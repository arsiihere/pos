import { stationView, type EngineState } from '@pos/engine';
import type { KdsStationBody, WsKdsLines } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildLineDetails } from '../kds/contracts.js';
import type { HubDeps } from '../server.js';
import { registerCatchUp, type CatchUpPart } from './catch-up.js';
import { wsHubFor } from './server.js';

// 03b §6.14, §6.16 (task b18): the `kds_station` catch-up part (station sockets, own station) and the `kds_lines` frame.
// - Body: day_open, sound_volume (default 70, §3.8), lanes (station_lanes, else all on over the labelled kds devices,
//   §3.7), Now = stationView(...).now with details, details = the frozen Next lines (stationView(...).next).
//   3 statements: settings + lanes 1, buildLineDetails 2.
// - Frame: after every commit, per connected station socket, the details of the lines its station shows (Now and every
//   planned line) that this socket has not been given yet (by its catch-up or an earlier frame): once per id per socket.
//   The record is per session id and each catch-up (a new socket) replaces it.
//   ⚠️ Changed by v1.0.4 (owner 2026-11-11, B3-3): a line whose live units changed in the commit (ItemRemoved,
//   ItemVoided, LineWeightSet) is sent again to the sockets that already hold it, so its units and options
//   ("2 x No onion", §4.4) follow a partial removal.
//   One buildLineDetails (2 statements) per commit that adds or changes shown lines; 0 statements otherwise. Registered
//   after the engine host's hook, so a commit's `station_plan` goes first and the KDS shows a placeholder until the
//   details arrive (§3.3).

/** §3.8: sound volume of a station with no StationScreenSet. */
export const DEFAULT_SOUND_VOLUME = 70;

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

const SETTINGS_SQL = `
SELECT (SELECT sound_volume FROM kds_station_settings WHERE station_id = @id) AS sound_volume,
       (SELECT lane_count FROM station_lanes WHERE station_id = @id) AS lane_count,
       (SELECT lanes_on FROM station_lanes WHERE station_id = @id) AS lanes_on,
       (SELECT COUNT(*) FROM station_lanes WHERE station_id = @id) AS has_lanes,
       (SELECT COUNT(*) FROM devices WHERE station_id = @id AND device_type = 'kds' AND lane_label IS NOT NULL AND revoked_at IS NULL) AS labelled`;

/** §6.14: the `kds_station` body (also the takeover frame's `view`, §3.6); 3 statements. */
export function kdsStationBody(db: Database.Database, state: EngineState, station_id: string, now: number): KdsStationBody {
  const s = db.prepare(SETTINGS_SQL).get({ id: station_id }) as {
    sound_volume: number | null;
    lane_count: number | null;
    lanes_on: number | null;
    has_lanes: number;
    labelled: number;
  };
  const view = stationView(state, station_id, now);
  const details = buildLineDetails(db, state, [...view.now, ...view.next].map((l) => l.order_item_id));
  const lane_count = s.has_lanes === 1 ? s.lane_count! : Math.max(1, s.labelled);
  return {
    station_id,
    day_open: state.business_day !== null && state.business_day.closed_at === null,
    sound_volume: s.sound_volume ?? DEFAULT_SOUND_VOLUME,
    lanes: { lanes_on: s.has_lanes === 1 ? s.lanes_on : lane_count, lane_count },
    now: view.now.flatMap((l) => {
      const d = details.get(l.order_item_id);
      return d === undefined ? [] : [{ ...d, stage: l.stage, fired_at: l.fired_at, started_at: l.started_at, mark: l.mark }];
    }),
    details: view.next.flatMap((l) => {
      const d = details.get(l.order_item_id);
      return d === undefined ? [] : [d];
    }),
  };
}

/** B3-3: the events that change a line's live units (02b §3.4: units − removed − voided; LineWeightSet re-reads it). */
const UNIT_CHANGES: ReadonlySet<string> = new Set(['ItemRemoved', 'ItemVoided', 'LineWeightSet']);

/** The lines a station shows or will show: Now and every planned (unfired) line, in memory. */
function stationLineIds(state: EngineState, station_id: string): Set<string> {
  const ids = new Set<string>();
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.station_id === station_id && (l.stage === 'added' || l.stage === 'cooking')) ids.add(id);
  }
  return ids;
}

