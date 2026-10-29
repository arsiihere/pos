import { canonicalJson, sha256hex } from '@pos/domain/hash';
import type {
  DealBranchWire,
  DealWire,
  ModifierGroupBranchWire,
  ModifierGroupWire,
  StockItemBranchWire,
  StockItemWire,
  VariantGroupWire,
} from '@pos/events';

// 01c V13, §5.4 (01b §5.3 rules 1–6): the only place that builds a variant group, stock item, modifier group
// or deal wire and its version. Each version input has exactly the §5.4 keys; arrays are sorted here by
// JavaScript string order (never database order); nullable values are null; every BIGINT goes through
// Number() so a pg string hashes like the number. archived = archived_at IS NOT NULL.

// A pg BIGINT column may arrive as a string.
type Bigint = number | string;

export interface VariantGroupRow {
  variant_group_id: string;
  name: string;
  category_id: string;
  description: string | null;
  sort_order: number;
  archived_at: Bigint | null;
  member_ids: string[];
}

export interface StockItemRow {
  stock_item_id: string;
  name: string;
  stock_unit: StockItemWire['stock_unit'];
  carries_over: boolean;
  archived_at: Bigint | null;
}

export interface StockItemBranchRow {
  station_id: string;
  low_stock_threshold: Bigint | null;
}

export interface ModifierOptionRow {
  option_id: string;
  name: string;
  price_minor: Bigint | null;
  max_quantity: number;
  is_default: boolean;
  linked_item_id: string | null;
  sort_order: number;
  archived_at: Bigint | null;
}

export interface ModifierLinkRow {
  target_kind: ModifierGroupWire['links'][number]['target_kind'];
  target_id: string;
  mode: ModifierGroupWire['links'][number]['mode'];
}

export interface ModifierOptionBranchRow {
  option_id: string;
  is_offered: boolean;
  price_minor_override: Bigint | null;
}

export interface ModifierGroupRow {
  modifier_group_id: string;
  name: string;
  min_choices: number;
  max_choices: number;
  sort_order: number;
  archived_at: Bigint | null;
  /** Every option of the group, active and archived. */
  options: ModifierOptionRow[];
  links: ModifierLinkRow[];
}

export interface DealChoiceRow {
  item_id: string;
  extra_price_minor: Bigint;
  sort_order: number;
}

export interface DealPartRow {
  deal_part_id: string;
  quantity: number;
  sort_order: number;
  archived_at: Bigint | null;
  choices: DealChoiceRow[];
}

export interface DealRow {
  deal_id: string;
  name: string;
  category_id: string;
  tax_class_id: string | null;
  description: string | null;
  sort_order: number;
  price_minor: Bigint;
  archived_at: Bigint | null;
  availability_windows: { start_ms: number; end_ms: number }[];
  /** Every part of the deal, active and archived. */
  parts: DealPartRow[];
}

export interface DealBranchRow {
  price_minor_override: Bigint | null;
}

export function toVariantGroupWire(row: VariantGroupRow): VariantGroupWire {
  const input = {
    variant_group_id: row.variant_group_id,
    name: row.name,
    category_id: row.category_id,
    description: row.description,
    sort_order: Number(row.sort_order),
    archived: row.archived_at !== null,
  };
  return {
    variant_group_id: input.variant_group_id,
    name: input.name,
    category_id: input.category_id,
    description: input.description,
    sort_order: input.sort_order,
    archived_at: numberOrNull(row.archived_at),
    member_ids: sorted(row.member_ids),
    version: hash(input),
  };
}

export function toStockItemWire(row: StockItemRow): StockItemWire {
  const input = {
    stock_item_id: row.stock_item_id,
    name: row.name,
    stock_unit: row.stock_unit,
    carries_over: row.carries_over,
    archived: row.archived_at !== null,
  };
  return {
    stock_item_id: input.stock_item_id,
    name: input.name,
    stock_unit: input.stock_unit,
    carries_over: input.carries_over,
    archived_at: numberOrNull(row.archived_at),
    version: hash(input),
  };
}

// §5.4: no row → is_counted false, station and threshold null (station_id null on the wire).
export function stockItemBranchVersion(stockItemId: string, branchId: string, row: StockItemBranchRow | null): StockItemBranchWire {
  const input = {
    stock_item_id: stockItemId,
    branch_id: branchId,
    is_counted: row !== null,
    station_id: row === null ? null : row.station_id,
    low_stock_threshold: row === null ? null : numberOrNull(row.low_stock_threshold),
  };
  return {
    branch_id: branchId,
    station_id: input.station_id,
    low_stock_threshold: input.low_stock_threshold,
    version: hash(input),
  };
}

