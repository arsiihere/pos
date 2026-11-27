import type { LineDetail } from '@pos/domain';
import { isOrderInEngine, priorityOfLine, stationView, type EngineState, type LinePriority } from '@pos/engine';
import type { KdsStationBody, PointOrderMeta, PointStation, WsPointLines, WsPointViewRefresh } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { buildLineDetails, devicePoint, pointOfLine } from '../kds/contracts.js';
import { bagReadyAtOf } from '../kds/exports.js';
import { screenStations } from '../kds/device-roles.js';
import { takeoverStations } from '../kds/presence.js';
import { stationHasPrinter } from '../print/api.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { registerCatchUp, type CatchUpPart } from './catch-up.js';
import { DEFAULT_SOUND_VOLUME, doneUndone, heldOfOrders, tableMovedOrderIds } from './kds-catch-up.js';
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
//   changes lines; 0 otherwise. ⚠️ Changed by v1.0.8 (owner 2026-11-13, Q-47): the lines of a moved / merged / split
//   seating are sent again (the table identifier), +1 statement in a commit with a table event. Registered after b18's kds_lines hook (lane order B3 → B6).
// - ⚠️ 03b v1.0.16 §6.15, §6.16 (run 3 R3-M-3): `stations` = the point's active default stations ∪ the stations of its
//   listed lines (routed ones too), in the catch-up (same settings read) and as `point_lines.stations` upserts for the
//   stations a socket newly references (one shared settings read per commit, only then); a held line the engine moved
//   to another station is sent again. `dark` stays the takeover at this point (takeover frames keep the default).

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

const LIVE = new Set(['added', 'cooking', 'done']);

/** B3-3: the events that change a line's live units (as ws/kds-catch-up.ts). */
const UNIT_CHANGES: ReadonlySet<string> = new Set(['ItemRemoved', 'ItemVoided', 'LineWeightSet']);

/**
 * Q-46: the engine line's serve group and mode, so the Pass computes Ready / HOLD (a return or released line is `immediate`).
 * ⚠️ 03b v1.0.13 §6.15, §6.16 (STAB-6, STAB-7): + `load_id` (the engine line's, set for a stored load before its fire
 * too; null off a batch station) and `priority` (the engine view's, 03a v1.2.10 §3.5.7 PR-8; null on a line that is
 * not priority), both memory.
 */
export type ServeFields = { group_id: string; serve_mode: 'sync' | 'immediate'; load_id: string | null; priority: LinePriority | null };
// ⚠️ 03b v1.0.12 §6.15 (STAB-5 Q5): started_at = the engine line's (null while waiting), so a grouped Done on the Pass
// sends the part that started last first
export type PointLine = LineDetail & ServeFields & { stage: 'added' | 'cooking' | 'done'; handed_over: boolean; started_at: number | null };
export interface PointViewBody {
  point_id: string;
  stations: PointStation[];
  // ⚠️ 03b v1.0.10 §6.15 (STAB-2): ready.lines = the Ready's unsettled own lines
  // ⚠️ 03b v1.0.16 §6.15 (run 3 R3-B-1, R3-M-5): + the order metadata (pickup_at_ms, boosted, pickup_readiness, no_station_lines)
  orders: Array<
    { order_id: string; identifier: LineDetail['identifier']; placed_at: number; lines: PointLine[]; ready: { at: number; by: string | null; lines: string[] } | null } & Omit<
      PointOrderMeta,
      'order_id'
    >
  >;
  takeovers: KdsStationBody[];
}

const serveOf = (state: EngineState, id: string, now: number, memo?: Map<string, number>): ServeFields => {
  const l = state.lines[id]!;
  return { group_id: l.group_id, serve_mode: l.serve_mode, load_id: l.load_id, priority: priorityOfLine(state, l, now, memo) ?? null };
};

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

// ⚠️ 03b v1.0.16 §3.4, §6.15 (run 3 R3-M-5): the live unserved non-deal station-less lines of pickup orders, one batched
// read (only when a listed order has a pickup time). A zone-served line is served at once, so it never shows.
const NO_STATION_SQL = `SELECT order_id, order_item_id, name AS item_name, units - removed_units - voided_units AS units FROM order_lines
  WHERE order_id IN (SELECT value FROM json_each(?)) AND station_id IS NULL AND line_kind <> 'deal' AND served_at IS NULL
    AND units - removed_units - voided_units > 0
  ORDER BY added_at, order_item_id`;

const ENGINE_OPEN = new Set(['added', 'cooking']);

