// 03a §10.6, D22: the simulator harness, on a 200-order day of the generated distribution (the 2 000-order day is
// task 18's perf gate). Everything here drives the real engine; a breach throws (strict folds) and fails the test.
import { parseEvent, type PosEvent } from '@pos/events';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildEngineState, type EngineState } from '../../src/index';
import { generateDay, policyReport, runDay, TICK_MS, twoDayLog, type PolicyReport, type SimResult } from './index';

const POLICIES = ['fifo', 'edf', 'waada_guard'] as const;
const aside = (s: EngineState): EngineState => ({ ...s, diagnostics: [] });
const count = (events: readonly PosEvent[], type: string): number => events.filter((e) => e.event_type === type).length;

describe('[03a §10.6 harness] generated day', () => {
  it('[03a §10.6 harness] the §10.6 stations, 2 000 orders by default, seed 7 gives one day', () => {
    const day = generateDay(7);
    expect(day.orders).toHaveLength(2_000);
    expect(generateDay(7)).toEqual(day);
    expect(generateDay(8).orders).not.toEqual(day.orders);
    expect(day.stations).toEqual([
      { station_id: 'bbq', type: 'slot', capacity: 30, cook_ms: 900_000, freshness_window_ms: null },
      { station_id: 'degh', type: 'batch', capacity: 100, cook_ms: 60_000, freshness_window_ms: 60_000 },
      { station_id: 'karahi', type: 'slot', capacity: 50, cook_ms: 1_200_000, freshness_window_ms: null },
      { station_id: 'tandoor', type: 'slot', capacity: 60, cook_ms: 180_000, freshness_window_ms: null },
      { station_id: 'tawa', type: 'slot', capacity: 8, cook_ms: 300_000, freshness_window_ms: null },
    ]);
  });

  it('[03a §10.6 harness] the drill distributions: 65 / 25 / 10 arrivals, MENU line rates, target = max cook + 300 s', () => {
    const day = generateDay(7);
    const H = 3_600_000;
    const at = (o: { at_ms: number }): number => o.at_ms - day.start_ms;
    const dinner = day.orders.filter((o) => at(o) >= 13 * H - 2.5 * H && at(o) <= 13 * H + 2.5 * H).length;
    const lunch = day.orders.filter((o) => at(o) >= 6 * H - H && at(o) <= 6 * H + H).length;
    // 1 300 × P(|z| ≤ 1) ≈ 887 + the uniform share; 500 × P(|z| ≤ 1) ≈ 341 + the uniform share.
    expect(dinner).toBeGreaterThan(850);
    expect(dinner).toBeLessThan(1_050);
    expect(lunch).toBeGreaterThan(300);
    expect(lunch).toBeLessThan(420);
    expect(day.orders.every((o) => at(o) >= 0 && at(o) <= 18 * H && Number.isInteger(o.at_ms))).toBe(true);
    expect(day.orders.map((o) => o.at_ms)).toEqual([...day.orders.map((o) => o.at_ms)].sort((a, b) => a - b));
    // The MENU formula's realised means are not its labels: tandoor ≈ 2.60, karahi ≈ 1.35, bbq ≈ 1.09, degh ≈ 1.21, tawa ≈ 0.99 (the drill's seed 7:
    // 5 157 / 2 646 / 2 211 / 2 440 / 1 958 of 14 412 lines; §10.6's counts depend on them, so the formula is ported as is).
    const lines = day.orders.flatMap((o) => o.lines);
    const per = (s: string): number => lines.filter((l) => l.station_id === s).length / day.orders.length;
    expect(per('tandoor')).toBeGreaterThan(2.4);
    expect(per('tandoor')).toBeLessThan(2.8);
    expect(lines.length).toBeGreaterThan(14_412 * 0.9);
    expect(lines.length).toBeLessThan(14_412 * 1.1);
    const cook = new Map(day.stations.map((s) => [s.station_id, s.cook_ms]));
    for (const o of day.orders) {
      expect(o.lines.length).toBeGreaterThan(0);
      expect(o.pickup_at_ms).toBe(o.at_ms + Math.max(...o.lines.map((l) => cook.get(l.station_id)!)) + 300_000);
    }
  });

  it('[03a §10.6 harness] an overload day puts the tandoor at 125 % of capacity in its peak hour, nothing else changes', () => {
    const day = generateDay(7);
    const over = generateDay(7, { overload: true });
    expect(over.orders).toEqual(day.orders);
    const t = over.stations.find((s) => s.station_id === 'tandoor')!;
    expect(t.capacity).toBeLessThan(60);
    const HOUR = 3_600_000;
    const perHour = new Map<number, number>();
    for (const o of day.orders) {
      const n = o.lines.filter((l) => l.station_id === 'tandoor').length;
      for (let w = 0; w < 6; w++) {
        const k = Math.floor((o.at_ms - day.start_ms + (w * HOUR) / 6) / HOUR) * 6 - w;
        perHour.set(k, (perHour.get(k) ?? 0) + n);
      }
    }
    const peak = Math.max(...perHour.values());
    const load = (peak * t.cook_ms) / (t.capacity * HOUR);
    expect(load).toBeGreaterThanOrEqual(1.2);
    expect(load).toBeLessThanOrEqual(1.3);
  });
});

