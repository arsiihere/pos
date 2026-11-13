import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { DraftStore, OrdersApi, SeatingLine } from '../contracts';
import { LineActions, type LineOrder } from '../view/LineActions';
import { LineRow } from '../view/LineRow';
import { CompItPrompt } from './CompItPrompt';
import type { CompItSent, CompItSource } from './pending-comps';
import { sendAsNewItem, type StartCompItCart } from './SendBackSheet';

// 02b v1.0.11 §3.8, §8 Table view E-7 (02b-D32 SendBack, SendBackClosed; 02b-D33 CompItPrompt / Yes / No).

const OFFSET = 5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 13, 15, 15);
const AT_830 = Date.UTC(2026, 10, 13, 15, 30);

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

function makeShell(o: { returnAnswer?: () => unknown; perms?: Record<string, Resolution>; online?: boolean } = {}) {
  const live = createLiveBus();
  const answers: Record<string, () => unknown> = {
    ReturnToKitchen: o.returnAnswer ?? (() => ok({ eta_ms: AT_830, promise_ms: AT_830 })),
    CompLine: () => ok({ alert_id: 'A1', pending: true as const, value_minor: 220_000 }),
  };
  const command = vi.fn(async (...args: [type: string, payload: unknown, opts?: { commandId?: string }]) => (answers[args[0]] ?? (() => ok({})))());
  const calls = (type: string) => command.mock.calls.filter((c) => c[0] === type).map((c) => ({ payload: c[1] as Record<string, unknown>, commandId: c[2]?.commandId }));
  const orders = {};
  const shell = {
    device: { token: 'D', id: 'DEV', type: 'tablet' },
    live,
    orders: orders as unknown as OrdersApi,
    api: { command, query: vi.fn(async () => ok({ requests: [] })) },
    tables: { tableMap: vi.fn(async () => ok({ as_of_seq: 1, floors: [] })) },
    permissions: createPermissions(o.perms ?? PERMS),
    toasts: createToastBus(),
    enqueue: Object.assign(vi.fn(), { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} }),
    clock: { nowMs: () => NOW, utcOffsetMs: OFFSET },
    config: { snapshot: () => ({ items: [{ item_id: 'KARAHI', price_minor: 220_000 }] }), config: () => ({ comp_reason_chips: ['Late', 'Quality'], zone_undo_ms: 300_000 }) },
    me: { staff_id: 'ST-ALI', name: 'Ali' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, orders, live, command, calls };
}

const order = (lines: SeatingLine[]): LineOrder => ({ order_id: 'O1', order_type: 'dine_in', ident: 'F4 + F5', billed: false, lines, seating_id: 'S4', table_id: 'F4' });

