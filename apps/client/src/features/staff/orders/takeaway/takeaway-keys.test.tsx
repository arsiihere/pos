import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { forgetTakeawayDrafts } from './current-draft';
import { screenHarness } from './screen-harness';

// 02b-TK A2 item 2 (frame KeyboardMode; MAPPING TK-S02; CHANGES §3 Menu): the keyboard speed mode of the takeaway
// screen — "/" focuses the item search; a number prefix adds that many ("4n" Enter = 4 naan); initials find a
// variant ("hk" = half karahi); F2 new takeaway, F4 Hold, Esc back (closes the drawer, else leaves the search); the
// shortcut hint row on the kiosk; typing while the name or phone field has focus goes to that field, never to the
// search; F8 / F9 keep sending (02b-TK C3-1).

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const type = (el: Element | null, value: string) => {
  const input = el as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
};
const press = (el: Element | Document, key: string): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => void el.dispatchEvent(e));
  return e;
};
const search = (m: Mounted) => m.container.querySelector<HTMLInputElement>('.menu input[type="search"]')!;
const cartLines = (m: Mounted) => [...m.container.querySelectorAll('.cart .ln')];
/** the harness's Naan sits in Sides, not the first category */
const naan = (m: Mounted) => {
  m.click(m.button('Sides', m.container.querySelector('.cats')!));
  m.click(m.container.querySelector('.mi[aria-label="Naan"]'));
};
const sugg = (m: Mounted) => [...m.container.querySelectorAll('.tk-sugg [role="option"]')];

beforeEach(() => {
  forgetTakeawayDrafts();
  window.history.replaceState(null, '', '#/takeaway');
});
afterEach(() => {
  document.body.innerHTML = '';
  nav.to = [];
  window.history.replaceState(null, '', '#');
});

