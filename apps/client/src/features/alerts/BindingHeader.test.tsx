import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../../test/dom';
import { BindingHeader } from './BindingHeader';
import { fakeTimers, recordingSink } from './test-fakes';

// 01d §3.7 / §8.1 (B05), BF-5, test #57 (vi): the tablet header line. "Alerts: Ali — pauses at 2:05 PM" while the
// hub's deadline is ahead, "Alerts paused" with one info chime when it passes, "Alerts: none" with no binding.
// The deadline timer and the clock are injected (the hub clock, never the device's).

let m: Mounted;
afterEach(() => m?.unmount());

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 2, 13, 55); // 1:55 PM hub time (offset 0)
const UNTIL = T0 + 10 * MIN; // 2:05 PM

function setup(binding: { name: string; until: number } | null) {
  const timers = fakeTimers();
  const sink = recordingSink(timers);
  const hub = { now: T0 };
  const advance = (ms: number) => {
    hub.now += ms;
    act(() => timers.advance(ms));
  };
  m = mount();
  const render = (b: { name: string; until: number } | null) =>
    m.render(<BindingHeader binding={b} nowMs={() => hub.now} utcOffsetMs={0} timers={timers} sink={sink} />);
  render(binding);
  return { render, advance, sink };
}

const line = () => m.container.querySelector('.bind')?.textContent ?? '';

describe('[01d #57 client] tablet alerts header', () => {
  it('[01d #57 client] shows "Alerts: Ali — pauses at 2:05 PM", then "Alerts paused" with one info chime when it passes', () => {
    const { advance, sink } = setup({ name: 'Ali', until: UNTIL });
    expect(line()).toBe('Alerts: Ali — pauses at 2:05 PM');
    expect(m.container.querySelector('.bind--off')).toBeNull();
    expect(m.container.querySelector('.bind b')?.textContent).toBe('Ali');
    advance(10 * MIN - 1);
    expect(line()).toBe('Alerts: Ali — pauses at 2:05 PM');
    expect(sink.played).toEqual([]);
    advance(1);
    expect(line()).toBe('Alerts paused');
    expect(m.container.querySelector('.bind--off')).not.toBeNull();
    expect(sink.played.map((p) => p.sound)).toEqual(['info']);
    advance(60 * MIN);
    expect(sink.played.length).toBe(1);
  });

  it('[01d #57 client] shows "Alerts: none" with no binding, and no chime', () => {
    const { advance, sink } = setup(null);
    expect(line()).toBe('Alerts: none');
    expect(m.container.querySelector('.bind--off')).not.toBeNull();
    advance(60 * MIN);
    expect(sink.played).toEqual([]);
  });

  it('[01d #57 client] a header that is already past its deadline on load says paused and stays quiet', () => {
    const { sink } = setup({ name: 'Ali', until: T0 - MIN });
    expect(line()).toBe('Alerts paused');
    expect(sink.played).toEqual([]);
  });

  it('[01d BF-5] a later deadline moves the time and the chime, and the old timer does not fire', () => {
    const { render, advance, sink } = setup({ name: 'Ali', until: UNTIL });
    advance(5 * MIN);
    render({ name: 'Ali', until: UNTIL + 30 * MIN });
    expect(line()).toBe('Alerts: Ali — pauses at 2:35 PM');
    advance(5 * MIN);
    expect(line()).toBe('Alerts: Ali — pauses at 2:35 PM');
    expect(sink.played).toEqual([]);
    advance(30 * MIN);
    expect(line()).toBe('Alerts paused');
    expect(sink.played.length).toBe(1);
  });

  it('[01d BF-5] a null deadline (binding ended) shows none without a chime; a new binding after pause re-arms', () => {
    const { render, advance, sink } = setup({ name: 'Ali', until: UNTIL });
    advance(11 * MIN);
    expect(sink.played.length).toBe(1);
    render({ name: 'Sana', until: UNTIL + 2 * 60 * MIN });
    expect(line()).toBe('Alerts: Sana — pauses at 4:05 PM');
    render(null);
    expect(line()).toBe('Alerts: none');
    advance(3 * 60 * MIN);
    expect(sink.played.length).toBe(1);
  });
});
