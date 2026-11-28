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
import type { ShiftView } from './contracts';
import { parseCount } from './money';
import { ShiftScreen } from './ShiftScreen';

const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.21 §8 "Shift" (open with float; close shows card / online totals and asks for the counted cash before any
// expected figure; variance after the count; "Variance sent for sign-off (pending); the drawer is free"; open advances;
// handover count on drawer shifts), §3.11, §6.15–§6.19, B23 (plan §4.1 task 39, after hub task 21; frames ShiftOpen,
// ShiftOpenErrors, ShiftOpenPhone, ShiftClose, ShiftCountResult, ShiftVariancePending, ShiftSkip, ShiftHandover,
// ShiftHandoverResult, ShiftPhone, ShiftUrdu).

type HubErr = { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' };
type Answer = { ok: true; data: unknown } | { ok: false; error: HubErr };

const NOT_FOUND: Answer = { ok: false, error: { kind: 'api', status: 404, code: 'SHIFT_NOT_FOUND', details: { shift_id: null } } };

function view(over: Partial<ShiftView> = {}): ShiftView {
  return {
    shift_id: 'SH1',
    staff_name: 'Sana',
    state: 'open',
    is_drawer: true,
    opened_at: Date.UTC(2026, 10, 20, 11, 0),
    float_minor: 500_000,
    takings: [
      {
        mode_id: 'card',
        mode_name: 'Card',
        payment_class: 'digital',
        in_minor: 1_842_000,
        out_minor: 0,
        change_minor: 0,
        payments_count: 3,
        by: [
          { taken_by_name: 'Sana', in_minor: 1_562_000, payments_count: 2 },
          { taken_by_name: 'Imran', in_minor: 280_000, payments_count: 1 },
        ],
      },
      { mode_id: 'jazz', mode_name: 'JazzCash', payment_class: 'digital', in_minor: 215_000, out_minor: 0, change_minor: 0, payments_count: 2, by: [{ taken_by_name: 'Sana', in_minor: 215_000, payments_count: 2 }] },
      { mode_id: 'cash', mode_name: 'Cash', payment_class: 'cash', in_minor: null, out_minor: null, change_minor: null, payments_count: 14, by: [{ taken_by_name: 'Sana', in_minor: null, payments_count: 14 }] },
    ],
    petty: [
      { entry_id: 'P1', kind: 'out', amount_minor: 60_000, category_name: 'Supplies', paid_to: null, advance_staff_name: null, settled: false },
      { entry_id: 'P2', kind: 'advance', amount_minor: 100_000, category_name: 'Staff advance', paid_to: null, advance_staff_name: 'Ali', settled: false },
    ],
    open_advances_minor: 100_000,
    handovers: [],
    counted_minor: null,
    expected_minor: null,
    variance_minor: null,
    ...over,
  };
}

interface Opts {
  views?: Answer[];
  answers?: Answer[];
  grants?: Record<string, unknown>;
  device?: 'cashier_kiosk' | 'tablet' | 'phone';
  online?: boolean;
  threshold?: number;
}

function setup(o: Opts = {}) {
  const views = [...(o.views ?? [{ ok: true, data: view() }])];
  const query = vi.fn(async (path: string): Promise<Answer> => {
    void path;
    return views.length > 1 ? views.shift()! : views[0]!;
  });
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: {} };
  });
  const toasts = createToastBus();
  const shown: string[] = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x.text);
    return show(x);
  };
  const shell = {
    device: { id: 'D1', type: o.device ?? 'cashier_kiosk', token: 't' },
    api: { query, command },
    live: createLiveBus(),
    toasts,
    permissions: createPermissions({ 'manage-own-shift': { grant: 'allowed', scope: 'branch' }, ...o.grants } as never),
    config: {
      config: () => null,
      snapshot: () => ({ currency_code: 'PKR', billing: { variance_threshold_minor: o.threshold ?? 10_000 } }),
      subscribe: () => () => {},
    },
    clock: { nowMs: () => Date.UTC(2026, 10, 20, 13, 40), utcOffsetMs: 0 },
    online: o.online ?? true,
    phone: (o.device ?? 'cashier_kiosk') === 'phone',
    portrait: false,
  } as unknown as Shell;
  return { shell, query, command, shown };
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

