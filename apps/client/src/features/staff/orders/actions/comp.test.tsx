import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { OrdersApi, SeatingLine } from '../contracts';
import { LineActions, type LineOrder } from '../view/LineActions';
import { LineRow } from '../view/LineRow';
import { CompWaiting } from './CompWaiting';
import { cascadedUnits, compPreviewMinor } from './CompSheet';
import { pendingCompsOf } from './pending-comps';

// 02b v1.0.11 §3.9, §6.8, §8 Table view (02b-D33 Comp; 02b-C03 CompWaiting; 01d AD-1; Q-11).

const OFFSET = 5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 13, 15, 15);

function sline(order_item_id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id,
    order_id: 'O1',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'KARAHI',
    deal_id: null,
    name: 'Chicken Karahi',
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 220_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 220_000,
    billed_minor: 220_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: NOW - 30 * 60_000,
    served_at: NOW - 5 * 60_000,
    served_source: 'tap',
    is_food: true,
    kitchen_note: null,
    stage: 'served',
    fired: true,
    ...over,
  };
}

const PERMS: Record<string, Resolution> = {
  'mark-item-returned': { grant: 'allowed', scope: 'branch' },
  'take-order': { grant: 'allowed', scope: 'branch' },
  'apply-comp': { grant: 'requires_approval', approver_role_ids: ['R-MGR'], scope: 'branch' },
};

const ok = <T,>(data: T) => ({ ok: true as const, data });

function makeShell(o: { perms?: Record<string, Resolution>; compAnswer?: () => unknown; withdraw?: () => unknown; requests?: () => unknown[] } = {}) {
  const live = createLiveBus();
  const answers: Record<string, () => unknown> = {
    CompLine: o.compAnswer ?? (() => ok({ alert_id: 'A1', pending: true as const, value_minor: 220_000 })),
    WithdrawRequest: o.withdraw ?? (() => ok({})),
  };
  const command = vi.fn(async (...args: [type: string, payload: unknown, opts?: { commandId?: string }]) => (answers[args[0]] ?? (() => ok({})))());
  const query = vi.fn(async () => ok({ requests: o.requests?.() ?? [] }));
  const calls = (type: string) => command.mock.calls.filter((c) => c[0] === type).map((c) => ({ payload: c[1] as Record<string, unknown>, commandId: c[2]?.commandId }));
  const orders = {};
  const shell = {
    device: { token: 'D', id: 'DEV', type: 'tablet' },
    live,
    orders: orders as unknown as OrdersApi,
    api: { command, query },
    tables: { tableMap: vi.fn(async () => ok({ as_of_seq: 1, floors: [] })) },
    permissions: createPermissions(o.perms ?? PERMS),
    toasts: createToastBus(),
    enqueue: Object.assign(vi.fn(), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
    clock: { nowMs: () => NOW, utcOffsetMs: OFFSET },
    config: { snapshot: () => ({ items: [{ item_id: 'KARAHI', price_minor: 220_000 }] }), config: () => ({ comp_reason_chips: ['Late', 'Quality'], zone_undo_ms: 300_000 }) },
    me: { staff_id: 'ST-ALI', name: 'Ali' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, orders, live, command, query, calls };
}

const order = (lines: SeatingLine[]): LineOrder => ({ order_id: 'O1', order_type: 'dine_in', ident: 'F4 + F5', billed: false, lines, seating_id: 'S4', table_id: 'F4' });

function View({ o }: { o: LineOrder }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="rnd">
      {o.lines.map((l) => (
        <LineRow key={l.order_item_id} line={l} mode="stages" utcOffsetMs={OFFSET} selected={sel === l.order_item_id} onSelect={setSel} below={<CompWaiting line={l} onChanged={() => {}} />}>
          <LineActions line={l} order={o} onChanged={() => {}} />
        </LineRow>
      ))}
    </div>
  );
}

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  setLanguage('en');
});

function render(shell: Shell, node: React.ReactNode) {
  const m = mount();
  current = m;
  m.render(<ShellContext.Provider value={shell}>{node}</ShellContext.Provider>);
  const select = (id: string) => m.click(m.container.querySelector(`.ol[data-line="${id}"]`));
  const ctrl = () => m.container.querySelector('.ol.sel .ol__ctrl');
  return { m, select, ctrl, rerender: (n: React.ReactNode) => m.render(<ShellContext.Provider value={shell}>{n}</ShellContext.Provider>) };
}