function View({ o, onSendAsNew }: { o: LineOrder; onSendAsNew?: (line: SeatingLine) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="rnd">
      {o.lines.map((l) => (
        <LineRow key={l.order_item_id} line={l} mode="stages" utcOffsetMs={OFFSET} selected={sel === l.order_item_id} onSelect={setSel}>
          <LineActions line={l} order={o} onChanged={() => {}} {...(onSendAsNew === undefined ? {} : { onSendAsNew })} />
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
  window.location.hash = '';
});

function render(shell: Shell, node: React.ReactNode) {
  const m = mount();
  current = m;
  m.render(<ShellContext.Provider value={shell}>{node}</ShellContext.Provider>);
  const select = (id: string) => m.click(m.container.querySelector(`.ol[data-line="${id}"]`));
  const ctrl = () => m.container.querySelector('.ol.sel .ol__ctrl');
  return { m, select, ctrl, rerender: (n: React.ReactNode) => m.render(<ShellContext.Provider value={shell}>{n}</ShellContext.Provider>) };
}

function fakeSource() {
  const listeners = new Set<(s: CompItSent) => void>();
  const source: CompItSource = { subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)) };
  return { source, emit: (s: CompItSent) => act(() => listeners.forEach((l) => l(s))) };
}

describe('[02b §8 Table view] send back', () => {
  it('[02b §8 Table view] Send back: Fix or Remake, one tap; Return on the replacement once remade', async () => {
    const s = makeShell();
    const v = render(s.shell, <View o={order([sline('K')])} />);
    v.select('K');
    v.m.click(v.m.button('Send back', v.ctrl()!));
    const dlg = v.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('Send back Chicken Karahi?');
    v.m.click(v.m.button('Remake', dlg));
    await flush();
    expect(s.calls('ReturnToKitchen')).toHaveLength(1);
    const sent = s.calls('ReturnToKitchen')[0]!.payload as { order_item_id: string; return_order_item_id: string; mode: string };
    expect(sent.order_item_id).toBe('K');
    expect(sent.mode).toBe('remake');
    expect(sent.return_order_item_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(s.shell.toasts.current()?.text).toBe('Sent back · ready at 8:30 PM');
    expect(v.m.container.querySelector('.dlg')).toBeNull();

    // remade: the original has no Send back; its replacement (once served) has it
    v.rerender(<View o={order([sline('K', { stage: 'returned', returned_units: 1 }), sline('R', { return_of: 'K', added_at: NOW, stage: 'served' })])} />);
    v.select('K');
    expect(v.ctrl()?.textContent ?? '').not.toContain('Send back');
    v.select('R');
    expect(v.ctrl()?.textContent).toContain('Send back');
  });

  it('[02b §8 Table view E-7] 409 ORDER_NOT_IN_ENGINE → "order closed" + Send it as a new item → order screen with the item (CompItCart)', async () => {
    const s = makeShell({ returnAnswer: () => ({ ok: false, error: { kind: 'api', status: 409, code: 'ORDER_NOT_IN_ENGINE', details: {} } }) });
    const start = vi.fn<StartCompItCart>(async () => {});
    const drafts = {} as DraftStore;
    const line = sline('K', { options: [{ name: 'Less spicy', quantity: 1 }] });
    const o = order([line]);
    const v = render(s.shell, <View o={o} onSendAsNew={(l) => void sendAsNewItem({ shell: s.shell, start, drafts, order: o, line: l })} />);
    v.select('K');
    v.m.click(v.m.button('Send back', v.ctrl()!));
    v.m.click(v.m.button('Fix', v.m.container.querySelector('.dlg')!));
    await flush();
    const dlg = v.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('This order is closed');
    expect(dlg.textContent).toContain('Served more than 30 min ago.');
    expect(dlg.textContent).toContain('Send Chicken Karahi as a new item?');
    v.m.click(v.m.button('Send it as a new item', dlg));
    await flush();
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ drafts, device_id: 'DEV', staff_id: 'ST-ALI', table_id: 'F4', seating_id: 'S4', item_id: 'KARAHI', options: [{ name: 'Less spicy', quantity: 1 }], nowMs: NOW }),
    );
    expect(window.location.hash).toBe('#/order/dine_in/S4');

    // a line already "Served · closed" opens on the closed state, no command sent
    s.command.mockClear();
    v.rerender(<View o={order([sline('C', { stage: 'out_of_engine' })])} onSendAsNew={() => {}} />);
    v.select('C');
    v.m.click(v.m.button('Send back', v.ctrl()!));
    expect(v.m.container.querySelector('.dlg')?.textContent).toContain('This order is closed');
    expect(s.calls('ReturnToKitchen')).toHaveLength(0);
  });
});