async function show(s: ReturnType<typeof setup>, shiftId?: string) {
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <ShiftScreen {...(shiftId === undefined ? {} : { shiftId })} />
    </ShellContext.Provider>,
  );
  await flush();
  return m;
}

const typeIn = (el: HTMLInputElement | null | undefined, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
};
const field = (v: Mounted, label: string) => [...v.container.querySelectorAll('.b5-fld')].find((f) => f.querySelector('span')?.textContent === label)?.querySelector('input');
const txt = (v: Mounted, sel: string) => v.container.querySelector(sel)?.textContent ?? null;

describe('[05 §8 Shift, §6.15] open the shift (frames ShiftOpen, ShiftOpenErrors, ShiftOpenPhone)', () => {
  it('no open shift (404 SHIFT_NOT_FOUND): the open form; on the cashier kiosk the drawer switch is on; Open shift sends float + as_drawer; toast; reload', async () => {
    const s = setup({ views: [NOT_FOUND, { ok: true, data: view() }], answers: [{ ok: true, data: { shift_id: 'SH1', opened_at: 1 } }] });
    const v = await show(s);
    expect(txt(v, '.b5-step')).toBe('Open your shift');
    const sw = v.container.querySelector('.b5-chip[aria-pressed]');
    expect(sw?.getAttribute('aria-pressed')).toBe('true');
    const open = v.button('Open shift');
    expect(open.getAttribute('aria-disabled')).toBe('true');
    typeIn(field(v, 'Starting cash'), '5,000.00');
    await flush();
    v.click(v.button('Open shift'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['OpenShift', { float_minor: 500_000, as_drawer: true }]);
    expect(s.shown).toEqual(['Shift open · drawer opened']);
    expect(txt(v, '.b5-bh h1')).toBe('My shift');
  });

  it('[02b v1.0.30 QK-9] opened from another screen\'s prompt (back = #/takeaway): after Open shift it returns there, not My shift', async () => {
    nav.to = [];
    const s = setup({ views: [NOT_FOUND, { ok: true, data: view() }], answers: [{ ok: true, data: { shift_id: 'SH1', opened_at: 1 } }] });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <ShiftScreen back="/takeaway" />
      </ShellContext.Provider>,
    );
    await flush();
    typeIn(field(m, 'Starting cash'), '5,000.00');
    await flush();
    m.click(m.button('Open shift'));
    await flush();
    expect(nav.to).toEqual(['/takeaway']);
  });

  it('the quick 0 and the switch off: float 0, as_drawer false, toast "Shift open"', async () => {
    const s = setup({ views: [NOT_FOUND, { ok: true, data: view({ is_drawer: false }) }], answers: [{ ok: true, data: { shift_id: 'SH1', opened_at: 1 } }] });
    const v = await show(s);
    v.click(v.button('0'));
    v.click(v.container.querySelector<HTMLElement>('.b5-chip[aria-pressed]')!);
    await flush();
    v.click(v.button('Open shift'));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ float_minor: 0, as_drawer: false });
    expect(s.shown).toEqual(['Shift open']);
  });

  it('[frame ShiftOpenPhone] a phone has no drawer switch and its own note; as_drawer is false', async () => {
    const s = setup({ device: 'phone', views: [NOT_FOUND], answers: [{ ok: false, error: { kind: 'network' } }] });
    const v = await show(s);
    expect(v.container.querySelector('.b5-chip[aria-pressed]')).toBeNull();
    expect(v.text()).toContain('You have no drawer');
    typeIn(field(v, 'Starting cash'), '0');
    await flush();
    v.click(v.button('Open shift'));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ float_minor: 0, as_drawer: false });
    expect(txt(v, '.msg')).toBe('Needs the hub');
  });

  it('[frame ShiftOpenErrors] each refusal inline: DRAWER_IN_USE names the holder; SHIFT_ALREADY_OPEN → Go to my shift; day not open; drawer invalid', async () => {
    const refusal = (code: string, details: Record<string, unknown> = {}): Answer => ({ ok: false, error: { kind: 'api', status: 409, code, details } });
    const s = setup({
      views: [NOT_FOUND, { ok: true, data: view() }],
      answers: [refusal('DRAWER_IN_USE', { shift_id: 'X', staff_name: 'Usman' }), refusal('DRAWER_DEVICE_INVALID', { device_id: 'D1' }), refusal('BUSINESS_DAY_NOT_OPEN'), refusal('SHIFT_ALREADY_OPEN', { shift_id: 'SH1' })],
    });
    const v = await show(s);
    typeIn(field(v, 'Starting cash'), '50');
    await flush();
    const tap = async () => {
      v.click(v.button('Open shift'));
      await flush();
      return txt(v, '.msg span');
    };
    expect(await tap()).toBe("This drawer is in Usman's open shift — they must close it first, or open without the drawer");
    expect(await tap()).toBe("This device can't hold a cash drawer");
    expect(await tap()).toBe("The day isn't started — ask a manager to start it");
    expect(await tap()).toBe('Your shift is already open');
    v.click(v.button('Go to my shift'));
    await flush();
    expect(txt(v, '.b5-bh h1')).toBe('My shift');
  });
});

