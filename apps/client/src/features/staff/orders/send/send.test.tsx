import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import type { EnqueueMeta, EnqueueResult, QueueableCommand, TableMapBody } from '../../tables/contracts';
import type { Draft, DraftStore, EtaDraft, EtaPreviewBody, SubmitOrderPayload, SubmitResult } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { DraftStoreContext, OrderScreen } from '../order-screen/OrderScreen';
import { onCompItSent, startCompItCart, toCart } from './send';

const lockState = vi.hoisted(() => ({ canSend: true }));
vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: lockState.canSend, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));

const HOUR = 3_600_000;
const T = Date.UTC(2025, 9, 20, 15); // 8:00 PM hub time (utc offset 5 h)
const at = (h: number, m: number) => Date.UTC(2025, 9, 20, h - 5, m);

function cfg(): BranchConfig {
  const base = aBranchConfig();
  const plain = (id: string, name: string, o: Record<string, unknown> = {}) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, category_id: 'C2', ...o });
  return {
    ...base,
    categories: [...base.categories, { category_id: 'C2', name: 'Sides', sort_order: 2, availability_windows: [] }],
    items: [...base.items, plain('I4', 'Raita', { price_minor: 8_000 }), plain('I5', 'Naan', { price_minor: 4_000 }), plain('I6', 'Karahi', { price_minor: 220_000 })],
  };
}

const MAP: TableMapBody = {
  as_of_seq: 1,
  floors: [
    {
      floor_id: 'F1',
      name: 'Ground',
      archived: false,
      zones: [
        {
          zone_id: 'Z1',
          name: 'Family hall',
          tables: [
            { table_id: 'TB4', name: 'F4', seats: 4, archived: false, state: 'ORDERED', seating_id: 'SE1', party_size: 4, primary_table_id: null, joined_table_names: [], holder: null, assignee: null, lock: null, opened_at: T - HOUR, bill_requested_at: null, live_order_count: 1 },
          ],
        },
      ],
    },
  ],
};

type Answer = EnqueueResult<SubmitResult | undefined>;
interface Sent {
  type: QueueableCommand;
  payload: SubmitOrderPayload;
  meta: EnqueueMeta;
  /** the cart's lines the moment the queue was handed the payload */
  frozenAtEnqueue: boolean;
}

