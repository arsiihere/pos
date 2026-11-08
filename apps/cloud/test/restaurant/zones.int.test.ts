import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// 01a v2.2 / v2.3 §6.6a, §6.6b: zones, with the nested routes[] / stock_items[] replace lists (02b A-1).
describe('zones', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;
  let menu: SeededMenu;
  const hooks: { handlerStart(): void; beforeBump?(): Promise<void> } = { handlerStart: () => counter.reset() };

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true, testHooks: hooks });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    delete hooks.beforeBump;
    f = await restaurantFixture(cloud);
    menu = await seedMenu(cloud.pool, f, { items: 4, archived: true });
    // IT-0002 is sold by the gram, IT-0003 is weighed at the till; IT-0000 and IT-0001 are pieces.
    await cloud.pool.query(
      `UPDATE menu_items SET sale_unit = 'g', stock_unit = 'g', stock_per_sale_unit = 1 WHERE item_id IN ('IT-0002', 'IT-0003')`,
    );
    await cloud.pool.query(`UPDATE menu_items SET requires_weighing = true WHERE item_id = 'IT-0003'`);
  });

  const A = () => f.branches[0];
  const zonesUrl = (branchId: string) => `/v1/admin/branches/${branchId}/zones`;
  const createZone = (payload: object, branchId = A(), token?: string) =>
    cloud.app.inject({ method: 'POST', url: zonesUrl(branchId), ...owner(f, token), payload });
  const patchZone = (zoneId: string, payload: object, branchId = A()) =>
    cloud.app.inject({ method: 'PATCH', url: `${zonesUrl(branchId)}/${zoneId}`, ...owner(f), payload });
  const versionOf = async (branchId: string) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]))
        .rows[0]!.v,
    );
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string; action: string; before: unknown; after: unknown }>(
        `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE entity = 'zone' ORDER BY at, audit_id`,
      )
    ).rows;
  const storedLists = async (zoneId: string) => ({
    routes: (
      await cloud.pool.query(`SELECT item_id, station_id FROM zone_item_routes WHERE zone_id = $1 ORDER BY item_id`, [zoneId])
    ).rows,
    stock_items: (
      await cloud.pool.query(`SELECT item_id, threshold FROM zone_stock_items WHERE zone_id = $1 ORDER BY item_id`, [zoneId])
    ).rows,
  });
  const newZone = async (payload: object = {}): Promise<string> => {
    const created = await createZone({ floor_id: menu.floorId, name: 'Patio', ...payload });
    expect(created.statusCode).toBe(201);
    return created.json().data.zone.zone_id as string;
  };
  const addTable = (tableId: string, zoneId: string | null, floorId = menu.floorId, archivedAt: number | null = null) =>
    cloud.pool.query(
      `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, zone_id, name, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $3, $6, 0, 0)`,
      [f.tenantId, A(), tableId, floorId, zoneId, archivedAt],
    );

  it('[01a #181] create zone on an active floor → 201, branch bumped, audit row; on an archived / foreign floor → 422 floor_id', async () => {
    const before = await versionOf(A());
    const otherBefore = await versionOf(f.branches[1]);
    const created = await createZone({ floor_id: menu.floorId, name: ' Patio ', sort_order: 3 });
    expect(created.statusCode).toBe(201);
    const zone = created.json().data.zone;
    expect(zone).toEqual({
      zone_id: expect.any(String),
      floor_id: menu.floorId,
      name: 'Patio',
      sort_order: 3,
      archived_at: null,
      routes: [],
      stock_items: [],
    });
    expect(await versionOf(A())).toBe(before + 1);
    expect(await versionOf(f.branches[1])).toBe(otherBefore);
    expect(await auditRows()).toEqual([
      { entity: 'zone', entity_id: zone.zone_id, branch_id: A(), action: 'create', before: null, after: zone },
    ]);

    const archivedFloor = await createZone({ floor_id: menu.archived!.floorId, name: 'Old' });
    expect(archivedFloor.statusCode).toBe(422);
    expect(archivedFloor.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'floor_id' } });
    // a floor of another branch, and one that does not exist
    const roof = (
      await cloud.app.inject({ method: 'POST', url: `/v1/admin/branches/${f.branches[1]}/floors`, ...owner(f), payload: { name: 'Roof' } })
    ).json().data.floor.floor_id as string;
    for (const floor_id of [roof, 'NO-SUCH-FLOOR']) {
      const foreign = await createZone({ floor_id, name: 'Elsewhere' });
      expect(foreign.statusCode).toBe(422);
      expect(foreign.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'floor_id' } });
    }
    expect((await cloud.pool.query(`SELECT 1 FROM zones`)).rowCount).toBe(1);
    expect(await auditRows()).toHaveLength(1);
    expect(await versionOf(A())).toBe(before + 1);
  });

  it('[01a #182] same zone name twice on one floor → 409 CONFIG_NAME_TAKEN; same name on another floor → 201', async () => {
    await newZone({ name: 'Patio' });
    const before = await versionOf(A());
    const duplicate = await createZone({ floor_id: menu.floorId, name: 'PATIO' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'zone', name: 'PATIO' } });
    expect(await versionOf(A())).toBe(before);
    expect(await auditRows()).toHaveLength(1);

    const upper = (
      await cloud.app.inject({ method: 'POST', url: `/v1/admin/branches/${A()}/floors`, ...owner(f), payload: { name: 'Upper' } })
    ).json().data.floor.floor_id as string;
    const other = await createZone({ floor_id: upper, name: 'Patio' });
    expect(other.statusCode).toBe(201);
  });

  it('[01a #183] table with a zone of another floor → 422 zone_id; moving a table to another floor without zone_id → zone_id = NULL', async () => {
    const zoneId = await newZone();
    const upper = (
      await cloud.app.inject({ method: 'POST', url: `/v1/admin/branches/${A()}/floors`, ...owner(f), payload: { name: 'Upper' } })
    ).json().data.floor.floor_id as string;
    const tables = `/v1/admin/branches/${A()}/tables`;

    // a zone of the table's own floor is accepted, on create and on patch
    const ok = await cloud.app.inject({ method: 'POST', url: tables, ...owner(f), payload: { floor_id: menu.floorId, name: 'P1', zone_id: zoneId } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.table).toMatchObject({ floor_id: menu.floorId, zone_id: zoneId });

    // a zone of another floor → 422
    const wrongFloor = await cloud.app.inject({ method: 'POST', url: tables, ...owner(f), payload: { floor_id: upper, name: 'U1', zone_id: zoneId } });
    expect(wrongFloor.statusCode).toBe(422);
    expect(wrongFloor.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'zone_id' } });
    const unknown = await cloud.app.inject({ method: 'POST', url: tables, ...owner(f), payload: { floor_id: menu.floorId, name: 'U2', zone_id: 'NO-SUCH-ZONE' } });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'zone_id' } });
    const patchWrong = await cloud.app.inject({
      method: 'PATCH',
      url: `${tables}/TB-2`,
      ...owner(f),
      payload: { floor_id: upper, zone_id: zoneId },
    });
    expect(patchWrong.statusCode).toBe(422);
    expect(patchWrong.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'zone_id' } });

    // the table with a zone moves floors without sending zone_id → NULL
    const moved = await cloud.app.inject({
      method: 'PATCH',
      url: `${tables}/${ok.json().data.table.table_id}`,
      ...owner(f),
      payload: { floor_id: upper },
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.table).toMatchObject({ floor_id: upper, zone_id: null });
    expect((await cloud.pool.query(`SELECT zone_id FROM dining_tables WHERE table_id = $1`, [ok.json().data.table.table_id])).rows).toEqual([
      { zone_id: null },
    ]);
  });

  it('[01a #184] archive a zone → its active tables’ zone_id NULL in the same transaction; the zone is archived', async () => {
    const zoneId = await newZone();
    await addTable('Z-T1', zoneId);
    await addTable('Z-T2', zoneId);
    await addTable('Z-OLD', zoneId, menu.floorId, 5);
    const before = await versionOf(A());

    const archived = await patchZone(zoneId, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.zone).toMatchObject({ zone_id: zoneId, archived_at: expect.any(Number) });
    const tables = await cloud.pool.query(`SELECT table_id, zone_id FROM dining_tables WHERE table_id LIKE 'Z-%' ORDER BY table_id`);
    // an already archived table keeps its zone: only active tables fall back to the floor's implicit zone
    expect(tables.rows).toEqual([
      { table_id: 'Z-OLD', zone_id: zoneId },
      { table_id: 'Z-T1', zone_id: null },
      { table_id: 'Z-T2', zone_id: null },
    ]);
    expect(await versionOf(A())).toBe(before + 1);
    const audit = await auditRows();
    expect(audit.at(-1)).toMatchObject({ entity: 'zone', entity_id: zoneId, action: 'archive' });

    // a failure after the table update rolls the tables back with the zone
    const second = await newZone({ name: 'Garden' });
    await addTable('Z-T3', second);
    hooks.beforeBump = async () => {
      throw new Error('boom');
    };
    const failed = await patchZone(second, { archived: true });
    expect(failed.statusCode).toBe(500);
    expect((await cloud.pool.query(`SELECT zone_id FROM dining_tables WHERE table_id = 'Z-T3'`)).rows).toEqual([{ zone_id: second }]);
    expect((await cloud.pool.query(`SELECT archived_at FROM zones WHERE zone_id = $1`, [second])).rows).toEqual([{ archived_at: null }]);
  });

  it('[01a #185] archive a floor with an active zone → 409 CONFIG_IN_USE { used_by: { entity: zone } }', async () => {
    const zoneId = await newZone();
    const floors = `/v1/admin/branches/${A()}/floors`;
    await cloud.pool.query(`DELETE FROM dining_tables`);
    const refused = await cloud.app.inject({ method: 'PATCH', url: `${floors}/${menu.floorId}`, ...owner(f), payload: { archived: true } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'floor', id: menu.floorId, used_by: { entity: 'zone', ids: [zoneId] } },
    });
    // with the zone archived the floor archives
    await patchZone(zoneId, { archived: true });
    const archived = await cloud.app.inject({ method: 'PATCH', url: `${floors}/${menu.floorId}`, ...owner(f), payload: { archived: true } });
    expect(archived.statusCode).toBe(200);
  });

  it('[01a #186] floors list returns zones and zone_id in 3 statements', async () => {
    const zoneId = await newZone({ name: 'Patio', sort_order: 2 });
    const archivedZone = await newZone({ name: 'Old patio', sort_order: 1 });
    await patchZone(archivedZone, { archived: true });
    await addTable('Z-T1', zoneId);
    const listed = await cloud.app.inject({ method: 'GET', url: `/v1/admin/branches/${A()}/floors`, ...owner(f) });
    expect(counter.count).toBe(3);
    expect(listed.statusCode).toBe(200);
    const floor = listed.json().data.floors.find((fl: { floor_id: string }) => fl.floor_id === menu.floorId);
    expect(floor.zones).toEqual([
      { zone_id: archivedZone, name: 'Old patio', sort_order: 1, archived_at: expect.any(Number) },
      { zone_id: zoneId, name: 'Patio', sort_order: 2, archived_at: null },
    ]);
    expect(floor.tables.find((t: { table_id: string }) => t.table_id === 'Z-T1')).toMatchObject({ zone_id: zoneId });
    expect(floor.tables.find((t: { table_id: string }) => t.table_id === 'TB-1')).toMatchObject({ zone_id: null });
    const empty = listed.json().data.floors.find((fl: { floor_id: string }) => fl.floor_id === menu.archived!.floorId);
    expect(empty.zones).toEqual([]);
  });

  it('[01a #189] zone with routes and stock_items → stored; PATCH with routes only replaces routes, keeps stock items; [] clears', async () => {
    const created = await createZone({
      floor_id: menu.floorId,
      name: 'Patio',
      routes: [
        { item_id: 'IT-0001', station_id: 'ST-2' },
        { item_id: 'IT-0000', station_id: 'ST-1' },
      ],
      stock_items: [{ item_id: 'IT-0001', threshold: 5 }, { item_id: 'IT-0000' }],
    });
    expect(created.statusCode).toBe(201);
    const zone = created.json().data.zone;
    const routes0 = [
      { item_id: 'IT-0000', station_id: 'ST-1' },
      { item_id: 'IT-0001', station_id: 'ST-2' },
    ];
    const stock0 = [
      { item_id: 'IT-0000', threshold: 0 },
      { item_id: 'IT-0001', threshold: 5 },
    ];
    expect(zone).toMatchObject({ routes: routes0, stock_items: stock0 });
    expect(await storedLists(zone.zone_id)).toEqual({ routes: routes0, stock_items: stock0 });
    expect((await auditRows())[0]).toMatchObject({ action: 'create', after: zone });

    // routes only → replaced; stock items kept
    const before = await versionOf(A());
    const replaced = await patchZone(zone.zone_id, { routes: [{ item_id: 'IT-0001', station_id: 'ST-1' }] });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().data.zone).toMatchObject({ routes: [{ item_id: 'IT-0001', station_id: 'ST-1' }], stock_items: stock0 });
    expect(await storedLists(zone.zone_id)).toEqual({ routes: [{ item_id: 'IT-0001', station_id: 'ST-1' }], stock_items: stock0 });
    expect(await versionOf(A())).toBe(before + 1);
    const audit = await auditRows();
    expect(audit).toHaveLength(2); // one row for the zone covers both lists
    expect(audit[1]).toMatchObject({ action: 'update', entity_id: zone.zone_id });
    expect(audit[1]!.before).toMatchObject({ routes: routes0, stock_items: stock0 });
    expect(audit[1]!.after).toMatchObject({ routes: [{ item_id: 'IT-0001', station_id: 'ST-1' }], stock_items: stock0 });

    // [] clears one list and keeps the other
    const cleared = await patchZone(zone.zone_id, { stock_items: [] });
    expect(cleared.statusCode).toBe(200);
    expect(await storedLists(zone.zone_id)).toEqual({ routes: [{ item_id: 'IT-0001', station_id: 'ST-1' }], stock_items: [] });
    const both = await patchZone(zone.zone_id, { routes: [], stock_items: [{ item_id: 'IT-0000', threshold: 5000 }] });
    expect(both.statusCode).toBe(200);
    expect(await storedLists(zone.zone_id)).toEqual({ routes: [], stock_items: [{ item_id: 'IT-0000', threshold: 5000 }] });
  });

  it('[01a #190] route to an archived station or a foreign item → 422 routes.N.…; duplicate item_id → 400', async () => {
    const zoneId = await newZone();
    const before = await versionOf(A());
    const auditBefore = (await auditRows()).length;
    const refuse = async (payload: object, field: string) => {
      const created = await createZone({ floor_id: menu.floorId, name: 'Other', ...payload });
      expect(created.statusCode).toBe(422);
      expect(created.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field } });
      const patched = await patchZone(zoneId, payload);
      expect(patched.statusCode).toBe(422);
      expect(patched.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field } });
    };
    // the archived station is the second route
    await refuse(
      { routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }, { item_id: 'IT-0001', station_id: menu.archived!.stationId }] },
      'routes.1.station_id',
    );
    // another branch's station, an unknown station
    await refuse({ routes: [{ item_id: 'IT-0000', station_id: 'ST-B' }] }, 'routes.0.station_id');
    await refuse({ routes: [{ item_id: 'IT-0000', station_id: 'NO-SUCH' }] }, 'routes.0.station_id');
    // an archived item, an unknown item, another tenant's item
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'CT-OTHER', 'Other', 0, 0)`,
      [f.other.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, 'FOREIGN-ITEM', 'CT-OTHER', 'Foreign', 100, 'immediate', 60000, 0, 0)`,
      [f.other.tenantId],
    );
    for (const item_id of [menu.archived!.itemId, 'NO-SUCH-ITEM', 'FOREIGN-ITEM']) {
      await refuse({ routes: [{ item_id, station_id: 'ST-1' }] }, 'routes.0.item_id');
    }
    expect((await cloud.pool.query(`SELECT 1 FROM zones`)).rowCount).toBe(1);
    expect(await storedLists(zoneId)).toEqual({ routes: [], stock_items: [] });
    expect(await versionOf(A())).toBe(before);
    expect(await auditRows()).toHaveLength(auditBefore);

    // a duplicate item_id is a 400 (body validation), in either list, on create and on patch
    const dup = [{ item_id: 'IT-0000', station_id: 'ST-1' }, { item_id: 'IT-0000', station_id: 'ST-2' }];
    const dupStock = [{ item_id: 'IT-0000' }, { item_id: 'IT-0000', threshold: 2 }];
    for (const payload of [{ routes: dup }, { stock_items: dupStock }]) {
      expect((await createZone({ floor_id: menu.floorId, name: 'Dup', ...payload })).statusCode).toBe(400);
      expect((await patchZone(zoneId, payload)).statusCode).toBe(400);
    }
    // more than 200 entries, and a threshold out of 0–5000, are 400 too
    const many = Array.from({ length: 201 }, (_, i) => ({ item_id: `X-${i}`, station_id: 'ST-1' }));
    expect((await patchZone(zoneId, { routes: many })).statusCode).toBe(400);
    expect((await patchZone(zoneId, { stock_items: [{ item_id: 'IT-0000', threshold: 5001 }] })).statusCode).toBe(400);
    expect((await patchZone(zoneId, { stock_items: [{ item_id: 'IT-0000', threshold: -1 }] })).statusCode).toBe(400);
  });

  it('[01a #191] stock item with sale_unit g or requires_weighing → 422 stock_items.N.item_id', async () => {
    const zoneId = await newZone();
    const before = await versionOf(A());
    // IT-0002 sells by the gram; IT-0003 is weighed; the second entry is the offender
    for (const [index, itemId] of [[1, 'IT-0002'], [1, 'IT-0003']] as const) {
      const payload = { stock_items: [{ item_id: 'IT-0000' }, { item_id: itemId }] };
      const created = await createZone({ floor_id: menu.floorId, name: 'Weighed', ...payload });
      expect(created.statusCode).toBe(422);
      expect(created.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: `stock_items.${index}.item_id` } });
      const patched = await patchZone(zoneId, payload);
      expect(patched.statusCode).toBe(422);
      expect(patched.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: `stock_items.${index}.item_id` } });
    }
    // an archived or unknown item is refused on the same field
    for (const item_id of [menu.archived!.itemId, 'NO-SUCH-ITEM']) {
      const patched = await patchZone(zoneId, { stock_items: [{ item_id }] });
      expect(patched.statusCode).toBe(422);
      expect(patched.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_items.0.item_id' } });
    }
    // the same gram-sold item is fine as a route (only stock items are limited to pieces)
    const route = await patchZone(zoneId, { routes: [{ item_id: 'IT-0002', station_id: 'ST-1' }] });
    expect(route.statusCode).toBe(200);
    expect(await versionOf(A())).toBe(before + 1);
    expect(await storedLists(zoneId)).toEqual({ routes: [{ item_id: 'IT-0002', station_id: 'ST-1' }], stock_items: [] });
  });

  it('[01a §6.6b] unknown or another branch’s zone → 404 ZONE_NOT_FOUND { zone_id }', async () => {
    const unknown = await patchZone('NO-SUCH-ZONE', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'ZONE_NOT_FOUND', details: { zone_id: 'NO-SUCH-ZONE' } });
    const zoneId = await newZone();
    const elsewhere = await patchZone(zoneId, { name: 'X' }, f.branches[1]);
    expect(elsewhere.statusCode).toBe(404);
    expect(elsewhere.json().error).toMatchObject({ code: 'ZONE_NOT_FOUND', details: { zone_id: zoneId } });
    const notAllowed = await patchZone(zoneId, { name: 'X' }, f.other.branchId);
    expect(notAllowed.statusCode).toBe(404);
    expect(notAllowed.json().error.code).toBe('BRANCH_NOT_FOUND');
  });

  it('[01a S26] a PATCH that changes nothing (same fields, same lists) writes nothing', async () => {
    const zoneId = await newZone({ routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-0001', threshold: 3 }] });
    const version = await versionOf(A());
    const audits = (await auditRows()).length;
    const updated = (await cloud.pool.query(`SELECT updated_at FROM zones WHERE zone_id = $1`, [zoneId])).rows;
    const same = await patchZone(zoneId, {
      name: 'Patio',
      sort_order: 0,
      archived: false,
      routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }],
      stock_items: [{ item_id: 'IT-0001', threshold: 3 }],
    });
    expect(same.statusCode).toBe(200);
    expect(same.json().data.zone).toMatchObject({ zone_id: zoneId, name: 'Patio' });
    expect(await versionOf(A())).toBe(version);
    expect(await auditRows()).toHaveLength(audits);
    expect((await cloud.pool.query(`SELECT updated_at FROM zones WHERE zone_id = $1`, [zoneId])).rows).toEqual(updated);
  });

  it('[01a §6.6b] archiving keeps the lists; restore checks the name; a rename keeps the lists', async () => {
    const zoneId = await newZone({ routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-0001', threshold: 3 }] });
    const lists = await storedLists(zoneId);
    expect((await patchZone(zoneId, { archived: true })).statusCode).toBe(200);
    expect(await storedLists(zoneId)).toEqual(lists);
    // a new active zone takes the name; the restore is refused
    await newZone({ name: 'patio' });
    const refused = await patchZone(zoneId, { archived: false });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'zone' } });
    const renamed = await patchZone(zoneId, { name: 'Garden', archived: false });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.zone).toMatchObject({ name: 'Garden', archived_at: null, routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }] });
    expect((await auditRows()).at(-1)).toMatchObject({ action: 'restore' });
    expect(await storedLists(zoneId)).toEqual(lists);
  });

  it('[01a S7] a replayed create (same Idempotency-Key) keeps one zone and one audit row', async () => {
    const headers = { authorization: `Bearer ${f.token}`, 'idempotency-key': '01HZZZZZZZZZZZZZZZZZZZZZZ1' };
    const payload = { floor_id: menu.floorId, name: 'Patio', routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }] };
    const first = await cloud.app.inject({ method: 'POST', url: zonesUrl(A()), headers, payload });
    const again = await cloud.app.inject({ method: 'POST', url: zonesUrl(A()), headers, payload });
    expect(first.statusCode).toBe(201);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect((await cloud.pool.query(`SELECT 1 FROM zones`)).rowCount).toBe(1);
    expect(await auditRows()).toHaveLength(1);
    const missing = await cloud.app.inject({
      method: 'POST',
      url: zonesUrl(A()),
      headers: { authorization: `Bearer ${f.token}` },
      payload,
    });
    expect(missing.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('[01a §6.6b] a table PATCH resending its unchanged zone_id reads no zone (lock order: the zone archive locks the zone first)', async () => {
    const zoneId = await newZone();
    await addTable('Z-T1', zoneId);
    const tables = `/v1/admin/branches/${A()}/tables/Z-T1`;
    const patchTable = (payload: object) => cloud.app.inject({ method: 'PATCH', url: tables, ...owner(f), payload });
    expect((await patchTable({ name: 'Renamed' })).statusCode).toBe(200);
    const withoutZone = counter.count;
    const resent = await patchTable({ name: 'Renamed again', zone_id: zoneId });
    expect(resent.statusCode).toBe(200);
    expect(counter.count).toBe(withoutZone);
    // a zone actually given is still checked
    const other = await newZone({ name: 'Garden' });
    const moved = await patchTable({ zone_id: other });
    expect(moved.statusCode).toBe(200);
    expect(counter.count).toBe(withoutZone + 1);
    expect(moved.json().data.table.zone_id).toBe(other);
  });

  it('[01a AD-4] restoring a table whose stored zone is now archived sets zone_id NULL; an archived zone given explicitly is still 422', async () => {
    const zoneId = await newZone();
    await addTable('Z-T1', zoneId);
    const url = `/v1/admin/branches/${A()}/tables/Z-T1`;
    const patchTable = (payload: object) => cloud.app.inject({ method: 'PATCH', url, ...owner(f), payload });
    expect((await patchTable({ archived: true })).statusCode).toBe(200);
    expect((await patchZone(zoneId, { archived: true })).statusCode).toBe(200); // an archived table keeps its zone
    expect((await cloud.pool.query(`SELECT zone_id FROM dining_tables WHERE table_id = 'Z-T1'`)).rows).toEqual([{ zone_id: zoneId }]);

    const explicit = await patchTable({ archived: false, zone_id: zoneId });
    expect(explicit.statusCode).toBe(422);
    expect(explicit.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'zone_id', reason: 'archived' } });

    const restored = await patchTable({ archived: false });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.table).toMatchObject({ archived_at: null, zone_id: null });
    expect((await cloud.pool.query(`SELECT zone_id FROM dining_tables WHERE table_id = 'Z-T1'`)).rows).toEqual([{ zone_id: null }]);

    // an active stored zone is kept on restore
    const live = await newZone({ name: 'Garden' });
    await addTable('Z-T2', live, menu.floorId, 5);
    const kept = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${A()}/tables/Z-T2`, ...owner(f), payload: { archived: false } });
    expect(kept.json().data.table).toMatchObject({ archived_at: null, zone_id: live });
  });

  it('[01a AD-5] restoring a zone whose floor is archived → 422 floor_id archived', async () => {
    await cloud.pool.query(
      `INSERT INTO zones (tenant_id, branch_id, zone_id, floor_id, name, archived_at, created_at, updated_at)
       VALUES ($1, $2, 'Z-OLD', $3, 'Old', 1, 0, 0)`,
      [f.tenantId, A(), menu.archived!.floorId],
    );
    const before = await versionOf(A());
    const restored = await patchZone('Z-OLD', { archived: false });
    expect(restored.statusCode).toBe(422);
    expect(restored.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'floor_id', reason: 'archived' } });
    expect(await versionOf(A())).toBe(before);
  });

  describe('[01a AD-6] in-use rules for stations and items named by an active zone list', () => {
    beforeEach(async () => {
      await cloud.pool.query(
        `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
         VALUES ($1, $2, 'ST-Z', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Zone grill', 'slot', 2, 0, 0)`,
        [f.tenantId, A()],
      );
      await cloud.pool.query(
        `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
         VALUES ($1, 'IT-Z', 'CT-1', 'Zone item', 100, 'immediate', 60000, 0, 0)`,
        [f.tenantId],
      );
      await cloud.pool.query(
        `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at) VALUES ($1, $2, 'IT-Z', 'ST-1', 0)`,
        [f.tenantId, A()],
      );
    });
    const patchStation = (payload: object) =>
      cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${A()}/stations/ST-Z`, ...owner(f), payload });
    const patchItem = (payload: object) =>
      cloud.app.inject({ method: 'PATCH', url: '/v1/admin/menu-items/IT-Z', ...owner(f), payload });
    const inUse = (res: { statusCode: number; json(): { error: unknown } }, entity: string, id: string, ids: string[]) => {
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({ code: 'CONFIG_IN_USE', details: { entity, id, used_by: { entity: 'zone', ids } } });
    };

    it('archiving a station named by an active zone’s routes → 409 (used_by zone); fine once the zone is archived', async () => {
      const zoneId = await newZone({ routes: [{ item_id: 'IT-Z', station_id: 'ST-Z' }] });
      const before = await versionOf(A());
      inUse(await patchStation({ archived: true }), 'station', 'ST-Z', [zoneId]);
      expect(await versionOf(A())).toBe(before);
      await patchZone(zoneId, { archived: true });
      expect((await patchStation({ archived: true })).statusCode).toBe(200);
    });

    it('archiving an item named by an active zone’s routes or stock_items → 409; stock-only check for sale_unit / weighing', async () => {
      const routeZone = await newZone({ name: 'R', routes: [{ item_id: 'IT-Z', station_id: 'ST-Z' }] });
      inUse(await patchItem({ archived: true }), 'menu_item', 'IT-Z', [routeZone]);
      // a route-only zone does not stop the item leaving 'piece' or being weighed
      expect((await patchItem({ sale_unit: 'g', requires_weighing: true })).statusCode).toBe(200);
      expect((await patchItem({ sale_unit: 'piece', requires_weighing: false })).statusCode).toBe(200);

      const stockZone = await newZone({ name: 'S', stock_items: [{ item_id: 'IT-Z' }] });
      inUse(await patchItem({ archived: true }), 'menu_item', 'IT-Z', [routeZone, stockZone].sort());
      inUse(await patchItem({ sale_unit: 'g' }), 'menu_item', 'IT-Z', [stockZone]);
      inUse(await patchItem({ sale_unit: 'g', requires_weighing: true }), 'menu_item', 'IT-Z', [stockZone]);
      expect((await cloud.pool.query(`SELECT sale_unit, archived_at FROM menu_items WHERE item_id = 'IT-Z'`)).rows).toEqual([
        { sale_unit: 'piece', archived_at: null },
      ]);
      // archived zones do not count
      await patchZone(routeZone, { archived: true });
      await patchZone(stockZone, { archived: true });
      expect((await patchItem({ archived: true })).statusCode).toBe(200);
    });
  });

  it('[01a AD-9] restoring a zone drops stored entries naming an archived item or station, a non-piece or weighed stock item; audited', async () => {
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, 'ST-Z', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Zone grill', 'slot', 2, 0, 0)`,
      [f.tenantId, A()],
    );
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, 'IT-P', 'CT-1', 'Zone piece', 100, 'immediate', 60000, 0, 0), ($1, 'IT-W', 'CT-1', 'Zone weighed', 100, 'immediate', 60000, 0, 0)`,
      [f.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at) VALUES ($1, $2, 'IT-P', 'ST-1', 0), ($1, $2, 'IT-W', 'ST-1', 0)`,
      [f.tenantId, A()],
    );
    const zoneId = await newZone({
      routes: [
        { item_id: 'IT-0000', station_id: 'ST-1' },
        { item_id: 'IT-0001', station_id: 'ST-Z' },
        { item_id: 'IT-P', station_id: 'ST-1' },
      ],
      stock_items: [{ item_id: 'IT-0000', threshold: 2 }, { item_id: 'IT-0001' }, { item_id: 'IT-P' }, { item_id: 'IT-W' }],
    });
    expect((await patchZone(zoneId, { archived: true })).statusCode).toBe(200);
    // the zone is archived, so none of these is refused as in use
    await cloud.pool.query(`UPDATE stations SET archived_at = 1 WHERE station_id = 'ST-Z'`);
    await cloud.pool.query(`UPDATE menu_items SET archived_at = 1 WHERE item_id = 'IT-P'`);
    await cloud.pool.query(`UPDATE menu_items SET sale_unit = 'g', stock_unit = 'g' WHERE item_id = 'IT-0001'`);
    await cloud.pool.query(`UPDATE menu_items SET sale_unit = 'g', stock_unit = 'g', requires_weighing = true WHERE item_id = 'IT-W'`);
    const stale = await storedLists(zoneId);
    expect(stale.routes).toHaveLength(3);
    expect(stale.stock_items).toHaveLength(4);

    // sent lists are validated as today: a bad ref is 422 and nothing is restored
    const bad = await patchZone(zoneId, { archived: false, routes: [{ item_id: 'IT-P', station_id: 'ST-1' }] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'routes.0.item_id' } });
    expect(await storedLists(zoneId)).toEqual(stale);

    const restored = await patchZone(zoneId, { archived: false });
    expect(restored.statusCode).toBe(200);
    const keptRoutes = [{ item_id: 'IT-0000', station_id: 'ST-1' }];
    const keptStock = [{ item_id: 'IT-0000', threshold: 2 }];
    expect(restored.json().data.zone).toMatchObject({ archived_at: null, routes: keptRoutes, stock_items: keptStock });
    expect(await storedLists(zoneId)).toEqual({ routes: keptRoutes, stock_items: keptStock });
    const audit = (await auditRows()).at(-1)!;
    expect(audit).toMatchObject({ action: 'restore', entity_id: zoneId });
    expect(audit.after).toMatchObject({
      routes: keptRoutes,
      stock_items: keptStock,
      dropped: {
        routes: [{ item_id: 'IT-0001', station_id: 'ST-Z' }, { item_id: 'IT-P', station_id: 'ST-1' }],
        stock_items: [{ item_id: 'IT-0001', threshold: 0 }, { item_id: 'IT-P', threshold: 0 }, { item_id: 'IT-W', threshold: 0 }],
      },
    });
    expect((audit.before as { routes: unknown[] }).routes).toHaveLength(3);

    // a restore with one list sent keeps that list as sent and drops from the other only
    await patchZone(zoneId, { archived: true });
    await cloud.pool.query(`UPDATE menu_items SET archived_at = 1 WHERE item_id = 'IT-0000'`);
    const mixed = await patchZone(zoneId, { archived: false, routes: [{ item_id: 'IT-0002', station_id: 'ST-1' }] });
    expect(mixed.statusCode).toBe(200);
    expect(await storedLists(zoneId)).toEqual({ routes: [{ item_id: 'IT-0002', station_id: 'ST-1' }], stock_items: [] });
    // nothing stale: no `dropped` key
    await patchZone(zoneId, { archived: true });
    await patchZone(zoneId, { archived: false });
    expect((await auditRows()).at(-1)!.after).not.toHaveProperty('dropped');
  });

  describe('[01a AD-15] zone items must be routed at the branch', () => {
    const route = (itemId: string, branchId = A()) =>
      cloud.pool.query(
        `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at) VALUES ($1, $2, $3, 'ST-1', 0)`,
        [f.tenantId, branchId, itemId],
      );
    const putRoute = (itemId: string, payload: object, branchId = A()) =>
      cloud.app.inject({ method: 'PUT', url: `/v1/admin/menu-items/${itemId}/routes/${branchId}`, ...owner(f), payload });
    beforeEach(async () => {
      await cloud.pool.query(
        `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
         VALUES ($1, 'IT-N', 'CT-1', 'Unrouted', 100, 'immediate', 60000, 0, 0)`,
        [f.tenantId],
      );
    });

    it('POST with an item not routed at the branch → 422 not_found for routes and for stock_items', async () => {
      const r = await createZone({ floor_id: menu.floorId, name: 'X', routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }, { item_id: 'IT-N', station_id: 'ST-1' }] });
      expect(r.statusCode).toBe(422);
      expect(r.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'routes.1.item_id', reason: 'not_found' } });
      const s = await createZone({ floor_id: menu.floorId, name: 'X', stock_items: [{ item_id: 'IT-0000' }, { item_id: 'IT-B' }] });
      expect(s.statusCode).toBe(422);
      expect(s.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_items.1.item_id', reason: 'not_found' } });
      expect((await createZone({ floor_id: menu.floorId, name: 'X', stock_items: [{ item_id: 'IT-0000' }] })).statusCode).toBe(201);
    });

    it('PATCH with an item not routed at the branch → 422; once routed → 200', async () => {
      const zoneId = await newZone();
      const r = await patchZone(zoneId, { routes: [{ item_id: 'IT-N', station_id: 'ST-1' }] });
      expect(r.statusCode).toBe(422);
      expect(r.json().error).toMatchObject({ details: { field: 'routes.0.item_id', reason: 'not_found' } });
      const s = await patchZone(zoneId, { stock_items: [{ item_id: 'IT-N' }] });
      expect(s.statusCode).toBe(422);
      expect(s.json().error).toMatchObject({ details: { field: 'stock_items.0.item_id', reason: 'not_found' } });
      await route('IT-N');
      expect((await patchZone(zoneId, { routes: [{ item_id: 'IT-N', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-N' }] })).statusCode).toBe(200);
    });

    it('route PUT removing a route an active zone names → 409 CONFIG_IN_USE (used_by zone); an archived zone does not block; other branches do not count', async () => {
      const zoneId = await newZone({ routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-0001' }] });
      const before = await versionOf(A());
      for (const item of ['IT-0000', 'IT-0001']) {
        const res = await putRoute(item, { station_id: null });
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toMatchObject({ code: 'CONFIG_IN_USE', details: { entity: 'menu_item', id: item, used_by: { entity: 'zone', ids: [zoneId] } } });
      }
      expect(await versionOf(A())).toBe(before);
      expect((await cloud.pool.query(`SELECT 1 FROM item_routes WHERE item_id = 'IT-0000' AND branch_id = $1`, [A()])).rowCount).toBe(1);
      // re-setting the route is not a removal
      expect((await putRoute('IT-0000', { station_id: 'ST-1' })).statusCode).toBe(200);
      await patchZone(zoneId, { archived: true });
      expect((await putRoute('IT-0000', { station_id: null })).statusCode).toBe(200);
      expect((await putRoute('IT-0001', { station_id: null })).statusCode).toBe(200);
    });

    it('restoring a zone drops kept entries whose item has no route at the branch; audited in after.dropped', async () => {
      const zoneId = await newZone({ routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }, { item_id: 'IT-0002', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-0000' }, { item_id: 'IT-0001' }] });
      await patchZone(zoneId, { archived: true });
      await putRoute('IT-0002', { station_id: null });
      await putRoute('IT-0001', { station_id: null });
      const restored = await patchZone(zoneId, { archived: false });
      expect(restored.statusCode).toBe(200);
      expect(await storedLists(zoneId)).toEqual({ routes: [{ item_id: 'IT-0000', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-0000', threshold: 0 }] });
      expect((await auditRows()).at(-1)!.after).toMatchObject({
        dropped: { routes: [{ item_id: 'IT-0002', station_id: 'ST-1' }], stock_items: [{ item_id: 'IT-0001', threshold: 0 }] },
      });
    });
  });

  it('[01a AD-9] a table PATCH to another floor resending its current zone_id answers 422 wrong_floor without locking the zone', async () => {
    const zoneId = await newZone();
    await addTable('Z-T1', zoneId);
    const upper = (
      await cloud.app.inject({ method: 'POST', url: `/v1/admin/branches/${A()}/floors`, ...owner(f), payload: { name: 'Upper' } })
    ).json().data.floor.floor_id as string;
    // the zone is held FOR UPDATE, as a concurrent archive holds it: a lock-free check still answers
    const holder = await cloud.pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM zones WHERE zone_id = $1 FOR UPDATE`, [zoneId]);
      const moved = await cloud.app.inject({
        method: 'PATCH',
        url: `/v1/admin/branches/${A()}/tables/Z-T1`,
        ...owner(f),
        payload: { floor_id: upper, zone_id: zoneId },
      });
      expect(moved.statusCode).toBe(422);
      expect(moved.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'zone_id', reason: 'wrong_floor' } });
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('[01a §6.6a] no N+1: the statement count does not grow with the list length', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `BULK-${i}`);
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       SELECT $1, id, 'CT-1', id, 100, 'immediate', 60000, 0, 0 FROM unnest($2::text[]) AS u (id)`,
      [f.tenantId, ids],
    );
    await cloud.pool.query(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at)
       SELECT $1, $2, id, 'ST-1', 0 FROM unnest($3::text[]) AS u (id)`,
      [f.tenantId, A(), ids],
    );
    await createZone({ floor_id: menu.floorId, name: 'One', routes: [{ item_id: ids[0], station_id: 'ST-1' }] });
    const small = counter.count;
    await createZone({
      floor_id: menu.floorId,
      name: 'Five',
      routes: ids.map((item_id) => ({ item_id, station_id: 'ST-1' })),
      stock_items: ids.map((item_id) => ({ item_id, threshold: 1 })),
    });
    // the stock list adds its delete and insert; the item read is shared with the routes' own
    expect(counter.count).toBe(small + 2);
  });
});
