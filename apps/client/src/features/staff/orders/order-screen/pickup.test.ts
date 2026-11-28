import { describe, expect, it } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { createLiveBus } from '../../shell/live';
import type { EtaPreviewBody } from '../contracts';
import { freezeSubmit, refusalText } from '../send/send';
import { EMPTY_CART, toEtaDraft, type Cart } from './cart';
import { chipPickup, pickupError, pickupProblemText, pickupRangeText, timeInputOf, timePickup } from './pickup';
import { createPreview } from './preview';
import { aBranchConfig } from '@pos/events/testing';

// ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §3.2 step 2b, §6.1, §6.14, §8 "Phone and pickup" (R4); frames PickupLater,
// PickupLaterUrdu): the takeaway cart's pickup — the chips' times on the hub clock, the eta-preview draft and the
// frozen SubmitOrder carry `pickup_at_ms`, a 422 PICKUP_TIME_INVALID in plain words with its bounds.

const T = Date.UTC(2026, 10, 27, 13, 20); // 1:20 PM, UTC offset 0
const PK = 5 * 3_600_000; // Pakistan, +05:00
const line = { key: 'A', item_id: 'I1', quantity: 1, options: [] };
const cart = (o: Partial<Cart> = {}): Cart => ({ ...EMPTY_CART, lines: [line], ...o });

describe('[02b-TK L-CLIENT-5 item 1; 02b §8 Phone and pickup] the chips', () => {
  it('[02b §8 R4] +15 / +30 / +45 are that many minutes after hub now (whole ms)', () => {
    expect(chipPickup(T + 0.6, 15)).toEqual({ chip: 15, at_ms: T + 15 * 60_000 });
    expect(chipPickup(T, 30).at_ms).toBe(T + 30 * 60_000);
    expect(chipPickup(T, 45).at_ms).toBe(T + 45 * 60_000);
  });

  it('[02b §3.2 step 2b] Time… is a hub-local clock time: today when still ahead, else tomorrow (the day ends at 04:00)', () => {
    expect(timePickup('14:00', T, 0)).toEqual({ chip: 'time', at_ms: Date.UTC(2026, 10, 27, 14, 0) });
    // 00:30 typed at 1:20 PM is after midnight (a day opened 08:00 ends 04:00 next morning)
    expect(timePickup('00:30', T, 0)!.at_ms).toBe(Date.UTC(2026, 10, 28, 0, 30));
    // hub local time +05:00: 18:20 local = 13:20 UTC
    expect(timePickup('19:00', T, PK)!.at_ms).toBe(Date.UTC(2026, 10, 27, 14, 0));
    expect(timePickup('', T, 0)).toBeNull();
    expect(timePickup('25:00', T, 0)).toBeNull();
  });

  it('[02b §6.14 pickup_bounds] the time input shows hub-local HH:MM', () => {
    expect(timeInputOf(Date.UTC(2026, 10, 27, 13, 30), 0)).toBe('13:30');
    expect(timeInputOf(Date.UTC(2026, 10, 27, 23, 5), PK)).toBe('04:05');
  });
});

describe('[02b-TK L-CLIENT-5 item 1; 02b §6.14, §6.1] the draft and the frozen Send', () => {
  it('[02b §6.14] the eta-preview draft carries pickup_at_ms on a takeaway; none without a pickup', () => {
    expect(toEtaDraft(cart({ pickup: { chip: 30, at_ms: T + 1_800_000 } }), { order_type: 'takeaway' }).pickup_at_ms).toBe(T + 1_800_000);
    expect('pickup_at_ms' in toEtaDraft(cart(), { order_type: 'takeaway' })).toBe(false);
    // takeaway only (§3.2 step 2b: on another type the hub refuses takeaway_only)
    expect('pickup_at_ms' in toEtaDraft(cart({ pickup: { chip: 30, at_ms: T } }), { order_type: 'parking' })).toBe(false);
  });

  it('[02b §6.1, §3.12] SubmitOrder carries pickup_at_ms, frozen with the payload (a later cart change never reaches it)', () => {
    const c = cart({ pickup: { chip: 'time', at_ms: T + 2 * 3_600_000 } });
    const p = freezeSubmit(c, { order_type: 'takeaway' }, 'O1', { print_slip: true });
    expect(p.pickup_at_ms).toBe(T + 2 * 3_600_000);
    expect(Object.isFrozen(p)).toBe(true);
    c.pickup!.at_ms = 0;
    expect(p.pickup_at_ms).toBe(T + 2 * 3_600_000);
    expect('pickup_at_ms' in freezeSubmit(cart(), { order_type: 'takeaway' }, 'O2')).toBe(false);
    expect('pickup_at_ms' in freezeSubmit(cart({ pickup: { chip: 15, at_ms: T } }), { order_type: 'dine_in', table_id: 'T1', seating_id: 'S1' }, 'O3')).toBe(false);
  });
});

