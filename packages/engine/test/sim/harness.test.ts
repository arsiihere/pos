// 03a §10.6, D22: the simulator harness, on a 200-order day of the generated distribution (the 2 000-order day is
// task 18's perf gate). Everything here drives the real engine; a breach throws (strict folds) and fails the test.
import { createHash } from 'node:crypto';
import { parseEvent, type PosEvent } from '@pos/events';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildEngineState } from '../../src/index';
import { demandPeakPct, generateDay, LINE_RATES, peakHourUnits, policyReport, runDay, TICK_MS, twoDayLog, type PolicyReport, type SimOrder, type SimResult } from './index';

const POLICIES = ['fifo', 'edf', 'waada_guard'] as const;
const count = (events: readonly PosEvent[], type: string): number => events.filter((e) => e.event_type === type).length;

describe('[03a §10.6, AD-27] the normal peak day', () => {
  const H = 3_600_000;
  const day = generateDay(7);

  it('[03a AD-27] seed 7 gives one day, 2 000 orders by default; capacities stay inside 01a\'s range 1–100', () => {
    expect(day.orders).toHaveLength(2_000);
    expect(generateDay(7)).toEqual(day);
    expect(generateDay(8).orders).not.toEqual(day.orders);
    expect(day.stations.map((s) => s.station_id)).toEqual(['bbq', 'degh', 'karahi', 'tandoor', 'tawa']);
    for (const s of day.stations) {
      expect(Number.isInteger(s.capacity)).toBe(true);
      expect(s.capacity).toBeGreaterThanOrEqual(1);
      expect(s.capacity).toBeLessThanOrEqual(100);
    }
  });

  it('[03a AD-27] the table of the day: capacity and cook per station', () => {
    expect(day.stations).toEqual([
      { station_id: 'bbq', type: 'slot', capacity: 30, cook_ms: 900_000, freshness_window_ms: null },
      { station_id: 'degh', type: 'batch', capacity: 4, cook_ms: 60_000, freshness_window_ms: 60_000 },
      { station_id: 'karahi', type: 'slot', capacity: 50, cook_ms: 1_200_000, freshness_window_ms: null },
      { station_id: 'tandoor', type: 'slot', capacity: 30, cook_ms: 180_000, freshness_window_ms: null },
      { station_id: 'tawa', type: 'slot', capacity: 8, cook_ms: 300_000, freshness_window_ms: null },
    ]);
    expect(LINE_RATES).toEqual({ tandoor: 2.55, karahi: 0.582, bbq: 0.503, degh: 0.96, tawa: 0.41 });
  });

  it('[03a AD-27] no capacity above §10.6\'s value and §10.6\'s cook times', () => {
    const spec: Record<string, { capacity: number; cook_ms: number }> = {
      bbq: { capacity: 30, cook_ms: 900_000 },
      degh: { capacity: 100, cook_ms: 60_000 },
      karahi: { capacity: 50, cook_ms: 1_200_000 },
      tandoor: { capacity: 60, cook_ms: 180_000 },
      tawa: { capacity: 8, cook_ms: 300_000 },
    };
    for (const s of day.stations) {
      expect(s.capacity).toBeLessThanOrEqual(spec[s.station_id]!.capacity);
      expect(s.cook_ms).toBe(spec[s.station_id]!.cook_ms);
    }
  });

  it('[03a AD-27] §10.6\'s arrival shape: 65 % dinner, 25 % lunch, 10 % uniform; target = max cook + 300 s', () => {
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
    const cook = new Map(day.stations.map((s) => [s.station_id, s.cook_ms]));
    for (const o of day.orders) {
      expect(o.lines.length).toBeGreaterThan(0);
      expect(o.pickup_at_ms).toBe(o.at_ms + Math.max(...o.lines.map((l) => cook.get(l.station_id)!)) + 300_000);
    }
  });

  it('[03a AD-27] the stated rates are the rates realised, within ±5 %, and none is above the old day\'s', () => {
    // What the drill's weights formula really gave (task 18a report, Finding 1): the ruling lowers demand, never raises it.
    const oldRates: Record<string, number> = { tandoor: 2.6, karahi: 1.35, bbq: 1.09, degh: 1.21, tawa: 0.99 };
    const lines = day.orders.flatMap((o) => o.lines);
    expect(Object.keys(LINE_RATES).sort()).toEqual(day.stations.map((s) => s.station_id));
    for (const s of day.stations) {
      const realised = lines.filter((l) => l.station_id === s.station_id).length / day.orders.length;
      expect(realised / LINE_RATES[s.station_id]!, s.station_id).toBeGreaterThanOrEqual(0.95);
      expect(realised / LINE_RATES[s.station_id]!, s.station_id).toBeLessThanOrEqual(1.05);
      expect(LINE_RATES[s.station_id]!, s.station_id).toBeLessThanOrEqual(oldRates[s.station_id]!);
    }
  });

  it('[03a AD-27] from demand, every station\'s busiest hour asks for 90–100 % of what it can cook', () => {
    const demand = demandPeakPct(day);
    expect(Object.keys(demand).sort()).toEqual(day.stations.map((s) => s.station_id));
    for (const s of day.stations) {
      expect(demand[s.station_id]!, s.station_id).toBeGreaterThanOrEqual(90);
      expect(demand[s.station_id]!, s.station_id).toBeLessThanOrEqual(100);
    }
  });

  it('[03a AD-27] R6 volume from the lines alone: the events that do not depend on the plan stay inside 45k ± 20 %', () => {
    // OrderPlaced + ItemServed per order, ItemAdded + ItemStarted + ItemDone per line. FireDispatched comes on top and is
    // measured on the full day in the perf project (3 000 – 5 000 on the days run so far).
    const fixed = 2 * day.orders.length + 3 * day.orders.reduce((n, o) => n + o.lines.length, 0);
    expect(fixed).toBeGreaterThanOrEqual(36_000 - 5_000);
    expect(fixed).toBeLessThanOrEqual(54_000 - 3_000);
  });
});

