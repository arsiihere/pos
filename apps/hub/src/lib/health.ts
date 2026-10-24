import { DomainError, statusOf } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import type { Clock } from './clock.js';

export const HUB_VERSION = '0.0.0';

export interface HealthRead {
  status: 'booting' | 'setup' | 'ready';
  bootStep: string;
  provisioned: boolean;
  confirmed: boolean;
  branchId: string | null;
  clockAlarm: { wall_ms: number; last_recorded_at: number; delta_ms: number } | null;
  db: Database.Database;
}

export function registerHealth(app: FastifyInstance, read: () => HealthRead): void {
  app.get('/health', { config: { group: 'health' } }, (request) => {
    const snap = read();
    if (request.isGuest === true) return { data: { status: snap.status } };
    return {
      data: {
        status: snap.status,
        boot_step: snap.bootStep,
        provisioned: snap.provisioned,
        confirmed: snap.confirmed,
        branch_id: snap.branchId,
        max_seq: maxSeq(snap.db, snap.branchId),
        hub_version: HUB_VERSION,
        clock_alarm: snap.clockAlarm,
      },
    };
  });
}

export function installHealthErrors(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);
    if (error instanceof DomainError) {
      return reply.status(statusOf(error.code)).send({
        error: { code: error.code, message: error.message, details: error.details, request_id: requestId },
      });
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'INTERNAL_ERROR', details: {}, request_id: requestId },
    });
  });
}

export function startHeartbeat(db: Database.Database, clock: Clock, branchId: string): () => void {
  const write = db.prepare(
    `INSERT INTO hub_heartbeat (branch_id, last_beat) VALUES (?, ?)
     ON CONFLICT (branch_id) DO UPDATE SET last_beat = excluded.last_beat`,
  );
  const timer = setInterval(() => {
    write.run(branchId, clock.branchNow());
  }, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export function readHeartbeat(db: Database.Database, branchId: string): number | null {
  const row = db.prepare('SELECT last_beat FROM hub_heartbeat WHERE branch_id = ?').get(branchId) as
    | { last_beat: number }
    | undefined;
  return row === undefined ? null : row.last_beat;
}

function maxSeq(db: Database.Database, branchId: string | null): number | null {
  if (branchId === null) return null;
  const row = db.prepare('SELECT MAX(seq) AS seq FROM events WHERE branch_id = ?').get(branchId) as {
    seq: number | null;
  };
  return row.seq;
}
