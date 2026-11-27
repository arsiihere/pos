import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { billingApi } from '../../../billing/api';
import { createMemoryDraftStore } from '../drafts/memory-drafts';
import { createTokenBook, type TokenBook } from './book';
import { cartCheckBillText } from './CheckBill';
import type { QueueToken } from './queue-model';
import { screenHarness, sl, view } from './screen-harness';
import { aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';
import { mount } from '../../../../../test/dom';
import { ShellContext } from '../../shell/hooks';

// ⚠️ 02b-TK L-CLIENT-3 item 1 (05 v1.0.35 §6.3, §6.3a, §8; 02b v1.0.25 §8 OR-5 / R6, test row 73; D9; 05 #60h): the
// cart's "Print check bill" before Send → PrintCartCheckBill { draft } (an addition cart: `draft.adds_to_order_id`);
// a sent token with money due → PrintCheckBill; a paid token → "Print receipt again" (PrintBillDocument receipt,
// take-payment only). The cart action is never queued, is off while offline and on a parking cart without a car
// number; the result's gross (totals_default.total_minor) and remaining payable (due_minor) are shown.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

let m: Mounted | null = null;
let book: TokenBook | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  book?.dispose();
  book = null;
  document.body.innerHTML = '';
});

type Failed = { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };
const refused = (status: number, code: string, details: Record<string, unknown> = {}): Failed => ({ ok: false, error: { kind: 'api', status, code, details } });
const totals = (total_minor: number) => ({ subtotal_minor: total_minor, tax_minor: 0, service_charge_minor: 0, rounding_minor: 0, total_minor });
const CART_PRINTED = { ok: true, data: { printed: true, job_id: 'J1', printer_name: 'Counter', totals_default: totals(4_000), due_minor: 4_000 } };
const CART_NO_PRINTER = { ok: true, data: { printed: false, job_id: null, printer_name: null, totals_default: totals(4_000), due_minor: 4_000 } };

