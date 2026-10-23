import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = fileURLToPath(new URL('../src', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

function importers(spec: RegExp): string[] {
  const clause = /import\s+(?:type\s+)?[\s\S]*?\sfrom\s+['"][^'"]+['"]/g;
  const hits: string[] = [];
  for (const file of tsFiles(srcRoot)) {
    const text = readFileSync(file, 'utf8');
    const imported = [...text.matchAll(clause)].some((match) => spec.test(match[0]));
    if (imported) hits.push(relative(repoRoot, file).split('\\').join('/'));
  }
  return hits.sort();
}

describe('cloud import pins', () => {
  it('[00 §10 #113] credential-lookup imported only by the two plugins; SystemContext only from cli/', () => {
    expect(importers(/credential-lookup/)).toEqual([
      'apps/cloud/src/plugins/owner-credentials.ts',
      'apps/cloud/src/plugins/tenant-scope.ts',
    ]);
    const system = importers(/system-context|SystemContext/);
    expect(system).toContain('apps/cloud/src/cli/seed-tenant.ts');
    expect(system.every((file) => file.startsWith('apps/cloud/src/cli/'))).toBe(true);
  });
});
