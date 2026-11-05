import { parseEvent, type EngineConfig, type PosEvent } from '@pos/events';
import { anEngineConfigApplied, anOrderBatch, anOrderLinesAdded, anItemAdded, aStockReserved } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildEngineState, initialEngineState, type EngineState } from '../src/index';

const T0 = 1_761_000_000_000;
const COOK = 1_200_000;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;

function config(stations: Array<Partial<EngineConfig['stations'][number]>>, settings?: Record<string, unknown>, recorded_at = T0 - 60_000): PosEvent {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  return deepFreeze(
    anEngineConfigApplied({
      recorded_at,
      occurred_at: recorded_at,
      payload: { stations: stations.map((s) => ({ ...S1, ...s })), settings: { ...base.settings, ...settings } },
    }),
  );
}

function fold(events: PosEvent[], state: EngineState = initialEngineState(), opts?: { strict?: boolean }): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

describe('@pos/engine order folds: lines, units, cook time, plan at awaiting = 0', () => {
  it('[03a #16] "Roti ×4" holds 4 units; capacity 30 with 28 used → the line waits for the blocking interval', () => {
    const cfg = config([{ station_id: 'S1', capacity: 30 }]);
    const blocking = anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1', item: { name: 'Roti', quantity: 28 } }], recorded_at: T0, seq: 1 });
    const roti = anOrderBatch({ order_id: 'O2', lines: [{ order_item_id: 'L2', item: { name: 'Roti', quantity: 4 } }], recorded_at: T0 + 1_000, seq: 3 });
    const s = fold([cfg, ...blocking, ...roti]);

    expect(s.lines.L1!.units).toBe(28);
    expect(s.lines.L1!.booked).toEqual({ start: T0, end: T0 + COOK, units: 28 });
    expect(s.lines.L2!.units).toBe(4);
    // 28 + 4 > 30: the line's fire is at the end of the blocking interval.
    expect(s.lines.L2!.fire_ms).toBe(T0 + COOK);
    expect(s.lines.L2!.fire_ms).toBeGreaterThanOrEqual(s.lines.L1!.booked!.end);
    expect(s.lines.L2!.booked).toEqual({ start: T0 + COOK, end: T0 + 2 * COOK, units: 4 });
    expect(s.stations.S1!.profile).toEqual({ t: [T0, T0 + COOK, T0 + 2 * COOK], u: [28, 4, 0] });
    expect(s.stations.S1!.unfired).toEqual(['L1', 'L2']);

    // Control: with 26 used the same 4 units fit at once.
    const fits = fold([cfg, ...anOrderBatch({ order_id: 'O1', lines: [{ order_item_id: 'L1', item: { quantity: 26 } }], recorded_at: T0, seq: 1 }), ...roti]);
    expect(fits.lines.L2!.fire_ms).toBe(T0 + 1_000);
    expect(fits.stations.S1!.profile).toEqual({ t: [T0, T0 + 1_000, T0 + COOK, T0 + COOK + 1_000], u: [26, 30, 4, 0] });
  });

  it('[03a #18] OrderPlaced target_land_ms / promise_ms are stored unchanged, also when replayed under a different config', () => {
    const groups = [
      { group_id: 'O1:0', target_land_ms: T0 + 1_234_567, promise_ms: T0 + 1_234_567 + 180_000, order_item_ids: ['L1'] },
      { group_id: 'O1:1', target_land_ms: T0 + 7_000_001, promise_ms: T0 + 7_000_001 + 99_999, order_item_ids: ['L2'] },
    ];
    const batch = anOrderBatch({
      lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2', item: { serve_mode: 'immediate' } }],
      order: { groups },
      recorded_at: T0,
    });
    const live = fold([config([{ station_id: 'S1' }]), ...batch]);
    // A different config (padding, weights, capacity) folded before the replay changes no stored promise.
    const other = config([{ station_id: 'S1', capacity: 1, promise_padding_ms: 900_000 }], {
      promise_padding_dine_in_ms: 600_000,
      weight_dine_in_pct: 300,
    });
    const replayed = buildEngineState([other, ...batch].map(deepFreeze));
    for (const s of [live, replayed]) {
      const o = s.orders.O1!;
      expect(o.groups).toEqual({
        'O1:0': { target_land_ms: groups[0]!.target_land_ms, line_ids: ['L1'] },
        'O1:1': { target_land_ms: groups[1]!.target_land_ms, line_ids: ['L2'] },
      });
      // The order's target / promise are the latest group's (F §4.7: the order lands with its last group).
      expect(o.target_land_ms).toBe(groups[1]!.target_land_ms);
      expect(o.promise_ms).toBe(groups[1]!.promise_ms);
      expect(o.next_group_index).toBe(2);
      expect(s.lines.L1!.group_id).toBe('O1:0');
      expect(s.lines.L2!.group_id).toBe('O1:1');
      // §3.2: d = T − carry − cook − prep from the stored group target.
      expect(s.lines.L1!.deadline_ms).toBe(groups[0]!.target_land_ms - COOK);
      expect(s.lines.L2!.deadline_ms).toBe(groups[1]!.target_land_ms - COOK);
    }
  });

  it('[03a #19] no line is placed before the last listed ItemAdded; a deal line never enters lines', () => {
    const cfg = config([{ station_id: 'S1' }]);
    const batch = anOrderBatch({
      lines: [
        { order_item_id: 'D1', item: { line_kind: 'deal', item_id: null, deal_id: 'DL1', station_id: null, serve_mode: null, cook_time_ms: null, prep_buffer_ms: null } },
        { order_item_id: 'L1', item: { line_kind: 'deal_part', parent_order_item_id: 'D1' } },
        { order_item_id: 'L2', item: { line_kind: 'deal_part', parent_order_item_id: 'D1', serve_mode: 'immediate' } },
      ],
      order: {
        lines: [
          { order_item_id: 'L1', station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: false, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null },
          { order_item_id: 'L2', station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: false, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null },
        ],
        groups: [
          { group_id: 'O1:0', target_land_ms: T0 + 1_500_000, promise_ms: T0 + 1_680_000, order_item_ids: ['L1'] },
          { group_id: 'O1:1', target_land_ms: T0 + COOK, promise_ms: T0 + COOK + 180_000, order_item_ids: ['L2'] },
        ],
      },
      recorded_at: T0,
      reserved: [{ stock_item_id: 'K1', order_item_id: 'L1', quantity: 1 }],
    });
    expect(batch.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded', 'ItemAdded', 'ItemAdded', 'StockReserved']);

    let s = fold([cfg]);
    const empty = s.stations.S1!.profile;
    const awaiting: number[] = [];
    for (const e of batch.slice(0, 3)) {
      s = fold([e], s);
      awaiting.push(s.orders.O1!.awaiting);
      expect(s.stations.S1!.profile).toEqual(empty);
      expect(s.stations.S1!.unfired).toEqual([]);
      for (const l of Object.values(s.lines)) {
        expect(l.fire_ms).toBeNull();
        expect(l.booked).toBeNull();
      }
    }
    expect(awaiting).toEqual([3, 2, 1]);
    const planned = fold([batch[3]!], s);
    expect(planned.orders.O1!.awaiting).toBe(0);
    expect(Object.keys(planned.lines).sort()).toEqual(['L1', 'L2']);
    expect(planned.lines.D1).toBeUndefined();
    expect(planned.orders.O1!.line_ids).toEqual(['L1', 'L2']);
    expect(planned.lines.L1!.fire_ms).not.toBeNull();
    expect(planned.lines.L2!.fire_ms).not.toBeNull();
    expect(planned.lines.L2!.serve_mode).toBe('immediate');
    expect(planned.stations.S1!.unfired.slice().sort()).toEqual(['L1', 'L2']);

    // The batch's own StockReserved folds after the plan and places nothing again (once per batch).
    const after = fold([batch[4]!], planned);
    expect(after.stations.S1).toBe(planned.stations.S1);
    expect(after.lines.L1!.booked).toEqual(planned.lines.L1!.booked);
    // Live = replay.
    expect(buildEngineState([cfg, ...batch].map(deepFreeze))).toEqual(after);
  });

  it('[03a §3.5.1] OrderLinesAdded adds to awaiting and plans at its last ItemAdded; placed lines stay; absent order throws', () => {
    const cfg = config([{ station_id: 'S1' }]);
    const placed = fold([cfg, ...anOrderBatch({ recorded_at: T0 })]);
    const added = deepFreeze(
      anOrderLinesAdded({
        recorded_at: T0 + 60_000,
        payload: {
          order_item_ids: ['L2', 'L3'],
          groups: [
            { group_id: 'O1:1', target_land_ms: T0 + 2_000_000, promise_ms: T0 + 2_180_000, order_item_ids: ['L2', 'L3'] },
          ],
          lines: ['L2', 'L3'].map((id) => ({
            order_item_id: id, station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: false,
            weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null, return_of: null, cook_ms_override: null,
          })),
        },
      }),
    );
    const item = (id: string): PosEvent => anItemAdded({ recorded_at: T0 + 60_000, payload: { order_item_id: id } });

    const s1 = fold([added], placed);
    expect(s1.orders.O1!.awaiting).toBe(2);
    expect(s1.orders.O1!.next_group_index).toBe(2);
    expect(s1.orders.O1!.line_ids).toEqual(['L1', 'L2', 'L3']);
    expect(s1.orders.O1!.groups['O1:1']).toEqual({ target_land_ms: T0 + 2_000_000, line_ids: ['L2', 'L3'] });
    // §3.5.1: target and promise are copied from OrderPlaced only.
    expect(s1.orders.O1!.target_land_ms).toBe(placed.orders.O1!.target_land_ms);
    expect(s1.orders.O1!.promise_ms).toBe(placed.orders.O1!.promise_ms);
    expect(s1.orders.O1!.last_line_fold_at).toBe(T0 + 60_000);
    const s2 = fold([item('L2')], s1);
    expect(s2.stations.S1).toBe(s1.stations.S1);
    expect(s2.lines.L2!.fire_ms).toBeNull();
    const s3 = fold([item('L3')], s2);
    expect(s3.orders.O1!.awaiting).toBe(0);
    expect(s3.lines.L1).toEqual(placed.lines.L1);
    expect(s3.lines.L2!.fire_ms).toBe(T0 + 60_000);
    expect(s3.lines.L3!.fire_ms).toBe(T0 + 60_000);
    expect(s3.stations.S1!.unfired).toEqual(['L1', 'L2', 'L3']);

    // §3.3: an OrderLinesAdded for an order not in the state is a bug and throws.
    expect(() => fold([anOrderLinesAdded({ payload: { order_id: 'O9', groups: [] } })], fold([cfg]))).toThrow();
  });

  it('[03a #43] a weighed line with its weight pending is 1 unit with the item cook time, placed normally (V18)', () => {
    const s = fold([
      config([{ station_id: 'S1' }]),
      ...anOrderBatch({
        lines: [{ order_item_id: 'L1', item: { sale_unit: 'g', requires_weighing: true, quantity: null, cook_time_ms: 900_000, line_total_minor: null } }],
        recorded_at: T0,
      }),
    ]);
    expect(s.lines.L1!.units).toBe(1);
    expect(s.lines.L1!.cook_ms).toBe(900_000);
    expect(s.lines.L1!.full_cook_ms).toBe(900_000);
    expect(s.lines.L1!.fire_ms).toBe(T0);
    expect(s.lines.L1!.booked).toEqual({ start: T0, end: T0 + 900_000, units: 1 });
  });

  it('[03a §3.3 placed_by] placed_by = the OrderPlaced actor_id, placed_at = its recorded_at', () => {
    const cfg = config([{ station_id: 'S1' }]);
    const s = fold([cfg, ...anOrderBatch({ recorded_at: T0 + 5, actor_id: '01JSTAFF000000000000000001' })]);
    const o = s.orders.O1!;
    expect(o.placed_by).toBe('01JSTAFF000000000000000001');
    expect(o.placed_at).toBe(T0 + 5);
    expect(o.last_line_fold_at).toBe(T0 + 5);
    expect(o).toMatchObject({
      order_id: 'O1', order_type: 'dine_in', table_key: 'dine_in:T12', table_id: 'T12', follow_up: false,
      pickup_at_ms: null, boosted: false, last_served_at: null, awaiting: 0, line_ids: ['L1'],
    });
    expect(fold([cfg, ...anOrderBatch({ recorded_at: T0 })]).orders.O1!.placed_by).toBeNull();
  });

  it('[03a §3.2] units and cook time per line: g / ml = 1 unit; from-stock slot line uses stock_time_ms; batch copies; deadline', () => {
    const s = fold([
      config([{ station_id: 'S1', capacity: 10 }, { station_id: 'S2', station_type: 'batch', capacity: 2 }]),
      ...anOrderBatch({
        lines: [
          { order_item_id: 'G1', item: { sale_unit: 'g', quantity: 500 } },
          { order_item_id: 'M1', item: { sale_unit: 'ml', quantity: 330 } },
          { order_item_id: 'P3', item: { quantity: 3, prep_buffer_ms: 60_000, stock_time_ms: 300_000 }, line: { carry_ms: 30_000 } },
          {
            order_item_id: 'ST',
            item: { stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K1', quantity: 500 }] },
            line: { from_stock: true },
          },
          {
            // ItemAdded.station_id is the home route (S1); the engine places on OrderPlaced.lines[].station_id (S2, batch).
            order_item_id: 'B1',
            item: { program_id: 'PR1', stock_program_id: 'PR2', program_cook_time_ms: 600_000, stock_program_cook_time_ms: 120_000 },
            line: { station_id: 'S2', from_stock: true },
          },
        ],
        recorded_at: T0,
      }),
    ]);
    const T = T0 + 1_500_000;
    expect(s.lines.G1!.units).toBe(1);
    expect(s.lines.M1!.units).toBe(1);
    expect(s.lines.P3!).toMatchObject({ units: 3, prep_ms: 60_000, cook_ms: COOK, full_cook_ms: COOK, stock_cook_ms: 300_000, from_stock: false, carry_ms: 30_000 });
    expect(s.lines.P3!.deadline_ms).toBe(T - 30_000 - COOK - 60_000);
    // Prep is off-station: the booking starts at fire + prep.
    expect(s.lines.P3!.booked).toEqual({ start: s.lines.P3!.fire_ms! + 60_000, end: s.lines.P3!.fire_ms! + 60_000 + COOK, units: 3 });
    expect(s.lines.ST!).toMatchObject({
      cook_ms: 300_000, full_cook_ms: COOK, stock_cook_ms: 300_000, from_stock: true,
      draws: [{ stock_item_id: 'K1', quantity: 500, reserved: 0 }], reserved_seq: null,
    });
    expect(s.lines.ST!.deadline_ms).toBe(T - 300_000);
    expect(s.lines.B1!).toMatchObject({
      station_id: 'S2', cook_ms: 120_000, full_cook_ms: 600_000, stock_cook_ms: 120_000, program_id: 'PR1', stock_program_id: 'PR2',
    });
    expect(s.lines.B1!).toMatchObject({
      stage: 'added', mark: null, return_of: null, load_id: null, fired_at: null, started_at: null, done_at: null,
      weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null, alternates: [], point_id: null,
    });
    expect(s.stations.S2!.unfired).toEqual(['B1']);
    expect(s.stations.S1!.unfired.slice().sort()).toEqual(['G1', 'M1', 'P3', 'ST']);
  });

  it('[03a Review Focus 4] an order whose every line is a deal line or has no station: awaiting reaches 0, nothing placed, no throw', () => {
    const cfg = config([{ station_id: 'S1' }]);
    const before = fold([cfg]);
    const batch = anOrderBatch({
      lines: [
        { order_item_id: 'D1', item: { line_kind: 'deal', item_id: null, deal_id: 'DL1', station_id: null, serve_mode: null, cook_time_ms: null } },
        { order_item_id: 'N1', item: { station_id: null, serve_mode: null, cook_time_ms: null } },
      ],
      order: { lines: [], groups: [] },
      recorded_at: T0,
    });
    const s = fold(batch, before);
    expect(s.orders.O1!.awaiting).toBe(0);
    expect(s.orders.O1!.line_ids).toEqual([]);
    expect(s.orders.O1!.groups).toEqual({});
    expect(s.lines).toEqual({});
    expect(s.stations).toBe(before.stations);
    expect(s.diagnostics).toEqual([]);
    // The builder's default lines[] lists every id; a deal / no-station ItemAdded still never enters lines.
    const listed = fold(anOrderBatch({ lines: [{ order_item_id: 'D1', item: { line_kind: 'deal', station_id: null, serve_mode: null } }], recorded_at: T0 }), before);
    expect(listed.lines).toEqual({});
    expect(listed.orders.O1!.line_ids).toEqual([]);
    expect(listed.orders.O1!.groups['O1:0']!.line_ids).toEqual([]);
    expect(listed.stations).toBe(before.stations);
  });

  it('[03a AD-4] a line over effective capacity books the whole station for ceil(units / cap) rounds and appends over_capacity in both modes', () => {
    const cfg = config([{ station_id: 'S1', capacity: 3 }, { station_id: 'S2' }]);
    const batch = anOrderBatch({ lines: [{ order_item_id: 'L1', item: { quantity: 4 } }], recorded_at: T0 });
    for (const opts of [undefined, { strict: false }]) {
      const before = fold([cfg], initialEngineState(), opts);
      const s = fold(batch, before, opts);
      expect(s.lines.L1!.units).toBe(4);
      expect(s.lines.L1!.booked).toEqual({ start: T0, end: T0 + 2 * COOK, units: 3 });
      expect(s.stations.S1!.profile).toEqual({ t: [T0, T0 + 2 * COOK], u: [3, 0] });
      expect(s.diagnostics).toEqual([
        { kind: 'over_capacity', event_id: batch[1]!.event_id, order_item_id: 'L1', station_id: 'S1', detail: { units: 4, capacity: 3 } },
      ]);
      // §3.3 copy-on-write: the untouched station keeps its reference.
      expect(s.stations.S2).toBe(before.stations.S2);
    }
    // capacity_override is the effective capacity (D37).
    const base = fold([cfg]);
    const overridden = deepFreeze({ ...base, stations: { ...base.stations, S1: { ...base.stations.S1!, capacity_override: 4 } } });
    const s = fold(batch, overridden);
    expect(s.lines.L1!.booked).toEqual({ start: T0, end: T0 + COOK, units: 4 });
    expect(s.diagnostics).toEqual([]);
  });

  it('[03a §6.1a] the order folds never mutate their inputs', () => {
    const cfg = config([{ station_id: 'S1' }]);
    const state = deepFreeze(fold([cfg]));
    const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
    const batch = anOrderBatch({ lines: [{ order_item_id: 'L1' }, { order_item_id: 'L2' }], recorded_at: T0 }).map(deepFreeze);
    expect(() => fold([...batch, aStockReserved()], state)).not.toThrow();
    expect(state).toEqual(snapshot);
  });

  it('[03a AD-6] writer-bug order folds throw when strict and record one invalid_event diagnostic when non-strict', () => {
    const cfg = config([{ station_id: 'S1' }, { station_id: 'S2', station_type: 'batch', capacity: 2 }]);
    const engineFields = { alternates: [], point_id: null, carry_ms: 0, from_stock: false, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null };
    const group = (ids: string[]) => [{ group_id: 'O1:0', target_land_ms: T0 + 1_500_000, promise_ms: T0 + 1_680_000, order_item_ids: ids }];
    type Case = { name: string; events: PosEvent[]; reason: string; event_type: string; station_id?: string };
    const cases: Case[] = [
      {
        name: 'station ItemAdded not listed by OrderPlaced.lines',
        events: anOrderBatch({ lines: [{ order_item_id: 'L1' }], order: { lines: [], groups: [] }, recorded_at: T0 }),
        reason: 'line_not_listed',
        event_type: 'ItemAdded',
      },
      {
        name: 'station ItemAdded after awaiting reached 0',
        events: [...anOrderBatch({ recorded_at: T0 }), anItemAdded({ recorded_at: T0, seq: 9, payload: { order_item_id: 'L1' } })],
        reason: 'line_not_listed',
        event_type: 'ItemAdded',
      },
      {
        name: 'engine station not in the state',
        events: anOrderBatch({ lines: [{ order_item_id: 'L1', line: { station_id: 'S9' } }], recorded_at: T0 }),
        reason: 'station_missing',
        event_type: 'ItemAdded',
        station_id: 'S9',
      },
      {
        name: 'listed line in no group',
        events: anOrderBatch({ lines: [{ order_item_id: 'L1' }], order: { groups: group([]) }, recorded_at: T0 }).slice(0, 1),
        reason: 'line_in_no_group',
        event_type: 'OrderPlaced',
        station_id: 'S1',
      },
      {
        name: 'serve_mode null on a station line',
        events: anOrderBatch({ lines: [{ order_item_id: 'L1', item: { serve_mode: null } }], recorded_at: T0 }),
        reason: 'serve_mode_null',
        event_type: 'ItemAdded',
        station_id: 'S1',
      },
      {
        name: 'slot cook_time_ms null',
        events: anOrderBatch({ lines: [{ order_item_id: 'L1', item: { cook_time_ms: null } }], recorded_at: T0 }),
        reason: 'cook_time_ms_null',
        event_type: 'ItemAdded',
        station_id: 'S1',
      },
      {
        name: 'batch program_cook_time_ms null',
        events: anOrderBatch({ lines: [{ order_item_id: 'L1', line: { station_id: 'S2', ...engineFields } }], recorded_at: T0 }),
        reason: 'program_cook_time_ms_null',
        event_type: 'ItemAdded',
        station_id: 'S2',
      },
    ];
    for (const c of cases) {
      const bad = deepFreeze(c.events[c.events.length - 1]!);
      for (const opts of [undefined, { strict: true }]) {
        const before = fold([cfg, ...c.events.slice(0, -1)], initialEngineState(), opts);
        expect(() => applyEvent(before, bad, opts), c.name).toThrow(c.reason);
      }
      const before = fold([cfg, ...c.events.slice(0, -1)], initialEngineState(), { strict: false });
      const after = applyEvent(before, bad, { strict: false });
      const { diagnostics, ...rest } = after;
      const { diagnostics: prior, ...beforeRest } = before;
      expect(rest, c.name).toEqual(beforeRest);
      for (const k of Object.keys(beforeRest) as Array<keyof typeof beforeRest>) expect(rest[k], `${c.name}: ${k}`).toBe(beforeRest[k]);
      expect(diagnostics, c.name).toEqual([
        ...prior,
        {
          kind: 'invalid_event',
          event_id: bad.event_id,
          ...(c.station_id === undefined ? {} : { station_id: c.station_id }),
          detail: { event_type: c.event_type, order_id: 'O1', order_item_id: 'L1', reason: c.reason },
        },
      ]);
    }
  });

  it('[03a §3.3] OrderLinesAdded on an absent order throws in both modes (not a diagnostic)', () => {
    const s = fold([config([{ station_id: 'S1' }])]);
    const e = deepFreeze(anOrderLinesAdded({ payload: { order_id: 'O9', groups: [] } }));
    expect(() => applyEvent(s, e)).toThrow('not in the engine');
    expect(() => applyEvent(s, e, { strict: false })).toThrow('not in the engine');
  });
});
