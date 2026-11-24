import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { currentTakeawayDraft, forgetTakeawayDrafts } from './current-draft';
import { screenHarness } from './screen-harness';

// 02b v1.0.24 §8 (Ordering screen, Held); 02b-TK C2-1; CHANGES §1 "The Takeaway tab is the order screen"; frames
// HomeKiosk, HomeTablet, PhoneMenu / PhoneCart / PhoneQueue: `#/takeaway` opens the order screen in takeaway mode on
// the device's current unsent takeaway draft (one per device and person, never a new id on every visit); after Send or
// Hold the cashier stays on it with a fresh cart.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const tile = (m: Mounted, name: string) => m.container.querySelector<HTMLElement>(`.mi[aria-label="${name}"]`)!;
const pick = (m: Mounted, category: string) => m.click(m.button(category, m.container.querySelector('.cats')!));
const lines = (m: Mounted) => m.container.querySelectorAll('.ln').length;

beforeEach(() => {
  forgetTakeawayDrafts();
  window.history.replaceState(null, '', '#/takeaway');
});
afterEach(() => {
  document.body.innerHTML = '';
  nav.to = [];
  window.history.replaceState(null, '', '#');
});

describe('[02b-TK C2-1] the current takeaway draft of a device', () => {
  it('[02b §8 #35] none stored → one fresh id, the same on every visit; an unsent takeaway draft is resumed; a held one never is', async () => {
    const drafts = createMemoryDraftStore();
    let n = 0;
    const newId = () => `N${++n}`;
    const first = await currentTakeawayDraft(drafts, 'DV1', 'sana', newId);
    expect(await currentTakeawayDraft(drafts, 'DV1', 'sana', newId)).toBe(first);
    expect(n).toBe(1);
    // another person on the same device has their own
    expect(await currentTakeawayDraft(drafts, 'DV1', 'zain', newId)).not.toBe(first);
    forgetTakeawayDrafts();
    // after a reload: the newest unsent takeaway draft of this person
    await drafts.put({ draft_id: 'D7', device_id: 'DV1', staff_id: 'sana', order_type: 'takeaway', cart: { lines: [] }, updated_at: 1, held: false });
    await drafts.put({ draft_id: 'D8', device_id: 'DV1', staff_id: 'sana', order_type: 'takeaway', cart: { lines: [] }, updated_at: 2, held: false });
    await drafts.put({ draft_id: 'P1', device_id: 'DV1', staff_id: 'sana', order_type: 'parking', cart: { lines: [] }, updated_at: 3, held: false });
    await drafts.put({ draft_id: 'H1', device_id: 'DV1', staff_id: 'sana', order_type: 'takeaway', cart: { lines: [] }, updated_at: 4, held: true });
    expect(await currentTakeawayDraft(drafts, 'DV1', 'sana', newId)).toBe('D8');
    // the current one stays current while it is unsent, though another is newer
    await drafts.put({ draft_id: 'D9', device_id: 'DV1', staff_id: 'sana', order_type: 'takeaway', cart: { lines: [] }, updated_at: 5, held: false });
    expect(await currentTakeawayDraft(drafts, 'DV1', 'sana', newId)).toBe('D8');
    // held (Hold, auto-hold at sign out): no longer current
    await drafts.put({ draft_id: 'D8', device_id: 'DV1', staff_id: 'sana', order_type: 'takeaway', cart: { lines: [] }, updated_at: 6, held: true });
    expect(await currentTakeawayDraft(drafts, 'DV1', 'sana', newId)).toBe('D9');
  });
});

