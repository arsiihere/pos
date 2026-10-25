// S47: the hub's now is `now_ms + (performance.now() − the performance.now() at receipt)`, read in the
// hub's zone from `utc_offset_ms`; never the device's wall clock or time zone.

export interface HubTime {
  now_ms: number;
  utc_offset_ms: number;
}

export interface HubClock {
  nowMs(): number;
  utcOffsetMs: number;
}

export function createHubClock(time: HubTime, perfNow: () => number = () => performance.now()): HubClock {
  const receivedAt = perfNow();
  return {
    nowMs: () => time.now_ms + (perfNow() - receivedAt),
    utcOffsetMs: time.utc_offset_ms,
  };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The UTC getters of a Date shifted by the hub's offset give the hub's wall time.
function inHubZone(ms: number, utcOffsetMs: number): Date {
  return new Date(ms + utcOffsetMs);
}

export function hubTimeText(ms: number, utcOffsetMs: number): string {
  const d = inHubZone(ms, utcOffsetMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function hubDayText(ms: number, utcOffsetMs: number): string {
  const d = inHubZone(ms, utcOffsetMs);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
