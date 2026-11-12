// 02b §3.5 Drafts / Export, §3.9 Stale requests, §3.3 (P-1d): what follows when units of an order's lines leave billing
// (RemoveItems here; 04's voids through `lineChangeDrafts`, To 04). In §3.5 order: the stale comp-request closes, then
// OrderFoodCleared (the order keeps a live line but no live unserved food line) or OrderCancelled (no live line left).
// AD-9: the caller's CommandCtx, so the closes carry the caller's actor and device.
import type { EventDraft, OrderCancelledPayload } from '@pos/events';
import { alerts, type CloseItem } from '../alerts/raise.js';
import type { CommandCtx } from '../commands/registry.js';
import type { LineChangeDrafts, LineChangeOptions, LineView } from './contracts.js';
import { orderLines } from './exports.js';
import { foodDrafts } from './food.js';
import { liveUnits, removeUnits } from './ledger.js';

/** One line's units leaving billing (a removal or a void; cascaded parts and children are their own entries). */
export interface LineChange {
  order_item_id: string;
  units_out: number;
}

/** §3.9: the comp request kind (defined in orders/comp-kind.ts, §6.12); a string here, as zone-alerts.ts does. */
export const COMP_KIND = 'comp';

/**
 * §3.9 Stale requests, the one rule: every open `comp:<order_item_id>` request of the order whose line is left with
 * `live_units − comped_units` (`freeOf`) < its requested units closes `obsolete` with a note; 01d tells the requester.
 * `freeOf` returns undefined for a line the caller's write does not judge (that request is skipped).
 * 1 statement: `alerts.listOpen({ kind: 'comp', subject: order })` (+ closeMany's own when a request closes).
 */
export function staleCompCloses(
  ctx: CommandCtx,
  order_id: string,
  freeOf: (order_item_id: string) => number | undefined,
): { drafts: EventDraft[]; closed: string[] } {
  const closes: CloseItem[] = [];
  for (const a of alerts.listOpen(ctx.tx.db, { kind: COMP_KIND, subject: { stream_type: 'order', stream_id: order_id } })) {
    const values = a.values as { order_item_id?: unknown; units?: unknown };
    if (typeof values.order_item_id !== 'string' || typeof values.units !== 'number') continue;
    const free = freeOf(values.order_item_id);
    if (free !== undefined && free < values.units) {
      closes.push({ alert_id: a.alert_id, reason: 'obsolete', note: `stale: ${values.order_item_id} has ${free} of ${values.units} units left to comp` });
    }
  }
  return { drafts: closes.length === 0 ? [] : alerts.closeMany(ctx, closes), closed: closes.map((c) => c.alert_id) };
}

/**
 * §3.4: a line after `units_out` of its live units leave billing, by the ledger's own rule (`removeUnits`: uncomped
 * units first, then comped ones). Remove and void move the same units out of `live` and `comped`, so the after state
 * used here (live_units, comped_units) is the same for a void (04).
 */
function afterChange(l: LineView, units_out: number): LineView {
  if (units_out === 0) return l;
  const after = { ...l, ...removeUnits(l, units_out).after };
  return { ...after, live_units: liveUnits(after) };
}

/** The order's lines as they are after `changes` (several entries of one line add up). */
export function linesAfter(before: readonly LineView[], changes: readonly LineChange[]): LineView[] {
  const out = new Map<string, number>();
  for (const c of changes) out.set(c.order_item_id, (out.get(c.order_item_id) ?? 0) + c.units_out);
  return before.map((l) => afterChange(l, out.get(l.order_item_id) ?? 0));
}

/**
 * The shared core of RemoveItems and `lineChangeDrafts`, given the order's lines BEFORE the change (the caller read
 * them). 1 statement: `alerts.listOpen({ kind: 'comp', subject: order })` (+ closeMany's own when a request closes);
 * 0 with `stale_comps: 'keep'`. §3.9 (⚠️ 04 row Q-4; G-15): only open requests on a line in `changes` are judged
 * (`freeOf` → undefined for any other id); such a request whose line is left with `live_units − comped_units` < its
 * requested units closes `obsolete` with a note; 01d tells the requester. `'keep'` judges none and skips
 * `staleCompCloses` (04's void `apply`, K-1). §3.4 deal headers: "no live line" looks at parts only.
 */
export function changeDrafts(
  ctx: CommandCtx,
  order_id: string,
  before: readonly LineView[],
  changes: readonly LineChange[],
  opts: LineChangeOptions = { stale_comps: 'close' },
): { drafts: EventDraft[]; cancelled: boolean; comp_requests_closed: string[] } {
  const after = linesAfter(before, changes);
  const byId = new Map(after.map((l) => [l.order_item_id, l]));
  const changed = new Set(changes.map((c) => c.order_item_id));
  // A changed id the order no longer has counts as 0 free (closed); an unchanged line is not judged.
  const stale =
    opts.stale_comps === 'keep'
      ? { drafts: [], closed: [] }
      : staleCompCloses(ctx, order_id, (id) => {
          if (!changed.has(id)) return undefined;
          const line = byId.get(id);
          return line === undefined ? 0 : line.live_units - line.comped_units;
        });
  const drafts: EventDraft[] = stale.drafts;
  const envelope = { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const cancelled = !after.some((l) => l.line_kind !== 'deal' && l.live_units > 0);
  if (cancelled) {
    const payload: OrderCancelledPayload = { order_id };
    drafts.push({ stream_type: 'order', stream_id: order_id, event_type: 'OrderCancelled', schema_version: 1, payload, ...envelope });
  } else {
    // AD-10: foodDrafts has no envelope; the caller adds it.
    for (const d of foodDrafts(order_id, after, 'change')) drafts.push({ ...d, ...envelope });
  }
  return { drafts, cancelled, comp_requests_closed: stale.closed };
}

/**
 * §3.5 Export (To 04): OrderCancelled (if the order is emptied), OrderFoodCleared { food_served } and the stale
 * comp-request closes of the changed lines for units leaving billing in the caller's transaction (`ctx.tx`, AD-9).
 * `changes` lists every line whose units leave (cascaded parts and children included, as their own events do); the
 * lines are read as they are before the change. 2 statements: the order's lines (`orderLines`), `alerts.listOpen` for
 * the order; `opts.stale_comps: 'keep'` (04 row Q-4) skips the comp read and closes none: 1 statement.
 */
export const lineChangeDrafts: LineChangeDrafts = (ctx, order_id, changes, opts) =>
  changeDrafts(ctx, order_id, orderLines(ctx.tx.db, [order_id]).get(order_id) ?? [], changes, opts).drafts;
