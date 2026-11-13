import type { Timers } from '../../../alerts/store';
import type { LiveBus } from '../../shell/live';
import type { MapStore, MapTile, TableMapBody, TablesApi } from '../contracts';

// 02a v1.1.6 §8 Table map (Q-5, Q-35), §6.17: the map is the catch-up `tables` part, then one debounced `table-map`
// read per trigger. No timer polls: a read happens only after a frame, a reconnect or a visible page.

/** The `table` stream (tables/audiences.ts) minus TableLockTouched, which changes no tile (Q-5). */
const TABLE_FRAMES: ReadonlySet<string> = new Set([
  'TableOpened',
  'TableLocked',
  'TableLockReleased',
  'TableHolderChanged',
  'TableMoved',
  'TablesMerged',
  'SeatingSplit',
  'BillRequested',
  'TableCleaned',
]);

/**
 * The order frames of orders/audiences.ts (ORDER_EVENT_TYPES, OrderContactSet, LineComped) minus the kitchen-progress
 * frames ItemStarted, ItemDone, ItemDoneUndone, FireDispatched and SlipWarned, which change no tile (Q-35; they are
 * not in the list at all). Zone stock frames are no order frames. `BillClosed` is listened for; 05 registers it (AD-25).
 */
const ORDER_FRAMES: ReadonlySet<string> = new Set([
  'OrderPlaced',
  'ItemAdded',
  'OrderLinesAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'ItemReturned',
  'ItemsReleased',
  'OrderBoosted',
  'OrderCancelled',
  'OrderFoodServed',
  'OrderFoodCleared',
  'OrdersBilled',
  'LineWeightSet',
  'OrderContactSet',
  'LineComped',
  'BillClosed',
]);

export const MAP_REFRESH_DEBOUNCE_MS = 250;

export interface MapStoreDeps {
  tables: Pick<TablesApi, 'tableMap'>;
  live: LiveBus;
  /** defaults to the global timers; tests pass a fake clock */
  timers?: Timers;
}

export function createMapStore(deps: MapStoreDeps): MapStore & { dispose(): void } {
  const timers: Timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const listeners = new Set<() => void>();
  let map = (deps.live.part('tables') as TableMapBody | undefined) ?? null;
  let timer: unknown = null;
  let reading = false;
  let follow = false;
  // seq of the last frame that triggers a read (Q-5/Q-35); a kitchen frame or a lock touch is no reason to drop a reply
  let lastTrigger = -1;
  let disposed = false;

  const changed = () => {
    for (const l of [...listeners]) l();
  };

  async function read(): Promise<void> {
    reading = true;
    const answer = await deps.tables.tableMap();
    reading = false;
    if (disposed) return;
    // a failed read keeps the last map; the next frame or reconnect asks again. A reply older than a read-triggering
    // frame seen meanwhile is dropped, and that frame's read follows (IR-6).
    if (answer.ok && answer.data.as_of_seq >= lastTrigger) {
      map = answer.data;
      changed();
    }
    if (follow) {
      follow = false;
      refresh();
    }
  }

  function refresh(): void {
    if (disposed) return;
    if (reading) {
      follow = true;
      return;
    }
    if (timer !== null) return;
    timer = timers.setTimeout(() => {
      timer = null;
      if (reading) {
        follow = true;
        return;
      }
      void read();
    }, MAP_REFRESH_DEBOUNCE_MS);
  }

  const off = deps.live.subscribe((message) => {
    switch (message.kind) {
      case 'catch_up': {
        const tables = message.state.tables as TableMapBody | undefined;
        if (tables !== undefined) {
          map = tables;
          changed();
        }
        break;
      }
      case 'event':
        if (TABLE_FRAMES.has(message.event.event_type) || ORDER_FRAMES.has(message.event.event_type)) {
          lastTrigger = message.seq;
          refresh();
        }
        break;
      case 'reconnect':
      case 'visible':
        refresh();
        break;
    }
  });

  return {
    current: () => map,
    tile(table_id): MapTile | null {
      for (const floor of map?.floors ?? []) {
        for (const zone of floor.zones) {
          const found = zone.tables.find((t) => t.table_id === table_id);
          if (found !== undefined) return found;
        }
      }
      return null;
    },
    refresh,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      off();
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      listeners.clear();
    },
  };
}

const shared = new WeakMap<LiveBus, ReturnType<typeof createMapStore>>();

/**
 * The page's one map store (per live bus): the map, the table sheet and the top bar read the same tiles and the same
 * debounced read. Lives as long as the page.
 */
export function sharedMapStore(tables: Pick<TablesApi, 'tableMap'>, live: LiveBus): MapStore {
  let store = shared.get(live);
  if (store === undefined) {
    store = createMapStore({ tables, live });
    shared.set(live, store);
  }
  return store;
}
