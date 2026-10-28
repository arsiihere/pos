import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHubClock, hubDayText, hubTimeText } from './hub-clock';

afterEach(() => vi.restoreAllMocks());

describe('hub clock', () => {
  it('[01a S47] nowMs advances with performance.now, not Date.now', () => {
    let perf = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => perf);
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(5);

    const clock = createHubClock({ now_ms: 1_000_000, utc_offset_ms: 18_000_000 });
    expect(clock.nowMs()).toBe(1_000_000);
    expect(clock.utcOffsetMs).toBe(18_000_000);

    perf += 60_000;
    dateNow.mockReturnValue(999_999_999_999);
    expect(clock.nowMs()).toBe(1_060_000);
  });

  it('[01a S47] times and days read in the hub zone from utc_offset_ms', () => {
    // 2026-10-24T04:12:00Z is Sat 24 Oct 09:12 at +5 h, Fri 23 Oct 23:12 at −5 h.
    const ms = Date.UTC(2026, 9, 24, 4, 12);
    expect(hubTimeText(ms, 5 * 3_600_000)).toBe('09:12');
    expect(hubDayText(ms, 5 * 3_600_000)).toBe('Sat 24 Oct');
    expect(hubTimeText(ms, -5 * 3_600_000)).toBe('23:12');
    expect(hubDayText(ms, -5 * 3_600_000)).toBe('Fri 23 Oct');
  });
});
