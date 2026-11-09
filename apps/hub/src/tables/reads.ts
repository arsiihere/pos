import type { TableState } from '@pos/domain';
import { branchConfig, zoneOfTable } from '../sync/branch-config-holder.js';
import type { CurrentTableOf, HoldersOfOrders, SeatingOf, TableOwners, ZoneOf } from './contracts.js';
import type { StaffDirectory } from '../auth/staff-directory.js';

// 02a v1.1.1 §4.2 reads. Every reader but zoneOf is one batch-shaped statement over its ids (json_each); §12.3 note.

export const tableOwners: TableOwners = (db, table_ids) => {
  const rows = db
    .prepare(
      `SELECT st.table_id AS table_id, s.holder_staff_id AS holder
         FROM json_each(?) j
         JOIN seating_tables st ON st.table_id = j.value
         JOIN seatings s ON s.seating_id = st.seating_id`,
    )
    .all(JSON.stringify(table_ids)) as Array<{ table_id: string; holder: string }>;
  return new Map(rows.map((r) => [r.table_id, r.holder]));
};

export const holdersOfOrders: HoldersOfOrders = (db, order_ids) => {
  const rows = db
    .prepare(
      `SELECT so.order_id AS order_id, s.holder_staff_id AS holder
         FROM json_each(?) j
         JOIN seating_orders so ON so.order_id = j.value
         JOIN seatings s ON s.seating_id = so.seating_id`,
    )
    .all(JSON.stringify(order_ids)) as Array<{ order_id: string; holder: string }>;
  return new Map(rows.map((r) => [r.order_id, r.holder]));
};

export const currentTableOf: CurrentTableOf = (db, order_ids) => {
  const rows = db
    .prepare(
      `SELECT so.order_id AS order_id, s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, st.table_id AS table_id
         FROM json_each(?) j
         JOIN seating_orders so ON so.order_id = j.value
         JOIN seatings s ON s.seating_id = so.seating_id
         JOIN seating_tables st ON st.seating_id = s.seating_id
        ORDER BY so.order_id, st.joined_at, st.table_id`,
    )
    .all(JSON.stringify(order_ids)) as Array<{ order_id: string; seating_id: string; primary_table_id: string; table_id: string }>;
  const out: ReturnType<CurrentTableOf> = new Map();
  for (const r of rows) {
    const entry = out.get(r.order_id);
    if (entry === undefined) out.set(r.order_id, { seating_id: r.seating_id, primary_table_id: r.primary_table_id, table_ids: [r.table_id] });
    else entry.table_ids.push(r.table_id);
  }
  return out;
};

export const seatingOf: SeatingOf = (db, table_id) => {
  const rows = db
    .prepare(
      `SELECT s.seating_id AS seating_id, s.primary_table_id AS primary_table_id, s.state AS state,
              s.holder_staff_id AS holder_staff_id, st.table_id AS table_id
         FROM seating_tables mine
         JOIN seatings s ON s.seating_id = mine.seating_id
         JOIN seating_tables st ON st.seating_id = s.seating_id
        WHERE mine.table_id = ?
        ORDER BY st.joined_at, st.table_id`,
    )
    .all(table_id) as Array<{ seating_id: string; primary_table_id: string; state: TableState; holder_staff_id: string; table_id: string }>;
  const first = rows[0];
  if (first === undefined) return null;
  return {
    seating_id: first.seating_id,
    primary_table_id: first.primary_table_id,
    table_ids: rows.map((r) => r.table_id),
    state: first.state,
    holder_staff_id: first.holder_staff_id,
  };
};

// AD-6: registerTables hands over a getter, never the directory object, so a 01b apply that swaps the directory is
// seen on the next call.
let directoryOf: (() => StaffDirectory) | null = null;

export function bindZoneDirectory(getter: () => StaffDirectory): void {
  directoryOf = getter;
}

// §4.2: 0 statements. Floor and zone from the branch config; a table without a zone has zone_id null (T9).
// A table the config does not know (or no config yet) has floor_id ''.
export const zoneOf: ZoneOf = (table_id) => {
  if (directoryOf === null) throw new Error('zoneOf: tables are not registered');
  const floor_id = branchConfig()?.floors.find((f) => f.tables.some((t) => t.table_id === table_id))?.floor_id ?? '';
  return {
    floor_id,
    zone_id: zoneOfTable(table_id),
    zone_order_taker_staff_id: directoryOf().assignedOrderTaker(table_id),
  };
};
