import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import type { HubResult } from '../../../../api/hub-admin';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { Enqueue, EnqueueResult, MapTile, TableMapBody, TablesApi } from '../contracts';
import { createLocalFlags } from '../local-flags';
import { TableSheet } from '../sheet/TableSheet';

// 02a §3.13, §6.12–§6.14, §8 Offline (02a-D23 CallWaiter, CallWaiterNobody; 02a-D24 AskBill; 02-D13 Clean,
// CleanWhileLocked, CleanOpenOrders). Ask for bill and Clean go through the one Enqueue (Q-3); Call waiter never.

vi.mock('../../orders/table-view/OrdersPart', () => ({ OrdersPart: () => null }));

const ME = 'ST-ALI';
const NOW = 1_700_000_000_000;
const allow: Resolution = { grant: 'allowed', scope: 'branch' };
const BILAL = { staff_id: 'ST-BIL', name: 'Bilal' };

function tile(over: Partial<MapTile> = {}): MapTile {
  return {
    table_id: 'TB4',
    name: 'F4',
    seats: 6,
    archived: false,
    state: 'FOOD_ON_TABLE',
    seating_id: 'S1',
    party_size: null,
    primary_table_id: 'TB4',
    joined_table_names: ['F4'],
    holder: { staff_id: ME, name: 'Ali' },
    assignee: null,
    lock: null,
    opened_at: NOW - 60_000,
    bill_requested_at: null,
    live_order_count: 2,
    ...over,
  };
}
const mapOf = (t: MapTile): TableMapBody => ({ as_of_seq: 1, floors: [{ floor_id: 'FL1', name: 'Hall', archived: false, zones: [{ zone_id: 'Z1', name: 'Z', tables: [t] }] }] });

type Call = { name: string; payload: unknown; meta?: unknown };
function fakeShell(o: { perms?: string[]; tile?: MapTile; online?: boolean; queue?: EnqueueResult[]; answers?: Partial<Record<keyof TablesApi, Array<HubResult<unknown>>>> }) {
  const calls: Call[] = [];
  const answers = o.answers ?? {};
  const tables = new Proxy({} as TablesApi, {
    get: (_t, name: keyof TablesApi) => async (payload: unknown) => {
      calls.push({ name, payload });
      if (name === 'tableMap') return { ok: true, data: mapOf(o.tile ?? tile()) };
      return answers[name]?.shift() ?? { ok: false, error: { kind: 'network' } };
    },
  });
  const queue = [...(o.queue ?? [])];
  const send = async (type: string, payload: unknown, meta: unknown) => {
    calls.push({ name: `enqueue:${type}`, payload, meta });
    return queue.shift() ?? { status: 'needs_hub' };
  };
  const enqueue = Object.assign(send, { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }) as unknown as Enqueue;
  const shell: Shell = {
    device: { token: 'T', id: 'DEV1', type: 'tablet' },
    meta: { tenantId: 'TEN', branchId: 'BR', branchName: 'Gulberg', hubNowMs: NOW, utcOffsetMs: 0 },
    api: {} as never,
    tables,
    orders: {} as never,
    live: createLiveBus(),
    config: {} as never,
    permissions: createPermissions(Object.fromEntries((o.perms ?? ['take-order', 'clean-table']).map((p) => [p, allow]))),
    toasts: createToastBus(),
    enqueue,
    localFlags: createLocalFlags(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: ME, name: 'Ali' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  };
  return { shell, calls };
}

let m: Mounted;
beforeEach(() => {
  window.location.hash = '/tables/TB4?seating_id=S1';
});
afterEach(() => m?.unmount());

async function render(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <TableSheet table_id="TB4" seating_id="S1" />
    </ShellContext.Provider>,
  );
  await flush();
}
const dlg = () => m.container.querySelector<HTMLElement>('.dlg');
const sent = (calls: Call[]) => calls.filter((c) => c.name !== 'tableMap');
const toast = (shell: Shell) => shell.toasts.current();
const RECIPIENTS = (n: number): HubResult<unknown> => ({ ok: true, data: { alert_id: 'AL1', repeated: false, recipients: n } });

