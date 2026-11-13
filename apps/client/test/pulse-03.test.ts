// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const kitDir = root + 'packages/ui-kit/components/';
const handoff = root + 'docs/design/handoff/03b/design/';
const app = root + 'apps/client/src/app/';

function importsOf(file: string): string[] {
  const text = readFileSync(app + file, 'utf8');
  return [...text.matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1] as string);
}
const k = (name: string) => '../../../../packages/ui-kit/' + name;

describe('Pulse 03 and admin 03 layers (03b + 03c, handoff 03b PROMPT)', () => {
  it('[03b W0.2] pulse-03.css and admin-03.css equal the handoff files, load nothing from the network, declare no font faces', () => {
    for (const name of ['pulse-03.css', 'admin-03.css']) {
      expect(existsSync(kitDir + name), name).toBe(true);
      const css = readFileSync(kitDir + name);
      expect(css.equals(readFileSync(handoff + name)), name).toBe(true);
      const text = css.toString('utf8');
      const rules = text.replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text, name).not.toMatch(/https?:\/\//);
      expect(rules, name).not.toMatch(/@import/);
      expect(rules, name).not.toMatch(/url\(/);
      expect(rules, name).not.toMatch(/@font-face/);
    }
  });

  it('[03b W0.2] the staff and kds kits import pulse-03.css; the admin kit imports admin-03.css', () => {
    // staff kit: pulse-03 right after pulse-02 (PROMPT order pulse … pulse-02, pulse-03)
    const staff = importsOf('ui-kit-staff.ts');
    const p02 = staff.indexOf(k('components/pulse-02.css'));
    expect(p02).toBeGreaterThanOrEqual(0);
    expect(staff.indexOf(k('components/pulse-03.css'))).toBe(p02 + 1);

    // kds kit: tokens, bundle, the Pulse staff layer (holds the dark .pu.v-brand.kds block), then pulse-03
    expect(importsOf('ui-kit-kds.ts')).toEqual([
      k('tokens.css'),
      k('components/bundle.css'),
      k('components/pulse-staff.css'),
      k('components/pulse-03.css'),
    ]);
    expect(readFileSync(kitDir + 'pulse-staff.css', 'utf8')).toContain('.pu.v-brand.kds {');

    // admin kit (the two 03b / 03c admin entries): the owner stack, then admin-03
    expect(importsOf('ui-kit-admin.ts')).toEqual([k('tokens.css'), k('components/bundle.css'), k('components/admin-03.css')]);
    // admin-03 is unscoped: it never reaches the kit every entry loads, nor the staff / kds kits
    for (const f of ['ui-kit.ts', 'ui-kit-staff.ts', 'ui-kit-kds.ts']) expect(importsOf(f), f).not.toContain(k('components/admin-03.css'));
  });
});
