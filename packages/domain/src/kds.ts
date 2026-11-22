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
