// 03a §10.6, §7.1 "Overload pass", §3.5.6 (task 18): the overload day, tandoor at 125 %. The bounds are the spec's.
import { beforeAll, describe, expect, it } from 'vitest';
import { dist, step, writeSamples } from './perf-kit';
import { generateDay, policyReport, runDay, type SimDay, type SimResult } from './index';

const HOOK_MS = 3_600_000; // a watchdog, not a bound (day.perf.test.ts)
const PROBES_MAX = 16; // §7.1
const REPLAN_P99_MS = 50; // §7.1

describe('[03a §10.6] the overload day (seed 7, tandoor at 125 %)', () => {
  let day: SimDay;
  let run: SimResult;

  beforeAll(() => {
    day = generateDay(7, { overload: true });
    run = step(
      'overload_run',
      () => runDay(day),
      (r) => {
        const byStation: Record<string, { searches: number; max_probes: number }> = {};
        r.overloadStations.forEach((station, i) => {
          const row = byStation[station] ?? { searches: 0, max_probes: 0 };
          row.searches++;
          row.max_probes = Math.max(row.max_probes, r.overloadProbes[i]!);
          byStation[station] = row;
        });
        return {
          tandoor_capacity: day.stations.find((s) => s.station_id === 'tandoor')!.capacity,
          replan_ms: dist(r.replanMs),
          replaced_lines: dist(r.replacedLines),
          overload_searches: r.overloadProbes.length,
          overload_probes_max: r.overloadProbes.length === 0 ? null : Math.max(...r.overloadProbes),
          overload_by_station: byStation,
          events: r.events.length,
        };
      },
    );
    writeSamples('overload_replan_ms', run.replanMs);
    writeSamples('overload_probes', run.overloadProbes);
    step('overload_policy_waada_guard', () => policyReport(run), (r) => r);
  }, HOOK_MS);

  it('[03a §10.6] the overload pass really ran, so its bound is not vacuous', () => {
    expect(run.overloadProbes.length).toBeGreaterThan(0);
  });

  it('[03a §10.6, §3.5.6] ≤ 16 probes', () => {
    expect(Math.max(...run.overloadProbes)).toBeLessThanOrEqual(PROBES_MAX);
  });

  it('[03a §10.6] re-plan per submit p99 ≤ 50 ms, the overload pass included', () => {
    expect(dist(run.replanMs).p99).toBeLessThanOrEqual(REPLAN_P99_MS);
  });
});
