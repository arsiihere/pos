/// <reference types="node" />
import type { DeviceType } from '@pos/domain';
import { WS_CLOSE, WsClientMessage, type PosEvent } from '@pos/events';
import websocket from '@fastify/websocket';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { findSessionByToken, isIdleExpired } from '../auth/session-store.js';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import { buildCatchUpState, type SocketCtx } from './catch-up.js';

const AUTH_MS = 5_000;

export interface WsHub {
  publish(events: PosEvent[]): void;
}

interface HubSocket {
  send(data: string): void;
  close(code?: number): void;
  on(event: 'message', listener: (data: { toString(): string } | Array<{ toString(): string }>) => void): void;
  on(event: 'close', listener: () => void): void;
}

interface OpenSocket {
  socket: HubSocket;
  ctx: SocketCtx;
}

export function registerWs(app: FastifyInstance, deps: HubDeps): WsHub {
  const open: OpenSocket[] = [];
  const branchId = deps.config.provisioned?.branch_id ?? '';
  const hub: WsHub = {
    publish(events) {
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
          if (event.seq > live.ctx.asOfSeq) live.socket.send(body);
        }
      }
    },
  };
  deps.writer.addAfterCommit((events) => {
    if (events.length > 0) hub.publish(events);
  });
  app.register(websocket);
  app.after(() => {
    app.get('/ws', { websocket: true, config: { group: 'ws' } }, (socket, request) => {
      accept(socket, request, deps, branchId, open);
    });
  });
  return hub;
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
  const timer = setTimeout(() => {
    if (decided) return;
    decided = true;
    socket.close(WS_CLOSE.CREDENTIALS);
  }, AUTH_MS);
  socket.on('close', () => {
    clearTimeout(timer);
  });
  socket.on('message', (data) => {
    if (decided) return;
    decided = true;
    clearTimeout(timer);
    const parsed = WsClientMessage.safeParse(readJson(data));
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
    const state = buildCatchUpState(deps.db, deps.state.get(), ctx, branchId);
    const live = { socket, ctx };
    open.push(live);
    socket.on('close', () => {
      const index = open.indexOf(live);
      if (index >= 0) open.splice(index, 1);
    });
    socket.send(JSON.stringify({ type: 'catch_up', as_of_seq: asOfSeq, state }));
  });
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
