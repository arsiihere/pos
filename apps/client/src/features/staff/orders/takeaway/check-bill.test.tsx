import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createLiveBus } from '../../shell/live';
import { createPermissions } from '../../shell/permissions';
import { createToastBus } from '../../shell/toast';
import type { OrderViewBody } from '../contracts';
import { createTokenBook, type TokenBook } from './book';
import { CheckBill, checkBillText } from './CheckBill';
import type { QueueToken } from './queue-model';
import { screenHarness, sl, view } from './screen-harness';
import { aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';

// 02b-TK C3-2 (05 v1.0.34 §6.3, §3.16; ruling R6): Print check bill on the token view and on the cart of an addition
// to a sent token, through PrintCheckBill { bill_ref: { order_id } }; an unsent cart has none (its total is on screen).

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

type Failed = { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };
type Answer = { ok: true; data: unknown } | Failed;
const refused = (status: number, code: string, details: Record<string, unknown> = {}): Failed => ({ ok: false, error: { kind: 'api', status, code, details } });
const PRINTED: Answer = { ok: true, data: { bill_id: 'B1', printed: true, job_id: 'J1', printer_name: 'Counter' } };

let m: Mounted | null = null;
let book: TokenBook | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  book?.dispose();
  book = null;
  document.body.innerHTML = '';
  nav.to = [];
});

function shellWith(answer: Answer, o: { bills?: Record<string, unknown>; views?: Record<string, OrderViewBody> } = {}) {
  const live = createLiveBus();
  const toasts = createToastBus();
  const command = vi.fn(async (type: string, payload: unknown, opts?: unknown) => {
    void type;
    void payload;
    void opts;
    return answer;
  });
  const bills = o.bills ?? {};
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    api: {
      query: async (path: string) => {
        const id = new URLSearchParams(path.split('?')[1]).get('order_id')!;
        return bills[id] === undefined ? { ok: false, error: { kind: 'network' } } : { ok: true, data: bills[id] };
      },
      page: vi.fn(),
      command,
    },
    orders: { orderView: async (id: string) => ({ ok: true, data: { kind: 'order', order: (o.views ?? {})[id] } }), orderContact: vi.fn() },
    live,
    permissions: createPermissions({ 'take-order': { grant: 'allowed', scope: 'branch' }, 'take-payment': { grant: 'allowed', scope: 'branch' }, 'mark-served': { grant: 'allowed', scope: 'branch' } } as never),
    toasts,
    clock: { nowMs: () => at(13, 20), utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, command, toasts, live };
}

const showButton = (s: ReturnType<typeof shellWith>) => {
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <CheckBill order_id="O54" />
    </ShellContext.Provider>,
  );
  return m;
};