function harness(o: { answer: (p: SubmitOrderPayload) => Promise<Answer>; preview?: (d: EtaDraft) => EtaPreviewBody | null; drafts?: DraftStore; map?: TableMapBody }) {
  const live = createLiveBus();
  const config = cfg();
  const sent: Sent[] = [];
  const mapReads = { n: 0 };
  const previews = { n: 0 };
  const toasts: string[] = [];
  const drafts = o.drafts ?? createMemoryDraftStore();
  const enqueue = Object.assign(
    async (type: QueueableCommand, payload: unknown, meta: EnqueueMeta) => {
      sent.push({ type, payload: payload as SubmitOrderPayload, meta, frozenAtEnqueue: Object.isFrozen(payload) && Object.isFrozen((payload as SubmitOrderPayload).lines[0]) });
      return o.answer(payload as SubmitOrderPayload);
    },
    { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} },
  );
  const shell = {
    device: { token: 'tok', id: 'DV1', type: 'tablet' },
    live,
    config: { config: () => null, snapshot: () => config, refresh: async () => {}, subscribe: () => () => {}, dispose: () => {} },
    orders: {
      etaPreview: async (d: EtaDraft) => {
        previews.n += 1;
        const b = o.preview?.(d) ?? null;
        return b === null ? { ok: false, error: { kind: 'network' } } : { ok: true, data: b };
      },
      seatingOrders: async () => ({ ok: true, data: { orders: [{}], total_minor: 0 } }),
    },
    tables: {
      tableMap: async () => {
        mapReads.n += 1;
        return { ok: true, data: o.map ?? MAP };
      },
    },
    toasts: { show: (x: { text: string }) => toasts.push(x.text) },
    permissions: { allowed: () => false, requiresApproval: () => false, resolution: () => ({ grant: 'not_granted' }), scope: () => null },
    enqueue,
    clock: { nowMs: () => T, utcOffsetMs: 5 * HOUR },
    me: { staff_id: 'ST1', name: 'Ali' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  const render = (order_type: 'dine_in' | 'takeaway' | 'parking' = 'dine_in', id = 'SE1') => {
    const m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <DraftStoreContext.Provider value={drafts}>
          <OrderScreen order_type={order_type} id={id} />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    return m;
  };
  return { live, sent, toasts, drafts, render, config, mapReads, previews };
}

const tile = (m: ReturnType<typeof mount>, name: string) => m.container.querySelector<HTMLElement>(`.mi[aria-label="${name}"]`)!;
const pick = (m: ReturnType<typeof mount>, category: string) => m.click(m.button(category, m.container.querySelector('.cats')!));
const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
const result = (p: SubmitOrderPayload, o: Partial<SubmitResult> = {}): SubmitResult => ({
  order_id: p.order_id,
  token: null,
  groups: [{ group_id: 'G1', promise_ms: at(20, 29), order_item_ids: p.lines.map((l) => l.order_item_id) }],
  lines: p.lines.map((l) => ({ order_item_id: l.order_item_id, eta_ms: at(20, 20), from_stock: false, zone_served: false })),
  ...o,
});

describe('[02b §8 Ordering screen] Send', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('[02b §8 Ordering screen] Send freezes the cart, enqueues first, then submits', async () => {
    let release: (a: Answer) => void = () => {};
    const h = harness({ answer: () => new Promise((r) => (release = r)) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({ type: 'SubmitOrder', meta: { table_id: 'TB4', seating_id: 'SE1' }, frozenAtEnqueue: true });
    expect(h.sent[0]!.payload).toMatchObject({ order_type: 'dine_in', table_id: 'TB4', seating_id: 'SE1', lines: [{ item_id: 'I5', quantity: 1 }] });
    // while it is sent the cart takes no change
    m.click(tile(m, 'Naan'));
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('1×');
    expect(() => ((h.sent[0]!.payload.lines as unknown as Array<{ quantity: number }>)[0]!.quantity = 9)).toThrow();
    release({ status: 'sent', result: result(h.sent[0]!.payload) });
    await flush();
    m.unmount();
  });

  it('[02b §8 Ordering screen; task 28 e2e] the table name: the hub\'s joined_table_names hold the seating\'s tables, itself included ("F4", never "F4 + F4")', async () => {
    const withTables = (names: string[]): TableMapBody => {
      const tile = MAP.floors[0]!.zones[0]!.tables[0]!;
      return { ...MAP, floors: [{ ...MAP.floors[0]!, zones: [{ ...MAP.floors[0]!.zones[0]!, tables: [{ ...tile, joined_table_names: names }] }] }] };
    };
    for (const [names, shown] of [
      [['F4'], 'F4'],
      [['F4', 'F5'], 'F4 + F5'],
    ] as const) {
      const h = harness({ answer: async (p) => ({ status: 'sent', result: result(p) }), map: withTables([...names]) });
      const m = h.render();
      await flush();
      pick(m, 'Sides');
      m.click(tile(m, 'Naan'));
      m.click(m.button('Send to kitchen'));
      await flush();
      expect(h.sent[0]!.meta.label).toBe(`Order · ${shown}`);
      expect(m.container.querySelector('.dlg .tcode')?.textContent).toBe(shown);
      m.unmount();
    }
  });

  it('[02b #35] Sending until the 2xx; never "Sent" before it', async () => {
    let release: (a: Answer) => void = () => {};
    const h = harness({ answer: () => new Promise((r) => (release = r)) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    await tick(10_000);
    expect(m.text()).toContain('Sending to the kitchen…');
    expect(m.container.querySelector('#send-t')?.textContent).not.toBe('Sent');
    release({ status: 'sent', result: result(h.sent[0]!.payload) });
    await flush();
    expect(m.container.querySelector('#send-t')?.textContent).toBe('Sent');
    expect(m.text()).not.toContain('Sending to the kitchen…');
    m.unmount();
  });

  it('[02b §8 Ordering screen] Sent: final times and "Time updated: Karahi 8:29 PM"', async () => {
    const h = harness({
      preview: (d) => ({ as_of_seq: 1, groups: [{ promise_ms: at(20, 27), keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: at(20, 27), from_stock: false, zone_served: false })) }),
      answer: async (p) => ({ status: 'sent', result: result(p, { lines: p.lines.map((l) => ({ order_item_id: l.order_item_id, eta_ms: l.item_id === 'I6' ? at(20, 29) : at(20, 27), from_stock: false, zone_served: false })) }) }),
    });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(tile(m, 'Karahi'));
    await tick();
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(m.text()).toContain('Time updated: Karahi 8:29 PM');
    expect([...m.container.querySelectorAll('.sl')].map((l) => l.textContent)).toEqual(['1×Naan8:27 PM', '1×Karahi8:29 PM']);
    expect(m.container.querySelector('.sl.hl b')?.textContent).toBe('Karahi');
    // the cart is empty after Send, and its draft is gone
    m.click(m.button('Done'));
    expect(await h.drafts.list('DV1', 'ST1')).toEqual([]);
    m.unmount();
  });

  it('[02b #36] zone-empty flip: from_zone line with zone_served false → "Zone empty — Raita sent to the kitchen", once', async () => {
    const h = harness({ answer: async (p) => ({ status: 'sent', result: result(p) }) });
    h.live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: { orders: [], zone_stock: [{ zone_id: 'Z1', name: 'Counter', items: [{ item_id: 'I4', name: 'Raita', on_hand: 6, threshold: 2 }] }] } } });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Raita'));
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent[0]!.payload.lines[0]).toMatchObject({ item_id: 'I4', from_zone: true });
    const msgs = [...m.container.querySelectorAll('.dlg .msg')].map((x) => x.textContent);
    expect(msgs).toEqual(['Zone empty — Raita sent to the kitchen']);
    m.click(m.button('Done'));
    expect(m.text()).not.toContain('Zone empty');
    m.unmount();
  });

  it('[02b §8 Queue] offline Send → SentQueued "Not sent yet", token after sending', async () => {
    const h = harness({ answer: async () => ({ status: 'queued', entry_id: 'Q1' }) });
    const m = h.render('takeaway', 'D1');
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(m.text()).toContain('Not sent yet');
    expect(m.text()).toContain('It will send when the hub is back. Token after sending.');
    expect(m.container.querySelector('.token')).toBeNull();
    m.unmount();
  });

  it('[02b §3.12; IR-12] Send that went straight to the queue log (session ended) → "Not sent — see the queue log", not "when the hub is back"', async () => {
    const h = harness({ answer: async () => ({ status: 'queued', entry_id: 'Q1', logged: true }) });
    const m = h.render('takeaway', 'D1');
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(m.text()).toContain('Not sent — see the queue log');
    expect(m.text()).not.toContain('when the hub is back');
    m.unmount();
  });

  it('[02b §8 Ordering screen] 409 own pending ORDER_ITEM_ID_IN_USE → shown as Sent', async () => {
    // the queue (25b) answers `sent` with no result for the device's own pending SubmitOrder the hub already had
    const h = harness({ answer: async () => ({ status: 'sent', result: undefined }) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(m.container.querySelector('#send-t')?.textContent).toBe('Sent');
    expect(h.toasts).toEqual([]);
    m.unmount();
  });

  it('[02b §8 Types] takeaway: the big token after Send; parking: the plate', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put({ draft_id: 'D1', device_id: 'DV1', staff_id: 'ST1', order_type: 'takeaway', cart: { lines: [], takeaway: { customer_name: 'Usman', phone: '03001234567' } }, updated_at: T, held: false });
    const h = harness({ drafts, answer: async (p) => ({ status: 'sent', result: result(p, { token: 57 }) }) });
    const m = h.render('takeaway', 'D1');
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent[0]!.payload).toMatchObject({ order_type: 'takeaway', takeaway: { customer_name: 'Usman', phone: '03001234567' } });
    expect(m.container.querySelector('.token b')?.textContent).toBe('57');
    expect(m.container.querySelector('.token')?.textContent).toContain('Takeaway · Usman · ready by 8:29 PM');
    expect(m.button('New takeaway')).toBeTruthy();
    m.unmount();
  });

  it('[02b §8 Table view E-7] CompItCart: item (options by name, Q-7) as a new round, badge "Sent again · asks to comp"', async () => {
    const h = harness({ answer: async (p) => ({ status: 'sent', result: result(p) }) });
    let n = 0;
    await startCompItCart({ drafts: h.drafts, config: h.config, device_id: 'DV1', staff_id: 'ST1', table_id: 'TB4', seating_id: 'SE1', item_id: 'I6', options: [], newKey: () => `CK${++n}`, nowMs: T });
    const heard: unknown[] = [];
    const off = onCompItSent((x) => heard.push(x));
    const m = h.render();
    await flush();
    expect(m.container.querySelector('.ln')?.textContent).toContain('Sent again · asks to comp');
    expect(m.text()).toContain('Karahi is in a new round for F4. After Send you’ll be asked to comp it.');
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(heard).toEqual([{ order_id: h.sent[0]!.payload.order_id, order_item_id: 'CK1', item_id: 'I6', seating_id: 'SE1' }]);
    off();
    m.unmount();
  });

  it('[02b IR-7, IR-8] a queue-log copy ({ copy_of, from_entry_id }) opens as a cart with fresh ids; from_entry_id is kept', async () => {
    const copy_of: SubmitOrderPayload = {
      order_id: 'OLD',
      order_type: 'takeaway',
      takeaway: { customer_name: 'Usman' },
      order_note: 'no ice',
      lines: [
        { order_item_id: 'L1', item_id: 'I5', quantity: 6, kitchen_note: 'crisp' },
        { order_item_id: 'L2', item_id: 'I2', options: [{ option_id: 'O1', quantity: 2, order_item_id: 'L2c' }] },
        { order_item_id: 'L3', deal_id: 'D1', quantity: 2, deal_choices: [{ deal_part_id: 'P1', item_id: 'I1', order_item_id: 'L3a' }] },
      ],
    };
    let n = 0;
    const cart = toCart({ copy_of, from_entry_id: 'Q9' }, () => `N${++n}`)!;
    expect(cart).toEqual({
      lines: [
        { key: 'N1', item_id: 'I5', quantity: 6, options: [], kitchen_note: 'crisp' },
        { key: 'N2', item_id: 'I2', quantity: null, options: [{ option_id: 'O1', quantity: 2, order_item_id: 'N3' }] },
        { key: 'N4', deal_id: 'D1', quantity: 2, options: [], deal_choices: [{ deal_part_id: 'P1', item_id: 'I1', order_item_id: 'N5' }] },
      ],
      order_note: 'no ice',
      takeaway: { customer_name: 'Usman' },
      from_entry_id: 'Q9',
    });
    // on the screen: the copy shows (no "back" banner) and the saved draft keeps from_entry_id
    const drafts = createMemoryDraftStore();
    const draft: Draft = { draft_id: 'C1', device_id: 'DV1', staff_id: 'ST1', order_type: 'takeaway', cart: { copy_of: { ...copy_of, lines: [copy_of.lines[0]!] }, from_entry_id: 'Q9' }, updated_at: T, held: false };
    await drafts.put(draft);
    const h = harness({ drafts, answer: async (p) => ({ status: 'sent', result: result(p) }) });
    const m = h.render('takeaway', 'C1');
    await flush();
    expect(m.container.querySelector('.ln')?.textContent).toContain('Naan');
    expect(m.text()).not.toContain('Your unsent order is back');
    const saved = (await drafts.list('DV1', 'ST1'))[0]!;
    expect(saved.cart).toMatchObject({ from_entry_id: 'Q9', lines: [{ item_id: 'I5', quantity: 6 }] });
    expect((saved.cart as { lines: Array<{ key: string }> }).lines[0]!.key).not.toBe('L1');
    m.unmount();
  });

  it('[02b §8 Table view E-7] a queued comp-it round is announced with queued: true (27a2 waits for its ItemAdded)', async () => {
    const h = harness({ answer: async () => ({ status: 'queued', entry_id: 'Q1' }) });
    let n = 0;
    await startCompItCart({ drafts: h.drafts, config: h.config, device_id: 'DV1', staff_id: 'ST1', table_id: 'TB4', seating_id: 'SE1', item_id: 'I6', options: [], newKey: () => `QK${++n}`, nowMs: T });
    const heard: unknown[] = [];
    const off = onCompItSent((x) => heard.push(x));
    const m = h.render();
    await flush();
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(m.text()).toContain('Not sent yet');
    expect(heard).toEqual([{ order_id: h.sent[0]!.payload.order_id, order_item_id: 'QK1', item_id: 'I6', seating_id: 'SE1', queued: true }]);
    off();
    m.unmount();
  });

  // --- #174 fix round 1 ------------------------------------------------------------------------------------------

  it('[02b #35] two taps on Send before React updates → exactly one SubmitOrder; while it is sent the cart takes no edit', async () => {
    let release: (a: Answer) => void = () => {};
    const h = harness({ answer: () => new Promise((r) => (release = r)) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    // the line is open (stepper and Edit showing) before Send
    m.click(m.container.querySelector<HTMLElement>('.ln .ln__m'));
    const more = m.container.querySelector<HTMLElement>('.ln__ctrl [aria-label="One more"]')!;
    const edit = m.button('Edit', m.container.querySelector('.ln__ctrl')!);
    const send = m.button('Send to kitchen');
    const raita = tile(m, 'Raita');
    act(() => {
      send.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      send.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      // a same-tick stepper and Edit do nothing either
      more.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      edit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      raita.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.payload.lines[0]!.quantity).toBe(1);
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('1×');
    expect(m.container.querySelector('#opt-t')).toBeNull();
    // the stepper, Edit, Order note and Hold do nothing while it is sent
    m.click(more);
    m.click(edit);
    expect(m.container.querySelector('.ln__q')?.textContent).toBe('1×');
    expect(m.container.querySelector('#opt-t')).toBeNull();
    // a tile tap is refused too
    m.click(tile(m, 'Raita'));
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.click(m.button('Hold'));
    m.click(m.button('Order note'));
    expect(m.container.querySelector('#note-t')).toBeNull();
    expect(await h.drafts.list('DV1', 'ST1')).toMatchObject([{ held: false }]);
    release({ status: 'sent', result: result(h.sent[0]!.payload) });
    await flush();
    m.unmount();
  });

  it('[02a §9, plan Global constraints] Send refused with TABLE_SEATING_CHANGED → "This table changed — refreshed" + one more table-map read; the cart is kept', async () => {
    const h = harness({ answer: async () => ({ status: 'refused', error: { kind: 'api', status: 409, code: 'TABLE_SEATING_CHANGED', details: {} } }) });
    const m = h.render();
    await flush();
    const reads = h.mapReads.n;
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.toasts).toEqual(['This table changed — refreshed']);
    expect(h.mapReads.n).toBe(reads + 1);
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.unmount();
  });

  it('[02b §9] other refusals say why (the queue log words), keep the cart; no session → sign in; a throwing queue → no stuck Sending', async () => {
    const answers: Answer[] = [
      { status: 'refused', error: { kind: 'api', status: 409, code: 'ITEM_SOLD_OUT', details: { item_id: 'I5', available: 0 } } },
      { status: 'refused', error: { kind: 'api', status: 409, code: 'STATION_PAUSED', details: {} } },
      { status: 'refused', error: { kind: 'api', status: 409, code: 'SOMETHING_NEW', details: {} } },
      { status: 'needs_hub' },
    ];
    let k = 0;
    const h = harness({ answer: async () => answers[k++]! });
    const m = h.render('takeaway', 'D1');
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    for (let i = 0; i < answers.length; i += 1) {
      const before = h.previews.n;
      m.click(m.button('Send to kitchen'));
      await flush();
      await tick();
      // a refusal runs the preview again, so a line problem shows (B05 / B07)
      if (i < 3) expect(h.previews.n, `preview after refusal ${i}`).toBe(before + 1);
    }
    expect(h.toasts).toEqual(['Not sent — Naan sold out', 'Not sent — a kitchen station is paused', 'Not sent — the hub refused it', 'Not sent — sign in again, then send']);
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.unmount();
    const t2 = harness({ answer: () => Promise.reject(new Error('boom')) });
    const m2 = t2.render('takeaway', 'D2');
    await flush();
    pick(m2, 'Sides');
    m2.click(tile(m2, 'Naan'));
    m2.click(m2.button('Send to kitchen'));
    await flush();
    expect(m2.text()).not.toContain('Sending to the kitchen…');
    expect(t2.toasts).toEqual(['Not sent — try again']);
    expect(m2.container.querySelectorAll('.ln')).toHaveLength(1);
    m2.unmount();
  });

  it('[02b §8 Table view E-7, Q-7] comp-it without stored options ticks nothing (no priced default) and opens the options sheet', async () => {
    const h = harness({ answer: async (p) => ({ status: 'sent', result: result(p) }) });
    // Karahi now has a priced default option (Extra masala Rs 50)
    const priced: BranchConfig = {
      ...h.config,
      modifier_groups: [{ modifier_group_id: 'G9', name: 'Extras', min_choices: 0, max_choices: 2, sort_order: 1, has_plain_options: true, options: [{ option_id: 'X1', name: 'Extra masala', price_minor: 5_000, max_quantity: 1, is_default: true, linked_item_id: null, sort_order: 1 }] }],
      items: h.config.items.map((i) => (i.item_id === 'I6' ? { ...i, modifier_group_ids: ['G9'] } : i)),
    };
    Object.assign(h.config, priced);
    let n = 0;
    await startCompItCart({ drafts: h.drafts, config: h.config, device_id: 'DV1', staff_id: 'ST1', table_id: 'TB4', seating_id: 'SE1', item_id: 'I6', newKey: () => `PK${++n}`, nowMs: T });
    const stored = (await h.drafts.list('DV1', 'ST1'))[0]!.cart as { lines: Array<{ options: unknown[]; pick_options?: boolean }> };
    expect(stored.lines[0]).toMatchObject({ options: [], pick_options: true });
    const m = h.render();
    await flush();
    expect(m.container.querySelector('#opt-t')?.textContent).toBe('Karahi');
    // the sheet comes up with nothing ticked (the priced default is not chosen for the guest); Add keeps the mark
    expect(m.button('Extra masala').getAttribute('aria-pressed')).toBe('false');
    m.click(m.button('Add to order'));
    expect(m.container.querySelector('.ln')?.textContent).toContain('Sent again · asks to comp');
    expect(m.container.querySelector('.ln__p')?.textContent).toBe('Rs 2,200'); // no +Rs 50
    m.unmount();
  });

  it('[02b §8 Types] parking: the plate (LTR), "Sedan · ready by", New parking', async () => {
    const drafts = createMemoryDraftStore();
    await drafts.put({ draft_id: 'P1', device_id: 'DV1', staff_id: 'ST1', order_type: 'parking', cart: { lines: [], parking: { car_number: 'LEB 1234', car_type: 'sedan' } }, updated_at: T, held: false });
    const h = harness({ drafts, answer: async (p) => ({ status: 'sent', result: result(p) }) });
    const m = h.render('parking', 'P1');
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent[0]!.payload).toMatchObject({ order_type: 'parking', parking: { car_number: 'LEB 1234', car_type: 'sedan' } });
    const plate = m.container.querySelector('.token .plate')!;
    expect(plate.textContent).toBe('LEB 1234');
    expect(plate.getAttribute('dir')).toBe('ltr');
    expect(m.container.querySelector('.token')?.textContent).toContain('Sedan · ready by 8:29 PM');
    expect(m.button('New parking')).toBeTruthy();
    m.unmount();
  });

  it('[02b #36] day not started: a BusinessDayOpened frame or a reconnect catch-up lets Send work again', async () => {
    const closed: Answer = { status: 'refused', error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } };
    for (const reopen of ['frame', 'catch_up'] as const) {
      let k = 0;
      const h = harness({ answer: async (p) => (k++ === 0 ? closed : { status: 'sent', result: result(p) }) });
      const m = h.render();
      await flush();
      pick(m, 'Sides');
      m.click(tile(m, 'Naan'));
      m.click(m.button('Send to kitchen'));
      await flush();
      expect(m.text()).toContain("The day hasn't started");
      act(() =>
        reopen === 'frame'
          ? h.live.frame({ type: 'event', seq: 50, event: { event_id: 'E50', event_type: 'BusinessDayOpened', schema_version: 2, payload: {} } })
          : h.live.frame({ type: 'catch_up', as_of_seq: 60, state: {} }),
      );
      m.click(m.button('Send to kitchen'));
      await flush();
      expect(m.container.querySelector('#send-t')?.textContent).toBe('Sent');
      m.unmount();
    }
  });

  it('[02b IR-7] a copied deal keeps the options of its parts, with fresh ids', () => {
    let n = 0;
    const cart = toCart(
      { copy_of: { order_id: 'O', order_type: 'takeaway', lines: [{ order_item_id: 'L', deal_id: 'D1', quantity: 2, deal_choices: [{ deal_part_id: 'P1', item_id: 'I3', order_item_id: 'LP', options: [{ option_id: 'S1', quantity: 2 }] }] }] } },
      () => `F${++n}`,
    )!;
    expect(cart.lines[0]!.deal_choices).toEqual([{ deal_part_id: 'P1', item_id: 'I3', order_item_id: 'F2', options: [{ option_id: 'S1', quantity: 2 }] }]);
  });

  it('[02a §8 Order screen] a lock that does not let this person send: Send is off and nothing is enqueued', async () => {
    lockState.canSend = false;
    try {
      const h = harness({ answer: async (p) => ({ status: 'sent', result: result(p) }) });
      const m = h.render();
      await flush();
      pick(m, 'Sides');
      m.click(tile(m, 'Naan'));
      const send = m.button('Send to kitchen');
      expect(send.hasAttribute('disabled')).toBe(true);
      // the handler checks the lock itself: React drops clicks on a disabled button, so call its onClick directly
      const propsKey = Object.keys(send).find((k) => k.startsWith('__reactProps'))!;
      const onClick = (send as unknown as Record<string, { onClick: () => void }>)[propsKey]!.onClick;
      act(() => onClick());
      await flush();
      expect(h.sent).toHaveLength(0);
      m.unmount();
    } finally {
      lockState.canSend = true;
    }
  });
});
