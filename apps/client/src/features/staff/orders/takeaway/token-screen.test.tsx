import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { UNDO_MS } from './handover';
import { screenHarness, sl, view } from './screen-harness';
import { aRow, at } from './test-fixtures';

// 02b-TK C2 on the takeaway order screen: the rail opens the token view over the kept cart; hand-overs wait for Undo.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};

describe('[02b-TK C2-2] token view on the takeaway screen', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §8; frames TokenReady, HandoverUndo] the rail opens the drawer; Hand over all shows "48 handed over · Undo" and sends MarkServed after 5 s', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    expect(m.container.querySelector('.tk-drawer')?.textContent).toContain('Ali');
    m.click(m.button('Hand over all'));
    expect(m.container.querySelector('.tk-drawer')).toBeNull();
    expect(m.container.querySelector('.tk-toast')?.textContent).toContain('48 handed over');
    // the token leaves the rail while it can still be undone
    expect(m.container.querySelector('.tk-rt')).toBeNull();
    expect(h.sent).toEqual([]);
    await tick(UNDO_MS);
    expect(h.sent).toEqual([{ type: 'MarkServed', payload: { lines: [{ order_id: 'O48', order_item_ids: ['A'] }] }, meta: { label: 'Mark served · 48' } }]);
    expect(m.container.querySelector('.tk-toast')).toBeNull();
    m.unmount();
  });

  it('[02b §6.4 no undo command] Undo inside 5 s: nothing is sent, the token is back', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    // the paid ready tile hands over in one tap (frame ReadyTiles)
    act(() => h.live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'OrdersBilled', schema_version: 1, payload: { order_ids: ['O48'], bill_id: 'B48' } } }));
    m.click(m.button('Hand over', m.container.querySelector('.tk-rt')!));
    await flush();
    expect(m.container.querySelector('.tk-toast')?.textContent).toContain('48 handed over');
    m.click(m.button('Undo'));
    await tick(UNDO_MS * 2);
    expect(h.sent).toEqual([]);
    expect(m.container.querySelector('.tk-rt')).not.toBeNull();
    m.unmount();
  });

  it('[02b-TK C2-2] leaving the screen sends a waiting hand-over at once', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-rt__open'));
    await flush();
    m.click(m.button('Hand over all'));
    m.unmount();
    expect(h.sent.map((s) => s.type)).toEqual(['MarkServed']);
  });
});

const addNaan = (m: Mounted) => {
  m.click(m.button('Sides', m.container.querySelector('.cats')!));
  m.click(m.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};
const openRow = async (m: Mounted) => {
  m.click(m.container.querySelector('.tk-rt__open'));
  await flush();
};
const SUBMITTED = { status: 'sent', result: { order_id: 'X', token: 48, groups: [{ group_id: 'X:0', promise_ms: at(13, 33), order_item_ids: [] }], lines: [] } };

describe('[02b-TK C2-3] add items to a sent token', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §3.2 step 2; 05 #44a; frame TokenAddItems] "Adding to token 48", primary "Add to token 48"; SubmitOrder names the root', async () => {
    const h = screenHarness({ rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } }), aRow({ order_id: 'O48b', token: 48, placed_at: at(13, 5), ready: { n: 0, m: 1 } })], views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]), O48b: view('O48b', [sl('O48b', 'B', 'Naan', 'cooking')]) }, answer: (type) => (type === 'SubmitOrder' ? SUBMITTED : undefined) });
    const m = h.render();
    await flush();
    m.click(m.container.querySelector('.tk-qr'));
    await flush();
    m.click(m.button('Add items'));
    expect(m.container.querySelector('.tk-drawer')).toBeNull();
    expect(m.container.querySelector('.tk-banner')?.textContent).toContain('Adding to token 48');
    addNaan(m);
    m.click(m.button('Add to token 48'));
    await flush(8);
    const submit = h.sent.find((s) => s.type === 'SubmitOrder')!;
    expect(submit.payload).toMatchObject({ order_type: 'takeaway', adds_to_order_id: 'O48' });
    expect(m.container.querySelector('.tk-banner')).toBeNull();
    expect(m.text()).not.toContain('Add to token');
    m.unmount();
  });

  it('[02b-TK C2-3] Cancel on the banner makes it a new order again', async () => {
    const h = screenHarness({ answer: (type) => (type === 'SubmitOrder' ? SUBMITTED : undefined) });
    const m = h.render();
    await flush();
    await openRow(m);
    m.click(m.button('Add items'));
    m.click(m.button('Cancel', m.container.querySelector('.tk-banner')!));
    addNaan(m);
    // 02b-TK C3-1: a take-payment holder's takeaway cart sends with "Send · pay later" (or "Send & pay")
    m.click(m.button('Send · pay later'));
    await flush(8);
    expect(h.sent.find((s) => s.type === 'SubmitOrder')!.payload).not.toHaveProperty('adds_to_order_id');
    m.unmount();
  });

  it('[02b-TK C2-3] a cart with lines is another customer\'s: Add items asks to send or hold it first', async () => {
    const h = screenHarness();
    const m = h.render();
    await flush();
    addNaan(m);
    await openRow(m);
    m.click(m.button('Add items'));
    expect(h.toasts.at(-1)!.text).toBe('Send or hold this cart first, then add to the token');
    expect(m.container.querySelector('.tk-banner')).toBeNull();
    m.unmount();
  });

  it('[02b §3.2 step 2] 422 CONFIG_REFERENCE_INVALID { field: adds_to_order_id } / 404 ORDER_NOT_FOUND → the cart comes back with the reason', async () => {
    for (const error of [
      { kind: 'api', status: 422, code: 'CONFIG_REFERENCE_INVALID', details: { field: 'adds_to_order_id' } },
      { kind: 'api', status: 404, code: 'ORDER_NOT_FOUND', details: {} },
    ]) {
      const h = screenHarness({ answer: (type) => (type === 'SubmitOrder' ? { status: 'refused', error } : undefined) });
      const m = h.render();
      await flush();
      await openRow(m);
      m.click(m.button('Add items'));
      addNaan(m);
      m.click(m.button('Add to token 48'));
      await flush(8);
      expect(h.toasts.at(-1)!.text).toBe('This token can’t take more items (closed, cancelled or another day) — send them as a new order');
      expect(m.container.querySelector('.tk-banner')?.textContent).toContain('Adding to token 48');
      expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
      m.unmount();
    }
  });
});
