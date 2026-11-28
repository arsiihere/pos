import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext } from '../../shell/hooks';
import { createTokenBook, type TokenBook } from './book';
import type { QueueToken } from './queue-model';
import { screenHarness, sl, view } from './screen-harness';
import { slipMissesOf } from './slips';
import { aRow, at } from './test-fixtures';
import { TokenView } from './TokenView';

// ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §3.11, §6.14, §8; 02b v1.0.25 §3.2 steps 2b, 10a, 11, §8 (R6); test 82; 03c
// client tests): "Send · pay later" (every takeaway Send that is not Send & pay, an addition too) sends
// `takeaway.print_slip: true`; "Send & pay" leaves it out. The result's `slip` shows briefly in the sent toast; a miss
// (`no_printer`, `failed`, `replay_late`) marks the token "Slip not printed — Print slip"; `setting_off` / `slip_held`
// show nothing. The token view of a Due token offers Print token (`PrintTakeawaySlip { reason: 'reprint' }`,
// take-order, one request in flight, off while offline); `TAKEAWAY_SLIP_NOT_ALLOWED` (billed) refreshes it.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

let m: Mounted | null = null;
let book: TokenBook | null = null;
const reset = () => {
  m?.unmount();
  m = null;
};
afterEach(() => {
  reset();
  book?.dispose();
  book = null;
  document.body.innerHTML = '';
});

type Slip = { printed: boolean; job_id: string | null; skipped: string | null } | null;
const submitted = (slip: Slip) => (type: string, payload: unknown) =>
  type === 'SubmitOrder' ? { status: 'sent', result: { order_id: (payload as { order_id: string }).order_id, token: 57, groups: [{ group_id: 'g', promise_ms: at(13, 42), order_item_ids: [] }], lines: [], slip } } : undefined;

const addNaan = (v: Mounted) => {
  v.click(v.button('Sides', v.container.querySelector('.pills')!));
  v.click(v.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};
const takeawayOf = (h: ReturnType<typeof screenHarness>) => (h.sent[0]?.payload as { takeaway?: Record<string, unknown> }).takeaway;

describe('[02b-TK L-CLIENT-3 item 2; 03c §3.11 trigger 1; 02b §3.2 step 2b] the flag on Send', () => {
  it('[03c §8 Q-TK-4] Send · pay later sends takeaway.print_slip: true; Send & pay leaves it out', async () => {
    for (const [button, flag] of [
      ['Send · pay later', { print_slip: true }],
      ['Send & pay', undefined],
    ] as const) {
      const h = screenHarness({ answer: submitted(null) });
      const v = h.render();
      m = v;
      await flush();
      addNaan(v);
      v.click(v.button(button, v.container.querySelector('.cart')!));
      await flush();
      expect(h.sent.map((s) => s.type)).toEqual(['SubmitOrder']);
      expect(takeawayOf(h)).toEqual(flag);
      v.unmount();
      m = null;
    }
  });

  it('[02b §3.2 step 2b] the flag sits beside the typed contact; an addition ("Add to token") and a Send without take-payment are pay later too', async () => {
    const plain = screenHarness({ answer: submitted(null), grants: { 'take-payment': { grant: 'not_granted', scope: 'branch' } } });
    let v = plain.render();
    m = v;
    await flush();
    addNaan(v);
    v.click(v.button('Send', v.container.querySelector('.cart')!));
    await flush();
    expect(takeawayOf(plain)).toEqual({ print_slip: true });
    v.unmount();
    m = null;

    const add = screenHarness({ answer: submitted(null), rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } })], views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]) }, bills: { O48: { bill_id: 'B48', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 4_000 }], totals_default: { total_minor: 4_000 } } } });
    v = add.render();
    m = v;
    await flush();
    v.click(v.container.querySelector('.tk-qr'));
    await flush();
    v.click(v.button('Add items'));
    await flush();
    addNaan(v);
    v.click(v.button('Add to token 48', v.container.querySelector('.cart')!));
    await flush();
    expect(add.sent[0]?.payload).toMatchObject({ adds_to_order_id: 'O48', takeaway: { print_slip: true } });
  });
});

