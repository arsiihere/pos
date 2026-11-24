import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate';
import { assertTenantContext } from '../../src/db/tenant-scoped-repository';
import { fixedClock } from '../../src/lib/clock';
import { syncConfig } from '../../src/modules/config-sync/service';
import { dropScratchDatabases, scratchDatabaseAt } from '../helpers/scratch-db';

// 08 v1.1 Part B §5.1 (rows A-5, A-6), test 33: a scratch database migrated to 0018 (08a era) with two branches,
// an owner and stock items, then the real folder (with 0019_recipes.sql). The three recipe tables and their
// CHECKs as §5.1; config_audit takes recipe / recipe_version / publish; every branch's config_version + 1 (the
// release delivery of the inventory key, 01a MD-3 / AD-9 pattern). The key itself is s1's (AD-7): test 33's
// "with `inventory`" assertion is added in `test/config-sync/inventory-key.int.test.ts`.

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const T = 1_761_000_000_000;
const TN = 't1';

let pool: pg.Pool;
let preVersions: Record<string, number> = {};
let preEntityDef = '';
let preActionDef = '';
const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
const constraintDef = async (name: string): Promise<string> =>
  (await q(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`, [name])).rows[0]!.def as string;
const listed = (def: string) => [...def.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);

beforeAll(async () => {
  ({ pool } = await scratchDatabaseAt(18));
  await q(`INSERT INTO tenants (tenant_id, name, currency_code, created_at) VALUES ($1, 'Pilot', 'PKR', $2)`, [TN, T]);
  for (const b of ['b1', 'b2']) {
    await q(`INSERT INTO branches (tenant_id, branch_id, name, status, created_at) VALUES ($1, $2, $2, 'pending_hub', $3)`, [TN, b, T]);
  }
  await q(
    `INSERT INTO branch_engine_settings (tenant_id, branch_id, created_at, updated_at)
     SELECT tenant_id, branch_id, $2, $2 FROM branches WHERE tenant_id = $1 ON CONFLICT DO NOTHING`,
    [TN, T],
  );
  await q(
    `INSERT INTO owner_users (tenant_id, user_id, email, display_name, password_hash, allowed_branch_ids, created_at)
     VALUES ($1, 'u1', 'owner@example.test', 'Owner', 'x', ARRAY['b1','b2'], $2)`,
    [TN, T],
  );
  for (const [id, name, unit, kind] of [
    ['s1', 'PAYE-COOKED', 'piece', 'prepared'],
    ['s2', 'Beef', 'g', 'ingredient'],
    ['s3', 'Onion', 'g', 'ingredient'],
  ] as const) {
    await q(
      `INSERT INTO stock_items (tenant_id, stock_item_id, name, stock_unit, kind, carries_over, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, $6, $6)`,
      [TN, id, name, unit, kind, T],
    );
  }
  preVersions = Object.fromEntries((await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`)).rows.map((r) => [r.branch_id, Number(r.config_version)]));
  // 01b D-5: the live CHECKs, read before the migration
  preEntityDef = await constraintDef('config_audit_entity_check');
  preActionDef = await constraintDef('config_audit_action_check');
  await migrate(pool, migrationsDir, fixedClock(T));
}, 40_000);

afterAll(async () => {
  await dropScratchDatabases();
}, 40_000);

// a refusal by that constraint only (code + its name), so one CHECK cannot hide another
async function refused(code: string, constraint: string | null, sql: string, params: unknown[] = []): Promise<void> {
  await expect(q(sql, params)).rejects.toMatchObject(constraint === null ? { code } : { code, constraint });
}

// an unnamed CHECK, pinned by its definition text: the refusing constraint's pg_get_constraintdef contains `part`
async function refusedBy(part: string, sql: string, params: unknown[] = []): Promise<void> {
  const error = await q(sql, params).then(
    () => null,
    (e: { code?: string; constraint?: string }) => e,
  );
  expect(error).toMatchObject({ code: '23514' });
  expect(await constraintDef(error!.constraint!)).toContain(part);
}

const recipe = (id: string, ownerType: string, ownerId: string) =>
  q(`INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $5)`, [TN, id, ownerType, ownerId, T]);