describe('[05 §8 Shift, §6.16, B23] the blind close screen (frames ShiftClose, ShiftPhone)', () => {
  it('card / online with amounts and who took them; cash as a count only; petty and open advances; the count asked before any expected figure', async () => {
    const v = await show(setup());
    expect(txt(v, '.b5-bh h1')).toBe('My shift');
    const rows = [...v.container.querySelectorAll('.b5-tk')].map((r) => r.textContent);
    expect(rows[0]).toContain('Card');
    expect(rows[0]).toContain('3 payments');
    expect(rows[0]).toContain('Rs 18,420.00');
    expect(v.container.querySelector('.b5-by')?.textContent).toContain('by Imran (takeover) · Rs 2,800.00');
    const blind = v.container.querySelector('.b5-tk.blind')!;
    expect(blind.textContent).toContain('14 payments');
    expect(blind.textContent).toContain('amount shows after you count');
    expect(v.text()).toContain('Cash out · Supplies');
    expect(txt(v, '.b5-adv b')).toBe('Ali · advance');
    expect(v.container.querySelector('.b5-adv')?.textContent).toContain('doesn’t stop the count');
    expect(txt(v, '.b5-blind span')).toBe('The expected amount shows after you count — count first.');
    expect(v.text()).not.toContain('Expected');
    expect(v.button('Count and close').getAttribute('aria-disabled')).toBe('true');
  });

  it('[B23] before the count is sent, no expected amount anywhere in the DOM: text, aria-*, title, data-* or any attribute, input values', async () => {
    // even a view that wrongly carries expected / variance (a stale or bad payload) shows none of it before this screen's own count
    const s = setup({ views: [{ ok: true, data: view({ expected_minor: 4_850_000, variance_minor: -25_000 }) }] });
    await show(s);
    typeIn(field(m!, 'Cash counted'), '48,250.00');
    await flush();
    const parts: string[] = [document.body.textContent ?? ''];
    for (const el of [document.body, ...document.body.querySelectorAll('*')]) {
      for (const name of el.getAttributeNames()) parts.push(`${name}=${el.getAttribute(name) ?? ''}`);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) parts.push(el.value);
    }
    const all = parts.join('\n');
    for (const leak of ['48,500', '48500', '4850000', '4,850,000', '25000', '25,000', 'Rs 250.00', 'Variance', 'Short', 'Over ']) expect(all, leak).not.toContain(leak);
    // only the blind line's lower-case "The expected amount shows after you count" may name it
    expect(all).not.toMatch(/\bExpected\b/);
    expect(s.command).not.toHaveBeenCalled();
  });

  it('[§6.17] Count and close: CountShift; then Expected · Counted · Short (over the threshold, warn); sign-off pending; the cancelled petty request', async () => {
    const counted = view({ state: 'closed', counted_minor: 4_825_000, expected_minor: 4_850_000, variance_minor: -25_000 });
    const s = setup({
      views: [{ ok: true, data: view() }, { ok: true, data: counted }],
      answers: [{ ok: true, data: { shift_id: 'SH1', closed: true, expected_minor: 4_850_000, variance_minor: -25_000, sign_off: { alert_id: 'A1' }, closed_requests: ['A9'] } }],
    });
    const v = await show(s);
    typeIn(field(v, 'Cash counted'), '48,250.00');
    await flush();
    v.click(v.button('Count and close'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['CountShift', { shift_id: 'SH1', counted_minor: 4_825_000 }]);
    expect(s.query.mock.calls[1]![0]).toBe('/queries/shift?shift_id=SH1');
    expect(txt(v, '.b5-step.done')).toBe('Shift closed · drawer is free');
    const res = [...v.container.querySelectorAll('.b5-res > div')].map((d) => d.textContent);
    expect(res).toEqual(['ExpectedRs 48,500.00', 'CountedRs 48,250.00', 'VarianceShort Rs 250.00']);
    expect(v.container.querySelector('.b5-res > .var')?.className).toContain('c-warn');
    // frame ShiftVariancePending: the waiting card (info), the spec's line
    expect(txt(v, '.b5-wait b')).toBe('Variance sent for sign-off (pending); the drawer is free');
    expect(txt(v, '.b5-wait span')).toBe('Short Rs 250.00');
    expect(v.container.querySelector('.b5-wait')?.className).toContain('c-info');
    expect(v.text()).toContain('1 petty cash request was cancelled because the shift closed');
    expect(txt(v, '.b5-bh .st')).toBe('Closed');
  });

  it('within the threshold: Over / Exact in a neutral tone, nothing sent', async () => {
    const s = setup({ answers: [{ ok: true, data: { shift_id: 'SH1', closed: true, expected_minor: 100_000, variance_minor: 4_000, sign_off: null, closed_requests: [] } }] });
    const v = await show(s);
    typeIn(field(v, 'Cash counted'), '1,040');
    await flush();
    v.click(v.button('Count and close'));
    await flush();
    expect(txt(v, '.b5-res > .var b')).toBe('Over Rs 40.00');
    expect(v.container.querySelector('.b5-res > .var')?.className).toContain('c-ok');
    expect(v.text()).toContain('Within the Rs 100.00 threshold — nothing sent.');
    expect(v.container.querySelector('.msg')).toBeNull();
  });

  it('[D32] a lost reply: the resend carries the same command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { shift_id: 'SH1', closed: true, expected_minor: 0, variance_minor: 0, sign_off: null, closed_requests: [] } }] });
    const v = await show(s);
    typeIn(field(v, 'Cash counted'), '0');
    await flush();
    v.click(v.button('Count and close'));
    await flush();
    expect(txt(v, '.msg')).toBe('Needs the hub');
    v.click(v.button('Count and close'));
    await flush();
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
    expect(txt(v, '.b5-res > .var b')).toBe('Exact');
  });

  it('offline: no command, the actions say "Needs the hub"', async () => {
    const v = await show(setup({ online: false }));
    expect(v.button('Count and close').getAttribute('aria-disabled')).toBe('true');
    expect(v.text()).toContain('Needs the hub');
  });

  it('another person\'s shift (shift_id from day close): "{name}\'s shift", read by shift_id', async () => {
    const s = setup({ views: [{ ok: true, data: view({ staff_name: 'Usman' }) }] });
    const v = await show(s, 'SH7');
    expect(s.query.mock.calls[0]![0]).toBe('/queries/shift?shift_id=SH7');
    expect(txt(v, '.b5-bh h1')).toBe("Usman's shift");
  });
});

