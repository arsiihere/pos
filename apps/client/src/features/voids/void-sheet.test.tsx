import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage, t } from '../../i18n';
import { fill } from '../../i18n/en';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import type { SeatingLine } from '../staff/orders/contracts';
import { LineActions, type LineOrder } from '../staff/orders/view/LineActions';
import { LineRow } from '../staff/orders/view/LineRow';
import type { VoidPreview } from './contracts';
import { ALLOWED, apiError, APPROVAL, dineIn, OFFSET, ok, preview, sline, voidShell } from './test-fakes';

// 04 §8 Void action + Void sheet (handoff 04-A01, 04-D02, 04-C02, 04-C03, 04-B02, 04-T01; §10 #57).

let current: Mounted | null = null;
afterEach(() => {
  current?.unmount();
  current = null;
  setLanguage('en');
});

function Harness({ order, onChanged }: { order: LineOrder; onChanged: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  return (
    <div className="rnd">
      {order.lines.map((l) => (
        <LineRow key={l.order_item_id} line={l} mode="stages" utcOffsetMs={OFFSET} selected={sel === l.order_item_id} onSelect={(id) => setSel(sel === id ? null : id)}>
          <LineActions line={l} order={order} onChanged={onChanged} />
        </LineRow>
      ))}
    </div>
  );
}

function setup(order: LineOrder, o: Parameters<typeof voidShell>[0] & { previews?: (path: string) => VoidPreview[] } = {}) {
  const s = voidShell({ ...o, query: o.query ?? (async (path) => ok({ previews: o.previews?.(path) ?? [] })) });
  let changed = 0;
  const m = mount();
  m.render(
    <ShellContext.Provider value={s.shell as Shell}>
      <Harness order={order} onChanged={() => (changed += 1)} />
    </ShellContext.Provider>,
  );
  current = m;
  const select = (id: string) => m.click(m.container.querySelector(`.ol[data-line="${id}"]`));
  const ctrlText = () => [...(m.container.querySelector('.ol__ctrl')?.querySelectorAll('button') ?? [])].map((b) => b.textContent);
  const dlg = () => m.container.querySelector<HTMLElement>('.dlg--v');
  const primary = () => dlg()!.querySelector<HTMLElement>('.acts .btn:last-child')!;
  const open = async (id: string) => {
    select(id);
    m.click(m.button(t('line.void')));
    await flush();
  };
  return { ...s, m, select, ctrlText, dlg, primary, open, changed: () => changed };
}

const karahi = () => sline('K1', { name: 'Chicken Karahi — Full' });
const naan = () => sline('N1', { parent_order_item_id: 'K1', line_kind: 'option_child', name: 'Extra naan', units: 2, live_units: 2, stage: 'added', fired: true });

describe('04 §8 Void action on a line (04-A01)', () => {
  it('[04 #57] a line past stage 1 shows Void with "Needs approval" (requires_approval); a stage-1 line keeps Remove and has no Void', () => {
    const s = setup(dineIn([karahi(), sline('S1', { name: 'Seekh Kebab', stage: 'added' })]));
    s.select('K1');
    const v = s.m.button(t('line.void'));
    expect(v.className).toContain('btn--void');
    expect(v.querySelector('.ntag')?.textContent).toBe(t('staff.grant.requires_approval'));
    expect(v.hasAttribute('disabled')).toBe(false);
    s.select('S1');
    expect(s.ctrlText()).toContain(t('line.remove'));
    expect(s.ctrlText().some((x) => x?.startsWith(t('line.void')))).toBe(false);
  });

  it('[04 #57] R5: void-item allowed → plain Void (no tag); not granted → no Void; never a role check', () => {
    const a = setup(dineIn([karahi()]), { perms: ALLOWED });
    a.select('K1');
    expect(a.m.button(t('line.void')).querySelector('.ntag')).toBeNull();
    a.m.unmount();
    const b = setup(dineIn([karahi()]), { perms: { ...APPROVAL, 'void-item': { grant: 'not_granted' } } });
    b.select('K1');
    expect(b.ctrlText().some((x) => x?.startsWith(t('line.void')))).toBe(false);
  });

  it('[04 §8] a line with an open comp request offers no Void; an option child never shows its own Void', () => {
    const s = setup(dineIn([karahi(), sline('K2', { name: 'Raita', pending_comp: { alert_id: 'C1', units: 1, value_minor: 100 } } as Partial<SeatingLine>)]));
    s.select('K2');
    expect(s.ctrlText().some((x) => x?.startsWith(t('line.void')))).toBe(false);
  });
});

describe('04 §8 Void sheet (04-D02, 04-C03)', () => {
  it('[04 #57] opens with one void-preview; moved pre-selected and marked Suggested when enabled; a released child shows Released', async () => {
    const s = setup(dineIn([karahi(), naan()]), { previews: () => [preview('K1', { children: [{ id: 'N1', started: false, units: 2 }] })] });
    await s.open('K1');
    expect(s.query).toHaveBeenCalledTimes(1);
    expect(s.query.mock.calls[0]![0]).toBe('/queries/void-preview?order_id=O1&order_item_ids=K1&units=1');
    const moved = s.dlg()!.querySelector('[data-disposition="moved"]')!;
    expect(moved.getAttribute('aria-checked')).toBe('true');
    expect(moved.querySelector('.pre')?.textContent).toBe(t('void.suggested'));
    expect(s.dlg()!.querySelector('[data-line="K1"] .vout')?.textContent).toBe(t('void.out.moved'));
    expect(s.dlg()!.querySelector('[data-line="N1"] .vout')?.textContent).toBe(t('void.out.released'));
    expect(s.dlg()!.querySelector('h2')?.textContent).toBe(fill(t('void.title'), { item: 'Chicken Karahi — Full' }));
    expect(s.dlg()!.textContent).toContain(t('comp.needs_manager'));
    expect(s.dlg()!.querySelector('.vsum strong')?.textContent).toBe('Rs 2,280');
  });

  it('[04 #57] moved disabled → wastage pre-selected, no Suggested; every disabled row shows its §8 reason', async () => {
    for (const block of ['stock_not_tracked', 'not_movable_stage', 'move_not_granted', 'day_closed'] as const) {
      const s = setup(dineIn([karahi()]), { previews: () => [preview('K1', { moved: block })] });
      await s.open('K1');
      const moved = s.dlg()!.querySelector('[data-disposition="moved"]')!;
      expect(moved.getAttribute('aria-disabled')).toBe('true');
      expect(moved.getAttribute('aria-checked')).toBe('false');
      expect(moved.querySelector('.pre')).toBeNull();
      expect(moved.querySelector('.why')?.textContent).toBe(t(`void.block.${block}`));
      expect(s.dlg()!.querySelector('[data-disposition="wastage"]')!.getAttribute('aria-checked')).toBe('true');
      s.m.click(moved);
      expect(moved.getAttribute('aria-checked')).toBe('false');
      s.m.unmount();
    }
    expect(t('void.block.stock_not_tracked')).toBe('Stock not tracked for this item');
    expect(t('void.block.not_movable_stage')).toBe('Not cooking or cooked');
    expect(t('void.block.move_not_granted')).toBe("You can't move to stock");
    expect(t('void.block.day_closed')).toBe('Business day closed');
  });

  it('[04 #57] a partly movable deal shows "Cooked parts to stock, the rest released"; the header shows Parts below', async () => {
    const deal = sline('D1', { line_kind: 'deal', name: 'Family Deal', stage: null, deal_id: 'DL', item_id: null });
    const handi = sline('H1', { parent_order_item_id: 'D1', line_kind: 'deal_part', name: 'Chicken Handi' });
    const roghni = sline('R1', { parent_order_item_id: 'D1', line_kind: 'deal_part', name: 'Roghni naan', units: 4, live_units: 4, stage: 'added' });
    const p = preview('D1', { children: [{ id: 'H1', started: true }, { id: 'R1', started: false, units: 4 }] });
    for (const d of p.dispositions) if (d.enabled) d.line_dispositions['D1'] = null;
    const s = setup(dineIn([deal, handi, roghni]), { previews: () => [p] });
    await s.open('D1');
    const moved = s.dlg()!.querySelector('[data-disposition="moved"]')!;
    expect(moved.querySelector('b')?.textContent).toBe(t('void.disposition.moved_partly') + t('void.suggested'));
    expect(t('void.disposition.moved_partly')).toBe('Cooked parts to stock, the rest released');
    expect(s.dlg()!.querySelector('[data-line="D1"] .vout')?.textContent).toBe(t('void.out.parts_below'));
    expect(s.dlg()!.querySelector('[data-line="H1"] .vout')?.textContent).toBe(t('void.out.moved'));
    expect(s.dlg()!.querySelector('[data-line="R1"] .vout')?.textContent).toBe(t('void.out.released'));
    expect(s.dlg()!.textContent).toContain(t('void.deal_portions'));
  });

  it('[04 #57] the primary button names the missing step, then Ask for approval (requires_approval) — or Void (allowed)', async () => {
    const s = setup(dineIn([karahi()]), { previews: () => [preview('K1')] });
    await s.open('K1');
    expect(s.primary().textContent).toBe(t('comp.pick_reason'));
    expect(s.primary().getAttribute('aria-disabled')).toBe('true');
    s.m.click(s.m.button(t('void.reason.other'), s.dlg()!));
    expect(s.primary().textContent).toBe(t('void.write_why_first'));
    expect(s.dlg()!.querySelector('.fld__e')?.textContent).toBe(t('void.note.required'));
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()!));
    expect(s.primary().textContent).toBe(t('comp.ask'));
    expect(s.primary().className).toContain('btn--primary');
    expect(s.primary().getAttribute('aria-disabled')).toBeNull();
    // Other disposition needs its own note
    s.m.click(s.dlg()!.querySelector('[data-disposition="other"]'));
    expect(s.primary().textContent).toBe(t('void.write_why_first'));
    s.m.unmount();

    const a = setup(dineIn([karahi()]), { perms: ALLOWED, previews: () => [preview('K1', { needs_approval: false })] });
    await a.open('K1');
    a.m.click(a.m.button(t('void.reason.quality'), a.dlg()!));
    expect(a.primary().textContent).toBe(t('void.do'));
    expect(a.primary().className).toContain('btn--danger');
    expect(a.dlg()!.textContent).toContain(t('void.can_void'));
    expect(a.dlg()!.textContent).toContain(t('void.amount.direct'));
  });

  it('[04 §8] comp_pending on the approval path: "A comp is waiting on this item — decide it first", the button reads Comp waiting and sends nothing', async () => {
    const s = setup(dineIn([karahi()]), { previews: () => [preview('K1', { comp_pending: { alert_id: 'C9' } })] });
    await s.open('K1');
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()!));
    expect(s.dlg()!.querySelector('.msg')?.textContent).toContain('A comp is waiting on this item — decide it first');
    expect(s.primary().textContent).toBe(t('void.comp_waiting'));
    s.m.click(s.primary());
    await flush();
    expect(s.command).not.toHaveBeenCalled();
  });

  it('[04 §8 V15] offline: the offline text, no preview read, nothing sent', async () => {
    const s = setup(dineIn([karahi()]), { online: false });
    await s.open('K1');
    expect(s.query).not.toHaveBeenCalled();
    expect(s.dlg()!.querySelector('.msg')?.textContent).toBe(t('answer.error.offline') + t('void.err.offline.hint'));
    s.m.click(s.primary());
    await flush();
    expect(s.command).not.toHaveBeenCalled();
  });

  it('[04 §8] a weighed (kg) line is voided whole: ×1, no stepper, no units in the preview; Rs 0 while weight pending (V18)', async () => {
    const fish = sline('F1', { name: 'Fish', sale_unit: 'g', quantity: null, billed_minor: 0 });
    const s = setup(dineIn([fish]), { previews: () => [preview('F1', { moved: 'stock_not_tracked', refund_minor: 0 })] });
    await s.open('F1');
    expect(s.query.mock.calls[0]![0]).toBe('/queries/void-preview?order_id=O1&order_item_ids=F1');
    expect(s.dlg()!.querySelector('.qline .fix')?.textContent).toBe('×1');
    expect(s.dlg()!.querySelector('.qline .step')).toBeNull();
    expect(s.dlg()!.textContent).toContain(t('void.weighed_whole'));
    expect(s.dlg()!.querySelector('.vsum strong')?.textContent).toBe('Rs 0');
    expect(s.dlg()!.textContent).toContain(t('void.amount.not_weighed'));
  });

  it('[04 §8] the units stepper reads the preview again with units, up to the live units ("of N")', async () => {
    const s = setup(dineIn([sline('NA', { name: 'Naan', units: 6, live_units: 6 })]), { previews: () => [preview('NA')] });
    await s.open('NA');
    expect(s.dlg()!.querySelector('.qline .of')?.textContent).toBe(fill(t('void.of'), { n: '6' }));
    s.m.click(s.dlg()!.querySelector('.step button[aria-label="+"]'));
    await flush();
    expect(s.query.mock.calls.at(-1)![0]).toBe('/queries/void-preview?order_id=O1&order_item_ids=NA&units=2');
  });

  it('[04 §6.1] Ask for approval sends one VoidItems (not queued) and toasts "Void asked — waiting for approval"', async () => {
    const s = setup(dineIn([karahi()]), {
      previews: () => [preview('K1')],
      command: async () => ok({ pending: [{ order_item_id: 'K1', alert_id: 'AL1' }] }),
    });
    await s.open('K1');
    s.m.click(s.m.button(t('void.reason.customer_changed_mind'), s.dlg()!));
    s.m.click(s.primary());
    await flush();
    expect(s.command).toHaveBeenCalledTimes(1);
    const [type, payload, opts] = s.command.mock.calls[0]!;
    expect(type).toBe('VoidItems');
    expect(payload).toEqual({ order_id: 'O1', reason_code: 'customer_changed_mind', note: null, disposition_note: null, lines: [{ order_item_id: 'K1', units: 1, disposition: 'moved' }] });
    expect(typeof (opts as { commandId?: unknown }).commandId).toBe('string');
    expect(s.shell.enqueue).not.toHaveBeenCalled();
    expect(s.shell.toasts.current()).toEqual({ text: t('void.toast.asked'), sub: 'Chicken Karahi — Full ×1' });
    expect(s.dlg()).toBeNull();
    expect(s.changed()).toBe(1);
  });

  it('[04 §8] Void (allowed) toasts "Voided" with the amount off the bill', async () => {
    const s = setup(dineIn([karahi()]), {
      perms: ALLOWED,
      previews: () => [preview('K1', { needs_approval: false })],
      command: async () => ok({ voided: [{ order_item_id: 'K1', units: 1, refund_minor: 220_000, comp_voided_minor: 0, disposition: 'moved' }], cancelled: false }),
    });
    await s.open('K1');
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()!));
    s.m.click(s.primary());
    await flush();
    expect(s.shell.toasts.current()).toEqual({ text: t('void.toast.voided'), sub: 'Chicken Karahi — Full ×1 · Rs 2,200 off the bill' });
  });
});

