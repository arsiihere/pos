import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { pgCounter } from '../helpers/pg-counter';
import { owner, restaurantFixture, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

describe('stations', () => {
  let cloud: TestCloud;
  let counter: ReturnType<typeof pgCounter>;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud({ captureLogs: true, testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  const stationsUrl = (branchId: string) => `/v1/admin/branches/${branchId}/stations`;
  const createStation = (branchId: string, payload: object) =>
    cloud.app.inject({ method: 'POST', url: stationsUrl(branchId), ...owner(f), payload });
  const patchStation = (branchId: string, stationId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `${stationsUrl(branchId)}/${stationId}`, ...owner(f), payload });
  const listStations = (branchId: string) => cloud.app.inject({ method: 'GET', url: stationsUrl(branchId), ...owner(f) });
  const versionOf = async (branchId: string) =>
    Number(
      (await cloud.pool.query<{ v: string }>(`SELECT config_version AS v FROM branches WHERE branch_id = $1`, [branchId]))
        .rows[0]!.v,
    );
  const auditRows = async () =>
    (await cloud.pool.query<{ entity: string; entity_id: string; action: string; before: unknown; after: unknown }>(
      `SELECT entity, entity_id, action, before, after FROM config_audit WHERE entity IN ('station', 'batch_program')
        ORDER BY at, audit_id`,
    )).rows;
  const addProgram = (branchId: string, stationId: string, programId: string, name: string) =>
    cloud.pool.query(
      `INSERT INTO batch_programs (tenant_id, branch_id, station_id, program_id, name, cook_time_ms, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 600000, 0, 0)`,
      [f.tenantId, branchId, stationId, programId, name],
    );
  // An item routed to the station; archivedItem leaves the route on an archived item.
  const addRoute = async (branchId: string, stationId: string, itemId: string, o: { programId?: string; archivedItem?: boolean } = {}) => {
    await cloud.pool.query(
      `INSERT INTO categories (tenant_id, category_id, name, created_at, updated_at) VALUES ($1, 'CAT-1', 'Mains', 0, 0)
       ON CONFLICT DO NOTHING`,
      [f.tenantId],
    );
    await cloud.pool.query(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, archived_at, created_at, updated_at)
       VALUES ($1, $2, 'CAT-1', $2, 100, 'immediate', 60000, $3, 0, 0)`,
      [f.tenantId, itemId, o.archivedItem === true ? 1 : null],
    );
    await cloud.pool.query(
      `INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, program_id, updated_at) VALUES ($1, $2, $3, $4, $5, 0)`,
      [f.tenantId, branchId, itemId, stationId, o.programId ?? null],
    );
  };

  it('[01a §10 #24] slot station without freshness; batch defaults freshness 0; freshness on a slot → 400', async () => {
    const slot = await createStation(f.branches[0], { name: 'Tawa', station_type: 'slot', capacity: 4 });
    expect(slot.statusCode).toBe(201);
    expect(slot.json().data.station).toEqual({
      station_id: expect.any(String),
      name: 'Tawa',
      location_label: null,
      station_type: 'slot',
      capacity: 4,
      freshness_window_ms: null,
      completion_mode: 'two_tap',
      archived_at: null,
      // ⚠️ 01a v2.1 §6.9: the exact shape gains the engine fields; every value is pinned in stations-engine.int.test.ts
      point_id: expect.any(String),
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
    });

    const batch = await createStation(f.branches[0], {
      name: 'Fryer',
      location_label: ' Back kitchen ',
      station_type: 'batch',
      capacity: 2,
      completion_mode: 'single_tap',
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().data.station).toMatchObject({
      location_label: 'Back kitchen',
      station_type: 'batch',
      freshness_window_ms: 0,
      completion_mode: 'single_tap',
    });

    const bad = await createStation(f.branches[0], { name: 'Grill', station_type: 'slot', capacity: 4, freshness_window_ms: 0 });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_FAILED');
    const badPatch = await patchStation(f.branches[0], slot.json().data.station.station_id, { freshness_window_ms: 60000 });
    expect(badPatch.statusCode).toBe(400);
    expect(badPatch.json().error.code).toBe('VALIDATION_FAILED');
    for (const payload of [
      { name: 'X', station_type: 'slot', capacity: 0 },
      { name: 'X', station_type: 'slot', capacity: 101 },
      { name: 'X', station_type: 'batch', capacity: 1, freshness_window_ms: 3_600_001 },
      { name: 'X', station_type: 'oven', capacity: 1 },
      { name: 'X', station_type: 'slot', capacity: 1, completion_mode: 'three_tap' },
    ]) {
      expect((await createStation(f.branches[0], payload)).statusCode).toBe(400);
    }

    expect(await auditRows()).toEqual([
      expect.objectContaining({ entity: 'station', entity_id: slot.json().data.station.station_id, action: 'create', before: null }),
      expect.objectContaining({ entity: 'station', entity_id: batch.json().data.station.station_id, action: 'create' }),
    ]);

    const listed = await listStations(f.branches[0]);
    expect(counter.count).toBe(3); // ⚠️ 01a v2.1 §6.8: 2 → 3 (points)
    expect(listed.json().data.stations.map((s: { name: string; programs: unknown[] }) => [s.name, s.programs])).toEqual([
      ['Fryer', []],
      ['Tawa', []],
    ]);
  });

  it('[01a §10 #25] archive a station with an active route → 409; after the route is removed → OK', async () => {
    const stationId = (await createStation(f.branches[0], { name: 'Tawa', station_type: 'slot', capacity: 4 })).json().data
      .station.station_id;
    await addRoute(f.branches[0], stationId, 'ITEM-B');
    await addRoute(f.branches[0], stationId, 'ITEM-A');
    await addRoute(f.branches[0], stationId, 'ITEM-OLD', { archivedItem: true });
    const before = await versionOf(f.branches[0]);

    const refused = await patchStation(f.branches[0], stationId, { archived: true });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'station', id: stationId, used_by: { entity: 'menu_item', ids: ['ITEM-A', 'ITEM-B'] } },
    });
    expect(await versionOf(f.branches[0])).toBe(before);

    await cloud.pool.query(`DELETE FROM item_routes WHERE item_id IN ('ITEM-A', 'ITEM-B')`);
    const archived = await patchStation(f.branches[0], stationId, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data.station.archived_at).toBe(cloud.clock.branchNow());
    expect((await auditRows()).at(-1)).toMatchObject({ entity: 'station', entity_id: stationId, action: 'archive' });
    expect(await versionOf(f.branches[0])).toBe(before + 1);

    // the archived station stays listed (S22)
    const listed = await listStations(f.branches[0]);
    expect(listed.json().data.stations).toEqual([expect.objectContaining({ station_id: stationId, archived_at: cloud.clock.branchNow() })]);
  });

  it('[01a §10 #26] change station_type while routes exist → 409; with none, batch → slot archives its programs', async () => {
    const batchId = (await createStation(f.branches[0], { name: 'Fryer', station_type: 'batch', capacity: 2, freshness_window_ms: 120000 }))
      .json().data.station.station_id;
    await addProgram(f.branches[0], batchId, 'PRG-2', 'Fries');
    await addProgram(f.branches[0], batchId, 'PRG-1', 'Nuggets');
    await addRoute(f.branches[0], batchId, 'ITEM-A', { programId: 'PRG-1' });

    const refused = await patchStation(f.branches[0], batchId, { station_type: 'slot' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'station', id: batchId, used_by: { entity: 'menu_item', ids: ['ITEM-A'] } },
    });

    await cloud.pool.query(`DELETE FROM item_routes`);
    const auditBefore = (await auditRows()).length;
    const changed = await patchStation(f.branches[0], batchId, { station_type: 'slot' });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().data.station).toMatchObject({ station_type: 'slot', freshness_window_ms: null });
    const programs = await cloud.pool.query(`SELECT program_id, archived_at FROM batch_programs ORDER BY program_id`);
    expect(programs.rows).toEqual([
      { program_id: 'PRG-1', archived_at: String(cloud.clock.branchNow()) },
      { program_id: 'PRG-2', archived_at: String(cloud.clock.branchNow()) },
    ]);
    const audit = (await auditRows()).slice(auditBefore);
    expect(audit.map((row) => [row.entity, row.entity_id, row.action])).toEqual([
      ['station', batchId, 'update'],
      ['batch_program', 'PRG-1', 'archive'],
      ['batch_program', 'PRG-2', 'archive'],
    ]);

    // slot → batch: freshness from the body, else 0
    const back = await patchStation(f.branches[0], batchId, { station_type: 'batch' });
    expect(back.statusCode).toBe(200);
    expect(back.json().data.station).toMatchObject({ station_type: 'batch', freshness_window_ms: 0 });
    const listed = await listStations(f.branches[0]);
    expect(listed.json().data.stations[0].programs).toEqual([
      { program_id: 'PRG-2', name: 'Fries', cook_time_ms: 600000, archived_at: cloud.clock.branchNow() },
      { program_id: 'PRG-1', name: 'Nuggets', cook_time_ms: 600000, archived_at: cloud.clock.branchNow() },
    ]);
  });

  it('[01a §10 #27] unknown station → 404 STATION_NOT_FOUND', async () => {
    const unknown = await patchStation(f.branches[0], 'NO-SUCH-STATION', { name: 'X' });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error).toMatchObject({ code: 'STATION_NOT_FOUND', details: { station_id: 'NO-SUCH-STATION' } });

    const elsewhere = (await createStation(f.branches[1], { name: 'Tawa', station_type: 'slot', capacity: 1 })).json().data.station
      .station_id;
    const wrongBranch = await patchStation(f.branches[0], elsewhere, { name: 'X' });
    expect(wrongBranch.statusCode).toBe(404);
    expect(wrongBranch.json().error.code).toBe('STATION_NOT_FOUND');
  });

  it('[01a S10] "Fryer" twice in one branch → 409; in another branch → 201', async () => {
    const fryer = { name: 'Fryer', station_type: 'batch', capacity: 2 };
    expect((await createStation(f.branches[0], fryer)).statusCode).toBe(201);
    const duplicate = await createStation(f.branches[0], { ...fryer, name: 'fryer', location_label: 'Upstairs' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'station', name: 'fryer' } });
    const otherBefore = await versionOf(f.branches[0]);
    expect((await createStation(f.branches[1], fryer)).statusCode).toBe(201);
    expect(await versionOf(f.branches[0])).toBe(otherBefore);
  });

  it('[01a §6.9] rename and restore: audited update, branch bumped; restore checks name uniqueness', async () => {
    const created = (await createStation(f.branches[0], { name: 'Tawa', station_type: 'slot', capacity: 4 })).json().data.station;
    const before = await versionOf(f.branches[0]);
    const renamed = await patchStation(f.branches[0], created.station_id, { name: 'Tandoor', capacity: 6, location_label: null });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().data.station).toEqual({ ...created, name: 'Tandoor', capacity: 6 });
    expect((await auditRows()).at(-1)).toEqual({
      entity: 'station',
      entity_id: created.station_id,
      action: 'update',
      before: created,
      after: renamed.json().data.station,
    });
    expect(await versionOf(f.branches[0])).toBe(before + 1);

    expect((await patchStation(f.branches[0], created.station_id, { archived: true })).statusCode).toBe(200);
    expect((await createStation(f.branches[0], { name: 'TANDOOR', station_type: 'slot', capacity: 1 })).statusCode).toBe(201);
    const restore = await patchStation(f.branches[0], created.station_id, { archived: false });
    expect(restore.statusCode).toBe(409);
    expect(restore.json().error.code).toBe('CONFIG_NAME_TAKEN');
    expect((await patchStation(f.branches[0], created.station_id, {})).statusCode).toBe(400);
  });
});
