/// <reference types="node" />
import { DomainError, type DeviceType } from '@pos/domain';
import { verify } from '@node-rs/argon2';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HubDeps } from '../server.js';
import { sha256hex } from '../lib/hash.js';
import { Semaphore } from '../lib/semaphore.js';
import { currentDirectory } from './guards.js';
import { checkPin } from './pin.js';
import { createSession, endSession, findSessionByToken } from './session-store.js';

const LOGIN_TYPES = new Set<DeviceType>(['tablet', 'cashier_kiosk', 'phone']);

export interface AdminSemaphores {
  pin: Semaphore;
  admin: Semaphore;
}

const attached = new WeakMap<FastifyInstance, AdminSemaphores>();

export function authSemaphores(app: FastifyInstance): AdminSemaphores {
  const found = attached.get(app);
  if (found === undefined) throw new Error('admin semaphores are not registered');
  return found;
}

export function registerAdminRoutes(app: FastifyInstance, deps: HubDeps, semaphores: AdminSemaphores): void {
  attached.set(app, semaphores);

  app.post('/admin/auth', { config: { group: 'admin-device-public' } }, async (request) => {
    const device = request.device;
    if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
    const body = loginBody(request);
    if (!LOGIN_TYPES.has(device.device_type)) throw new DomainError('DEVICE_TYPE_NOT_ALLOWED');
    if (device.device_type === 'phone' && device.owner_staff_id !== body.staff_id) {
      throw new DomainError('DEVICE_NOT_OWNED');
    }
    const outcome = await checkPin(
      {
        db: deps.db,
        writer: deps.writer,
        directory: () => currentDirectory(app),
        clock: deps.clock,
        config: deps.config,
        semaphore: semaphores.admin,
        verify: (pinHash, pin) => verify(pinHash, pin),
      },
      { staffId: body.staff_id, pin: body.pin, subject: { type: 'device', id: device.device_id }, eventDeviceId: device.device_id },
      (tx) => {
        const directory = currentDirectory(app);
        const staff = directory.get(body.staff_id);
        if (staff === undefined || !directory.hasAdmin(body.staff_id)) return { allowed: false as const };
        const idleTtlMs = directory.ttlFor(body.staff_id);
        const created = createSession(tx, {
          kind: 'admin',
          staffId: body.staff_id,
          stationId: null,
          deviceId: device.device_id,
          idleTtlMs,
          eventDeviceId: device.device_id,
        });
        return {
          allowed: true as const,
          admin_session_token: created.token,
          session_id: created.sessionId,
          staff_id: body.staff_id,
          display_name: staff.display_name,
          idle_ttl_ms: idleTtlMs,
        };
      },
    );
    if (!outcome.allowed) throw new DomainError('PERMISSION_DENIED', { permission: 'access-hub-admin' });
    return {
      data: {
        admin_session_token: outcome.admin_session_token,
        session_id: outcome.session_id,
        staff_id: outcome.staff_id,
        display_name: outcome.display_name,
        idle_ttl_ms: outcome.idle_ttl_ms,
      },
    };
  });

  app.post('/admin/auth/logout', { config: { group: 'admin-bootstrap' } }, async (request) => {
    const token = headerValue(request, 'x-admin-session');
    if (token === undefined) throw new DomainError('ADMIN_SESSION_REQUIRED');
    const session = findSessionByToken(deps.db, token);
    if (session === undefined || session.kind !== 'admin') throw new DomainError('ADMIN_SESSION_REQUIRED');
    if (session.device_id !== null) {
      const device = deviceFromBearer(deps.db, request);
      if (device === undefined || device.revoked_at !== null || device.device_id !== session.device_id) {
        throw new DomainError('ADMIN_SESSION_REQUIRED');
      }
    }
    if (session.ended_at !== null) {
      return { data: { session_id: session.session_id, ended_at: session.ended_at, already_ended: true } };
    }
    const endedAt = deps.writer.run((tx) => {
      const fresh = findSessionByToken(tx.db, token);
      if (fresh === undefined || fresh.kind !== 'admin') return null;
      if (fresh.ended_at !== null) return fresh.ended_at;
      endSession(tx, fresh, 'logout', fresh.staff_id, fresh.staff_id, fresh.device_id ?? 'hub-admin');
      return fresh.ended_at;
    }).result;
    if (endedAt === null) throw new DomainError('ADMIN_SESSION_REQUIRED');
    return { data: { session_id: session.session_id, ended_at: endedAt, already_ended: false } };
  });

  app.get('/admin/login-roster', { config: { group: 'admin-bootstrap' } }, async (request) => {
    const scope = rosterScope(deps, request);
    const directory = currentDirectory(app);
    const locks = new Map<string, number | null>();
    const rows = deps.db
      .prepare(`SELECT subject_id, locked_until FROM auth_lockouts WHERE branch_id = ? AND subject_type = 'staff'`)
      .all(deps.config.provisioned?.branch_id) as Array<{ subject_id: string; locked_until: number | null }>;
    const now = deps.clock.branchNow();
    for (const row of rows) locks.set(row.subject_id, row.locked_until !== null && row.locked_until > now ? row.locked_until : null);
    const staff = directory
      .list()
      .filter((member) => directory.hasAdmin(member.staff_id))
      .filter((member) => scope === null || member.staff_id === scope)
      .map((member) => ({
        staff_id: member.staff_id,
        display_name: member.display_name,
        locked_until: locks.get(member.staff_id) ?? null,
      }));
    return { data: { staff } };
  });
}

function loginBody(request: FastifyRequest): { staff_id: string; pin: string } {
  const body = request.body as { staff_id?: unknown; pin?: unknown } | null;
  const staffId = body?.staff_id;
  const pin = body?.pin;
  if (typeof staffId !== 'string' || staffId.length === 0 || typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'pin', message: 'invalid' }] });
  }
  return { staff_id: staffId, pin };
}

interface DeviceHit {
  device_id: string;
  device_type: DeviceType;
  owner_staff_id: string | null;
  revoked_at: number | null;
}

function deviceFromBearer(db: Database.Database, request: FastifyRequest): DeviceHit | undefined {
  const token = bearerToken(request);
  if (token === undefined) return undefined;
  return db
    .prepare('SELECT device_id, device_type, owner_staff_id, revoked_at FROM devices WHERE token_hash = ?')
    .get(sha256hex(token)) as DeviceHit | undefined;
}

function rosterScope(deps: HubDeps, request: FastifyRequest): string | null {
  const bootstrap = headerValue(request, 'x-admin-bootstrap');
  if (bootstrap !== undefined) {
    if (!liveBootstrap(deps, bootstrap)) throw new DomainError('PAIRING_TOKEN_INVALID');
    return null;
  }
  const device = deviceFromBearer(deps.db, request);
  if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
  if (device.revoked_at !== null) throw new DomainError('DEVICE_REVOKED');
  if (!LOGIN_TYPES.has(device.device_type)) throw new DomainError('DEVICE_TYPE_NOT_ALLOWED');
  return device.device_type === 'phone' ? device.owner_staff_id : null;
}

function liveBootstrap(deps: HubDeps, token: string): boolean {
  const row = deps.db
    .prepare('SELECT consumed_at, expires_at FROM admin_bootstrap_tokens WHERE token_hash = ?')
    .get(sha256hex(token)) as { consumed_at: number | null; expires_at: number } | undefined;
  return row !== undefined && row.consumed_at === null && row.expires_at > deps.clock.branchNow();
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
