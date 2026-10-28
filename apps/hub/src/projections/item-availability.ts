import type Database from 'better-sqlite3';
import type { Projection } from './registry.js';

export const itemAvailabilityProjection: Projection = {
  name: 'item_availability',
  eventTypes: ['ItemMadeUnavailable', 'ItemMadeAvailable'],
  apply(tx, event) {
    const { item_id } = event.payload as { item_id: string };
    tx.prepare(
      `INSERT INTO item_availability (item_id, is_available, changed_at, changed_by) VALUES (?, ?, ?, ?)
       ON CONFLICT (item_id) DO UPDATE SET
         is_available = excluded.is_available, changed_at = excluded.changed_at, changed_by = excluded.changed_by`,
    ).run(item_id, event.event_type === 'ItemMadeAvailable' ? 1 : 0, event.recorded_at, event.actor_id);
  },
  reset(tx) {
    tx.prepare('DELETE FROM item_availability').run();
  },
};

// S17: a missing row means available.
export function itemAvailability(db: Database.Database, itemIds: readonly string[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  if (itemIds.length === 0) return result;
  const rows = db
    .prepare(
      `SELECT item_id, is_available FROM item_availability
       WHERE item_id IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(itemIds)) as Array<{ item_id: string; is_available: number }>;
  for (const id of itemIds) result.set(id, true);
  for (const row of rows) result.set(row.item_id, row.is_available === 1);
  return result;
}
