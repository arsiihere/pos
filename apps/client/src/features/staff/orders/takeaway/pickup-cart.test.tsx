import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, type Mounted } from '../../../../../test/dom';
import type { EtaDraft, EtaPreviewBody } from '../contracts';
import { forgetTakeawayDrafts } from './current-draft';
import { screenHarness, sl, view } from './screen-harness';
import { aRow, at } from './test-fixtures';

// ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §3.2 step 2b, §6.1, §6.14, §8 "Phone and pickup" (R4); frames PickupLater,
// PickupLaterUrdu): the takeaway cart's pickup row — Now (default) / +15 / +30 / +45 / Time…; the chosen pickup goes
// into the eta-preview draft and SubmitOrder as `pickup_at_ms`; the footer says "Kitchen times it for 1:50 PM"; the
// preview's `pickup_bounds` bound Time… and a 422 PICKUP_TIME_INVALID says why; clearing / sending resets to Now.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const NOW = at(13, 20); // the harness's hub clock
const BOUNDS = { earliest_ms: at(13, 30), latest_ms: Date.UTC(2026, 10, 25, 4, 0) };
const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
/** Ready by = the pickup when the draft has one (§6.14: the preview's promise is the pickup's), else 1:42 PM. */
const answer = (d: EtaDraft): { ok: true; data: EtaPreviewBody } => {
  const promise = d.pickup_at_ms ?? at(13, 42);
  return { ok: true, data: { as_of_seq: 1, groups: [{ promise_ms: promise, keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: promise, from_stock: false, zone_served: false })), pickup_bounds: BOUNDS } };
};
const naan = (m: Mounted) => {
  m.click(m.button('Sides', m.container.querySelector('.pills')!));
  m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};
const pick = (m: Mounted) => m.container.querySelector<HTMLElement>('.cart [data-pickup-row]');
const chip = (m: Mounted, label: string) => [...(pick(m)?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
const selected = (m: Mounted) => [...(pick(m)?.querySelectorAll('button[aria-pressed="true"]') ?? [])].map((b) => (b.textContent ?? '').trim());
const ready = (m: Mounted) => m.container.querySelector('.cart [data-ready]')?.textContent ?? '';

let drafts: EtaDraft[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  forgetTakeawayDrafts();
  drafts = [];
  window.history.replaceState(null, '', '#/takeaway');
});
afterEach(() => {
  vi.useRealTimers();
  setLanguage('en');
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '#');
});

const harness = (o: Parameters<typeof screenHarness>[0] = {}) =>
  screenHarness({
    preview: (d) => {
      drafts.push(d);
      return answer(d);
    },
    answer: (type, payload) => (type === 'SubmitOrder' ? { status: 'sent', result: { order_id: (payload as { order_id: string }).order_id, token: 57, groups: [{ group_id: 'g', promise_ms: at(13, 50), order_item_ids: [] }], lines: [], slip: null } } : undefined),
    ...o,
  });

