import { t } from '../../i18n';
import { fill } from '../../i18n/en';

// 04 v1.0.4 §6.5, §8 (AD-15, to exclusive; integrator O11, O12): the audit range is whole days on the hub clock, half-open [from, to), at most
// 31 days. The hub's zone is the page's `utc_offset_ms` (S47, app/hub-clock.ts), never the device's. Day and month words
// come from the i18n catalogue (`alerts.months`, the 01d month list, Urdu month names), digits stay Latin (R20).

export const DAY_MS = 86_400_000;
export const MAX_DAYS = 31;

export interface DayRange {
  /** hub midnight, inclusive */
  from: number;
  /** hub midnight after the last day, exclusive */
  to: number;
}

/** The hub midnight that starts the day holding `ms`. */
export function dayStart(ms: number, utcOffsetMs: number): number {
  return Math.floor((ms + utcOffsetMs) / DAY_MS) * DAY_MS - utcOffsetMs;
}

/** Whole days from `first` to `last` (both days included). */
export function daysRange(first: number, last: number, utcOffsetMs: number): DayRange {
  const a = dayStart(Math.min(first, last), utcOffsetMs);
  const b = dayStart(Math.max(first, last), utcOffsetMs);
  return { from: a, to: b + DAY_MS };
}

export function todayRange(nowMs: number, utcOffsetMs: number): DayRange {
  return daysRange(nowMs, nowMs, utcOffsetMs);
}

export function dayCount(r: DayRange): number {
  return Math.round((r.to - r.from) / DAY_MS);
}

/** The hub-zone calendar fields of an instant. */
export function hubDate(ms: number, utcOffsetMs: number): { y: number; m: number; d: number; wd: number } {
  const x = new Date(ms + utcOffsetMs);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay() };
}

/** The hub midnight of a calendar day (month 0-based; a day past the month's end rolls over). */
export function hubMidnight(y: number, m: number, d: number, utcOffsetMs: number): number {
  return Date.UTC(y, m, d) - utcOffsetMs;
}

function monthName(m: number): string {
  return t('alerts.months').split(',')[m] ?? '';
}

/** "Tue 17 Nov" (Urdu: "17 نومبر", AuditUrdu). */
export function dayText(ms: number, utcOffsetMs: number): string {
  const x = hubDate(ms, utcOffsetMs);
  return fill(t('audit.date'), { weekday: t('audit.weekdays').split(',')[x.wd] ?? '', d: String(x.d), month: monthName(x.m) });
}

/** "11 Nov" */
export function shortDayText(ms: number, utcOffsetMs: number): string {
  const x = hubDate(ms, utcOffsetMs);
  return fill(t('audit.date_short'), { d: String(x.d), month: monthName(x.m) });
}

/** "11 Nov 2026" */
export function longDayText(ms: number, utcOffsetMs: number): string {
  const x = hubDate(ms, utcOffsetMs);
  return fill(t('audit.date_long'), { d: String(x.d), month: monthName(x.m), y: String(x.y) });
}

/** "2026-11-17", for the CSV file name (V17). */
export function isoDay(ms: number, utcOffsetMs: number): string {
  const x = hubDate(ms, utcOffsetMs);
  return `${x.y}-${String(x.m + 1).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
}

/** The presets of the Date popover (04-C06), each ending today at the latest. */
export type Preset = 'today' | 'yesterday' | 'last7' | 'month';

export function presetRange(p: Preset, nowMs: number, utcOffsetMs: number): DayRange {
  const today = dayStart(nowMs, utcOffsetMs);
  switch (p) {
    case 'today':
      return { from: today, to: today + DAY_MS };
    case 'yesterday':
      return { from: today - DAY_MS, to: today };
    case 'last7':
      return { from: today - 6 * DAY_MS, to: today + DAY_MS };
    case 'month': {
      const x = hubDate(nowMs, utcOffsetMs);
      return { from: hubMidnight(x.y, x.m, 1, utcOffsetMs), to: today + DAY_MS };
    }
  }
}

export function presetOf(r: DayRange, nowMs: number, utcOffsetMs: number): Preset | null {
  for (const p of ['today', 'yesterday', 'last7', 'month'] as const) {
    const q = presetRange(p, nowMs, utcOffsetMs);
    if (q.from === r.from && q.to === r.to) return p;
  }
  return null;
}

/** The Date filter's value: "Today · Tue 17 Nov", "Last 7 days", "Mon 16 Nov", "11 Nov – 17 Nov". */
export function rangeText(r: DayRange, nowMs: number, utcOffsetMs: number): string {
  const p = presetOf(r, nowMs, utcOffsetMs);
  if (p === 'today') return fill(t('audit.f.today'), { date: dayText(r.from, utcOffsetMs) });
  if (p === 'yesterday') return fill(t('audit.f.yesterday'), { date: dayText(r.from, utcOffsetMs) });
  if (p === 'last7') return t('audit.range.last7');
  if (p === 'month' && dayCount(r) > 1) return t('audit.range.month');
  if (dayCount(r) === 1) return dayText(r.from, utcOffsetMs);
  return fill(t('audit.f.range'), { from: shortDayText(r.from, utcOffsetMs), to: shortDayText(r.to - DAY_MS, utcOffsetMs) });
}

/** The range named inside a sentence (empty state): "Tue 17 Nov" or "11 Nov – 17 Nov". */
export function rangeInSentence(r: DayRange, utcOffsetMs: number): string {
  if (dayCount(r) === 1) return dayText(r.from, utcOffsetMs);
  return fill(t('audit.f.range'), { from: shortDayText(r.from, utcOffsetMs), to: shortDayText(r.to - DAY_MS, utcOffsetMs) });
}
