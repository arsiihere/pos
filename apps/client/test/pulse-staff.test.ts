// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const kit = fileURLToPath(new URL('../../../packages/ui-kit/', import.meta.url));
const css = readFileSync(kit + 'components/pulse-staff.css', 'utf8');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('Pulse staff layer (01d)', () => {
  it('loads nothing from the network', () => {
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@import\s+url\(/i);
    expect(rules).not.toMatch(/@import/);
  });

  it('every url() resolves to a file in packages/ui-kit/fonts/', () => {
    const urls = [...rules.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1] as string);
    for (const u of urls) expect(existsSync(kit + 'components/' + u) && /fonts\//.test(u), u).toBe(true);
  });

  it('declares no font faces of its own (tokens.css does)', () => {
    expect(rules).not.toMatch(/@font-face/);
  });

  it('every top-level selector stays under .pu', () => {
    const selectors = [...rules.matchAll(/(?:^|})\s*([^{}@]+)\{/g)].map((m) => (m[1] as string).trim());
    expect(selectors.length).toBeGreaterThan(100);
    for (const group of selectors)
      for (const s of group.split(/,(?![^(]*\))/).map((x) => x.trim()))
        expect(s, s).toMatch(/\.pu\b/);
  });

  it('brand colours come from the kit brand tokens', () => {
    for (const hex of ['F4A321', '6E140E', '8E1F16', '3A0E07', 'FFF3E6']) expect(rules.toUpperCase()).not.toContain('#' + hex);
    expect(rules).toContain('var(--brand-primary)');
    expect(rules).toContain('var(--brand-secondary)');
  });
});
