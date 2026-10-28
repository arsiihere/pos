import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { itemAvailability } from '../projections/item-availability.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { defineCommand } from './registry.js';
import { commandRegistry } from './route.js';
import { requireItemsInScope } from './set-precooked-stock.js';

const Payload = z.object({ item_id: z.string().min(1), is_available: z.boolean() });

// §6.18, S17: one ItemMadeUnavailable / ItemMadeAvailable, or nothing when the item is already in that state.
// 01b B20: under `my_stations` the item must be routed to one of the person's stations.
export function registerSetItemAvailability(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SetItemAvailability',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx, payload) {
        const item = branchConfig()?.items.find((candidate) => candidate.item_id === payload.item_id);
        if (item === undefined) throw new DomainError('MENU_ITEM_NOT_FOUND', { item_id: payload.item_id });
        requireItemsInScope(ctx, [item]);
        const current = itemAvailability(ctx.tx.db, [payload.item_id]).get(payload.item_id);
        const changed = current !== payload.is_available;
        if (changed) {
          ctx.tx.append([
            {
              stream_type: 'stock',
              stream_id: payload.item_id,
              event_type: payload.is_available ? 'ItemMadeAvailable' : 'ItemMadeUnavailable',
              schema_version: 1,
              payload: { item_id: payload.item_id },
              occurred_at: ctx.clock.branchNow(),
              actor_id: ctx.actor.staffId,
              device_id: ctx.actor.deviceId,
            },
          ]);
        }
        return { events: [], result: { item_id: payload.item_id, is_available: payload.is_available, changed } };
      },
    }),
  );
}
