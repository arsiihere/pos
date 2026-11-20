import { useState } from 'react';
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
import type { ShiftPetty, ShiftView } from './contracts';
import { PettySheet, SettleSheet, type Raised } from './PettySheets';
import { ShiftScreen } from './ShiftScreen';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.23 §8 "Petty cash" (advance / out / in sheet with categories; open advances with Settle), §3.12, §6.20, B24
// (plan §4.1 task 40, after hub task 22; frames Petty, PettyAdvance, PettyWaiting, PettyAdvances, PettySettle, PettyUrdu).

type HubErr = { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' };
type Answer = { ok: true; data: unknown } | { ok: false; error: HubErr };

const ADVANCE: ShiftPetty = { entry_id: 'P2', kind: 'advance', amount_minor: 100_000, category_name: 'Staff advance', paid_to: null, advance_staff_name: 'Ali', settled: false };

function view(over: Partial<ShiftView> = {}): ShiftView {
  return {
    shift_id: 'SH1',
    staff_name: 'Sana',
    state: 'open',
    is_drawer: true,
    opened_at: Date.UTC(2026, 10, 20, 11, 0),
    float_minor: 500_000,
    takings: [],
    petty: [ADVANCE],
    open_advances_minor: 100_000,
    handovers: [],
    counted_minor: null,
    expected_minor: null,
    variance_minor: null,
    ...over,
  };
}

const ROSTER = { staff: [
  { staff_id: 'S-ALI', display_name: 'Ali', locked_until: null },
  { staff_id: 'S-BILAL', display_name: 'Bilal', locked_until: null },
], active_session: null };

function setup(o: { answers?: Answer[]; views?: Answer[]; grant?: 'allowed' | 'requires_approval' | null; limit?: number } = {}) {
  const queue = [...(o.answers ?? [])];
  const views = [...(o.views ?? [{ ok: true, data: view() }])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { entry_id: 'P9' } };
  });
  const query = vi.fn(async (path: string): Promise<Answer> => {
    void path;
    return views.length > 1 ? views.shift()! : views[0]!;
  });
  const roster = vi.fn(async () => ({ ok: true as const, data: ROSTER }));
  const toasts = createToastBus();
  const shown: string[] = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x.text);
    return show(x);
  };
  const grants: Record<string, unknown> = { 'manage-own-shift': { grant: 'allowed', scope: 'branch' } };
  if (o.grant !== null) grants['record-petty-cash'] = { grant: o.grant ?? 'allowed', scope: 'branch' };
  const shell = {
    device: { id: 'D1', type: 'cashier_kiosk', token: 't' },
    api: { query, command, roster },
    live: createLiveBus(),
    toasts,
    permissions: createPermissions(grants as never),
    config: {
      config: () => null,
      snapshot: () => ({ currency_code: 'PKR', billing: { petty_cash_limit_minor: o.limit ?? 500_000, variance_threshold_minor: 10_000 } }),
      subscribe: () => () => {},
    },
    clock: { nowMs: () => Date.UTC(2026, 10, 20, 13, 46), utcOffsetMs: 0 },
    me: { staff_id: 'S-SANA', name: 'Sana' },
    online: true,
    phone: false,
    portrait: false,
  } as unknown as Shell;
  return { shell, command, query, roster, shown };
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
});

/** The sheet with its raised request held outside it, as the shift screen holds it. */
function Harness({ shift, done, close }: { shift: ShiftView; done: (r: string) => void; close: () => void }) {
  const [raised, setRaised] = useState<Raised | null>(null);
  return <PettySheet shift={shift} raised={raised} onRaised={setRaised} onDone={done} onClose={close} />;
}

async function sheet(s: ReturnType<typeof setup>, shift: ShiftView = view(), on: { done?: (r: string) => void; close?: () => void } = {}) {
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <Harness shift={shift} done={on.done ?? (() => {})} close={on.close ?? (() => {})} />
    </ShellContext.Provider>,
  );
  await flush();
  return m;
}

