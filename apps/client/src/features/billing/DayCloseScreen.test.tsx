import type { ReportDocInput } from '@pos/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createPermissions } from '../staff/shell/permissions';
import { createToastBus } from '../staff/shell/toast';
import { DayCloseScreen, type DayCloseExits } from './DayCloseScreen';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.25 §8 "Day close" (staff app, close-business-day: blockers list — voids, open shifts, unbilled orders with
// Carry over — then Close; Z shown and printed), §3.13 (the guard order; R-76: a pending variance sign-off blocks),
// §6.24 CarryOverOrders, §6.25, §6.26 (R-85: the Z of the date, newest z_no) (plan §4.1 task 41, after hub task 25;
// frames DayClose, DayCloseVoids, DayCloseShifts, DayCloseUnbilled, CarryOver, DayCloseDone, DayCloseUrdu; the
// blocked lists as 01a's Message.items rows: one row per listed entry, "and N more" past the list).

type HubErr = { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' };
type Answer = { ok: true; data: unknown } | { ok: false; error: HubErr };

const blocked = (details: Record<string, unknown>): Answer => ({ ok: false, error: { kind: 'api', status: 409, code: 'DAY_CLOSE_BLOCKED', details } });
const AT = (h: number, mi: number) => Date.UTC(2026, 10, 19, h, mi);

const SHIFTS = blocked({ reason: 'shift_open', count: 2, shifts: [{ shift_id: 'SH7', staff_name: 'Usman', opened_at: AT(17, 0), is_drawer: true }, { shift_id: 'SH8', staff_name: 'Hamza', opened_at: AT(12, 0), is_drawer: false }] });
const VOIDS = blocked({ reason: 'void_pending', count: 4, voids: [{ identifier: 'T12', item: 'Mutton Karahi Full × 1', requester_name: 'Hamza' }, { identifier: 'F4 + F5', item: 'Chicken Karahi Full × 1', requester_name: 'Ali' }, { identifier: 'T2', item: 'Raita × 2', requester_name: 'Bilal' }] });
const SIGNOFFS = blocked({ reason: 'variance_pending', count: 1, shifts: [{ shift_id: 'SH3', staff_name: 'Sana', closed_at: AT(16, 5), alert_id: 'A9' }] });
const UNBILLED = blocked({
  reason: 'unbilled_orders',
  count: 3,
  orders: [
    { order_id: 'O1', identifier: 'T2', total_minor: 428_000, placed_at: AT(19, 40), open_minutes: 252 },
    { order_id: 'O2', identifier: '#15', total_minor: 64_000, placed_at: AT(23, 38), open_minutes: 14 },
    { order_id: 'O3', identifier: 'F1', total_minor: 726_000, placed_at: AT(23, 21), open_minutes: 31 },
  ],
});
const CLOSED: Answer = { ok: true, data: { business_date: '2026-11-19', opened_at: AT(9, 0), closed_at: AT(23, 58), changed: true } };

function zReport(z_no: number): ReportDocInput {
  return {
    kind: 'z',
    z_no,
    business_date: '2026-11-19',
    issued_at: AT(23, 58),
    currency_code: 'PKR',
    sales: { invoice_count: 104, gross_minor: 0, discounts: { count: 0, value_minor: 0, by_reason: [], entries: [] }, service_charge_minor: 0, net_minor: 0, taxes: [], rounding_minor: 0, total_minor: 0 },
    credits: { count: 0, value_minor: 0, by_reason: [] },
    net_after_credits_minor: 49_821_400,
    payments_by_mode: [],
    comps: { value_minor: 0, voided_minor: 0, removals: { count: 0, value_minor: 0 } },
    voids: [],
    reopens: { count: 0, value_minor: 0, entries: [] },
    petty_cash: [],
    open_advances: [],
    shifts: [],
    variance_signoffs: [],
    pending_signoffs: [],
    takings_by_taker: [],
    full_refunds: { count: 0, value_minor: 0 },
    fiscal: { pending: 0, acked: 104, rejected: 0, not_required: 0 },
    bills: { count: 104, average_minor: 479_052 },
    open_bills: [],
    carried_over: [],
    brought_forward: [],
    carried_forward: [],
  };
}

function setup(o: { answers?: Answer[]; zPage?: Answer; grants?: Record<string, unknown> } = {}) {
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? CLOSED;
  });
  const page = vi.fn(async (path: string): Promise<Answer> => {
    void path;
    return o.zPage ?? { ok: true, data: { data: { reports: [{ business_date: '2026-11-19', z_no: 43, report: zReport(43), staff_names: {} }] }, next_cursor: null } };
  });
  const query = vi.fn(async (): Promise<Answer> => ({ ok: false, error: { kind: 'network' } }));
  const toasts = createToastBus();
  const shown: string[] = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x.text);
    return show(x);
  };
  const shell = {
    device: { id: 'D1', type: 'tablet', token: 't' },
    meta: { branchName: 'Gulberg' },
    me: { staff_id: 'S-IMRAN', name: 'Imran' },
    api: { query, command, page },
    live: createLiveBus(),
    toasts,
    permissions: createPermissions({ 'close-business-day': { grant: 'allowed', scope: 'branch' }, ...o.grants } as never),
    config: { config: () => null, snapshot: () => ({ currency_code: 'PKR' }), subscribe: () => () => {} },
    clock: { nowMs: () => AT(23, 50), utcOffsetMs: 0 },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, command, page, shown };
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

