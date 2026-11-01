import { performance } from 'node:perf_hooks';
import type { DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { activity } from '../../src/auth/session-store';
import { cryptoSecrets } from '../../src/lib/secrets';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { connectWs, type WsClient } from '../helpers/ws-client';
import { FAKE_STEP_1_MS, registerFakes, resetFakes } from './fakes';

// 01d task 30: §10 test 58, the timed tick (m9), §7 Performance: "raise ≤ 5 ms in-transaction at 10 sockets;
// tick with 200 due ≤ 50 ms". In the style of 00 #79 (a measurement of the machine it runs on): it runs only on
// the pilot mini PC (POS_PILOT_HW=1) and is skipped elsewhere. Timings use performance.now() in test code
// only; the hub clock stays the fixed test clock (no Date.now()).

const BRANCH = 'branch-1';
const SOCKETS = 10;
const DUE = 200;
const TICK_LIMIT_MS = 50;
const RAISE_LIMIT_MS = 5;
const RAISE_RUNS = 20;
const ON_PILOT = process.env.POS_PILOT_HW === '1';

const sid = (i: number): string => `S_T${i}`;

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = (base.staff[0] as DirectoryInput['staff'][number]).pin_hash;
  const staff = [...base.staff];
  for (let i = 0; i < SOCKETS; i += 1) {
    staff.push({ staff_id: sid(i), display_name: `Staff ${i}`, pin_hash: pin, role_ids: ['R_WAIT'], denied_permissions: [], lead_staff_id: null, floor_ids: [] });
  }
  return { ...base, staff };
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + (s[mid] as number)) / 2 : (s[mid] as number);
};

describe('01d timed tick (§7 Performance; test 58)', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const clients: WsClient[] = [];
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    registerFakes();
    await seedDirectory(hub, await directory());
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    for (const c of clients.splice(0)) c.close();
    vi.restoreAllMocks();
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.useRealTimers();
    await hub.close();
  });

  const twoStep = (n: number): RaiseInput => ({
    kind: 't_two_step',
    subject: { stream_type: 'hub', stream_id: BRANCH },
    target: { kind: 'person', staff_id: sid(n % SOCKETS) },
    display: { kind_label_key: 'alert.t.lock' },
    dedupe_key: `timed:${n}`,
  });

  it.skipIf(!ON_PILOT)(
    `[01d #58] timed tick on the pilot mini PC: ${DUE} due alerts with ${SOCKETS} sockets → the tick's writer.run ≤ ${TICK_LIMIT_MS} ms; one raise ≤ ${RAISE_LIMIT_MS} ms in-transaction (median of ${RAISE_RUNS})`,
    async () => {
      // 10 staff sessions, each on its own tablet with a live socket. testSecrets repeats after 8 tokens
      // (256 bytes), so the tokens of this test's 20 devices and sessions are random (test code only).
      (hub.deps as { secrets: typeof cryptoSecrets }).secrets = cryptoSecrets;
      for (let i = 0; i < SOCKETS; i += 1) {
        const device = pairDevice(hub, { type: 'tablet', name: sid(i) });
        const session = openSession(hub, { kind: 'staff', staffId: sid(i), deviceId: device.deviceId });
        const ws = await connectWs(hub.app);
        ws.send({ type: 'auth', device_token: device.token, session_token: session.token });
        await ws.untilCount(1);
        expect(ws.messages[0]).toMatchObject({ type: 'catch_up' });
        clients.push(ws);
      }

      // one raise, in-transaction, median of 20 (each its own transaction: the fixed reads are not cached)
      const raiseMs: number[] = [];
      for (let n = 0; n < RAISE_RUNS; n += 1) {
        hub.deps.writer.run((tx) => {
          const started = performance.now();
          const r = alerts.raise(alerts.tickCtx(tx, hub.clock.branchNow()), twoStep(10_000 + n));
          raiseMs.push(performance.now() - started);
          tx.append(r.events);
        });
      }

      // with the 20 timed raises, 200 alerts due at the same pass (step 1 at the same time)
      hub.deps.writer.run((tx) => {
        const results = alerts.raiseMany(
          alerts.tickCtx(tx, hub.clock.branchNow()),
          Array.from({ length: DUE - RAISE_RUNS }, (_, n) => twoStep(n)),
        );
        tx.append(results.flatMap((r) => r.events));
      });
      // SessionStarted marks no_approver dirty; its flag pass is task 31: start clean
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();

      const run = hub.deps.writer.run.bind(hub.deps.writer);
      const runs: Array<{ ms: number; steps: number }> = [];
      vi.spyOn(hub.deps.writer, 'run').mockImplementation(((fn: Parameters<typeof run>[0]) => {
        const started = performance.now();
        const out = run(fn);
        const steps = out.appended.filter((e) => e.event_type === 'AttemptSent').length;
        runs.push({ ms: performance.now() - started, steps });
        return out;
      }) as typeof run);
      stop = startTickLoop(hub.deps, log);
      hub.clock.advance(FAKE_STEP_1_MS);
      await vi.advanceTimersByTimeAsync(TICK_MS);

      expect(log.error).not.toHaveBeenCalled();
      expect(runs).toHaveLength(1);
      const tick = runs[0] as { ms: number; steps: number };
      expect(tick.steps).toBe(DUE);
      const raise = median(raiseMs);
      process.stdout.write(`[01d #58] tick ${tick.ms.toFixed(1)} ms (limit ${TICK_LIMIT_MS} ms); raise median ${raise.toFixed(2)} ms (limit ${RAISE_LIMIT_MS} ms)\n`);
      expect(tick.ms).toBeLessThanOrEqual(TICK_LIMIT_MS);
      expect(raise).toBeLessThanOrEqual(RAISE_LIMIT_MS);
    },
  );
});