const cart = (v: Mounted) => v.container.querySelector('.cart')!;
const checkButton = (v: Mounted) => [...cart(v).querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === 'Print check bill');
const addNaan = (v: Mounted) => {
  v.click(v.button('Sides', v.container.querySelector('.cats')!));
  v.click(v.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};

describe('[02b-TK L-CLIENT-3 item 1; 05 #60h] Print check bill before Send', () => {
  it('[05 §6.3a; #60h] an unsent takeaway cart sends PrintCartCheckBill { draft } (no ids, no printer_id), never through the queue', async () => {
    const h = screenHarness({ command: (type) => (type === 'PrintCartCheckBill' ? CART_PRINTED : undefined) });
    const v = h.render();
    m = v;
    await flush();
    expect(checkButton(v)).toBeUndefined(); // an empty cart prints nothing
    addNaan(v);
    v.click(checkButton(v));
    await flush();
    const key = (h.commands[0]?.payload as { draft: { lines: Array<{ key: string }> } }).draft.lines[0]!.key;
    expect(h.commands).toEqual([{ type: 'PrintCartCheckBill', payload: { draft: { order_type: 'takeaway', lines: [{ key, item_id: 'I5', quantity: 1 }] } } }]);
    expect(key).toMatch(/^[0-9A-Z]{26}$/);
    expect(h.sent).toEqual([]); // §6.3a R2-M-5: never in the QueueStore
    expect(h.toasts.at(-1)).toEqual({ text: 'Check bill sent to Counter · Gross total Rs 40 · Remaining payable Rs 40', tone: 'ok' });
  });

  it('[05 §6.3a R2-m-1] no bill printer → "show the screen", with the printed figures', async () => {
    const h = screenHarness({ command: () => CART_NO_PRINTER });
    const v = h.render();
    m = v;
    await flush();
    addNaan(v);
    v.click(checkButton(v));
    await flush();
    expect(h.toasts.at(-1)).toEqual({ text: 'No bill printer is set up — show the screen to the customer · Gross total Rs 40 · Remaining payable Rs 40', tone: 'warn' });
  });

  it('[05 §6.3a R2-M-6, R3-M-5; #60h] an addition cart (unsent lines on a sent token) sends PrintCartCheckBill { draft: { …, adds_to_order_id } }, never PrintCheckBill', async () => {
    const h = screenHarness({
      rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } }), aRow({ order_id: 'O48b', token: 48, placed_at: at(13, 5), ready: { n: 0, m: 1 } })],
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]), O48b: view('O48b', [sl('O48b', 'B', 'Naan', 'cooking')]) },
      bills: { O48b: { bill_id: 'B48', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 4_000 }], totals_default: { total_minor: 4_000 } } },
      command: () => ({ ok: true, data: { printed: true, job_id: 'J2', printer_name: 'Counter', totals_default: totals(8_000), due_minor: 6_000 } }),
    });
    const v = h.render();
    m = v;
    await flush();
    v.click(v.container.querySelector('.tk-qr'));
    await flush();
    v.click(v.button('Add items'));
    addNaan(v);
    v.click(checkButton(v));
    await flush();
    const key = (h.commands[0]?.payload as { draft: { lines: Array<{ key: string }> } }).draft.lines[0]!.key;
    // the root, as SubmitOrder's adds_to_order_id (02b §3.2 step 2); 05 checks it as Send does
    expect(h.commands).toEqual([{ type: 'PrintCartCheckBill', payload: { draft: { order_type: 'takeaway', adds_to_order_id: 'O48', lines: [{ key, item_id: 'I5', quantity: 1 }] } } }]);
    expect(h.sent).toEqual([]);
    expect(h.toasts.at(-1)?.text).toBe('Check bill sent to Counter · Gross total Rs 80 · Remaining payable Rs 60');
  });

  it('[#60h R2-M-5] offline the cart action is off: a tap sends nothing and queues nothing', async () => {
    const h = screenHarness({ online: false, command: () => CART_PRINTED });
    const v = h.render();
    m = v;
    await flush();
    addNaan(v);
    const btn = checkButton(v)!;
    expect(btn.getAttribute('aria-disabled')).toBe('true');
    v.click(btn);
    await flush();
    expect(h.commands).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it('[05 §6.3a R2-m-7; #60h] a parking cart is greyed until its car number is set; with it, the draft carries `parking`', async () => {
    const off = screenHarness({ command: () => CART_PRINTED });
    let v = off.renderAs('parking', 'P1');
    m = v;
    await flush();
    addNaan(v);
    v.click(checkButton(v));
    await flush();
    expect(checkButton(v)!.getAttribute('aria-disabled')).toBe('true');
    expect(off.commands).toEqual([]);
    v.unmount();
    m = null;

    const drafts = createMemoryDraftStore();
    await drafts.put({ draft_id: 'P2', device_id: 'DV1', staff_id: 'sana', order_type: 'parking', cart: { lines: [], parking: { car_number: 'LEA 123', car_type: 'sedan' } }, updated_at: at(13, 0), held: false });
    const on = screenHarness({ drafts, command: () => CART_PRINTED });
    v = on.renderAs('parking', 'P2');
    m = v;
    await flush();
    addNaan(v);
    expect(checkButton(v)!.getAttribute('aria-disabled')).toBe('false');
    v.click(checkButton(v));
    await flush();
    const key = (on.commands[0]?.payload as { draft: { lines: Array<{ key: string }> } }).draft.lines[0]!.key;
    expect(on.commands).toEqual([{ type: 'PrintCartCheckBill', payload: { draft: { order_type: 'parking', parking: { car_number: 'LEA 123', car_type: 'sedan' }, lines: [{ key, item_id: 'I5', quantity: 1 }] } } }]);
  });

  it('[05 §6.3a Line refusals] a refused line opens that cart line and says which item, in the check bill\'s words', async () => {
    let key = '';
    const h = screenHarness({
      command: (_type, payload) => {
        key = (payload as { draft: { lines: Array<{ key: string }> } }).draft.lines[0]!.key;
        return refused(409, 'ITEM_UNAVAILABLE', { item_id: 'I5', key });
      },
    });
    const v = h.render();
    m = v;
    await flush();
    addNaan(v);
    expect(v.container.querySelector('.cart li.ln.open')).toBeNull();
    v.click(checkButton(v));
    await flush();
    expect(h.toasts.at(-1)).toEqual({ text: 'Check bill not printed — Naan is not available', tone: 'warn' });
    expect(v.container.querySelector(`.cart li[data-key="${key}"]`)?.className).toContain('open');
  });

  it('[05 §6.3a Errors; #60g, #60i] every refusal reads its own text, never a raw code', () => {
    const items = [{ item_id: 'I5', name: 'Naan' }];
    const deals = [{ deal_id: 'D1', name: 'Family deal' }];
    const lines = [{ key: 'k1', item_id: 'I5' }];
    const cases: Array<[Failed, string]> = [
      [refused(400, 'VALIDATION_FAILED', { issues: [{ path: 'payload.draft.order_type', message: 'takeaway_or_parking_only' }] }), 'Check the fields and try again.'],
      [refused(409, 'BUSINESS_DAY_NOT_OPEN'), 'The day hasn’t started — no check bill yet'],
      [refused(404, 'PRINTER_NOT_FOUND', { printer_id: 'P1' }), 'This printer was removed or archived — reload'],
      [refused(404, 'MENU_ITEM_NOT_FOUND', { item_id: 'I9', key: 'k9' }), 'Check bill not printed — an item is no longer on the menu'],
      [refused(404, 'DEAL_NOT_FOUND', { deal_id: 'D9', key: 'k9' }), 'Check bill not printed — a deal is no longer on the menu'],
      [refused(409, 'ITEM_UNAVAILABLE', { item_id: 'I5', key: 'k1' }), 'Check bill not printed — Naan is not available'],
      [refused(409, 'ITEM_OUT_OF_HOURS', { key: 'k1' }), 'Check bill not printed — Naan is not served now'],
      [refused(422, 'OPTION_CHOICE_INVALID', { key: 'k1' }), 'Check bill not printed — the choices of an item changed'],
      [refused(404, 'ORDER_NOT_FOUND', { order_id: 'O48' }), 'This token can’t take more items (closed, cancelled or another day) — send them as a new order'],
      [refused(422, 'CONFIG_REFERENCE_INVALID', { field: 'adds_to_order_id' }), 'This token can’t take more items (closed, cancelled or another day) — send them as a new order'],
      [refused(403, 'PERMISSION_DENIED', { permission: 'take-order', grant: 'not_granted' }), 'You can’t print the check bill for this order'],
      [{ ok: false, error: { kind: 'network' } }, 'Needs the hub'],
    ];
    for (const [answer, text] of cases) expect(cartCheckBillText(answer.error, { items, deals, lines })).toBe(text);
  });

  it('[05 §6.3a; #60h] the billing api: PrintCartCheckBill with and without an explicit printer, the payload as given', async () => {
    const command = vi.fn(async () => CART_PRINTED);
    const api = billingApi({ query: vi.fn(), page: vi.fn(), command } as never, () => 'CMD1');
    const draft = { order_type: 'takeaway' as const, lines: [{ key: 'k1', item_id: 'I5', quantity: 1 }] };
    await api.printCartCheckBill({ draft });
    await api.printCartCheckBill({ draft: { ...draft, adds_to_order_id: 'O48' }, printer_id: 'PR1' });
    expect(command.mock.calls).toEqual([
      ['PrintCartCheckBill', { draft }, { commandId: 'CMD1' }],
      ['PrintCartCheckBill', { draft: { ...draft, adds_to_order_id: 'O48' }, printer_id: 'PR1' }, { commandId: 'CMD1' }],
    ]);
  });

  it('[05 §6.3 R3-M-1] the token view\'s PrintCheckBill shows the gross and remaining payable of its result', async () => {
    const h = screenHarness({
      rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } })],
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]) },
      bills: { O48: { bill_id: 'B48', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 30_000 }], totals_default: { total_minor: 50_000 } } },
      command: () => ({ ok: true, data: { bill_id: 'B48', printed: true, job_id: 'J3', printer_name: 'Counter', totals_default: totals(50_000), due_minor: 30_000 } }),
    });
    const v = h.render();
    m = v;
    await flush();
    v.click(v.container.querySelector('.tk-qr'));
    await flush();
    v.click(v.button('Print check bill', v.container.querySelector('.tk-drawer')!));
    await flush();
    expect(h.commands).toEqual([{ type: 'PrintCheckBill', payload: { bill_ref: { order_id: 'O48' } } }]);
    expect(h.toasts.at(-1)?.text).toBe('Check bill sent to Counter · Gross total Rs 500 · Remaining payable Rs 300');
  });
});