describe('[task 39 review] refusals, stale settings, closed shifts, layout', () => {
  it('[review M2] CountShift refused SHIFT_NOT_OPEN (closed elsewhere): the shift is read again and shows closed', async () => {
    const closed = view({ state: 'closed', counted_minor: 100_000, expected_minor: 100_000, variance_minor: 0 });
    const s = setup({ views: [{ ok: true, data: view() }, { ok: true, data: closed }], answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'SHIFT_NOT_OPEN', details: { reason: 'not_open' } } }] });
    const v = await show(s);
    typeIn(field(v, 'Cash counted'), '10');
    await flush();
    v.click(v.button('Count and close'));
    await flush();
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(txt(v, '.b5-bh .st')).toBe('Closed');
    expect(v.buttons().some((b) => b.textContent === 'Count and close')).toBe(false);
  });

  it('[review M5] the sign-off tone follows the hub\'s answer, not the client\'s (maybe stale) threshold', async () => {
    // client threshold Rs 100; the hub raised nothing for Short Rs 250 (its threshold is higher) → ok, "Nothing sent"
    const s = setup({ answers: [{ ok: true, data: { shift_id: 'SH1', closed: true, expected_minor: 100_000, variance_minor: -25_000, sign_off: null, closed_requests: [] } }] });
    const v = await show(s);
    typeIn(field(v, 'Cash counted'), '750');
    await flush();
    v.click(v.button('Count and close'));
    await flush();
    expect(v.container.querySelector('.b5-res > .var')?.className).toContain('c-ok');
    expect(v.container.querySelector('.b5-wait')).toBeNull();
    expect(v.text()).toContain('Nothing sent for sign-off.');
    v.unmount();
    // and a sign-off within the client's threshold still reads warn with the waiting card
    const t2 = setup({ threshold: 100_000, answers: [{ ok: true, data: { shift_id: 'SH1', closed: true, expected_minor: 100_000, variance_minor: -25_000, sign_off: { alert_id: 'A1' }, closed_requests: [] } }] });
    m = await show(t2);
    typeIn(field(m, 'Cash counted'), '750');
    await flush();
    m.click(m.button('Count and close'));
    await flush();
    expect(m.container.querySelector('.b5-res > .var')?.className).toContain('c-warn');
    expect(txt(m, '.b5-wait b')).toBe('Variance sent for sign-off (pending); the drawer is free');
  });

  it('[review M4] a closed shift never counted: the cash row says "not counted", not "after you count"', async () => {
    const v = await show(setup({ views: [{ ok: true, data: view({ state: 'closed' }) }] }), 'SH1');
    expect(v.container.querySelector('.b5-tk.blind')?.textContent).toContain('not counted');
    expect(v.text()).not.toContain('amount shows after you count');
    expect(v.text()).toContain('Closed without a count');
  });

  it('[review M1] phone and portrait: one column (frame ShiftPhone); kiosk: two', async () => {
    const k = await show(setup());
    expect(k.container.querySelector('main')?.className).toBe('b5-page b5-shift');
    k.unmount();
    m = await show(setup({ device: 'phone' }));
    expect(m.container.querySelector('main')?.className).toBe('b5-page b5-shift b5-shift--one');
    m.unmount();
    m = await show(setup({ device: 'phone', views: [NOT_FOUND] }));
    expect(m.container.querySelector('main')?.className).toBe('b5-page b5-shift b5-shift--one');
  });

  it('[review M3] after Open shift the form is gone at once; a failed read then says so with Try again', async () => {
    const s = setup({ views: [NOT_FOUND, { ok: false, error: { kind: 'network' } }, { ok: true, data: view() }], answers: [{ ok: true, data: { shift_id: 'SH1', opened_at: 1 } }] });
    const v = await show(s);
    typeIn(field(v, 'Starting cash'), '0');
    await flush();
    v.click(v.button('Open shift'));
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Open shift')).toBe(false);
    expect(txt(v, '.msg span')).toBe('Needs the hub');
    v.click(v.button('Try again'));
    await flush();
    expect(s.query.mock.calls[2]![0]).toBe('/queries/shift?shift_id=SH1');
    expect(txt(v, '.b5-bh h1')).toBe('My shift');
    expect(s.command).toHaveBeenCalledTimes(1);
  });
});

