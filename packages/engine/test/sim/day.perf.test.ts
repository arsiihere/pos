// 03a §10.6, §7.1, §12.1 DoD 6, BF-7 (task 18): the performance gate on the generated day. The bounds are the spec's and
// a miss stays red (the plan's stop rule). One shared run per describe in beforeAll; each `it` only reads results. Every
// number is on disk (perf-kit, task-18-numbers.json) before the next step starts.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyEvent, ENGINE_REPLAY_EVENTS, initialEngineState, noOrderInEngine, toCheckpoint } from '../../src/index';
import { generateDay, policyReport, runDay, twoDayLog, type SimResult } from './index';
import { dist, keepEvery, measureAtPeak, peakPass, peakSummary, replayFrom, sameState, step, writeSamples, type AtPeak, type Peak } from './perf-kit';

// A watchdog for a day's work, not a bound. Vitest's default hookTimeout is 10 s and the perf project sets testTimeout only.
const HOOK_MS = 3_600_000;
const SEED = 7;
const REPLAN_P99_MS = 50; // §7.1
const REPLAY_DAY_MS = 45_000; // §7.1
const REPLAY_TWO_DAYS_MS = 80_000; // §7.1
const SNAPSHOT_MS = 50; // §7.1, P-12: the serialise part; task 21 asserts the full write on the same state
const BF7_MS = 50; // BF-7: inside the 50 ms
const R6_REPLAYED_EVENTS = 45_000; // README R6, AD-26
const R6_TOLERANCE = 0.2; // §10.6
const PEAK_SAMPLES = 21;
const REPLAYED: ReadonlySet<string> = new Set(Object.values(ENGINE_REPLAY_EVENTS).flat());

const closeSummary = (r: SimResult) => ({
  replan_ms: dist(r.replanMs),
  replaced_lines: dist(r.replacedLines),
  overload_searches: r.overloadProbes.length,
  overload_probes_max: r.overloadProbes.length === 0 ? null : Math.max(...r.overloadProbes),
  events: r.events.length,
  events_replayed: r.events.filter((e) => REPLAYED.has(e.event_type)).length,
  diagnostics: r.liveState.diagnostics.length,
});

describe('[03a §10.6] the generated day (seed 7, 2 000 orders)', () => {
  let run: SimResult;
  let replay: ReturnType<typeof replayFrom>;
  let peak: Peak;
  let at: AtPeak;

  beforeAll(() => {
    const day = generateDay(SEED);
    const live = new Map<number, string>();
    run = step('day_run', () => runDay(day, { watch: keepEvery(live, 500) }), (r) => ({ ...closeSummary(r), orders: day.orders.length, lines: day.orders.reduce((n, o) => n + o.lines.length, 0) }));
    writeSamples('day_replan_ms', run.replanMs);
    writeSamples('day_replaced_lines', run.replacedLines);
    // The log's own first event is the config: the checkpoint a previous night would have left (§3.12), no orders in it.
    const checkpoint = toCheckpoint(applyEvent(initialEngineState(), run.events[0]!), run.events[0]!.seq);
    replay = step('day_replay_from_checkpoint', () => replayFrom(checkpoint, run.events, 1), (r) => ({ ms: r.ms, events: r.events, fold_mean_ms: r.ms / r.events }));
    step('day_rebuild_from_seq_0', () => replayFrom({ ...checkpoint, config: null, stations: {}, stock: {}, business_day: null, last_seq: 0 }, run.events, 0), (r) => ({ ms: r.ms, events: r.events, equals_live: sameState(r.state, run.liveState) }));
    peak = step('day_peak_pass', () => peakPass(run.events, live), (p) => ({ by_unfired: peakSummary(p.byUnfired), by_lines: peakSummary(p.byLines), fold_mean_ms: p.fold_mean_ms, fold_by_type: p.fold_by_type, live_compared: p.live_compared, live_mismatches: p.live_mismatches }));
    at = step('day_at_peak', () => measureAtPeak(peak, day, run.events, { samples: PEAK_SAMPLES }), (m) => m);
    step('day_policy_waada_guard', () => policyReport(run), (r) => r);
  }, HOOK_MS);

  it('[03a §10.6] re-plan per submit p99 ≤ 50 ms', () => {
    expect(run.replanMs).toHaveLength(2_000);
    expect(dist(run.replanMs).p99).toBeLessThanOrEqual(REPLAN_P99_MS);
  });

  it('[03a §10.6] full-day replay from a checkpoint ≤ 45 s', () => {
    expect(replay.ms).toBeLessThanOrEqual(REPLAY_DAY_MS);
  });

  it('[03a §10.6] events ≈ R6 (±20 %)', () => {
    const replayed = run.events.filter((e) => REPLAYED.has(e.event_type)).length;
    expect(replayed).toBeGreaterThanOrEqual(R6_REPLAYED_EVENTS * (1 - R6_TOLERANCE));
    expect(replayed).toBeLessThanOrEqual(R6_REPLAYED_EVENTS * (1 + R6_TOLERANCE));
  });

  it('[03a §10.6] live state = replayed state, at the end of the day and at the kept points through it', () => {
    expect(replay.state).toEqual(run.liveState);
    expect(peak.live_compared).toBeGreaterThan(50);
    expect(peak.live_mismatches).toEqual([]);
  });

  // The stricter reading: §7.1 gives this row no percentile, so every sample counts.
  it('[03a §10.6, §7.1, P-12] snapshot serialisation of the peak state ≤ 50 ms', () => {
    expect(at.snapshot.ms.n).toBe(PEAK_SAMPLES);
    expect(at.snapshot.ms.max).toBeLessThanOrEqual(SNAPSHOT_MS);
  });

  it('[03a BF-7] a 20-line StockAdded at the peak, stockEffects + folds, inside the 50 ms', () => {
    expect(at.errors).toEqual({});
    expect(at.bf7!.flipped).toBe(20);
    expect(at.bf7!.hidden_before).toBe(20);
    expect(at.bf7!.ms.max).toBeLessThanOrEqual(BF7_MS);
  });

  // P-11: the re-placed-lines bound is not asserted while a spec bound misses (task 18 report; "Simulator bounds" in the plan).
});