const typeIn = (el: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el!.dispatchEvent(new Event('input', { bubbles: true }));
};
const field = (v: Mounted, label: string) => [...v.container.querySelectorAll('.b5-fld')].find((f) => f.querySelector('span')?.textContent?.startsWith(label))?.querySelector('input');
const primary = (v: Mounted) => v.container.querySelector<HTMLButtonElement>('.acts .btn--primary')!;
// a staff chip reads its avatar initial first ("AAli")
const chip = (v: Mounted, text: string) => [...v.container.querySelectorAll<HTMLButtonElement>('.b5-chip')].find((c) => c.textContent?.trim() === text || (c.querySelector('.av') !== null && c.textContent === `${text.slice(0, 1)}${text}`))!;
const seg = (v: Mounted, text: string) => [...v.container.querySelectorAll<HTMLButtonElement>('.b5-seg button')].find((c) => c.textContent?.trim() === text)!;

describe('[05 §8 Petty cash, §6.20] record (frames Petty, PettyAdvance)', () => {
  it('cash out: kind, amount, a category from the settings, paid to; under the limit → Record → RecordPettyCash; toast', async () => {
    const s = setup();
    const done: string[] = [];
    const v = await sheet(s, view(), { done: (r) => done.push(r) });
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Petty cash');
    expect(v.container.querySelector('.dlg__t .ac__who')?.textContent).toBe("From Sana's drawer shift");
    expect(seg(v, 'Cash out').getAttribute('aria-pressed')).toBe('true');
    expect(v.container.querySelector('.b5-limit')?.textContent).toBe('Up to Rs 5,000.00 is recorded at once');
    expect([...v.container.querySelectorAll('.b5-chip')].map((c) => c.textContent)).toEqual(['Supplies', 'Utilities', 'Staff advance', 'Transport', 'Other']);
    expect(primary(v).textContent).toBe('Type the amount');
    typeIn(field(v, 'Amount'), '600');
    await flush();
    expect(primary(v).textContent).toBe('Pick a category');
    v.click(chip(v, 'Supplies'));
    typeIn(field(v, 'Paid to'), 'Corner general store');
    await flush();
    expect(primary(v).textContent).toBe('Record');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['RecordPettyCash', { kind: 'out', amount_minor: 60_000, category_id: 'supplies', paid_to: 'Corner general store' }]);
    expect(s.shown).toEqual(['Recorded · drawer opened']);
    expect(done).toEqual(['recorded']);
  });

  it('an advance: who takes it from the sign-in roster (Q-12); no Paid to; advance_staff_id sent', async () => {
    const s = setup();
    const v = await sheet(s);
    v.click(seg(v, 'Advance'));
    await flush();
    expect(s.roster).toHaveBeenCalledTimes(1);
    expect(field(v, 'Paid to')).toBeUndefined();
    typeIn(field(v, 'Amount'), '1,000');
    v.click(chip(v, 'Staff advance'));
    await flush();
    expect(primary(v).textContent).toBe('Pick who takes it');
    v.click(chip(v, 'Ali'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ kind: 'advance', amount_minor: 100_000, category_id: 'staff_advance', advance_staff_id: 'S-ALI' });
  });

  it('Other needs a note (frame: "Write why (needed for Other)"); a cash in sends kind in', async () => {
    const s = setup();
    const v = await sheet(s);
    v.click(seg(v, 'Cash in'));
    typeIn(field(v, 'Amount'), '50');
    v.click(chip(v, 'Other'));
    await flush();
    expect(primary(v).textContent).toBe('Write why first');
    typeIn(v.container.querySelector('textarea'), 'Change from the bank');
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ kind: 'in', amount_minor: 5_000, category_id: 'other', note: 'Change from the bank' });
  });

  it('[§3.12] over the limit → Ask for approval (Needs approval); pending → the waiting card with Withdraw', async () => {
    const s = setup({ answers: [{ ok: true, data: { entry_id: 'P9', pending: { alert_id: 'A7' } } }, { ok: true, data: {} }] });
    const done: string[] = [];
    const v = await sheet(s, view(), { done: (r) => done.push(r) });
    typeIn(field(v, 'Amount'), '6,500');
    v.click(chip(v, 'Supplies'));
    await flush();
    expect(primary(v).textContent).toBe('Ask for approvalNeeds approval');
    expect(v.container.querySelector('.b5-limit')?.textContent).toBe('Over the Rs 5,000.00 limit — a manager approves it');
    expect(v.container.querySelector('.b5-limit')?.className).toContain('c-warn');
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.b5-wait b')?.textContent).toBe('Waiting for a manager');
    expect(v.container.querySelector('.b5-wait span')?.textContent).toBe('Cash out Rs 6,500.00 · Supplies · asked 1:46 PM');
    expect(v.text()).toContain('The drawer doesn’t open by itself.');
    v.click(v.button('Withdraw'));
    await flush();
    expect(s.command.mock.calls[1]!.slice(0, 2)).toEqual(['WithdrawRequest', { alert_id: 'A7' }]);
    expect(done).toEqual(['pending', 'withdrawn']);
  });

  it('requires_approval: Ask for approval at any amount; approved meanwhile (the entry is on the shift) → "Approved — open the drawer"', async () => {
    const s = setup({ grant: 'requires_approval', answers: [{ ok: true, data: { entry_id: 'P9', pending: { alert_id: 'A7' } } }] });
    const v = await sheet(s);
    typeIn(field(v, 'Amount'), '10');
    v.click(chip(v, 'Supplies'));
    await flush();
    expect(primary(v).textContent).toBe('Ask for approvalNeeds approval');
    // requires_approval asks for every amount: no limit line
    expect(v.container.querySelector('.b5-limit')).toBeNull();
    v.click(primary(v));
    await flush();
    v.render(
      <ShellContext.Provider value={s.shell}>
        <Harness shift={view({ petty: [ADVANCE, { ...ADVANCE, entry_id: 'P9', kind: 'out', advance_staff_name: null, settled: false }] })} done={() => {}} close={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    expect(v.text()).toContain('Approved — open the drawer to take the cash');
  });

  it('[D32, H-4] a lost reply: the resend keeps the command_id even when Paid to was edited (paid_to and note out of the key)', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { entry_id: 'P9' } }] });
    const v = await sheet(s);
    typeIn(field(v, 'Amount'), '600');
    v.click(chip(v, 'Supplies'));
    typeIn(field(v, 'Paid to'), 'Store');
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg span')?.textContent).toBe('Needs the hub');
    typeIn(field(v, 'Paid to'), 'Corner store');
    await flush();
    v.click(primary(v));
    await flush();
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
  });

  it('[D32, H-4] the note alone edited before the resend: still the same command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { entry_id: 'P9' } }] });
    const v = await sheet(s);
    typeIn(field(v, 'Amount'), '600');
    v.click(chip(v, 'Supplies'));
    typeIn(v.container.querySelector('textarea'), 'Soap');
    await flush();
    v.click(primary(v));
    await flush();
    typeIn(v.container.querySelector('textarea'), 'Soap and bags');
    await flush();
    v.click(primary(v));
    await flush();
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
    expect(b![1]).toEqual({ kind: 'out', amount_minor: 60_000, category_id: 'supplies', note: 'Soap and bags' });
  });

  it('[§6.20 Amount ≥ 1] a zero amount cannot be recorded', async () => {
    const v = await sheet(setup());
    typeIn(field(v, 'Amount'), '0');
    v.click(chip(v, 'Supplies'));
    await flush();
    expect(primary(v).textContent).toBe('Type the amount');
    expect(primary(v).getAttribute('aria-disabled')).toBe('true');
  });

  it('[review M2] Withdraw on a request answered or closed meanwhile (REQUEST_NOT_PENDING) is "closed", never "withdrawn"', async () => {
    const s = setup({ answers: [{ ok: true, data: { entry_id: 'P9', pending: { alert_id: 'A7' } } }, { ok: false, error: { kind: 'api', status: 409, code: 'REQUEST_NOT_PENDING', details: {} } }] });
    const done: string[] = [];
    const v = await sheet(s, view(), { done: (r) => done.push(r) });
    typeIn(field(v, 'Amount'), '6,500');
    v.click(chip(v, 'Supplies'));
    await flush();
    v.click(primary(v));
    await flush();
    v.click(v.button('Withdraw'));
    await flush();
    expect(done).toEqual(['pending', 'closed']);
  });

  it('SHIFT_NOT_OPEN no_shift reads its own text', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'api', status: 409, code: 'SHIFT_NOT_OPEN', details: { reason: 'no_shift' } } }] });
    const v = await sheet(s);
    typeIn(field(v, 'Amount'), '600');
    v.click(chip(v, 'Supplies'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg span')?.textContent).toBe('Open your shift to take money');
  });
});

