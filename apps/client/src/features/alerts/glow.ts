import { announce } from './LiveRegion';

// 01d v1.3 §3.13.2 rule 2, §3.13.6: the place a deep link opens is scrolled to the centre of its scroller
// (smooth unless reduced motion), gets `pos-glow` for the length of its computed --motion-glow (the one source,
// n5; else 2 000 ms; the same timer with reduced motion, whose static ring lasts as long), and its name goes to
// the polite live region (n4). No focus move, no sound.

const GLOW = 'pos-glow';
const FALLBACK_MS = 2000;
/** A running glow: its timer, and the observer that keeps the class through a re-render. */
const running = new WeakMap<Element, { timer: ReturnType<typeof setTimeout>; keep: MutationObserver }>();

function stop(el: Element): void {
  const r = running.get(el);
  if (r === undefined) return;
  clearTimeout(r.timer);
  r.keep.disconnect();
  running.delete(el);
}

/** The glow length in ms: the element's computed --motion-glow, else 2 000. */
export function glowLength(el: Element): number {
  const ms = parseFloat(getComputedStyle(el).getPropertyValue('--motion-glow'));
  return Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_MS;
}

const reducedMotion = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface FocusPlaceOptions {
  /** a map tile is centred on both axes (§3.13.5 m7); default: the browser's ('nearest') */
  inline?: ScrollLogicalPosition;
}

/** Scrolls `el` into view, glows it, says `label` ("Opened <place>", already in the person's language). A repeat
 *  tap restarts the glow from the start; a re-render of the element keeps it (the class is managed here, in one
 *  place, so no screen has to keep it in its own className). */
export function focusPlace(el: HTMLElement, label: string, opts: FocusPlaceOptions = {}): void {
  el.scrollIntoView({ block: 'center', ...(opts.inline === undefined ? {} : { inline: opts.inline }), behavior: reducedMotion() ? 'auto' : 'smooth' });
  stop(el);
  el.classList.remove(GLOW);
  void el.offsetWidth; // restart the animation on a repeat tap
  el.classList.add(GLOW);
  // a re-render that sets className (React writes the whole attribute) would drop the class early: put it back in
  // the same microtask, before the next paint, until the glow's length is over
  const keep = new MutationObserver(() => {
    if (!el.classList.contains(GLOW)) el.classList.add(GLOW);
  });
  keep.observe(el, { attributes: true, attributeFilter: ['class'] });
  const timer = setTimeout(() => {
    keep.disconnect();
    running.delete(el);
    el.classList.remove(GLOW);
  }, glowLength(el));
  running.set(el, { timer, keep });
  announce(label);
}
