import { stationView, type EngineState } from '@pos/engine';
import { HUB_ENGINE_SETTING_DEFAULTS, type EventDraft, type WsStationTakeover } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { alerts, type CloseItem, type RaiseInput } from '../alerts/raise.js';
import type { TickDef } from '../alerts/tick.js';
import { rawDbOf } from '../engine-host/read-only-tx.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { kdsStationBody } from '../ws/kds-catch-up.js';
import { wsHubFor, type ConnectedSession, type WsHub } from '../ws/server.js';
import type { StationPresence } from './contracts.js';
import { devicePointOf, screenStations } from './device-roles.js';
import { KDS_OFFLINE, KDS_OFFLINE_KIND } from './kinds.js';

// 03b §3.6, §6.20 (task b20): the `kds_presence` tick, `stationPresence()` and the Pass takeover frames.
// - Host (G-13): one per hub db, bound by registerKds (lane B6's register) holding wsHubFor(app); `due` finds it by
//   rawDbOf(db), `intents` by tx.db (the engine-host/fires-tick.ts bindFiresTick pattern).
// - due(db, state, now): 1 statement (the open `kds_offline` alerts, by kind, on the read-only view), the rest memory.
//   Presence from connectedSessions() (station sockets by stationId, 00 H-9); `offline_since` starts at the first pass
//   that sees a screen station without a socket (G-13: the loop starts only after listen). Takeover END writes nothing, so due sends
//   `station_takeover { active: false }` and clears the set itself. True when a raise, a close or a takeover START is due.
// - intents(tx, state, now): the open alerts re-read inside the transaction (1 statement, race rule), then one
//   alerts.raiseMany and one alerts.closeMany (01d's bounds); the takeover START frames go out in tx.onCommit, so a
//   rolled-back pass sends nothing (§3.6 step 2).

/** §3.6 step 3: a back screen closes its `kds_offline` alert `done` after this long connected. */
export const KDS_BACK_MS = 60_000;

export const KDS_PRESENCE_TICK = 'kds_presence';

