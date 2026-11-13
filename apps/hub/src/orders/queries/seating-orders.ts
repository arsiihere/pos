import { isOrderInEngine, type EngineLine, type EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { alerts } from '../../alerts/raise.js';
import { defineQuery, queryRegistry } from '../../queries/registry.js';
import type { CompValues } from '../commands/comp-line.js';
import type { LineView, OrderView } from '../contracts.js';
import { ordersOf, seatingTotals } from '../exports.js';
import { COMP_KIND } from '../line-change.js';

// 02b v1.0.3 §6.15 GET /queries/seating-orders: the seating's orders (02a seating_orders, current, P-1c) by placed_at,
// with their lines (LineView, §4.2) and each line's engine stage and `fired`, and the seating's total (§3.13).
// Statements: 3 (ordersOf, seatingTotals, the open comp requests of pending_comp — ⚠️ 02b v1.0.11 Q-11; was 2); names from the directory, promise / stage / fired from EngineState, in memory.
// No contact (O17). ⚠️ 02b v1.0.11 (Q-7): each order carries `order_note`, each line its `options` (LineView, §4.2);
// 0 extra statements.
//
// Owner 2026-11-11 S-1 (d): each order carries the order-level `promise_ms` (EngineOrder.promise_ms, the max over its
// groups, never moved) while the order is in the engine (the predicate, 03a §3.3), else null — as open-orders; no
// per-group list (EngineState keeps no per-group promise). R8 (owner): `fired` per line, MarkServed's own predicate.

/**
 * A line's stage for the screens. `null`: a deal header or a zone-served line (never in the engine, 03a :245, O5), or a
 * line the engine does not hold. `out_of_engine`: the order has left the engine (O16; the stage name RemoveItems
 * already uses) — any exit: abandoned, the normal exit 30 min after its last serve, or an order the engine never held
 * (only no-station lines); the line's own `served_at` tells a served line apart (reading R8, accepted). Else the
 * EngineState stage.
 */
export type LineStage = EngineLine['stage'] | 'out_of_engine' | null;

export function lineStage(state: Readonly<EngineState>, line: LineView, inEngine: boolean): LineStage {
  if (line.line_kind === 'deal' || line.zone_served) return null;
  if (!inEngine) return 'out_of_engine';
  return state.lines[line.order_item_id]?.stage ?? null;
}

/**
 * R8 (owner 2026-11-11): the line may be marked served as far as firing goes — MarkServed's check (§3.7, O16,
 * commands/mark-served.ts): unfired only when the order is in the engine and its engine line is `added` with no fire.
 * A line the engine does not hold (no station, zone-served) and every line of an order out of the engine count as
 * fired; a deal header is never served (its parts are, §3.4), so false.
 */
export function lineFired(state: Readonly<EngineState>, line: LineView, inEngine: boolean): boolean {
  if (line.line_kind === 'deal') return false;
  const engineLine = inEngine ? state.lines[line.order_item_id] : undefined;
  return !(engineLine !== undefined && engineLine.stage === 'added' && engineLine.fired_at === null);
}

export interface SeatingOrder {
  order_id: string;
  placed_by: { staff_id: string; name: string | null };
  placed_at: number;
  follow_up: boolean;
  cancelled: boolean;
  billed: boolean;
  has_phone: boolean;
  /** ⚠️ 02b v1.0.11 §6.15 (Q-7): OrderView.order_note */
  order_note: string | null;
  /** S-1 (d): EngineOrder.promise_ms while the order is in the engine, else null */
  promise_ms: number | null;
  lines: Array<LineView & { stage: LineStage; fired: boolean; pending_comp: PendingComp | null }>;
}

/** ⚠️ 02b v1.0.11 §6.15 (Q-11): the line's open `comp` request — its id, the requested units and its amount. */
export interface PendingComp {
  alert_id: string;
  units: number;
  value_minor: number;
}

/** The id-only warning sink of `pendingComps` (the Fastify logger in the routes). */
export interface PendingCompLog {
  warn(obj: { alert_id: string; order_item_id: string }, msg: string): void;
}

/**
 * ⚠️ 02b v1.0.11 §6.15 / §6.18a (Q-11): the branch's open `comp` requests by `values.order_item_id` (CompValues), one
 * `alerts.listOpen({ kind: 'comp' })` per call (1 statement). `value_minor` = the request's `details.amount` (§3.9, the
 * pending result's `value_minor`). One open request per line (dedupe key `comp:<order_item_id>`). A request with no
 * amount is left out (the line's `pending_comp` is null, never Rs 0) and logged by ids only; never thrown, so one bad
 * row cannot break the view.
 */
export function pendingComps(db: Database.Database, log: PendingCompLog): Map<string, PendingComp> {
  const out = new Map<string, PendingComp>();
  for (const a of alerts.listOpen(db, { kind: COMP_KIND })) {
    const v = a.values as CompValues; // validated by the kind's values_schema at raise
    const amount = a.details?.amount;
    if (typeof amount !== 'number') {
      log.warn({ alert_id: a.alert_id, order_item_id: v.order_item_id }, 'comp request without amount; pending_comp left null');
      continue;
    }
    out.set(v.order_item_id, { alert_id: a.alert_id, units: v.units, value_minor: amount });
  }
  return out;
}

/**
 * ⚠️ 02b v1.0.11 §6.18a (Q-8): one order in the §6.15 shape, the builder `seating-orders` and `order-view` share
 * (0 statements: names from the directory, promise / stage / fired from EngineState).
 */
export function toSeatingOrder(
  state: Readonly<EngineState>,
  directory: StaffDirectory,
  o: OrderView,
  now: number,
  pending: ReadonlyMap<string, PendingComp>,
): SeatingOrder {
  const inEngine = isOrderInEngine(state, o.order_id, now);
  return {
    order_id: o.order_id,
    placed_by: { staff_id: o.placed_by, name: directory.get(o.placed_by)?.display_name ?? null },
    placed_at: o.placed_at,
    follow_up: o.follow_up,
    cancelled: o.cancelled,
    billed: o.billed,
    has_phone: o.has_phone,
    order_note: o.order_note,
    promise_ms: inEngine ? state.orders[o.order_id]!.promise_ms : null,
    lines: o.lines.map((l) => ({
      ...l,
      stage: lineStage(state, l, inEngine),
      fired: lineFired(state, l, inEngine),
      pending_comp: pending.get(l.order_item_id) ?? null,
    })),
  };
}

export function seatingOrdersBody(
  db: Database.Database,
  state: Readonly<EngineState>,
  directory: StaffDirectory,
  seating_id: string,
  now: number,
  log: PendingCompLog,
): { orders: SeatingOrder[]; total_minor: number } {
  const orders = ordersOf(db, seating_id);
  const { total_minor } = seatingTotals(db, seating_id);
  const pending = pendingComps(db, log);
  return { orders: orders.map((o) => toSeatingOrder(state, directory, o, now, pending)), total_minor };
}

export function registerSeatingOrdersQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'seating-orders',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({ seating_id: z.string().min(1) }),
      handle: (ctx, q) => ({ data: seatingOrdersBody(ctx.db, ctx.state, ctx.directory, q.seating_id, ctx.now, app.log) }),
    }),
  );
}
