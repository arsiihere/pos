import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../../..');

// 01b §10.9a #55: the only files that may name a default role by its display name (R5).
const ALLOWED = [
  'apps/cloud/src/modules/staff-roles/default-roles.ts',
  'apps/cloud/src/db/migrations/0003_manage_stock_backfill.sql',
  'apps/cloud/src/db/migrations/0005_staff_roles.sql',
];

const NAMES = ['Owner', 'Manager', 'Cashier', 'Order taker', 'Waiter', 'Cook'];
const LITERAL = new RegExp(`(['"])(${NAMES.join('|')})\\1`);

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && extensions.some((ext) => e.name.endsWith(ext)))
    .filter((e) => !e.name.endsWith('.test.ts') && !e.name.endsWith('.test.tsx'))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)));
}

function inScope(): string[] {
  const workspaces = (group: string) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(ROOT, group, e.name, 'src'));
  return [
    ...workspaces('apps').flatMap((src) => filesUnder(src, ['.ts', '.tsx', '.sql'])),
    ...workspaces('packages').flatMap((src) => filesUnder(src, ['.ts', '.tsx'])),
  ].sort();
}

describe('[01b §3.8, R5] default role names', () => {
  it('[01b #55] no src file outside the allowed three quotes a default role name', () => {
    const files = inScope();
    expect(files).toContain('apps/hub/src/server.ts');
    expect(files).toContain('apps/client/src/i18n/en.ts');

    const hits = files
      .filter((file) => !ALLOWED.includes(file))
      .flatMap((file) =>
        readFileSync(join(ROOT, file), 'utf8')
          .split('\n')
          .flatMap((line, i) => (LITERAL.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
      );
    expect(hits).toEqual([]);
  });

  it('[01b #55] the grep finds a quoted name in each allowed file and in a planted line', () => {
    expect(LITERAL.test(`role: "Order taker"`)).toBe(true);
    expect(LITERAL.test(`name = 'Cook'`)).toBe(true);
    expect(LITERAL.test(`'Cooking'`)).toBe(false);
    expect(LITERAL.test(`'cook'`)).toBe(false);
    for (const file of ALLOWED) expect(LITERAL.test(readFileSync(join(ROOT, file), 'utf8')), file).toBe(true);
  });
});
