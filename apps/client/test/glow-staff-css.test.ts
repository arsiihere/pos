// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// 01d v1.3.1 §3.13.6, test 98: under reduced motion every deep-link target shows the static outline ring with the
// real staff CSS loaded, in the order apps/client/src/app/ui-kit-staff.ts imports it (read from that file).
//
// jsdom limits, and how this test handles them:
// - it evaluates only `all` / `screen` media, so `(prefers-reduced-motion: reduce)` is emulated by rewriting that
//   one media condition to `all` in every loaded file (what a browser with reduced motion on does: every such
//   rule applies);
// - it does not expand a shorthand that holds var(), nor resolve var() in computed values, so the cascaded
//   `outline` shorthand is read from the computed style and its var() chain is resolved here through the
//   element's own computed custom properties.

// jsdom gives import.meta.url an http scheme: the repo root is found from this file's folder
const root = resolvePath(__dirname, '../../..') + '/';
const entry = root + 'apps/client/src/app/ui-kit-staff.ts';
const imports = [...readFileSync(entry, 'utf8').matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1] as string);
const files = imports.map((i) => root + i.replace(/^(\.\.\/)+/, ''));

const REDUCE = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)/g;

/** Resolves var(--x[, fallback]) through `el`'s computed custom properties. */
function resolve(value: string, el: Element, depth = 0): string {
  if (depth > 10) throw new Error(`var() loop in ${value}`);
  const out = value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, name: string, fallback?: string) => {
    const v = getComputedStyle(el).getPropertyValue(name).trim();
    return v !== '' ? v : (fallback ?? '').trim();
  });
  return out.includes('var(') ? resolve(out, el, depth + 1) : out;
}

function load(reduced: boolean) {
  document.head.innerHTML = '';
  for (const f of files) {
    const style = document.createElement('style');
    const css = readFileSync(f, 'utf8');
    style.textContent = reduced ? css.replace(REDUCE, '@media all') : css;
    document.head.appendChild(style);
  }
}

/** Each deep-link target type (§3.13.5) as the staff app renders it. */
const TARGETS: Array<[string, string]> = [
  ['.rnd (round)', '<div class="rnd" data-order="O1"></div>'],
  ['.ol (line)', '<div class="ol" data-line="L1"></div>'],
  ['.ol.sel (selected line)', '<div class="ol sel" data-line="L2"></div>'],
  ['.pc (Pass card)', '<article class="pc" data-order="O2"></article>'],
  ['.pc.ready (Pass card, ready)', '<article class="pc ready" data-order="O3"></article>'],
  ['.lc (LateCard)', '<div class="lc" data-alerts="A1,A2"></div>'],
  ['.zs (zone stock row)', '<div class="zs low" data-zone-item="Z1:I1"></div>'],
  ['map tile', '<button type="button" class="tt s-seated c-seated" data-table="T1"></button>'],
  ['Inbox card (.ac)', '<article class="ac c-urgent is-new" data-alert="A3"></article>'],
  ['Inbox row (.ar)', '<button type="button" class="ar c-info" data-alert="A4"></button>'],
];

function render(): HTMLElement[] {
  document.body.innerHTML = `<div class="pu v-brand staff" data-theme="light"><main class="body">${TARGETS.map(([, html]) => html).join('')}</main></div>`;
  return [...document.querySelectorAll<HTMLElement>('main.body > *')];
}

const ring = (el: Element) => {
  const cs = getComputedStyle(el);
  return { outline: resolve(cs.getPropertyValue('outline'), el), offset: cs.outlineOffset, animation: cs.animationName };
};

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});
afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('[01d #98] reduced-motion ring under the full staff CSS', () => {
  it('[01d #98] the staff entry loads no bundle.css, and the .pos-glow rules are in its last layer, staff-02-additions.css', () => {
    expect(imports.length).toBeGreaterThan(5);
    expect(imports.some((i) => i.endsWith('bundle.css'))).toBe(false);
    expect(imports.at(-1)).toMatch(/components\/staff-02-additions\.css$/);
    const holders = files.filter((f) => /\.pos-glow\b/.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(holders.map((f) => f.slice(root.length))).toEqual(['packages/ui-kit/components/staff-02-additions.css']);
  });

  it('[01d #98] every target type with pos-glow: outline 2px solid <computed --brand-primary>, offset 2px, no animation; without the class, its own outline again', () => {
    load(true);
    const els = render();
    const own = els.map((el) => ring(el));
    for (const [i, el] of els.entries()) {
      const name = TARGETS[i]![0];
      const brand = getComputedStyle(el).getPropertyValue('--brand-primary').trim();
      expect(brand, name).toBe('#F4A321');
      expect(own[i]!.outline, name).not.toContain(brand);
      el.classList.add('pos-glow');
      const r = ring(el);
      expect(r.outline, name).toBe(`2px solid ${brand}`);
      expect(r.offset, name).toBe('2px');
      expect(r.animation, name).toBe('none');
      // the client takes the class off after --motion-glow (glow.ts): the element's own outline comes back
      el.classList.remove('pos-glow');
      expect(ring(el), name).toEqual(own[i]);
    }
  });

  it('[01d §3.13.6] without reduced motion the class runs the pos-glow animation and adds no outline', () => {
    load(false);
    const els = render();
    for (const [i, el] of els.entries()) {
      const name = TARGETS[i]![0];
      const before = ring(el).outline;
      el.classList.add('pos-glow');
      const cs = getComputedStyle(el);
      expect(cs.getPropertyValue('animation'), name).toBe('pos-glow var(--motion-glow) ease-out 1');
      expect(resolve(cs.getPropertyValue('animation'), el), name).toBe('pos-glow 2000ms ease-out 1');
      expect(ring(el).outline, name).toBe(before);
    }
  });
});
