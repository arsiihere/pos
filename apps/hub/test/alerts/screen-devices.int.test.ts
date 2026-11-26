import type { DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineAlertKind, unregisterAlertKind } from '../../src/alerts/kinds';
import { alerts, type RaiseInput } from '../../src/alerts/raise';
import { registeredRoutes } from '../../src/alerts/routes';
import { alertsTick, startTickLoop, TICK_MS } from '../../src/alerts/tick';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { loadDeviceProfiles } from '../../src/auth/device-profile';
import { activity } from '../../src/auth/session-store';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { appendDeviceProfile, createTestHub, pairDevice, seedDirectory, type DeviceProfileInput, type TestHub } from '../helpers/test-hub';
import { registerFakes, resetFakes } from './fakes';

// 01d v1.3.7 §3.4, §3.5 (03b v1.0.16 D-7; 02b-tk R8), §11 (a): the step target `screen_devices`. Tests 106 (who it
// reaches, statement bound), 112 (the device list is re-read per step), 114 (the gate is fixed at raise).

const BRANCH = 'branch-1';
const CASH = 'S_CASH';
const KIND = 't_counter';
const STEP_1_MS = 30_000;

/** 03b's ready kind in miniature: step 0 to the raised target and the counter screens, step 1 to the counter screens. */
function defineCounterKind(): void {
  const counter = { target: { kind: 'screen_devices', screen_from_value: 'counter_screen' }, set: 'recipient' } as const;
  defineAlertKind({
    kind: KIND,
    family: 'action',
    subject: 'hub',
    steps: [
      { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }, counter] },
      { at: { ms: STEP_1_MS }, to: [counter] },
    ],
    closes_on: 'owner',
    values_schema: z.object({ counter_screen: z.enum(['takeaway', 'parking']).optional() }),
    details_schema: null,
    lead_fallback: false,
    expires_at_day_close: true,
    silent: false,
    labels: { card: 'alert.t_counter.card', lock: 'alert.t_counter.lock' },
    request: null,
  });
}

