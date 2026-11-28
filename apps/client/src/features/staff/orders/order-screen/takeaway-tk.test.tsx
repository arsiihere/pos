import type { BranchConfig } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../../../api/hub-admin';
import { flush, mount } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createStaffApi } from '../../api';
import type { Enqueue, EnqueueMeta, EnqueueResult, QueueableCommand } from '../../tables/contracts';
import { createEnqueue } from '../queue/enqueue';
import { createMemoryQueueStore } from '../queue/memory-store';
import type { DraftStore, EtaDraft, EtaPreviewBody, SubmitOrderPayload, SubmitResult } from '../contracts';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { createDayWatch } from './day-open';
import { letLeavePass } from './leave-pass';
import { DraftStoreContext, OrderScreen } from './OrderScreen';

// 02b-TK batch C1 (docs/plans/02b-tk-plan.md): the takeaway cart and Send on the order screen.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const HOUR = 3_600_000;
const T = Date.UTC(2025, 9, 20, 15); // 8:00 PM hub time (utc offset 5 h)
const at = (h: number, m: number) => Date.UTC(2025, 9, 20, h - 5, m);

function cfg(): BranchConfig {
  const base = aBranchConfig();
  const plain = (id: string, name: string, o: Record<string, unknown> = {}) => ({ ...base.items.find((i) => i.item_id === 'I2')!, item_id: id, name, category_id: 'C2', ...o });
  return {
    ...base,
    categories: [...base.categories, { category_id: 'C2', name: 'Sides', sort_order: 2, availability_windows: [] }],
    items: [...base.items, plain('I4', 'Raita', { price_minor: 8_000 }), plain('I5', 'Naan', { price_minor: 4_000 })],
  };
}

type Answer = EnqueueResult<SubmitResult | undefined>;
const DAY_CLOSED = { ok: false, error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } } as const;

function harness(o: { answer?: (p: SubmitOrderPayload) => Promise<Answer>; preview?: (d: EtaDraft) => HubResult<EtaPreviewBody>; drafts?: DraftStore; phone?: boolean; online?: boolean; enqueue?: (live: ReturnType<typeof createLiveBus>) => Enqueue } = {}) {
  const live = createLiveBus();
  const config = cfg();
  const sent: Array<{ type: QueueableCommand; payload: SubmitOrderPayload; meta: EnqueueMeta }> = [];
  const previews: EtaDraft[] = [];
  const toasts: Array<{ text: string; sub?: string; tone?: string }> = [];
  const drafts = o.drafts ?? createMemoryDraftStore();
  const enqueue = Object.assign(
    async (type: QueueableCommand, payload: unknown, meta: EnqueueMeta) => {
      sent.push({ type, payload: payload as SubmitOrderPayload, meta });
      return (o.answer ?? (async () => ({ status: 'queued', entry_id: 'Q1' }) as Answer))(payload as SubmitOrderPayload);
    },
    { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} },
  );
  const shell = {
    device: { token: 'tok', id: 'DV1', type: 'cashier_kiosk' },
    live,
    config: { config: () => null, snapshot: () => config, refresh: async () => {}, subscribe: () => () => {}, dispose: () => {} },
    orders: {
      etaPreview: async (d: EtaDraft) => {
        previews.push(d);
        return o.preview?.(d) ?? { ok: false, error: { kind: 'network' } };
      },
      seatingOrders: async () => ({ ok: true, data: { orders: [], total_minor: 0 } }),
    },
    tables: { tableMap: async () => ({ ok: true, data: { as_of_seq: 1, floors: [] } }) },
    toasts: { show: (x: { text: string; sub?: string; tone?: string }) => toasts.push(x) },
    permissions: { allowed: () => false, requiresApproval: () => false, resolution: () => ({ grant: 'not_granted' }), scope: () => null },
    enqueue: o.enqueue?.(live) ?? enqueue,
    clock: { nowMs: () => T, utcOffsetMs: 5 * HOUR },
    me: { staff_id: 'ST1', name: 'Sana' },
    online: o.online ?? true,
    phone: o.phone === true,
    portrait: false,
  } as unknown as Shell;
  const render = (id = 'D1') => {
    const m = mount();
    m.render(
      <ShellContext.Provider value={shell}>
        <DraftStoreContext.Provider value={drafts}>
          <OrderScreen order_type="takeaway" id={id} />
        </DraftStoreContext.Provider>
      </ShellContext.Provider>,
    );
    return m;
  };
  return { live, sent, previews, toasts, drafts, render, shell };
}

