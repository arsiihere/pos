// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 03c v1.0.9 §8, IR-25: the printer card's ⋯ menu (`.pos-menu`) is `position: absolute` against the nearest positioned
// ancestor; with none it anchored to the scrolling page and opened above the viewport (y = -56 at 1280 x 800, found by
// the Z1 e2e), so a manager could not tap Archive. The card (`.pr`) is that ancestor, as `.pos-list__row` is for 02's lists.
describe('[03c §8, IR-25] printer card menu anchor', () => {
  it('.pr is a positioned box (position: relative) in admin-03-additions.css, loaded by the admin kit', () => {
    const css = readFileSync(fileURLToPath(new URL('../../../packages/ui-kit/components/admin-03-additions.css', import.meta.url)), 'utf8');
    const rule = /^\.pr\s*\{([^}]*)\}/m.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/position:\s*relative/);
    const kit = readFileSync(fileURLToPath(new URL('../src/app/ui-kit-admin.ts', import.meta.url)), 'utf8');
    expect(kit).toContain('admin-03-additions.css');
  });
});