describe('[02b-TK C2-1; CHANGES §1] the Takeaway tab is the order screen', () => {
  it('[frame HomeKiosk] kiosk: queue rail | menu | cart in one screen, no open-orders list and no New order button', async () => {
    const h = screenHarness();
    const m = h.renderHome();
    await flush();
    expect(m.container.querySelector('.osc--tk > .tk-q')).not.toBeNull();
    expect(m.container.querySelector('.osc--tk .menu')).not.toBeNull();
    expect(m.text()).toContain('Send & pay');
    expect(m.container.querySelector('.tk-rt .tok')?.textContent).toBe('48');
    expect(m.text()).not.toContain('New order');
    m.unmount();
  });

  it('[frame HomeTablet] tablet: the ready strip above the menu; the whole queue opens as a drawer', async () => {
    const h = screenHarness({ device: 'tablet' });
    const m = h.renderHome();
    await flush();
    expect(m.container.querySelector('.tk-mid > .tk-rstrip')).not.toBeNull();
    expect(m.container.querySelector('.tk-drawer')).toBeNull();
    m.click(m.button('All orders', m.container.querySelector('.tk-rstrip')!));
    expect(m.container.querySelector('.tk-drawer.tk-q')).not.toBeNull();
    m.unmount();
  });

  it('[frames PhoneMenu, PhoneCart, PhoneQueue] phone: Menu / Cart / Queue tabs', async () => {
    const h = screenHarness({ phone: true });
    const m = h.renderHome();
    await flush();
    const tabs = [...m.container.querySelectorAll('.ptabs button')].map((b) => b.textContent);
    expect(tabs).toEqual(['Menu', 'Cart 0', 'Queue']);
    m.click(m.button('Queue', m.container.querySelector('.ptabs')!));
    expect(m.container.querySelector('.tk-q--tab')).not.toBeNull();
    m.unmount();
  });

  it('[02b §8 #35] resumes the unsent takeaway draft of this device; a revisit starts no new draft', async () => {
    const drafts = createMemoryDraftStore();
    const h = screenHarness({ drafts });
    const m = h.renderHome();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    const saved = await drafts.list('DV1', 'sana');
    expect(saved.map((d) => [d.order_type, d.held])).toEqual([['takeaway', false]]);
    // the person goes to another tab by a deep link (no guard, no hold) and comes back: the same draft, its line
    window.history.replaceState(null, '', '#/tables');
    m.unmount();
    window.history.replaceState(null, '', '#/takeaway');
    const again = h.renderHome();
    await flush();
    expect(lines(again)).toBe(1);
    expect((await drafts.list('DV1', 'sana')).map((d) => d.draft_id)).toEqual([saved[0]!.draft_id]);
    again.unmount();
  });

  it('[02b §8 Held] Hold keeps the cashier here with a fresh cart; the held draft is in Held, the next customer gets another draft', async () => {
    const drafts = createMemoryDraftStore();
    const h = screenHarness({ drafts });
    const m = h.renderHome();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    const first = (await drafts.list('DV1', 'sana'))[0]!.draft_id;
    m.click(m.button('Hold'));
    await flush();
    expect(nav.to).toEqual([]);
    expect(lines(m)).toBe(0);
    expect(m.button('Held', m.container.querySelector('.tk-q__foot')!).textContent).toContain('1');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    const all = await drafts.list('DV1', 'sana');
    expect(all.filter((d) => d.held).map((d) => d.draft_id)).toEqual([first]);
    expect(all.filter((d) => !d.held).map((d) => d.draft_id)).toHaveLength(1);
    expect(all.find((d) => !d.held)!.draft_id).not.toBe(first);
    m.unmount();
  });

  it('[02b §6.1; frame SentToast] Send keeps the cashier here with a fresh cart', async () => {
    const h = screenHarness({ answer: () => ({ status: 'sent', result: { order_id: 'O60', token: 60, groups: [] } }) });
    const m = h.renderHome();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    m.click(m.button('Send · pay later'));
    await flush();
    expect(h.sent.map((s) => s.type)).toEqual(['SubmitOrder']);
    expect(nav.to).toEqual([]);
    expect(lines(m)).toBe(0);
    m.unmount();
  });

  it('[02b §8 Held] Hold on a takeaway resumed from Held (#/order/takeaway/<id>) goes to the Takeaway tab, not the open-orders list', async () => {
    window.history.replaceState(null, '', '#/order/takeaway/D1');
    const h = screenHarness();
    const m = h.render('D1');
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    m.click(m.button('Hold'));
    await flush();
    expect(nav.to).toEqual(['/takeaway']);
    m.unmount();
  });
});
