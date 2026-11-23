import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { fixedClock } from '../../src/lib/clock';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 08a §5.1 (A-1), test 27: a scratch database migrated to 0017 (01c era) with stock items, then the real folder
// (with 0018_inventory_config.sql). Every existing stock item reads as prepared / food / not an A-item; no
// config_version change (I11); the new tables and CHECKs as §5.1.

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;
let preVersions: Array<[string, bigint]> = [];
let preEntityDef = '';
let preActionDef = '';
const constraintDef = async (name: string): Promise<string> =>
  (await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [name])).rows[0]!.def as string;
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(17));
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  await q(
    `INSERT INTO owner_users (tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids, created_at)
     VALUES ($1, 'u1', 'owner@example.test', 'Owner', 'x', ARRAY['b1','b2'], $2)`,
    [TN, T],
  );
  for (const [id, name, unit, carries] of [
    ['s1', 'PAYE-COOKED', 'piece', true],
    ['s2', 'Karahi pot', 'g', false],
    ['s4', 'Anday', 'piece', false],
  ] as const) {
    await q(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, carries_over, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [TN, id, name, unit, carries, T],
    );
  }
  preVersions = (await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, BigInt(String(r.config_version))]);
  // 01b D-5: the live CHECKs, read before the migration
  preEntityDef = await constraintDef('config_audit_entity_check');
  preActionDef = await constraintDef('config_audit_action_check');
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

// a CHECK refusal by that constraint only (code 23514 + its name), so one CHECK cannot hide another
async function refused(constraint: string, sql: string, params: unknown[] = []): Promise<void> {
  await expect(q(sql, params)).rejects.toMatchObject({ code: '23514', constraint });
}

