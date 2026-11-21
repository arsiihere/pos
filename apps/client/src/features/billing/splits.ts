import type { BillView } from './contracts';

// 05 §3.8, §6.5 (task 36): the split editor's unit arithmetic over the bill view. Units only — every amount shown is
// the hub's (§6.1 totals); the hub validates the plan (BILL_SPLIT_INVALID) and is the authority.

/** One editable split column: units per order_item_id. */
export interface Column {
  split_no: number;
  lines: ReadonlyMap<string, number>;
}

const MAX_SPLITS = 20;

/** Units a closed split's item plan invoiced, per line (§3.8: never touched by a re-plan). */
export function closedUnits(bill: BillView): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of bill.splits)
    if (s.state === 'closed' && s.plan !== null && 'lines' in s.plan) for (const l of s.plan.lines) out.set(l.order_item_id, (out.get(l.order_item_id) ?? 0) + l.units);
  return out;
}

/** §3.8 the open remainder: each line's live units not in a closed split (lines with none left drop out). */
export function openUnits(bill: BillView): Map<string, number> {
  const closed = closedUnits(bill);
  const out = new Map<string, number>();
  for (const l of bill.lines) {
    const n = l.units - (closed.get(l.order_item_id) ?? 0);
    if (n > 0) out.set(l.order_item_id, n);
  }
  return out;
}

/** The lowest split number 1–20 not in `used`, or null when all 20 are taken. */
export function nextSplitNo(used: Iterable<number>): number | null {
  const taken = new Set(used);
  for (let n = 1; n <= MAX_SPLITS; n += 1) if (!taken.has(n)) return n;
  return null;
}

/**
 * The starting columns: the open splits' item plans when the bill is split by items; otherwise every open unit in
 * the lowest open split. Always at least two columns (a split needs 2–20, §6.5): an empty next split is added.
 */
export function initialColumns(bill: BillView): Column[] {
  const open = bill.splits.filter((s) => s.state === 'open');
  const byItems = open.length > 0 && open.every((s) => s.plan !== null && 'lines' in s.plan);
  const remainder = openUnits(bill);
  let cols: Column[];
  if (byItems) {
    // a plan row never holds more than the remainder has left (a unit voided since); units no plan row holds — a
    // line added after the plan, G-29 — sit on the highest open split, where the hub's compute puts them (§3.8)
    const left = new Map(remainder);
    const placed = open.map((s) => {
      const lines = new Map<string, number>();
      for (const l of (s.plan as { lines: Array<{ order_item_id: string; units: number }> }).lines) {
        const n = Math.min(l.units, left.get(l.order_item_id) ?? 0);
        if (n > 0) {
          lines.set(l.order_item_id, (lines.get(l.order_item_id) ?? 0) + n);
          left.set(l.order_item_id, (left.get(l.order_item_id) ?? 0) - n);
        }
      }
      return { split_no: s.split_no, lines };
    });
    const last = placed.reduce((a, b) => (b.split_no > a.split_no ? b : a));
    for (const [id, n] of left) if (n > 0) last.lines.set(id, (last.lines.get(id) ?? 0) + n);
    cols = placed;
  } else {
    const first = open[0]?.split_no ?? nextSplitNo(bill.splits.map((s) => s.split_no)) ?? 1;
    cols = [{ split_no: first, lines: remainder }, ...open.slice(1).map((s) => ({ split_no: s.split_no, lines: new Map<string, number>() }))];
  }
  if (cols.length < 2) {
    const n = nextSplitNo([...bill.splits.map((s) => s.split_no), ...cols.map((c) => c.split_no)]);
    if (n !== null) cols = [...cols, { split_no: n, lines: new Map() }];
  }
  return cols;
}

/** Open units no column holds, per line, in the bill's line order. */
export function unplacedOf(remainder: ReadonlyMap<string, number>, cols: readonly Column[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, units] of remainder) {
    const placed = cols.reduce((n, c) => n + (c.lines.get(id) ?? 0), 0);
    if (units - placed > 0) out.set(id, units - placed);
  }
  return out;
}

/**
 * Moves one unit of `id` from column `from` (null = the unplaced pool) to column `to`. Unchanged (the same array)
 * when the source holds no unit of the line, or source and target are the same column.
 */
export function moveUnit(cols: readonly Column[], id: string, from: number | null, to: number): Column[] {
  if (from === to) return cols as Column[];
  if (from !== null && (cols.find((c) => c.split_no === from)?.lines.get(id) ?? 0) < 1) return cols as Column[];
  return cols.map((c) => {
    if (c.split_no !== from && c.split_no !== to) return c;
    const lines = new Map(c.lines);
    const n = (lines.get(id) ?? 0) + (c.split_no === to ? 1 : -1);
    if (n > 0) lines.set(id, n);
    else lines.delete(id);
    return { split_no: c.split_no, lines };
  });
}

/** Typed major units → minor units at `exponent` (row F-6); commas ignored. Null for anything else or ≤ 0. */
export function parseMinor(text: string, exponent: number): number | null {
  const m = /^([0-9]+)(?:\.([0-9]+))?$/.exec(text.trim().replaceAll(',', ''));
  if (m === null) return null;
  const frac = m[2] ?? '';
  if (frac.length > exponent) return null;
  const value = Number((m[1] as string) + frac.padEnd(exponent, '0'));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
