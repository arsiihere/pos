import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../test/dom';
import { PinKeys } from './PinStep';

// ⚠️ 01d v1.3.9 §8.1 (owner 2026-11-28 QA-R2, BUG-13), test 126: the answer sheet's PIN pad ignores pointer taps for
// 400 ms after it opens (a double-tap on Approve typed a "9"); keyboard digits always count.

let m: Mounted;
afterEach(() => {
  m.unmount();
  vi.useRealTimers();
});

const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
const key = (label: string) => [...m.container.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('[01d #126] PIN pad ghost taps (BUG-13)', () => {
  it('a pointer tap within 400 ms of opening adds no digit; after it does; a keyboard digit counts at once', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date'] });
    const digits: string[] = [];
    m = mount();
    m.render(<PinKeys length={0} disabled={false} actionLabel="Approve" onDigit={(d) => digits.push(d)} onBack={() => {}} onSubmit={() => {}} error={null} guardMs={400} />);
    tap(key('9'));
    expect(digits).toEqual([]);
    m.key(m.container.querySelector('.pin__keys'), '7');
    expect(digits).toEqual(['7']);
    vi.advanceTimersByTime(399);
    tap(key('9'));
    expect(digits).toEqual(['7']);
    vi.advanceTimersByTime(2);
    tap(key('9'));
    expect(digits).toEqual(['7', '9']);
  });

  it('without guardMs (the sign-in pad) a tap counts at once', () => {
    const digits: string[] = [];
    m = mount();
    m.render(<PinKeys length={0} disabled={false} actionLabel="Sign in" onDigit={(d) => digits.push(d)} onBack={() => {}} onSubmit={() => {}} error={null} />);
    tap(key('9'));
    expect(digits).toEqual(['9']);
  });
});
