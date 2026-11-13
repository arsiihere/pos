import type { EngineState } from '@pos/engine';
import type { PosEvent } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import { devicePoint, pointOfLine } from '../kds/contracts.js';
import { takeoverStations } from '../kds/presence.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { registerEventAudience } from './audience.js';
import type { SocketCtx } from './catch-up.js';

// 03b §6.17 (task b22): event audiences, all memory (0 statements).
// - Line events → the station sockets of the line's station; the staff sockets whose devicePoint is the line's point
//   (pointOfLine, §3.1); the staff sockets of the station's point while that station is under takeover (§3.6).
// - Pass events (ReadyToServe, ReadyToServeUndone, Handover, ReadyRetargeted) → the staff sockets of the payload's point.
// G-10: audiences are OR-ed (ws/audience.ts), so 03b only adds sockets; 02b / 03a already send ItemRemoved, ItemVoided,
// ItemServed, OrderBoosted, ItemsReleased and StationCapacitySet wider — accepted. The sets above are 03b's minimum,
// not exact: 02b v1.0.11 H1 also sends ItemStarted, ItemDone, ItemDoneUndone, FireDispatched to every staff socket and
// kiosk (03b v1.0.8 §6.17, Q-49).
// Config frames (Q-44, 03b v1.0.8 §6.17): LanesSet → every staff and station socket; StationScreenSet → the station
// sockets of its station; BusinessDayOpened / BusinessDayClosed → also the station sockets, additive to 01a's staff
// audience (owner ruling Q-62 = a; 01a §4.5 / test 73 contradicted on purpose). DeviceRoleSet has no audience (§3.8).
// The line → (station, point) facts come from a memory map refreshed after every commit from the engine state (before
// that commit's publish), so a line the same commit removed from the state (an order that left the engine) still finds
// its station; an entry missing from the state is dropped one commit later (its events have been published by then).

export const KDS_LINE_EVENT_TYPES = [
  'ItemStarted',
  'ItemDone',
  'ItemDoneUndone',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'OrderBoosted',
  'ItemsReleased',
  'FireDispatched',
  'StationCapacitySet',
] as const;

export const KDS_PASS_EVENT_TYPES = ['ReadyToServe', 'ReadyToServeUndone', 'Handover', 'ReadyRetargeted'] as const;

interface LineFacts {
  station_id: string;
  point_id: string | null;
  order_id: string;
}

const isEngineState = (s: unknown): s is EngineState =>
  typeof s === 'object' && s !== null && typeof (s as Partial<EngineState>).stations === 'object' && typeof (s as Partial<EngineState>).lines === 'object';

const stationPointOf = (station_id: string): string | null => branchConfig()?.stations.find((s) => s.station_id === station_id)?.point_id ?? null;

/** Called once per server from lane B6's register(); the audiences are removed on close. */
export function registerKdsAudiences(app: FastifyInstance, deps: Pick<HubDeps, 'db' | 'state' | 'writer'>): void {
  const lines = new Map<string, LineFacts>();
  const gone = new Set<string>();
  const refresh = (): void => {
    const state = deps.state.get();
    if (!isEngineState(state)) return;
    for (const id of gone) if (state.lines[id] === undefined) lines.delete(id);
    gone.clear();
    for (const id of lines.keys()) if (state.lines[id] === undefined) gone.add(id);
    for (const id in state.lines) {
      const l = state.lines[id]!;
      lines.set(id, { station_id: l.station_id, point_id: pointOfLine(state, id), order_id: l.order_id });
    }
  };
  refresh();
  deps.writer.addAfterCommit(refresh);

  /** The (station, point) pairs an event's lines name; memory. */
  const targetsOf = (event: PosEvent): Array<{ station_id: string; point_id: string | null }> => {
    const p = event.payload as Record<string, unknown>;
    const ids: string[] = [];
    if (typeof p.order_item_id === 'string') ids.push(p.order_item_id);
    for (const key of ['order_item_ids', 'released', 'expedite']) {
      const list = p[key];
      if (Array.isArray(list)) for (const id of list) if (typeof id === 'string') ids.push(id);
    }
    if (event.event_type === 'OrderBoosted' && typeof p.order_id === 'string') {
      for (const [id, f] of lines) if (f.order_id === p.order_id) ids.push(id);
    }
    const out = ids.flatMap((id) => {
      const f = lines.get(id);
      return f === undefined ? [] : [{ station_id: f.station_id, point_id: f.point_id }];
    });
    // FireDispatched / StationCapacitySet name their station on the payload (StationCapacitySet has no line).
    if (typeof p.station_id === 'string' && !out.some((t) => t.station_id === p.station_id)) {
      out.push({ station_id: p.station_id, point_id: event.event_type === 'StationCapacitySet' ? stationPointOf(p.station_id) : null });
    }
    return out;
  };

  const cache = new WeakMap<PosEvent, Array<{ station_id: string; point_id: string | null }>>();
  const lineAudience = (event: PosEvent, socket: SocketCtx): boolean => {
    let targets = cache.get(event);
    if (targets === undefined) cache.set(event, (targets = targetsOf(event)));
    if (targets.length === 0) return false;
    if (socket.kind === 'station') return socket.stationId !== null && targets.some((t) => t.station_id === socket.stationId);
    const point = devicePoint(socket.deviceId);
    if (point === null) return false;
    if (targets.some((t) => t.point_id === point)) return true;
    const takeover = takeoverStations(deps.db);
    return targets.some((t) => takeover.has(t.station_id) && takeover.get(t.station_id) === point);
  };

  const passAudience = (event: PosEvent, socket: SocketCtx): boolean => {
    const point_id = (event.payload as { point_id?: unknown }).point_id;
    return socket.kind === 'staff' && typeof point_id === 'string' && devicePoint(socket.deviceId) === point_id;
  };

  const stops = [
    ...KDS_LINE_EVENT_TYPES.map((t) => registerEventAudience(t, lineAudience)),
    ...KDS_PASS_EVENT_TYPES.map((t) => registerEventAudience(t, passAudience)),
    registerEventAudience('LanesSet', (_e, s) => s.kind === 'staff' || s.kind === 'station'),
    registerEventAudience('StationScreenSet', (e, s) => s.kind === 'station' && s.stationId === (e.payload as { station_id?: unknown }).station_id),
    registerEventAudience('BusinessDayOpened', (_e, s) => s.kind === 'station'),
    registerEventAudience('BusinessDayClosed', (_e, s) => s.kind === 'station'),
  ];
  app.addHook('onClose', async () => {
    for (const stop of stops) stop();
  });
}
