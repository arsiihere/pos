import { DomainError } from '@pos/domain';
import { isOrderInEngine } from '@pos/engine';
import type { EventDraft, ItemRemovedPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { withStockEffects } from '../../commands/set-precooked-stock.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { requireLock } from '../../tables/lock.js';
import type { LineView, OrderType } from '../contracts.js';
import { billedMinor, gmlDealPartPartial, liveUnits, planRemove } from '../ledger.js';
import { changeDrafts, type LineChange } from '../line-change.js';
import { zoneAlertDrafts } from '../zone-alerts.js';

// 02b §6.2 RemoveItems, §3.5 (stage 1, zone undo, drafts), §3.4 (units, deals, cascades, g/ml parts), §3.9 (stale comp
// requests), §3.3 (OrderFoodCleared), §3.10 (zone counts and alerts), §3.14 (scope). Not queueable (§3.12).
// Order of checks: payload (Zod, C6) → order (404) → billed → dine-in seating + requireLock (02a) → each entry in
// payload order (line of the order, zone rule before any engine stage, stage 1, units, g/ml parts) → scope last (C8).
// Statements: 1 order + lines (with the order's current seating and the zone counts of its zone lines), 1 seating /
// lock (requireLock, dine-in), 1 open comp requests (alerts.listOpen), +1 zone alerts (listOpen for zone:<id>) only
// when a zone line is in the payload (m-6); 01d's own bounds and the append excluded.

const Entry = z.object({ order_item_id: z.string().min(1), units: z.number().int().min(1).optional() });

export const RemoveItemsPayload = z.object({
  order_id: z.string().min(1),
  seating_id: z.string().min(1).optional(),
  lines: z
    .array(Entry)
    .min(1)
    .max(40)
    .superRefine((lines, rc) => {
      // C6: keyed entries; a repeated order_item_id → 400 at lines.N.order_item_id, N the repeat.
      const seen = new Set<string>();
      lines.forEach((l, i) => {
        if (seen.has(l.order_item_id)) rc.addIssue({ code: 'custom', path: [i, 'order_item_id'], message: 'duplicate order_item_id' });
        seen.add(l.order_item_id);
      });
    }),
});
type Payload = z.infer<typeof RemoveItemsPayload>;

interface OrderHead {
  order_id: string;
  order_type: OrderType;
  placed_by: string;
  billed_at: number | null;
  /** 02a seating_orders → seatings (read-only join, P-1c): the order's current seating */
  seating_id: string | null;
  primary_table_id: string | null;
  holder_staff_id: string | null;
}

type Line = LineView & { zone_on_hand: number | null };

// One statement: the order, its current seating (02a, P-1c) and its lines with the zone count of each zone line.
const READ = `SELECT o.order_id, o.order_type, o.placed_by, o.billed_at,
       so.seating_id, s.primary_table_id, s.holder_staff_id,
       l.order_item_id, l.parent_order_item_id, l.line_kind, l.item_id, l.deal_id, l.name, l.sale_unit, l.quantity,
       l.units, l.comped_units, l.removed_units, l.voided_units, l.returned_units, l.refundable_minor, l.comp_minor,
       l.comp_voided_minor, l.removed_minor, l.refund_minor, l.line_total_minor, l.return_of, l.served_from_zone_id,
       l.added_at, l.served_at, l.served_source, l.is_food, l.kitchen_note, zs.on_hand AS zone_on_hand
  FROM orders o
  LEFT JOIN seating_orders so ON so.order_id = o.order_id
  LEFT JOIN seatings s ON s.seating_id = so.seating_id
  LEFT JOIN order_lines l ON l.order_id = o.order_id
  LEFT JOIN zone_stock zs ON zs.zone_id = l.served_from_zone_id AND zs.item_id = l.item_id
 WHERE o.order_id = ?
 ORDER BY l.added_at, l.rowid`;

type Row = OrderHead & Omit<Line, 'order_id' | 'live_units' | 'billed_minor' | 'zone_served' | 'is_food' | 'order_item_id'> & { order_item_id: string | null; is_food: number };

function readOrder(ctx: CommandCtx, order_id: string): { order: OrderHead; lines: Line[] } {
  const rows = ctx.tx.db.prepare(READ).all(order_id) as Row[];
  const first = rows[0];
  if (first === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id });
  const { order_type, placed_by, billed_at, seating_id, primary_table_id, holder_staff_id } = first;
  const lines: Line[] = rows
    .filter((r): r is Row & { order_item_id: string } => r.order_item_id !== null)
    .map((r) => ({
      order_item_id: r.order_item_id,
      order_id,
      parent_order_item_id: r.parent_order_item_id,
      line_kind: r.line_kind,
      item_id: r.item_id,
      deal_id: r.deal_id,
      name: r.name,
      sale_unit: r.sale_unit,
      quantity: r.quantity,
      units: r.units,
      live_units: liveUnits(r),
      comped_units: r.comped_units,
      removed_units: r.removed_units,
      voided_units: r.voided_units,
      returned_units: r.returned_units,
      refundable_minor: r.refundable_minor,
      comp_minor: r.comp_minor,
      comp_voided_minor: r.comp_voided_minor,
      removed_minor: r.removed_minor,
      refund_minor: r.refund_minor,
      line_total_minor: r.line_total_minor,
      billed_minor: 0,
      return_of: r.return_of,
      served_from_zone_id: r.served_from_zone_id,
      zone_served: r.served_from_zone_id !== null,
      added_at: r.added_at,
      served_at: r.served_at,
      served_source: r.served_source,
      is_food: r.is_food === 1,
      kitchen_note: r.kitchen_note,
      zone_on_hand: r.zone_on_hand,
    }));
  // §3.4 billed_minor (the ledger's rule; a deal from its parts)
  for (const l of lines) l.billed_minor = billedMinor(l, l.line_kind === 'deal' ? lines.filter((p) => p.parent_order_item_id === l.order_item_id && p.line_kind === 'deal_part') : []);
  return { order: { order_id, order_type, placed_by, billed_at, seating_id, primary_table_id, holder_staff_id }, lines };
}

