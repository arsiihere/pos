import { routePoint, type RoutablePoint } from '@pos/domain';
import { BranchConfigSnapshotSchemaV4 } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildSnapshotBody, type SnapshotHeader } from '../../src/modules/config-sync/builder';
import { restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// ⚠️ 01a v2.11 PT-3 (run 3 R3-m-3), §4.3, test 221: the builder sends points[].order_types ('all' or the sorted set),
// read in the existing points statement.
const HEADER: SnapshotHeader = {
  config_version: 42,
  currency_code: 'PKR',
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
  business_day_end_local_ms: 14_400_000,
};

describe('[01a #221 PT-3] snapshot points[].order_types', () => {
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
    await seedMenu(cloud.pool, f, {});
  });

  const build = async () => {
    const client = await cloud.pool.connect();
    try {
      return await buildSnapshotBody(client, Object.freeze({ tenantId: f.tenantId, branchIds: Object.freeze([...f.branches]) }), f.branches[0], HEADER);
    } finally {
      client.release();
    }
  };

  it("emits 'all' for SQL NULL and the sorted set otherwise; the V4 parse keeps them; an omitted key routes as 'all'; an empty set is refused", async () => {
    const now = 1_761_000_000_000;
    await cloud.pool.query(
      `INSERT INTO points (tenant_id, branch_id, point_id, name, sort_order, order_types, created_at, updated_at)
       VALUES ($1, $2, 'PT-TA', 'Takeaway Pass', 5, '{parking,takeaway}', $3, $3)`,
      [f.tenantId, f.branches[0], now],
    );
    const raw = (await build()) as unknown as { points: Array<{ point_id: string; name: string; order_types?: unknown }> };
    const ta = raw.points.find((p) => p.point_id === 'PT-TA')!;
    const pass = raw.points.find((p) => p.name === 'Pass')!;
    expect(ta.order_types).toEqual(['parking', 'takeaway']);
    expect(pass.order_types).toBe('all');

    const parsed = BranchConfigSnapshotSchemaV4.parse(raw);
    expect(parsed.points.find((p) => p.point_id === 'PT-TA')!.order_types).toEqual(['parking', 'takeaway']);
    expect(parsed.points.find((p) => p.point_id === pass.point_id)!.order_types).toBe('all');

    // An older body without the key parses and routes like the explicit 'all' (absent = 'all').
    const withoutKey = raw.points.map((p) => {
      const copy: Record<string, unknown> = { ...p };
      delete copy.order_types;
      return copy;
    });
    const omitted = BranchConfigSnapshotSchemaV4.parse({ ...raw, points: withoutKey });
    expect(omitted.points.every((p) => p.order_types === undefined)).toBe(true);
    const station = { point_id: pass.point_id };
    for (const t of ['dine_in', 'takeaway', 'delivery', 'parking'] as const) {
      expect(routePoint(omitted.points as RoutablePoint[], station, t), t).toEqual(routePoint(parsed.points.map((p) => (p.point_id === 'PT-TA' ? { ...p, order_types: 'all' as const } : p)) as RoutablePoint[], station, t));
    }
    expect(BranchConfigSnapshotSchemaV4.safeParse({ ...raw, points: raw.points.map((p) => ({ ...p, order_types: [] })) }).success).toBe(false);
  });
});
