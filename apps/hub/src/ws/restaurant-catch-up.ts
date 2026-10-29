import { availableStock, dayStockUnit, openDayStartMs, stockLevel, stockOf, type EngineState } from '@pos/engine';
import type { Clock } from '../lib/clock.js';
import { hubTime } from '../lib/hub-time.js';
import { branchConfig, currentConfigEntry } from '../sync/branch-config-holder.js';
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
      // 01c A7 (§4.2, §6.21): `items` keyed by stock_item_id, one per stock item counted here; `business_day` is
      // the engine BusinessDay (with the frozen stock_units and draws).
      build(_db, raw) {
        const state = raw as EngineState;
        const start = openDayStartMs(state);
        const items: Record<string, unknown> = {};
        for (const stockItem of branchConfig()?.stock_items ?? []) {
          const entry = stockOf(state, stockItem.stock_item_id);
          items[stockItem.stock_item_id] = {
            on_hand: entry.on_hand,
            reserved: entry.reserved,
            set_at: entry.set_at,
            unit: dayStockUnit(state, stockItem),
            available: availableStock(state, stockItem.stock_item_id, start, stockItem),
            level: stockLevel(state, stockItem.stock_item_id, start, stockItem),
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
