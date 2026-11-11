// 02b §3.7 "Estimated Served", §6.11 tick `served_estimate` (⚠️ Changed by 03b v1.0.1 G-2: written by 03b task 0e over
// 03b's `handoversDue`, 03b §4.3). A module-level TickDef (02a `table_locks` pattern), registered once per process by
// registerOrders.
// - Setting `served_estimate_ms` read per call from branchConfig() (never captured); null (or no config) = off: not due.
// - due: `handoversDue(db, now, served_estimate_ms)` non-empty (03b §4.2, 2 statements; 1 when nothing is due).
// - intents: the same read inside the tick's own writer.run (race rule: a line served, removed, voided, returned or
//   cancelled since the pre-check is settled and no longer listed), then `orderLines` (1) for those orders, then
//   `servedDrafts(…, 'estimated')`: per order ItemServed { source: 'estimated' } → OrderFoodServed when it serves a food
//   line → its stockEffects. Only the hand-overs' UNSETTLED lines are served; a line already served (any source) or
//   with no live units is left out. An order that has left the engine is served with no stockEffects (02b O16).
// - Envelope: occurred_at = the pass's now, actor_id null, device_id 'hub'. No served_at (the serve is the estimate).
import { isOrderInEngine, type EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { TickDef } from '../alerts/tick.js';
import { handoversDue } from '../kds/contracts.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { servedDrafts, type ServeEntry } from './commands/mark-served.js';
import { orderLines } from './exports.js';

export const SERVED_ESTIMATE_TICK = 'served_estimate';

/** The setting, or null when off (null in the snapshot, or no config applied). */
function estimateMs(): number | null {
  return branchConfig()?.engine_settings.served_estimate_ms ?? null;
}

/** Due hand-overs' unsettled lines grouped per order, orders in the order handoversDue returned them. */
function dueByOrder(db: Database.Database, now: number, ms: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const h of handoversDue(db, now, ms)) {
    const ids = out.get(h.order_id) ?? [];
    for (const id of h.order_item_ids) if (!ids.includes(id)) ids.push(id);
    out.set(h.order_id, ids);
  }
  return out;
}

export const servedEstimateTick: TickDef = {
  name: SERVED_ESTIMATE_TICK,
  due(db, _state, now) {
    const ms = estimateMs();
    return ms !== null && handoversDue(db, now, ms).length > 0;
  },
  intents(tx, state, now) {
    const ms = estimateMs();
    if (ms === null) return [];
    const due = dueByOrder(tx.db, now, ms);
    if (due.size === 0) return []; // settled since the pre-check
    const lines = orderLines(tx.db, [...due.keys()]);
    const serves: ServeEntry[] = [];
    for (const [order_id, wanted] of due) {
      const byId = new Map((lines.get(order_id) ?? []).map((l) => [l.order_item_id, l]));
      const ids = wanted.filter((id) => {
        const l = byId.get(id);
        return l !== undefined && l.served_at === null && l.live_units > 0 && l.line_kind !== 'deal';
      });
      if (ids.length > 0) serves.push({ order_id, ids, inEngine: isOrderInEngine(state as EngineState, order_id, now) });
    }
    if (serves.length === 0) return [];
    const drafts: EventDraft[] = servedDrafts(state as EngineState, lines, serves, { occurred_at: now, actor_id: null, device_id: 'hub' }, 'estimated');
    return drafts;
  },
};
