// 03a §3.10 pressure (D20): booked unit-ms in [now, now + pressure_window_ms) ÷ (effective capacity × window), in
// basis points, from the live profile (the planned bookings plus the in-flight lines laid over them, §3.3), never
// stored. Task 15 builds stationPressure for the §3.10 overload item of getAlertIntents; the bands, stationsLive and
// the views are task 16b.
// Task 13 note: a batch load books the whole station, so a load with room reads as full here: §3.10 is time occupancy
// ("booked unit-ms"), and the bands see exactly that, not the units on the tray.
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

export type PressureBand = 'green' | 'amber' | 'red';

// §3.10: green < pressure_amber_bp ≤ amber ≤ pressure_red_bp < red.
export function pressureBand(bp: number, thresholds: { pressure_amber_bp: number; pressure_red_bp: number }): PressureBand {
  if (bp < thresholds.pressure_amber_bp) return 'green';
  return bp <= thresholds.pressure_red_bp ? 'amber' : 'red';
}

// §3.10, §6.1m: max(1, min(capacity, lanes_on × lane_units)), lane_units = the configured value, or when it is null
// max(1, floor(capacity ÷ lane_count)), never 0. lane_count is an input, an integer ≥ 1 (03a never reads devices).
export function capacityForLanes(station: { capacity: number; lane_units: number | null }, lanes_on: number, lane_count: number): number {
  const lane_units = station.lane_units ?? Math.max(1, Math.floor(station.capacity / lane_count));
  return Math.max(1, Math.min(station.capacity, lanes_on * lane_units));
}
