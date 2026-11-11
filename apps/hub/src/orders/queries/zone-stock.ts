import { DomainError } from '@pos/domain';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from '../../queries/registry.js';

// 02b v1.0.3 §6.17 GET /queries/zone-stock: any staff session reads every zone's counts (W-3, run 4 M-3; the
// permission `manage-zone-stock` gates only AddZoneStock / SetZoneStock). Zones, items and thresholds from the branch
// config (flat, not archived, floor then zone sort order); on_hand from `zone_stock` (an absent row is 0, §3.10).
// Statements: 1. An unknown or archived `zone_id` → 404 ZONE_NOT_FOUND (as §6.9), 0 statements.

export interface ZoneStockBody {
  zone_id: string;
  name: string;
  items: Array<{ item_id: string; name: string | null; on_hand: number; threshold: number }>;
}

export function zoneStockBody(db: Database.Database, config: BranchConfig | null, zone_id?: string): ZoneStockBody[] {
  const bySort = <T extends { sort_order: number }>(a: T, b: T) => a.sort_order - b.sort_order;
  const zones = [...(config?.floors ?? [])]
    .sort(bySort)
    // a floor without `zones` (a config older than snapshot V4) has none
    .flatMap((f) => [...((f.zones as BranchConfig['floors'][number]['zones'] | undefined) ?? [])].sort(bySort))
    .filter((z) => !z.is_archived && (zone_id === undefined || z.zone_id === zone_id));
  if (zone_id !== undefined && zones.length === 0) throw new DomainError('ZONE_NOT_FOUND', { zone_id });
  const rows = (
    zone_id === undefined
      ? db.prepare('SELECT zone_id, item_id, on_hand FROM zone_stock').all()
      : db.prepare('SELECT zone_id, item_id, on_hand FROM zone_stock WHERE zone_id = ?').all(zone_id)
  ) as Array<{ zone_id: string; item_id: string; on_hand: number }>;
  const onHand = new Map(rows.map((r) => [`${r.zone_id}\u0000${r.item_id}`, r.on_hand]));
  const names = new Map((config?.items ?? []).map((i) => [i.item_id, i.name]));
  return zones.map((z) => ({
    zone_id: z.zone_id,
    name: z.name,
    items: z.stock_items.map((s) => ({
      item_id: s.item_id,
      name: names.get(s.item_id) ?? null,
      on_hand: onHand.get(`${z.zone_id}\u0000${s.item_id}`) ?? 0,
      threshold: s.threshold,
    })),
  }));
}

export function registerZoneStockQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'zone-stock',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({ zone_id: z.string().min(1).optional() }),
      handle: (ctx, q) => ({ data: zoneStockBody(ctx.db, ctx.branchConfig, q.zone_id) }),
    }),
  );
}
