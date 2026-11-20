import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createToastBus } from '../staff/shell/toast';
import type { BillPrint } from './contracts';
import { PrintRows, ReprintButton } from './PrintStatus';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.14 §8 "Print status" (Print to), §6.23 RetargetBillPrint, §6.23a GET /queries/bill-printers, §6.22
// PrintBillDocument, B18 (plan §3.1 task 38, second half after hub task 27; brief §3.4; frames PrintStatus, PrintTo,
// PrintToPhone): a failed row, or one waiting more than 10 s, offers Print to; the picker reads the active printers
// when it opens; picking one moves the job (nothing prints twice).

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };

const PRINTERS = { printers: [{ printer_id: 'P1', name: 'Counter' }, { printer_id: 'P2', name: 'First floor bill' }, { printer_id: 'P3', name: 'Tandoor printer' }] };

function setup(o: { answers?: Answer[]; printers?: unknown } = {}) {
  const queue = [...(o.answers ?? [])];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { job_id: 'J1', printer_id: 'P2', printer_name: 'First floor bill', state: 'waiting', last_error: null } };
  });
  const query = vi.fn(async (path: string) => {
    void path;
    return { ok: true as const, data: o.printers ?? PRINTERS };
  });
  const toasts = createToastBus();
  const shown: Array<{ text: string; tone?: string }> = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x as { text: string; tone?: string });
    show(x);
  };
  const shell = { api: { query, command }, live: createLiveBus(), toasts, online: true, phone: false, portrait: false } as unknown as Shell;
  return { shell, command, query, shown };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

async function show(s: ReturnType<typeof setup>, node: React.ReactNode) {
  view = mount();
  view.render(<ShellContext.Provider value={s.shell}>{node}</ShellContext.Provider>);
  await flush();
  return view;
}

const p = (over: Partial<BillPrint> & { job_id: string }): BillPrint => ({ doc_kind: 'receipt', state: 'waiting', printer_name: 'Counter', last_error: null, ...over });

