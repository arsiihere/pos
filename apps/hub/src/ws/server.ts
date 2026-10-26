/// <reference types="node" />
import type { DeviceType } from '@pos/domain';
import { WS_CLOSE, WsClientMessage, type PosEvent } from '@pos/events';
import websocket from '@fastify/websocket';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { activity, findSessionByToken, isIdleExpired } from '../auth/session-store.js';
import { provisionedOf } from '../config/schema.js';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import { audienceAllows } from './audience.js';
import { buildCatchUpState, type SocketCtx } from './catch-up.js';

const AUTH_MS = 5_000;
const PING_MS = 15_000;
const PONG_MS = 30_000;

export interface WsHub {
  publish(events: PosEvent[]): void;
}

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

interface SocketClose {
  code: number;
  reason?: string;
}

const publishers = new WeakMap<FastifyInstance, (events: PosEvent[]) => void>();

export function publisherFor(app: FastifyInstance): ((events: PosEvent[]) => void) | undefined {
  return publishers.get(app);
}

export function registerWs(app: FastifyInstance, deps: HubDeps): WsHub {
  const open: OpenSocket[] = [];
  const branchId = deps.config.provisioned?.branch_id ?? '';
  const hub: WsHub = {
    publish(events) {
      deliver(open, events);
    },
  };
  publishers.set(app, hub.publish);
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
      accept(socket, request, deps, branchId, open);
    });
  });
  return hub;
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
): void {
  if (request.wsClose !== undefined) {
    socket.close(request.wsClose);
    return;
  }
  let decided = false;
  let live: OpenSocket | undefined;
  let stopKeepalive = (): void => undefined;
  const timer = setTimeout(() => {
    if (decided) return;
    decided = true;
    socket.close(WS_CLOSE.CREDENTIALS);
  }, AUTH_MS);
  socket.on('close', () => {
    clearTimeout(timer);
    stopKeepalive();
    if (live === undefined) return;
    const index = open.indexOf(live);
    if (index >= 0) open.splice(index, 1);
  });
  socket.on('message', (data) => {
    const parsed = WsClientMessage.safeParse(readJson(data));
    if (live !== undefined) {
      if (parsed.success && parsed.data.type === 'ack') live.lastAck = parsed.data.last_seq;
      return;
    }
    if (decided) return;
    decided = true;
    clearTimeout(timer);
    if (!parsed.success || parsed.data.type !== 'auth') {
      socket.close(WS_CLOSE.CREDENTIALS);
      return;
    }
    const auth = authenticate(deps, parsed.data.device_token, parsed.data.session_token);
    if ('code' in auth) {
      socket.close(auth.code);
      return;
    }
    const asOfSeq = deps.writer.lastSeq();
    const ctx: SocketCtx = { ...auth, asOfSeq };
    const state = buildCatchUpState(deps.db, deps.state.get(), ctx, branchId, provisionedOf(deps.config).branch_name);
    live = { socket, ctx };
    open.push(live);
    // Q8 (§6.17): a pong is a sign of life, so a kitchen screen that only holds its socket stays "seen" (15 s).
    stopKeepalive = armKeepalive(socket, () => activity.deviceSeen(auth.deviceId, deps.clock.branchNow()));
    socket.send(JSON.stringify({ type: 'catch_up', as_of_seq: asOfSeq, state }));
  });
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
