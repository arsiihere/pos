// 03a §3.10 pressure (D20): booked unit-ms in [now, now + pressure_window_ms) ÷ (effective capacity × window), in
// basis points, from the live profile (the planned bookings plus the in-flight lines laid over them, §3.3), never
// stored. Task 15 builds stationPressure for the §3.10 overload item of getAlertIntents; the bands, stationsLive and
// the views are task 16b.
import { effectiveCapacity } from './capacity.js';
import { liveProfile } from './live.js';
import { bookedUnitMs } from './profile.js';
import type { EngineState, Profile } from './state.js';

// Proposed (implementer, overnight): integer basis points rounded down, so a band boundary is reached only when the
// booked work actually reaches it; a station with no config window or no capacity reads 0.
export function pressureBp(profile: Profile, cap: number, window_ms: number, now: number): number {
  if (!(cap >= 1) || !(window_ms > 0)) return 0;
  return Math.floor((bookedUnitMs(profile, now, now + window_ms) * 10_000) / (cap * window_ms));
}

export function pressureWindowOf(state: EngineState, station_id: string): number {
  return state.config?.stations.find((s) => s.station_id === station_id)?.pressure_window_ms ?? 0;
}

// §6.1j: basis points; pure in (state, now).
export function stationPressure(state: EngineState, station_id: string, now: number): number {
  const station = state.stations[station_id];
  if (station === undefined) return 0;
  return pressureBp(liveProfile(state, station_id, now), effectiveCapacity(station), pressureWindowOf(state, station_id), now);
}
