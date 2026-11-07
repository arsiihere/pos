import type { EngineState } from '@pos/engine';
import type { Clock } from '../lib/clock.js';
import { stationsLiveBody } from '../queries/stations-live.js';
import { registerEventAudience } from './audience.js';
import { registerCatchUp, type CatchUpPart } from './catch-up.js';

// 03a §6.4: the station-config events go to every staff and every station socket. Order-stream events get no
// audience here (01d run 3 §4): an event type with no registered audience reaches no socket.
for (const eventType of ['EngineConfigApplied', 'StationCapacitySet', 'StationPauseSet']) {
  registerEventAudience(eventType, () => true);
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

// Returns the unregister function.
export function registerEngineCatchUp(clock: Clock): () => void {
  return registerCatchUp(stationsLivePart(clock));
}