describe('[03a §10.6, AD-27] demand, by hand', () => {
  it('[03a AD-27] 60 + 40 tandoor lines inside one hour, and 50 three hours later: peak 100; 100 × 180 s / (5 × 3 600 s) = 100 %', () => {
    const MIN = 60_000;
    const order = (minute: number, tandoor: number): SimOrder => ({
      order_id: `O${minute}`,
      at_ms: 1_000_000_000_000 + minute * MIN,
      order_type: 'dine_in',
      follow_up: false,
      table_id: 'T1',
      table_key: 'dine_in:T1',
      pickup_at_ms: 0,
      lines: [
        ...Array.from({ length: tandoor }, (_, i) => ({ order_item_id: `L${minute}-${i}`, station_id: 'tandoor' })),
        { order_item_id: `K${minute}`, station_id: 'karahi' },
      ],
    });
    // Minutes 50 and 70 straddle a clock hour, and one of the 10-minute windows holds both; minute 240 is on its own.
    const orders = [order(50, 60), order(70, 40), order(240, 50)];
    expect(peakHourUnits(orders, 1_000_000_000_000, 'tandoor')).toBe(100);
    expect(peakHourUnits(orders, 1_000_000_000_000, 'karahi')).toBe(2);
    const stations = [
      { station_id: 'tandoor', type: 'slot' as const, capacity: 5, cook_ms: 180_000, freshness_window_ms: null },
      { station_id: 'karahi', type: 'slot' as const, capacity: 1, cook_ms: 900_000, freshness_window_ms: null },
    ];
    expect(demandPeakPct({ seed: 0, start_ms: 1_000_000_000_000, stations, orders })).toEqual({ tandoor: 100, karahi: 50 });
  });
});

