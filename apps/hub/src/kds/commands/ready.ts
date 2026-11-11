// 03b §3.5 MarkReadyToServe / UndoReadyToServe, §6.6 (Statements 4), §6.7 (Statements 2). `run-pass` (a station
// session is refused by the route: not stationScoped, 403 PERMISSION_DENIED { session_kind: 'station' }). Not
// queueable (§3.2 "all four", the Pass is online). Engine data from memory; the alert through 01d's alerts.raise.
import { DomainError, UNDO_DONE_MS, type Identifier } from '@pos/domain';
import { isOrderInEngine } from '@pos/engine';
import { HUB_ENGINE_SETTING_DEFAULTS, type EventDraft, type ReadyToServePayload, type ReadyToServeUndonePayload } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { currentTableOf } from '../../tables/reads.js';
import { pointOfLine, tableLabel } from '../details.js';
import { READY_TO_SERVE_KIND } from '../kinds.js';

export const ReadyPayload = z.object({ order_id: z.string().min(1), point_id: z.string().min(1) });
type Payload = z.infer<typeof ReadyPayload>;

/** Engine stages of a live line (§3.4: served / removed / voided / returned lines drop off). */
const LIVE_STAGES = new Set(['added', 'cooking', 'done']);

/** §3.5 step 1: the point exists and is not archived (01a config, memory); returns its name. */
export function livePoint(point_id: string): { name: string } {
  const point = branchConfig()?.points.find((p) => p.point_id === point_id);
  if (point === undefined || point.is_archived) throw new DomainError('POINT_NOT_FOUND', { point_id });
  return { name: point.name };
}

/** §3.5 step 1: the order is in the engine at `now` (memory). */
export function requireInEngine(ctx: CommandCtx, order_id: string, now: number): void {
  if (!isOrderInEngine(ctx.state, order_id, now)) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id });
}

/** The order's live engine lines at `point_id`, in the order's line order (memory). */
export function linesAtPoint(ctx: CommandCtx, order_id: string, point_id: string): string[] {
  const order = ctx.state.orders[order_id];
  if (order === undefined) return [];
  return order.line_ids.filter((id) => {
    const line = ctx.state.lines[id];
    return line !== undefined && LIVE_STAGES.has(line.stage) && pointOfLine(ctx.state, id) === point_id;
  });
}

/** 1 statement: which of `ids` are in a hand-over (`handover_lines`). */
export function handedOver(db: Database.Database, ids: readonly string[]): Set<string> {
  const rows = db.prepare('SELECT order_item_id FROM handover_lines WHERE order_item_id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as Array<{
    order_item_id: string;
  }>;
  return new Set(rows.map((r) => r.order_item_id));
}

/** 1 statement: the open Ready of (order, point) (`pass_orders_open`). */
function openReady(db: Database.Database, order_id: string, point_id: string): { ready_alert_id: string; ready_at: number | null } | undefined {
  return db
    .prepare('SELECT ready_alert_id, ready_at FROM pass_orders WHERE order_id = ? AND point_id = ? AND ready_alert_id IS NOT NULL')
    .get(order_id, point_id) as { ready_alert_id: string; ready_at: number | null } | undefined;
}

interface OrderFacts {
  order_type: 'dine_in' | 'takeaway' | 'parking';
  placed_by: string;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: 'sedan' | 'mini' | 'large' | null;
}

/** What a Pass alert needs about an order: its target, table, identifier text and table_code. */
export interface PassOrder {
  order_type: OrderFacts['order_type'];
  placed_by: string;
  /** current primary table (dine-in), else null */
  table_id: string | null;
  /** §3.5 step 5: the primary table's name when it is all digits, else null */
  table_code: string | null;
  /** §3.1 identifier text, ≤ 40 (D-2 `details.identifier`) */
  identifier: string;
}

/**
 * 1 statement (`orders`) + 1 `currentTableOf` for a dine-in. §3.1 identifier: dine-in → the current tables' names,
 * primary first, "T" on all-digit names (01d P-1, `tableLabel`); with no seating row, the engine's table at submit.
 */
