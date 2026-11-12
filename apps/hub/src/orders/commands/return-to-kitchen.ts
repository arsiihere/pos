// 02b §6.7 ReturnToKitchen, §3.8 (E-4 order_header, E-7 30-min exit), §3.3 (non-food return), §3.4 (return lines),
// §3.14 (scope "as MarkServed"); 03a v1.2 §3.8a. Not queueable (§3.12). No lock. 02b v1.0.8 / 03a v1.2.3 (owner
// 2026-11-11, B3-4): the return line copies the plain options and the live station-less option children.
import { DomainError } from '@pos/domain';
import { isOrderInEngine, planOrder, type EngineState, type ProposedLine, type ProposedOrder } from '@pos/engine';
import {
  ItemAddedPayload,
  type EventDraft,
  type ItemReturnedPayload,
  type OrderLinesAddedHeader,
  type OrderLinesAddedPayload,
} from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import type { LineView, OrderType } from '../contracts.js';
import { orderLines } from '../exports.js';
import { foodDrafts } from '../food.js';
import { checkOrderScope, scopedOrders, type ScopedOrder } from './mark-served.js';

export const ReturnToKitchenPayload = z.object({
  order_item_id: z.string().min(1),
  /** device-minted id of the new return line (O3) */
  return_order_item_id: z.string().min(1),
  mode: z.enum(['fix', 'remake']),
});
type Payload = z.infer<typeof ReturnToKitchenPayload>;

interface LineCopy {
  /** the line's order (null: no such line) */
  order_id: string | null;
  /** the line's first ItemAdded on its own order stream (the D25 copy, 03a AD-8) */
  copy: string | null;
  /** return_order_item_id already names a line */
  in_use: number;
}

/**
 * One statement: the line's order and its ItemAdded copy (the engine and `order_lines` keep no full D25 copy; as
 * engine-host `readLineFacts`, only the row on the line's own order stream, the first by seq), plus the §6.7
 * `return_order_item_id` id check against `order_lines` (O3).
 */
function lineCopy(db: Database.Database, order_item_id: string, return_order_item_id: string): LineCopy {
  return db
    .prepare(
      `SELECT l.order_id AS order_id,
              (SELECT e.payload FROM events e
                WHERE e.stream_type = 'order' AND e.stream_id = l.order_id AND e.event_type = 'ItemAdded'
                  AND json_extract(e.payload, '$.order_item_id') = l.order_item_id
                ORDER BY e.seq LIMIT 1) AS copy,
              EXISTS (SELECT 1 FROM order_lines r WHERE r.order_item_id = ?) AS in_use
         FROM (SELECT 1) one
         LEFT JOIN order_lines l ON l.order_item_id = ?`,
    )
    .get(return_order_item_id, order_item_id) as LineCopy;
}

/** A live option child of the served line: its first ItemAdded on the order stream (as `lineCopy`). */
interface ChildCopy {
  copy: string | null;
}

/**
 * 02b v1.0.8 §6.7 (B3-4): one statement, the served line's live option children (`order_lines WHERE
 * parent_order_item_id = ?`, live units > 0) in their order (added_at, rowid, as 03b buildLineDetails), each with its
 * ItemAdded copy (order_lines keeps no option_id, option_quantity or station).
 */
function optionChildren(db: Database.Database, order_id: string, order_item_id: string): ItemAddedPayload[] {
  const rows = db
    .prepare(
      `SELECT (SELECT e.payload FROM events e
                WHERE e.stream_type = 'order' AND e.stream_id = c.order_id AND e.event_type = 'ItemAdded'
                  AND json_extract(e.payload, '$.order_item_id') = c.order_item_id
                ORDER BY e.seq LIMIT 1) AS copy
         FROM order_lines c
        WHERE c.order_id = ? AND c.parent_order_item_id = ? AND c.line_kind = 'option_child'
          AND c.units - c.removed_units - c.voided_units > 0
        ORDER BY c.added_at, c.rowid`,
    )
    .all(order_id, order_item_id) as ChildCopy[];
  // Broken-invariant guard, as for the served line: every order_lines row is folded from an ItemAdded on its stream.
  return rows.map((r) => {
    if (r.copy === null) throw new Error(`ReturnToKitchen: no ItemAdded for an option child of ${order_item_id}`);
    return ItemAddedPayload.parse(JSON.parse(r.copy));
  });
}

