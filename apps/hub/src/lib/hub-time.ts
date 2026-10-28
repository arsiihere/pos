import type { Clock } from './clock.js';

// S47: the hub's clock and its OS time zone's offset at that instant; clients never use their own zone.
export function hubTime(clock: Clock): { now_ms: number; utc_offset_ms: number } {
  const now = clock.branchNow();
  // `0 -` rather than unary minus, so UTC gives 0, not -0.
  return { now_ms: now, utc_offset_ms: 0 - new Date(now).getTimezoneOffset() * 60_000 };
}
