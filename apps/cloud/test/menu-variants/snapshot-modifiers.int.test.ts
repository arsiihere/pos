import { isGroupSatisfiable } from '@pos/domain';
import { BranchConfigSnapshotSchemaV3, type BranchConfig, type CreateModifierGroupRequest, type ModifierGroupWire } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { createModifierGroup, createVariantGroup, seedModifierGroupRows } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
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
// schema-3 snapshot and each item's resolved effective set, written through the API (§6.11, §6.12).
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
      return BranchConfigSnapshotSchemaV3.parse(await buildSnapshot(client, tenant, branchId, HEADER));
    } finally {
      client.release();
    }
  };
  // The builder's statement count (01c #127; transaction control excluded).
  const countBuild = async (branchId: string) => {
    const counter = pgCounter(cloud.pool);
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      counter.reset();
      BranchConfigSnapshotSchemaV3.parse(await buildSnapshot(client, tenant, branchId, HEADER));
      return counter.count;
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
  // §6.12a through the API, at the group's current branch version.
  const putBranch = async (group: ModifierGroupWire, branchId: string, options: object[]) => {
    const version = group.branches.find((branch) => branch.branch_id === branchId)!.version;
    const response = await cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/modifier-groups/${group.modifier_group_id}/branches/${branchId}`,
      ...owner(f),
      payload: { expected_version: version, options },
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const groupWire = async (groupId: string): Promise<ModifierGroupWire> => {
    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/modifier-groups', headers: owner(f).headers });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json().data.modifier_groups as ModifierGroupWire[]).find((g) => g.modifier_group_id === groupId)!;
  };
  const putRoute = async (itemId: string, branchId: string, payload: object) => {
    const response = await cloud.app.inject({ method: 'PUT', url: `/v1/admin/menu-items/${itemId}/routes/${branchId}`, ...owner(f), payload });
    expect(response.statusCode, response.body).toBe(200);
  };
  // Naan (serve mode immediate, 1 min), Rs 30, routed at A only.
  const naanItem = () =>
    createItem({
      category_id: menu.categoryIds[1],
      tax_class_id: null,
      name: 'Naan',
      price_minor: 3_000,
      serve_mode: 'immediate',
      cook_time_ms: 60_000,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [f.tenantId])
    ).rows.map((row) => Number(row.config_version));
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

  it('[01c #100] an item with 21 effective groups (seeded directly) → the builder succeeds, the snapshot parses with BranchConfigSnapshotSchemaV3 and lists 21 ids', async () => {
    const [a] = f.branches;
    const groupIds: string[] = [];
    for (let n = 0; n < 21; n += 1) {
      const groupId = `MG-${String(n).padStart(2, '0')}`;
      await seedModifierGroupRows(cloud, f, { modifierGroupId: groupId, options: [{ optionId: `MO-${groupId}`, priceMinor: 100 }] });
      groupIds.push(groupId);
    }
    await seedLinks(groupIds.map((groupId) => ({ groupId, kind: 'category', targetId: menu.categoryIds[0], mode: 'attach' })));

    const snapshot = await build(a); // parsed with BranchConfigSnapshotSchemaV3 in build()
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

  it('[01c #59] linked option price: the option override wins; else the linked item’s branch override; omitted where the linked item has no route; the linked item keeps its own serve_mode, station and cook time; plain options carry no station or timing fields', async () => {
    const [a, b] = f.branches;
    const naan = await naanItem();
    await putRoute(naan, a, { station_id: 'ST-1', price_minor_override: 3_500 });
    const bread = await createModifierGroup(cloud, f, {
      name: 'Bread',
      min_choices: 0,
      max_choices: 2,
      options: [
        { name: 'Butter', price_minor: 500, sort_order: 1 },
        { name: 'Naan', price_minor: null, linked_item_id: naan, sort_order: 2 },
      ],
      links: [karahi()],
    });
    const [butter, naanOption] = bread.options;
    const optionsAt = async (branchId: string) => groupOf(await build(branchId), bread.modifier_group_id)?.options;

    // null option price → the linked item's branch override (S57)
    let atA = await build(a);
    expect(groupOf(atA, bread.modifier_group_id)!.options).toEqual([
      { option_id: butter!.option_id, name: 'Butter', price_minor: 500, max_quantity: 1, is_default: false, linked_item_id: null, sort_order: 1 },
      { option_id: naanOption!.option_id, name: 'Naan', price_minor: 3_500, max_quantity: 1, is_default: false, linked_item_id: naan, sort_order: 2 },
    ]);
    // V7: the linked item is in the snapshot with its own serve mode, station and cook time
    expect(atA.items.find((item) => item.item_id === naan)).toMatchObject({ serve_mode: 'immediate', station_id: 'ST-1', cook_time_ms: 60_000 });
    // the option's own price wins over the item's branch price
    const priced = await patchGroup(bread.modifier_group_id, {
      expected_version: bread.version,
      options: [
        { option_id: butter!.option_id, name: 'Butter', price_minor: 500, sort_order: 1 },
        { option_id: naanOption!.option_id, name: 'Naan', price_minor: 2_000, linked_item_id: naan, sort_order: 2 },
      ],
    });
    expect((await optionsAt(a))!.map((o) => o.price_minor)).toEqual([500, 2_000]);
    // the option's branch override wins over both
    await putBranch(priced, a, [{ option_id: naanOption!.option_id, is_offered: true, price_minor_override: 2_500 }]);
    atA = await build(a);
    expect(groupOf(atA, bread.modifier_group_id)!.options.map((o) => o.price_minor)).toEqual([500, 2_500]);
    // Branch B: Naan has no route there → its option is left out, Butter stays
    expect((await optionsAt(b))!.map((o) => o.option_id)).toEqual([butter!.option_id]);
  });

  it('[01c #88] PUT at A [O1 not offered, O2 offered at 4 000] → A omits O1 and prices O2 at 4 000; B keeps both at base; one audit row branch_set at A; only A bumped', async () => {
    const [a, b] = f.branches;
    const group = await spice({
      min_choices: 0,
      options: [
        { name: 'Mild', price_minor: 100, sort_order: 1 },
        { name: 'Normal', price_minor: 200, sort_order: 2 },
      ],
    });
    const [o1, o2] = group.options;
    const before = await versions();
    await putBranch(group, a, [
      { option_id: o1!.option_id, is_offered: false },
      { option_id: o2!.option_id, is_offered: true, price_minor_override: 4_000 },
    ]);
    const order = [...f.branches].sort();
    expect(await versions()).toEqual(before.map((v, i) => (order[i] === a ? v + 1 : v)));
    const audit = await cloud.pool.query<{ entity: string; action: string; branch_id: string | null }>(
      `SELECT entity, action, branch_id FROM config_audit WHERE tenant_id = $1 AND entity_id = $2 AND action = 'branch_set'`,
      [f.tenantId, group.modifier_group_id],
    );
    expect(audit.rows).toEqual([{ entity: 'modifier_group', action: 'branch_set', branch_id: a }]);

    expect(groupOf(await build(a), group.modifier_group_id)!.options.map((o) => [o.option_id, o.price_minor])).toEqual([[o2!.option_id, 4_000]]);
    expect(groupOf(await build(b), group.modifier_group_id)!.options.map((o) => [o.option_id, o.price_minor])).toEqual([
      [o1!.option_id, 100],
      [o2!.option_id, 200],
    ]);
  });

  it('[01c #89] linked Naan (option price null; Naan’s A route override 3 500) with an A option override 2 500 → 2 500; without the option override → 3 500', async () => {
    const [a] = f.branches;
    const naan = await naanItem();
    await putRoute(naan, a, { station_id: 'ST-1', price_minor_override: 3_500 });
    const bread = await createModifierGroup(cloud, f, {
      name: 'Bread',
      min_choices: 0,
      max_choices: 1,
      options: [{ name: 'Naan', linked_item_id: naan }],
      links: [karahi()],
    });
    const option = bread.options[0]!.option_id;
    const priceAtA = async () => groupOf(await build(a), bread.modifier_group_id)!.options.map((o) => o.price_minor);
    await putBranch(bread, a, [{ option_id: option, is_offered: true, price_minor_override: 2_500 }]);
    expect(await priceAtA()).toEqual([2_500]);
    await putBranch(await groupWire(bread.modifier_group_id), a, []);
    expect(await priceAtA()).toEqual([3_500]);
  });

  it('[01c #92] required Spice level with every option not offered at A → 200; A keeps the group with options: []; isGroupSatisfiable is false for it', async () => {
    const [a] = f.branches;
    const group = await spice();
    await putBranch(
      group,
      a,
      group.options.map((o) => ({ option_id: o.option_id, is_offered: false })),
    );
    const snapshot = await build(a);
    const kept = groupOf(snapshot, group.modifier_group_id)!;
    expect(kept).toMatchObject({ min_choices: 1, has_plain_options: true, options: [] });
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual([group.modifier_group_id]);
    const groupsById = Object.fromEntries(snapshot.modifier_groups.map((g) => [g.modifier_group_id, g]));
    const itemsById = Object.fromEntries(snapshot.items.map((item) => [item.item_id, item]));
    expect(isGroupSatisfiable(kept, 'line', groupsById, itemsById, () => true)).toBe(false);
  });

  it('[01c #106] O2 archived with an A row; a PUT at A for O1 keeps O2’s row; restoring O2 brings its A override back into the snapshot', async () => {
    const [a] = f.branches;
    const group = await spice({
      min_choices: 0,
      options: [
        { name: 'Mild', price_minor: 100, sort_order: 1 },
        { name: 'Normal', price_minor: 200, sort_order: 2 },
      ],
    });
    const [o1, o2] = group.options;
    await putBranch(group, a, [{ option_id: o2!.option_id, is_offered: true, price_minor_override: 4_000 }]);
    const archived = await patchGroup(group.modifier_group_id, {
      expected_version: group.version,
      options: [{ option_id: o1!.option_id, name: 'Mild', price_minor: 100, sort_order: 1 }],
    });
    await putBranch(archived, a, [{ option_id: o1!.option_id, is_offered: true, price_minor_override: 150 }]);
    const rows = await cloud.pool.query(`SELECT option_id, price_minor_override::int AS price FROM modifier_option_branches WHERE branch_id = $1 ORDER BY option_id`, [a]);
    expect(rows.rows).toEqual(
      [
        { option_id: o1!.option_id, price: 150 },
        { option_id: o2!.option_id, price: 4_000 },
      ].sort((x, y) => (x.option_id < y.option_id ? -1 : 1)),
    );
    expect(groupOf(await build(a), group.modifier_group_id)!.options.map((o) => [o.option_id, o.price_minor])).toEqual([[o1!.option_id, 150]]);

    await patchGroup(group.modifier_group_id, {
      expected_version: (await groupWire(group.modifier_group_id)).version,
      options: [
        { option_id: o1!.option_id, name: 'Mild', price_minor: 100, sort_order: 1 },
        { option_id: o2!.option_id, name: 'Normal', price_minor: 200, sort_order: 2 },
      ],
    });
    expect(groupOf(await build(a), group.modifier_group_id)!.options.map((o) => [o.option_id, o.price_minor])).toEqual([
      [o1!.option_id, 150],
      [o2!.option_id, 4_000],
    ]);
  });

  it('[01c #127] backstop: required Bread with plain Butter and linked Naan; Naan set by SQL to g, then weighed, then archived → Naan left out, Butter stays; Butter not offered too → Bread kept with options: []; Naan back to an active piece item → the option is back; 21 statements', async () => {
    const [a] = f.branches;
    const naan = await naanItem();
    const bread = await createModifierGroup(cloud, f, {
      name: 'Bread',
      min_choices: 1,
      max_choices: 2,
      options: [
        { name: 'Butter', price_minor: 500, sort_order: 1 },
        { name: 'Naan', linked_item_id: naan, sort_order: 2 },
      ],
      links: [karahi()],
    });
    const [butter, naanOption] = bread.options.map((o) => o.option_id);
    const optionIds = async () => groupOf(await build(a), bread.modifier_group_id)?.options.map((o) => o.option_id);
    const setNaan = (set: string) => cloud.pool.query(`UPDATE menu_items SET ${set} WHERE tenant_id = $1 AND item_id = $2`, [f.tenantId, naan]);
    expect(await optionIds()).toEqual([butter, naanOption]);
    const statements = await countBuild(a);

    await setNaan(`sale_unit = 'g', stock_unit = 'g'`); // the deprecated unit column follows (01a S44 CHECK)
    expect(await optionIds()).toEqual([butter]);
    await setNaan(`requires_weighing = true`);
    expect(await optionIds()).toEqual([butter]);
    await setNaan(`archived_at = 1`);
    expect(await optionIds()).toEqual([butter]);

    await putBranch(bread, a, [{ option_id: butter!, is_offered: false }]);
    const snapshot = await build(a);
    expect(groupOf(snapshot, bread.modifier_group_id)).toMatchObject({ min_choices: 1, has_plain_options: true, options: [] });
    expect(idsOf(snapshot, menu.itemIds[0]!)).toEqual([bread.modifier_group_id]);

    await setNaan(`sale_unit = 'piece', stock_unit = 'piece', requires_weighing = false, archived_at = NULL`);
    expect(await optionIds()).toEqual([naanOption]);
    // 01c §6.17: task 27's 12 + this branch's option rows (+ task 31's 3 deal reads, + 03a C6's 5); unchanged by what the rows hold
    expect(statements).toBe(21);
    expect(await countBuild(a)).toBe(21);
  });
});