describe('[03a §10.6, AD-27] the overload day', () => {
  const H = 3_600_000;
  const day = generateDay(7);
  const over = generateDay(7, { overload: true });
  const hour = over.overload_hour!;
  const inHour = (o: SimOrder): boolean => o.at_ms >= hour.from_ms && o.at_ms < hour.to_ms;
  const units = (orders: readonly SimOrder[], station_id: string): number => orders.filter(inHour).reduce((n, o) => n + o.lines.filter((l) => l.station_id === station_id).length, 0);

  it('[03a AD-27] deterministic; same stations as the normal day; the normal day names no overload hour', () => {
    expect(generateDay(7, { overload: true })).toEqual(over);
    expect(over.stations).toEqual(day.stations);
    expect(day.overload_hour).toBeUndefined();
  });

  it('[03a AD-27] one contiguous hour of the dinner rush', () => {
    expect(hour.to_ms - hour.from_ms).toBe(H);
    expect(hour.from_ms - day.start_ms).toBeGreaterThanOrEqual(13 * H - 2.5 * H);
    expect(hour.to_ms - day.start_ms).toBeLessThanOrEqual(13 * H + 2.5 * H);
  });

  it('[03a AD-27] the normal day\'s orders, unchanged, plus extras only inside that hour', () => {
    const normal = new Set(day.orders.map((o) => o.order_id));
    const kept = over.orders.filter((o) => normal.has(o.order_id));
    const extras = over.orders.filter((o) => !normal.has(o.order_id));
    expect(kept).toEqual(day.orders);
    expect(extras.length).toBeGreaterThan(0);
    expect(extras.every(inHour)).toBe(true);
    expect(over.orders.map((o) => o.at_ms)).toEqual([...over.orders.map((o) => o.at_ms)].sort((a, b) => a - b));
    const ids = over.orders.flatMap((o) => [o.order_id, ...o.lines.map((l) => l.order_item_id)]);
    expect(new Set(ids).size).toBe(ids.length);
    const cook = new Map(day.stations.map((s) => [s.station_id, s.cook_ms]));
    for (const o of extras) {
      expect(o.lines.length).toBeGreaterThan(0);
      expect(o.pickup_at_ms).toBe(o.at_ms + Math.max(...o.lines.map((l) => cook.get(l.station_id)!)) + 300_000);
    }
  });

  it('[03a AD-27] that hour\'s demand is 125 % of its normal on every station, to the nearest line', () => {
    for (const s of day.stations) {
      const normal = units(day.orders, s.station_id);
      expect(normal, s.station_id).toBeGreaterThan(0);
      expect(Math.abs(units(over.orders, s.station_id) - 1.25 * normal), s.station_id).toBeLessThanOrEqual(0.5);
    }
    expect(over.orders.filter(inHour).length / day.orders.filter(inHour).length).toBeGreaterThan(1.2);
    expect(over.orders.filter(inHour).length / day.orders.filter(inHour).length).toBeLessThanOrEqual(1.26);
  });

  // Task 18b review: the search was over the whole day, and took lunch on 8 of these 20 seeds.
  it('[03a AD-27] the overload hour stays in the dinner rush, also on a seed whose busiest hour is lunch', () => {
    const inDinner = (seed: number): [number, number] => {
      const d = generateDay(seed, { overload: true });
      return [d.overload_hour!.from_ms - d.start_ms, d.overload_hour!.to_ms - d.start_ms];
    };
    for (let seed = 1; seed <= 20; seed++) {
      const [from, to] = inDinner(seed);
      expect(from, `seed ${seed}`).toBeGreaterThanOrEqual(10.5 * H);
      expect(to, `seed ${seed}`).toBeLessThanOrEqual(15.5 * H);
    }
    // Seed 1's busiest hour of the whole day starts at 5.5 h.
    const seed1 = generateDay(1);
    const lunch = seed1.orders.filter((o) => o.at_ms - seed1.start_ms >= 5.5 * H && o.at_ms - seed1.start_ms < 6.5 * H).reduce((n, o) => n + o.lines.length, 0);
    const [from] = inDinner(1);
    const dinner = seed1.orders.filter((o) => o.at_ms - seed1.start_ms >= from && o.at_ms - seed1.start_ms < from + H).reduce((n, o) => n + o.lines.length, 0);
    expect(lunch).toBeGreaterThan(dinner);
  });

  it('[03a AD-27] seed 7, the day the gate runs: the overload day comes out identical', () => {
    expect(createHash('sha256').update(JSON.stringify(over)).digest('hex')).toBe('91b960ae6ac28588e0930ae89d4e1c0d1ba6ceeb6600647e31ff33604af3c191');
  });

  it('[03a AD-27] live state = replayed state on a small overload day', () => {
    const small = generateDay(7, { orders: 200, overload: true });
    expect(small.orders.length).toBeGreaterThan(200);
    const run = runDay(small, {});
    expect(run.replanMs).toHaveLength(small.orders.length);
    expect(buildEngineState(run.events)).toEqual(run.liveState);
    expect(run.liveState.diagnostics.filter((d) => d.kind !== 'over_capacity')).toEqual([]);
  }, 120_000);
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

  it('[03a §10.6 harness] the live state is the replayed state, diagnostics included; no breach', () => {
    expect(buildEngineState(run.events)).toEqual(run.liveState);
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
    // 60 orders from the 13 h peak of the 2 000-order day, on an empty kitchen, so this does not saturate it: the
    // saturated case (250 orders, 46 s) is skip.perf.test.ts. A pass on every grid point, due or not.
    const full = generateDay(7);
    const peak = full.orders.findIndex((o) => o.at_ms - full.start_ms >= 13 * 3_600_000);
    const slice = { ...full, orders: full.orders.slice(peak, peak + 60) };
    expect(runDay(slice, { everyTick: true }).events).toEqual(runDay(slice, {}).events);
  }, 120_000);

  it('[03a §10.6 harness] prune: false runs the same day unpruned and replays with the same option', () => {
    const unpruned = runDay(day, { prune: false });
    expect(buildEngineState(unpruned.events, { prune: false })).toEqual(unpruned.liveState);
    const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);
    expect(sum(unpruned.replacedLines)).toBeGreaterThanOrEqual(sum(run.replacedLines));
  }, 120_000);

  it('[03a §10.6 harness] twoDayLog: two business days back to back, seq continuous, replay = live', () => {
    const two = twoDayLog(7, { orders: 30 });
    expect(two.events.map((e) => e.seq)).toEqual(two.events.map((_, i) => i + 1));
    expect(count(two.events, 'BusinessDayOpened')).toBe(2);
    expect(count(two.events, 'BusinessDayClosed')).toBe(2);
    expect(count(two.events, 'OrderPlaced')).toBe(60);
    expect(buildEngineState(two.events)).toEqual(two.liveState);
    expect(Object.keys(two.liveState.orders)).toEqual([]);
  }, 120_000);
});