describe('[02b §8 Table view E-7] Comp it?', () => {
  const again = sline('N', { order_id: 'O2', stage: 'added', fired: true, served_at: null, served_source: null, added_at: NOW });

  it('[02b §8 Table view E-7] round accepted → "Comp the new Chicken Karahi?": No → "Kept on the bill"; Yes → Comp prefilled, "Pick a reason" until chosen', async () => {
    const s = makeShell();
    const src = fakeSource();
    const orders = [order([sline('K')]), { ...order([again]), order_id: 'O2' }];
    const v = render(s.shell, <CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    expect(v.m.container.querySelector('.dlg')).toBeNull();
    src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4' });
    v.rerender(<CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    let dlg = v.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('Comp the new Chicken Karahi?');
    expect(dlg.textContent).toContain('Rs 2,200');
    v.m.click(v.m.button('No, keep on the bill', dlg));
    expect(v.m.container.querySelector('.dlg')).toBeNull();
    expect(s.shell.toasts.current()).toMatchObject({ text: 'Kept on the bill', sub: 'You can still comp it from the line.' });

    // asked once: the same line is never asked again
    src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4' });
    v.rerender(<CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    expect(v.m.container.querySelector('.dlg')).toBeNull();
    // a second comp-it line → Yes
    const again2 = { ...again, order_item_id: 'N2' };
    const orders2 = [orders[0]!, { ...order([again, again2]), order_id: 'O2' }];
    src.emit({ order_id: 'O2', order_item_id: 'N2', item_id: 'KARAHI', seating_id: 'S4' });
    v.rerender(<CompItPrompt seating_id="S4" orders={orders2} source={src.source} onChanged={() => {}} />);
    expect(v.m.container.querySelector('.dlg')?.textContent).toContain('Comp the new');
    v.m.click(v.m.button('Yes, comp it'));
    dlg = v.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('Give Chicken Karahi free?');
    expect(dlg.querySelector('.step output')?.textContent).toBe('1');
    const send = [...dlg.querySelectorAll('.acts .btn')].at(-1) as HTMLButtonElement;
    expect(send.textContent).toBe('Pick a reason');
    expect(send.disabled).toBe(true);
    v.m.click(v.m.button('Quality', dlg));
    expect(send.textContent).toBe('Ask for approval');
    v.m.click(send);
    await flush();
    expect(s.calls('CompLine').map((c) => c.payload)).toEqual([{ order_item_id: 'N2', units: 1, reason_code: 'Quality' }]);
  });

  it('[02b E-7] a queued round: the prompt waits until it is sent', () => {
    const s = makeShell();
    const src = fakeSource();
    const orders = [{ ...order([again]), order_id: 'O2' }];
    const v = render(s.shell, <CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4', queued: true });
    expect(v.m.container.querySelector('.dlg')).toBeNull();
    // another line's frame does not count
    act(() => s.live.frame({ type: 'event', seq: 4, event: { event_id: 'E0', event_type: 'ItemAdded', schema_version: 1, payload: { order_item_id: 'OTHER' } } }));
    expect(v.m.container.querySelector('.dlg')).toBeNull();
    // the queue sent the round: its ItemAdded arrives
    act(() => s.live.frame({ type: 'event', seq: 5, event: { event_id: 'E1', event_type: 'ItemAdded', schema_version: 1, payload: { order_item_id: 'N' } } }));
    expect(v.m.container.querySelector('.dlg')?.textContent).toContain('Comp the new Chicken Karahi?');
  });

  it('[02b §8 Table view] replacement removed then the dish added again → the same prompt (return_of, live_units)', () => {
    const s = makeShell();
    const src = fakeSource();
    const asNew = vi.fn();
    const remade = sline('K', { stage: 'returned', returned_units: 1 });
    const removed = sline('R', { return_of: 'K', stage: 'removed', live_units: 0, removed_units: 1, served_at: null });
    const v = render(s.shell, <View o={order([remade, removed])} onSendAsNew={asNew} />);
    v.select('K');
    v.m.click(v.m.button('Send it as a new item', v.ctrl()!));
    expect(asNew).toHaveBeenCalledWith(remade);
    // a live replacement: no "new item" — Return sits on the replacement
    v.rerender(<View o={order([remade, sline('R', { return_of: 'K' })])} onSendAsNew={asNew} />);
    v.select('K');
    expect(v.ctrl()?.textContent ?? '').not.toContain('new item');

    // the new round is sent → the same prompt
    const orders = [order([remade, removed]), { ...order([again]), order_id: 'O2' }];
    v.rerender(<CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4' });
    v.rerender(<CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    expect(v.m.container.querySelector('.dlg')?.textContent).toContain('Comp the new Chicken Karahi?');
  });
});

describe('[02b §8 Table view] send back and comp-it — review #183', () => {
  const again = sline('N', { order_id: 'O2', stage: 'added', fired: true, served_at: null, served_source: null, added_at: NOW });

  it('[02b §6.7] Send back: a lost reply is sent again with the same command_id and return_order_item_id', async () => {
    let n = 0;
    const s = makeShell({ returnAnswer: () => (++n === 1 ? { ok: false, error: { kind: 'network' } } : ok({ eta_ms: AT_830, promise_ms: AT_830 })) });
    const v = render(s.shell, <View o={order([sline('K')])} />);
    v.select('K');
    v.m.click(v.m.button('Send back', v.ctrl()!));
    v.m.click(v.m.button('Fix', v.m.container.querySelector('.dlg')!));
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('No answer from the hub — try again');
    // the other mode cannot be sent instead while the first waits for its answer
    expect((v.m.button('Remake', v.m.container.querySelector('.dlg')!) as HTMLButtonElement).disabled).toBe(true);
    v.m.click(v.m.button('Fix', v.m.container.querySelector('.dlg')!));
    await flush();
    const [a, b] = s.calls('ReturnToKitchen');
    expect(b!.commandId).toBe(a!.commandId);
    expect(b!.payload).toEqual(a!.payload);
    expect(s.shell.toasts.current()?.text).toBe('Sent back · ready at 8:30 PM');
  });

  it('[02b §3.8] Send back hidden offline and while a Fix is still open', () => {
    const off = makeShell({ online: false });
    const v = render(off.shell, <View o={order([sline('K')])} />);
    v.select('K');
    expect(v.ctrl()?.textContent ?? '').not.toContain('Send back');
    current?.unmount();
    const on = makeShell();
    // Fix: the replacement line is open (not served) and the original is not "returned"
    const w = render(on.shell, <View o={order([sline('K'), sline('R', { return_of: 'K', stage: 'cooking', served_at: null, served_source: null })])} />);
    w.select('K');
    expect(w.ctrl()?.textContent ?? '').not.toContain('Send back');
  });

  it('[02b §3.9] Comp it? only when Comp could be given: grant, online, not billed, no open request', () => {
    const cases: Array<[string, Parameters<typeof makeShell>[0], Partial<LineOrder>]> = [
      ['no grant', { perms: { 'take-order': { grant: 'allowed', scope: 'branch' } } }, {}],
      ['offline', { online: false }, {}],
      ['billed', {}, { billed: true }],
    ];
    for (const [, o, over] of cases) {
      const s = makeShell(o);
      const src = fakeSource();
      const orders = [{ ...order([again]), order_id: 'O2', ...over }];
      const v = render(s.shell, <CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
      src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4' });
      expect(v.m.container.querySelector('.dlg')).toBeNull();
      current?.unmount();
    }
    // an open request on the line (hub pending_comp)
    const s = makeShell();
    const src = fakeSource();
    const orders = [{ ...order([{ ...again, pending_comp: { alert_id: 'A7', units: 1, value_minor: 220_000 } }]), order_id: 'O2' }];
    const v = render(s.shell, <CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4' });
    expect(v.m.container.querySelector('.dlg')).toBeNull();
  });

  it('[02b E-7] a queued round whose ItemAdded arrives while no prompt is on screen is asked later', () => {
    const s = makeShell();
    const src = fakeSource();
    const orders = [{ ...order([again]), order_id: 'O2' }];
    // the table view was open when the round was queued, then closed
    const v = render(s.shell, <CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    src.emit({ order_id: 'O2', order_item_id: 'N', item_id: 'KARAHI', seating_id: 'S4', queued: true });
    v.rerender(<div />);
    act(() => s.live.frame({ type: 'event', seq: 9, event: { event_id: 'E9', event_type: 'ItemAdded', schema_version: 1, payload: { order_item_id: 'N' } } }));
    // the table view opens again
    v.rerender(<CompItPrompt seating_id="S4" orders={orders} source={src.source} onChanged={() => {}} />);
    expect(v.m.container.querySelector('.dlg')?.textContent).toContain('Comp the new Chicken Karahi?');
  });
});