const invalid = (path: string, message: string): DomainError => new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
const wrongStage = (order_item_id: string, stage: string): DomainError => new DomainError('ITEM_WRONG_STAGE', { order_item_id, stage });

/** §3.4: an engine stage open before served (the g/ml part rule's "open in the engine"). */
const OPEN = new Set(['added', 'cooking', 'done']);

function removeItems(ctx: CommandCtx, p: Payload): { events: EventDraft[]; result: unknown } {
  const { order, lines } = readOrder(ctx, p.order_id);
  if (order.billed_at !== null) throw new DomainError('ORDER_BILLED', { order_id: order.order_id });

  // §3.1 / §6 common rules: dine-in carries seating_id (required) and follows 02a's TABLE_SEATING_CHANGED rule; the
  // table is the order's current one (02a seating_orders, as currentTableOf resolves it); requireLock (02a, AD-1).
  let lockDrafts: EventDraft[] = [];
  if (order.order_type === 'dine_in') {
    if (p.seating_id === undefined) throw invalid('seating_id', 'seating_id is required for a dine_in order');
    if (order.seating_id !== p.seating_id || order.primary_table_id === null) {
      throw new DomainError('TABLE_SEATING_CHANGED', { table_id: order.primary_table_id, seating_id: p.seating_id });
    }
    lockDrafts = requireLock(ctx.tx, { table_id: order.primary_table_id, seating_id: p.seating_id }, ctx);
  }

  const now = ctx.clock.branchNow();
  const state = ctx.state;
  const inEngine = isOrderInEngine(state, order.order_id, now);
  const undoMs = branchConfig()?.engine_settings.zone_undo_ms ?? 0;
  // §3.5 stage 1: the engine line at `added` (fired or not, O16); an order out of the engine → out_of_engine.
  const stageCheck = (l: Line): void => {
    if (!inEngine) throw wrongStage(l.order_item_id, 'out_of_engine');
    const engineLine = state.lines[l.order_item_id];
    if (engineLine === undefined) {
      if (l.served_at !== null) throw wrongStage(l.order_item_id, 'served'); // a line the engine never held
      return;
    }
    if (engineLine.stage !== 'added') throw wrongStage(l.order_item_id, engineLine.stage);
  };

  // Each entry against the lines as the earlier entries left them (a cascade is counted once).
  const work = new Map(lines.map((l) => [l.order_item_id, { ...l }]));
  const removed = new Map<string, number>(); // order_item_id → units, in first-touch order
  p.lines.forEach((entry, i) => {
    const line = work.get(entry.order_item_id);
    if (line === undefined) throw invalid(`lines.${i}.order_item_id`, 'not a line of this order');
    if (line.zone_served) {
      // §3.5 zone rule, before any engine-stage check: within zone_undo_ms of its ItemAdded (the command's check only).
      if (now - line.added_at > undoMs) throw wrongStage(line.order_item_id, 'served');
    } else if (line.line_kind !== 'deal') {
      stageCheck(line);
    }
    const n = entry.units ?? line.live_units;
    if (n < 1 || n > line.live_units) throw invalid(`lines.${i}.units`, 'units > live_units');
    // §3.4 cascade children: a deal's parts, an item's option children.
    const childKind = line.line_kind === 'deal' ? 'deal_part' : line.line_kind === 'item' ? 'option_child' : null;
    const children = childKind === null ? [] : [...work.values()].filter((c) => c.parent_order_item_id === line.order_item_id && c.line_kind === childKind);
    if (line.line_kind === 'deal' || line.line_kind === 'deal_part') {
      const parts = (line.line_kind === 'deal' ? children : [line]).map((part) => ({
        sale_unit: part.sale_unit,
        open_in_engine: OPEN.has(state.lines[part.order_item_id]?.stage ?? ''),
      }));
      if (gmlDealPartPartial({ line_kind: line.line_kind, live_units: line.live_units, units: n, parts })) {
        throw invalid(`lines.${i}.units`, 'gml_deal_part_partial');
      }
    }
    const plan = planRemove(line, children, n);
    for (const planned of plan.lines) {
      const touched = work.get(planned.order_item_id)!;
      // §3.4: removing deal units only when every part it touches is at stage 1; a cascaded child likewise.
      if (touched !== line) stageCheck(touched);
      Object.assign(touched, planned.after);
      touched.live_units = liveUnits(touched);
      removed.set(planned.order_item_id, (removed.get(planned.order_item_id) ?? 0) + planned.units);
    }
  });

  checkScope(ctx, order);

  const envelope = { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const changes: LineChange[] = [...removed].map(([order_item_id, units_out]) => ({ order_item_id, units_out }));
  const itemRemoved: EventDraft[] = changes.map((c) => {
    const payload: ItemRemovedPayload = { order_item_id: c.order_item_id, units: c.units_out };
    return { stream_type: 'order', stream_id: order.order_id, event_type: 'ItemRemoved', schema_version: 1, payload, ...envelope };
  });
  // §3.5 Drafts: ItemRemoved per line + stockEffects releasing that share (Q-4; array form across the command).
  const drafts = [...lockDrafts, ...withStockEffects(ctx, itemRemoved)];
  const after = changeDrafts(ctx, order.order_id, lines, changes);
  drafts.push(...after.drafts);

  // §3.10: a zone undo adds the units back to the zone count (the fold); the alerts follow the count (m-6).
  const zoneChanges = new Map<string, { zone_id: string; item_id: string; before: number; after: number }>();
  for (const c of changes) {
    const l = work.get(c.order_item_id)!;
    if (l.served_from_zone_id === null || l.item_id === null) continue;
    const key = `${l.served_from_zone_id}\u0000${l.item_id}`;
    const z = zoneChanges.get(key) ?? { zone_id: l.served_from_zone_id, item_id: l.item_id, before: l.zone_on_hand ?? 0, after: l.zone_on_hand ?? 0 };
    z.after += c.units_out;
    zoneChanges.set(key, z);
  }
  if (zoneChanges.size > 0) drafts.push(...zoneAlertDrafts(ctx, [...zoneChanges.values()]));

  return {
    events: drafts,
    result: {
      removed: changes.map((c) => ({ order_item_id: c.order_item_id, units: c.units_out })),
      cancelled: after.cancelled,
      comp_requests_closed: after.comp_requests_closed,
    },
  };
}

/**
 * §3.14 RemoveItems scope (C8, last), 0 statements. Dine-in: requireLock has passed (holder, or take-order-anywhere),
 * so `own_tables` is covered; `my_floors` → the current table's floor is one of the caller's; `branch` any.
 * Takeaway / parking: `own_tables` and `my_floors` = placed by the caller; `branch` any.
 */
function checkScope(ctx: CommandCtx, order: OrderHead): void {
  const staffId = ctx.actor.staffId;
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  let covered = false;
  if (staffId !== null && scope !== null) {
    if (scope === 'branch') covered = true;
    else if (order.order_type === 'dine_in') {
      if (scope === 'own_tables') covered = true;
      else if (scope === 'my_floors') {
        const floor = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === order.primary_table_id));
        covered = floor !== undefined && ctx.directory.floorsOf(staffId).includes(floor.floor_id);
      }
    } else if (scope === 'own_tables' || scope === 'my_floors') {
      covered = order.placed_by === staffId;
    }
  }
  if (!covered) {
    throw new DomainError(
      'PERMISSION_DENIED',
      order.order_type === 'dine_in' ? { reason: 'outside_scope', table_ids: [order.primary_table_id] } : { reason: 'outside_scope', order_id: order.order_id },
    );
  }
}

export const removeItemsCommand = defineCommand({
  commandType: 'RemoveItems',
  payloadSchema: RemoveItemsPayload,
  sessionKind: 'device',
  permission: 'take-order',
  handle: (ctx, payload) => removeItems(ctx, payload),
});

export function registerRemoveItems(app: FastifyInstance): void {
  commandRegistry(app).register(removeItemsCommand);
}
