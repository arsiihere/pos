import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage, t } from '../../i18n';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import type { LineOrder } from '../staff/orders/view/LineActions';
import { CancelOrderSheet, cancelTargets, type CancelRound } from './CancelOrderSheet';
import type { VoidPreview } from './contracts';
import { ALLOWED, apiError, APPROVAL, dineIn, ok, preview, sline, voidShell, type CommandFn } from './test-fakes';

// 04 §8 Cancel order / Void all (handoff 04-D08: CancelOrder, CancelOrderWasteAll, CancelOrderRemoveFailed,
// CancelOrderRetry; §10 #59).

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  setLanguage('en');
});

const removeP = (id: string): VoidPreview => ({ ...preview(id), group: 'remove', touched: [], dispositions: [], refund_minor: 0 });

// Seekh at stage 1 (remove); Karahi done (moved); Lassi served, no stock (wastage); Raita at added with a cooking child (V1 d′: void)
const lines = () => [
  sline('SK', { name: 'Seekh Kebab', units: 4, live_units: 4, stage: 'added', billed_minor: 140_000 }),
  sline('KR', { name: 'Chicken Karahi', stage: 'done' }),
  sline('XN', { name: 'Extra naan', line_kind: 'option_child', parent_order_item_id: 'KR', stage: 'added', units: 2, live_units: 2 }),
  sline('LS', { name: 'Lassi', stage: null, served_at: 1, billed_minor: 30_000 }),
  sline('RT', { name: 'Raita', stage: 'added' }),
  sline('RC', { name: 'Chutney', line_kind: 'option_child', parent_order_item_id: 'RT', stage: 'cooking' }),
];
const previews = () => [
  removeP('SK'),
  preview('KR', { children: [{ id: 'XN', started: false, units: 2 }] }),
  preview('LS', { moved: 'stock_not_tracked', refund_minor: 30_000 }),
  preview('RT', { moved: 'not_movable_stage', children: [{ id: 'RC', started: true }], refund_minor: 10_000 }),
];

function setup(order: LineOrder, o: { command?: CommandFn; previews?: () => VoidPreview[]; perms?: NonNullable<Parameters<typeof voidShell>[0]>['perms'] } = {}) {
  const s = voidShell({ ...(o.perms === undefined ? {} : { perms: o.perms }), query: async () => ok({ previews: (o.previews ?? previews)() }), ...(o.command === undefined ? {} : { command: o.command }) });
  let done = 0;
  const m = mount();
  current = m;
  m.render(
    <ShellContext.Provider value={s.shell as Shell}>
      <CancelOrderSheet rounds={[{ n: 1, order }]} mode="order" onClose={() => {}} onDone={() => (done += 1)} onChanged={() => {}} />
    </ShellContext.Provider>,
  );
  const dlg = () => m.container.querySelector<HTMLElement>('.dlg--all')!;
  const primary = () => dlg().querySelector<HTMLElement>('.acts .btn:last-child')!;
  const group = (g: string) => [...dlg().querySelectorAll(`.vgroup[data-group="${g}"] .vrow`)].map((r) => r.getAttribute('data-line'));
  const sel = (id: string) => dlg().querySelector<HTMLSelectElement>(`.vrow[data-line="${id}"] select`)!;
  return { ...s, m, dlg, primary, group, sel, done: () => done };
}