/**
 * 02b v1.0.8 §3.8 / 03a v1.2.3 §3.8a (owner 2026-11-11, B3-4): the return line's options = the served line's live
 * option children with no station (their own lines when stationed, so not copied), each as a plain option entry
 * (`option_id`, the option's `modifier_group_id` from config, `name`, `quantity` = `option_quantity`), then the served
 * line's plain options; every `price_minor` / `charge_minor` 0. Children first, as the served line's KDS row and ticket
 * list them (03b §4.4, 03c §3.3). Display data only: the engine ignores options.
 */
function returnOptions(copy: ItemAddedPayload, children: readonly ItemAddedPayload[]): ItemAddedPayload['options'] {
  const groups = new Map((branchConfig()?.modifier_groups ?? []).flatMap((g) => g.options.map((o) => [o.option_id, g.modifier_group_id] as const)));
  const fromChildren = children
    .filter((c) => c.station_id === null && c.option_id !== null)
    .map((c) => ({
      option_id: c.option_id!,
      modifier_group_id: groups.get(c.option_id!) ?? '',
      name: c.name,
      price_minor: 0,
      quantity: c.option_quantity ?? 1,
      charge_minor: 0,
    }));
  return [...fromChildren, ...copy.options.map((o) => ({ ...o, price_minor: 0, charge_minor: 0 }))];
}

/**
 * §3.8 checks in the spec's order, each → 409 with nothing appended: removed / voided (task 17's stages); zone-served
 * (the zone rule before any engine check, as §3.5); the order out of the engine (abandon, or 30 min after its last
 * serve, E-7) → ORDER_NOT_IN_ENGINE; not served → ITEM_WRONG_STAGE { stage: the engine stage, or 'not_engine_line'
 * for a line the engine does not hold on an order still in it, e.g. a deal header (owner S-2e, AD-35) }; already remade
 * (`returned_units > 0`) → { stage: 'returned' }; an open return (a live unserved line with `return_of` = it) →
 * RETURN_ALREADY_OPEN.
 */
function checkReturnable(state: EngineState, now: number, line: LineView, lines: readonly LineView[]): void {
  const id = line.order_item_id;
  const stage = (s: string): never => {
    throw new DomainError('ITEM_WRONG_STAGE', { order_item_id: id, stage: s });
  };
  if (line.live_units === 0) stage(line.voided_units > 0 ? 'voided' : 'removed');
  if (line.zone_served) stage('zone_served');
  if (!isOrderInEngine(state, line.order_id, now)) throw new DomainError('ORDER_NOT_IN_ENGINE', { order_id: line.order_id });
  const engineLine = state.lines[id];
  if (line.served_at === null) stage(engineLine?.stage ?? 'not_engine_line');
  if (line.returned_units > 0) stage('returned');
  const open = lines.find((l) => l.return_of === id && l.live_units > 0 && l.served_at === null);
  if (open !== undefined) throw new DomainError('RETURN_ALREADY_OPEN', { order_item_id: id, return_order_item_id: open.order_item_id });
  // 03a §3.8a: the engine takes a return only of a line it holds as served (a deal header is never an engine line).
  if (engineLine?.stage !== 'served') stage(engineLine?.stage ?? 'not_engine_line');
}

/**
 * §3.14 "as MarkServed" (C8, last), from the EngineOrder the in-engine check holds: order type and placed_by (the
 * envelope actor_id of its OrderPlaced, as `orders.placed_by`). The holder is read (`scopedOrders`, 1 statement)
 * only where the scope needs it (own_tables on a dine-in); my_floors reads `currentTableOf` inside checkOrderScope.
 */