const navigate = vi.fn();
const ALL: DayCloseExits = { closeShift: true, ownShift: true, bill: true, requests: true, reports: true };
async function show(s: ReturnType<typeof setup>, exits: DayCloseExits = ALL) {
  navigate.mockReset();
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <DayCloseScreen onNavigate={navigate} exits={exits} />
    </ShellContext.Provider>,
  );
  await flush();
  return m;
}

const steps = (v: Mounted) =>
  [...v.container.querySelectorAll('.b5-gs')].map((g) => [(g.textContent ?? '').replace(g.querySelector('.r')?.textContent ?? '', ''), g.className.replace('b5-gs', '').trim(), g.querySelector('.r')?.textContent]);
const close = async (v: Mounted) => {
  v.click(v.button('Close day'));
  await flush();
};

describe('[05 §8 Day close, §3.13] Close day and the guard order (frame DayClose)', () => {
  it('before: every step "checked next" (R-76: pending sign-offs is a step), no list; Close day sends CloseBusinessDay {}', async () => {
    const s = setup({ answers: [SHIFTS] });
    const v = await show(s);
    expect(v.container.querySelector('.b5-dcard h1')?.textContent).toBe('Close the day');
    expect(v.container.querySelector('.b5-dcard .when')?.textContent).toBe('Gulberg');
    expect(steps(v)).toEqual([
      ['Void requests', '', 'checked next'],
      ['Open shifts', '', 'checked next'],
      ['Pending sign-offs', '', 'checked next'],
      ['Orders not billed', '', 'checked next'],
    ]);
    expect(v.text()).not.toContain('never stops the close');
    await close(v);
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['CloseBusinessDay', {}]);
  });

  it('[frame DayCloseShifts] shift_open: the steps before clear, this one "fix this"; a row per shift with Close this shift → that shift', async () => {
    const v = await show(setup({ answers: [SHIFTS] }));
    await close(v);
    expect(steps(v)).toEqual([
      ['Void requests', 'ok', 'clear'],
      ['Open shifts', 'now', 'fix this'],
      ['Pending sign-offs', '', 'checked next'],
      ['Orders not billed', '', 'checked next'],
    ]);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('2 shifts are still open — close them first');
    const rows = [...v.container.querySelectorAll('.b5-br')];
    expect(rows.map((r) => r.querySelector('b')?.textContent)).toEqual(['Usman', 'Hamza']);
    expect(rows[0]!.textContent).toContain('open since 5:00 PM · drawer');
    expect(rows[1]!.textContent).toContain('open since 12:00 PM · no drawer');
    v.click(rows[0]!.querySelector('button')!);
    expect(navigate).toHaveBeenCalledWith('/shift?shift_id=SH7');
  });

  it('[frame DayCloseVoids] void_pending: 04\'s rows (identifier, item, asked by), "and N more", Open Requests', async () => {
    const v = await show(setup({ answers: [VOIDS] }));
    await close(v);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('4 void requests are still open — answer them first');
    expect([...v.container.querySelectorAll('.b5-br')].map((r) => r.textContent)).toEqual(['T12Mutton Karahi Full × 1 · asked by Hamza', 'F4 + F5Chicken Karahi Full × 1 · asked by Ali', 'T2Raita × 2 · asked by Bilal']);
    expect(v.container.querySelector('.b5-more')?.textContent).toBe('and 1 more');
    v.click(v.button('Open Requests'));
    expect(navigate).toHaveBeenCalledWith('/requests');
  });

  it('[R-76] variance_pending: the sign-offs still to answer, Open Requests', async () => {
    const v = await show(setup({ answers: [SIGNOFFS] }));
    await close(v);
    expect(steps(v)[2]).toEqual(['Pending sign-offs', 'now', 'fix this']);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('1 variance sign-off is still pending — answer it first');
    expect(v.container.querySelector('.b5-br')?.textContent).toContain('Sana');
    expect(v.container.querySelector('.b5-br')?.textContent).toContain('closed 4:05 PM');
    expect(v.buttons().some((b) => b.textContent === 'Open Requests')).toBe(true);
  });

  it('a reason or shape the client does not know: the generic text, no list', async () => {
    const v = await show(setup({ answers: [blocked({ reason: 'something_new', count: 1 })] }));
    await close(v);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe(en['billing.dayclose.blocked_generic']);
    expect(v.container.querySelectorAll('.b5-br')).toHaveLength(0);
  });

  it('nothing changed: not_open / opened_recently say so', async () => {
    const v = await show(setup({ answers: [{ ok: true, data: { business_date: null, opened_at: null, closed_at: null, changed: false, reason: 'not_open' } }, { ok: true, data: { business_date: '2026-11-19', opened_at: AT(23, 0), closed_at: null, changed: false, reason: 'opened_recently' } }] }));
    await close(v);
    expect(v.text()).toContain('No day is open to close');
    await close(v);
    expect(v.text()).toContain('The day opened too recently to close; nothing changed');
  });

  it('offline: Close day says "Needs the hub" and sends nothing', async () => {
    const s = setup();
    (s.shell as { online: boolean }).online = false;
    const v = await show(s);
    expect(v.button('Close day').getAttribute('aria-disabled')).toBe('true');
    await close(v);
    expect(s.command).not.toHaveBeenCalled();
    expect(v.text()).toContain('Needs the hub');
  });
});