describe('[05 §8 Print status; §6.23, §6.23a, B18] Print to (task 38)', () => {
  it('a failed row carries Print to; a printed one does not; a waiting one only after 10 s', async () => {
    vi.useFakeTimers();
    const v = await show(setup(), <PrintRows prints={[p({ job_id: 'J1', state: 'failed', last_error: 'connect' }), p({ job_id: 'J2', state: 'printed' }), p({ job_id: 'J3' })]} onChanged={() => {}} />);
    const rowBtn = () => [...v.container.querySelectorAll('.b5-pr')].map((r) => r.querySelector('button')?.textContent ?? null);
    expect(rowBtn()).toEqual(['Print to', null, null]);
    expect(v.container.querySelector('.b5-pr.c-danger .btn')?.className).toContain('btn--tone');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(rowBtn()).toEqual(['Print to', null, null]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(rowBtn()).toEqual(['Print to', null, 'Print to']);
  });

  it('without onChanged (no way to refresh) there is no Print to', async () => {
    const v = await show(setup(), <PrintRows prints={[p({ job_id: 'J1', state: 'failed' })]} />);
    expect(v.container.querySelector('.b5-pr button')).toBeNull();
  });

  it('the picker reads GET /queries/bill-printers when it opens, names the doc, marks the job\'s printer; Print on <name> sends RetargetBillPrint', async () => {
    const s = setup();
    const changed: unknown[] = [];
    const v = await show(s, <PrintRows prints={[p({ job_id: 'J1', state: 'failed', last_error: 'connect' })]} onChanged={() => changed.push(1)} />);
    expect(s.query).not.toHaveBeenCalled();
    v.click(v.button('Print to'));
    await flush();
    expect(s.query).toHaveBeenCalledWith('/queries/bill-printers');
    expect(v.container.querySelector('.dlg__t h2')?.textContent).toBe('Print the receipt on…');
    const chips = [...v.container.querySelectorAll<HTMLElement>('.b5-chip')];
    expect(chips.map((c) => c.querySelector('span')?.textContent)).toEqual(["Counterdidn’t print here · Can't reach the printer", 'First floor bill', 'Tandoor printer']);
    const primary = () => v.container.querySelector<HTMLElement>('.acts .btn--primary')!;
    expect(primary().textContent).toBe('Pick a printer');
    expect(primary().getAttribute('aria-disabled')).toBe('true');
    v.click(chips[1]);
    expect(primary().textContent).toBe('Print on First floor bill');
    v.click(primary());
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['RetargetBillPrint', { job_id: 'J1', printer_id: 'P2' }, expect.anything()]);
    expect(s.shown).toEqual([{ text: 'Moved to First floor bill', tone: 'ok' }]);
    expect(changed).toEqual([1]);
    expect(v.container.querySelector('.dlg')).toBeNull();
  });

  it('the job\'s own printer cannot be picked again', async () => {
    const v = await show(setup(), <PrintRows prints={[p({ job_id: 'J1', state: 'failed' })]} onChanged={() => {}} />);
    v.click(v.button('Print to'));
    await flush();
    const counter = [...v.container.querySelectorAll<HTMLButtonElement>('.b5-chip')][0]!;
    expect(counter.disabled).toBe(true);
  });

  it('PRINT_JOB_NOT_PENDING: "Already printed or cancelled", the sheet closes and the bill is read again; PRINTER_NOT_FOUND re-reads the list', async () => {
    const s = setup({
      answers: [
        { ok: false, error: { kind: 'api', status: 404, code: 'PRINTER_NOT_FOUND', details: { printer_id: 'P2' } } },
        { ok: false, error: { kind: 'api', status: 409, code: 'PRINT_JOB_NOT_PENDING', details: { job_id: 'J1', state: 'printed' } } },
      ],
    });
    const changed: unknown[] = [];
    const v = await show(s, <PrintRows prints={[p({ job_id: 'J1', state: 'failed' })]} onChanged={() => changed.push(1)} />);
    v.click(v.button('Print to'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLElement>('.b5-chip')][1]);
    v.click(v.container.querySelector('.acts .btn--primary'));
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toBe('This printer was removed — pick another');
    expect(s.query).toHaveBeenCalledTimes(2);
    v.click([...v.container.querySelectorAll<HTMLElement>('.b5-chip')][2]);
    v.click(v.container.querySelector('.acts .btn--primary'));
    await flush();
    expect(s.shown).toEqual([{ text: 'Already printed or cancelled', tone: 'warn' }]);
    expect(changed).toEqual([1]);
    expect(v.container.querySelector('.dlg')).toBeNull();
  });

  it('a lost reply keeps the sheet with "Needs the hub"; the resend is the same command_id', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }] });
    const v = await show(s, <PrintRows prints={[p({ job_id: 'J1', state: 'failed' })]} onChanged={() => {}} />);
    v.click(v.button('Print to'));
    await flush();
    v.click([...v.container.querySelectorAll<HTMLElement>('.b5-chip')][1]);
    v.click(v.container.querySelector('.acts .btn--primary'));
    await flush();
    expect(v.container.querySelector('.dlg .msg')?.textContent).toBe('Needs the hub');
    v.click(v.container.querySelector('.acts .btn--primary'));
    await flush();
    expect(s.command.mock.calls[1]![2]?.commandId).toBe(s.command.mock.calls[0]![2]?.commandId);
  });

  it('[review m2, m3] a waiting job that leaves waiting loses its 10 s mark; a printing (sent) job never offers Print to; unmount clears the timers', async () => {
    vi.useFakeTimers();
    const s = setup();
    const node = (prints: BillPrint[]) => (
      <ShellContext.Provider value={s.shell}>
        <PrintRows prints={prints} onChanged={() => {}} />
      </ShellContext.Provider>
    );
    const v = await show(s, <PrintRows prints={[p({ job_id: 'J1' })]} onChanged={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_500);
    });
    expect(v.container.querySelector('.b5-pr button')?.textContent).toBe('Print to');
    // sent to the printer: not movable any more
    v.render(node([p({ job_id: 'J1', state: 'printing' })]));
    expect(v.container.querySelector('.b5-pr button')).toBeNull();
    // back to waiting (a retarget keeps the job id): the 10 s start again
    v.render(node([p({ job_id: 'J1' })]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(v.container.querySelector('.b5-pr button')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_500);
    });
    expect(v.container.querySelector('.b5-pr button')?.textContent).toBe('Print to');
    v.render(node([p({ job_id: 'J2' })]));
    v.unmount();
    view = null;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('[review m6] a reprint resent after a lost reply keeps its command_id even from a remounted button', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { printed: true, job_id: 'J9', printer_name: 'Counter' } }] });
    const v = await show(s, <ReprintButton doc="receipt" invoiceId="I7" onPrinted={() => {}} />);
    v.click(v.button('Reprint receipt'));
    await flush();
    v.unmount();
    view = null;
    const w = await show(s, <ReprintButton doc="receipt" invoiceId="I7" onPrinted={() => {}} />);
    w.click(w.button('Reprint receipt'));
    await flush();
    expect(s.command.mock.calls[1]![2]?.commandId).toBe(s.command.mock.calls[0]![2]?.commandId);
  });

  it('Cancel closes the picker without a command', async () => {
    const s = setup();
    const v = await show(s, <PrintRows prints={[p({ job_id: 'J1', state: 'failed' })]} onChanged={() => {}} />);
    v.click(v.button('Print to'));
    await flush();
    v.click(v.button('Cancel'));
    expect(v.container.querySelector('.dlg')).toBeNull();
    expect(s.command).not.toHaveBeenCalled();
  });
});