interface VersionCols {
  status?: string;
  basis?: string;
  base_qty?: number | null;
  batch_yield_qty?: number | null;
  batch_stock_unit?: string | null;
  measure_unit?: string | null;
  misc?: number;
  published_at?: number | null;
  no?: number;
}
const version = (id: string, recipeId: string, v: VersionCols) =>
  q(
    `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty,
       batch_stock_unit, measure_unit, misc_allowance_bp, created_by, created_at, updated_at, published_by, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'u1', $12, $12, $13, $14)`,
    [
      TN,
      id,
      recipeId,
      v.no ?? 1,
      v.status ?? 'draft',
      v.basis ?? 'per_unit',
      v.base_qty ?? null,
      v.batch_yield_qty ?? null,
      v.batch_stock_unit ?? null,
      v.measure_unit ?? null,
      v.misc ?? 500,
      T,
      (v.published_at ?? null) === null ? null : 'u1',
      v.published_at ?? null,
    ],
  );

interface LineCols {
  line_no?: number;
  stock_item_id?: string;
  entered_num?: string;
  entered_den?: string;
  num?: string;
  den?: string;
  stock_unit?: string;
  qty_basis?: string;
}
const line = (versionId: string, l: LineCols) =>
  q(
    `INSERT INTO recipe_lines (tenant_id, recipe_version_id, line_no, stock_item_id, unit_name, entered_num, entered_den,
       stock_qty_num, stock_qty_den, stock_unit, qty_basis)
     VALUES ($1, $2, $3, $4, 'g', $5, $6, $7, $8, $9, $10)`,
    [TN, versionId, l.line_no ?? 1, l.stock_item_id ?? 's2', l.entered_num ?? '250', l.entered_den ?? '1', l.num ?? '250', l.den ?? '1', l.stock_unit ?? 'g', l.qty_basis ?? 'AP'],
  );

