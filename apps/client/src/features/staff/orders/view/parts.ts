import type { SeatingLine } from '../contracts';

// 02b v1.0.21 §8 (STAB-5, test 42): a line sent as one-unit parts (§3.2 step 4a, `part_of`) shows as one row per stage —
// "Karahi ×3 · cooking", "Karahi ×2 · waiting". The row is its first part with the parts' units and money summed and
// `part_ids` = its members; a child (option_child) follows its parent's row. An action on n of a grouped row names n
// parts of one unit each (`partEntries`); every command already takes several lines.

export type GroupedLine = SeatingLine & { part_ids?: string[] };

const SUMMED = ['quantity', 'units', 'live_units', 'comped_units', 'removed_units', 'voided_units', 'returned_units', 'refundable_minor', 'comp_minor', 'comp_voided_minor', 'removed_minor', 'refund_minor', 'line_total_minor', 'billed_minor'] as const;

// a comped or returned part is its own row (a comp names one line; its money differs)
const keyOf = (l: SeatingLine): string => `${l.part_of}|${l.stage ?? ''}|${l.fired ? 1 : 0}|${l.served_at === null ? 0 : 1}|${l.comped_units}|${l.returned_units}|${l.pending_comp == null ? 0 : 1}`;

export function groupParts(lines: readonly SeatingLine[]): GroupedLine[] {
  const rowOfPart = new Map<string, string>(); // part id → its row's first part
  const rows: GroupedLine[] = [];
  const byKey = new Map<string, GroupedLine>();
  for (const l of lines) {
    if (l.part_of === null || l.part_of === undefined) {
      rows.push(l);
      continue;
    }
    // a child's row also depends on its parent's row, so children of two parent rows stay apart
    const parentRow = l.parent_order_item_id === null ? '' : (rowOfPart.get(l.parent_order_item_id) ?? l.parent_order_item_id);
    const key = `${keyOf(l)}|${parentRow}`;
    const row = byKey.get(key);
    if (row === undefined) {
      const first: GroupedLine = { ...l, parent_order_item_id: l.parent_order_item_id === null ? null : parentRow, part_ids: [l.order_item_id] };
      byKey.set(key, first);
      rows.push(first);
      rowOfPart.set(l.order_item_id, l.order_item_id);
      continue;
    }
    for (const f of SUMMED) {
      const a = row[f] as number | null;
      const b = l[f] as number | null;
      (row as unknown as Record<string, unknown>)[f] = a === null || b === null ? null : a + b;
    }
    row.part_ids!.push(l.order_item_id);
    rowOfPart.set(l.order_item_id, row.order_item_id);
  }
  return rows;
}

/** n units of row `order_item_id`: its first n parts (one unit each), or the unsplit line with n units. */
export function partEntries(rows: readonly GroupedLine[], order_item_id: string, n: number): Array<{ order_item_id: string; units: number }> {
  const row = rows.find((r) => r.order_item_id === order_item_id);
  if (row?.part_ids === undefined) return [{ order_item_id, units: n }];
  return row.part_ids.slice(0, n).map((id) => ({ order_item_id: id, units: 1 }));
}
