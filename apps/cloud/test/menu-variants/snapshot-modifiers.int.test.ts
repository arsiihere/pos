import { BranchConfigSnapshotSchemaV2, type BranchConfig, type CreateModifierGroupRequest, type ModifierGroupWire } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { createModifierGroup, createVariantGroup, seedModifierGroupRows } from '../helpers/menu-variants';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const HEADER: SnapshotHeader = {
  config_version: 7,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

// 01c §4.6 rules 3 and 6 (V8, V9 has_plain_options, F1, M5, m5, m15): the modifier groups of a branch's
// schema-2 snapshot and each item's resolved effective set, written through the API (§6.11, §6.12).
describe('01c snapshot modifier groups and effective sets (§4.6)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    // IT-0000 (slot) and IT-0001 (batch) in Karahi, routed at branch A; IT-B in Karahi, routed at branch B only.
    menu = await seedMenu(cloud.pool, f);
  });

  const build = async (branchId: string): Promise<BranchConfig> => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      return BranchConfigSnapshotSchemaV2.parse(await buildSnapshot(client, tenant, branchId, HEADER));
    } finally {
      client.release();
    }
  };
  const idsOf = (snapshot: BranchConfig, itemId: string) => snapshot.items.find((item) => item.item_id === itemId)?.modifier_group_ids;
  const groupOf = (snapshot: BranchConfig, groupId: string) => snapshot.modifier_groups.find((g) => g.modifier_group_id === groupId);
  const inject = (method: 'POST' | 'PATCH', url: string, payload: object) => cloud.app.inject({ method, url, ...owner(f), payload });
  const patchGroup = async (groupId: string, payload: object): Promise<ModifierGroupWire> => {
    const response = await inject('PATCH', `/v1/admin/modifier-groups/${groupId}`, payload);
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data.modifier_group as ModifierGroupWire;
  };
  const createItem = async (payload: object) => {
    const response = await inject('POST', '/v1/admin/menu-items', payload);
    expect(response.statusCode, response.body).toBe(201);
    return (response.json().data.item as { item_id: string }).item_id;
  };
  const karahi = () => ({ target_kind: 'category' as const, target_id: menu.categoryIds[0], mode: 'attach' as const });
  const spice = (o?: Partial<CreateModifierGroupRequest>) =>
    createModifierGroup(cloud, f, {
      name: 'Spice level',
      min_choices: 1,
      max_choices: 1,
      sort_order: 1,
      options: [
        { name: 'Mild', price_minor: 0, sort_order: 1 },
        { name: 'Normal', price_minor: 0, is_default: true, sort_order: 2 },
      ],
      links: [karahi()],
      ...o,
    });
  // P-4: links by SQL, for groups seeded by seedModifierGroupRows (V2 bounds kept: 1 plain option each).
  const seedLinks = async (rows: ReadonlyArray<{ groupId: string; kind: 'category' | 'variant_group' | 'item'; targetId: string; mode: 'attach' | 'detach' }>) => {
    for (const row of rows) {
      await cloud.pool.query(
        `INSERT INTO modifier_group_links (tenant_id, modifier_group_id, target_kind, target_id, mode) VALUES ($1, $2, $3, $4, $5)`,
        [f.tenantId, row.groupId, row.kind, row.targetId, row.mode],
      );
    }
  };

  it('[01c #36] Spice level (min 1 max 1, Normal default) attached to Karahi → every Karahi item lists it; "Extras" with "Extra napkins" at 0 → 201, in the snapshot at 0; an unlinked group is not in modifier_groups (m5)', async () => {
    const [a, b] = f.branches;
    const group = await spice();
    const extras = await createModifierGroup(cloud, f, {
      name: 'Extras',
      min_choices: 0,
      max_choices: 2,
      sort_order: 2,
      options: [{ name: 'Extra napkins', price_minor: 0 }],
      links: [{ target_kind: 'item', target_id: menu.itemIds[0]!, mode: 'attach' }],
    });
    const unused = await createModifierGroup(cloud, f, { name: 'Unused', min_choices: 0, max_choices: 1, options: [{ name: 'X', price_minor: 10 }] });

    const atA = await build(a);
    expect(idsOf(atA, menu.itemIds[0]!)).toEqual([group.modifier_group_id, extras.modifier_group_id]);
    expect(idsOf(atA, menu.itemIds[1]!)).toEqual([group.modifier_group_id]);
    const [mild, normal] = group.options;
    expect(atA.modifier_groups).toEqual([
      {
        modifier_group_id: group.modifier_group_id,
        name: 'Spice level',
        min_choices: 1,
        max_choices: 1,
        sort_order: 1,
        has_plain_options: true,
        options: [
          { option_id: mild!.option_id, name: 'Mild', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 },
          { option_id: normal!.option_id, name: 'Normal', price_minor: 0, max_quantity: 1, is_default: true, linked_item_id: null, sort_order: 2 },
        ],
      },
      {
        modifier_group_id: extras.modifier_group_id,
        name: 'Extras',
        min_choices: 0,
        max_choices: 2,
        sort_order: 2,
        has_plain_options: true,
        options: [
          { option_id: extras.options[0]!.option_id, name: 'Extra napkins', price_minor: 0, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 0 },
        ],
      },
    ]);
    expect(groupOf(atA, unused.modifier_group_id)).toBeUndefined();
    // Branch B: IT-B is in Karahi too; Extras reaches no item there, so it is not in B's modifier_groups (m5).
    const atB = await build(b);
    expect(idsOf(atB, 'IT-B')).toEqual([group.modifier_group_id]);
    expect(atB.modifier_groups.map((g) => g.modifier_group_id)).toEqual([group.modifier_group_id]);
  });

  it('[01c #37] detach on the Half item → Half lacks it, Full keeps it; detach on the variant group + attach on Full → only Full has it', async () => {
    const [a] = f.branches;
    const variantGroup = await createVariantGroup(cloud, f, { name: 'Chicken Karahi', category_id: menu.categoryIds[0] });
    const variant = (name: string) =>
      createItem({
        category_id: menu.categoryIds[0],
        tax_class_id: null,
        variant_group_id: variantGroup.variant_group_id,
        variant_name: name,
        name: `Chicken Karahi ${name}`,
        price_minor: 100_000,
        serve_mode: 'sync',
        cook_time_ms: 1_200_000,
        routes: [{ branch_id: a, station_id: menu.slotStationId }],
      });
    const half = await variant('Half');
    const full = await variant('Full');
    const group = await spice({ links: [karahi(), { target_kind: 'item', target_id: half, mode: 'detach' }] });
    const id = group.modifier_group_id;

    let snapshot = await build(a);
    expect(idsOf(snapshot, half)).toEqual([]);
    expect(idsOf(snapshot, full)).toEqual([id]);
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual([id]);

    await patchGroup(id, {
      expected_version: group.version,
      links: [
        karahi(),
        { target_kind: 'variant_group', target_id: variantGroup.variant_group_id, mode: 'detach' },
        { target_kind: 'item', target_id: full, mode: 'attach' },
      ],
    });
    snapshot = await build(a);
    expect(idsOf(snapshot, half)).toEqual([]);
    expect(idsOf(snapshot, full)).toEqual([id]);
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual([id]);
    expect(snapshot.modifier_groups.map((g) => g.modifier_group_id)).toEqual([id]);
  });

  it('[01c #81] required "Bread" whose only option links an item not routed at B → B keeps it with options: [] and IT-B lists it; an optional group in the same state is absent from modifier_groups and modifier_group_ids', async () => {
    const [a, b] = f.branches;
    // IT-0000 is routed at A only; a linked option with a null price takes the item's price there.
    const linked = { name: 'Naan', price_minor: null, linked_item_id: menu.itemIds[0]! };
    const bread = await createModifierGroup(cloud, f, { name: 'Bread', min_choices: 1, max_choices: 1, sort_order: 1, options: [linked], links: [karahi()] });
    const sauce = await createModifierGroup(cloud, f, { name: 'Sauce', min_choices: 0, max_choices: 1, sort_order: 2, options: [linked], links: [karahi()] });

    const atB = await build(b);
    expect(atB.modifier_groups).toEqual([
      { modifier_group_id: bread.modifier_group_id, name: 'Bread', min_choices: 1, max_choices: 1, sort_order: 1, has_plain_options: false, options: [] },
    ]);
    expect(idsOf(atB, 'IT-B')).toEqual([bread.modifier_group_id]);

    const atA = await build(a);
    expect(atA.modifier_groups.map((g) => g.modifier_group_id)).toEqual([bread.modifier_group_id, sauce.modifier_group_id]);
    expect(groupOf(atA, sauce.modifier_group_id)!.options).toEqual([
      { option_id: sauce.options[0]!.option_id, name: 'Naan', price_minor: 120_000, max_quantity: 1, is_default: false, linked_item_id: menu.itemIds[0], sort_order: 0 },
    ]);
    expect(idsOf(atA, menu.itemIds[1]!)).toEqual([bread.modifier_group_id, sauce.modifier_group_id]);
  });

  it('[01c #100] an item with 21 effective groups (seeded directly) → the builder succeeds, the snapshot parses with BranchConfigSnapshotSchemaV2 and lists 21 ids', async () => {
    const [a] = f.branches;
    const groupIds: string[] = [];
    for (let n = 0; n < 21; n += 1) {
      const groupId = `MG-${String(n).padStart(2, '0')}`;
      await seedModifierGroupRows(cloud, f, { modifierGroupId: groupId, options: [{ optionId: `MO-${groupId}`, priceMinor: 100 }] });
      groupIds.push(groupId);
    }
    await seedLinks(groupIds.map((groupId) => ({ groupId, kind: 'category', targetId: menu.categoryIds[0], mode: 'attach' })));

    const snapshot = await build(a); // parsed with BranchConfigSnapshotSchemaV2 in build()
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual(groupIds);
    expect(snapshot.modifier_groups).toHaveLength(21);
  });

  it('[01c #109] re-sending a link to a category archived since → 200; a new link to an archived target → 422 archived; the builder ignores archived targets; archiving an item linked only by an option of an archived group → 200', async () => {
    const [a] = f.branches;
    const category = async (name: string) => (await inject('POST', '/v1/admin/categories', { name })).json().data.category.category_id as string;
    const old = await category('Old');
    const group = await spice({ links: [karahi(), { target_kind: 'category', target_id: old, mode: 'attach' }] });
    expect((await inject('PATCH', `/v1/admin/categories/${old}`, { archived: true })).statusCode).toBe(200);
    const resent = await patchGroup(group.modifier_group_id, { expected_version: group.version, links: group.links, name: 'Spice' });
    const fresh = await category('Fresh');
    expect((await inject('PATCH', `/v1/admin/categories/${fresh}`, { archived: true })).statusCode).toBe(200);
    const added = await inject('PATCH', `/v1/admin/modifier-groups/${group.modifier_group_id}`, {
      expected_version: resent.version,
      links: [...resent.links, { target_kind: 'category', target_id: fresh, mode: 'attach' }],
    });
    expect(added.statusCode, added.body).toBe(422);
    expect(added.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { reason: 'archived' } });
    // The archived category's link is ignored; the Karahi link still reaches every Karahi item.
    let snapshot = await build(a);
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual([group.modifier_group_id]);

    // m15 by SQL (bypassing V16): IT-0000 in a variant group archived since, with a detach there and an attach on
    // Karahi → the detach is ignored and IT-0000 keeps the group; an attach on an archived category reaches nothing.
    await cloud.pool.query(
      `INSERT INTO variant_groups (tenant_id, variant_group_id, category_id, name, sort_order, archived_at, created_at, updated_at)
       VALUES ($1, 'VG-OLD', $2, 'Old group', 1, 1, 0, 0)`,
      [f.tenantId, menu.categoryIds[0]],
    );
    await cloud.pool.query(`UPDATE menu_items SET variant_group_id = 'VG-OLD', variant_name = 'Half' WHERE tenant_id = $1 AND item_id = $2`, [
      f.tenantId,
      menu.itemIds[0],
    ]);
    await seedModifierGroupRows(cloud, f, { modifierGroupId: 'MG-SQL', options: [{ optionId: 'MO-SQL', priceMinor: 5 }] });
    await seedLinks([
      { groupId: 'MG-SQL', kind: 'category', targetId: menu.categoryIds[0], mode: 'attach' },
      { groupId: 'MG-SQL', kind: 'variant_group', targetId: 'VG-OLD', mode: 'detach' },
    ]);
    await cloud.pool.query(`UPDATE categories SET archived_at = 1 WHERE tenant_id = $1 AND category_id = $2`, [f.tenantId, menu.categoryIds[1]]);
    await cloud.pool.query(`UPDATE menu_items SET category_id = $2 WHERE tenant_id = $1 AND item_id = $3`, [f.tenantId, menu.categoryIds[1], menu.itemIds[1]]);
    await seedModifierGroupRows(cloud, f, { modifierGroupId: 'MG-BRK', options: [{ optionId: 'MO-BRK', priceMinor: 5 }] });
    await seedLinks([{ groupId: 'MG-BRK', kind: 'category', targetId: menu.categoryIds[1], mode: 'attach' }]);
    snapshot = await build(a);
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual(['MG-SQL', group.modifier_group_id]);
    expect(idsOf(snapshot, menu.itemIds[1]!)).toEqual([]);
    expect(groupOf(snapshot, 'MG-BRK')).toBeUndefined();

    // §6.5 R4 counts only options of active groups: an item linked only by an option of an archived group archives.
    const naan = await createItem({
      category_id: menu.categoryIds[0],
      tax_class_id: null,
      name: 'Naan',
      price_minor: 3_000,
      serve_mode: 'immediate',
      cook_time_ms: 60_000,
      routes: [{ branch_id: a, station_id: menu.slotStationId }],
    });
    const bread = await createModifierGroup(cloud, f, { name: 'Bread', min_choices: 0, max_choices: 1, options: [{ name: 'Naan', linked_item_id: naan }] });
    await patchGroup(bread.modifier_group_id, { expected_version: bread.version, archived: true });
    expect((await inject('PATCH', `/v1/admin/menu-items/${naan}`, { archived: true })).statusCode).toBe(200);
  });

  it('[01c #113] effective set order: groups with sort_order 2, 1, 1 (the two 1s resolved by id) → modifier_group_ids by sort_order, then id', async () => {
    const [a] = f.branches;
    for (const [groupId, sortOrder] of [
      ['MG-C', 2],
      ['MG-B', 1],
      ['MG-A', 1],
    ] as const) {
      await seedModifierGroupRows(cloud, f, { modifierGroupId: groupId, options: [{ optionId: `MO-${groupId}`, priceMinor: 0 }] });
      await cloud.pool.query(`UPDATE modifier_groups SET sort_order = $3 WHERE tenant_id = $1 AND modifier_group_id = $2`, [f.tenantId, groupId, sortOrder]);
    }
    await seedLinks([
      { groupId: 'MG-C', kind: 'item', targetId: menu.itemIds[0]!, mode: 'attach' },
      { groupId: 'MG-B', kind: 'category', targetId: menu.categoryIds[0], mode: 'attach' },
      { groupId: 'MG-A', kind: 'item', targetId: menu.itemIds[0]!, mode: 'attach' },
    ]);
    const snapshot = await build(a);
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual(['MG-A', 'MG-B', 'MG-C']);
    expect(snapshot.modifier_groups.map((g) => g.modifier_group_id)).toEqual(['MG-A', 'MG-B', 'MG-C']);
  });
});
