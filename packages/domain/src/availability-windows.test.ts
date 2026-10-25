import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as root from './index';
import { inAvailabilityWindows, isOrderableByTime, localTimeOfDayMs } from './availability-windows';

const H = 3_600_000;
const M = 60_000;
const at = (h: number, m = 0) => h * H + m * M;
const KARACHI = 5 * H;
// hub clock instant whose Karachi (+5 h) local time is hh:mm on 2026-10-25
const hubAt = (h: number, m = 0) => Date.UTC(2026, 9, 25, 0, 0) + at(h, m) - KARACHI;

let savedTz: string | undefined;
beforeAll(() => {
  savedTz = process.env.TZ;
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe('availability windows', () => {
  it('[01a §10 #136] inAvailabilityWindows and localTimeOfDayMs', () => {
    expect(inAvailabilityWindows([], 0)).toBe(true);
    expect(inAvailabilityWindows([], at(13, 37))).toBe(true);

    const lunch = [{ start_ms: at(7), end_ms: at(13) }];
    expect(inAvailabilityWindows(lunch, at(7))).toBe(true);
    expect(inAvailabilityWindows(lunch, at(13))).toBe(false);
    expect(inAvailabilityWindows(lunch, at(6, 59))).toBe(false);

    const late = [{ start_ms: at(22), end_ms: at(2) }];
    expect(inAvailabilityWindows(late, at(23, 30))).toBe(true);
    expect(inAvailabilityWindows(late, at(1, 59))).toBe(true);
    expect(inAvailabilityWindows(late, at(2))).toBe(false);
    expect(inAvailabilityWindows(late, at(21, 59))).toBe(false);

    expect(new Date(0).getTimezoneOffset()).toBe(0);
    expect(localTimeOfDayMs(Date.UTC(2026, 9, 25, 9, 0), KARACHI)).toBe(at(14));
    expect(localTimeOfDayMs(Date.UTC(2026, 9, 25, 22, 30), KARACHI)).toBe(at(3, 30));
    expect(localTimeOfDayMs(Date.UTC(2026, 9, 25, 2, 0), -5 * H)).toBe(at(21));
  });

  it('[01a §10 #137] isOrderableByTime against the hub clock and offset', () => {
    const lunchItem = { availability_windows: [{ start_ms: at(7), end_ms: at(13) }] };
    const noWindowItem = { availability_windows: [] };
    const afternoon = { availability_windows: [{ start_ms: at(12), end_ms: at(16) }] };
    const evening = { availability_windows: [{ start_ms: at(18), end_ms: at(23) }] };
    const always = { availability_windows: [] };

    expect(isOrderableByTime(lunchItem, null, hubAt(14), KARACHI)).toBe(false);
    expect(isOrderableByTime(noWindowItem, afternoon, hubAt(14), KARACHI)).toBe(true);
    expect(isOrderableByTime(lunchItem, evening, hubAt(10), KARACHI)).toBe(false);
    expect(isOrderableByTime(lunchItem, always, hubAt(12, 59), KARACHI)).toBe(true);
    expect(isOrderableByTime(lunchItem, always, hubAt(13), KARACHI)).toBe(false);
  });

  it('[01a S47] exported from the @pos/domain root', () => {
    expect(root.inAvailabilityWindows).toBe(inAvailabilityWindows);
    expect(root.isOrderableByTime).toBe(isOrderableByTime);
    expect(root.localTimeOfDayMs).toBe(localTimeOfDayMs);
  });
});
