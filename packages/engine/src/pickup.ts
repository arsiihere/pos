// 03a §3.5.1 step 5 (D6, D3) and §3.5.8 PK-2 (⚠️ Changed by v1.2.12, owner 2026-11-28, QA BUG-5).
import type { EngineState } from './state.js';

type OrderType = 'dine_in' | 'takeaway' | 'delivery' | 'parking';

// §3.5.1 step 5 (D6, D3): padding = the station's promise_padding_ms ?? the branch's per order type; 0 on a FIFO
// or EDF station. A group takes the max over its stations. Exported (BR-1, owner 2026-11-27) for 03c customerReadyAt.
export function paddingOf(state: EngineState, station_id: string, order_type: OrderType): number {
  const config = state.config;
  if (config === null) return 0;
  const station = config.stations.find((s) => s.station_id === station_id);
  if (station !== undefined && station.policy !== 'waada_guard') return 0;
  return station?.promise_padding_ms ?? config.settings[`promise_padding_${order_type}_ms`];
}

// PK-2 (owner 2026-11-28): for a pickup order the kitchen targets p − padding, so the promise (T + padding) is the
// pickup itself when the kitchen can make it: T_L = max(p − padding, land). A line on `station_id` (immediate, held,
// FIFO-placed) takes that station's padding. Reading (v1.2.12): a pickup order is a takeaway with a pickup (02b R4,
// the only order type 02b lets carry one); a delivery's `pickup_at_ms` is the rider's pickup (D3), still a land floor.
const customerPickup = (order_type: OrderType): boolean => order_type === 'takeaway';
export function pickupLand(state: EngineState, pickup: number | null, station_id: string, order_type: OrderType): number | null {
  if (pickup === null || !customerPickup(order_type)) return pickup;
  return pickup - paddingOf(state, station_id, order_type);
}

// A sync group's floor: p − the max padding over its lines' stations (the group's padding, §3.5.1 step 5).
export function pickupGroupLand(state: EngineState, pickup: number | null, station_ids: readonly string[], order_type: OrderType): number | null {
  if (pickup === null || !customerPickup(order_type)) return pickup;
  const pad = station_ids.length === 0 ? 0 : Math.max(...station_ids.map((s) => paddingOf(state, s, order_type)));
  return pickup - pad;
}
