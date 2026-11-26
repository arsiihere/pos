// 03b §3.5 MarkReadyToServe / UndoReadyToServe, §6.6 (Statements 4), §6.7 (Statements 2). `run-pass` (a station
// session is refused by the route: not stationScoped, 403 PERMISSION_DENIED { session_kind: 'station' }). Not
// queueable (§3.2 "all four", the Pass is online). Engine data from memory; the alert through 01d's alerts.raise.
import { DomainError, UNDO_DONE_MS, type Identifier } from '@pos/domain';
import { isOrderInEngine, stockEffects, type EngineState } from '@pos/engine';
import { HUB_ENGINE_SETTING_DEFAULTS, ReadyToServeV2, type EventDraft, type ReadyToServePayload, type ReadyToServePayloadV2, type ReadyToServeUndonePayload } from '@pos/events';
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
import { envelopeOf } from './start-done.js';

export const ReadyPayload = z.object({ order_id: z.string().min(1), point_id: z.string().min(1) });
type Payload = z.infer<typeof ReadyPayload>;
// ⚠️ 03b v1.0.10 §6.6 (STAB-2): the lines to make ready (additive); absent → the done ones.
export const MarkReadyPayload = ReadyPayload.extend({ order_item_ids: z.array(z.string().min(1)).min(1).max(40).optional() });
type MarkPayload = z.infer<typeof MarkReadyPayload>;

/** 03b v1.0.10 §3.5 step 5: at most this many lines on the waiter's card (`details.lines`). */
const CARD_LINES_MAX = 20;

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
  lines_json: string;
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
  /** §3.5 step 5: the primary table's name when it is all digits, else null; ⚠️ v1.0.16: '#token' / 'PARKING' */
  table_code: string | null;
  /** §3.1 identifier text, ≤ 40 (D-2 `details.identifier`) */
  identifier: string;
  /** 03b v1.0.10 §3.5 step 5: each line's name, live units and (v1.0.11, STAB-5) `part_of` (`order_lines`, same statement) */
  names: Map<string, { name: string; units: number; part_of: string | null }>;
}

/**
 * 1 statement (`orders`) + 1 `currentTableOf` for a dine-in. §3.1 identifier: dine-in → the current tables' names,
 * primary first, "T" on all-digit names (01d P-1, `tableLabel`); with no seating row, the engine's table at submit.
 */
