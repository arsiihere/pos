// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const kitFile = root + 'packages/ui-kit/components/pulse-02.css';
const handoff02a = root + 'docs/design/handoff/02a/design/pulse-02.css';
const handoff02b = root + 'docs/design/handoff/02b/design/pulse-02.css';

describe('Pulse 02 layer (02a + 02b, handoff PROMPT step 2)', () => {
  it('[02 W0.2] pulse-02.css equals the handoff file, loads nothing from the network, declares no font faces', () => {
    expect(existsSync(kitFile)).toBe(true);
    const css = readFileSync(kitFile);
    // byte copy of the 02a handoff file; the 02b handoff file is identical
    expect(css.equals(readFileSync(handoff02a))).toBe(true);
    expect(css.equals(readFileSync(handoff02b))).toBe(true);
    const text = css.toString('utf8');
    const rules = text.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(text).not.toMatch(/https?:\/\//);
    expect(rules).not.toMatch(/@import/);
    expect(rules).not.toMatch(/url\(/);
    expect(rules).not.toMatch(/@font-face/);
  });

  it('[02 W0.2] the staff entry imports pulse-02.css after pulse-staff.css', () => {
    const entry = readFileSync(root + 'apps/client/src/app/ui-kit-staff.ts', 'utf8');
    const imports = [...entry.matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1] as string);
    const staff = imports.indexOf('../../../../packages/ui-kit/components/pulse-staff.css');
    const p02 = imports.indexOf('../../../../packages/ui-kit/components/pulse-02.css');
    expect(staff).toBeGreaterThanOrEqual(0);
    expect(p02).toBe(staff + 1);
  });
});