describe('04 §8 Cancel order (Void all)', () => {
  it('[04 #59] parents only: option children and deal parts go with their parent', () => {
    expect(cancelTargets(lines()).map((l) => l.order_item_id)).toEqual(['SK', 'KR', 'LS', 'RT']);
  });

  it('[04 #59] ONE void-preview with every live parent line; groups from it (an item at added with a cooking child is in Void, H3-4); per-entry defaults', async () => {
    const s = setup(dineIn(lines()));
    await flush();
    expect(s.query).toHaveBeenCalledTimes(1);
    expect(s.query.mock.calls[0]![0]).toBe('/queries/void-preview?order_id=O1&order_item_ids=SK,KR,LS,RT');
    expect(s.group('remove')).toEqual(['SK']);
    expect(s.group('void')).toEqual(['KR', 'LS', 'RT']);
    // done karahi → moved; served drink (no stock) → wastage
    expect(s.sel('KR').value).toBe('moved');
    expect(s.sel('LS').value).toBe('wastage');
    expect(s.sel('RT').value).toBe('wastage');
    expect(s.primary().textContent).toBe(t('comp.pick_reason'));
    s.m.click(s.m.button(t('void.reason.customer_changed_mind'), s.dlg()));
    expect(s.primary().textContent).toBe('Remove 1 · ask to void 3');
  });

  it('[04 #59] RemoveItems first (stage-1 lines, with the seating), then ONE VoidItems with parents only', async () => {
    const s = setup(dineIn(lines()), {
      command: async (type) => (type === 'RemoveItems' ? ok({ removed: [{ order_item_id: 'SK', units: 4 }], cancelled: false }) : ok({ pending: [{ order_item_id: 'KR', alert_id: 'A1' }, { order_item_id: 'LS', alert_id: 'A2' }, { order_item_id: 'RT', alert_id: 'A3' }] })),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.customer_changed_mind'), s.dlg()));
    s.m.click(s.primary());
    await flush();
    expect(s.command.mock.calls.map((c) => c[0])).toEqual(['RemoveItems', 'VoidItems']);
    expect(s.command.mock.calls[0]![1]).toEqual({ order_id: 'O1', seating_id: 'S4', lines: [{ order_item_id: 'SK' }] });
    expect(s.command.mock.calls[1]![1]).toEqual({
      order_id: 'O1',
      reason_code: 'customer_changed_mind',
      note: null,
      disposition_note: null,
      lines: [
        { order_item_id: 'KR', disposition: 'moved' },
        { order_item_id: 'LS', disposition: 'wastage' },
        { order_item_id: 'RT', disposition: 'wastage' },
      ],
    });
    expect(s.shell.toasts.current()).toEqual({ text: t('void.toast.cancelled'), sub: '1 removed · 3 voids waiting for approval' });
    expect(s.done()).toBe(1);
  });

  it('[04 #59 H6-8] a failed RemoveItems stops the flow: nothing voided, "… — nothing was cancelled", void-preview read again', async () => {
    const s = setup(dineIn(lines()), { command: async () => apiError('TABLE_ALREADY_LOCKED', {}) });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush();
    expect(s.command.mock.calls.map((c) => c[0])).toEqual(['RemoveItems']);
    expect(s.dlg().querySelector('.msg.c-danger')?.textContent).toBe('Someone is taking an order here — nothing was cancelled' + t('void_all.reloaded'));
    expect(s.query).toHaveBeenCalledTimes(2);
    expect(s.done()).toBe(0);
  });

  it('[04 §8] the second command fails (COMP_PENDING): the removals stay, the preview is read again, Try again', async () => {
    let read = 0;
    const s = setup(dineIn(lines()), {
      previews: () => (++read === 1 ? previews() : previews().slice(1).map((p) => (p.order_item_id === 'RT' ? { ...p, comp_pending: null } : p))),
      command: async (type) => (type === 'RemoveItems' ? ok({ removed: [{ order_item_id: 'SK', units: 4 }], cancelled: false }) : apiError('COMP_PENDING', { alert_id: 'C1' })),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush();
    const msgs = [...s.dlg().querySelectorAll('.msg')].map((x) => x.textContent);
    expect(msgs[0]).toBe('Seekh Kebab ×4 removed');
    expect(msgs[1]).toBe('The voids were not sent: A comp is waiting on this item — decide it first' + t('void_all.left_below'));
    expect(s.group('remove')).toEqual([]);
    expect(s.primary().textContent).toBe('Try again · void 3');
    s.m.click(s.primary());
    await flush();
    expect(s.command.mock.calls.map((c) => c[0])).toEqual(['RemoveItems', 'VoidItems', 'VoidItems']);
  });

  it('[04 §8] Waste all sets every void line to Wastage (.is-set); each line can still change', async () => {
    const s = setup(dineIn(lines()));
    await flush();
    s.m.click(s.dlg().querySelector('.tgl'));
    expect(s.dlg().querySelector('.tgl')?.getAttribute('aria-checked')).toBe('true');
    expect(['KR', 'LS', 'RT'].map((id) => s.sel(id).value)).toEqual(['wastage', 'wastage', 'wastage']);
    expect(s.sel('KR').className).toBe('dsel is-set');
    // moved is offered only where its preview enables it
    expect([...s.sel('LS').options].map((o) => o.value)).toEqual(['wastage', 'staff_meal', 'other']);
  });

  it('[04 §8] allowed path: "Remove 1 · void 3", off the bill at once', async () => {
    const s = setup(dineIn(lines()), { perms: ALLOWED, previews: () => previews().map((p) => ({ ...p, needs_approval: false })) });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    expect(s.primary().textContent).toBe('Remove 1 · void 3');
    expect(s.primary().className).toContain('btn--danger');
  });
});

// 04 v1.0.5 §8 Cancel table (owner Q-VU1-1 (a), row S-1; §10 #59b): every live round of the seating.
describe('04 v1.0.5 §8 Cancel table', () => {
  // round 1: a done karahi (void, moved); round 2: a stage-1 karahi (remove) and a served lassi (void)
  const r1 = () => dineIn([sline('K1', { order_id: 'O1', name: 'Chicken Karahi', stage: 'done' })], { order_id: 'O1' });
  const r2 = () =>
    dineIn([sline('K2', { order_id: 'O2', name: 'Chicken Karahi', stage: 'added' }), sline('L2', { order_id: 'O2', name: 'Lassi', stage: null, served_at: 1, billed_minor: 30_000 })], { order_id: 'O2' });
  /** the hub's answer for the ids asked (a removed line is no longer asked for) */
  const pv = (path: string): VoidPreview[] => {
    const ids = new URL(path, 'http://h').searchParams.get('order_item_ids')!.split(',');
    const all = path.includes('order_id=O1') ? [preview('K1')] : [removeP('K2'), preview('L2', { moved: 'stock_not_tracked', refund_minor: 30_000 })];
    return all.filter((p) => ids.includes(p.order_item_id));
  };

  function table(o: { command?: CommandFn; previews?: (path: string) => VoidPreview[]; perms?: NonNullable<Parameters<typeof voidShell>[0]>['perms'] } = {}) {
    const s = voidShell({ ...(o.perms === undefined ? {} : { perms: o.perms }), query: async (path) => ok({ previews: (o.previews ?? pv)(path) }), ...(o.command === undefined ? {} : { command: o.command }) });
    let done = 0;
    const m = mount();
    current = m;
    const rounds: CancelRound[] = [
      { n: 1, order: r1() },
      { n: 2, order: r2() },
    ];
    m.render(
      <ShellContext.Provider value={s.shell as Shell}>
        <CancelOrderSheet rounds={rounds} mode="table" onClose={() => {}} onDone={() => (done += 1)} onChanged={() => {}} />
      </ShellContext.Provider>,
    );
    const dlg = () => m.container.querySelector<HTMLElement>('.dlg--all')!;
    const primary = () => dlg().querySelector<HTMLElement>('.acts .btn:last-child')!;
    const sent = () => s.command.mock.calls.map((c) => `${c[0]}:${(c[1] as { order_id: string }).order_id}`);
    const ids = () => s.command.mock.calls.map((c) => (c[2] as { commandId: string }).commandId);
    const msgs = () => [...dlg().querySelectorAll('.msg')].map((x) => x.textContent);
    /** void-preview reads per order (the reload scope) */
    const reads = () => {
      const by: Record<string, number> = {};
      for (const c of s.query.mock.calls) {
        const id = /order_id=(\w+)/.exec(c[0] as string)![1]!;
        by[id] = (by[id] ?? 0) + 1;
      }
      return by;
    };
    return { ...s, m, dlg, primary, sent, ids, msgs, reads, done: () => done };
  }
  const pending = (order_item_id: string, alert_id: string) => ok({ pending: [{ order_item_id, alert_id }] });

  it('[04 #59b] one void-preview per live order; the sheet groups by round, then Remove / Void', async () => {
    const s = table();
    await flush();
    expect(s.query.mock.calls.map((c) => c[0])).toEqual([
      '/queries/void-preview?order_id=O1&order_item_ids=K1',
      '/queries/void-preview?order_id=O2&order_item_ids=K2,L2',
    ]);
    const rounds = [...s.dlg().querySelectorAll('.vround')].map((r) => [r.querySelector('.vlab')?.textContent, [...r.querySelectorAll('.vgroup')].map((g) => g.getAttribute('data-group'))]);
    expect(rounds).toEqual([
      ['Round 1', ['void']],
      ['Round 2', ['remove', 'void']],
    ]);
    expect(s.dlg().querySelector('h2')?.textContent).toBe(t('void_table.title'));
  });

  it('[04 #59b] send order: round 2 RemoveItems, then round 1 VoidItems, then round 2 VoidItems; own command_ids; no X-Queued-At; one reason and Waste all reach every VoidItems', async () => {
    const s = table({
      command: async (type, payload) =>
        type === 'RemoveItems' ? ok({ removed: [{ order_item_id: 'K2', units: 1 }], cancelled: false }) : pending((payload as { lines: Array<{ order_item_id: string }> }).lines[0]!.order_item_id, 'A'),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.too_late'), s.dlg()));
    s.m.click(s.dlg().querySelector('.tgl'));
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1', 'VoidItems:O2']);
    expect(new Set(s.ids()).size).toBe(3);
    for (const c of s.command.mock.calls) expect(Object.keys(c[2] as object)).toEqual(['commandId']);
    expect(s.command.mock.calls[0]![1]).toEqual({ order_id: 'O2', seating_id: 'S4', lines: [{ order_item_id: 'K2' }] });
    for (const c of s.command.mock.calls.slice(1)) {
      const p = c[1] as { reason_code: string; lines: Array<{ disposition: string }> };
      expect(p.reason_code).toBe('too_late');
      expect(p.lines.every((l) => l.disposition === 'wastage')).toBe(true);
    }
    expect(s.shell.toasts.current()).toEqual({ text: 'Voids asked', sub: '1 removed · 0 voided · 2 waiting for approval' });
    expect(s.done()).toBe(1);
  });

  it('[04 #59b] without Waste all round 1\'s karahi goes moved (T-2 / H2-6: round 2\'s Remove went first)', async () => {
    const s = table({ command: async (type) => (type === 'RemoveItems' ? ok({ removed: [], cancelled: false }) : pending('X', 'A')) });
    await flush();
    s.m.click(s.m.button(t('void.reason.too_late'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    expect((s.command.mock.calls[1]![1] as { lines: unknown[] }).lines).toEqual([{ order_item_id: 'K1', disposition: 'moved' }]);
  });

  it.each([
    ['TABLE_ALREADY_LOCKED', 409, 'Someone is taking an order here', APPROVAL],
    // a session without take-order is not hidden from Cancel table: its RemoveItems is refused (v1.0.5 §8)
    ['PERMISSION_DENIED', 403, t('tables.err.PERMISSION_DENIED'), { 'void-item': APPROVAL['void-item']! }],
  ])('[04 #59b] Remove stop (%s): no VoidItems for any round, both previews reload', async (code, status, text, perms) => {
    const s = table({ perms, command: async () => apiError(code, {}, status) });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2']);
    expect(s.msgs()[0]).toBe(`${text} — nothing was cancelled` + t('void_all.reloaded'));
    // every live order is read again
    expect(s.reads()).toEqual({ O1: 2, O2: 2 });
  });

  it('[04 #59b] retry from round 1: round 1 VoidItems fails COMP_PENDING → round 2 removal stays, both reload, Try again sends round 1 then round 2 with new ids', async () => {
    let n = 0;
    const s = table({
      command: async (type, payload) => {
        if (type === 'RemoveItems') return ok({ removed: [{ order_item_id: 'K2', units: 1 }], cancelled: false });
        n += 1;
        return n === 1 ? apiError('COMP_PENDING', { alert_id: 'C' }) : pending((payload as { lines: Array<{ order_item_id: string }> }).lines[0]!.order_item_id, 'A');
      },
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1']);
    expect(s.msgs()[0]).toBe('Chicken Karahi ×1 removed');
    expect(s.msgs().at(-1)).toBe('The voids were not sent: A comp is waiting on this item — decide it first' + t('void_all.left_below'));
    // round 1 and every later round are read again (round 2 also once after its removal)
    expect(s.reads()).toEqual({ O1: 2, O2: 3 });
    expect(s.primary().textContent).toBe('Try again · void 2');
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1', 'VoidItems:O1', 'VoidItems:O2']);
    expect(new Set(s.ids()).size).toBe(4);
  });

  it('[04 #59b] retry from round 2: round 2 VoidItems fails → round 2 removal and round 1 void stay, "Round 1 cancelled", Try again sends only round 2', async () => {
    let voids = 0;
    const s = table({
      command: async (type, payload) => {
        if (type === 'RemoveItems') return ok({ removed: [{ order_item_id: 'K2', units: 1 }], cancelled: false });
        voids += 1;
        return voids === 2 ? apiError('COMP_PENDING', { alert_id: 'C' }) : pending((payload as { lines: Array<{ order_item_id: string }> }).lines[0]!.order_item_id, 'A');
      },
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1', 'VoidItems:O2']);
    expect(s.msgs()[0]).toBe('Round 1 cancelled');
    // the cancelled round 1 is not read again; round 2 is (after its removal, then after the failure)
    expect(s.reads()).toEqual({ O1: 1, O2: 3 });
    expect([...s.dlg().querySelectorAll('.vround')].map((r) => r.getAttribute('data-round'))).toEqual(['2']);
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1', 'VoidItems:O2', 'VoidItems:O2']);
    expect(s.ids()[3]).not.toBe(s.ids()[2]);
  });

  it('[04 #59b] allowed: one summary toast "Table cancelled"', async () => {
    const s = table({
      perms: ALLOWED,
      previews: (path) => pv(path).map((p) => ({ ...p, needs_approval: false })),
      command: async (type) => (type === 'RemoveItems' ? ok({ removed: [], cancelled: false }) : ok({ voided: [{ order_item_id: 'X', units: 1, refund_minor: 1, comp_voided_minor: 0, disposition: 'wastage' }], cancelled: true })),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    // the removed count is the hub's (removed: [] here)
    expect(s.shell.toasts.current()).toEqual({ text: 'Table cancelled', sub: '0 removed · 2 voided · 0 waiting for approval' });
  });

  it('[04 §8 D32] a lost reply freezes the sheet; the retry resends that command with its command_id, then goes on', async () => {
    let n = 0;
    const s = table({
      command: async (type, payload) => {
        n += 1;
        if (n === 2) return { ok: false as const, error: { kind: 'network' as const } };
        return type === 'RemoveItems' ? ok({ removed: [], cancelled: false }) : pending((payload as { lines: Array<{ order_item_id: string }> }).lines[0]!.order_item_id, 'A');
      },
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1']);
    expect([...s.dlg().querySelectorAll<HTMLButtonElement>('.chips--r .chip')].every((c) => c.disabled)).toBe(true);
    expect(s.dlg().querySelector<HTMLButtonElement>('.tgl')!.disabled).toBe(true);
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['RemoveItems:O2', 'VoidItems:O1', 'VoidItems:O1', 'VoidItems:O2']);
    expect(s.ids()[2]).toBe(s.ids()[1]);
  });
});

describe('04 v1.0.5 §8 Cancel table — review #233', () => {
  const r1 = () => dineIn([sline('K1', { order_id: 'O1', name: 'Chicken Karahi', stage: 'done' })], { order_id: 'O1' });
  const r2 = () => dineIn([sline('L2', { order_id: 'O2', name: 'Lassi', stage: 'done' })], { order_id: 'O2' });
  const r3 = () => dineIn([sline('N3', { order_id: 'O3', name: 'Naan', stage: 'done' })], { order_id: 'O3' });
  const byIds = (path: string) => new URL(path, 'http://h').searchParams.get('order_item_ids')!.split(',').map((id) => preview(id));
  function sheet(rounds: CancelRound[], o: { command?: CommandFn; previews?: (path: string) => VoidPreview[] } = {}) {
    const s = voidShell({ query: async (path) => ok({ previews: (o.previews ?? byIds)(path) }), ...(o.command === undefined ? {} : { command: o.command }) });
    let done = 0;
    const m = mount();
    current = m;
    const node = (rs: CancelRound[]) => (
      <ShellContext.Provider value={s.shell as Shell}>
        <CancelOrderSheet rounds={rs} mode="table" onClose={() => {}} onDone={() => (done += 1)} onChanged={() => {}} />
      </ShellContext.Provider>
    );
    m.render(node(rounds));
    const dlg = () => m.container.querySelector<HTMLElement>('.dlg--all')!;
    const primary = () => dlg().querySelector<HTMLElement>('.acts .btn:last-child')!;
    const sent = () => s.command.mock.calls.map((c) => `${c[0]}:${(c[1] as { order_id: string }).order_id}`);
    return { ...s, m, node, dlg, primary, sent, done: () => done };
  }
  const pend = async (_t: string, payload: unknown) => ok({ pending: (payload as { lines: Array<{ order_item_id: string }> }).lines.map((l) => ({ order_item_id: l.order_item_id, alert_id: `A-${l.order_item_id}` })) });

  it('[04 §8] the rounds are frozen at open: a frame dropping a cancelled round mid-sequence keeps "Round 1 cancelled"; a round placed meanwhile is not shown or sent', async () => {
    let calls = 0;
    const s = sheet([{ n: 1, order: r1() }, { n: 2, order: r2() }], {
      command: async (type, payload) => (++calls === 2 || calls === 3 ? apiError('COMP_PENDING', { alert_id: 'C' }) : pend(type, payload)),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    // the table view's next read drops round 1 (cancelled) and adds round 3
    s.m.render(s.node([{ n: 2, order: r2() }, { n: 3, order: r3() }]));
    await flush();
    expect([...s.dlg().querySelectorAll('.vround')].map((r) => r.getAttribute('data-round'))).toEqual(['2']);
    expect(s.dlg().querySelector('.ac__who')?.textContent).toBe("Round 2 · removes what the kitchen hasn't started, voids the rest");
    expect(s.query.mock.calls.some((c) => (c[0] as string).includes('order_id=O3'))).toBe(false);
    // a second failure still names the round cancelled before the frame
    s.m.click(s.primary());
    await flush(8);
    expect([...s.dlg().querySelectorAll('.msg')].map((x) => x.textContent)[0]).toBe('Round 1 cancelled');
    s.m.click(s.primary());
    await flush(8);
    expect(s.sent()).toEqual(['VoidItems:O1', 'VoidItems:O2', 'VoidItems:O2', 'VoidItems:O2']);
    expect(s.shell.toasts.current()?.text).toBe('Voids asked');
  });

  it('[04 §8, V12] Other is offered per line; one note box for the Other lines, sent on each VoidItems that has an Other line', async () => {
    const s = sheet([{ n: 1, order: r1() }, { n: 2, order: r2() }], { command: pend });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    const sel = s.dlg().querySelector<HTMLSelectElement>('.vrow[data-line="K1"] select')!;
    act(() => {
      sel.value = 'other';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const box = s.dlg().querySelector<HTMLInputElement>('[data-note="disposition"] input')!;
    expect(box).not.toBeNull();
    expect(s.primary().textContent).toBe(t('void.write_why_first'));
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'given to the guard');
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    s.m.click(s.primary());
    await flush(8);
    const payloads = s.command.mock.calls.map((c) => c[1] as { order_id: string; disposition_note: string | null; lines: Array<{ disposition: string }> });
    expect(payloads.map((p) => [p.order_id, p.disposition_note, p.lines[0]!.disposition])).toEqual([
      ['O1', 'given to the guard', 'other'],
      ['O2', null, 'moved'],
    ]);
  });

  it('[04 §8] a double tap in one batch sends the plan once', async () => {
    const s = sheet([{ n: 1, order: r1() }], { command: pend });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    act(() => {
      s.primary().click();
      s.primary().click();
    });
    await flush(8);
    expect(s.sent()).toEqual(['VoidItems:O1']);
  });

  it('[04 §6.1, §6.3] a round over 40 lines is read and sent in parts of 40: nothing is left uncancelled', async () => {
    const many = dineIn(
      Array.from({ length: 41 }, (_, i) => sline(`X${i}`, { order_id: 'O1', name: `Item ${i}`, stage: 'done' })),
      { order_id: 'O1' },
    );
    const s = sheet([{ n: 1, order: many }], { command: pend });
    await flush();
    expect(s.query.mock.calls.map((c) => (c[0] as string).split('order_item_ids=')[1]!.split(',').length)).toEqual([40, 1]);
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(8);
    expect(s.command.mock.calls.map((c) => (c[1] as { lines: unknown[] }).lines.length)).toEqual([40, 1]);
    expect(s.shell.toasts.current()).toEqual({ text: 'Voids asked', sub: '0 removed · 0 voided · 41 waiting for approval' });
  });

  it('[04 §8] the subtitle lists the rounds with the list keys ("Round 1 and Round 2"; Urdu ،)', async () => {
    const s = sheet([{ n: 1, order: r1() }, { n: 2, order: r2() }, { n: 3, order: r3() }]);
    await flush();
    expect(s.dlg().querySelector('.ac__who')?.textContent).toBe("Round 1, Round 2 and Round 3 · removes what the kitchen hasn't started, voids the rest");
    s.m.unmount();
    setLanguage('ur');
    const u = sheet([{ n: 1, order: r1() }, { n: 2, order: r2() }, { n: 3, order: r3() }]);
    await flush();
    expect(u.dlg().querySelector('.ac__who')?.textContent).toContain('، ');
    expect(u.dlg().querySelector('.ac__who')?.textContent).toContain(' اور ');
  });
});

describe('04 §8 Cancel order — review #233', () => {
  it('[04 #59] the Remove amount includes the option children removed with the line; "· with" lists them with the list keys', async () => {
    const order = dineIn([
      sline('SK', { name: 'Seekh Kebab', stage: 'added', billed_minor: 140_000 }),
      sline('CH', { name: 'Chutney', line_kind: 'option_child', parent_order_item_id: 'SK', stage: null, billed_minor: 5_000 }),
      sline('RA', { name: 'Raita', line_kind: 'option_child', parent_order_item_id: 'SK', stage: null, billed_minor: 3_000 }),
    ]);
    const s = setup(order, { previews: () => [{ ...removeP('SK'), touched: [] }] });
    await flush();
    expect(s.dlg().querySelector('.vrow[data-line="SK"] .amt')?.textContent).toBe('Rs 1,480');
    expect(s.dlg().querySelector('.vsum strong')?.textContent).toBe('Rs 1,480');
  });

});

// 04 v1.0.5 §8 — review #233 round 2: line state across chunks, ordering across chunks, the newest-read guard,
// per-order read errors, and a cancelled order beside a voided one.
describe('04 v1.0.5 §8 Cancel table — review #233 round 2', () => {
  function sheet(rounds: CancelRound[], o: { mode?: 'order' | 'table'; perms?: NonNullable<Parameters<typeof voidShell>[0]>['perms']; query?: (path: string) => Promise<unknown>; command?: CommandFn } = {}) {
    const s = voidShell({ ...(o.perms === undefined ? {} : { perms: o.perms }), ...(o.query === undefined ? {} : { query: o.query }), ...(o.command === undefined ? {} : { command: o.command }) });
    let done = 0;
    const m = mount();
    current = m;
    m.render(
      <ShellContext.Provider value={s.shell as Shell}>
        <CancelOrderSheet rounds={rounds} mode={o.mode ?? 'table'} onClose={() => {}} onDone={() => (done += 1)} onChanged={() => {}} />
      </ShellContext.Provider>,
    );
    const dlg = () => m.container.querySelector<HTMLElement>('.dlg--all')!;
    const primary = () => dlg().querySelector<HTMLElement>('.acts .btn:last-child')!;
    const sent = () => s.command.mock.calls.map((c) => `${c[0]}:${(c[1] as { order_id: string }).order_id}:${(c[1] as { lines: unknown[] }).lines.length}`);
    const ids = () => s.command.mock.calls.map((c) => (c[2] as { commandId: string }).commandId);
    return { ...s, m, dlg, primary, sent, ids, done: () => done };
  }
  const idsOf = (path: string) => new URL(path, 'http://h').searchParams.get('order_item_ids')!.split(',');
  const orderOf = (path: string) => new URL(path, 'http://h').searchParams.get('order_id')!;

  it('[04 §6.1 BLOCKER] direct path, 41 lines: chunk 1 voids 40, chunk 2 fails; the reload and the retry ask for and send only the 1 line left (new id); the sheet ends cancelled', async () => {
    const many = dineIn(Array.from({ length: 41 }, (_, i) => sline(`X${i}`, { order_id: 'O1', name: `Item ${i}`, stage: 'done' })), { order_id: 'O1' });
    // a stateful hub: a voided line has 0 live units, and a preview of it is refused (plan.ts: 1 ≤ units ≤ live)
    const voided = new Set<string>();
    let voids = 0;
    const s = sheet([{ n: 1, order: many }], {
      mode: 'order',
      perms: ALLOWED,
      query: async (path) => {
        const asked = idsOf(path);
        if (asked.some((id) => voided.has(id))) return apiError('VALIDATION_FAILED', { issues: [{ path: 'units', message: 'units' }] }, 400);
        return ok({ previews: asked.map((id) => preview(id, { needs_approval: false })) });
      },
      command: async (_type, payload) => {
        voids += 1;
        if (voids === 2) return apiError('VOID_PENDING', { alert_id: 'AX', order_item_id: 'X40' });
        const lines = (payload as { lines: Array<{ order_item_id: string }> }).lines;
        for (const l of lines) voided.add(l.order_item_id);
        return ok({ voided: lines.map((l) => ({ order_item_id: l.order_item_id, units: 1, refund_minor: 100, comp_voided_minor: 0, disposition: 'moved' })), cancelled: voids === 3 });
      },
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(10);
    expect(s.sent()).toEqual(['VoidItems:O1:40', 'VoidItems:O1:1']);
    // the reload asked only for the line still live: no 400, the round shows its one line
    expect(s.query.mock.calls.slice(2).every((c) => idsOf(c[0] as string).every((id) => id === 'X40'))).toBe(true);
    expect(s.dlg().querySelectorAll('.vgroup[data-group="void"] .vrow')).toHaveLength(1);
    expect(s.primary().textContent).toBe('Try again · void 1');
    s.m.click(s.primary());
    await flush(10);
    expect(s.sent()).toEqual(['VoidItems:O1:40', 'VoidItems:O1:1', 'VoidItems:O1:1']);
    expect((s.command.mock.calls[2]![1] as { lines: Array<{ order_item_id: string }> }).lines).toEqual([{ order_item_id: 'X40', disposition: 'moved' }]);
    expect(s.ids()[2]).not.toBe(s.ids()[1]);
    expect(s.shell.toasts.current()?.text).toBe(t('void.toast.cancelled'));
    expect(s.done()).toBe(1);
  });

  it('[04 v1.0.5 §8] every RemoveItems chunk of every round goes out before any VoidItems (round 1: 41 Remove lines; round 2: a void)', async () => {
    const r1 = dineIn(Array.from({ length: 41 }, (_, i) => sline(`R${i}`, { order_id: 'O1', name: `Seekh ${i}`, stage: 'added' })), { order_id: 'O1' });
    const r2 = dineIn([sline('K2', { order_id: 'O2', name: 'Karahi', stage: 'done' })], { order_id: 'O2' });
    const s = sheet([{ n: 1, order: r1 }, { n: 2, order: r2 }], {
      query: async (path) => ok({ previews: idsOf(path).map((id) => (orderOf(path) === 'O1' ? removeP(id) : preview(id))) }),
      command: async (type, payload) =>
        type === 'RemoveItems'
          ? ok({ removed: (payload as { lines: Array<{ order_item_id: string }> }).lines.map((l) => ({ order_item_id: l.order_item_id, units: 1 })), cancelled: false })
          : ok({ pending: [{ order_item_id: 'K2', alert_id: 'A' }] }),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(10);
    expect(s.sent()).toEqual(['RemoveItems:O1:40', 'RemoveItems:O1:1', 'VoidItems:O2:1']);
  });

  it('[04 §8 IR-6] an older preview read that lands after a newer one is dropped', async () => {
    const r1 = dineIn([sline('K1', { order_id: 'O1', name: 'Karahi', stage: 'done' })], { order_id: 'O1' });
    const r2 = dineIn([sline('K2', { order_id: 'O2', name: 'Karahi 2', stage: 'added' }), sline('L2', { order_id: 'O2', name: 'Lassi', stage: 'done' })], { order_id: 'O2' });
    let o2 = 0;
    let releaseStale: (() => void) | null = null;
    const s = sheet([{ n: 1, order: r1 }, { n: 2, order: r2 }], {
      query: async (path) => {
        if (orderOf(path) === 'O1') return ok({ previews: [preview('K1')] });
        o2 += 1;
        if (o2 === 1) return ok({ previews: [removeP('K2'), preview('L2')] });
        if (o2 === 2) {
          // the read started after round 2's RemoveItems: it answers last, with what the hub held before the reload
          await new Promise<void>((r) => (releaseStale = r));
          return ok({ previews: [preview('L2'), preview('STALE')] });
        }
        return ok({ previews: [preview('L2')] });
      },
      command: async (type) => (type === 'RemoveItems' ? ok({ removed: [{ order_item_id: 'K2', units: 1 }], cancelled: false }) : apiError('COMP_PENDING', { alert_id: 'C' })),
    });
    await flush();
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(10);
    // round 1's VoidItems failed: the reload of round 2 (read 3) answered first
    expect(o2).toBe(3);
    expect(s.dlg().querySelector('.vround[data-round="2"] .vrow[data-line="L2"]')).not.toBeNull();
    releaseStale!();
    await flush(10);
    expect(s.dlg().querySelector('[data-line="STALE"]')).toBeNull();
  });

  it('[04 §8] a failed read is per order: round 1 shows its error and Try again, round 2 its rows; Try again reads round 1 only', async () => {
    const r1 = dineIn([sline('K1', { order_id: 'O1', name: 'Karahi', stage: 'done' })], { order_id: 'O1' });
    const r2 = dineIn([sline('L2', { order_id: 'O2', name: 'Lassi', stage: 'done' })], { order_id: 'O2' });
    let o1 = 0;
    const s = sheet([{ n: 1, order: r1 }, { n: 2, order: r2 }], {
      query: async (path) => {
        if (orderOf(path) === 'O1' && ++o1 === 1) return { ok: false as const, error: { kind: 'network' as const } };
        return ok({ previews: idsOf(path).map((id) => preview(id)) });
      },
    });
    await flush();
    const round1 = s.dlg().querySelector('.vround[data-round="1"]')!;
    expect(round1.querySelector('.msg')?.textContent).toContain(t('answer.error.offline'));
    expect(s.dlg().querySelector('.vround[data-round="2"] .vrow[data-line="L2"]')).not.toBeNull();
    expect(s.primary().getAttribute('aria-disabled')).toBe('true');
    s.m.click(round1.querySelector('[data-retry="O1"]'));
    await flush();
    expect(s.query.mock.calls.map((c) => orderOf(c[0] as string))).toEqual(['O1', 'O2', 'O1']);
    expect(s.dlg().querySelector('.vround[data-round="1"] .vrow[data-line="K1"]')).not.toBeNull();
    expect(s.dlg().querySelector('.vround[data-round="1"] .msg')).toBeNull();
  });

  it('[04 #59] a remake line takes its preview\'s group; a RemoveItems that cancels its order ends that order, and the other round\'s VoidItems still goes', async () => {
    const r1 = dineIn([sline('KR', { order_id: 'O1', name: 'Karahi', stage: 'added' }), sline('RM', { order_id: 'O1', name: 'Karahi (remake)', stage: 'added', return_of: 'KX', billed_minor: 0 })], { order_id: 'O1' });
    const r2 = dineIn([sline('L2', { order_id: 'O2', name: 'Lassi', stage: 'done' })], { order_id: 'O2' });
    const s = sheet([{ n: 1, order: r1 }, { n: 2, order: r2 }], {
      query: async (path) => ok({ previews: orderOf(path) === 'O1' ? [removeP('KR'), removeP('RM')] : [preview('L2')] }),
      command: async (type) =>
        type === 'RemoveItems' ? ok({ removed: [{ order_item_id: 'KR', units: 1 }, { order_item_id: 'RM', units: 1 }], cancelled: true }) : ok({ pending: [{ order_item_id: 'L2', alert_id: 'A' }] }),
    });
    await flush();
    expect([...s.dlg().querySelectorAll('.vround[data-round="1"] .vgroup[data-group="remove"] .vrow')].map((r) => r.getAttribute('data-line'))).toEqual(['KR', 'RM']);
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()));
    s.m.click(s.primary());
    await flush(10);
    expect(s.sent()).toEqual(['RemoveItems:O1:2', 'VoidItems:O2:1']);
    expect(s.shell.toasts.current()).toEqual({ text: 'Voids asked', sub: '2 removed · 0 voided · 1 waiting for approval' });
    expect(s.done()).toBe(1);
  });
});
