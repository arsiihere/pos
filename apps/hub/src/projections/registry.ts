import { parseEvent, type PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';

const PAGE = 1000;

export interface Projection {
  name: string;
  eventTypes: string[];
  apply(tx: Database.Database, e: PosEvent, mode: 'live' | 'catchup'): void;
  reset?(tx: Database.Database): void;
}

export interface ProjectionRegistry {
  register(p: Projection): void;
  applyAll(tx: Database.Database, events: PosEvent[], branchId: string): void;
  catchUp(db: Database.Database, branchId: string): { replayed: Record<string, number> };
  afterCatchUp(fn: (tx: Database.Database) => void): void;
}

interface EventRow {
  event_id: string;
  tenant_id: string;
  branch_id: string;
  stream_type: PosEvent['stream_type'];
  stream_id: string;
  event_type: string;
  schema_version: number;
  payload: string;
  occurred_at: number;
  recorded_at: number;
  actor_id: string | null;
  device_id: string;
  seq: number;
}

export function createProjectionRegistry(): ProjectionRegistry {
  const projections: Projection[] = [];
  const hooks: Array<(tx: Database.Database) => void> = [];
  return {
    register(projection) {
      projections.push(projection);
    },
    afterCatchUp(fn) {
      hooks.push(fn);
    },
    applyAll(tx, events, branchId) {
      for (const event of events) {
        for (const projection of projections) {
          if (projection.eventTypes.includes(event.event_type)) projection.apply(tx, event, 'live');
        }
      }
      const last = events[events.length - 1];
      if (last === undefined) return;
      // 00 M48 (04 §4.5 H-2): only existing rows advance; catchUp writes a projection's first row.
      const advance = tx.prepare('UPDATE projection_checkpoints SET last_seq = ? WHERE branch_id = ? AND projection = ?');
      for (const projection of projections) advance.run(last.seq, branchId, projection.name);
    },
    catchUp(db, branchId) {
      const replayed: Record<string, number> = {};
      for (const projection of projections) replayed[projection.name] = 0;
      const maxSeq = (
        db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE branch_id = ?').get(branchId) as {
          seq: number;
        }
      ).seq;
      const stored = db.prepare('SELECT last_seq FROM projection_checkpoints WHERE branch_id = ? AND projection = ?');
      const jobs: Array<{ projection: Projection; from: number; reset: boolean }> = [];
      for (const projection of projections) {
        const row = stored.get(branchId, projection.name) as { last_seq: number } | undefined;
        if (row !== undefined && row.last_seq >= maxSeq) continue;
        jobs.push({ projection, from: row?.last_seq ?? 0, reset: row === undefined && projection.reset !== undefined });
      }
      if (jobs.length === 0) {
        if (hooks.length > 0) {
          db.transaction(() => {
            for (const fn of hooks) fn(db);
          }).immediate();
        }
        return { replayed };
      }
      const upsert = checkpointUpsert(db);
      const peek = db.prepare(
        `SELECT seq FROM events WHERE branch_id = ? AND seq > ? ORDER BY seq LIMIT ${PAGE + 1}`,
      );
      const page = db.prepare(
        `SELECT event_id, tenant_id, branch_id, stream_type, stream_id, event_type, schema_version,
                payload, occurred_at, recorded_at, actor_id, device_id, seq
         FROM events WHERE branch_id = ? AND seq > ? ORDER BY seq LIMIT ${PAGE}`,
      );
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index]!;
        let cursor = job.from;
        let resetPending = job.reset;
        const lastJob = index === jobs.length - 1;
        for (;;) {
          const ahead = peek.all(branchId, cursor) as Array<{ seq: number }>;
          const lastPage = ahead.length <= PAGE;
          db.transaction(() => {
            if (resetPending && job.projection.reset !== undefined) job.projection.reset(db);
            const rows = page.all(branchId, cursor) as EventRow[];
            for (const row of rows) {
              const event = parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] });
              if (!job.projection.eventTypes.includes(event.event_type)) continue;
              job.projection.apply(db, event, 'catchup');
              replayed[job.projection.name] = (replayed[job.projection.name] ?? 0) + 1;
            }
            const tip = rows.length > 0 ? rows[rows.length - 1]!.seq : maxSeq;
            upsert.run(branchId, job.projection.name, tip);
            if (lastPage && lastJob) {
              for (const fn of hooks) fn(db);
            }
          }).immediate();
          resetPending = false;
          if (lastPage) break;
          cursor = ahead[PAGE - 1]!.seq;
        }
      }
      return { replayed };
    },
  };
}

function checkpointUpsert(db: Database.Database): Database.Statement {
  return db.prepare(
    `INSERT INTO projection_checkpoints (branch_id, projection, last_seq)
     VALUES (?, ?, ?)
     ON CONFLICT (branch_id, projection) DO UPDATE SET last_seq = excluded.last_seq`,
  );
}