/**
 * ⚠️ 03b v1.0.16 §3.4, §6.15 (run 3 R3-B-1, R3-M-5): a card's order metadata. `pickup_at_ms` and `boosted` are the
 * engine order's (Boost keeps the time, D1). A pickup card adds `pickup_readiness`: every live engine line of the order,
 * at any point, done or settled (`all_engine_lines_done`), and the station-less hold, the pickup time while a live
 * station-less line remains and the order is not boosted (else null; clients compare it with hub time); and its
 * `no_station_lines`. Engine facts are memory; 1 statement for the station-less lines, only with a pickup order.
 */
export function orderMetaOf(
  db: Database.Database,
  state: EngineState,
  order_ids: readonly string[],
  pairs: ReadonlyMap<string, { bag_ready_since: number; bag_ready_window_ms: number }>,
): Map<string, PointOrderMeta> {
  const pickups = order_ids.filter((id) => (state.orders[id]?.pickup_at_ms ?? null) !== null);
  const stationLess = new Map<string, PointOrderMeta['no_station_lines']>();
  if (pickups.length > 0) {
    const rows = db.prepare(NO_STATION_SQL).all(JSON.stringify(pickups)) as Array<{ order_id: string; order_item_id: string; item_name: string; units: number }>;
    for (const r of rows) {
      const list = stationLess.get(r.order_id) ?? [];
      list.push({ order_item_id: r.order_item_id, item_name: r.item_name, units: r.units });
      stationLess.set(r.order_id, list);
    }
  }
  const out = new Map<string, PointOrderMeta>();
  for (const order_id of order_ids) {
    const order = state.orders[order_id];
    if (order === undefined) continue;
    const pickup = order.pickup_at_ms;
    // ⚠️ 03b v1.0.16 §6.15 (R3-M-9): the R8 pair, given by the caller's batched read
    const pair = pairs.get(order_id);
    const bag = { bag_ready_since: pair?.bag_ready_since ?? null, bag_ready_window_ms: pair?.bag_ready_window_ms ?? null };
    if (pickup === null) {
      out.set(order_id, { order_id, pickup_at_ms: null, boosted: order.boosted, pickup_readiness: null, no_station_lines: [], ...bag });
      continue;
    }
    const lines = stationLess.get(order_id) ?? [];
    const all_engine_lines_done = order.line_ids.every((id) => {
      const l = state.lines[id];
      return l === undefined || !ENGINE_OPEN.has(l.stage);
    });
    out.set(order_id, {
      order_id,
      pickup_at_ms: pickup,
      boosted: order.boosted,
      pickup_readiness: { all_engine_lines_done, station_less_hold_until: order.boosted || lines.length === 0 ? null : pickup },
      no_station_lines: lines,
      ...bag,
    });
  }
  return out;
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
SELECT 'r' AS k, order_id AS id, ready_at AS at, ready_by AS by,
       (SELECT json_group_array(r.order_item_id) FROM pass_ready_lines r
         WHERE r.order_id = pass_orders.order_id AND r.point_id = pass_orders.point_id AND r.settled_at IS NULL) AS rl
  FROM pass_orders
 WHERE point_id = @point_id AND ready_at IS NOT NULL AND order_id IN (SELECT value FROM json_each(@orders))
UNION ALL
SELECT 'h' AS k, order_item_id AS id, NULL AS at, NULL AS by, NULL AS rl FROM handover_lines
 WHERE order_item_id IN (SELECT value FROM json_each(@lines))
UNION ALL
SELECT 'b' AS k, order_id AS id, bag_ready_since AS at, NULL AS by, bag_ready_window_ms AS rl FROM pass_bag_ready
 WHERE order_id IN (SELECT value FROM json_each(@orders))`;

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

const NO_SETTINGS: SettingsRow = { station_id: '', sound_volume: null, lane_count: null, lanes_on: null, has_lanes: 0, labelled: 0 };

/** One settings + lanes read for `ids` (0 statements when empty). */
function settingsOf(db: Database.Database, ids: readonly string[]): Map<string, SettingsRow> {
  return new Map((ids.length === 0 ? [] : (db.prepare(SETTINGS_SQL).all(JSON.stringify(ids)) as SettingsRow[])).map((r) => [r.station_id, r]));
}

/**
 * ⚠️ 03b v1.0.16 §6.15, §6.16 (run 3 R3-M-3): the stations of a point's cards — its active default stations and every
 * station a listed line is on (a routed line's station whose default is elsewhere, an archived station with outstanding
 * work), in config order, then any id the config no longer lists (memory).
 */
function cardStationIds(state: EngineState, point_id: string, lineIds: readonly string[]): string[] {
  const config = branchConfig()?.stations ?? [];
  const wanted = new Set(config.filter((s) => s.point_id === point_id && !s.is_archived).map((s) => s.station_id));
  for (const id of lineIds) wanted.add(state.lines[id]!.station_id);
  const ordered = config.map((s) => s.station_id).filter((id) => wanted.has(id));
  const known = new Set(ordered);
  return [...ordered, ...[...wanted].filter((id) => !known.has(id)).sort()];
}

/** A card station (§6.15 shape): `dark` = under takeover at this point (§3.6, the effective default); memory over `settings`. */
function cardStation(station_id: string, settings: ReadonlyMap<string, SettingsRow>, takeovers: readonly string[]): PointStation {
  return {
    station_id,
    name: branchConfig()?.stations.find((s) => s.station_id === station_id)?.name ?? station_id,
    lanes: lanesOf(settings.get(station_id) ?? NO_SETTINGS),
    dark: takeovers.includes(station_id),
    // Q-45 (§3.1): no paired, unrevoked kds device (memory, 0 statements); refreshed with the device maps.
    screenless: !screenStations().has(station_id),
  };
}

/** §6.15: the `point_view` body; 4 statements (5 with a pickup order, §6.15 run 3). */
export function pointViewBody(db: Database.Database, state: EngineState, point_id: string, now: number): PointViewBody {
  const lineIds = pointLineIds(state, point_id, now);
  const stationIds = cardStationIds(state, point_id, lineIds);
  const takeovers = takeoverIdsOf(db, point_id);
  // one read for the card stations and the takeover stations together
  const settings = settingsOf(db, [...new Set([...stationIds, ...takeovers])]);
  const views = new Map(takeovers.map((id) => [id, stationView(state, id, now)]));
  const takeoverLineIds = [...views.values()].flatMap((v) => [...v.now, ...v.next].map((l) => l.order_item_id));
  const details = buildLineDetails(db, state, [...new Set([...lineIds, ...takeoverLineIds])]);

  const orderIds = [...new Set(lineIds.map((id) => state.lines[id]!.order_id))];
  const ready = new Map<string, { at: number; by: string | null; lines: string[] }>();
  const handed = new Set<string>();
  const pairs = new Map<string, { bag_ready_since: number; bag_ready_window_ms: number }>();
  if (orderIds.length > 0) {
    const rows = db.prepare(PASS_SQL).all({ point_id, orders: JSON.stringify(orderIds), lines: JSON.stringify(lineIds) }) as Array<{
      k: 'r' | 'h' | 'b';
      id: string;
      at: number | null;
      by: string | null;
      rl: string | number | null;
    }>;
    for (const r of rows) {
      if (r.k === 'r') ready.set(r.id, { at: r.at!, by: r.by, lines: JSON.parse(String(r.rl ?? '[]')) as string[] });
      else if (r.k === 'b') pairs.set(r.id, { bag_ready_since: r.at!, bag_ready_window_ms: Number(r.rl) });
      else handed.add(r.id);
    }
  }

  const lineSet = new Set(lineIds);
  const memo = new Map<string, number>();
  const meta = orderMetaOf(db, state, orderIds, pairs);
  const orders: PointViewBody['orders'] = [];
  for (const order_id of orderIds) {
    const order = state.orders[order_id]!;
    const lines = order.line_ids.flatMap((id): PointLine[] => {
      const d = details.get(id);
      if (!lineSet.has(id) || d === undefined) return [];
      return [{ ...d, ...serveOf(state, id, now, memo), stage: state.lines[id]!.stage as PointLine['stage'], handed_over: handed.has(id), started_at: state.lines[id]!.started_at }];
    });
    if (lines.length === 0) continue;
    const { order_id: _id, ...m } = meta.get(order_id)!;
    void _id;
    orders.push({ order_id, identifier: lines[0]!.identifier, placed_at: order.placed_at, lines, ready: ready.get(order_id) ?? null, ...m });
  }
  orders.sort((a, b) => a.placed_at - b.placed_at || (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0));

  const dayOpen = state.business_day !== null && state.business_day.closed_at === null;
  // ⚠️ Changed by 03b v1.0.6 (owner 2026-11-12, Q-20): a takeover body is a kds_station body, so it carries has_printer
  // (03c stationHasPrinter): 1 statement for every takeover station together, 0 without a takeover (§6.15 "+1").
  const printing = stationHasPrinter(db, takeovers);
  return {
    point_id,
    stations: stationIds.map((id) => cardStation(id, settings, takeovers)),
    orders,
    takeovers: takeovers.map((station_id): KdsStationBody => {
      const view = views.get(station_id)!;
      const s = settings.get(station_id) ?? NO_SETTINGS;
      return {
        station_id,
        day_open: dayOpen,
        sound_volume: s.sound_volume ?? DEFAULT_SOUND_VOLUME,
        has_printer: printing.has(station_id),
        lanes: lanesOf(s),
        now: view.now.flatMap((l) => {
          const d = details.get(l.order_item_id);
          // ⚠️ 03b v1.0.13 §3.3 (STAB-6, STAB-7): + load_id and priority, as kdsStationBody (a takeover body is one)
          return d === undefined
            ? []
            : [{ ...d, stage: l.stage, fired_at: l.fired_at, started_at: l.started_at, mark: l.mark, done_undone: doneUndone(state, l.order_item_id), load_id: l.load_id, priority: l.priority ?? null }];
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

/** ⚠️ 03b v1.0.16 §6.16 (R3-M-5): the metadata a socket was given, per order (its JSON), to send only changes. */
const metaKey = (m: PointOrderMeta): string => JSON.stringify(m);

export function pointViewPart(
  deps: Pick<HubDeps, 'clock'>,
  onBuilt?: (sessionId: string, ids: readonly string[], meta: ReadonlyMap<string, string>, body: PointViewBody) => void,
): CatchUpPart {
  return {
    part: 'point_view',
    appliesTo: (socket) => socket.kind === 'staff' && devicePoint(socket.deviceId) !== null,
    build: (db, raw, socket) => {
      const point_id = devicePoint(socket.deviceId);
      if (!isEngineState(raw) || point_id === null) return null;
      const body = pointViewBody(db, raw, point_id, deps.clock.branchNow());
      const meta = new Map(
        body.orders.map((o) => [
          o.order_id,
          metaKey({
            order_id: o.order_id,
            pickup_at_ms: o.pickup_at_ms,
            boosted: o.boosted,
            pickup_readiness: o.pickup_readiness,
            no_station_lines: o.no_station_lines,
            bag_ready_since: o.bag_ready_since,
            bag_ready_window_ms: o.bag_ready_window_ms,
          }),
        ]),
      );
      onBuilt?.(socket.sessionId, bodyIds(body), meta, body);
      return body;
    },
  };
}

/** Called once per server from lane B6's register(). */
export function registerPointCatchUp(app: FastifyInstance, deps: HubDeps): void {
  const given = new Map<string, Set<string>>();
  givenByDb.set(deps.db, given);
  // ⚠️ 03b v1.0.16 §6.16 (R3-M-5): per Pass socket, order → the metadata it holds (catch-up or an earlier frame)
  const metaGiven = new Map<string, Map<string, string>>();
  // ⚠️ 03b v1.0.16 §6.16 (run 3 R3-M-3): per Pass socket, the card stations it holds, and the station each held line
  // was on when its details were given (an engine station change sends the line again)
  const stationsGiven = new Map<string, Set<string>>();
  const lineStation = new Map<string, Map<string, string>>();
  const holdView = (sessionId: string, view: PointViewBody | null): void => {
    stationsGiven.set(sessionId, new Set(view === null ? [] : view.stations.map((st) => st.station_id)));
    const at = new Map<string, string>();
    for (const o of view?.orders ?? []) for (const l of o.lines) at.set(l.order_item_id, l.station_id);
    for (const t of view?.takeovers ?? []) for (const l of [...t.now, ...t.details]) at.set(l.order_item_id, l.station_id);
    lineStation.set(sessionId, at);
  };
  // A catch-up starts a new socket (also a reconnect on the same session token): it replaces the record.
  const stopPart = registerCatchUp(
    pointViewPart(deps, (sessionId, ids, meta, body) => {
      given.set(sessionId, new Set(ids));
      metaGiven.set(sessionId, new Map(meta));
      holdView(sessionId, body);
    }),
  );
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
    for (const id of metaGiven.keys()) if (!live.has(id)) metaGiven.delete(id);
    for (const id of stationsGiven.keys()) if (!live.has(id)) stationsGiven.delete(id);
    for (const id of lineStation.keys()) if (!live.has(id)) lineStation.delete(id);
    if (sessions.length === 0) return;
    const state = deps.state.get();
    if (!isEngineState(state)) return;
    const now = deps.clock.branchNow();

    // ⚠️ 03b v1.0.16 §6.16 (run 3 R3-M-1): a commit holding D7 Pass archive moves refreshes the Pass sockets at every
    // moved-from and moved-to point: the full view of a receiving point, null on an archived one (moves only leave
    // archived points). The refresh replaces the socket's held ids and metadata and supersedes this commit's frames.
    const refreshed = new Set<string>();
    const movesIn = appended.filter((e) => e.event_type === 'PassPointLinesMoved');
    if (movesIn.length > 0) {
      const retired = new Set<string>();
      const affected = new Set<string>();
      for (const e of movesIn) {
        for (const m of (e.payload as { moves: Array<{ from_point_id: string; to_point_id: string }> }).moves) {
          retired.add(m.from_point_id);
          affected.add(m.from_point_id);
          affected.add(m.to_point_id);
        }
      }
      const as_of_seq = appended[appended.length - 1]!.seq;
      const views = new Map<string, PointViewBody>();
      const ws = wsHubFor(app);
      for (const s of sessions) {
        if (!affected.has(s.point_id)) continue;
        let view: PointViewBody | null = null;
        if (!retired.has(s.point_id)) {
          view = views.get(s.point_id) ?? pointViewBody(deps.db, state, s.point_id, now);
          views.set(s.point_id, view);
        }
        given.set(s.sessionId, new Set(view === null ? [] : bodyIds(view)));
        metaGiven.set(s.sessionId, new Map());
        holdView(s.sessionId, view);
        refreshed.add(s.sessionId);
        const frame: WsPointViewRefresh = { type: 'point_view_refresh', as_of_seq, view: view as unknown as Record<string, unknown> | null };
        ws.sendToSessions([s.sessionId], frame);
      }
    }

    // B3-3 (§6.16, v1.0.4): lines whose live units changed in this commit (memory), sent again to sockets holding them.
    const changed = new Set<string>();
    for (const e of appended) {
      if (UNIT_CHANGES.has(e.event_type)) changed.add((e.payload as { order_item_id: string }).order_item_id);
    }

    // Q-47 (§6.16): the orders of the seatings a table event of this commit touched (1 statement, only with such an event).
    const moved = tableMovedOrderIds(deps.db, appended);

    // ⚠️ 03b v1.0.16 §6.16 (R3-M-5): the orders this commit named (OrderBoosted, cooking or settlement at any point,
    // additions, returns, PassBagReadyChanged: all on the order stream); their metadata goes to every Pass showing them
    const named = new Set(appended.filter((e) => e.stream_type === 'order').map((e) => e.stream_id));
    const byPoint = new Map<string, Set<string>>();
    const ordersAt = new Map<string, Set<string>>();
    const cardsAt = new Map<string, string[]>();
    const missing = new Map<string, string[]>();
    const all = new Set<string>();
    const metaWanted = new Set<string>();
    // ⚠️ R3-M-3: the card stations each socket gains in this commit, and all of them (one settings read)
    const stationsMissing = new Map<string, string[]>();
    const allStations = new Set<string>();
    for (const s of sessions) {
      if (refreshed.has(s.sessionId)) continue;
      let shown = byPoint.get(s.point_id);
      if (shown === undefined) {
        const own = pointLineIds(state, s.point_id, now);
        ordersAt.set(s.point_id, new Set(own.map((id) => state.lines[id]!.order_id)));
        cardsAt.set(s.point_id, cardStationIds(state, s.point_id, own));
        shown = new Set(own);
        for (const station_id of takeoverIdsOf(deps.db, s.point_id)) for (const id of stationShownIds(state, station_id)) shown.add(id);
        byPoint.set(s.point_id, shown);
      }
      for (const order_id of ordersAt.get(s.point_id)!) if (named.has(order_id)) metaWanted.add(order_id);
      const had = given.get(s.sessionId) ?? new Set<string>();
      for (const id of had) if (!shown.has(id)) had.delete(id);
      given.set(s.sessionId, had);
      // ⚠️ R3-M-3: a station neither a current default nor on a listed line is dropped from the held set (the client
      // drops it from its cards); one newly referenced is sent
      const cards = cardsAt.get(s.point_id)!;
      const heldStations = stationsGiven.get(s.sessionId) ?? new Set<string>();
      for (const id of heldStations) if (!cards.includes(id)) heldStations.delete(id);
      stationsGiven.set(s.sessionId, heldStations);
      const newStations = cards.filter((id) => !heldStations.has(id));
      if (newStations.length > 0) {
        stationsMissing.set(s.sessionId, newStations);
        for (const id of newStations) allStations.add(id);
      }
      const gained = [...shown].filter((id) => !had.has(id));
      // Held and still shown (pruned above) with changed units → sent again.
      const resend = [...changed].filter((id) => had.has(id));
      // ⚠️ R3-M-3: held lines the engine moved to another station → sent again
      let at = lineStation.get(s.sessionId);
      if (at === undefined) lineStation.set(s.sessionId, (at = new Map()));
      for (const id of at.keys()) if (!had.has(id)) at.delete(id);
      const restation: string[] = [];
      for (const id of had) {
        const now_at = state.lines[id]?.station_id;
        if (now_at === undefined) continue;
        const was = at.get(id);
        if (was === undefined) at.set(id, now_at); // given by a takeover start view: recorded from here
        else if (was !== now_at) restation.push(id);
      }
      const send = [...new Set([...gained, ...resend, ...restation, ...heldOfOrders(state, had, moved)])].sort();
      if (send.length === 0) continue;
      missing.set(s.sessionId, send);
      for (const id of send) all.add(id);
    }
    if (all.size === 0 && metaWanted.size === 0 && allStations.size === 0) return;

    const details = all.size === 0 ? new Map<string, LineDetail>() : buildLineDetails(deps.db, state, [...all]);
    // §6.15 metadata of the named orders shown anywhere (1 statement, only with a pickup order among them)
    // + the R8 pair of the named takeaway / parking orders (1 statement, only with one among them)
    const counterOrders = [...metaWanted].filter((id) => ['takeaway', 'parking'].includes(state.orders[id]?.order_type ?? ''));
    const pairs = counterOrders.length === 0 ? new Map<string, { bag_ready_since: number; bag_ready_window_ms: number }>() : bagReadyAtOf(deps.db, counterOrders);
    const meta = metaWanted.size === 0 ? new Map<string, PointOrderMeta>() : orderMetaOf(deps.db, state, [...metaWanted], pairs);
    // ⚠️ R3-M-3: one shared settings read across the stations gained in this commit (0 without one)
    const stationSettings = settingsOf(deps.db, [...allStations]);
    const ws = wsHubFor(app);
    const memo = new Map<string, number>();
    for (const s of sessions) {
      if (refreshed.has(s.sessionId)) continue;
      const ids = missing.get(s.sessionId) ?? [];
      const lines = ids.flatMap((id) => {
        const d = details.get(id);
        return d === undefined || state.lines[id] === undefined ? [] : [{ ...d, ...serveOf(state, id, now, memo) }];
      });
      const had = given.get(s.sessionId)!;
      const at = lineStation.get(s.sessionId)!;
      for (const id of ids) {
        had.add(id);
        const d = details.get(id);
        if (d !== undefined) at.set(id, d.station_id);
      }
      const newStations = stationsMissing.get(s.sessionId) ?? [];
      const takeovers = newStations.length === 0 ? [] : takeoverIdsOf(deps.db, s.point_id);
      const stations = newStations.map((id) => cardStation(id, stationSettings, takeovers));
      for (const id of newStations) stationsGiven.get(s.sessionId)!.add(id);
      // metadata the socket does not hold yet (a newly shown order, or a change), for orders this commit named
      let heldMeta = metaGiven.get(s.sessionId);
      if (heldMeta === undefined) metaGiven.set(s.sessionId, (heldMeta = new Map()));
      for (const order_id of heldMeta.keys()) if (!ordersAt.get(s.point_id)!.has(order_id)) heldMeta.delete(order_id);
      const orders: PointOrderMeta[] = [];
      for (const order_id of ordersAt.get(s.point_id)!) {
        const m = meta.get(order_id);
        if (m === undefined) continue;
        const key = metaKey(m);
        if (heldMeta.get(order_id) === key) continue;
        heldMeta.set(order_id, key);
        orders.push(m);
      }
      if (lines.length === 0 && orders.length === 0 && stations.length === 0) continue;
      // stations first: the client applies the upserts before the lines (§6.16 R3-M-3)
      const frame: WsPointLines = { type: 'point_lines', point_id: s.point_id, ...(stations.length === 0 ? {} : { stations }), lines, ...(orders.length === 0 ? {} : { orders }) };
      ws.sendToSessions([s.sessionId], frame);
    }
  });
}
