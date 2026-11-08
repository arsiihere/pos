import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('floors', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;
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
  });

  const floorsUrl = (branchId: string) => `/v1/admin/branches/${branchId}/floors`;
  const createFloor = (branchId: string, payload: object, token?: string) =>
    cloud.app.inject({ method: 'POST', url: floorsUrl(branchId), ...owner(f, token), payload });
  const patchFloor = (branchId: string, floorId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `${floorsUrl(branchId)}/${floorId}`, ...owner(f), payload });
  const auditRows = async () =>
    (await cloud.pool.query<{ entity_id: string; action: string; before: unknown; after: unknown }>(
      `SELECT entity_id, action, before, after FROM config_audit ORDER BY at, audit_id`,
    )).rows;
  const versionOf = async (branchId: string) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]))
        .rows[0]!.v,
    );
  const addTable = (branchId: string, floorId: string, tableId: string, archivedAt: number | null = null) =>
    cloud.pool.query(
      `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $3, $5, 0, 0)`,
      [f.tenantId, branchId, tableId, floorId, archivedAt],
    );

  it('[01a §10 #16] create floor; list returns it with its zones and nested tables in 3 statements', async () => {
    const created = await createFloor(f.branches[0], { name: 'Ground', sort_order: 2 });
    expect(created.statusCode).toBe(201);
    const floor = created.json().data.floor;
    expect(floor).toEqual({ floor_id: expect.any(String), name: 'Ground', sort_order: 2, archived_at: null });

    await cloud.pool.query(
      `INSERT INTO dining_tables (tenant_id, branch_id, table_id, floor_id, name, seats, sort_order, created_at, updated_at)
       VALUES ($1, $2, 'T-1', $3, 'T1', 4, 1, 0, 0), ($1, $2, 'T-2', $3, 'T2', NULL, 0, 0, 0)`,
      [f.tenantId, f.branches[0], floor.floor_id],
    );

    const listed = await cloud.app.inject({ method: 'GET', url: floorsUrl(f.branches[0]), ...owner(f) });
    expect(counter.count).toBe(3);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      data: {
        floors: [
          {
            ...floor,
            zones: [],
            tables: [
              { table_id: 'T-2', name: 'T2', seats: null, sort_order: 0, zone_id: null, archived_at: null },
              { table_id: 'T-1', name: 'T1', seats: 4, sort_order: 1, zone_id: null, archived_at: null },
            ],
          },
        ],
      },
    });

    const otherBranch = await cloud.app.inject({ method: 'GET', url: floorsUrl(f.branches[1]), ...owner(f) });
    expect(otherBranch.json()).toEqual({ data: { floors: [] } });
  });

  it('[01a §10 #17] duplicate active floor name (case-insensitive) → 409; same name allowed after archiving the first', async () => {
    const first = await createFloor(f.branches[0], { name: 'Ground' });
    expect(first.statusCode).toBe(201);
    const duplicate = await createFloor(f.branches[0], { name: 'GROUND' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'floor', name: 'GROUND' } });

    await cloud.pool.query(`UPDATE floors SET archived_at = 1 WHERE tenant_id = $1 AND floor_id = $2`, [
      f.tenantId,
      first.json().data.floor.floor_id,
    ]);
    const again = await createFloor(f.branches[0], { name: 'ground' });
    expect(again.statusCode).toBe(201);
  });

  it('[01a §10 #23] path branch not in allowed_branch_ids → 404 BRANCH_NOT_FOUND', async () => {
    const onlyA = f.tokenFor([f.branches[0]]);
    for (const branchId of [f.branches[1], f.other.branchId]) {
      const list = await cloud.app.inject({ method: 'GET', url: floorsUrl(branchId), ...owner(f, onlyA) });
      expect(list.statusCode).toBe(404);
      expect(list.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: branchId } });
      const create = await createFloor(branchId, { name: 'Ground' }, onlyA);
      expect(create.statusCode).toBe(404);
      expect(create.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND', details: { branch_id: branchId } });
    }
    const floors = await cloud.pool.query(`SELECT 1 FROM floors`);
    expect(floors.rowCount).toBe(0);
  });

  it('[01a §10 #80] create floor → one config_audit row: floor / create, before null, after = the floor', async () => {
    const created = await createFloor(f.branches[0], { name: 'Ground' });
    expect(created.statusCode).toBe(201);
    const floor = created.json().data.floor;
    const audit = await cloud.pool.query(
      `SELECT actor_kind, actor_owner_user_id, branch_id, entity, entity_id, action, before, after FROM config_audit`,
    );
    expect(audit.rows).toEqual([
      {
        actor_kind: 'owner',
        actor_owner_user_id: f.userId,
        branch_id: f.branches[0],
        entity: 'floor',
        entity_id: floor.floor_id,
        action: 'create',
        before: null,
        after: floor,
      },
    ]);
  });

  it('[01a §3.3] " ground " is stored as "ground" and duplicates "Ground"', async () => {
    const created = await createFloor(f.branches[0], { name: ' ground ' });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.floor.name).toBe('ground');
    const stored = await cloud.pool.query(`SELECT name FROM floors`);
    expect(stored.rows).toEqual([{ name: 'ground' }]);
    const duplicate = await createFloor(f.branches[0], { name: 'Ground' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('CONFIG_NAME_TAKEN');

    for (const name of ['', '   ', 'x'.repeat(61)]) {
      const bad = await createFloor(f.branches[0], { name });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('[01a S8] create floor bumps only that branch', async () => {
    const versions = async () =>
      (
        await cloud.pool.query<{ branch_id: string; config_version: string }>(
          `SELECT branch_id, config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`,
          [f.tenantId],
        )
      ).rows.map((row) => [row.branch_id, Number(row.config_version)] as const);
    const before = new Map(await versions());
    const created = await createFloor(f.branches[1], { name: 'Roof' });
    expect(created.statusCode).toBe(201);
    const after = new Map(await versions());
    for (const branchId of f.branches) {
      expect(after.get(branchId)).toBe(before.get(branchId)! + (branchId === f.branches[1] ? 1 : 0));
    }
  });

  it('[01a §10 #18] archive floor with an active table → 409 CONFIG_IN_USE listing the table', async () => {
    const floorId = (await createFloor(f.branches[0], { name: 'Ground' })).json().data.floor.floor_id;
    await addTable(f.branches[0], floorId, 'T-B');
    await addTable(f.branches[0], floorId, 'T-A');
    await addTable(f.branches[0], floorId, 'T-OLD', 1);
    const before = await versionOf(f.branches[0]);

    const refused = await patchFloor(f.branches[0], floorId, { archived: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'floor', id: floorId, used_by: { entity: 'table', ids: ['T-A', 'T-B'] } },
    });
    const stored = await cloud.pool.query(`SELECT archived_at FROM floors WHERE floor_id = $1`, [floorId]);
    expect(stored.rows).toEqual([{ archived_at: null }]);
    expect(await versionOf(f.branches[0])).toBe(before);

    await cloud.pool.query(`UPDATE dining_tables SET archived_at = 1 WHERE floor_id = $1`, [floorId]);
    const archived = await patchFloor(f.branches[0], floorId, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.floor.archived_at).toBe(cloud.clock.branchNow());
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: floorId, action: 'archive' });
  });

  it('[01a §10 #19] unknown floor → 404 FLOOR_NOT_FOUND', async () => {
    const unknown = await patchFloor(f.branches[0], 'NO-SUCH-FLOOR', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'FLOOR_NOT_FOUND', details: { floor_id: 'NO-SUCH-FLOOR' } });

    const elsewhere = (await createFloor(f.branches[1], { name: 'Roof' })).json().data.floor.floor_id;
    const wrongBranch = await patchFloor(f.branches[0], elsewhere, { name: 'X' });
    expect(wrongBranch.statusCode).toBe(404);
    expect(wrongBranch.json().error).toMatchObject({ code: 'FLOOR_NOT_FOUND', details: { floor_id: elsewhere } });
  });

  it('[01a §10 #83] replayed create keeps one audit row; a 409 writes none; a failure in the bump writes nothing', async () => {
    const request = { method: 'POST' as const, url: floorsUrl(f.branches[0]), ...owner(f), payload: { name: 'Ground' } };
    const first = await cloud.app.inject(request);
    const replay = await cloud.app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(201);
    expect(replay.headers['idempotent-replay']).toBe('true');
    expect(await auditRows()).toHaveLength(1);

    const taken = await createFloor(f.branches[0], { name: 'ground' });
    expect(taken.statusCode).toBe(409);
    expect(await auditRows()).toHaveLength(1);

    // beforeBump runs after writeConfigAudit, inside the transaction
    let bumpCalls = 0;
    hooks.beforeBump = async () => {
      bumpCalls += 1;
      throw new Error('forced bump failure');
    };
    const failed = await createFloor(f.branches[0], { name: 'Roof' });
    expect(failed.statusCode).toBe(500);
    const floorId = first.json().data.floor.floor_id;
    const failedPatch = await patchFloor(f.branches[0], floorId, { name: 'Renamed' });
    expect(failedPatch.statusCode).toBe(500);
    expect(bumpCalls).toBe(2);
    delete hooks.beforeBump;

    expect(await auditRows()).toHaveLength(1);
    const floors = await cloud.pool.query(`SELECT name FROM floors ORDER BY name`);
    expect(floors.rows).toEqual([{ name: 'Ground' }]);
    const keys = await cloud.pool.query(`SELECT 1 FROM idempotency_keys`); // the 409 and the failed create roll theirs back
    expect(keys.rowCount).toBe(1);
  });

  it('[01a §6.4] restore checks name uniqueness', async () => {
    const firstId = (await createFloor(f.branches[0], { name: 'Ground' })).json().data.floor.floor_id;
    expect((await patchFloor(f.branches[0], firstId, { archived: true })).statusCode).toBe(200);
    expect((await createFloor(f.branches[0], { name: 'GROUND' })).statusCode).toBe(201);

    const restore = await patchFloor(f.branches[0], firstId, { archived: false });
    expect(restore.statusCode).toBe(409);
    expect(restore.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'floor', name: 'Ground' } });

    const renamedRestore = await patchFloor(f.branches[0], firstId, { archived: false, name: 'Upper' });
    expect(renamedRestore.statusCode).toBe(200);
    expect(renamedRestore.json().data.floor).toMatchObject({ name: 'Upper', archived_at: null });
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: firstId, action: 'restore' });
  });

  it('[01a §6.4] rename → 200, audited update, branch bumped', async () => {
    const created = (await createFloor(f.branches[0], { name: 'Ground', sort_order: 1 })).json().data.floor;
    const before = await versionOf(f.branches[0]);
    const otherBefore = await versionOf(f.branches[1]);

    const renamed = await patchFloor(f.branches[0], created.floor_id, { name: ' Lower ', sort_order: 5 });
    expect(renamed.statusCode).toBe(200);
    const floor = renamed.json().data.floor;
    expect(floor).toEqual({ ...created, name: 'Lower', sort_order: 5 });
    expect((await auditRows()).at(-1)).toEqual({ entity_id: created.floor_id, action: 'update', before: created, after: floor });
    expect(await versionOf(f.branches[0])).toBe(before + 1);
    expect(await versionOf(f.branches[1])).toBe(otherBefore);

    const empty = await patchFloor(f.branches[0], created.floor_id, {});
    expect(empty.statusCode).toBe(400);
    const blank = await patchFloor(f.branches[0], created.floor_id, { name: '  ' });
    expect(blank.statusCode).toBe(400);
  });
});
