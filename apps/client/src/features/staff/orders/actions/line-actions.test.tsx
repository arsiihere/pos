import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { setLanguage } from '../../../../i18n';
import type { Resolution } from '../../api';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { Enqueue, EnqueueResult } from '../../tables/contracts';
import type { CatchUpOrder, OrdersApi, SeatingLine } from '../contracts';
import { LineActions, type LineOrder } from '../view/LineActions';
import { LineRow } from '../view/LineRow';
import { OrderView } from '../view/OrderView';
import { gramsOf } from './WeightSheet';

// 02b v1.0.11 §8 Table view (02-D08 MarkServed, 02b-D31 Remove, 02b-D34 EnterWeight, 02b-D35 Contact): the line
// actions of a selected line and their sheets.

const OFFSET = 5 * 3_600_000;
const NOW = Date.UTC(2026, 10, 13, 15, 15);

function sline(order_item_id: string, over: Partial<SeatingLine> = {}): SeatingLine {
  return {
    order_item_id,
    order_id: 'O1',
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: `I-${order_item_id}`,
    deal_id: null,
    name: order_item_id,
    sale_unit: 'piece',
    quantity: 1,
    units: 1,
    live_units: 1,
    comped_units: 0,
    removed_units: 0,
    voided_units: 0,
    returned_units: 0,
    refundable_minor: 50_000,
    comp_minor: 0,
    comp_voided_minor: 0,
    removed_minor: 0,
    refund_minor: 0,
    line_total_minor: 50_000,
    billed_minor: 50_000,
    return_of: null,
    served_from_zone_id: null,
    zone_served: false,
    added_at: NOW - 10 * 60_000,
    served_at: null,
    served_source: null,
    is_food: true,
    kitchen_note: null,
    stage: 'added',
    fired: false,
    ...over,
  };
}

const ALL: Record<string, Resolution> = {
  'mark-served': { grant: 'allowed', scope: 'branch' },
  'take-order': { grant: 'allowed', scope: 'branch' },
  'set-line-weight': { grant: 'allowed', scope: 'branch' },
  'void-item': { grant: 'allowed', scope: 'branch' },
  'view-customer-contact': { grant: 'allowed', scope: 'branch' },
};

const ok = <T,>(data: T) => ({ ok: true as const, data });

