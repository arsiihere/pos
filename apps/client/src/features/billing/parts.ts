import { groupByPartOf } from '@pos/domain';
import type { BillViewLine } from './contracts';

// 05 v1.0.33 §8 (STAB-5; proposal §3.4): a slot-station line of quantity n is n one-unit parts sharing `part_of`
// (02b v1.0.20 §3.2 step 4a). The bill screen shows the parts with the same name, tags, `added_after_close` and amount
// per unit as one row at the first part's place, units and amount summed (the hub's integers, nothing recomputed);
// the split editor steps a group's parts. Every command still names part ids.

/** a bill screen row: the first line with the summed units and amount, and the lines it stands for */
export interface BillRow {
  line: BillViewLine;
  parts: readonly BillViewLine[];
}

const keyOf = (l: BillViewLine): string | null =>
  l.part_of === undefined || l.part_of === null ? null : JSON.stringify([l.part_of, l.name, [...l.tags].sort(), l.added_after_close, l.units, l.base_minor]);

export function groupBillLines(lines: readonly BillViewLine[]): BillRow[] {
  return groupByPartOf(lines, keyOf).map((parts) => {
    const first = parts[0]!;
    if (parts.length === 1) return { line: first, parts };
    return { line: { ...first, units: parts.reduce((n, l) => n + l.units, 0), base_minor: parts.reduce((n, l) => n + l.base_minor, 0) }, parts };
  });
}

/** the split editor's groups: `part_of` → its parts' ids in line order, for groups of two or more one-unit parts */
export function partGroups(lines: readonly BillViewLine[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const l of lines) {
    if (l.part_of === undefined || l.part_of === null) continue;
    out.set(l.part_of, [...(out.get(l.part_of) ?? []), l.order_item_id]);
  }
  for (const [k, ids] of out) if (ids.length < 2) out.delete(k);
  return out;
}
