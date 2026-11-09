import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV4, SNAPSHOT_SCHEMA_VERSION } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, seedMenu, type RestaurantFixture, type SeededMenu } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// v2.1's config-only sync poll 200 path after the guard's key lookup, measured on this branch before task 4: the
// header read, the 21 builder statements and the hub_last_seen_at UPDATE (01b v1.5 B-8 bound ≤ 27).
const V21_CONFIG_ONLY_200 = 23;
// The same poll with the directory on v2.1: + loadDirectory's 9 statements (01b v1.4 B-5), within 01b v1.5 B-8's ≤ 32.
const V21_WITH_DIRECTORY_200 = V21_CONFIG_ONLY_200 + 9;

// 01a v2.2 A-1, v2.3 A-1 (02p §11 #4): snapshot schema 4 from the cloud.
describe('GET /v1/sync/config: snapshot V4', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;
  let menu: SeededMenu;

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
    menu = await seedMenu(cloud.pool, f, { items: 4, archived: true });
  });

  const A = () => f.branches[0];
  const zonesUrl = () => `/v1/admin/branches/${A()}/zones`;
  const createZone = async (payload: object): Promise<string> => {
    const created = await cloud.app.inject({ method: 'POST', url: zonesUrl(), ...owner(f), payload });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().data.zone.zone_id as string;
  };
  const patchZone = async (zoneId: string, payload: object) => {
    const patched = await cloud.app.inject({ method: 'PATCH', url: `${zonesUrl()}/${zoneId}`, ...owner(f), payload });
    expect(patched.statusCode, patched.body).toBe(200);
  };
  const patchTable = async (tableId: string, payload: object) => {
    const patched = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/branches/${A()}/tables/${tableId}`, ...owner(f), payload });
    expect(patched.statusCode, patched.body).toBe(200);
  };
  const directoryVersion = async () =>
    Number((await cloud.pool.query<{ v: string }>(`SELECT directory_version AS v FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0]!.v);
  // A config-only 200: config_version 0 is always behind, directory_version is current.
  const pollConfig = async () => {
    const dv = await directoryVersion();
    const response = await cloud.app.inject({
      method: 'GET',
      url: `/v1/sync/config?config_version=0&directory_version=${dv}`,
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    const config = response.json().data.config as { snapshot_hash: string; snapshot: Record<string, unknown> };
    return { response, config, snapshot: BranchConfigSnapshotSchemaV4.parse(config.snapshot) };
  };
  const ground = (snapshot: ReturnType<typeof BranchConfigSnapshotSchemaV4.parse>) =>
    snapshot.floors.find((floor) => floor.floor_id === menu.floorId)!;

  it('[01a #187] Sync poll 200 path: config-only one statement more than v2.1 (zones), with the directory "+2" (zones and 01b v1.6 B-2 assignments); snapshot `snapshot_schema_version = 4` with `zones[]` and `zone_id`', async () => {
    const zoneId = await createZone({
      floor_id: menu.floorId,
      name: 'Patio',
      routes: [{ item_id: 'IT-0000', station_id: menu.slotStationId }],
      stock_items: [{ item_id: 'IT-0001', threshold: 2 }],
    });
    await patchTable(menu.tableIds[0], { zone_id: zoneId });
    const { config, snapshot } = await pollConfig();
    expect(counter.count).toBe(V21_CONFIG_ONLY_200 + 1);
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(4);
    expect(config.snapshot.snapshot_schema_version).toBe(4);
    expect(config.snapshot_hash).toBe(sha256hex(canonicalJson(config.snapshot)));
    expect(ground(snapshot).zones.map((zone) => zone.zone_id)).toEqual([zoneId]);
    expect(ground(snapshot).tables).toEqual([
      { table_id: menu.tableIds[0], name: 'T1', seats: 4, sort_order: 1, zone_id: zoneId },
      { table_id: menu.tableIds[1], name: 'T2', seats: null, sort_order: 2, zone_id: null },
    ]);
    // the same count with no zone at all (the zones statement is fixed)
    await cloud.pool.query(`UPDATE dining_tables SET zone_id = NULL`);
    await cloud.pool.query(`DELETE FROM zone_item_routes`);
    await cloud.pool.query(`DELETE FROM zone_stock_items`);
    await cloud.pool.query(`DELETE FROM zones`);
    const empty = await pollConfig();
    expect(counter.count).toBe(V21_CONFIG_ONLY_200 + 1);
    expect(ground(empty.snapshot).zones).toEqual([]);
    // with the directory (directory_version 0 is always behind): + the zones read and the assignments read
    const both = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(both.statusCode, both.body).toBe(200);
    expect(both.json().data.directory).not.toBeNull();
    expect(counter.count).toBe(V21_WITH_DIRECTORY_200 + 2);
  });

  it('[01a #192] Snapshot V4 carries `zones[].routes[]`, `zones[].stock_items[]`, `items[].is_ready_item`', async () => {
    await cloud.pool.query(`UPDATE menu_items SET is_ready_item = true WHERE item_id = 'IT-0002'`);
    const zoneId = await createZone({
      floor_id: menu.floorId,
      name: 'Patio',
      sort_order: 2,
      routes: [{ item_id: 'IT-0000', station_id: menu.slotStationId }],
      stock_items: [{ item_id: 'IT-0001', threshold: 2 }],
    });
    const { snapshot } = await pollConfig();
    expect(ground(snapshot).zones).toEqual([
      {
        zone_id: zoneId,
        name: 'Patio',
        sort_order: 2,
        is_archived: false,
        routes: [{ item_id: 'IT-0000', station_id: menu.slotStationId }],
        stock_items: [{ item_id: 'IT-0001', threshold: 2 }],
      },
    ]);
    expect(Object.fromEntries(snapshot.items.map((item) => [item.item_id, item.is_ready_item]))).toEqual({
      'IT-0000': false,
      'IT-0001': false,
      'IT-0002': true,
      'IT-0003': false,
    });
  });

  it('[01a #193] Settings: `queue_auto_send_max_ms`, `zone_undo_ms`, `slow_item_threshold_ms`, `comp_reason_chips` … delivered (02p U-2: delivered with defaults; written, range-checked in task 9)', async () => {
    const { snapshot } = await pollConfig();
    expect(snapshot.engine_settings).toMatchObject({
      queue_auto_send_max_ms: 14_400_000,
      zone_undo_ms: 300_000,
      slow_item_threshold_ms: 900_000,
      served_estimate_ms: null,
      comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
    });
    expect(snapshot).not.toHaveProperty('settings'); // AD-10: beside the A-12 fields, no new key
    // stored values are what is delivered (no default in the builder)
    await cloud.pool.query(
      `UPDATE branch_engine_settings SET zone_undo_ms = 60000, served_estimate_ms = 1200000, comp_reason_chips = ARRAY['Late','Other']
        WHERE branch_id = $1`,
      [A()],
    );
    expect((await pollConfig()).snapshot.engine_settings).toMatchObject({
      zone_undo_ms: 60_000,
      served_estimate_ms: 1_200_000,
      comp_reason_chips: ['Late', 'Other'],
    });
  });

  it('[01a #184 snapshot] snapshot shows the zone `is_archived: true`', async () => {
    const zoneId = await createZone({ floor_id: menu.floorId, name: 'Patio' });
    await patchTable(menu.tableIds[0], { zone_id: zoneId });
    await patchZone(zoneId, { archived: true });
    const { snapshot } = await pollConfig();
    expect(ground(snapshot).zones).toMatchObject([{ zone_id: zoneId, is_archived: true }]);
    expect(ground(snapshot).tables.map((table) => table.zone_id)).toEqual([null, null]);
  });

  it('[01a AD-11] an archived zone is delivered with `is_archived: true`, `routes: []`, `stock_items: []`; its cloud rows stay', async () => {
    const zoneId = await createZone({
      floor_id: menu.floorId,
      name: 'Patio',
      routes: [{ item_id: 'IT-0000', station_id: menu.slotStationId }],
      stock_items: [{ item_id: 'IT-0001', threshold: 2 }],
    });
    await patchZone(zoneId, { archived: true });
    const { snapshot } = await pollConfig();
    expect(ground(snapshot).zones).toEqual([
      { zone_id: zoneId, name: 'Patio', sort_order: 0, is_archived: true, routes: [], stock_items: [] },
    ]);
    const stored = async (table: string) =>
      (await cloud.pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE zone_id = $1`, [zoneId])).rows[0].n as number;
    expect([await stored('zone_item_routes'), await stored('zone_stock_items')]).toEqual([1, 1]);
  });

  it('[01a AD-12] `routes[]` and `stock_items[]` are sorted by `item_id`; zones by sort_order, then zone_id', async () => {
    const second = await createZone({
      floor_id: menu.floorId,
      name: 'Hall',
      sort_order: 5,
      routes: [
        { item_id: 'IT-0003', station_id: menu.slotStationId },
        { item_id: 'IT-0000', station_id: menu.slotStationId },
        { item_id: 'IT-0002', station_id: menu.slotStationId },
      ],
      stock_items: [
        { item_id: 'IT-0001', threshold: 4 },
        { item_id: 'IT-0000', threshold: 1 },
      ],
    });
    const first = await createZone({ floor_id: menu.floorId, name: 'Patio', sort_order: 1 });
    const { snapshot } = await pollConfig();
    const zones = ground(snapshot).zones;
    expect(zones.map((zone) => zone.zone_id)).toEqual([first, second]);
    expect(zones[1]!.routes.map((route) => route.item_id)).toEqual(['IT-0000', 'IT-0002', 'IT-0003']);
    expect(zones[1]!.stock_items).toEqual([
      { item_id: 'IT-0000', threshold: 1 },
      { item_id: 'IT-0001', threshold: 4 },
    ]);
    // canonicalJson is stable across two builds
    expect((await pollConfig()).config.snapshot_hash).toBe((await pollConfig()).config.snapshot_hash);
  });

  it('[01a §4.3 V4] only active floors carry zones; a zone of another branch is not delivered', async () => {
    const zoneId = await createZone({ floor_id: menu.floorId, name: 'Patio' });
    const roof = (
      await cloud.app.inject({ method: 'POST', url: `/v1/admin/branches/${f.branches[1]}/floors`, ...owner(f), payload: { name: 'Roof' } })
    ).json().data.floor.floor_id as string;
    const other = await cloud.app.inject({
      method: 'POST',
      url: `/v1/admin/branches/${f.branches[1]}/zones`,
      ...owner(f),
      payload: { floor_id: roof, name: 'Roof zone' },
    });
    expect(other.statusCode).toBe(201);
    const { snapshot } = await pollConfig();
    expect(snapshot.floors.flatMap((floor) => floor.zones.map((zone) => zone.zone_id))).toEqual([zoneId]);
  });
});