describe('[05 §8 i18n; row F-6] parseCount (typed count / starting cash → minor units)', () => {
  it('0 is fine; the exponent of the currency; refuses bad input and above 10¹²', () => {
    for (const z of ['0', '00', '0.00', ' 0 ']) expect(parseCount(z, 2), z).toBe(0);
    expect(parseCount('48,250.00', 2)).toBe(4_825_000);
    expect(parseCount('1,234', 0)).toBe(1_234);
    expect(parseCount('6.624', 3)).toBe(6_624);
    expect(parseCount('10000000000', 2)).toBe(1e12);
    for (const bad of ['', '-5', '1.234', 'abc', '10000000000.01']) expect(parseCount(bad, 2), bad).toBeNull();
    expect(parseCount('1.5', 0)).toBeNull();
  });
});

describe('[05 §6.16, §3.7; E2E E-5] the cash line after the count', () => {
  it('shows in − out (the applied amounts); the change given is not taken off again', async () => {
    // E2E run: cash 962 (given 1,000), 320 (given 500), 500, 34 (given 50): in 1,816.00, change 234.00
    const cash = { mode_id: 'cash', mode_name: 'Cash', payment_class: 'cash' as const, in_minor: 181_600, out_minor: 0, change_minor: 23_400, payments_count: 4, by: [{ taken_by_name: 'Sana', in_minor: 181_600, payments_count: 4 }] };
    const closed = view({ state: 'closed', takings: [cash], petty: [], open_advances_minor: 0, counted_minor: 631_600, expected_minor: 656_600, variance_minor: -25_000 });
    const v = await show(setup({ views: [{ ok: true, data: closed }] }), 'SH1');
    const row = [...v.container.querySelectorAll('.b5-tk')].find((r) => r.textContent?.includes('Cash'))!;
    expect(row.querySelector('.a')?.textContent).toBe('Rs 1,816.00');
    expect(v.text()).not.toContain('Rs 1,582.00');
  });

  it('a cash refund (out) is taken off', async () => {
    const cash = { mode_id: 'cash', mode_name: 'Cash', payment_class: 'cash' as const, in_minor: 100_000, out_minor: 30_000, change_minor: 5_000, payments_count: 3, by: [] };
    const v = await show(setup({ views: [{ ok: true, data: view({ state: 'closed', takings: [cash], petty: [], counted_minor: 0, expected_minor: 0, variance_minor: 0 }) }] }), 'SH1');
    expect([...v.container.querySelectorAll('.b5-tk')].find((r) => r.textContent?.includes('Cash'))!.querySelector('.a')?.textContent).toBe('Rs 700.00');
  });
});

