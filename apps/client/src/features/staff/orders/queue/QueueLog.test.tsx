import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { createStaffApi, type Device, type PageMeta } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createToastBus } from '../../shell/toast';
import type { Draft, QueueEntry, SubmitOrderPayload } from '../contracts';
import { createMemoryDraftStore, type MemoryDraftBacking } from '../drafts/memory-drafts';
import { createEnqueue, queueOf } from './enqueue';
import { createMemoryQueueStore, type MemoryQueueBacking } from './memory-store';
import { QueuedSentCard } from './QueuedSentCard';
import { copyPayload, QueueLog, type QueueCopyCart } from './QueueLog';
import { createShellHooks } from './shell-hooks';

// 02b v1.0.11 §8 Queue, §3.12 (25c; frames 02-D14 QueueLog, OpenOrdersQueued): the queue log, the sign-in hooks and
// the sticky token card, over the real queue (memory store) and staff api (scripted hub fetch).

const device: Device = { token: 'DEV', id: 'dev-1', type: 'cashier_kiosk' };
const meta: PageMeta = { tenantId: 'ten', branchId: 'br', branchName: 'Gulberg', hubNowMs: 0, utcOffsetMs: 0 };
// 20:02 hub time (UTC offset 0)
const AT_8_02_PM = Date.UTC(2026, 10, 13, 20, 2);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const ok = (result: unknown) => json(200, { data: { command_id: 'x', event_ids: [], result } });

const takeaway: SubmitOrderPayload = {
  order_id: 'O-OLD',
  order_type: 'takeaway',
  takeaway: { customer_name: 'Usman' },
  lines: [
    { order_item_id: 'L-OLD-1', item_id: 'seekh', options: [{ option_id: 'spicy', quantity: 1, order_item_id: 'L-OLD-1a' }] },
    { order_item_id: 'L-OLD-2', deal_id: 'combo', deal_choices: [{ deal_part_id: 'p1', item_id: 'naan', order_item_id: 'L-OLD-2a' }] },
  ],
};

function logEntry(over: Partial<QueueEntry>): QueueEntry {
  return { entry_id: 'E', command_type: 'SubmitOrder', payload: takeaway, queued_at: AT_8_02_PM, staff_id: 'bilal', device_id: 'dev-1', label: 'Takeaway · 3 items', state: 'log', ...over };
}

function setup(o: { backing?: MemoryQueueBacking; me?: { staff_id: string; name: string } } = {}) {
  const commands: Array<{ path: string; body: { command_id: string; actor_id: string; payload: unknown } }> = [];
  const answers: Response[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/auth/pin') {
      const staff = (JSON.parse(String(init?.body)) as { staff_id: string }).staff_id;
      return json(200, { data: { session_token: `TOK-${staff}`, session_id: 'S', staff_id: staff, display_name: staff, role_ids: [], idle_ttl_ms: 1 } });
    }
    if (input === '/queries/staff-roster')
      return json(200, { data: { staff: [{ staff_id: 'bilal', display_name: 'Bilal', locked_until: null }, { staff_id: 'ali', display_name: 'Ali', locked_until: null }], active_session: null } });
    if (input.startsWith('/commands/')) {
      commands.push({ path: input, body: JSON.parse(String(init?.body)) as never });
      const next = answers.shift();
      if (next === undefined) throw new TypeError('Failed to fetch');
      return next;
    }
    return json(200, { data: {} });
  });
  const api = createStaffApi({ device, meta, fetch, onSignedOut: () => {} });
  const live = createLiveBus();
  const enqueue = createEnqueue({
    api,
    device,
    clock: () => ({ nowMs: () => AT_8_02_PM, utcOffsetMs: 0 }),
    live,
    store: createMemoryQueueStore(o.backing ?? new Map()),
    onDeviceRevoked: () => {},
    presence: () => ({ ownedElsewhere: async () => new Set<string>(), announceRemoved: () => {}, onRemoved: () => () => {}, dispose: () => {} }),
  });
  const draftBacking: MemoryDraftBacking = new Map();
  const toasts = createToastBus();
  const shell = {
    device,
    meta,
    api,
    live,
    toasts,
    enqueue,
    clock: { nowMs: () => AT_8_02_PM, utcOffsetMs: 0 },
    config: { snapshot: () => ({ items: [{ item_id: 'seekh', name: 'Seekh Kebab', variant_name: null }], deals: [{ deal_id: 'combo', name: 'Family deal' }] }) },
    me: o.me ?? null,
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { api, live, enqueue, queue: queueOf(enqueue)!, shell, commands, answers, draftBacking, drafts: createMemoryDraftStore(draftBacking), toasts };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  window.location.hash = '';
});

