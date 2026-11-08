import type { EngineState } from '@pos/engine';
import type { Clock } from '../lib/clock.js';
import { stationsLiveBody } from '../queries/stations-live.js';
import { registerEventAudience } from './audience.js';
import { registerCatchUp, type CatchUpPart, type SocketCtx } from './catch-up.js';

// 03a §6.4: the station-config events go to every staff and every station socket. Order-stream events get no
// audience here (01d run 3 §4): an event type with no registered audience reaches no socket.
for (const eventType of ['EngineConfigApplied', 'StationCapacitySet', 'StationPauseSet']) {
  registerEventAudience(eventType, () => true);
}

// AD-32 (1), developer ruling 2026-11-07: the stock frames go to every staff socket of the branch (ordering screens'
// availability), not to station sockets — the same rule as 01a's StockSet / StockAdded (restaurant-audiences.ts).
for (const eventType of ['StockReserved', 'StockReleased', 'StockConsumed']) {
  registerEventAudience(eventType, (_event, socket) => socket.kind === 'staff');
}

// §6.4: catch-up part stations_live for staff and station sockets; body = §6.5 at the catch-up's as_of_seq
// (the writer's lastSeq read with the state). 0 statements.
export function stationsLivePart(clock: Clock): CatchUpPart {
  return {
    part: 'stations_live',
    appliesTo: (socket) => socket.kind === 'staff' || socket.kind === 'station',
    build: (_db, raw, socket) => stationsLiveBody(raw as EngineState, clock.branchNow(), socket.asOfSeq),
  };
}

// §3.6.3, §6.4 (v0.4 G2 #19): the `station_plan` audience, for the catch-up part and the frame alike: every staff
// socket, and the station sockets of that station only.
export function stationPlanAudience(station_id: string, socket: Pick<SocketCtx, 'kind' | 'stationId'>): boolean {
  return socket.kind === 'staff' || (socket.kind === 'station' && socket.stationId === station_id);
}

// Returns the unregister function.
export function registerEngineCatchUp(clock: Clock): () => void {
  return registerCatchUp(stationsLivePart(clock));
}