describe('[03a §10.6 harness] twoDayLog on an over-capacity day', () => {
  it('[03a §10.6 harness] a day that cooks past start + 23 h: time never goes back, the close follows every order out, ids are per day', () => {
    const H = 3_600_000;
    // 150 orders at capacity 1: the lines queue well past the 18 h of orders (≈ 87 karahi lines × 20 min alone).
    const shape = (day: ReturnType<typeof generateDay>): ReturnType<typeof generateDay> => ({ ...day, stations: day.stations.map((s) => ({ ...s, capacity: 1 })) });
    const two = twoDayLog(7, { orders: 150, shape });
    const times = two.events.map((e) => e.recorded_at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(two.events.map((e) => e.seq)).toEqual(two.events.map((_, i) => i + 1));

    const closes = two.events.filter((e) => e.event_type === 'BusinessDayClosed');
    expect(closes).toHaveLength(2);
    const opens = two.events.filter((e) => e.event_type === 'BusinessDayOpened');
    const start = opens[0]!.recorded_at + 1;
    // This is the case the fix is for: the first day's last cook ends after start + 23 h.
    const firstClose = two.events.indexOf(closes[0]!);
    const last = two.events[firstClose - 1]!;
    expect(last.recorded_at).toBeGreaterThan(start + 23 * H);
    expect(closes[0]!.recorded_at).toBe(last.recorded_at + 1_800_000);
    expect(opens[1]!.recorded_at).toBeGreaterThan(closes[0]!.recorded_at);

    const placed = two.events.filter((e) => e.event_type === 'OrderPlaced').map((e) => e.stream_id);
    expect(new Set(placed).size).toBe(300);
    expect(placed.slice(0, 150).every((id) => id.startsWith('D1'))).toBe(true);
    expect(placed.slice(150).every((id) => id.startsWith('D2'))).toBe(true);
    expect(buildEngineState(two.events)).toEqual(two.liveState);
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
    expect(r.max_target_ahead_ms).toBeGreaterThan(0);
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
    // 1 200 s of one karahi unit in one hour, of 50 units: 1 200 / (50 × 3 600) per line, on the same windows as demandPeakPct.
    const karahiLines = mixed.lines.filter((l) => l.station_id === 'karahi').length;
    expect(r.utilisation.karahi!.peak_window_pct).toBeCloseTo((100 * karahiLines * 1_200) / (50 * 3_600), 1);
    // T − now at the submit: alone in the kitchen, T is the pickup time.
    expect(r.max_target_ahead_ms).toBe(1_500_000);
  }, 60_000);
});
