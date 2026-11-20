import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createPermissions } from '../staff/shell/permissions';
import { createToastBus } from '../staff/shell/toast';
import type { OpenBillRow } from './contracts';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import { BILL_LIST_FRAMES } from './frames';
import { OpenBills, billRefOf } from './OpenBills';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.12 §8 "Cashier screen", §6.2 (plan §3.1 task 34; frames OpenBills, OpenBillsEmpty, OpenBillsOffline,
// OpenBillsUrdu): the open-bills list over scripted hub answers, the real live bus and permissions.

// 1:40 PM hub time (UTC offset 0), 20 Nov 2026
const NOW = Date.UTC(2026, 10, 20, 13, 40);
const at = (h: number, m: number) => Date.UTC(2026, 10, 20, h, m);

function row(over: Partial<OpenBillRow> & { identifier: string }): OpenBillRow {
  return {
    bill_id: null,
    seating_id: null,
    order_id: null,
    order_type: 'dine_in',
    state: 'open',
    total_default_minor: 100_000,
    paid_minor: 0,
    check_printed_at: null,
    opened_at: at(13, 0),
    open_minutes: 40,
    flagged: false,
    partly_paid: false,
    has_open_request: false,
    ...over,
  };
}

// server order (check bill printed first, then opened_at): the client never re-sorts (§6.2)
const ROWS: OpenBillRow[] = [
  row({ identifier: 'T7', bill_id: 'B7', seating_id: 'S7', check_printed_at: at(13, 32), total_default_minor: 662_400, open_minutes: 46 }),
  row({ identifier: 'T4 + T5', bill_id: 'B45', seating_id: 'S4', state: 'partly_paid', partly_paid: true, paid_minor: 146_200, total_default_minor: 365_400, open_minutes: 65 }),
  row({ identifier: '#12', order_id: 'O12', order_type: 'takeaway', state: 'projected', total_default_minor: 171_000, open_minutes: 18 }),
  row({ identifier: 'PARKING ABC 123 SEDAN', order_id: 'O13', order_type: 'parking', state: 'projected', total_default_minor: 145_000, open_minutes: 22 }),
  row({ identifier: 'Family 2', seating_id: 'S9', state: 'projected', has_open_request: true, total_default_minor: 6_078_400, open_minutes: 72 }),
  row({ identifier: 'T2', bill_id: 'B2', seating_id: 'S2', flagged: true, total_default_minor: 428_000, open_minutes: 252, opened_at: at(9, 28) }),
];

interface Opts {
  rows?: OpenBillRow[];
  online?: boolean;
  fail?: boolean;
  currency?: string;
}

function setup(o: Opts = {}) {
  const live = createLiveBus();
  const query = vi.fn(async (path: string) => {
    void path;
    if (o.fail === true) return { ok: false as const, error: { kind: 'api' as const, status: 500, code: 'INTERNAL', details: {} } };
    return { ok: true as const, data: { bills: o.rows ?? ROWS, as_of_seq: 7 } };
  });
  const shell = {
    device: { token: 'D', id: 'dev-1', type: 'cashier_kiosk' },
    api: { query },
    live,
    config: { config: () => null, snapshot: () => ({ currency_code: o.currency ?? 'PKR' }), subscribe: () => () => {} },
    permissions: createPermissions({ 'take-payment': { grant: 'allowed', scope: 'branch' } } as never),
    toasts: createToastBus(),
    clock: { nowMs: () => NOW, utcOffsetMs: 0 },
    me: { staff_id: 'sana', name: 'Sana' },
    online: o.online ?? true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, live, query };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
  setLanguage('en');
});
beforeEach(() => {
  window.location.hash = '';
});

async function show(s: ReturnType<typeof setup>, onOpen?: (ref: ReturnType<typeof billRefOf>) => void) {
  view = mount();
  view.render(
    <ShellContext.Provider value={s.shell}>
      <OpenBills {...(onOpen === undefined ? {} : { onOpen })} />
    </ShellContext.Provider>,
  );
  await flush();
  return view;
}

const rowsOf = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.b5-wr:not(.th)')];