describe('[task 41 review] exits the person may use (R5); own shift; the Z read', () => {
  it('[M2] without close-shift-for-others, take-payment or the requests route: no Close this shift, no Open bill, no Open Requests', async () => {
    const none: DayCloseExits = { closeShift: false, ownShift: true, bill: false, requests: false, reports: false };
    const v = await show(setup({ answers: [SHIFTS, VOIDS, UNBILLED] }), none);
    await close(v);
    expect(v.buttons().some((b) => b.textContent === 'Close this shift')).toBe(false);
    await close(v);
    expect(v.buttons().some((b) => b.textContent === 'Open Requests')).toBe(false);
    expect(v.text()).toContain('Someone allowed to answer them does it in Requests.');
    await close(v);
    expect(v.buttons().some((b) => b.textContent === 'Open bill')).toBe(false);
  });

  it('[m3] my own open shift opens as My shift (#/shift, no shift_id)', async () => {
    const own = blocked({ reason: 'shift_open', count: 1, shifts: [{ shift_id: 'SH1', staff_name: 'Imran', opened_at: AT(9, 0), is_drawer: true }] });
    const v = await show(setup({ answers: [own] }));
    await close(v);
    v.click(v.button('Close this shift'));
    expect(navigate).toHaveBeenCalledWith('/shift');
  });

  it('[M1] the Z read refused (no view-reports) or failed: "Day closed" and where to see it — never "no Z"', async () => {
    const v = await show(setup({ zPage: { ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { permission: 'view-reports' } } } }));
    await close(v);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('Day closed');
    expect(v.text()).toContain('The Z is saved and printed.');
    expect(v.text()).not.toContain('No Z report for this day');
    v.click(v.button('Reports'));
    expect(navigate).toHaveBeenCalledWith('/reports');
  });

  it('[D32] a lost close reply: the resend carries the same command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }] });
    const v = await show(s);
    await close(v);
    expect(v.text()).toContain('Needs the hub');
    await close(v);
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
  });
});