describe('[05 §6.18] close without counting (frame ShiftSkip)', () => {
  it('without skip-blind-count the button is not there', async () => {
    const v = await show(setup());
    expect(v.buttons().some((b) => b.textContent === 'Close without counting')).toBe(false);
  });

  it('with it: the inline confirm with an optional note → CloseShift { skip_count: true, note }; toast; closed', async () => {
    const s = setup({
      grants: { 'skip-blind-count': { grant: 'allowed', scope: 'branch' } },
      views: [{ ok: true, data: view() }, { ok: true, data: view({ state: 'closed' }) }],
      answers: [{ ok: true, data: { closed: { shift_id: 'SH1' }, closed_requests: [], open_advances: [{ entry_id: 'P2', advance_staff_id: 'S4', amount_minor: 100_000 }] } }],
    });
    const v = await show(s);
    v.click(v.button('Close without counting'));
    await flush();
    expect(v.text()).toContain('Close without counting?');
    const note = v.container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(note, 'Power cut');
    note.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
    const confirm = [...v.container.querySelectorAll<HTMLButtonElement>('.b5-acts .btn--primary')].find((b) => b.textContent === 'Close without counting')!;
    v.click(confirm);
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['CloseShift', { shift_id: 'SH1', skip_count: true, note: 'Power cut' }]);
    expect(s.shown).toEqual(['Shift closed without a count']);
    expect(txt(v, '.b5-bh .st')).toBe('Closed');
  });

  it('[review M7] the skip close lists its cancelled petty requests (§6.18 closed_requests)', async () => {
    const s = setup({
      grants: { 'skip-blind-count': { grant: 'allowed', scope: 'branch' } },
      views: [{ ok: true, data: view() }, { ok: true, data: view({ state: 'closed' }) }],
      answers: [{ ok: true, data: { closed: { shift_id: 'SH1' }, closed_requests: ['A1', 'A2'], open_advances: [] } }],
    });
    const v = await show(s);
    v.click(v.button('Close without counting'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.b5-acts .btn--primary')].find((b) => b.textContent === 'Close without counting')!);
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ shift_id: 'SH1', skip_count: true });
    expect(v.text()).toContain('2 petty cash requests were cancelled because the shift closed');
  });

  it('a refused skip (403 skip_not_granted) says "You can\'t skip the count"', async () => {
    const s = setup({ grants: { 'skip-blind-count': { grant: 'allowed', scope: 'branch' } }, answers: [{ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: { reason: 'skip_not_granted' } } }] });
    const v = await show(s);
    v.click(v.button('Close without counting'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLButtonElement>('.b5-acts .btn--primary')].find((b) => b.textContent === 'Close without counting')!);
    await flush();
    expect(txt(v, '.msg')).toBe("You can't skip the count");
  });
});

