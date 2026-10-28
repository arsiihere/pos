import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('no-op config writes (v1.0.2)', () => {
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
    menu = await seedMenu(cloud.pool, f, { items: 2 });
  });

  const send = (method: 'PATCH' | 'PUT', url: string, payload: object) =>
    cloud.app.inject({ method, url, ...owner(f), payload });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const auditRows = async () =>
    Number((await cloud.pool.query<{ n: string }>(`SELECT count(*) AS n FROM config_audit WHERE tenant_id = $1`, [f.tenantId])).rows[0]!.n);

  it('[01a §10 #155] a no-op PATCH or route PUT writes no audit row and bumps nothing; a real change still does', async () => {
    const [a, b] = f.branches;
    const floor = (
      await cloud.pool.query<{ name: string; sort_order: number }>(`SELECT name, sort_order FROM floors WHERE floor_id = $1`, [
        menu.floorId,
      ])
    ).rows[0]!;
    const itemId = menu.itemIds[0]!;
    const item = (
      await cloud.pool.query<{ name: string; price_minor: string }>(`SELECT name, price_minor FROM menu_items WHERE item_id = $1`, [itemId])
    ).rows[0]!;
    const windows = (
      await cloud.pool.query<{ start_ms: string; end_ms: string }>(
        `SELECT start_ms, end_ms FROM availability_windows WHERE item_id = $1 ORDER BY start_ms, end_ms`,
        [itemId],
      )
    ).rows.map((w) => ({ start_ms: Number(w.start_ms), end_ms: Number(w.end_ms) }));
    const route = (
      await cloud.pool.query(
        `SELECT station_id, program_id, stock_program_id FROM item_routes WHERE item_id = $1 AND branch_id = $2`,
        [itemId, a],
      )
    ).rows[0] as { station_id: string; program_id: string | null; stock_program_id: string | null };
    const v0 = await versions();
    const n0 = await auditRows();

    const floorNoop = await send('PATCH', `/v1/admin/branches/${a}/floors/${menu.floorId}`, {
      name: floor.name,
      sort_order: floor.sort_order,
      archived: false,
    });
    expect(floorNoop.statusCode, floorNoop.body).toBe(200);
    expect(floorNoop.json().data.floor).toMatchObject({ floor_id: menu.floorId, name: floor.name, archived_at: null });

    const itemNoop = await send('PATCH', `/v1/admin/menu-items/${itemId}`, {
      name: item.name,
      price_minor: Number(item.price_minor),
      availability_windows: [...windows].reverse(),
    });
    expect(itemNoop.statusCode, itemNoop.body).toBe(200);
    expect(itemNoop.json().data.item).toMatchObject({ item_id: itemId, name: item.name, availability_windows: windows });

    const routeNoop = await send('PUT', `/v1/admin/menu-items/${itemId}/routes/${a}`, route);
    expect(routeNoop.statusCode, routeNoop.body).toBe(200);
    expect(routeNoop.json().data).toEqual({ route: { branch_id: a, price_minor_override: null, ...route } });

    const removeNothing = await send('PUT', `/v1/admin/menu-items/${itemId}/routes/${b}`, { station_id: null });
    expect(removeNothing.statusCode, removeNothing.body).toBe(200);
    expect(removeNothing.json().data).toEqual({ route: null });

    expect(await auditRows()).toBe(n0);
    expect(await versions()).toEqual(v0);

    // One real change: one audit row, one bump.
    const renamed = await send('PATCH', `/v1/admin/branches/${a}/floors/${menu.floorId}`, { name: `${floor.name} 2` });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(await auditRows()).toBe(n0 + 1);
    expect(await versions()).toEqual([v0[0]! + 1, v0[1], v0[2]]);
  });
});
