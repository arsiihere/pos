// 03a §3.12 day-close checkpoint (D26, P-8): a version-independent document with its own schema. Written by 03a's host
// only when noOrderInEngine holds (§3.6.1), so the body is built from the stock, station and config parts alone; an
// order still physically present but exited by the predicate is not part of it. AD-6: diagnostics are host scratch,
// neither stored here nor restored. Pure.
import type { EngineConfig } from '@pos/events';
import type { BusinessDay, EngineState, StationRuntime } from './state.js';

export type EngineCheckpointV1 = {
  checkpoint_schema: 1;
  last_seq: number;
  business_day: BusinessDay | null;
  stock: EngineState['stock'];
  stations: Record<string, { capacity_override: number | null; paused: boolean }>;
  config: EngineConfig | null;
};

// P-8: last_seq is the caller's (§3.12: the max seq of the commit that folded BusinessDayClosed, or writer.lastSeq()
// for a deferred checkpoint).
export function toCheckpoint(state: EngineState, last_seq: number): EngineCheckpointV1 {
  const stations: EngineCheckpointV1['stations'] = {};
  for (const id of Object.keys(state.stations)) {
    const { capacity_override, paused } = state.stations[id]!;
    stations[id] = { capacity_override, paused };
  }
  return { checkpoint_schema: 1, last_seq, business_day: state.business_day, stock: state.stock, stations, config: state.config };
}

// §3.12 boot step 2: the state a full replay holds at last_seq when no order is in the engine. Every station comes from
// config (§3.11: every station is in the log, archived ones included) with an empty runtime and the body's two live
// fields. proposed (implementer, overnight): a station the config no longer lists cannot be rebuilt (the body has no
// type or capacity) and is left out; §3.11 stations are archived, never dropped from E(next), so this does not occur.
export function fromCheckpoint(body: EngineCheckpointV1): EngineState {
  const stations: Record<string, StationRuntime> = {};
  for (const s of body.config?.stations ?? []) {
    const live = body.stations[s.station_id];
    stations[s.station_id] = {
      station_id: s.station_id,
      type: s.station_type,
      capacity: s.capacity,
      capacity_override: live?.capacity_override ?? null,
      paused: live?.paused ?? false,
      profile: { t: [], u: [] },
      unfired: [],
      loads: {},
    };
  }
  return {
    stock: body.stock,
    business_day: body.business_day,
    config: body.config,
    stations,
    orders: {},
    lines: {},
    slips: {},
    next_alert_due_at: null,
    slip_due: {},
    diagnostics: [],
  };
}
