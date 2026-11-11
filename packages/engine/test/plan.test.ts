import { DomainError } from '@pos/domain';
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { anEngineConfigApplied, anItemAdded, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  addInterval,
  applyEvent,
  calculateETA,
  checkOrderable,
  initialEngineState,
  isEngineLine,
  planOrder,
  type EngineState,
  type PlanResult,
  type ProposedOrder,
} from '../src/index';

const T0 = 1_761_000_000_000;
const COOK = 1_200_000;
const PAD = 180_000;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;
type StationCfg = EngineConfig['stations'][number];

function config(stations: Array<Partial<StationCfg>>, settings?: Record<string, unknown>): PosEvent {
  const base = anEngineConfigApplied().payload as unknown as EngineConfig;
  return deepFreeze(
    anEngineConfigApplied({
      recorded_at: T0 - 60_000,
      occurred_at: T0 - 60_000,
      payload: { stations: stations.map((s) => ({ ...S1, ...s })), settings: { ...base.settings, ...settings } },
    }),
  );
}

function fold(events: PosEvent[], state: EngineState = initialEngineState()): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e)));
  return s;
}

// Existing bookings on a station's profile (another order's planned intervals), as plain state.
function withBookings(state: EngineState, station_id: string, bookings: Array<[number, number, number?]>): EngineState {
  const st = state.stations[station_id]!;
  let profile = st.profile;
  for (const [start, end, units] of bookings) profile = addInterval(profile, { start, end }, units ?? 1);
  return deepFreeze({ ...state, stations: { ...state.stations, [station_id]: { ...st, profile } } });
}

type LineSpec = { id: string; item?: Partial<ItemAddedPayload>; engine?: Partial<ProposedOrder['lines'][number]> };

function proposed(lines: LineSpec[], order?: Partial<ProposedOrder['order']>, order_id = 'O1'): ProposedOrder {
  const base = anItemAdded().payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null, ...order },
    lines: lines.map((l) => ({
      ...base,
      order_id,
      order_item_id: l.id,
      ...l.item,
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
      ...l.engine,
    })),
  });
}

// The §4.2 batch 02 would append from a plan: OrderPlaced with the plan's groups and lines, then ItemAdded × n.
function batchFrom(p: ProposedOrder, plan: PlanResult, recorded_at: number, seq = 10): PosEvent[] {
  const byId = new Map(plan.lines.map((l) => [l.order_item_id, l]));
  return anOrderBatch({
    order_id: p.order_id,
    recorded_at,
    seq,
    lines: p.lines.map((l) => {
      const { alternates, point_id, carry_ms, weight_pct, max_early_ms, max_late_ms, max_carry_ms, cook_ms_override, return_of, ...item } = l;
      void cook_ms_override;
      void return_of;
      const planned = byId.get(l.order_item_id);
      return {
        order_item_id: l.order_item_id,
        item,
        line: {
          station_id: planned?.station_id ?? l.station_id,
          alternates,
          point_id,
          carry_ms,
          from_stock: planned?.from_stock ?? false,
          weight_pct,
          max_early_ms,
          max_late_ms,
          max_carry_ms,
        },
      };
    }),
    order: { order_type: p.order.order_type, pickup_at_ms: p.order.pickup_at_ms, groups: plan.groups },
  });
}

function group(plan: PlanResult, id: string) {
  return plan.groups.find((g) => g.group_id === id)!;
}
function eta(plan: PlanResult, id: string): number {
  return plan.lines.find((l) => l.order_item_id === id)!.eta_ms;
}

