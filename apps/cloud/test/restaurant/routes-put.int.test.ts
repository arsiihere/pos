import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('item route put', () => {
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
    menu = await seedMenu(cloud.pool, f, { items: 1, archived: true });
  });

  const put = (itemId: string, branchId: string, payload: object, token?: string) =>
    cloud.app.inject({
      method: 'PUT',
      url: `/v1/admin/menu-items/${itemId}/routes/${branchId}`,
      headers: { authorization: `Bearer ${token ?? f.token}` },
      payload,
    });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(
        `SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
        [f.tenantId],
      )
    ).rows.map((row) => Number(row.config_version));
  const storedRoutes = async (itemId: string) =>
    (
      await cloud.pool.query(
        `SELECT branch_id, station_id, program_id, stock_program_id FROM item_routes WHERE item_id = $1 ORDER BY branch_id`,
        [itemId],
      )
    ).rows;
  const audit = async (entity: string, entityId: string) =>
    (
      await cloud.pool.query<{
        actor_owner_user_id: string | null;
        branch_id: string | null;
        action: string;
        before: Record<string, unknown> | null;
        after: Record<string, unknown> | null;
      }>(
        `SELECT actor_owner_user_id, branch_id, action, before, after FROM config_audit
          WHERE entity = $1 AND entity_id = $2 ORDER BY at, audit_id`,
        [entity, entityId],
      )
    ).rows;
  const snapshotItemIds = async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    return (response.json().data.config.snapshot.items as Array<{ item_id: string }>).map((i) => i.item_id);
  };

  it('[01a §10 #39] PUT route twice → same state, the second changes nothing and bumps nothing; { station_id: null } removes it; item absent from that branch snapshot', async () => {
    const [a] = f.branches;
    const itemId = menu.itemIds[0]!;
    const route = { station_id: menu.batchStationId, program_id: menu.programIds[0], stock_program_id: menu.programIds[1] };
    const v0 = await versions();

    const first = await put(itemId, a, route);
    expect(first.statusCode, first.body).toBe(200);
    expect(first.headers['idempotent-replay']).toBeUndefined();
    expect(first.json().data).toEqual({ route: { branch_id: a, price_minor_override: null, ...route } });
    const v1 = await versions();
    expect(v1).toEqual([v0[0]! + 1, v0[1], v0[2]]);
    const state = await storedRoutes(itemId);

    const second = await put(itemId, a, route);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await storedRoutes(itemId)).toEqual(state);
    expect(await versions()).toEqual(v1);
    expect(await snapshotItemIds()).toContain(itemId);

    const removed = await put(itemId, a, { station_id: null });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().data).toEqual({ route: null });
    expect(await storedRoutes(itemId)).toEqual([]);
    expect(await snapshotItemIds()).not.toContain(itemId);
    expect((await versions())[0]).toBe(v1[0]! + 1);

    // Errors as §6.14, nothing written.
    const before = { routes: await storedRoutes(itemId), versions: await versions() };
    const cases: Array<[object, number, unknown, string?]> = [
      [{ station_id: menu.archived!.stationId }, 422, { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'station_id', reason: 'archived' } }],
      [{ station_id: 'NO-SUCH-STATION' }, 422, { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'station_id', reason: 'not_found' } }],
      [{ station_id: 'ST-B' }, 422, { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'station_id', reason: 'wrong_branch' } }],
      [{ station_id: menu.slotStationId, program_id: menu.programIds[0] }, 422, { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'program_id', reason: 'program_not_allowed' } }],
      [{ station_id: menu.batchStationId }, 422, { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'program_id', reason: 'program_required' } }],
      [{ station_id: menu.batchStationId, program_id: menu.archived!.programId }, 422, { code: 'CONFIG_REFERENCE_INVALID', details: { field: 'program_id', reason: 'archived' } }],
      [{ station_id: null, program_id: menu.programIds[0] }, 400, { code: 'VALIDATION_FAILED' }],
      [{}, 400, { code: 'VALIDATION_FAILED' }],
      [{ station_id: menu.slotStationId }, 404, { code: 'MENU_ITEM_NOT_FOUND', details: { item_id: 'NO-SUCH-ITEM' } }, 'NO-SUCH-ITEM'],
    ];
    for (const [payload, status, error, item] of cases) {
      const response = await put(item ?? itemId, a, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(status);
      expect(response.json().error).toMatchObject(error as object);
    }
    const outside = await put(itemId, f.branches[2], { station_id: menu.slotStationId }, f.tokenFor([a]));
    expect(outside.statusCode).toBe(404);
    expect(outside.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: f.branches[2] } });
    expect(await storedRoutes(itemId)).toEqual(before.routes);
    expect(await versions()).toEqual(before.versions);
  });

  it('[01a §10 #82] category archive/restore rows; route PUT → item_route / route_set; null → route_removed with after null; batch → slot writes one batch_program / archive row per program', async () => {
    const [a] = f.branches;
    const category = menu.categoryIds[1]!;
    for (const archived of [true, false]) {
      const response = await cloud.app.inject({
        method: 'PATCH',
        url: `/v1/admin/categories/${category}`,
        ...owner(f),
        payload: { archived },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    expect((await audit('category', category)).map((row) => row.action)).toEqual(['archive', 'restore']);

    const itemId = menu.itemIds[0]!;
    // v1.0.2 S26: re-setting the seeded slot route would be a no-op, so remove it first, then set it again.
    const removed = await put(itemId, a, { station_id: null });
    expect(removed.statusCode).toBe(200);
    const set = await put(itemId, a, { station_id: menu.slotStationId });
    expect(set.statusCode).toBe(200);
    const slotRoute = { branch_id: a, station_id: menu.slotStationId, program_id: null, stock_program_id: null, price_minor_override: null };
    expect(await audit('item_route', itemId)).toEqual([
      { actor_owner_user_id: f.userId, branch_id: a, action: 'route_removed', before: slotRoute, after: null },
      { actor_owner_user_id: f.userId, branch_id: a, action: 'route_set', before: null, after: slotRoute },
    ]);

    // IT-0000 routes only to the slot station and IT-0001 is not seeded (items: 1), so the batch station is free.
    const changed = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/branches/${a}/stations/${menu.batchStationId}`,
      ...owner(f),
      payload: { station_type: 'slot' },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    for (const programId of menu.programIds) {
      const rows = await audit('batch_program', programId);
      expect(rows.map((row) => row.action)).toEqual(['archive']);
      expect(rows[0]).toMatchObject({ branch_id: a, before: { archived_at: null } });
    }
    expect(await audit('batch_program', menu.archived!.programId)).toEqual([]);
  });
});
