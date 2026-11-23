import { groupByPartOf, sumOptionTexts, type LineDetail } from '@pos/domain';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { StationPlanBody } from '@pos/events';
import type { KdsRow, KdsView, RowPriority } from '../store';

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
    priority: largest(parts.map((p) => p.priority ?? null)),
    parts,
  };
}

/** ⚠️ 03b v1.0.13 §3.3 (STAB-7): a grouped row shows the chip when any part is priority, with the largest n */
export function largest(ps: ReadonlyArray<RowPriority | null>): RowPriority | null {
  let out: RowPriority | null = null;
  for (const p of ps) {
    if (p === null) continue;
    if (out === null || (p.minutes_late ?? -1) > (out.minutes_late ?? -1)) out = p;
  }
  return out;
}

/** ⚠️ 03b v1.0.14 §3.3 (m-7): "Priority · n min late", or "Priority" alone when n is 0 or not known yet (m-6) */
export const priorityText = (p: RowPriority): string =>
  p.minutes_late === null || p.minutes_late === 0 ? t('kds.priority_short') : fill(t('kds.priority'), { n: String(p.minutes_late) });

/**
 * ⚠️ 03b v1.0.13 §3.3 (STAB-6; post-review m-8): the round tag of each load = its place among ALL the station's
 * unfinished loads in fire order (the fired Now rows not done, in append order, then the plan's loads by fire_ms):
 * "this round", "next round", "round n". A row without load_id has none.
 */
export function roundsOf(view: Pick<KdsView, 'rows' | 'plan'>): Map<string, string> {
  const loads: string[] = [];
  const add = (id: string | null | undefined) => {
    if (id != null && !loads.includes(id)) loads.push(id);
  };
  for (const r of view.rows) if (r.stage !== 'done') add(r.load_id);
  for (const l of [...(view.plan?.lines ?? [])].sort((a, b) => a.fire_ms - b.fire_ms)) add(l.load_id);
  return new Map(loads.map((id, i) => [id, i === 0 ? t('kds.round.this') : i === 1 ? t('kds.round.next') : fill(t('kds.round.n'), { n: String(i + 1) })]));
}

const keyOf = (r: KdsRow): string | null => {
  const of = r.detail?.part_of ?? null;
  // ⚠️ 03b v1.0.13 §3.3 (STAB-6): + load_id at a batch station, so each round is its own row
  return of === null ? null : `${of} ${r.stage} ${r.mark ?? ''} ${r.done_undone ? 1 : 0} ${r.load_id ?? ''}`;
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
  /** ⚠️ 03b v1.0.14 §3.3 (STAB-7): the row's chip (any part, the largest n; a flagged part reads "Priority") */
  priority: RowPriority | null;
}

/** §3.3 Next: planned parts of one `part_of` with the same `fire_ms` and mark are one row (own fire times stay apart) */
export function groupNext(lines: StationPlanBody['lines'], details: ReadonlyMap<string, LineDetail>, flagged: ReadonlySet<string> = new Set()): NextRow[] {
  const groups = groupByPartOf(lines, (l) => {
    const of = details.get(l.order_item_id)?.part_of ?? null;
    return of === null ? null : `${of} ${l.fire_ms} ${l.mark ?? ''} ${l.load_id ?? ''}`;
  });
  return groups.map((g) => {
    const first = g[0]!;
    const d = details.get(first.order_item_id);
    const ds = g.flatMap((l) => {
      const x = details.get(l.order_item_id);
      return x === undefined ? [] : [x];
    });
    const priority = largest(g.map((l) => (l.priority !== undefined ? { minutes_late: l.priority.minutes_late } : flagged.has(l.order_item_id) ? { minutes_late: null } : null)));
    return { line: first, detail: d === undefined || g.length === 1 ? d : merged(d, ds), ids: g.map((l) => l.order_item_id), priority };
  });
}