export function passOrderFacts(ctx: CommandCtx, order_id: string): PassOrder {
  const row = ctx.tx.db
    .prepare(
      `SELECT order_type, placed_by, business_date, token, car_number, car_type,
              (SELECT json_group_array(json_object('id', l.order_item_id, 'name', l.name, 'units', l.units - l.removed_units - l.voided_units, 'part_of', l.part_of))
                 FROM order_lines l WHERE l.order_id = orders.order_id) AS lines_json
         FROM orders WHERE order_id = ?`,
    )
    .get(order_id) as OrderFacts | undefined;
  // In the engine but no 02b row (an order logged before 02b): 02b orders are the only orders a Pass serves.
  if (row === undefined) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id });
  const names = new Map(
    (JSON.parse(row.lines_json) as Array<{ id: string; name: string; units: number; part_of: string | null }>).map((l) => [l.id, { name: l.name, units: l.units, part_of: l.part_of }] as const),
  );
  if (row.order_type !== 'dine_in') {
    // ⚠️ 03b v1.0.16 §3.5 step 5 (02b-tk R8; 03b OQ-8): the lock names the order without the card: '#' + token for a
    // takeaway, 'PARKING' for parking (no reader prefixes "T" to a non-digit value, 01d v1.3.7 m-6)
    const table_code = row.order_type === 'takeaway' ? `#${row.token ?? 0}` : 'PARKING';
    return { order_type: row.order_type, placed_by: row.placed_by, table_id: null, table_code, identifier: identifierText(identifierOf(ctx, row, null)), names };
  }
  const seating = currentTableOf(ctx.tx.db, [order_id]).get(order_id);
  const ids =
    seating === undefined
      ? [ctx.state.orders[order_id]?.table_id].filter((t): t is string => typeof t === 'string')
      : [seating.primary_table_id, ...seating.table_ids.filter((t) => t !== seating.primary_table_id)];
  const tableNames = new Map((branchConfig()?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  const primary = ids[0] ?? null;
  const primaryName = primary === null ? null : (tableNames.get(primary) ?? primary);
  return {
    order_type: row.order_type,
    placed_by: row.placed_by,
    table_id: primary,
    table_code: primaryName !== null && /^[0-9]+$/.test(primaryName) ? primaryName : null,
    identifier: identifierText({ kind: 'table', label: ids.map((t) => tableLabel(tableNames.get(t) ?? t)).join(' + ') }),
    names,
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

function draft(ctx: CommandCtx, order_id: string, event_type: string, payload: ReadyToServePayloadV2 | ReadyToServeUndonePayload, now: number): EventDraft {
  const schema_version = event_type === 'ReadyToServe' ? 2 : 1; // 03b v1.0.10 §6.22: ReadyToServe v2
  return { stream_type: 'order', stream_id: order_id, event_type, schema_version, payload, occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
}

/**
 * §3.5 steps 4–6 for `lines`: raise the ready alert under `key` (its card lists the lines, 03b v1.0.10) and draft the
 * `ReadyToServe` v2. 1 statement (`orders` with its line names) + 1 `currentTableOf` for a dine-in; + 01d's raise.
 */
function raiseReady(
  ctx: CommandCtx,
  o: { order_id: string; point_id: string; point_name: string; lines: string[]; added: string[]; forced: string[]; suffix: string },
  now: number,
): { events: EventDraft[]; alert_id: string; deduped: boolean } {
  const order = passOrderFacts(ctx, o.order_id);
  const target =
    order.order_type === 'dine_in' && order.table_id !== null
      ? ({ kind: 'table_team', table_id: order.table_id, depth: 'direct' } as const)
      : ({ kind: 'person', staff_id: order.placed_by } as const);
  const window_ms = branchConfig()?.engine_settings.ready_window_ms ?? HUB_ENGINE_SETTING_DEFAULTS.ready_window_ms;
  // ⚠️ 03b v1.0.11 §3.5 step 5 (STAB-5): a split line's parts (one `part_of`) are one entry with their summed units, at
  // the first part's place; the cap counts entries
  const entries = new Map<string, { name: string; quantity: number; state: string }>();
  for (const id of o.lines) {
    const n = order.names.get(id);
    const key = n?.part_of ?? id;
    const units = Math.max(1, n?.units ?? 1);
    const had = entries.get(key);
    if (had === undefined) entries.set(key, { name: n?.name ?? id, quantity: units, state: 'ready' });
    else had.quantity += units;
  }
  const cardLines = [...entries.values()].slice(0, CARD_LINES_MAX);
  const raised = alerts.raise(ctx, {
    kind: READY_TO_SERVE_KIND,
    subject: { stream_type: 'order', stream_id: o.order_id },
    target,
    values: { order_id: o.order_id, point_id: o.point_id, table_id: order.table_id ?? '', window_ms },
    display: { table_code: order.table_code, point_code: o.point_name, kind_label_key: 'alert.ready_to_serve' },
    details: { identifier: order.identifier, lines: cardLines },
    dedupe_key: dedupeKey(o.order_id, o.point_id, order.table_id) + o.suffix,
  });
  if (raised.deduped) return { events: [], alert_id: raised.alert_id, deduped: true };
  const p: ReadyToServePayloadV2 = {
    order_id: o.order_id,
    point_id: o.point_id,
    order_item_ids: o.lines,
    added_ids: o.added,
    forced_ids: o.forced,
    table_id: order.table_id,
    alert_id: raised.alert_id,
  };
  return { events: [...raised.events, draft(ctx, o.order_id, 'ReadyToServe', p, now)], alert_id: raised.alert_id, deduped: false };
}

// ------------------------------------------------------------------------------------------- §6.6

type MarkResult = { alert_id: string; already?: true; forced?: string[] };

/** 1 statement: the open Ready of (order, point) with its unsettled own lines (`pass_orders` ⋈ `pass_ready_lines`). */
function openReadyLines(db: Database.Database, order_id: string, point_id: string): { ready_alert_id: string; lines: Set<string> } | undefined {
  const row = db
    .prepare(
      `SELECT p.ready_alert_id,
              (SELECT json_group_array(r.order_item_id) FROM pass_ready_lines r
                WHERE r.order_id = p.order_id AND r.point_id = p.point_id AND r.settled_at IS NULL) AS lines
         FROM pass_orders p WHERE p.order_id = ? AND p.point_id = ? AND p.ready_alert_id IS NOT NULL`,
    )
    .get(order_id, point_id) as { ready_alert_id: string; lines: string } | undefined;
  return row === undefined ? undefined : { ready_alert_id: row.ready_alert_id, lines: new Set(JSON.parse(row.lines) as string[]) };
}

/** §3.2 DoneItem's drafts for one line (03b v1.0.10 §3.5 step 2a): ItemDone (tap) + its stockEffects; no confirm, no load. */
function forcedDones(ctx: CommandCtx, ids: readonly string[], now: number): EventDraft[] {
  if (ids.length === 0) return [];
  const envelope = envelopeOf(ctx, now);
  const dones = ids.map(
    (order_item_id): EventDraft => ({
      stream_type: 'order',
      stream_id: ctx.state.lines[order_item_id]!.order_id,
      event_type: 'ItemDone',
      schema_version: 1,
      payload: { order_item_id, done_at: now, source: 'tap' },
      ...envelope,
    }),
  );
  return stockEffects(ctx.state as EngineState, dones).map((d): EventDraft => ({ ...envelope, ...d }) as EventDraft);
}

/**
 * §3.5 MarkReadyToServe (⚠️ 03b v1.0.10, STAB-2: picked lines, forced Dones, extend). Statements 4 (dine-in):
 * `handover_lines`, `pass_orders` ⋈ `pass_ready_lines`, `orders` (+ line names), `currentTableOf`; 3 for a takeaway /
 * parking; + 01d's raise and close.
 */
function markReadyToServe(ctx: CommandCtx, payload: MarkPayload): { events: EventDraft[]; result: MarkResult } {
  const now = ctx.clock.branchNow();
  const { order_id, point_id } = payload;
  const point = livePoint(point_id);
  requireInEngine(ctx, order_id, now);

  const atPoint = linesAtPoint(ctx, order_id, point_id);
  const handed = atPoint.length === 0 ? new Set<string>() : handedOver(ctx.tx.db, atPoint);
  const candidates = atPoint.filter((id) => !handed.has(id));
  const isCandidate = new Set(candidates);
  const asked = payload.order_item_ids === undefined ? null : [...new Set(payload.order_item_ids)];
  for (const id of asked ?? []) {
    if (isCandidate.has(id)) continue;
    const stage = handed.has(id) ? 'handed_over' : (ctx.state.lines[id]?.stage ?? 'unknown');
    throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: id, stage });
  }
  if (candidates.length === 0) throw new DomainError('ITEM_WRONG_STAGE', { order_id, stage: 'served' });

  const open = openReadyLines(ctx.tx.db, order_id, point_id);
  const stageOf = (id: string): string => ctx.state.lines[id]!.stage;
  const picked = (asked ?? candidates.filter((id) => stageOf(id) === 'done')).filter((id) => open === undefined || !open.lines.has(id));
  if (picked.length === 0) {
    if (open !== undefined) return { events: [], result: { alert_id: open.ready_alert_id, already: true } };
    throw new DomainError('ITEM_WRONG_STAGE', { order_id, stage: stageOf(candidates[0]!) });
  }
  const forced = picked.filter((id) => stageOf(id) !== 'done');
  // ⚠️ 03b v1.0.16 §3.5 step 2a (run 3 R3-M-5): a pickup refuses a forced pick (Start / Done make unmade food)
  const first = forced[0];
  if (first !== undefined && (ctx.state.orders[order_id]?.pickup_at_ms ?? null) !== null) {
    throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: first, stage: stageOf(first) });
  }
  const taken = new Set([...picked, ...(open === undefined ? [] : [...open.lines].filter((id) => isCandidate.has(id)))]);
  const lines = candidates.filter((id) => taken.has(id)); // the order's line order
  // Step 3: extend — the open alert still holds the base key in this transaction, so the new one takes a suffix.
  // `overridden`, not `obsolete` (the re-target's "Moved"): the waiter's old card reads "Updated"
  const closed = open === undefined ? [] : alerts.close(ctx, open.ready_alert_id, 'overridden');
  const raised = raiseReady(ctx, { order_id, point_id, point_name: point.name, lines, added: picked, forced, suffix: open === undefined ? '' : `:+${picked[0]}` }, now);
  // An open alert under the same key with no open pass_orders row cannot be built by 03b's commands; treat as step 3.
  if (raised.deduped) return { events: [], result: { alert_id: raised.alert_id, already: true } };
  const events = [...forcedDones(ctx, forced, now), ...closed, ...raised.events];
  return { events, result: { alert_id: raised.alert_id, ...(forced.length === 0 ? {} : { forced }) } };
}

