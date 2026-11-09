/// <reference types="node" />
import type { DeviceType } from '@pos/domain';
import {
  WS_CLOSE,
  WsClientMessage,
  WsAlertsOpen,
  WsReceipt,
  type PosEvent,
  type WsAlert,
  type WsAlertClosed,
  type WsAlertSeen,
  type WsBindingRoute,
  type WsServerMessage,
} from '@pos/events';
import websocket from '@fastify/websocket';
import type Database from 'better-sqlite3';
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import { activity, findSessionByToken, idlePause, isIdleExpired } from '../auth/session-store.js';
import { provisionedOf } from '../config/schema.js';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import { audienceAllows } from './audience.js';
import { buildCatchUpState, type SocketCtx } from './catch-up.js';

const AUTH_MS = 5_000;
const PING_MS = 15_000;
const PONG_MS = 30_000;
// 00 v1.6 H-1: a newer alert-mode auth for the same device replaces this socket.
const ALERT_REPLACED = 4409;
// A builder (alerts_open, catch-up) failed: RFC 6455 "internal error"; no WS_CLOSE code fits.
const INTERNAL_ERROR = 1011;

// §6.21: after alerts_open an alert-mode socket gets alert frames only (binding_route: 01d P-6 / AD-4).
export type AlertModeFrame = WsAlert | WsAlertSeen | WsAlertClosed | WsBindingRoute;

export interface ConnectedSession {
  staffId: string | null;
  deviceId: string;
  sessionId: string;
  kind: 'staff' | 'station';
}

export interface WsHub {
  publish(events: PosEvent[]): void;
  // H-4: after commit only. Every socket of the device: staff, station and (01d) alert mode.
  // Callers send only frames that are valid on all of them (alert frames); the type stays wide for 00's use.
  sendToDevices(deviceIds: string[], frame: WsServerMessage): void;
  // H-4: staff-session sockets only.
  sendToStaff(staffIds: string[], frame: WsServerMessage): void;
  // 01d §6 batch 3 (task 20): the session sockets (staff or station) of these session ids only; alert
  // frames carry a per-recipient `set` / `for_staff_id` and hiding works per session.
  sendToSessions(sessionIds: string[], frame: WsServerMessage): void;
  // H-4: from the in-memory socket list, no statement.
  connectedSessions(): ConnectedSession[];
  // H-1: the alert-mode list, never part of connectedSessions() or deliver().
  alertSockets(): Array<{ deviceId: string; deviceType: DeviceType }>;
  // H-1: alert-mode sockets of these devices only.
  sendToAlertMode(deviceIds: string[], frame: AlertModeFrame): void;
  // H-1: a valid `receipt` frame from a session socket or an alert-mode socket.
  onReceipt(fn: ReceiptListener): void;
  // H-1: the first frame of an alert-mode socket; default { alerts: [], binding_route_until: null }.
  setAlertsOpen(fn: (deviceId: string) => WsAlertsOpen): void;
}

export interface ReceiptFrom {
  deviceId: string;
  sessionId: string | null;
  staffId: string | null;
  mode: 'session' | 'alert';
}

export type ReceiptListener = (from: ReceiptFrom, msg: WsReceipt) => void;

interface HubSocket {
  send(data: string): void;
  ping(): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: { toString(): string } | Array<{ toString(): string }>) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'pong', listener: () => void): void;
}

interface OpenSocket {
  socket: HubSocket;
  ctx: SocketCtx;
  lastAck?: number;
}

interface AlertSocket {
  socket: HubSocket;
  deviceId: string;
  deviceType: DeviceType;
  remoteAddress: string;
}

// Alert mode (H-1) lives outside the session list: no deliver(), audiences or catch-up.
interface AlertMode {
  open: Map<string, AlertSocket>;
  receipts: ReceiptListener[];
  buildOpen: (deviceId: string) => WsAlertsOpen;
}

interface SocketClose {
  code: number;
  reason?: string;
}

