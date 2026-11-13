import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { LockBannerState } from '../contracts';
import { LockBanner } from './LockBanner';

// 02a §8 Banners (handoff 02a-B10: LockReleased, LockHolderChanged, LockHolderChangedSend, LockOtherDevice,
// LockTimedOut, ForceMovedToMe).

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

function show(state: LockBannerState | null) {
  const onKeepDraft = vi.fn();
  m = mount();
  m.render(<LockBanner state={state} onKeepDraft={onKeepDraft} />);
  return { m, onKeepDraft, title: () => m!.container.querySelector('.ac__title b')?.textContent ?? '', det: () => m!.container.querySelector('.ac__det')?.textContent ?? '' };
}

describe('[02a §8 Banners] LockBanner', () => {
  it('[02a §8 Banners] nothing without a state', () => {
    expect(show(null).m.container.innerHTML).toBe('');
  });

  it('[02a §8 Banners] released by a manager: warn banner, table code, "by Imran", the reason localised; Keep as draft', () => {
    const v = show({ kind: 'released_by', table: 'F7', by_name: 'Imran', reason: 'went_home' });
    const abn = v.m.container.querySelector('.abns .abn.c-warn[role="alert"]');
    expect(abn).not.toBeNull();
    expect(v.m.container.querySelector('.tcode')?.textContent).toBe('F7');
    expect(v.title()).toBe('Your table F7 was released by Imran');
    expect(v.det()).toBe('“Went home” · Your order is kept as a draft.');
    v.m.click(v.m.button('Keep as draft'));
    expect(v.onKeepDraft).toHaveBeenCalledTimes(1);
  });

  it('[02a Q-18] a token with a note shows the token localised and the note; other text raw; no name, no reason', () => {
    let v = show({ kind: 'released_by', table: 'F7', by_name: 'Imran', reason: 'shift_ended: left early' });
    expect(v.det()).toBe('“Shift ended: left early” · Your order is kept as a draft.');
    v.m.unmount();
    v = show({ kind: 'released_by', table: 'F7', by_name: 'Imran', reason: 'stayed too long' });
    expect(v.det()).toBe('“stayed too long” · Your order is kept as a draft.');
    v.m.unmount();
    v = show({ kind: 'released_by', table: 'F7', by_name: null, reason: null });
    expect(v.title()).toBe('Your table F7 was released');
    expect(v.det()).toBe('Your order is kept as a draft.');
  });

  it('[02a §8 Banners] lock time, other device, holder changed with and without Send', () => {
    let v = show({ kind: 'released_ttl', table: 'F7', minutes: 15 });
    expect(v.title()).toBe('Your table F7 was released after 15 min without activity');
    expect(v.det()).toBe('Your order is kept. Send takes the table back if it’s still free.');
    v.m.unmount();
    v = show({ kind: 'other_device', table: 'F7' });
    expect(v.title()).toBe('Opened on another device');
    expect(v.det()).toBe('This order stays here as a draft.');
    v.m.unmount();
    v = show({ kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: false });
    expect(v.title()).toBe('Ali now has this table');
    expect(v.det()).toBe('Your order is kept as a draft. Hold it or discard it.');
    v.m.unmount();
    v = show({ kind: 'holder_changed', table: 'F7', holder_name: 'Ali', can_send: true });
    expect(v.det()).toBe('You can still send this order. The table stays Ali’s.');
    expect(v.m.button('Keep as draft')).toBeTruthy();
  });

  it('[02a §8 Banners] ForceMovedToMe: info banner "A manager gave you F2", OK hides it', () => {
    const v = show({ kind: 'force_moved_to_me', table: 'F2' });
    expect(v.m.container.querySelector('.abn.abn--info.c-info')).not.toBeNull();
    expect(v.title()).toBe('A manager gave you F2');
    v.m.click(v.m.button('OK'));
    expect(v.m.container.querySelector('.abn')).toBeNull();
    expect(v.onKeepDraft).not.toHaveBeenCalled();
  });

  it('[02a §8 Rules] Urdu: the texts come from ur, the table code stays LTR', () => {
    setLanguage('ur');
    const v = show({ kind: 'other_device', table: 'F7' });
    expect(v.title()).toBe('دوسرے آلے پر کھل گئی');
    expect(v.m.container.querySelector('.tcode')?.getAttribute('dir')).toBe('ltr');
  });
});
