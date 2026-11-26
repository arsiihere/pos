// 03b §4.4: shared KDS / Pass types (browser-safe; no node imports).

export const UNDO_DONE_MS = 30_000; // D16; Undo Done and Undo ready

export type Identifier =
  | { kind: 'table'; label: string } // "T4 + T5", "Family 2"
  | { kind: 'token'; token: number; date: string | null }
  | { kind: 'parking'; car_number: string; car_type: 'sedan' | 'mini' | 'large' };

export interface LineDetail {
  order_item_id: string;
  order_id: string;
  station_id: string;
  point_id: string;
  identifier: Identifier;
  order_type: 'dine_in' | 'takeaway' | 'parking';
  item_name: string;
  units: number; // live units
  line_kind: 'item' | 'option_child' | 'deal_part';
  for_parent: string | null;
  deal_name: string | null;
  options: string[]; // option children with no station
  kitchen_note: string | null;
  order_note: string | null;
  return_of: { order_item_id: string; mode: 'fix' | 'remake'; item_name: string; identifier: Identifier } | null;
  cook_ms: number;
  prep_ms: number;
  from_stock: boolean;
  placed_by_name: string | null; // order taker (03c ticket toggle)
  /** 03b v1.0.11 §4.4 (STAB-5): order_lines.part_of, the first part of a split line (02b v1.0.20 §3.2 step 4a); null = not split; absent from an older hub */
  part_of?: string | null;
}

// 03b v1.0.11 §3.3, §3.4, 03c v1.0.15 §3.3 (STAB-5): a slot-station line of quantity n is sent as n one-unit parts
// sharing `part_of` (02b v1.0.20 §3.2 step 4a); the KDS, the Pass and the kitchen ticket show them as one row.

/** Items with the same non-null key form one group, at the place of the first one; a null key is a group alone. */
export function groupByPartOf<T>(items: readonly T[], keyOf: (item: T) => string | null): T[][] {
  const groups: T[][] = [];
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const had = key === null ? undefined : byKey.get(key);
    if (had !== undefined) {
      had.push(item);
      continue;
    }
    const group = [item];
    groups.push(group);
    if (key !== null) byKey.set(key, group);
  }
  return groups;
}

/**
 * The option entries (§4.4: "name" or "<q> x name") of several parts as one row's: quantities summed by name in
 * first-seen order, so three parts with "Raita" read "3 x Raita", the text of the unsplit line.
 */
export function sumOptionTexts(lists: ReadonlyArray<readonly string[]>): string[] {
  const sums = new Map<string, number>();
  for (const list of lists)
    for (const text of list) {
      const m = /^(\d+) x (.+)$/.exec(text);
      const name = m === null ? text : m[2]!;
      sums.set(name, (sums.get(name) ?? 0) + (m === null ? 1 : Number(m[1])));
    }
  return [...sums].map(([name, q]) => (q > 1 ? `${q} x ${name}` : name));
}

// ⚠️ 03b v1.0.16 owner clarification (PT-1, PT-2, PT-6), run 3 (R3-M-1, R3-M-2), §4.4: Pass points by order type.
// Pure, no I/O, browser-safe. A line goes to the active point that accepts the order's type; of several, the most
// specific (fewest accepted types; absent or 'all' = every type) wins; a tie or no match goes to the station's
// effective default (D7). Every active point covers every station (PT-2). The result does not depend on input order.
export const POINT_ORDER_TYPES = ['dine_in', 'takeaway', 'delivery', 'parking'] as const; // the 01a A-9 / PT-2 enum
export type PointOrderType = (typeof POINT_ORDER_TYPES)[number];
// kds-config routing_gaps (PT-6); 'delivery' joins when delivery orders ship.
export const ROUTING_WARN_ORDER_TYPES = ['dine_in', 'takeaway', 'parking'] as const;

export interface RoutablePoint {
  point_id: string;
  name: string;
  sort_order: number;
  is_archived: boolean;
  order_types?: 'all' | readonly PointOrderType[];
}
export interface RoutedPoint {
  point_id: string;
  reason: 'match' | 'tie' | 'fallback';
  tied_point_ids: string[];
}

const lexical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function acceptedCount(p: RoutablePoint): number {
  return p.order_types === undefined || p.order_types === 'all' ? POINT_ORDER_TYPES.length : new Set(p.order_types).size;
}

function accepts(p: RoutablePoint, order_type: PointOrderType): boolean {
  return p.order_types === undefined || p.order_types === 'all' || p.order_types.includes(order_type);
}

// R3-M-1 (01a §6.9): the station's configured point while it is active; else the first active point named `Pass`,
// then by sort_order, then lexically by point_id. `active` is non-empty.
function effectiveDefault(active: readonly RoutablePoint[], station: { point_id: string }): string {
  if (active.some((p) => p.point_id === station.point_id)) return station.point_id;
  const pass = (p: RoutablePoint): number => (p.name === 'Pass' ? 0 : 1);
  return [...active].sort((a, b) => pass(a) - pass(b) || a.sort_order - b.sort_order || lexical(a.point_id, b.point_id))[0]!.point_id;
}

// null when the branch has no active point (D7 refuses the archive that would make it so).
export function routePoint(points: readonly RoutablePoint[], station: { point_id: string }, order_type: PointOrderType): RoutedPoint | null {
  const active = points.filter((p) => !p.is_archived);
  if (active.length === 0) return null;
  const matches = active.filter((p) => accepts(p, order_type));
  if (matches.length === 0) return { point_id: effectiveDefault(active, station), reason: 'fallback', tied_point_ids: [] };
  const fewest = Math.min(...matches.map(acceptedCount));
  const best = matches
    .filter((p) => acceptedCount(p) === fewest)
    .map((p) => p.point_id)
    .sort(lexical);
  if (best.length === 1) return { point_id: best[0]!, reason: 'match', tied_point_ids: [] };
  return { point_id: effectiveDefault(active, station), reason: 'tie', tied_point_ids: best };
}
