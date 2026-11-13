import { checkOptionChoices, type Violation } from '@pos/domain';
import type { BranchConfig, ConfigItem, ConfigModifierGroup } from '@pos/events';
import type { LineOption } from '../contracts';
import type { CartOption, UnitOf } from '../order-screen/cart';

// 02b §8 Ordering screen (options sheet: "defaults visible"), Q-7 ("Send it as a new item" opens the options sheet
// preselected by option **name** match; storing option_id is deferred unless name match fails, OPEN-QUESTIONS §9).
// A linked option gets its child line id here (newKey), as every device id is minted when the line is built.

/** The item's effective groups at this branch, in the item's order (a group id absent from the snapshot is not offered, F1). */
export function groupsOf(config: BranchConfig, item: ConfigItem): ConfigModifierGroup[] {
  return item.modifier_group_ids.flatMap((id) => config.modifier_groups.filter((g) => g.modifier_group_id === id));
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

/** 01c §3.4.6: the options marked default, quantity 1 each. `plainOnly` for a deal part's choice (child position). */
export function defaultOptions(config: BranchConfig, item: ConfigItem, newKey: () => string, plainOnly = false): CartOption[] {
  return groupsOf(config, item).flatMap((g) =>
    g.options
      .filter((o) => o.is_default && (!plainOnly || o.linked_item_id === null))
      .map((o) => (o.linked_item_id === null ? { option_id: o.option_id, quantity: 1 } : { option_id: o.option_id, quantity: 1, order_item_id: newKey() })),
  );
}

/**
 * Q-7: tick the item's options whose name matches a stored option's name (trimmed, case-insensitive), the first
 * match in group order, its quantity kept within the option's max_quantity. Names that match nothing stay unticked.
 * Without stored options (H2 not there yet) → null: the caller keeps the item's defaults.
 */
export function preselect(config: BranchConfig, item: ConfigItem, stored: readonly LineOption[] | undefined, newKey: () => string): CartOption[] | null {
  if (stored === undefined) return null;
  const options = groupsOf(config, item).flatMap((g) => g.options);
  const out: CartOption[] = [];
  for (const s of stored) {
    const match = options.find((o) => norm(o.name) === norm(s.name) && !out.some((x) => x.option_id === o.option_id));
    if (match === undefined) continue;
    const quantity = Math.max(1, Math.min(match.max_quantity, Math.floor(s.quantity)));
    out.push(match.linked_item_id === null ? { option_id: match.option_id, quantity } : { option_id: match.option_id, quantity, order_item_id: newKey() });
  }
  return out;
}

/**
 * 01c V9, owner Q-64 (a): a deal part offers its item's **plain** options; the hub checks them with
 * `checkOptionChoices(groups, choice.options, 'child', { quantity: part qty × deal qty, sale_unit })` (build-submit.ts
 * dealLines). The same check here; a linked option is never offered in a child position.
 */
export function partViolations(config: BranchConfig, unitOf: UnitOf, item_id: string, quantity: number, options: readonly CartOption[]): Violation[] {
  const item = config.items.find((i) => i.item_id === item_id);
  if (item === undefined) return [{ reason: 'not_effective', modifier_group_id: '', option_id: null }];
  const groups = groupsOf(config, item);
  const groupsById = Object.fromEntries(config.modifier_groups.map((g) => [g.modifier_group_id, g]));
  const itemsById = Object.fromEntries(config.items.map((i) => [i.item_id, i]));
  const chosen = options.map((o) => ({ modifier_group_id: groups.find((x) => x.options.some((y) => y.option_id === o.option_id))?.modifier_group_id ?? '', option_id: o.option_id, quantity: o.quantity }));
  const unit = unitOf(item_id) ?? item.sale_unit;
  // plain options only: the stock of a linked item is never read here (linked_in_child refuses one)
  return checkOptionChoices(groups, chosen, 'child', { quantity, sale_unit: unit }, groupsById, itemsById, () => true);
}

/** The part's item has plain options to offer (a group with plain options, V9). */
export function offersOptions(config: BranchConfig, item_id: string): boolean {
  const item = config.items.find((i) => i.item_id === item_id);
  return item !== undefined && groupsOf(config, item).some((g) => g.has_plain_options && g.options.some((o) => o.linked_item_id === null));
}