function checkScope(ctx: CommandCtx, order_id: string, order: EngineState['orders'][string]): void {
  const scope = ctx.permission !== null && 'scope' in ctx.permission ? ctx.permission.scope : null;
  const scoped: ScopedOrder | undefined =
    scope === 'own_tables' && order.order_type === 'dine_in'
      ? scopedOrders(ctx.tx.db, [order_id]).get(order_id)
      : { order_id, order_type: order.order_type as OrderType, placed_by: order.placed_by ?? '', holder_staff_id: null };
  if (scoped === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id });
  checkOrderScope(ctx, [scoped]);
}

/**
 * §3.8 / §6.7. Statements: 1 the line's order + ItemAdded copy + the `return_order_item_id` id check (`lineCopy`),
 * 1 the order's lines (`orderLines`), + the holder (own_tables dine-in) or `currentTableOf` (my_floors dine-in),
 * + 1 the served line's option children (`optionChildren`, v1.0.8 B3-4): 3–4. The E-4 header comes from EngineState, no statement. Batch: `OrderLinesAdded` (one return line, planOrder
 * groups and lines, `order_header`) → its `ItemAdded` (the copy except money and links, `return_of`, AD-15) →
 * `ItemReturned` (remake) → `OrderFoodCleared` (a non-food return leaving no live unserved food line, §3.3).
 */
