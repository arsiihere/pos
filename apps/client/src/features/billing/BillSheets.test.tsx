import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createPermissions } from '../staff/shell/permissions';
import { createToastBus } from '../staff/shell/toast';
import { canDiscount, DiscountSheet, ServiceChargeRow, ServiceChargeSheet } from './BillSheets';
import type { BillView } from './contracts';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.14 §8 (discount sheet, service charge row), §6.6–§6.8, B7, B8 (plan §3.1 task 37; brief §3.5, §3.5.1,
// §3.5.2; frames Discount, DiscountWaiting, ServiceChargeRemove, ServiceChargeWaiting). The buyer sheet is task 18's.

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };

const tot = (total_minor: number, service_charge_minor = 0) => ({ subtotal_minor: 571_000, discount_minor: 0, service_charge_minor, taxes: [], rounding_minor: 0, total_minor });

function bill(over: Partial<BillView> = {}): BillView {
  return {
    bill_id: 'B7',
    state: 'open',
    order_type: 'dine_in',
    identifier: 'T7',
    lines: [],
    splits: [],
    currency: { code: 'PKR', exponent: 2 },
    as_of_seq: 3,
    service_charge: { rate_bp: 500, removed: false },
    discount: null,
    totals_default: tot(662_400, 15_000),
    open_requests: [],
    prints: [],
    blocks: [],
    reopen_count: 0,
    check_printed_at: null,
    buyer: { required: false, threshold_minor: null, waived: false },
    ...over,
  };
}

interface Opts {
  answers?: Answer[];
  grants?: Record<string, 'allowed' | 'requires_approval'>;
  billing?: unknown;
}

function setup(o: Opts = {}) {
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { bill_id: 'B7', changed: true } };
  });
  const toasts = createToastBus();
  const shown: Array<{ text: string; tone?: string }> = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x as { text: string; tone?: string });
    show(x);
  };
  const grants = Object.fromEntries(Object.entries(o.grants ?? { 'apply-discount': 'allowed', 'remove-service-charge': 'allowed' }).map(([k, g]) => [k, { grant: g, scope: 'branch' }]));
  const snapshot = { currency_code: 'PKR', ...(o.billing === undefined ? {} : { billing: o.billing }) };
  const shell = {
    api: { query: vi.fn(), command },
    live: createLiveBus(),
    toasts,
    permissions: createPermissions(grants as never),
    config: { config: () => null, snapshot: () => snapshot, subscribe: () => () => {} },
    clock: { nowMs: () => Date.UTC(2026, 10, 20, 13, 42), utcOffsetMs: 0 },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, command, shown };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function show(s: ReturnType<typeof setup>, node: React.ReactNode) {
  view = mount();
  view.render(<ShellContext.Provider value={s.shell}>{node}</ShellContext.Provider>);
  await flush();
  return view;
}

