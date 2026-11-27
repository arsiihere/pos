import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { screenHarness } from './screen-harness';

// 02b-TK L-CLIENT-6a item 8 (frame CartNote; 02b §8 order note ≤ 200): a takeaway cart shows its saved order note as a
// row above Note · Hold, and the note button reads "Add note" / "Edit note".

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  document.body.innerHTML = '';
});

describe('[02b-TK L-CLIENT-6a item 8] the order note in the takeaway cart', () => {
  it('[frame CartNote] Add note → the saved note shows in the cart; the button then reads Edit note', async () => {
    const v = (m = screenHarness({ rows: [] }).render());
    await flush();
    v.click(v.button('Sides', v.container.querySelector('.pills')!));
    v.click(v.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
    expect(v.container.querySelector('[data-note]')).toBeNull();
    v.click(v.button('Add note', v.container.querySelector('.cart')!));
    const area = document.querySelector<HTMLTextAreaElement>('textarea')!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      set.call(area, 'Less spicy, extra raita');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    v.click([...document.querySelectorAll<HTMLButtonElement>('.btn--primary')].find((b) => b.closest('[role="dialog"]') !== null)!);
    await flush();
    expect(v.container.querySelector('[data-note]')?.textContent).toBe('Less spicy, extra raita');
    expect(v.button('Edit note', v.container.querySelector('.cart')!)).toBeTruthy();
  });
});
