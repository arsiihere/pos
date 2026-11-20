import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import type { BillRef, BillView, BillViewSplit, Totals } from './contracts';
import { SplitEditor } from './SplitEditor';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.12 §8 "Splits", §6.5, §3.8 (plan §3.1 task 36; brief §3.3; frames SplitItems, SplitAmount, SplitEqual,
// SplitLocked, SplitInvalid): the split editor over a scripted bill view and SetSplits answers.

const tot = (total_minor: number): Totals => ({ subtotal_minor: total_minor, discount_minor: 0, service_charge_minor: 0, taxes: [], rounding_minor: 0, total_minor });
const split = (over: Partial<BillViewSplit> & { split_no: number }): BillViewSplit => ({
  state: 'open',
  plan: null,
  payments: [],
  totals: { cash: tot(0), digital: tot(0), as_paid: tot(0) },
  balance_minor: 0,
  invoice: null,
  ...over,
});
const line = (id: string, name: string, units: number, added_after_close = false) => ({ order_item_id: id, order_id: 'O1', name, units, base_minor: 100, tax_profile_id: 'p', tags: [], added_after_close });

function bill(over: Partial<BillView> = {}): BillView {
  return {
    bill_id: 'B7',
    state: 'open',
    order_type: 'dine_in',
    identifier: 'T7',
    lines: [line('K', 'Chicken Karahi Full', 1), line('N', 'Naan', 6), line('R', 'Raita', 2)],
    splits: [split({ split_no: 1, totals: { cash: tot(662_400), digital: tot(599_600), as_paid: tot(662_400) } })],
    currency: { code: 'PKR', exponent: 2 },
    as_of_seq: 3,
    service_charge: { rate_bp: 0, removed: false },
    discount: null,
    totals_default: tot(0),
    open_requests: [],
    prints: [],
    blocks: [],
    reopen_count: 0,
    check_printed_at: null,
    buyer: { required: false, threshold_minor: null, waived: false },
    ...over,
  };
}

// T4 + T5 after the first close: split 1 closed (invoice), split 2 has a payment, a later Naan in the open part
const LOCKED = bill({
  identifier: 'T4 + T5',
  state: 'partly_paid',
  lines: [line('H', 'Chicken Karahi Half', 1), line('N1', 'Naan', 2), line('M', 'Mutton Karahi Half', 1), line('L', 'Lassi', 2), line('N2', 'Naan', 2, true)],
  splits: [
    split({ split_no: 1, state: 'closed', plan: { lines: [{ order_item_id: 'H', units: 1 }, { order_item_id: 'N1', units: 2 }] }, invoice: { invoice_ref: 'AC1-S000124', fiscal_number: null, fiscal_state: 'pending' } }),
    split({
      split_no: 2,
      plan: { lines: [{ order_item_id: 'M', units: 1 }, { order_item_id: 'L', units: 1 }] },
      payments: [{ payment_id: 'P1', mode_id: 'cash', mode_name: 'Cash', direction: 'in', amount_minor: 100_000, tendered_minor: null, change_minor: 0, has_reference: false, taken_by_name: 'Sana' }],
    }),
    split({ split_no: 3, plan: { lines: [{ order_item_id: 'L', units: 1 }, { order_item_id: 'N2', units: 2 }] } }),
  ],
});

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };

function setup(answers: Answer[] = []) {
  const queue = [...answers];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { bill_id: 'B7', splits: [] } };
  });
  const shell = { api: { query: vi.fn(), command }, live: createLiveBus(), online: true, phone: false, portrait: false } as unknown as Shell;
  return { shell, command };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

async function show(s: ReturnType<typeof setup>, b: BillView = bill(), handlers: { onSaved?: (x: BillViewSplit[]) => void; onClose?: () => void; billRef?: BillRef } = {}) {
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <SplitEditor bill={b} billRef={handlers.billRef ?? { bill_id: 'B7' }} onSaved={handlers.onSaved ?? (() => {})} onClose={handlers.onClose ?? (() => {})} />
    </ShellContext.Provider>,
  );
  await flush();
  return view;
}

const cols = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.b5-scol:not(.add)')];
const colText = (c: HTMLElement) => [...c.querySelectorAll('.b5-su')].map((u) => `${u.querySelector('span')?.textContent} ${u.querySelector('.q')?.textContent}`);
const primary = (v: Mounted) => v.container.querySelector<HTMLButtonElement>('.acts .btn--primary')!;

