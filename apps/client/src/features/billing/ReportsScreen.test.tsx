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
import type { FiscalStatusView } from './contracts';
import { FiscalLine, fiscalLineOf } from './FiscalLine';
import { ReportsScreen } from './ReportsScreen';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.24 §8 "Reports" (X any time and the Z list, view-reports; the fiscal status line on the cashier screen when
// the adapter is not none), §6.26 (R-83 field names; R-85: Z by z_no, a date can have several, newest first), §6.27,
// §6.28 RetryFiscalNow (close-business-day), B26 (plan §4.1 task 42, after hub tasks 26b and 31; frames XReport,
// ZList, ZReport, ReportsTablet, OpenBillsFiscal).

type HubErr = { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' };
type Answer = { ok: true; data: unknown } | { ok: false; error: HubErr };

function report(over: Partial<ReportDocInput> = {}): ReportDocInput {
  return {
    kind: 'x',
    z_no: null,
    business_date: '2026-11-19',
    issued_at: Date.UTC(2026, 10, 19, 16, 15),
    currency_code: 'PKR',
    sales: {
      invoice_count: 86,
      gross_minor: 41_260_000,
      discounts: { count: 3, value_minor: 418_000, by_reason: [{ reason_code: 'regular_customer', count: 2, value_minor: 296_000 }, { reason_code: 'owner_guest', count: 1, value_minor: 122_000 }], entries: [] },
      service_charge_minor: 235_000,
      net_minor: 41_077_000,
      taxes: [
        { tax_code: 'PST', label: 'Punjab sales tax on services', tax_profile_id: 'svc', payment_class: 'cash', rate_bp: 1_600, tax_minor: 3_784_000 },
        { tax_code: 'PST', label: 'Punjab sales tax on services', tax_profile_id: 'svc', payment_class: 'digital', rate_bp: 500, tax_minor: 871_350 },
      ],
      rounding_minor: 3_850,
      total_minor: 45_736_200,
    },
    credits: { count: 1, value_minor: 599_600, by_reason: [{ reason_code: 'wrong_payment_mode', count: 1, value_minor: 599_600 }] },
    net_after_credits_minor: 45_136_600,
    payments_by_mode: [
      { mode_name: 'Cash', in_minor: 26_474_900, out_minor: 32_500, change_minor: 4_188_000 },
      { mode_name: 'Card', in_minor: 16_521_000, out_minor: 0, change_minor: 0 },
    ],
    comps: { value_minor: 290_000, voided_minor: 0, removals: { count: 1, value_minor: 145_000 } },
    voids: [{ disposition: 'wastage', count: 3, value_minor: 90_000 }],
    reopens: { count: 1, value_minor: 599_600, entries: [{ requester_staff_id: 'S-SANA', approver_staff_id: 'S-IMRAN' }] },
    petty_cash: [{ category_name: 'Supplies', kind: 'out', amount_minor: 60_000 }],
    open_advances: [{ staff_id: 'S-ALI', amount_minor: 100_000, age_minutes: 120 }],
    shifts: [
      { staff_id: 'S-SANA', float_minor: 500_000, expected_minor: null, counted_minor: null, variance_minor: null, skipped: false, signoff_state: null },
      { staff_id: 'S-HAMZA', float_minor: 0, expected_minor: 1_252_000, counted_minor: 1_248_000, variance_minor: -4_000, skipped: false, signoff_state: null },
      { staff_id: 'S-USMAN', float_minor: 0, expected_minor: 3_911_000, counted_minor: 3_886_000, variance_minor: -25_000, skipped: false, signoff_state: 'pending sign-off' },
      { staff_id: 'S-BILAL', float_minor: 0, expected_minor: null, counted_minor: null, variance_minor: null, skipped: true, signoff_state: null },
    ],
    variance_signoffs: [{ shift_date: '2026-11-17', staff_id: 'S-USMAN', amount_minor: -15_000, outcome: 'approved', approver_staff_id: 'S-IMRAN', at: 1 }],
    pending_signoffs: [{ shift_date: '2026-11-19', staff_id: 'S-USMAN', amount_minor: -25_000 }],
    takings_by_taker: [{ staff_id: 'S-SANA', amount_minor: 30_000_000 }],
    full_refunds: { count: 0, value_minor: 0 },
    fiscal: { pending: 3, acked: 83, rejected: 0, not_required: 0 },
    bills: { count: 86, average_minor: 524_844 },
    open_bills: [{ identifier: 'T2', open_minutes: 252, flagged: true }, { identifier: 'T7', open_minutes: 46, flagged: false }],
    carried_over: [{ label: '#12', carried_in: true }],
    brought_forward: [],
    carried_forward: [],
    ...over,
  };
}

const NAMES = { 'S-SANA': 'Sana', 'S-HAMZA': 'Hamza', 'S-USMAN': 'Usman', 'S-BILAL': 'Bilal', 'S-IMRAN': 'Imran', 'S-ALI': 'Ali' };
const zRow = (z_no: number, business_date: string, net: number, print: { job_id: string; state: string; printer_name: string | null } | null = null) => ({
  business_date,
  z_no,
  report: report({ kind: 'z', z_no, business_date, net_after_credits_minor: net, open_bills: [] }),
  staff_names: NAMES,
  print,
});

interface Opts {
  x?: Answer;
  pages?: Answer[];
  answers?: Answer[];
  grants?: Record<string, unknown>;
}

function setup(o: Opts = {}) {
  const query = vi.fn(async (path: string): Promise<Answer> => {
    void path;
    return o.x ?? { ok: true, data: { report: report(), staff_names: NAMES } };
  });
  const pages = [...(o.pages ?? [{ ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 49_821_400), zRow(42, '2026-11-18', 41_230_000)] }, next_cursor: null } }])];
  const page = vi.fn(async (path: string): Promise<Answer> => {
    void path;
    return pages.length > 1 ? pages.shift()! : pages[0]!;
  });
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { pending_count: 3 } };
  });
  const toasts = createToastBus();
  const shown: string[] = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x.text);
    return show(x);
  };
  const shell = {
    device: { id: 'D1', type: 'cashier_kiosk', token: 't' },
    api: { query, command, page },
    live: createLiveBus(),
    toasts,
    permissions: createPermissions({ 'view-reports': { grant: 'allowed', scope: 'branch' }, ...o.grants } as never),
    config: { config: () => null, snapshot: () => ({ currency_code: 'PKR' }), subscribe: () => () => {} },
    clock: { nowMs: () => Date.UTC(2026, 10, 19, 16, 20), utcOffsetMs: 0 },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, query, page, command, shown };
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

