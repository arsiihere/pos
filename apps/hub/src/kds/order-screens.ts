import type { EngineState } from '@pos/engine';
import type { HubDeps } from '../server.js';

// ⚠️ 03b v1.0.16 §3.5 step 4, §6.21 (run 3 verify R3-B-3): order_id → the 05a screen a counter device shows for the
// order (takeaway → `takeaway`, parking → `parking`; dine-in and delivery have none), for the `ready_to_serve` device
// filter, which reads only an alert's stored values. Memory, refreshed after every commit from the engine state; an
// order the engine drops stays one commit longer (as the KDS audiences' maps).

export type CounterScreen = 'takeaway' | 'parking';

const screens = new Map<string, CounterScreen>();
const gone = new Set<string>();

const isEngineState = (s: unknown): s is EngineState => typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).orders === 'object';

/** The order's counter screen, or null (dine-in, delivery, or an order never seen). Memory. */
export function counterScreenOfOrder(order_id: string): CounterScreen | null {
  return screens.get(order_id) ?? null;
}

/** Rebuilds the map from an engine state (the after-commit refresh; tests). */
export function refreshOrderScreens(state: unknown): void {
  if (!isEngineState(state)) return;
  for (const id of gone) if (state.orders[id] === undefined) screens.delete(id);
  gone.clear();
  for (const id of screens.keys()) if (state.orders[id] === undefined) gone.add(id);
  for (const id in state.orders) {
    const t = state.orders[id]!.order_type;
    if (t === 'takeaway' || t === 'parking') screens.set(id, t);
  }
}

/** Once per server (lane B6): load now, then refresh after every commit. */
export function registerOrderScreens(deps: Pick<HubDeps, 'state' | 'writer'>): void {
  refreshOrderScreens(deps.state.get());
  deps.writer.addAfterCommit(() => refreshOrderScreens(deps.state.get()));
}