describe('[02b §3.9] comp', () => {
  it('[02b §8 Table view] requires_approval → "Ask for approval" → "Waiting for approval — Rs 2,200 comp" + Withdraw', async () => {
    const s = makeShell();
    const v = render(s.shell, <View o={order([sline('K')])} />);
    v.select('K');
    v.m.click(v.m.button('Comp', v.ctrl()!));
    const dlg = v.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('Give Chicken Karahi free?');
    expect(dlg.textContent).toContain("Needs a manager's approval");
    expect(dlg.querySelector('.qline')?.textContent).toContain('Rs 2,200');
    // the chips: config labels + the one fixed Other
    expect([...dlg.querySelectorAll('.chip')].map((c) => c.textContent)).toEqual(['Late', 'Quality', 'Other']);
    v.m.click(v.m.button('Quality', dlg));
    v.m.click(v.m.button('Ask for approval', dlg));
    await flush();
    expect(s.calls('CompLine').map((c) => c.payload)).toEqual([{ order_item_id: 'K', units: 1, reason_code: 'Quality' }]);
    expect(s.shell.toasts.current()?.text).toBe('Comp asked — waiting for approval');
    const card = v.m.container.querySelector('.wcard')!;
    expect(card.textContent).toContain('Waiting for approval — Rs 2,200 comp');
    expect(card.textContent).toContain('Chicken Karahi ×1 · Quality · amount as asked');
    // one request per line: no second Comp while it waits
    expect([...(v.ctrl()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).not.toContain('Comp');
    v.m.click(v.m.button('Withdraw', card));
    await flush();
    expect(s.calls('WithdrawRequest').map((c) => c.payload)).toEqual([{ alert_id: 'A1' }]);
    expect(v.m.container.querySelector('.wcard')).toBeNull();
  });

  it('[02b §3.9] allowed grant: "Comp" applies at once; Other needs a note', async () => {
    const s = makeShell({ perms: { 'apply-comp': { grant: 'allowed', scope: 'branch' } }, compAnswer: () => ok({ comped: true, value_minor: 220_000 }) });
    const v = render(s.shell, <View o={order([sline('K')])} />);
    v.select('K');
    v.m.click(v.m.button('Comp', v.ctrl()!));
    const dlg = v.m.container.querySelector('.dlg')!;
    v.m.click(v.m.button('Other', dlg));
    const send = [...dlg.querySelectorAll('.acts .btn')].at(-1) as HTMLButtonElement;
    expect(send.textContent).toBe('Comp');
    expect(send.disabled).toBe(true);
    const input = dlg.querySelector('input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'cold');
    act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    expect(send.disabled).toBe(false);
    v.m.click(send);
    await flush();
    expect(s.calls('CompLine').map((c) => c.payload)).toEqual([{ order_item_id: 'K', units: 1, reason_code: 'other', note: 'cold' }]);
    expect(s.shell.toasts.current()?.text).toBe('Comped ×1');
    expect(v.m.container.querySelector('.wcard')).toBeNull();
  });

  it('[02b Q-11] waiting card from line.pending_comp after reload / on another device', async () => {
    const pendingRow = { alert_id: 'A9', kind: 'comp', state: 'pending', close_reason: null, decision: null, answerer_name: null, raised_at: NOW - 60_000, waiting_ms: 60_000, ask_in_person: false, lock: { kind_label_key: 'alert.comp.lock' } };
    const s = makeShell({ requests: () => [pendingRow] });
    const v = render(s.shell, <View o={order([sline('K', { pending_comp: { alert_id: 'A9', units: 1, value_minor: 220_000 } })])} />);
    await flush();
    const card = v.m.container.querySelector('.wcard')!;
    expect(card.textContent).toContain('Waiting for approval — Rs 2,200 comp');
    v.m.click(v.m.button('Withdraw', card));
    await flush();
    expect(s.calls('WithdrawRequest').map((c) => c.payload)).toEqual([{ alert_id: 'A9' }]);

    // H6 on the hub: its null wins over this device's memory (answered or closed elsewhere)
    act(() => pendingCompsOf(s.shell).remember({ alert_id: 'A1', order_item_id: 'K', units: 1, value_minor: 220_000, reason: 'Quality' }, true));
    v.rerender(<View o={order([sline('K', { pending_comp: null })])} />);
    expect(v.m.container.querySelector('.wcard')).toBeNull();
    // H6 not there yet (field absent): the memory card
    v.rerender(<View o={order([sline('K')])} />);
    expect(v.m.container.querySelector('.wcard')?.textContent).toContain('Rs 2,200');
  });

  it('[02b §3.9] Comp hidden inside the zone undo window', () => {
    const s = makeShell();
    const zone = (added_at: number) => sline('Z', { zone_served: true, served_from_zone_id: 'ZN', served_source: 'zone', stage: null, added_at, name: 'Raita' });
    const v = render(s.shell, <View o={order([zone(NOW - 60_000)])} />);
    v.select('Z');
    expect([...(v.ctrl()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).not.toContain('Comp');
    // zone_undo_ms (300 000) passed: Comp is there
    v.rerender(<View o={order([zone(NOW - 301_000)])} />);
    expect([...(v.ctrl()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toContain('Comp');
  });
});

describe('[02b §3.9] comp — review #183', () => {
  const myRow = (alert_id: string, state: string) => ({ alert_id, kind: 'comp', state, close_reason: null, decision: null, answerer_name: null, raised_at: NOW - 60_000, waiting_ms: 0, ask_in_person: false, lock: { kind_label_key: 'alert.comp.lock' } });
  const askQuality = (v: ReturnType<typeof render>) => {
    v.select('K');
    v.m.click(v.m.button('Comp', v.ctrl()!));
    v.m.click(v.m.button('Quality', v.m.container.querySelector('.dlg')!));
    v.m.click(v.m.button('Ask for approval', v.m.container.querySelector('.dlg')!));
  };

  it('[02b Q-11] the waiting card shows the hub amount only: none when the pending result has no value_minor', async () => {
    const s = makeShell({ compAnswer: () => ok({ alert_id: 'A1', pending: true }) });
    const v = render(s.shell, <View o={order([sline('K')])} />);
    askQuality(v);
    await flush();
    const card = v.m.container.querySelector('.wcard')!;
    expect(card.textContent).toContain('Waiting for approval');
    expect(card.textContent).not.toContain('Rs');
  });

  it('[02b §6.8] Comp: a lost reply is sent again with the same command_id; never two comps', async () => {
    let n = 0;
    const s = makeShell({ compAnswer: () => (++n === 1 ? { ok: false, error: { kind: 'api', status: 503, code: 'HUB_BUSY', details: {} } } : ok({ alert_id: 'A1', pending: true, value_minor: 220_000 })) });
    const v = render(s.shell, <View o={order([sline('K')])} />);
    askQuality(v);
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('No answer from the hub — try again');
    v.m.click(v.m.button('Ask for approval', v.m.container.querySelector('.dlg')!));
    await flush();
    const [a, b] = s.calls('CompLine');
    expect(b!.commandId).toBe(a!.commandId);
    expect(b!.payload).toEqual(a!.payload);
    expect(v.m.container.querySelector('.wcard')).not.toBeNull();
  });

  it('[02b §3.9] the waiting card goes when the request is answered or closed; Comp comes back', async () => {
    let rows: unknown[] = [myRow('A1', 'pending')];
    const s = makeShell({ requests: () => rows });
    const v = render(s.shell, <View o={order([sline('K', { quantity: 2, units: 2, live_units: 2, refundable_minor: 440_000 })])} />);
    askQuality(v);
    await flush();
    expect(v.m.container.querySelector('.wcard')).not.toBeNull();
    // rejected: a request_result reaches the page → my-requests no longer lists it pending
    rows = [myRow('A1', 'closed')];
    await act(async () => pendingCompsOf(s.shell).resultSeen());
    expect(v.m.container.querySelector('.wcard')).toBeNull();
    v.select('K');
    v.select('K');
    expect([...(v.ctrl()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toContain('Comp');

    // approved: its LineComped frame names the alert
    rows = [myRow('A2', 'pending')];
    act(() => pendingCompsOf(s.shell).remember({ alert_id: 'A2', order_item_id: 'K', units: 1, value_minor: 220_000, reason: null }, true));
    expect(v.m.container.querySelector('.wcard')).not.toBeNull();
    act(() => s.live.frame({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'LineComped', schema_version: 1, payload: { order_item_id: 'K', alert_id: 'A2' } } }));
    expect(v.m.container.querySelector('.wcard')).toBeNull();

    // a reconnect re-reads my-requests
    act(() => pendingCompsOf(s.shell).remember({ alert_id: 'A3', order_item_id: 'K', units: 1, value_minor: 220_000, reason: null }, true));
    rows = [];
    act(() => {
      s.live.connection(true);
      s.live.connection(false);
      s.live.connection(true);
    });
    await flush();
    expect(v.m.container.querySelector('.wcard')).toBeNull();
  });

  it('[02b §3.9] Withdraw 409 REQUEST_NOT_PENDING clears the card; no Withdraw on a request that is not mine', async () => {
    const s = makeShell({ withdraw: () => ({ ok: false, error: { kind: 'api', status: 409, code: 'REQUEST_NOT_PENDING', details: {} } }), requests: () => [myRow('A1', 'pending')] });
    const v = render(s.shell, <View o={order([sline('K')])} />);
    askQuality(v);
    await flush();
    v.m.click(v.m.button('Withdraw', v.m.container.querySelector('.wcard')!));
    await flush();
    expect(v.m.container.querySelector('.wcard')).toBeNull();
    current?.unmount();

    // someone else's open request (hub pending_comp; my-requests does not list it): the card, no Withdraw
    const t = makeShell({ requests: () => [] });
    const w = render(t.shell, <View o={order([sline('K', { pending_comp: { alert_id: 'A8', units: 1, value_minor: 220_000 } })])} />);
    await flush();
    const card = w.m.container.querySelector('.wcard')!;
    expect(card.textContent).toContain('Rs 2,200');
    expect(card.querySelector('button')).toBeNull();
  });

  it('[02b §3.9] COMP_PENDING shows the open request with its own units', async () => {
    const s = makeShell({ compAnswer: () => ({ ok: false, error: { kind: 'api', status: 409, code: 'COMP_PENDING', details: { alert_id: 'A5' } } }) });
    // H6 on the hub: the read raced the other request — the sheet opened before pending_comp arrived
    const line = sline('K', { quantity: 3, units: 3, live_units: 3, refundable_minor: 660_000 });
    const v = render(s.shell, <View o={order([line])} />);
    askQuality(v);
    await flush();
    const card = v.m.container.querySelector('.wcard')!;
    expect(card.textContent).toContain('Waiting for approval');
    expect(card.textContent).not.toContain('×1');
    expect(card.querySelector('button')).toBeNull();
    v.rerender(<View o={order([{ ...line, pending_comp: { alert_id: 'A5', units: 2, value_minor: 440_000 } }])} />);
    expect(v.m.container.querySelector('.wcard')?.textContent).toContain('×2');
  });

  it('[02b §3.4] comp preview: partial units, the remainder share, a deal and an option child as the hub plans them', () => {
    // 3 units, Rs 10.00 → shares 333, 333, 334 (allocateDealMinor: the last takes the remainder)
    const three = sline('T', { quantity: 3, units: 3, live_units: 3, refundable_minor: 1_000 });
    expect(compPreviewMinor(three, [three], 2)).toBe(666);
    expect(compPreviewMinor({ ...three, comped_units: 2 }, [three], 1)).toBe(334);
    expect(compPreviewMinor({ ...three, removed_units: 1, live_units: 2 }, [three], 2)).toBe(667);
    // a deal of 2 units: part A (1 per deal unit, Rs 10.00), part B (2 per deal unit, Rs 8.00)
    const deal = sline('D', { line_kind: 'deal', item_id: null, deal_id: 'DL', quantity: 2, units: 2, live_units: 2, refundable_minor: 0 });
    const a = sline('A', { line_kind: 'deal_part', parent_order_item_id: 'D', units: 2, live_units: 2, refundable_minor: 1_000 });
    const b = sline('B', { line_kind: 'deal_part', parent_order_item_id: 'D', units: 4, live_units: 4, refundable_minor: 800 });
    expect(compPreviewMinor(deal, [deal, a, b], 1)).toBe(500 + 400);
    // the last free deal unit takes every remaining part unit
    expect(compPreviewMinor(deal, [deal, a, b], 2)).toBe(1_000 + 800);
    // an item with an option child (2 per parent unit)
    const item = sline('I', { quantity: 2, units: 2, live_units: 2, refundable_minor: 2_000 });
    const extra = sline('X', { line_kind: 'option_child', parent_order_item_id: 'I', units: 4, live_units: 4, refundable_minor: 160 });
    expect(compPreviewMinor(item, [item, extra], 1)).toBe(1_000 + 80);
    // a child whose units are not a multiple of the parent's: no preview (the hub refuses that shape)
    expect(compPreviewMinor(item, [item, { ...extra, units: 3 }], 1)).toBeNull();
    expect(cascadedUnits(item, extra, 1)).toBe(2);
  });

  it('[02b Q-19] the Other note is not sent once another chip is picked', async () => {
    const s = makeShell();
    const v = render(s.shell, <View o={order([sline('K')])} />);
    v.select('K');
    v.m.click(v.m.button('Comp', v.ctrl()!));
    const dlg = v.m.container.querySelector('.dlg')!;
    v.m.click(v.m.button('Other', dlg));
    const input = dlg.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'cold');
    act(() => void input.dispatchEvent(new Event('input', { bubbles: true })));
    v.m.click(v.m.button('Quality', dlg));
    v.m.click(v.m.button('Ask for approval', dlg));
    await flush();
    expect(s.calls('CompLine').map((c) => c.payload)).toEqual([{ order_item_id: 'K', units: 1, reason_code: 'Quality' }]);
  });

  it('[02b §3.9] the zone undo boundary is inclusive, as the hub (now − added_at <= zone_undo_ms)', () => {
    const s = makeShell();
    const zone = (added_at: number) => sline('Z', { zone_served: true, served_from_zone_id: 'ZN', served_source: 'zone', stage: null, added_at, name: 'Raita' });
    const v = render(s.shell, <View o={order([zone(NOW - 300_000)])} />);
    v.select('Z');
    expect([...(v.ctrl()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).not.toContain('Comp');
  });
});