describe('[05 §8 Petty cash, §6.20 Settle] settle an advance (frames PettyAdvances, PettySettle)', () => {
  async function settle(s: ReturnType<typeof setup>, on: { done?: () => void } = {}) {
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <SettleSheet advance={ADVANCE} onDone={on.done ?? (() => {})} onClose={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    return m;
  }

  it('the two typed amounts only (no running sum); SettlePettyAdvance; done', async () => {
    const s = setup({ answers: [{ ok: true, data: { entry_id: 'P2', shift_id: 'SH1' } }] });
    let done = 0;
    const v = await settle(s, { done: () => done++ });
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Settle advance');
    expect(v.container.querySelector('.b5-adv b')?.textContent).toBe('Ali · advance');
    expect(v.container.querySelector('.b5-adv .a')?.textContent).toBe('Rs 1,000.00');
    expect(v.text()).toContain('The returned cash goes into your shift.');
    typeIn(field(v, 'Spent'), '800');
    typeIn(field(v, 'Returned'), '200');
    await flush();
    expect(v.text()).not.toContain('Rs 200.00 left');
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]!.slice(0, 2)).toEqual(['SettlePettyAdvance', { entry_id: 'P2', spent_minor: 80_000, returned_minor: 20_000 }]);
    expect(s.shown).toEqual(['Advance settled']);
    expect(done).toBe(1);
  });

  it('[D32] a lost settle reply: the resend carries the same command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { entry_id: 'P2', shift_id: 'SH1' } }] });
    const v = await settle(s);
    typeIn(field(v, 'Spent'), '1,000');
    typeIn(field(v, 'Returned'), '0');
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.msg span')?.textContent).toBe('Needs the hub');
    v.click(primary(v));
    await flush();
    const [a, b] = s.command.mock.calls;
    expect((b![2] as { commandId: string }).commandId).toBe((a![2] as { commandId: string }).commandId);
  });

  it('0 is fine for one of them; the hub\'s PETTY_SETTLE_MISMATCH shown inline with its amount', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'api', status: 422, code: 'PETTY_SETTLE_MISMATCH', details: { amount_minor: 100_000 } } }] });
    const v = await settle(s);
    typeIn(field(v, 'Spent'), '760');
    typeIn(field(v, 'Returned'), '0');
    await flush();
    v.click(primary(v));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ entry_id: 'P2', spent_minor: 76_000, returned_minor: 0 });
    expect(v.container.querySelector('.msg.c-danger span')?.textContent).toBe('Spent and returned must add up to Rs 1,000.00');
  });
});

