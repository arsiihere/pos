// 03a §3.8a return to kitchen (D28): the return line of an OrderLinesAdded folds as immediate, mark 'return',
// follow-up weight (§3.5.2), from_stock false, no draws, its own group, on the served line's engine station;
// `fix` cooks for the event's cook_ms_override (never config), `remake` for the normal cook and its ItemReturned
// makes the served line `returned`. Placement = the one sequence (pass 1 keeps older lines within d − keep, then
// the return at its earliest fit): within others' slack, never past their deadlines (returns_boost is task 16).
import { parseEvent, type EngineConfig, type ItemAddedPayload, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemStarted, anOrderBatch, aReturnLinesAdded } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildEngineState, initialEngineState, planOrder, type EngineState, type ProposedOrder } from '../src/index';
import { weightOf } from '../src/replan';

const T0 = 1_761_000_000_000;
const M = 60_000;
const at = (min: number): number => T0 + min * M;
const ADJUST = 180_000;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const S1 = (parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig).stations[0]!;
type StationCfg = EngineConfig['stations'][number];

function config(stations: Array<Partial<StationCfg>>, recorded_at = T0 - 3_600_000, version = 1): PosEvent {
  return anEngineConfigApplied({
    recorded_at,
    occurred_at: recorded_at,
    payload: { config_version: version, stations: stations.map((s) => ({ ...S1, ...s })) },
  });
}

type Opts = { strict?: boolean };
function fold(events: PosEvent[], state: EngineState = initialEngineState(), opts?: Opts): EngineState {
  let s = deepFreeze(state);
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e), opts));
  return s;
}

let seq = 1_000;
const nextSeq = (): number => seq++;
function orderEvent(event_type: string, order_id: string, payload: Record<string, unknown>, recorded_at: number): PosEvent {
  const s = nextSeq();
  return { ...anItemStarted(), event_type, stream_id: order_id, payload, recorded_at, occurred_at: recorded_at, seq: s, event_id: `01JR${String(s).padStart(22, '0')}` };
}
function fire(id: string, t: number): PosEvent {
  return aFireDispatched({ recorded_at: t, occurred_at: t, seq: nextSeq(), payload: { order_item_ids: [id], due_at: t, load_id: null, reason: 'scheduled' } });
}
// Fire, Start, Done and Served of a line (the life of a plate before it comes back).
function cookAndServe(order_id: string, id: string, start: number, done: number, served: number): PosEvent[] {
  return [
    fire(id, start),
    orderEvent('ItemStarted', order_id, { order_item_id: id, started_at: start, source: 'tap' }, start),
    orderEvent('ItemDone', order_id, { order_item_id: id, done_at: done, source: 'tap' }, done),
    orderEvent('ItemServed', order_id, { order_item_ids: [id], source: 'tap' }, served),
  ];
}

// Order O1: one line L1 served from stock (stock cook 5 min, draws 500 of K1), cooked 12:00–12:05, served 12:06.
function servedFromStock(extraItem: Record<string, unknown> = {}): { log: PosEvent[]; servedAdded: PosEvent } {
  const batch = anOrderBatch({
    order_id: 'O1',
    recorded_at: at(0),
    seq: nextSeq(),
    lines: [
      {
        order_item_id: 'L1',
        item: { stock_time_ms: 5 * M, stock_draws: [{ stock_item_id: 'K1', quantity: 500 }], ...extraItem },
        line: { from_stock: true },
      },
    ],
    order: { groups: [{ group_id: 'O1:0', target_land_ms: at(5), promise_ms: at(8), order_item_ids: ['L1'] }] },
  });
  return { log: [...batch, ...cookAndServe('O1', 'L1', at(0), at(5), at(6))], servedAdded: batch[1]! };
}

// Order O2 (delivery, pickup 12:35): line L2 cook 20 min, held to its deadline 12:15 (hidden at 12:10).
function heldDelivery(): PosEvent[] {
  return anOrderBatch({
    order_id: 'O2',
    recorded_at: at(6),
    seq: nextSeq() + 10,
    lines: [{ order_item_id: 'L2' }],
    order: {
      order_type: 'delivery',
      table_id: null,
      table_key: 'delivery:O2',
      pickup_at_ms: at(35),
      groups: [{ group_id: 'O2:0', target_land_ms: at(35), promise_ms: at(38), order_item_ids: ['L2'] }],
    },
  });
}

// 02's ProposedOrder for the return line (ReturnToKitchen builds the same line it appends).
function proposedReturn(servedAdded: PosEvent, mode: 'fix' | 'remake', override: number | null, line: Record<string, unknown> = {}): ProposedOrder {
  const s = servedAdded.payload as unknown as ItemAddedPayload;
  return deepFreeze({
    order_id: s.order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null },
    lines: [
      {
        ...s,
        order_item_id: `${s.order_item_id}R`,
        line_kind: 'item',
        options: [],
        alternates: [],
        point_id: null,
        carry_ms: 0,
        weight_pct: 100,
        max_early_ms: 60_000,
        max_late_ms: null,
        max_carry_ms: null,
        cook_ms_override: override,
        return_of: { order_item_id: s.order_item_id, mode },
        ...line,
      },
    ],
  });
}

