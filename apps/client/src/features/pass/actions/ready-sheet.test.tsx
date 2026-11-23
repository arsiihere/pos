import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { ShellContext, type Shell } from '../../staff/shell/hooks';
import { createLiveBus } from '../../staff/shell/live';
import type { PointLine, PointStation, PointViewBody } from '../contracts';
import { passLiveOf } from '../live';
import { PassScreen } from '../PassScreen';

// 03b v1.0.10 §3.4 (STAB-2, test #82): Ready to serve. Every pending line done → one tap, MarkReadyToServe with no
// order_item_ids; else the pick sheet: the pending lines with their state, done ones ticked; ticking an uncooked line
// shows the warning; confirm sends the ticked ids; Cancel sends nothing. Pending = not handed over and not in the open
// Ready (`ready.lines`), so a second press offers only the lines that finished later.

function line(id: string, station_id: string, stage: PointLine['stage']): PointLine {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id,
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T3' },
    order_type: 'dine_in',
    item_name: id,
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 1,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    stage,
    handed_over: false,
  };
}
const st = (station_id: string, screenless?: boolean): PointStation => ({
  station_id,
  name: station_id,
  lanes: { lanes_on: 1, lane_count: 1 },
  dark: false,
  ...(screenless === undefined ? {} : { screenless }),
});

function shellWith(view: PointViewBody, answers: Record<string, Array<HubResult<unknown>>>) {
  const live = createLiveBus();
  const sent: Array<{ type: string; payload: unknown; commandId?: string }> = [];
  let now = 1_000_000;
  const shell = {
    live,
    clock: { nowMs: () => now, utcOffsetMs: 0 },
    api: {
      roster: () => new Promise(() => undefined),
      command: (type: string, payload: unknown, opts: { commandId?: string } = {}) => {
        sent.push({ type, payload, ...(opts.commandId === undefined ? {} : { commandId: opts.commandId }) });
        return Promise.resolve(answers[type]?.shift() ?? { ok: false, error: { kind: 'network' } });
      },
      query: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
    },
    permissions: { allowed: (p: string) => p === 'run-pass' },
    toasts: { show: () => undefined },
    online: true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Asif' },
    device: { token: 'DEV', id: 'D-P1', type: 'tablet' },
  } as unknown as Shell;
  // the page creates its Pass live before the socket's first catch-up (W0.6, IR-17b)
  passLiveOf(shell);
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: view } });
  return { shell, live, sent, at: (ms: number) => (now = ms) };
}

let m: Mounted;
afterEach(() => m?.unmount());

function show(s: ReturnType<typeof shellWith>) {
  m = mount();
  m.render(
    <ShellContext.Provider value={s.shell}>
      <PassScreen />
    </ShellContext.Provider>,
  );
}

const ok = (data: unknown): HubResult<unknown> => ({ ok: true, data });
const order = (lines: PointLine[], ready: PointViewBody['orders'][number]['ready'] = null): PointViewBody => ({
  point_id: 'PT',
  stations: [st('TANDOOR', false), st('COLD', true)],
  takeovers: [],
  orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T3' }, placed_at: 0, ready, lines }],
});
const dialog = () => m.container.querySelector('[role="dialog"]');
const box = (id: string) => m.container.querySelector<HTMLInputElement>(`[role="dialog"] input[name="${id}"]`)!;

describe('[03b v1.0.10 #82] Ready to serve on the Pass', () => {
  it('[03b #82] every line done → one tap sends MarkReadyToServe with no ids and opens no sheet', async () => {
    const s = shellWith(order([line('NAAN', 'TANDOOR', 'done'), line('SALAD', 'COLD', 'done')]), { MarkReadyToServe: [ok({ alert_id: 'A1' })] });
    show(s);
    m.click(m.button('Ready to serve'));
    await flush();
    expect(dialog()).toBeNull();
    expect(s.sent).toEqual([expect.objectContaining({ type: 'MarkReadyToServe', payload: { order_id: 'O1', point_id: 'PT' } })]);
  });

  it('[03b #82] a cooking and a waiting line → the pick sheet: done ticked, others not; ticking one shows the warning; confirm sends the ticked ids; Cancel sends nothing', async () => {
    const s = shellWith(order([line('NAAN', 'TANDOOR', 'done'), line('KEBAB', 'TANDOOR', 'cooking'), line('RAITA', 'COLD', 'added')]), {
      MarkReadyToServe: [ok({ alert_id: 'A1', forced: ['KEBAB'] })],
    });
    show(s);
    m.click(m.button('Ready to serve'));
    await flush();
    expect(dialog()).not.toBeNull();
    expect(s.sent).toEqual([]);
    expect([box('NAAN').checked, box('KEBAB').checked, box('RAITA').checked]).toEqual([true, false, false]);
    expect(dialog()!.textContent).toContain('cooking');
    expect(dialog()!.textContent).toContain('waiting');
    expect(dialog()!.querySelector('.msg.c-warn')).toBeNull();
    expect(m.button('Ready to serve (1)', dialog()!)).toBeTruthy();

    m.click(m.button('Cancel', dialog()!));
    await flush();
    expect(dialog()).toBeNull();
    expect(s.sent).toEqual([]);

    m.click(m.button('Ready to serve'));
    await flush();
    m.click(box('KEBAB'));
    await flush();
    expect(dialog()!.querySelector('.msg.c-warn')?.textContent).toContain('KEBAB');
    m.click(m.button('Ready to serve (2)', dialog()!));
    await flush();
    expect(s.sent).toEqual([expect.objectContaining({ type: 'MarkReadyToServe', payload: { order_id: 'O1', point_id: 'PT', order_item_ids: ['NAAN', 'KEBAB'] } })]);
    expect(dialog()).toBeNull();
  });

  it('[03b #82] nothing ticked → confirm is off; an open Ready keeps the button for lines not in it, and a second press offers only those', async () => {
    const s = shellWith(order([line('NAAN', 'TANDOOR', 'done'), line('KEBAB', 'TANDOOR', 'cooking')], { at: 999_000, by: null, lines: ['NAAN'] }), {});
    show(s);
    m.click(m.button('Ready to serve'));
    await flush();
    expect(box('NAAN')).toBeNull();
    expect(box('KEBAB').checked).toBe(false);
    expect((m.button('Ready to serve (0)', dialog()!) as HTMLButtonElement).disabled).toBe(true);
  });
});