const publishers = new WeakMap<FastifyInstance, (events: PosEvent[]) => void>();
const hubs = new WeakMap<FastifyInstance, WsHub>();

export function publisherFor(app: FastifyInstance): ((events: PosEvent[]) => void) | undefined {
  return publishers.get(app);
}

// P-5: modules reach 00's socket hub through this, like publisherFor.
export function wsHubFor(app: FastifyInstance): WsHub {
  const hub = hubs.get(app);
  if (hub === undefined) throw new Error('registerWs has not run on this app');
  return hub;
}

export function registerWs(app: FastifyInstance, deps: HubDeps): WsHub {
  const open: OpenSocket[] = [];
  const alerts: AlertMode = {
    open: new Map(),
    receipts: [],
    buildOpen: () => ({ type: 'alerts_open', alerts: [], binding_route_until: null }),
  };
  const branchId = deps.config.provisioned?.branch_id ?? '';
  const hub: WsHub = {
    publish(events) {
      deliver(open, events);
    },
    sendToDevices(deviceIds, frame) {
      const wanted = new Set(deviceIds);
      const body = JSON.stringify(frame);
      for (const socket of socketsOfDevices(open, alerts.open, wanted)) socket.send(body);
    },
    sendToStaff(staffIds, frame) {
      const wanted = new Set(staffIds);
      const body = JSON.stringify(frame);
      for (const live of open) {
        if (live.ctx.kind === 'staff' && live.ctx.staffId !== null && wanted.has(live.ctx.staffId)) {
          live.socket.send(body);
        }
      }
    },
    sendToSessions(sessionIds, frame) {
      const wanted = new Set(sessionIds);
      const body = JSON.stringify(frame);
      for (const live of open) if (wanted.has(live.ctx.sessionId)) live.socket.send(body);
    },
    connectedSessions() {
      return open.map(({ ctx }) => ({
        staffId: ctx.staffId,
        deviceId: ctx.deviceId,
        sessionId: ctx.sessionId,
        kind: ctx.kind,
      }));
    },
    alertSockets() {
      return [...alerts.open.values()].map(({ deviceId, deviceType }) => ({ deviceId, deviceType }));
    },
    sendToAlertMode(deviceIds, frame) {
      const body = JSON.stringify(frame);
      for (const deviceId of new Set(deviceIds)) alerts.open.get(deviceId)?.socket.send(body);
    },
    onReceipt(fn) {
      alerts.receipts.push(fn);
    },
    setAlertsOpen(fn) {
      alerts.buildOpen = fn;
    },
  };
  // §3.7 revoke / rotation: alert-mode sockets get no event frames, so 00's closeFor never sees them.
  // This runs after commit and before publish; no frame is sent first.
  deps.writer.addAfterCommit((appended) => closeAlertSockets(alerts, appended));
  publishers.set(app, hub.publish);
  hubs.set(app, hub);
  app.register(websocket, {
    preClose(done) {
      const server = app.websocketServer;
      for (const client of server.clients) client.close(WS_CLOSE.RESTARTING);
      server.close(() => undefined);
      done();
    },
  });
  app.after(() => {
    app.get('/ws', { websocket: true, config: { group: 'ws' } }, (socket, request) => {
      accept(socket, request, deps, branchId, open, alerts);
    });
  });
  return hub;
}

// The one place that resolves "every socket of a device" (H-4): staff, station and alert mode (H-1).
function socketsOfDevices(open: OpenSocket[], alertOpen: Map<string, AlertSocket>, deviceIds: Set<string>): HubSocket[] {
  const sockets: HubSocket[] = [];
  for (const live of open) if (deviceIds.has(live.ctx.deviceId)) sockets.push(live.socket);
  for (const deviceId of deviceIds) {
    const alert = alertOpen.get(deviceId);
    if (alert !== undefined) sockets.push(alert.socket);
  }
  return sockets;
}