interface PresenceLog {
  info(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

interface PresenceHost {
  db: Database.Database;
  state: () => unknown;
  ws: () => WsHub;
  log: PresenceLog | null;
  /** Screen stations with no station socket: since when (first pass that saw it so). */
  offline_since: Map<string, number>;
  /** Screen stations with a station socket: since when (§3.6 step 3, the 60 s close). */
  connected_since: Map<string, number>;
  /** §3.6 `takeover_stations`: station_id → the point its start frame went to. */
  takeover: Map<string, string | null>;
  /** stationPresence(): the view of the last due. */
  snapshot: Map<string, StationPresence>;
}

const hosts = new WeakMap<Database.Database, PresenceHost>();

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

const OPEN_SQL = `SELECT alert_id, json_extract(values_json, '$.station_id') AS station_id FROM alerts WHERE state = 'open' AND kind = ?`;

function readOpen(db: Database.Database): Map<string, string> {
  const rows = db.prepare(OPEN_SQL).all(KDS_OFFLINE_KIND) as Array<{ alert_id: string; station_id: unknown }>;
  const out = new Map<string, string>();
  for (const r of rows) if (typeof r.station_id === 'string') out.set(r.station_id, r.alert_id);
  return out;
}

/** Called once per server from lane B6's register(); returns the host (tests read it through the exports below). */
export function bindPresence(app: FastifyInstance, deps: Pick<HubDeps, 'db' | 'state'>): void {
  const host: PresenceHost = {
    db: deps.db,
    state: () => deps.state.get(),
    ws: () => wsHubFor(app),
    log: app.log,
    offline_since: new Map(),
    connected_since: new Map(),
    takeover: new Map(),
    snapshot: new Map(),
  };
  hosts.set(deps.db, host);
}

/** §3.6 step 6 / §4.2: the tick's view at its last pass (memory, 0 statements). Empty before the first pass. */
export function stationPresenceOf(db: Database.Database): Map<string, StationPresence> {
  return new Map(hosts.get(rawDbOf(db))?.snapshot ?? []);
}

/** §3.6 step 2: the stations under takeover (for 03b's audiences, b22). Memory, 0 statements. */
export function takeoverStations(db: Database.Database): ReadonlyMap<string, string | null> {
  return hosts.get(rawDbOf(db))?.takeover ?? new Map();
}

interface StationFacts {
  name: string;
  point_id: string | null;
}

function stationFacts(): Map<string, StationFacts> {
  const out = new Map<string, StationFacts>();
  for (const s of branchConfig()?.stations ?? []) out.set(s.station_id, { name: s.name, point_id: s.point_id ?? null });
  return out;
}

const offlineMs = (): number => branchConfig()?.engine_settings.kds_offline_ms ?? HUB_ENGINE_SETTING_DEFAULTS.kds_offline_ms;

/** Step 1: presence memory from the socket list (due only). */
function observe(host: PresenceHost, now: number): Set<string> {
  const connected = new Set<string>();
  for (const s of host.ws().connectedSessions() as ConnectedSession[]) if (s.kind === 'station' && s.stationId !== null) connected.add(s.stationId);
  const screens = screenStations();
  for (const id of [...host.offline_since.keys(), ...host.connected_since.keys()]) {
    if (!screens.has(id)) {
      host.offline_since.delete(id);
      host.connected_since.delete(id);
    }
  }
  for (const id of screens.keys()) {
    if (connected.has(id)) {
      host.offline_since.delete(id);
      if (!host.connected_since.has(id)) host.connected_since.set(id, now);
    } else {
      host.connected_since.delete(id);
      if (!host.offline_since.has(id)) host.offline_since.set(id, now);
    }
  }
  return connected;
}

interface Plan {
  dark: Set<string>;
  raise: string[];
  closes: CloseItem[];
  start: string[];
  end: string[];
}

/** Steps 2–5 over the memory (pure; due and intents both call it, intents with the open alerts read in its tx). */
function plan(host: PresenceHost, state: EngineState, now: number, open: ReadonlyMap<string, string>): Plan {
  const screens = screenStations();
  const ms = offlineMs();
  const dark = new Set<string>();
  for (const [id, since] of host.offline_since) {
    if (!screens.has(id) || now - since < ms) continue;
    const view = stationView(state, id, now);
    if (view.now.length + view.next.length > 0) dark.add(id);
  }
  const raise = [...dark].filter((id) => !open.has(id)).sort();
  const closes: CloseItem[] = [];
  for (const [id, alert_id] of [...open].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!screens.has(id)) closes.push({ alert_id, reason: 'obsolete' });
    else {
      const back = host.connected_since.get(id);
      if (back !== undefined && now - back >= KDS_BACK_MS) closes.push({ alert_id, reason: 'done' });
    }
  }
  const start = [...dark].filter((id) => !host.takeover.has(id)).sort();
  // A dark station whose point changed (config apply) ends at the old point; it starts again at the new one (§6.17).
  const points = stationFacts();
  const end = [...host.takeover]
    .filter(([id, point]) => !dark.has(id) || (points.get(id)?.point_id ?? null) !== point)
    .map(([id]) => id)
    .sort();
  return { dark, raise, closes, start, end };
}

function snapshotOf(host: PresenceHost, connected: ReadonlySet<string>, dark: ReadonlySet<string>): Map<string, StationPresence> {
  const screens = screenStations();
  const ids = new Set<string>([...(branchConfig()?.stations ?? []).map((s) => s.station_id), ...screens.keys()]);
  const out = new Map<string, StationPresence>();
  for (const id of [...ids].sort()) {
    const screenless = !screens.has(id);
    out.set(id, {
      screenless,
      connected: connected.has(id),
      offline_since: screenless ? null : (host.offline_since.get(id) ?? null),
      dark: dark.has(id),
    });
  }
  return out;
}

/** The staff sockets whose device is bound to `point_id` (Pass tablets, §3.1). */
function passSessions(host: PresenceHost, point_id: string | null): string[] {
  if (point_id === null) return [];
  return host
    .ws()
    .connectedSessions()
    .filter((s) => s.kind === 'staff' && devicePointOf(s.deviceId) === point_id)
    .map((s) => s.sessionId);
}

function send(host: PresenceHost, point_id: string | null, frame: WsStationTakeover): void {
  const sessions = passSessions(host, point_id);
  if (sessions.length > 0) host.ws().sendToSessions(sessions, frame);
}

export const kdsPresenceTick: TickDef = {
  name: KDS_PRESENCE_TICK,
  due(db, state, now) {
    const host = hosts.get(rawDbOf(db));
    if (host === undefined || !isEngineState(state)) return false;
    const connected = observe(host, now);
    const p = plan(host, state, now, readOpen(db)); // §6.20: the one statement of due
    host.snapshot = snapshotOf(host, connected, p.dark);
    // Step 3 / 4 / 5: takeover end writes nothing — sent here, at once.
    for (const id of p.end) {
      const point_id = host.takeover.get(id) ?? null;
      host.takeover.delete(id);
      send(host, point_id, { type: 'station_takeover', station_id: id, active: false });
      host.log?.info({ station_id: id }, 'kds.takeover.end');
    }
    const restart = p.end.some((id) => p.dark.has(id)); // moved to another point: starts there in this pass's intents
    return p.raise.length > 0 || p.closes.length > 0 || p.start.length > 0 || restart;
  },
  intents(tx, state, now) {
    const host = hosts.get(tx.db);
    if (host === undefined || !isEngineState(state)) return [];
    const p = plan(host, state, now, readOpen(tx.db)); // authoritative inside the transaction (1 statement)
    const ctx = alerts.tickCtx(tx, now);
    const facts = stationFacts();
    const inputs: RaiseInput[] = p.raise.map((id) => ({
      kind: KDS_OFFLINE_KIND,
      subject: { stream_type: 'hub', stream_id: tx.branchId },
      target: { kind: 'managers' },
      values: { station_id: id },
      display: { kind_label_key: KDS_OFFLINE.labels.lock },
      details: { station_name: (facts.get(id)?.name ?? id).slice(0, 40) },
      dedupe_key: `${KDS_OFFLINE_KIND}:${id}`,
    }));
    const drafts: EventDraft[] = [];
    if (inputs.length > 0) for (const r of alerts.raiseMany(ctx, inputs)) drafts.push(...r.events);
    if (p.closes.length > 0) drafts.push(...alerts.closeMany(ctx, p.closes));
    if (p.start.length > 0) {
      const starts = p.start.map((id) => ({ id, point_id: facts.get(id)?.point_id ?? null }));
      tx.onCommit(() => {
        const after = host.state();
        for (const { id, point_id } of starts) {
          if (host.takeover.has(id)) continue;
          host.takeover.set(id, point_id);
          // A failed send never skips the other starts, the writer's after-commit hooks or the publish.
          try {
            const sessions = passSessions(host, point_id);
            if (sessions.length > 0 && isEngineState(after)) {
              host.ws().sendToSessions(sessions, { type: 'station_takeover', station_id: id, active: true, view: kdsStationBody(host.db, after, id, now) });
            }
          } catch (err) {
            host.log?.error({ station_id: id, err }, 'kds.takeover.start: frame skipped');
          }
          host.log?.info({ station_id: id }, 'kds.takeover.start');
        }
      });
    }
    return drafts;
  },
};