async function show(s: ReturnType<typeof setup>) {
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <ReportsScreen />
    </ShellContext.Provider>,
  );
  await flush();
  return m;
}

const rows = (v: Mounted, card: string) =>
  [...v.container.querySelectorAll('.b5-rc')].find((c) => c.querySelector('h3')?.textContent === card)?.querySelectorAll('.b5-rr') ?? [];
const rowText = (v: Mounted, card: string) => [...rows(v, card)].map((r) => r.textContent);
const seg = (v: Mounted, text: string) => [...v.container.querySelectorAll<HTMLButtonElement>('.b5-seg button')].find((b) => b.textContent?.trim() === text)!;

describe('[05 §8 Reports, §6.26] Today (X) (frame XReport)', () => {
  it('reads the X; the head line; four KPIs (net after credits, invoices, average, fiscal)', async () => {
    const s = setup();
    const v = await show(s);
    expect(s.query.mock.calls[0]![0]).toBe('/queries/x-report');
    expect(seg(v, 'Today (X)').getAttribute('aria-pressed')).toBe('true');
    expect(v.container.querySelector('.b5-rep-line .b5-note')?.textContent).toBe('X · Thu 19 Nov · issued 4:15 PM · PKR');
    const kpis = [...v.container.querySelectorAll('.b5-kpi')].map((k) => [k.querySelector('span')?.textContent, k.querySelector('b')?.textContent, k.querySelector('small')?.textContent]);
    expect(kpis).toEqual([
      ['Net after credits', 'Rs 451,366.00', 'so far today'],
      ['Invoices', '86', '1 credit note'],
      ['Average bill', 'Rs 5,248.44', '86 bills'],
      ['Fiscal', '3 waiting', '83 accepted · 0 not accepted'],
    ]);
  });

  it('[R-83] Sales: gross, discounts by reason, service charge, net, one row per tax (key, rate, label), rounding apart, total, credits, net after credits', async () => {
    const v = await show(setup());
    expect(rowText(v, 'Sales')).toEqual([
      'Gross412,600.00',
      'Discounts · 3−4,180.00',
      'Regular customer · 2−2,960.00',
      'Owner guest · 1−1,220.00',
      'Service charge2,350.00',
      'Net410,770.00',
      'Punjab sales tax on services · 16 % · cash37,840.00',
      'Punjab sales tax on services · 5 % · digital8,713.50',
      'Rounding+38.50',
      'Total457,362.00',
      'Credits · 1−5,996.00',
      'Wrong payment type · 1−5,996.00',
      'Net after credits451,366.00',
    ]);
    expect(rows(v, 'Sales')[8]!.className).toContain('rnd');
  });

  it('Payments by mode (in / back / change given), takings by person; shifts with their state (uncounted: no expected); fiscal; open bills; petty; comps, voids, reopens', async () => {
    const v = await show(setup());
    expect(rowText(v, 'Payments by mode')).toEqual([
      'Cash · in264,749.00',
      'Cash · back−325.00',
      'Cash · change given41,880.00',
      'Card165,210.00',
      'Takings by person',
      'Sana300,000.00',
      'Brought forward0.00',
      'Carried forward0.00',
    ]);
    expect(rowText(v, 'Shifts')).toEqual([
      'Sana · float 5,000.00 · openOpen',
      'Hamza · expected 12,520.00 · counted 12,480.00 · Short 40.00Within',
      'Usman · expected 39,110.00 · counted 38,860.00 · Short 250.00Pending sign-off',
      'Bilal · skipped the countSkipped',
      'Variance sign-offs today',
      'Usman · 17 Nov · −150.00Approved by Imran · 12:00 AM',
      'Pending sign-offs1',
      'Usman · 19 Nov−250.00',
    ]);
    expect(rowText(v, 'Fiscal')).toEqual(['Accepted83', 'Pending3', 'Not accepted0', 'Not required0']);
    expect(rowText(v, 'Open bills')).toEqual(['Open now2', 'Open too longT2 · 4 h 12 min', 'Carried in#12']);
    expect(rowText(v, 'Petty cash')).toEqual(['Cash out · Supplies600.00', 'Open advancesAli · 1,000.00 · 2 h 00 min']);
    expect(rowText(v, 'Comps, voids, reopens')).toEqual(['Comps2,900.00', 'Comp removals1 · 1,450.00', 'Voids · Wastage3 · 900.00', 'Reopens1 · 5,996.00', 'asked Sana, approved Imran']);
  });

  it('[§6.28] Retry fiscal now only with close-business-day: RetryFiscalNow {} → "{n} waiting — sending now"; reads the X again', async () => {
    const none = await show(setup());
    expect(none.buttons().some((b) => b.textContent === 'Retry fiscal now')).toBe(false);
    none.unmount();
    const s = setup({ grants: { 'close-business-day': { grant: 'allowed', scope: 'branch' } } });
    m = await show(s);
    m.click(m.button('Retry fiscal now'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['RetryFiscalNow', {}]);
    expect(s.shown).toEqual(['3 waiting — sending now']);
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[review M1] the hub\'s sign-off strings: pending sign-off warn, approved ok, disputed danger; an unknown one as is, never "Within"', async () => {
    const shifts = (['pending sign-off', 'approved', 'disputed', 'odd'] as const).map((st, i) => ({ staff_id: `S${i}`, float_minor: 0, expected_minor: 100, counted_minor: 90, variance_minor: -10, skipped: false, signoff_state: st }));
    const v = await show(setup({ x: { ok: true, data: { report: report({ shifts, variance_signoffs: [], pending_signoffs: [] }), staff_names: {} } } }));
    const chips = [...rows(v, 'Shifts')].slice(0, 4).map((r) => [r.querySelector('.st')?.textContent, r.querySelector('.st')?.className]);
    expect(chips).toEqual([
      ['Pending sign-off', 'st c-warn'],
      ['Approved', 'st c-ok'],
      ['Disputed', 'st c-danger'],
      ['odd', 'st c-warn'],
    ]);
  });

  it('[§6.26] each discount\'s asker and approver (frame: "asked Sana, approved Imran")', async () => {
    const discounts = { count: 2, value_minor: 418_000, by_reason: [], entries: [{ requester_staff_id: 'S-SANA', approver_staff_id: 'S-IMRAN', method: 'approval', value_minor: 296_000 }, { requester_staff_id: 'S-ALI', approver_staff_id: null, method: 'direct', value_minor: 122_000 }] };
    const base = report();
    const v = await show(setup({ x: { ok: true, data: { report: { ...base, sales: { ...base.sales, discounts } }, staff_names: NAMES } } }));
    expect(rowText(v, 'Sales').slice(1, 4)).toEqual(['Discounts · 2−4,180.00', 'asked Sana, approved Imran−2,960.00', 'Ali−1,220.00']);
  });

  it('[review m2] brought / carried forward: the hub\'s rows by mode and staff, never a client total', async () => {
    const v = await show(setup({ x: { ok: true, data: { report: report({ brought_forward: [{ mode_name: 'Cash', staff_id: 'S-SANA', amount_minor: 100_000 }, { mode_name: 'Card', staff_id: 'S-SANA', amount_minor: 50_000 }] }), staff_names: NAMES } } }));
    const pay = rowText(v, 'Payments by mode');
    expect(pay).toContain('Brought forward');
    expect(pay).toContain('Cash · Sana1,000.00');
    expect(pay).toContain('Card · Sana500.00');
    expect(v.text()).not.toContain('1,500.00');
  });

  it('[review m4] no open day (BUSINESS_DAY_NOT_OPEN): its own note and See Z reports, no Try again', async () => {
    const s = setup({ x: { ok: false, error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } } });
    const v = await show(s);
    expect(v.text()).toContain('No day is open, so there is no X.');
    expect(v.buttons().some((b) => b.textContent === 'Try again')).toBe(false);
    v.click(v.button('See Z reports'));
    await flush();
    expect(seg(v, 'Z reports').getAttribute('aria-pressed')).toBe('true');
    expect(s.page).toHaveBeenCalledTimes(1);
  });

  it('[review m8] Retry fiscal now only with something pending', async () => {
    const v = await show(setup({ grants: { 'close-business-day': { grant: 'allowed', scope: 'branch' } }, x: { ok: true, data: { report: report({ fiscal: { pending: 0, acked: 86, rejected: 0, not_required: 0 } }), staff_names: NAMES } } }));
    expect(v.buttons().some((b) => b.textContent === 'Retry fiscal now')).toBe(false);
    expect(v.container.querySelectorAll('.b5-kpi')[3]!.querySelector('b')?.textContent).toBe('All sent');
  });

  it('a negative net after credits (a day of refunds) reads with its sign', async () => {
    const v = await show(setup({ x: { ok: true, data: { report: report({ net_after_credits_minor: -59_960 }), staff_names: NAMES } } }));
    expect(v.container.querySelector('.b5-kpi.hero b')?.textContent).toBe('-Rs 599.60');
  });

  it('rejected invoices: "Not accepted invoices need a fix from support"', async () => {
    const v = await show(setup({ x: { ok: true, data: { report: report({ fiscal: { pending: 0, acked: 80, rejected: 2, not_required: 0 } }), staff_names: NAMES } } }));
    expect(v.text()).toContain('Not accepted invoices need a fix from support');
    expect(v.container.querySelectorAll('.b5-kpi')[3]!.querySelector('b')?.textContent).toBe('2 not accepted');
  });

  it('a refusal or the hub down: its text and Try again', async () => {
    const v = await show(setup({ x: { ok: false, error: { kind: 'network' } } }));
    expect(v.container.querySelector('.msg span')?.textContent).toBe('Needs the hub');
    expect(v.buttons().some((b) => b.textContent === 'Try again')).toBe(true);
  });
});

describe('[05 §8 Reports, §6.26, R-85] Z reports (frames ZList, ZReport)', () => {
  it('newest first by z_no (a date can have two); each row: Z no, date, invoices · closed time, net; the first is shown', async () => {
    const s = setup({ pages: [{ ok: true, data: { data: { reports: [zRow(44, '2026-11-19', 1_000_000), zRow(43, '2026-11-19', 49_821_400), zRow(42, '2026-11-18', 41_230_000)] }, next_cursor: null } }] });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    expect(s.page.mock.calls[0]![0]).toBe('/queries/z-reports?limit=20');
    const list = [...v.container.querySelectorAll('.b5-zl')];
    expect(list.map((r) => r.querySelector('.z')?.textContent)).toEqual(['Z 0044', 'Z 0043', 'Z 0042']);
    expect(list[1]!.textContent).toBe('Z 0043Thu 19 Nov86 invoices · closed 4:15 PMZ not printed — print it from the Z screenRs 498,214.00net');
    expect(list[0]!.className).toContain('is-sel');
    expect(v.container.querySelector('.b5-kpi small')?.textContent).toBe('Z 0044');
    v.click(list[2] as HTMLElement);
    await flush();
    expect(v.container.querySelector('.b5-zl.is-sel .z')?.textContent).toBe('Z 0042');
    expect(v.container.querySelector('.b5-kpi.hero b')?.textContent).toBe('Rs 412,300.00');
    // a Z has no open bills card (X only)
    expect(rows(v, 'Open bills')).toHaveLength(0);
  });

  it('cursor paging: Load older asks the next page and appends it', async () => {
    const s = setup({
      pages: [
        { ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 1)] }, next_cursor: 'C1' } },
        { ok: true, data: { data: { reports: [zRow(42, '2026-11-18', 2)] }, next_cursor: null } },
      ],
    });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    v.click(v.button('Load older'));
    await flush();
    expect(s.page.mock.calls[1]![0]).toBe('/queries/z-reports?limit=20&cursor=C1');
    expect([...v.container.querySelectorAll('.b5-zl .z')].map((z) => z.textContent)).toEqual(['Z 0043', 'Z 0042']);
    expect(v.buttons().some((b) => b.textContent === 'Load older')).toBe(false);
  });

  it('[review m5] a double tap on Load older reads one page; a row seen already is not repeated', async () => {
    let release: (a: Answer) => void = () => {};
    const s = setup({ pages: [{ ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 1)] }, next_cursor: 'C1' } }] });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    s.page.mockImplementationOnce(() => new Promise<Answer>((r) => (release = r)));
    const older = v.button('Load older');
    v.click(older);
    v.click(older);
    release({ ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 1), zRow(42, '2026-11-18', 2)] }, next_cursor: null } });
    await flush();
    expect(s.page).toHaveBeenCalledTimes(2);
    expect([...v.container.querySelectorAll('.b5-zl .z')].map((z) => z.textContent)).toEqual(['Z 0043', 'Z 0042']);
  });

  it('no Z yet: "No Z reports yet"', async () => {
    const v = await show(setup({ pages: [{ ok: true, data: { data: { reports: [] }, next_cursor: null } }] }));
    v.click(seg(v, 'Z reports'));
    await flush();
    expect(v.text()).toContain('No Z reports yet');
  });
});