const groupOf = (s: EngineState, id: string) => s.orders[s.lines[id]!.order_id]!.groups[s.lines[id]!.group_id]!;

describe('@pos/engine return to kitchen (§3.8a, D28)', () => {
  it('[03a #75] fix on a served from-stock line → one new immediate line, cook = adjust_time_ms from the event, no draw, mark return, within others\' slack', () => {
    const { log, servedAdded } = servedFromStock();
    const before = fold([config([{ station_id: 'S1', capacity: 1 }]), ...log, ...heldDelivery()]);
    expect(before.lines.L2!.fire_ms).toBe(at(15));
    expect(before.lines.L2!.deadline_ms).toBe(at(15));

    // planOrder for 02's return line at 12:10 = the fold of the appended batch (one sequence, §3.5.1).
    const plan = planOrder(before, proposedReturn(servedAdded, 'fix', ADJUST), at(10), { [`L1R`]: true });
    expect(plan.lines).toEqual([expect.objectContaining({ order_item_id: 'L1R', from_stock: false, eta_ms: at(13) })]);
    const ret = aReturnLinesAdded(servedAdded, 'fix', { recorded_at: at(10), target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms });
    expect(ret.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded']);
    const s = fold(ret, before);

    const r = s.lines.L1R!;
    expect(Object.keys(s.lines).filter((id) => !(id in before.lines))).toEqual(['L1R']);
    expect(r).toMatchObject({
      serve_mode: 'immediate',
      mark: 'return',
      return_of: { order_item_id: 'L1', mode: 'fix' },
      from_stock: false,
      cook_ms: ADJUST,
      draws: [],
      reserved_seq: null,
      stage: 'added',
      station_id: 'S1',
    });
    // No draw → nothing for reserveStock to reserve (task 12 asserts its drafts on the same shape).
    expect(r.draws).toHaveLength(0);
    // §3.5.2: a return takes the follow-up weight (300) on a dine-in order (100).
    expect(weightOf(s, r)).toBe(300);
    // Placed at its earliest fit; the older held line keeps d − keep and never crosses its deadline.
    expect(r.fire_ms).toBe(at(10));
    expect(r.booked).toEqual({ start: at(10), end: at(13), units: 1 });
    expect(s.lines.L2!.fire_ms).toBe(at(14));
    expect(s.lines.L2!.fire_ms).toBeLessThanOrEqual(s.lines.L2!.deadline_ms);
    // The served line is unchanged on fix (§3.8a).
    expect(s.lines.L1).toEqual(before.lines.L1);
    expect(s.stations.S1!.unfired).toEqual(['L1R', 'L2']);
  });

  it('[03a #75] remake → normal cook time; it never pushes the older line past its deadline; ItemReturned makes the served line returned', () => {
    const { log, servedAdded } = servedFromStock();
    const before = fold([config([{ station_id: 'S1', capacity: 1 }]), ...log, ...heldDelivery()]);
    const plan = planOrder(before, proposedReturn(servedAdded, 'remake', null), at(10), {});
    const ret = aReturnLinesAdded(servedAdded, 'remake', { recorded_at: at(10), target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms });
    expect(ret.map((e) => e.event_type)).toEqual(['OrderLinesAdded', 'ItemAdded', 'ItemReturned']);

    const mid = fold(ret.slice(0, 2), before);
    expect(mid.lines.L1!.stage).toBe('served');
    const s = fold(ret.slice(2), mid);
    const r = s.lines.L1R!;
    // The normal (fresh) cook: from_stock false even though the served plate came from stock.
    expect(r).toMatchObject({ serve_mode: 'immediate', mark: 'return', return_of: { order_item_id: 'L1', mode: 'remake' }, cook_ms: 20 * M, from_stock: false, draws: [] });
    // 20 min do not fit before the held line's d − keep: the return waits behind it (no deadline crossed).
    expect(s.lines.L2!.fire_ms).toBe(at(14));
    expect(s.lines.L2!.fire_ms).toBeLessThanOrEqual(s.lines.L2!.deadline_ms);
    expect(r.fire_ms).toBe(at(34));
    expect(plan.lines[0]!.eta_ms).toBe(r.booked!.end);
    // ItemReturned: the served line exits as `returned` (occupies nothing, booked null); nothing else moves.
    expect(s.lines.L1).toEqual({ ...mid.lines.L1!, stage: 'returned' });
    expect(s.lines.L1!.booked).toBeNull();
    expect(s.stations).toEqual(mid.stations);
    expect(s.lines.L1R).toEqual(mid.lines.L1R);
  });

  it('[03a #80] fix: cook_ms_override comes from the event; a later config change does not change a replay; max_carry_ms and alternates are the line\'s and drive its routing (§3.5.5, route.test.ts)', () => {
    const { log, servedAdded } = servedFromStock();
    const kitchen = config([{ station_id: 'S1', capacity: 2 }, { station_id: 'S2', capacity: 2 }]);
    // The item's adjust_time_ms was 240 000 when 02 wrote the return (D25 copy); never the 180 000 default.
    const ret = aReturnLinesAdded(servedAdded, 'fix', {
      recorded_at: at(10),
      adjust_time_ms: 240_000,
      target_land_ms: at(14),
      line: { station_id: 'S2', alternates: [{ station_id: 'S1', carry_ms: 0, home: true }], max_carry_ms: 90_000 },
    });
    const events = [kitchen, ...log, ...ret];
    const replay = buildEngineState(events);
    expect(replay.lines.L1R!.cook_ms).toBe(240_000);
    expect(replay.lines.L1R!.full_cook_ms).toBe(240_000);
    // A later config (another version, other weights and capacity knobs) changes nothing of the folded line.
    const later = anEngineConfigApplied({
      recorded_at: at(11),
      occurred_at: at(11),
      payload: {
        config_version: 2,
        stations: [{ ...S1, station_id: 'S1', capacity: 2 }, { ...S1, station_id: 'S2', capacity: 2 }],
        settings: { ...(anEngineConfigApplied().payload as unknown as EngineConfig).settings, weight_follow_up_pct: 250 },
      },
    });
    const replay2 = buildEngineState([...events, later]);
    expect(replay2.lines.L1R).toEqual(replay.lines.L1R);
    // The line's own max_carry_ms and alternates are kept (D25) and route it (task 11, §3.5.5): its engine station
    // is S2 (OrderLinesAdded.lines[].station_id, D8) and S1 is the alternate marked home; both land the return at
    // the same time → home (D9). The station it leaves joins its alternates.
    expect(replay.lines.L1R).toMatchObject({ station_id: 'S1', max_carry_ms: 90_000, alternates: [{ station_id: 'S2', carry_ms: 0, home: false }] });
    expect(replay.stations.S1!.unfired).toEqual(['L1R']);
    expect(replay.stations.S2!.unfired).toEqual([]);
    // Task 1 / 8a guard: with no alternate the line stays on its engine station (OrderLinesAdded.lines[].station_id),
    // which differs from ItemAdded.station_id (S1, kept as the routed station only).
    const stay = buildEngineState([kitchen, ...log, ...aReturnLinesAdded(servedAdded, 'fix', { recorded_at: at(10), target_land_ms: at(14), line: { station_id: 'S2', alternates: [] } })]);
    expect(stay.lines.L1R).toMatchObject({ station_id: 'S2', routed_station_id: 'S1', alternates: [] });
    expect(stay.stations.S2!.unfired).toEqual(['L1R']);
  });

  it('[03a #114 engine] a return of a deal_part / option_child line folds with draws [], its own group, never re-opening the old group', () => {
    for (const child of [
      { line_kind: 'deal_part', parent_order_item_id: 'L0', deal_id: 'D1', deal_part_id: 'DP1' },
      { line_kind: 'option_child', parent_order_item_id: 'L0', option_id: 'OP1', option_quantity: 1 },
    ]) {
      const batch = anOrderBatch({
        order_id: 'O1',
        recorded_at: at(0),
        seq: nextSeq(),
        lines: [
          { order_item_id: 'L0', item: { line_kind: child.line_kind === 'deal_part' ? 'deal' : 'item', station_id: child.line_kind === 'deal_part' ? null : 'S1' } },
          { order_item_id: 'L1', item: { ...child, quantity: 2, stock_draws: [{ stock_item_id: 'K1', quantity: 1_000 }], serve_mode: 'sync' } },
        ],
      });
      const servedAdded = batch.find((e) => e.event_type === 'ItemAdded' && e.payload.order_item_id === 'L1')!;
      const base = fold([config([{ station_id: 'S1', capacity: 4 }]), ...batch, ...cookAndServe('O1', 'L1', at(0), at(20), at(21))]);
      const oldGroup = groupOf(base, 'L1');
      const ret = aReturnLinesAdded(servedAdded, 'remake', { recorded_at: at(22), target_land_ms: at(42) });
      expect(ret[1]!.payload).toMatchObject({ line_kind: 'item', parent_order_item_id: null, deal_id: null, deal_part_id: null, option_id: null, option_quantity: null, options: [], quantity: 2 });
      const s = fold(ret, base);
      const r = s.lines.L1R!;
      expect(r).toMatchObject({ draws: [], units: 2, serve_mode: 'immediate', group_id: 'O1:1', mark: 'return' });
      expect(groupOf(s, 'L1R')).toEqual({ target_land_ms: at(42), line_ids: ['L1R'] });
      expect(s.orders.O1!.groups[s.lines.L1!.group_id]).toEqual(oldGroup);
      expect(s.orders.O1!.next_group_index).toBe(2);
    }
  });

  describe('[03a §3.8a] writer bugs (AD-8: strict throws, non-strict invalid_event, never a crash)', () => {
    const { log, servedAdded } = servedFromStock();
    const kitchen = config([{ station_id: 'S1', capacity: 2 }]);
    const reasons = (s: EngineState): unknown[] => s.diagnostics.filter((d) => d.kind === 'invalid_event').map((d) => d.detail.reason);

    it('[03a §3.8a AD-8] return_of naming a line that is not served, or not in the order → strict throws; non-strict drops the line', () => {
      const unserved = anOrderBatch({ order_id: 'O1', recorded_at: at(0), seq: nextSeq(), lines: [{ order_item_id: 'L1' }] });
      const added = unserved[1]!;
      for (const [base, served] of [
        [fold([kitchen, ...unserved]), added], // L1 still cooking-to-be (added), not served
        [fold([kitchen, ...unserved]), { ...added, payload: { ...added.payload, order_item_id: 'LX' } }], // unknown line
      ] as const) {
        const ret = aReturnLinesAdded(served, 'fix', { recorded_at: at(1) });
        expect(() => fold(ret, base)).toThrow(/return_of/);
        const s = fold(ret, base, { strict: false });
        expect(s.lines[ret[1]!.payload.order_item_id as string]).toBeUndefined();
        expect(s.orders.O1!.awaiting).toBe(0);
        expect(reasons(s)).toEqual(['return_of_not_served']);
      }
    });

    it('[03a §3.8a AD-8] a fix with no cook_ms_override, or a return line in an existing group → strict throws; non-strict changes nothing but diagnostics', () => {
      const base = fold([kitchen, ...log]);
      const fixRet = aReturnLinesAdded(servedAdded, 'fix', { recorded_at: at(10) });
      const linesAdded = fixRet[0]!;
      const lines = linesAdded.payload.lines as Array<Record<string, unknown>>;
      const noOverride = [{ ...linesAdded, payload: { ...linesAdded.payload, lines: [{ ...lines[0], cook_ms_override: null }] } }, fixRet[1]!];
      const oldGroup = aReturnLinesAdded(servedAdded, 'fix', { recorded_at: at(10), group_index: 0 });
      for (const [ret, reason] of [
        [noOverride, 'cook_ms_override_null'],
        [oldGroup, 'return_group_invalid'],
      ] as const) {
        expect(() => fold(ret, base)).toThrow(reason);
        const s = fold(ret, base, { strict: false });
        expect(s.lines.L1R).toBeUndefined();
        expect(s.orders.O1!.groups).toEqual(base.orders.O1!.groups);
        expect(reasons(s)).toEqual([reason, 'line_not_listed']);
      }
    });

    it('[03a §3.8a AD-8] ItemReturned: an absent line or order is a no-op (§3.3); a line not served or a replacement that is not its remake → strict throws, non-strict diagnostic', () => {
      const ret = aReturnLinesAdded(servedAdded, 'remake', { recorded_at: at(10) });
      const s0 = fold([kitchen, ...log, ...ret.slice(0, 2)]);
      const returned = ret[2]!;
      const absentLine = { ...returned, payload: { ...returned.payload, order_item_id: 'LX' } };
      const absentOrder = { ...returned, stream_id: 'O9', payload: { ...returned.payload, order_item_id: 'L9' } };
      expect(applyEvent(s0, absentLine)).toBe(s0);
      expect(applyEvent(s0, absentOrder)).toBe(s0);

      const notServed = { ...returned, payload: { ...returned.payload, order_item_id: 'L1R', replacement_order_item_id: 'L1R' } };
      const wrongReplacement = { ...returned, payload: { ...returned.payload, replacement_order_item_id: 'L1' } };
      for (const e of [notServed, wrongReplacement]) {
        expect(() => applyEvent(s0, e)).toThrow(/item_returned/);
        const s = applyEvent(s0, e, { strict: false });
        expect(s.lines).toBe(s0.lines);
        expect(s.diagnostics).toHaveLength(1);
        expect(s.diagnostics[0]!.kind).toBe('invalid_event');
      }
      // A second ItemReturned of the same line (already returned) is a writer bug too.
      const once = applyEvent(s0, returned);
      expect(() => applyEvent(once, returned)).toThrow(/item_returned/);
    });
  });
});
