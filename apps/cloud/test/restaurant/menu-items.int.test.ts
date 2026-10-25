import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('menu item create', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1, archived: true });
    // A second batch station at A with its own program, and a slot station at C.
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, name, station_type, capacity, freshness_window_ms, created_at, updated_at)
       VALUES ($1, $2, 'ST-3', 'Grill', 'batch', 2, 0, 0, 0), ($1, $3, 'ST-C', 'Karahi', 'slot', 2, NULL, 0, 0)`,
      [f.tenantId, f.branches[0], f.branches[2]],
    );
    await cloud.pool.query(
      `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, created_at, updated_at)
       VALUES ($1, $2, 'ST-3', 'PG-3', 'Grill 10 min', 600000, 0, 0)`,
      [f.tenantId, f.branches[0]],
    );
  });

  const post = (payload: object, token?: string) =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/menu-items', ...owner(f, token), payload });
  const item = (o: object = {}) => ({
    category_id: menu.categoryIds[0],
    tax_class_id: menu.taxClassId,
    name: 'Chicken Karahi — Full',
    price_minor: 240000,
    serve_mode: 'sync',
    cook_time_ms: 1_200_000,
    routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId }],
    ...o,
  });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const counts = async () =>
    (
      await cloud.pool.query<{ items: string; routes: string; audit: string; keys: string }>(
        `SELECT (SELECT count(*) FROM menu_items) AS items, (SELECT count(*) FROM item_routes) AS routes,
                (SELECT count(*) FROM config_audit) AS audit, (SELECT count(*) FROM idempotency_keys) AS keys`,
      )
    ).rows[0];
  const snapshotItems = async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    // only the items these tests create (seedMenu's IT-0000 is routed to branch A too)
    return (response.json().data.config.snapshot.items as Array<Record<string, unknown>>).filter(
      (i) => !menu.itemIds.includes(i.item_id as string),
    );
  };
  const expectReference = async (payload: object, field: string, reason: string) => {
    const before = { counts: await counts(), versions: await versions() };
    const response = await post(payload);
    expect(response.statusCode, JSON.stringify(payload)).toBe(422);
    expect(response.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field, reason } });
    expect(await counts()).toEqual(before.counts);
    expect(await versions()).toEqual(before.versions);
  };

  it('[01a §10 #33] item with a slot route and stock_time_ms → created; price_minor stored as integer paisa; float price → 400', async () => {
    const before = await versions();
    const created = await post(item({ stock_time_ms: 300_000, price_minor: 123_456 }));
    expect(created.statusCode).toBe(201);
    const data = created.json().data.item;
    expect(data).toEqual({
      item_id: expect.any(String),
      category_id: menu.categoryIds[0],
      tax_class_id: menu.taxClassId,
      name: 'Chicken Karahi — Full',
      group_label: null,
      description: null,
      sort_order: 0,
      price_minor: 123_456,
      serve_mode: 'sync',
      prep_buffer_ms: 0,
      cook_time_ms: 1_200_000,
      stock_time_ms: 300_000,
      out_of_stock_behaviour: 'cook_fresh',
      stock_unit: 'piece',
      sale_unit: 'piece',
      stock_per_sale_unit: 1,
      low_stock_threshold: null,
      carries_over: false,
      availability_windows: [],
      archived_at: null,
      routes: [{ branch_id: f.branches[0], station_id: menu.slotStationId, program_id: null, stock_program_id: null }],
    });
    const stored = await cloud.pool.query(
      `SELECT price_minor::text AS text, pg_typeof(price_minor)::text AS type FROM menu_items WHERE item_id = $1`,
      [data.item_id],
    );
    expect(stored.rows[0]).toEqual({ text: '123456', type: 'bigint' });
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const audit = await cloud.pool.query(
      `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit ORDER BY entity, branch_id`,
    );
    const { routes, ...itemOnly } = data;
    expect(audit.rows).toEqual([
      { entity: 'item_route', entity_id: data.item_id, branch_id: f.branches[0], action: 'route_set', before: null, after: routes[0] },
      { entity: 'menu_item', entity_id: data.item_id, branch_id: null, action: 'create', before: null, after: itemOnly },
    ]);
    expect((await snapshotItems()).map((i) => i.item_id)).toEqual([data.item_id]);

    const float = await post(item({ name: 'Float', price_minor: 1234.5 }));
    expect(float.statusCode).toBe(400);
    expect(float.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('[01a §10 #34] batch route without program_id → 422 program_required; program of another station → program_wrong_station; station of another branch → wrong_branch', async () => {
    const a = f.branches[0];
    await expectReference(item({ routes: [{ branch_id: a, station_id: menu.batchStationId }] }), 'routes.0.program_id', 'program_required');
    await expectReference(
      item({ routes: [{ branch_id: a, station_id: menu.batchStationId, program_id: 'PG-3' }] }),
      'routes.0.program_id',
      'program_wrong_station',
    );
    await expectReference(
      item({ routes: [{ branch_id: a, station_id: menu.batchStationId, program_id: menu.programIds[0], stock_program_id: 'PG-3' }] }),
      'routes.0.stock_program_id',
      'program_wrong_station',
    );
    await expectReference(item({ routes: [{ branch_id: a, station_id: 'ST-B' }] }), 'routes.0.station_id', 'wrong_branch');
    // the rest of §3.3's route and reference rules
    await expectReference(
      item({ routes: [{ branch_id: a, station_id: menu.slotStationId, program_id: menu.programIds[0] }] }),
      'routes.0.program_id',
      'program_not_allowed',
    );
    await expectReference(item({ routes: [{ branch_id: a, station_id: menu.archived!.stationId }] }), 'routes.0.station_id', 'archived');
    await expectReference(item({ routes: [{ branch_id: a, station_id: 'NO-SUCH' }] }), 'routes.0.station_id', 'not_found');
    await expectReference(
      item({ routes: [{ branch_id: a, station_id: menu.batchStationId, program_id: menu.archived!.programId }] }),
      'routes.0.program_id',
      'archived',
    );
    await expectReference(item({ category_id: menu.archived!.categoryId }), 'category_id', 'archived');
    await expectReference(item({ category_id: 'NO-SUCH' }), 'category_id', 'not_found');
    await expectReference(item({ tax_class_id: menu.archived!.taxClassId }), 'tax_class_id', 'archived');

    const batch = await post(
      item({
        routes: [
          { branch_id: a, station_id: menu.batchStationId, program_id: menu.programIds[0], stock_program_id: menu.programIds[1] },
          { branch_id: f.branches[1], station_id: 'ST-B' },
        ],
      }),
    );
    expect(batch.statusCode).toBe(201);
    expect(batch.json().data.item.routes).toEqual([
      { branch_id: a, station_id: menu.batchStationId, program_id: menu.programIds[0], stock_program_id: menu.programIds[1] },
      { branch_id: f.branches[1], station_id: 'ST-B', program_id: null, stock_program_id: null },
    ]);
  });

  it('[01a §10 #35] stock_time_ms > cook_time_ms → 422 stock_time_exceeds_cook_time; stock_time_ms = 0 → OK', async () => {
    await expectReference(item({ cook_time_ms: 200_000, stock_time_ms: 200_001 }), 'stock_time_ms', 'stock_time_exceeds_cook_time');
    const zero = await post(item({ stock_time_ms: 0 }));
    expect(zero.statusCode).toBe(201);
    expect(zero.json().data.item.stock_time_ms).toBe(0);
  });

  it('[01a §10 #36] route for a branch outside allowed_branch_ids → 404 BRANCH_NOT_FOUND; nothing written', async () => {
    const before = { counts: await counts(), versions: await versions() };
    const response = await post(
      item({
        routes: [
          { branch_id: f.branches[0], station_id: menu.slotStationId },
          { branch_id: f.branches[2], station_id: 'ST-C' },
        ],
      }),
      f.tokenFor([f.branches[0], f.branches[1]]),
    );
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: f.branches[2] } });
    expect(await counts()).toEqual(before.counts);
    expect(await versions()).toEqual(before.versions);
  });

  it('[01a §10 #37] query count fixed for 1 and 3 routes', async () => {
    const [a, b, c] = f.branches;
    counter.reset();
    expect((await post(item({ name: 'One route' }))).statusCode).toBe(201);
    const one = counter.count;
    counter.reset();
    const three = await post(
      item({
        name: 'Three routes',
        routes: [
          { branch_id: a, station_id: menu.slotStationId },
          { branch_id: b, station_id: 'ST-B' },
          { branch_id: c, station_id: 'ST-C' },
        ],
      }),
    );
    expect(three.statusCode).toBe(201);
    expect(three.json().data.item.routes).toHaveLength(3);
    expect(counter.count).toBe(one);
    const audit = await cloud.pool.query(`SELECT count(*)::int AS n FROM config_audit WHERE entity = 'item_route'`);
    expect(audit.rows[0].n).toBe(4);
  });

  it('[01a §10 #41] two items sharing group_label "Chicken Karahi" with different prices and stock times → both in the snapshot', async () => {
    const half = await post(item({ name: 'Karahi Half', group_label: 'Chicken Karahi', price_minor: 120000, stock_time_ms: 300_000 }));
    const full = await post(item({ name: 'Karahi Full', group_label: 'Chicken Karahi', price_minor: 240000, stock_time_ms: 600_000 }));
    expect(half.statusCode).toBe(201);
    expect(full.statusCode).toBe(201);
    const items = await snapshotItems();
    expect(items.map(({ item_id, group_label, price_minor, stock_time_ms }) => ({ item_id, group_label, price_minor, stock_time_ms })))
      .toEqual(
        [
          { item_id: half.json().data.item.item_id, group_label: 'Chicken Karahi', price_minor: 120000, stock_time_ms: 300_000 },
          { item_id: full.json().data.item.item_id, group_label: 'Chicken Karahi', price_minor: 240000, stock_time_ms: 600_000 },
        ].sort((x, y) => (x.item_id < y.item_id ? -1 : 1)),
      );
  });

  it('[01a §10 #88] zero-price item (price_minor: 0) → 201; in the snapshot with price_minor: 0', async () => {
    const created = await post(item({ name: 'Free water', price_minor: 0 }));
    expect(created.statusCode).toBe(201);
    expect(created.json().data.item.price_minor).toBe(0);
    const items = await snapshotItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ item_id: created.json().data.item.item_id, price_minor: 0 });
  });

  it('[01a §6.14] a body without the tax_class_id key → 400', async () => {
    const body: Record<string, unknown> = item();
    delete body.tax_class_id;
    const response = await post(body);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details.issues.map((i: { path: string }) => i.path)).toContain('tax_class_id');

    const untaxed = await post(item({ tax_class_id: null }));
    expect(untaxed.statusCode).toBe(201);
    expect(untaxed.json().data.item.tax_class_id).toBeNull();
  });

  it('[01a S44] g / piece / 250 → 201 and the three fields in the response', async () => {
    const created = await post(item({ stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250, low_stock_threshold: 1000, carries_over: true }));
    expect(created.statusCode).toBe(201);
    expect(created.json().data.item).toMatchObject({
      stock_unit: 'g',
      sale_unit: 'piece',
      stock_per_sale_unit: 250,
      low_stock_threshold: 1000,
      carries_over: true,
    });

    for (const [units, path] of [
      [{ stock_unit: 'g', sale_unit: 'g', stock_per_sale_unit: 250 }, 'stock_per_sale_unit'],
      [{ stock_unit: 'piece', sale_unit: 'g' }, 'sale_unit'],
      [{ stock_unit: 'g', sale_unit: 'ml', stock_per_sale_unit: 2 }, 'sale_unit'],
    ] as const) {
      const before = await counts();
      const bad = await post(item({ name: 'Bad units', ...units }));
      expect(bad.statusCode, JSON.stringify(units)).toBe(400);
      expect(bad.json().error).toMatchObject({ code: 'VALIDATION_FAILED', details: { issues: [{ path }] } });
      expect(await counts()).toEqual(before);
    }
  });
});
