import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import enSource from '../../i18n/en.ts?raw';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createLiveBus } from '../staff/shell/live';
import { createToastBus } from '../staff/shell/toast';
import type { BillPrint } from './contracts';
import { CheckBillButton, PrintRows } from './PrintStatus';
import { TODO_05 } from './urdu-todo-05';

// 05 v1.0.14 §8 "Print status", §6.3, §6.1 `prints[]` (plan §3.1 task 38; brief §3.2.7, §3.4; frame PrintStatus):
// each bill document shows waiting / printed / failed with the printer name; Print check bill. The Print to picker
// (GET /queries/bill-printers, RetargetBillPrint) and reprints come with task 27.

type Answer = { ok: true; data: unknown } | { ok: false; error: { kind: 'api'; status: number; code: string; details: Record<string, unknown> } | { kind: 'network' } };

function setup(answers: Answer[] = []) {
  const queue = [...answers];
  const command = vi.fn(async (type: string, payload: unknown, opts?: { commandId?: string }): Promise<Answer> => {
    void type;
    void payload;
    void opts;
    return queue.shift() ?? { ok: true, data: { bill_id: 'B7', printed: true, job_id: 'J1', printer_name: 'Counter', totals_default: {} } };
  });
  const toasts = createToastBus();
  const shown: Array<{ text: string; tone?: string }> = [];
  const show = toasts.show.bind(toasts);
  toasts.show = (x) => {
    shown.push(x as { text: string; tone?: string });
    show(x);
  };
  const shell = { api: { query: vi.fn(), command }, live: createLiveBus(), toasts, online: true, phone: false, portrait: false } as unknown as Shell;
  return { shell, command, shown };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
  setLanguage('en');
});

async function show(s: ReturnType<typeof setup>, node: React.ReactNode) {
  view = mount();
  view.render(<ShellContext.Provider value={s.shell}>{node}</ShellContext.Provider>);
  await flush();
  return view;
}

const p = (over: Partial<BillPrint> & { job_id: string }): BillPrint => ({ doc_kind: 'check', state: 'waiting', printer_name: 'Counter', last_error: null, ...over });
const rows = (v: Mounted) => [...v.container.querySelectorAll<HTMLElement>('.b5-pr')].map((r) => `${r.className.replace('b5-pr ', '')}|${r.querySelector('.k')?.textContent}|${r.querySelector('.t > span:last-child')?.textContent}`);

describe('[05 §8 Print status; §6.1 prints[]] print rows (task 38)', () => {
  it('waiting / printing → info "Printing on …", printed → ok, failed → danger with the 03c error word; kind as the label', async () => {
    const v = await show(
      setup(),
      <PrintRows
        prints={[
          p({ job_id: 'J1' }),
          p({ job_id: 'J2', doc_kind: 'receipt', state: 'printing' }),
          p({ job_id: 'J3', doc_kind: 'receipt', state: 'printed' }),
          p({ job_id: 'J4', doc_kind: 'credit', state: 'failed', last_error: 'connect' }),
        ]}
      />,
    );
    expect(rows(v)).toEqual([
      'c-info|Check bill|Printing on Counter…',
      'c-info|Receipt|Printing on Counter…',
      'c-ok|Receipt|Printed on Counter',
      "c-danger|Credit note|Didn’t print on Counter: Can't reach the printer",
    ]);
    // waiting shows the spinner, the others an icon
    expect(v.container.querySelectorAll('.b5-pr .spin').length).toBe(2);
  });

  it('a failed row never shows a raw error code: an unknown or missing one reads without the error word', async () => {
    const v = await show(setup(), <PrintRows prints={[p({ job_id: 'J1', state: 'failed', last_error: 'xyz_raw' }), p({ job_id: 'J2', state: 'failed', last_error: null })]} />);
    expect(rows(v)).toEqual(['c-danger|Check bill|Didn’t print on Counter', 'c-danger|Check bill|Didn’t print on Counter']);
    expect(v.text()).not.toContain('xyz_raw');
  });

  it('a cancelled job is not shown; no print at all shows nothing', async () => {
    const v = await show(setup(), <PrintRows prints={[p({ job_id: 'J1', state: 'cancelled' })]} />);
    expect(v.container.querySelectorAll('.b5-pr').length).toBe(0);
  });

  it('the no-printer row (after a PrintCheckBill with printed: false): muted "No bill printer set up"', async () => {
    const v = await show(setup(), <PrintRows prints={[]} noPrinter="check" />);
    expect(rows(v)).toEqual(['c-mute|Check bill|No bill printer set up']);
  });
});

