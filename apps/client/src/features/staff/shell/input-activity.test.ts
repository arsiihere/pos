import { describe, expect, it } from 'vitest';
import { createInputActivity, INPUT_ACTIVITY_MS } from './input-activity';

// ⚠️ 00 v1.14 M101 (owner 2026-11-28 Q8; QA BUG-12): the signed-in person's input (pointerdown / keydown on the page)
// sends the activity signal at most once per 60 s; the first input after a quiet minute sends at once; nothing else
// (no timer, no frame, no focus) ever sends it; detached, input sends nothing.

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
    fire: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

describe('[00 v1.14 M101] input activity signal', () => {
  it('first input sends; more input within 60 s sends nothing; the first input after 60 s sends again', () => {
    let now = 1_000_000;
    const sent: number[] = [];
    const target = fakeTarget();
    const a = createInputActivity({ send: () => sent.push(now), now: () => now, target });
    const stop = a.attach();
    expect(sent).toEqual([]); // attaching is not input
    target.fire('pointerdown');
    expect(sent).toEqual([1_000_000]);
    now += 30_000;
    target.fire('keydown');
    target.fire('pointerdown');
    expect(sent).toHaveLength(1);
    now += INPUT_ACTIVITY_MS;
    target.fire('keydown');
    expect(sent).toEqual([1_000_000, 1_090_000]);
    stop();
    expect(target.count()).toBe(0);
    now += INPUT_ACTIVITY_MS;
    target.fire('pointerdown');
    expect(sent).toHaveLength(2);
  });

  it('only pointerdown and keydown count (no focus, visibility, scroll or mouse move)', () => {
    const sent: string[] = [];
    const target = fakeTarget();
    createInputActivity({ send: () => sent.push('x'), now: () => 0, target }).attach();
    for (const t of ['focus', 'visibilitychange', 'scroll', 'mousemove', 'pointermove']) target.fire(t);
    expect(sent).toEqual([]);
    expect(INPUT_ACTIVITY_MS).toBe(60_000);
  });
});