describe('[05 §6.22] Reprint receipt / credit note (task 38)', () => {
  it('sends PrintBillDocument { doc, ref_id }; printed → toast with the printer; printed: false → the no-printer text', async () => {
    const s = setup({ answers: [{ ok: true, data: { printed: true, job_id: 'J9', printer_name: 'Counter' } }, { ok: true, data: { printed: false, job_id: null, printer_name: null } }] });
    const done: unknown[] = [];
    const v = await show(s, <ReprintButton doc="receipt" invoiceId="I1" onPrinted={() => done.push(1)} />);
    v.click(v.button('Reprint receipt'));
    await flush();
    expect(s.command.mock.calls[0]).toEqual(['PrintBillDocument', { doc: 'receipt', ref_id: 'I1' }, expect.anything()]);
    expect(s.shown[0]).toEqual({ text: 'Reprint sent to Counter', tone: 'ok' });
    v.click(v.button('Reprint receipt'));
    await flush();
    expect(s.shown[1]).toEqual({ text: 'No bill printer is set up — show the screen to the customer', tone: 'warn' });
    expect(done).toEqual([1, 1]);
  });

  it('the credit note reads its own label; INVOICE_NOT_FOUND its text', async () => {
    const s = setup({ answers: [{ ok: false, error: { kind: 'api', status: 404, code: 'INVOICE_NOT_FOUND', details: { invoice_id: 'C1' } } }] });
    const v = await show(s, <ReprintButton doc="credit_note" invoiceId="C1" onPrinted={() => {}} />);
    v.click(v.button('Reprint credit note'));
    await flush();
    expect(s.command.mock.calls[0]![1]).toEqual({ doc: 'credit_note', ref_id: 'C1' });
    expect(s.shown[0]).toEqual({ text: "This invoice can't be found", tone: 'warn' });
  });

  it('[05 §8 Rules] every key of this block is in en and in ur or 05/urdu-todo.md', () => {
    const start = enSource.indexOf('// ---- 05 client (task 38, Print to)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      expect((ur as Record<string, string | undefined>)[key] !== undefined || TODO_05.has(key), key).toBe(true);
    }
  });
});
