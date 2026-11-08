import { goesWith, planRelease, type EngineState, type GoesWithLine } from '@pos/engine';
import { AlertDetailsBase, type EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { defineAlertKind } from '../alerts/kinds.js';
import { branchConfig } from '../sync/branch-config-holder.js';

// 03a §6.4: the three kinds 03a registers, at module load (index.ts imports this file statically, so the kinds exist
// before boot replays the `alerts` projection, 01d §3.5 / P-8). §3.8 slip_warning, §3.10 station_overload, AD-8
// engine_line_dropped.

/** The kinds the `fires_alerts` tick raises (§3.8, §3.10, AD-8). */
export const ENGINE_ALERT_KINDS = {
  slip: 'slip_warning',
  overload: 'station_overload',
  lineDropped: 'engine_line_dropped',
} as const;

const MIN = 60_000;

// ------------------------------------------------------------------------------------------- slip_warning (§3.8)

/** §3.8 `values_schema { table_key, order_ids, escalate_ms }`; step 1 is at `values.escalate_ms`. */
export const SlipWarningValues = z.object({
  table_key: z.string().min(1),
  order_ids: z.array(z.string().min(1)).min(1),
  escalate_ms: z.number().int().min(0),
});
export type SlipWarningValues = z.infer<typeof SlipWarningValues>;

/** §3.8 `details_schema { minutes_late, lines: [{ name, quantity, state }] }`: picked and required from 01d v1.1.2 D-1. */
export const SlipWarningDetails = AlertDetailsBase.pick({ minutes_late: true, lines: true }).required();
export type SlipWarningDetails = z.infer<typeof SlipWarningDetails>;

/** One line's ItemAdded facts the engine state does not keep: its card name and its goes-with keys. */
export interface LineFacts extends GoesWithLine {
  name: string;
}

/**
 * The ItemAdded facts of the given orders' lines: ONE statement (events_stream index), whatever the number of orders.
 * proposed (implementer): the engine state keeps no line name, item_id or category_id, so the slip's card name
 * (§3.8 `details`) and the accept's goes-with pre-ticks (AD-22: "ItemAdded.item_id / category_id") read them from the
 * order streams. A line refused by the engine (AD-8) may have a second ItemAdded under another order: only the row on
 * the line's own order stream counts, the first by seq.
 */
export function readLineFacts(db: Database.Database, state: EngineState, order_ids: readonly string[]): Map<string, LineFacts> {
  const rows = db
    .prepare(
      `SELECT stream_id, json_extract(payload, '$.order_item_id') AS order_item_id, json_extract(payload, '$.name') AS name,
              json_extract(payload, '$.item_id') AS item_id,
              json_extract(payload, '$.category_id') AS category_id
       FROM events
       WHERE stream_type = 'order' AND event_type = 'ItemAdded' AND stream_id IN (SELECT value FROM json_each(?))
       ORDER BY seq`,
    )
    .all(JSON.stringify([...new Set(order_ids)])) as Array<{
    stream_id: string;
    order_item_id: string;
    name: string;
    item_id: string | null;
    category_id: string;
  }>;
  const out = new Map<string, LineFacts>();
  for (const r of rows) {
    if (out.has(r.order_item_id) || state.lines[r.order_item_id]?.order_id !== r.stream_id) continue;
    out.set(r.order_item_id, { name: r.name, item_id: r.item_id, category_id: r.category_id });
  }
  return out;
}

// AD-8: a listed line not yet filled by its ItemAdded is not a line (as the engine's isPlaceholder).
const isPlaceholder = (l: EngineState['lines'][string]): boolean => l.units === 0 && l.fire_ms === null && l.booked === null;

/** The open sync lines of the orders (the slip's groups), in order_ids then line_ids order. */
function syncLines(state: EngineState, order_ids: readonly string[]): Array<EngineState['lines'][string]> {
  const out: Array<EngineState['lines'][string]> = [];
  for (const order_id of new Set(order_ids)) {
    for (const id of state.orders[order_id]?.line_ids ?? []) {
      const l = state.lines[id];
      if (l === undefined || isPlaceholder(l) || l.serve_mode !== 'sync') continue;
      if (l.stage === 'added' || l.stage === 'cooking' || l.stage === 'done') out.push(l);
    }
  }
  return out;
}

/**
 * §3.8 the slip card's `details`.
 * - minutes_late: owner ruling AD-37 (3), against the engine target; folded into §3.8 at task 29. The estimate (the
 *   predicted land from the engine's current plan, getAlertIntents) minus the target T, whole minutes rounded up,
 *   never below 0; never `now`, never the promise. The card reads "≈ N min late".
 * - proposed (implementer): lines = the slip orders' sync lines that are not served or gone (their groups), each with its ItemAdded name, its
 *   engine `units` as `quantity` (lineUnits: the piece count, 1 for a g / ml or pending-weight line, lowered by a
 *   partial void, BF-12; always ≥ 1 on a filled line; review I3) and its engine stage (`added`, `cooking`, `done`) as
 *   `state`.
 */
export function slipDetails(
  state: EngineState,
  slip: { order_ids: readonly string[]; estimate: number; target: number },
  facts: ReadonlyMap<string, LineFacts>,
): SlipWarningDetails {
  return {
    minutes_late: Math.max(0, Math.ceil((slip.estimate - slip.target) / MIN)),
    lines: syncLines(state, slip.order_ids).map((l) => {
      const f = facts.get(l.order_item_id);
      return { name: f?.name || l.order_item_id, quantity: l.units, state: l.stage };
    }),
  };
}

/**
 * §3.8 / AD-22: the D12 pre-ticks: every open sync line of the orders that goes with a released (`done`) line of
 * them. No goes-with link configured → none, and no statement. proposed (implementer): released and candidate
 * lines are taken across every order of the slip (one table key, one card), as planRelease takes them.
 */
function preTicks(db: Database.Database, state: EngineState, order_ids: readonly string[]): string[] {
  const links = branchConfig()?.goes_with ?? [];
  if (links.length === 0) return [];
  const lines = syncLines(state, order_ids);
  const released = lines.filter((l) => l.stage === 'done');
  const open = lines.filter((l) => l.stage !== 'done');
  if (released.length === 0 || open.length === 0) return [];
  const facts = readLineFacts(db, state, order_ids);
  const ticked: string[] = [];
  for (const b of open) {
    const fb = facts.get(b.order_item_id);
    if (fb === undefined) continue;
    if (released.some((a) => {
      const fa = facts.get(a.order_item_id);
      return fa !== undefined && goesWith(fa, fb, links);
    })) ticked.push(b.order_item_id);
  }
  return ticked;
}

export const SLIP_WARNING = defineAlertKind<SlipWarningValues, SlipWarningDetails>({
  kind: ENGINE_ALERT_KINDS.slip,
  family: 'action',
  subject: 'order', // the oldest order of the group (§3.8, §3.12)
  steps: [
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'answerer' }] },
    // E4-SLIP AC3: at values.escalate_ms (= slip_escalate_ms) the managers are told
    { at: { value: 'escalate_ms', times: 1 }, escalation: true, to: [{ target: 'raised_target', set: 'answerer' }, { target: { kind: 'managers' }, set: 'informed' }] },
  ],
  closes_on: 'owner',
  values_schema: SlipWarningValues,
  details_schema: SlipWarningDetails,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  // "Send what's ready" / "Wait" are the client's answer texts for this kind (01d: accept kinds use the kind's labels)
  labels: { card: 'alert.slip_warning.card', lock: 'alert.slip_warning.lock' },
  request: {
    answers: ['accept', 'decline'],
    right: { mode: 'named' },
    needs_pin: 'never',
    // §3.8: read-only (01d §3.5). accept → one ItemsReleased per order with work, carrying this alert's id; decline → [].
    apply(ctx, answer) {
      if (answer.decision !== 'accept') return [];
      const state = ctx.state as EngineState;
      const order_ids = ctx.alert.values.order_ids;
      const expedite = preTicks(ctx.tx.db, state, order_ids);
      return planRelease(state, order_ids, { expedite }).map(
        (d): EventDraft => ({
          stream_type: d.stream_type,
          stream_id: d.stream_id,
          event_type: d.event_type,
          schema_version: d.schema_version,
          payload: { ...d.payload, alert_id: ctx.alert.alert_id },
          occurred_at: answer.answered_at,
          actor_id: answer.answerer_staff_id,
          device_id: answer.device_id,
        }),
      );
    },
  },
});

