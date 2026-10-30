import type { CloudAdmin, MenuItem, ModifierGroup, ModifierGroupBranch, ModifierLink } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import type { WholeMenu } from '../menu-pages';
import { shownRupees } from '../money';

// Pure helpers of the 01c choice group views (01c-S02, S03, S10, B04, B05).

// S02 "Customers pick": "Pick 1" (min = max), "Up to 6" (min 0), else "Pick 1–2".
export function pickText(group: Pick<ModifierGroup, 'min_choices' | 'max_choices'>): string {
  const { min_choices: min, max_choices: max } = group;
  if (min === max) return fill(t('choice_groups.pick_n'), { n: String(max) });
  if (min === 0) return fill(t('choice_groups.up_to'), { n: String(max) });
  return fill(t('choice_groups.pick_range'), { min: String(min), max: String(max) });
}

// S02 "Options": the first 3 names, then "+N".
export function optionsText(group: Pick<ModifierGroup, 'options'>): string {
  const names = [...group.options].sort((a, b) => a.sort_order - b.sort_order).map((o) => o.name);
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} +${names.length - 3}` : shown;
}

export function targetName(menu: Pick<WholeMenu, 'categories' | 'variant_groups' | 'items'> | null, link: Pick<ModifierLink, 'target_kind' | 'target_id'>): string {
  if (menu === null) return '';
  if (link.target_kind === 'category') return menu.categories.find((c) => c.category_id === link.target_id)?.name ?? '';
  if (link.target_kind === 'variant_group') return menu.variant_groups.find((g) => g.variant_group_id === link.target_id)?.name ?? '';
  return menu.items.find((i) => i.item_id === link.target_id)?.name ?? '';
}

// S02 "Applies to": "Category Karahi · not on Lassi", "Size group Chicken Karahi", "Categories Karahi, Rice".
export function appliesText(menu: WholeMenu | null, links: readonly ModifierLink[]): string {
  const named = (kind: ModifierLink['target_kind'], mode: ModifierLink['mode']) =>
    links
      .filter((l) => l.target_kind === kind && l.mode === mode)
      .map((l) => targetName(menu, l))
      .filter((n) => n !== '');
  const parts: string[] = [];
  const kinds: [ModifierLink['target_kind'], 'category' | 'size_group' | 'item'][] = [
    ['category', 'category'],
    ['variant_group', 'size_group'],
    ['item', 'item'],
  ];
  for (const [kind, key] of kinds) {
    const names = named(kind, 'attach');
    if (names.length === 0) continue;
    const label = names.length === 1 ? t(`choice_groups.kind_${key}` as 'choice_groups.kind_category') : t(`choice_groups.kinds_${key}` as 'choice_groups.kinds_category');
    parts.push(`${label} ${names.join(', ')}`);
  }
  const off = [...named('category', 'detach'), ...named('variant_group', 'detach'), ...named('item', 'detach')];
  if (off.length > 0) parts.push(fill(t('choice_groups.not_on'), { names: off.join(', ') }));
  return parts.length === 0 ? t('choice_groups.applies_none') : parts.join(' · ');
}

// The stored (or drafted) state of one option at one branch: offered (default true) and its override.
export function offeredAt(branch: Pick<ModifierGroupBranch, 'options'>, optionId: string): boolean {
  return branch.options.find((o) => o.option_id === optionId)?.is_offered ?? true;
}

// 01c-B05 (F1): a required group (min ≥ 1) with no active option offered at the branch.
export function nothingOffered(group: Pick<ModifierGroup, 'min_choices' | 'options'>, branch: Pick<ModifierGroupBranch, 'options'>): boolean {
  return group.min_choices >= 1 && group.options.length > 0 && group.options.every((o) => !offeredAt(branch, o.option_id));
}

// 01c-B04 (m11): an option that goes to the kitchen as an item, offered at the branch, whose item has no route
// there (or is no longer on the active menu). Only meaningful once every menu page has loaded (N9).
export function omittedAt(group: Pick<ModifierGroup, 'options'>, branch: Pick<ModifierGroupBranch, 'branch_id' | 'options'>, items: ReadonlyMap<string, MenuItem>): boolean {
  return group.options.some((o) => {
    if (o.linked_item_id === null || !offeredAt(branch, o.option_id)) return false;
    const item = items.get(o.linked_item_id);
    return item === undefined || !item.routes.some((r) => r.branch_id === branch.branch_id);
  });
}

// S10 "Base Rs 60" / "Base item price" (a kitchen option with no price of its own).
export function baseText(option: { price_minor: number | null }): string {
  return option.price_minor === null
    ? t('choice_group.base_item')
    : fill(t('choice_group.base_price'), { price: `${t('owner.menu.rupees')} ${shownRupees(option.price_minor)}` });
}

// S03 chips and the dialog: an item can be a kitchen option only when sold by piece and not weighed (§3.3).
export function canBeKitchenItem(item: MenuItem): boolean {
  return item.archived_at === null && item.sale_unit === 'piece' && !item.requires_weighing;
}

// The group by id, active or archived (the form and its branch rows re-read through it).
export async function findChoiceGroup(api: CloudAdmin, groupId: string) {
  const [active, archived] = await Promise.all([api.listModifierGroups(), api.listModifierGroups({ status: 'archived' })]);
  if (!active.ok) return active;
  const inActive = active.data.modifier_groups.find((g) => g.modifier_group_id === groupId);
  // A failed archived read is an error, not "isn't here any more" (the group may be archived).
  if (groupId !== 'new' && inActive === undefined && !archived.ok) return archived;
  const all = [...active.data.modifier_groups, ...(archived.ok ? archived.data.modifier_groups : [])];
  return {
    ok: true as const,
    data: { canEditTenant: active.data.can_edit_tenant, group: all.find((g) => g.modifier_group_id === groupId) ?? null },
  };
}
