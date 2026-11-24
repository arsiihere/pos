import type { EngineLine, EngineOrder, EngineState } from '@pos/engine';

type ReadyLine = Pick<EngineLine, 'order_id' | 'station_id' | 'carry_ms' | 'cook_ms' | 'load_id'
  | 'booked' | 'done_at' | 'started_at' | 'fired_at' | 'fire_ms'>;
type Station = EngineState['stations'][string];
type ReadyState = {
  orders: Record<string, Pick<EngineOrder, 'promise_ms' | 'target_land_ms'>>;
  stations: Record<string, { loads: Record<string, Pick<Station['loads'][string], 'booked'>> }>;
};

function landOf(state: ReadyState, l: ReadyLine): number | null {
  if (l.done_at !== null) return l.done_at + l.carry_ms;
  const booked = l.booked ?? (l.load_id === null ? null : (state.stations[l.station_id]?.loads[l.load_id]?.booked ?? null));
  if (booked !== null) return booked.end + l.carry_ms;
  const start = l.started_at ?? l.fired_at ?? l.fire_ms;
  return start === null ? null : start + l.cook_ms + l.carry_ms;
}

/** 03c §4.2: the customer's line time, shared by receipts and takeaway slips. */
export function customerReadyAt(state: ReadyState, line: ReadyLine): { land_at: number; ready_at: number } | null {
  const order = state.orders[line.order_id];
  const land = landOf(state, line);
  if (order === undefined || land === null) return null;
  return { land_at: land, ready_at: land + (order.promise_ms - order.target_land_ms) };
}

type TokenState = ReadyState & { lines: Record<string, ReadyLine & Pick<EngineLine, 'stage'>> };

/** 03c §3.11: time for the token's non-cancelled orders, across both serve modes. */
export function takeawaySlipReadyAt(state: TokenState, orderIds: readonly string[], pickupAt: number | null): number | null {
  const included = new Set(orderIds);
  let latestLand: number | null = null;
  let latestReady: number | null = null;
  for (const line of Object.values(state.lines)) {
    if (!included.has(line.order_id) || (line.stage !== 'added' && line.stage !== 'cooking' && line.stage !== 'done')) continue;
    const time = customerReadyAt(state, line);
    if (time === null) return null;
    latestLand = Math.max(latestLand ?? time.land_at, time.land_at);
    latestReady = Math.max(latestReady ?? time.ready_at, time.ready_at);
  }
  if (pickupAt !== null && latestLand !== null && latestLand <= pickupAt) return pickupAt;
  return latestReady;
}