describe('[02b-TK L-CLIENT-3 item 2; 03c §3.11 Result, §8] the slip result after Send', () => {
  const sendLater = async (slip: Slip) => {
    const h = screenHarness({ answer: submitted(slip) });
    const v = h.render();
    m = v;
    await flush();
    addNaan(v);
    v.click(v.button('Send · pay later', v.container.querySelector('.cart')!));
    await flush();
    const order_id = (h.sent[0]!.payload as { order_id: string }).order_id;
    return { h, order_id };
  };

  it('[frame SentToast] printed → the sent toast says "Slip printing"', async () => {
    const { h, order_id } = await sendLater({ printed: true, job_id: 'J1', skipped: null });
    expect(h.toasts.at(-1)).toMatchObject({ text: '57 · sent · ready 1:42 PM', sub: 'Slip printing', tone: 'ok' });
    expect(slipMissesOf(h.shell).missed([order_id])).toBe(false);
  });

  it('[L-CLIENT-6a item 9; frame SentToast] the sent toast carries the token and Print again (PrintTakeawaySlip reprint)', async () => {
    const { h, order_id } = await sendLater({ printed: true, job_id: 'J1', skipped: null });
    const toast = h.toasts.at(-1) as { token?: string; action?: { label: string; run(): void } };
    expect(toast.token).toBe('57');
    expect(toast.action?.label).toBe('Print again');
    toast.action!.run();
    await flush();
    expect(h.commands.at(-1)).toEqual({ type: 'PrintTakeawaySlip', payload: { order_id, reason: 'reprint' } });
  });

  it('[03c §8] no_printer, failed, replay_late → "Slip not printed — Print slip", and the token is marked', async () => {
    for (const skipped of ['no_printer', 'failed', 'replay_late']) {
      const { h, order_id } = await sendLater({ printed: false, job_id: null, skipped });
      expect(h.toasts.at(-1)).toMatchObject({ sub: 'Slip not printed — Print slip' });
      expect(slipMissesOf(h.shell).missed([order_id])).toBe(true);
      reset();
    }
  });

  it('[03c §8] setting_off and slip_held (and Send & pay\'s null) show nothing', async () => {
    for (const slip of [{ printed: false, job_id: null, skipped: 'setting_off' }, { printed: false, job_id: null, skipped: 'slip_held' }, null]) {
      const { h, order_id } = await sendLater(slip);
      expect(h.toasts.at(-1)?.sub).toBeUndefined();
      expect(slipMissesOf(h.shell).missed([order_id])).toBe(false);
      reset();
    }
  });

  it('[03c §8] a marked token\'s rail row reads "Slip not printed — Print slip"', async () => {
    const h = screenHarness({ rows: [aRow({ order_id: 'O48', token: 48, ready: { n: 0, m: 1 } })], views: { O48: view('O48', [sl('O48', 'A', 'Karahi', 'cooking')]) } });
    slipMissesOf(h.shell).mark('O48');
    const v = h.render();
    m = v;
    await flush();
    expect(v.container.querySelector('.tk-qr [data-slip]')?.textContent).toBe('Slip not printed — Print slip');
  });
});

