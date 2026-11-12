import type { LineDetail } from '@pos/domain';
import { isOrderInEngine, stationView, type EngineState } from '@pos/engine';
import type { KdsStationBody, WsPointLines } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildLineDetails, devicePoint, pointOfLine } from '../kds/contracts.js';
import { takeoverStations } from '../kds/presence.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { registerCatchUp, type CatchUpPart } from './catch-up.js';
import { DEFAULT_SOUND_VOLUME, doneUndone } from './kds-catch-up.js';
import { wsHubFor } from './server.js';

// 03b §6.15, §6.16 (task b21): the `point_view` catch-up part (staff sockets on a device with a point, §3.4) and the
// `point_lines` frame.
// - Body: the point's stations (name, lanes, dark = under takeover, §3.6), every order in the engine with a live line
//   (added / cooking / done) whose point (pointOfLine, §3.1) is this point — oldest first, lines in the order's line
//   order with stage and handed_over, the open Ready (`pass_orders.ready_at`, `ready_by`) — and one `kds_station` body
//   per station of the point under takeover. 4 statements whatever the takeovers: buildLineDetails 2 (the orders'
//   lines and the takeover stations' Now / Next together), pass rows 1 (Ready rows ∪ handed lines), settings + lanes of
//   the point's stations 1.
// - Frame: after every commit, per Pass socket, the details of the lines its point shows (the point's live lines and
//   the Now / planned lines of its takeover stations) that this socket has not been given yet (catch-up, an earlier
//   frame or a takeover start view): once per id per socket, and again when a held line's live units change (B3-3:
//   ItemRemoved / ItemVoided with units, LineWeightSet). One buildLineDetails (2 statements) per commit that adds or
//   changes lines; 0 otherwise. Registered after b18's kds_lines hook (lane order B3 → B6).

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

const LIVE = new Set(['added', 'cooking', 'done']);

/** B3-3: the events that change a line's live units (as ws/kds-catch-up.ts). */
const UNIT_CHANGES: ReadonlySet<string> = new Set(['ItemRemoved', 'ItemVoided', 'LineWeightSet']);

export type PointLine = LineDetail & { stage: 'added' | 'cooking' | 'done'; handed_over: boolean };
export interface PointViewBody {
  point_id: string;
  stations: Array<{ station_id: string; name: string; lanes: KdsStationBody['lanes']; dark: boolean }>;
  orders: Array<{ order_id: string; identifier: LineDetail['identifier']; placed_at: number; lines: PointLine[]; ready: { at: number; by: string | null } | null }>;
  takeovers: KdsStationBody[];
}

/** The live lines of `point_id` whose order is in the engine (memory). */
function pointLineIds(state: EngineState, point_id: string, now: number): string[] {
  const ids: string[] = [];
  const inEngine = new Map<string, boolean>();
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (!LIVE.has(l.stage) || pointOfLine(state, id) !== point_id) continue;
    let keep = inEngine.get(l.order_id);
    if (keep === undefined) inEngine.set(l.order_id, (keep = isOrderInEngine(state, l.order_id, now)));
    if (keep) ids.push(id);
  }
  return ids;
}

/** The stations of `point_id` under takeover (memory). */
function takeoverIdsOf(db: Database.Database, point_id: string): string[] {
  return [...takeoverStations(db)].filter(([, p]) => p === point_id).map(([id]) => id).sort();
}

/** The lines a takeover station shows (Now and every planned line), like the KDS (memory). */
function stationShownIds(state: EngineState, station_id: string): string[] {
  const ids: string[] = [];
  for (const id in state.lines) {
    const l = state.lines[id]!;
    if (l.station_id === station_id && (l.stage === 'added' || l.stage === 'cooking')) ids.push(id);
  }
  return ids;
}

const SETTINGS_SQL = `
SELECT j.value AS station_id,
       (SELECT sound_volume FROM kds_station_settings WHERE station_id = j.value) AS sound_volume,
       (SELECT lane_count FROM station_lanes WHERE station_id = j.value) AS lane_count,
       (SELECT lanes_on FROM station_lanes WHERE station_id = j.value) AS lanes_on,
       (SELECT COUNT(*) FROM station_lanes WHERE station_id = j.value) AS has_lanes,
       (SELECT COUNT(*) FROM devices WHERE station_id = j.value AND device_type = 'kds' AND lane_label IS NOT NULL AND revoked_at IS NULL) AS labelled
  FROM json_each(?) j`;