export function passOrderFacts(ctx: CommandCtx, order_id: string): PassOrder {
  const row = ctx.tx.db
    .prepare('SELECT order_type, placed_by, business_date, token, car_number, car_type FROM orders WHERE order_id = ?')
    .get(order_id) as OrderFacts | undefined;
  // In the engine but no 02b row (an order logged before 02b): 02b orders are the only orders a Pass serves.
  if (row === undefined) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id });
  if (row.order_type !== 'dine_in') {
    return { order_type: row.order_type, placed_by: row.placed_by, table_id: null, table_code: null, identifier: identifierText(identifierOf(ctx, row, null)) };
  }
  const seating = currentTableOf(ctx.tx.db, [order_id]).get(order_id);
  const ids =
    seating === undefined
      ? [ctx.state.orders[order_id]?.table_id].filter((t): t is string => typeof t === 'string')
      : [seating.primary_table_id, ...seating.table_ids.filter((t) => t !== seating.primary_table_id)];
  const names = new Map((branchConfig()?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  const primary = ids[0] ?? null;
  const primaryName = primary === null ? null : (names.get(primary) ?? primary);
  return {
    order_type: row.order_type,
    placed_by: row.placed_by,
    table_id: primary,
    table_code: primaryName !== null && /^[0-9]+$/.test(primaryName) ? primaryName : null,
    identifier: identifierText({ kind: 'table', label: ids.map((t) => tableLabel(names.get(t) ?? t)).join(' + ') }),
  };
}

function identifierOf(ctx: CommandCtx, row: OrderFacts, label: string | null): Identifier {
  if (row.order_type === 'dine_in') return { kind: 'table', label: label ?? '' };
  if (row.order_type === 'takeaway') {
    const today = ctx.state.business_day?.business_date ?? null;
    return { kind: 'token', token: row.token ?? 0, date: row.business_date === today ? null : row.business_date };
  }
  return { kind: 'parking', car_number: row.car_number ?? '', car_type: row.car_type ?? 'sedan' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** §3.1 text: "T4 + T5", "Family 2"; "#12", "#12 10 Nov" (earlier business date); "PARKING LEB 1234 SEDAN". ≤ 40. */
export function identifierText(identifier: Identifier): string {
  let text: string;
  if (identifier.kind === 'table') text = identifier.label;
  else if (identifier.kind === 'token') {
    const m = identifier.date === null ? null : /^\d{4}-(\d{2})-(\d{2})$/.exec(identifier.date);
    text = m === null ? `#${identifier.token}` : `#${identifier.token} ${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? ''}`;
  } else text = `PARKING ${identifier.car_number} ${identifier.car_type.toUpperCase()}`;
  return text.slice(0, 40);
}

const dedupeKey = (order_id: string, point_id: string, table_id: string | null): string => `${order_id}:${point_id}:${table_id ?? '-'}`;

function draft(ctx: CommandCtx, order_id: string, event_type: string, payload: ReadyToServePayload | ReadyToServeUndonePayload, now: number): EventDraft {
  return { stream_type: 'order', stream_id: order_id, event_type, schema_version: 1, payload, occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
}

// ------------------------------------------------------------------------------------------- §6.6

type MarkResult = { alert_id: string; already?: true };

/**
 * §3.5 MarkReadyToServe. Statements 4 (dine-in): `handover_lines`, `pass_orders`, `orders`, `currentTableOf`; 3 for a
 * takeaway / parking (no table read); + 01d's raise.
 */
function markReadyToServe(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: MarkResult } {
  const now = ctx.clock.branchNow();
  const { order_id, point_id } = payload;
  const point = livePoint(point_id);
  requireInEngine(ctx, order_id, now);

  const atPoint = linesAtPoint(ctx, order_id, point_id);
  const handed = atPoint.length === 0 ? new Set<string>() : handedOver(ctx.tx.db, atPoint);
  const readyLines = atPoint.filter((id) => !handed.has(id));
  if (readyLines.length === 0) throw new DomainError('ITEM_WRONG_STAGE', { order_id, stage: 'served' });

  const open = openReady(ctx.tx.db, order_id, point_id);
  if (open !== undefined) return { events: [], result: { alert_id: open.ready_alert_id, already: true } };

  const order = passOrderFacts(ctx, order_id);
  const target =
    order.order_type === 'dine_in' && order.table_id !== null
      ? ({ kind: 'table_team', table_id: order.table_id, depth: 'direct' } as const)
      : ({ kind: 'person', staff_id: order.placed_by } as const);
  const window_ms = branchConfig()?.engine_settings.ready_window_ms ?? HUB_ENGINE_SETTING_DEFAULTS.ready_window_ms;
  const raised = alerts.raise(ctx, {
    kind: READY_TO_SERVE_KIND,
    subject: { stream_type: 'order', stream_id: order_id },
    target,
    values: { order_id, point_id, table_id: order.table_id ?? '', window_ms },
    display: { table_code: order.table_code, point_code: point.name, kind_label_key: 'alert.ready_to_serve' },
    details: { identifier: order.identifier },
    dedupe_key: dedupeKey(order_id, point_id, order.table_id),
  });
  // An open alert under the same key with no open pass_orders row cannot be built by 03b's commands; treat as step 3.
  if (raised.deduped) return { events: [], result: { alert_id: raised.alert_id, already: true } };

  const p: ReadyToServePayload = { order_id, point_id, order_item_ids: readyLines, table_id: order.table_id, alert_id: raised.alert_id };
  return { events: [...raised.events, draft(ctx, order_id, 'ReadyToServe', p, now)], result: { alert_id: raised.alert_id } };
}

export const markReadyToServeCommand = defineCommand({
  commandType: 'MarkReadyToServe',
  payloadSchema: ReadyPayload,
  sessionKind: 'device',
  permission: 'run-pass',
  handle: (ctx, payload) => markReadyToServe(ctx, payload),
});

// ------------------------------------------------------------------------------------------- §6.7

/**
 * §3.5 UndoReadyToServe: an open Ready, `now − ready_at ≤ UNDO_DONE_MS`, no Handover of (order, point) since `ready_at`
 * → `ReadyToServeUndone` + close `undone`; else 409 PASS_UNDO_WINDOW_CLOSED. Statements 2 (`pass_orders`, `handovers`)
 * + 01d's close.
 */
function undoReadyToServe(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { alert_id: string } } {
  const now = ctx.clock.branchNow();
  const { order_id, point_id } = payload;
  livePoint(point_id);
  const closed = (): DomainError => new DomainError('PASS_UNDO_WINDOW_CLOSED', { order_id, point_id });
  const open = openReady(ctx.tx.db, order_id, point_id);
  if (open === undefined || open.ready_at === null || now - open.ready_at > UNDO_DONE_MS) throw closed();
  const handed = ctx.tx.db
    .prepare(
      // any Handover of this order at this point since the Ready (also of a line added after it); §5 has no
      // handovers (order_id, point_id) index, so this scans handovers (Reading R-17)
      `SELECT EXISTS (SELECT 1 FROM handovers WHERE order_id = ? AND point_id = ? AND handed_at >= ?) AS handed`,
    )
    .get(order_id, point_id, open.ready_at) as { handed: number };
  if (handed.handed === 1) throw closed();

  const p: ReadyToServeUndonePayload = { order_id, point_id, alert_id: open.ready_alert_id };
  return {
    events: [draft(ctx, order_id, 'ReadyToServeUndone', p, now), ...alerts.close(ctx, open.ready_alert_id, 'undone')],
    result: { alert_id: open.ready_alert_id },
  };
}

export const undoReadyToServeCommand = defineCommand({
  commandType: 'UndoReadyToServe',
  payloadSchema: ReadyPayload,
  sessionKind: 'device',
  permission: 'run-pass',
  handle: (ctx, payload) => undoReadyToServe(ctx, payload),
});

export function registerReadyCommands(app: FastifyInstance): void {
  commandRegistry(app).register(markReadyToServeCommand);
  commandRegistry(app).register(undoReadyToServeCommand);
}
