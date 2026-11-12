import type { EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import { VOID_KIND, type PendingVoid } from './contracts.js';
import type { VoidValues } from './kind.js';
import { movableLine } from './plan.js';

// 04 §4.2 (task v8): `pendingVoids`, provided to contracts.ts by lanes/V2.ts (callers import it from contracts.ts).
// Lane V2 owns this file.

const PENDING = `SELECT alert_id, subject_stream_id AS order_id, requester_staff_id, raised_at, values_json
  FROM alerts
  WHERE kind = '${VOID_KIND}' AND state = 'open' AND subject_stream_type = 'order'
    AND subject_stream_id IN (SELECT value FROM json_each(?))
  ORDER BY raised_at, raised_seq`;

/**
 * §4.2: the open `void_approval` requests of `order_ids` (1 statement, `alerts_open_kind`), oldest first; the map holds
 * only orders that have one (05: `pendingVoids(...).size > 0`). Amounts and touched ids are the raise-time plan from
 * `values`. `blocked` (§6.4, OQ-D): with `state`, `'not_movable_stage'` when a stored `moved` line is no longer movable
 * (plan.ts `movableLine`, the same rule `apply` re-checks),
 * so an approve would be refused (0 statements, engine state in memory); without `state`, `null`.
 */
export function pendingVoids(db: Database.Database, order_ids: readonly string[], state?: EngineState): Map<string, PendingVoid[]> {
  const out = new Map<string, PendingVoid[]>();
  if (order_ids.length === 0) return out;
  const rows = db.prepare(PENDING).all(JSON.stringify(order_ids)) as Array<{ alert_id: string; order_id: string; requester_staff_id: string; raised_at: number; values_json: string }>;
  for (const r of rows) {
    const v = JSON.parse(r.values_json) as VoidValues;
    const stale = state !== undefined && Object.entries(v.line_dispositions).some(([id, d]) => d === 'moved' && !movableLine(state, id));
    const entry: PendingVoid = {
      alert_id: r.alert_id,
      order_item_id: v.order_item_id,
      units: v.units,
      touched_ids: v.touched_ids,
      refund_minor: v.refund_minor,
      comp_voided_minor: v.comp_voided_minor,
      requester_staff_id: r.requester_staff_id,
      raised_at: r.raised_at,
      blocked: stale ? 'not_movable_stage' : null,
    };
    const list = out.get(r.order_id);
    if (list === undefined) out.set(r.order_id, [entry]);
    else list.push(entry);
  }
  return out;
}