describe('[03a §10.6 harness] a day on the real engine', () => {
  const day = generateDay(7, { orders: 200 });
  let run: SimResult;
  beforeAll(() => {
    run = runDay(day, {});
  }, 120_000);

  it('[03a §10.6 harness] seed 7 → the same event list twice', () => {
    expect(runDay(generateDay(7, { orders: 200 }), {}).events).toEqual(run.events);
  }, 120_000);

  it('[03a §10.6 harness] the live state is the replayed state, diagnostics aside; no breach', () => {
    expect(aside(buildEngineState(run.events))).toEqual(aside(run.liveState));
    expect(run.liveState.diagnostics.filter((d) => d.kind !== 'over_capacity')).toEqual([]);
  }, 60_000);

  it('[03a §10.6 harness] every event is a valid event, seq and event_id increase, time never goes back', () => {
    run.events.forEach((e, i) => {
      expect(() => parseEvent(e)).not.toThrow();
      expect(e.seq).toBe(i + 1);
      if (i > 0) expect(e.recorded_at).toBeGreaterThanOrEqual(run.events[i - 1]!.recorded_at);
      if (i > 0) expect(e.event_id > run.events[i - 1]!.event_id).toBe(true);
    });
    expect(run.events.every((e) => e.occurred_at === e.recorded_at)).toBe(true);
  });

  it('[03a §10.6 harness] each submit is the §4.2 batch: OrderPlaced, ItemAdded in listing order, one recorded_at', () => {
    for (const o of day.orders) {
      const i = run.events.findIndex((e) => e.event_type === 'OrderPlaced' && e.stream_id === o.order_id);
      expect(i).toBeGreaterThanOrEqual(0);
      const placed = run.events[i]!;
      expect(placed.recorded_at).toBe(o.at_ms);
      const ids = o.lines.map((l) => l.order_item_id);
      expect((placed.payload as { order_item_ids: string[] }).order_item_ids).toEqual(ids);
      const added = run.events.slice(i + 1, i + 1 + ids.length);
      expect(added.map((e) => e.event_type)).toEqual(ids.map(() => 'ItemAdded'));
      expect(added.map((e) => (e.payload as { order_item_id: string }).order_item_id)).toEqual(ids);
      expect(added.every((e) => e.recorded_at === o.at_ms)).toBe(true);
    }
  });

  it('[03a §10.6 harness] every line is fired, started and done on time and every order served; served orders exit', () => {
    const lines = day.orders.flatMap((o) => o.lines);
    expect(count(run.events, 'ItemStarted')).toBe(lines.length);
    expect(count(run.events, 'ItemDone')).toBe(lines.length);
    expect(count(run.events, 'ItemServed')).toBe(day.orders.length);
    const fired = run.events.filter((e) => e.event_type === 'FireDispatched').flatMap((e) => (e.payload as { order_item_ids: string[] }).order_item_ids);
    expect(new Set(fired).size).toBe(lines.length);
    expect(fired).toHaveLength(lines.length);
    for (const e of run.events) {
      if (e.event_type === 'FireDispatched') expect(e.recorded_at % TICK_MS).toBe(0);
    }
    // The tick runs on the 500 ms grid, every tap on time: Done exactly a cook after Start.
    const started = new Map(run.events.filter((e) => e.event_type === 'ItemStarted').map((e) => [(e.payload as { order_item_id: string }).order_item_id, e]));
    const cook = new Map(day.orders.flatMap((o) => o.lines).map((l) => [l.order_item_id, day.stations.find((s) => s.station_id === l.station_id)!.cook_ms]));
    for (const e of run.events) {
      if (e.event_type !== 'ItemDone') continue;
      const id = (e.payload as { order_item_id: string }).order_item_id;
      expect(e.recorded_at).toBe(started.get(id)!.recorded_at + cook.get(id)!);
    }
    expect(Object.keys(run.liveState.orders).length).toBeLessThan(day.orders.length / 2);
    expect(Object.values(run.liveState.lines).every((l) => l.stage === 'served')).toBe(true);
    for (const s of Object.values(run.liveState.stations)) {
      expect(s.unfired).toEqual([]);
      expect(s.loads).toEqual({});
    }
  });

  it('[03a §10.6 harness] the §7.1 measurements: one re-plan time per submit, re-placed lines per station re-plan', () => {
    expect(run.replanMs).toHaveLength(day.orders.length);
    expect(run.replanMs.every((ms) => ms >= 0)).toBe(true);
    const replans = day.orders.reduce((n, o) => n + new Set(o.lines.map((l) => l.station_id)).size, 0);
    expect(run.replacedLines).toHaveLength(replans);
    // Each count includes the station's new lines, as the drill's len(free) does.
    expect(run.replacedLines.every((n) => n >= 1)).toBe(true);
    expect(run.overloadProbes.every((n) => n >= 1 && n <= 16)).toBe(true);
  });

  it('[03a §10.6 harness] skipping idle passes through nextDueAt writes exactly what a pass every 500 ms writes', () => {
    // The densest hour of the 2 000-order day: a pass on every grid point, due or not.
    const full = generateDay(7);
    const peak = full.orders.findIndex((o) => o.at_ms - full.start_ms >= 13 * 3_600_000);
    const slice = { ...full, orders: full.orders.slice(peak, peak + 60) };
    expect(runDay(slice, { everyTick: true }).events).toEqual(runDay(slice, {}).events);
  }, 120_000);

  it('[03a §10.6 harness] prune: false runs the same day unpruned and replays with the same option', () => {
    const unpruned = runDay(day, { prune: false });
    expect(aside(buildEngineState(unpruned.events, { prune: false }))).toEqual(aside(unpruned.liveState));
    const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
    expect(sum(unpruned.replacedLines)).toBeGreaterThanOrEqual(sum(run.replacedLines));
  }, 120_000);

  it('[03a §10.6 harness] twoDayLog: two business days back to back, seq continuous, replay = live', () => {
    const two = twoDayLog(7, { orders: 30 });
    expect(two.events.map((e) => e.seq)).toEqual(two.events.map((_, i) => i + 1));
    expect(count(two.events, 'BusinessDayOpened')).toBe(2);
    expect(count(two.events, 'BusinessDayClosed')).toBe(2);
    expect(count(two.events, 'OrderPlaced')).toBe(60);
    expect(aside(buildEngineState(two.events))).toEqual(aside(two.liveState));
    expect(Object.keys(two.liveState.orders)).toEqual([]);
  }, 120_000);
});

