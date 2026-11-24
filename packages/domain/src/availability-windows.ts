// S47: time windows per item and per category, local time of day in ms, [start, end), end < start wraps.
// The UTC offset is always passed (the hub's), never read from the runtime. Browser-safe: no node:* import.

const DAY_MS = 86_400_000;

export const BUSINESS_DAY_END_LOCAL_MS_DEFAULT = 14_400_000;

export interface AvailabilityWindow {
  start_ms: number;
  end_ms: number;
}

export function localTimeOfDayMs(nowMs: number, utcOffsetMs: number): number {
  return (((nowMs + utcOffsetMs) % DAY_MS) + DAY_MS) % DAY_MS;
}

// 01a §3.3 BD-3: the first configured local day end at or after the minimum gap.
export function businessDayLatestMs(
  openedAtMs: number,
  dayMinGapHours: number,
  businessDayEndLocalMs: number,
  utcOffsetMs: number,
): number {
  const base = openedAtMs + dayMinGapHours * 3_600_000;
  const untilDayEnd = businessDayEndLocalMs - localTimeOfDayMs(base, utcOffsetMs);
  return base + (((untilDayEnd % DAY_MS) + DAY_MS) % DAY_MS);
}

export function inAvailabilityWindows(windows: readonly AvailabilityWindow[], localTimeOfDayMs: number): boolean {
  if (windows.length === 0) return true;
  return windows.some((w) =>
    w.start_ms < w.end_ms
      ? localTimeOfDayMs >= w.start_ms && localTimeOfDayMs < w.end_ms
      : localTimeOfDayMs >= w.start_ms || localTimeOfDayMs < w.end_ms,
  );
}

export function isOrderableByTime(
  item: { availability_windows: readonly AvailabilityWindow[] },
  category: { availability_windows: readonly AvailabilityWindow[] } | null,
  hubNowMs: number,
  utcOffsetMs: number,
): boolean {
  const t = localTimeOfDayMs(hubNowMs, utcOffsetMs);
  return inAvailabilityWindows(item.availability_windows, t) && (category === null || inAvailabilityWindows(category.availability_windows, t));
}
