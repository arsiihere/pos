import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateModifierGroupRequest } from '@pos/events';
import { createModifierGroup, createVariantGroup } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01c §6.11: modifier group create; V8 effective-set limit (§3.3, M5) on group writes and item writes (§6.2 R3,
// §6.4, §6.5 R3).
describe('01c modifier group create (§6.11) and the effective-set limit', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const inject = (method: 'POST' | 'PATCH', url: string, payload: object, headers?: Record<string, string>) =>
    cloud.app.inject({ method, url, headers: { ...owner(f).headers, ...headers }, payload });
  const postGroup = (payload: object, headers?: Record<string, string>) => inject('POST', '/v1/admin/modifier-groups', payload, headers);
  const category = async (name: string, o?: { archived?: boolean }) => {
    const id = (await inject('POST', '/v1/admin/categories', { name })).json().data.category.category_id as string;
    if (o?.archived === true) expect((await inject('PATCH', `/v1/admin/categories/${id}`, { archived: true })).statusCode).toBe(200);
    return id;
  };
  const itemBody = (o: object) => ({
    category_id: menu.categoryIds[0],
    tax_class_id: null,
    price_minor: 10000,
    serve_mode: 'sync',
    cook_time_ms: 600_000,
    routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    ...o,
  });
  const item = async (o: object) => {
    const response = await inject('POST', '/v1/admin/menu-items', itemBody(o));
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item.item_id as string;
  };
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const counts = async () =>
    (
      await cloud.pool.query<{ groups: number; options: number; links: number; items: number; audit: number }>(
        `SELECT (SELECT count(*)::int FROM modifier_groups) AS groups, (SELECT count(*)::int FROM modifier_options) AS options,
                (SELECT count(*)::int FROM modifier_group_links) AS links, (SELECT count(*)::int FROM menu_items) AS items,
                (SELECT count(*)::int FROM config_audit) AS audit`,
      )
    ).rows[0];
  // The call answers `status` with nothing written and no branch bumped; the error is returned.
  const refused = async (call: () => Promise<{ statusCode: number; body: string; json: () => unknown }>, status: number) => {
    const before = { counts: await counts(), versions: await versions() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect(await counts()).toEqual(before.counts);
    expect(await versions()).toEqual(before.versions);
    return (response.json() as { error: { code: string; details: Record<string, unknown> } }).error;
  };
  const issuePaths = (error: { details: Record<string, unknown> }) =>
    (error.details.issues as Array<{ path: string }>).map((i) => i.path);
  const plainGroup = (name: string, links: CreateModifierGroupRequest['links'] = []): CreateModifierGroupRequest => ({
    name,
    min_choices: 0,
    max_choices: 1,
    options: [{ name: 'Yes', price_minor: 0 }],
    links,
  });

  it('[01c §6.11] create → 201 wire, one audit row with options and links, every branch bumped; replay → stored 201', async () => {
    const karahi = menu.categoryIds[0];
    const group = await createVariantGroup(cloud, f, { name: 'Chicken Karahi', category_id: karahi });
    const half = await item({ name: 'Chicken Karahi Half', variant_group_id: group.variant_group_id, variant_name: 'Half' });
    const raita = await item({ name: 'Raita' });
    const before = await versions();
    const key = '01J00000000000000000000123';
    const body = {
      name: 'Spice level',
      min_choices: 1,
      max_choices: 1,
      sort_order: 2,
      options: [
        { name: 'Normal', price_minor: 0, is_default: true },
        { name: 'Extra raita', linked_item_id: raita, sort_order: 1 },
      ],
      links: [
        { target_kind: 'category', target_id: karahi, mode: 'attach' },
        { target_kind: 'variant_group', target_id: group.variant_group_id, mode: 'detach' },
        { target_kind: 'item', target_id: half, mode: 'attach' },
      ],
    };
    const created = await postGroup(body, { 'idempotency-key': key });
    expect(created.statusCode, created.body).toBe(201);
    // key insert, tenant-wide check, variant groups / items / categories FOR SHARE, option names, effective-set read,
    // group / options / links inserts, audit, 2 bump, key response, prune
    expect(counter.count).toBe(15);
    const wire = created.json().data.modifier_group;
    expect(wire).toEqual({
      modifier_group_id: expect.any(String),
      name: 'Spice level',
      min_choices: 1,
      max_choices: 1,
      sort_order: 2,
      archived_at: null,
      options: [
        { option_id: expect.any(String), name: 'Normal', price_minor: 0, max_quantity: 1, is_default: true, linked_item_id: null, sort_order: 0 },
        { option_id: expect.any(String), name: 'Extra raita', price_minor: null, max_quantity: 1, is_default: false, linked_item_id: raita, sort_order: 1 },
      ],
      archived_options: [],
      links: [
        { target_kind: 'category', target_id: karahi, mode: 'attach' },
        { target_kind: 'item', target_id: half, mode: 'attach' },
        { target_kind: 'variant_group', target_id: group.variant_group_id, mode: 'detach' },
      ],
      branches: [...f.branches].sort().map((branch_id) => ({ branch_id, options: [], version: expect.any(String) })),
      version: expect.any(String),
    });
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string | null; action: string; before: unknown; after: Record<string, unknown> }>(
      `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'modifier_group'`,
      [f.tenantId],
    );
    expect(audit.rows).toEqual([
      {
        entity: 'modifier_group',
        entity_id: wire.modifier_group_id,
        branch_id: null,
        action: 'create',
        before: null,
        after: expect.objectContaining({ name: 'Spice level', options: wire.options, links: wire.links }),
      },
    ]);
    const stored = await cloud.pool.query(
      `SELECT name, price_minor, linked_item_id, archived_at FROM modifier_options WHERE modifier_group_id = $1 ORDER BY sort_order`,
      [wire.modifier_group_id],
    );
    expect(stored.rows).toEqual([
      { name: 'Normal', price_minor: '0', linked_item_id: null, archived_at: null },
      { name: 'Extra raita', price_minor: null, linked_item_id: raita, archived_at: null },
    ]);

    const replay = await postGroup(body, { 'idempotency-key': key });
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(replay.json()).toEqual(created.json());
    expect(await versions()).toEqual(before.map((v) => v + 1));

    // a group with no links reads no references and no effective set, and inserts no links; a zero-price add-on is valid
    const extras = await postGroup({ name: 'Extras', min_choices: 0, max_choices: 3, options: [{ name: 'Extra napkins', price_minor: 0 }] });
    expect(extras.statusCode, extras.body).toBe(201);
    // key insert, tenant-wide check, option names, group and options inserts (no links insert), audit, 2 bump,
    // key response, prune
    expect(counter.count).toBe(10);
    expect(extras.json().data.modifier_group).toMatchObject({ links: [], options: [{ name: 'Extra napkins', price_minor: 0 }] });
  });

  it('[01c #38] two links for one target → 400 at links.1.target_id; detach on a category → 400', async () => {
    const karahi = menu.categoryIds[0];
    const twice = await refused(
      () =>
        postGroup(
          plainGroup('Spice level', [
            { target_kind: 'category', target_id: karahi, mode: 'attach' },
            { target_kind: 'category', target_id: karahi, mode: 'attach' },
          ]),
        ),
      400,
    );
    expect(twice.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(twice)).toContain('links.1.target_id');
    const detach = await refused(() => postGroup(plainGroup('Spice level', [{ target_kind: 'category', target_id: karahi, mode: 'detach' }])), 400);
    expect(detach.code).toBe('VALIDATION_FAILED');
    // a POST option carries no id; options are 1–50
    const withId = await refused(() => postGroup({ ...plainGroup('Spice level'), options: [{ option_id: 'OP-1', name: 'Mild', price_minor: 0 }] }), 400);
    expect(issuePaths(withId)).toContain('options.0.option_id');
    expect((await refused(() => postGroup({ ...plainGroup('Spice level'), options: [] }), 400)).code).toBe('VALIDATION_FAILED');
  });

  it('[01c #39] linked option to a g item → 422 linked_item_not_piece; unknown item → 422 not_found at options.0.linked_item_id', async () => {
    const mutton = await item({ name: 'Mutton by weight', sale_unit: 'g', requires_weighing: true });
    const fish = await item({ name: 'Fish', sale_unit: 'g' });
    const linked = (itemId: string) => ({ ...plainGroup('Sides'), options: [{ name: 'Side', linked_item_id: itemId }] });
    for (const itemId of [fish, mutton]) {
      const error = await refused(() => postGroup(linked(itemId)), 422);
      expect(error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'options.0.linked_item_id', reason: 'linked_item_not_piece' },
      });
    }
    const unknown = await refused(() => postGroup(linked('IT-UNKNOWN')), 422);
    expect(unknown).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options.0.linked_item_id', reason: 'not_found' } });
    const archivedItem = await archivedItemId();
    const archived = await refused(() => postGroup(linked(archivedItem)), 422);
    expect(archived.details).toMatchObject({ field: 'options.0.linked_item_id', reason: 'archived' });

    // link targets: unknown or another tenant's → not_found, archived → archived, at links.N.target_id
    const otherCategory = 'B-CATEGORY-0000000000000001';
    await cloud.pool.query(`INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, $2, 'B', 0, 0)`, [
      f.other.tenantId,
      otherCategory,
    ]);
    const oldCategory = await category('Old', { archived: true });
    const target = (links: CreateModifierGroupRequest['links']) => () => postGroup(plainGroup('Spice level', links));
    const foreign = await refused(
      target([
        { target_kind: 'category', target_id: menu.categoryIds[0], mode: 'attach' },
        { target_kind: 'category', target_id: otherCategory, mode: 'attach' },
      ]),
      422,
    );
    expect(foreign).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'links.1.target_id', reason: 'not_found' } });
    const old = await refused(target([{ target_kind: 'category', target_id: oldCategory, mode: 'attach' }]), 422);
    expect(old.details).toMatchObject({ field: 'links.0.target_id', reason: 'archived' });
    const noGroup = await refused(target([{ target_kind: 'variant_group', target_id: 'VG-UNKNOWN', mode: 'detach' }]), 422);
    expect(noGroup.details).toMatchObject({ field: 'links.0.target_id', reason: 'not_found' });
    const noItem = await refused(target([{ target_kind: 'item', target_id: menu.categoryIds[0], mode: 'attach' }]), 422);
    expect(noItem.details).toMatchObject({ field: 'links.0.target_id', reason: 'not_found' });
  });

  async function archivedItemId(): Promise<string> {
    const id = await item({ name: 'Old item' });
    expect((await inject('PATCH', `/v1/admin/menu-items/${id}`, { archived: true })).statusCode).toBe(200);
    return id;
  }

  it('[01c #40] min 3 with options summing max_quantity 2 → 422 choices_unsatisfiable; 2 defaults with max 1 → 422 defaults_exceed_max', async () => {
    const unsatisfiable = await refused(
      () =>
        postGroup({
          name: 'Breads',
          min_choices: 3,
          max_choices: 5,
          options: [
            { name: 'Naan', price_minor: 0 },
            { name: 'Roti', price_minor: 0 },
          ],
        }),
      422,
    );
    expect(unsatisfiable).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'min_choices', reason: 'choices_unsatisfiable' } });
    const defaults = await refused(
      () =>
        postGroup({
          name: 'Spice level',
          min_choices: 1,
          max_choices: 1,
          options: [
            { name: 'Normal', price_minor: 0, is_default: true },
            { name: 'Hot', price_minor: 0, is_default: true },
          ],
        }),
      422,
    );
    expect(defaults).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'options', reason: 'defaults_exceed_max' } });
    // max_quantity counts toward min: 2 × max_quantity 2 satisfies min 3
    const satisfied = await postGroup({
      name: 'Breads',
      min_choices: 3,
      max_choices: 5,
      options: [
        { name: 'Naan', price_minor: 0, max_quantity: 2 },
        { name: 'Roti', price_minor: 0, max_quantity: 2 },
      ],
    });
    expect(satisfied.statusCode, satisfied.body).toBe(201);
  });

  it('[01c §6.11] group name taken → 409 modifier_group; two options with one name (any case) → 409 modifier_option', async () => {
    await createModifierGroup(cloud, f, plainGroup('Spice level'));
    const taken = await refused(() => postGroup(plainGroup(' spice LEVEL ')), 409);
    expect(taken).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'modifier_group', name: 'spice LEVEL' } });
    const options = await refused(
      () =>
        postGroup({
          ...plainGroup('Extras'),
          options: [
            { name: 'Raita', price_minor: 100 },
            { name: 'Salad', price_minor: 100 },
            { name: 'RAITA', price_minor: 150 },
          ],
        }),
      409,
    );
    expect(options).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'modifier_option', name: 'RAITA' } });
    // an archived group's name is free again
    await cloud.pool.query(`UPDATE modifier_groups SET archived_at = 1 WHERE tenant_id = $1`, [f.tenantId]);
    expect((await postGroup(plainGroup('Spice level'))).statusCode).toBe(201);
  });

  it('[01c #41] 21st effective group on an item → 422 too_many_groups on the group write, and on an item PATCH into a category carrying it', async () => {
    const plainCategory = await category('Grill');
    const extraCategory = await category('Specials');
    const tikka = await item({ name: 'Tikka', category_id: plainCategory });
    for (let i = 0; i < 20; i += 1) {
      await createModifierGroup(cloud, f, plainGroup(`Group ${i}`, [{ target_kind: 'item', target_id: tikka, mode: 'attach' }]));
    }
    // the 21st on the item, directly or through its category → 422 at links
    for (const link of [
      { target_kind: 'item' as const, target_id: tikka, mode: 'attach' as const },
      { target_kind: 'category' as const, target_id: plainCategory, mode: 'attach' as const },
    ]) {
      const error = await refused(() => postGroup(plainGroup('Group 20', [link])), 422);
      expect(error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'links', reason: 'too_many_groups' } });
    }
    // a detach link adds nothing
    expect((await postGroup(plainGroup('Detached', [{ target_kind: 'item', target_id: tikka, mode: 'detach' }]))).statusCode).toBe(201);
    // a category with no items may carry it
    expect(
      (await postGroup(plainGroup('Group 20', [{ target_kind: 'category', target_id: extraCategory, mode: 'attach' }]))).statusCode,
    ).toBe(201);

    const moved = await refused(() => inject('PATCH', `/v1/admin/menu-items/${tikka}`, { category_id: extraCategory }), 422);
    expect(moved).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'too_many_groups' } });
    // another category without groups is fine
    const fine = await inject('PATCH', `/v1/admin/menu-items/${tikka}`, { category_id: menu.categoryIds[1] });
    expect(fine.statusCode, fine.body).toBe(200);
  });

  it('[01c §6.4, §6.2 R3] item POST into a category with 21 groups → 422; with 20 → 201; a variant group move there → 422', async () => {
    const twenty = await category('Twenty');
    const twentyOne = await category('Twenty one');
    for (let i = 0; i < 21; i += 1) {
      const links: CreateModifierGroupRequest['links'] = [{ target_kind: 'category', target_id: twentyOne, mode: 'attach' }];
      if (i < 20) links.push({ target_kind: 'category', target_id: twenty, mode: 'attach' });
      await createModifierGroup(cloud, f, plainGroup(`Group ${i}`, links));
    }
    const over = await refused(() => inject('POST', '/v1/admin/menu-items', itemBody({ name: 'Over', category_id: twentyOne })), 422);
    expect(over).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'too_many_groups' } });
    await item({ name: 'At the limit', category_id: twenty });

    const group = await createVariantGroup(cloud, f, { name: 'Chicken Karahi', category_id: menu.categoryIds[0] });
    await item({ name: 'Chicken Karahi Half', variant_group_id: group.variant_group_id, variant_name: 'Half' });
    const move = await refused(
      () => inject('PATCH', `/v1/admin/variant-groups/${group.variant_group_id}`, { expected_version: group.version, category_id: twentyOne }),
      422,
    );
    expect(move).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'too_many_groups' } });
    const ok = await inject('PATCH', `/v1/admin/variant-groups/${group.variant_group_id}`, { expected_version: group.version, category_id: twenty });
    expect(ok.statusCode, ok.body).toBe(200);
    // the member now has 20 through its category: a variant group link reaches it → 422 on the group write
    const viaGroup = await refused(
      () => postGroup(plainGroup('Group 21', [{ target_kind: 'variant_group', target_id: group.variant_group_id, mode: 'attach' }])),
      422,
    );
    expect(viaGroup.details).toMatchObject({ field: 'links', reason: 'too_many_groups' });

    // AD-21 c: §6.2 R3 counts active members only; a move that puts only an archived member over the limit → 200
    const mutton = await createVariantGroup(cloud, f, { name: 'Mutton Karahi', category_id: menu.categoryIds[0] });
    const muttonHalf = await item({ name: 'Mutton Karahi Half', variant_group_id: mutton.variant_group_id, variant_name: 'Half' });
    expect((await inject('PATCH', `/v1/admin/menu-items/${muttonHalf}`, { archived: true })).statusCode).toBe(200);
    const archivedMove = await inject('PATCH', `/v1/admin/variant-groups/${mutton.variant_group_id}`, {
      expected_version: mutton.version,
      category_id: twentyOne,
    });
    expect(archivedMove.statusCode, archivedMove.body).toBe(200);
  });

  it('[01c §6.4, §6.5 R3, AD-21 a] a write that sets the variant group answers at variant_group_id: item POST and PATCH → 422', async () => {
    const twenty = await category('Twenty');
    for (let i = 0; i < 20; i += 1) {
      await createModifierGroup(cloud, f, plainGroup(`Group ${i}`, [{ target_kind: 'category', target_id: twenty, mode: 'attach' }]));
    }
    const seekh = await createVariantGroup(cloud, f, { name: 'Seekh', category_id: twenty });
    // no member yet: the variant group may carry a 21st
    await createModifierGroup(cloud, f, plainGroup('On the group', [{ target_kind: 'variant_group', target_id: seekh.variant_group_id, mode: 'attach' }]));
    const posted = await refused(
      () => inject('POST', '/v1/admin/menu-items', itemBody({ name: 'Seekh Half', category_id: twenty, variant_group_id: seekh.variant_group_id, variant_name: 'Half' })),
      422,
    );
    expect(posted).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'variant_group_id', reason: 'too_many_groups' } });
    const loose = await item({ name: 'Seekh loose', category_id: twenty });
    const joined = await refused(
      () => inject('PATCH', `/v1/admin/menu-items/${loose}`, { variant_group_id: seekh.variant_group_id, variant_name: 'Full' }),
      422,
    );
    expect(joined).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'variant_group_id', reason: 'too_many_groups' } });
  });
});
