// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const kitDir = root + 'packages/ui-kit/components/';
const handoff = root + 'docs/design/handoff/04/design/css/';
const app = root + 'apps/client/src/app/';

function importsOf(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1] as string);
}
const k = (name: string) => '../../../../packages/ui-kit/' + name;

describe('Pulse 04 layers (04 §8; handoff 04 PROMPT step 1, O7)', () => {
  it('[04 VU1] pulse-04.css and pulse-04-admin.css equal the handoff files, load nothing from the network, declare no font faces', () => {
    for (const name of ['pulse-04.css', 'pulse-04-admin.css']) {
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

  it('[04 VU1] pulse-04-additions.css only holds the frames\' inline layout: no network, no fonts, no new colours', () => {
    const css = readFileSync(kitDir + 'pulse-04-additions.css', 'utf8');
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/https?:\/\/|@import|url\(|@font-face|#[0-9a-f]{3,8}\b|rgb\(/i);
    for (const sel of ['.qline .qv', '.dlg--v.dlg--kiosk']) expect(rules, sel).toContain(sel);
  });

  it('[04 VU1] the staff kit loads pulse-04.css after pulse-02.css; only the Stock page loads pulse-04-admin.css', () => {
    const staff = importsOf(app + 'ui-kit-staff.ts');
    const p02 = staff.indexOf(k('components/pulse-02.css'));
    expect(p02).toBeGreaterThanOrEqual(0);
    expect(staff.indexOf(k('components/pulse-04.css'))).toBeGreaterThan(p02);
    expect(staff.indexOf(k('components/pulse-04-additions.css'))).toBe(staff.indexOf(k('components/pulse-04.css')) + 1);
    for (const f of ['ui-kit.ts', 'ui-kit-kds.ts', 'ui-kit-admin.ts']) expect(importsOf(app + f), f).not.toContain(k('components/pulse-04.css'));
    // the 01a hub admin Stock page (owner kit) gets the banner list; no other entry
    const stock = importsOf(root + 'apps/client/src/features/admin/stock/main.tsx');
    expect(stock).toContain('../../../../../../packages/ui-kit/components/pulse-04-admin.css');
    for (const f of ['ui-kit.ts', 'ui-kit-staff.ts', 'ui-kit-kds.ts', 'ui-kit-admin.ts']) expect(importsOf(app + f), f).not.toContain(k('components/pulse-04-admin.css'));
  });
});
