import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

interface PointWire {
  point_id: string;
  name: string;
  sort_order: number;
  archived_at: number | null;
  version: string;
}

describe('points', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  const hooks: { afterTargetLock?: () => Promise<void>; beforeBump?: () => Promise<void> } = {};

  beforeAll(async () => {
    cloud = await createTestCloud({
      captureLogs: true,
      testHooks: {
        afterTargetLock: () => hooks.afterTargetLock?.() ?? Promise.resolve(),
        beforeBump: () => hooks.beforeBump?.() ?? Promise.resolve(),
      },
    });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    delete hooks.afterTargetLock;
    delete hooks.beforeBump;
    f = await restaurantFixture(cloud);
  });

  const pointsUrl = (branchId: string) => `/v1/admin/branches/${branchId}/points`;
  const post = (payload: object, branchId = f.branches[0]) =>
    cloud.app.inject({ method: 'POST', url: pointsUrl(branchId), ...owner(f), payload });
  const patch = (pointId: string, payload: object, branchId = f.branches[0]) =>
    cloud.app.inject({ method: 'PATCH', url: `${pointsUrl(branchId)}/${pointId}`, ...owner(f), payload });
  const add = async (name: string, branchId = f.branches[0]): Promise<PointWire> => {
    const created = await post({ name }, branchId);
    expect(created.statusCode, created.body).toBe(201);
    return created.json().data.point as PointWire;
  };
  const postStation = (payload: object) =>
    cloud.app.inject({ method: 'POST', url: `/v1/admin/branches/${f.branches[0]}/stations`, ...owner(f), payload });
  const addStation = async (name: string, pointId: string): Promise<string> => {
    const created = await postStation({ name, station_type: 'slot', capacity: 1, point_id: pointId });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().data.station.station_id as string;
  };
  const archiveStation = async (stationId: string) => {
    const archived = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/branches/${f.branches[0]}/stations/${stationId}`,
      ...owner(f),
      payload: { archived: true },
    });
    expect(archived.statusCode, archived.body).toBe(200);
  };
  const versionOf = async (branchId = f.branches[0]) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId])).rows[0]!.v,
    );
  const pointAudit = async () =>
    (
      await cloud.pool.query<{ entity_id: string; branch_id: string; action: string; before: unknown; after: unknown }>(
        `SELECT entity_id, branch_id, action, before, after FROM config_audit WHERE entity = 'point' ORDER BY at, audit_id`,
      )
    ).rows;
  const passOf = async (branchId = f.branches[0]) =>
    (await cloud.pool.query<{ point_id: string }>(`SELECT point_id FROM points WHERE branch_id = $1 AND name = 'Pass'`, [branchId]))
      .rows[0]!.point_id;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('[01a §6.9a] POST { name, sort_order? } → 201 with the wire, the branch bumped, one point / create audit row', async () => {
    const before = await versionOf();
    const sibling = await versionOf(f.branches[1]);
    const created = await post({ name: '  Window  ', sort_order: 4 });
    expect(created.statusCode).toBe(201);
    const point = created.json().data.point as PointWire;
    expect(point).toEqual({ point_id: point.point_id, name: 'Window', sort_order: 4, archived_at: null, version: expect.any(String) });
    expect((await add('Door')).sort_order).toBe(0);
    expect(await versionOf()).toBe(before + 2);
    expect(await versionOf(f.branches[1])).toBe(sibling);
    const audit = await pointAudit();
    expect(audit[0]).toMatchObject({ entity_id: point.point_id, branch_id: f.branches[0], action: 'create', before: null });
    expect(audit[0]!.after).toMatchObject({ point_id: point.point_id, name: 'Window', sort_order: 4, archived_at: null });
  });

  it('[01a §5.2a A-1] a name is 1–40 characters after trimming; anything else → 400', async () => {
    expect((await post({ name: 'x'.repeat(41) })).statusCode).toBe(400);
    expect((await post({ name: '   ' })).statusCode).toBe(400);
    expect((await post({})).statusCode).toBe(400);
    expect((await add('y'.repeat(40))).name).toHaveLength(40);
    const { point_id, version } = await add('Door');
    expect((await patch(point_id, { expected_version: version, name: 'x'.repeat(41) })).statusCode).toBe(400);
  });

  it('[01a §6.9a] POST without Idempotency-Key → 400; nothing written', async () => {
    const headers = { authorization: owner(f).headers.authorization! };
    const before = await versionOf();
    const response = await cloud.app.inject({ method: 'POST', url: pointsUrl(f.branches[0]), headers, payload: { name: 'Window' } });
    expect(response.statusCode).toBe(400);
    expect(await pointAudit()).toEqual([]);
    expect(await versionOf()).toBe(before);
  });

  it('[01a §6.9a] a retransmit answers the same 201: one row, one audit row, one bump', async () => {
    const before = await versionOf();
    const request = { method: 'POST' as const, url: pointsUrl(f.branches[0]), ...owner(f), payload: { name: 'Window' } };
    const first = await cloud.app.inject(request);
    const second = await cloud.app.inject(request);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await pointAudit()).toHaveLength(1);
    expect(await versionOf()).toBe(before + 1);
    const rows = await cloud.pool.query(`SELECT 1 FROM points WHERE branch_id = $1 AND name = 'Window'`, [f.branches[0]]);
    expect(rows.rowCount).toBe(1);
  });

  it('[01a §6.9a] a duplicate active name → 409 CONFIG_NAME_TAKEN; another branch and an archived name are free', async () => {
    const first = await add('Window');
    const duplicate = await post({ name: 'Window' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'point', name: 'Window' } });
    expect((await post({ name: 'Pass' })).statusCode).toBe(409);
    await add('Window', f.branches[1]);
    expect((await patch(first.point_id, { expected_version: first.version, archived: true })).statusCode).toBe(200);
    await add('Window');
  });

  it('[01a §6.9a] PATCH renames, sorts, archives and restores on expected_version, each with its audit action and a bump', async () => {
    const point = await add('Window');
    const start = await versionOf();

    const renamed = await patch(point.point_id, { expected_version: point.version, name: 'Door' });
    expect(renamed.statusCode).toBe(200);
    const afterRename = renamed.json().data.point as PointWire;
    expect(afterRename).toMatchObject({ point_id: point.point_id, name: 'Door', sort_order: 0, archived_at: null });
    expect(afterRename.version).not.toBe(point.version);

    const sorted = await patch(point.point_id, { expected_version: afterRename.version, sort_order: 7 });
    expect(sorted.statusCode).toBe(200);
    const afterSort = sorted.json().data.point as PointWire;
    expect(afterSort.sort_order).toBe(7);
    expect(afterSort.version).not.toBe(afterRename.version);

    const archived = await patch(point.point_id, { expected_version: afterSort.version, archived: true });
    expect(archived.statusCode).toBe(200);
    const afterArchive = archived.json().data.point as PointWire;
    expect(afterArchive.archived_at).toEqual(expect.any(Number));
    expect(afterArchive.version).not.toBe(afterSort.version);

    const restored = await patch(point.point_id, { expected_version: afterArchive.version, archived: false });
    expect(restored.statusCode).toBe(200);
    const afterRestore = restored.json().data.point as PointWire;
    expect(afterRestore.archived_at).toBeNull();
    expect(afterRestore.version).toBe(afterSort.version);

    expect((await pointAudit()).map((row) => row.action)).toEqual(['create', 'update', 'update', 'archive', 'restore']);
    expect(await versionOf()).toBe(start + 4);
  });

  it('[01a §6.9a R30] the listed version is the wire version and is accepted by a PATCH', async () => {
    const point = await add('Window');
    const listed = await cloud.app.inject({ method: 'GET', url: `/v1/admin/branches/${f.branches[0]}/stations`, ...owner(f) });
    const row = (listed.json().data.points as PointWire[]).find((p) => p.point_id === point.point_id);
    expect(row).toEqual(point);
    const pass = (listed.json().data.points as PointWire[]).find((p) => p.name === 'Pass')!;
    expect(pass.version).toEqual(expect.any(String));
    expect((await patch(pass.point_id, { expected_version: pass.version, sort_order: 1 })).statusCode).toBe(200);
  });

  it('[01a §6.9a R30, C9] expected_version is required; a PATCH with only expected_version → 400', async () => {
    const point = await add('Window');
    for (const payload of [{ expected_version: point.version }, { name: 'Door' }, {}]) {
      const response = await patch(point.point_id, payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('[01a §6.9a R30] stale expected_version → 409 CONFIG_STALE { entity, id }, a stale no-op too; nothing written', async () => {
    const point = await add('Window');
    const renamed = await patch(point.point_id, { expected_version: point.version, name: 'Door' });
    const current = renamed.json().data.point as PointWire;
    const audit = (await pointAudit()).length;
    const version = await versionOf();
    for (const payload of [{ name: 'Other' }, { name: 'Door' }]) {
      const stale = await patch(point.point_id, { expected_version: point.version, ...payload });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error).toMatchObject({ code: 'CONFIG_STALE', details: { entity: 'point', id: point.point_id } });
    }
    expect((await pointAudit()).length).toBe(audit);
    expect(await versionOf()).toBe(version);
    expect(current.name).toBe('Door');
  });

  it('[01a §6.9a S26] a PATCH that changes nothing → 200 with the same version, no audit row, no bump', async () => {
    const point = await add('Window');
    const audit = (await pointAudit()).length;
    const version = await versionOf();
    const same = await patch(point.point_id, { expected_version: point.version, name: 'Window', sort_order: 0, archived: false });
    expect(same.statusCode).toBe(200);
    expect(same.json().data.point).toEqual(point);
    expect((await pointAudit()).length).toBe(audit);
    expect(await versionOf()).toBe(version);
  });

  it('[01a §12.3 Q-v2.1-1] an unknown point_id, another branch\'s and another tenant\'s → 404 POINT_NOT_FOUND', async () => {
    const elsewhere = await add('Window', f.branches[1]);
    const foreign = await passOf(f.other.branchId);
    for (const pointId of ['PT-MISSING', elsewhere.point_id, foreign]) {
      const response = await patch(pointId, { expected_version: 'any', name: 'Door' });
      expect(response.statusCode, pointId).toBe(404);
      expect(response.json().error).toMatchObject({ code: 'POINT_NOT_FOUND', details: { point_id: pointId } });
    }
  });

  it('[01a §6.0, S19] a branch outside the owner\'s list → 404 BRANCH_NOT_FOUND for both routes', async () => {
    const point = await add('Window', f.branches[1]);
    const onlyA = f.tokenFor([f.branches[0]]);
    const url = pointsUrl(f.branches[1]);
    const created = await cloud.app.inject({ method: 'POST', url, ...owner(f, onlyA), payload: { name: 'Door' } });
    expect(created.statusCode).toBe(404);
    expect(created.json().error.code).toBe('BRANCH_NOT_FOUND');
    const patched = await cloud.app.inject({
      method: 'PATCH',
      url: `${url}/${point.point_id}`,
      ...owner(f, onlyA),
      payload: { expected_version: point.version, name: 'Door' },
    });
    expect(patched.statusCode).toBe(404);
    expect(patched.json().error.code).toBe('BRANCH_NOT_FOUND');
  });

  it('[01a §12.3 Q-v2.1-2] archiving a point an active station names → 409 CONFIG_IN_USE with the active ids only', async () => {
    const point = await add('Window');
    const a = await addStation('A', point.point_id);
    const b = await addStation('B', point.point_id);
    const gone = await addStation('Gone', point.point_id);
    await archiveStation(gone);
    const audit = (await pointAudit()).length;
    const version = await versionOf();
    const refused = await patch(point.point_id, { expected_version: point.version, archived: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'point', id: point.point_id, used_by: { entity: 'station', ids: [a, b].sort() } },
    });
    expect((await pointAudit()).length).toBe(audit);
    expect(await versionOf()).toBe(version);
  });

  it('[01a §12.3 Q-v2.1-2] a point only archived stations name archives → 200', async () => {
    const point = await add('Window');
    await archiveStation(await addStation('Gone', point.point_id));
    const archived = await patch(point.point_id, { expected_version: point.version, archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.point.archived_at).toEqual(expect.any(Number));
  });

  it('[01a §6.9a] a rename into an active name and a restore onto one → 409 CONFIG_NAME_TAKEN', async () => {
    const old = await add('Window');
    const archived = (await patch(old.point_id, { expected_version: old.version, archived: true })).json().data.point as PointWire;
    const fresh = await add('Window');
    const restore = await patch(old.point_id, { expected_version: archived.version, archived: false });
    expect(restore.statusCode).toBe(409);
    expect(restore.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'point', name: 'Window' } });
    const rename = await patch(fresh.point_id, { expected_version: fresh.version, name: 'Pass' });
    expect(rename.statusCode).toBe(409);
    expect(rename.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'point', name: 'Pass' } });
    // a restore under a free name in the same PATCH goes through
    const renamed = await patch(old.point_id, { expected_version: archived.version, archived: false, name: 'Door' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.point).toMatchObject({ name: 'Door', archived_at: null });
  });

  it('[01a §6.9a] the "Pass" point can be renamed', async () => {
    const listed = await cloud.app.inject({ method: 'GET', url: `/v1/admin/branches/${f.branches[0]}/stations`, ...owner(f) });
    const pass = (listed.json().data.points as PointWire[]).find((p) => p.name === 'Pass')!;
    const renamed = await patch(pass.point_id, { expected_version: pass.version, name: 'Counter' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.point.name).toBe('Counter');
  });

  it('[01a §12.3 Q-v2.1-2] an archive holding the point: a station POST naming it waits, then 422 archived', async () => {
    const point = await add('Window');
    let locked!: () => void;
    const isLocked = new Promise<void>((resolve) => {
      locked = resolve;
    });
    hooks.afterTargetLock = async () => {
      locked();
      await pause();
    };
    const archive = patch(point.point_id, { expected_version: point.version, archived: true });
    await isLocked;
    delete hooks.afterTargetLock;
    const station = await postStation({ name: 'Late', station_type: 'slot', capacity: 1, point_id: point.point_id });
    expect((await archive).statusCode).toBe(200);
    expect(station.statusCode).toBe(422);
    expect(station.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'point_id', reason: 'archived' } });
  });

  it('[01a §12.3 Q-v2.1-2] a station POST holding the point FOR SHARE: the archive waits, then sees the station → 409', async () => {
    const point = await add('Window');
    let held!: () => void;
    const isHeld = new Promise<void>((resolve) => {
      held = resolve;
    });
    hooks.beforeBump = async () => {
      held();
      await pause();
    };
    const station = postStation({ name: 'First', station_type: 'slot', capacity: 1, point_id: point.point_id });
    await isHeld;
    delete hooks.beforeBump;
    const archive = await patch(point.point_id, { expected_version: point.version, archived: true });
    const created = await station;
    expect(created.statusCode).toBe(201);
    expect(archive.statusCode).toBe(409);
    expect(archive.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { used_by: { entity: 'station', ids: [created.json().data.station.station_id] } },
    });
  });
});
