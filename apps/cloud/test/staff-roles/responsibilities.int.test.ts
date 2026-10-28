import type { DefaultKey } from '@pos/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadDirectory } from '../../src/modules/hub-registration/repository';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const T = 1_761_000_000_000;

interface Entry {
  responsibility: 'count_stock';
  station_id: string;
  staff_ids: string[];
  role_ids: string[];
}
interface SetBody {
  responsibilities: Entry[];
  version: string;
}

describe('responsibilities GET / PUT (01b §6.8, §3.6)', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    // The guard's owner-row read is not counted (§6): the count starts when the handler does.
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    cloud.clock.set(T);
    f = await restaurantFixture(cloud);
  });

  const auth = () => ({ authorization: `Bearer ${f.token}` });
  const url = (branchId: string) => `/v1/admin/branches/${branchId}/responsibilities`;
  const roleId = async (key: DefaultKey) =>
    (
      await cloud.pool.query<{ role_id: string }>(`SELECT role_id FROM roles WHERE tenant_id = $1 AND default_key = $2`, [
        f.tenantId,
        key,
      ])
    ).rows[0]!.role_id;
  const station = async (branchId: string, name: string): Promise<string> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: `/v1/admin/branches/${branchId}/stations`,
      ...owner(f),
      payload: { name, station_type: 'slot', capacity: 1 },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().data.station.station_id as string;
  };
  const archiveStation = async (branchId: string, stationId: string, archived: boolean) => {
    const response = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/branches/${branchId}/stations/${stationId}`,
      headers: auth(),
      payload: { archived },
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const person = async (name: string, branchIds: string[]): Promise<string> => {
    const created = await cloud.app.inject({
      method: 'POST',
      url: '/v1/admin/staff',
      ...owner(f),
      payload: { display_name: name, role_ids: [await roleId('cook')], branch_ids: branchIds },
    });
    expect(created.statusCode, created.body).toBe(200);
    return created.json().data.staff.staff_id as string;
  };
  const get = async (branchId: string): Promise<SetBody> => {
    const response = await cloud.app.inject({ method: 'GET', url: url(branchId), headers: auth() });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().data as SetBody;
  };
  const put = (branchId: string, payload: object) => cloud.app.inject({ method: 'PUT', url: url(branchId), headers: auth(), payload });
  const entry = (stationId: string, staffIds: string[], roleIds: string[] = []): Entry => ({
    responsibility: 'count_stock',
    station_id: stationId,
    staff_ids: staffIds,
    role_ids: roleIds,
  });
  const directoryOf = async (branchId: string) => {
    const client = await cloud.pool.connect();
    try {
      return (await loadDirectory(client, f.tenantId, branchId)).directory;
    } finally {
      client.release();
    }
  };
  const directoryVersion = async () =>
    Number((await cloud.pool.query(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [f.tenantId])).rows[0].directory_version);
  const auditRows = async () =>
    (
      await cloud.pool.query(`SELECT entity, entity_id, branch_id, action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'responsibility'`, [
        f.tenantId,
      ])
    ).rows;

  it('[01b #32] PUT replaces the branch\'s set; a station of another branch → 422 wrong_branch; GET returns it', async () => {
    const [a, b] = [f.branches[0], f.branches[1]];
    const grill = await station(a, 'Grill');
    const fryer = await station(a, 'Fryer');
    const other = await station(b, 'Tandoor');
    const ali = await person('Ali', [a]);
    const bilal = await person('Bilal', [a]);
    const cook = await roleId('cook');

    const empty = await get(a);
    expect(empty.responsibilities).toEqual([]);
    const v0 = await directoryVersion();
    const first = await put(a, { expected_version: empty.version, responsibilities: [entry(grill, [bilal, ali]), entry(fryer, [], [cook])] });
    expect(first.statusCode, first.body).toBe(200);
    const firstData = first.json().data;
    expect(firstData.changed_versions).toEqual({ staff: [], roles: [], responsibilities: [] });
    const listed = await get(a);
    expect(listed).toEqual({ responsibilities: firstData.responsibilities, version: firstData.version });
    expect(listed.responsibilities).toEqual(
      [entry(grill, [ali, bilal].sort()), entry(fryer, [], [cook])].sort((x, y) => (x.station_id < y.station_id ? -1 : 1)),
    );
    expect(await directoryVersion()).toBe(v0 + 1);
    expect(await auditRows()).toEqual([
      { entity: 'responsibility', entity_id: a, branch_id: a, action: 'update', before: [], after: listed.responsibilities },
    ]);

    // Replace: grill now Ali only, fryer dropped.
    const second = await put(a, { expected_version: listed.version, responsibilities: [entry(grill, [ali])] });
    expect(second.statusCode, second.body).toBe(200);
    expect((await get(a)).responsibilities).toEqual([entry(grill, [ali])]);

    // A no-op writes nothing.
    const [v1, audits] = [await directoryVersion(), (await auditRows()).length];
    const same = await put(a, { expected_version: second.json().data.version, responsibilities: [entry(grill, [ali])] });
    expect(same.statusCode, same.body).toBe(200);
    expect([await directoryVersion(), (await auditRows()).length]).toEqual([v1, audits]);

    const current = await get(a);
    const wrong = await put(a, { expected_version: current.version, responsibilities: [entry(other, [ali])] });
    expect(wrong.statusCode, wrong.body).toBe(422);
    expect(wrong.json().error).toMatchObject({
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'responsibilities.0.station_id', reason: 'wrong_branch' },
    });
    expect(await get(a)).toEqual(current);
  });

  it('[01b §6.8] PUT rules: stale version, archived station, person not at the branch, archived role, unknown branch', async () => {
    const [a, b] = [f.branches[0], f.branches[1]];
    const grill = await station(a, 'Grill');
    const old = await station(a, 'Old');
    await archiveStation(a, old, true);
    const ali = await person('Ali', [a]);
    const atB = await person('Bilal', [b]);
    const current = await get(a);
    const refused = async (payload: object, status: number, error: object) => {
      const response = await put(a, payload);
      expect(response.statusCode, response.body).toBe(status);
      expect(response.json().error).toMatchObject(error);
    };
    await refused({ expected_version: 'stale', responsibilities: [] }, 409, {
      code: 'CONFIG_STALE',
      details: { entity: 'responsibility', id: a },
    });
    await refused({ expected_version: current.version, responsibilities: [entry(old, [ali])] }, 422, {
      details: { field: 'responsibilities.0.station_id', reason: 'archived' },
    });
    await refused({ expected_version: current.version, responsibilities: [entry(grill, [ali, atB])] }, 422, {
      details: { field: 'responsibilities.0.staff_ids.1', reason: 'not_at_branch' },
    });
    const role = await cloud.app.inject({ method: 'POST', url: '/v1/admin/roles', ...owner(f), payload: { name: 'Gone', idle_minutes: 5, grants: [] } });
    const gone = role.json().data.role;
    await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/roles/${gone.role_id}`,
      headers: auth(),
      payload: { expected_version: gone.version, archived: true },
    });
    await refused({ expected_version: current.version, responsibilities: [entry(grill, [], [gone.role_id])] }, 422, {
      details: { field: 'responsibilities.0.role_ids.0', reason: 'role_archived' },
    });
    await refused({ expected_version: current.version, responsibilities: [entry('nope', [ali])] }, 422, {
      details: { field: 'responsibilities.0.station_id', reason: 'not_found' },
    });
    await refused({ expected_version: current.version, responsibilities: [entry(grill, [ali]), entry(grill, [])] }, 422, {
      code: 'CONFIG_REFERENCE_INVALID',
      details: { field: 'responsibilities.1.station_id' },
    });
    const foreign = await cloud.app.inject({ method: 'GET', url: url(f.other.branchId), headers: auth() });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json().error.code).toBe('BRANCH_NOT_FOUND');
    const foreignPut = await put(f.other.branchId, { expected_version: current.version, responsibilities: [] });
    expect(foreignPut.statusCode, foreignPut.body).toBe(404);
    expect(await get(a)).toEqual(current);
  });

  it('[01b §6.8] GET is 1 statement', async () => {
    const a = f.branches[0];
    const grill = await station(a, 'Grill');
    const ali = await person('Ali', [a]);
    const current = await get(a);
    expect((await put(a, { expected_version: current.version, responsibilities: [entry(grill, [ali])] })).statusCode).toBe(200);
    await get(a);
    expect(counter.count).toBe(1);
  });

  it('[01b #35] an archived station\'s responsibilities are left out of loadDirectory and the GET; restoring the station brings them back', async () => {
    const a = f.branches[0];
    const grill = await station(a, 'Grill');
    const ali = await person('Ali', [a]);
    await cloud.app.inject({ method: 'PUT', url: `/v1/admin/staff/${ali}/pin`, headers: auth(), payload: { pin: '4321' } });
    const current = await get(a);
    expect((await put(a, { expected_version: current.version, responsibilities: [entry(grill, [ali])] })).statusCode).toBe(200);
    expect((await directoryOf(a)).responsibilities).toEqual([entry(grill, [ali])]);

    await archiveStation(a, grill, true);
    expect((await get(a)).responsibilities).toEqual([]);
    expect((await directoryOf(a)).responsibilities).toEqual([]);

    await archiveStation(a, grill, false);
    expect((await get(a)).responsibilities).toEqual([entry(grill, [ali])]);
    expect((await directoryOf(a)).responsibilities).toEqual([entry(grill, [ali])]);
  });

  it('[01b #103] an archived station never makes the set stale; its rows survive a PUT and come back on restore', async () => {
    const a = f.branches[0];
    const s = await station(a, 'Grill');
    const t = await station(a, 'Fryer');
    const ali = await person('Ali', [a]);
    const bilal = await person('Bilal', [a]);
    const start = await get(a);
    expect((await put(a, { expected_version: start.version, responsibilities: [entry(s, [ali]), entry(t, [bilal])] })).statusCode).toBe(200);

    await archiveStation(a, s, true);
    const without = await get(a);
    expect(without.responsibilities).toEqual([entry(t, [bilal])]);
    const first = await put(a, { expected_version: without.version, responsibilities: [entry(t, [ali, bilal])] });
    expect(first.statusCode, first.body).toBe(200);
    const firstData = first.json().data;
    expect(firstData).toMatchObject({ responsibilities: [entry(t, [ali, bilal].sort())], changed_versions: { staff: [], roles: [], responsibilities: [] } });
    expect(typeof firstData.version).toBe('string');
    const kept = await cloud.pool.query(`SELECT subject_id FROM responsibilities WHERE tenant_id = $1 AND station_id = $2`, [f.tenantId, s]);
    expect(kept.rows).toEqual([{ subject_id: ali }]);

    const second = await put(a, { expected_version: firstData.version, responsibilities: [entry(t, [bilal])] });
    expect(second.statusCode, second.body).toBe(200);

    await archiveStation(a, s, false);
    expect((await get(a)).responsibilities).toEqual(
      [entry(s, [ali]), entry(t, [bilal])].sort((x, y) => (x.station_id < y.station_id ? -1 : 1)),
    );
  });
  it('[01b §6.8, AD-19] two entries for one station: 422 with the field and no reason, unless the entries merge to the stored set (no-op → 200)', async () => {
    const a = f.branches[0];
    const grill = await station(a, 'Grill');
    const ali = await person('Ali', [a]);
    const bilal = await person('Bilal', [a]);
    const empty = await get(a);
    const first = await put(a, { expected_version: empty.version, responsibilities: [entry(grill, [ali])] });
    expect(first.statusCode, first.body).toBe(200);
    const stored = await get(a);
    const [v0, audits] = [await directoryVersion(), (await auditRows()).length];

    // The second entry adds nothing, so the entries merge to the stored set: the no-op runs before the duplicate check.
    const same = await put(a, { expected_version: stored.version, responsibilities: [entry(grill, [ali]), entry(grill, [])] });
    expect(same.statusCode, same.body).toBe(200);
    expect(same.json().data).toMatchObject({ responsibilities: stored.responsibilities, version: stored.version });
    expect([await directoryVersion(), (await auditRows()).length]).toEqual([v0, audits]);

    // Repeats are dropped inside one entry only, so the same person in both entries is not the stored set: refused.
    const repeated = await put(a, { expected_version: stored.version, responsibilities: [entry(grill, [ali]), entry(grill, [ali])] });
    expect(repeated.statusCode, repeated.body).toBe(422);
    expect(repeated.json().error.details).toEqual({ field: 'responsibilities.1.station_id' });

    // A change: the duplicate is refused, nothing written.
    const changed = await put(a, { expected_version: stored.version, responsibilities: [entry(grill, [ali]), entry(grill, [bilal])] });
    expect(changed.statusCode, changed.body).toBe(422);
    expect(changed.json().error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'responsibilities.1.station_id' } });
    expect(changed.json().error.details).not.toHaveProperty('reason');
    expect(await get(a)).toEqual(stored);
  });
});