describe('[02b-TK L-CLIENT-5 item 1; 02b §3.2 step 2b, §9] PICKUP_TIME_INVALID in plain words', () => {
  const details = (reason: string) => ({ reason, pickup_at_ms: T, earliest_ms: Date.UTC(2026, 10, 27, 13, 30), latest_ms: Date.UTC(2026, 10, 28, 4, 0) });

  it('[§3.2 step 2b] each reason the spec lists, with the bounds', () => {
    setLanguage('en');
    expect(pickupError(details('too_early'))).toEqual({ reason: 'too_early', earliest_ms: details('x').earliest_ms, latest_ms: details('x').latest_ms });
    expect(pickupError({})).toBeNull();
    expect(pickupProblemText(pickupError(details('too_early'))!, 0)).toBe('Too soon — the earliest pickup is 1:30 PM');
    expect(pickupProblemText(pickupError(details('after_day_end'))!, 0)).toBe('Too late — the day ends at 4:00 AM');
    expect(pickupProblemText(pickupError(details('other_day'))!, 0)).toBe('That time is on another business day — pick a time today');
    expect(pickupProblemText(pickupError(details('no_time_left'))!, 0)).toBe('No pickup time is left today — choose Now, or close the day first');
    expect(pickupRangeText({ earliest_ms: details('x').earliest_ms, latest_ms: details('x').latest_ms }, 0)).toBe('Pickup between 1:30 PM and 4:00 AM');
  });

  it('[§8] Urdu', () => {
    setLanguage('ur');
    try {
      expect(pickupProblemText(pickupError(details('too_early'))!, 0)).toContain('1:30 PM');
      expect(pickupProblemText(pickupError(details('too_early'))!, 0)).not.toContain('Too soon');
      expect(pickupRangeText({ earliest_ms: details('x').earliest_ms, latest_ms: details('x').latest_ms }, 0)).toContain('4:00 AM');
    } finally {
      setLanguage('en');
    }
  });

  it('[§8] a refused Send says the reason (the queue log too)', () => {
    setLanguage('en');
    const text = refusalText(aBranchConfig(), { kind: 'refused', error: { kind: 'api', status: 422, code: 'PICKUP_TIME_INVALID', details: details('too_early') } }, 0);
    expect(text).toContain('Too soon — the earliest pickup is 1:30 PM');
  });

  it('[§6.14] the preview keeps a 422 as pickup_invalid with its reason and bounds; an ok reply has pickup_bounds', async () => {
    const answers: Array<{ ok: boolean; data?: EtaPreviewBody; error?: unknown }> = [
      { ok: false, error: { kind: 'api', status: 422, code: 'PICKUP_TIME_INVALID', details: details('after_day_end') } },
      { ok: true, data: { as_of_seq: 1, groups: [], lines: [], pickup_bounds: { earliest_ms: 1, latest_ms: 2 } } },
    ];
    const timers: Array<() => void> = [];
    const p = createPreview({
      live: createLiveBus(),
      online: () => true,
      etaPreview: async () => answers.shift() as never,
      setTimeout: (fn) => timers.push(fn),
      clearTimeout: () => {},
    });
    p.set({ order_type: 'takeaway', lines: [], pickup_at_ms: T });
    timers.shift()!();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(p.state()).toEqual({ kind: 'pickup_invalid', problem: { reason: 'after_day_end', earliest_ms: details('x').earliest_ms, latest_ms: details('x').latest_ms } });
    p.set({ order_type: 'takeaway', lines: [] });
    timers.pop()!(); // the debounce (⚠️ 02b v1.0.26 CT-2: the 30 s re-ask timer is queued before it)
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    const s = p.state();
    expect(s.kind === 'ok' && s.body.pickup_bounds).toEqual({ earliest_ms: 1, latest_ms: 2 });
  });
});
