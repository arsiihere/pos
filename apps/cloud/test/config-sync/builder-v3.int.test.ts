import { canonicalJson, sha256hex } from '@pos/domain/hash';
import { BranchConfigSnapshotSchemaV3 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshot, buildSnapshotBody, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

const HEADER: SnapshotHeader = {
  config_version: 42,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
};

interface BodyStation {
  station_id: string;
  point_id: string;
  alternates: Array<{ station_id: string; order_types: string[]; home_for_order_types: string[] }>;
  carry_times: Array<{ point_id: string; carry_ms: number }>;
  [key: string]: unknown;
}

interface V3Body {
  points: Array<{ point_id: string; name: string; sort_order: number; is_archived: boolean }>;
  stations: BodyStation[];
  items: Array<Record<string, unknown>>;
  engine_settings: Record<string, unknown>;
  goes_with: Array<{ source_kind: string; source_id: string; target_kind: string; target_id: string; excluded: boolean }>;
}

// 01a §4.3 (Changed by 03a v1.0), S28: every schema 3 field in the unparsed body. The sort and drop rules of plan C5.
describe('buildSnapshotBody: schema 3', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
    await seedMenu(cloud.pool, f, { archived: true });
  });

  const tenant = () => Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) });
  const raw = async (branchId: string = f.branches[0]) => {
    const client = await cloud.pool.connect();
    try {
      return await buildSnapshotBody(client, tenant(), branchId, HEADER);
    } finally {
      client.release();
    }
  };
  const body = async () => (await raw()) as unknown as V3Body;
  const sql = (text: string, params: unknown[] = []) => cloud.pool.query(text, [f.tenantId, ...params]);
  const station = (b: V3Body, id: string) => b.stations.find((row) => row.station_id === id)!;
  const pass = async () =>
    (await sql(`SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'`, [f.branches[0]])).rows[0]
      .point_id as string;
  // Two more active slot stations at branch A, to name as alternates.
  const seedSlots = async () => {
    await sql(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, 'ST-3', $3, 'Tawa', 'slot', 2, 0, 0), ($1, $2, 'ST-4', $3, 'Handi', 'slot', 2, 0, 0)`,
      [f.branches[0], await pass()],
    );
  };
  const alternate = (from: string, to: string, orderTypes: string[], home: string[]) =>
    sql(
      `INSERT INTO station_alternates (tenant_id, branch_id, station_id, alternate_station_id, order_types, home_for_order_types, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0)`,
      [f.branches[0], from, to, orderTypes, home],
    );
  const link = (linkId: string, sourceKind: string, sourceId: string, targetKind: string, targetId: string, excluded = false) =>
    sql(
      `INSERT INTO goes_with_links (tenant_id, link_id, source_kind, source_id, target_kind, target_id, excluded, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0)`,
      [linkId, sourceKind, sourceId, targetKind, targetId, excluded],
    );

  it('[01a §4.3 V3] the unparsed body parses as schema 3 once its version is set to 3 (the wire version since the flip), every engine field kept', async () => {
    await seedSlots();
    await alternate('ST-3', 'ST-4', ['takeaway'], []);
    await sql(`INSERT INTO carry_times (tenant_id, branch_id, station_id, point_id, carry_ms, created_at, updated_at) VALUES ($1, $2, 'ST-3', $3, 15000, 0, 0)`, [
      f.branches[0],
      await pass(),
    ]);
    await link('L1', 'item', 'IT-0000', 'category', 'CT-2');
    const unparsed = await raw();
    const parsed = BranchConfigSnapshotSchemaV3.parse({ ...unparsed, snapshot_schema_version: 3 });
    expect(JSON.parse(JSON.stringify(parsed))).toEqual({ ...unparsed, snapshot_schema_version: 3 });
    expect(parsed.points.length).toBeGreaterThan(0);
    expect(parsed.stations.find((row) => row.station_id === 'ST-3')).toMatchObject({
      point_id: await pass(),
      policy: 'waada_guard',
      freeze_ms: 120000,
      min_slack_keep_ms: 60000,
      promise_padding_ms: null,
      pressure_window_ms: 900000,
      pressure_amber_bp: 8000,
      pressure_red_bp: 10000,
      pressure_alert_ms: 300000,
      pause_enabled: false,
      lane_units: null,
      reserve_units: 0,
      alternates: [{ station_id: 'ST-4', order_types: ['takeaway'], home_for_order_types: [] }],
      carry_times: [{ point_id: await pass(), carry_ms: 15000 }],
    });
    expect(parsed.items[0]).toMatchObject({ weight_pct: 100, max_early_ms: 60000, max_carry_ms: null, max_late_ms: null, adjust_time_ms: 180000 });
    expect(parsed.goes_with).toEqual([{ source_kind: 'item', source_id: 'IT-0000', target_kind: 'category', target_id: 'CT-2', excluded: false }]);
  });

  it('[01a §4.3 V3] points keep archived rows with is_archived, by sort_order then point_id, and an archived station’s point resolves', async () => {
    const [a] = f.branches;
    await sql(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, sort_order, archived_at, created_at, updated_at)
       VALUES ($1, $2, 'PT-B', 'Terrace', 5, NULL, 0, 0), ($1, $2, 'PT-A', 'Roof', 5, NULL, 0, 0), ($1, $2, 'PT-C', 'Old hall', 2, 7, 0, 0)`,
      [a],
    );
    // A point of another branch is never listed.
    await sql(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, created_at, updated_at) VALUES ($1, $2, 'PT-Z', 'Elsewhere', 0, 0)`,
      [f.branches[1]],
    );
    await sql(`UPDATE stations SET point_id = 'PT-C' WHERE tenant_id = $1 AND station_id = 'ST-X'`);
    const b = await body();
    expect(b.points.map((row) => [row.point_id, row.sort_order, row.is_archived])).toEqual([
      [await pass(), 0, false],
      ['PT-C', 2, true],
      ['PT-A', 5, false],
      ['PT-B', 5, false],
    ]);
    expect(b.points.map((row) => row.point_id)).toContain(station(b, 'ST-X').point_id);
    expect(station(b, 'ST-X')).toMatchObject({ is_archived: true });
  });

  it('[01a §4.3 V3] alternates by station_id, order types in a stable order, rows naming an archived station left out (CL-10)', async () => {
    await seedSlots();
    await alternate('ST-1', 'ST-4', ['takeaway', 'dine_in'], ['takeaway', 'dine_in']);
    await alternate('ST-1', 'ST-3', ['parking', 'delivery', 'dine_in'], ['parking', 'dine_in']);
    await alternate('ST-1', 'ST-X', ['dine_in'], []); // an active station naming an archived one (restore, CL-10)
    await alternate('ST-X', 'ST-1', ['dine_in'], []); // an archived station's own row
    const b = await body();
    expect(station(b, 'ST-1').alternates).toEqual([
      { station_id: 'ST-3', order_types: ['delivery', 'dine_in', 'parking'], home_for_order_types: ['dine_in', 'parking'] },
      { station_id: 'ST-4', order_types: ['dine_in', 'takeaway'], home_for_order_types: ['dine_in', 'takeaway'] },
    ]);
    expect(station(b, 'ST-X').alternates).toEqual([]);
    expect(station(b, 'ST-2').alternates).toEqual([]);
  });

  it('[01a §4.3 V3] carry_times by point_id, per station', async () => {
    const [a] = f.branches;
    await sql(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, created_at, updated_at)
       VALUES ($1, $2, 'PT-b', 'Lower', 0, 0), ($1, $2, 'PT-C', 'Upper', 0, 0), ($1, $2, 'PT-A', 'First', 0, 0)`,
      [a],
    );
    await sql(
      `INSERT INTO carry_times (tenant_id, branch_id, station_id, point_id, carry_ms, created_at, updated_at)
       VALUES ($1, $2, 'ST-1', 'PT-b', 3000, 0, 0), ($1, $2, 'ST-1', 'PT-C', 2000, 0, 0), ($1, $2, 'ST-1', 'PT-A', 1000, 0, 0),
              ($1, $2, 'ST-2', 'PT-A', 9000, 0, 0)`,
      [a],
    );
    const b = await body();
    expect(station(b, 'ST-1').carry_times).toEqual([
      { point_id: 'PT-A', carry_ms: 1000 },
      { point_id: 'PT-C', carry_ms: 2000 },
      { point_id: 'PT-b', carry_ms: 3000 },
    ]);
    expect(station(b, 'ST-2').carry_times).toEqual([{ point_id: 'PT-A', carry_ms: 9000 }]);
    expect(station(b, 'ST-X').carry_times).toEqual([]);
  });

  it('[01a §4.3 V3] a carry time naming an archived point is kept: the point stays in points[] (is_archived), so the reference resolves', async () => {
    const [a] = f.branches;
    await sql(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, archived_at, created_at, updated_at) VALUES ($1, $2, 'PT-OLD', 'Old pass', 5, 0, 0)`,
      [a],
    );
    await sql(
      `INSERT INTO carry_times (tenant_id, branch_id, station_id, point_id, carry_ms, created_at, updated_at) VALUES ($1, $2, 'ST-1', 'PT-OLD', 4000, 0, 0)`,
      [a],
    );
    const b = await body();
    expect(station(b, 'ST-1').carry_times).toEqual([{ point_id: 'PT-OLD', carry_ms: 4000 }]);
    expect(b.points.find((row) => row.point_id === 'PT-OLD')).toMatchObject({ is_archived: true });
  });

  it('[01a §4.3 V3] engine_settings is this branch’s row with every A-12 key; a missing row is an error, not a default (CL-3)', async () => {
    const [a, other] = f.branches;
    await sql(`UPDATE branch_engine_settings SET returns_boost = false, order_abandon_ms = 7200000, table_lock_ttl_ms = 120000 WHERE tenant_id = $1 AND branch_id = $2`, [a]);
    await sql(`UPDATE branch_engine_settings SET weight_follow_up_pct = 500 WHERE tenant_id = $1 AND branch_id = $2`, [other]);
    expect((await body()).engine_settings).toEqual({
      weight_dine_in_pct: 100,
      weight_takeaway_pct: 200,
      weight_delivery_pct: 200,
      weight_parking_pct: 200,
      weight_follow_up_pct: 300,
      promise_padding_dine_in_ms: 180000,
      promise_padding_takeaway_ms: 180000,
      promise_padding_delivery_ms: 180000,
      promise_padding_parking_ms: 180000,
      slip_threshold_ms: 120000,
      slip_escalate_ms: 120000,
      cascade_step_ms: 60000,
      min_gain_ms: 60000,
      returns_boost: false,
      order_abandon_ms: 7200000,
      table_lock_ttl_ms: 120000,
    });
    await sql(`DELETE FROM branch_engine_settings WHERE tenant_id = $1 AND branch_id = $2`, [a]);
    await expect(raw()).rejects.toThrow(/engine settings/);
    const client = await cloud.pool.connect();
    try {
      await expect(buildSnapshot(client, tenant(), a, HEADER)).rejects.toThrow(/engine settings/);
    } finally {
      client.release();
    }
  });

  it('[01a §4.3 V3] item knobs come from the item', async () => {
    await sql(
      `UPDATE menu_items SET weight_pct = 150, max_early_ms = 1000, max_carry_ms = 2000, max_late_ms = 3000, adjust_time_ms = 4000
        WHERE tenant_id = $1 AND item_id = 'IT-0000'`,
    );
    const b = await body();
    expect(b.items.find((item) => item.item_id === 'IT-0000')).toMatchObject({
      weight_pct: 150,
      max_early_ms: 1000,
      max_carry_ms: 2000,
      max_late_ms: 3000,
      adjust_time_ms: 4000,
    });
  });

  it('[01a §4.3 V3] goes_with in code-unit order by source_kind, source_id, target_kind, target_id; a link with an archived end left out (CL-12)', async () => {
    await sql(
      `INSERT INTO categories (tenant_id, category_id, name, sort_order, archived_at, created_at, updated_at)
       VALUES ($1, 'CT-OLD', 'Old', 9, 3, 0, 0)`,
    );
    await sql(`UPDATE menu_items SET archived_at = 3 WHERE tenant_id = $1 AND item_id = 'IT-0001'`);
    // Lower case after upper case in code-unit order, the reverse of a linguistic collation.
    await sql(
      `INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms, created_at, updated_at)
       VALUES ($1, 'it-lower', 'CT-1', 'lower id', 1, 'immediate', 1, 0, 0), ($1, 'IT-UPPER', 'CT-1', 'upper id', 1, 'immediate', 1, 0, 0)`,
    );
    await link('L1', 'item', 'it-lower', 'category', 'CT-1');
    await link('L2', 'item', 'IT-UPPER', 'item', 'it-lower', true);
    await link('L3', 'item', 'IT-UPPER', 'item', 'IT-0000');
    await link('L4', 'item', 'IT-UPPER', 'category', 'CT-2', true);
    await link('L5', 'category', 'CT-2', 'item', 'IT-UPPER');
    await link('L6', 'category', 'CT-1', 'category', 'CT-2');
    // Left out: each end archived, each kind.
    await link('X1', 'item', 'IT-0001', 'category', 'CT-1');
    await link('X2', 'item', 'IT-0000', 'item', 'IT-0001');
    await link('X3', 'category', 'CT-OLD', 'item', 'IT-0000');
    await link('X4', 'item', 'IT-0000', 'category', 'CT-OLD');
    const { goes_with } = await body();
    expect(goes_with.map((row) => [row.source_kind, row.source_id, row.target_kind, row.target_id, row.excluded])).toEqual([
      ['category', 'CT-1', 'category', 'CT-2', false],
      ['category', 'CT-2', 'item', 'IT-UPPER', false],
      ['item', 'IT-UPPER', 'category', 'CT-2', true],
      ['item', 'IT-UPPER', 'item', 'IT-0000', false],
      ['item', 'IT-UPPER', 'item', 'it-lower', true],
      ['item', 'it-lower', 'category', 'CT-1', false],
    ]);
  });

  it('[01a §4.3 V3] another tenant’s links never appear; the hash is equal across two builds with points, alternates, carry times and goes-with filled', async () => {
    await seedSlots();
    await alternate('ST-1', 'ST-3', ['takeaway', 'dine_in'], []);
    await sql(`INSERT INTO carry_times (tenant_id, branch_id, station_id, point_id, carry_ms, created_at, updated_at) VALUES ($1, $2, 'ST-3', $3, 15000, 0, 0)`, [
      f.branches[0],
      await pass(),
    ]);
    await link('L1', 'item', 'IT-0000', 'category', 'CT-1');
    await cloud.pool.query(
      `INSERT INTO goes_with_links (tenant_id, link_id, source_kind, source_id, target_kind, target_id, created_at, updated_at)
       VALUES ($1, 'LX', 'item', 'IT-0000', 'category', 'CT-2', 0, 0)`,
      [f.other.tenantId],
    );
    const first = await raw();
    const filled = first as unknown as V3Body;
    expect(filled.goes_with).toHaveLength(1);
    expect(filled.points.length).toBeGreaterThan(0);
    expect(station(filled, 'ST-1').alternates).toHaveLength(1);
    expect(station(filled, 'ST-3').carry_times).toHaveLength(1);
    const second = await raw();
    expect(sha256hex(canonicalJson(second))).toBe(sha256hex(canonicalJson(first)));
  });
});