const primary = (v: Mounted) => v.container.querySelector<HTMLButtonElement>('.acts .btn--primary')!;
const type = (el: HTMLInputElement | HTMLTextAreaElement | null, text: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, text);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('[05 §8; §6.6, B7] discount sheet (task 37)', () => {
  it('only while the bill is open or projected and no split is closed (hidden once a split is closed)', () => {
    expect(canDiscount(bill())).toBe(true);
    expect(canDiscount(bill({ bill_id: null, state: 'projected' }))).toBe(true);
    expect(canDiscount(bill({ state: 'partly_paid' }))).toBe(false);
    expect(canDiscount(bill({ state: 'closed' }))).toBe(false);
    const closedSplit = { split_no: 1, state: 'closed' as const, plan: null, payments: [], totals: { cash: tot(0), digital: tot(0), as_paid: tot(0) }, balance_minor: 0, invoice: null };
    expect(canDiscount(bill({ splits: [closedSplit] }))).toBe(false);
  });

  it('the primary names the missing step: value → reason → note for Other → the action; reasons from the branch settings', async () => {
    const billing = { discount_reasons: [{ code: 'regular', label: 'Regular customer' }, { code: 'other', label: 'Other' }] };
    const v = await show(setup({ billing }), <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Discount the bill');
    expect([...v.container.querySelectorAll('.b5-chip')].map((c) => c.textContent)).toEqual(['Regular customer', 'Other']);
    expect(primary(v).textContent).toBe('Type the discount first');
    v.click(v.button('Percent'));
    type(v.container.querySelector('.b5-in input'), '10');
    await flush();
    expect(primary(v).textContent).toBe('Pick a reason');
    v.click(v.button('Other'));
    expect(primary(v).textContent).toBe('Write why first');
    type(v.container.querySelector('textarea'), 'Family friend');
    await flush();
    expect(v.container.querySelector('.b5-count')?.textContent).toBe('13 / 200');
    expect(primary(v).textContent).toBe('Give discount');
  });

  it('with no billing key in the snapshot the reasons are the hub defaults (defaultBillingSettings)', async () => {
    const v = await show(setup(), <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    expect([...v.container.querySelectorAll('.b5-chip')].map((c) => c.textContent)).toEqual(['Regular customer', 'Staff', 'Owner guest', 'Complaint', 'Other']);
  });

  it('allowed: ApplyDiscount { bill_ref, kind, value (bp / minor), reason_code } → applied → toast and onDone', async () => {
    const s = setup({ answers: [{ ok: true, data: { applied: tot(600_000) } }] });
    const done: unknown[] = [];
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ seating_id: 'S7' }} onDone={(r) => done.push(r)} onClose={() => {}} />);
    v.click(v.button('Percent'));
    type(v.container.querySelector('.b5-in input'), '12.5');
    v.click(v.button('Regular customer'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![0]).toBe('ApplyDiscount');
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { seating_id: 'S7' }, kind: 'percent', value: 1_250, reason_code: 'regular_customer' });
    expect(s.shown).toEqual([{ text: 'Discount applied', tone: 'ok' }]);
    expect(done).toEqual(['applied']);
  });

  it('by amount: the typed amount in minor units at the currency exponent; a bad amount is not sent', async () => {
    const s = setup({ answers: [{ ok: true, data: { applied: tot(600_000) } }] });
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    v.click(v.button('Staff'));
    type(v.container.querySelector('.b5-in input'), '1.234');
    await flush();
    expect(primary(v).textContent).toBe('Type the discount first');
    type(v.container.querySelector('.b5-in input'), '500');
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, kind: 'amount', value: 50_000, reason_code: 'staff' });
  });

  it('a percent above 100 % or with more than 2 decimals is not sent', async () => {
    const s = setup();
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    v.click(v.button('Percent'));
    v.click(v.button('Staff'));
    for (const bad of ['101', '0', '10.555']) {
      type(v.container.querySelector('.b5-in input'), bad);
      await flush();
      expect(primary(v).textContent, bad).toBe('Type the discount first');
    }
  });

  it('requires_approval: "Ask for approval" + Needs approval tag → pending → the waiting card in the sheet\'s place; Withdraw sends WithdrawRequest', async () => {
    const s = setup({ grants: { 'apply-discount': 'requires_approval' }, answers: [{ ok: true, data: { bill_id: 'B7', pending: { alert_id: 'A9' } } }, { ok: true, data: {} }] });
    const done: unknown[] = [];
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={(r) => done.push(r)} onClose={() => {}} />);
    v.click(v.button('Percent'));
    type(v.container.querySelector('.b5-in input'), '10');
    v.click(v.button('Regular customer'));
    await flush();
    expect(primary(v).textContent).toBe('Ask for approvalNeeds approval');
    expect(primary(v).querySelector('.ntag')?.textContent).toBe('Needs approval');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.b5-wait b')?.textContent).toBe('Waiting for approval');
    expect(v.container.querySelector('.b5-wait span')?.textContent).toBe('10 % · Regular customer');
    expect(v.text()).toContain('Close waits until the discount is answered');
    expect(done).toEqual(['pending']);
    v.click(v.button('Withdraw'));
    await flush();
    expect(s.command.mock.calls[1]).toEqual(['WithdrawRequest', { alert_id: 'A9' }, expect.anything()]);
    expect(done).toEqual(['pending', 'withdrawn']);
  });

  it('an open discount request on the bill (open_requests) opens the sheet on its waiting card', async () => {
    const v = await show(setup(), <DiscountSheet bill={bill({ open_requests: [{ kind: 'discount', alert_id: 'A5' }] })} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    expect(v.container.querySelector('.b5-wait b')?.textContent).toBe('Waiting for approval');
    expect(v.button('Back to the bill')).toBeTruthy();
  });

  it('DISCOUNT_TOO_LARGE reads "The most you can give is <max>"; BILL_PARTLY_PAID its text', async () => {
    const s = setup({
      answers: [
        { ok: false, error: { kind: 'api', status: 422, code: 'DISCOUNT_TOO_LARGE', details: { max_minor: 571_000 } } },
        { ok: false, error: { kind: 'api', status: 409, code: 'BILL_PARTLY_PAID', details: { bill_id: 'B7' } } },
      ],
    });
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    type(v.container.querySelector('.b5-in input'), '9000');
    v.click(v.button('Staff'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg')?.textContent).toBe('The most you can give is Rs 5,710.00');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg')?.textContent).toBe('A split is already paid — no discount now');
  });

  it('Remove discount: reason (+ note for Other) → RemoveDiscount { bill_id, reason_code } → toast "Discount removed"', async () => {
    const s = setup({ answers: [{ ok: true, data: { bill_id: 'B7', changed: true } }] });
    const done: unknown[] = [];
    const b = bill({ discount: { kind: 'percent', value: 1_000, reason_code: 'regular_customer', frozen_minor: null, discount_minor: 57_100 } });
    const v = await show(s, <DiscountSheet bill={b} billRef={{ bill_id: 'B7' }} onDone={(r) => done.push(r)} onClose={() => {}} />);
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Remove the discount');
    expect(v.text()).toContain('10 % · Rs 571.00');
    expect(primary(v).textContent).toBe('Pick a reason');
    v.click(v.button('Complaint'));
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['RemoveDiscount', { bill_id: 'B7', reason_code: 'complaint' }, expect.anything()]);
    expect(s.shown).toEqual([{ text: 'Discount removed', tone: 'ok' }]);
    expect(done).toEqual(['removed']);
  });

  it('[review m3, m9] Withdraw on a request already answered (REQUEST_NOT_PENDING) counts as done; the card goes once the bill no longer lists it', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'REQUEST_NOT_PENDING', details: {} } }] });
    const done: unknown[] = [];
    const b = bill({ open_requests: [{ kind: 'discount', alert_id: 'A5' }] });
    const v = await show(s, <DiscountSheet bill={b} billRef={{ bill_id: 'B7' }} onDone={(r) => done.push(r)} onClose={() => {}} />);
    v.click(v.button('Withdraw'));
    await flush();
    expect(done).toEqual(['withdrawn']);
    v.render(
      <ShellContext.Provider value={s.shell}>
        <DiscountSheet bill={bill({ as_of_seq: 9 })} billRef={{ bill_id: 'B7' }} onDone={(r) => done.push(r)} onClose={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(v.container.querySelector('.b5-wait')).toBeNull();
  });

  it('[review m4] Withdraw of someone else\'s request reads its own text (PERMISSION_DENIED not_requester)', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'not_requester' } } }] });
    const v = await show(s, <DiscountSheet bill={bill({ open_requests: [{ kind: 'discount', alert_id: 'A5' }] })} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    v.click(v.button('Withdraw'));
    await flush();
    expect(v.container.querySelector('.msg')?.textContent).toBe('Only the person who asked can withdraw it');
  });

  it('[review m5, B7] a bill with a discount: mode apply changes it (ApplyDiscount, replaces); the default is remove', async () => {
    const s = setup({ answers: [{ ok: true, data: { applied: tot(600_000) } }] });
    const b = bill({ discount: { kind: 'percent', value: 1_000, reason_code: 'regular_customer', frozen_minor: null, discount_minor: 57_100 } });
    const v = await show(s, <DiscountSheet bill={b} billRef={{ bill_id: 'B7' }} mode="apply" onDone={() => {}} onClose={() => {}} />);
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Discount the bill');
    v.click(v.button('Percent'));
    type(v.container.querySelector('.b5-in input'), '15');
    v.click(v.button('Staff'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![0]).toBe('ApplyDiscount');
  });

  it('[review m8] after a lost reply, editing only the note resends the same command_id (the hub leaves the note out of the payload hash)', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { applied: tot(1) } }] });
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    type(v.container.querySelector('.b5-in input'), '100');
    v.click(v.button('Staff'));
    type(v.container.querySelector('textarea'), 'first');
    await flush();
    v.click(primary(v));
    await flush();
    type(v.container.querySelector('textarea'), 'second try');
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[1]![2]?.commandId).toBe(s.command.mock.calls[0]![2]?.commandId);
  });

  it('[review m2, money] the amount is read at the bill\'s currency exponent (KWD 3)', async () => {
    const s = setup({ answers: [{ ok: true, data: { applied: tot(1) } }] });
    const v = await show(s, <DiscountSheet bill={bill({ currency: { code: 'KWD', exponent: 3 } })} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    type(v.container.querySelector('.b5-in input'), '1.5');
    v.click(v.button('Staff'));
    await flush();
    v.click(primary(v));
    await flush();
    expect((s.command.mock.calls[0]![1] as { value: number }).value).toBe(1_500);
  });

  it('[review m7] on a phone the sheet has the grip and two-column reasons', async () => {
    const s = setup();
    (s.shell as { phone: boolean }).phone = true;
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    expect(v.container.querySelector('.scrim--sheet .dlg__grip')).not.toBeNull();
    expect(v.container.querySelector('.b5-chips')?.className).toContain('c2');
  });

  it('a lost reply: "Needs the hub", and the resend keeps the command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { applied: tot(1) } }] });
    const v = await show(s, <DiscountSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    type(v.container.querySelector('.b5-in input'), '100');
    v.click(v.button('Staff'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg')?.textContent).toBe('Needs the hub');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[1]![2]?.commandId).toBe(s.command.mock.calls[0]![2]?.commandId);
  });
});

describe('[05 §8; §6.8, B8] service charge (task 37)', () => {
  it('the row: "Service charge 5 %" with its amount and Remove; removed → "Service charge removed" with Add back (allowed only)', async () => {
    const v = await show(setup(), <ServiceChargeRow bill={bill()} billRef={{ bill_id: 'B7' }} onRemove={() => {}} onChanged={() => {}} />);
    expect(v.container.querySelector('.b5-tr > span')?.textContent).toBe('Service charge 5 %Remove');
    expect(v.container.querySelector('.b5-tr .v')?.textContent).toBe('150.00');
    v.unmount();
    view = null;
    const removed = bill({ service_charge: { rate_bp: 500, removed: true }, totals_default: tot(647_400, 0) });
    const w = await show(setup(), <ServiceChargeRow bill={removed} billRef={{ bill_id: 'B7' }} onRemove={() => {}} onChanged={() => {}} />);
    expect(w.container.querySelector('.b5-tr')?.className).toContain('gone');
    expect(w.container.querySelector('.b5-tr > span')?.textContent).toBe('Service charge removedAdd back');
    w.unmount();
    view = null;
    const x = await show(setup({ grants: { 'remove-service-charge': 'requires_approval' } }), <ServiceChargeRow bill={removed} billRef={{ bill_id: 'B7' }} onRemove={() => {}} onChanged={() => {}} />);
    expect(x.buttons().some((b) => b.textContent === 'Add back')).toBe(false);
  });

  it('no charge on the bill (rate 0, R-61): no row', async () => {
    const v = await show(setup(), <ServiceChargeRow bill={bill({ service_charge: { rate_bp: 0, removed: false } })} billRef={{ bill_id: 'B7' }} onRemove={() => {}} onChanged={() => {}} />);
    expect(v.container.querySelector('.b5-tr')).toBeNull();
  });

  it('Add back: an inline confirm "Add the 5 % back?" → ApplyServiceCharge { bill_ref } → onChanged', async () => {
    const s = setup();
    const changed: unknown[] = [];
    const removed = bill({ service_charge: { rate_bp: 500, removed: true } });
    const v = await show(s, <ServiceChargeRow bill={removed} billRef={{ bill_id: 'B7' }} onRemove={() => {}} onChanged={() => changed.push(1)} />);
    v.click(v.button('Add back'));
    expect(v.text()).toContain('Add the 5 % back?');
    expect(s.command).not.toHaveBeenCalled();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.b5-confirm button')].find((b) => b.textContent === 'Add back'));
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['ApplyServiceCharge', { bill_ref: { bill_id: 'B7' } }, expect.anything()]);
    expect(changed).toEqual([1]);
  });

  it('the remove sheet: CHARGE_REMOVE_REASONS → RemoveServiceCharge; changed → toast, changed:false → just a refresh', async () => {
    const s = setup({ answers: [{ ok: true, data: { bill_id: 'B7', changed: true } }, { ok: true, data: { bill_id: 'B7', changed: false } }] });
    const done: unknown[] = [];
    const v = await show(s, <ServiceChargeSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={(r) => done.push(r)} onClose={() => {}} />);
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Remove service charge');
    expect([...v.container.querySelectorAll('.b5-chip')].map((c) => c.textContent)).toEqual(['Customer asked', 'Service complaint', 'Staff meal', 'Other']);
    expect(v.container.querySelector('.fact b')?.textContent).toBe('5 % · Rs 150.00');
    v.click(v.button('Service complaint'));
    expect(primary(v).textContent).toBe('Remove service charge');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['RemoveServiceCharge', { bill_ref: { bill_id: 'B7' }, reason_code: 'service_complaint' }, expect.anything()]);
    expect(s.shown).toEqual([{ text: 'Service charge removed', tone: 'ok' }]);
    v.click(primary(v));
    await flush();
    expect(done).toEqual(['removed', 'unchanged']);
    expect(s.shown.length).toBe(1);
  });

  it('requires_approval: pending → waiting card (R-59: a second ask answers the open one the same way); Other needs a note', async () => {
    const s = setup({ grants: { 'remove-service-charge': 'requires_approval' }, answers: [{ ok: true, data: { bill_id: 'B7', pending: { alert_id: 'A3' } } }] });
    const v = await show(s, <ServiceChargeSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    v.click(v.button('Other'));
    expect(primary(v).textContent).toBe('Write why first');
    type(v.container.querySelector('textarea'), 'Owner asked');
    await flush();
    expect(primary(v).textContent).toBe('Ask for approvalNeeds approval');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, reason_code: 'other', note: 'Owner asked' });
    expect(v.container.querySelector('.b5-wait span')?.textContent).toBe('Remove service charge · Other');
  });

  it('[review m9] the service-charge waiting card: Withdraw sends WithdrawRequest and reports withdrawn', async () => {
    const s = setup({ answers: [{ ok: true, data: {} }] });
    const done: unknown[] = [];
    const v = await show(s, <ServiceChargeSheet bill={bill({ open_requests: [{ kind: 'remove_service_charge', alert_id: 'A3' }] })} billRef={{ bill_id: 'B7' }} onDone={(r) => done.push(r)} onClose={() => {}} />);
    v.click(v.button('Withdraw'));
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['WithdrawRequest', { alert_id: 'A3' }, expect.anything()]);
    expect(done).toEqual(['withdrawn']);
  });

  it('[review m10] a closed bill\'s row shows the charge without Remove / Add back', async () => {
    const v = await show(setup(), <ServiceChargeRow bill={bill({ state: 'closed' })} billRef={{ bill_id: 'B7' }} onRemove={() => {}} onChanged={() => {}} />);
    expect(v.container.querySelector('.b5-tr')).not.toBeNull();
    expect(v.buttons().length).toBe(0);
  });

  it('SERVICE_CHARGE_NOT_APPLIED (R-58) reads its text', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'SERVICE_CHARGE_NOT_APPLIED', details: { bill_id: 'B7' } } }] });
    const v = await show(s, <ServiceChargeSheet bill={bill()} billRef={{ bill_id: 'B7' }} onDone={() => {}} onClose={() => {}} />);
    v.click(v.button('Staff meal'));
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg')?.textContent).toBe('The service charge was already removed');
  });

  it('[05 §8 Rules] every task-37 key is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 37)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(25);
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
    }
  });
});