describe('[05 §8 Cashier screen; §6.2] open-bills list (task 34)', () => {
  it('reads GET /queries/open-bills and shows the rows in server order with identifier, type, open time and the cash total', async () => {
    const s = setup();
    const v = await show(s);
    expect(s.query).toHaveBeenCalledWith('/queries/open-bills');
    const rows = rowsOf(v);
    expect(rows.map((r) => r.querySelector('.tcode')?.textContent)).toEqual(['T7', 'T4 + T5', '#12', 'PARKING ABC 123 SEDAN', 'Family 2', 'T2']);
    const [t7, t45, t12, park, fam, t2] = rows as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(t7.querySelector('.ty')?.textContent).toBe('Dine-in');
    expect(t12.querySelector('.ty')?.textContent).toBe('Takeaway');
    expect(park.querySelector('.ty')?.textContent).toBe('Parking');
    expect(t7.querySelector('.am b')?.textContent).toBe('Rs 6,624.00');
    expect(t7.querySelector('.op')?.textContent).toBe('46 min');
    expect(t45.querySelector('.op')?.textContent).toBe('1 h 05 min');
    expect(fam.querySelector('.am b')?.textContent).toBe('Rs 60,784.00');
    // a takeaway / parking code is the quiet tile; a long identifier wraps
    expect(t12.querySelector('.tcode')?.className).toContain('q');
    expect(park.querySelector('.tcode')?.className).toContain('long');
    expect(t7.querySelector('.tcode')?.className).not.toMatch(/\bq\b|long/);
    // the header row and the count
    expect(v.container.querySelector('.b5-wr.th')?.textContent).toBe('BillTypeStatusOpenTotal if cash');
    expect(v.container.querySelector('.b5-wl__h h1')?.textContent).toBe('Open bills');
    expect(v.container.querySelector('.b5-wl__h .cnt')?.textContent).toBe('6');
    void t2;
  });

  it('badges: check bill printed (with its time), partly paid (+ Paid line), waiting for approval, open too long (with duration)', async () => {
    const v = await show(setup());
    const [t7, t45, t12, , fam, t2] = rowsOf(v) as HTMLElement[];
    const badges = (r: HTMLElement | undefined) => [...(r?.querySelectorAll('.b5-bd') ?? [])].map((b) => `${b.className.replace('b5-bd ', '')}:${b.textContent}`);
    expect(badges(t7)).toEqual(['c-ok:Check bill printed 1:32 PM']);
    expect(badges(t45)).toEqual(['c-info:Partly paid']);
    expect(t45?.querySelector('.am .paid')?.textContent).toBe('Paid Rs 1,462.00');
    expect(t7?.querySelector('.am .paid')).toBeNull();
    expect(badges(t12)).toEqual([]);
    expect(badges(fam)).toEqual(['c-info:Waiting for approval']);
    expect(badges(t2)).toEqual(['c-warn:Open too long · 4 h 12 min']);
  });

  it('[row F-6] amounts use the snapshot currency and its exponent, set LTR', async () => {
    const v = await show(setup({ currency: 'KWD', rows: [row({ identifier: 'T1', total_default_minor: 6_624, paid_minor: 1_000, partly_paid: true })] }));
    const r = rowsOf(v)[0]!;
    expect(r.querySelector('.am b')?.textContent).toBe('KWD 6.624');
    expect(r.querySelector('.am b')?.getAttribute('dir')).toBe('ltr');
    expect(r.querySelector('.am .paid')?.textContent).toBe('Paid KWD 1.000');
  });

  it('a tap opens the bill by the bill_ref rule (bill_id, else seating_id, else order_id); no handler → rows are not buttons', async () => {
    expect(billRefOf(ROWS[0]!)).toEqual({ bill_id: 'B7' });
    expect(billRefOf(ROWS[4]!)).toEqual({ seating_id: 'S9' });
    expect(billRefOf(ROWS[2]!)).toEqual({ order_id: 'O12' });
    const opened: unknown[] = [];
    const v = await show(setup(), (ref) => opened.push(ref));
    const rows = rowsOf(v);
    expect(rows.every((r) => r.tagName === 'BUTTON')).toBe(true);
    v.click(rows[4]);
    v.click(rows[2]);
    expect(opened).toEqual([{ seating_id: 'S9' }, { order_id: 'O12' }]);
    v.unmount();
    view = null;
    const plain = await show(setup());
    expect(rowsOf(plain).some((r) => r.tagName === 'BUTTON')).toBe(false);
  });

  it('refetches (debounced) on a bill, order or table frame, on reconnect and when the page turns visible; not on other frames', async () => {
    vi.useFakeTimers();
    const s = setup();
    await show(s);
    expect(s.query).toHaveBeenCalledTimes(1);
    let seq = 8;
    const ev = (event_type: string) => s.live.frame({ type: 'event', seq: ++seq, event: { event_type, payload: {} } } as never);
    ev('PaymentAdded');
    ev('CheckBillPrinted');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.query).toHaveBeenCalledTimes(2); // one read per burst
    ev('ItemAdded');
    await vi.advanceTimersByTimeAsync(300);
    ev('BillRequested');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.query).toHaveBeenCalledTimes(4);
    ev('StationRenamed');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.query).toHaveBeenCalledTimes(4);
    s.live.visibility('visible');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.query).toHaveBeenCalledTimes(5);
  });

  it('[G-26] the refetch frames hold every bill event, the order frames (OrdersBilled / OrdersUnbilled) and the table frames', () => {
    const bills = Object.keys(import.meta.glob('../../../../../packages/events/src/events/bill/*.v1.ts')).map((p) => p.replace(/^.*\/(\w+)\.v1\.ts$/, '$1'));
    expect(bills.length).toBeGreaterThan(15);
    for (const type of [...bills, 'OrdersBilled', 'OrdersUnbilled', 'OrderPlaced', 'OrderCancelled', 'ItemVoided', 'BillRequested', 'BillClosed', 'BillClosedEmpty', 'SeatingReopened', 'TablesMerged', 'SeatingSplit', 'TableMarksChanged'])
      expect(BILL_LIST_FRAMES.has(type), type).toBe(true);
    // a frame that changes no list row: kept out (OrdersCarriedOver keeps the order open and unbilled; the lock touch)
    expect(BILL_LIST_FRAMES.has('TableLockTouched')).toBe(false);
  });

  it('empty: "No open bills" and its sub-line; first load: skeleton rows', async () => {
    const s = setup({ rows: [] });
    let release: () => void = () => {};
    s.query.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = () => done({ ok: true as const, data: { bills: [], as_of_seq: 1 } });
        }),
    );
    const v = await show(s);
    expect(v.container.querySelectorAll('.sk').length).toBeGreaterThan(0);
    release();
    await flush();
    expect(v.container.querySelector('.empty b')?.textContent).toBe('No open bills');
    expect(v.text()).toContain('Bills show here as soon as a table orders or a takeaway is placed.');
    expect(v.container.querySelectorAll('.sk').length).toBe(0);
  });

  it('hub down: the last list stays, marked "as of <time>" and stale', async () => {
    const s = setup();
    const v = await show(s);
    (s.shell as { online: boolean }).online = false;
    v.render(
      <ShellContext.Provider value={{ ...s.shell, online: false }}>
        <OpenBills />
      </ShellContext.Provider>,
    );
    await flush();
    expect(v.container.querySelector('.b5-wl__h .b5-note')?.textContent).toBe('as of 1:40 PM');
    expect(rowsOf(v).length).toBe(6);
    expect(rowsOf(v).every((r) => r.className.includes('stale'))).toBe(true);
  });

  it('a reply older than the last request is dropped; a failed refetch keeps the list, marked stale "as of" its read', async () => {
    vi.useFakeTimers();
    const s = setup();
    let lateFirst: () => void = () => {};
    s.query.mockImplementationOnce(
      () =>
        new Promise((done) => {
          lateFirst = () => done({ ok: true as const, data: { bills: [row({ identifier: 'OLD' })], as_of_seq: 1 } });
        }),
    );
    const v = await show(s);
    s.live.frame({ type: 'event', seq: 50, event: { event_type: 'PaymentAdded', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    lateFirst();
    await vi.advanceTimersByTimeAsync(0);
    expect(rowsOf(v).map((r) => r.querySelector('.tcode')?.textContent)).toEqual(['T7', 'T4 + T5', '#12', 'PARKING ABC 123 SEDAN', 'Family 2', 'T2']);
    s.query.mockImplementationOnce(async () => ({ ok: false as const, error: { kind: 'network' as const } }) as never);
    s.live.frame({ type: 'event', seq: 51, event: { event_type: 'PaymentAdded', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.query).toHaveBeenCalledTimes(3);
    await flush();
    expect(rowsOf(v).length).toBe(6);
    expect(rowsOf(v).every((r) => r.className.includes('stale'))).toBe(true);
    expect(v.container.querySelector('.b5-wl__h .b5-note')?.textContent).toBe('as of 1:40 PM');
  });

  it('a failed read shows the error with Try again, which reads again', async () => {
    const s = setup({ fail: true });
    const v = await show(s);
    expect(v.container.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load the bills.");
    v.click(v.button('Try again'));
    await flush();
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[R20; frame OpenBillsUrdu] Urdu: the frame texts, amounts and times in Latin digits', async () => {
    setLanguage('ur');
    const v = await show(setup());
    expect(v.container.querySelector('.b5-wl__h h1')?.textContent).toBe('کھلے بل');
    const [t7, t45] = rowsOf(v) as HTMLElement[];
    expect(t7?.querySelector('.ty')?.textContent).toBe('ڈائن اِن');
    expect(t7?.querySelector('.b5-bd')?.textContent).toBe('چیک بل پرنٹ 1:32 PM');
    expect(t45?.querySelector('.b5-bd')?.textContent).toBe('جزوی ادائیگی');
    expect(t7?.querySelector('.am b')?.textContent).toBe('Rs 6,624.00');
  });
  it('[05 §8 Rules] every list key is in en, and in ur (frame OpenBillsUrdu) or 05/urdu-todo.md; Urdu keeps the placeholders', () => {
    const keys = Object.keys(en).filter((k) => /^billing\.(nav|list\.|badge\.|type\.)/.test(k));
    expect(keys.length).toBe(19);
    const holes = (x: string) => [...x.matchAll(/\{\w+\}/g)].map((m) => m[0]).join();
    for (const key of keys) {
      const u = (ur as Record<string, string | undefined>)[key];
      expect(u !== undefined || TODO_05.has(key), key).toBe(true);
      if (u !== undefined) {
        expect(TODO_05.has(key), key).toBe(false);
        expect(holes(u), key).toBe(holes((en as Record<string, string>)[key]!));
      }
    }
  });
});