export function kdsStationPart(deps: Pick<HubDeps, 'clock'>, onBuilt?: (sessionId: string, ids: readonly string[]) => void): CatchUpPart {
  return {
    part: 'kds_station',
    appliesTo: (socket) => socket.kind === 'station' && socket.stationId !== null,
    build: (db, raw, socket) => {
      if (!isEngineState(raw) || socket.stationId === null) return null;
      const body = kdsStationBody(db, raw, socket.stationId, deps.clock.branchNow());
      onBuilt?.(socket.sessionId, [...body.now.map((l) => l.order_item_id), ...body.details.map((l) => l.order_item_id)]);
      return body;
    },
  };
}

/** Called once per server from lane B3's register(). */
export function registerKdsCatchUp(app: FastifyInstance, deps: HubDeps): void {
  // Per station socket (session id): the ids whose details it holds. Host memory; a closed socket's entry is dropped
  // at the next commit. With two hubs in one process (tests only) the module-global catch-up registry builds every
  // hub's part, as engine-host/station-plan.ts notes; production runs one hub per process.
  const given = new Map<string, Set<string>>();
  const stopPart = registerCatchUp(
    // A catch-up starts a new socket (also a reconnect on the same session token): it replaces the record, so the
    // next commit sends that socket every shown line its catch-up did not carry (review of #30, item 1).
    kdsStationPart(deps, (sessionId, ids) => given.set(sessionId, new Set(ids))),
  );
  app.addHook('onClose', async () => stopPart());

  deps.writer.addAfterCommit((appended) => {
    const sessions = wsHubFor(app)
      .connectedSessions()
      .filter((s) => s.kind === 'station' && s.stationId !== null);
    const live = new Set(sessions.map((s) => s.sessionId));
    for (const id of given.keys()) if (!live.has(id)) given.delete(id);
    if (sessions.length === 0) return;
    const state = deps.state.get();
    if (!isEngineState(state)) return;

    // B3-3: lines whose live units changed in this commit (in memory, no statement).
    const changed = new Set<string>();
    for (const e of appended) {
      if (UNIT_CHANGES.has(e.event_type)) changed.add((e.payload as { order_item_id: string }).order_item_id);
    }

    const byStation = new Map<string, Set<string>>();
    const missing = new Map<string, string[]>(); // sessionId → ids to send
    const all = new Set<string>();
    for (const s of sessions) {
      const station_id = s.stationId!;
      let shown = byStation.get(station_id);
      if (shown === undefined) byStation.set(station_id, (shown = stationLineIds(state, station_id)));
      const had = given.get(s.sessionId) ?? new Set<string>();
      // Keep only what the station still shows, so the memory stays bounded by the engine's lines.
      for (const id of had) if (!shown.has(id)) had.delete(id);
      given.set(s.sessionId, had);
      const gained = [...shown].filter((id) => !had.has(id));
      // Held and still shown (pruned above) with changed units → sent again.
      const resend = [...changed].filter((id) => had.has(id));
      const send = [...gained, ...resend].sort();
      if (send.length === 0) continue;
      missing.set(s.sessionId, send);
      for (const id of send) all.add(id);
    }
    if (all.size === 0) return;

    const details = buildLineDetails(deps.db, state, [...all]);
    const ws = wsHubFor(app);
    for (const s of sessions) {
      const ids = missing.get(s.sessionId);
      if (ids === undefined) continue;
      const lines = ids.flatMap((id) => {
        const d = details.get(id);
        return d === undefined ? [] : [d];
      });
      // Marked given even without details (a line 02b's tables do not hold yet): the KDS keeps its placeholder, and a
      // commit never re-reads it, so the 2-statement bound holds per commit.
      const had = given.get(s.sessionId)!;
      for (const id of ids) had.add(id);
      if (lines.length === 0) continue;
      const frame: WsKdsLines = { type: 'kds_lines', station_id: s.stationId!, lines };
      ws.sendToSessions([s.sessionId], frame);
    }
  });
}
