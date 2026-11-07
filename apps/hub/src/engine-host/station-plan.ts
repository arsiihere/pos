import { stationPlan, type EngineState } from '@pos/engine';
import type { StationPlanBody, WsStationPlan } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../lib/clock.js';
import type { HubDeps } from '../server.js';
import { registerCatchUp, type CatchUpPart } from '../ws/catch-up.js';
import { stationPlanAudience } from '../ws/engine-audiences.js';
import { wsHubFor } from '../ws/server.js';
import { onFreezeEntry, takeCommittedCrossed } from './fires-tick.js';
import { touchedIn } from './reducer.js';

// 03a §3.6.3, §6.4 (test #83): the `station_plan` catch-up part and frame. Re-plans write no event (D13) and lines
// enter Next with time, so 03b's KDS learns the plan from these, never from ItemAdded.
// - Catch-up part: per station `{ station_id, as_of_seq, lines }` from stationPlan(state, station_id, now); staff and
//   station sockets, a station session only its own station. In memory: 0 statements.
// - Frame: the same body for one station, to that station's station sockets and every staff socket (G2 #19), sent
//   (a) after commit for every station the commit's fold touched (P-7, reducer.touchedIn) plus the stations the fires
//       pass crossed when that pass also had intents: one frame per station per commit;
//   (b) from the fires tick's `due` when a line entered Next and nothing else is due (fires-tick onFreezeEntry seam):
//       a send of committed state, no transaction, no statement.
// as_of_seq is writer.lastSeq(), read with the state in one synchronous step.

// 01a §2: a hub with no engine steps holds {}.
const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

export function stationPlanBody(state: EngineState, station_id: string, now: number, as_of_seq: number): StationPlanBody {
  return { ...stationPlan(state, station_id, now), as_of_seq };
}

// proposed (implementer): the part's value is an array of bodies, one per station of state.stations in id order
// (archived ones too: §3.6.3 lists "every unfired line"), or the station session's own station alone (its own body,
// empty, when the station is not in the engine: review M-3). §3.6.3 says "per station" with no container; an array
// keeps the body the frame's own.
export function stationPlanPart(clock: Clock, onSocket?: (sessionId: string, stationId: string | null) => void): CatchUpPart {
  return {
    part: 'station_plan',
    appliesTo: (socket) => socket.kind === 'staff' || socket.kind === 'station',
    build: (_db, raw, socket) => {
      onSocket?.(socket.sessionId, socket.kind === 'station' ? socket.stationId : null);
      if (!isEngineState(raw)) return [];
      const now = clock.branchNow();
      if (socket.kind === 'station') return socket.stationId === null ? [] : [stationPlanBody(raw, socket.stationId, now, socket.asOfSeq)];
      const ids = Object.keys(raw.stations).sort().filter((id) => stationPlanAudience(id, socket));
      return ids.map((id) => stationPlanBody(raw, id, now, socket.asOfSeq));
    },
  };
}

// registerEngineHost (P-6): the part, the after-commit frames and the freeze-entry sender of this hub.
export function bindStationPlans(app: FastifyInstance, deps: HubDeps): void {
  // proposed (implementer): 00 H-4's connectedSessions() has no stationId, so the station of each session socket is
  // noted when its catch-up part is built (every staff and station socket builds it) and dropped once the socket is
  // gone; this keeps the frame at 0 statements without changing 00's contract.
  const stationOf = new Map<string, string | null>();
  // The catch-up registry (ws/catch-up.ts `parts`) is module-global: with two hubs in one process (tests only) each
  // hub's sockets build every registered part: the last one registered sets the `station_plan` key (with its own
  // clock), and the other hub's part notes foreign session ids into its own map, which its send prunes. Production
  // runs one hub per process, so this affects tests only (review M-2).
  const stopPart = registerCatchUp(stationPlanPart(deps.clock, (sessionId, stationId) => stationOf.set(sessionId, stationId)));
  app.addHook('onClose', async () => stopPart());

  // proposed (implementer): sent with ws.sendToSessions (00 v1.6.1 AD-74), not sendToDevices as §3.6.3 names: the
  // latter also reaches a device's alert-mode socket, which gets alert frames only (00 H-1), and every other session
  // socket of the device; sendToSessions reaches exactly the stated audience.
  const send = (station_ids: readonly string[]): void => {
    const ws = wsHubFor(app);
    const sessions = ws.connectedSessions();
    // Review M-1: the notes of closed sockets go first, before any early return.
    const live = new Set(sessions.map((s) => s.sessionId));
    for (const id of stationOf.keys()) if (!live.has(id)) stationOf.delete(id);
    if (station_ids.length === 0) return;
    const state = deps.state.get();
    if (!isEngineState(state)) return;
    const now = deps.clock.branchNow();
    const as_of_seq = deps.writer.lastSeq();
    for (const station_id of [...new Set(station_ids)].sort()) {
      const to = sessions
        .filter((s) => stationPlanAudience(station_id, { kind: s.kind, stationId: stationOf.get(s.sessionId) ?? null }))
        .map((s) => s.sessionId);
      if (to.length === 0) continue;
      const frame: WsStationPlan = { type: 'station_plan', ...stationPlanBody(state, station_id, now, as_of_seq) };
      ws.sendToSessions(to, frame);
    }
  };

  onFreezeEntry(deps, send);
  deps.writer.addAfterCommit((appended) => {
    send([...takeCommittedCrossed(deps), ...touchedIn(appended)]);
  });
}