describe('[03a §10.6] two days on one log (a deferred checkpoint never written, §3.12)', () => {
  let two: SimResult;
  let replay: ReturnType<typeof replayFrom>;

  beforeAll(() => {
    two = step('two_day_build', () => twoDayLog(SEED), (r) => closeSummary(r));
    const closeIndex = two.events.findIndex((e) => e.event_type === 'BusinessDayClosed');
    const checkpoint = toCheckpoint(applyEvent(initialEngineState(), two.events[0]!), two.events[0]!.seq);
    replay = step('two_day_replay', () => replayFrom(checkpoint, two.events, 1, closeIndex), (r) => ({ ms: r.ms, events: r.events, fold_mean_ms: r.ms / r.events }));
    // Beside it: day two alone, from the checkpoint day one's close really leaves (§3.12).
    const closed = replay.captured!;
    const closeEvent = two.events[closeIndex]!;
    step(
      'two_day_second_day_from_close_checkpoint',
      () => replayFrom(toCheckpoint(closed, closeEvent.seq), two.events, closeIndex + 1),
      (r) => ({
        ms: r.ms,
        events: r.events,
        no_order_in_engine_at_close: noOrderInEngine(closed, closeEvent.recorded_at),
        equals_live_diagnostics_aside: sameState({ ...r.state, diagnostics: [] }, { ...two.liveState, diagnostics: [] }),
      }),
    );
  }, HOOK_MS);

  it('[03a §10.6] 2-day replay ≤ 80 s', () => {
    expect(replay.ms).toBeLessThanOrEqual(REPLAY_TWO_DAYS_MS);
  });

  it('[03a §10.6] live state = replayed state over the two days', () => {
    expect(two.events.filter((e) => e.event_type === 'BusinessDayClosed')).toHaveLength(2);
    expect(replay.state).toEqual(two.liveState);
  });
});

// D22, a report and no gate: the two other policies add a full day each, so they run only on request.
describe.runIf(process.env.POS_PERF_POLICY === '1')('[03a §10.6] policy report, FIFO and EDF on the full day', () => {
  it('[03a §10.6] FIFO and EDF run the day with no breach', () => {
    for (const policy of ['fifo', 'edf'] as const) {
      const report = step(`day_policy_${policy}`, () => policyReport(runDay(generateDay(SEED), { policy })), (r) => r);
      expect(report.breaches).toBe(0);
    }
  }, HOOK_MS);
});
