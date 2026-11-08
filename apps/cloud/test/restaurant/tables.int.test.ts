import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('tables', () => {
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

  const base = (branchId: string) => `/v1/admin/branches/${branchId}`;
  const createFloor = async (branchId: string, name: string): Promise<string> => {
    const created = await cloud.app.inject({ method: 'POST', url: `${base(branchId)}/floors`, ...owner(f), payload: { name } });
    expect(created.statusCode).toBe(201);
    return created.json().data.floor.floor_id as string;
  };
  const createTable = (branchId: string, payload: object) =>
    cloud.app.inject({ method: 'POST', url: `${base(branchId)}/tables`, ...owner(f), payload });
  const patchTable = (branchId: string, tableId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `${base(branchId)}/tables/${tableId}`, ...owner(f), payload });
  const versionOf = async (branchId: string) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]))
        .rows[0]!.v,
    );
  const auditRows = async () =>
    (await cloud.pool.query<{ entity: string; entity_id: string; branch_id: string; action: string; before: unknown; after: unknown }>(
      `SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE entity = 'table' ORDER BY at, audit_id`,
    )).rows;
  const snapshotFloors = async () => {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/v1/sync/config?config_version=0&directory_version=0',
      headers: { authorization: `Bearer ${f.branchKey}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data.config.snapshot.floors as Array<{
      floor_id: string;
      tables: Array<{ table_id: string; name: string; seats: number | null }>;
    }>;
  };

  it('[01a §10 #20] table with seats null → created; in the snapshot with seats null', async () => {
    const floorId = await createFloor(f.branches[0], 'Ground');
    const created = await createTable(f.branches[0], { floor_id: floorId, name: 'Takeaway', seats: null });
    expect(created.statusCode).toBe(201);
    const table = created.json().data.table;
    expect(table).toEqual({
      table_id: expect.any(String),
      floor_id: floorId,
      zone_id: null,
      name: 'Takeaway',
      seats: null,
      sort_order: 0,
      archived_at: null,
    });
    const floors = await snapshotFloors();
    expect(floors).toEqual([
      expect.objectContaining({
        floor_id: floorId,
        tables: [{ table_id: table.table_id, name: 'Takeaway', seats: null, sort_order: 0 }],
      }),
    ]);
    expect(await auditRows()).toEqual([
      { entity: 'table', entity_id: table.table_id, branch_id: f.branches[0], action: 'create', before: null, after: table },
    ]);

    const withSeats = await createTable(f.branches[0], { floor_id: floorId, name: 'T1', seats: 4, sort_order: 2 });
    expect(withSeats.statusCode).toBe(201);
    expect(withSeats.json().data.table).toMatchObject({ seats: 4, sort_order: 2 });
    for (const seats of [0, 101, 2.5]) {
      expect((await createTable(f.branches[0], { floor_id: floorId, name: 'T9', seats })).statusCode).toBe(400);
    }
  });

  it('[01a §10 #21] table on an archived floor or another branch’s floor → 422 CONFIG_REFERENCE_INVALID', async () => {
    const archivedFloor = await createFloor(f.branches[0], 'Old');
    await cloud.pool.query(`UPDATE floors SET archived_at = 1 WHERE floor_id = $1`, [archivedFloor]);
    const otherBranchFloor = await createFloor(f.branches[1], 'Roof');
    const before = await versionOf(f.branches[0]);

    const archived = await createTable(f.branches[0], { floor_id: archivedFloor, name: 'T1' });
    expect(archived.statusCode).toBe(422);
    expect(archived.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'floor_id', reason: 'archived' },
    });
    const elsewhere = await createTable(f.branches[0], { floor_id: otherBranchFloor, name: 'T1' });
    expect(elsewhere.statusCode).toBe(422);
    expect(elsewhere.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'floor_id', reason: 'wrong_branch' },
    });
    const unknown = await createTable(f.branches[0], { floor_id: 'NO-SUCH-FLOOR', name: 'T1' });
    expect(unknown.statusCode).toBe(422);
    expect(unknown.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'floor_id', reason: 'not_found' },
    });

    expect((await cloud.pool.query(`SELECT 1 FROM dining_tables`)).rowCount).toBe(0);
    expect(await auditRows()).toEqual([]);
    expect(await versionOf(f.branches[0])).toBe(before);
  });

  it('[01a §10 #22] unknown table → 404 TABLE_NOT_FOUND', async () => {
    const unknown = await patchTable(f.branches[0], 'NO-SUCH-TABLE', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'TABLE_NOT_FOUND', details: { table_id: 'NO-SUCH-TABLE' } });

    const roof = await createFloor(f.branches[1], 'Roof');
    const elsewhere = (await createTable(f.branches[1], { floor_id: roof, name: 'R1' })).json().data.table.table_id;
    const wrongBranch = await patchTable(f.branches[0], elsewhere, { name: 'X' });
    expect(wrongBranch.statusCode).toBe(404);
    expect(wrongBranch.json().error.code).toBe('TABLE_NOT_FOUND');
  });

  it('[01a §10 #118] PATCH table: rename, move, archive, restore with a taken name, restore', async () => {
    const ground = await createFloor(f.branches[0], 'Ground');
    const upper = await createFloor(f.branches[0], 'Upper');
    const created = (await createTable(f.branches[0], { floor_id: ground, name: 'T1', seats: 4 })).json().data.table;
    const otherBefore = await versionOf(f.branches[1]);

    // rename → 200, audited, branch bumped
    let before = await versionOf(f.branches[0]);
    const renamed = await patchTable(f.branches[0], created.table_id, { name: ' Window ' });
    expect(renamed.statusCode).toBe(200);
    const afterRename = renamed.json().data.table;
    expect(afterRename).toEqual({ ...created, name: 'Window' });
    expect((await auditRows()).at(-1)).toEqual({
      entity: 'table',
      entity_id: created.table_id,
      branch_id: f.branches[0],
      action: 'update',
      before: created,
      after: afterRename,
    });
    expect(await versionOf(f.branches[0])).toBe(before + 1);
    expect(await versionOf(f.branches[1])).toBe(otherBefore);

    // move to another active floor of the branch → under that floor in the next snapshot
    const moved = await patchTable(f.branches[0], created.table_id, { floor_id: upper });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().data.table.floor_id).toBe(upper);
    let floors = await snapshotFloors();
    expect(floors.find((floor) => floor.floor_id === ground)!.tables).toEqual([]);
    expect(floors.find((floor) => floor.floor_id === upper)!.tables.map((t) => t.table_id)).toEqual([created.table_id]);

    // archive → absent from the snapshot
    before = await versionOf(f.branches[0]);
    const archived = await patchTable(f.branches[0], created.table_id, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.table.archived_at).toBe(cloud.clock.branchNow());
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: created.table_id, action: 'archive' });
    expect(await versionOf(f.branches[0])).toBe(before + 1);
    floors = await snapshotFloors();
    expect(floors.flatMap((floor) => floor.tables)).toEqual([]);

    // restore with a name now taken → 409, nothing written
    const taker = await createTable(f.branches[0], { floor_id: ground, name: 'WINDOW' });
    expect(taker.statusCode).toBe(201);
    const auditCount = (await auditRows()).length;
    before = await versionOf(f.branches[0]);
    const taken = await patchTable(f.branches[0], created.table_id, { archived: false });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'table', name: 'Window' } });
    expect(await auditRows()).toHaveLength(auditCount);
    expect(await versionOf(f.branches[0])).toBe(before);

    // restore otherwise → back
    const restored = await patchTable(f.branches[0], created.table_id, { archived: false, name: 'Corner' });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().data.table).toMatchObject({ name: 'Corner', archived_at: null, floor_id: upper });
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: created.table_id, action: 'restore' });
    floors = await snapshotFloors();
    expect(floors.find((floor) => floor.floor_id === upper)!.tables.map((t) => t.name)).toEqual(['Corner']);

    expect((await patchTable(f.branches[0], created.table_id, {})).statusCode).toBe(400);
  });

  it('[01a §6.6] moving a table to another branch’s floor → 422 wrong_branch', async () => {
    const ground = await createFloor(f.branches[0], 'Ground');
    const roof = await createFloor(f.branches[1], 'Roof');
    const table = (await createTable(f.branches[0], { floor_id: ground, name: 'T1' })).json().data.table;
    const before = await versionOf(f.branches[0]);

    const moved = await patchTable(f.branches[0], table.table_id, { floor_id: roof });
    expect(moved.statusCode).toBe(422);
    expect(moved.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'floor_id', reason: 'wrong_branch' },
    });
    const stored = await cloud.pool.query(`SELECT floor_id FROM dining_tables WHERE table_id = $1`, [table.table_id]);
    expect(stored.rows).toEqual([{ floor_id: ground }]);
    expect(await versionOf(f.branches[0])).toBe(before);

    // restoring a table onto a floor archived meanwhile is refused on the merged row
    await cloud.pool.query(`UPDATE dining_tables SET archived_at = 1 WHERE table_id = $1`, [table.table_id]);
    await cloud.pool.query(`UPDATE floors SET archived_at = 1 WHERE floor_id = $1`, [ground]);
    const restore = await patchTable(f.branches[0], table.table_id, { archived: false });
    expect(restore.statusCode).toBe(422);
    expect(restore.json().error.details).toEqual({ field: 'floor_id', reason: 'archived' });
  });

  it('[01a §6.6] floor_id on an archived table, or with archived: true, is still checked → 422, never 500', async () => {
    const ground = await createFloor(f.branches[0], 'Ground');
    const roof = await createFloor(f.branches[1], 'Roof');
    const active = (await createTable(f.branches[0], { floor_id: ground, name: 'T1' })).json().data.table;
    const archived = (await createTable(f.branches[0], { floor_id: ground, name: 'T2' })).json().data.table;
    expect((await patchTable(f.branches[0], archived.table_id, { archived: true })).statusCode).toBe(200);
    const auditCount = (await auditRows()).length;
    const before = await versionOf(f.branches[0]);

    const cases: Array<[string, object, string]> = [
      [archived.table_id, { floor_id: 'NO-SUCH-FLOOR' }, 'not_found'],
      [archived.table_id, { floor_id: roof }, 'wrong_branch'],
      [active.table_id, { archived: true, floor_id: 'NO-SUCH-FLOOR' }, 'not_found'],
      [active.table_id, { archived: true, floor_id: roof }, 'wrong_branch'],
    ];
    for (const [tableId, payload, reason] of cases) {
      const response = await patchTable(f.branches[0], tableId, payload);
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toMatchObject({
        code: 'CONFIG_REFERENCE_INVALID',
        details: { field: 'floor_id', reason },
      });
    }
    const stored = await cloud.pool.query(`SELECT floor_id, archived_at FROM dining_tables ORDER BY name`);
    expect(stored.rows).toEqual([
      { floor_id: ground, archived_at: null },
      { floor_id: ground, archived_at: expect.anything() },
    ]);
    expect(await auditRows()).toHaveLength(auditCount);
    expect(await versionOf(f.branches[0])).toBe(before);
  });
});
