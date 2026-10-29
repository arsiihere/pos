import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStockItem, createVariantGroup } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('01c items: create and menu read (§6.3, §6.4)', () => {
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
    menu = await seedMenu(cloud.pool, f, { items: 1, archived: true });
  });

  const post = (payload: object) => cloud.app.inject({ method: 'POST', url: '/v1/admin/menu-items', ...owner(f), payload });
  const item = (o: object = {}) => ({
    category_id: menu.categoryIds[0],
    tax_class_id: null,
    name: 'Chicken Karahi Half',
    price_minor: 115000,
    serve_mode: 'sync',
    cook_time_ms: 1_200_000,
    routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    ...o,
  });
  const created = async (payload: object) => {
    const response = await post(payload);
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data.item as { item_id: string } & Record<string, unknown>;
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
      await cloud.pool.query<{ items: string; draws: string; routes: string; audit: string }>(
        `SELECT (SELECT count(*) FROM menu_items) AS items, (SELECT count(*) FROM stock_draws) AS draws,
                (SELECT count(*) FROM item_routes) AS routes, (SELECT count(*) FROM config_audit) AS audit`,
      )
    ).rows[0];
  // The response is the error; nothing is written and no branch is bumped.
  const refused = async (payload: object, status: number) => {
    const before = { counts: await counts(), versions: await versions() };
    const response = await post(payload);
    expect(response.statusCode, response.body).toBe(status);
    expect(await counts()).toEqual(before.counts);
    expect(await versions()).toEqual(before.versions);
    return response.json().error as { code: string; details: Record<string, unknown> };
  };
  const issuePaths = (error: { details: Record<string, unknown> }) =>
    (error.details.issues as Array<{ path: string }>).map((i) => i.path);
  const karahi = () => createVariantGroup(cloud, f, { name: 'Chicken Karahi', category_id: menu.categoryIds[0] });

  it('[01c #22] variant name taken in the group → 409 variant; category ≠ group → 422 category_mismatch; name without group → 400', async () => {
    const group = await karahi();
    const half = await created(item({ variant_group_id: group.variant_group_id, variant_name: 'Half' }));
    expect(half).toMatchObject({ variant_group_id: group.variant_group_id, variant_name: 'Half' });

    const taken = await refused(
      item({ name: 'Chicken Karahi Half 2', variant_group_id: group.variant_group_id, variant_name: ' half ' }),
      409,
    );
    expect(taken).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'variant', name: 'half' } });

    const mismatch = await refused(
      item({ name: 'Breakfast Karahi', category_id: menu.categoryIds[1], variant_group_id: group.variant_group_id, variant_name: 'Full' }),
      422,
    );
    expect(mismatch).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'category_id', reason: 'category_mismatch' } });

    const nameOnly = await refused(item({ name: 'Loose', variant_name: 'Full' }), 400);
    expect(nameOnly.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(nameOnly)).toContain('variant_group_id');
    const groupOnly = await refused(item({ name: 'Loose', variant_group_id: group.variant_group_id }), 400);
    expect(issuePaths(groupOnly)).toContain('variant_name');

    // the same variant name in another group, and a second name in this one, are fine
    const other = await createVariantGroup(cloud, f, { name: 'Mutton Karahi', category_id: menu.categoryIds[0] });
    await created(item({ name: 'Mutton Karahi Half', variant_group_id: other.variant_group_id, variant_name: 'Half' }));
    await created(item({ name: 'Chicken Karahi Full', variant_group_id: group.variant_group_id, variant_name: 'Full' }));
  });

  it('[01c #23] sale_unit g + stock item piece → 422 unit_mismatch; two draws → 400 at stock_draws.1', async () => {
    const naan = (await createStockItem(cloud, f, { name: 'Naan', stock_unit: 'piece' })).stock_item_id;
    const pot = (await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' })).stock_item_id;

    const mismatch = await refused(
      item({ name: 'Naan by weight', sale_unit: 'g', stock_draws: [{ stock_item_id: naan, quantity_per_sale_unit: 1 }] }),
      422,
    );
    expect(mismatch).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' },
    });
    // equal units need a factor of 1
    const factor = await refused(item({ name: 'Pot', sale_unit: 'g', stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 2 }] }), 422);
    expect(factor.details).toMatchObject({ field: 'stock_draws.0.stock_item_id', reason: 'unit_mismatch' });

    const twice = await refused(
      item({
        name: 'Twice',
        stock_draws: [
          { stock_item_id: pot, quantity_per_sale_unit: 500 },
          { stock_item_id: pot, quantity_per_sale_unit: 500 },
        ],
      }),
      400,
    );
    expect(twice.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(twice)).toContain('stock_draws.1.stock_item_id');
    const two = await refused(
      item({
        name: 'Two',
        stock_draws: [
          { stock_item_id: pot, quantity_per_sale_unit: 500 },
          { stock_item_id: naan, quantity_per_sale_unit: 1 },
        ],
      }),
      400,
    );
    expect(issuePaths(two)).toContain('stock_draws');

    // piece from g: any factor; the draw is in the response and inside the audit row's after
    const half = await created(item({ stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 500 }] }));
    expect(half.stock_draws).toEqual([{ stock_item_id: pot, quantity_per_sale_unit: 500 }]);
    const stored = await cloud.pool.query(`SELECT stock_item_id, quantity_per_sale_unit FROM stock_draws WHERE item_id = $1`, [half.item_id]);
    expect(stored.rows).toEqual([{ stock_item_id: pot, quantity_per_sale_unit: 500 }]);
    const audit = await cloud.pool.query(`SELECT after FROM config_audit WHERE entity = 'menu_item' AND entity_id = $1`, [half.item_id]);
    expect(audit.rows).toEqual([{ after: expect.objectContaining({ stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 500 }] }) }]);
  });

  it('[01c §6.4] archived, foreign or unknown variant group or stock item → 422 archived / not_found, nothing written', async () => {
    const group = await karahi();
    expect(
      (await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/variant-groups/${group.variant_group_id}`, ...owner(f), payload: { expected_version: group.version, archived: true } })).statusCode,
    ).toBe(200);
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'CT-F', 'Theirs', 0, 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO variant_groups (tenant_id, variant_group_id, category_id, name, created_at, updated_at)
       VALUES ($1, 'VG-F', 'CT-F', 'Their group', 0, 0)`,
      [f.other.tenantId],
    );
    // tenant B's own stock item, through the API with B's token
    const theirs = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/stock-items',
      ...owner(f, f.other.token),
      payload: { name: 'Their pot', stock_unit: 'g' },
    });
    expect(theirs.statusCode, theirs.body).toBe(201);
    const foreignPot = theirs.json().data.stock_item.stock_item_id as string;
    const archivedPot = (await createStockItem(cloud, f, { name: 'Old pot', stock_unit: 'g' }, { archived: true })).stock_item_id;

    for (const [payload, field, reason] of [
      [item({ variant_group_id: group.variant_group_id, variant_name: 'Half' }), 'variant_group_id', 'archived'],
      [item({ variant_group_id: 'VG-F', variant_name: 'Half' }), 'variant_group_id', 'not_found'],
      [item({ variant_group_id: 'NO-SUCH', variant_name: 'Half' }), 'variant_group_id', 'not_found'],
      [item({ stock_draws: [{ stock_item_id: archivedPot, quantity_per_sale_unit: 500 }] }), 'stock_draws.0.stock_item_id', 'archived'],
      [item({ stock_draws: [{ stock_item_id: foreignPot, quantity_per_sale_unit: 500 }] }), 'stock_draws.0.stock_item_id', 'not_found'],
      [item({ stock_draws: [{ stock_item_id: 'NO-SUCH', quantity_per_sale_unit: 500 }] }), 'stock_draws.0.stock_item_id', 'not_found'],
    ] as const) {
      const error = await refused(payload, 422);
      expect(error, JSON.stringify(payload)).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason } });
    }
  });

  it('[01c §6 C4] an owner whose row misses a branch → 403 tenant_wide_write before the 409 and 422, nothing written', async () => {
    const group = await karahi();
    await created(item({ variant_group_id: group.variant_group_id, variant_name: 'Half' }));
    const old = await createVariantGroup(cloud, f, { name: 'Old Pulao', category_id: menu.categoryIds[0] });
    const archive = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/variant-groups/${old.variant_group_id}`,
      ...owner(f),
      payload: { expected_version: old.version, archived: true },
    });
    expect(archive.statusCode).toBe(200);
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      f.tenantId,
      f.userId,
      [f.branches[0]],
    ]);
    const keys = async () => Number((await cloud.pool.query(`SELECT count(*) AS n FROM idempotency_keys`)).rows[0].n);
    for (const payload of [
      item({ name: 'Taken', variant_group_id: group.variant_group_id, variant_name: 'half' }), // else 409 variant
      item({ name: 'Archived group', variant_group_id: old.variant_group_id, variant_name: 'Half' }), // else 422 archived
    ]) {
      const before = await keys();
      const error = await refused(payload, 403);
      expect(error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
      expect(await keys()).toBe(before);
    }
  });

  it('[01c §6.4] statements: a group and a draw add 3 (group and stock item FOR SHARE, the draw insert)', async () => {
    const group = await karahi();
    const pot = (await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' })).stock_item_id;
    await created(item({ name: 'Plain' }));
    const plain = counter.count;
    await created(item({ variant_group_id: group.variant_group_id, variant_name: 'Half', stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 500 }] }));
    expect(counter.count).toBe(plain + 3);
  });

  it('[01c §6.4 V18] requires_weighing with sale_unit piece → 400; with a draw → 422 weighed_item_stock_draw; g alone → 201', async () => {
    const pot = (await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' })).stock_item_id;
    const piece = await refused(item({ name: 'Fish', requires_weighing: true }), 400);
    expect(piece.code).toBe('VALIDATION_FAILED');
    expect(issuePaths(piece)).toContain('requires_weighing');

    const drawn = await refused(
      item({ name: 'Fish', sale_unit: 'g', requires_weighing: true, stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 1 }] }),
      422,
    );
    expect(drawn).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_draws', reason: 'weighed_item_stock_draw' } });

    const fish = await created(item({ name: 'Fish', sale_unit: 'g', requires_weighing: true }));
    expect(fish).toMatchObject({ sale_unit: 'g', requires_weighing: true, stock_draws: [] });
  });

  it('[01c §5.1 P-11] the deprecated columns are stored as stock_unit = sale_unit, 1, null, false, null; never on the wire', async () => {
    const body = item({
      name: 'Mutton by weight',
      sale_unit: 'g',
      group_label: 'Mutton',
      stock_unit: 'piece',
      stock_per_sale_unit: 250,
      low_stock_threshold: 1000,
      carries_over: true,
    });
    const mutton = await created(body);
    for (const key of ['group_label', 'stock_unit', 'stock_per_sale_unit', 'low_stock_threshold', 'carries_over']) {
      expect(mutton).not.toHaveProperty(key);
    }
    const stored = await cloud.pool.query(
      `SELECT stock_unit, stock_per_sale_unit, low_stock_threshold, carries_over, group_label FROM menu_items WHERE item_id = $1`,
      [mutton.item_id],
    );
    expect(stored.rows).toEqual([
      { stock_unit: 'g', stock_per_sale_unit: 1, low_stock_threshold: null, carries_over: false, group_label: null },
    ]);
  });

  it('[01c #26] menu read: variant_groups whole; q=Karahi matches a member through its group name; 8 statements', async () => {
    const group = await karahi();
    const archivedGroup = await createVariantGroup(cloud, f, { name: 'Old Pulao', category_id: menu.categoryIds[0] });
    const pot = (await createStockItem(cloud, f, { name: 'Karahi pot', stock_unit: 'g' })).stock_item_id;
    const half = await created(
      item({ name: 'Half plate', variant_group_id: group.variant_group_id, variant_name: 'Half', stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 500 }] }),
    );
    const full = await created(item({ name: 'Full plate', variant_group_id: group.variant_group_id, variant_name: 'Full' }));
    const gone = await created(item({ name: 'Quarter plate', variant_group_id: group.variant_group_id, variant_name: 'Quarter' }));
    const archive = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${gone.item_id}`, ...owner(f), payload: { archived: true } });
    expect(archive.statusCode).toBe(200);
    const pulao = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/variant-groups/${archivedGroup.variant_group_id}`,
      ...owner(f),
      payload: { expected_version: archivedGroup.version, archived: true },
    });
    expect(pulao.statusCode).toBe(200);
    await created(item({ name: 'Plain rice' }));

    const response = await cloud.app.inject({ method: 'GET', url: '/v1/admin/menu?q=Karahi', headers: owner(f).headers });
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(8);
    const data = response.json().data;
    // the seeded 'Chicken Karahi — Half' matches by its own name; Half and Full plate through their group
    expect(data.items.map((i: { name: string }) => i.name)).toEqual(['Chicken Karahi — Half', 'Full plate', 'Half plate']);
    expect(data.items.find((i: { item_id: string }) => i.item_id === half.item_id)).toMatchObject({
      variant_group_id: group.variant_group_id,
      variant_name: 'Half',
      stock_draws: [{ stock_item_id: pot, quantity_per_sale_unit: 500 }],
      requires_weighing: false,
    });
    expect(data.items.find((i: { item_id: string }) => i.item_id === full.item_id).stock_draws).toEqual([]);
    expect(data.variant_groups).toEqual([
      {
        ...group,
        member_ids: [half.item_id, full.item_id, gone.item_id].sort(),
      },
      pulao.json().data.variant_group,
    ].sort((a, b) => a.sort_order - b.sort_order || (a.variant_group_id < b.variant_group_id ? -1 : 1)));

    // the group's name is matched case-insensitively and only for its members
    const lower = await cloud.app.inject({ method: 'GET', url: '/v1/admin/menu?q=pulao', headers: owner(f).headers });
    expect(lower.json().data.items).toEqual([]);
    const archived = await cloud.app.inject({ method: 'GET', url: '/v1/admin/menu?q=karahi&status=archived', headers: owner(f).headers });
    expect(archived.json().data.items.map((i: { item_id: string }) => i.item_id)).toEqual([gone.item_id]);
    expect(counter.count).toBe(8);
  });
});
