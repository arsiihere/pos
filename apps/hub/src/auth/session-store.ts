/// <reference types="node" />
import type { SessionEndReason, SessionKind } from '@pos/domain';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { WriterTx } from '../engine-host/writer.js';
import { sha256hex } from '../lib/hash.js';
import { cryptoSecrets } from '../lib/secrets.js';

export interface SessionRow {
  session_id: string;
  kind: SessionKind;
  staff_id: string | null;
  station_id: string | null;
  device_id: string | null;
  idle_ttl_ms: number | null;
  last_activity_at: number;
  ended_at: number | null;
  token_hash: string;
}

const touches = new Map<string, number>();
const devicesSeen = new Map<string, number>();

export const activity = {
  touch(id: string, at: number): void {
    touches.set(id, at);
  },
  get(id: string): number | undefined {
    return touches.get(id);
  },
  drain(): Array<[string, number]> {
    const items = [...touches.entries()];
    touches.clear();
    return items;
  },
  deviceSeen(id: string, at: number): void {
    devicesSeen.set(id, at);
  },
  drainDevices(): Array<[string, number]> {
    const items = [...devicesSeen.entries()];
    devicesSeen.clear();
    return items;
  },
  forget(id: string): void {
    touches.delete(id);
  },
};

export function createSession(
  tx: WriterTx,
  o: {
    kind: SessionKind;
    staffId: string | null;
    stationId: string | null;
    deviceId: string | null;
    idleTtlMs: number | null;
    eventDeviceId: string;
  },
): { sessionId: string; token: string } {
  const sessionId = tx.ids.next();
  const token = cryptoSecrets.token256();
  const now = tx.clock.branchNow();
  tx.db
    .prepare(
      `INSERT INTO staff_sessions (
        session_id, branch_id, token_hash, kind, staff_id, station_id, device_id,
        idle_ttl_ms, started_at, last_activity_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      tx.branchId,
      sha256hex(token),
      o.kind,
      o.staffId,
      o.stationId,
      o.deviceId,
      o.idleTtlMs,
      now,
      now,
    );
  tx.append([sessionEvent('SessionStarted', sessionId, o, now, o.kind === 'station' ? null : o.staffId, o.eventDeviceId)]);
  return { sessionId, token };
}

export function endSession(
  tx: WriterTx,
  s: SessionRow,
  reason: SessionEndReason,
  endedBy: string | null,
  actorId: string | null,
  eventDeviceId: string,
): void {
  if (s.ended_at !== null) return;
  const now = tx.clock.branchNow();
  const updated = tx.db
    .prepare('UPDATE staff_sessions SET ended_at = ?, end_reason = ?, ended_by = ? WHERE session_id = ? AND ended_at IS NULL')
    .run(now, reason, endedBy, s.session_id);
  if (updated.changes === 0) return;
  s.ended_at = now;
  activity.forget(s.session_id);
  tx.append([
    {
      stream_type: s.kind === 'station' ? 'station' : 'staff',
      stream_id: s.kind === 'station' ? (s.station_id ?? '') : (s.staff_id ?? ''),
      event_type: 'SessionEnded',
      schema_version: 1,
      payload: {
        session_id: s.session_id,
        kind: s.kind,
        staff_id: s.staff_id,
        station_id: s.station_id,
        reason,
        ended_by: endedBy,
      },
      occurred_at: now,
      actor_id: actorId,
      device_id: eventDeviceId,
    },
  ]);
}

export function revokeDevice(
  tx: WriterTx,
  deviceId: string,
  o: {
    reason: string | null;
    cause: 'manual' | 'owner_removed';
    actorId: string | null;
    eventDeviceId: string;
    revokedBy: string | null;
  },
): void {
  const now = tx.clock.branchNow();
  const updated = tx.db
    .prepare('UPDATE devices SET revoked_at = ?, revoked_by = ? WHERE device_id = ? AND revoked_at IS NULL')
    .run(now, o.revokedBy, deviceId);
  if (updated.changes === 0) return;
  for (const session of activeSessionsOf(tx.db, { deviceId })) {
    endSession(tx, session, 'device_revoked', o.actorId, o.actorId, o.eventDeviceId);
  }
  tx.append([
    {
      stream_type: 'hub',
      stream_id: deviceId,
      event_type: 'DeviceRevoked',
      schema_version: 1,
      payload: { device_id: deviceId, reason: o.reason, cause: o.cause },
      occurred_at: now,
      actor_id: o.actorId,
      device_id: o.eventDeviceId,
    },
  ]);
}

export function findSessionByToken(db: Database.Database, token: string): SessionRow | undefined {
  const row = db.prepare(`SELECT ${SESSION_COLUMNS} FROM staff_sessions WHERE token_hash = ?`).get(sha256hex(token));
  return row === undefined ? undefined : asSession(row);
}

export function activeSessionsOf(
  db: Database.Database,
  where: { staffId?: string; deviceId?: string; kind?: SessionKind },
): SessionRow[] {
  const clauses = ['ended_at IS NULL'];
  const params: Array<string> = [];
  if (where.staffId !== undefined) {
    clauses.push('staff_id = ?');
    params.push(where.staffId);
  }
  if (where.deviceId !== undefined) {
    clauses.push('device_id = ?');
    params.push(where.deviceId);
  }
  if (where.kind !== undefined) {
    clauses.push('kind = ?');
    params.push(where.kind);
  }
  const rows = db.prepare(`SELECT ${SESSION_COLUMNS} FROM staff_sessions WHERE ${clauses.join(' AND ')}`).all(...params);
  return rows.map((row) => asSession(row));
}

export function isIdleExpired(s: SessionRow, now: number): boolean {
  if (s.idle_ttl_ms == null) return false;
  const last = Math.max(s.last_activity_at, activity.get(s.session_id) ?? 0);
  return now - last > s.idle_ttl_ms;
}

const SESSION_COLUMNS =
  'session_id, kind, staff_id, station_id, device_id, idle_ttl_ms, last_activity_at, ended_at, token_hash';

function sessionEvent(
  eventType: 'SessionStarted',
  sessionId: string,
  o: {
    kind: SessionKind;
    staffId: string | null;
    stationId: string | null;
    deviceId: string | null;
    idleTtlMs: number | null;
  },
  now: number,
  actorId: string | null,
  eventDeviceId: string,
): EventDraft {
  return {
    stream_type: o.kind === 'station' ? 'station' : 'staff',
    stream_id: o.kind === 'station' ? (o.stationId ?? '') : (o.staffId ?? ''),
    event_type: eventType,
    schema_version: 1,
    payload: {
      session_id: sessionId,
      kind: o.kind,
      staff_id: o.staffId,
      station_id: o.stationId,
      device_id: o.deviceId,
      idle_ttl_ms: o.idleTtlMs,
    },
    occurred_at: now,
    actor_id: actorId,
    device_id: eventDeviceId,
  };
}

function asSession(row: unknown): SessionRow {
  return row as SessionRow;
}
