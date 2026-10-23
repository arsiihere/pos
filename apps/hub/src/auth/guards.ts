import { DomainError, type DeviceType } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest, onRequestHookHandler } from 'fastify';
import type { HubConfig } from '../config/schema.js';
import { isProvisioned } from '../config/schema.js';
import type { AuthGeneration } from '../engine-host/auth-generation.js';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import { sha256hex } from '../lib/hash.js';
import { createHostMatcher, createNetMatcher } from '../lib/net.js';
import { StaffDirectory } from './staff-directory.js';
import { activity, endSession, findSessionByToken, isIdleExpired, type SessionRow } from './session-store.js';

export type RouteGroup =
  | 'health'
  | 'setup'
  | 'device'
  | 'device-session'
  | 'admin'
  | 'admin-device-public'
  | 'admin-bootstrap'
  | 'pair'
  | 'pair-request'
  | 'ws';

const GROUPS = new Set<RouteGroup>([
  'health',
  'setup',
  'device',
  'device-session',
  'admin',
  'admin-device-public',
  'admin-bootstrap',
  'pair',
  'pair-request',
  'ws',
]);

const VERSION_GROUPS = new Set<RouteGroup>(['device', 'device-session', 'pair', 'pair-request', 'ws']);
const DEVICE_GROUPS = new Set<RouteGroup>(['device', 'device-session', 'admin', 'admin-device-public']);

export interface RequestDevice {
  device_id: string;
  device_type: DeviceType;
  owner_staff_id: string | null;
  station_id: string | null;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    group?: RouteGroup;
    guards?: string[];
    allowEnded?: boolean;
    allowStation?: boolean;
  }
  interface FastifyRequest {
    isGuest?: boolean;
    device?: RequestDevice;
    session?: SessionRow;
    authGen?: number;
  }
}

export function guardsFor(group: RouteGroup): string[] {
  const names = ['host'];
  if (group !== 'health' && group !== 'setup') names.push('provisioned');
  names.push(group === 'health' ? 'isGuest' : 'guest');
  if (VERSION_GROUPS.has(group)) names.push('version');
  if (DEVICE_GROUPS.has(group)) names.push('device');
  if (group === 'device-session') names.push('session');
  if (group === 'admin') names.push('admin');
  return names;
}

export interface ListedRoute {
  method: string;
  url: string;
  guards: string[];
}

const listed = new WeakMap<FastifyInstance, ListedRoute[]>();
const unguarded = new WeakMap<FastifyInstance, string[]>();
const directories = new WeakMap<FastifyInstance, { current: StaffDirectory }>();

export function listRouteGuards(app: FastifyInstance): ListedRoute[] {
  return listed.get(app) ?? [];
}

export function currentDirectory(app: FastifyInstance): StaffDirectory {
  const holder = directories.get(app);
  if (holder === undefined) throw new Error('staff directory is not bound');
  return holder.current;
}

export function swapDirectory(app: FastifyInstance, directory: StaffDirectory): void {
  const holder = directories.get(app);
  if (holder === undefined) throw new Error('staff directory is not bound');
  holder.current = directory;
}

export interface GuardDeps {
  config: HubConfig;
  ownIPv4: string[];
  db: Database.Database;
  writer: Writer;
  clock: Clock;
  authGeneration: AuthGeneration;
}

export function attachRouteGuards(app: FastifyInstance, deps: GuardDeps): void {
  const routes: ListedRoute[] = [];
  const missing: string[] = [];
  listed.set(app, routes);
  unguarded.set(app, missing);
  const holder = { current: StaffDirectory.load(deps.db) };
  directories.set(app, holder);
  const allowHost = createHostMatcher({
    port: deps.config.http_port,
    advertisedHost: deps.config.advertised_host ?? null,
    ownIPv4: deps.ownIPv4,
  });
  const guestNet = createNetMatcher(deps.config.guest_network_cidrs ?? []);
  const handlers: Record<string, onRequestHookHandler> = {
    async host(request) {
      if (!allowHost(request.headers.host)) throw new DomainError('HOST_NOT_ALLOWED');
    },
    async provisioned() {
      if (!isProvisioned(deps.config)) throw new DomainError('HUB_NOT_PROVISIONED');
    },
    async guest(request) {
      if (guestNet(request.ip)) throw new DomainError('GUEST_NETWORK_FORBIDDEN');
    },
    async isGuest(request) {
      request.isGuest = guestNet(request.ip);
    },
    async version(request) {
      const header = request.headers['x-client-version'];
      const version = Array.isArray(header) ? header[0] : header;
      if (version !== undefined && version.length > 0 && isBelow(version, deps.config.min_client_version)) {
        throw new DomainError('CLIENT_UPGRADE_REQUIRED');
      }
    },
    async device(request) {
      requireDevice(request, deps);
    },
    async session(request) {
      requireSession(request, deps);
    },
    async admin(request) {
      requireAdmin(request, deps, holder);
    },
  };
  app.addHook('onRoute', (opts) => {
    const group = opts.config?.group;
    const label = `${String(opts.method)} ${opts.url}`;
    if (!isGroup(group)) {
      missing.push(label);
      return;
    }
    const names = guardsFor(group);
    const prior = opts.onRequest === undefined ? [] : [opts.onRequest].flat();
    opts.onRequest = [...names.map((name) => handlers[name]!), ...prior];
    routes.push({ method: String(opts.method), url: opts.url, guards: names });
  });
  app.addHook('onReady', async () => {
    if (missing.length > 0) throw new Error(`route has no group: ${missing.join(', ')}`);
  });
}