function makeShell(o: { perms?: Record<string, Resolution>; enqueue?: EnqueueResult; catchUp?: CatchUpOrder[]; weighed?: string[]; command?: () => Promise<unknown> } = {}) {
  const live = createLiveBus();
  live.frame({ type: 'catch_up', as_of_seq: 3, state: { orders: { orders: o.catchUp ?? [], zone_stock: [] } } } as never);
  const orders = {
    removeItems: vi.fn(async () => ok({ removed: [], cancelled: false, comp_requests_closed: [] })),
    setLineWeight: vi.fn(async () => ok({ line_total_minor: 350_000 })),
    orderContact: vi.fn(async () => ok({ customer_name: 'Usman', phone: '03217654321' })),
    orderView: vi.fn(async () => ok({ kind: 'missing' as const })),
    openOrders: vi.fn(async () => ok({ orders: [] })),
    boostOrder: vi.fn(async () => ok({})),
  };
  const send = vi.fn(async () => o.enqueue ?? { status: 'sent' as const, result: { served: 1, skipped: [] } });
  const enqueue = Object.assign(send, { pendingFor: () => 0, pendingCount: () => 0, subscribe: () => () => {} });
  const items = (o.weighed ?? []).map((item_id) => ({ item_id, price_minor: 280_000, requires_weighing: true }));
  const command = vi.fn(o.command ?? (async () => ok({ removed: [] })));
  const shell = {
    device: { token: 'D', id: 'DEV', type: 'tablet' },
    live,
    orders: orders as unknown as OrdersApi,
    api: { command },
    tables: { tableMap: vi.fn(async () => ok({ as_of_seq: 1, floors: [] })) },
    permissions: createPermissions(o.perms ?? ALL),
    toasts: createToastBus(),
    enqueue: enqueue as unknown as Enqueue,
    clock: { nowMs: () => NOW, utcOffsetMs: OFFSET },
    config: { snapshot: () => ({ items }), config: () => null },
    me: { staff_id: 'ST-ALI', name: 'Ali' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, orders, send, command };
}

function Harness({ order, onChanged }: { order: LineOrder; onChanged: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="rnd">
      {order.lines.map((l) => (
        <LineRow key={l.order_item_id} line={l} mode="stages" utcOffsetMs={OFFSET} selected={sel === l.order_item_id} onSelect={(id) => setSel(sel === id ? null : id)}>
          <LineActions line={l} order={order} onChanged={onChanged} />
        </LineRow>
      ))}
    </div>
  );
}

function setup(order: LineOrder, o: Parameters<typeof makeShell>[0] = {}) {
  const s = makeShell(o);
  const onChanged = vi.fn();
  const m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <Harness order={order} onChanged={onChanged} />
    </ShellContext.Provider>,
  );
  current = m;
  const select = (id: string) => m.click(m.container.querySelector(`.ol[data-line="${id}"]`));
  const ctrl = () => m.container.querySelector('.ol__ctrl');
  const ctrlText = () => [...(ctrl()?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
  return { ...s, m, onChanged, select, ctrl, ctrlText };
}

const dineIn = (lines: SeatingLine[]): LineOrder => ({ order_id: 'O1', order_type: 'dine_in', ident: 'F4 + F5', billed: false, lines, seating_id: 'S4', table_id: 'F4' });

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  setLanguage('en');
});