// §5.4, V19: branches lists every id in branchIds (the owner's allowed branches), by branch_id; branchRows are
// the group's stored difference rows at those branches. Neither branches nor archived_options is hashed.
export function toModifierGroupWire(
  row: ModifierGroupRow,
  branchIds: readonly string[],
  branchRows: ReadonlyArray<ModifierOptionBranchRow & { branch_id: string }>,
): ModifierGroupWire {
  const active = row.options.filter((option) => option.archived_at === null);
  const archived = row.options.filter((option) => option.archived_at !== null);
  const input = {
    modifier_group_id: row.modifier_group_id,
    name: row.name,
    min_choices: Number(row.min_choices),
    max_choices: Number(row.max_choices),
    sort_order: Number(row.sort_order),
    archived: row.archived_at !== null,
    options: sortedOptions(active).map((option) => ({
      option_id: option.option_id,
      name: option.name,
      price_minor: numberOrNull(option.price_minor),
      max_quantity: Number(option.max_quantity),
      is_default: option.is_default,
      linked_item_id: option.linked_item_id,
      sort_order: Number(option.sort_order),
    })),
    links: row.links
      .map((link) => ({ target_kind: link.target_kind, target_id: link.target_id, mode: link.mode }))
      .sort((a, b) => compare(a.target_kind, b.target_kind) || compare(a.target_id, b.target_id)),
  };
  const activeIds = new Set(active.map((option) => option.option_id));
  return {
    modifier_group_id: input.modifier_group_id,
    name: input.name,
    min_choices: input.min_choices,
    max_choices: input.max_choices,
    sort_order: input.sort_order,
    archived_at: numberOrNull(row.archived_at),
    options: input.options,
    archived_options: sortedOptions(archived).map((option) => ({ option_id: option.option_id, name: option.name })),
    links: input.links,
    branches: sorted(branchIds).map((branchId) =>
      modifierGroupBranchVersion(
        row.modifier_group_id,
        branchId,
        branchRows.filter((branchRow) => branchRow.branch_id === branchId),
        activeIds,
      ),
    ),
    version: hash(input),
  };
}

// §5.4, V19: the stored difference rows of the group's active options at one branch, by option_id (no rows → []).
export function modifierGroupBranchVersion(
  modifierGroupId: string,
  branchId: string,
  rows: readonly ModifierOptionBranchRow[],
  activeOptionIds: ReadonlySet<string>,
): ModifierGroupBranchWire {
  const options = rows
    .filter((r) => activeOptionIds.has(r.option_id))
    .map((r) => ({ option_id: r.option_id, is_offered: r.is_offered, price_minor_override: numberOrNull(r.price_minor_override) }))
    .sort((a, b) => compare(a.option_id, b.option_id));
  return { branch_id: branchId, options, version: hash({ modifier_group_id: modifierGroupId, branch_id: branchId, options }) };
}

export function toDealWire(row: DealRow): DealWire {
  const active = row.parts.filter((part) => part.archived_at === null);
  const archived = row.parts.filter((part) => part.archived_at !== null);
  const input = {
    deal_id: row.deal_id,
    name: row.name,
    category_id: row.category_id,
    tax_class_id: row.tax_class_id,
    description: row.description,
    sort_order: Number(row.sort_order),
    price_minor: Number(row.price_minor),
    archived: row.archived_at !== null,
    availability_windows: row.availability_windows
      .map((w) => ({ start_ms: Number(w.start_ms), end_ms: Number(w.end_ms) }))
      .sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms),
    parts: sortedParts(active).map((part) => ({
      deal_part_id: part.deal_part_id,
      quantity: Number(part.quantity),
      sort_order: Number(part.sort_order),
      choices: part.choices
        .map((c) => ({ item_id: c.item_id, extra_price_minor: Number(c.extra_price_minor), sort_order: Number(c.sort_order) }))
        .sort((a, b) => a.sort_order - b.sort_order || compare(a.item_id, b.item_id)),
    })),
  };
  return {
    deal_id: input.deal_id,
    name: input.name,
    category_id: input.category_id,
    tax_class_id: input.tax_class_id,
    description: input.description,
    sort_order: input.sort_order,
    price_minor: input.price_minor,
    archived_at: numberOrNull(row.archived_at),
    availability_windows: input.availability_windows,
    parts: input.parts,
    archived_parts: sortedParts(archived).map((part) => ({ deal_part_id: part.deal_part_id })),
    version: hash(input),
  };
}

// §5.4: no row → is_sold false, override null.
export function dealBranchVersion(dealId: string, branchId: string, row: DealBranchRow | null): DealBranchWire {
  const input = {
    deal_id: dealId,
    branch_id: branchId,
    is_sold: row !== null,
    price_minor_override: row === null ? null : numberOrNull(row.price_minor_override),
  };
  return { branch_id: branchId, is_sold: input.is_sold, price_minor_override: input.price_minor_override, version: hash(input) };
}

function hash(input: unknown): string {
  return sha256hex(canonicalJson(input));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sorted(values: readonly string[]): string[] {
  return values.slice().sort(compare);
}

function numberOrNull(value: Bigint | null): number | null {
  return value === null ? null : Number(value);
}

function sortedOptions(options: readonly ModifierOptionRow[]): ModifierOptionRow[] {
  return options.slice().sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || compare(a.option_id, b.option_id));
}

function sortedParts(parts: readonly DealPartRow[]): DealPartRow[] {
  return parts.slice().sort((a, b) => Number(a.sort_order) - Number(b.sort_order) || compare(a.deal_part_id, b.deal_part_id));
}
