// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const CLIENT_FILE = 'apps/client/src/x.tsx';

async function errorsFor(eslint: ESLint, code: string, relPath = CLIENT_FILE): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: root + relPath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
}

describe('apps/client lint', () => {
  const eslint = new ESLint({ cwd: root });

  it('[01a §10 #79] refused imports and the style prop fail; ui-kit CSS, @pos/engine and @pos/domain pass', async () => {
    const refusedImports = [
      "import { sha256hex } from '@pos/domain/hash';\nexport const h = sha256hex;\n",
      "import { readFileSync } from 'node:fs';\nexport const r = readFileSync;\n",
      "import { x } from '../../hub/src/lib/hash';\nexport const y = x;\n",
      "import { x } from '../../../apps/hub/src/lib/hash';\nexport const y = x;\n",
      "import { x } from '../../cloud/src/lib/idempotency';\nexport const y = x;\n",
      "import { x } from '../../../apps/cloud/src/lib/idempotency';\nexport const y = x;\n",
      "import './app.css';\n",
      "import '../../../node_modules/some-kit/kit.css';\n",
    ];
    for (const code of refusedImports) {
      expect(await errorsFor(eslint, code), code).toEqual([
        expect.stringMatching(/^no-restricted-imports: .*S(35 d|35 f|27)/),
      ]);
    }

    expect(await errorsFor(eslint, 'export const A = () => <div style={{ color: "red" }} />;\n')).toEqual([
      expect.stringMatching(/^no-restricted-syntax: S35 d/),
    ]);

    const allowed =
      "import '../../../packages/ui-kit/tokens.css';\n" +
      "import '../../../packages/ui-kit/components/bundle.css';\n" +
      "import '../../../packages/ui-kit/components/pulse-staff.css';\n" +
      "import '../app/ui-kit-staff';\n" +
      "import { availableStock } from '@pos/engine';\n" +
      "import { ULID_RE } from '@pos/domain';\n" +
      'export const a = [availableStock, ULID_RE];\n' +
      'export const B = () => <div className="pos-card" />;\n';
    expect(await errorsFor(eslint, allowed)).toEqual([]);

    const results = await eslint.lintFiles(['apps/client']);
    expect(results.reduce((n, r) => n + r.errorCount, 0)).toBe(0);
  }, 60_000);

  it('[01a §10 #75 page part] dangerouslySetInnerHTML fails lint', async () => {
    const code = "export const A = () => <div dangerouslySetInnerHTML={{ __html: '<b>x</b>' }} />;\n";
    expect(await errorsFor(eslint, code)).toEqual([expect.stringMatching(/^no-restricted-syntax: S35 e/)]);
  }, 60_000);

  it('[01a S35 j] crypto.randomUUID() and import \'ulid\' fail', async () => {
    expect(await errorsFor(eslint, 'export const id = crypto.randomUUID();\n')).toEqual([
      expect.stringMatching(/^no-restricted-syntax: S35 j/),
    ]);
    expect(await errorsFor(eslint, "import { ulid } from 'ulid';\nexport const u = ulid;\n")).toEqual([
      expect.stringMatching(/^no-restricted-imports: .*S35 j/),
    ]);
  }, 60_000);

  it('[01a S47] getTimezoneOffset() fails in apps/client/src', async () => {
    expect(await errorsFor(eslint, 'export const o = new Date().getTimezoneOffset();\n')).toEqual([
      expect.stringMatching(/^no-restricted-syntax: S47/),
    ]);
  }, 60_000);

  it('[F §6.7] Date.now() passes in apps/client/src, fails in apps/hub/src', async () => {
    const code = 'export const now = Date.now();\n';
    expect(await errorsFor(eslint, code, 'apps/client/src/x.ts')).toEqual([]);
    expect(await errorsFor(eslint, code, 'apps/hub/src/x.ts')).toEqual([
      expect.stringMatching(/^no-restricted-syntax: Date\.now is forbidden/),
    ]);
  }, 60_000);
});