const PASS_SQL = `
SELECT 'r' AS k, order_id AS id, ready_at AS at, ready_by AS by FROM pass_orders
 WHERE point_id = @point_id AND ready_at IS NOT NULL AND order_id IN (SELECT value FROM json_each(@orders))
UNION ALL
SELECT 'h' AS k, order_item_id AS id, NULL AS at, NULL AS by FROM handover_lines
 WHERE order_item_id IN (SELECT value FROM json_each(@lines))`;

interface SettingsRow {
  station_id: string;
  sound_volume: number | null;
  lane_count: number | null;
  lanes_on: number | null;
  has_lanes: number;
  labelled: number;
}

const lanesOf = (s: SettingsRow): KdsStationBody['lanes'] => {
  const lane_count = s.has_lanes === 1 ? s.lane_count! : Math.max(1, s.labelled);
  return { lanes_on: s.has_lanes === 1 ? s.lanes_on : lane_count, lane_count };
};

/** §6.15: the `point_view` body; 4 statements. */
export function pointViewBody(db: Database.Database, state: EngineState, point_id: string, now: number): PointViewBody {
  const stations = (branchConfig()?.stations ?? []).filter((s) => s.point_id === point_id && !s.is_archived);
  const takeovers = takeoverIdsOf(db, point_id);
  const settingsIds = [...new Set([...stations.map((s) => s.station_id), ...takeovers])];
  const settings = new Map(
    (settingsIds.length === 0 ? [] : (db.prepare(SETTINGS_SQL).all(JSON.stringify(settingsIds)) as SettingsRow[])).map((r) => [r.station_id, r]),
  );
  const lineIds = pointLineIds(state, point_id, now);
  const views = new Map(takeovers.map((id) => [id, stationView(state, id, now)]));
  const takeoverLineIds = [...views.values()].flatMap((v) => [...v.now, ...v.next].map((l) => l.order_item_id));
  const details = buildLineDetails(db, state, [...new Set([...lineIds, ...takeoverLineIds])]);

  const orderIds = [...new Set(lineIds.map((id) => state.lines[id]!.order_id))];
  const ready = new Map<string, { at: number; by: string | null }>();
  const handed = new Set<string>();
  if (orderIds.length > 0) {
    const rows = db.prepare(PASS_SQL).all({ point_id, orders: JSON.stringify(orderIds), lines: JSON.stringify(lineIds) }) as Array<{
      k: 'r' | 'h';
      id: string;
      at: number | null;
      by: string | null;
    }>;
    for (const r of rows) {
      if (r.k === 'r') ready.set(r.id, { at: r.at!, by: r.by });
      else handed.add(r.id);
    }
  }

  const lineSet = new Set(lineIds);
  const orders: PointViewBody['orders'] = [];
  for (const order_id of orderIds) {
    const order = state.orders[order_id]!;
    const lines = order.line_ids.flatMap((id): PointLine[] => {
      const d = details.get(id);
      if (!lineSet.has(id) || d === undefined) return [];
      return [{ ...d, stage: state.lines[id]!.stage as PointLine['stage'], handed_over: handed.has(id) }];
    });
    if (lines.length === 0) continue;
    orders.push({ order_id, identifier: lines[0]!.identifier, placed_at: order.placed_at, lines, ready: ready.get(order_id) ?? null });
  }
  orders.sort((a, b) => a.placed_at - b.placed_at || (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0));

  const dayOpen = state.business_day !== null && state.business_day.closed_at === null;
  const noSettings: SettingsRow = { station_id: '', sound_volume: null, lane_count: null, lanes_on: null, has_lanes: 0, labelled: 0 };
  return {
    point_id,
    stations: stations.map((s) => ({
      station_id: s.station_id,
      name: s.name,
      lanes: lanesOf(settings.get(s.station_id) ?? noSettings),
      dark: takeovers.includes(s.station_id),
    })),
    orders,
    takeovers: takeovers.map((station_id): KdsStationBody => {
      const view = views.get(station_id)!;
      const s = settings.get(station_id) ?? noSettings;
      return {
        station_id,
        day_open: dayOpen,
        sound_volume: s.sound_volume ?? DEFAULT_SOUND_VOLUME,
        lanes: lanesOf(s),
        now: view.now.flatMap((l) => {
          const d = details.get(l.order_item_id);
          return d === undefined ? [] : [{ ...d, stage: l.stage, fired_at: l.fired_at, started_at: l.started_at, mark: l.mark, done_undone: doneUndone(state, l.order_item_id) }];
        }),
        details: view.next.flatMap((l) => {
          const d = details.get(l.order_item_id);
          return d === undefined ? [] : [d];
        }),
      };
    }),
  };
}

