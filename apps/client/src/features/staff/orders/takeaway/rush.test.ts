import { afterEach, describe, expect, it, vi } from 'vitest';
import { RUSH_KEY, RUSH_OPEN_ORDERS, readRushOverride, rushOn, toggledOverride, writeRushOverride } from './rush';

// 02b-TK A2 item 4 (frame HomeRush; ruling R9 "UI only"; CHANGES §6 Q6): rush mode is on at 15 open takeaway tokens
// (the branch setting `rush_open_orders` is Part B, 01a v2.11) or by the pill (a manual override, remembered on this
// device; a storage that throws is ignored).

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('[02b-TK R9] rush mode', () => {
  it('[CHANGES §6 Q6] on at 15 open orders, off below; a manual override wins', () => {
    expect(RUSH_OPEN_ORDERS).toBe(15);
    expect(rushOn(14, null)).toBe(false);
    expect(rushOn(15, null)).toBe(true);
    expect(rushOn(40, false)).toBe(false);
    expect(rushOn(3, true)).toBe(true);
  });

  it('[frame HomeRush pill] a tap flips what is shown; flipping back to what the count says clears the override', () => {
    expect(toggledOverride(3, null)).toBe(true);
    expect(toggledOverride(3, true)).toBe(null);
    expect(toggledOverride(20, null)).toBe(false);
    expect(toggledOverride(20, false)).toBe(null);
  });

  it('[R9] the override is kept in localStorage on this device; a throwing storage is ignored', () => {
    expect(readRushOverride()).toBe(null);
    writeRushOverride(true);
    expect(window.localStorage.getItem(RUSH_KEY)).toBe('on');
    expect(readRushOverride()).toBe(true);
    writeRushOverride(false);
    expect(readRushOverride()).toBe(false);
    writeRushOverride(null);
    expect(window.localStorage.getItem(RUSH_KEY)).toBe(null);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRushOverride()).toBe(null);
    expect(() => writeRushOverride(true)).not.toThrow();
  });
});