function returnToKitchen(ctx: CommandCtx, payload: Payload): { events: EventDraft[]; result: { eta_ms: number; promise_ms: number } } {
  const db = ctx.tx.db;
  const now = ctx.clock.branchNow();
  const state = ctx.state;
  const id = payload.order_item_id;
  const replacement = payload.return_order_item_id;

  const found = lineCopy(db, id, replacement);
  // O3 (§3.2 step 3): an id in order_lines or live in EngineState.
  if (found.in_use === 1 || state.lines[replacement] !== undefined) throw new DomainError('ORDER_ITEM_ID_IN_USE', { order_item_id: replacement });
  if (found.order_id === null) throw new DomainError('ORDER_NOT_FOUND', { order_item_id: id });
  const order_id = found.order_id;
  const lines = orderLines(db, [order_id]).get(order_id)!;
  const line = lines.find((l) => l.order_item_id === id)!;
  checkReturnable(state, now, line, lines);
  const order = state.orders[order_id]!;
  // Broken-invariant guard, not a client error: every order_lines row is folded from an ItemAdded on its order stream.
  if (found.copy === null) throw new Error(`ReturnToKitchen: no ItemAdded for ${id} on ${order_id}`);
  const copy = ItemAddedPayload.parse(JSON.parse(found.copy));

  // 01a A-11: a fix cooks for the item's adjust_time_ms (config), copied into the event (03a §3.8a, D25).
  let cook_ms_override: number | null = null;
  if (payload.mode === 'fix') {
    const item = branchConfig()?.items.find((i) => i.item_id === copy.item_id);
    if (item === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: copy.item_id });
    cook_ms_override = item.adjust_time_ms;
  }

  checkScope(ctx, order_id, order);
  const options = returnOptions(copy, optionChildren(db, order_id, id));

  // 03a §3.8a (G4-1 #11, G4-2 #18): the served line's copy except money (0 / null) and links (a plain `item` line,
  // options as `returnOptions` (v1.2.3, B3-4), quantity copied); no stock draw; `return_of` = the returned line (AD-15).
  const { return_of: _ignored, ...base } = copy;
  void _ignored;
  const added: ItemAddedPayload = {
    ...base,
    order_item_id: replacement,
    parent_order_item_id: null,
    line_kind: 'item',
    deal_id: null,
    deal_part_id: null,
    option_id: null,
    option_quantity: null,
    price_minor: 0,
    extra_price_minor: null,
    allocated_price_minor: null,
    tax_class_id: null,
    options,
    line_total_minor: 0,
    stock_draws: [],
    served_from_zone_id: null,
    return_of: id,
  };
  // The engine knobs and station of the served line as the engine holds it (03a §3.8a: its station, alternates allowed).
  const served = state.lines[id]!;
  const proposedLine: ProposedLine = {
    ...added,
    station_id: served.station_id,
    alternates: served.alternates.map((a) => ({ ...a })),
    point_id: served.point_id,
    carry_ms: served.carry_ms,
    weight_pct: served.weight_pct,
    max_early_ms: served.max_early_ms,
    max_late_ms: served.max_late_ms,
    max_carry_ms: served.max_carry_ms,
    cook_ms_override,
    return_of: { order_item_id: id, mode: payload.mode },
  };
  const header: OrderLinesAddedHeader = {
    order_type: order.order_type,
    table_key: order.table_key,
    table_id: order.table_id,
    follow_up: order.follow_up,
    pickup_at_ms: order.pickup_at_ms,
    placed_by: order.placed_by,
  };
  const proposed: ProposedOrder = {
    order_id,
    order: { order_type: header.order_type, table_id: header.table_id, table_key: header.table_key, follow_up: header.follow_up, pickup_at_ms: header.pickup_at_ms },
    lines: [proposedLine],
  };
  const plan = planOrder(state, proposed, now, { [replacement]: false });
  const planned = plan.lines[0]!;
  const linesAdded: OrderLinesAddedPayload = {
    order_id,
    order_item_ids: [replacement],
    groups: plan.groups,
    lines: [
      {
        order_item_id: replacement,
        station_id: planned.station_id,
        alternates: planned.alternates,
        point_id: planned.point_id,
        carry_ms: planned.carry_ms,
        from_stock: planned.from_stock,
        weight_pct: proposedLine.weight_pct,
        max_early_ms: proposedLine.max_early_ms,
        max_late_ms: proposedLine.max_late_ms,
        max_carry_ms: proposedLine.max_carry_ms,
        return_of: proposedLine.return_of,
        cook_ms_override,
      },
    ],
    order_header: header,
  };

  // §3.3: the order's lines after the change, with the replacement (folded only after the append): live, unserved,
  // food as the returned line.
  const units = added.sale_unit !== 'piece' || added.quantity === null ? 1 : added.quantity;
  const replacementView: LineView = {
    ...line,
    order_item_id: replacement,
    parent_order_item_id: null,
    line_kind: 'item',
    deal_id: null,
    units,
    live_units: units,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 0,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 0,
    billed_minor: 0,
    return_of: id,
    served_from_zone_id: null,
    zone_served: false,
    added_at: now,
    served_at: null,
    served_source: null,
  };
  const after = [...lines.map((l) => (l.order_item_id === id && payload.mode === 'remake' ? { ...l, returned_units: l.live_units } : l)), replacementView];

  const envelope = { occurred_at: now, actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
  const on = (event_type: string, p: object): EventDraft => ({
    stream_type: 'order',
    stream_id: order_id,
    event_type,
    schema_version: 1,
    payload: p as Record<string, unknown>,
    ...envelope,
  });
  const returned: ItemReturnedPayload = { order_item_id: id, mode: 'remake', replacement_order_item_id: replacement };
  const events: EventDraft[] = [
    on('OrderLinesAdded', linesAdded),
    on('ItemAdded', added),
    ...(payload.mode === 'remake' ? [on('ItemReturned', returned)] : []),
    ...foodDrafts(order_id, after, 'return').map((d): EventDraft => ({ ...d, ...envelope })),
  ];
  return { events, result: { eta_ms: planned.eta_ms, promise_ms: plan.groups[0]!.promise_ms } };
}

export const returnToKitchenCommand = defineCommand({
  commandType: 'ReturnToKitchen',
  payloadSchema: ReturnToKitchenPayload,
  sessionKind: 'device',
  permission: 'mark-item-returned',
  handle: (ctx, payload) => returnToKitchen(ctx, payload),
});

export function registerReturnToKitchen(app: FastifyInstance): void {
  commandRegistry(app).register(returnToKitchenCommand);
}