describe('[05 §6.22, R-87; frames XReport, ZReport] Print (hub task 27b)', () => {
  it('X: Print → PrintReport { doc: x_report } (no ref_id); "Sent to {printer}"', async () => {
    const s = setup({ answers: [{ ok: true, data: { printed: true, job_id: 'J1', printer_name: 'Counter' } }] });
    const v = await show(s);
    v.click(v.button('Print'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['PrintReport', { doc: 'x_report' }]);
    expect(s.shown).toEqual(['Sent to Counter']);
  });

  it('no printer routed (printed: false) says so; a refusal reads its text; a lost reply resends with the same command_id', async () => {
    const s = setup({
      answers: [
        { ok: true, data: { printed: false, job_id: null, printer_name: null } },
        { ok: false, error: { kind: 'api', status: 409, code: 'BUSINESS_DAY_NOT_OPEN', details: {} } },
        { ok: false, error: { kind: 'network' } },
        { ok: true, data: { printed: true, job_id: 'J2', printer_name: 'Counter' } },
      ],
    });
    const v = await show(s);
    for (let i = 0; i < 4; i++) {
      v.click(v.button('Print'));
      await flush();
    }
    expect(s.shown[0]).toBe('No printer is set up for reports — nothing printed');
    // review m1: the day closed meanwhile — its own text, and the X view reads again (closed-day state)
    expect(s.shown[1]).toBe('No day is open, so there is no X to print.');
    expect(s.shown[2]).toBe('Needs the hub');
    const [, , c, d] = s.command.mock.calls;
    expect((d![2] as { commandId: string }).commandId).toBe((c![2] as { commandId: string }).commandId);
  });

  it('offline: Print sends nothing and says "Needs the hub"', async () => {
    const s = setup();
    (s.shell as { online: boolean }).online = false;
    const v = await show(s);
    v.click(v.button('Print'));
    await flush();
    expect(s.command).not.toHaveBeenCalled();
    expect(s.shown).toEqual(['Needs the hub']);
  });

  it('[R-87 (1)] an older Z of a date on a later page: still no Print (its date\'s latest is on page 1)', async () => {
    const s = setup({
      pages: [
        { ok: true, data: { data: { reports: [zRow(44, '2026-11-19', 1)] }, next_cursor: 'C1' } },
        { ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 2)] }, next_cursor: null } },
      ],
    });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    v.click(v.button('Load older'));
    await flush();
    v.click(v.container.querySelectorAll('.b5-zl')[1] as HTMLElement);
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Print')).toBe(false);
    expect(v.text()).toContain('Only the latest Z of a date prints');
  });

  it('[R-87 (1), R-85] Z: Print sends the business date; a date closed twice prints only its latest Z (z_no), the older one says so', async () => {
    const s = setup({
      pages: [{ ok: true, data: { data: { reports: [zRow(44, '2026-11-19', 1), zRow(43, '2026-11-19', 2), zRow(42, '2026-11-18', 3)] }, next_cursor: null } }],
      answers: [{ ok: true, data: { printed: true, job_id: 'J3', printer_name: 'Office' } }],
    });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    v.click(v.button('Print'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['PrintReport', { doc: 'z_report', ref_id: '2026-11-19' }]);
    v.click(v.container.querySelectorAll('.b5-zl')[1] as HTMLElement);
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Print')).toBe(false);
    expect(v.text()).toContain('Only the latest Z of a date prints');
    v.click(v.container.querySelectorAll('.b5-zl')[2] as HTMLElement);
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Print')).toBe(true);
  });
});