describe('[01d v1.3.7 §3.4 screen_devices] #106 #112 #114', () => {
  let hub: TestHub;
  let stop: () => void = () => undefined;
  const log = { error: vi.fn<(obj: Record<string, unknown>, msg?: string) => void>() };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    hub = await createTestHub();
    registerFakes();
    defineCounterKind();
    await seedDirectory(hub, (await aDirectory()) as DirectoryInput);
    hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
  });

  afterEach(async () => {
    stop();
    stop = () => undefined;
    unregisterAlertKind(KIND);
    resetFakes();
    activity.drain();
    activity.drainDevices();
    vi.useRealTimers();
    await hub.close();
  });

  const device = (type: 'tablet' | 'cashier_kiosk' | 'kds', name: string, profile?: DeviceProfileInput): string =>
    pairDevice(hub, { type, name, ...(type === 'kds' ? { stationId: 'station-1' } : {}), ...(profile === undefined ? {} : { profile }) }).deviceId;
  const takeaway: DeviceProfileInput = { access: 'everyone', screens: ['takeaway', 'cashier'] };

  /** A `DeviceProfileSet` with `needs_review: true` (05a: still in force until reviewed). */
  function needsReview(deviceId: string, screens: DeviceProfileInput['screens']): void {
    hub.deps.writer.run((tx) => {
      tx.append([
        {
          stream_type: 'hub',
          stream_id: deviceId,
          event_type: 'DeviceProfileSet',
          schema_version: 1,
          payload: { device_id: deviceId, device_name: 'Review tablet', access: 'everyone', staff_ids: [], screens, point_id: null, profile_version: 1, cause: 'upgrade', needs_review: true },
          occurred_at: hub.clock.branchNow(),
          actor_id: null,
          device_id: 'hub',
        },
      ]);
    });
  }

  function revoke(deviceId: string): void {
    hub.deps.db.prepare('UPDATE devices SET revoked_at = ? WHERE device_id = ?').run(hub.clock.branchNow(), deviceId);
    loadDeviceProfiles(hub.deps.db);
  }

  const input = (n: number, values: Record<string, unknown> = { counter_screen: 'takeaway' }): RaiseInput => ({
    kind: KIND,
    subject: { stream_type: 'hub', stream_id: BRANCH },
    target: { kind: 'person', staff_id: CASH },
    values,
    display: { kind_label_key: 'alert.t_counter.lock', table_code: `#${n}` },
    dedupe_key: `counter:${n}`,
  });

  function raise(inputs: RaiseInput[]): string[] {
    return hub.deps.writer.run((tx) => {
      const results = alerts.raiseMany(alerts.tickCtx(tx, hub.clock.branchNow()), inputs);
      tx.append(results.flatMap((r) => r.events));
      return results.map((r) => r.alert_id);
    }).result;
  }

  function stepDevices(alertId: string, step: number): string[] {
    const rows = hub.deps.db
      .prepare("SELECT payload FROM events WHERE event_type IN ('AttemptSent', 'EscalationStepped') ORDER BY seq")
      .all() as Array<{ payload: string }>;
    const p = rows.map((r) => JSON.parse(r.payload) as { alert_id: string; step: number; recipients: Array<{ device_id: string | null }> }).find((x) => x.alert_id === alertId && x.step === step);
    if (p === undefined) throw new Error(`no step ${step} for ${alertId}`);
    return p.recipients.flatMap((r) => (r.device_id === null ? [] : [r.device_id])).sort();
  }

  async function pass(): Promise<void> {
    await vi.advanceTimersByTimeAsync(TICK_MS);
  }

  it('#106: reaches the unrevoked devices whose profile shows the screen (needs_review counts); absent → nobody', () => {
    const kiosk = device('cashier_kiosk', 'Counter kiosk', takeaway);
    const tablet = device('tablet', 'Review tablet');
    needsReview(tablet, ['takeaway']);
    device('cashier_kiosk', 'Dine-in kiosk', { access: 'everyone', screens: ['dine_in', 'cashier'] });
    const gone = device('cashier_kiosk', 'Old kiosk', takeaway);
    revoke(gone);
    device('kds', 'Grill KDS');
    device('tablet', 'No profile');
    const [id] = raise([input(1)]) as [string];
    expect(stepDevices(id, 0)).toEqual([kiosk, tablet].sort());
    const [none] = raise([input(2, {})]) as [string];
    expect(stepDevices(none, 0)).toEqual([]);
    const parking = device('tablet', 'Parking tablet', { access: 'everyone', screens: ['parking'] });
    const [park] = raise([input(3, { counter_screen: 'parking' })]) as [string];
    expect(stepDevices(park, 0)).toEqual([parking]);
  });

  it('#106: statements stay fixed whatever the number of counter devices (raise, raiseMany ×3, one tick pass with 3 due)', () => {
    const counter = statementCounter(hub.deps.db);
    /** Statements of the raise call itself (the projection folds of the append are not the raise's). */
    const raiseCount = (inputs: RaiseInput[]): number =>
      hub.deps.writer.run((tx) => {
        counter.reset();
        const results = alerts.raiseMany(alerts.tickCtx(tx, hub.clock.branchNow()), inputs);
        const n = counter.count;
        tx.append(results.flatMap((r) => r.events));
        return n;
      }).result;
    /** §3.5 "Reads per tick": `due` (read-only view) + `intents` (in the transaction), as bounds.int.test.ts. */
    const tickCount = (): number => {
      const now = hub.clock.branchNow();
      counter.reset();
      expect(alertsTick.due(readOnlyDb(hub.deps.db), {} as never, now)).toBe(true);
      let n = counter.count;
      hub.deps.writer.run((tx) => {
        counter.reset();
        const drafts = alertsTick.intents(tx, {} as never, now);
        n += counter.count;
        return tx.append(drafts);
      });
      return n;
    };
    const measure = (n0: number): { raise: number; many: number; tick: number } => {
      const one = raiseCount([input(n0)]);
      const many = raiseCount([input(n0 + 1), input(n0 + 2)]) && raiseCount([input(n0 + 3), input(n0 + 4), input(n0 + 5)]);
      hub.clock.advance(STEP_1_MS);
      hub.deps.db.prepare('UPDATE alert_flags SET dirty = 0').run();
      const tick = tickCount();
      const due = hub.deps.db.prepare("SELECT COUNT(*) AS n FROM alerts WHERE kind = ? AND step = 1 AND alert_id IN (SELECT alert_id FROM alerts WHERE dedupe_key IN (SELECT value FROM json_each(?)))").get(
        KIND,
        JSON.stringify([n0 + 3, n0 + 4, n0 + 5].map((n) => `counter:${n}`)),
      ) as { n: number };
      expect(due.n, 'the three raiseMany alerts stepped in one pass').toBe(3);
      return { raise: one, many, tick };
    };
    device('cashier_kiosk', 'K1', takeaway);
    const few = measure(10);
    for (let i = 0; i < 6; i += 1) device('tablet', `T${i}`, takeaway);
    const more = measure(20);
    expect(more).toEqual(few);
    // §3.5: 1 + 8 + R + T, here R = 0 (no resolver: screen_devices reads read (5) and the profile map)
    expect(few.tick).toBeLessThanOrEqual(1 + 8 + 0 + registeredRoutes().length);
  });

  it('#112: the device list is re-read per step: a device revoked after step 0 drops out, a device given the screen joins', async () => {
    const k = device('cashier_kiosk', 'K', takeaway);
    const l = device('cashier_kiosk', 'L', takeaway);
    const m = device('tablet', 'M', { access: 'everyone', screens: ['dine_in'] });
    const [id] = raise([input(1)]) as [string];
    expect(stepDevices(id, 0)).toEqual([k, l].sort());
    revoke(l);
    appendDeviceProfile(hub, m, { access: 'everyone', screens: ['dine_in', 'takeaway'] });
    stop = startTickLoop(hub.deps, log);
    hub.clock.advance(STEP_1_MS);
    await pass();
    expect(stepDevices(id, 1)).toEqual([k, m].sort());
  });

  it('#114: the gate is fixed at raise: raised without counter_screen, no counter device at any step, even after one gains the screen', async () => {
    const t = device('tablet', 'T', { access: 'everyone', screens: ['dine_in'] });
    device('cashier_kiosk', 'K', takeaway);
    const [id] = raise([input(1, {})]) as [string];
    expect(stepDevices(id, 0)).toEqual([]);
    appendDeviceProfile(hub, t, { access: 'everyone', screens: ['takeaway'] });
    stop = startTickLoop(hub.deps, log);
    hub.clock.advance(STEP_1_MS);
    await pass();
    expect(stepDevices(id, 1)).toEqual([]);
    const stored = hub.deps.db.prepare('SELECT values_json FROM alerts WHERE alert_id = ?').get(id) as { values_json: string };
    expect(JSON.parse(stored.values_json)).toEqual({});
  });
});