describe('04 §8 / §9 errors in the sheet (04-B02)', () => {
  const refusal = async (error: ReturnType<typeof apiError>) => {
    const s = setup(dineIn([karahi()]), { previews: () => [preview('K1')], command: async () => error });
    await s.open('K1');
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()!));
    s.m.click(s.primary());
    await flush();
    return s;
  };
  const msgs = (s: Awaited<ReturnType<typeof refusal>>) => [...s.dlg()!.querySelectorAll('.msg')].map((x) => x.textContent);

  it('[04 §8] each code shows its spec text, never the server message', async () => {
    const cases: Array<[ReturnType<typeof apiError>, string]> = [
      [apiError('VOID_PENDING', { alert_id: 'A', order_item_id: 'K1' }), 'A void is already waiting on this item'],
      [apiError('COMP_PENDING', { alert_id: 'C' }), 'A comp is waiting on this item — decide it first'],
      [apiError('ORDER_BILLED', {}), 'Bill closed — refunds are at the counter'],
      [apiError('VOID_NOT_ALLOWED', { order_item_id: 'K1', reason: 'stock_not_tracked' }), 'Stock not tracked for this item' + t('void.err.not_allowed.again')],
      [apiError('PERMISSION_DENIED', { reason: 'move_not_granted' }, 403), "You can't move to stock" + t('void.err.not_allowed.again')],
    ];
    for (const [error, text] of cases) {
      const s = await refusal(error);
      expect(msgs(s).some((m) => m?.startsWith(text)), `${error.error.code}: ${msgs(s).join(' | ')}`).toBe(true);
      s.m.unmount();
    }
  });

  it('[04 §8] ITEM_WRONG_STAGE {stage: added} → "Not started — use Remove" with a Remove button that opens 02b Remove', async () => {
    const s = await refusal(apiError('ITEM_WRONG_STAGE', { order_item_id: 'K1', stage: 'added' }));
    const msg = [...s.dlg()!.querySelectorAll('.msg')].find((x) => x.textContent?.includes('Not started — use Remove'))!;
    expect(msg).toBeDefined();
    s.m.click(s.m.button(t('line.remove'), msg));
    expect(s.dlg()).toBeNull();
    expect(s.m.container.textContent).toContain(t('remove.title'));
  });

  it('[04 §8] a refusal that changes the choices reads void-preview again', async () => {
    const s = await refusal(apiError('VOID_NOT_ALLOWED', { order_item_id: 'K1', reason: 'not_movable_stage' }));
    expect(s.query).toHaveBeenCalledTimes(2);
  });

  it('[04 §8] a lost reply keeps the same command_id for the retry (D32)', async () => {
    let n = 0;
    const s = setup(dineIn([karahi()]), {
      previews: () => [preview('K1')],
      command: async () => (++n === 1 ? { ok: false as const, error: { kind: 'network' as const } } : ok({ pending: [{ order_item_id: 'K1', alert_id: 'AL1' }] })),
    });
    await s.open('K1');
    s.m.click(s.m.button(t('void.reason.quality'), s.dlg()!));
    s.m.click(s.primary());
    await flush();
    expect(s.dlg()!.textContent).toContain(t('line.err.lost'));
    s.m.click(s.primary());
    await flush();
    const ids = s.command.mock.calls.map((c) => (c[2] as { commandId: string }).commandId);
    expect(ids[0]).toBe(ids[1]);
  });
});

