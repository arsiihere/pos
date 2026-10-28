// 01c §3.4, §4.2: order-line quantities, charges, deal allocation and line totals, called by 02, 04 and 05.
// Integer arithmetic only (BigInt inside); a non-safe input or result throws, like lineTotalMinor. Browser-safe.
import { lineTotalMinor } from './line-total.js';
import type { Unit } from './units.js';

export type LineKind = 'item' | 'option_child' | 'deal' | 'deal_part';

// §3.4.4. A deal's parts[].quantity is the part quantity per deal; part option charges come pre-computed (§3.4.3).
export type LineTotalInput =
  | { line_kind: 'item'; price_minor: number; quantity: number | null; sale_unit: Unit; option_charges_minor: number[] }
  | { line_kind: 'option_child'; price_minor: number; quantity: number; option_charges_minor: number[] }
  | {
      line_kind: 'deal';
      price_minor: number;
      quantity: number;
      parts: Array<{ sale_unit: Unit; quantity: number; extra_price_minor: number; option_charges_minor: number[] }>;
    }
  | { line_kind: 'deal_part' };

function nonNegative(fn: string, name: string, n: number): bigint {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${fn}: ${name} must be a non-negative integer`);
  return BigInt(n);
}

function safe(fn: string, name: string, n: bigint): number {
  const out = Number(n);
  if (!Number.isSafeInteger(out)) throw new Error(`${fn}: ${name} is not a safe integer`);
  return out;
}

// §3.4.2: piece parent → option qty × parent qty; g/ml parent → option qty (a 1.25 kg karahi with 3 naan → 3 naan).
export function childQuantity(optionQty: number, parentQty: number, parentSaleUnit: Unit): number {
  const opt = nonNegative('childQuantity', 'option quantity', optionQty);
  const parent = nonNegative('childQuantity', 'parent quantity', parentQty);
  return safe('childQuantity', 'quantity', parentSaleUnit === 'piece' ? opt * parent : opt);
}

// §3.4.3: piece parent → price × option qty × parent qty; g/ml parent → price × option qty, once per line, never per gram.
// A deal part passes part qty × deal qty (piece part) or the deal qty with 'piece' (g/ml part, B2).
export function optionChargeMinor(priceMinor: number, optionQty: number, parentQty: number, parentSaleUnit: Unit): number {
  const price = nonNegative('optionChargeMinor', 'price_minor', priceMinor);
  const opt = nonNegative('optionChargeMinor', 'option quantity', optionQty);
  const parent = nonNegative('optionChargeMinor', 'parent quantity', parentQty);
  return safe('optionChargeMinor', 'charge', price * opt * (parentSaleUnit === 'piece' ? parent : 1n));
}

// V11 c (m1, M8): pro rata by weight, floor for every share but the last, the remainder to the last, so the shares sum to the total.
// A zero weight gets 0; the split is equal only when every weight is 0. Also the per-unit void split (weights all 1, §3.4.8).
export function allocateDealMinor(totalMinor: number, weightsMinor: readonly number[]): number[] {
  const total = nonNegative('allocateDealMinor', 'total', totalMinor);
  if (weightsMinor.length === 0) throw new Error('allocateDealMinor: weights must not be empty');
  const weights = weightsMinor.map((w) => nonNegative('allocateDealMinor', 'weight', w));
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  const shares =
    weightSum === 0n ? weights.map(() => total / BigInt(weights.length)) : weights.map((w) => (total * w) / weightSum);
  const head = shares.slice(0, -1);
  const last = total - head.reduce((a, b) => a + b, 0n);
  return [...head, last].map((s) => safe('allocateDealMinor', 'share', s));
}

// §3.4.4, V11 a, V18: the billed total of one order line; null while a weighed line's weight is pending.
export function orderLineTotalMinor(line: LineTotalInput): number | null {
  const fn = 'orderLineTotalMinor';
  const charges = (xs: readonly number[]): bigint => xs.reduce((a, x) => a + nonNegative(fn, 'option charge', x), 0n);
  switch (line.line_kind) {
    case 'item':
      if (line.quantity === null) return null;
      return safe(fn, 'total', BigInt(lineTotalMinor(line.price_minor, line.quantity, line.sale_unit)) + charges(line.option_charges_minor));
    case 'option_child':
      return safe(fn, 'total', BigInt(lineTotalMinor(line.price_minor, line.quantity, 'piece')) + charges(line.option_charges_minor));
    case 'deal': {
      const dealQty = nonNegative(fn, 'quantity', line.quantity);
      let total = nonNegative(fn, 'price_minor', line.price_minor) * dealQty;
      for (const part of line.parts) {
        // B2: piece part extra × part qty × deal qty; g/ml part extra × deal qty.
        const extra = nonNegative(fn, 'extra_price_minor', part.extra_price_minor);
        const partQty = nonNegative(fn, 'part quantity', part.quantity);
        total += extra * (part.sale_unit === 'piece' ? partQty : 1n) * dealQty + charges(part.option_charges_minor);
      }
      return safe(fn, 'total', total);
    }
    case 'deal_part':
      return 0;
  }
}

// ---- §3.4.6, V9, V11 d, §4.2: option checks and orderability (structural types; no @pos/events import) ----

export type Position = 'line' | 'child';
// Supplied by 02 (v0.6 Q3): item On, inside its and its category's windows, not sold out for that quantity.
export type IsAvailable = (itemId: string, quantity: number) => boolean;

// A snapshot group's `options` holds only the options offered at this branch (the builder filters them).
export interface MenuLineOption {
  option_id: string;
  price_minor: number;
  max_quantity: number;
  is_default: boolean;
  linked_item_id: string | null;
}
export interface MenuLineGroup {
  modifier_group_id: string;
  min_choices: number;
  max_choices: number;
  has_plain_options: boolean;
  options: MenuLineOption[];
}
export interface MenuLineItem {
  item_id: string;
  sale_unit: Unit;
  modifier_group_ids: string[];
}
export interface MenuLineDeal {
  deal_id: string;
  parts: Array<{ deal_part_id: string; quantity: number; choices: Array<{ item_id: string; extra_price_minor: number }> }>;
}
export interface ChosenOption {
  modifier_group_id: string;
  option_id: string;
  quantity: number;
}
export interface Violation {
  reason: 'not_effective' | 'quantity_out_of_range' | 'below_min' | 'above_max' | 'linked_in_child' | 'linked_not_orderable';
  modifier_group_id: string;
  option_id: string | null;
}

type GroupsById = Readonly<Record<string, MenuLineGroup>>;
type ItemsById = Readonly<Record<string, MenuLineItem>>;

// §3.4.6 N5, Q3: a linked option's item is orderable as a child for the child quantity; an item absent from itemsById is not.
function linkedOrderable(itemId: string, quantity: number, groupsById: GroupsById, itemsById: ItemsById, isAvailable: IsAvailable): boolean {
  const item = itemsById[itemId];
  return item !== undefined && isItemOrderable(item, groupsById, itemsById, 'child', quantity, isAvailable);
}

// §3.4.6, M1, N6, P2. 'child': a group without plain options is not offered and is satisfiable; otherwise only its plain
// options count. 'line': plain options always count; a linked option counts only when its item is orderable as a child
// for 1. The child-position check never reads linked options, so the recursion stops at depth 1 (V9).
export function isGroupSatisfiable(
  group: MenuLineGroup,
  position: Position,
  groupsById: GroupsById,
  itemsById: ItemsById,
  isAvailable: IsAvailable,
): boolean {
  if (position === 'child' && !group.has_plain_options) return true;
  let capacity = 0;
  for (const o of group.options) {
    if (capacity >= group.min_choices) break;
    if (o.linked_item_id === null) capacity += o.max_quantity;
    else if (position === 'line' && linkedOrderable(o.linked_item_id, 1, groupsById, itemsById, isAvailable)) capacity += o.max_quantity;
  }
  return capacity >= group.min_choices;
}

// M1: available for the quantity and every effective group satisfiable in the position. A group id absent from groupsById
// is an optional group with no option at this branch, left out of the snapshot (F1), so it is not offered.
export function isItemOrderable(
  item: MenuLineItem,
  groupsById: GroupsById,
  itemsById: ItemsById,
  position: Position,
  quantity: number,
  isAvailable: IsAvailable,
): boolean {
  if (!isAvailable(item.item_id, quantity)) return false;
  return item.modifier_group_ids.every((id) => {
    const group = groupsById[id];
    return group === undefined || isGroupSatisfiable(group, position, groupsById, itemsById, isAvailable);
  });
}

// V11 d, m16: inside the deal's (and its category's) windows, supplied as inWindows, and every part has a choice orderable
// in the child position for part qty × deal qty.
export function isDealOrderable(
  deal: MenuLineDeal,
  dealQuantity: number,
  groupsById: GroupsById,
  itemsById: ItemsById,
  isAvailable: IsAvailable,
  inWindows: boolean,
): boolean {
  if (!inWindows) return false;
  const dealQty = nonNegative('isDealOrderable', 'deal quantity', dealQuantity);
  return deal.parts.every((part) => {
    const qty = safe('isDealOrderable', 'part quantity', nonNegative('isDealOrderable', 'part quantity', part.quantity) * dealQty);
    return part.choices.some((c) => linkedOrderable(c.item_id, qty, groupsById, itemsById, isAvailable));
  });
}

// §3.4.6 (T3): `groups` are the line item's effective groups; `parent` gives the child quantity of a linked option
// (childQuantity; a g/ml parent does not need its quantity, which may be null while the weight is pending).
export function checkOptionChoices(
  groups: readonly MenuLineGroup[],
  chosen: readonly ChosenOption[],
  position: Position,
  parent: { quantity: number | null; sale_unit: Unit },
  groupsById: GroupsById,
  itemsById: ItemsById,
  isAvailable: IsAvailable,
): Violation[] {
  const violations: Violation[] = [];
  const effective = new Map(groups.map((g) => [g.modifier_group_id, g]));
  // Sum the quantities per (group, option) first, so an option entered twice is range- and stock-checked on its total (M2).
  const perOption = new Map<string, { modifier_group_id: string; option_id: string; quantity: number; valid: boolean }>();
  for (const c of chosen) {
    const key = JSON.stringify([c.modifier_group_id, c.option_id]);
    const entry = perOption.get(key) ?? { modifier_group_id: c.modifier_group_id, option_id: c.option_id, quantity: 0, valid: true };
    entry.valid &&= Number.isSafeInteger(c.quantity) && c.quantity >= 1;
    entry.quantity += c.quantity;
    perOption.set(key, entry);
  }
  const selections = new Map<string, number>();
  for (const c of perOption.values()) {
    const group = effective.get(c.modifier_group_id);
    const option = group?.options.find((o) => o.option_id === c.option_id);
    const at = { modifier_group_id: c.modifier_group_id, option_id: c.option_id };
    if (group === undefined || option === undefined) {
      violations.push({ reason: 'not_effective', ...at });
      continue;
    }
    if (!c.valid || !Number.isSafeInteger(c.quantity) || c.quantity > option.max_quantity) {
      violations.push({ reason: 'quantity_out_of_range', ...at });
      continue;
    }
    // §3.4.6: in a child position linked options never count (linked_in_child refuses them below).
    if (position === 'line' || option.linked_item_id === null) {
      selections.set(group.modifier_group_id, (selections.get(group.modifier_group_id) ?? 0) + c.quantity);
    }
    if (option.linked_item_id === null) continue;
    if (position === 'child') {
      violations.push({ reason: 'linked_in_child', ...at });
    } else {
      const qty = childQuantity(c.quantity, parent.quantity ?? 1, parent.sale_unit);
      if (!linkedOrderable(option.linked_item_id, qty, groupsById, itemsById, isAvailable)) {
        violations.push({ reason: 'linked_not_orderable', ...at });
      }
    }
  }
  for (const group of groups) {
    if (position === 'child' && !group.has_plain_options) continue;
    const n = selections.get(group.modifier_group_id) ?? 0;
    const at = { modifier_group_id: group.modifier_group_id, option_id: null };
    if (n < group.min_choices) violations.push({ reason: 'below_min', ...at });
    else if (n > group.max_choices) violations.push({ reason: 'above_max', ...at });
  }
  return violations;
}
