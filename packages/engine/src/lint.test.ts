// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const nodeImport = "import { createHash } from 'node:crypto';\nexport const h = createHash;\n";
const domainImport = "import { ULID_RE } from '@pos/domain';\nexport const r = ULID_RE;\n";

async function errorsFor(eslint: ESLint, code: string, relPath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: root + relPath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

describe('browser-safe lint', () => {
  it('[01a §10 #127] node:* is refused in packages/engine and the @pos/domain root; pnpm lint passes on the real tree', async () => {
    const eslint = new ESLint({ cwd: root });
    expect(await errorsFor(eslint, nodeImport, 'packages/engine/src/x.ts')).toEqual([
      expect.stringContaining('S35 k'),
    ]);
    expect(await errorsFor(eslint, nodeImport, 'packages/domain/src/x.ts')).toEqual([
      expect.stringContaining('S35 k'),
    ]);
    expect(await errorsFor(eslint, nodeImport, 'packages/domain/src/hash.ts')).toEqual([]);
    expect(await errorsFor(eslint, nodeImport, 'packages/domain/src/x.test.ts')).toEqual([]);
    expect(await errorsFor(eslint, domainImport, 'packages/engine/src/x.ts')).toEqual([]);

    const results = await eslint.lintFiles(['packages/engine', 'packages/domain']);
    expect(results.reduce((n, r) => n + r.errorCount, 0)).toBe(0);
  }, 60_000);
});