describe('[02b-TK TK-S02] keyboard speed mode on the takeaway screen', () => {
  it('[frame KeyboardMode] "/" focuses the item search (its placeholder "Type item — e.g. 4 naan"); "/" in the name field stays text', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    expect(search(m).placeholder).toBe('Type item — e.g. 4 naan');
    const e = press(document.body, '/');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search(m));
    const name = m.container.querySelector<HTMLInputElement>('.cust input[name="customer_name"]')!;
    name.focus();
    expect(press(name, '/').defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(name);
    m.unmount();
  });

  it('[frame KeyboardMode] "4n": the suggestions "4× Naan" (Enter) with the price × 4 and the hint; Enter adds 4 naan and clears the search', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    search(m).focus();
    type(search(m), '4n');
    const rows = sugg(m);
    expect(rows[0]?.textContent).toContain('4×');
    expect(rows[0]?.textContent).toContain('Naan');
    expect(rows[0]?.textContent).toContain('Rs 160');
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
    expect(m.container.querySelector('.tk-sugg .tk-hint')?.textContent).toContain('half karahi');
    press(search(m), 'Enter');
    await flush();
    expect(cartLines(m)).toHaveLength(1);
    expect(cartLines(m)[0]!.textContent).toContain('Naan');
    expect(cartLines(m)[0]!.textContent).toContain('4');
    expect(search(m).value).toBe('');
    expect(sugg(m)).toHaveLength(0);
    m.unmount();
  });

  it('[frame KeyboardMode "hk = half karahi"] initials pick the variant; ↓ moves the choice; Enter adds it without a sheet', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    search(m).focus();
    type(search(m), 'k');
    // "k" starts Karahi in three names: ↓ moves to the second
    expect(sugg(m).length).toBeGreaterThan(1);
    press(search(m), 'ArrowDown');
    expect(sugg(m)[1]!.getAttribute('aria-selected')).toBe('true');
    press(search(m), 'ArrowUp');
    expect(sugg(m)[0]!.getAttribute('aria-selected')).toBe('true');
    type(search(m), 'hk');
    expect(sugg(m)[0]!.textContent).toContain('Chicken Karahi — Half');
    press(search(m), 'Enter');
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(cartLines(m)[0]!.textContent).toContain('Half');
    m.unmount();
  });

  it('typing on the bare screen goes to the search; typing in the phone field goes to the phone, never to the search', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    const e = press(document.body, '4');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search(m));
    expect(search(m).value).toBe('4');
    type(search(m), '');
    const phone = m.container.querySelector<HTMLInputElement>('.cust input[name="phone"]')!;
    phone.focus();
    for (const d of '0300') expect(press(phone, d).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(phone);
    expect(search(m).value).toBe('');
    m.unmount();
  });

  it('Esc leaves the search (cleared); with the token view open, Esc closes it', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    search(m).focus();
    type(search(m), 'naan');
    press(search(m), 'Escape');
    expect(search(m).value).toBe('');
    expect(document.activeElement).not.toBe(search(m));
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    expect(m.container.querySelector('.tk-drawer')).not.toBeNull();
    press(document.body, 'Escape');
    expect(m.container.querySelector('.tk-drawer')).toBeNull();
    m.unmount();
  });

  it('[frame HomeKiosk "Hold F4"] F4 holds the cart: the draft is held, the Takeaway tab gets a fresh cart', async () => {
    const h = screenHarness();
    const m = h.renderHome();
    await flush(6);
    naan(m);
    expect(cartLines(m)).toHaveLength(1);
    expect(m.button('Hold').textContent).toContain('F4');
    press(document.body, 'F4');
    await flush(6);
    expect(cartLines(m)).toHaveLength(0);
    const held = (await h.drafts.list('DV1', 'sana')).filter((d) => d.held);
    expect(held).toHaveLength(1);
    m.unmount();
  });

  it('[frame KeyboardMode "F2 New takeaway"] F2 with an unsent cart asks first (Hold it / Throw away / Stay here); Hold it gives a fresh cart; F2 on an empty cart focuses the search', async () => {
    const h = screenHarness();
    const m = h.renderHome();
    await flush(6);
    press(document.body, 'F2');
    expect(document.activeElement).toBe(search(m));
    (document.activeElement as HTMLElement).blur();
    naan(m);
    press(document.body, 'F2');
    await flush();
    const dlg = document.querySelector('[role="dialog"]');
    expect(dlg?.textContent).toContain('This order isn’t sent');
    m.click(m.button('Hold it'));
    await flush(6);
    expect(cartLines(m)).toHaveLength(0);
    expect((await h.drafts.list('DV1', 'sana')).filter((d) => d.held)).toHaveLength(1);
    // a takeaway opened on its own route: F2 goes to the Takeaway tab (the leave guard asks there)
    m.unmount();
    const h2 = screenHarness();
    const m2 = h2.render();
    await flush();
    press(document.body, 'F2');
    expect(nav.to).toContain('/takeaway');
    m2.unmount();
  });

  it('[frame KeyboardMode] the shortcut hint row on the kiosk (/, 4n Enter, F2 New takeaway, F8 Send & pay, F9 Send · pay later, Esc Back); none on a tablet', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    const hint = m.container.querySelector('.menu > .tk-hint')!;
    expect(hint.textContent).toBe('/ Keys: 4n Enter · F2 New takeaway · F8 Send & pay · F9 Send · pay later · Esc Back');
    expect([...hint.querySelectorAll('.tk-kbd')].map((k) => k.getAttribute('dir'))).toEqual(['ltr', 'ltr', 'ltr', 'ltr', 'ltr', 'ltr', 'ltr']);
    m.unmount();
    const t = screenHarness({ device: 'tablet' }).render();
    await flush();
    expect(t.container.querySelector('.tk-hint')).toBeNull();
    t.unmount();
  });

  it('[02b-TK C3-1] F9 still sends (pay later) with the search in use', async () => {
    const h = screenHarness({ answer: () => ({ status: 'sent', result: { order_id: 'O1', token: 57, groups: [], lines: [] } }) });
    const m = h.render();
    await flush();
    naan(m);
    search(m).focus();
    press(search(m), 'F9');
    await flush(6);
    expect(h.sent.map((s) => s.type)).toContain('SubmitOrder');
    m.unmount();
  });
});
