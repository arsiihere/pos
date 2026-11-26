// ⚠️ 03a v1.2.11 §10.6, §3.5.8 PK-12, §7.1 (hostile run 1 M-6; test 194): the pickup day, the normal peak day with 30 % of
// its takeaway orders carrying pickup_at_ms 30–240 min ahead and one to three drinks (a ready drink, a 1-min shake) on a
// one-unit drinks counter; every other order carries null (R2-m-8). Reported: hidden held lines per station, lines
// re-placed per station re-plan, re-plan p99, overload probes. Gates: re-plan p99 ≤ 50 ms and re-placed p99 ≤ 270 (P-11),
// as on the normal day; a miss stops the build and the spec is bumped first (PK-12). `pnpm test:perf` only, on the
// owner's machine: never in `pnpm -w test`, the cloud or CI.
import { beforeAll, describe, expect, it } from 'vitest';
import type { EngineState } from '../../src/index';
import { dist, step, writeSamples } from './perf-kit';
import { generateDay, runDay, type SimDay, type SimResult } from './index';

const HOOK_MS = 3_600_000; // a watchdog, not a bound (day.perf.test.ts)
const SEED = 7;
const REPLAN_P99_MS = 50; // §7.1
const REPLACED_LINES_P99_MAX = 270; // P-11, as day.perf.test.ts

// The hidden held lines of a station (PK-12): unfired lines of an order with an effective pickup (not boosted) that
// are not sync, or that sit on a FIFO station (PK-4).
function hiddenHeld(state: EngineState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const station_id of Object.keys(state.stations)) out[station_id] = 0;
  const fifo = new Set((state.config?.stations ?? []).filter((s) => s.policy === 'fifo').map((s) => s.station_id));
  for (const l of Object.values(state.lines)) {
    if (l.stage !== 'added' || l.fired_at !== null) continue;
    const order = state.orders[l.order_id];
    if (order === undefined || order.boosted || order.pickup_at_ms === null) continue;
    if (l.serve_mode === 'sync' && !fifo.has(l.station_id)) continue;
    out[l.station_id] = (out[l.station_id] ?? 0) + 1;
  }
  return out;
}

describe('[03a §10.6 M-6, #194] the pickup day (seed 7, 2 000 orders)', () => {
  let day: SimDay;
  let run: SimResult;
  const held: Record<string, number[]> = {};

  beforeAll(() => {
    day = generateDay(SEED, { pickup_day: true });
    let lastOrders = -1;
    // Sampled once per new order (outside the re-plan stopwatch): the hidden held set each submit sees.
    const watch = (state: EngineState): void => {
      const orders = Object.keys(state.orders).length;
      if (orders === lastOrders) return;
      lastOrders = orders;
      for (const [station_id, n] of Object.entries(hiddenHeld(state))) (held[station_id] ??= []).push(n);
    };
    run = step(
      'pickup_day_run',
      () => runDay(day, { watch }),
      (r) => ({
        orders: day.orders.length,
        pickup_orders: day.orders.filter((o) => o.pickup_at_ms !== null).length,
        drinks: day.orders.reduce((n, o) => n + o.lines.filter((l) => l.drink !== undefined).length, 0),
        hidden_held_by_station: Object.fromEntries(Object.entries(held).map(([s, ns]) => [s, dist(ns)])),
        replan_ms: dist(r.replanMs),
        replaced_lines: dist(r.replacedLines),
        overload_searches: r.overloadProbes.length,
        overload_probes_max: r.overloadProbes.length === 0 ? null : Math.max(...r.overloadProbes),
        events: r.events.length,
        diagnostics: r.liveState.diagnostics.length,
      }),
    );
    writeSamples('pickup_day_replan_ms', run.replanMs);
    writeSamples('pickup_day_replaced_lines', run.replacedLines);
  }, HOOK_MS);

  it('[03a #194] the pickup day really holds lines (the bounds are not vacuous)', () => {
    expect(day.orders.some((o) => o.pickup_at_ms !== null)).toBe(true);
    expect(Math.max(...(held.drinks ?? [0]))).toBeGreaterThan(0);
  });

  it('[03a #194, §7.1] re-plan per submit p99 ≤ 50 ms', () => {
    expect(run.replanMs).toHaveLength(day.orders.length);
    expect(dist(run.replanMs).p99).toBeLessThanOrEqual(REPLAN_P99_MS);
  });

  it('[03a #194, P-11] lines re-placed per station re-plan p99 ≤ 270', () => {
    expect(dist(run.replacedLines).p99).toBeLessThanOrEqual(REPLACED_LINES_P99_MAX);
  });
});
