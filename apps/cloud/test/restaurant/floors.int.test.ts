import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('floors', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;

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
  });

  const floorsUrl = (branchId: string) => `/v1/admin/branches/${branchId}/floors`;
  const createFloor = (branchId: string, payload: object, token?: string) =>
    cloud.app.inject({ method: 'POST', url: floorsUrl(branchId), ...owner(f, token), payload });

  it('[01a §10 #16] create floor; list returns it with nested tables in 2 statements', async () => {
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
    expect(counter.count).toBe(2);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      data: {
        floors: [
          {
            ...floor,
            tables: [
              { table_id: 'T-2', name: 'T2', seats: null, sort_order: 0, archived_at: null },
              { table_id: 'T-1', name: 'T1', seats: 4, sort_order: 1, archived_at: null },
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
      expect(list.json().error.code).toBe('BRANCH_NOT_FOUND');
      const create = await createFloor(branchId, { name: 'Ground' }, onlyA);
      expect(create.statusCode).toBe(404);
      expect(create.json().error.code).toBe('BRANCH_NOT_FOUND');
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
});
