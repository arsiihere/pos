/// <reference types="node" />
import { verify } from '@node-rs/argon2';
import { DomainError, type DeviceType } from '@pos/domain';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { HubDeps } from '../server.js';
import type { Semaphore } from '../lib/semaphore.js';
import type { WriterTx } from '../engine-host/writer.js';
import { currentDirectory } from './guards.js';
import { checkPin } from './pin.js';
import {
  activeSessionsOf,
  activity,
  createSession,
  endSession,
  findSessionByToken,
  isIdleExpired,
  type SessionRow,
} from './session-store.js';

const LOGIN_TYPES = new Set<DeviceType>(['tablet', 'cashier_kiosk', 'phone']);

export function registerStaffSessionRoutes(app: FastifyInstance, deps: HubDeps, pinSemaphore: Semaphore): void {
  app.post('/auth/pin', { config: { group: 'device' } }, async (request) => {
    const device = request.device;
    if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
    const body = pinBody(request);
    if (!LOGIN_TYPES.has(device.device_type)) {
      throw new DomainError('DEVICE_TYPE_NOT_ALLOWED', {
        device_type: device.device_type,
        allowed: ['tablet', 'cashier_kiosk', 'phone'],
      });
    }
    if (device.device_type === 'phone' && device.owner_staff_id !== body.staff_id) {
      throw new DomainError('DEVICE_NOT_OWNED', { device_id: device.device_id });
    }
    const outcome = await checkPin(
      {
        db: deps.db,
        writer: deps.writer,
        directory: () => currentDirectory(app),
        clock: deps.clock,
        config: deps.config,
        semaphore: pinSemaphore,
        verify: (pinHash, pin) => verify(pinHash, pin),
      },
      {
        staffId: body.staff_id,
        pin: body.pin,
        subject: { type: 'device', id: device.device_id },
        eventDeviceId: device.device_id,
      },
      (tx) => openStaffSession(app, tx, device.device_id, body.staff_id, body.takeover),
    );
    activity.touch(outcome.session_id, deps.clock.branchNow());
    return { data: outcome };
  });

  app.post(
    '/auth/logout',
    { config: { group: 'device-session', allowEnded: true, allowStation: true } },
    async (request) => {
      const device = request.device;
      if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
      const token = headerValue(request, 'x-session-token');
      const session = token === undefined ? undefined : findSessionByToken(deps.db, token);
      if (session === undefined || session.device_id !== device.device_id) throw new DomainError('SESSION_INVALID');
      if (session.kind === 'station') throw new DomainError('STATION_LOGOUT_NOT_ALLOWED');
      if (session.ended_at !== null) {
        return { data: { session_id: session.session_id, ended_at: session.ended_at, already_ended: true } };
      }
      const endedAt = deps.writer.run((tx) => {
        const fresh = findSessionByToken(tx.db, token!);
        if (fresh === undefined || fresh.device_id !== device.device_id) return null;
        if (fresh.kind === 'station') throw new DomainError('STATION_LOGOUT_NOT_ALLOWED');
        if (fresh.ended_at !== null) return fresh.ended_at;
        endSession(tx, fresh, 'logout', fresh.staff_id, fresh.staff_id, device.device_id);
        return fresh.ended_at;
      }).result;
      if (endedAt === null) throw new DomainError('SESSION_INVALID');
      return { data: { session_id: session.session_id, ended_at: endedAt, already_ended: false } };
    },
  );
}

function openStaffSession(
  app: FastifyInstance,
  tx: WriterTx,
  deviceId: string,
  staffId: string,
  takeover: boolean,
): {
  session_token: string;
  session_id: string;
  staff_id: string;
  role_ids: string[];
  display_name: string;
  idle_ttl_ms: number;
} {
  const directory = currentDirectory(app);
  const staff = directory.get(staffId);
  if (staff === undefined) throw new DomainError('STAFF_NOT_FOUND', { staff_id: staffId });
  const now = tx.clock.branchNow();
  const holders = activeSessionsOf(tx.db, { deviceId }).filter((session) => session.kind === 'staff' || session.kind === 'station');
  for (const session of holders) {
    if (isIdleExpired(session, now)) endSession(tx, session, 'idle_timeout', null, null, deviceId);
  }
  for (const session of holders) {
    if (session.ended_at !== null) continue;
    if (session.staff_id === staffId) {
      endSession(tx, session, 'replaced', staffId, staffId, deviceId);
      continue;
    }
    if (!takeover) throw activeError(directory, session);
    endSession(tx, session, 'taken_over', staffId, staffId, deviceId);
  }
  try {
    const created = createSession(tx, {
      kind: 'staff',
      staffId,
      stationId: null,
      deviceId,
      idleTtlMs: directory.ttlFor(staffId),
      eventDeviceId: deviceId,
    });
    return {
      session_token: created.token,
      session_id: created.sessionId,
      staff_id: staffId,
      role_ids: staff.role_ids,
      display_name: staff.display_name,
      idle_ttl_ms: directory.ttlFor(staffId),
    };
  } catch (error) {
    if (!isUniqueConstraint(error)) throw error;
    const holder = activeSessionsOf(tx.db, { deviceId }).find((session) => session.kind === 'staff' || session.kind === 'station');
    throw activeError(directory, holder);
  }
}

function activeError(
  directory: ReturnType<typeof currentDirectory>,
  session: SessionRow | undefined,
): DomainError {
  const holder = session?.staff_id == null ? undefined : directory.get(session.staff_id);
  return new DomainError('DEVICE_SESSION_ACTIVE', {
    staff_id: session?.staff_id ?? null,
    display_name: holder?.display_name ?? '',
    can_take_over: true,
  });
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function pinBody(request: FastifyRequest): { staff_id: string; pin: string; takeover: boolean } {
  const body = request.body as { staff_id?: unknown; pin?: unknown; takeover?: unknown } | null;
  const staffId = body?.staff_id;
  const pin = body?.pin;
  const takeover = body?.takeover ?? false;
  if (
    typeof staffId !== 'string' ||
    staffId.length === 0 ||
    typeof pin !== 'string' ||
    !/^\d{4,6}$/.test(pin) ||
    typeof takeover !== 'boolean'
  ) {
    throw new DomainError('VALIDATION_FAILED', { issues: [{ path: 'pin', message: 'invalid' }] });
  }
  return { staff_id: staffId, pin, takeover };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first.length === 0) return undefined;
  return first;
}