// -------------------------------------------------------------------------------------- station_overload (§3.10)

/** §3.10 `values { station_id, pressure_bp, waiting }`; card "{station} {pressure} % · {waiting} orders waiting". */
export const StationOverloadValues = z.object({
  station_id: z.string().min(1),
  pressure_bp: z.number().int().min(0),
  waiting: z.number().int().min(0),
});
export type StationOverloadValues = z.infer<typeof StationOverloadValues>;

export const STATION_OVERLOAD = defineAlertKind<StationOverloadValues>({
  kind: ENGINE_ALERT_KINDS.overload,
  family: 'info', // §12.3 Q6: a plain info kind
  subject: 'station',
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: StationOverloadValues,
  details_schema: null,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.station_overload.card', lock: 'alert.station_overload.lock' },
  request: null,
});

// ---------------------------------------------------------------------------------------- engine_line_dropped (AD-8)

/** AD-8 developer condition: `values { order_id, order_item_id, reason }`. */
export const EngineLineDroppedValues = z.object({
  order_id: z.string().min(1),
  order_item_id: z.string().min(1),
  reason: z.string().min(1),
});
export type EngineLineDroppedValues = z.infer<typeof EngineLineDroppedValues>;

// AD-8: an `info` alert to managers. proposed (implementer): `closes_on: 'owner'` like station_overload (a seen does
// not close it; 03a writes no close, so day close expires it), no lead fallback (managers are a branch set).
export const ENGINE_LINE_DROPPED = defineAlertKind<EngineLineDroppedValues>({
  kind: ENGINE_ALERT_KINDS.lineDropped,
  family: 'info',
  subject: 'order',
  steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: EngineLineDroppedValues,
  details_schema: null,
  lead_fallback: false,
  expires_at_day_close: true,
  silent: false,
  labels: { card: 'alert.engine_line_dropped.card', lock: 'alert.engine_line_dropped.lock' },
  request: null,
});
