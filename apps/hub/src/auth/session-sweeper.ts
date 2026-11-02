/// <reference types="node" />
import type Database from 'better-sqlite3';
import type { HubDeps } from '../server.js';
import type { WriterTx } from '../engine-host/writer.js';
import { purgeAlerts } from '../alerts/retention.js';
import { clearExpiredDeliveryTokens } from './pair-requests.js';
import { activity, endSession, type SessionRow } from './session-store.js';

const SWEEP_MS = 15_000;
const DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const BATCH = 500;

const SESSION_COLUMNS =
  'session_id, kind, staff_id, station_id, device_id, idle_ttl_ms, last_activity_at, ended_at, token_hash';

let maintenanceHour: number | undefined;
const retentionDays = new WeakMap<Database.Database, string>();

export function setMaintenanceHour(hour: number): void {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('maintenance hour must be 0–23');
  maintenanceHour = hour;
}

export function sweepOnce(deps: HubDeps): { ended: string[] } {
  const touches = activity.drain();
  const devices = activity.drainDevices();
  const ended = deps.writer.run((tx) => {
    const touch = tx.db.prepare(
      `UPDATE staff_sessions SET last_activity_at = ?
       WHERE session_id = ? AND ended_at IS NULL AND last_activity_at < ?`,
    );
    for (const [sessionId, at] of touches) touch.run(at, sessionId, at);
    const seen = tx.db.prepare(
      `UPDATE devices SET last_seen_at = ? WHERE device_id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)`,
    );
    for (const [deviceId, at] of devices) seen.run(at, deviceId, at);
    const now = tx.clock.branchNow();
    const idle = tx.db
      .prepare(
        `SELECT ${SESSION_COLUMNS} FROM staff_sessions
         WHERE ended_at IS NULL AND kind != 'station' AND idle_ttl_ms IS NOT NULL
           AND (? - last_activity_at) > idle_ttl_ms`,
      )
      .all(now) as SessionRow[];
    const ids: string[] = [];
    for (const session of idle) {
      const deviceId = session.kind === 'admin' && session.device_id === null ? 'hub-admin' : (session.device_id ?? 'hub');
      endSession(tx, session, 'idle_timeout', null, null, deviceId);
      ids.push(session.session_id);
    }
    clearExpiredDeliveryTokens(tx, now);
    return ids;
  }).result;
  return { ended };
}

export interface SweeperLog {
  error(obj: Record<string, unknown>, msg?: string): void;
}

export function startSweeper(deps: HubDeps, log: SweeperLog): () => void {
  const timer = setInterval(() => {
    // H-8 (§7.3): an error in a run is logged and the next run continues. `err` is pino's Error key (AD-20).
    try {
      sweepOnce(deps);
      retentionOnce(deps, deps.clock.branchNow());
    } catch (error) {
      log.error({ timer: 'sweeper', err: error }, 'sweeper run failed');
    }
  }, SWEEP_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export function retentionOnce(deps: HubDeps, now: number): { deleted: number } {
  const hour = maintenanceHour ?? deps.config.maintenance_hour;
  if (new Date(now).getHours() !== hour) return { deleted: 0 };
  const day = localDay(now);
  if (retentionDays.get(deps.db) === day) return { deleted: 0 };
  const deleted = purge(deps, now);
  retentionDays.set(deps.db, day);
  return { deleted };
}

function purge(deps: HubDeps, now: number): number {
  const seven = now - SEVEN_DAYS_MS;
  const one = now - DAY_MS;
  const batches: Array<{ probe: string; remove: string; args: (tx: WriterTx) => Array<string | number> }> = [
    {
      probe: `SELECT 1 FROM staff_sessions WHERE branch_id = ? AND ended_at IS NOT NULL AND ended_at < ? LIMIT 1`,
      remove: `DELETE FROM staff_sessions WHERE session_id IN (
        SELECT session_id FROM staff_sessions WHERE branch_id = ? AND ended_at IS NOT NULL AND ended_at < ? LIMIT ${BATCH}
      )`,
      args: (tx) => [tx.branchId, seven],
    },
    {
      probe: `SELECT 1 FROM pairing_tokens WHERE branch_id = ? AND expires_at < ? LIMIT 1`,
      remove: `DELETE FROM pairing_tokens WHERE pairing_token_id IN (
        SELECT pairing_token_id FROM pairing_tokens WHERE branch_id = ? AND expires_at < ? LIMIT ${BATCH}
      )`,
      args: (tx) => [tx.branchId, seven],
    },
    {
      probe: `SELECT 1 FROM pair_requests WHERE branch_id = ? AND expires_at < ? LIMIT 1`,
      remove: `DELETE FROM pair_requests WHERE request_id IN (
        SELECT request_id FROM pair_requests WHERE branch_id = ? AND expires_at < ? LIMIT ${BATCH}
      )`,
      args: (tx) => [tx.branchId, seven],
    },
    {
      probe: `SELECT 1 FROM admin_bootstrap_tokens WHERE branch_id = ? AND expires_at < ? LIMIT 1`,
      remove: `DELETE FROM admin_bootstrap_tokens WHERE bootstrap_token_id IN (
        SELECT bootstrap_token_id FROM admin_bootstrap_tokens WHERE branch_id = ? AND expires_at < ? LIMIT ${BATCH}
      )`,
      args: (tx) => [tx.branchId, seven],
    },
    {
      probe: `SELECT 1 FROM processed_commands WHERE branch_id = ? AND recorded_at < ? LIMIT 1`,
      remove: `DELETE FROM processed_commands WHERE command_id IN (
        SELECT command_id FROM processed_commands WHERE branch_id = ? AND recorded_at < ? LIMIT ${BATCH}
      )`,
      args: (tx) => [tx.branchId, seven],
    },
    {
      probe: `SELECT 1 FROM auth_lockouts WHERE branch_id = ? AND (locked_until IS NULL OR locked_until <= ?) AND window_started_at < ? LIMIT 1`,
      remove: `DELETE FROM auth_lockouts WHERE rowid IN (
        SELECT rowid FROM auth_lockouts
        WHERE branch_id = ? AND (locked_until IS NULL OR locked_until <= ?) AND window_started_at < ?
        LIMIT ${BATCH}
      )`,
      args: (tx) => [tx.branchId, now, one],
    },
  ];
  const branchId = deps.config.provisioned?.branch_id;
  if (branchId === undefined) return 0;
  let deleted = 0;
  let more = true;
  while (more) {
    more = false;
    for (const batch of batches) {
      const sample = batch.args({ branchId } as WriterTx);
      if (deps.db.prepare(batch.probe).get(...sample) === undefined) continue;
      const n = deps.writer.run((tx) => deps.db.prepare(batch.remove).run(...batch.args(tx)).changes).result;
      deleted += n;
      if (n > 0) more = true;
    }
  }
  // 01d §5.1 (task 38): the alert projection rows, after 00's own batches
  return deleted + purgeAlerts(deps, branchId, now);
}

function localDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