describe('[02b-TK C3-2] Print check bill', () => {
  it('[05 §6.3, §3.16] sends PrintCheckBill { bill_ref: { order_id } } and says where it printed; no printer → "show the screen"', async () => {
    for (const [answer, text] of [
      [PRINTED, 'Check bill sent to Counter'],
      [{ ok: true, data: { bill_id: 'B1', printed: false, job_id: null, printer_name: null } } as Answer, 'No bill printer is set up — show the screen to the customer'],
    ] as const) {
      const s = shellWith(answer);
      const v = showButton(s);
      v.click(v.button('Print check bill'));
      await flush();
      expect(s.command).toHaveBeenCalledWith('PrintCheckBill', { bill_ref: { order_id: 'O54' } }, expect.anything());
      expect(s.toasts.current()?.text).toBe(text);
      v.unmount();
      m = null;
    }
  });

  it('[05 §6.3 errors] every refusal reads its own text, never a raw code', () => {
    const cases: Array<[Failed, string]> = [
      [refused(409, 'BILL_NOT_OPEN', { bill_id: 'B1', state: 'closed' }), 'This bill is already closed'],
      [refused(409, 'BILL_NOT_OPEN', { bill_id: null, state: 'cancelled' }), 'This order was cancelled'],
      [refused(404, 'ORDER_NOT_FOUND', { order_id: 'O54' }), 'This order is not open any more'],
      [refused(404, 'PRINTER_NOT_FOUND', { printer_id: 'P1' }), 'This printer was removed or archived — reload'],
      [refused(409, 'BUSINESS_DAY_NOT_OPEN'), 'The day hasn’t started — no check bill yet'],
      [refused(403, 'PERMISSION_DENIED', { permission: 'take-order', grant: 'not_granted' }), 'You can’t print the check bill for this order'],
      [{ ok: false, error: { kind: 'network' } }, 'Needs the hub'],
    ];
    for (const [answer, text] of cases) expect(checkBillText(answer.error)).toBe(text);
  });

  it('[05 §6.3] a refusal is a warning toast', async () => {
    const s = shellWith(refused(409, 'BILL_NOT_OPEN', { bill_id: 'B1', state: 'closed' }));
    const v = showButton(s);
    v.click(v.button('Print check bill'));
    await flush();
    expect(s.toasts.current()).toMatchObject({ text: 'This bill is already closed', tone: 'warn' });
  });

  it('[R6; frame TokenDue] the token view of a Due token offers Print check bill for its NEWEST order; a paid one does not', async () => {
    const tok: QueueToken = { key: 'k', token: 53, order_ids: ['O53', 'O53b'], newest_order_id: 'O53b', customer_name: null, phone: null, placed_at: at(13, 4), promise_ms: at(13, 24), ready: { n: 0, m: 1 }, paid: false, part: false, summary: '' };
    const due = { bill_id: 'B2', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 39_000 }], totals_default: { total_minor: 39_000 } };
    const paid = { bill_id: 'B2', state: 'closed', splits: [{ split_no: 1, state: 'closed', balance_minor: 0, totals: { as_paid: { total_minor: 39_000 } } }], totals_default: { total_minor: 0 } };
    const views = { O53: view('O53', [sl('O53', 'A', 'Karahi', 'cooking')]), O53b: view('O53b', [sl('O53b', 'B', 'Naan', 'cooking')]) };
    for (const [bill, shown] of [
      [due, true],
      [paid, false],
    ] as const) {
      const s = shellWith(PRINTED, { bills: { O53: paid, O53b: bill }, views });
      book = createTokenBook(s.live);
      const v = mount();
      m = v;
      v.render(
        <ShellContext.Provider value={s.shell}>
          <TokenView token={tok} book={book} onClose={() => {}} onHandOver={() => {}} />
        </ShellContext.Provider>,
      );
      await flush();
      const btn = v.buttons().find((b) => b.textContent === 'Print check bill');
      expect(btn !== undefined).toBe(shown);
      if (btn !== undefined) {
        v.click(btn);
        await flush();
        expect(s.command).toHaveBeenCalledWith('PrintCheckBill', { bill_ref: { order_id: 'O53b' } }, expect.anything());
      }
      v.unmount();
      m = null;
      book.dispose();
      book = null;
    }
  });

  const harness = () =>
    screenHarness({
      rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } }), aRow({ order_id: 'O48b', token: 48, placed_at: at(13, 5), ready: { n: 0, m: 1 } })],
      views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]), O48b: view('O48b', [sl('O48b', 'B', 'Naan', 'cooking')]) },
      bills: { O48b: { bill_id: 'B48', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 4_000 }], totals_default: { total_minor: 4_000 } } },
      command: (type) => (type === 'PrintCheckBill' ? PRINTED : undefined),
    });

  it('[R6; ⚠️ OR-5, 05 §6.3a] a new, unsent cart prints through PrintCartCheckBill (cart-check-bill.test.tsx), never PrintCheckBill', async () => {
    const h = harness();
    const v = h.render();
    m = v;
    await flush();
    v.click(v.button('Sides', v.container.querySelector('.pills')!));
    v.click(v.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
    v.click(v.button('Print check bill', v.container.querySelector('.cart')!));
    await flush();
    expect(h.commands.map((c) => c.type)).toEqual(['PrintCartCheckBill']);
  });

  it('[R6; frame TokenAddItems; 05 §6.3 R2-m-4] the cart of an addition to a sent token, before any unsent line, prints the token\'s check bill (its newest order)', async () => {
    const h = harness();
    const v = h.render();
    m = v;
    await flush();
    v.click(v.container.querySelector('.tk-qr'));
    await flush();
    v.click(v.button('Add items'));
    await flush();
    v.click(v.button('Print check bill', v.container.querySelector('.cart')!));
    await flush();
    expect(h.commands).toEqual([{ type: 'PrintCheckBill', payload: { bill_ref: { order_id: 'O48b' } } }]);
  });
});
