import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const ENGINE_DEFAULTS = {
  policy: 'waada_guard',
  freeze_ms: 120_000,
  min_slack_keep_ms: 60_000,
  promise_padding_ms: null,
  pressure_window_ms: 900_000,
  pressure_amber_bp: 8_000,
  pressure_red_bp: 10_000,
  pressure_alert_ms: 300_000,
  pause_enabled: false,
  lane_units: null,
  reserve_units: 0,
  alternates: [],
  carry_times: [],
};

describe('station engine fields', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;
  let holdAfterLock = 0;

  beforeAll(async () => {
    cloud = await createTestCloud({
      captureLogs: true,
      testHooks: {
        handlerStart: () => counter.reset(),
        afterTargetLock: () => new Promise((resolve) => setTimeout(resolve, holdAfterLock)),
      },
    });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    holdAfterLock = 0;
    f = await restaurantFixture(cloud);
  });

  const stationsUrl = (branchId: string) => `/v1/admin/branches/${branchId}/stations`;
  const post = (payload: object, branchId = f.branches[0]) =>
    cloud.app.inject({ method: 'POST', url: stationsUrl(branchId), ...owner(f), payload });
  const patch = (stationId: string, payload: object, branchId = f.branches[0]) =>
    cloud.app.inject({ method: 'PATCH', url: `${stationsUrl(branchId)}/${stationId}`, ...owner(f), payload });
  const list = (branchId = f.branches[0]) => cloud.app.inject({ method: 'GET', url: stationsUrl(branchId), ...owner(f) });
  const addStation = async (name: string, extra: object = {}, branchId = f.branches[0]): Promise<string> => {
    const created = await post({ name, station_type: 'slot', capacity: 100, ...extra }, branchId);
    expect(created.statusCode, created.body).toBe(201);
    return created.json().data.station.station_id as string;
  };
  const passOf = async (branchId = f.branches[0]): Promise<string> =>
    (
      await cloud.pool.query<{ point_id: string }>(
        `SELECT point_id FROM points WHERE branch_id = $1 AND name = 'Pass'`,
        [branchId],
      )
    ).rows[0]!.point_id;
  const addPoint = async (pointId: string, name: string, o: { sort?: number; archived?: boolean; branchId?: string } = {}) => {
    await cloud.pool.query(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, sort_order, archived_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0)`,
      [f.tenantId, o.branchId ?? f.branches[0], pointId, name, o.sort ?? 0, o.archived === true ? 1 : null],
    );
    return pointId;
  };
  const versionOf = async (branchId = f.branches[0]) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]))
        .rows[0]!.v,
    );
  const auditOf = async (stationId: string) =>
    (
      await cloud.pool.query<{ action: string; before: { alternates?: unknown; carry_times?: unknown }; after: { alternates?: unknown; carry_times?: unknown } }>(
        `SELECT action, before, after FROM config_audit WHERE entity = 'station' AND entity_id = $1 ORDER BY at, audit_id`,
        [stationId],
      )
    ).rows;
  const expectError = (
    response: Awaited<ReturnType<typeof post>>,
    status: number,
    code: string,
    details?: object,
  ) => {
    expect(response.statusCode, response.body).toBe(status);
    expect(response.json().error).toMatchObject({ code, ...(details !== undefined ? { details } : {}) });
  };
  const alternate = (id: string, o: { order_types?: string[]; home?: string[] } = {}) => ({
    alternate_station_id: id,
    order_types: o.order_types ?? ['dine_in'],
    home_for_order_types: o.home ?? [],
  });

  it('[01a §6.9 A-2–A-8] POST with defaults returns every engine field, on the branch\'s Pass', async () => {
    const created = await post({ name: 'Tawa', station_type: 'slot', capacity: 4 });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.station).toEqual({
      station_id: expect.any(String),
      name: 'Tawa',
      location_label: null,
      station_type: 'slot',
      capacity: 4,
      freshness_window_ms: null,
      completion_mode: 'two_tap',
      archived_at: null,
      point_id: await passOf(),
      ...ENGINE_DEFAULTS,
    });
  });

  it('[01a §6.9 A-2–A-10] POST accepts the engine fields and both lists; the audit row carries them', async () => {
    const other = await addStation('Grill');
    const point = await addPoint('PT-2', 'Counter', { sort: 2 });
    const created = await post({
      name: 'Tawa',
      station_type: 'slot',
      capacity: 10,
      point_id: point,
      policy: 'edf',
      freeze_ms: 0,
      min_slack_keep_ms: 0,
      promise_padding_ms: 0,
      pressure_window_ms: 300_000,
      pressure_amber_bp: 1,
      pressure_red_bp: 2,
      pressure_alert_ms: 60_000,
      pause_enabled: true,
      lane_units: 5,
      reserve_units: 10,
      alternates: [alternate(other, { order_types: ['takeaway', 'dine_in'], home: ['takeaway'] })],
      carry_times: [{ point_id: point, carry_ms: 30_000 }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const station = created.json().data.station;
    expect(station).toMatchObject({
      point_id: point,
      policy: 'edf',
      reserve_units: 10,
      lane_units: 5,
      alternates: [{ alternate_station_id: other, order_types: ['dine_in', 'takeaway'], home_for_order_types: ['takeaway'] }],
      carry_times: [{ point_id: point, carry_ms: 30_000 }],
    });
    const audit = await auditOf(station.station_id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.after).toMatchObject({ alternates: station.alternates, carry_times: station.carry_times });
    const listed = (await list()).json().data.stations.find((s: { station_id: string }) => s.station_id === station.station_id);
    expect(listed).toEqual({ ...station, programs: [] });
  });

  // Each field at both range ends (200), then one past each end (400).
  const RANGES: Array<[string, Array<number | string | boolean | null>, unknown[]]> = [
    ['policy', ['waada_guard', 'edf', 'fifo'], ['lifo']],
    ['freeze_ms', [0, 900_000], [-1, 900_001]],
    ['min_slack_keep_ms', [0, 600_000], [-1, 600_001]],
    ['promise_padding_ms', [null, 0, 1_800_000], [-1, 1_800_001]],
    ['pressure_window_ms', [300_000, 3_600_000], [299_999, 3_600_001]],
    ['pressure_alert_ms', [60_000, 3_600_000], [59_999, 3_600_001]],
    ['pause_enabled', [true, false], ['yes']],
    ['lane_units', [null, 1, 100], [0, 101]],
    ['reserve_units', [0, 100], [-1, 101]],
  ];
  it.each(RANGES)('[01a §6.9 A-3–A-8] PATCH %s at the range ends and one past', async (field, good, bad) => {
    const id = await addStation('Tawa');
    for (const value of good) {
      const ok = await patch(id, { [field]: value });
      expect(ok.statusCode, `${field}=${String(value)} ${ok.body}`).toBe(200);
      expect(ok.json().data.station[field]).toBe(value);
    }
    for (const value of bad) {
      expect((await patch(id, { [field]: value })).statusCode, `${field}=${String(value)}`).toBe(400);
    }
  });

  it('[01a §6.9 A-7] pressure bp at the range ends and one past', async () => {
    const id = await addStation('Tawa');
    expect((await patch(id, { pressure_amber_bp: 1 })).statusCode).toBe(200);
    expect((await patch(id, { pressure_red_bp: 20_000 })).statusCode).toBe(200);
    expect((await patch(id, { pressure_amber_bp: 0 })).statusCode).toBe(400);
    expect((await patch(id, { pressure_red_bp: 20_001 })).statusCode).toBe(400);
  });

  it('[01a §6.9 A-7, A-8 ruling 2] a merged row above capacity or amber ≥ red → 400, never a 500', async () => {
    const id = await addStation('Tawa', { capacity: 4 });
    expectError(await patch(id, { lane_units: 5 }), 400, 'VALIDATION_FAILED');
    expectError(await patch(id, { reserve_units: 5 }), 400, 'VALIDATION_FAILED');
    expectError(await patch(id, { pressure_amber_bp: 10_000 }), 400, 'VALIDATION_FAILED');
    expectError(await patch(id, { pressure_red_bp: 8_000 }), 400, 'VALIDATION_FAILED');
    expect((await patch(id, { lane_units: 4, reserve_units: 4 })).statusCode).toBe(200);
    expectError(await patch(id, { capacity: 3 }), 400, 'VALIDATION_FAILED');
    expect((await patch(id, { capacity: 3, lane_units: 3, reserve_units: 0 })).statusCode).toBe(200);

    const station = { name: 'Other', station_type: 'slot', capacity: 4 };
    expectError(await post({ ...station, lane_units: 5 }), 400, 'VALIDATION_FAILED');
    expectError(await post({ ...station, reserve_units: 5 }), 400, 'VALIDATION_FAILED');
    expectError(await post({ ...station, pressure_amber_bp: 10_000 }), 400, 'VALIDATION_FAILED');
    expectError(await post({ ...station, pressure_amber_bp: 5, pressure_red_bp: 5 }), 400, 'VALIDATION_FAILED');
  });

  it('[01a §6.9 A-9, A-10] replace-lists: a new list replaces, absent keeps, empty clears; one audit row, one bump each', async () => {
    const id = await addStation('Tawa');
    const [b, c] = [await addStation('B'), await addStation('C')];
    const pass = await passOf();
    const second = await addPoint('PT-2', 'Counter');
    const start = await versionOf();

    const first = await patch(id, {
      alternates: [alternate(c), alternate(b, { order_types: ['takeaway', 'delivery'], home: ['delivery'] })],
      carry_times: [{ point_id: second, carry_ms: 600_000 }, { point_id: pass, carry_ms: 0 }],
    });
    expect(first.statusCode, first.body).toBe(200);
    const sorted = [b, c].sort();
    expect(first.json().data.station.alternates.map((a: { alternate_station_id: string }) => a.alternate_station_id)).toEqual(sorted);
    expect(first.json().data.station.carry_times).toEqual(
      [{ point_id: second, carry_ms: 600_000 }, { point_id: pass, carry_ms: 0 }].sort((x, y) => (x.point_id < y.point_id ? -1 : 1)),
    );
    expect(await versionOf()).toBe(start + 1);

    // absent: both lists stay
    const renamed = await patch(id, { name: 'Tawa 2' });
    expect(renamed.json().data.station.alternates).toHaveLength(2);
    expect(renamed.json().data.station.carry_times).toHaveLength(2);
    expect(await versionOf()).toBe(start + 2);

    // the same list in another order is a no-op: no bump, no audit row
    const auditBefore = (await auditOf(id)).length;
    const same = await patch(id, {
      alternates: [alternate(b, { order_types: ['delivery', 'takeaway'], home: ['delivery'] }), alternate(c)],
      carry_times: renamed.json().data.station.carry_times.slice().reverse(),
    });
    expect(same.statusCode).toBe(200);
    expect(same.json().data.station).toEqual(renamed.json().data.station);
    expect(await versionOf()).toBe(start + 2);
    expect(await auditOf(id)).toHaveLength(auditBefore);

    // replaced, then cleared
    const replaced = await patch(id, { alternates: [alternate(b)] });
    expect(replaced.json().data.station.alternates).toEqual([alternate(b)]);
    expect(replaced.json().data.station.carry_times).toHaveLength(2);
    const cleared = await patch(id, { alternates: [], carry_times: [] });
    expect(cleared.json().data.station).toMatchObject({ alternates: [], carry_times: [] });
    const rows = await cloud.pool.query(
      `SELECT 1 FROM station_alternates WHERE station_id = $1 UNION ALL SELECT 1 FROM carry_times WHERE station_id = $1`,
      [id],
    );
    expect(rows.rows).toEqual([]);

    const audit = await auditOf(id);
    expect(audit).toHaveLength(auditBefore + 2);
    expect(audit.at(-1)!.before).toMatchObject({ alternates: [alternate(b)] });
    expect(audit.at(-1)!.after).toMatchObject({ alternates: [], carry_times: [] });
  });

  it('[01a §6.9 A-9] a batch alternate, another branch\'s station, an unknown one, self, a batch owner → 422 { field: alternates }', async () => {
    const id = await addStation('Tawa');
    const batch = await addStation('Fryer', { station_type: 'batch' });
    const elsewhere = await addStation('Far', {}, f.branches[1]);
    const start = await versionOf();
    for (const bad of [batch, elsewhere, 'NOPE', id]) {
      expectError(await patch(id, { alternates: [alternate(bad)] }), 422, 'CONFIG_REFERENCE_INVALID', { field: 'alternates' });
    }
    expectError(await patch(batch, { alternates: [alternate(id)] }), 422, 'CONFIG_REFERENCE_INVALID', { field: 'alternates' });
    expect(await versionOf()).toBe(start);

    for (const bad of [batch, elsewhere, 'NOPE']) {
      expectError(
        await post({ name: 'New', station_type: 'slot', capacity: 1, alternates: [alternate(bad)] }),
        422,
        'CONFIG_REFERENCE_INVALID',
        { field: 'alternates' },
      );
    }
    expectError(
      await post({ name: 'New', station_type: 'batch', capacity: 1, alternates: [alternate(id)] }),
      422,
      'CONFIG_REFERENCE_INVALID',
      { field: 'alternates' },
    );
    // a type change and a list in one body: the merged row is what counts
    expectError(await patch(id, { station_type: 'batch', alternates: [alternate(await addStation('S2'))] }), 422, 'CONFIG_REFERENCE_INVALID', {
      field: 'alternates',
    });
  });

  it('[01a §6.9 A-9, A-10 ruling 3] duplicates or home ⊄ order_types → 400', async () => {
    const id = await addStation('Tawa');
    const b = await addStation('B');
    const pass = await passOf();
    for (const body of [
      { alternates: [alternate(b, { order_types: ['dine_in', 'dine_in'] })] },
      { alternates: [alternate(b, { order_types: ['dine_in'], home: ['dine_in', 'dine_in'] })] },
      { alternates: [alternate(b, { order_types: ['dine_in'], home: ['takeaway'] })] },
      { alternates: [alternate(b), alternate(b)] },
      { alternates: [alternate(b, { order_types: [] })] },
      { alternates: [alternate(b, { order_types: ['drive_through'] })] },
      { carry_times: [{ point_id: pass, carry_ms: 0 }, { point_id: pass, carry_ms: 1 }] },
      { carry_times: [{ point_id: pass, carry_ms: -1 }] },
      { carry_times: [{ point_id: pass, carry_ms: 600_001 }] },
    ]) {
      expectError(await patch(id, body), 400, 'VALIDATION_FAILED');
      expectError(await post({ name: 'New', station_type: 'slot', capacity: 1, ...body }), 400, 'VALIDATION_FAILED');
    }
  });

  it('[01a §6.9 A-10 ruling 4] carry time to another branch\'s or an unknown point → 422 { field: carry_times }; an archived point of the branch is fine', async () => {
    const id = await addStation('Tawa');
    const elsewhere = await passOf(f.branches[1]);
    for (const bad of [elsewhere, 'NOPE']) {
      const carry_times = [{ point_id: bad, carry_ms: 1 }];
      expectError(await patch(id, { carry_times }), 422, 'CONFIG_REFERENCE_INVALID', { field: 'carry_times' });
      expectError(await post({ name: 'New', station_type: 'slot', capacity: 1, carry_times }), 422, 'CONFIG_REFERENCE_INVALID', {
        field: 'carry_times',
      });
    }
    const archived = await addPoint('PT-X', 'Old', { archived: true });
    expect((await patch(id, { carry_times: [{ point_id: archived, carry_ms: 1 }] })).statusCode).toBe(200);
  });

  it('[01a §6.9 A-2] point_id archived, of another branch or unknown → 422 { field: point_id }', async () => {
    const id = await addStation('Tawa');
    const archived = await addPoint('PT-X', 'Old', { archived: true });
    const elsewhere = await passOf(f.branches[1]);
    for (const bad of [archived, elsewhere, 'NOPE']) {
      expectError(await patch(id, { point_id: bad }), 422, 'CONFIG_REFERENCE_INVALID', { field: 'point_id' });
      expectError(await post({ name: 'New', station_type: 'slot', capacity: 1, point_id: bad }), 422, 'CONFIG_REFERENCE_INVALID', {
        field: 'point_id',
      });
    }
    const other = await addPoint('PT-2', 'Counter');
    const moved = await patch(id, { point_id: other });
    expect(moved.json().data.station.point_id).toBe(other);
  });

  it('[01a §6.9 A-2] restoring a station whose point is archived → 422 { field: point_id }', async () => {
    const other = await addPoint('PT-2', 'Counter');
    const id = await addStation('Tawa', { point_id: other });
    expect((await patch(id, { archived: true })).statusCode).toBe(200);
    await cloud.pool.query(`UPDATE points SET archived_at = 1 WHERE point_id = $1`, [other]);
    expectError(await patch(id, { archived: false }), 422, 'CONFIG_REFERENCE_INVALID', { field: 'point_id' });
    const restored = await patch(id, { archived: false, point_id: await passOf() });
    expect(restored.statusCode, restored.body).toBe(200);
  });

  it('[01a §6.9 A-2 ruling 1] POST without point_id: Pass; else lowest (sort_order, point_id); none → 422', async () => {
    const station = { station_type: 'slot', capacity: 1 };
    await addPoint('PT-B', 'Bar', { sort: 1 });
    await addPoint('PT-A', 'Aisle', { sort: 2 });
    await addPoint('PT-C', 'Corner', { sort: 1 });
    const pass = await passOf();
    expect((await post({ ...station, name: 'S1' })).json().data.station.point_id).toBe(pass);

    await cloud.pool.query(`UPDATE points SET name = 'Renamed', sort_order = 5 WHERE point_id = $1`, [pass]);
    expect((await post({ ...station, name: 'S2' })).json().data.station.point_id).toBe('PT-B');

    await cloud.pool.query(`UPDATE points SET archived_at = 1 WHERE branch_id = $1`, [f.branches[0]]);
    expectError(await post({ ...station, name: 'S3' }), 422, 'CONFIG_REFERENCE_INVALID', { field: 'point_id' });
  });

  it('[01a §6.9 ruling 1] a token naming a branch that does not exist → still 404 BRANCH_NOT_FOUND', async () => {
    const response = await cloud.app.inject({
      method: 'POST',
      url: stationsUrl('NO-SUCH-BRANCH'),
      ...owner(f, f.tokenFor(['NO-SUCH-BRANCH'])),
      payload: { name: 'S', station_type: 'slot', capacity: 1 },
    });
    expectError(response, 404, 'BRANCH_NOT_FOUND');
  });

  it('[01a §6.9 A-9 ruling 5] PATCH to batch with alternates, or named as one → 409 CONFIG_IN_USE', async () => {
    const a = await addStation('A');
    const b = await addStation('B');
    const c = await addStation('C');
    expect((await patch(a, { alternates: [alternate(b)] })).statusCode).toBe(200);
    expect((await patch(c, { alternates: [alternate(b)] })).statusCode).toBe(200);
    const start = await versionOf();

    expectError(await patch(a, { station_type: 'batch' }), 409, 'CONFIG_IN_USE', {
      entity: 'station',
      id: a,
      used_by: { entity: 'station', ids: [a] },
    });
    expectError(await patch(b, { station_type: 'batch' }), 409, 'CONFIG_IN_USE', {
      entity: 'station',
      id: b,
      used_by: { entity: 'station', ids: [a, c].sort() },
    });
    expect(await versionOf()).toBe(start);

    // Clearing the list in the same body frees it; the row in another station's list still holds b.
    const freed = await patch(a, { station_type: 'batch', alternates: [] });
    expect(freed.statusCode, freed.body).toBe(200);
    expect(freed.json().data.station).toMatchObject({ station_type: 'batch', alternates: [], freshness_window_ms: 0 });
    expectError(await patch(b, { station_type: 'batch' }), 409, 'CONFIG_IN_USE', { used_by: { entity: 'station', ids: [c] } });
    expect((await patch(c, { alternates: [] })).statusCode).toBe(200);
    expect((await patch(b, { station_type: 'batch' })).statusCode).toBe(200);
  });

  it('[01a §6.8 A-1–A-10] GET lists points and the fields, archived included, in 3 statements however many rows', async () => {
    const pass = await passOf();
    await addPoint('PT-X', 'Old', { sort: 3, archived: true });
    const a = await addStation('A');
    const b = await addStation('B');
    const fryer = await addStation('Fryer', { station_type: 'batch' });
    await patch(a, { alternates: [alternate(b)], carry_times: [{ point_id: pass, carry_ms: 5 }] });
    await patch(b, { alternates: [alternate(a)], carry_times: [{ point_id: pass, carry_ms: 7 }] });

    const listed = await list();
    expect(counter.count).toBe(3);
    const body = listed.json().data;
    expect(body.points).toEqual([
      { point_id: pass, name: 'Pass', sort_order: 0, archived_at: null },
      { point_id: 'PT-X', name: 'Old', sort_order: 3, archived_at: 1 },
    ]);
    expect(body.stations.map((s: { station_id: string }) => s.station_id)).toEqual([a, b, fryer]);
    expect(body.stations[0]).toMatchObject({
      point_id: pass,
      ...ENGINE_DEFAULTS,
      alternates: [alternate(b)],
      carry_times: [{ point_id: pass, carry_ms: 5 }],
      programs: [],
    });
    expect(body.stations[2]).toMatchObject({ alternates: [], carry_times: [] });

    for (const name of ['C', 'D', 'E']) await addStation(name, { alternates: [alternate(a)] });
    await list();
    expect(counter.count).toBe(3);
  });

  it('[01a S8, §6.9 A-9] two stations naming each other at once: both commit, no deadlock', async () => {
    const a = await addStation('A');
    const b = await addStation('B');
    holdAfterLock = 100;
    const [first, second] = await Promise.all([patch(a, { alternates: [alternate(b)] }), patch(b, { alternates: [alternate(a)] })]);
    expect([first.statusCode, second.statusCode], `${first.body} ${second.body}`).toEqual([200, 200]);
  });

  it('[01a S8, §6.9 A-9] a type change to batch racing a list that names the station: never a batch alternate', async () => {
    const a = await addStation('A');
    const x = await addStation('X');
    holdAfterLock = 100;
    const [named, changed] = await Promise.all([patch(a, { alternates: [alternate(x)] }), patch(x, { station_type: 'batch' })]);
    expect([named.statusCode, changed.statusCode].sort(), `${named.body} ${changed.body}`).toEqual(
      named.statusCode === 200 ? [200, 409] : [200, 422],
    );
    const bad = await cloud.pool.query(
      `SELECT 1 FROM station_alternates sa
         JOIN stations s ON s.tenant_id = sa.tenant_id AND s.branch_id = sa.branch_id AND s.station_id = sa.alternate_station_id
        WHERE s.station_type = 'batch'`,
    );
    expect(bad.rows).toEqual([]);
  });
});