export const markReadyToServeCommand = defineCommand({
  commandType: 'MarkReadyToServe',
  payloadSchema: MarkReadyPayload,
  sessionKind: 'device',
  permission: 'run-pass',
  handle: (ctx, payload) => markReadyToServe(ctx, payload),
});

// ------------------------------------------------------------------------------------------- §6.7

/** 1 statement (`events_stream`): the latest `ReadyToServe` of (order, point), read as v2 (03b v1.0.10 §6.7). */
function latestReady(db: Database.Database, order_id: string, point_id: string): ReadyToServePayloadV2 | undefined {
  const row = db
    .prepare(
      `SELECT schema_version, payload FROM events
        WHERE stream_type = 'order' AND stream_id = ? AND event_type = 'ReadyToServe' AND json_extract(payload, '$.point_id') = ?
        ORDER BY seq DESC LIMIT 1`,
    )
    .get(order_id, point_id) as { schema_version: number; payload: string } | undefined;
  if (row === undefined) return undefined;
  const payload = JSON.parse(row.payload) as unknown;
  return row.schema_version >= 2 ? (payload as ReadyToServePayloadV2) : (ReadyToServeV2.upcastFromPrevious!(payload as ReadyToServePayload) as ReadyToServePayloadV2);
}

/**
 * §3.5 UndoReadyToServe: an open Ready, `now − ready_at ≤ UNDO_DONE_MS`, no Handover of (order, point) since `ready_at`;
 * else 409 PASS_UNDO_WINDOW_CLOSED. ⚠️ 03b v1.0.10 (STAB-2): takes back only the last press — its forced Dones get
 * `ItemDoneUndone`; the lines it did not add stay ready under a new alert (a new `ReadyToServe`), else
 * `ReadyToServeUndone`; the alert closes `undone`. Statements 3 (`pass_orders`, `handovers`, the latest
 * `ReadyToServe`), + `orders` and `currentTableOf` when it re-raises; + 01d's close and raise.
 */
