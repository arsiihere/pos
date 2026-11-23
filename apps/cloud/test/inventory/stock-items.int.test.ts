import type { StockItemWire } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stockItemBranchVersion } from '../../src/modules/menu-variants/versions';
import { createStockItem, putStockItemBranch } from '../helpers/menu-variants';
import { pgCounter } from '../helpers/pg-counter';
import { owner } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';
import { inventoryFixture, stockItem, type InventoryFixture } from './fixtures';

// 08a §10.2: the changed 01c stock-item routes (§6.1 list, §6.2 POST, §6.3 PATCH) with the inventory fields.
describe('08a stock items (§6.1–§6.3, I2, I9, I11 → 08b B16, C-5)', () => {
  let cloud: TestCloud;
  let fx: InventoryFixture;
  let counter: ReturnType<typeof pgCounter>;

  beforeAll(async () => {
    cloud = await createTestCloud({ testHooks: { handlerStart: () => counter.reset() } });
    counter = pgCounter(cloud.pool);
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    fx = await inventoryFixture(cloud);
  });

  const post = (payload: object, headers?: Record<string, string>) =>
    cloud.app.inject({ method: 'POST', url: '/v1/admin/stock-items', headers: { ...owner(fx.f).headers, ...headers }, payload });
  const patch = (stockItemId: string, payload: object) =>
    cloud.app.inject({ method: 'PATCH', url: `/v1/admin/stock-items/${stockItemId}`, ...owner(fx.f), payload });
  const list = (query = '', token?: string) =>
    cloud.app.inject({ method: 'GET', url: `/v1/admin/stock-items${query}`, headers: owner(fx.f, token).headers });
  const versions = async () =>
    (
      await cloud.pool.query<{ config_version: string }>(`SELECT config_version FROM branches WHERE tenant_id = $1 ORDER BY branch_id`, [
        fx.f.tenantId,
      ])
    ).rows.map((row) => Number(row.config_version));
  const auditRows = async () =>
    (
      await cloud.pool.query<{ entity_id: string; action: string; before: unknown; after: unknown }>(
        `SELECT entity_id, action, before, after FROM config_audit WHERE tenant_id = $1 AND entity = 'stock_item' ORDER BY at, audit_id`,
        [fx.f.tenantId],
      )
    ).rows;
  const storedItems = async () => (await cloud.pool.query(`SELECT * FROM stock_items ORDER BY stock_item_id`)).rows;
  const nothingWritten = async (call: () => Promise<{ statusCode: number; body: string; json(): unknown }>, status: number) => {
    const before = { items: await storedItems(), audit: await auditRows(), versions: await versions() };
    const response = await call();
    expect(response.statusCode, response.body).toBe(status);
    expect({ items: await storedItems(), audit: await auditRows(), versions: await versions() }).toEqual(before);
    return response.json() as { error: { code: string; details?: unknown } };
  };
  const removeBranchRow = async (stockItemId: string) => {
    const wire = (await list()).json().data.stock_items.find((s: { stock_item_id: string }) => s.stock_item_id === stockItemId);
    const row = wire.branches.find((b: { branch_id: string }) => b.branch_id === fx.lakeCity);
    await putStockItemBranch(cloud, fx.f, stockItemId, fx.lakeCity, { expected_version: row.version, station_id: null });
  };
  const archiveItem = async (itemId: string) => {
    const response = await cloud.app.inject({ method: 'PATCH', url: `/v1/admin/menu-items/${itemId}`, ...owner(fx.f), payload: { archived: true } });
    expect(response.statusCode, response.body).toBe(200);
  };

  it('[08a #7] POST each kind; defaults prepared / food / not A-item; packet in piece → 422 packet_unit; carries_over on ingredient → 400; 8 statements, 9 with code', async () => {
    const before = await versions();
    const plain = await post({ name: 'Karahi pot', stock_unit: 'g' });
    expect(plain.statusCode, plain.body).toBe(201);
    expect(counter.count).toBe(8); // key, tenant-wide, insert, audit, 2 bump, key response, prune
    expect(plain.json().data.stock_item).toEqual({
      stock_item_id: expect.any(String),
      name: 'Karahi pot',
      stock_unit: 'g',
      carries_over: false,
      archived_at: null,
      kind: 'prepared',
      code: null,
      cost_category: 'food',
      is_a_item: false,
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(await versions()).toEqual(before.map((v) => v + 1));

    const onion = await post({ name: 'Onion', stock_unit: 'g', kind: 'ingredient', cost_category: 'food', is_a_item: true });
    expect(onion.statusCode, onion.body).toBe(201);
    expect(counter.count).toBe(8);
    expect(onion.json().data.stock_item).toMatchObject({ kind: 'ingredient', code: null, cost_category: 'food', is_a_item: true });

    const box = await post({ name: 'Box', stock_unit: 'piece', kind: 'ingredient', cost_category: 'packaging' });
    expect(box.statusCode, box.body).toBe(201);
    expect(box.json().data.stock_item).toMatchObject({ kind: 'ingredient', cost_category: 'packaging', is_a_item: false });

    const qmKey = '01J00000000000000000000097';
    const qm = await post({ name: 'QM-1 qeema packet', stock_unit: 'g', kind: 'packet', code: 'QM-1' }, { 'idempotency-key': qmKey });
    expect(qm.statusCode, qm.body).toBe(201);
    expect(counter.count).toBe(9); // + the code read
    expect(qm.json().data.stock_item).toMatchObject({ kind: 'packet', code: 'QM-1', stock_unit: 'g', carries_over: false });
    const stored = (await cloud.pool.query(`SELECT kind, code, cost_category, is_a_item FROM stock_items WHERE stock_item_id = $1`, [
      qm.json().data.stock_item.stock_item_id,
    ])).rows[0];
    expect(stored).toEqual({ kind: 'packet', code: 'QM-1', cost_category: 'food', is_a_item: false });
    // the audit row carries the new fields in after
    expect((await auditRows()).at(-1)).toMatchObject({
      action: 'create',
      before: null,
      after: expect.objectContaining({ kind: 'packet', code: 'QM-1', cost_category: 'food', is_a_item: false }),
    });

    // the same key replays the stored 201: same body, no new row, audit or bump
    const replay = await nothingWritten(() => post({ name: 'QM-1 qeema packet', stock_unit: 'g', kind: 'packet', code: 'QM-1' }, { 'idempotency-key': qmKey }), 201);
    expect(replay).toEqual(qm.json());

    const piecePacket = await nothingWritten(() => post({ name: 'PY-1 paye packet', stock_unit: 'piece', kind: 'packet' }), 422);
    expect(piecePacket.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_unit', reason: 'packet_unit' } });
    for (const body of [
      { name: 'Hot oil', stock_unit: 'ml', kind: 'ingredient', carries_over: true },
      { name: 'Hot oil', stock_unit: 'g', kind: 'packet', carries_over: true },
      { name: 'Hot oil', stock_unit: 'ml', kind: 'raw' },
      { name: 'Hot oil', stock_unit: 'ml', cost_category: 'fuel' },
      { name: 'Hot oil', stock_unit: 'ml', code: 'tp 1' },
    ]) {
      expect((await nothingWritten(() => post(body), 400)).error.code, JSON.stringify(body)).toBe('VALIDATION_FAILED');
    }
    // carries_over on prepared is 01c's meaning
    const pot = await post({ name: 'Nihari pot', stock_unit: 'g', kind: 'prepared', carries_over: true });
    expect(pot.statusCode, pot.body).toBe(201);
    const keys = await cloud.pool.query(`SELECT count(*)::int AS n FROM idempotency_keys WHERE route = 'POST /v1/admin/stock-items'`);
    expect(keys.rows[0]).toEqual({ n: 5 + 5 }); // the fixture's five, these five; the refused POSTs stored no key
  });

  it('[08a #8 ⚠️ 08b P-1] code: uppercased; active clash → 409 stock_item_code; archived-only clash → 201; name and code taken → 409 stock_item_code (m-13); restore onto a held code → 409 stock_item_code, nothing written (N-7)', async () => {
    const created = await post({ name: 'Qeema packet', stock_unit: 'g', kind: 'packet', code: ' qm-1 ' });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json().data.stock_item.code).toBe('QM-1');

    const clash = await nothingWritten(() => post({ name: 'Tikka packet 2', stock_unit: 'g', kind: 'packet', code: 'tp-1' }), 409);
    expect(clash.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item_code' } });
    // name and code taken: the code read runs before the insert's name index
    const both = await nothingWritten(() => post({ name: 'tp-1 TIKKA PACKET', stock_unit: 'g', kind: 'packet', code: 'TP-1' }), 409);
    expect(both.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item_code' } });
    expect((await post({ name: 'tp-1 TIKKA PACKET', stock_unit: 'g', kind: 'packet', code: 'TP-1' })).statusCode).toBe(409);
    expect(counter.count).toBe(3); // key, tenant-wide, code read (rolled back)
    // the name alone still answers the name entity
    const nameOnly = await nothingWritten(() => post({ name: 'TP-1 tikka packet', stock_unit: 'g', kind: 'packet' }), 409);
    expect(nameOnly.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item' } });

    // archived-only holder → the code is free
    const old = await createStockItem(cloud, fx.f, { name: 'Old seekh', stock_unit: 'g', kind: 'packet', code: 'SK-1' }, { archived: true });
    const reuse = await post({ name: 'Seekh packet', stock_unit: 'g', kind: 'packet', code: 'sk-1' });
    expect(reuse.statusCode, reuse.body).toBe(201);
    expect(reuse.json().data.stock_item.code).toBe('SK-1');

    // N-7: restoring the archived holder → the index answers, mapped by constraint name
    const fresh = await stockItem(cloud, fx.f, old.stock_item_id);
    const restore = await nothingWritten(() => patch(old.stock_item_id, { expected_version: fresh.version, archived: false }), 409);
    expect(restore.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item_code' } });

    // PATCH R7: code sent and differs → one read; taken → 409; the same code → no read
    const beef = await stockItem(cloud, fx.f, fx.ids.beef);
    const taken = await nothingWritten(() => patch(fx.ids.beef, { expected_version: beef.version, code: 'qm-1' }), 409);
    expect(taken.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item_code' } });
    const coded = await patch(fx.ids.beef, { expected_version: beef.version, code: 'bf-1' });
    expect(coded.statusCode, coded.body).toBe(200);
    expect(counter.count).toBe(7); // tenant-wide, lock, code read, update, audit, 2 bump (⚠️ 08b P-1: code is in inventory.items[])
    expect(coded.json().data.stock_item.code).toBe('BF-1');
    const recoded = await patch(fx.ids.beef, { expected_version: coded.json().data.stock_item.version, code: 'BF-1', is_a_item: true });
    expect(recoded.statusCode, recoded.body).toBe(200);
    expect(counter.count).toBe(6); // same code: no code read (⚠️ 08b P-1: + 2 bump)
    const cleared = await patch(fx.ids.beef, { expected_version: recoded.json().data.stock_item.version, code: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(counter.count).toBe(6); // null clears, R7 read skipped (AD-8): tenant-wide, lock, update, audit, 2 bump (⚠️ 08b P-1)
    expect(cleared.json().data.stock_item.code).toBeNull();
    // R7 also on an archived merged row: archive + a code an active item holds → 409, nothing written
    const plain = cleared.json().data.stock_item as StockItemWire;
    const archivedClash = await nothingWritten(() => patch(fx.ids.beef, { expected_version: plain.version, archived: true, code: 'TP-1' }), 409);
    expect(archivedClash.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item_code' } });
    expect((await patch(fx.ids.beef, { expected_version: plain.version, archived: true, code: 'TP-1' })).statusCode).toBe(409);
    expect(counter.count).toBe(5); // tenant-wide, lock, drawers read (archiving), recipes read (archiving; ⚠️ 08b v1.0 C-11), code read
  });

  it('[08a #9 ⚠️ 08b P-1] PATCH only is_a_item → 200, one audit row, bumps every branch; statements = the bump path (B16)', async () => {
    const before = await versions();
    const beef = await stockItem(cloud, fx.f, fx.ids.beef);
    const auditBefore = (await auditRows()).length;
    const response = await patch(fx.ids.beef, { expected_version: beef.version, is_a_item: true });
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(6); // tenant-wide, lock, update, audit, 2 bump (⚠️ 08b P-1: was the bump path − 2)
    const wire = response.json().data.stock_item as StockItemWire;
    expect(wire).toMatchObject({ is_a_item: true, kind: 'ingredient' });
    expect(wire.version).not.toBe(beef.version);
    expect(await versions()).toEqual(before.map((v) => v + 1)); // ⚠️ 08b P-1: is_a_item is in inventory.items[]
    const audit = await auditRows();
    expect(audit).toHaveLength(auditBefore + 1);
    expect(audit.at(-1)).toMatchObject({
      entity_id: fx.ids.beef,
      action: 'update',
      before: expect.objectContaining({ is_a_item: false }),
      after: expect.objectContaining({ is_a_item: true }),
    });

    // the bump path for the same item: a field of 01c's stock (name) changes → 6, the same count
    const renamed = await patch(fx.ids.beef, { expected_version: wire.version, name: 'Beef boneless' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(counter.count).toBe(6);

    // cost_category / kind (ingredient → prepared, nothing in use) bump every branch too (⚠️ 08b P-1)
    const v = await versions();
    const cat = await patch(fx.ids.beef, { expected_version: renamed.json().data.stock_item.version, cost_category: 'beverage' });
    expect(cat.statusCode, cat.body).toBe(200);
    expect(counter.count).toBe(6); // ⚠️ 08b P-1: + 2 bump
    const toPrepared = await patch(fx.ids.beef, { expected_version: cat.json().data.stock_item.version, kind: 'prepared' });
    expect(toPrepared.statusCode, toPrepared.body).toBe(200);
    expect(counter.count).toBe(7); // a change to prepared reads no drawers or branch rows; + the recipes read (⚠️ 08b v1.0 P-2: any kind change); + 2 bump (⚠️ 08b P-1)
    expect(await versions()).toEqual(v.map((x) => x + 2));
  });

  it('[08a #10] PATCH name + is_a_item → 200, one audit row, every branch bumped', async () => {
    const before = await versions();
    const ghee = await stockItem(cloud, fx.f, fx.ids.ghee);
    const response = await patch(fx.ids.ghee, { expected_version: ghee.version, name: 'Desi ghee', is_a_item: false });
    expect(response.statusCode, response.body).toBe(200);
    expect(counter.count).toBe(6); // tenant-wide, lock, update, audit, 2 bump
    expect(response.json().data.stock_item).toMatchObject({ name: 'Desi ghee', is_a_item: false });
    expect(await versions()).toEqual(before.map((v) => v + 1));
    // stock_unit, carries_over and archived bump too
    const v1 = await versions();
    const unit = await patch(fx.ids.ghee, { expected_version: response.json().data.stock_item.version, stock_unit: 'ml' });
    expect(unit.statusCode, unit.body).toBe(200);
    expect(await versions()).toEqual(v1.map((v) => v + 1));
    const archived = await patch(fx.ids.ghee, { expected_version: unit.json().data.stock_item.version, archived: true });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(await versions()).toEqual(v1.map((v) => v + 2));
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: fx.ids.ghee, action: 'archive' });
    const restored = await patch(fx.ids.ghee, { expected_version: archived.json().data.stock_item.version, archived: false });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(await versions()).toEqual(v1.map((v) => v + 3));
    expect((await auditRows()).at(-1)).toMatchObject({ entity_id: fx.ids.ghee, action: 'restore' });
  });

  it('[08a #11 ⚠️ 08b P-1] PATCH kind away from prepared: branch row → 409 stock_item_branch; only an active drawer → 409 menu_item; only an archived drawer → 200 (R4)', async () => {
    const payeCooked = await stockItem(cloud, fx.f, fx.ids.payeCooked);
    // carries_over off first (R6 would answer 400 otherwise, test 14)
    const off = await patch(fx.ids.payeCooked, { expected_version: payeCooked.version, carries_over: false });
    expect(off.statusCode, off.body).toBe(200);
    const v1 = off.json().data.stock_item.version as string;

    const counted = await nothingWritten(() => patch(fx.ids.payeCooked, { expected_version: v1, kind: 'ingredient' }), 409);
    expect(counted.error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'stock_item', id: fx.ids.payeCooked, used_by: { entity: 'stock_item_branch', ids: [fx.lakeCity] } },
    });
    expect((await patch(fx.ids.payeCooked, { expected_version: v1, kind: 'ingredient' })).statusCode).toBe(409);
    expect(counter.count).toBe(4); // tenant-wide, lock, drawers read, branch-rows read

    await removeBranchRow(fx.ids.payeCooked);
    const drawn = await nothingWritten(() => patch(fx.ids.payeCooked, { expected_version: v1, kind: 'packet', stock_unit: 'g' }), 409);
    expect(drawn.error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'stock_item', id: fx.ids.payeCooked, used_by: { entity: 'menu_item', ids: [fx.payeHalfItemId] } },
    });

    await archiveItem(fx.payeHalfItemId);
    const before = await versions();
    const changed = await patch(fx.ids.payeCooked, { expected_version: v1, kind: 'ingredient' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(counter.count).toBe(9); // tenant-wide, lock, drawers read, branch-rows read, recipes read (⚠️ 08b v1.0 P-2), update, audit, 2 bump (⚠️ 08b P-1)
    expect(changed.json().data.stock_item).toMatchObject({ kind: 'ingredient' });
    expect(await versions()).toEqual(before.map((v) => v + 1)); // ⚠️ 08b P-1: kind is in inventory.items[]

    // a branch row only at a branch outside the token still blocks
    const pot = await createStockItem(cloud, fx.f, { name: 'Karahi pot', stock_unit: 'g' });
    const [, , c] = fx.f.branches;
    await cloud.pool.query(
      `INSERT INTO stations (tenant_id, branch_id, station_id, point_id, name, station_type, capacity, created_at, updated_at)
       VALUES ($1, $2, 'ST-C', (SELECT point_id FROM points WHERE tenant_id = $1 AND branch_id = $2 AND name = 'Pass'), 'Karahi', 'slot', 4, 0, 0)`,
      [fx.f.tenantId, c],
    );
    await putStockItemBranch(cloud, fx.f, pot.stock_item_id, c, {
      expected_version: stockItemBranchVersion(pot.stock_item_id, c, null).version,
      station_id: 'ST-C',
    });
    const fresh = await stockItem(cloud, fx.f, pot.stock_item_id);
    const outside = await cloud.app.inject({
      method: 'PATCH',
      url: `/v1/admin/stock-items/${pot.stock_item_id}`,
      headers: { authorization: `Bearer ${fx.f.tokenFor([fx.f.branches[0]])}` },
      payload: { expected_version: fresh.version, kind: 'ingredient' },
    });
    expect(outside.statusCode, outside.body).toBe(409);
    expect(outside.json().error).toMatchObject({ details: { used_by: { entity: 'stock_item_branch', ids: [c] } } });
  });

  it('[08a §6.3 R5, R6] kind packet on an ingredient in piece → 422 packet_unit; with stock_unit g → 200; carries_over on a non-prepared → 400', async () => {
    const egg = await createStockItem(cloud, fx.f, { name: 'Anday', stock_unit: 'piece', kind: 'ingredient' });
    const refused = await nothingWritten(() => patch(egg.stock_item_id, { expected_version: egg.version, kind: 'packet' }), 422);
    expect(refused.error).toMatchObject({ code: 'CONFIG_REFERENCE_INVALID', details: { field: 'stock_unit', reason: 'packet_unit' } });
    const g = await patch(egg.stock_item_id, { expected_version: egg.version, kind: 'packet', stock_unit: 'g' });
    expect(g.statusCode, g.body).toBe(200);
    const packet = g.json().data.stock_item as StockItemWire;
    // a packet's stock_unit stays g
    const back = await nothingWritten(() => patch(egg.stock_item_id, { expected_version: packet.version, stock_unit: 'piece' }), 422);
    expect(back.error).toMatchObject({ details: { field: 'stock_unit', reason: 'packet_unit' } });
    const carries = await nothingWritten(() => patch(egg.stock_item_id, { expected_version: packet.version, carries_over: true }), 400);
    expect(carries.error.code).toBe('VALIDATION_FAILED');
    // kind prepared on an ingredient → 200, then carries_over is allowed
    const prepared = await patch(egg.stock_item_id, { expected_version: packet.version, kind: 'prepared', carries_over: true });
    expect(prepared.statusCode, prepared.body).toBe(200);
    expect(prepared.json().data.stock_item).toMatchObject({ kind: 'prepared', carries_over: true });
  });

  it('[08a #13] list: kind filter; bad kind → 400; foreign branch_id → 404 before SQL; menu_cost per I7; 5 statements', async () => {
    const [a, b] = fx.f.branches;
    const now = cloud.clock.branchNow();
    const price = async (o: {
      id: string;
      stockItemId: string;
      branch?: string | null;
      kind?: 'manual' | 'market_rate';
      minor: number;
      unit?: string;
      num?: number;
      den?: number;
      stockUnit?: string;
      createdAt: number;
      until?: number | null;
    }) =>
      cloud.pool.query(
        `INSERT INTO item_prices (tenant_id, price_id, stock_item_id, branch_id, kind, unit_name, price_minor, stock_qty_num, stock_qty_den,
                                  stock_unit, created_at, valid_until_at, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13)`,
        [
          fx.f.tenantId,
          o.id,
          o.stockItemId,
          o.branch ?? null,
          o.kind ?? 'manual',
          o.unit ?? 'kg',
          o.minor,
          o.num ?? 1000,
          o.den ?? 1,
          o.stockUnit ?? 'g',
          o.createdAt,
          o.until ?? null,
          fx.f.userId,
        ],
      );
    // ghee (g): manual Rs 1,500 / kg every branch; a newer every-branch market rate, expired; a branch market rate at A
    await price({ id: 'P1', stockItemId: fx.ids.ghee, minor: 150000, createdAt: now - 10 * 3_600_000 });
    await price({ id: 'P2', stockItemId: fx.ids.ghee, kind: 'market_rate', minor: 140000, createdAt: now - 30 * 3_600_000 + 1, until: now - 6 * 3_600_000 });
    await price({ id: 'P3', stockItemId: fx.ids.ghee, kind: 'market_rate', branch: a, minor: 160000, createdAt: now - 3_600_000, until: now + 3_600_000 });
    // in effect only from later, and a row in another stock unit: never candidates
    await price({ id: 'P4', stockItemId: fx.ids.ghee, minor: 999000, createdAt: now + 1 });
    await price({ id: 'P5', stockItemId: fx.ids.ghee, minor: 888000, stockUnit: 'ml', unit: 'l', createdAt: now - 1 });
    // beef: a branch market rate at B that expired exactly now → falls back to nothing (no every-branch row)
    await price({ id: 'P6', stockItemId: fx.ids.beef, kind: 'market_rate', branch: b, minor: 200000, createdAt: now - 3_600_000, until: now });
    // TP-1 packet (g): Rs 400 per 'tray' of 12 g → 40 000 / 12 = 10 000/3 minor per g
    await price({ id: 'P7', stockItemId: fx.ids.tp1, minor: 40000, unit: 'tray', num: 12, den: 1, createdAt: now - 5 });

    const all = await list();
    expect(all.statusCode, all.body).toBe(200);
    expect(counter.count).toBe(5); // coversEveryBranch, stock items, branch rows, drawers, price candidates
    const rows = all.json().data.stock_items as Array<StockItemWire & { menu_cost: unknown }>;
    expect(rows.map((r) => r.name).sort()).toEqual(['Beef', 'Ghee', 'PAYE-COOKED', 'Paye raw', 'TP-1 tikka packet']);
    const cost = (rs: typeof rows, id: string) => rs.find((r) => r.stock_item_id === id)?.menu_cost;
    expect(cost(rows, fx.ids.ghee)).toEqual({
      branch_id: null,
      price_id: 'P1',
      per_stock_unit: { num: '150', den: '1' },
      display_per: { unit: 'kg', minor: '150000', below_one_minor: false },
    });
    expect(cost(rows, fx.ids.beef)).toBeNull();
    expect(cost(rows, fx.ids.payeCooked)).toBeNull();
    expect(cost(rows, fx.ids.tp1)).toEqual({
      branch_id: null,
      price_id: 'P7',
      per_stock_unit: { num: '10000', den: '3' },
      display_per: { unit: 'kg', minor: '3333333', below_one_minor: false },
    });

    const atA = await list(`?branch_id=${a}`);
    expect(atA.statusCode, atA.body).toBe(200);
    expect(counter.count).toBe(5);
    const aRows = atA.json().data.stock_items as typeof rows;
    expect(cost(aRows, fx.ids.ghee)).toEqual({
      branch_id: a,
      price_id: 'P3',
      per_stock_unit: { num: '160', den: '1' },
      display_per: { unit: 'kg', minor: '160000', below_one_minor: false },
    });
    const atB = (await list(`?branch_id=${b}`)).json().data.stock_items as typeof rows;
    expect(cost(atB, fx.ids.ghee)).toMatchObject({ branch_id: null, price_id: 'P1' });
    expect(cost(atB, fx.ids.beef)).toBeNull();

    // m-5: paye raw g → piece: its g price becomes "other unit", no menu cost; back to g → restored (I5, m-6)
    await price({ id: 'P8', stockItemId: fx.ids.payeRaw, minor: 50000, createdAt: now - 7 });
    const payeCost = { branch_id: null, price_id: 'P8', per_stock_unit: { num: '50', den: '1' }, display_per: { unit: 'kg', minor: '50000', below_one_minor: false } };
    expect(cost((await list()).json().data.stock_items, fx.ids.payeRaw)).toEqual(payeCost);
    const raw = await stockItem(cloud, fx.f, fx.ids.payeRaw);
    const toPiece = await patch(fx.ids.payeRaw, { expected_version: raw.version, stock_unit: 'piece' });
    expect(toPiece.statusCode, toPiece.body).toBe(200);
    expect(cost((await list()).json().data.stock_items, fx.ids.payeRaw)).toBeNull();
    const toG = await patch(fx.ids.payeRaw, { expected_version: toPiece.json().data.stock_item.version, stock_unit: 'g' });
    expect(toG.statusCode, toG.body).toBe(200);
    expect(cost((await list()).json().data.stock_items, fx.ids.payeRaw)).toEqual(payeCost);

    const ingredients = await list('?kind=ingredient');
    expect(ingredients.statusCode).toBe(200);
    expect(counter.count).toBe(5);
    expect((ingredients.json().data.stock_items as StockItemWire[]).map((r) => r.stock_item_id)).toEqual([fx.ids.beef, fx.ids.ghee, fx.ids.payeRaw]);
    const packets = (await list('?kind=packet')).json().data.stock_items as StockItemWire[];
    expect(packets.map((r) => [r.stock_item_id, r.kind, r.code])).toEqual([[fx.ids.tp1, 'packet', 'TP-1']]);
    const prepared = (await list('?kind=prepared&status=active')).json().data.stock_items as StockItemWire[];
    expect(prepared.map((r) => r.stock_item_id)).toEqual([fx.ids.payeCooked]);
    expect((await list('?kind=prepared&status=archived')).json().data.stock_items).toEqual([]);
    expect(counter.count).toBe(5);

    expect((await list('?kind=raw')).statusCode).toBe(400);
    for (const [query, token] of [
      [`?branch_id=${fx.f.other.branchId}`, undefined],
      ['?branch_id=NO-SUCH', undefined],
      [`?branch_id=${b}`, fx.f.tokenFor([a])],
    ] as const) {
      const missing = await list(query, token);
      expect(missing.statusCode, query).toBe(404);
      expect(missing.json().error).toMatchObject({ code: 'BRANCH_NOT_FOUND' });
      expect(counter.count, query).toBe(0); // C2 before any SQL
    }
  });

  it('[08a #14] precedence: carries_over on an ingredient and a kind change in use → 400 first (R6 before R4)', async () => {
    const payeCooked = await stockItem(cloud, fx.f, fx.ids.payeCooked);
    expect(payeCooked).toMatchObject({ kind: 'prepared', carries_over: true });
    const refused = await nothingWritten(() => patch(fx.ids.payeCooked, { expected_version: payeCooked.version, kind: 'ingredient', carries_over: true }), 400);
    expect(refused.error.code).toBe('VALIDATION_FAILED');
    // carries_over stored true, kind change alone → also R6 (merged row) before R4
    expect((await nothingWritten(() => patch(fx.ids.payeCooked, { expected_version: payeCooked.version, kind: 'ingredient' }), 400)).error.code).toBe(
      'VALIDATION_FAILED',
    );
    // 409 (R4) before 422 (R5): packet in piece while counted
    const r4 = await nothingWritten(() => patch(fx.ids.payeCooked, { expected_version: payeCooked.version, kind: 'packet', carries_over: false }), 409);
    expect(r4.error).toMatchObject({ code: 'CONFIG_IN_USE', details: { used_by: { entity: 'stock_item_branch' } } });
    // 422 (R5) before R7 (code) and R3 (name)
    const egg = await createStockItem(cloud, fx.f, { name: 'Anday', stock_unit: 'piece', kind: 'ingredient' });
    const r5 = await nothingWritten(() => patch(egg.stock_item_id, { expected_version: egg.version, kind: 'packet', code: 'TP-1', name: 'Beef' }), 422);
    expect(r5.error).toMatchObject({ details: { field: 'stock_unit', reason: 'packet_unit' } });
    // R7 before R3
    const r7 = await nothingWritten(() => patch(egg.stock_item_id, { expected_version: egg.version, code: 'TP-1', name: 'Beef' }), 409);
    expect(r7.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item_code' } });
    const r3 = await nothingWritten(() => patch(egg.stock_item_id, { expected_version: egg.version, code: 'AN-1', name: 'Beef' }), 409);
    expect(r3.error).toMatchObject({ code: 'CONFIG_NAME_TAKEN', details: { entity: 'stock_item' } });
    // R2 before R4: archive + kind change on PAYE-COOKED (branch row and active drawer) → 409 menu_item
    const r2 = await nothingWritten(
      () => patch(fx.ids.payeCooked, { expected_version: payeCooked.version, archived: true, kind: 'ingredient', carries_over: false }),
      409,
    );
    expect(r2.error).toMatchObject({
      code: 'CONFIG_IN_USE',
      details: { entity: 'stock_item', id: fx.ids.payeCooked, used_by: { entity: 'menu_item', ids: [fx.payeHalfItemId] } },
    });
    // 403 tenant-wide stays first on every path
    await cloud.pool.query(`UPDATE owner_users SET allowed_branch_ids = $3 WHERE tenant_id = $1 AND user_id = $2`, [
      fx.f.tenantId,
      fx.f.userId,
      [fx.f.branches[0]],
    ]);
    const denied = await nothingWritten(() => patch(fx.ids.payeCooked, { expected_version: payeCooked.version, kind: 'ingredient' }), 403);
    expect(denied.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { reason: 'tenant_wide_write' } });
  });
});
