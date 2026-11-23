import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, stockItem } from './fixtures';

// 08a P0.5: the shared fixture is what §10.3 says, and testHooks.afterStockItemLock runs on the §6.3 PATCH right
// after the stock-item lock (N-5), on every path (the no-op too), before the version check.
describe('08a inventory fixture and afterStockItemLock hook (§10.3, N-5)', () => {
  let cloud: TestCloud;
  const calls: string[] = [];
  let probeIds: string[] = [];
  let probeResult: string | null = null;

  beforeAll(async () => {
    cloud = await createTestCloud({
      testHooks: {
        afterStockItemLock: async (route) => {
          calls.push(route);
          // the PATCH holds the row FOR UPDATE here: another connection sees it and cannot lock it
          const probe = await cloud.pool.query<{ total: number; free: number }>(
            `SELECT (SELECT count(*)::int FROM stock_items WHERE stock_item_id = ANY($1)) AS total,
                    (SELECT count(*)::int FROM (SELECT 1 FROM stock_items WHERE stock_item_id = ANY($1) FOR UPDATE SKIP LOCKED) s) AS free`,
            [probeIds],
          );
          const { total, free } = probe.rows[0]!;
          probeResult = total === 1 && free === 0 ? 'locked' : `total ${total}, free ${free}`;
        },
      },
    });
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });

  it('[08a §10.3] fixture: PAYE-COOKED prepared + counted at Lake City and drawn by Paye Half; ingredients, TP-1 packet', async () => {
    const fx = await inventoryFixture(cloud);
    const rows = (
      await cloud.pool.query(`SELECT name, kind, stock_unit, code, is_a_item, carries_over FROM stock_items WHERE tenant_id = $1 ORDER BY name`, [fx.f.tenantId])
    ).rows;
    expect(rows).toEqual([
      { name: 'Beef', kind: 'ingredient', stock_unit: 'g', code: null, is_a_item: false, carries_over: false },
      { name: 'Ghee', kind: 'ingredient', stock_unit: 'g', code: null, is_a_item: true, carries_over: false },
      { name: 'PAYE-COOKED', kind: 'prepared', stock_unit: 'piece', code: null, is_a_item: false, carries_over: true },
      { name: 'Paye raw', kind: 'ingredient', stock_unit: 'g', code: null, is_a_item: true, carries_over: false },
      { name: 'TP-1 tikka packet', kind: 'packet', stock_unit: 'g', code: 'TP-1', is_a_item: false, carries_over: false },
    ]);
    const counted = await cloud.pool.query(`SELECT branch_id, stock_item_id FROM stock_item_branches WHERE tenant_id = $1`, [fx.f.tenantId]);
    expect(counted.rows).toEqual([{ branch_id: fx.lakeCity, stock_item_id: fx.ids.payeCooked }]);
    const draws = await cloud.pool.query(`SELECT item_id, stock_item_id FROM stock_draws WHERE tenant_id = $1`, [fx.f.tenantId]);
    expect(draws.rows).toEqual([{ item_id: fx.payeHalfItemId, stock_item_id: fx.ids.payeCooked }]);
    expect((await stockItem(cloud, fx.f, fx.ids.tp1)).kind).toBe('packet');
  });

  it('[08a §10.3, N-5] afterStockItemLock runs on the PATCH after the lock, also on a stale or no-op PATCH', async () => {
    const fx = await inventoryFixture(cloud);
    const beef = await stockItem(cloud, fx.f, fx.ids.beef);
    const patch = (payload: object) =>
      cloud.app.inject({ method: 'PATCH', url: `/v1/admin/stock-items/${fx.ids.beef}`, ...owner(fx.f), payload });
    calls.length = 0;
    probeIds = [fx.ids.beef];
    probeResult = null;
    const ok = await patch({ expected_version: beef.version, name: 'Beef raw' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(calls).toEqual(['PATCH /v1/admin/stock-items/:stock_item_id']);
    expect(probeResult).toBe('locked');
    probeResult = null;
    expect((await patch({ expected_version: beef.version, name: 'Beef' })).statusCode).toBe(409); // stale
    expect(probeResult).toBe('locked');
    const fresh = await stockItem(cloud, fx.f, fx.ids.beef);
    probeResult = null;
    expect((await patch({ expected_version: fresh.version, name: 'Beef raw' })).statusCode).toBe(200); // no-op
    expect(probeResult).toBe('locked');
    expect(calls).toHaveLength(3);
  });
});