describe('[05 §8, §6.24] unbilled orders and Carry over (frames DayCloseUnbilled, CarryOver)', () => {
  it('rows with a tick, the amount, placed and open time, Open bill; Carry over {n} after ticking', async () => {
    const v = await show(setup({ answers: [UNBILLED] }));
    await close(v);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('3 orders are not billed — bill them or carry them over');
    const rows = [...v.container.querySelectorAll('.b5-br')];
    expect(rows[0]!.textContent).toContain('T2');
    expect(rows[0]!.textContent).toContain('Rs 4,280.00');
    expect(rows[0]!.textContent).toContain('placed 7:40 PM · open 4 h 12 min');
    expect(v.buttons().some((b) => b.textContent?.startsWith('Carry over'))).toBe(false);
    v.click(rows[0]!.querySelector('.b5-tick')!);
    v.click(rows[1]!.querySelector('.b5-tick')!);
    await flush();
    expect(v.text()).toContain('2 ticked');
    expect(v.button('Carry over 2')).toBeTruthy();
    v.click([...rows[2]!.querySelectorAll('button')].find((b) => b.textContent === 'Open bill')!);
    expect(navigate).toHaveBeenCalledWith('/bill?order_id=O3');
  });

  it('the sheet: the ticked orders, Why (CARRY_OVER_REASONS), a note needed for Other → CarryOverOrders; the rows leave the list', async () => {
    const s = setup({ answers: [UNBILLED, { ok: true, data: { business_date: '2026-11-19', order_ids: ['O1', 'O2'] } }] });
    const v = await show(s);
    await close(v);
    const rows = [...v.container.querySelectorAll('.b5-br')];
    v.click(rows[0]!.querySelector('.b5-tick')!);
    v.click(rows[1]!.querySelector('.b5-tick')!);
    await flush();
    v.click(v.button('Carry over 2'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Carry over to tomorrow');
    expect(v.container.querySelector('.dlg__t .ac__who')?.textContent).toBe('2 orders');
    expect([...v.container.querySelectorAll('.dlg .b5-chip')].map((c) => c.textContent)).toEqual(['Table still seated', 'Customer will pay later', 'Other']);
    const primary = () => v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!;
    expect(primary().textContent).toBe('Pick a reason');
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')].find((c) => c.textContent === 'Other')!);
    await flush();
    expect(primary().textContent).toBe('Write why first');
    const note = v.container.querySelector('.dlg textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Wedding party stays');
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    expect(primary().textContent).toBe('Carry over 2 orders');
    v.click(primary());
    await flush();
    expect(s.command.mock.calls[1]!.slice(0, 2)).toEqual(['CarryOverOrders', { order_ids: ['O1', 'O2'], reason_code: 'other', note: 'Wedding party stays' }]);
    expect(s.shown).toEqual(['2 orders carried over — tap Close day again']);
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect([...v.container.querySelectorAll('.b5-br .tcode')].map((c) => c.textContent)).toEqual(['F1']);
  });

  it('[m5] more orders than listed: carrying the listed ones says to tap Close day for the next, not "all carried"', async () => {
    const many = blocked({ reason: 'unbilled_orders', count: 45, orders: [{ order_id: 'O1', identifier: 'T2', total_minor: 1, placed_at: AT(19, 0), open_minutes: 5 }] });
    const v = await show(setup({ answers: [many, { ok: true, data: { business_date: '2026-11-19', order_ids: ['O1'] } }] }));
    await close(v);
    v.click(v.container.querySelector('.b5-br .b5-tick')!);
    await flush();
    v.click(v.button('Carry over 1'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')].find((c) => c.textContent === 'Table still seated')!);
    await flush();
    v.click(v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!);
    await flush();
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('The listed orders are carried over — tap Close day again for the next ones');
  });

  it('a refusal (ORDER_BILLED) shows in the sheet', async () => {
    const v = await show(setup({ answers: [UNBILLED, { ok: false, error: { kind: 'api', status: 409, code: 'ORDER_BILLED', details: {} } }] }));
    await close(v);
    v.click(v.container.querySelector('.b5-br .b5-tick')!);
    await flush();
    v.click(v.button('Carry over 1'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.dlg .b5-chip')].find((c) => c.textContent === 'Table still seated')!);
    await flush();
    v.click(v.container.querySelector<HTMLButtonElement>('.dlg .acts .btn--primary')!);
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toContain('Tap Close day again to refresh the list.');
  });
});

describe('[05 §8, §6.26, R-85] day closed (frame DayCloseDone)', () => {
  it('every step clear; the Z of that date read after the close (newest z_no); "the Z prints by itself"', async () => {
    const s = setup();
    const v = await show(s);
    await close(v);
    expect(s.page.mock.calls[0]![0]).toBe('/queries/z-reports?business_date=2026-11-19&limit=1');
    expect(steps(v).map((x) => x[1])).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('Day closed · Z 0043');
    expect(v.text()).toContain('Thu 19 Nov · issued 11:58 PM · the Z prints by itself');
    expect(v.container.querySelector('.b5-kpi.hero b')?.textContent).toBe('Rs 498,214.00');
    expect(v.buttons().some((b) => b.textContent === 'Close day')).toBe(false);
  });

  it('[§6.22, R-87] Print again → PrintReport { doc: z_report, ref_id: the date }; only with view-reports', async () => {
    const s = setup({ answers: [CLOSED, { ok: true, data: { printed: true, job_id: 'J1', printer_name: 'Office' } }] });
    const v = await show(s);
    await close(v);
    v.click(v.button('Print again'));
    await flush();
    expect(s.command.mock.calls[1]!.slice(0, 2)).toEqual(['PrintReport', { doc: 'z_report', ref_id: '2026-11-19' }]);
    expect(s.shown).toEqual(['Sent to Office']);
    v.unmount();
    m = await show(setup(), { ...ALL, reports: false });
    await close(m);
    expect(m.buttons().some((b) => b.textContent === 'Print again')).toBe(false);
  });

  it('[R-85 (2)] no Z for the date (no branch settings): "Day closed" and the note', async () => {
    const v = await show(setup({ zPage: { ok: true, data: { data: { reports: [] }, next_cursor: null } } }));
    await close(v);
    expect(v.container.querySelector('.b5-blk__h b')?.textContent).toBe('Day closed');
    expect(v.text()).toContain('No Z report for this day');
  });
});

describe('[05 §8 i18n] texts', () => {
  it('[frame DayCloseUrdu] Urdu: the drawn texts', async () => {
    setLanguage('ur');
    const v = await show(setup({ answers: [SHIFTS] }));
    expect(v.container.querySelector('.b5-dcard h1')?.textContent).toBe('دن بند کریں');
    v.click(v.container.querySelector<HTMLButtonElement>('.b5-dcard .btn--primary')!);
    await flush();
    expect(v.text()).toContain('کھلی شفٹیں');
    expect(v.text()).toContain('اسے ٹھیک کریں');
    expect(v.text()).toContain('یہ شفٹ بند کریں');
  });

  it('every key of the task 41 block is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 41, day close)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((x) => x[1]!);
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
    }
  });
});