// One close per socket per commit; DeviceRevoked (4403) wins over DeviceTokenRotated (4401).
function closeAlertSockets(alerts: AlertMode, appended: PosEvent[]): void {
  const closing = new Map<string, number>();
  for (const event of appended) {
    if (event.event_type !== 'DeviceRevoked' && event.event_type !== 'DeviceTokenRotated') continue;
    const deviceId = String(event.payload.device_id);
    if (!alerts.open.has(deviceId)) continue;
    if (event.event_type === 'DeviceRevoked') closing.set(deviceId, WS_CLOSE.FORBIDDEN);
    else if (!closing.has(deviceId)) closing.set(deviceId, WS_CLOSE.CREDENTIALS);
  }
  for (const [deviceId, code] of closing) {
    const alert = alerts.open.get(deviceId);
    if (alert === undefined) continue;
    alerts.open.delete(deviceId);
    alert.socket.close(code);
  }
}

function emitReceipt(alerts: AlertMode, log: FastifyBaseLogger, from: ReceiptFrom, msg: WsReceipt): void {
  for (const listener of alerts.receipts) {
    try {
      listener(from, msg);
    } catch (err) {
      log.error({ err, device_id: from.deviceId, alert_id: msg.alert_id }, 'ws receipt listener failed');
    }
  }
}

function deliver(open: OpenSocket[], events: PosEvent[]): void {
  const closing = new Map<OpenSocket, SocketClose>();
  for (const event of events) {
    const body = JSON.stringify({
      type: 'event',
      seq: event.seq,
      event: {
        event_id: event.event_id,
        event_type: event.event_type,
        schema_version: event.schema_version,
        payload: event.payload,
      },
    });
    for (const live of open) {
      if (event.seq <= live.ctx.asOfSeq || !audienceAllows(event, live.ctx)) continue;
      live.socket.send(body);
      const next = closeFor(event, live.ctx);
      if (next === undefined) continue;
      const prev = closing.get(live);
      if (prev === undefined || next.code === WS_CLOSE.FORBIDDEN) closing.set(live, next);
    }
  }
  for (const [live, action] of closing) live.socket.close(action.code, action.reason);
}

function closeFor(event: PosEvent, socket: SocketCtx): SocketClose | undefined {
  if (event.event_type === 'SessionEnded' && event.payload.session_id === socket.sessionId) {
    return { code: WS_CLOSE.CREDENTIALS, reason: String(event.payload.reason) };
  }
  if (event.event_type === 'DeviceTokenRotated' && event.payload.device_id === socket.deviceId) {
    return { code: WS_CLOSE.CREDENTIALS };
  }
  if (event.event_type === 'DeviceRevoked' && event.payload.device_id === socket.deviceId) {
    return { code: WS_CLOSE.FORBIDDEN };
  }
  return undefined;
}