describe('[05 §8 Splits; §6.5] split editor (task 36)', () => {
  it('by items: every open unit starts in split 1 with an empty split 2; tap an item then a split moves one unit ("3 of 6")', async () => {
    const s = setup();
    const v = await show(s);
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Split the bill');
    expect(v.container.querySelector('.dlg__h .tcode')?.textContent).toBe('T7');
    expect(v.container.querySelector('.b5-seg [aria-pressed="true"]')?.textContent).toBe('Items');
    expect(cols(v).map((c) => c.querySelector('.b5-scol__h b')?.textContent)).toEqual(['Split 1', 'Split 2']);
    expect(colText(cols(v)[0]!)).toEqual(['Chicken Karahi Full 1 of 1', 'Naan 6 of 6', 'Raita 2 of 2']);
    for (let i = 0; i < 3; i += 1) {
      v.click([...cols(v)[0]!.querySelectorAll<HTMLElement>('.b5-su')][1]);
      v.click(cols(v)[1]!.querySelector('.b5-scol__h'));
    }
    expect(colText(cols(v)[0]!)).toEqual(['Chicken Karahi Full 1 of 1', 'Naan 3 of 6', 'Raita 2 of 2']);
    expect(colText(cols(v)[1]!)).toEqual(['Naan 3 of 6']);
    expect(v.container.querySelector('.b5-sum')?.textContent).toBe('Every item is placed0 left');
    expect(primary(v).textContent).toBe('Save split');
  });

  it('Save by items sends SetSplits { bill_ref, mode: items, splits } (empty splits left out) and hands back the recomputed splits', async () => {
    const recomputed = [split({ split_no: 1 }), split({ split_no: 2 })];
    const s = setup([{ ok: true, data: { bill_id: 'B7', splits: recomputed } }]);
    const saved: BillViewSplit[][] = [];
    const v = await show(s, bill(), { onSaved: (x) => saved.push(x) });
    v.click([...cols(v)[0]!.querySelectorAll<HTMLElement>('.b5-su')][2]);
    v.click(cols(v)[1]!.querySelector('.b5-scol__h'));
    v.click(primary(v));
    await flush();
    expect(s.command).toHaveBeenCalledTimes(1);
    expect(s.command.mock.calls[0]![0]).toBe('SetSplits');
    expect(s.command.mock.calls[0]![1]).toEqual({
      bill_ref: { bill_id: 'B7' },
      mode: 'items',
      splits: [
        { split_no: 1, lines: [{ order_item_id: 'K', units: 1 }, { order_item_id: 'N', units: 6 }, { order_item_id: 'R', units: 1 }] },
        { split_no: 2, lines: [{ order_item_id: 'R', units: 1 }] },
      ],
    });
    expect(saved).toEqual([recomputed]);
  });

  it('by items: one non-empty split is not a plan (2–20, §6.5): Save says so and sends nothing; an empty split with no payment is left out (the hub needs ≥ 1 line per split)', async () => {
    const s = setup();
    const v = await show(s);
    expect(primary(v).textContent).toBe('Place items in at least 2 splits');
    expect(primary(v).getAttribute('aria-disabled')).toBe('true');
    v.click(primary(v));
    await flush();
    expect(s.command).not.toHaveBeenCalled();
    v.click(v.button('Add split'));
    expect(cols(v).map((c) => c.querySelector('.b5-scol__h b')?.textContent)).toEqual(['Split 1', 'Split 2', 'Split 3']);
    v.click([...cols(v)[0]!.querySelectorAll<HTMLElement>('.b5-su')][0]);
    v.click(cols(v)[2]!.querySelector('.b5-scol__h'));
    v.click(primary(v));
    await flush();
    const p = s.command.mock.calls[0]![1] as { splits: Array<{ split_no: number }> };
    expect(p.splits.map((x) => x.split_no)).toEqual([1, 3]);
  });

  it('[§3.8, R-53] a paid split keeps its number: emptying it blocks Save (named), nothing is sent; one unit back on it unblocks', async () => {
    const s = setup();
    const v = await show(s, LOCKED);
    const c2 = () => cols(v)[1]!;
    const c3 = () => cols(v)[2]!;
    // move both of split 2's units (Mutton Karahi, Lassi) to split 3
    for (let i = 0; i < 2; i += 1) {
      v.click(c2().querySelector('.b5-su'));
      v.click(c3().querySelector('.b5-scol__h'));
    }
    expect(c2().querySelectorAll('.b5-su').length).toBe(0);
    // two other splits keep lines (split 3 and a new split 4), so only the paid-split rule can hold Save back
    v.click(v.button('Add split'));
    v.click(c3().querySelector('.b5-su'));
    v.click(cols(v)[3]!.querySelector('.b5-scol__h'));
    expect(cols(v)[3]!.querySelectorAll('.b5-su').length).toBe(1);
    expect(primary(v).textContent).toBe('Split 2 has a payment — keep at least one item on it');
    expect(primary(v).getAttribute('aria-disabled')).toBe('true');
    v.click(primary(v));
    await flush();
    expect(s.command).not.toHaveBeenCalled();
    v.click(c3().querySelector('.b5-su'));
    v.click(c2().querySelector('.b5-scol__h'));
    expect(primary(v).textContent).toBe('Save split');
    v.click(primary(v));
    await flush();
    const p = s.command.mock.calls[0]![1] as { splits: Array<{ split_no: number; lines: unknown[] }> };
    expect(p.splits.map((x) => x.split_no)).toEqual([2, 3, 4]);
    expect(p.splits.every((x) => x.lines.length > 0)).toBe(true);
  });

  it('[G-29] a line no plan row holds (added after the plan) starts on the highest open split, marked New; a plan row is clamped to the units left', async () => {
    const b = {
      ...LOCKED,
      splits: LOCKED.splits.map((x) => (x.split_no === 3 ? { ...x, plan: { lines: [{ order_item_id: 'L', units: 5 }] } } : x)),
    };
    const v = await show(setup(), b);
    expect(v.container.querySelector('.b5-scol.pool')).toBeNull();
    const c3 = cols(v)[2]!;
    // L: 2 live, 1 on split 2's plan → split 3 holds the 1 left (not 5); N2 (no plan row) joins split 3
    expect(colText(c3)).toEqual(['Lassi 1 of 2', 'Naan 2 of 2']);
    expect(c3.querySelectorAll('.b5-su')[1]?.querySelector('small')?.textContent).toBe('New — added after split 1 closed');
  });

  it('[money, B9] with several open splits the cash total is a guide only: Save goes; the hub\'s shares_sum figure then replaces it', async () => {
    const s = setup([{ ok: false, error: { kind: 'api', status: 422, code: 'BILL_SPLIT_INVALID', details: { reason: 'shares_sum', expected_minor: 662_400 } } }]);
    const b = bill({
      splits: [
        split({ split_no: 1, plan: { lines: [{ order_item_id: 'K', units: 1 }] }, totals: { cash: tot(400_000), digital: tot(0), as_paid: tot(0) } }),
        split({ split_no: 2, plan: { lines: [{ order_item_id: 'N', units: 6 }, { order_item_id: 'R', units: 2 }] }, totals: { cash: tot(262_500), digital: tot(0), as_paid: tot(0) } }),
      ],
    });
    const v = await show(s, b);
    v.click(v.button('Amount'));
    const inputs = () => [...v.container.querySelectorAll<HTMLInputElement>('.b5-share input')];
    const type = (el: HTMLInputElement, text: string) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type(inputs()[0]!, '4000');
    type(inputs()[1]!, '2624');
    await flush();
    expect(primary(v).textContent).toBe('Save split');
    v.click(primary(v));
    await flush();
    expect(s.command).toHaveBeenCalledTimes(1);
    expect(v.container.querySelector('.msg.c-warn')?.textContent).toBe('Amounts must add up to Rs 6,624.00');
    expect(v.container.querySelector('.b5-sum span')?.textContent).toBe('Rs 6,624.00 to share · Rs 0.00 left');
  });

  it('[frame SplitInvalid] units the bill gained while the sheet is open show in "Not placed"; Save names the missing step and sends nothing', async () => {
    const s = setup();
    const b = bill({ splits: [split({ split_no: 1, plan: { lines: [{ order_item_id: 'K', units: 1 }, { order_item_id: 'N', units: 6 }] } }), split({ split_no: 2, plan: { lines: [{ order_item_id: 'R', units: 2 }] } })] });
    const v = await show(s, b);
    expect(v.container.querySelector('.b5-scol.pool')).toBeNull();
    // a later round lands while the sheet is open: 2 more Naan on a new line, 1 more Raita unit
    const grown = { ...b, lines: [...b.lines.map((l) => (l.order_item_id === 'R' ? { ...l, units: 3 } : l)), line('N9', 'Naan', 2)] };
    v.render(
      <ShellContext.Provider value={s.shell}>
        <SplitEditor bill={grown} billRef={{ bill_id: 'B7' }} onSaved={() => {}} onClose={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    const pool = v.container.querySelector<HTMLElement>('.b5-scol.pool')!;
    expect(pool.querySelector('.b5-scol__h b')?.textContent).toBe('Not placed');
    expect(colText(pool)).toEqual(['Raita 1 of 3', 'Naan 2 of 2']);
    expect([...pool.querySelectorAll('.b5-su')].every((u) => u.className.includes('err'))).toBe(true);
    expect(v.container.querySelector('.b5-sum')?.className).toContain('c-warn');
    expect(v.container.querySelector('.b5-sum b')?.textContent).toBe('3 items not placed');
    expect(primary(v).textContent).toBe('Place 3 items first');
    expect(primary(v).getAttribute('aria-disabled')).toBe('true');
    v.click(primary(v));
    await flush();
    expect(s.command).not.toHaveBeenCalled();
    // placing from the pool
    v.click(pool.querySelector('.b5-su'));
    v.click(cols(v).find((c) => c.querySelector('.b5-scol__h b')?.textContent === 'Split 2')!.querySelector('.b5-scol__h'));
    expect(v.container.querySelector('.b5-sum b')?.textContent).toBe('2 items not placed');
  });

  it('[frame SplitLocked] a closed split shows first, locked with its invoice and not editable; a paid split says so; a later line is marked New', async () => {
    const s = setup();
    const v = await show(s, LOCKED);
    const [c1, c2, c3] = cols(v) as [HTMLElement, HTMLElement, HTMLElement];
    expect(c1.className).toContain('lockd');
    expect(c1.querySelector('.b5-scol__h')?.textContent).toContain('Paid · AC1-S000124');
    expect([...c1.querySelectorAll('.b5-su')].every((u) => u.className.includes('lk'))).toBe(true);
    expect(c1.textContent).toContain('Paid — can’t change');
    expect(c2.querySelector('.b5-scol__h span')?.textContent).toBe('has a payment · Rs 1,000.00');
    expect(colText(c3)).toEqual(['Lassi 1 of 2', 'Naan 2 of 2']);
    expect(c3.querySelectorAll('.b5-su')[1]?.querySelector('small')?.textContent).toBe('New — added after split 1 closed');
    expect(c3.querySelectorAll('.b5-su')[0]?.querySelector('small')).toBeNull();
    // a locked unit cannot be picked up, nor dropped into
    v.click(c1.querySelector('.b5-su'));
    v.click(c3.querySelector('.b5-scol__h'));
    expect(colText(cols(v)[2]!)).toEqual(['Lassi 1 of 2', 'Naan 2 of 2']);
    // the payload never names the closed split
    v.click(primary(v));
    await flush();
    const p = s.command.mock.calls[0]![1] as { splits: Array<{ split_no: number }> };
    expect(p.splits.map((x) => x.split_no)).toEqual([2, 3]);
  });

  it('BILL_HAS_PAYMENTS, BILL_SPLIT_INVALID reasons: the error text, filled from details (item name, amount, split)', async () => {
    const s = setup([
      { ok: false, error: { kind: 'api', status: 409, code: 'BILL_HAS_PAYMENTS', details: { bill_id: 'B7', split_nos: [2] } } },
      { ok: false, error: { kind: 'api', status: 422, code: 'BILL_SPLIT_INVALID', details: { reason: 'units_missing', order_item_id: 'L' } } },
      { ok: false, error: { kind: 'api', status: 422, code: 'BILL_SPLIT_INVALID', details: { reason: 'shares_sum', expected_minor: 662_400 } } },
    ]);
    const v = await show(s, LOCKED);
    v.click(v.button('One bill'));
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg.c-warn')?.textContent).toBe('Split 2 has a payment — remove the payment first or keep the split');
    v.click(v.button('Items'));
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg.c-warn')?.textContent).toBe('Every item must be in a split — Lassi is not');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg.c-warn')?.textContent).toBe('Amounts must add up to Rs 6,624.00');
  });

  it('by amount: shares of the open cash total; "to share · left"; Save only when they add up; sends share_minor', async () => {
    const s = setup();
    const v = await show(s);
    v.click(v.button('Amount'));
    expect(v.container.querySelector('.b5-sum span')?.textContent).toBe('Rs 6,624.00 to share · Rs 6,624.00 left');
    const inputs = () => [...v.container.querySelectorAll<HTMLInputElement>('.b5-share input')];
    expect(inputs().length).toBe(2);
    const type = (el: HTMLInputElement, text: string) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type(inputs()[0]!, '4,000.00');
    await flush();
    expect(v.container.querySelector('.b5-sum span')?.textContent).toBe('Rs 6,624.00 to share · Rs 2,624.00 left');
    expect(primary(v).textContent).toBe('Make it add up to Rs 6,624.00');
    v.click(primary(v));
    expect(s.command).not.toHaveBeenCalled();
    type(inputs()[1]!, '2624');
    await flush();
    expect(v.container.querySelector('.b5-sum span')?.textContent).toBe('Rs 6,624.00 to share · Rs 0.00 left');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, mode: 'amount', splits: [{ split_no: 1, share_minor: 400_000 }, { split_no: 2, share_minor: 262_400 }] });
  });

  it('equally: a 2–20 stepper; sends { mode: equal, n }', async () => {
    const s = setup();
    const v = await show(s);
    v.click(v.button('Equally'));
    expect(v.container.querySelector('.b5-stepper b')?.textContent).toBe('2');
    const [minus, plus] = [...v.container.querySelectorAll<HTMLButtonElement>('.b5-stepper button')];
    v.click(minus);
    expect(v.container.querySelector('.b5-stepper b')?.textContent).toBe('2');
    v.click(plus);
    expect(v.container.querySelector('.b5-stepper b')?.textContent).toBe('3');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, mode: 'equal', n: 3 });
  });

  it('One bill sends { mode: none }; it is offered only while at most one open split has payments', async () => {
    const s = setup();
    const v = await show(s);
    v.click(v.button('One bill'));
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { bill_id: 'B7' }, mode: 'none' });
    v.unmount();
    view = null;
    const pay = LOCKED.splits[1]!.payments;
    const two = { ...LOCKED, splits: LOCKED.splits.map((x) => (x.split_no === 3 ? { ...x, payments: pay } : x)) };
    const w = await show(setup(), two);
    expect(w.button('One bill').hasAttribute('disabled')).toBe(true);
  });

  it('the command names the bill by the ref the bill screen read it with (a projected bill: its seating)', async () => {
    const s = setup();
    const v = await show(s, bill({ bill_id: null, state: 'projected' }), { billRef: { seating_id: 'S7' } });
    v.click(v.button('One bill'));
    v.click(primary(v));
    await flush();
    expect((s.command.mock.calls[0]![1] as { bill_ref: unknown }).bill_ref).toEqual({ seating_id: 'S7' });
  });

  it('[handbook §10] a lost reply: Save again resends the same command_id; after an answer a new save is a new command', async () => {
    const s = setup([{ ok: false, error: { kind: 'network' } }, { ok: true, data: { bill_id: 'B7', splits: [] } }]);
    const v = await show(s);
    v.click(v.button('One bill'));
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg')?.textContent).toBe('Needs the hub');
    v.click(primary(v));
    await flush();
    const ids = s.command.mock.calls.map((c) => c[2]?.commandId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
  });

  it('Cancel and the close button close the sheet without a command', async () => {
    const s = setup();
    let closed = 0;
    const v = await show(s, bill(), { onClose: () => (closed += 1) });
    v.click(v.button('Cancel'));
    v.click(v.button('Close'));
    expect(closed).toBe(2);
    expect(s.command).not.toHaveBeenCalled();
  });

  it('[05 §8 Rules] every task-36 key is in en and in ur or 05/urdu-todo.md', () => {
    // this task's block of en.ts (the brief's split.* keys are billing.split.*: 02a owns split.*)
    const block = enSource.slice(enSource.indexOf('// ---- 05 client (task 36)'));
    const keys = [...block.slice(0, block.indexOf('// ----', 10) === -1 ? undefined : block.indexOf('// ----', 10)).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
    expect(keys.length).toBe(33);
    for (const key of keys) expect(key in en, key).toBe(true);
    for (const key of keys) expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
  });
});
