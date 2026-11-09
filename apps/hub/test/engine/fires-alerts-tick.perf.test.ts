// 03a §7.1 "fires_alerts pass with work p99 ≤ 20 ms" (task 22a review I3), and the cost of its `due` on an idle pass,
// which runs the §3.10 overload check every 500 ms (bound: the same 20 ms). AD-32: wall-clock bounds, so this runs only in
// the clean measurement (`pnpm test:perf`, project perf-hub), never in the normal gate.
//
// Fixture: the AD-27 normal peak day of seed 7, the state with the most lines waiting to fire (as fires-tick.perf.test.ts).
// The simulator's orders have no placed_by, so the peak state's orders get one seeded order taker (in the hub directory):
// that makes the slips raisable (task 17c).
// - (a) idle: `due` on the read-only view with no flag set and an empty dropped-line queue, at the peak's instant.
// - (b) with work, at the peak's instant: no slip is due yet there (the first is due ~2 min later), so each sample raises
//   the DROPS dropped-line facts plus whatever overloads and closes the peak holds. It times no slip raise.
// - (c) with work and slips, at `nextAlertDueAt(peak.state) + 60 s`: the same raise pass, with the slips due then (about
//   ten) raised too. It times the slip raise path; untimed, each pass must have raised every slip due, none skipped.
// Untimed before each sample of (b) and (c): the alerts of the three kinds an earlier sample raised are deleted (so nothing
// dedupes) and DROPS dropped-line facts are queued. One pass = 01d's tickPass body (`due`, then its own writer.run with
// `intents`). Each sample swaps the same peak state back and rebinds the tick's host memory (skipped, red_since,
// overload_open), so no sample leans on another's result.
import { performance } from 'node:perf_hooks';
import { getAlertIntents, nextAlertDueAt, type EngineState } from '@pos/engine';
import { generateDay, runDay } from '@pos/engine/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindFiresAlertsTick, ENGINE_ALERT_KINDS, firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { hostFlags } from '../../src/engine-host/host-flags';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';

const SEED = 7;
const PASS_P99_MS = 20; // §7.1
const WARM_UP = 3;
const SAMPLES = 31;
const DROPS = 5;
const ORDER_TAKER = 'S_WAIT'; // in the fixtures' directory (aDirectory)
const HOOK_MS = 3_600_000; // a watchdog for the day's simulation, not a bound

const pctl = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]!;
};
const unfiredOf = (s: EngineState): number => {
  let n = 0;
  for (const id in s.stations) n += s.stations[id]!.unfired.length;
  return n;
};
const report = (row: string, samples: readonly number[], extra: string): void => {
  process.stderr.write(
    `[03a §7.1 fires_alerts ${row}] ${extra}; ${SAMPLES} samples: p50 ${pctl(samples, 0.5).toFixed(2)} / p99 ${pctl(samples, 0.99).toFixed(2)} / max ${Math.max(...samples).toFixed(2)} ms\n`,
  );
};