function reconnect(live: ReturnType<typeof createLiveBus>) {
  live.connection(true);
  live.connection(false);
  live.connection(true);
}

describe('[02b §8 Queue] queue log', () => {
  it('[02b §8 Queue] queue log rows: Send again as {name} / Discard / Copy to a new order', async () => {
    const backing: MemoryQueueBacking = new Map([
      ['E1', logEntry({ entry_id: 'E1', label: 'Order · F4 + F5 · 5 items', log_reason: 'SESSION_EXPIRED', table_id: 'F4', seating_id: 'S1', payload: { ...takeaway, order_type: 'dine_in' } })],
      ['E2', logEntry({ entry_id: 'E2', queued_at: AT_8_02_PM + 120_000, log_reason: 'ITEM_SOLD_OUT', log_details: { item_id: 'seekh' } })],
      ['E3', logEntry({ entry_id: 'E3', command_type: 'CleanTable', queued_at: AT_8_02_PM - 240_000, label: 'Clean F8', log_reason: 'TABLE_SEATING_CHANGED', payload: { table_id: 'F8', seating_id: 'S9' } })],
      ['E4', logEntry({ entry_id: 'E4', command_type: 'MarkServed', queued_at: AT_8_02_PM + 1, label: 'Served · F2', log_reason: 'reloaded', payload: { lines: [] } })],
    ]);
    const s = setup({ backing, me: { staff_id: 'ali', name: 'Ali' } });
    await s.api.signIn('ali', '1', false);
    await s.queue.ready;
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={s.drafts} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(view.text()).toContain('Not sent');
    expect(view.text()).toContain('Things this screen tried to send and the hub refused.');
    const rows = [...view.container.querySelectorAll('.ql')];
    // oldest first: Clean F8 (7:58), the order (8:02), Served (8:02), the takeaway (8:04)
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Clean F8', 'Order · F4 + F5 · 5 items', 'Served · F2', 'Takeaway · 3 items']);
    const [clean, order, served, take] = rows as [Element, Element, Element, Element];
    expect(clean.textContent).toContain('Not sent: the table had changed');
    expect(clean.textContent).toContain('7:58 PM');
    expect([...clean.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Discard']);
    expect(order.textContent).toContain('Not sent: Bilal was signed out');
    expect([...order.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Send again as Ali', 'Discard']);
    expect(served.textContent).toContain('Not sent: this screen was restarted');
    expect([...served.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Send again as Ali', 'Discard']);
    expect(take.querySelector('small')?.textContent).toBe('Not sent: Seekh Kebab sold out');
    expect([...take.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy to a new order', 'Discard']);
    view.click(view.button('Discard', clean));
    await flush();
    expect(view.container.querySelectorAll('.ql')).toHaveLength(3);
    expect(backing.has('E3')).toBe(false);
  });

  it('[02b #35] "Send again" names the person now signed in', async () => {
    const backing: MemoryQueueBacking = new Map([['E1', logEntry({ entry_id: 'E1', log_reason: 'reloaded', staff_id: 'bilal' })]]);
    const s = setup({ backing, me: { staff_id: 'sara', name: 'Sara' } });
    await s.api.signIn('sara', '1', false);
    await s.queue.ready;
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={s.drafts} />
      </ShellContext.Provider>,
    );
    await flush();
    s.answers.push(ok({ order_id: 'O-OLD', token: 57, groups: [], lines: [] }));
    view.click(view.button('Send again as Sara'));
    await flush(8);
    expect(s.commands.at(-1)).toMatchObject({ path: '/commands/submit-order', body: { command_id: 'E1', actor_id: 'sara', payload: takeaway } });
    expect(view.container.querySelectorAll('.ql')).toHaveLength(0);
    expect(s.toasts.current()?.text).toBe('All sent');
  });

  it('[02b §8 Queue] Copy to a new order opens the order screen with the frozen lines as a draft', async () => {
    const backing: MemoryQueueBacking = new Map([['E2', logEntry({ entry_id: 'E2', log_reason: 'ITEM_SOLD_OUT' })]]);
    const s = setup({ backing, me: { staff_id: 'ali', name: 'Ali' } });
    await s.api.signIn('ali', '1', false);
    await s.queue.ready;
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={s.drafts} />
      </ShellContext.Provider>,
    );
    await flush();
    // a double tap makes one copy
    const copyButton = view.button('Copy to a new order');
    view.click(copyButton);
    view.click(copyButton);
    await flush();
    const drafts: Draft[] = await s.drafts.list('dev-1', 'ali');
    expect(drafts).toHaveLength(1);
    const draft = drafts[0]!;
    expect(draft).toMatchObject({ order_type: 'takeaway', held: false, updated_at: AT_8_02_PM });
    const copy = (draft.cart as QueueCopyCart).copy_of;
    // the same lines, every id new
    expect(copy.lines.map((l) => [l.item_id, l.deal_id])).toEqual([
      ['seekh', undefined],
      [undefined, 'combo'],
    ]);
    const ids = [copy.order_id, copy.lines[0]!.order_item_id, copy.lines[0]!.options![0]!.order_item_id, copy.lines[1]!.order_item_id, copy.lines[1]!.deal_choices![0]!.order_item_id];
    for (const id of ids) expect(['O-OLD', 'L-OLD-1', 'L-OLD-1a', 'L-OLD-2', 'L-OLD-2a']).not.toContain(id);
    expect(new Set(ids).size).toBe(5);
    expect(copy.takeaway).toEqual({ customer_name: 'Usman' });
    expect(window.location.hash).toBe(`#/order/takeaway/${draft.draft_id}`);
    // the refused entry is kept until Discard; the frozen payload is untouched
    expect(s.queue.log()[0]!.payload).toEqual(takeaway);
    expect((draft.cart as QueueCopyCart).from_entry_id).toBe('E2');
    // the row says Copied, no second Copy — also when the log is opened again
    expect(view.text()).toContain('Copied');
    expect(view.buttons().map((b) => b.textContent)).not.toContain('Copy to a new order');
    view.unmount();
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={s.drafts} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(view.text()).toContain('Copied');
    expect(view.buttons().map((b) => b.textContent)).not.toContain('Copy to a new order');
    // the copy was sent (its draft is gone): still Copied for this page's life
    await s.drafts.remove(draft.draft_id);
    view.unmount();
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={s.drafts} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(view.text()).toContain('Copied');
    expect(view.buttons().map((b) => b.textContent)).not.toContain('Copy to a new order');
  });

  it('[02b §8 Queue review #165] a failed draft save says so and keeps Copy; a dine-in refused for a changed or to-clean table offers Discard only', async () => {
    const backing: MemoryQueueBacking = new Map([
      ['E2', logEntry({ entry_id: 'E2', log_reason: 'ITEM_SOLD_OUT', log_details: { item_id: 'seekh' } })],
      ['E5', logEntry({ entry_id: 'E5', queued_at: AT_8_02_PM + 1, label: 'Order · F4', log_reason: 'TABLE_SEATING_CHANGED', payload: { ...takeaway, order_type: 'dine_in', table_id: 'F4', seating_id: 'S1' } })],
      ['E6', logEntry({ entry_id: 'E6', queued_at: AT_8_02_PM + 2, label: 'Order · F6', log_reason: 'TABLE_NEEDS_CLEANING', payload: { ...takeaway, order_type: 'dine_in', table_id: 'F6', seating_id: 'S6' } })],
    ]);
    const s = setup({ backing, me: { staff_id: 'ali', name: 'Ali' } });
    await s.api.signIn('ali', '1', false);
    await s.queue.ready;
    const broken = { put: () => Promise.reject(new Error('quota')), list: async () => [], remove: async () => {} };
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={broken} />
      </ShellContext.Provider>,
    );
    await flush();
    const [sold, changed, cleaning] = [...view.container.querySelectorAll('.ql')] as [Element, Element, Element];
    expect([...changed.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Discard']);
    expect([...cleaning.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Discard']);
    expect(cleaning.querySelector('small')?.textContent).toBe('Not sent: the table needs cleaning');
    expect(changed.querySelector('small')?.textContent).toBe('Not sent: the table had changed');
    view.click(view.button('Copy to a new order', sold));
    await flush();
    expect(s.toasts.current()).toEqual({ tone: 'warn', text: 'Could not keep the copy on this screen' });
    expect(window.location.hash).toBe('');
    expect([...sold.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Copy to a new order', 'Discard']);
  });

  it('[02b §8 Queue review #165] refusal wording per code, with the menu name of the item or deal', async () => {
    const rows: Array<[string, Record<string, unknown> | undefined, string]> = [
      ['ITEM_OUT_OF_HOURS', { deal_id: 'combo', opens_at_ms: null }, 'Not sent: Family deal is not served now'],
      ['ITEM_UNAVAILABLE', { item_id: 'gone' }, 'Not sent: an item is not available'],
      ['STATION_PAUSED', {}, 'Not sent: a kitchen station is paused'],
      ['BUSINESS_DAY_NOT_OPEN', {}, 'Not sent: the day hasn’t started'],
      ['SOMETHING_NEW', {}, 'Not sent: the hub refused it'],
    ];
    const backing: MemoryQueueBacking = new Map(rows.map(([code, details], i) => [`E${i}`, logEntry({ entry_id: `E${i}`, queued_at: AT_8_02_PM + i, log_reason: code, ...(details === undefined ? {} : { log_details: details }) })]));
    const s = setup({ backing, me: { staff_id: 'ali', name: 'Ali' } });
    await s.queue.ready;
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueueLog drafts={s.drafts} />
      </ShellContext.Provider>,
    );
    await flush();
    expect([...view.container.querySelectorAll('.ql small')].map((e) => e.textContent)).toEqual(rows.map((r) => r[2]));
  });

  it('[02b §8 Queue] copyPayload on dine-in keeps table and seating', () => {
    let n = 0;
    const copy = copyPayload({ ...takeaway, order_type: 'dine_in', table_id: 'F4', seating_id: 'S1' }, () => `N${++n}`);
    expect(copy).toMatchObject({ order_id: 'N1', table_id: 'F4', seating_id: 'S1' });
  });
});

describe('[02b §8 Queue] sign-in hooks', () => {
  it('[02b §8 Queue] sign-in: queueLine "n waiting to send"; beforeSignIn drains first', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    await s.enqueue('SubmitOrder', takeaway, { label: 'Takeaway' });
    await s.enqueue('RequestBill', { table_id: 'F4', seating_id: 'S1' }, { table_id: 'F4', seating_id: 'S1', label: 'Ask for bill' });
    const hooks = createShellHooks(s.enqueue);
    const heard = vi.fn();
    hooks.subscribe(heard);
    expect(hooks.queueLine()).toBe('2 waiting to send');
    expect(hooks.queueLine()).toBe(hooks.queueLine());
    s.answers.push(ok({ order_id: 'O-OLD', token: 3, groups: [], lines: [] }), ok({ requested: true }));
    await hooks.beforeSignIn();
    // both drained, in queue order, as the person who queued them (Ali)
    const drained = s.commands.slice(-2).map((c) => [c.path, c.body.actor_id]);
    expect(drained).toEqual([
      ['/commands/submit-order', 'ali'],
      ['/commands/request-bill', 'ali'],
    ]);
    expect(s.enqueue.pendingCount()).toBe(0);
    expect(hooks.queueLine()).toBeNull();
    expect(heard).toHaveBeenCalled();
  });

  it('[02b §3.12] a failed drain never blocks the login', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    await s.enqueue('SubmitOrder', takeaway, { label: 'Takeaway' });
    const hooks = createShellHooks(s.enqueue);
    await expect(hooks.beforeSignIn()).resolves.toBeUndefined();
    expect(hooks.queueLine()).toBe('1 waiting to send');
  });
});

describe('[02b §8 Queue] sticky token card', () => {
  it('[02b §8 Queue] a queued takeaway sent on reconnect shows the sticky token card', async () => {
    const s = setup({ me: { staff_id: 'sana', name: 'Sana' } });
    await s.api.signIn('sana', '1', false);
    view = mount();
    view.render(
      <ShellContext.Provider value={s.shell}>
        <QueuedSentCard />
      </ShellContext.Provider>,
    );
    // sent at once (online): no card — the send dialog shows that token
    s.answers.push(ok({ order_id: 'O1', token: 12, groups: [], lines: [] }));
    await s.enqueue('SubmitOrder', { ...takeaway, order_id: 'O1' }, { label: 'Takeaway' });
    await flush();
    expect(view.container.querySelector('.tokc')).toBeNull();
    // offline: queued; sent on reconnect → the card with the replay's token
    expect((await s.enqueue('SubmitOrder', { ...takeaway, order_id: 'O2' }, { label: 'Takeaway' })).status).toBe('queued');
    s.answers.push(ok({ order_id: 'O2', token: 57, groups: [], lines: [] }));
    reconnect(s.live);
    await s.queue.drain();
    await flush();
    const card = view.container.querySelector('.tokc');
    expect(card?.getAttribute('role')).toBe('status');
    expect(card?.querySelector('.tk')?.textContent).toBe('57');
    expect(card?.textContent).toContain('Takeaway sent');
    expect(card?.textContent).toContain('Queued at 8:02 PM · call the token');
    view.click(view.button('OK'));
    expect(view.container.querySelector('.tokc')).toBeNull();
  });
});
