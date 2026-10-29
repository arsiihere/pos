import { availableStock, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import { isStockTrackedV1 } from '@pos/events';
import type { Clock } from '../lib/clock.js';
import { hubTime } from '../lib/hub-time.js';
import { dayStockUnitOf, viewStockItem } from '../commands/set-precooked-stock.js';
import { branchConfig, currentConfigEntry } from '../sync/branch-config-holder.js';
import { branchConfigV2 } from '../sync/config-v2-view.js';
import { registerCatchUp, type SocketCtx } from './catch-up.js';

const staffOnly = (socket: SocketCtx) => socket.kind === 'staff';

// §4.5: the branch_config, availability and stock parts. Returns the unregister function.
export function registerRestaurantCatchUp(clock: Clock): () => void {
  const stops = [
    registerCatchUp({
      part: 'branch_config',
      appliesTo: () => true,
      // S47: hub_time rides with the version; the body is fetched with §6.23 only when the hash changed.
      build() {
        const entry = currentConfigEntry();
        if (entry === null) return null;
        return { config_version: entry.configVersion, snapshot_hash: entry.snapshotHash, hub_time: hubTime(clock) };
      },
    }),
    registerCatchUp({
      part: 'availability',
      appliesTo: staffOnly,
      build(db) {
        const ids = db
          .prepare('SELECT item_id FROM item_availability WHERE is_available = 0 ORDER BY item_id')
          .pluck()
          .all() as string[];
        return { unavailable_item_ids: ids };
      },
    }),
    registerCatchUp({
      part: 'stock',
      appliesTo: staffOnly,
      build(_db, raw) {
        const state = raw as EngineState;
        const config = branchConfig();
        const v2 = branchConfigV2();
        const start = openDayStartMs(state);
        const items: Record<string, unknown> = {};
        for (const item of config?.items ?? []) {
          if (config === null || !isStockTrackedV1(config, item)) continue;
          // 01c V5 through the view: the tracked item's stock item (same id, §5.1).
          const stockItem = viewStockItem(v2, item.item_id);
          const entry = stockOf(state, item.item_id);
          items[item.item_id] = {
            on_hand: entry.on_hand,
            reserved: entry.reserved,
            set_at: entry.set_at,
            unit: dayStockUnitOf(state, v2, item),
            available: availableStock(state, item.item_id, start, stockItem),
            level: stockLevel(state, item.item_id, start, stockItem),
          };
        }
        return { business_day: state.business_day, business_day_started_at: start, items };
      },
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
