import { afterEach, describe, expect, it, vi } from 'vitest';
import { activity } from '../../src/auth/session-store';
import { retentionOnce, setMaintenanceHour, startSweeper, sweepOnce } from '../../src/auth/session-sweeper';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

const cleanups: Array<() => Promise<void> | void> = [];

describe('session sweeper and retention', () => {
  afterEach(async () => {
    vi.useRealTimers();
    for (const cleanup of cleanups.splice(0)) await cleanup();
    activity.drain();
    activity.drainDevices();
  });

  it('[00 §10 #69] the sweeper ends idle staff and admin sessions within 15 s and never station sessions', async () => {
    const hub = await open();
    const directory = await aDirectory();
    directory.roles.push({ role_id: 'R_LONG', name: 'Long', session_idle_ttl_ms: 5_000_000, permissions: [] });
    const cashier = directory.staff.find((staff) => staff.staff_id === 'S_CASH');
    if (cashier === undefined) throw new Error('fixture has no cashier');
    cashier.role_ids.push('R_LONG');
    await seedDirectory(hub, directory);
    const tablet = pairDevice(hub, { type: 'tablet' });
    const kds = pairDevice(hub, { type: 'kds', stationId: 'station-1' });
    const waiter = openSession(hub, { kind: 'staff', staffId: 'S_WAIT', deviceId: tablet.deviceId });
    const admin = openSession(hub, { kind: 'admin', staffId: 'S_OWNER', deviceId: tablet.deviceId });
    const cashierSession = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: pairDevice(hub, { type: 'cashier_kiosk' }).deviceId });
    const station = openSession(hub, { kind: 'station', deviceId: kds.deviceId, stationId: 'station-1' });
    expect(idleTtl(hub, cashierSession.sessionId)).toBe(5_000_000);
    expect(idleTtl(hub, waiter.sessionId)).toBe(300_000);

    const kept = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: pairDevice(hub, { type: 'tablet' }).deviceId });
    insertDelivery(hub, 'req-expired', hub.clock.branchNow() - 1, 'plain-expired');
    insertDelivery(hub, 'req-live', hub.clock.branchNow() + 20_000_000, 'plain-live');

    hub.clock.advance(300_000);
    const touched = hub.clock.branchNow();
    activity.touch(kept.sessionId, touched);
    activity.deviceSeen(tablet.deviceId, touched);
    expect(sweepOnce(hub.deps).ended).toEqual([]);
    expect(endReason(hub, waiter.sessionId)).toBeNull();

    hub.clock.advance(1);
    const ended = sweepOnce(hub.deps);
    expect(ended.ended).toEqual([waiter.sessionId]);
    expect(endReason(hub, waiter.sessionId)).toBe('idle_timeout');
    expect(sessionEnded(hub, waiter.sessionId)).toMatchObject({ reason: 'idle_timeout', ended_by: null, kind: 'staff' });
    expect(endReason(hub, admin.sessionId)).toBeNull();
    expect(endReason(hub, cashierSession.sessionId)).toBeNull();
    expect(endReason(hub, station.sessionId)).toBeNull();
    expect(endReason(hub, kept.sessionId)).toBeNull();
    expect(lastActivity(hub, kept.sessionId)).toBe(touched);
    expect(lastSeen(hub, tablet.deviceId)).toBe(touched);
    expect(deliveryToken(hub, 'req-expired')).toBeNull();
    expect(deliveryToken(hub, 'req-live')).toBe('plain-live');
    hub.deps.db.prepare(`UPDATE staff_sessions SET ended_at = ?, end_reason = 'logout' WHERE session_id = ?`).run(hub.clock.branchNow(), kept.sessionId);

    hub.clock.advance(3_600_000 - 300_001);
    expect(sweepOnce(hub.deps).ended).toEqual([]);
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([admin.sessionId]);
    expect(sessionEnded(hub, admin.sessionId)).toMatchObject({ reason: 'idle_timeout', kind: 'admin', ended_by: null });
    expect(endReason(hub, cashierSession.sessionId)).toBeNull();
    expect(endReason(hub, station.sessionId)).toBeNull();

    hub.clock.advance(5_000_000 - 3_600_001);
    expect(sweepOnce(hub.deps).ended).toEqual([]);
    hub.clock.advance(1);
    expect(sweepOnce(hub.deps).ended).toEqual([cashierSession.sessionId]);
    expect(endReason(hub, station.sessionId)).toBeNull();

    const late = openSession(hub, { kind: 'staff', staffId: 'S_MGR', deviceId: pairDevice(hub, { type: 'phone', ownerStaffId: 'S_MGR' }).deviceId });
    const lateTtl = idleTtl(hub, late.sessionId);
    hub.clock.advance(lateTtl + 1);
    expect(endReason(hub, late.sessionId)).toBeNull();
    vi.useFakeTimers();
    const stop = startSweeper(hub.deps);
    cleanups.push(stop);
    vi.advanceTimersByTime(14_999);
    expect(endReason(hub, late.sessionId)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(endReason(hub, late.sessionId)).toBe('idle_timeout');
    expect(endReason(hub, station.sessionId)).toBeNull();
  });

  it('[00 §10 #121] retention runs in the maintenance hour, in batches of 500, once per local day', async () => {
    const hub = await open();
    const atFour = atLocalHour(hub.clock.branchNow(), 4);
    const cutoff = atFour - SEVEN_DAYS_MS;
    insertCommands(hub, 1_000, cutoff - 1);
    insertCommand(hub, 'boundary', cutoff);
    insertEndedSession(hub, 'sess-old', cutoff - 1);
    insertEndedSession(hub, 'sess-new', atFour - DAY_MS);
    insertPairingToken(hub, 'pair-old', cutoff - 1);
    insertPairingToken(hub, 'pair-new', atFour - DAY_MS);
    insertPairRequest(hub, 'preq-old', cutoff - 1);
    insertPairRequest(hub, 'preq-new', atFour - DAY_MS);
    insertBootstrap(hub, 'boot-old', cutoff - 1);
    insertBootstrap(hub, 'boot-new', atFour - DAY_MS);
    insertLockout(hub, 'old-open', cutoff - 1, null);
    insertLockout(hub, 'old-locked', cutoff - 1, atFour + DAY_MS);
    insertLockout(hub, 'fresh-open', atFour - DAY_MS, null);

    setMaintenanceHour(4);
    expect(retentionOnce(hub.deps, atLocalHour(atFour, 5)).deleted).toBe(0);
    expect(countCommands(hub, cutoff)).toBe(1_000);

    let sawBatch = false;
    hub.deps.writer.addAfterCommit(() => {
      if (sawBatch) return;
      if (countCommands(hub, cutoff) !== 500) return;
      sawBatch = true;
      hub.deps.writer.run((tx) => {
        tx.db
          .prepare(
            `INSERT INTO processed_commands (
              command_id, branch_id, device_id, session_id, command_type, payload_hash, response_json, recorded_at
            ) VALUES ('between-batches', 'branch-1', 'dev', NULL, 'TestNoop', 'hash', '{}', ?)`,
          )
          .run(atFour);
      });
    });
    const deleted = retentionOnce(hub.deps, atFour);
    expect(sawBatch).toBe(true);
    expect(deleted.deleted).toBe(1_000 + 5);
    expect(countCommands(hub, cutoff)).toBe(0);
    expect(commandExists(hub, 'boundary')).toBe(true);
    expect(commandExists(hub, 'between-batches')).toBe(true);
    expect(sessionExists(hub, 'sess-old')).toBe(false);
    expect(sessionExists(hub, 'sess-new')).toBe(true);
    expect(rowExists(hub, 'pairing_tokens', 'pairing_token_id', 'pair-old')).toBe(false);
    expect(rowExists(hub, 'pairing_tokens', 'pairing_token_id', 'pair-new')).toBe(true);
    expect(rowExists(hub, 'pair_requests', 'request_id', 'preq-old')).toBe(false);
    expect(rowExists(hub, 'pair_requests', 'request_id', 'preq-new')).toBe(true);
    expect(rowExists(hub, 'admin_bootstrap_tokens', 'bootstrap_token_id', 'boot-old')).toBe(false);
    expect(rowExists(hub, 'admin_bootstrap_tokens', 'bootstrap_token_id', 'boot-new')).toBe(true);
    expect(lockoutExists(hub, 'old-open')).toBe(false);
    expect(lockoutExists(hub, 'old-locked')).toBe(true);
    expect(lockoutExists(hub, 'fresh-open')).toBe(true);

    insertCommands(hub, 10, cutoff - 1, 'later');
    expect(retentionOnce(hub.deps, atFour).deleted).toBe(0);
    expect(countCommands(hub, cutoff)).toBe(10);
    const nextDay = nextLocalDay(atFour);
    expect(retentionOnce(hub.deps, nextDay).deleted).toBe(13);
    expect(countCommands(hub, nextDay - SEVEN_DAYS_MS)).toBe(0);
    expect(commandExists(hub, 'boundary')).toBe(false);
    expect(commandExists(hub, 'between-batches')).toBe(true);
    expect(lockoutExists(hub, 'fresh-open')).toBe(false);
    expect(lockoutExists(hub, 'old-locked')).toBe(false);
    expect(sessionExists(hub, 'sess-new')).toBe(true);
    expect(rowExists(hub, 'pairing_tokens', 'pairing_token_id', 'pair-new')).toBe(true);
    expect(rowExists(hub, 'pair_requests', 'request_id', 'preq-new')).toBe(true);
    expect(rowExists(hub, 'admin_bootstrap_tokens', 'bootstrap_token_id', 'boot-new')).toBe(true);
  });
});

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  return hub;
}