// R-93 (05 v1.0.32 §8 Reports, §6.26; E2E re-run R-3): each Z row says whether that Z printed, from its `print` (the
// Day close texts; 'expired' → no line); after Print on a Z the list is read again to show the new job.
describe('[05 v1.0.32 §8 Reports, R-93] the Z print state on each Z row', () => {
  const lines = (v: Mounted) => [...v.container.querySelectorAll('.b5-zl')].map((r) => r.querySelector('.b5-zprint')?.textContent ?? null);
  const job = (state: string, printer_name: string | null = 'Office') => ({ job_id: 'J', state, printer_name });

  it('each row: printed / printing / problem / not printed / cancelled; expired has no line', async () => {
    const rows = [
      zRow(48, '2026-11-24', 1, job('printed')),
      zRow(47, '2026-11-23', 1, job('waiting')),
      zRow(46, '2026-11-22', 1, job('failed', 'Bar')),
      zRow(45, '2026-11-21', 1, null),
      zRow(44, '2026-11-20', 1, job('cancelled')),
      zRow(43, '2026-11-19', 1, { job_id: 'J', state: 'expired', printer_name: null }),
    ];
    const v = await show(setup({ pages: [{ ok: true, data: { data: { reports: rows }, next_cursor: null } }] }));
    v.click(seg(v, 'Z reports'));
    await flush();
    expect(lines(v)).toEqual([
      'Z printed on Office',
      'Z printing on Office…',
      'Z printing… — printer problem on Bar',
      'Z not printed — print it from the Z screen',
      'Z not printed — print it from the Z screen',
      null,
    ]);
  });

  it('after Print on a Z the Z list of its date is read again (the new job shows); the picked Z stays picked', async () => {
    const s = setup({
      pages: [
        { ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 1, null), zRow(42, '2026-11-18', 2, null)] }, next_cursor: null } },
        { ok: true, data: { data: { reports: [zRow(42, '2026-11-18', 2, job('waiting'))] }, next_cursor: null } },
      ],
      answers: [{ ok: true, data: { printed: true, job_id: 'J2', printer_name: 'Office' } }],
    });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    v.click(v.container.querySelectorAll('.b5-zl')[1] as HTMLElement);
    await flush();
    v.click(v.button('Print'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['PrintReport', { doc: 'z_report', ref_id: '2026-11-18' }]);
    expect(s.page.mock.calls.map((c) => c[0])).toEqual(['/queries/z-reports?limit=20', '/queries/z-reports?business_date=2026-11-18&limit=1']);
    expect(lines(v)[1]).toBe('Z printing on Office…');
    expect(v.container.querySelectorAll('.b5-zl')[1]!.getAttribute('aria-pressed')).toBe('true');
  });

  it('[review m4] a Z on a later page: after Print its own row shows the new job', async () => {
    const s = setup({
      pages: [
        { ok: true, data: { data: { reports: [zRow(43, '2026-11-19', 1, null)] }, next_cursor: 'C1' } },
        { ok: true, data: { data: { reports: [zRow(42, '2026-11-18', 2, null)] }, next_cursor: null } },
        { ok: true, data: { data: { reports: [zRow(42, '2026-11-18', 2, job('printed'))] }, next_cursor: null } },
      ],
      answers: [{ ok: true, data: { printed: true, job_id: 'J2', printer_name: 'Office' } }],
    });
    const v = await show(s);
    v.click(seg(v, 'Z reports'));
    await flush();
    v.click(v.button('Load older'));
    await flush();
    v.click(v.container.querySelectorAll('.b5-zl')[1] as HTMLElement);
    await flush();
    v.click(v.button('Print'));
    await flush();
    expect(s.page.mock.calls.at(-1)![0]).toBe('/queries/z-reports?business_date=2026-11-18&limit=1');
    expect(lines(v)).toEqual(['Z not printed — print it from the Z screen', 'Z printed on Office']);
  });
});