const tile = (m: ReturnType<typeof mount>, name: string) => m.container.querySelector<HTMLElement>(`.mi[aria-label="${name}"]`)!;
const pick = (m: ReturnType<typeof mount>, category: string) => m.click(m.button(category, m.container.querySelector('.pills')!));
const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
const dayFrame = (seq: number, event_type: 'BusinessDayOpened' | 'BusinessDayClosed') => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: event_type === 'BusinessDayOpened' ? 2 : 1, payload: event_type === 'BusinessDayOpened' ? { business_date: '2025-10-20', stock_units: {}, draws: {} } : { business_date: '2025-10-20' } } });
const stockPart = (business_day: unknown) => ({ business_day, business_day_started_at: null, items: {} });
const openDay = { business_date: '2025-10-20', opened_at: T - HOUR, closed_at: null, stock_units: {}, draws: {} };

describe('[02b-TK C1-1] day not open from eta-preview and the socket', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §6.14; 02b-TK C1-1] eta-preview 409 BUSINESS_DAY_NOT_OPEN → "Times show after Start day", the day block, no Send', async () => {
    const h = harness({ preview: () => DAY_CLOSED });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(h.previews).toHaveLength(1);
    expect(m.text()).toContain('Times show after Start day');
    expect(m.text()).not.toContain('Times will be set when sent');
    expect(m.text()).toContain("The day hasn't started");
    expect(m.buttons().filter((b) => (b.textContent ?? '').includes('Send') && !(b as HTMLButtonElement).disabled)).toHaveLength(0);
    expect(h.sent).toEqual([]);
    m.unmount();
  });

  it('[02b §6.14] another preview failure keeps "Times will be set when sent" and Send', async () => {
    const h = harness({ preview: () => ({ ok: false, error: { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: {} } }) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(m.text()).toContain('Times will be set when sent');
    expect((m.button('Send to kitchen') as HTMLButtonElement).disabled).toBe(false);
    m.unmount();
  });

  it('[02b §8 Queue; 02b-TK C1-1] catch-up stock with no business day blocks Send before the first item; BusinessDayOpened clears it without a reload', async () => {
    const h = harness();
    h.live.frame({ type: 'catch_up', as_of_seq: 1, state: { stock: stockPart(null) } });
    const m = h.render();
    await flush();
    expect(m.text()).toContain("The day hasn't started");
    expect(m.text()).toContain('Times show after Start day');
    act(() => h.live.frame(dayFrame(2, 'BusinessDayOpened')));
    expect(m.text()).not.toContain("The day hasn't started");
    expect(m.button('Send to kitchen')).toBeTruthy();
    act(() => h.live.frame(dayFrame(3, 'BusinessDayClosed')));
    expect(m.text()).toContain("The day hasn't started");
    // a catch-up after a reconnect with the day open clears it too
    act(() => h.live.frame({ type: 'catch_up', as_of_seq: 4, state: { stock: stockPart(openDay) } }));
    expect(m.text()).not.toContain("The day hasn't started");
    m.unmount();
  });

  it('[02b-TK C1-1] a day_not_open preview is asked again when the day opens', async () => {
    let open = false;
    const ok = (d: EtaDraft): HubResult<EtaPreviewBody> => ({ ok: true, data: { as_of_seq: 1, groups: [{ promise_ms: at(20, 29), keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: at(20, 29), from_stock: false, zone_served: false })) } });
    const h = harness({ preview: (d) => (open ? ok(d) : DAY_CLOSED) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    expect(m.text()).toContain('Times show after Start day');
    open = true;
    act(() => h.live.frame(dayFrame(2, 'BusinessDayOpened')));
    await tick();
    expect(m.text()).not.toContain('Times show after Start day');
    expect(m.text()).toContain('Ready by · Tell the customer');
    m.unmount();
  });

  it('[02b-TK C1-1] the day watch: unknown without a stock part; closed / open from the business day and the frames', () => {
    const live = createLiveBus();
    const w = createDayWatch(live);
    expect(w.state()).toBe('unknown');
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { orders: {} } });
    expect(w.state()).toBe('unknown');
    live.frame({ type: 'catch_up', as_of_seq: 2, state: { stock: stockPart({ ...openDay, closed_at: T }) } });
    expect(w.state()).toBe('closed');
    live.frame(dayFrame(3, 'BusinessDayOpened'));
    expect(w.state()).toBe('open');
    w.dispose();
  });
});