describe('[05 §6.3; brief §3.2.7] Print check bill (task 38)', () => {
  it('sends PrintCheckBill { bill_ref }; printed → toast "Check bill sent to <printer>" and onPrinted', async () => {
    const s = setup();
    const done: unknown[] = [];
    const v = await show(s, <CheckBillButton billRef={{ seating_id: 'S7' }} onPrinted={(r) => done.push(r)} />);
    v.click(v.button('Print check bill'));
    await flush();
    expect(s.command).toHaveBeenCalledTimes(1);
    expect(s.command.mock.calls[0]![0]).toBe('PrintCheckBill');
    expect(s.command.mock.calls[0]![1]).toEqual({ bill_ref: { seating_id: 'S7' } });
    expect(s.shown).toEqual([{ text: 'Check bill sent to Counter', tone: 'ok' }]);
    expect(done).toEqual([{ printed: true, printer_name: 'Counter', job_id: 'J1' }]);
  });

  it('printed: false → "No bill printer is set up — show the screen to the customer" (warn)', async () => {
    const s = setup([{ ok: true, data: { bill_id: 'B7', printed: false, job_id: null, printer_name: null, totals_default: {} } }]);
    const done: unknown[] = [];
    const v = await show(s, <CheckBillButton billRef={{ bill_id: 'B7' }} onPrinted={(r) => done.push(r)} />);
    v.click(v.button('Print check bill'));
    await flush();
    expect(s.shown).toEqual([{ text: 'No bill printer is set up — show the screen to the customer', tone: 'warn' }]);
    expect(done).toEqual([{ printed: false, printer_name: null, job_id: null }]);
  });

  it('BILL_NOT_OPEN → its text; a lost reply → "Needs the hub", and the resend keeps the command_id', async () => {
    const s = setup([
      { ok: false, error: { kind: 'api', status: 409, code: 'BILL_NOT_OPEN', details: { bill_id: 'B7', state: 'closed' } } },
      { ok: false, error: { kind: 'network' } },
      { ok: true, data: { bill_id: 'B7', printed: true, job_id: 'J1', printer_name: 'Counter', totals_default: {} } },
    ]);
    const v = await show(s, <CheckBillButton billRef={{ bill_id: 'B7' }} onPrinted={() => {}} />);
    v.click(v.button('Print check bill'));
    await flush();
    expect(s.shown[0]).toEqual({ text: 'This bill is already closed', tone: 'warn' });
    v.click(v.button('Print check bill'));
    await flush();
    expect(s.shown[1]).toEqual({ text: 'Needs the hub', tone: 'warn' });
    v.click(v.button('Print check bill'));
    await flush();
    const ids = s.command.mock.calls.map((c) => c[2]?.commandId);
    expect(ids[2]).toBe(ids[1]);
    expect(ids[1]).not.toBe(ids[0]);
  });

  it('[frame BillUrdu] Urdu: the button reads چیک بل پرنٹ', async () => {
    setLanguage('ur');
    const v = await show(setup(), <CheckBillButton billRef={{ bill_id: 'B7' }} onPrinted={() => {}} />);
    expect(v.text()).toContain('چیک بل پرنٹ');
  });

  it('[05 §8 Rules] every task-38 key is in en and in ur or 05/urdu-todo.md; Urdu keeps the placeholders', () => {
    const start = enSource.indexOf('// ---- 05 client (task 38)');
    expect(start).toBeGreaterThan(0);
    const end = enSource.indexOf('// ----', start + 10);
    const keys = [...enSource.slice(start, end === -1 ? undefined : end).matchAll(/^ {2}'([^']+)':/gm)].map((m) => m[1]!);
    expect(keys.length).toBe(11);
    const holes = (x: string) => [...x.matchAll(/\{\w+\}/g)].map((m) => m[0]).join();
    for (const key of keys) {
      expect(key in en, key).toBe(true);
      const u = (ur as Record<string, string | undefined>)[key];
      expect(u !== undefined || TODO_05.has(key), key).toBe(true);
      if (u !== undefined) expect(holes(u), key).toBe(holes((en as Record<string, string>)[key]!));
    }
  });
});
