import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('batch programs', () => {
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

  const stationsUrl = (branchId: string) => `/v1/admin/branches/${branchId}/stations`;
  const createStation = async (branchId: string, payload: object): Promise<string> => {
    const created = await cloud.app.inject({ method: 'POST', url: stationsUrl(branchId), ...owner(f), payload });
    expect(created.statusCode).toBe(201);
    return created.json().data.station.station_id as string;
  };
  const programsUrl = (branchId: string, stationId: string) => `${stationsUrl(branchId)}/${stationId}/programs`;
  const createProgram = (branchId: string, stationId: string, payload: object) =>
    cloud.app.inject({ method: 'POST', url: programsUrl(branchId, stationId), ...owner(f), payload });
  const patchProgram = (branchId: string, stationId: string, programId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `${programsUrl(branchId, stationId)}/${programId}`, ...owner(f), payload });
  const versionOf = async (branchId: string) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]))
        .rows[0]!.v,
    );
  const auditRows = async () =>
    (await cloud.pool.query<{ entity_id: string; branch_id: string; action: string; before: unknown; after: unknown }>(
      `SELECT entity_id, branch_id, action, before, after FROM config_audit WHERE entity = 'batch_program' ORDER BY at, audit_id`,
    )).rows;
  const snapshotStations = async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.config.snapshot.stations as Array<{
      station_id: string;
      programs: Array<{ program_id: string; name: string; cook_time_ms: number; is_archived: boolean }>;
    }>;
  };
  const addRoute = async (stationId: string, itemId: string, route: { program_id: string; stock_program_id?: string }) => {
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'CAT-1', 'Mains', 0, 0)
       ON CONFLICT DO NOTHING`,
      [f.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, $2, 'CAT-1', $2, 100, 'immediate', 60000, 0, 0)`,
      [f.tenantId, itemId],
    );
    await cloud.pool.query(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, stock_program_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0)`,
      [f.tenantId, f.branches[0], itemId, stationId, route.program_id, route.stock_program_id ?? null],
    );
  };

  it('[01a §10 #28] program on a slot station → 422 CONFIG_REFERENCE_INVALID (program_not_allowed)', async () => {
    const slot = await createStation(f.branches[0], { name: 'Tawa', station_type: 'slot', capacity: 4 });
    const archivedBatch = await createStation(f.branches[0], { name: 'Old fryer', station_type: 'batch', capacity: 1 });
    await cloud.pool.query(`UPDATE stations SET archived_at = 1 WHERE station_id = $1`, [archivedBatch]);
    const otherBranch = await createStation(f.branches[1], { name: 'Fryer', station_type: 'batch', capacity: 1 });
    const before = await versionOf(f.branches[0]);

    const onSlot = await createProgram(f.branches[0], slot, { name: 'Fries', cook_time_ms: 300000 });
    expect(onSlot.statusCode).toBe(422);
    expect(onSlot.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'station_id', reason: 'program_not_allowed' },
    });
    const onArchived = await createProgram(f.branches[0], archivedBatch, { name: 'Fries', cook_time_ms: 300000 });
    expect(onArchived.statusCode).toBe(422);
    expect(onArchived.json().error.details).toEqual({ field: 'station_id', reason: 'archived' });
    const onOtherBranch = await createProgram(f.branches[0], otherBranch, { name: 'Fries', cook_time_ms: 300000 });
    expect(onOtherBranch.statusCode).toBe(422);
    expect(onOtherBranch.json().error.details).toEqual({ field: 'station_id', reason: 'not_found' });

    expect((await cloud.pool.query(`SELECT 1 FROM batch_programs`)).rowCount).toBe(0);
    expect(await auditRows()).toEqual([]);
    expect(await versionOf(f.branches[0])).toBe(before);
  });

  it('[01a §10 #29] archive a program used as stock_program_id → 409 CONFIG_IN_USE', async () => {
    const fryer = await createStation(f.branches[0], { name: 'Fryer', station_type: 'batch', capacity: 2 });
    const cook = (await createProgram(f.branches[0], fryer, { name: 'Cook', cook_time_ms: 300000 })).json().data.program;
    const hold = (await createProgram(f.branches[0], fryer, { name: 'Hold', cook_time_ms: 60000 })).json().data.program;
    await addRoute(fryer, 'ITEM-A', { program_id: cook.program_id, stock_program_id: hold.program_id });
    const before = await versionOf(f.branches[0]);

    const stock = await patchProgram(f.branches[0], fryer, hold.program_id, { archived: true });
    expect(stock.statusCode).toBe(409);
    expect(stock.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'batch_program', id: hold.program_id, used_by: { entity: 'menu_item', ids: ['ITEM-A'] } },
    });
    expect(await versionOf(f.branches[0])).toBe(before);

    await cloud.pool.query(`UPDATE menu_items SET archived_at = 1 WHERE item_id = 'ITEM-A'`);
    const archived = await patchProgram(f.branches[0], fryer, hold.program_id, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: hold.program_id, action: 'archive' });
  });

  it('[01a §10 #30] unknown program → 404 PROGRAM_NOT_FOUND', async () => {
    const fryer = await createStation(f.branches[0], { name: 'Fryer', station_type: 'batch', capacity: 2 });
    const grill = await createStation(f.branches[0], { name: 'Grill', station_type: 'batch', capacity: 2 });
    const unknown = await patchProgram(f.branches[0], fryer, 'NO-SUCH-PROGRAM', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'PROGRAM_NOT_FOUND', details: { program_id: 'NO-SUCH-PROGRAM' } });

    const onGrill = (await createProgram(f.branches[0], grill, { name: 'Tikka', cook_time_ms: 300000 })).json().data.program;
    const wrongStation = await patchProgram(f.branches[0], fryer, onGrill.program_id, { name: 'X' });
    expect(wrongStation.statusCode).toBe(404);
    expect(wrongStation.json().error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('[01a §10 #119] POST program on a batch station → 201, in the snapshot; PATCH cook_time_ms → audited update, branch bumped', async () => {
    const fryer = await createStation(f.branches[0], { name: 'Fryer', station_type: 'batch', capacity: 2 });
    const created = await createProgram(f.branches[0], fryer, { name: ' Fries ', cook_time_ms: 300000 });
    expect(created.statusCode).toBe(201);
    const program = created.json().data.program;
    expect(program).toEqual({
      program_id: expect.any(String),
      station_id: fryer,
      name: 'Fries',
      cook_time_ms: 300000,
      archived_at: null,
    });
    expect(await auditRows()).toEqual([
      { entity_id: program.program_id, branch_id: f.branches[0], action: 'create', before: null, after: program },
    ]);
    let stations = await snapshotStations();
    expect(stations.find((s) => s.station_id === fryer)!.programs).toEqual([
      { program_id: program.program_id, name: 'Fries', cook_time_ms: 300000, is_archived: false },
    ]);

    const before = await versionOf(f.branches[0]);
    const otherBefore = await versionOf(f.branches[1]);
    const patched = await patchProgram(f.branches[0], fryer, program.program_id, { cook_time_ms: 420000 });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.program).toEqual({ ...program, cook_time_ms: 420000 });
    expect((await auditRows()).at(-1)).toEqual({
      entity_id: program.program_id,
      branch_id: f.branches[0],
      action: 'update',
      before: program,
      after: { ...program, cook_time_ms: 420000 },
    });
    expect(await versionOf(f.branches[0])).toBe(before + 1);
    expect(await versionOf(f.branches[1])).toBe(otherBefore);
    stations = await snapshotStations();
    expect(stations.find((s) => s.station_id === fryer)!.programs[0]!.cook_time_ms).toBe(420000);

    // names unique per station; ranges are 400
    expect((await createProgram(f.branches[0], fryer, { name: 'FRIES', cook_time_ms: 1 })).statusCode).toBe(409);
    for (const cook_time_ms of [0, 14_400_001]) {
      expect((await createProgram(f.branches[0], fryer, { name: 'X', cook_time_ms })).statusCode).toBe(400);
    }
    expect((await patchProgram(f.branches[0], fryer, program.program_id, {})).statusCode).toBe(400);
  });

  it('[01a §6.10] archiving a program used as program_id → 409', async () => {
    const fryer = await createStation(f.branches[0], { name: 'Fryer', station_type: 'batch', capacity: 2 });
    const cook = (await createProgram(f.branches[0], fryer, { name: 'Cook', cook_time_ms: 300000 })).json().data.program;
    await addRoute(fryer, 'ITEM-B', { program_id: cook.program_id });
    await addRoute(fryer, 'ITEM-A', { program_id: cook.program_id });

    const refused = await patchProgram(f.branches[0], fryer, cook.program_id, { archived: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'batch_program', id: cook.program_id, used_by: { entity: 'menu_item', ids: ['ITEM-A', 'ITEM-B'] } },
    });

    // restoring a program onto a station that became slot is refused on the merged row
    await cloud.pool.query(`DELETE FROM item_routes`);
    expect((await patchProgram(f.branches[0], fryer, cook.program_id, { archived: true })).statusCode).toBe(200);
    await cloud.pool.query(`UPDATE stations SET station_type = 'slot', freshness_window_ms = NULL WHERE station_id = $1`, [fryer]);
    const restore = await patchProgram(f.branches[0], fryer, cook.program_id, { archived: false });
    expect(restore.statusCode).toBe(422);
    expect(restore.json().error.details).toEqual({ field: 'station_id', reason: 'program_not_allowed' });
  });
});