/** React reads a typed value through the native setter and an `input` event. */
const type = (el: Element | null, value: string) => {
  const input = el as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
};
const nameInput = (m: ReturnType<typeof mount>) => m.container.querySelector<HTMLInputElement>('.cust input[name="customer_name"]');
const phoneInput = (m: ReturnType<typeof mount>) => m.container.querySelector<HTMLInputElement>('.cust input[name="phone"]');

describe('[02b-TK C1-2] takeaway name / phone inline in the cart', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §3.1, §6.1; R1; ⚠️ 02b v1.0.25 §3.2 step 2b] both optional: Send with neither sends no contact (only the pay-later slip flag)', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    expect(m.text()).toContain('Name · optional');
    expect(m.text()).toContain('Phone · optional');
    const phone = phoneInput(m)!;
    expect(phone.getAttribute('inputmode')).toBe('tel');
    expect(phone.getAttribute('dir')).toBe('ltr');
    expect(phone.getAttribute('placeholder')).toBe('+92 3xx xxxxxxx');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]!.payload.takeaway).toEqual({ print_slip: true });
    m.unmount();
  });

  it('[02b §3.1, §6.1; 02b-TK C1-2] a typed name and a +92 phone are sent as SubmitOrder.takeaway (digits, as the hub stores them)', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    type(nameInput(m), '  Usman ');
    type(phoneInput(m), '+92 300-1234567');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await tick();
    // the contact is not timing: it never travels in the eta-preview query string
    expect(h.previews.at(-1)!.takeaway).toBeUndefined();
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent[0]!.payload.takeaway).toEqual({ customer_name: 'Usman', phone: '923001234567', print_slip: true });
    expect(h.sent[0]!.meta.label).toBe('Takeaway · Usman');
    m.unmount();
  });

  it('[02b §3.1; R1; frame PhoneInvalid] a typed phone that is not 10–13 digits shows "Enter 10 digits after +92" and Send waits; clearing it lets Send go', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    type(phoneInput(m), '300 12345');
    expect(m.text()).toContain('Enter 10 digits after +92');
    expect(phoneInput(m)!.getAttribute('aria-invalid')).toBe('true');
    expect((m.button('Send to kitchen') as HTMLButtonElement).disabled).toBe(true);
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent).toEqual([]);
    for (const bad of ['0300+1234567', '03OO1234567', '12345678901234']) {
      type(phoneInput(m), bad);
      expect(m.text()).toContain('Enter 10 digits after +92');
    }
    type(phoneInput(m), '');
    expect(m.text()).not.toContain('Enter 10 digits after +92');
    expect((m.button('Send to kitchen') as HTMLButtonElement).disabled).toBe(false);
    m.unmount();
  });

  it('[02b §8 Ordering screen #35] the typed contact is kept in the draft and comes back on reload', async () => {
    const drafts = createMemoryDraftStore();
    const h = harness({ drafts });
    const m = h.render();
    await flush();
    type(nameInput(m), 'Usman');
    type(phoneInput(m), '0300 1234567');
    await flush();
    expect((await drafts.list('DV1', 'ST1'))[0]!.cart).toMatchObject({ takeaway: { customer_name: 'Usman', phone: '0300 1234567' } });
    m.unmount();
    const again = harness({ drafts }).render();
    await flush();
    expect(nameInput(again)!.value).toBe('Usman');
    expect(phoneInput(again)!.value).toBe('0300 1234567');
    again.unmount();
  });

  it('[02b-TK C1-2; frame PhoneCart] phone layout: the contact row sits on the Cart tab', async () => {
    const h = harness({ phone: true });
    const m = h.render();
    await flush();
    expect(phoneInput(m)).toBeNull();
    m.click(m.button('Cart'));
    expect(phoneInput(m)).not.toBeNull();
    type(phoneInput(m), '123');
    expect((m.container.querySelector('.sbar .btn--primary') as HTMLButtonElement).disabled).toBe(true);
    m.unmount();
  });
});

