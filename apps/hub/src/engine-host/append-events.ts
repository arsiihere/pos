import { parseEvent, type EventDraft, type PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { Clock } from '../lib/clock.js';
import type { IdGen } from '../lib/ids.js';

export function appendEvents(
  tx: Database.Database,
  drafts: EventDraft[],
  ctx: { clock: Clock; ids: IdGen; tenantId: string; branchId: string },
): PosEvent[] {
  if (!tx.inTransaction) throw new Error('appendEvents requires a transaction');
  // AD-34: nothing to append → no statement (no MAX(seq) read; 03a §10.5).
  if (drafts.length === 0) return [];
  const recordedAt = ctx.clock.branchNow();
  const row = tx.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE branch_id = ?').get(ctx.branchId) as {
    seq: number;
  };
  let seq = row.seq;
  const events = drafts.map((draft) => {
    seq += 1;
    return parseEvent({
      ...draft,
      event_id: ctx.ids.next(),
      seq,
      recorded_at: recordedAt,
      tenant_id: ctx.tenantId,
      branch_id: ctx.branchId,
    });
  });
  const insert = tx.prepare(
    `INSERT INTO events (
      event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
      schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const event of events) {
    insert.run(
      event.event_id,
      event.tenant_id,
      event.branch_id,
      event.stream_type,
      event.stream_id,
      event.event_type,
      event.schema_version,
      JSON.stringify(event.payload),
      event.occurred_at,
      event.recorded_at,
      event.actor_id,
      event.device_id,
      event.seq,
    );
  }
  return events;
}