describe('[03a §10.6 harness] policy report (D22)', () => {
  const day = generateDay(7, { orders: 200 });
  const reports = {} as Record<(typeof POLICIES)[number], PolicyReport>;
  beforeAll(() => {
    for (const policy of POLICIES) reports[policy] = policyReport(runDay(day, { policy }));
  }, 180_000);

  it.each(POLICIES)('[03a §10.6 harness] %s: % promises kept, max late, mean wait by order type, cold time, utilisation; no breach', (policy) => {
    const r = reports[policy];
    expect(r.policy).toBe(policy);
    expect(r.orders).toBe(200);
    expect(r.promises_kept_pct).toBeGreaterThanOrEqual(0);
    expect(r.promises_kept_pct).toBeLessThanOrEqual(100);
    expect(r.max_late_ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(r.mean_wait_ms).sort()).toEqual(['dine_in', 'follow_up', 'takeaway']);
    for (const ms of Object.values(r.mean_wait_ms)) expect(ms).toBeGreaterThan(0);
    expect(r.mean_cold_ms).toBeGreaterThanOrEqual(0);
    expect(Object.keys(r.utilisation).sort()).toEqual(['bbq', 'degh', 'karahi', 'tandoor', 'tawa']);
    for (const u of Object.values(r.utilisation)) {
      expect(u.mean_pct).toBeGreaterThan(0);
      expect(u.mean_pct).toBeLessThanOrEqual(100);
      expect(u.peak_hour_pct).toBeGreaterThanOrEqual(u.mean_pct);
    }
    expect(r.breaches).toBe(0);
  });

  it('[03a §10.6 harness] hold-and-fire against firing at once: FIFO lands lines colder than Waada Guard (D3, D16)', () => {
    expect(reports.fifo.mean_cold_ms).toBeGreaterThan(reports.waada_guard.mean_cold_ms);
  });

  it('[03a §10.6 harness] the report hand-checked on a one-order day: wait, promise, cold, utilisation', () => {
    const one = generateDay(7, { orders: 200 });
    const mixed = one.orders.find((o) => new Set(o.lines.map((l) => l.station_id)).has('karahi') && new Set(o.lines.map((l) => l.station_id)).has('tandoor') && o.order_type === 'dine_in' && !o.follow_up)!;
    const r = policyReport(runDay({ ...one, orders: [mixed] }, {}));
    // Alone on an empty kitchen every line auto-fills at d − max_early_ms (D16): the group lands 60 s before
    // T = pickup = max cook + 300 s (1 500 s), to within one 500 ms pass, and lands together: nothing goes cold.
    expect(r.orders).toBe(1);
    expect(r.promises_kept_pct).toBe(100);
    expect(r.max_late_ms).toBe(0);
    expect(Math.abs(r.mean_wait_ms.dine_in! - (1_500_000 - 60_000))).toBeLessThan(TICK_MS);
    expect(r.mean_cold_ms).toBeLessThan(TICK_MS);
  }, 60_000);
});