describe('[02a §3.13] call waiter, ask for bill, clean', () => {
  it('[02a §3.13] Call waiter: four chips, one tap sends; sub line without names (Q-16)', async () => {
    const { shell, calls } = fakeShell({ answers: { callWaiter: [RECIPIENTS(2)] } });
    await render(shell);
    m.click(m.button('Call waiter'));
    const box = dlg()!;
    expect(box.textContent).toContain('Call a waiter to F4');
    expect(box.textContent).toContain('One tap sends. Its waiters get it; your screen stays quiet.');
    const chips = [...box.querySelectorAll<HTMLElement>('.bchip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Water', 'Clear the table', 'Come to the table', 'Other']);
    expect(chips[2]!.classList.contains('def')).toBe(true);
    expect(() => m.button('Send', box)).toThrow(); // no send button: the chip sends
    m.click(chips[1]!);
    await flush();
    expect(sent(calls)).toEqual([{ name: 'callWaiter', payload: { table_id: 'TB4', seating_id: 'S1', chip: 'clear' } }]);
    expect(toast(shell)?.text).toBe('Waiter called');
    expect(shell.localFlags.callSentAt('TB4')).toBe(NOW);
    expect(dlg()).toBeNull();
  });

  it('[02a Q-16] repeated: true → "Already called" without a time; sets the local Call sent flag', async () => {
    const { shell } = fakeShell({ answers: { callWaiter: [{ ok: true, data: { alert_id: 'AL1', repeated: true } }] } });
    await render(shell);
    m.click(m.button('Call waiter'));
    m.click(m.button('Water', dlg()!));
    await flush();
    expect(toast(shell)?.text).toBe('Already called');
    expect(toast(shell)?.sub).toBeUndefined();
    expect(shell.localFlags.callSentAt('TB4')).toBe(NOW);
  });

  it('[02a §3.13] recipients: 0 → "Nobody else is working" warn toast', async () => {
    const { shell } = fakeShell({ answers: { callWaiter: [RECIPIENTS(0)] } });
    await render(shell);
    m.click(m.button('Call waiter'));
    m.click(m.button('Come to the table', dlg()!));
    await flush();
    expect(toast(shell)).toEqual({ text: 'Nobody else is working — you can call again in 5 min', sub: 'Go yourself or ask a manager', tone: 'warn' });
  });

  it('[02a §8 Offline] Call waiter offline → "Needs the hub", never queued', async () => {
    const off = fakeShell({ online: false });
    await render(off.shell);
    const b = m.button('Call waiter');
    expect(b.getAttribute('aria-disabled')).toBe('true');
    m.click(b);
    expect(toast(off.shell)?.text).toBe('Needs the hub');
    expect(dlg()).toBeNull();
    m.unmount();
    // the hub lost between the sheet and the tap: the call is not queued either
    const lost = fakeShell({});
    await render(lost.shell);
    m.click(m.button('Call waiter'));
    m.click(m.button('Water', dlg()!));
    await flush();
    expect(toast(lost.shell)?.text).toBe('Needs the hub');
    expect(sent(off.calls.concat(lost.calls)).map((c) => c.name)).toEqual(['callWaiter']);
    expect(lost.shell.localFlags.callSentAt('TB4')).toBeNull();
  });

  it('[02a §8 Offline] Ask for bill / Clean go through Enqueue with seating_id: needs_hub → "Needs the hub"; queued → "Will be sent when the hub is back"', async () => {
    const seated = tile({ state: 'SEATED', live_order_count: 0 });
    const { shell, calls } = fakeShell({ online: false, tile: tile(), queue: [{ status: 'needs_hub' }, { status: 'queued', entry_id: 'Q1' }] });
    await render(shell);
    m.click(m.button('Ask for bill'));
    m.click(m.button('Ask', m.container.querySelector('.confirm')!));
    await flush();
    expect(toast(shell)?.text).toBe('Needs the hub');
    m.click(m.button('Ask for bill'));
    m.click(m.button('Ask', m.container.querySelector('.confirm')!));
    await flush();
    expect(toast(shell)?.text).toBe('Will be sent when the hub is back');
    expect(sent(calls)).toEqual([
      { name: 'enqueue:RequestBill', payload: { table_id: 'TB4', seating_id: 'S1' }, meta: { table_id: 'TB4', seating_id: 'S1', label: 'Ask for bill · F4' } },
      { name: 'enqueue:RequestBill', payload: { table_id: 'TB4', seating_id: 'S1' }, meta: { table_id: 'TB4', seating_id: 'S1', label: 'Ask for bill · F4' } },
    ]);
    m.unmount();

    const clean = fakeShell({ online: false, tile: seated, queue: [{ status: 'queued', entry_id: 'Q2' }] });
    await render(clean.shell);
    m.click(m.button('More'));
    m.click(m.button('Mark clean'));
    m.click(m.button('Mark clean', dlg()!));
    await flush();
    expect(sent(clean.calls)).toEqual([{ name: 'enqueue:CleanTable', payload: { table_id: 'TB4', seating_id: 'S1' }, meta: { table_id: 'TB4', seating_id: 'S1', label: 'Clean · F4' } }]);
    expect(toast(clean.shell)?.text).toBe('Will be sent when the hub is back');
  });

  it('[02a §3.13] Ask bill confirms in place; 409 TABLE_NO_ORDERS → toast; requested: false → "Already asked"', async () => {
    const { shell, calls } = fakeShell({
      queue: [
        { status: 'sent', result: { requested: true } },
        { status: 'sent', result: { requested: false } },
        { status: 'refused', error: { kind: 'api', status: 409, code: 'TABLE_NO_ORDERS', details: { table_id: 'TB4' } } },
      ],
    });
    await render(shell);
    m.click(m.button('Ask for bill'));
    // in place: the action grid turns into the confirm line, no dialog
    const confirm = m.container.querySelector<HTMLElement>('.confirm')!;
    expect(confirm.textContent).toContain('Ask for the bill for F4?');
    expect(dlg()).toBeNull();
    m.click(m.button('Cancel', confirm));
    expect(m.container.querySelector('.confirm')).toBeNull();
    expect(sent(calls)).toEqual([]);
    m.click(m.button('Ask for bill'));
    m.click(m.button('Ask', m.container.querySelector('.confirm')!));
    await flush();
    expect(toast(shell)?.text).toBe('Bill asked');
    m.click(m.button('Ask for bill'));
    m.click(m.button('Ask', m.container.querySelector('.confirm')!));
    await flush();
    expect(toast(shell)?.text).toBe('Already asked');
    m.click(m.button('Ask for bill'));
    m.click(m.button('Ask', m.container.querySelector('.confirm')!));
    await flush();
    expect(toast(shell)?.text).toBe('No orders on this table yet');
  });

  it('[02a §3.13] Clean while someone orders → "Clean anyway?"; 409 TABLE_HAS_OPEN_ORDERS → "The bill must be paid first"', async () => {
    const locked = tile({ state: 'SEATED', live_order_count: 0, holder: BILAL, lock: { ...BILAL, mine: false } });
    const { shell, calls } = fakeShell({
      tile: locked,
      queue: [
        { status: 'sent', result: { reason: 'left_without_order' } },
        { status: 'refused', error: { kind: 'api', status: 409, code: 'TABLE_HAS_OPEN_ORDERS', details: { table_id: 'TB4', order_count: 3 } } },
      ],
    });
    await render(shell);
    m.click(m.button('Mark clean'));
    let box = dlg()!;
    expect(box.textContent).toContain('Bilal is taking an order here');
    expect(box.textContent).toContain('Clean anyway? His order stays on his screen as a draft. F4 becomes free.');
    m.click(m.button('Clean anyway', box));
    await flush();
    expect(sent(calls)[0]).toMatchObject({ name: 'enqueue:CleanTable', payload: { table_id: 'TB4', seating_id: 'S1' } });
    expect(toast(shell)?.text).toBe('F4 is free');
    expect(dlg()).toBeNull();

    m.click(m.button('Mark clean'));
    m.click(m.button('Clean anyway', dlg()!));
    await flush();
    box = dlg()!;
    expect(box.textContent).toContain('F4 still has 3 orders. The bill must be paid first.');
    m.click(m.button('OK', box));
    expect(dlg()).toBeNull();
  });

  it('[02a §3.13] while a send is in flight Cancel and Close do nothing, so no second command can follow (review #172)', async () => {
    const { shell, calls } = fakeShell({});
    let done: (v: unknown) => void = () => {};
    const slow = new Promise((r) => (done = r));
    const orig = shell.tables;
    shell.tables = new Proxy(orig, { get: (t, name: keyof TablesApi) => (name === 'callWaiter' ? async (p: unknown) => (calls.push({ name, payload: p }), slow) : t[name]) });
    await render(shell);
    m.click(m.button('Call waiter'));
    m.click(m.button('Water', dlg()!));
    const cancel = m.button('Cancel', dlg()!) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    m.click(m.button('Close', dlg()!));
    expect(dlg()).not.toBeNull();
    done({ ok: true, data: { alert_id: 'AL1', repeated: false, recipients: 1 } });
    await flush();
    expect(dlg()).toBeNull();
    expect(sent(calls).filter((c) => c.name === 'callWaiter')).toHaveLength(1);
  });

  it('[02a Q-16] a Clean that is sent clears this device\'s "Call sent" flag for the table (review #172)', async () => {
    const { shell } = fakeShell({ tile: tile({ state: 'NEEDS_CLEANING', live_order_count: 0 }), queue: [{ status: 'sent', result: { reason: 'cleaned' } }] });
    shell.localFlags.markCallSent('TB4', NOW - 60_000);
    await render(shell);
    m.click(m.button('Mark clean'));
    m.click(m.button('Mark clean', dlg()!));
    await flush();
    expect(shell.localFlags.callSentAt('TB4')).toBeNull();
  });

  it('[02a §3.13] Mark clean on a table to clean: plain confirm; TABLE_SEATING_CHANGED on the send → toast + one map read', async () => {
    const toClean = tile({ state: 'NEEDS_CLEANING', live_order_count: 0 });
    const { shell, calls } = fakeShell({
      tile: toClean,
      queue: [{ status: 'refused', error: { kind: 'api', status: 409, code: 'TABLE_SEATING_CHANGED', details: { table_id: 'TB4', seating_id: 'S2' } } }],
    });
    await render(shell);
    m.click(m.button('Mark clean'));
    const box = dlg()!;
    expect(box.textContent).toContain('Mark F4 clean?');
    expect(box.textContent).toContain('The table becomes free.');
    const reads = calls.filter((c) => c.name === 'tableMap').length;
    m.click(m.button('Mark clean', box));
    await flush();
    expect(toast(shell)?.text).toBe('This table changed — refreshed');
    expect(calls.filter((c) => c.name === 'tableMap').length).toBe(reads + 1);
  });
});
