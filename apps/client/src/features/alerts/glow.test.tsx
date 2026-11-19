import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { focusPlace, glowLength } from './glow';
import { LiveRegion } from './LiveRegion';
import tokensJson from '../../../../../packages/ui-kit/tokens.json?raw';

// 01d v1.3 §3.13.2 rule 2, §3.13.6 (n4, n5): scroll the place into view, give it the 2 s brand glow, say
// "Opened <place>" in one polite live region. The length is read from --motion-glow, never measured (03a AD-32).


let reduced = false;
const scrolls: Array<{ el: Element; opts: ScrollIntoViewOptions | boolean | undefined }> = [];
let m: Mounted | null = null;

beforeEach(() => {
  reduced = false;
  scrolls.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduced, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  Element.prototype.scrollIntoView = function (this: Element, opts?: ScrollIntoViewOptions | boolean) {
    scrolls.push({ el: this, opts });
  };
});
afterEach(() => {
  m?.unmount();
  m = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function place(motion?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ol';
  el.dataset.line = 'L1';
  if (motion !== undefined) el.style.setProperty('--motion-glow', motion);
  document.body.appendChild(el);
  return el;
}

const region = () => document.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');

describe('[01d §3.13.6] glow helper and live region', () => {
  it('[01d #77] reduced motion: no smooth scroll, the class (static ring in CSS) goes after --motion-glow; the tokens exist for both themes', () => {
    // the tokens (cp1's tokens.json; client src cannot read files and vitest serves CSS as '', so the CSS half —
    // the reduced-motion rule and the tokens.css block — is pinned by apps/client/test/glow.test.ts, node env)
    const json = JSON.parse(tokensJson) as { color: { tokens: { name: string; value: { light: string; dark: string } }[] }; motion: { tokens: { name: string; value: string }[] } };
    for (const t of ['glow-brand', 'glow-brand-ring', 'glow-edge']) {
      const v = json.color.tokens.find((x) => x.name === t)?.value;
      expect(v?.light, t).toBeTruthy();
      expect(v?.dark, t).toBeTruthy();
    }
    expect(json.motion.tokens.find((x) => x.name === 'motion-glow')?.value).toBe('2000ms');
    // the helper with reduced motion: no smooth scroll, the same timer
    reduced = true;
    const el = place('1500ms');
    focusPlace(el, 'Opened F4');
    expect(scrolls).toEqual([{ el, opts: { block: 'center', behavior: 'auto' } }]);
    expect(el.classList.contains('pos-glow')).toBe(true);
    vi.advanceTimersByTime(1499);
    expect(el.classList.contains('pos-glow')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('pos-glow')).toBe(false);
  });

  it('[01d §3.13.6] the length is the element\'s computed --motion-glow (1500ms → 1 500 ms), else 2 000 ms', () => {
    expect(glowLength(place('1500ms'))).toBe(1500);
    expect(glowLength(place(' 2000ms'))).toBe(2000);
    expect(glowLength(place())).toBe(2000);
    expect(glowLength(place('nonsense'))).toBe(2000);
    expect(glowLength(place('0ms'))).toBe(2000);
  });

  it('[01d §3.13.2] smooth scroll to the centre without reduced motion; the class added and removed; no focus move', () => {
    const el = place();
    const before = document.activeElement;
    focusPlace(el, 'Opened Round 2');
    expect(scrolls).toEqual([{ el, opts: { block: 'center', behavior: 'smooth' } }]);
    expect(el.classList.contains('pos-glow')).toBe(true);
    expect(document.activeElement).toBe(before);
    vi.advanceTimersByTime(1999);
    expect(el.classList.contains('pos-glow')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.className).toBe('ol');
  });

  it('[01d §3.13.5] a map tile can be centred on both axes (m7)', () => {
    const el = place();
    focusPlace(el, 'Opened F4', { inline: 'center' });
    expect(scrolls).toEqual([{ el, opts: { block: 'center', inline: 'center', behavior: 'smooth' } }]);
  });

  it('[01d §3.13.2] a repeat tap restarts the glow: the class is taken off and put back, the length counts from the new tap', () => {
    const el = place('1000ms');
    focusPlace(el, 'Opened F4');
    vi.advanceTimersByTime(800);
    const obs = new MutationObserver(() => {});
    obs.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    focusPlace(el, 'Opened F4');
    // off, then on again: the CSS animation starts over
    expect(obs.takeRecords().map((r) => r.oldValue)).toEqual(['ol pos-glow', 'ol']);
    obs.disconnect();
    expect(el.classList.contains('pos-glow')).toBe(true);
    // the first tap's timer does not cut the second glow short
    vi.advanceTimersByTime(999);
    expect(el.classList.contains('pos-glow')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(el.classList.contains('pos-glow')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('[01d §3.13.6] a re-render that rewrites className keeps the glow for its length, then the new classes stay', async () => {
    m = mount();
    const Line = ({ sel }: { sel: boolean }) => <div className={sel ? 'ol sel' : 'ol'} data-line="L9" />;
    m.render(<Line sel={false} />);
    const el = m.container.querySelector<HTMLElement>('[data-line="L9"]')!;
    focusPlace(el, 'Opened line');
    m.render(<Line sel={true} />);
    await flush();
    expect(el.className.split(' ').sort()).toEqual(['ol', 'pos-glow', 'sel']);
    vi.advanceTimersByTime(2000);
    await flush();
    expect(el.className).toBe('ol sel');
    // after the glow, a re-render is left alone
    m.render(<Line sel={false} />);
    await flush();
    expect(el.className).toBe('ol');
  });

  it('[01d §3.13.6] the element unmounted mid-glow: no throw, no timer left', () => {
    m = mount();
    m.render(<div className="rnd" data-order="O1" />);
    const el = m.container.querySelector<HTMLElement>('[data-order="O1"]')!;
    focusPlace(el, 'Opened Round 1');
    vi.advanceTimersByTime(500);
    m.unmount();
    m = null;
    expect(() => vi.advanceTimersByTime(1500)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('[01d §3.13.6 n4] "Opened <place>" goes to the one visually hidden polite live region, not the toast; the same text again is said again', async () => {
    m = mount();
    m.render(<LiveRegion />);
    const r = region()!;
    expect(r).not.toBeNull();
    expect(document.querySelectorAll('[aria-live="polite"]').length).toBe(1);
    expect(r.className).toBe('sr');
    expect(r.getAttribute('aria-atomic')).toBe('true');
    expect(r.textContent).toBe('');
    const el = place();
    focusPlace(el, 'Opened F4');
    await flush();
    expect(region()!.textContent).toBe('Opened F4');
    const node = region()!.firstElementChild;
    focusPlace(el, 'Opened F4');
    await flush();
    expect(region()!.textContent).toBe('Opened F4');
    // a new node, so a screen reader reads the repeat
    expect(region()!.firstElementChild).not.toBe(node);
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('[01d §3.13.6] with no live region mounted the glow still runs', () => {
    const el = place();
    expect(() => focusPlace(el, 'Opened F4')).not.toThrow();
    expect(el.classList.contains('pos-glow')).toBe(true);
  });
});
