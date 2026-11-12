// 03b §3.5 Handover (steps 1–8), §6.8 (Statements 4). `run-pass` (a station session is refused by the route). Not
// queueable. Receiver scope = 02b's pure `orderCovered` (G-3, P0.14) on `resolve(receiver, 'mark-served')`, which must
// be `allowed` (P0.F: a requires_approval right is not a receiver), and the receiver signed in (owner ruling B4-3 (a));
// else 422 PASS_RECEIVER_INVALID.
import { DomainError } from '@pos/domain';
import type { EventDraft, HandoverPayload, ReadyToServePayload } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import type { CurrentTableOf } from '../../engine-host/slip-readers.js';
import { orderCovered, type ScopedOrder } from '../../orders/commands/mark-served.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { currentTableOf } from '../../tables/reads.js';
import { pointOfLine, tableLabel } from '../details.js';
import { SERVED_CARD_KIND } from '../kinds.js';
import { handedOver, identifierText, livePoint, requireInEngine } from './ready.js';

/** Lines of one hand-over (03b §6.8 / the Handover event: 1–40; owner ruling B4-2 (a)). */
const HANDOVER_MAX = 40;

export const HandoverCommandPayload = z.object({
  order_id: z.string().min(1),
  point_id: z.string().min(1),
  receiver_staff_id: z.string().min(1),
  order_item_ids: z.array(z.string().min(1)).min(1).max(HANDOVER_MAX).optional(),
});
type Payload = z.infer<typeof HandoverCommandPayload>;

/** Engine stages that are settled (§3.5 Closing: served, removed, voided, returned). */
const SETTLED = new Set(['served', 'removed', 'voided', 'returned']);

// ------------------------------------------------------------------------------------------- shared reads (b15)

type OrderType = ScopedOrder['order_type'];

interface PassOrderRow extends ScopedOrder {
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: 'sedan' | 'mini' | 'large' | null;
  /** JSON object order_item_id → added_at of the order's lines (B4-2 line order) */
  line_added: string;
}

/**
 * 1 statement: 02b's `scopedOrders` row (order type, placed_by, the open seating's holder; same joins as
 * `orders/commands/mark-served.ts` scopedOrders) plus the identifier columns of `orders` and the order's lines'
 * `added_at` (B4-2 line order), for `order_ids`.
 */
export function passScopedOrders(db: Database.Database, order_ids: readonly string[]): Map<string, PassOrderRow> {
  const rows = db
    .prepare(
      `SELECT o.order_id AS order_id, o.order_type AS order_type, o.placed_by AS placed_by, s.holder_staff_id AS holder_staff_id,
              o.business_date AS business_date, o.token AS token, o.car_number AS car_number, o.car_type AS car_type,
              (SELECT json_group_object(l.order_item_id, l.added_at) FROM order_lines l WHERE l.order_id = o.order_id) AS line_added
         FROM (SELECT DISTINCT value FROM json_each(?)) j
         JOIN orders o ON o.order_id = j.value
         LEFT JOIN seating_orders so ON so.order_id = o.order_id
         LEFT JOIN seatings s ON s.seating_id = so.seating_id AND s.state <> 'CLOSED'`,
    )
    .all(JSON.stringify(order_ids)) as PassOrderRow[];
  return new Map(rows.map((r) => [r.order_id, r]));
}

