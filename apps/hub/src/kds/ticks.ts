// 03b §3.5 (Closing, Re-target), §6.18 tick `ready_retarget`, §6.19 tick `pass_closures`. Module-level TickDefs
// (02a `table_locks` pattern), registered once per process by lane B5's register file. Both need no hub deps: the db
// and the engine state come with each call, settings and names from branchConfig() (read per call, never captured).
// - due: the read-only pre-check, 2 statements (1 when no Ready is open: nothing to compare against).
// - intents: the same reads inside the tick's own writer.run (race rule: a Ready closed or re-targeted since the
//   pre-check is not selected), then ONE alerts.closeMany (+ ONE alerts.raiseMany for re-target) for the whole pass.
// - Envelope (01d §4.2 tickCtx): occurred_at = the pass's now, actor_id null, device_id 'hub'.
import { isOrderInEngine, type EngineState } from '@pos/engine';
import { HUB_ENGINE_SETTING_DEFAULTS, type EventDraft, type ReadyRetargetedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import { alerts, type RaiseInput } from '../alerts/raise.js';
import { cachedPrepare } from '../alerts/statements.js';
import type { TickDef } from '../alerts/tick.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { currentTableOf } from '../tables/reads.js';
import { identifierText } from './commands/ready.js';
import { tableLabel } from './details.js';
import { READY_TO_SERVE_KIND } from './kinds.js';

export const READY_RETARGET_TICK = 'ready_retarget';
export const PASS_CLOSURES_TICK = 'pass_closures';

// ------------------------------------------------------------------------------------------- §6.18 ready_retarget

/**
 * (1) open table Readies (`pass_orders_open`; no ORDER BY, so the partial index drives the read on a never-pruned
 * pass_orders). A Ready stored with no table (takeaway / parking: a person target) is never re-targeted. A Ready whose
 * alert day close has marked `expire_due` is left to expire: re-raising it would give a fresh alert no day close expires.
 */
export const OPEN_TABLE_READIES_SQL = `SELECT o.order_id AS order_id, o.point_id AS point_id, o.ready_alert_id AS ready_alert_id,
    o.ready_table_id AS ready_table_id
  FROM pass_orders o JOIN alerts a ON a.alert_id = o.ready_alert_id
  WHERE o.ready_alert_id IS NOT NULL AND o.ready_table_id IS NOT NULL AND a.expire_due = 0`;

interface TableReady {
  order_id: string;
  point_id: string;
  ready_alert_id: string;
  ready_table_id: string;
}

interface Moved extends TableReady {
  /** the order's current primary table, first of `table_ids` */
  table_ids: string[];
}

/** (1) + (2) `currentTableOf`: the open Readies whose stored table is not the order's current primary table. */
function movedReadies(db: Database.Database): Moved[] {
  const rows = cachedPrepare(db, OPEN_TABLE_READIES_SQL).all() as TableReady[];
  if (rows.length === 0) return [];
  const tables = currentTableOf(db, [...new Set(rows.map((r) => r.order_id))]);
  const moved: Moved[] = [];
  for (const r of rows) {
    const seating = tables.get(r.order_id);
    // no open seating row (cleaned, or never seated): nothing to follow
    if (seating === undefined || seating.primary_table_id === r.ready_table_id) continue;
    moved.push({ ...r, table_ids: [seating.primary_table_id, ...seating.table_ids.filter((t) => t !== seating.primary_table_id)] });
  }
  return moved;
}

/** §3.5 step 5 inputs for the new table, from memory: identifier (§3.1, 01d P-1 "T"), table_code, point_code. */
function retargetInput(r: Moved, window_ms: number): RaiseInput {
  const config = branchConfig();
  const names = new Map((config?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  const primary = r.table_ids[0]!;
  const primaryName = names.get(primary) ?? primary;
  const point = config?.points.find((p) => p.point_id === r.point_id);
  return {
    kind: READY_TO_SERVE_KIND,
    subject: { stream_type: 'order', stream_id: r.order_id },
    target: { kind: 'table_team', table_id: primary, depth: 'direct' },
    values: { order_id: r.order_id, point_id: r.point_id, table_id: primary, window_ms },
    display: { table_code: /^[0-9]+$/.test(primaryName) ? primaryName : null, point_code: point?.name ?? r.point_id, kind_label_key: 'alert.ready_to_serve' },
    details: { identifier: identifierText({ kind: 'table', label: r.table_ids.map((t) => tableLabel(names.get(t) ?? t)).join(' + ') }) },
    // §3.5 dedupe key with the new table: a move back to an earlier table raises a fresh alert (the old one is closed)
    dedupe_key: `${r.order_id}:${r.point_id}:${primary}`,
  };
}

export const readyRetargetTick: TickDef = {
  name: READY_RETARGET_TICK,
  due(db) {
    return movedReadies(db).length > 0;
  },
  intents(tx, _state, now) {
    const moved = movedReadies(tx.db);
    if (moved.length === 0) return []; // closed, undone or re-targeted since the pre-check
    const ctx = alerts.tickCtx(tx, now);
    const window_ms = branchConfig()?.engine_settings.ready_window_ms ?? HUB_ENGINE_SETTING_DEFAULTS.ready_window_ms;
    const closed = alerts.closeMany(
      ctx,
      moved.map((r) => ({ alert_id: r.ready_alert_id, reason: 'obsolete' as const })),
    );
    const raised = alerts.raiseMany(
      ctx,
      moved.map((r) => retargetInput(r, window_ms)),
    );
    const retargeted = moved.map((r, i): EventDraft => {
      const payload: ReadyRetargetedPayload = {
        order_id: r.order_id,
        point_id: r.point_id,
        table_id: r.table_ids[0]!,
        alert_id: raised[i]!.alert_id,
        previous_alert_id: r.ready_alert_id,
      };
      return { stream_type: 'order', stream_id: r.order_id, event_type: 'ReadyRetargeted', schema_version: 1, payload, occurred_at: now, actor_id: null, device_id: 'hub' };
    });
    // the pass fold: AlertClosed clears ready_alert_id, then ReadyRetargeted sets the new one (ready_at is kept)
    return [...closed, ...raised.flatMap((r) => r.events), ...retargeted];
  },
};

// ------------------------------------------------------------------------------------------- §6.19 pass_closures

/** (1) open Readies with whether one of their own `pass_ready_lines` is still unsettled (`pass_orders_open`; no ORDER BY). */
export const OPEN_READIES_SQL = `SELECT o.order_id AS order_id, o.ready_alert_id AS alert_id,
    EXISTS (SELECT 1 FROM pass_ready_lines l
             WHERE l.order_id = o.order_id AND l.point_id = o.point_id AND l.settled_at IS NULL) AS unsettled
  FROM pass_orders o WHERE o.ready_alert_id IS NOT NULL`;

/** (2) open Served cards whose hand-over has no unsettled line (`handovers_card_open`). */
export const SETTLED_CARDS_SQL = `SELECT served_card_alert_id AS alert_id FROM handovers
  WHERE served_card_alert_id IS NOT NULL AND card_closed_at IS NULL AND open_lines = 0`;

/**
 * §3.5 Closing: the alert ids to close `done` — a Ready whose own lines are all settled, or whose order has left the
 * engine at `now` (memory), and a Served card at open_lines = 0. 2 statements.
 */
function closable(db: Database.Database, state: Readonly<EngineState>, now: number): string[] {
  const readies = cachedPrepare(db, OPEN_READIES_SQL).all() as Array<{ order_id: string; alert_id: string; unsettled: 0 | 1 }>;
  const cards = cachedPrepare(db, SETTLED_CARDS_SQL).all() as Array<{ alert_id: string }>;
  const ids = readies.filter((r) => r.unsettled === 0 || !isOrderInEngine(state as EngineState, r.order_id, now)).map((r) => r.alert_id);
  for (const c of cards) ids.push(c.alert_id);
  return ids;
}

export const passClosuresTick: TickDef = {
  name: PASS_CLOSURES_TICK,
  due(db, state, now) {
    return closable(db, state, now).length > 0;
  },
  intents(tx, state, now) {
    const ids = closable(tx.db, state, now);
    if (ids.length === 0) return [];
    return alerts.closeMany(
      alerts.tickCtx(tx, now),
      ids.map((alert_id) => ({ alert_id, reason: 'done' as const })),
    );
  },
};
