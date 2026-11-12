import type Database from 'better-sqlite3';
import type { MergeGuard } from '../tables/contracts.js';
import { VOID_KIND, type VoidDayCloseGuard, type VoidLineGuard } from './contracts.js';

// 04 §6.6 (task v8): the three void locks, each 1 statement on `alerts_open_kind` (kind, raised_at) WHERE state = 'open'
// (the literal `state = 'open'` lets SQLite use the partial index). A void request = an open `void_approval` alert whose
// subject is its order; its locked lines are `values.touched_ids` (§3.1). Registered at boot by lanes/V2.ts.
// Lane V2 owns this file.

const OPEN = `kind = '${VOID_KIND}' AND state = 'open' AND subject_stream_type = 'order'`;

const BY_ORDERS = `SELECT values_json FROM alerts
  WHERE ${OPEN} AND subject_stream_id IN (SELECT value FROM json_each(?))
  ORDER BY raised_at, raised_seq`;

const BY_SEATINGS = `SELECT values_json FROM alerts
  WHERE ${OPEN} AND subject_stream_id IN (
    SELECT order_id FROM seating_orders WHERE seating_id IN (SELECT value FROM json_each(?)))
  ORDER BY raised_at, raised_seq`;

/**
 * §6.6 merge guard (02a §3.11 / §3.12): open void requests whose order is in `order_ids` when given (split: only the
 * orders that move, H6-7), else in the seatings (merge, via `seating_orders`) → blocked with their touched ids (in
 * request order, de-duplicated). 1 statement.
 */
export const mergeGuard: MergeGuard = (db, q) => {
  const rows = (q.order_ids === undefined ? db.prepare(BY_SEATINGS).all(JSON.stringify(q.seating_ids)) : db.prepare(BY_ORDERS).all(JSON.stringify(q.order_ids))) as Array<{
    values_json: string;
  }>;
  const ids = new Set<string>();
  for (const r of rows) for (const id of (JSON.parse(r.values_json) as { touched_ids: string[] }).touched_ids) ids.add(id);
  return { blocked: ids.size > 0, order_item_ids: [...ids] };
};

const LINE = `SELECT a.alert_id AS alert_id, g.value AS order_item_id
  FROM alerts a, json_each(a.values_json, '$.touched_ids') t, json_each(?) g
  WHERE a.kind = '${VOID_KIND}' AND a.state = 'open' AND a.subject_stream_type = 'order' AND a.subject_stream_id = ? AND t.value = g.value
  ORDER BY g.key, a.raised_at, a.raised_seq
  LIMIT 1`;

/**
 * §6.6 / 02b row Q-3 line guard: the open void request of the order whose touched ids meet `touched_ids` →
 * `{ alert_id, order_item_id }` with the first given id that is locked (as VoidItems' own rule 6 (b) reports it), else
 * null. 1 statement. Never asked by the void `apply` (H1-1: its own request is the lock).
 */
export const lineGuard: VoidLineGuard = (db, order_id, touched_ids) => {
  const hit = db.prepare(LINE).get(JSON.stringify(touched_ids), order_id) as { alert_id: string; order_item_id: string } | undefined;
  return hit === undefined ? null : { alert_id: hit.alert_id, order_item_id: hit.order_item_id };
};

/** §9: at most this many requests listed in `DAY_CLOSE_BLOCKED`; `count` is all open ones. */
export const DAY_CLOSE_LISTED = 40;

const DAY = `SELECT alert_id, json_extract(details_json, '$.identifier') AS identifier, json_extract(details_json, '$.item') AS item,
       json_extract(display_json, '$.requester_name') AS requester_name, COUNT(*) OVER () AS count
  FROM alerts
  WHERE kind = '${VOID_KIND}' AND state = 'open'
  ORDER BY raised_at, raised_seq
  LIMIT ${DAY_CLOSE_LISTED}`;

/**
 * Row A-1 (01a v2.5 §6.18b, 04 §9): any open void request → `409 DAY_CLOSE_BLOCKED { reason: 'void_pending', voids:
 * [{ alert_id, identifier, item, requester_name }] (oldest first, ≤ 40), count }`, `count` from the same statement
 * (`COUNT(*) OVER ()`, taken before the LIMIT). 1 statement. Names and the identifier come from the request's stored
 * `display` / `details` (as raised).
 */
export const dayCloseGuard: VoidDayCloseGuard = (db: Database.Database) => {
  const rows = db.prepare(DAY).all() as Array<{ alert_id: string; identifier: string | null; item: string | null; requester_name: string | null; count: number }>;
  if (rows.length === 0) return null;
  return {
    code: 'DAY_CLOSE_BLOCKED',
    details: {
      reason: 'void_pending',
      voids: rows.map((r) => ({ alert_id: r.alert_id, identifier: r.identifier, item: r.item, requester_name: r.requester_name })),
      count: rows[0]!.count,
    },
  };
};