const result = (p: SubmitOrderPayload, o: Partial<SubmitResult> = {}): SubmitResult => ({
  order_id: p.order_id,
  token: 57,
  groups: [
    { group_id: 'G1', promise_ms: at(20, 12), order_item_ids: [] },
    { group_id: 'G2', promise_ms: at(20, 29), order_item_ids: p.lines.map((l) => l.order_item_id) },
  ],
  lines: p.lines.map((l) => ({ order_item_id: l.order_item_id, eta_ms: at(20, 29), from_stock: false, zone_served: false })),
  ...o,
});

describe('[02b-TK C1-3] Send in the background', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    nav.to = [];
  });

  it('[02b §6.1; frame SentToast] no dialog; the cart is fresh at once; the toast names the token, the customer and the ready time', async () => {
    let release: (a: Answer) => void = () => {};
    const h = harness({ answer: () => new Promise((r) => (release = r)) });
    const m = h.render();
    await flush();
    type(nameInput(m), 'Usman');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    // fresh cart at once, before the hub answers; no "Sending…" dialog
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(m.container.querySelectorAll('.ln')).toHaveLength(0);
    expect(nameInput(m)!.value).toBe('');
    expect(h.sent[0]!.payload).toMatchObject({ order_type: 'takeaway', takeaway: { customer_name: 'Usman' }, lines: [{ item_id: 'I5', quantity: 2 }] });
    release({ status: 'sent', result: result(h.sent[0]!.payload) });
    await flush();
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(h.toasts.at(-1)).toMatchObject({ text: '57 · Usman · sent · ready 8:29 PM', tone: 'ok' });
    expect(nav.to).toEqual([]);
    // the next customer: the screen takes the next order at once
    m.click(tile(m, 'Raita'));
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]!.payload.takeaway).toEqual({ print_slip: true });
    expect(h.sent[1]!.payload.order_id).not.toBe(h.sent[0]!.payload.order_id);
    m.unmount();
  });

  it('[02b §3.12 #35] while the first answer is awaited the fresh cart takes no tap (one Send at a time)', async () => {
    let release: (a: Answer) => void = () => {};
    const h = harness({ answer: () => new Promise((r) => (release = r)) });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    m.click(tile(m, 'Raita'));
    expect(m.container.querySelectorAll('.ln')).toHaveLength(0);
    release({ status: 'sent', result: result(h.sent[0]!.payload) });
    await flush();
    m.click(tile(m, 'Raita'));
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.unmount();
  });

  it('[02b §9] a refused Send brings the cart back (lines and customer) with the reason', async () => {
    const h = harness({ answer: async () => ({ status: 'refused', error: { kind: 'api', status: 409, code: 'ITEM_SOLD_OUT', details: { item_id: 'I5' } } }) });
    const m = h.render();
    await flush();
    type(nameInput(m), 'Usman');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush();
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    expect(nameInput(m)!.value).toBe('Usman');
    expect(h.toasts.at(-1)!.text).toContain('Naan');
    m.unmount();
  });

  it('[02b §3.12; frame SentQueued] offline: "Not sent yet — token comes when the hub is back", no dialog, fresh cart; a logged entry says the queue log', async () => {
    for (const [answer, text] of [
      [{ status: 'queued', entry_id: 'Q1' }, 'Not sent yet — token comes when the hub is back'],
      [{ status: 'queued', entry_id: 'Q1', logged: true }, 'Not sent — see the queue log'],
    ] as const) {
      const h = harness({ answer: async () => answer });
      const m = h.render();
      await flush();
      pick(m, 'Sides');
      m.click(tile(m, 'Naan'));
      m.click(m.button('Send to kitchen'));
      await flush();
      expect(m.container.querySelector('.dlg')).toBeNull();
      expect(m.container.querySelectorAll('.ln')).toHaveLength(0);
      expect(h.toasts.at(-1)!.text).toBe(text);
      m.unmount();
    }
  });

  it('[02b §3.12; frame SentQueued] a takeaway waiting in the queue shows as a dashed "Waiting to send" row', async () => {
    const fetch = async (input: string) => {
      if (input === '/auth/pin') return new Response(JSON.stringify({ data: { session_token: 'TOK', session_id: 'S', staff_id: 'ST1', display_name: 'Sana', role_ids: [], idle_ttl_ms: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      throw new TypeError('Failed to fetch');
    };
    const device = { token: 'DEV', id: 'DV1', type: 'cashier_kiosk' } as const;
    const api = createStaffApi({ device, meta: { tenantId: 'ten', branchId: 'br', branchName: 'Lake City', hubNowMs: 0, utcOffsetMs: 0 }, fetch, onSignedOut: () => {} });
    await api.signIn('ST1', '1', false);
    const h = harness({
      enqueue: (live) =>
        createEnqueue({
          api,
          device,
          clock: () => ({ nowMs: () => T, utcOffsetMs: 5 * HOUR }),
          live,
          store: createMemoryQueueStore(),
          onDeviceRevoked: () => {},
          presence: () => ({ ownedElsewhere: async () => new Set<string>(), announceRemoved: () => {}, onRemoved: () => () => {}, dispose: () => {} }),
        }),
    });
    const m = h.render();
    await flush();
    type(nameInput(m), 'Usman');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(m.button('Send to kitchen'));
    await flush(8);
    const row = m.container.querySelector('.tk-qr--q');
    expect(row?.textContent).toContain('Waiting to send');
    expect(row?.textContent).toContain('Usman');
    expect(row?.textContent).toContain('Naan'); // L-CLIENT-6a item 4 (frame SentQueued): what was ordered, not "1 items"
    m.unmount();
  });
});

describe('[02b-TK C1-4] editing a cart line', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('[02b-TK C1-4; frame ItemSheetEdit] Edit opens the sheet with "Save changes"; its Remove takes the line off the cart', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    // 02b-TK A2 item 3 (frame TileStates): Half on the tile adds the line in one tap (no sheet)
    m.click(m.button('Chicken Karahi · Half'));
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.click(m.container.querySelector('.ln__m'));
    m.click(m.button('Edit'));
    // ⚠️ L-CLIENT-6b item 3 (frame ItemSheetEdit): "Save changes · Rs X · Enter", the red trash bottom-left
    expect(m.container.querySelector('.tk-sheet__go')?.textContent).toMatch(/^Save changes·Rs \d/);
    m.click(m.container.querySelector<HTMLButtonElement>('.tk-sheet__f .tk-sheet__trash[aria-label="Remove"]'));
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(m.container.querySelectorAll('.ln')).toHaveLength(0);
    m.unmount();
  });
});

