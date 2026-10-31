import { DomainError } from '@pos/domain';
import type { ModifierLinkRow } from './versions.js';

// 01c V8: a modifier_group_links row with its group.
export interface LinkRow extends ModifierLinkRow {
  modifier_group_id: string;
}

export interface EffectiveSetItem {
  item_id: string;
  category_id: string;
  variant_group_id: string | null;
}

export interface GroupOrder {
  modifier_group_id: string;
  sort_order: number;
}

// §3.3: at most 20 effective groups per item, a write-time soft limit (M5): never checked by the snapshot schema
// or the builder.
export const MAX_EFFECTIVE_GROUPS = 20;

const SPECIFICITY: Record<LinkRow['target_kind'], number> = { category: 1, variant_group: 2, item: 3 };

function reaches(item: EffectiveSetItem, link: LinkRow): boolean {
  switch (link.target_kind) {
    case 'item':
      return link.target_id === item.item_id;
    case 'variant_group':
      return item.variant_group_id !== null && link.target_id === item.variant_group_id;
    case 'category':
      return link.target_id === item.category_id;
  }
}

// V8: for each group in `groups` (the active groups), its most specific link that reaches the item (item >
// variant group > category) decides; the group applies when that link attaches. A link of a group not in `groups`,
// or whose target is not in `activeTargets` (m15: archived targets are ignored), does not count. Ordered by group
// sort_order, then id.
export function effectiveGroupIds(
  item: EffectiveSetItem,
  links: readonly LinkRow[],
  groups: readonly GroupOrder[],
  activeTargets: ReadonlySet<string>,
): string[] {
  const known = new Map(groups.map((group) => [group.modifier_group_id, group]));
  const decisive = new Map<string, LinkRow>();
  for (const link of links) {
    if (!known.has(link.modifier_group_id) || !activeTargets.has(link.target_id) || !reaches(item, link)) continue;
    const current = decisive.get(link.modifier_group_id);
    if (current === undefined || SPECIFICITY[link.target_kind] > SPECIFICITY[current.target_kind]) {
      decisive.set(link.modifier_group_id, link);
    }
  }
  return [...decisive.values()]
    .filter((link) => link.mode === 'attach')
    .map((link) => known.get(link.modifier_group_id)!)
    .sort((a, b) => a.sort_order - b.sort_order || (a.modifier_group_id < b.modifier_group_id ? -1 : a.modifier_group_id > b.modifier_group_id ? 1 : 0))
    .map((group) => group.modifier_group_id);
}

// §3.3 effective-set row: any item above the limit → 422 CONFIG_REFERENCE_INVALID { field, reason: 'too_many_groups' }.
export function assertEffectiveSetLimit(
  items: readonly EffectiveSetItem[],
  links: readonly LinkRow[],
  groups: readonly GroupOrder[],
  activeTargets: ReadonlySet<string>,
  field: string,
): void {
  for (const item of items) {
    if (effectiveGroupIds(item, links, groups, activeTargets).length > MAX_EFFECTIVE_GROUPS) {
      throw new DomainError('CONFIG_REFERENCE_INVALID', { field, reason: 'too_many_groups' });
    }
  }
}
