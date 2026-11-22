import { groupByPartOf, sumOptionTexts, type LineDetail } from '@pos/domain';
import type { StationPlanBody } from '@pos/events';
import type { KdsRow } from '../store';

// 03b v1.0.11 §3.3 (STAB-5 phase 3; proposal §3.5, owner Q1 = b): a slot-station line of quantity n is sent as n
// one-unit parts sharing `part_of` (02b v1.0.20 §3.2 step 4a). Now rows of one `part_of` with the same stage, mark and
// `done_undone` are one row at the first part's place (nothing reorders): units summed, options summed by name, the
// other details from the first part; its timer reads the part that started first (else fired first); a done row's
// Undo window is its first-done part's. A row without `part_of` stays one line.

const minOf = (xs: ReadonlyArray<number | null>): number | null => xs.reduce<number | null>((m, x) => (x === null ? m : m === null ? x : Math.min(m, x)), null);

function merged(detail: LineDetail, parts: ReadonlyArray<LineDetail>): LineDetail {
  return { ...detail, units: parts.reduce((n, d) => n + d.units, 0), options: sumOptionTexts(parts.map((d) => d.options)) };
}

/** one row for a group of store rows (a group of one is the row itself) */
export function mergeParts(parts: readonly KdsRow[]): KdsRow {
  const first = parts[0]!;
  if (parts.length === 1) return first;
  return {
    ...first,
    fired_at: minOf(parts.map((p) => p.fired_at)),
    started_at: minOf(parts.map((p) => p.started_at)),
    done_at: minOf(parts.map((p) => p.done_at)),
    detail: first.detail === null ? null : merged(first.detail, parts.flatMap((p) => (p.detail === null ? [] : [p.detail]))),
    parts,
  };
}

const keyOf = (r: KdsRow): string | null => {
  const of = r.detail?.part_of ?? null;
  return of === null ? null : `${of} ${r.stage} ${r.mark ?? ''} ${r.done_undone ? 1 : 0}`;
};

/** §3.3: the Now rows with a split line's parts in one stage grouped */
export function groupNow(rows: readonly KdsRow[]): KdsRow[] {
  return groupByPartOf(rows, keyOf).map(mergeParts);
}

/** the store rows a view row stands for */
export const partsOf = (row: KdsRow): readonly KdsRow[] => row.parts ?? [row];

/**
 * The order a grouped tap sends its parts in: Done sends the part that started **last** first (the one §3.2's 50 %
 * check refuses first, so `422 ITEM_DONE_CONFIRM_REQUIRED` stops the row before any other part is done); Start and
 * Undo go in append order.
 */
export function sendOrder(row: KdsRow, action: 'start' | 'done' | 'undo'): string[] {
  const parts = partsOf(row);
  if (action !== 'done' || parts.length === 1) return parts.map((p) => p.order_item_id);
  return parts
    .map((p, i) => ({ id: p.order_item_id, at: p.started_at ?? Number.NEGATIVE_INFINITY, i }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .map((p) => p.id);
}

/** a Next row: the planned line, its detail with summed units, and the parts' ids */
export interface NextRow {
  line: StationPlanBody['lines'][number];
  detail: LineDetail | undefined;
  ids: string[];
}

/** §3.3 Next: planned parts of one `part_of` with the same `fire_ms` and mark are one row (own fire times stay apart) */
export function groupNext(lines: StationPlanBody['lines'], details: ReadonlyMap<string, LineDetail>): NextRow[] {
  const groups = groupByPartOf(lines, (l) => {
    const of = details.get(l.order_item_id)?.part_of ?? null;
    return of === null ? null : `${of} ${l.fire_ms} ${l.mark ?? ''}`;
  });
  return groups.map((g) => {
    const first = g[0]!;
    const d = details.get(first.order_item_id);
    const ds = g.flatMap((l) => {
      const x = details.get(l.order_item_id);
      return x === undefined ? [] : [x];
    });
    return { line: first, detail: d === undefined || g.length === 1 ? d : merged(d, ds), ids: g.map((l) => l.order_item_id) };
  });
}
