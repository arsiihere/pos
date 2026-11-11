// 03a §7.1 "fires pass with work p99 ≤ 20 ms" (task 22, test 62's hub row). AD-32: a wall-clock bound, so it runs only in
// the clean measurement (`pnpm test:perf`, project perf-hub), never in the normal gate.
//
// Fixture: the AD-27 normal peak day of seed 7 (@pos/engine/sim), the state with the most lines waiting to fire, at
// now = max(its instant, nextDueAt) — the same point and now as the engine-only "Fires tick" row (day.perf.test.ts), so
// the two compare: this one adds the hub's due, the stamp, the appends, the fold and the COMMIT (WAL, synchronous=FULL).
// proposed (implementer): the peak is kept at the end of a watch call (after a whole batch or tap), not only at the end
// of an instant as the engine's peakPass does; the most-unfired state is the one after a submit, the last write of
// its instant, so in practice they are the same state.
//
// One pass = exactly 01d's tickPass body for this tick: `due` on the read-only view, then its own writer.run with
// `intents` inside. Each sample runs the same pass on the same immutable peak state (swapped back before each), so
// no sample leans on another's result; the log keeps growing, which only makes the appends a little heavier.
import { performance } from 'node:perf_hooks';
import { nextDueAt, type EngineState } from '@pos/engine';
import { generateDay, runDay } from '@pos/engine/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TICK_MS } from '../../src/alerts/tick';
import { unregisterTick } from '../../src/alerts/tick';
import { firesTick } from '../../src/engine-host/fires-tick';
import { hostFlags } from '../../src/engine-host/host-flags';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { createTestHub, type TestHub } from '../helpers/test-hub';

const SEED = 7;
const PASS_P99_MS = 20; // §7.1
const WARM_UP = 3; // untimed: the first pass after boot runs cold (JIT), a once-per-boot cost
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

describe('[03a §7.1 fires] the fires pass with work at the AD-27 normal peak, through the hub', () => {
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
    peak = { ...b, at: run.events[b.seq - 1]!.recorded_at };
    hub = await createTestHub();
    unregisterTick('table_locks'); // 02a §3.4: registerTables adds it to every test hub; this file counts the ticks
    for (const name of ['pass_closures', 'ready_retarget']) unregisterTick(name); // 03b §6.18–6.19 (b16): lane B5 adds both to every test hub too
  }, HOOK_MS);

  afterAll(async () => {
    await hub?.close();
  });

  it(`[03a §7.1 fires] due + the tick's transaction, p99 ≤ ${PASS_P99_MS} ms`, () => {
    const now = Math.max(peak.at, nextDueAt(peak.state, peak.at) ?? peak.at);
    const view = readOnlyDb(hub.deps.db);
    hub.clock.set(now);
    const samples: number[] = [];
    const drafts: number[] = [];
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      hub.deps.state.swap(peak.state);
      hostFlags.last_pass_ms = now - TICK_MS;
      const started = performance.now();
      let appended = 0;
      if (firesTick.due(view, hub.deps.state.get(), now)) {
        appended = hub.deps.writer.run((tx) => tx.append(firesTick.intents(tx, hub.deps.state.get(), now))).appended.length;
      }
      const ms = performance.now() - started;
      if (i >= WARM_UP) {
        samples.push(ms);
        drafts.push(appended);
      }
    }
    process.stderr.write(
      `[03a §7.1 fires] peak seq ${peak.seq}, ${peak.unfired} unfired, now − peak ${now - peak.at} ms, ${drafts[0]} drafts/pass; ` +
        `${SAMPLES} passes: p50 ${pctl(samples, 0.5).toFixed(2)} / p99 ${pctl(samples, 0.99).toFixed(2)} / max ${Math.max(...samples).toFixed(2)} ms\n`,
    );
    expect(Math.min(...drafts)).toBeGreaterThan(0); // every sample is a pass with work
    expect(pctl(samples, 0.99)).toBeLessThanOrEqual(PASS_P99_MS);
  });
});