describe('[08b §5.1, #33] cloud migration 0019_recipes.sql', () => {
  it('[08b #33, A-6] every branch config_version + 1; a hub on the pre-migration version gets 200 with a new snapshot; no audit row', async () => {
    const { rows } = await q(`SELECT branch_id, config_version FROM branches ORDER BY branch_id`);
    // The full migration run includes one bump from 0019 and another from 0021 (01a v2.11 MG-1).
    expect(rows.map((r) => [r.branch_id, Number(r.config_version)])).toEqual([
      ['b1', preVersions.b1! + 2],
      ['b2', preVersions.b2! + 2],
    ]);
    expect((await q(`SELECT count(*)::int AS n FROM config_audit`)).rows[0]).toEqual({ n: 0 });
    const directory = Number((await q(`SELECT directory_version FROM tenants WHERE tenant_id = $1`, [TN])).rows[0].directory_version);
    const result = await syncConfig(pool, fixedClock(T), assertTenantContext(Object.freeze({ tenantId: TN, branchIds: Object.freeze(['b1']) })), {
      config_version: preVersions.b1!,
      directory_version: directory,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect((result.data.config!.snapshot as { config_version: number }).config_version).toBe(preVersions.b1! + 2);
  });

  it('[08b #33 §5.1] recipes: owner_type list; one recipe per owner (archived included)', async () => {
    await recipe('r-mi', 'menu_item', 'i1');
    await refused('23514', 'recipes_owner_type_check', `INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, created_at, updated_at) VALUES ($1, 'r-x', 'deal', 'd1', $2, $2)`, [TN, T]);
    await q(`UPDATE recipes SET archived_at = $2 WHERE tenant_id = $1 AND recipe_id = 'r-mi'`, [TN, T]);
    await expect(recipe('r-mi2', 'menu_item', 'i1')).rejects.toMatchObject({ code: '23505', constraint: 'recipes_tenant_id_owner_type_owner_id_key' });
    await recipe('r-opt', 'modifier_option', 'i1'); // same id, another owner type: a different owner
    await expect(q(`INSERT INTO recipes (tenant_id, recipe_id, owner_type, owner_id, created_at, updated_at) VALUES ('nope', 'r-y', 'menu_item', 'i9', $1, $1)`, [T])).rejects.toMatchObject({ code: '23503' });
  });

  it('[08b #33 §5.1 B3, T-2, N-1] recipe_versions: basis fields per basis; measure_unit on per_measure only; batch unit with batch yield', async () => {
    await recipe('r-v', 'menu_item', 'i2');
    await version('v-unit', 'r-v', { basis: 'per_unit' });
    await q(`DELETE FROM recipe_versions WHERE tenant_id = $1 AND recipe_version_id = 'v-unit'`, [TN]);
    await version('v-measure', 'r-v', { basis: 'per_measure', base_qty: 1000, measure_unit: 'ml' });
    await q(`DELETE FROM recipe_versions WHERE tenant_id = $1 AND recipe_version_id = 'v-measure'`, [TN]);
    // per_measure ⇔ base_qty and ⇔ measure_unit
    await refusedBy('base_qty IS NOT NULL', ...versionSql('x1', 'r-v', { basis: 'per_measure', measure_unit: 'g' }));
    await refusedBy('measure_unit IS NOT NULL', ...versionSql('x2', 'r-v', { basis: 'per_measure', base_qty: 1000 }));
    await refusedBy('base_qty IS NOT NULL', ...versionSql('x3', 'r-v', { basis: 'per_unit', base_qty: 1000 }));
    await refusedBy('measure_unit IS NOT NULL', ...versionSql('x4', 'r-v', { basis: 'per_unit', measure_unit: 'g' }));
    await refused('23514', 'recipe_versions_measure_unit_check', ...versionSql('x5', 'r-v', { basis: 'per_measure', base_qty: 1000, measure_unit: 'piece' }));
    await refused('23514', 'recipe_versions_base_qty_check', ...versionSql('x6', 'r-v', { basis: 'per_measure', base_qty: 1_000_001, measure_unit: 'g' }));
    // batch yield only on per_batch, with its frozen unit; a published per_batch needs it
    await refusedBy("basis = 'per_batch'::text) OR (batch_yield_qty IS NULL)", ...versionSql('x7', 'r-v', { basis: 'per_unit', batch_yield_qty: 160, batch_stock_unit: 'piece' }));
    await refusedBy('(batch_yield_qty IS NULL) = (batch_stock_unit IS NULL)', ...versionSql('x8', 'r-v', { basis: 'per_batch', batch_yield_qty: 160 }));
    await refusedBy('(batch_yield_qty IS NULL) = (batch_stock_unit IS NULL)', ...versionSql('x9', 'r-v', { basis: 'per_batch', batch_stock_unit: 'piece' }));
    await refusedBy('batch_yield_qty IS NOT NULL', ...versionSql('x10', 'r-v', { basis: 'per_batch', status: 'published', published_at: T }));
    await refused('23514', 'recipe_versions_batch_yield_qty_check', ...versionSql('x11', 'r-v', { basis: 'per_batch', batch_yield_qty: 1_000_000_001, batch_stock_unit: 'piece' }));
    await version('v-batch-draft', 'r-v', { basis: 'per_batch' }); // a draft may lack the yield (B6 checks it at publish)
    await q(`DELETE FROM recipe_versions WHERE tenant_id = $1 AND recipe_version_id = 'v-batch-draft'`, [TN]);
    // misc 0 … 5 000; status list; published_at ⇔ not draft
    await refused('23514', 'recipe_versions_misc_allowance_bp_check', ...versionSql('x12', 'r-v', { misc: 5001 }));
    await refused('23514', 'recipe_versions_status_check', ...versionSql('x13', 'r-v', { status: 'archived', published_at: T }));
    await refusedBy('published_at IS NULL', ...versionSql('x14', 'r-v', { status: 'published' }));
    await refusedBy('published_at IS NULL', ...versionSql('x15', 'r-v', { status: 'draft', published_at: T }));
    await refused('23514', 'recipe_versions_basis_check', ...versionSql('x16', 'r-v', { basis: 'per_kg' }));
    // lower bounds, the frozen batch unit list, version_no ≥ 1, the recipe and published_by FKs
    await refused('23514', 'recipe_versions_base_qty_check', ...versionSql('x17', 'r-v', { basis: 'per_measure', base_qty: 0, measure_unit: 'g' }));
    await refused('23514', 'recipe_versions_batch_yield_qty_check', ...versionSql('x18', 'r-v', { basis: 'per_batch', batch_yield_qty: 0, batch_stock_unit: 'piece' }));
    await refused('23514', 'recipe_versions_misc_allowance_bp_check', ...versionSql('x19', 'r-v', { misc: -1 }));
    await refused('23514', 'recipe_versions_batch_stock_unit_check', ...versionSql('x20', 'r-v', { basis: 'per_batch', batch_yield_qty: 10, batch_stock_unit: 'kg' }));
    await expect(version('x23', 'r-v', { no: 0 })).rejects.toMatchObject({ code: '23514', constraint: 'recipe_versions_version_no_check' });
    await refused('23503', null, ...versionSql('x21', 'r-none', {}));
    await refused('23503', null, `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, misc_allowance_bp, created_by, created_at, updated_at, published_by, published_at)
       VALUES ($1, 'x22', 'r-v', 98, 'published', 'per_unit', 500, 'u1', $2, $2, 'nobody', $2)`, [TN, T]);
  });

  it('[08b #33 §5.1 B8] one draft and one published per recipe; superseded many; version_no unique', async () => {
    await recipe('r-b8', 'menu_item', 'i3');
    await version('d1', 'r-b8', { no: 1 });
    await expect(version('d2', 'r-b8', { no: 2 })).rejects.toMatchObject({ code: '23505', constraint: 'recipe_versions_one_draft' });
    await version('p1', 'r-b8', { no: 2, status: 'published', published_at: T });
    await expect(version('p2', 'r-b8', { no: 3, status: 'published', published_at: T })).rejects.toMatchObject({ code: '23505', constraint: 'recipe_versions_one_published' });
    await version('s1', 'r-b8', { no: 3, status: 'superseded', published_at: T });
    await version('s2', 'r-b8', { no: 4, status: 'superseded', published_at: T });
    await expect(version('s3', 'r-b8', { no: 4, status: 'superseded', published_at: T })).rejects.toMatchObject({ code: '23505', constraint: 'recipe_versions_tenant_id_recipe_id_version_no_key' });
    await expect(q(`UPDATE recipe_versions SET created_by = 'nobody' WHERE tenant_id = $1 AND recipe_version_id = 'd1'`, [TN])).rejects.toMatchObject({ code: '23503' });
  });

  it('[08b #33 §5.1 B4] recipe_lines: line 1 … 60; qty ≠ 0, |frozen| ≤ 10^15, same sign; frozen unit and qty basis lists; a stock item once', async () => {
    await recipe('r-l', 'modifier_option', 'o1');
    await version('vl', 'r-l', {});
    await line('vl', { line_no: 1, stock_item_id: 's2' });
    await line('vl', { line_no: 2, stock_item_id: 's3', entered_num: '-30', num: '-30' }); // removal (B4: the service checks owner kind)
    await line('vl', { line_no: 60, stock_item_id: 's1', stock_unit: 'piece', num: '1000000000000000' });
    await expect(line('vl', { line_no: 3, stock_item_id: 's2' })).rejects.toMatchObject({ code: '23505', constraint: 'recipe_lines_tenant_id_recipe_version_id_stock_item_id_key' });
    await q(`DELETE FROM recipe_lines WHERE tenant_id = $1 AND recipe_version_id = 'vl'`, [TN]);
    const bad: Array<[string | null, LineCols]> = [
      ['recipe_lines_line_no_check', { line_no: 0 }],
      ['recipe_lines_line_no_check', { line_no: 61 }],
      [null, { entered_num: '0' }], // entered_num <> 0 (the sign CHECK may answer first)
      ['recipe_lines_entered_den_check', { entered_den: '0' }],
      [null, { num: '0' }], // stock_qty_num <> 0 (the sign CHECK may answer first)
      ['recipe_lines_stock_qty_num_check', { num: '1000000000000001' }],
      ['recipe_lines_stock_qty_num_check', { num: '-1000000000000001', entered_num: '-1' }],
      ['recipe_lines_stock_qty_den_check', { den: '0' }],
      ['recipe_lines_stock_unit_check', { stock_unit: 'kg' }],
      ['recipe_lines_qty_basis_check', { qty_basis: 'XP' }],
    ];
    for (const [constraint, cols] of bad) await refused('23514', constraint, ...lineSql('vl', cols));
    await refusedBy('sign(', ...lineSql('vl', { entered_num: '-30', num: '30' }));
    await expect(line('vl', { stock_item_id: 'nope' })).rejects.toMatchObject({ code: '23503' });
    await expect(line('nope', {})).rejects.toMatchObject({ code: '23503' });
  });

  it('[08b #33 §5.1] indexes for the B15 versions read and the B17 in-use read exist', async () => {
    const { rows } = await q(`SELECT indexname FROM pg_indexes WHERE tablename IN ('recipes','recipe_versions','recipe_lines') ORDER BY indexname`);
    const def = async (name: string) => (await q(`SELECT pg_get_indexdef(i.oid) AS d FROM pg_class i WHERE i.relname = $1`, [name])).rows[0]?.d as string;
    expect(rows.map((r) => r.indexname)).toEqual(
      expect.arrayContaining(['recipe_lines_stock_item', 'recipe_versions_one_draft', 'recipe_versions_one_published', 'recipe_versions_recent']),
    );
    expect(await def('recipe_versions_recent')).toMatch(/\(tenant_id, recipe_id, published_at DESC, recipe_version_id DESC\) WHERE \(status = ANY \(ARRAY\['published'::text, 'superseded'::text\]\)\)/);
    expect(await def('recipe_versions_one_draft')).toMatch(/UNIQUE INDEX .*\(tenant_id, recipe_id\) WHERE \(status = 'draft'::text\)/);
    expect(await def('recipe_versions_one_published')).toMatch(/UNIQUE INDEX .*\(tenant_id, recipe_id\) WHERE \(status = 'published'::text\)/);
    expect(await def('recipe_lines_stock_item')).toMatch(/\(tenant_id, stock_item_id\)$/);
  });

  it('[08b #33, A-5] config_audit: entities + recipe, recipe_version; action + publish; the old lists kept', async () => {
    const before = listed(preEntityDef);
    expect(before).toHaveLength(26);
    expect(listed(await constraintDef('config_audit_entity_check'))).toEqual([...before, 'recipe', 'recipe_version']);
    const beforeActions = listed(preActionDef);
    expect(beforeActions).toHaveLength(14);
    expect(listed(await constraintDef('config_audit_action_check'))).toEqual([...beforeActions, 'publish']);
    const ins = (entity: string, action: string) =>
      q(
        `INSERT INTO config_audit (tenant_id, audit_id, actor_kind, actor_owner_user_id, entity, entity_id, action, after, at)
         VALUES ($1, gen_random_uuid()::text, 'owner', 'u1', $2, 'x', $3, '{}'::jsonb, $4)`,
        [TN, entity, action, T],
      );
    await ins('recipe', 'create');
    await ins('recipe_version', 'publish');
    await expect(ins('recipe_line', 'create')).rejects.toMatchObject({ code: '23514', constraint: 'config_audit_entity_check' });
    await expect(ins('recipe', 'unpublish')).rejects.toMatchObject({ code: '23514', constraint: 'config_audit_action_check' });
  });
});

function versionSql(id: string, recipeId: string, v: VersionCols): [string, unknown[]] {
  return [
    `INSERT INTO recipe_versions (tenant_id, recipe_version_id, recipe_id, version_no, status, basis, base_qty, batch_yield_qty,
       batch_stock_unit, measure_unit, misc_allowance_bp, created_by, created_at, updated_at, published_by, published_at)
     VALUES ($1, $2, $3, 99, $4, $5, $6, $7, $8, $9, $10, 'u1', $11, $11, NULL, $12)`,
    [TN, id, recipeId, v.status ?? 'draft', v.basis ?? 'per_unit', v.base_qty ?? null, v.batch_yield_qty ?? null, v.batch_stock_unit ?? null, v.measure_unit ?? null, v.misc ?? 500, T, v.published_at ?? null],
  ];
}

function lineSql(versionId: string, l: LineCols): [string, unknown[]] {
  return [
    `INSERT INTO recipe_lines (tenant_id, recipe_version_id, line_no, stock_item_id, unit_name, entered_num, entered_den,
       stock_qty_num, stock_qty_den, stock_unit, qty_basis)
     VALUES ($1, $2, $3, $4, 'g', $5, $6, $7, $8, $9, $10)`,
    [TN, versionId, l.line_no ?? 1, l.stock_item_id ?? 's2', l.entered_num ?? '250', l.entered_den ?? '1', l.num ?? '250', l.den ?? '1', l.stock_unit ?? 'g', l.qty_basis ?? 'AP'],
  ];
}
