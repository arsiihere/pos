// 03a §4.4 stubs, test fakes only (nothing of 02 or 03b is built): a fake `SubmitOrder` that calls checkOrderable,
// reserveStock and planOrder and appends the §4.2 batch, and the Start / Done drafts a real command would write
// (with their stock effects from stockEffects, array form, AD-29 Q7).
import { checkOrderable, lateStartShift, planOrder, reserveStock, stockEffects, type EngineState, type ProposedOrder } from '@pos/engine';
import type { ConfigStockItem, EventDraft, PosEvent } from '@pos/events';
import { anItemAdded, anOrderBatch, aReturnLinesAdded } from '@pos/events/testing';
import type { HubDeps } from '../../src/server';

export function draftOf(event: Pick<PosEvent, 'stream_type' | 'stream_id' | 'event_type' | 'schema_version' | 'payload'> & Partial<PosEvent>, at?: number): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: at ?? event.occurred_at ?? 0,
    actor_id: event.actor_id ?? null,
    device_id: event.device_id ?? 'hub',
  };
}

export interface FakeLine {
  order_item_id: string;
  station_id?: string;
  /** ItemAdded payload overrides (cook_time_ms, stock_draws, stock_time_ms, …) */
  item?: Record<string, unknown>;
}
export interface FakeOrder {
  order_id: string;
  lines: FakeLine[];
  order?: Partial<ProposedOrder['order']>;
  /** OrderPlaced's actor_id, i.e. the order's placed_by (§3.3); default null */
  actor_id?: string | null;
}
export interface FakeStock {
  dayStartMs: number;
  stockItems: ConfigStockItem[];
}

// The ProposedOrder 02 would build from branchConfig() (§4.2), with the config defaults of a line (01a v2.1 §5.2a).
export function proposedOf(o: FakeOrder): ProposedOrder {
  const base = anItemAdded().payload;
  return {
    order_id: o.order_id,
    order: { order_type: 'dine_in', table_id: 'T12', table_key: 'dine_in:T12', follow_up: false, pickup_at_ms: null, ...o.order },
    lines: o.lines.map((l) => ({
      ...base,
      order_id: o.order_id,
      order_item_id: l.order_item_id,
      station_id: l.station_id ?? 'S1',
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
    })) as unknown as ProposedOrder['lines'],
  };
}

// The §4.2 submit batch on `state` at `now`: OrderPlaced, ItemAdded × n, StockReserved × draws.
export function fakeSubmitDrafts(state: EngineState, o: FakeOrder, now: number, stock?: FakeStock): EventDraft[] {
  const proposed = proposedOf(o);
  checkOrderable(state, proposed);
  const reserved = reserveStock(state, proposed, stock?.dayStartMs ?? 0, stock?.stockItems ?? [], {});
  const plan = planOrder(state, proposed, now, reserved.from_stock);
  const placed = new Map(plan.lines.map((l) => [l.order_item_id, l]));
  const batch = anOrderBatch({
    order_id: o.order_id,
    recorded_at: now,
    lines: o.lines.map((l) => {
      const p = placed.get(l.order_item_id)!;
      return {
        order_item_id: l.order_item_id,
        item: { station_id: l.station_id ?? 'S1', ...l.item },
        line: { station_id: p.station_id, alternates: p.alternates, point_id: p.point_id, carry_ms: p.carry_ms, from_stock: p.from_stock },
      };
    }),
    order: { ...proposed.order, groups: plan.groups },
    reserved: reserved.drafts.map((d) => d.payload),
    actor_id: o.actor_id ?? null,
  });
  return batch.map((e) => draftOf(e, now));
}

// A fake SubmitOrder command: one writer.run; the state is read inside the transaction (race rule, test 71).
export function fakeSubmit(deps: Pick<HubDeps, 'writer'>, o: FakeOrder, stock?: FakeStock): PosEvent[] {
  return deps.writer.run((tx) => tx.append(fakeSubmitDrafts(tx.state as EngineState, o, tx.clock.branchNow(), stock))).appended;
}

const stamp = (d: { stream_type: string; stream_id: string; event_type: string; schema_version: number; payload: unknown }, now: number): EventDraft =>
  draftOf({ ...d, payload: d.payload as Record<string, unknown> } as Parameters<typeof draftOf>[0], now);

// A Start tap (03b's command, stubbed): ItemStarted plus its stock effects, as a real command drafts them.
export function fakeStartDrafts(state: EngineState, order_item_id: string, now: number): EventDraft[] {
  const order_id = state.lines[order_item_id]!.order_id;
  const start = draftOf({ stream_type: 'order', stream_id: order_id, event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id, started_at: now, source: 'tap' } }, now);
  return stockEffects(state, [start]).map((d) => stamp(d, now));
}