describe('[03a §7.1 fires_alerts] the fires_alerts due and pass at the AD-27 normal peak, through the hub', () => {
  let hub: TestHub;
  let peak: { state: EngineState; at: number; unfired: number; seq: number };

  beforeAll(async () => {
    let best: { state: EngineState; seq: number; unfired: number } | null = null;
    const run = runDay(generateDay(SEED), {
      watch: (state, seq) => {
        const unfired = unfiredOf(state);
        if (best === null || unfired > best.unfired) best = { state, seq, unfired };
      },
    });
    const b = best!;
    // The simulator submits without actor_id, so no order has a receiver; give each one (in this file only).
    const orders: EngineState['orders'] = Object.fromEntries(Object.entries(b.state.orders).map(([id, o]) => [id, { ...o, placed_by: ORDER_TAKER }]));
    peak = { ...b, state: { ...b.state, orders }, at: run.events[b.seq - 1]!.recorded_at };
    hub = await createTestHub();
    await seedDirectory(hub);
  }, HOOK_MS);

  afterAll(async () => {
    await hub?.close();
  });

  const reset = (): void => {
    hub.deps.state.swap(peak.state);
    bindFiresAlertsTick(hub.deps);
    hostFlags.reconcile = false;
    hostFlags.day_closed = false;
  };

  it(`[03a §7.1 fires_alerts idle] due on an idle pass (the overload check), p99 ≤ ${PASS_P99_MS} ms`, () => {
    const view = readOnlyDb(hub.deps.db);
    const now = peak.at;
    hub.clock.set(now);
    const samples: number[] = [];
    let due = false;
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      reset();
      const started = performance.now();
      due = firesAlertsTick.due(view, hub.deps.state.get(), now);
      const ms = performance.now() - started;
      if (i >= WARM_UP) samples.push(ms);
    }
    report('idle', samples, `peak seq ${peak.seq}, ${peak.unfired} unfired, due ${String(due)}`);
    expect(pctl(samples, 0.99)).toBeLessThanOrEqual(PASS_P99_MS);
  });

  // slipPath: every pass must raise every slip due at `now`, none skipped (asserted outside the timed part).
  function withWork(now: number, row: string, slipPath: boolean): void {
    const view = readOnlyDb(hub.deps.db);
    hub.clock.set(now);
    const samples: number[] = [];
    const appended: number[] = [];
    const raised: number[] = [];
    const slipRows: number[] = [];
    let wanted = 0;
    let ran = 0;
    const kinds = JSON.stringify(Object.values(ENGINE_ALERT_KINDS));
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      reset();
      hub.deps.db.prepare('DELETE FROM alerts WHERE kind IN (SELECT value FROM json_each(?))').run(kinds);
      for (let d = 0; d < DROPS; d += 1) hostFlags.dropped_lines.push({ order_id: `PERF-O${d}`, order_item_id: `PERF-L${d}`, reason: 'station_missing', batch: false });
      // 02p E-9: the slips due are counted on the reset state, before the pass folds its SlipWarned events.
      if (slipPath) wanted = getAlertIntents(hub.deps.state.get(), now).slips.length;
      const started = performance.now();
      let n = 0;
      let r = 0;
      if (firesAlertsTick.due(view, hub.deps.state.get(), now)) {
        ran += 1;
        const events = hub.deps.writer.run((tx) => tx.append(firesAlertsTick.intents(tx, hub.deps.state.get(), now))).appended;
        n = events.length;
        r = events.filter((e) => e.event_type === 'AlertRaised').length;
      }
      const ms = performance.now() - started;
      if (slipPath) {
        const got = (hub.deps.db.prepare('SELECT count(*) AS n FROM alerts WHERE kind = ?').get(ENGINE_ALERT_KINDS.slip) as { n: number }).n;
        expect(hostFlags.skipped.size).toBe(0);
        expect(got).toBeGreaterThanOrEqual(1);
        expect(got).toBe(wanted);
        slipRows.push(got);
      }
      if (i >= WARM_UP) {
        samples.push(ms);
        appended.push(n);
        raised.push(r);
      }
    }
    report(row, samples, `peak seq ${peak.seq}${slipPath ? `, ${wanted} slips due` : ''}, drafts first/last sample ${appended[0]}/${appended[appended.length - 1]}`);
    expect(ran).toBe(WARM_UP + SAMPLES); // every sample is a pass with work
    expect(Math.min(...raised)).toBeGreaterThanOrEqual(DROPS); // and a raise pass, never a dedupe pass
    if (slipPath) expect(Math.min(...slipRows)).toBeGreaterThanOrEqual(1); // not a timing: a slip raise path, every pass
    expect(pctl(samples, 0.99)).toBeLessThanOrEqual(PASS_P99_MS);
  }

  it(`[03a §7.1 fires_alerts] due + the tick's transaction with work, p99 ≤ ${PASS_P99_MS} ms`, () => {
    withWork(peak.at, 'with work', false);
  });

  it(`[03a §7.1 fires_alerts slips] due + the tick's transaction with work and slips, p99 ≤ ${PASS_P99_MS} ms`, () => {
    withWork(nextAlertDueAt(peak.state, new Set())! + 60_000, 'with work and slips', true);
  });
});
