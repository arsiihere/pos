import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildSnapshot, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// Only the fields read below; not .strict(), so the snapshot's other keys are dropped.
const SnapshotItems = z.object({ items: z.array(z.object({ item_id: z.string(), price_minor: z.number() })) });

const HEADER: SnapshotHeader = {
  config_version: 42,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

describe('per-branch price (S57)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let menu: SeededMenu;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 1 });
  });

  const put = (itemId: string, branchId: string, payload: object) =>
    cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/menu-items/${itemId}/routes/${branchId}`,
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const storedOverride = async (itemId: string, branchId: string) =>
    (
      await cloud.pool.query<{ price_minor_override: string | null }>(
        `SELECT price_minor_override FROM item_routes WHERE item_id = $1 AND branch_id = $2`,
        [itemId, branchId],
      )
    ).rows.map((row) => (row.price_minor_override === null ? null : Number(row.price_minor_override)));
  const audit = async (itemId: string) =>
    (
      await cloud.pool.query<{ branch_id: string; action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>(
        `SELECT branch_id, action, before, after FROM config_audit
          WHERE entity = 'item_route' AND entity_id = $1 ORDER BY at, audit_id`,
        [itemId],
      )
    ).rows;
  const snapshotPrice = async (branchId: string, itemId: string) => {
    const client = await cloud.pool.connect();
    try {
      const tenant = Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
      const snapshot = await buildSnapshot(client, tenant, branchId, HEADER);
      return SnapshotItems.parse(snapshot).items.find((item) => item.item_id === itemId)?.price_minor;
    } finally {
      client.release();
    }
  };

  it('[01a §10 #173] route PUT stores price_minor_override, audits it, bumps only that branch; a repeat writes nothing; bad values → 400', async () => {
    const [a] = f.branches;
    const itemId = menu.itemIds[0]!;
    const v0 = await versions();

    const set = await put(itemId, a, { station_id: menu.slotStationId, price_minor_override: 230000 });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().data.route).toEqual({
      branch_id: a,
      station_id: menu.slotStationId,
      program_id: null,
      stock_program_id: null,
      price_minor_override: 230000,
    });
    expect(await storedOverride(itemId, a)).toEqual([230000]);
    const v1 = await versions();
    expect(v1).toEqual([v0[0]! + 1, v0[1], v0[2]]);
    const rows = await audit(itemId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      branch_id: a,
      action: 'route_set',
      before: { price_minor_override: null },
      after: { price_minor_override: 230000 },
    });

    const again = await put(itemId, a, { station_id: menu.slotStationId, price_minor_override: 230000 });
    expect(again.statusCode).toBe(200);
    expect(await audit(itemId)).toHaveLength(1);
    expect(await versions()).toEqual(v1);

    const cleared = await put(itemId, a, { station_id: menu.slotStationId, price_minor_override: null });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().data.route.price_minor_override).toBeNull();
    expect(await storedOverride(itemId, a)).toEqual([null]);
    expect(await audit(itemId)).toHaveLength(2);

    const before = await versions();
    for (const payload of [
      { station_id: menu.slotStationId, price_minor_override: -1 },
      { station_id: menu.slotStationId, price_minor_override: 1_000_000_001 },
      { station_id: menu.slotStationId, price_minor_override: 1.5 },
      { station_id: null, price_minor_override: 100 },
    ]) {
      const response = await put(itemId, a, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    expect(await storedOverride(itemId, a)).toEqual([null]);
    expect(await versions()).toEqual(before);
  });

  it('[01a §10 #174] POST menu item with a route override; the menu read returns the overrides', async () => {
    const [a, b] = f.branches;
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/menu-items',
      ...owner(f),
      payload: {
        category_id: menu.categoryIds[0],
        tax_class_id: null,
        name: 'Mutton Karahi',
        price_minor: 220000,
        serve_mode: 'sync',
        cook_time_ms: 1_200_000,
        routes: [
          { branch_id: a, station_id: menu.slotStationId, price_minor_override: 230000 },
          { branch_id: b, station_id: 'ST-B' },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const item = created.json().data.item as { item_id: string; routes: Array<{ branch_id: string; price_minor_override: number | null }> };
    const overrides = (routes: typeof item.routes) =>
      Object.fromEntries(routes.map((route) => [route.branch_id, route.price_minor_override]));
    expect(overrides(item.routes)).toEqual({ [a]: 230000, [b]: null });

    const read = await cloud.app.inject({
      method: 'GET',
      url: `/v1/admin/menu?q=${encodeURIComponent('Mutton')}`,
      headers: { authorization: `Bearer ${f.token}` },
    });
    expect(read.statusCode, read.body).toBe(200);
    const listed = (read.json().data.items as Array<typeof item>).find((row) => row.item_id === item.item_id)!;
    expect(overrides(listed.routes)).toEqual({ [a]: 230000, [b]: null });
  });

  it('[01a §10 #175] the snapshot carries the effective price: the override at its branch, the main price elsewhere', async () => {
    const [a, b] = f.branches;
    const itemId = menu.itemIds[0]!;
    expect((await put(itemId, b, { station_id: 'ST-B' })).statusCode).toBe(200);
    expect((await put(itemId, a, { station_id: menu.slotStationId, price_minor_override: 130000 })).statusCode).toBe(200);
    expect(await snapshotPrice(a, itemId)).toBe(130000);
    expect(await snapshotPrice(b, itemId)).toBe(120000);

    const patched = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/menu-items/${itemId}`,
      ...owner(f),
      payload: { price_minor: 140000 },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(await snapshotPrice(a, itemId)).toBe(130000);
    expect(await snapshotPrice(b, itemId)).toBe(140000);

    expect((await put(itemId, a, { station_id: menu.slotStationId, price_minor_override: null })).statusCode).toBe(200);
    expect(await snapshotPrice(a, itemId)).toBe(140000);
  });
});