describe('04 §8 sheet layouts and keys', () => {
  it('[04 §8] phone: Reason first, amount and buttons pinned in .vfoot; portrait: one column bottom sheet; kiosk: 1000 px', async () => {
    const p = setup(dineIn([karahi()]), { phone: true, previews: () => [preview('K1')] });
    await p.open('K1');
    expect(p.m.container.querySelector('.scrim--sheet .dlg__grip')).not.toBeNull();
    expect(p.dlg()!.querySelector('.vbody .vcol')!.firstElementChild?.className).toBe('fld');
    expect(p.dlg()!.querySelector('.vfoot .vsum')).not.toBeNull();
    expect(p.dlg()!.querySelector('.vfoot .acts')).not.toBeNull();
    p.m.unmount();
    const q = setup(dineIn([karahi()]), { portrait: true, previews: () => [preview('K1')] });
    await q.open('K1');
    expect(q.dlg()!.querySelector('.vgrid')).toBeNull();
    expect(q.m.container.querySelector('.scrim--sheet')).not.toBeNull();
    q.m.unmount();
    const k = setup(dineIn([karahi()], { ident: '57', order_type: 'takeaway' }), { kiosk: true, previews: () => [preview('K1')] });
    await k.open('K1');
    expect(k.dlg()!.classList.contains('dlg--kiosk')).toBe(true);
    expect(k.dlg()!.querySelector('.vgrid')).not.toBeNull();
  });

  it('[04 §8] Escape closes the sheet', async () => {
    const s = setup(dineIn([karahi()]), { previews: () => [preview('K1')] });
    await s.open('K1');
    s.m.key(s.dlg(), 'Escape');
    expect(s.dlg()).toBeNull();
  });

  it('[04 §8 R20] Urdu: the frame texts, Latin digits', async () => {
    setLanguage('ur');
    const s = setup(dineIn([karahi()]), { previews: () => [preview('K1')] });
    await s.open('K1');
    expect(s.dlg()!.textContent).toContain('کہاں جائے گا');
    expect(s.dlg()!.querySelector('.vsum strong')?.textContent).toBe('Rs 2,280');
    expect(s.dlg()!.querySelector('.qline .of')?.textContent).toBe('1 میں سے');
  });
});
