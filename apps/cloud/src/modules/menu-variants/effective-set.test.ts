import { DomainError } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { MAX_EFFECTIVE_GROUPS, assertEffectiveSetLimit, effectiveGroupIds, type LinkRow } from './effective-set';

// 01c V8: the effective set of an item: the most specific link of each group wins (item > variant group >
// category); a group applies when that link attaches. Links of unknown (archived) groups and links whose target
// is archived are ignored; the set is ordered by group sort_order, then id.
describe('[01c V8] effective set', () => {
  const half = { item_id: 'IT-HALF', category_id: 'CA-KARAHI', variant_group_id: 'VG-KARAHI' };
  const full = { item_id: 'IT-FULL', category_id: 'CA-KARAHI', variant_group_id: 'VG-KARAHI' };
  const plain = { item_id: 'IT-RAITA', category_id: 'CA-SIDES', variant_group_id: null };
  const link = (modifier_group_id: string, target_kind: LinkRow['target_kind'], target_id: string, mode: LinkRow['mode'] = 'attach'): LinkRow => ({
    modifier_group_id,
    target_kind,
    target_id,
    mode,
  });
  const groups = [
    { modifier_group_id: 'MG-SPICE', sort_order: 1 },
    { modifier_group_id: 'MG-EXTRAS', sort_order: 2 },
    { modifier_group_id: 'MG-BREAD', sort_order: 2 },
  ];
  const active = new Set(['IT-HALF', 'IT-FULL', 'IT-RAITA', 'CA-KARAHI', 'CA-SIDES', 'VG-KARAHI']);

  it('a category attach reaches every item of the category; nothing else', () => {
    const links = [link('MG-SPICE', 'category', 'CA-KARAHI')];
    expect(effectiveGroupIds(half, links, groups, active)).toEqual(['MG-SPICE']);
    expect(effectiveGroupIds(full, links, groups, active)).toEqual(['MG-SPICE']);
    expect(effectiveGroupIds(plain, links, groups, active)).toEqual([]);
  });

  it('most specific link wins: item > variant group > category', () => {
    // detach on the Half item: Half lacks it, Full keeps it
    const itemDetach = [link('MG-SPICE', 'category', 'CA-KARAHI'), link('MG-SPICE', 'item', 'IT-HALF', 'detach')];
    expect(effectiveGroupIds(half, itemDetach, groups, active)).toEqual([]);
    expect(effectiveGroupIds(full, itemDetach, groups, active)).toEqual(['MG-SPICE']);
    // detach on the variant group beats the category attach
    const groupDetach = [link('MG-SPICE', 'category', 'CA-KARAHI'), link('MG-SPICE', 'variant_group', 'VG-KARAHI', 'detach')];
    expect(effectiveGroupIds(half, groupDetach, groups, active)).toEqual([]);
    expect(effectiveGroupIds(full, groupDetach, groups, active)).toEqual([]);
  });

  it('a lower-level attach re-adds: detach on the variant group + attach on Full → only Full has it', () => {
    const links = [
      link('MG-SPICE', 'category', 'CA-KARAHI'),
      link('MG-SPICE', 'variant_group', 'VG-KARAHI', 'detach'),
      link('MG-SPICE', 'item', 'IT-FULL'),
    ];
    expect(effectiveGroupIds(half, links, groups, active)).toEqual([]);
    expect(effectiveGroupIds(full, links, groups, active)).toEqual(['MG-SPICE']);
  });

  it('a group attached at several levels appears once', () => {
    const links = [link('MG-SPICE', 'category', 'CA-KARAHI'), link('MG-SPICE', 'variant_group', 'VG-KARAHI'), link('MG-SPICE', 'item', 'IT-HALF')];
    expect(effectiveGroupIds(half, links, groups, active)).toEqual(['MG-SPICE']);
  });

  it('archived targets are ignored: the next most specific link decides', () => {
    const links = [link('MG-SPICE', 'category', 'CA-KARAHI'), link('MG-SPICE', 'variant_group', 'VG-KARAHI', 'detach')];
    const groupArchived = new Set(['IT-HALF', 'CA-KARAHI']);
    expect(effectiveGroupIds(half, links, groups, groupArchived)).toEqual(['MG-SPICE']);
    const itemArchived = new Set(['CA-KARAHI', 'VG-KARAHI']);
    expect(effectiveGroupIds(half, [link('MG-EXTRAS', 'item', 'IT-HALF')], groups, itemArchived)).toEqual([]);
    expect(effectiveGroupIds(half, [link('MG-SPICE', 'category', 'CA-KARAHI')], groups, new Set(['IT-HALF']))).toEqual([]);
  });

  it('links of a group not listed (an archived group) are ignored', () => {
    expect(effectiveGroupIds(half, [link('MG-GONE', 'category', 'CA-KARAHI')], groups, active)).toEqual([]);
  });

  it('a link that names another item, variant group or category does not apply', () => {
    const links = [link('MG-SPICE', 'item', 'IT-FULL'), link('MG-EXTRAS', 'variant_group', 'VG-OTHER'), link('MG-BREAD', 'category', 'CA-SIDES')];
    expect(effectiveGroupIds(half, links, groups, new Set([...active, 'VG-OTHER']))).toEqual([]);
    // a plain item has no variant group: a variant group link never reaches it
    expect(effectiveGroupIds(plain, [link('MG-SPICE', 'variant_group', 'VG-KARAHI')], groups, active)).toEqual([]);
  });

  it('ordered by group sort_order, then id', () => {
    const links = [link('MG-EXTRAS', 'item', 'IT-HALF'), link('MG-BREAD', 'variant_group', 'VG-KARAHI'), link('MG-SPICE', 'category', 'CA-KARAHI')];
    expect(effectiveGroupIds(half, links, groups, active)).toEqual(['MG-SPICE', 'MG-BREAD', 'MG-EXTRAS']);
  });

  it('assertEffectiveSetLimit: 20 groups pass; a 21st on any item → 422 too_many_groups at the field given', () => {
    const many = Array.from({ length: MAX_EFFECTIVE_GROUPS + 1 }, (_, i) => ({ modifier_group_id: `MG-${String(i).padStart(2, '0')}`, sort_order: 0 }));
    const twenty = many.slice(0, MAX_EFFECTIVE_GROUPS).map((g) => link(g.modifier_group_id, 'category', 'CA-KARAHI'));
    expect(MAX_EFFECTIVE_GROUPS).toBe(20);
    expect(() => assertEffectiveSetLimit([half, full], twenty, many, active, 'links')).not.toThrow();
    const extra = [...twenty, link(many[MAX_EFFECTIVE_GROUPS]!.modifier_group_id, 'item', 'IT-FULL')];
    expect(() => assertEffectiveSetLimit([half], extra, many, active, 'links')).not.toThrow();
    let thrown: unknown;
    try {
      assertEffectiveSetLimit([half, full], extra, many, active, 'category_id');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'too_many_groups' } });
  });
});
