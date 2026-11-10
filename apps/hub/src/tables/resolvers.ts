import { alertDirectoryOf } from '../alerts/raise.js';
import { cachedPrepare } from '../alerts/statements.js';
import { targetKey, type ResolvedTarget, type TargetResolver } from '../alerts/targets.js';
import { waiterTeam } from './team.js';

// 02a §4.2 resolver rows, §6.16, 01d D-1: batch-shaped, one call per tick (or raise) with every target of the kind.

// One statement: the open seatings of the targets' tables (any table of the seating, holder + primary table) and
// the branch's live staff sessions (index staff_sessions_active). `k` tells the two row kinds apart.
const TABLE_TEAM_SQL = `
  SELECT 'seat' AS k, st.table_id AS table_id, s.holder_staff_id AS staff_id, s.primary_table_id AS primary_table_id
    FROM json_each(@table_ids) j
    JOIN seating_tables st ON st.table_id = j.value
    JOIN seatings s ON s.seating_id = st.seating_id
   WHERE s.closed_at IS NULL
  UNION ALL
  SELECT 'live' AS k, NULL, staff_id, NULL
    FROM staff_sessions
   WHERE branch_id = @branch_id AND ended_at IS NULL AND kind = 'staff'`;

interface Row {
  k: 'seat' | 'live';
  table_id: string | null;
  staff_id: string;
  primary_table_id: string | null;
}

/**
 * `table_team` (D-1): per target `{ staff_ids, device_ids: [], owner_staff_id: holder }`; `owner` → [holder],
 * `direct` (or no depth) → W ∪ {holder} (§3.5), A = assignedOrderTaker(primary table) (T10). A table with no open
 * seating gets no entry: 01d reads a missing key as no recipients and no owner (`targets.ts` `resolved`).
 */
export const tableTeam: TargetResolver<'table_team'> = (tx, targets) => {
  const tableIds = [...new Set(targets.map((t) => t.table_id))];
  const rows = cachedPrepare(tx.db, TABLE_TEAM_SQL).all({ table_ids: JSON.stringify(tableIds), branch_id: tx.branchId }) as Row[];
  const seatings = new Map<string, { holder: string; primary: string }>();
  const live = new Set<string>();
  for (const row of rows) {
    if (row.k === 'live') live.add(row.staff_id);
    else seatings.set(row.table_id as string, { holder: row.staff_id, primary: row.primary_table_id as string });
  }
  const directory = alertDirectoryOf(tx);
  const out = new Map<string, ResolvedTarget>();
  for (const target of targets) {
    const seating = seatings.get(target.table_id);
    if (seating === undefined) continue;
    const staff_ids =
      target.depth === 'owner'
        ? [seating.holder]
        : waiterTeam({ assignee: directory.assignedOrderTaker(seating.primary), holder_staff_id: seating.holder }, live, directory);
    out.set(targetKey(target), { staff_ids, device_ids: [], owner_staff_id: seating.holder });
  }
  return out;
};

/** `zone_order_taker` (§6.16, SG-1 ruling): `assignedOrderTaker(table_id)`, in memory, 0 statements. */
export const zoneOrderTaker: TargetResolver<'zone_order_taker'> = (tx, targets) => {
  const directory = alertDirectoryOf(tx);
  return new Map(
    targets.map((target) => {
      const taker = directory.assignedOrderTaker(target.table_id);
      return [targetKey(target), { staff_ids: taker === null ? [] : [taker], device_ids: [] }];
    }),
  );
};
