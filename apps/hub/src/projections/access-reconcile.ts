import type { SessionKind } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import type { ProjectionRegistry } from './registry.js';

const EVENT_TYPES = ['DevicePaired', 'DeviceTokenRotated', 'DeviceRevoked', 'SessionStarted', 'SessionEnded'];

interface RememberedSession {
  session_id: string;
  kind: SessionKind;
  staff_id: string | null;
  station_id: string | null;
  device_id: string | null;
}

export function registerAccessReconcile(deps: {
  projections: ProjectionRegistry;
  writer: Writer;
  clock: Clock;
}): void {
  const pending = new Map<string, RememberedSession>();
  deps.projections.register({
    name: 'access_reconcile',
    eventTypes: EVENT_TYPES,
    apply(tx, event, mode) {
      applyAccessEvent(tx, event, mode, pending);
    },
  });
  deps.projections.afterCatchUp(() => {
    const open = [...pending.values()];
    pending.clear();
    if (open.length === 0) return;
    deps.writer.run((tx) => {
      tx.append(open.map((session) => sessionEndedDraft(session, deps.clock.branchNow())));
    });
  });
}

export function restoreEmptyStaffSessions(
  db: Database.Database,
  writer: Writer,
  clock: Clock,
  branchId: string,
): void {
  const sessions = db.prepare('SELECT COUNT(*) AS n FROM staff_sessions').get() as { n: number };
  if (sessions.n > 0) return;
  const sessionEvents = db
    .prepare(
      `SELECT 1 AS ok FROM events
       WHERE branch_id = ? AND stream_type IN ('staff', 'station')
         AND event_type IN ('SessionStarted', 'SessionEnded')
       LIMIT 1`,
    )
    .get(branchId) as { ok: number } | undefined;
  if (sessionEvents === undefined) return;
  const started = db
    .prepare(
      `SELECT payload FROM events
       WHERE branch_id = ? AND stream_type IN ('staff', 'station') AND event_type = 'SessionStarted'
       ORDER BY seq`,
    )
    .all(branchId) as Array<{ payload: string }>;
  const ended = new Set(
    (
      db
        .prepare(
          `SELECT payload FROM events
           WHERE branch_id = ? AND stream_type IN ('staff', 'station') AND event_type = 'SessionEnded'`,
        )
        .all(branchId) as Array<{ payload: string }>
    ).map((row) => sessionIdOf(row.payload)),
  );
  const open: RememberedSession[] = [];
  const seen = new Set<string>();
  for (const row of started) {
    const session = rememberedFrom(JSON.parse(row.payload) as Record<string, unknown>);
    if (session === undefined || ended.has(session.session_id) || seen.has(session.session_id)) continue;
    seen.add(session.session_id);
    open.push(session);
  }
  if (open.length === 0) return;
  writer.run((tx) => {
    tx.append(open.map((session) => sessionEndedDraft(session, clock.branchNow())));
  });
}

function applyAccessEvent(
  tx: Database.Database,
  event: PosEvent,
  mode: 'live' | 'catchup',
  pending: Map<string, RememberedSession>,
): void {
  const payload = event.payload;
  if (event.event_type === 'DevicePaired') {
    const at = event.recorded_at;
    if (typeof payload.pairing_token_id === 'string') {
      tx.prepare('UPDATE pairing_tokens SET consumed_at = COALESCE(consumed_at, ?) WHERE pairing_token_id = ?').run(
        at,
        payload.pairing_token_id,
      );
    }
    if (typeof payload.pairing_request_id === 'string') {
      tx.prepare('UPDATE pair_requests SET approved_at = COALESCE(approved_at, ?) WHERE request_id = ?').run(
        at,
        payload.pairing_request_id,
      );
    }
    return;
  }
  if (event.event_type === 'DeviceTokenRotated') {
    if (mode !== 'catchup') return;
    tx.prepare(
      `UPDATE devices SET token_hash = 'rotated:' || ? WHERE device_id = ? AND token_hash NOT LIKE 'rotated:%'`,
    ).run(event.event_id, payload.device_id);
    return;
  }
  if (event.event_type === 'DeviceRevoked') {
    tx.prepare('UPDATE devices SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?').run(
      event.recorded_at,
      payload.device_id,
    );
    return;
  }
  if (event.event_type === 'SessionEnded') {
    const sessionId = payload.session_id;
    if (typeof sessionId === 'string') pending.delete(sessionId);
    tx.prepare(
      `UPDATE staff_sessions
       SET ended_at = COALESCE(ended_at, ?), end_reason = COALESCE(end_reason, ?)
       WHERE session_id = ?`,
    ).run(event.recorded_at, payload.reason, sessionId);
    return;
  }
  if (event.event_type === 'SessionStarted' && mode === 'catchup') {
    const session = rememberedFrom(payload);
    if (session === undefined) return;
    const row = tx.prepare('SELECT 1 AS ok FROM staff_sessions WHERE session_id = ?').get(session.session_id);
    if (row === undefined) pending.set(session.session_id, session);
  }
}

function rememberedFrom(payload: Record<string, unknown>): RememberedSession | undefined {
  const sessionId = payload.session_id;
  const kind = payload.kind;
  if (typeof sessionId !== 'string' || !isKind(kind)) return undefined;
  return {
    session_id: sessionId,
    kind,
    staff_id: typeof payload.staff_id === 'string' ? payload.staff_id : null,
    station_id: typeof payload.station_id === 'string' ? payload.station_id : null,
    device_id: typeof payload.device_id === 'string' ? payload.device_id : null,
  };
}

function isKind(value: unknown): value is SessionKind {
  return value === 'staff' || value === 'admin' || value === 'station';
}

function sessionIdOf(payload: string): string {
  const parsed = JSON.parse(payload) as { session_id?: unknown };
  return typeof parsed.session_id === 'string' ? parsed.session_id : '';
}

function sessionEndedDraft(session: RememberedSession, now: number): EventDraft {
  const station = session.kind === 'station';
  return {
    stream_type: station ? 'station' : 'staff',
    stream_id: station ? (session.station_id ?? '') : (session.staff_id ?? ''),
    event_type: 'SessionEnded',
    schema_version: 1,
    payload: {
      session_id: session.session_id,
      kind: session.kind,
      staff_id: session.staff_id,
      station_id: session.station_id,
      reason: 'hub_restored',
      ended_by: null,
    },
    occurred_at: now,
    actor_id: null,
    device_id: session.device_id ?? 'hub',
  };
}
