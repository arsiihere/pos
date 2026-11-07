// 03a §7.1 "fires_alerts pass with work p99 ≤ 20 ms" (task 22a review I3), and the cost of its `due` on an idle pass,
// which runs the §3.10 overload check every 500 ms (bound: the same 20 ms). AD-32: wall-clock bounds, so this runs only in
// the clean measurement (`pnpm test:perf`, project perf-hub), never in the normal gate.
//
// Fixture: the AD-27 normal peak day of seed 7, the state with the most lines waiting to fire (as fires-tick.perf.test.ts).
// - (a) idle: `due` on the read-only view with no flag set and an empty dropped-line queue, at the peak's instant.
// - (b) with work: the reconcile flag forces the pass (2 listOpen), plus whatever slips, closes and overloads the peak
//   holds at that instant; one pass = 01d's tickPass body (`due`, then its own writer.run with `intents`).
// Each sample swaps the same peak state back and rebinds the tick's host memory (skipped, red_since, overload_open), so no
// sample leans on another's in-memory result. Alerts raised by an earlier sample stay open in the database, so later
// samples dedupe them: the reads are the same, the appends fewer.
import { performance } from 'node:perf_hooks';
import { type EngineState } from '@pos/engine';
import { generateDay, runDay } from '@pos/engine/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bindFiresAlertsTick, firesAlertsTick } from '../../src/engine-host/fires-alerts-tick';
import { hostFlags } from '../../src/engine-host/host-flags';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { createTestHub, type TestHub } from '../helpers/test-hub';
import { registerEngineKindFakes, resetEngineKindFakes } from './fakes';

const SEED = 7;
const PASS_P99_MS = 20; // §7.1
const WARM_UP = 3;
const SAMPLES = 31;
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
    registerEngineKindFakes();
    let best: { state: EngineState; seq: number; unfired: number } | null = null;
    const run = runDay(generateDay(SEED), {
      watch: (state, seq) => {
        const unfired = unfiredOf(state);
        if (best === null || unfired > best.unfired) best = { state, seq, unfired };
      },
    });
    const b = best!;
    peak = { ...b, at: run.events[b.seq - 1]!.recorded_at };
    hub = await createTestHub();
  }, HOOK_MS);

  afterAll(async () => {
    await hub?.close();
    resetEngineKindFakes();
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

  it(`[03a §7.1 fires_alerts] due + the tick's transaction with work, p99 ≤ ${PASS_P99_MS} ms`, () => {
    const view = readOnlyDb(hub.deps.db);
    const now = peak.at;
    hub.clock.set(now);
    const samples: number[] = [];
    const appended: number[] = [];
    let ran = 0;
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      reset();
      hostFlags.reconcile = true; // forces a pass with work: the two listOpen at least
      const started = performance.now();
      let n = 0;
      if (firesAlertsTick.due(view, hub.deps.state.get(), now)) {
        ran += 1;
        n = hub.deps.writer.run((tx) => tx.append(firesAlertsTick.intents(tx, hub.deps.state.get(), now))).appended.length;
      }
      const ms = performance.now() - started;
      if (i >= WARM_UP) {
        samples.push(ms);
        appended.push(n);
      }
    }
    report('with work', samples, `peak seq ${peak.seq}, drafts first/last sample ${appended[0]}/${appended[appended.length - 1]}`);
    expect(ran).toBe(WARM_UP + SAMPLES); // every sample is a pass with work
    expect(pctl(samples, 0.99)).toBeLessThanOrEqual(PASS_P99_MS);
  });
});