describe('[02b-TK L-CLIENT-3 item 1; 05 #60h] Print receipt again on a paid token', () => {
  const tok: QueueToken = { key: 'k', token: 53, order_ids: ['O53'], newest_order_id: 'O53', customer_name: null, phone: null, placed_at: at(13, 4), promise_ms: at(13, 24), ready: { n: 0, m: 1 }, paid: true, part: false, summary: '' };
  const invoice = (invoice_id: string) => ({ invoice_id, invoice_ref: 'INV', fiscal_number: null, fiscal_state: null });
  const paid = { bill_id: 'B53', state: 'closed', splits: [{ split_no: 1, state: 'closed', balance_minor: 0, totals: { as_paid: { total_minor: 19_000 } }, invoice: invoice('INV-1') }, { split_no: 2, state: 'closed', balance_minor: 0, totals: { as_paid: { total_minor: 20_000 } }, invoice: invoice('INV-2') }], totals_default: { total_minor: 0 } };
  const due = { bill_id: 'B53', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 39_000, invoice: null }], totals_default: { total_minor: 39_000 } };

  const showView = async (bill: unknown, grants: Record<string, unknown> = {}) => {
    const h = screenHarness({
      bills: { O53: bill },
      views: { O53: view('O53', [sl('O53', 'A', 'Karahi', 'cooking')]) },
      grants,
      command: () => ({ ok: true, data: { printed: true, job_id: 'J9', printer_name: 'Counter' } }),
    });
    book = createTokenBook(h.live);
    const v = mount();
    m = v;
    v.render(
      <ShellContext.Provider value={h.shell}>
        <TokenView token={tok} book={book} onClose={() => {}} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    return { h, v };
  };
  const again = (v: Mounted) => v.buttons().find((b) => b.textContent === 'Print receipt again');

  it('[05 §6.22; #60h] a paid token offers Print receipt again (no check bill) → PrintBillDocument { receipt, its newest invoice }', async () => {
    const { h, v } = await showView(paid);
    expect(v.buttons().some((b) => b.textContent === 'Print check bill')).toBe(false);
    v.click(again(v));
    await flush();
    expect(h.commands).toEqual([{ type: 'PrintBillDocument', payload: { doc: 'receipt', ref_id: 'INV-2' } }]);
    expect(h.sent).toEqual([]);
    expect(h.toasts.at(-1)).toEqual({ text: 'Reprint sent to Counter', tone: 'ok' });
  });

  it('[#60h] Print receipt again only with take-payment; a Due token keeps Print check bill instead', async () => {
    const without = await showView(paid, { 'take-payment': { grant: 'not_granted', scope: 'branch' } });
    expect(again(without.v)).toBeUndefined();
    without.v.unmount();
    m = null;
    book?.dispose();
    book = null;
    const open = await showView(due);
    expect(again(open.v)).toBeUndefined();
    expect(open.v.buttons().some((b) => b.textContent === 'Print check bill')).toBe(true);
  });

  it('[#60h] the cart of an addition to a paid token, before any line: the token\'s bill is read once and Print receipt again reprints its receipt', async () => {
    const h = screenHarness({
      rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } })],
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]) },
      bills: { O48: { ...paid, bill_id: 'B48' } },
      command: () => ({ ok: true, data: { printed: false, job_id: null, printer_name: null } }),
    });
    const v = h.render();
    m = v;
    await flush();
    v.click(v.container.querySelector('.tk-qr'));
    await flush();
    v.click(v.button('Add items'));
    await flush();
    expect(checkButton(v)).toBeUndefined();
    v.click(v.button('Print receipt again', cart(v)));
    await flush();
    expect(h.commands).toEqual([{ type: 'PrintBillDocument', payload: { doc: 'receipt', ref_id: 'INV-2' } }]);
    expect(h.toasts.at(-1)).toEqual({ text: 'No bill printer is set up — show the screen to the customer', tone: 'warn' });
  });
});