function undoReadyToServe(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { alert_id: string } } {
  const now = ctx.clock.branchNow();
  const { order_id, point_id } = payload;
  const point = livePoint(point_id);
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

  const last = latestReady(ctx.tx.db, order_id, point_id);
  const live = (id: string): boolean => LIVE_STAGES.has(ctx.state.lines[id]?.stage ?? '') && pointOfLine(ctx.state, id) === point_id;
  const undone = (last?.forced_ids ?? [])
    .filter((id) => ctx.state.lines[id]?.stage === 'done' && live(id))
    .map((order_item_id): EventDraft => ({ stream_type: 'order', stream_id: order_id, event_type: 'ItemDoneUndone', schema_version: 1, payload: { order_item_id }, ...envelopeOf(ctx, now) }));
  const added = new Set(last?.added_ids ?? []);
  const rest = (last?.order_item_ids ?? []).filter((id) => !added.has(id) && live(id));
  const close = alerts.close(ctx, open.ready_alert_id, 'undone');
  if (rest.length === 0) {
    const p: ReadyToServeUndonePayload = { order_id, point_id, alert_id: open.ready_alert_id };
    return { events: [...undone, draft(ctx, order_id, 'ReadyToServeUndone', p, now), ...close], result: { alert_id: open.ready_alert_id } };
  }
  // the earlier lines stay ready: a new alert for them (the waiter is told again), as a Ready of its own
  const raised = raiseReady(ctx, { order_id, point_id, point_name: point.name, lines: rest, added: rest, forced: [], suffix: `:-${[...added][0] ?? ''}` }, now);
  return { events: [...undone, ...close, ...raised.events], result: { alert_id: raised.alert_id } };
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
