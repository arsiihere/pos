// 03a §4.4 stubs, test fakes only (nothing of 02 or 03b is built): a fake `SubmitOrder` that calls checkOrderable,
// reserveStock and planOrder and appends the §4.2 batch, and the Start / Done drafts a real command would write
// (with their stock effects from stockEffects, array form, AD-29 Q7).
import { checkOrderable, planOrder, reserveStock, stockEffects, type EngineState, type ProposedOrder } from '@pos/engine';
import type { ConfigStockItem, EventDraft, PosEvent } from '@pos/events';
import { anItemAdded, anOrderBatch } from '@pos/events/testing';
import { z } from 'zod';
import { defineAlertKind, kindOf, unregisterAlertKind } from '../../src/alerts/kinds';
import { ENGINE_ALERT_KINDS } from '../../src/engine-host/fires-alerts-tick';
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

// 03a task 22a: the three kinds `fires_alerts` raises, as 01d test fakes until task 23 registers the real ones
// (§3.8 slip_warning, §3.10 station_overload, AD-8 engine_line_dropped). The one place their definitions live, so
// task 23 can move them to src/engine-host/kinds.ts. The slip kind's apply is task 23's (here it returns nothing).
export function registerEngineKindFakes(): void {
  if (kindOf(ENGINE_ALERT_KINDS.slip) === undefined) {
    defineAlertKind({
      kind: ENGINE_ALERT_KINDS.slip,
      family: 'action',
      subject: 'order',
      steps: [
        { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
        { at: { value: 'escalate_ms', times: 1 }, escalation: true, to: [{ target: 'raised_target', set: 'answerer' }, { target: { kind: 'managers' }, set: 'informed' }] },
      ],
      closes_on: 'owner',
      // max(64) stands in for "values that fail the kind's schema" (test 76).
      values_schema: z.object({ table_key: z.string().min(1).max(64), order_ids: z.array(z.string().min(1)).min(1), escalate_ms: z.number().int() }),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.slip_warning.card', lock: 'alert.slip_warning.lock' },
      request: { answers: ['accept', 'decline'], right: { mode: 'named' }, needs_pin: 'never', apply: () => [] },
    });
  }
  if (kindOf(ENGINE_ALERT_KINDS.overload) === undefined) {
    defineAlertKind({
      kind: ENGINE_ALERT_KINDS.overload,
      family: 'info',
      subject: 'station',
      steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
      closes_on: 'owner',
      values_schema: z.object({ station_id: z.string().min(1), pressure_bp: z.number().int(), waiting: z.number().int() }),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.station_overload.card', lock: 'alert.station_overload.lock' },
      request: null,
    });
  }
  if (kindOf(ENGINE_ALERT_KINDS.lineDropped) === undefined) {
    defineAlertKind({
      kind: ENGINE_ALERT_KINDS.lineDropped,
      family: 'info',
      subject: 'order',
      steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
      closes_on: 'owner',
      values_schema: z.object({ order_id: z.string().min(1), order_item_id: z.string().min(1), reason: z.string().min(1) }),
      details_schema: null,
      lead_fallback: false,
      expires_at_day_close: true,
      silent: false,
      labels: { card: 'alert.engine_line_dropped.card', lock: 'alert.engine_line_dropped.lock' },
      request: null,
    });
  }
}

export function resetEngineKindFakes(): void {
  for (const kind of Object.values(ENGINE_ALERT_KINDS)) unregisterAlertKind(kind);
}