describe('[08a §5.1, #27] cloud migration 0018_inventory_config.sql', () => {
  it('[08a #27] every existing stock item is prepared, food, not an A-item, no code; no config_version change; no audit row', async () => {
    const { rows } = await q(`SELECT stock_item_id, kind, code, cost_category, is_a_item FROM stock_items ORDER BY stock_item_id`);
    expect(rows).toEqual([
      { stock_item_id: 's1', kind: 'prepared', code: null, cost_category: 'food', is_a_item: false },
      { stock_item_id: 's2', kind: 'prepared', code: null, cost_category: 'food', is_a_item: false },
      { stock_item_id: 's4', kind: 'prepared', code: null, cost_category: 'food', is_a_item: false },
    ]);
    const versions = (await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, BigInt(String(r.config_version))]);
    // ⚠️ 08b v1.0 A-6: the whole folder runs, and 0019_recipes.sql bumps every branch once (0018 itself bumps none)
    expect(versions).toEqual(preVersions.map(([b, v]) => [b, v + 1n]));
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
  });

  it('[08a #27] stock_items CHECKs: kind list, code pattern, packet ⇒ g, carries_over ⇒ prepared; active code unique', async () => {
    await refused('stock_items_kind_check', `UPDATE stock_items SET kind = 'produced' WHERE stock_item_id = 's2'`);
    await refused('stock_items_code_check', `UPDATE stock_items SET code = 'tp-1' WHERE stock_item_id = 's2'`);
    await refused('stock_items_code_check', `UPDATE stock_items SET code = 'ABCDEFGHIJKLMNOPQ' WHERE stock_item_id = 's2'`);
    await refused('stock_items_cost_category_check', `UPDATE stock_items SET cost_category = 'fuel' WHERE stock_item_id = 's2'`);
    await refused('stock_items_packet_unit', `UPDATE stock_items SET kind = 'packet' WHERE stock_item_id = 's4'`); // piece, no carries_over
    await refused('stock_items_carries_over_kind', `UPDATE stock_items SET kind = 'ingredient' WHERE stock_item_id = 's1'`);
    await q(`UPDATE stock_items SET kind = 'ingredient' WHERE stock_item_id = 's4'`); // piece ingredient is fine
    await q(`UPDATE stock_items SET kind = 'packet', code = 'TP-1' WHERE stock_item_id = 's2'`);
    await q(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, kind, code, created_at, updated_at)
       VALUES ($1, 's3', 'Other', 'g', 'ingredient', 'X-1', $2, $2)`,
      [TN, T],
    );
    // defaults on a new row
    expect((await q(`SELECT cost_category, is_a_item FROM stock_items WHERE stock_item_id = 's3'`)).rows[0]).toEqual({ cost_category: 'food', is_a_item: false });
    await expect(q(`UPDATE stock_items SET code = 'TP-1' WHERE stock_item_id = 's3'`)).rejects.toMatchObject({
      code: '23505',
      constraint: 'stock_items_active_code',
    });
    await q(`UPDATE stock_items SET archived_at = $1 WHERE stock_item_id = 's2'`, [T]);
    await q(`UPDATE stock_items SET code = 'TP-1' WHERE stock_item_id = 's3'`); // an archived holder does not block
  });

  it('[08a #27] stock_item_units: name pattern, not its base unit, factor ranges', async () => {
    const ins = (name: string, base: string, num: number, den: number, o: { item?: string; by?: string; note?: string | null } = {}) =>
      q(
        `INSERT INTO stock_item_units (tenant_id, unit_row_id, stock_item_id, unit_name, base_unit, factor_num, factor_den, note, recorded_by, created_at)
         VALUES ($1, gen_random_uuid()::text, $7, $2, $3, $4, $5, $8, $9, $6)`,
        [TN, name, base, num, den, T, o.item ?? 's3', o.note ?? null, o.by ?? 'u1'],
      );
    const bad = (constraint: string, p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: '23514', constraint });
    await ins('peti', 'g', 12_000, 1);
    await ins('1 l bottle', 'g', 1_000_000_000, 1_000_000, { note: 'x'.repeat(200) });
    await bad('stock_item_units_unit_name_check', ins('Peti', 'g', 1, 1));
    await bad('stock_item_units_unit_name_check', ins('a'.repeat(21), 'g', 1, 1));
    await bad('stock_item_units_check', ins('g', 'g', 1, 1));
    await bad('stock_item_units_base_unit_check', ins('peti', 'kg', 1, 1));
    await bad('stock_item_units_factor_num_check', ins('peti', 'g', 0, 1));
    await bad('stock_item_units_factor_num_check', ins('peti', 'g', 1_000_000_001, 1));
    await bad('stock_item_units_factor_den_check', ins('peti', 'g', 1, 0));
    await bad('stock_item_units_factor_den_check', ins('peti', 'g', 1, 1_000_001));
    await bad('stock_item_units_note_check', ins('peti', 'g', 1, 1, { note: 'x'.repeat(201) }));
    await expect(ins('peti', 'g', 1, 1, { item: 'nope' })).rejects.toMatchObject({ code: '23503' });
    await expect(ins('peti', 'g', 1, 1, { by: 'nobody' })).rejects.toMatchObject({ code: '23503' });
  });

  it('[08a #27] item_prices: manual has no branch and no validity; market rate 1 h … 30 days; price 1 … 1e9', async () => {
    const ins = (
      kind: string,
      branch: string | null,
      price: number,
      until: number | null,
      o: { num?: number; den?: number; unit?: string; note?: string | null; item?: string; by?: string } = {},
    ) =>
      q(
        `INSERT INTO item_prices (tenant_id, price_id, stock_item_id, branch_id, kind, unit_name, price_minor,
                                  stock_qty_num, stock_qty_den, stock_unit, created_at, valid_until_at, note, recorded_by)
         VALUES ($1, gen_random_uuid()::text, $9, $2, $3, 'kg', $4, $7, $8, $10, $5, $6, $11, $12)`,
        [TN, branch, kind, price, T, until, o.num ?? 1000, o.den ?? 1, o.item ?? 's3', o.unit ?? 'g', o.note ?? null, o.by ?? 'u1'],
      );
    const bad = (constraint: string, p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: '23514', constraint });
    await ins('manual', null, 150_000, null);
    await ins('manual', null, 1_000_000_000, null, { note: 'x'.repeat(200) });
    await ins('market_rate', 'b1', 1, T + 3_600_000);
    await ins('market_rate', null, 150_000, T + 2_592_000_000);
    await bad('item_prices_check', ins('manual', 'b1', 150_000, null)); // M-6: no branch manual price
    await bad('item_prices_check1', ins('manual', null, 150_000, T + 3_600_000));
    await bad('item_prices_check1', ins('market_rate', null, 150_000, null));
    await bad('item_prices_check2', ins('market_rate', null, 150_000, T + 2_592_000_001));
    await bad('item_prices_check2', ins('market_rate', null, 150_000, T));
    await bad('item_prices_kind_check', ins('quote', null, 150_000, T + 3_600_000));
    await bad('item_prices_price_minor_check', ins('manual', null, 0, null));
    await bad('item_prices_price_minor_check', ins('manual', null, 1_000_000_001, null));
    await bad('item_prices_stock_qty_num_check', ins('manual', null, 1, null, { num: 0 }));
    await bad('item_prices_stock_qty_den_check', ins('manual', null, 1, null, { den: 0 }));
    await bad('item_prices_stock_unit_check', ins('manual', null, 1, null, { unit: 'kg' }));
    await bad('item_prices_note_check', ins('manual', null, 1, null, { note: 'x'.repeat(201) }));
    await expect(ins('market_rate', 'nope', 150_000, T + 3_600_000)).rejects.toMatchObject({ code: '23503' });
    await expect(ins('manual', null, 1, null, { item: 'nope' })).rejects.toMatchObject({ code: '23503' });
    await expect(ins('manual', null, 1, null, { by: 'nobody' })).rejects.toMatchObject({ code: '23503' });
  });

  it('[08a #27] yield_profiles: 1 … 50 000 bp; test quantities and unit all or none', async () => {
    const ins = (bp: number, ap: number | null, ep: number | null, unit: string | null, o: { note?: string | null; item?: string; by?: string } = {}) =>
      q(
        `INSERT INTO yield_profiles (tenant_id, yield_profile_id, stock_item_id, yield_bp, test_ap_qty, test_ep_qty, test_unit, note, recorded_by, created_at)
         VALUES ($1, gen_random_uuid()::text, $7, $2, $3, $4, $5, $8, $9, $6)`,
        [TN, bp, ap, ep, unit, T, o.item ?? 's3', o.note ?? null, o.by ?? 'u1'],
      );
    const bad = (constraint: string, p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: '23514', constraint });
    await ins(7_120, 10_000, 7_120, 'g');
    await ins(50_000, null, null, null, { note: 'x'.repeat(200) });
    await ins(1, 1_000_000_000, 1, 'piece');
    await bad('yield_profiles_yield_bp_check', ins(0, null, null, null));
    await bad('yield_profiles_yield_bp_check', ins(50_001, null, null, null));
    await bad('yield_profiles_check', ins(7_120, 10_000, null, 'g'));
    await bad('yield_profiles_check', ins(7_120, 10_000, 7_120, null));
    await bad('yield_profiles_test_ap_qty_check', ins(1, 0, 1, 'g'));
    await bad('yield_profiles_test_ep_qty_check', ins(1, 1, 1_000_000_001, 'g'));
    await bad('yield_profiles_test_unit_check', ins(1, 1, 1, 'kg'));
    await bad('yield_profiles_note_check', ins(1, null, null, null, { note: 'x'.repeat(201) }));
    await expect(ins(1, null, null, null, { item: 'nope' })).rejects.toMatchObject({ code: '23503' });
    await expect(ins(1, null, null, null, { by: 'nobody' })).rejects.toMatchObject({ code: '23503' });
  });

  it('[08a #27, A-1] config_audit entity CHECK takes the three new entities and keeps the old ones', async () => {
    const ins = (entity: string) =>
      q(
        `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, actor_owner_user_id, entity, entity_id, action, after, at)
         VALUES ($1, gen_random_uuid()::text, 'owner', 'u1', $2, 'x', 'create', '{}'::jsonb, $3)`,
        [TN, entity, T],
      );
    const before = [...preEntityDef.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
    expect(before).toHaveLength(23);
    const after = [...(await constraintDef('config_audit_entity_check')).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
    // ⚠️ 08b v1.0 A-5: the whole folder runs, and 0019_recipes.sql adds recipe, recipe_version and the action publish
    expect(after).toEqual([...before, 'stock_item_unit', 'item_price', 'yield_profile', 'recipe', 'recipe_version']);
    expect(await constraintDef('config_audit_action_check')).toBe(preActionDef.replace("'branch_removed'::text", "'branch_removed'::text, 'publish'::text")); // 0018: actions unchanged
    for (const entity of after) await ins(entity);
    await expect(ins('recipe_line')).rejects.toMatchObject({ code: '23514', constraint: 'config_audit_entity_check' });
  });
});