function atLocalHour(now: number, hour: number): number {
  const date = new Date(now);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function nextLocalDay(now: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function idleTtl(hub: TestHub, sessionId: string): number {
  return hub.deps.db.prepare('SELECT idle_ttl_ms FROM staff_sessions WHERE session_id = ?').pluck().get(sessionId) as number;
}

function endReason(hub: TestHub, sessionId: string): string | null {
  return hub.deps.db.prepare('SELECT end_reason FROM staff_sessions WHERE session_id = ?').pluck().get(sessionId) as string | null;
}

function lastActivity(hub: TestHub, sessionId: string): number {
  return hub.deps.db.prepare('SELECT last_activity_at FROM staff_sessions WHERE session_id = ?').pluck().get(sessionId) as number;
}

function lastSeen(hub: TestHub, deviceId: string): number | null {
  return hub.deps.db.prepare('SELECT last_seen_at FROM devices WHERE device_id = ?').pluck().get(deviceId) as number | null;
}

function deliveryToken(hub: TestHub, requestId: string): string | null {
  return hub.deps.db.prepare('SELECT delivery_token FROM pair_requests WHERE request_id = ?').pluck().get(requestId) as string | null;
}

function sessionEnded(hub: TestHub, sessionId: string): Record<string, unknown> | undefined {
  const rows = hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'SessionEnded'`).all() as Array<{ payload: string }>;
  return rows.map((row) => JSON.parse(row.payload) as Record<string, unknown>).find((payload) => payload.session_id === sessionId);
}

function insertDelivery(hub: TestHub, requestId: string, expiresAt: number, token: string): void {
  hub.deps.db
    .prepare(
      `INSERT INTO pair_requests (
        request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at, delivery_token
      ) VALUES (?, 'branch-1', 'hash', 'ABCDEF', 'screen', '10.0.0.8', ?, ?, ?)`,
    )
    .run(requestId, expiresAt - 1, expiresAt, token);
}

function insertCommands(hub: TestHub, count: number, recordedAt: number, prefix = 'old'): void {
  const insert = hub.deps.db.prepare(
    `INSERT INTO processed_commands (
      command_id, branch_id, device_id, session_id, command_type, payload_hash, response_json, recorded_at
    ) VALUES (?, 'branch-1', 'dev', NULL, 'TestNoop', 'hash', '{}', ?)`,
  );
  hub.deps.db.transaction(() => {
    for (let i = 0; i < count; i += 1) insert.run(`${prefix}-${i}`, recordedAt);
  })();
}

function insertCommand(hub: TestHub, commandId: string, recordedAt: number): void {
  hub.deps.db
    .prepare(
      `INSERT INTO processed_commands (
        command_id, branch_id, device_id, session_id, command_type, payload_hash, response_json, recorded_at
      ) VALUES (?, 'branch-1', 'dev', NULL, 'TestNoop', 'hash', '{}', ?)`,
    )
    .run(commandId, recordedAt);
}

function insertEndedSession(hub: TestHub, sessionId: string, endedAt: number): void {
  hub.deps.db
    .prepare(
      `INSERT INTO staff_sessions (
        session_id, branch_id, token_hash, kind, staff_id, device_id, idle_ttl_ms, started_at, last_activity_at, ended_at, end_reason
      ) VALUES (?, 'branch-1', ?, 'staff', 'S_CASH', 'dev-old', 1800000, ?, ?, ?, 'logout')`,
    )
    .run(sessionId, `hash-${sessionId}`, endedAt - 1, endedAt - 1, endedAt);
}

function insertPairingToken(hub: TestHub, tokenId: string, expiresAt: number): void {
  hub.deps.db
    .prepare(
      `INSERT INTO pairing_tokens (
        pairing_token_id, branch_id, token_hash, device_type, created_by, created_at, expires_at
      ) VALUES (?, 'branch-1', ?, 'tablet', 'S_MGR', ?, ?)`,
    )
    .run(tokenId, `hash-${tokenId}`, expiresAt - 1, expiresAt);
}

function insertPairRequest(hub: TestHub, requestId: string, expiresAt: number): void {
  hub.deps.db
    .prepare(
      `INSERT INTO pair_requests (
        request_id, branch_id, poll_secret_hash, display_code, device_name, requester_ip, created_at, expires_at
      ) VALUES (?, 'branch-1', 'hash', 'ABCDEF', 'screen', '10.0.0.9', ?, ?)`,
    )
    .run(requestId, expiresAt - 1, expiresAt);
}

function insertBootstrap(hub: TestHub, tokenId: string, expiresAt: number): void {
  hub.deps.db
    .prepare(
      `INSERT INTO admin_bootstrap_tokens (bootstrap_token_id, branch_id, token_hash, created_at, expires_at)
       VALUES (?, 'branch-1', ?, ?, ?)`,
    )
    .run(tokenId, `hash-${tokenId}`, expiresAt - 1, expiresAt);
}

function insertLockout(hub: TestHub, subjectId: string, windowStartedAt: number, lockedUntil: number | null): void {
  hub.deps.db
    .prepare(
      `INSERT INTO auth_lockouts (branch_id, subject_type, subject_id, failed_count, window_started_at, locked_until)
       VALUES ('branch-1', 'staff', ?, 1, ?, ?)`,
    )
    .run(subjectId, windowStartedAt, lockedUntil);
}

function countCommands(hub: TestHub, cutoff: number): number {
  const row = hub.deps.db.prepare('SELECT COUNT(*) AS n FROM processed_commands WHERE recorded_at < ?').get(cutoff) as { n: number };
  return row.n;
}

function commandExists(hub: TestHub, commandId: string): boolean {
  return hub.deps.db.prepare('SELECT 1 AS ok FROM processed_commands WHERE command_id = ?').get(commandId) !== undefined;
}

function sessionExists(hub: TestHub, sessionId: string): boolean {
  return hub.deps.db.prepare('SELECT 1 AS ok FROM staff_sessions WHERE session_id = ?').get(sessionId) !== undefined;
}

function rowExists(hub: TestHub, table: string, column: string, id: string): boolean {
  return hub.deps.db.prepare(`SELECT 1 AS ok FROM ${table} WHERE ${column} = ?`).get(id) !== undefined;
}

function lockoutExists(hub: TestHub, subjectId: string): boolean {
  return hub.deps.db.prepare(`SELECT 1 AS ok FROM auth_lockouts WHERE subject_id = ?`).get(subjectId) !== undefined;
}
