/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 08a §10.5 test 34 (source half; the route half is audit.int.test.ts): I4, I6, I8 — unit, price and yield rows are
// append-only, so no statement anywhere in apps/cloud/src (modules, lib, cli, migrations) updates, deletes,
// truncates or upserts into them. Source grep in the manner of 05 #74 (fiscal/outbox.test.ts).
const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const TABLES = ['stock_item_units', 'item_prices', 'yield_profiles'] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|sql)$/.test(entry.name) ? [path] : [];
  });
}

// Every place a statement could change an existing row of `table`. Comments are scanned too (stricter: a quoted
// statement in a comment is as suspect as one in code).
function mutationsOf(text: string, table: string): string[] {
  const name = `(?:"?public"?\\.)?(?:"${table}"|${table}\\b)`; // optional schema qualifier
  const direct = new RegExp(
    String.raw`\b(?:UPDATE\s+(?:ONLY\s+)?|DELETE\s+FROM\s+(?:ONLY\s+)?|TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?(?:[a-z0-9_."]+\s*,\s*)*|MERGE\s+INTO\s+)${name}`,
    'gi',
  );
  const found = [...text.matchAll(direct)].map((m) => m[0]);
  // INSERT … ON CONFLICT … DO UPDATE on the table (an upsert rewrites a row); the statement ends at its string's end.
  for (const m of text.matchAll(new RegExp(String.raw`\bINSERT\s+INTO\s+${name}[^\`;]*`, 'gi'))) {
    if (/\bDO\s+UPDATE\b/i.test(m[0])) found.push(m[0].slice(0, 60));
  }
  return found;
}

describe('08a append-only tables (source grep)', () => {
  const files = sourceFiles(SRC);

  it('[08a #34] the scan sees the inventory module and the migration that create the three tables', () => {
    const rel = files.map((file) => relative(SRC, file));
    expect(rel).toEqual(expect.arrayContaining([join('modules', 'inventory', 'repository.ts'), join('db', 'migrations', '0018_inventory_config.sql')]));
    const all = files.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const table of TABLES) expect(all, table).toMatch(new RegExp(String.raw`\bINSERT\s+INTO\s+${table}\b`, 'i'));
  });

  it('[08a #34] no UPDATE / DELETE / TRUNCATE / MERGE / upsert statement in apps/cloud/src targets stock_item_units, item_prices or yield_profiles', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const table of TABLES) {
        for (const hit of mutationsOf(text, table)) offenders.push(`${relative(SRC, file)}: ${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('[08a #34] the grep itself catches each form (guards the regexes)', () => {
    expect(mutationsOf('`UPDATE item_prices SET price_minor = 1`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`update  "yield_profiles" set yield_bp = 1`', 'yield_profiles')).toHaveLength(1);
    expect(mutationsOf('`DELETE FROM stock_item_units WHERE true`', 'stock_item_units')).toHaveLength(1);
    expect(mutationsOf('`TRUNCATE branches, item_prices`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`INSERT INTO item_prices (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = 2`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`INSERT INTO item_prices (a) VALUES (1) ON CONFLICT DO NOTHING`', 'item_prices')).toEqual([]);
    expect(mutationsOf('`UPDATE item_prices_archive SET a = 1`', 'item_prices')).toEqual([]);
    expect(mutationsOf('`SELECT * FROM item_prices`', 'item_prices')).toEqual([]);
    // the forms the repo uses, plus schema-qualified and quoted lists
    expect(mutationsOf('`UPDATE item_prices p\n   SET price_minor = 1`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`DELETE\n  FROM item_prices AS x WHERE true`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`UPDATE public.item_prices SET a = 1`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`UPDATE "public"."item_prices" SET a = 1`', 'item_prices')).toHaveLength(1);
    expect(mutationsOf('`TRUNCATE "branches", item_prices`', 'item_prices')).toHaveLength(1);
  });
});