function requireDevice(request: FastifyRequest, deps: GuardDeps): void {
  if (request.routeOptions.config.group === 'admin' && liveBootstrap(request, deps)) {
    request.authGen = deps.authGeneration.current();
    return;
  }
  const token = bearerToken(request);
  if (token === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
  const device = findDevice(deps.db, token);
  if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
  if (device.revoked_at !== null) throw new DomainError('DEVICE_REVOKED');
  activity.deviceSeen(device.device_id, deps.clock.branchNow());
  request.device = {
    device_id: device.device_id,
    device_type: device.device_type,
    owner_staff_id: device.owner_staff_id,
    station_id: device.station_id,
  };
  request.authGen = deps.authGeneration.current();
}

function requireSession(request: FastifyRequest, deps: GuardDeps): void {
  const token = headerValue(request, 'x-session-token');
  const session = token === undefined ? undefined : findSessionByToken(deps.db, token);
  if (session === undefined || session.device_id !== request.device?.device_id) throw new DomainError('SESSION_INVALID');
  const allowStation = request.routeOptions.config.allowStation === true;
  if (session.kind !== 'staff' && !(session.kind === 'station' && allowStation)) throw new DomainError('SESSION_INVALID');
  if (session.ended_at !== null) {
    if (request.routeOptions.config.allowEnded !== true) throw new DomainError('SESSION_EXPIRED');
  } else if (isIdleExpired(session, deps.clock.branchNow())) {
    endIdle(deps, token!);
    throw new DomainError('SESSION_EXPIRED');
  }
  request.session = session;
  request.authGen = deps.authGeneration.current();
}

function requireAdmin(request: FastifyRequest, deps: GuardDeps, holder: { current: StaffDirectory }): void {
  const token = headerValue(request, 'x-admin-session');
  const session = token === undefined ? undefined : findSessionByToken(deps.db, token);
  if (session === undefined || session.kind !== 'admin' || session.ended_at !== null) {
    throw new DomainError('ADMIN_SESSION_REQUIRED');
  }
  if (session.device_id !== null && session.device_id !== request.device?.device_id) {
    throw new DomainError('ADMIN_SESSION_REQUIRED');
  }
  if (isIdleExpired(session, deps.clock.branchNow())) {
    endIdle(deps, token!);
    throw new DomainError('ADMIN_SESSION_REQUIRED');
  }
  if (session.staff_id === null || !holder.current.hasAdmin(session.staff_id)) {
    throw new DomainError('PERMISSION_DENIED', { permission: 'access-hub-admin' });
  }
  request.session = session;
  request.authGen = deps.authGeneration.current();
}

function endIdle(deps: GuardDeps, token: string): void {
  deps.writer.run((tx) => {
    const fresh = findSessionByToken(tx.db, token);
    if (fresh === undefined || fresh.ended_at !== null) return;
    endSession(tx, fresh, 'idle_timeout', null, null, fresh.device_id ?? 'hub');
  });
}

function liveBootstrap(request: FastifyRequest, deps: GuardDeps): boolean {
  const token = headerValue(request, 'x-admin-session');
  if (token === undefined) return false;
  const session = findSessionByToken(deps.db, token);
  return session !== undefined && session.kind === 'admin' && session.device_id === null;
}

interface DeviceRow {
  device_id: string;
  device_type: DeviceType;
  owner_staff_id: string | null;
  station_id: string | null;
  revoked_at: number | null;
}

function findDevice(db: Database.Database, token: string): DeviceRow | undefined {
  return db
    .prepare(
      'SELECT device_id, device_type, owner_staff_id, station_id, revoked_at FROM devices WHERE token_hash = ?',
    )
    .get(sha256hex(token)) as DeviceRow | undefined;
}

function bearerToken(request: FastifyRequest): string | undefined {
  const value = headerValue(request, 'authorization');
  if (value === undefined || !value.startsWith('Bearer ')) return undefined;
  const token = value.slice('Bearer '.length);
  return token.length === 0 ? undefined : token;
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first.length === 0) return undefined;
  return first;
}

function isGroup(value: unknown): value is RouteGroup {
  return typeof value === 'string' && GROUPS.has(value as RouteGroup);
}

function isBelow(version: string, min: string): boolean {
  const left = version.split('.').map((part) => Number(part));
  const right = min.split('.').map((part) => Number(part));
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const a = left[i] ?? 0;
    const b = right[i] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b) || a < b) return true;
    if (a > b) return false;
  }
  return false;
}
