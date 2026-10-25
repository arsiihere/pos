import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../src/modules/config-sync/builder';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const HEADER = { config_version: 1, currency_code: 'PKR', tax_enabled: true, day_stale_after_hours: 16, day_min_gap_hours: 4 };

describe('tax classes and categories', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const post = (url: string, payload: object) => cloud.app.inject({ method: 'POST', url, ...owner(f), payload });
  const patch = (url: string, payload: object) => cloud.app.inject({ method: 'PATCH', url, ...owner(f), payload });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const auditRows = async (entity: string) =>
    (await cloud.pool.query<{ entity_id: string; branch_id: string | null; action: string; before: unknown; after: unknown }>(
      `SELECT entity_id, branch_id, action, before, after FROM config_audit WHERE entity = $1 ORDER BY at, audit_id`,
      [entity],
    )).rows;
  const snapshots = async () => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      const out = [];
      for (const branchId of f.branches) out.push(await buildSnapshot(client, tenant, branchId, HEADER));
      return out as Array<{ tax_classes: unknown[]; categories: unknown[] }>;
    } finally {
      client.release();
    }
  };
  const addItem = (itemId: string, o: { categoryId: string; taxClassId?: string; archived?: boolean }) =>
    cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, tax_class_id, name, price_minor, serve_mode, cook_time_ms,
                               archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $2, 100, 'immediate', 60000, $5, 0, 0)`,
      [f.tenantId, itemId, o.categoryId, o.taxClassId ?? null, o.archived === true ? 1 : null],
    );

  it('[01a §10 #31] tax class rate_bp 10 001 → 400; archive one in use → 409; unknown → 404', async () => {
    for (const rate_bp of [10_001, -1, 1.5]) {
      const bad = await post('/v1/admin/tax-classes', { name: 'GST', rate_bp });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    }
    const gst = (await post('/v1/admin/tax-classes', { name: 'GST', rate_bp: 1600 })).json().data.tax_class;
    expect((await patch(`/v1/admin/tax-classes/${gst.tax_class_id}`, { rate_bp: 10_001 })).statusCode).toBe(400);

    const category = (await post('/v1/admin/categories', { name: 'Mains' })).json().data.category;
    await addItem('ITEM-B', { categoryId: category.category_id, taxClassId: gst.tax_class_id });
    await addItem('ITEM-A', { categoryId: category.category_id, taxClassId: gst.tax_class_id });
    await addItem('ITEM-OLD', { categoryId: category.category_id, taxClassId: gst.tax_class_id, archived: true });
    const before = await versions();
    const inUse = await patch(`/v1/admin/tax-classes/${gst.tax_class_id}`, { archived: true });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'tax_class', id: gst.tax_class_id, used_by: { entity: 'menu_item', ids: ['ITEM-A', 'ITEM-B'] } },
    });
    expect(await versions()).toEqual(before);

    const unknown = await patch('/v1/admin/tax-classes/NO-SUCH-CLASS', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'TAX_CLASS_NOT_FOUND', details: { tax_class_id: 'NO-SUCH-CLASS' } });
  });

  it('[01a §10 #32] archive a category with active items → 409; unknown → 404 CATEGORY_NOT_FOUND', async () => {
    const mains = (await post('/v1/admin/categories', { name: 'Mains' })).json().data.category;
    await addItem('ITEM-A', { categoryId: mains.category_id });
    await addItem('ITEM-OLD', { categoryId: mains.category_id, archived: true });
    const inUse = await patch(`/v1/admin/categories/${mains.category_id}`, { archived: true });
    expect(inUse.statusCode).toBe(409);
    expect(inUse.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'category', id: mains.category_id, used_by: { entity: 'menu_item', ids: ['ITEM-A'] } },
    });

    await cloud.pool.query(`UPDATE menu_items SET archived_at = 1 WHERE item_id = 'ITEM-A'`);
    const archived = await patch(`/v1/admin/categories/${mains.category_id}`, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.category.archived_at).toBe(cloud.clock.branchNow());
    expect((await auditRows('category')).at(-1)).toMatchObject({ entity_id: mains.category_id, action: 'archive', branch_id: null });

    const unknown = await patch('/v1/admin/categories/NO-SUCH-CATEGORY', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'CATEGORY_NOT_FOUND', details: { category_id: 'NO-SUCH-CATEGORY' } });
  });

  it('[01a §10 #120] POST tax class → every branch bumped, in every snapshot; PATCH rate_bp audited; POST category in every snapshot', async () => {
    const before = await versions();
    const created = await post('/v1/admin/tax-classes', { name: ' GST ', rate_bp: 1600 });
    expect(created.statusCode).toBe(201);
    const gst = created.json().data.tax_class;
    expect(gst).toEqual({ tax_class_id: expect.any(String), name: 'GST', rate_bp: 1600, archived_at: null });
    expect(await versions()).toEqual(before.map((v) => v + 1));
    expect(await auditRows('tax_class')).toEqual([
      { entity_id: gst.tax_class_id, branch_id: null, action: 'create', before: null, after: gst },
    ]);
    for (const snapshot of await snapshots()) {
      expect(snapshot.tax_classes).toEqual([{ tax_class_id: gst.tax_class_id, name: 'GST', rate_bp: 1600, is_archived: false }]);
    }

    const patched = await patch(`/v1/admin/tax-classes/${gst.tax_class_id}`, { rate_bp: 1800 });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.tax_class).toEqual({ ...gst, rate_bp: 1800 });
    expect((await auditRows('tax_class')).at(-1)).toEqual({
      entity_id: gst.tax_class_id,
      branch_id: null,
      action: 'update',
      before: gst,
      after: { ...gst, rate_bp: 1800 },
    });
    expect(await versions()).toEqual(before.map((v) => v + 2));

    const category = await post('/v1/admin/categories', { name: 'Breakfast', sort_order: 3, availability_windows: [] });
    expect(category.statusCode).toBe(201);
    const breakfast = category.json().data.category;
    expect(breakfast).toEqual({
      category_id: expect.any(String),
      name: 'Breakfast',
      sort_order: 3,
      archived_at: null,
      availability_windows: [],
    });
    for (const snapshot of await snapshots()) {
      expect(snapshot.categories).toEqual([
        { category_id: breakfast.category_id, name: 'Breakfast', sort_order: 3, availability_windows: [] },
      ]);
    }

    // names unique per tenant, case-insensitive; empty PATCH → 400
    expect((await post('/v1/admin/tax-classes', { name: 'gst', rate_bp: 0 })).statusCode).toBe(409);
    expect((await post('/v1/admin/categories', { name: 'BREAKFAST' })).json().error).toMatchObject({
      code: 'CONFIG_NAME_TAKEN',
      details: { entity: 'category', name: 'BREAKFAST' },
    });
    expect((await patch(`/v1/admin/categories/${breakfast.category_id}`, {})).statusCode).toBe(400);
  });

  it('[01a S8] a category create bumps all three branches', async () => {
    const before = await versions();
    expect(before).toHaveLength(3);
    expect((await post('/v1/admin/categories', { name: 'Mains' })).statusCode).toBe(201);
    expect(await versions()).toEqual(before.map((v) => v + 1));
    const renamed = await patch(
      `/v1/admin/categories/${(await cloud.pool.query<{ category_id: string }>(`SELECT category_id FROM categories`)).rows[0]!.category_id}`,
      { name: 'Curries' },
    );
    expect(renamed.statusCode).toBe(200);
    expect(await versions()).toEqual(before.map((v) => v + 2));
  });
});