describe('@pos/engine planOrder / calculateETA / checkOrderable: hold-and-fire, target and promise (§3.5.1)', () => {
  it('[03a #17] P = T + padding: branch per order type, station override, max over the group stations; FIFO / EDF padding 0', () => {
    const state = fold([
      config(
        [
          { station_id: 'S1' },
          { station_id: 'S2', promise_padding_ms: 600_000 },
          { station_id: 'S3', policy: 'fifo', promise_padding_ms: 900_000 },
          { station_id: 'S4', policy: 'edf' },
        ],
        { promise_padding_takeaway_ms: 300_000 },
      ),
    ]);

    // Branch padding per order type.
    const dine = planOrder(state, proposed([{ id: 'L1' }]), T0, {});
    expect(dine.groups).toEqual([{ group_id: 'O1:0', target_land_ms: T0 + COOK, promise_ms: T0 + COOK + PAD, order_item_ids: ['L1'] }]);
    const take = planOrder(state, proposed([{ id: 'L1' }], { order_type: 'takeaway', table_key: 'takeaway:O1', table_id: null }), T0, {});
    expect(group(take, 'O1:0').promise_ms).toBe(T0 + COOK + 300_000);

    // The station override wins over the branch value; the group takes the max over its stations.
    const mixed = planOrder(state, proposed([{ id: 'L1' }, { id: 'L2', item: { station_id: 'S2' } }]), T0, {});
    expect(group(mixed, 'O1:0')).toEqual({ group_id: 'O1:0', target_land_ms: T0 + COOK, promise_ms: T0 + COOK + 600_000, order_item_ids: ['L1', 'L2'] });

    // FIFO and EDF lines use padding 0 (their own override is ignored, D3); max with a Waada Guard station.
    for (const s of ['S3', 'S4']) {
      const alone = planOrder(state, proposed([{ id: 'L1', item: { station_id: s } }]), T0, {});
      expect(group(alone, 'O1:0').promise_ms).toBe(group(alone, 'O1:0').target_land_ms);
      const withWg = planOrder(state, proposed([{ id: 'L1', item: { station_id: s } }, { id: 'L2' }]), T0, {});
      expect(group(withWg, 'O1:0').promise_ms).toBe(group(withWg, 'O1:0').target_land_ms + PAD);
    }

    // An immediate line is its own group: target = its land time, promise = target + its station's padding.
    const imm = planOrder(
      state,
      proposed([
        { id: 'L1' },
        { id: 'I1', item: { serve_mode: 'immediate', cook_time_ms: 300_000, station_id: 'S2' } },
        { id: 'I2', item: { serve_mode: 'immediate', cook_time_ms: 300_000, station_id: 'S4' } },
      ]),
      T0,
      {},
    );
    expect(imm.groups).toEqual([
      { group_id: 'O1:0', target_land_ms: T0 + COOK, promise_ms: T0 + COOK + PAD, order_item_ids: ['L1'] },
      { group_id: 'O1:1', target_land_ms: T0 + 300_000, promise_ms: T0 + 300_000 + 600_000, order_item_ids: ['I1'] },
      { group_id: 'O1:2', target_land_ms: T0 + 300_000, promise_ms: T0 + 300_000, order_item_ids: ['I2'] },
    ]);
    expect(eta(imm, 'I1')).toBe(T0 + 300_000);
  });

  it('[03a #31] delivery: T = max(pickup_at_ms, loop result); the lines are held to land at T', () => {
    const state = fold([config([{ station_id: 'S1', capacity: 1 }])]);
    const pickup = T0 + 3_600_000;
    const p = proposed([{ id: 'L1', engine: { carry_ms: 30_000 }, item: { prep_buffer_ms: 60_000 } }], {
      order_type: 'delivery',
      table_id: null,
      table_key: 'delivery:O1',
      pickup_at_ms: pickup,
    });
    const plan = planOrder(state, p, T0, {});
    expect(group(plan, 'O1:0').target_land_ms).toBe(pickup);
    expect(group(plan, 'O1:0').promise_ms).toBe(pickup + PAD);
    expect(eta(plan, 'L1')).toBe(pickup);

    // The fold of the batch holds the line: its station interval ends at T − carry.
    const s = fold(batchFrom(p, plan, T0), state);
    expect(s.lines.L1!.booked).toEqual({ start: pickup - 30_000 - COOK, end: pickup - 30_000, units: 1 });
    expect(s.lines.L1!.fire_ms).toBe(pickup - 30_000 - COOK - 60_000);
    expect(s.lines.L1!.deadline_ms).toBe(s.lines.L1!.fire_ms);

    // A pickup earlier than the kitchen can make it: the loop result wins.
    const busy = withBookings(state, 'S1', [[T0, T0 + 4_000_000]]);
    const late = planOrder(busy, p, T0, {});
    expect(group(late, 'O1:0').target_land_ms).toBe(T0 + 4_000_000 + COOK + 30_000);
    // No pickup: the loop result (the line's earliest land).
    const now = planOrder(state, proposed([{ id: 'L1' }], { order_type: 'delivery', table_id: null, table_key: 'delivery:O1' }), T0, {});
    expect(group(now, 'O1:0').target_land_ms).toBe(T0 + COOK);
  });

  it('[03a BF-2] planOrder uses the from_stock map (stock_time_ms when true, the full cook when false); calculateETA without it = fresh', () => {
    const state = fold([config([{ station_id: 'S1' }])]);
    const p = proposed([{ id: 'L1', item: { stock_time_ms: 300_000 } }]);

    const stock = planOrder(state, p, T0, { L1: true });
    expect(group(stock, 'O1:0').target_land_ms).toBe(T0 + 300_000);
    expect(stock.lines).toEqual([{ order_item_id: 'L1', station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: true, eta_ms: T0 + 300_000 }]);

    const fresh = planOrder(state, p, T0, { L1: false });
    expect(group(fresh, 'O1:0').target_land_ms).toBe(T0 + COOK);
    expect(fresh.lines[0]!.from_stock).toBe(false);

    const preview = calculateETA(state, p, T0);
    expect(preview).toEqual(fresh);
    expect(calculateETA(state, p, T0, { L1: true })).toEqual(stock);
    // Pure: same result twice, state untouched (deep-frozen above), stock claims unchanged.
    expect(planOrder(state, p, T0, { L1: true })).toEqual(stock);
    expect(state.stock).toEqual({});
  });

  it('[03a BF-2] checkOrderable: a line whose only station is paused → STATION_PAUSED { station_id }; an unpaused alternate keeps it orderable', () => {
    const cfg = fold([config([{ station_id: 'S1' }, { station_id: 'S2' }])]);
    const paused = deepFreeze({ ...cfg, stations: { ...cfg.stations, S1: { ...cfg.stations.S1!, paused: true } } });
    const p = proposed([{ id: 'L1' }]);

    expect(() => checkOrderable(cfg, p)).not.toThrow();
    let err: unknown;
    try {
      checkOrderable(paused, p);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('STATION_PAUSED');
    expect((err as DomainError).details).toEqual({ station_id: 'S1' });
    // planOrder / calculateETA run the check first (§3.5.1 step 1).
    expect(() => planOrder(paused, p, T0, {})).toThrow(DomainError);
    expect(() => calculateETA(paused, p, T0)).toThrow(DomainError);

    // An allowed alternate that is not paused: the line is not routed only to a paused station.
    const alt = proposed([{ id: 'L1', engine: { alternates: [{ station_id: 'S2', carry_ms: 0, home: false }] } }]);
    expect(() => checkOrderable(paused, alt)).not.toThrow();
    // A deal line (no engine line) on a paused station is never checked.
    const deal = proposed([{ id: 'D1', item: { line_kind: 'deal', station_id: null, serve_mode: null } }]);
    expect(() => checkOrderable(paused, deal)).not.toThrow();
  });

  it('[03a AD-4] Review Focus 1: a 4-unit line on a capacity-3 station gets a finite T and promise; planOrder appends nothing', () => {
    const state = fold([config([{ station_id: 'S1', capacity: 3 }])]);
    const p = proposed([{ id: 'L1', item: { quantity: 4 } }]);
    const plan = planOrder(state, p, T0, {});
    // ceil(4 / 3) = 2 rounds of the whole station.
    expect(group(plan, 'O1:0').target_land_ms).toBe(T0 + 2 * COOK);
    expect(group(plan, 'O1:0').promise_ms).toBe(T0 + 2 * COOK + PAD);
    expect(Number.isFinite(group(plan, 'O1:0').promise_ms)).toBe(true);
    expect(state.diagnostics).toEqual([]);
    expect(Object.keys(plan).sort()).toEqual(['groups', 'lines']);

    // The fold books what occupancy says and appends the over_capacity diagnostic (AD-4).
    const s = fold(batchFrom(p, plan, T0), state);
    expect(s.lines.L1!.booked).toEqual({ start: T0, end: T0 + 2 * COOK, units: 3 });
    expect(s.diagnostics).toEqual([
      expect.objectContaining({ kind: 'over_capacity', order_item_id: 'L1', station_id: 'S1', detail: { units: 4, capacity: 3 } }),
    ]);
  });

  it('[03a §3.5.1] planOrder and the fold at awaiting = 0 give the same placement for the same (state, now)', () => {
    let state = fold([config([{ station_id: 'S1', capacity: 1 }, { station_id: 'S2', capacity: 2 }])]);
    state = withBookings(state, 'S1', [[T0 + 100_000, T0 + 700_000]]);
    state = withBookings(state, 'S2', [[T0, T0 + 900_000, 2]]);
    const p = proposed([
      { id: 'A', item: { cook_time_ms: 600_000 } },
      { id: 'I', item: { serve_mode: 'immediate', cook_time_ms: 200_000, station_id: 'S2' } },
      { id: 'B', item: { cook_time_ms: 400_000, station_id: 'S2', prep_buffer_ms: 30_000 }, engine: { carry_ms: 20_000 } },
      { id: 'C', item: { cook_time_ms: 300_000 } },
    ]);
    const plan = planOrder(state, p, T0, {});
    const s = fold(batchFrom(p, plan, T0), state);
    const T = group(plan, 'O1:0').target_land_ms;
    for (const l of plan.lines) {
      const line = s.lines[l.order_item_id]!;
      expect(line.booked!.end + line.carry_ms).toBe(l.eta_ms);
      expect(line.fire_ms).toBe(line.booked!.start - line.prep_ms);
      if (line.serve_mode === 'sync') expect(line.booked!.end).toBeLessThanOrEqual(T - line.carry_ms);
    }
    // The stored targets are the plan's (never recomputed by the fold, #18).
    expect(s.orders.O1!.groups['O1:0']!.target_land_ms).toBe(T);
    expect(s.orders.O1!.target_land_ms).toBe(Math.max(...plan.groups.map((g) => g.target_land_ms)));
    // Same-station sync siblings A and C (capacity 1) are serialised; the last one lands at T.
    expect(Math.max(eta(plan, 'A'), eta(plan, 'C'))).toBe(T);
  });

  it('[03a §3.5.1] property, 60 seeds: no sync line ends past T − carry, no station over capacity, fire ≥ now, planOrder = fold', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let run = 0; run < 60; run++) {
      const caps = [1 + rnd(3), 1 + rnd(3)];
      let state = fold([config([{ station_id: 'S1', capacity: caps[0]! }, { station_id: 'S2', capacity: caps[1]! }])]);
      for (const [i, st] of ['S1', 'S2'].entries()) {
        const bookings: Array<[number, number, number]> = [];
        for (let k = 0; k < 4; k++) {
          const start = T0 + rnd(2_000) * 1_000;
          bookings.push([start, start + (1 + rnd(900)) * 1_000, 1 + rnd(caps[i]!)]);
        }
        state = withBookings(state, st, bookings);
      }
      const n = 1 + rnd(4);
      const specs: LineSpec[] = [];
      for (let k = 0; k < n; k++) {
        specs.push({
          id: `L${k}`,
          item: {
            station_id: rnd(2) === 0 ? 'S1' : 'S2',
            serve_mode: rnd(4) === 0 ? 'immediate' : 'sync',
            cook_time_ms: (1 + rnd(900)) * 1_000,
            prep_buffer_ms: rnd(3) * 30_000,
            quantity: 1 + rnd(4),
          },
          engine: { carry_ms: rnd(3) * 10_000 },
        });
      }
      const p = proposed(specs);
      const now = T0 + rnd(500) * 1_000;
      const plan = planOrder(state, p, now, {});
      const s = fold(batchFrom(p, plan, now, 10 + run * 20), state);
      const T = plan.groups.find((g) => g.order_item_ids.some((id) => s.lines[id]!.serve_mode === 'sync'))?.target_land_ms;
      for (const l of plan.lines) {
        const line = s.lines[l.order_item_id]!;
        expect(line.booked!.end + line.carry_ms).toBe(l.eta_ms);
        expect(line.fire_ms!).toBeGreaterThanOrEqual(now);
        if (line.serve_mode === 'sync') expect(line.booked!.end).toBeLessThanOrEqual(T! - line.carry_ms);
      }
      for (const st of ['S1', 'S2']) {
        const prof = s.stations[st]!.profile;
        const cap = s.stations[st]!.capacity;
        const before = state.stations[st]!.profile;
        // Only the new lines are checked against capacity (the random bookings may already exceed it).
        if (Math.max(0, ...before.u) <= cap) expect(Math.max(0, ...prof.u)).toBeLessThanOrEqual(cap);
      }
    }
  });
});

describe('@pos/engine isEngineLine (§3.2)', () => {
  it('[03a §3.2] exported from the package index: a station and line_kind ≠ deal (02b §3.3 food rules import it)', () => {
    expect(isEngineLine({ station_id: 'st-1', line_kind: 'item' })).toBe(true);
    expect(isEngineLine({ station_id: 'st-1', line_kind: 'deal_part' })).toBe(true);
    expect(isEngineLine({ station_id: 'st-1', line_kind: 'option_child' })).toBe(true);
    expect(isEngineLine({ station_id: null, line_kind: 'item' })).toBe(false);
    expect(isEngineLine({ station_id: 'st-1', line_kind: 'deal' })).toBe(false);
  });
});