describe('[02b-TK L-CLIENT-5 item 1; 02b §8 Phone and pickup (R4)] the takeaway cart pickup row', () => {
  it('[§8; frame PickupLater] a takeaway cart offers Now (pressed) / +15 / +30 / +45 / Time…; a parking cart has none', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    expect(pick(m)?.textContent).toContain('Pickup');
    expect(['Now', '+15 min', '+30 min', '+45 min', 'Time…'].map((l) => chip(m, l) !== undefined)).toEqual([true, true, true, true, true]);
    expect(selected(m)).toEqual(['Now']);
    m.unmount();
    const p = harness().renderAs('parking', 'P1');
    await flush();
    expect(pick(p)).toBeNull();
    p.unmount();
  });

  it('[§6.14, §6.1] +30 → the preview draft and SubmitOrder carry hub now + 30 min; the footer says Kitchen times it for 1:50 PM; Send resets to Now', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    naan(m);
    await tick();
    expect(drafts.at(-1)?.pickup_at_ms).toBeUndefined();
    expect(ready(m)).toContain('1:42 PM');
    m.click(chip(m, '+30 min'));
    await tick();
    expect(selected(m)).toEqual(['+30 min']);
    expect(drafts.at(-1)?.pickup_at_ms).toBe(NOW + 30 * 60_000);
    expect(ready(m)).toContain('Kitchen times it for');
    expect(ready(m)).toContain('1:50 PM');
    expect(m.container.querySelector('.cart .tk-readyby--later')).not.toBeNull();
    m.click(m.button('Send · pay later', m.container.querySelector('.cart')!));
    await flush();
    expect((h.sent[0]!.payload as { pickup_at_ms?: number }).pickup_at_ms).toBe(NOW + 30 * 60_000);
    // the fresh cart is Now again
    expect(selected(m)).toEqual(['Now']);
    naan(m);
    await tick();
    expect(drafts.at(-1)?.pickup_at_ms).toBeUndefined();
    m.unmount();
  });

  it('[02b v1.0.26 §8, owner 2026-11-28 QA BUG-5] the kitchen cannot make the pickup (promise after it) → amber "Kitchen can make it by 1:55 PM, not 1:50 PM" before Send; the pickup sent stays the asked one', async () => {
    const late = at(13, 55);
    const h = harness({
      preview: (d) => {
        drafts.push(d);
        const a = answer(d);
        return d.pickup_at_ms === undefined ? a : { ...a, data: { ...a.data, groups: [{ ...a.data.groups[0]!, promise_ms: late }] } };
      },
    });
    const m = h.render();
    await flush();
    naan(m);
    await tick();
    expect(m.container.querySelector('.cart [data-pickup-late]')).toBeNull();
    m.click(chip(m, '+30 min'));
    await tick();
    const warn = m.container.querySelector<HTMLElement>('.cart [data-pickup-late]');
    expect(warn?.textContent).toBe('Kitchen can make it by 1:55 PM, not 1:50 PM');
    expect(warn?.classList.contains('c-warn')).toBe(true);
    m.click(m.button('Send · pay later', m.container.querySelector('.cart')!));
    await flush();
    expect((h.sent[0]!.payload as { pickup_at_ms?: number }).pickup_at_ms).toBe(NOW + 30 * 60_000);
    m.unmount();
  });

  it('[02b v1.0.26 §8, BUG-5] a pickup the kitchen makes (promise = the pickup) shows no warning', async () => {
    const m = harness().render();
    await flush();
    naan(m);
    m.click(chip(m, '+30 min'));
    await tick();
    expect(ready(m)).toContain('1:50 PM');
    expect(m.container.querySelector('.cart [data-pickup-late]')).toBeNull();
    m.unmount();
  });

  it('[§6.14 pickup_bounds] Time… opens a time input bounded by the preview range; a typed time goes into the draft; Now clears it', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    naan(m);
    await tick();
    m.click(chip(m, 'Time…'));
    const input = pick(m)!.querySelector<HTMLInputElement>('input[type="time"]')!;
    expect(input).not.toBeNull();
    expect(input.min).toBe('13:30');
    expect(input.max).toBe('04:00');
    expect(pick(m)!.textContent).toContain('Pickup between 1:30 PM and 4:00 AM');
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(input, '14:15');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await tick();
    expect(drafts.at(-1)?.pickup_at_ms).toBe(at(14, 15));
    expect(selected(m)).toEqual(['2:15 PM']);
    m.click(chip(m, 'Now'));
    await tick();
    expect(drafts.at(-1)?.pickup_at_ms).toBeUndefined();
    expect(selected(m)).toEqual(['Now']);
    m.unmount();
  });

  it('[§3.2 step 2b, §8] a 422 PICKUP_TIME_INVALID shows its reason and range in plain words, and Send waits', async () => {
    const h = harness({
      preview: (d) => {
        drafts.push(d);
        return d.pickup_at_ms == null ? answer(d) : { ok: false, error: { kind: 'api', status: 422, code: 'PICKUP_TIME_INVALID', details: { reason: 'after_day_end', pickup_at_ms: d.pickup_at_ms, ...BOUNDS } } };
      },
    });
    const m = h.render();
    await flush();
    naan(m);
    await tick();
    m.click(chip(m, '+45 min'));
    await tick();
    const problem = m.container.querySelector('.cart [data-pickup-problem]');
    expect(problem?.textContent).toContain('Too late — the day ends at 4:00 AM');
    expect(problem?.textContent).toContain('Pickup between 1:30 PM and 4:00 AM');
    expect((m.button('Send · pay later', m.container.querySelector('.cart')!) as HTMLButtonElement).disabled).toBe(true);
    m.click(chip(m, 'Now'));
    await tick();
    expect(m.container.querySelector('.cart [data-pickup-problem]')).toBeNull();
    m.unmount();
  });

  it('[§8 Send] a Send refused PICKUP_TIME_INVALID toasts the reason and keeps the cart and its pickup', async () => {
    const h = harness({
      answer: (type) => (type === 'SubmitOrder' ? { status: 'refused', error: { kind: 'api', status: 422, code: 'PICKUP_TIME_INVALID', details: { reason: 'too_early', pickup_at_ms: NOW, ...BOUNDS } } } : undefined),
    });
    const m = h.render();
    await flush();
    naan(m);
    m.click(chip(m, '+15 min'));
    await tick();
    m.click(m.button('Send · pay later', m.container.querySelector('.cart')!));
    await flush();
    expect(h.toasts.at(-1)?.text).toContain('Too soon — the earliest pickup is 1:30 PM');
    expect(selected(m)).toEqual(['+15 min']);
    m.unmount();
  });

  it('[§3.1 m-8, §8] an addition pre-fills the root token\'s pickup while it is ≥ hub now + 10 min, else Now', async () => {
    for (const [pickup, expected] of [
      [at(14, 0), ['2:00 PM']],
      [at(13, 25), ['Now']],
    ] as const) {
      const h = harness({ rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 }, pickup_at_ms: pickup, effective_pickup_at_ms: pickup })], views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]) } });
      const m = h.render();
      await flush();
      m.click(m.container.querySelector('.tk-qr'));
      await flush();
      m.click(m.button('Add items'));
      expect(selected(m)).toEqual(expected);
      m.unmount();
    }
  });

  it('[§8; frame PickupLaterUrdu] Urdu: the strings-table words', async () => {
    setLanguage('ur');
    const h = harness();
    const m = h.render();
    await flush();
    expect(pick(m)?.textContent).toContain('کب لیں گے');
    expect(['ابھی', '15 منٹ بعد', '30 منٹ بعد', '45 منٹ بعد', 'وقت…'].map((l) => chip(m, l) !== undefined)).toEqual([true, true, true, true, true]);
    naan(m);
    m.click(chip(m, '30 منٹ بعد'));
    await tick();
    expect(ready(m)).toContain('کچن اس وقت کیلئے بنائے گا');
    m.unmount();
  });
});