describe('[02b §8 Table view] line actions', () => {
  it('[02b §8 Table view] Mark served only for fired lines; ready lines pre-ticked; queues offline through Enqueue', async () => {
    const order = dineIn([
      sline('Handi', { stage: 'added', fired: false }),
      sline('Kebab', { stage: 'added', fired: true, quantity: 4, units: 4, live_units: 4 }),
      sline('Naan', { stage: 'done', fired: true, quantity: 6, units: 6, live_units: 6 }),
    ]);
    const s = setup(order, { enqueue: { status: 'queued', entry_id: 'E1' } });
    s.select('Handi');
    expect(s.ctrlText()).not.toContain('Mark served');
    s.select('Kebab');
    expect(s.ctrlText()).toContain('Mark served');
    s.m.click(s.m.button('Mark served', s.ctrl()!));
    const rows = [...s.m.container.querySelectorAll('.dlg .ckr')];
    // the unfired line is not offered; the ready line is ticked
    expect(rows.map((r) => [r.getAttribute('data-line'), r.getAttribute('aria-checked')])).toEqual([
      ['Kebab', 'false'],
      ['Naan', 'true'],
    ]);
    s.m.click(s.m.button('Mark 1 served'));
    await flush();
    expect(s.send).toHaveBeenCalledWith('MarkServed', { lines: [{ order_id: 'O1', order_item_ids: ['Naan'] }] }, { label: 'Mark served · F4 + F5', table_id: 'F4', seating_id: 'S4' });
    expect(s.shell.toasts.current()?.text).toBe('Will be sent when the hub is back');
    expect(s.m.container.querySelector('.dlg')).toBeNull();
  });

  it('[02b §8 Table view] Remove: stage 1 only, units stepper; cooking lines point to Void', async () => {
    const order = dineIn([
      sline('Seekh', { stage: 'added', fired: true, quantity: 4, units: 4, live_units: 4 }),
      sline('Deal', { line_kind: 'deal', stage: null, item_id: null, deal_id: 'D1' }),
      sline('Handi', { line_kind: 'deal_part', parent_order_item_id: 'Deal', stage: 'added' }),
      sline('Karahi', { stage: 'cooking', fired: true }),
    ]);
    const s = setup(order);
    s.select('Karahi');
    expect(s.ctrlText()).not.toContain('Remove');
    s.select('Seekh');
    s.m.click(s.m.button('Remove', s.ctrl()!));
    const dlg = s.m.container.querySelector('.dlg')!;
    const row = (id: string) => dlg.querySelector(`.ckr[data-line="${id}"]`)!;
    expect(row('Seekh').getAttribute('aria-checked')).toBe('true');
    expect(row('Seekh').textContent).toContain('Remove 1 of 4 · not cooking yet');
    expect(row('Deal').textContent).toContain('Later · its parts follow');
    // a deal part goes with its deal: no row of its own
    expect(dlg.querySelector('.ckr[data-line="Handi"]')).toBeNull();
    expect(row('Karahi').textContent).toContain('Already cooking — use Void');
    expect(row('Karahi').getAttribute('role')).toBeNull();
    s.m.click(s.m.button('+', row('Seekh')));
    expect(row('Seekh').textContent).toContain('Remove 2 of 4');
    s.m.click(s.m.button('Remove 2'));
    await flush();
    expect(s.command).toHaveBeenCalledWith('RemoveItems', { order_id: 'O1', seating_id: 'S4', lines: [{ order_item_id: 'Seekh', units: 2 }] }, { commandId: expect.any(String) });
    expect(s.onChanged).toHaveBeenCalled();
  });

  it('[02b §6.2] Remove: a lost reply is sent again with the same command_id; one removal', async () => {
    let calls = 0;
    const order = dineIn([sline('Seekh', { stage: 'added', quantity: 4, units: 4, live_units: 4 })]);
    const s = setup(order, { command: async () => (++calls === 1 ? { ok: false, error: { kind: 'network' } } : ok({ removed: [{ order_item_id: 'Seekh', units: 1 }] })) });
    s.select('Seekh');
    s.m.click(s.m.button('Remove', s.ctrl()!));
    s.m.click(s.m.button('Remove 1'));
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('No answer from the hub — try again');
    // the submission is frozen: the ticks do not change while it waits for its answer
    const row = s.m.container.querySelector('.dlg .ckr[data-line="Seekh"]')!;
    s.m.click(row);
    expect(row.getAttribute('aria-checked')).toBe('true');
    s.m.click(s.m.button('Remove 1'));
    await flush();
    expect(s.command).toHaveBeenCalledTimes(2);
    const [first, second] = s.command.mock.calls as unknown as Array<[string, unknown, { commandId: string }]>;
    expect(second![2].commandId).toBe(first![2].commandId);
    expect(second![1]).toEqual(first![1]);
    expect(s.shell.toasts.current()?.text).toBe('Removed');
    expect(s.m.container.querySelector('.dlg')).toBeNull();
    expect(s.onChanged).toHaveBeenCalledTimes(1);
  });

  it('[02b §6.2] Remove: a refusal resets the ticks and the next submission gets a new command_id', async () => {
    let calls = 0;
    const order = dineIn([sline('Seekh', { stage: 'added', quantity: 4, units: 4, live_units: 4 })]);
    const s = setup(order, {
      command: async () => (++calls === 1 ? { ok: false, error: { kind: 'api', status: 409, code: 'ITEM_WRONG_STAGE', details: {} } } : ok({ removed: [] })),
    });
    s.select('Seekh');
    s.m.click(s.m.button('Remove', s.ctrl()!));
    s.m.click(s.m.button('Remove 1'));
    await flush();
    expect(s.shell.toasts.current()?.text).toBe('This item has moved on — refreshed');
    expect(s.m.container.querySelector('.dlg .ckr[data-line="Seekh"]')?.getAttribute('aria-checked')).toBe('false');
    expect((s.m.button('Remove 0') as HTMLButtonElement).disabled).toBe(true);
    s.m.click(s.m.container.querySelector('.dlg .ckr[data-line="Seekh"]'));
    s.m.click(s.m.button('Remove 1'));
    await flush();
    const [first, second] = s.command.mock.calls as unknown as Array<[string, unknown, { commandId: string }]>;
    expect(second![2].commandId).not.toBe(first![2].commandId);
  });

  it('[02b §3.5] Remove: an unserved no-station drink and a deal with a no-station part are removable', () => {
    const order = dineIn([
      sline('Drink', { stage: null, fired: false }),
      sline('Deal', { line_kind: 'deal', stage: null, item_id: null, deal_id: 'D1' }),
      sline('Cola', { line_kind: 'deal_part', parent_order_item_id: 'Deal', stage: null }),
      sline('Handi', { line_kind: 'deal_part', parent_order_item_id: 'Deal', stage: 'added' }),
    ]);
    const s = setup(order);
    s.select('Drink');
    expect(s.ctrlText()).toContain('Remove');
    s.select('Deal');
    expect(s.ctrlText()).toContain('Remove');
    s.m.click(s.m.button('Remove', s.ctrl()!));
    expect(s.m.container.querySelector('.dlg .ckr[data-line="Drink"]')?.getAttribute('role')).toBe('checkbox');
  });

  it('[02b Q-24] "Void…" disabled "Comes with module 04"', () => {
    const order = dineIn([sline('Karahi', { stage: 'cooking', fired: true }), sline('Seekh', { stage: 'added' })]);
    const s = setup(order);
    s.select('Karahi');
    const v = s.m.button('Void…', s.ctrl()!) as HTMLButtonElement;
    expect(v.disabled).toBe(true);
    expect(v.textContent).toContain('Comes with module 04');
    // a stage-1 line has Remove, no Void
    s.select('Seekh');
    expect(s.ctrlText().some((x) => x?.includes('Void'))).toBe(false);
    // without the void permission the button is not drawn (R5)
    current?.unmount();
    const w = setup(order, { perms: { 'take-order': { grant: 'allowed', scope: 'branch' } } });
    w.select('Karahi');
    expect(w.m.container.querySelector('.ol__ctrl')?.textContent ?? '').not.toContain('Void');
    // nor in the Remove sheet: the row still says to use Void
    w.select('Seekh');
    w.m.click(w.m.button('Remove', w.m.container.querySelector('.ol__ctrl')!));
    const karahi = w.m.container.querySelector('.dlg .ckr[data-line="Karahi"]')!;
    expect(karahi.textContent).toContain('Already cooking — use Void');
    expect(karahi.querySelector('button')).toBeNull();
  });

  it('[02b §3.6] weight entry: kg pad, live total, SetLineWeight in 50 g steps', async () => {
    const fish = sline('Fish', { name: 'Fish', item_id: 'FISH', sale_unit: 'g', quantity: null, line_total_minor: null, refundable_minor: 0, billed_minor: 0 });
    const s = setup(dineIn([fish]), { weighed: ['FISH'] });
    s.select('Fish');
    s.m.click(s.m.button('Enter weight', s.ctrl()!));
    const dlg = () => s.m.container.querySelector('.dlg')!;
    expect(dlg().textContent).toContain('Enter weight · Fish');
    expect(dlg().textContent).toContain('50 g steps');
    // no price from today's menu: the line's money is the hub's (its ItemAdded copy, 01c M7)
    expect(dlg().textContent).not.toContain('Rs');
    const pad = (k: string) => s.m.click([...dlg().querySelectorAll('.wpad .btn')].find((b) => b.textContent === k));
    for (const k of ['1', '.', '2', '3']) pad(k);
    const save = () => s.m.button('Save', dlg()) as HTMLButtonElement;
    // 1.23 kg is not a 50 g step
    expect(save().disabled).toBe(true);
    pad('Delete');
    pad('5');
    expect(dlg().querySelector('.inp')?.textContent).toContain('1.25');
    expect(dlg().querySelector('.inp')?.textContent).toContain('kg');
    s.m.click(save());
    await flush();
    expect(s.orders.setLineWeight).toHaveBeenCalledWith({ order_item_id: 'Fish', quantity: 1250 });
    // the live total is the hub's saved line_total_minor
    expect(s.shell.toasts.current()?.text).toBe('Weight saved · Rs 3,500');

    expect([gramsOf('0.05'), gramsOf('50'), gramsOf('0.04'), gramsOf('50.05'), gramsOf('1.2'), gramsOf('')]).toEqual([50, 50_000, null, null, 1200, null]);
  });

  it('[02b §3.6] Enter weight only for requires_weighing lines; ml in L', () => {
    // a g line that is not weighed (fixed portion): no weight entry
    const portion = sline('Raita', { item_id: 'RAITA', sale_unit: 'g', quantity: 250 });
    const juice = sline('Juice', { item_id: 'JUICE', sale_unit: 'ml', quantity: 500 });
    const s = setup(dineIn([portion, juice]), { weighed: ['JUICE'] });
    s.select('Raita');
    expect(s.ctrlText().some((x) => x?.includes('Enter weight'))).toBe(false);
    expect(s.m.container.querySelector('.ol[data-line="Juice"] .ol__n')?.textContent).toContain('0.5 L');
    s.select('Juice');
    s.m.click(s.m.button('Enter weight', s.ctrl()!));
    expect(s.m.container.querySelector('.dlg .inp')?.textContent).toContain('L');
  });

  it('[02b §8 Table view] "Call" on a parking order fetches order-contact; only with view-customer-contact', async () => {
    const parking: CatchUpOrder = {
      order_id: 'O57',
      order_type: 'parking',
      table_key: 'parking:O57',
      business_date: '2026-11-13',
      token: null,
      car_number: 'LEB 1234',
      car_type: 'sedan',
      order_note: null,
      placed_by: 'ST-ALI',
      placed_at: NOW,
      follow_up: false,
      cancelled: false,
      cancelled_at: null,
      billed: false,
      billed_at: null,
      day_closed_at: null,
      sent_after_reconnect: false,
      has_phone: true,
      lines: [],
    };
    const view = (perms: Record<string, Resolution>) => {
      const s = makeShell({ perms, catchUp: [parking] });
      const m = mount();
      m.render(
        <ShellContext.Provider value={s.shell}>
          <OrderView order_id="O57" />
        </ShellContext.Provider>,
      );
      current = m;
      return { ...s, m };
    };
    const without = view({});
    await flush();
    expect(without.m.text()).not.toContain('Call');
    without.m.unmount();
    current = null;

    const s = view(ALL);
    await flush();
    expect(s.orders.orderContact).not.toHaveBeenCalled();
    s.m.click(s.m.button('Call'));
    await flush();
    expect(s.orders.orderContact).toHaveBeenCalledWith('O57');
    const dlg = s.m.container.querySelector('.dlg')!;
    expect(dlg.textContent).toContain('Parking · LEB 1234 · this look is logged');
    expect(dlg.textContent).toContain('Usman');
    expect(dlg.querySelector('.fact--amt b')?.getAttribute('dir')).toBe('ltr');
    expect(dlg.textContent).toContain('03217654321');
  });

  it('[02b Q-7] plain options under the line ("+ No onion · Less spicy"); none shown when the hub sends none', () => {
    const s = setup(
      dineIn([
        sline('Karahi', { name: 'Chicken Karahi', options: [{ name: 'No onion', quantity: 1 }, { name: 'Less spicy', quantity: 1 }], kitchen_note: 'less oil' }),
        sline('Naan', { name: 'Naan' }),
      ]),
    );
    const subs = (id: string) => [...s.m.container.querySelectorAll(`.ol[data-line="${id}"] .ol__n > span`)].map((x) => x.textContent);
    expect(subs('Karahi')).toEqual(['+ No onion · Less spicy', '“less oil”']);
    // H2 not on the hub yet: no `options` field → no options line
    expect(subs('Naan')).toEqual([]);
  });
});