// A Done tap: ItemDone plus its stock effects (AD-29 Q7: a from-stock Done with no Start drafts StockConsumed).
export function fakeDoneDrafts(state: EngineState, order_item_id: string, now: number): EventDraft[] {
  const order_id = state.lines[order_item_id]!.order_id;
  const done = draftOf({ stream_type: 'order', stream_id: order_id, event_type: 'ItemDone', schema_version: 1, payload: { order_item_id, done_at: now, source: 'tap' } }, now);
  return stockEffects(state, [done]).map((d) => stamp(d, now));
}

export function fakeTap(deps: Pick<HubDeps, 'writer'>, kind: 'start' | 'done', order_item_id: string): PosEvent[] {
  return deps.writer.run((tx) => {
    const state = tx.state as EngineState;
    const now = tx.clock.branchNow();
    return tx.append(kind === 'start' ? fakeStartDrafts(state, order_item_id, now) : fakeDoneDrafts(state, order_item_id, now));
  }).appended;
}

// 02's SubmitOrder refuses an order with a `sold_out` line that stock cannot serve (§3.7, E1 stock AC4): nothing is
// appended. Otherwise as fakeSubmit. The state is read inside the transaction (race rule, test 74).
export function fakeSubmitOrRefuse(deps: Pick<HubDeps, 'writer'>, o: FakeOrder, stock?: FakeStock): { refused: string[]; appended: PosEvent[] } {
  return deps.writer.run((tx) => {
    const state = tx.state as EngineState;
    const refused = reserveStock(state, proposedOf(o), stock?.dayStartMs ?? 0, stock?.stockItems ?? [], {}).refused;
    if (refused.length > 0) return { refused, appended: [] as PosEvent[] };
    return { refused, appended: tx.append(fakeSubmitDrafts(state, o, tx.clock.branchNow(), stock)) };
  }).result;
}

// A Served tap (03b's command, stubbed): ItemServed plus its stock effects (AD-29 Q7).
export function fakeServedDrafts(state: EngineState, order_id: string, order_item_ids: string[], now: number): EventDraft[] {
  const served = draftOf({ stream_type: 'order', stream_id: order_id, event_type: 'ItemServed', schema_version: 1, payload: { order_item_ids, source: 'tap' } }, now);
  return stockEffects(state, [served]).map((d) => stamp(d, now));
}

// 02's boost (§3.9): OrderBoosted { order_id }.
export function fakeBoostDrafts(order_id: string, now: number): EventDraft[] {
  return [draftOf({ stream_type: 'order', stream_id: order_id, event_type: 'OrderBoosted', schema_version: 1, payload: { order_id } }, now)];
}

// 02's ReturnToKitchen (§3.8a) for a served line, given its ItemAdded: the return line planned by planOrder (as 02
// would), then aReturnLinesAdded's batch (OrderLinesAdded, ItemAdded, ItemReturned for `remake`).
export function fakeReturnDrafts(state: EngineState, served: PosEvent, mode: 'fix' | 'remake', now: number): EventDraft[] {
  const s = served.payload as { order_id: string; order_item_id: string; station_id: string };
  const order = state.orders[s.order_id]!;
  const id = `${s.order_item_id}R`;
  const proposed = {
    order_id: s.order_id,
    order: { order_type: order.order_type, table_id: order.table_id, table_key: order.table_key, follow_up: order.follow_up, pickup_at_ms: order.pickup_at_ms },
    lines: [
      {
        ...served.payload,
        order_item_id: id,
        line_kind: 'item',
        options: [],
        stock_draws: [],
        alternates: [],
        point_id: null,
        carry_ms: 0,
        weight_pct: 100,
        max_early_ms: 60_000,
        max_late_ms: null,
        max_carry_ms: null,
        cook_ms_override: mode === 'fix' ? 180_000 : null,
        return_of: { order_item_id: s.order_item_id, mode },
      },
    ],
  } as unknown as ProposedOrder;
  const plan = planOrder(state, proposed, now, { [id]: false });
  const group = plan.groups[0]!;
  const batch = aReturnLinesAdded(served, mode, {
    order_item_id: id,
    recorded_at: now,
    target_land_ms: group.target_land_ms,
    promise_ms: group.promise_ms,
    group_index: order.next_group_index,
    line: { station_id: plan.lines[0]!.station_id, alternates: plan.lines[0]!.alternates },
  });
  return batch.map((e) => draftOf(e, now));
}

// A late Start tap: as fakeStartDrafts, plus 03b's lateStartShift draft when it gives one (§3.3, F §4.7 D42), drafted
// on the state before the Start, as the simulator does.
export function fakeLateStartDrafts(state: EngineState, order_item_id: string, now: number): EventDraft[] {
  const shift = lateStartShift(state, order_item_id, now);
  return [...fakeStartDrafts(state, order_item_id, now), ...(shift === null ? [] : [stamp(shift, now)])];
}
