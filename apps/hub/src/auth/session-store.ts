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
  started_at: number;
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
  deviceSeenAt(id: string): number | undefined {
    return devicesSeen.get(id);
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

// 00 v1.8 M95 (02b H-1): a staff session's idle clock is paused while its device has no open socket. In memory,
// per device (session or alert-mode sockets). Station and admin sessions are unchanged. The shift is not activity (M59).
export interface DevicePause {
  open_sockets: number;
  paused_at: number | null;
  paused_since: number | null;
}

const pauses = new WeakMap<Database.Database, Map<string, DevicePause>>();

function pausesOf(db: Database.Database): Map<string, DevicePause> {
  let map = pauses.get(db);
  if (map === undefined) {
    map = new Map();
    pauses.set(db, map);
  }
  return map;
}

// The device's active staff session moves forward by `by` ms, in memory (M5's flush persists it).
function shift(sessionId: string, lastActivityAt: number, by: number): void {
  if (by <= 0) return;
  activity.touch(sessionId, Math.max(lastActivityAt, activity.get(sessionId) ?? 0) + by);
}

export const idlePause = {
  // M95: at boot every device starts paused at HubStarted.hub_down_at (boot time on a first boot).
  boot(db: Database.Database, at: number): void {
    const map = new Map<string, DevicePause>();
    const rows = db.prepare('SELECT device_id FROM devices WHERE revoked_at IS NULL').all() as Array<{ device_id: string }>;
    for (const row of rows) map.set(row.device_id, { open_sockets: 0, paused_at: at, paused_since: at });
    pauses.set(db, map);
  },
  // M95: the device's next contact (an authenticated request or a socket connect), before M46's idle check.
  contact(db: Database.Database, deviceId: string, now: number): void {
    const pause = pausesOf(db).get(deviceId);
    if (pause === undefined || pause.paused_at === null) return;
    const session = db
      .prepare(
        `SELECT session_id, last_activity_at FROM staff_sessions
         WHERE device_id = ? AND kind = 'staff' AND ended_at IS NULL`,
      )
      .get(deviceId) as { session_id: string; last_activity_at: number } | undefined;
    if (session !== undefined) shift(session.session_id, session.last_activity_at, now - pause.paused_at);
    pause.paused_at = pause.open_sockets === 0 ? now : null;
  },
  socketOpened(db: Database.Database, deviceId: string): void {
    const map = pausesOf(db);
    const pause = map.get(deviceId) ?? { open_sockets: 0, paused_at: null, paused_since: null };
    pause.open_sockets += 1;
    pause.paused_at = null;
    pause.paused_since = null;
    map.set(deviceId, pause);
  },
  // The last socket closes (incl. a missed-pong terminate) → paused_at = paused_since = now.
  socketClosed(db: Database.Database, deviceId: string, now: number): void {
    const pause = pausesOf(db).get(deviceId);
    if (pause === undefined || pause.open_sockets === 0) return;
    pause.open_sockets -= 1;
    if (pause.open_sockets === 0) {
      pause.paused_at = now;
      pause.paused_since = now;
    }
  },
  isPaused(db: Database.Database, deviceId: string): boolean {
    return (pausesOf(db).get(deviceId)?.paused_at ?? null) !== null;
  },
  // M5's 15 s flush: paused devices' staff sessions move forward to now (one statement), then paused_at = now.
  flush(db: Database.Database, now: number): void {
    const map = pausesOf(db);
    if (![...map.values()].some((pause) => pause.paused_at !== null)) return;
    const sessions = db
      .prepare(
        `SELECT session_id, device_id, last_activity_at FROM staff_sessions
         WHERE ended_at IS NULL AND kind = 'staff' AND device_id IS NOT NULL`,
      )
      .all() as Array<{ session_id: string; device_id: string; last_activity_at: number }>;
    for (const session of sessions) {
      const pausedAt = map.get(session.device_id)?.paused_at ?? null;
      if (pausedAt !== null) shift(session.session_id, session.last_activity_at, now - pausedAt);
    }
    for (const pause of map.values()) if (pause.paused_at !== null) pause.paused_at = now;
  },
  // The cap: devices paused longer than `capMs` (now − paused_since).
  overCap(db: Database.Database, now: number, capMs: number): Set<string> {
    const over = new Set<string>();
    for (const [deviceId, pause] of pausesOf(db)) {
      if (pause.paused_since !== null && now - pause.paused_since > capMs) over.add(deviceId);
    }
    return over;
  },
  state(db: Database.Database, deviceId: string): DevicePause | undefined {
    const pause = pausesOf(db).get(deviceId);
    return pause === undefined ? undefined : { ...pause };
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
  'session_id, kind, staff_id, station_id, device_id, idle_ttl_ms, started_at, last_activity_at, ended_at, token_hash';

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
