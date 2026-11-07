// 03a §10.6, AD-29 Q2: report-only full days on seeds 8 and 11, a normal and an overload day each. The day stays fitted to
// seed 7 (AD-27), so these demand bands are not fitted (bbq and tawa medians about 105 %) and they read as harder days:
// numbers on record, no bound on them, only that each day runs with no breach. Each day takes about a minute, so they run
// only with POS_PERF_SEEDS=1, when the gate is measured. In their own file so their heap never weighs on the gate's numbers.
import { describe, expect, it } from 'vitest';
import { applyEvent, ENGINE_REPLAY_EVENTS, initialEngineState, toCheckpoint } from '../../src/index';
import { demandPeakPct, generateDay, policyReport, runDay } from './index';
import { dist, replayFrom, SEED_DAYS, step } from './perf-kit';

const HOOK_MS = 3_600_000; // a watchdog, not a bound (day.perf.test.ts)
const REPLAYED: ReadonlySet<string> = new Set(Object.values(ENGINE_REPLAY_EVENTS).flat());

describe.runIf(process.env.POS_PERF_SEEDS === '1')('[03a §10.6, AD-29 Q2] report-only seeds', () => {
  it.each(SEED_DAYS)(
    '[03a §10.6, AD-29 Q2] $section runs with no breach',
    ({ seed, overload, section }) => {
      const { report } = step(
        section,
        () => {
          const day = generateDay(seed, { overload });
          const run = runDay(day);
          const first = run.events[0]!;
          const replay = replayFrom(toCheckpoint(applyEvent(initialEngineState(), first), first.seq), run.events, 1);
          return { day, run, replay, report: policyReport(run) };
        },
        ({ day, run, replay, report: r }) => ({
          orders: day.orders.length,
          demand_peak_pct: demandPeakPct(day),
          replan_ms: dist(run.replanMs),
          replaced_lines: dist(run.replacedLines),
          overload_searches: run.overloadProbes.length,
          overload_probes_max: run.overloadProbes.length === 0 ? null : Math.max(...run.overloadProbes),
          events: run.events.length,
          events_replayed: run.events.filter((e) => REPLAYED.has(e.event_type)).length,
          replay_ms: replay.ms,
          policy: r,
        }),
      );
      expect(report.breaches).toBe(0);
    },
    HOOK_MS,
  );
});