describe('[05 §8] on the shift screen', () => {
  async function screen(s: ReturnType<typeof setup>) {
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <ShiftScreen />
      </ShellContext.Provider>,
    );
    await flush();
    return m;
  }

  it('record-petty-cash allowed: Petty cash opens the sheet; the open advance has Settle, which opens the settle sheet', async () => {
    const v = await screen(setup());
    v.click(v.button('Petty cash'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Petty cash');
    v.click(v.container.querySelector<HTMLButtonElement>('.dlg__x')!);
    await flush();
    v.click(v.button('Settle'));
    await flush();
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Settle advance');
  });

  it('requires_approval: Petty cash, but no Settle (Settle is allowed-only); without the grant neither', async () => {
    const v = await screen(setup({ grant: 'requires_approval' }));
    expect(v.buttons().some((b) => b.textContent === 'Petty cash')).toBe(true);
    expect(v.buttons().some((b) => b.textContent?.includes('Settle'))).toBe(false);
    v.unmount();
    m = await screen(setup({ grant: null }));
    expect(m.buttons().some((b) => b.textContent === 'Petty cash' || b.textContent?.includes('Settle'))).toBe(false);
  });

  it('[review M3] a raised request survives Back: the screen says it waits, and Petty cash reopens its card (no second request)', async () => {
    const s = setup({ answers: [{ ok: true, data: { entry_id: 'P9', pending: { alert_id: 'A7' } } }] });
    const v = await screen(s);
    v.click(v.button('Petty cash'));
    await flush();
    typeIn(field(v, 'Amount'), '6,500');
    v.click(chip(v, 'Supplies'));
    await flush();
    v.click(primary(v));
    await flush();
    v.click(v.button('Back'));
    await flush();
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(v.text()).toContain('Petty cash waiting for a manager · Cash out Rs 6,500.00 · Supplies · asked 1:46 PM');
    v.click(v.button('Petty cash'));
    await flush();
    expect(v.container.querySelector('.b5-wait b')?.textContent).toBe('Waiting for a manager');
    expect(s.command).toHaveBeenCalledTimes(1);
  });

  it('no Petty cash on another person\'s shift or a closed one (Record lands on my own money shift)', async () => {
    const s = setup({ views: [{ ok: true, data: view({ staff_name: 'Usman' }) }] });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <ShiftScreen shiftId="SH7" />
      </ShellContext.Provider>,
    );
    await flush();
    expect(m.buttons().some((b) => b.textContent === 'Petty cash')).toBe(false);
    m.unmount();
    m = await screen(setup({ views: [{ ok: true, data: view({ state: 'closed' }) }] }));
    expect(m.buttons().some((b) => b.textContent === 'Petty cash')).toBe(false);
  });

  it('a shift-stream frame (an approval elsewhere) reads the shift again', async () => {
    vi.useFakeTimers();
    const s = setup();
    await screen(s);
    s.shell.live.frame({ type: 'event', seq: 4, event: { event_type: 'PettyCashOut', payload: {} } } as never);
    await vi.advanceTimersByTimeAsync(300);
    vi.useRealTimers();
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('a recorded entry reads the shift again', async () => {
    const s = setup({ views: [{ ok: true, data: view() }, { ok: true, data: view({ petty: [ADVANCE, { ...ADVANCE, entry_id: 'P9', kind: 'out', category_name: 'Supplies', advance_staff_name: null }] }) }] });
    const v = await screen(s);
    v.click(v.button('Petty cash'));
    await flush();
    typeIn(field(v, 'Amount'), '600');
    v.click(chip(v, 'Supplies'));
    await flush();
    v.click(primary(v));
    await flush();
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(v.text()).toContain('Cash out · Supplies');
  });
});

describe('[05 §8 i18n] texts', () => {
  it('[frame PettyUrdu] Urdu: the drawn texts', async () => {
    setLanguage('ur');
    const v = await sheet(setup());
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('پیٹی کیش');
    expect(seg(v, 'نقد باہر')).toBeTruthy();
    expect(v.text()).toContain('کس کو دیا');
    expect(primary(v).textContent).not.toBe('');
  });

  it('every key of the task 40 block is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 40, petty)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((x) => x[1]!);
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
    }
  });
});
