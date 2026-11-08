// D37: a station's effective capacity = capacity_override ?? capacity. Its own module so live.ts, lifecycle.ts
// and the planners share one definition without an import cycle.
import type { StationRuntime } from './state.js';

export function effectiveCapacity(station: Pick<StationRuntime, 'capacity' | 'capacity_override'>): number {
  return station.capacity_override ?? station.capacity;
}
