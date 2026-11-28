import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';

// ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §3.2 step 2b, §6.14, §8 "Phone and pickup" (R4); frames PickupLater,
// PickupLaterUrdu): a takeaway cart's pickup time. Now (no pickup) / +15 / +30 / +45 min after hub now / Time… (a
// hub-local clock time). The hub checks it (earliest = now + 10 min, latest = the end of the open business day) in
// eta-preview and again at Send (a queued Send against its queued_at); a 422 PICKUP_TIME_INVALID shows its reason
// and its bounds in plain words. Pure.

export const PICKUP_CHIPS = [15, 30, 45] as const;

export interface CartPickup {
  /** the pickup the cart sends (`pickup_at_ms`, hub-clock ms) */
  at_ms: number;
  /** the chip that set it */
  chip: (typeof PICKUP_CHIPS)[number] | 'time';
}

export type PickupReason = 'no_time_left' | 'other_day' | 'too_early' | 'after_day_end';
export interface PickupBounds {
  earliest_ms: number;
  latest_ms: number;
}
export type PickupProblem = { reason: PickupReason } & PickupBounds;

const DAY_MS = 86_400_000;

/** +15 / +30 / +45: that many minutes after hub now. */
export function chipPickup(nowMs: number, minutes: (typeof PICKUP_CHIPS)[number]): CartPickup {
  return { chip: minutes, at_ms: Math.floor(nowMs) + minutes * 60_000 };
}

/**
 * Time…: "HH:MM" on the hub's local clock — today while still ahead of hub now, else the next day (null if not a time).
 * ⚠️ 02b v1.0.28 QK-4 (BUG-17): with the open day's end known (`pickup_bounds.latest_ms`), a time whose next day falls
 * after it stays today's — a time that has passed, said so (`pickupPassed`), never sent as tomorrow.
 */
export function timePickup(hhmm: string, nowMs: number, utcOffsetMs: number, dayEndMs?: number | null): CartPickup | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (m === null) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const localNow = Math.floor(nowMs) + utcOffsetMs;
  const midnight = localNow - (((localNow % DAY_MS) + DAY_MS) % DAY_MS);
  let at = midnight + (h * 60 + min) * 60_000 - utcOffsetMs;
  if (at <= nowMs && (dayEndMs == null || at + DAY_MS <= dayEndMs)) at += DAY_MS;
  return { chip: 'time', at_ms: at };
}

/** ⚠️ 02b v1.0.28 QK-4 (BUG-17): the cart's pickup is at or before hub now ("That time has passed"). */
export function pickupPassed(p: CartPickup | undefined, nowMs: number): boolean {
  return p !== undefined && p.at_ms <= nowMs;
}

/** The time input's "HH:MM" of a hub-clock instant (hub-local). */
export function timeInputOf(ms: number, utcOffsetMs: number): string {
  const d = new Date(ms + utcOffsetMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

const REASONS: readonly string[] = ['no_time_left', 'other_day', 'too_early', 'after_day_end'];

/** A PICKUP_TIME_INVALID's details `{ reason, pickup_at_ms, earliest_ms, latest_ms }`, or null when not that shape. */
export function pickupError(details: unknown): PickupProblem | null {
  const d = (details ?? {}) as Record<string, unknown>;
  if (typeof d['reason'] !== 'string' || !REASONS.includes(d['reason']) || typeof d['earliest_ms'] !== 'number' || typeof d['latest_ms'] !== 'number') return null;
  return { reason: d['reason'] as PickupReason, earliest_ms: d['earliest_ms'], latest_ms: d['latest_ms'] };
}

/** §8: the reason in plain words ("Too soon — the earliest pickup is 1:30 PM"). */
export function pickupProblemText(p: PickupProblem, utcOffsetMs: number): string {
  const time = (ms: number) => timeText(ms, utcOffsetMs);
  switch (p.reason) {
    case 'too_early':
      return fill(t('c.pick_err.too_early'), { t: time(p.earliest_ms) });
    case 'after_day_end':
      return fill(t('c.pick_err.after_day_end'), { t: time(p.latest_ms) });
    case 'other_day':
      return t('c.pick_err.other_day');
    case 'no_time_left':
      return t('c.pick_err.no_time_left');
  }
}

/** §6.14 `pickup_bounds`: "Pickup between 1:30 PM and 4:00 AM". */
export function pickupRangeText(b: PickupBounds, utcOffsetMs: number): string {
  return fill(t('c.pick_range'), { from: timeText(b.earliest_ms, utcOffsetMs), to: timeText(b.latest_ms, utcOffsetMs) });
}
