import { groupByPartOf, sumOptionTexts } from '@pos/domain';
import type { PointLine } from '../contracts';

// 03b v1.0.11 §3.4 (STAB-5 phase 3; proposal §3.5, owner Q1 = b): a Pass card shows the parts of one `part_of` (02b
// v1.0.20 §3.2 step 4a) with the same stage and hand-over state as one row at the first part's place: units summed,
// options summed by name (as the KDS, §3.3), the other details from the first part. Readiness and Hand over still work
// on the parts as lines (each part is an engine line); only what is shown and what a row's tap sends is grouped.

export interface PassRow {
  /** what the row shows: the first part with the summed units and options */
  line: PointLine;
  /** the lines it stands for, in line order (one for a line that was not split) */
  parts: readonly PointLine[];
}

export function groupLines(lines: readonly PointLine[]): PassRow[] {
  return groupByPartOf(lines, (l) => (l.part_of === undefined || l.part_of === null ? null : `${l.part_of} ${l.stage} ${l.handed_over ? 1 : 0}`)).map((parts) => {
    const first = parts[0]!;
    if (parts.length === 1) return { line: first, parts };
    return { line: { ...first, units: parts.reduce((n, p) => n + p.units, 0), options: sumOptionTexts(parts.map((p) => p.options)) }, parts };
  });
}