function accept(
  socket: HubSocket,
  request: FastifyRequest,
  deps: HubDeps,
  branchId: string,
  open: OpenSocket[],
  alerts: AlertMode,
): void {
  if (request.wsClose !== undefined) {
    socket.close(request.wsClose);
    return;
  }
  let decided = false;
  let live: OpenSocket | undefined;
  let alertLive: AlertSocket | undefined;
  let stopKeepalive = (): void => undefined;
  // 00 M95: the device whose open-socket count this socket holds, once accepted (session or alert mode).
  let counted: string | undefined;
  const timer = setTimeout(() => {
    if (decided) return;
    decided = true;
    socket.close(WS_CLOSE.CREDENTIALS);
  }, AUTH_MS);
  socket.on('close', () => {
    clearTimeout(timer);
    stopKeepalive();
    if (counted !== undefined) idlePause.socketClosed(deps.db, counted, deps.clock.branchNow());
    // A replaced or closed-by-hub alert socket already left the map; never remove its successor.
    if (alertLive !== undefined && alerts.open.get(alertLive.deviceId) === alertLive) alerts.open.delete(alertLive.deviceId);
    if (live === undefined) return;
    const index = open.indexOf(live);
    if (index >= 0) open.splice(index, 1);
  });
  socket.on('message', (data) => {
    const json = readJson(data);
    if (alertLive !== undefined) {
      onAlertFrame(alerts, alertLive, request.log, json);
      return;
    }
    const parsed = WsClientMessage.safeParse(json);
    if (live !== undefined) {
      // H-1: an invalid frame on a session socket (a malformed receipt included) is ignored.
      if (!parsed.success) return;
      if (parsed.data.type === 'ack') live.lastAck = parsed.data.last_seq;
      if (parsed.data.type === 'receipt') {
        const { deviceId, sessionId, staffId } = live.ctx;
        emitReceipt(alerts, request.log, { deviceId, sessionId, staffId, mode: 'session' }, parsed.data);
      }
      return;
    }
    if (decided) return;
    decided = true;
    clearTimeout(timer);
    if (!parsed.success || parsed.data.type !== 'auth') {
      socket.close(WS_CLOSE.CREDENTIALS);
      return;
    }
    if (parsed.data.session_token === undefined) {
      const accepted = acceptAlertMode(socket, request, deps, alerts, parsed.data.device_token);
      if (accepted === undefined) return;
      alertLive = accepted;
      counted = accepted.deviceId;
      idlePause.socketOpened(deps.db, accepted.deviceId);
      // H-13 (§6.17): alert-mode pongs refresh last seen too.
      stopKeepalive = armKeepalive(socket, () => activity.deviceSeen(accepted.deviceId, deps.clock.branchNow()));
      return;
    }
    const auth = authenticate(deps, parsed.data.device_token, parsed.data.session_token);
    if ('code' in auth) {
      socket.close(auth.code);
      return;
    }
    const asOfSeq = deps.writer.lastSeq();
    const ctx: SocketCtx = { ...auth, asOfSeq };
    const state = buildOrClose(socket, request.log, auth.deviceId, 'ws catch-up build failed', () =>
      buildCatchUpState(deps.db, deps.state.get(), ctx, branchId, provisionedOf(deps.config).branch_name),
    );
    if (state === undefined) return;
    live = { socket, ctx };
    open.push(live);
    counted = auth.deviceId;
    idlePause.socketOpened(deps.db, auth.deviceId);
    // Q8 (§6.17): a pong is a sign of life, so a kitchen screen that only holds its socket stays "seen" (15 s).
    stopKeepalive = armKeepalive(socket, () => activity.deviceSeen(auth.deviceId, deps.clock.branchNow()));
    socket.send(JSON.stringify({ type: 'catch_up', as_of_seq: asOfSeq, state }));
  });
}

// H-1: device valid and not revoked; alerts_open first; one alert-mode socket per device (4409).
function acceptAlertMode(
  socket: HubSocket,
  request: FastifyRequest,
  deps: HubDeps,
  alerts: AlertMode,
  deviceToken: string,
): AlertSocket | undefined {
  const device = findDevice(deps.db, deviceToken);
  if (device === undefined) {
    socket.close(WS_CLOSE.CREDENTIALS);
    return undefined;
  }
  if (device.revoked_at !== null) {
    socket.close(WS_CLOSE.FORBIDDEN);
    return undefined;
  }
  // 00 M95: a socket connect is contact.
  idlePause.contact(deps.db, device.device_id, deps.clock.branchNow());
  // Built and checked before the device's current alert socket is touched, so a failure here replaces nothing.
  const frame = buildOrClose(socket, request.log, device.device_id, 'ws alerts_open build failed', () =>
    WsAlertsOpen.parse(alerts.buildOpen(device.device_id)),
  );
  if (frame === undefined) return undefined;
  const alert: AlertSocket = {
    socket,
    deviceId: device.device_id,
    deviceType: device.device_type,
    remoteAddress: request.ip,
  };
  const previous = alerts.open.get(device.device_id);
  alerts.open.set(device.device_id, alert);
  if (previous !== undefined) {
    request.log.warn(
      { device_id: device.device_id, old_remote_address: previous.remoteAddress, new_remote_address: alert.remoteAddress },
      'ws alert-mode socket replaced',
    );
    previous.socket.close(ALERT_REPLACED);
  }
  socket.send(JSON.stringify(frame));
  return alert;
}

