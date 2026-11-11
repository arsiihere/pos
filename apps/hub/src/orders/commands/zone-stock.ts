import { DomainError } from '@pos/domain';
import { availableStock, dayDraws, openDayStartMs } from '@pos/engine';
import type { EventDraft, StockTransferredOutPayload, ZoneStockAddedPayload, ZoneStockSetPayload } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineCommand, type CommandCtx } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { zoneAlertDrafts } from '../zone-alerts.js';

// 02b §6.9 AddZoneStock / §6.10 SetZoneStock (§3.10 Refill, Count, Alerts; §6.19 stream table / 'zone:' + zone_id, AD-6).
// `manage-zone-stock`, scope `my_zones` on the zone (01b B-3), staff session, D32, not queueable (§3.12).
// Check order (§6.9 errors, C8): ZONE_NOT_FOUND → ZONE_ITEM_NOT_CONFIGURED → refill: BUSINESS_DAY_NOT_OPEN →
// STOCK_INSUFFICIENT per draw → scope last. Statements: 2 (the zone_stock row; zoneAlertDrafts' one alerts.listOpen
// for subject zone:<id>) + 01d's raise / close + the append. The branch stock read is ctx.state (0 SQL).

const AddZoneStockPayload = z.object({
  zone_id: z.string().min(1),
  item_id: z.string().min(1),
  quantity: z.number().int().min(1).max(500),
});
const SetZoneStockPayload = z.object({
  zone_id: z.string().min(1),
  item_id: z.string().min(1),
  on_hand: z.number().int().min(0).max(5_000),
});

/** §3.10: the zone (flat, not archived, as build-submit reads it) and the item a stock item of it; else 404 / 422. */
function requireZoneItem(zone_id: string, item_id: string): void {
  const zone = (branchConfig()?.floors ?? []).flatMap((f) => f.zones).find((z) => z.zone_id === zone_id && !z.is_archived);
  if (zone === undefined) throw new DomainError('ZONE_NOT_FOUND', { zone_id });
  if (!zone.stock_items.some((s) => s.item_id === item_id)) throw new DomainError('ZONE_ITEM_NOT_CONFIGURED', { zone_id, item_id });
}

/** §6.9 scope `my_zones` (01b B-3: the person's zones or their lead's); `branch` covers every zone. Checked last (C8). */
function requireZoneInScope(ctx: CommandCtx, zone_id: string): void {
  const resolution = ctx.permission;
  if (resolution === null || !('scope' in resolution) || resolution.scope !== 'my_zones') return;
  const staffId = ctx.actor.staffId;
  if (staffId !== null && ctx.directory.zonesOf(staffId).includes(zone_id)) return;
  throw new DomainError('PERMISSION_DENIED', { permission: 'manage-zone-stock', reason: 'outside_scope', zone_ids: [zone_id] });
}

/** §3.10 Counts: the zone count before the command; an absent row is 0. 1 statement. */
function zoneCount(ctx: CommandCtx, zone_id: string, item_id: string): number {
  const row = ctx.tx.db.prepare('SELECT on_hand FROM zone_stock WHERE zone_id = ? AND item_id = ?').get(zone_id, item_id) as
    | { on_hand: number }
    | undefined;
  return row?.on_hand ?? 0;
}

/** §3.10 Refill: each day draw × quantity leaves branch stock (03a Q-5); short → 409 STOCK_INSUFFICIENT. Reads ctx.state. */
function transfersOf(ctx: CommandCtx, item_id: string, quantity: number): Array<{ stock_item_id: string; quantity: number }> {
  const config = branchConfig()!; // requireZoneItem found the zone in it
  const dayStartMs = openDayStartMs(ctx.state);
  if (dayStartMs === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
  const configStockUnits = Object.fromEntries(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit]));
  // An item gone from the menu still has its frozen day draws; with none frozen it draws nothing.
  const item = config.items.find((i) => i.item_id === item_id) ?? { item_id, sale_unit: 'piece' as const, stock_draws: [] };
  const transfers = dayDraws(ctx.state, item, configStockUnits).stock_draws.map((d) => ({
    stock_item_id: d.stock_item_id,
    quantity: d.quantity_per_sale_unit * quantity,
  }));
  const needed = new Map<string, number>();
  for (const t of transfers) {
    const need = (needed.get(t.stock_item_id) ?? 0) + t.quantity;
    needed.set(t.stock_item_id, need);
    const stockItem = config.stock_items.find((s) => s.stock_item_id === t.stock_item_id);
    const available = stockItem === undefined ? 0 : availableStock(ctx.state, t.stock_item_id, dayStartMs, stockItem);
    if (need > available) throw new DomainError('STOCK_INSUFFICIENT', { stock_item_id: t.stock_item_id, available });
  }
  return transfers;
}

function envelope(ctx: CommandCtx) {
  return { occurred_at: ctx.clock.branchNow(), actor_id: ctx.actor.staffId, device_id: ctx.actor.deviceId };
}

export const addZoneStockCommand = defineCommand({
  commandType: 'AddZoneStock',
  payloadSchema: AddZoneStockPayload,
  sessionKind: 'device',
  permission: 'manage-zone-stock',
  handle(ctx, { zone_id, item_id, quantity }) {
    requireZoneItem(zone_id, item_id);
    const transfers = transfersOf(ctx, item_id, quantity);
    requireZoneInScope(ctx, zone_id);
    const before = zoneCount(ctx, zone_id, item_id);
    const after = before + quantity;
    const env = envelope(ctx);
    const events: EventDraft[] = [
      ...transfers.map((t) => ({
        stream_type: 'stock' as const,
        stream_id: t.stock_item_id,
        event_type: 'StockTransferredOut',
        schema_version: 1,
        payload: { stock_item_id: t.stock_item_id, quantity: t.quantity, zone_id } satisfies StockTransferredOutPayload,
        ...env,
      })),
      {
        stream_type: 'table',
        stream_id: `zone:${zone_id}`,
        event_type: 'ZoneStockAdded',
        schema_version: 1,
        payload: { zone_id, item_id, quantity, transfers } satisfies ZoneStockAddedPayload,
        ...env,
      },
      ...zoneAlertDrafts(ctx, [{ zone_id, item_id, before, after }]),
    ];
    return { events, result: { on_hand: after } };
  },
});

export const setZoneStockCommand = defineCommand({
  commandType: 'SetZoneStock',
  payloadSchema: SetZoneStockPayload,
  sessionKind: 'device',
  permission: 'manage-zone-stock',
  handle(ctx, { zone_id, item_id, on_hand }) {
    requireZoneItem(zone_id, item_id);
    requireZoneInScope(ctx, zone_id);
    const previous = zoneCount(ctx, zone_id, item_id);
    // §3.10 Count leaves branch stock: no stock event (To 08).
    const events: EventDraft[] = [
      {
        stream_type: 'table',
        stream_id: `zone:${zone_id}`,
        event_type: 'ZoneStockSet',
        schema_version: 1,
        payload: { zone_id, item_id, on_hand, previous } satisfies ZoneStockSetPayload,
        ...envelope(ctx),
      },
      ...zoneAlertDrafts(ctx, [{ zone_id, item_id, before: previous, after: on_hand }]),
    ];
    return { events, result: { on_hand } };
  },
});

export function registerZoneStock(app: FastifyInstance): void {
  const registry = commandRegistry(app);
  registry.register(addZoneStockCommand);
  registry.register(setZoneStockCommand);
}