/** §3.1 identifier text, primary table and §3.5 table_code of one order (memory; `tables` read by the caller). */
export function passIdentity(
  state: CommandCtx['state'],
  row: PassOrderRow,
  tables: ReturnType<CurrentTableOf> | null,
): { table_id: string | null; table_code: string | null; identifier: string } {
  const type: OrderType = row.order_type;
  if (type === 'takeaway') {
    const today = state.business_day?.business_date ?? null;
    return { table_id: null, table_code: null, identifier: identifierText({ kind: 'token', token: row.token ?? 0, date: row.business_date === today ? null : row.business_date }) };
  }
  if (type === 'parking') {
    return { table_id: null, table_code: null, identifier: identifierText({ kind: 'parking', car_number: row.car_number ?? '', car_type: row.car_type ?? 'sedan' }) };
  }
  const seating = tables?.get(row.order_id);
  const ids =
    seating === undefined
      ? [state.orders[row.order_id]?.table_id].filter((t): t is string => typeof t === 'string')
      : [seating.primary_table_id, ...seating.table_ids.filter((t) => t !== seating.primary_table_id)];
  const names = new Map((branchConfig()?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  const primary = ids[0] ?? null;
  const primaryName = primary === null ? null : (names.get(primary) ?? primary);
  return {
    table_id: primary,
    table_code: primaryName !== null && /^[0-9]+$/.test(primaryName) ? primaryName : null,
    identifier: identifierText({ kind: 'table', label: ids.map((t) => tableLabel(names.get(t) ?? t)).join(' + ') }),
  };
}

/**
 * §3.5 step 2 (G-3, P0.F): `staffId` may receive order `o` iff known to the directory, `mark-served` is `allowed`
 * (not requires_approval) and 02b's `orderCovered` covers the order. 0 statements.
 */
export function receiverCovers(directory: StaffDirectory, staffId: string, o: ScopedOrder, tables: ReturnType<CurrentTableOf> | null): boolean {
  if (directory.get(staffId) === undefined) return false;
  const resolution = directory.resolve(staffId, 'mark-served');
  if (resolution.grant !== 'allowed') return false;
  return orderCovered(o, { staffId, resolution }, tables, (id) => directory.floorsOf(id));
}

// ------------------------------------------------------------------------------------------- §6.8

interface OpenReadyRow {
  ready_alert_id: string | null;
  /** JSON array of the open Ready's unsettled own lines */
  lines: string;
}

/**
 * §3.5 Handover. Statements 5 dine-in / 4 otherwise (owner ruling B4-3 (a)): the scoped order row (`passScopedOrders`),
 * `currentTableOf` for a dine-in, the receiver's open staff session, `pass_orders` + `pass_ready_lines` (one read),
 * `handover_lines`; + 01d's raise / close.
 */
function handover(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { handover_id: string; served_card_alert_id: string; remaining: number } } {
  const now = ctx.clock.branchNow();
  const { order_id, point_id, receiver_staff_id } = payload;
  livePoint(point_id);
  requireInEngine(ctx, order_id, now);

  // §3.5 step 2: the receiver (C8 order: after existence, before lines)
  const order = passScopedOrders(ctx.tx.db, [order_id]).get(order_id);
  if (order === undefined) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id });
  const tables = order.order_type === 'dine_in' ? currentTableOf(ctx.tx.db, [order_id]) : null;
  // owner ruling B4-3 (a): the receiver must also be signed in (an open staff session), 1 statement
  if (!receiverCovers(ctx.directory, receiver_staff_id, order, tables) || !signedIn(ctx.tx.db, receiver_staff_id)) {
    throw new DomainError('PASS_RECEIVER_INVALID', { receiver_staff_id });
  }

  // the open Ready of (order, point) and its unsettled own lines (1 statement)
  const ready = ctx.tx.db
    .prepare(
      `SELECT p.ready_alert_id AS ready_alert_id,
              (SELECT json_group_array(r.order_item_id) FROM pass_ready_lines r
                WHERE r.order_id = p.order_id AND r.point_id = p.point_id AND r.settled_at IS NULL) AS lines
         FROM pass_orders p WHERE p.order_id = ? AND p.point_id = ? AND p.ready_alert_id IS NOT NULL`,
    )
    .get(order_id, point_id) as OpenReadyRow | undefined;
  const readyLines = ready === undefined ? [] : (JSON.parse(ready.lines) as string[]);

  // §3.5 step 3: the lines (named, or every done line at this point not handed over)
  const engineOrder = ctx.state.orders[order_id];
  const atPoint = (engineOrder?.line_ids ?? []).filter((id) => ctx.state.lines[id] !== undefined && pointOfLine(ctx.state, id) === point_id);
  const named = payload.order_item_ids === undefined ? null : [...new Set(payload.order_item_ids)];
  const handed = handedOverOf(ctx.tx.db, [...new Set([...atPoint, ...(named ?? []), ...readyLines])]);
  let lines: string[];
  if (named !== null) {
    for (const id of named) {
      const line = ctx.state.lines[id];
      const stage =
        line === undefined || line.order_id !== order_id
          ? 'not_in_order'
          : pointOfLine(ctx.state, id) !== point_id
            ? 'other_point'
            : handed.has(id)
              ? 'handed_over'
              : line.stage;
      if (stage !== 'done') throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: id, stage });
    }
    lines = named;
  } else {
    // owner ruling B4-2 (a): the done, not handed-over lines at this point in line order (added_at, order_item_id),
    // at most HANDOVER_MAX (the event's 1–40)
    const added = JSON.parse(order.line_added) as Record<string, number>;
    const due = atPoint
      .filter((id) => ctx.state.lines[id]!.stage === 'done' && !handed.has(id))
      .sort((a, b) => (added[a] ?? 0) - (added[b] ?? 0) || (a < b ? -1 : a > b ? 1 : 0));
    if (due.length === 0) throw new DomainError('ITEM_WRONG_STAGE', { order_id, stage: 'not_done' });
    lines = due.slice(0, HANDOVER_MAX);
  }
  // B4-2: done lines at this point still not handed over after this hand-over
  const taken = new Set(lines);
  const remaining = atPoint.filter((id) => ctx.state.lines[id]!.stage === 'done' && !handed.has(id) && !taken.has(id)).length;

  const identity = passIdentity(ctx.state, order, tables);
  const handover_id = ctx.ids.next(); // §3.5 step 4 (retries dedupe by D32 command_id)
  const events: EventDraft[] = [];
  const env = { stream_type: 'order' as const, stream_id: order_id, schema_version: 1, occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };

  // §3.5 step 5: no open Ready → a Ready with no alert first (its own lines are the handed lines)
  if (ready === undefined) {
    const p: ReadyToServePayload = { order_id, point_id, order_item_ids: lines, table_id: identity.table_id, alert_id: null };
    events.push({ ...env, event_type: 'ReadyToServe', payload: p });
  }

  // §3.5 step 6: the Served card to the receiver
  const raised = alerts.raise(ctx, {
    kind: SERVED_CARD_KIND,
    subject: { stream_type: 'order', stream_id: order_id },
    target: { kind: 'person', staff_id: receiver_staff_id },
    values: { handover_id, order_id },
    display: { table_code: identity.table_code, kind_label_key: 'alert.served_card' },
    details: { identifier: identity.identifier },
    dedupe_key: handover_id,
  });
  events.push(...raised.events);

  // §3.5 step 7: no Ready line left un-handed and unserved → close the open Ready `done`
  let ready_alert_closed: string | null = null;
  if (ready?.ready_alert_id != null) {
    const now_handed = new Set(lines);
    const left = readyLines.filter((id) => {
      const line = ctx.state.lines[id];
      return line !== undefined && !SETTLED.has(line.stage) && !handed.has(id) && !now_handed.has(id);
    });
    if (left.length === 0) {
      events.push(...alerts.close(ctx, ready.ready_alert_id, 'done'));
      ready_alert_closed = ready.ready_alert_id;
    }
  }

  // §3.5 step 8
  const p: HandoverPayload = { handover_id, order_id, point_id, receiver_staff_id, order_item_ids: lines, alert_id: raised.alert_id, ready_alert_closed };
  events.push({ ...env, event_type: 'Handover', payload: p });
  return { events, result: { handover_id, served_card_alert_id: raised.alert_id, remaining } };
}

/** 1 statement: which of `ids` are in a hand-over (b14's read; no statement for an empty list). */
function handedOverOf(db: Database.Database, ids: readonly string[]): Set<string> {
  return ids.length === 0 ? new Set() : handedOver(db, ids);
}

/** Owner ruling B4-3 (a): `staffId` has an open staff session (signed in). 1 statement. */
function signedIn(db: Database.Database, staffId: string): boolean {
  return db.prepare(`SELECT 1 FROM staff_sessions WHERE staff_id = ? AND kind = 'staff' AND ended_at IS NULL LIMIT 1`).get(staffId) !== undefined;
}

export const handoverCommand = defineCommand({
  commandType: 'Handover',
  payloadSchema: HandoverCommandPayload,
  sessionKind: 'device',
  permission: 'run-pass',
  handle: (ctx, payload) => handover(ctx, payload),
});

export function registerHandoverCommand(app: FastifyInstance): void {
  commandRegistry(app).register(handoverCommand);
}