// A throw inside a ws 'message' listener would be an uncaughtException and stop the hub.
// The strict WsAlertsOpen parse refuses `card` / `details` rows (01d §7); the log carries no frame body.
function buildOrClose<T>(
  socket: HubSocket,
  log: FastifyBaseLogger,
  deviceId: string,
  msg: string,
  build: () => T,
): T | undefined {
  try {
    return build();
  } catch (err) {
    log.error({ err, device_id: deviceId }, msg);
    socket.close(INTERNAL_ERROR);
    return undefined;
  }
}

// H-1: an alert-mode socket sends only `receipt`; a malformed receipt is ignored, anything else closes 4401.
function onAlertFrame(alerts: AlertMode, alert: AlertSocket, log: FastifyBaseLogger, json: unknown): void {
  if (alerts.open.get(alert.deviceId) !== alert) return;
  if (typeof json === 'object' && json !== null && (json as { type?: unknown }).type === 'receipt') {
    const receipt = WsReceipt.safeParse(json);
    if (!receipt.success) return;
    emitReceipt(alerts, log, { deviceId: alert.deviceId, sessionId: null, staffId: null, mode: 'alert' }, receipt.data);
    return;
  }
  alerts.open.delete(alert.deviceId);
  alert.socket.close(WS_CLOSE.CREDENTIALS);
}

export function armKeepalive(socket: Pick<HubSocket, 'ping' | 'terminate' | 'on'>, onPong: () => void): () => void {
  const handle = { kill: setTimeout(() => socket.terminate(), PONG_MS) };
  const ping = setInterval(() => socket.ping(), PING_MS);
  socket.on('pong', () => {
    onPong();
    clearTimeout(handle.kill);
    handle.kill = setTimeout(() => socket.terminate(), PONG_MS);
  });
  return () => {
    clearTimeout(handle.kill);
    clearInterval(ping);
  };
}

function authenticate(
  deps: HubDeps,
  deviceToken: string,
  sessionToken: string,
): Omit<SocketCtx, 'asOfSeq'> | { code: number } {
  const device = findDevice(deps.db, deviceToken);
  if (device === undefined) return { code: WS_CLOSE.CREDENTIALS };
  if (device.revoked_at !== null) return { code: WS_CLOSE.FORBIDDEN };
  // 00 M95: a socket connect is contact; the shift runs before M46's idle check below.
  idlePause.contact(deps.db, device.device_id, deps.clock.branchNow());
  const session = findSessionByToken(deps.db, sessionToken);
  if (
    session === undefined ||
    session.device_id !== device.device_id ||
    (session.kind !== 'staff' && session.kind !== 'station') ||
    session.ended_at !== null ||
    isIdleExpired(session, deps.clock.branchNow())
  ) {
    return { code: WS_CLOSE.CREDENTIALS };
  }
  return {
    deviceId: device.device_id,
    deviceType: device.device_type,
    sessionId: session.session_id,
    kind: session.kind,
    staffId: session.staff_id,
    stationId: session.station_id,
  };
}

interface DeviceRow {
  device_id: string;
  device_type: DeviceType;
  station_id: string | null;
  revoked_at: number | null;
}

function findDevice(db: Database.Database, token: string): DeviceRow | undefined {
  return db
    .prepare('SELECT device_id, device_type, station_id, revoked_at FROM devices WHERE token_hash = ?')
    .get(sha256hex(token)) as DeviceRow | undefined;
}

function readJson(data: { toString(): string } | Array<{ toString(): string }>): unknown {
  const text = Array.isArray(data) ? data.map((part) => part.toString()).join('') : data.toString();
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
