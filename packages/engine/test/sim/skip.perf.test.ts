// 03a §10.6: the skip of idle passes (run.ts) on a saturated kitchen. In the perf project (P-4) because a pass on every
// grid point over the drain of 250 peak orders takes about 45 s.
import { describe, expect, it } from 'vitest';
import { generateDay, runDay } from './index';

describe('[03a §10.6 harness] skipping idle passes, saturated', () => {
  it('[03a §10.6 harness] 250 orders from the 13 h peak: skipping through nextDueAt writes exactly what a pass every 500 ms writes', () => {
    const full = generateDay(7);
    const peak = full.orders.findIndex((o) => o.at_ms - full.start_ms >= 13 * 3_600_000);
    // AD-27: the normal peak day runs below saturation, so this case halves the capacities to keep the kitchen full.
    const slice = { ...full, stations: full.stations.map((st) => ({ ...st, capacity: Math.ceil(st.capacity / 2) })), orders: full.orders.slice(peak, peak + 250) };
    const lastAt = slice.orders.at(-1)!.at_ms;
    expect(lastAt - slice.orders[0]!.at_ms).toBeGreaterThan(3_600_000);
    const skipping = runDay(slice, {});
    // They start on an empty kitchen, so assert they fill it: orders whose T was pushed past their pickup time.
    const pushed = skipping.events.filter((e) => {
      if (e.event_type !== 'OrderPlaced') return false;
      const p = e.payload as { pickup_at_ms: number; groups: Array<{ target_land_ms: number }> };
      return p.groups[0]!.target_land_ms > p.pickup_at_ms;
    });
    expect(pushed.length).toBeGreaterThan(50);
    expect(runDay(slice, { everyTick: true }).events).toEqual(skipping.events);
  });
});
