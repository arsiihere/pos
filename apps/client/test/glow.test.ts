// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const kit = fileURLToPath(new URL('../../../packages/ui-kit/', import.meta.url));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const tokensCss = strip(readFileSync(kit + 'tokens.css', 'utf8'));
const additions = strip(readFileSync(kit + 'components/staff-02-additions.css', 'utf8'));
const bundle = strip(readFileSync(kit + 'components/bundle.css', 'utf8'));
const tokensJson = JSON.parse(readFileSync(kit + 'tokens.json', 'utf8')) as {
  color: { tokens: { name: string; value: { light: string; dark: string } }[] };
  motion?: { tokens: { name: string; value: string }[] };
};

const GLOW = ['--glow-brand', '--glow-brand-ring', '--glow-edge', '--motion-glow'] as const;

/** The body of the block whose selector list is exactly `selector`. */
function block(css: string, selector: string): string | undefined {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = (m[1] as string).trim().split(',').map((s) => s.trim()).join(', ');
    if (sel === selector) return m[2] as string;
  }
  return undefined;
}

describe('[01d §3.13.6] glow tokens and keyframe', () => {
  it('[01d §3.13.6] the four tokens sit in the DERIVED layer for :root, light and dark (tokens.css)', () => {
    const body = block(tokensCss, ':root, [data-theme="light"], [data-theme="dark"]');
    expect(body, 'a DERIVED block for :root, light and dark').toBeDefined();
    const decl = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body!)?.[1]?.trim();
    expect(decl('--glow-brand')).toBe('color-mix(in oklab, var(--brand-primary) 45%, transparent)');
    expect(decl('--glow-brand-ring')).toBe('var(--brand-primary)');
    expect(decl('--glow-edge')).toBe('var(--ink)');
    expect(decl('--motion-glow')).toBe('2000ms');
    // in the DERIVED layer: after its header, before the SEMANTIC layer
    const raw = readFileSync(kit + 'tokens.css', 'utf8');
    const at = raw.indexOf('--glow-brand:');
    expect(at).toBeGreaterThan(raw.indexOf('---------- 2. DERIVED (from brand)'));
    expect(at).toBeLessThan(raw.indexOf('---------- 3. SEMANTIC'));
  });

  it('[01d §3.13.6] tokens.json lists the glow colours for both themes and the glow length', () => {
    const byName = new Map(tokensJson.color.tokens.map((t) => [t.name, t.value]));
    for (const name of ['glow-brand', 'glow-brand-ring', 'glow-edge']) {
      const v = byName.get(name);
      expect(v, name).toBeDefined();
      expect(v!.light, name).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
      expect(v!.dark, name).toMatch(/^#[0-9A-F]{6}([0-9A-F]{2})?$/);
    }
    // --glow-edge is --ink in each theme (m9)
    expect(byName.get('glow-edge')).toEqual(byName.get('ink'));
    // the halo and the ring are the brand, never a status colour
    const status = ['ok', 'ok-fill', 'warn', 'warn-fill', 'danger', 'danger-fill', 'info', 'info-fill'].map((n) => byName.get(n)!.light.slice(0, 7));
    for (const name of ['glow-brand', 'glow-brand-ring']) expect(status).not.toContain(byName.get(name)!.light.slice(0, 7));
    expect(tokensJson.motion?.tokens.find((t) => t.name === 'motion-glow')?.value).toBe('2000ms');
  });

  it('[01d §3.13.6] @keyframes pos-glow and .pos-glow are in staff-02-additions.css, not bundle.css (v1.3.1)', () => {
    const kf = /@keyframes pos-glow\s*\{([\s\S]*?)\}\s*\}/.exec(additions);
    expect(kf, '@keyframes pos-glow').not.toBeNull();
    expect(kf![1]).toContain('var(--glow-edge)');
    expect(kf![1]).toContain('var(--glow-brand)');
    expect(kf![1]).toMatch(/100%\s*\{\s*box-shadow:\s*0 0 0 0 transparent;\s*$/);
    expect(additions).toMatch(/\.pos-glow\s*\{\s*animation:\s*pos-glow var\(--motion-glow\) ease-out 1;\s*\}/);
    // the staff entry never loads bundle.css (01d v1.3.1): nothing of the glow there
    expect(bundle).not.toMatch(/pos-glow|--glow-/);
  });

  it('[01d §3.13.6] reduced motion: no animation, a static outline ring in --glow-brand-ring (v1.3.1)', () => {
    const m = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.pos-glow\s*\{([^}]*)\}\s*\}/.exec(additions);
    expect(m, 'reduced-motion .pos-glow rule').not.toBeNull();
    expect(m![1].trim()).toBe('animation: none; outline: 2px solid var(--glow-brand-ring); outline-offset: 2px;');
  });

  it('[01d §3.13.6] no status colour in the glow', () => {
    const glowCss = [...additions.matchAll(/[^{}]*pos-glow[^{]*\{[\s\S]*?\}\s*\}?/g)].map((m) => m[0]).join('\n');
    expect(glowCss).not.toMatch(/--(ok|warn|danger|info)/);
    for (const t of GLOW) expect(tokensCss).toContain(t + ':');
  });
});