/** A hash change as a tab, Back or the browser makes it (jsdom fires hashchange as a task). */
const goTo = async (path: string) => {
  window.location.hash = path;
  await new Promise((r) => setTimeout(r, 0));
  await flush();
};

describe('[02b-TK C1-5] leave guard and auto-hold', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '#/order/takeaway/D1');
  });
  afterEach(() => {
    document.body.innerHTML = '';
    nav.to = [];
    window.history.replaceState(null, '', '#');
  });

  it('[02b §8 Held; frame LeaveGuard] leaving with an unsent cart asks; Stay here keeps the screen and the cart', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    m.click(tile(m, 'Naan'));
    await goTo('/tables');
    expect(window.location.hash).toBe('#/order/takeaway/D1');
    const dlg = m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('This order isn’t sent');
    expect(dlg.textContent).toContain('2 items · Rs 80. What should happen to it?');
    expect([...dlg.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['Hold it', 'Throw away', 'Stay here']));
    expect(dlg.querySelector('.btn--primary')?.textContent).toBe('Hold it');
    m.click(m.button('Stay here', dlg));
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(nav.to).toEqual([]);
    expect(m.container.querySelectorAll('.ln')).toHaveLength(1);
    m.unmount();
  });

  it('[02b §8 Held] Hold it keeps the draft held for this person and goes on; Throw away drops it and goes on', async () => {
    for (const choice of ['Hold it', 'Throw away'] as const) {
      const drafts = createMemoryDraftStore();
      const h = harness({ drafts });
      const m = h.render();
      await flush();
      pick(m, 'Sides');
      m.click(tile(m, 'Naan'));
      await flush();
      await goTo('/orders');
      m.click(m.button(choice, m.container.querySelector('.dlg')!));
      await flush();
      expect(nav.to).toEqual(['/orders']);
      const left = await drafts.list('DV1', 'ST1');
      if (choice === 'Hold it') expect(left.map((d) => [d.draft_id, d.held])).toEqual([['D1', true]]);
      else expect(left).toEqual([]);
      m.unmount();
      nav.to = [];
      window.history.replaceState(null, '', '#/order/takeaway/D1');
    }
  });

  it('[02b-TK C1-5; 01d #105] a deep link passes the guard and does not hold: its Back returns to the cart as it was', async () => {
    const drafts = createMemoryDraftStore();
    const h = harness({ drafts });
    const m = h.render();
    await flush();
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    letLeavePass('/tables/T4?seating_id=S1');
    await goTo('/tables/T4?seating_id=S1');
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(window.location.hash).toBe('#/tables/T4?seating_id=S1');
    m.unmount();
    await flush();
    expect((await drafts.list('DV1', 'ST1')).map((d) => [d.draft_id, d.held])).toEqual([['D1', false]]);
  });

  it('[02b-TK C1-5] an empty cart, or one whose Send is under way, leaves without asking', async () => {
    const h = harness();
    const m = h.render();
    await flush();
    await goTo('/tables');
    expect(m.container.querySelector('.dlg')).toBeNull();
    expect(window.location.hash).toBe('#/tables');
    m.unmount();
  });

  it('[02b §8 Device idle lock; shell.me.signout_sub] sign out / idle lock (the screen goes with the person) holds the unsent cart; it is in Held, not restored over a new cart', async () => {
    const drafts = createMemoryDraftStore();
    const h = harness({ drafts });
    const m = h.render();
    await flush();
    type(nameInput(m), 'Usman');
    pick(m, 'Sides');
    m.click(tile(m, 'Naan'));
    await flush();
    m.unmount();
    await flush();
    const held = await drafts.list('DV1', 'ST1');
    expect(held.map((d) => [d.draft_id, d.held])).toEqual([['D1', true]]);
    expect(held[0]!.cart).toMatchObject({ takeaway: { customer_name: 'Usman' }, lines: [{ item_id: 'I5', quantity: 1 }] });
    // signed in again on the same route: a fresh cart, and the held one stays held
    const again = harness({ drafts }).render();
    await flush();
    expect(again.container.querySelectorAll('.ln')).toHaveLength(0);
    pick(again, 'Sides');
    again.click(tile(again, 'Raita'));
    await flush();
    const both = await drafts.list('DV1', 'ST1');
    expect(both.filter((d) => d.held).map((d) => d.draft_id)).toEqual(['D1']);
    expect(both.filter((d) => !d.held)).toHaveLength(1);
    expect(both.find((d) => !d.held)!.draft_id).not.toBe('D1');
    again.unmount();
  });
});