describe('[05 §6.19] count at handover (frames ShiftHandover, ShiftHandoverResult)', () => {
  it('only on a drawer shift', async () => {
    const v = await show(setup({ views: [{ ok: true, data: view({ is_drawer: false }) }] }));
    expect(v.buttons().some((b) => b.textContent === 'Count at handover')).toBe(false);
  });

  it('HandoverCount; the result shows that count\'s expected and variance; the shift stays open; Back to my shift', async () => {
    const after = view({ handovers: [{ at: Date.UTC(2026, 10, 20, 17, 2), counted_minor: 3_120_000, expected_minor: 3_124_000, variance_minor: -4_000, by_staff_name: 'Sana' }] });
    const s = setup({ views: [{ ok: true, data: view() }, { ok: true, data: after }], answers: [{ ok: true, data: { shift_id: 'SH1', counted_minor: 3_120_000, expected_minor: 3_124_000, variance_minor: -4_000 } }] });
    const v = await show(s);
    v.click(v.button('Count at handover'));
    await flush();
    expect(txt(v, '.b5-countbox .b5-blind span')).toBe('Count now when someone takes over the drawer — the shift stays open.');
    typeIn(field(v, 'Cash counted now'), '31,200.00');
    await flush();
    v.click(v.button('Count'));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['HandoverCount', { shift_id: 'SH1', counted_minor: 3_120_000 }]);
    expect(txt(v, '.b5-step.done')).toBe('Handover counted · shift still open');
    expect(txt(v, '.b5-res > .var b')).toBe('Short Rs 40.00');
    expect(v.text()).toContain('Within the Rs 100.00 threshold — nothing sent.');
    // listed once (in the result, frame ShiftHandoverResult), not again on the left
    expect([...v.container.querySelectorAll('.b5-tk')].filter((r) => r.textContent?.includes('expected Rs 31,240.00'))).toHaveLength(1);
    v.click(v.button('Back to my shift'));
    await flush();
    expect(v.buttons().some((b) => b.textContent === 'Count and close')).toBe(true);
    expect(txt(v, '.b5-bh .st')).toBe('Open');
  });
});

describe('[05 §8 i18n] texts', () => {
  it('[frame ShiftUrdu] Urdu: the drawn texts', async () => {
    setLanguage('ur');
    const v = await show(setup());
    expect(txt(v, '.b5-bh h1')).toBe('میری شفٹ');
    expect(v.text()).toContain('کارڈ اور آن لائن');
    expect(v.text()).toContain('رقم گنتی کے بعد');
    expect(v.button('گن کر بند کریں')).toBeTruthy();
  });

  it('every key of the task 39 block is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 39, shift)');
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