describe('[05 §8, §6.27] the fiscal status line (frame OpenBillsFiscal)', () => {
  const status = (over: Partial<FiscalStatusView> = {}): FiscalStatusView => ({
    jurisdiction_id: 'PK-PB',
    adapter_key: 'PRA',
    environment: 'production',
    adapter_health: 'ok',
    last_success_at: Date.UTC(2026, 10, 19, 13, 38),
    pending_count: 0,
    oldest_pending_age_ms: null,
    rejected_count: 0,
    catch_up_window_ms: null,
    stuck: false,
    token_missing: [],
    tokens: [],
    ...over,
  });

  it('every state as the frame, worst first; none for the adapter none', () => {
    const at = (x: FiscalStatusView) => {
      const l = fiscalLineOf(x, 0);
      return l === null ? null : [l.tone, l.text];
    };
    expect(at(status())).toEqual(['c-ok', 'Fiscal: all sent']);
    expect(fiscalLineOf(status(), 0)?.small).toBe('last 1:38 PM');
    expect(fiscalLineOf(status({ last_success_at: null }), 0)?.small).toBeUndefined();
    // review m7: an ack of an earlier day names its date
    expect(fiscalLineOf(status(), 0, Date.UTC(2026, 10, 19, 15, 0))?.small).toBe('last 1:38 PM');
    expect(fiscalLineOf(status(), 0, Date.UTC(2026, 10, 20, 9, 0))?.small).toBe('last 19 Nov 1:38 PM');
    expect(at(status({ pending_count: 3, oldest_pending_age_ms: 12 * 60_000 }))).toEqual(['c-info', 'Fiscal: 3 waiting · oldest 12 min']);
    expect(at(status({ pending_count: 3, oldest_pending_age_ms: 125 * 60_000, stuck: true }))).toEqual(['c-warn', 'Fiscal: 3 waiting · oldest 2 h 05 min — tell a manager']);
    expect(at(status({ rejected_count: 1, pending_count: 3 }))).toEqual(['c-danger', 'Fiscal: 1 not accepted — tell a manager']);
    expect(at(status({ token_missing: [{ pos_id: 'P1', name: 'token' }], rejected_count: 1 }))).toEqual(['c-danger', 'Fiscal: not set up on this hub — tell the owner']);
    expect(at(status({ adapter_health: 'failing' }))).toEqual(['c-warn', 'Fiscal: can’t reach the authority']);
    expect(at(status({ adapter_health: 'unknown', last_success_at: null }))).toEqual(['c-mute', 'Fiscal: not checked yet']);
    expect(at(status({ adapter_key: 'none' }))).toBeNull();
  });

  it('the line reads GET /queries/fiscal-status and never shows a token or a pos id', async () => {
    const s = setup({ x: { ok: true, data: status({ token_missing: [{ pos_id: 'POS-77', name: 'token' }], tokens: [{ pos_id: 'POS-1', name: 'token', set_at: 1 }] }) } });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <FiscalLine />
      </ShellContext.Provider>,
    );
    await flush();
    expect(s.query.mock.calls[0]![0]).toBe('/queries/fiscal-status');
    expect(m.container.querySelector('.b5-fis')?.className).toBe('b5-fis c-danger');
    expect(m.container.innerHTML).not.toContain('POS-');
  });

  it('[review m7] read again each minute (oldest age, stuck and health move with time)', async () => {
    vi.useFakeTimers();
    const s = setup({ x: { ok: true, data: status() } });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <FiscalLine />
      </ShellContext.Provider>,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.query).toHaveBeenCalledTimes(2);
    m.unmount();
    m = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.query).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('adapter none or a refusal: nothing shown', async () => {
    const s = setup({ x: { ok: true, data: status({ adapter_key: 'none' }) } });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <FiscalLine />
      </ShellContext.Provider>,
    );
    await flush();
    expect(m.container.querySelector('.b5-fis')).toBeNull();
  });
});

describe('[05 §8 i18n] texts', () => {
  it('every key of the task 42 block is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 42, reports)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((x) => x[1]!);
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
    }
  });

  it('Urdu: no Urdu frame for reports, so the texts fall back to English (no blank text)', async () => {
    setLanguage('ur');
    const v = await show(setup());
    expect(seg(v, 'Today (X)')).toBeTruthy();
  });
});