describe('[02b-TK L-CLIENT-3 item 2; 03c §6.14, §8] Print token (PrintTakeawaySlip reprint) on the token view', () => {
  const tok: QueueToken = { key: 'k', token: 53, order_ids: ['O53', 'O53b'], newest_order_id: 'O53b', customer_name: null, phone: null, placed_at: at(13, 4), promise_ms: at(13, 24), ready: { n: 0, m: 1 }, paid: false, part: false, summary: '' };
  const due = { bill_id: 'B53', state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: 39_000, invoice: null }], totals_default: { total_minor: 39_000 } };
  const paid = { bill_id: 'B53', state: 'closed', splits: [{ split_no: 1, state: 'closed', balance_minor: 0, totals: { as_paid: { total_minor: 39_000 } }, invoice: null }], totals_default: { total_minor: 0 } };
  const views = { O53: view('O53', [sl('O53', 'A', 'Karahi', 'cooking')]), O53b: view('O53b', [sl('O53b', 'B', 'Naan', 'cooking')]) };

  const showView = async (o: { bill?: unknown; grants?: Record<string, unknown>; online?: boolean; command?: (type: string, payload: unknown) => unknown } = {}) => {
    let reads = 0;
    const h = screenHarness({ views, online: o.online ?? true, grants: o.grants ?? {}, bill: (id) => (id === 'O53b' ? (reads++, o.bill ?? due) : undefined), command: o.command ?? (() => ({ ok: true, data: { printed: true, job_id: 'J1', skipped: null } })) });
    book = createTokenBook(h.live);
    const v = mount();
    m = v;
    v.render(
      <ShellContext.Provider value={h.shell}>
        <TokenView token={tok} book={book} onClose={() => {}} onHandOver={() => {}} />
      </ShellContext.Provider>,
    );
    await flush();
    return { h, v, reads: () => reads };
  };
  const printToken = (v: Mounted) => v.buttons().find((b) => b.textContent === 'Print slip');

  it('[03c §6.14] a Due token: PrintTakeawaySlip { order_id: newest, reason: "reprint" }, not queued; "Slip printing"; the mark goes', async () => {
    const { h, v } = await showView();
    slipMissesOf(h.shell).mark('O53');
    v.click(printToken(v));
    await flush();
    expect(h.commands).toEqual([{ type: 'PrintTakeawaySlip', payload: { order_id: 'O53b', reason: 'reprint' } }]);
    expect(h.sent).toEqual([]);
    expect(h.toasts.at(-1)).toEqual({ text: 'Slip printing', tone: 'ok' });
    expect(slipMissesOf(h.shell).missed(['O53', 'O53b'])).toBe(false);
  });

  it('[03c §8] only on a Due token, for take-order holders', async () => {
    expect(printToken((await showView({ bill: paid })).v)).toBeUndefined();
    reset();
    expect(printToken((await showView({ grants: { 'take-order': { grant: 'not_granted', scope: 'branch' } } })).v)).toBeUndefined();
  });

  it('[03c §8] one request in flight; off while offline (not queueable)', async () => {
    let answer: (x: unknown) => void = () => {};
    const { h, v } = await showView({ command: () => new Promise((r) => (answer = r)) });
    v.click(printToken(v));
    v.click(printToken(v));
    await flush();
    expect(h.commands).toHaveLength(1);
    answer({ ok: true, data: { printed: true, job_id: 'J1', skipped: null } });
    await flush();
    reset();
    const off = await showView({ online: false });
    expect(printToken(off.v)!.getAttribute('aria-disabled')).toBe('true');
    off.v.click(printToken(off.v));
    await flush();
    expect(off.h.commands).toEqual([]);
  });

  it('[03c §6.14 Result, §8] no_printer → "No slip printer is set up"; a refusal says why; billed refreshes the view', async () => {
    const none = await showView({ command: () => ({ ok: true, data: { printed: false, job_id: null, skipped: 'no_printer' } }) });
    none.v.click(printToken(none.v));
    await flush();
    expect(none.h.toasts.at(-1)).toEqual({ text: 'No slip printer is set up — the token is on the screen', tone: 'warn' });
    reset();

    const billed = await showView({ command: () => ({ ok: false, error: { kind: 'api', status: 409, code: 'TAKEAWAY_SLIP_NOT_ALLOWED', details: { order_id: 'O53b', reason: 'billed' } } }) });
    const before = billed.reads();
    billed.v.click(printToken(billed.v));
    await flush();
    expect(billed.h.toasts.at(-1)).toEqual({ text: 'No slip for this order — it is paid, cancelled or not a takeaway', tone: 'warn' });
    expect(billed.reads()).toBeGreaterThan(before);
    reset();

    const network = await showView({ command: () => ({ ok: false, error: { kind: 'network' } }) });
    network.v.click(printToken(network.v));
    await flush();
    expect(network.h.toasts.at(-1)).toEqual({ text: 'Needs the hub', tone: 'warn' });
  });
});