/** The ids a point_view body carries details for. */
function bodyIds(body: PointViewBody): string[] {
  return [
    ...body.orders.flatMap((o) => o.lines.map((l) => l.order_item_id)),
    ...body.takeovers.flatMap((t) => [...t.now.map((l) => l.order_item_id), ...t.details.map((l) => l.order_item_id)]),
  ];
}

// Per hub db: Pass socket (session id) → the ids whose details it holds.
const givenByDb = new WeakMap<Database.Database, Map<string, Set<string>>>();

/** §3.6 takeover start (presence.ts): the start frame's view carried these ids to these sockets. */
export function markPointGiven(db: Database.Database, sessionIds: readonly string[], ids: readonly string[]): void {
  const given = givenByDb.get(db);
  if (given === undefined) return;
  for (const s of sessionIds) {
    let had = given.get(s);
    if (had === undefined) given.set(s, (had = new Set()));
    for (const id of ids) had.add(id);
  }
}

export function pointViewPart(deps: Pick<HubDeps, 'clock'>, onBuilt?: (sessionId: string, ids: readonly string[]) => void): CatchUpPart {
  return {
    part: 'point_view',
    appliesTo: (socket) => socket.kind === 'staff' && devicePoint(socket.deviceId) !== null,
    build: (db, raw, socket) => {
      const point_id = devicePoint(socket.deviceId);
      if (!isEngineState(raw) || point_id === null) return null;
      const body = pointViewBody(db, raw, point_id, deps.clock.branchNow());
      onBuilt?.(socket.sessionId, bodyIds(body));
      return body;
    },
  };
}

/** Called once per server from lane B6's register(). */
export function registerPointCatchUp(app: FastifyInstance, deps: HubDeps): void {
  const given = new Map<string, Set<string>>();
  givenByDb.set(deps.db, given);
  // A catch-up starts a new socket (also a reconnect on the same session token): it replaces the record.
  const stopPart = registerCatchUp(pointViewPart(deps, (sessionId, ids) => given.set(sessionId, new Set(ids))));
  app.addHook('onClose', async () => stopPart());

  deps.writer.addAfterCommit((appended) => {
    const sessions = wsHubFor(app)
      .connectedSessions()
      .flatMap((s) => {
        const point_id = s.kind === 'staff' ? devicePoint(s.deviceId) : null;
        return point_id === null ? [] : [{ sessionId: s.sessionId, point_id }];
      });
    const live = new Set(sessions.map((s) => s.sessionId));
    for (const id of given.keys()) if (!live.has(id)) given.delete(id);
    if (sessions.length === 0) return;
    const state = deps.state.get();
    if (!isEngineState(state)) return;
    const now = deps.clock.branchNow();

    // B3-3 (§6.16, v1.0.4): lines whose live units changed in this commit (memory), sent again to sockets holding them.
    const changed = new Set<string>();
    for (const e of appended) {
      if (UNIT_CHANGES.has(e.event_type)) changed.add((e.payload as { order_item_id: string }).order_item_id);
    }

    const byPoint = new Map<string, Set<string>>();
    const missing = new Map<string, string[]>();
    const all = new Set<string>();
    for (const s of sessions) {
      let shown = byPoint.get(s.point_id);
      if (shown === undefined) {
        shown = new Set(pointLineIds(state, s.point_id, now));
        for (const station_id of takeoverIdsOf(deps.db, s.point_id)) for (const id of stationShownIds(state, station_id)) shown.add(id);
        byPoint.set(s.point_id, shown);
      }
      const had = given.get(s.sessionId) ?? new Set<string>();
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
      const had = given.get(s.sessionId)!;
      for (const id of ids) had.add(id);
      if (lines.length === 0) continue;
      const frame: WsPointLines = { type: 'point_lines', point_id: s.point_id, lines };
      ws.sendToSessions([s.sessionId], frame);
    }
  });
}
