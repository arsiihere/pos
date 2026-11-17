import { UNDO_DONE_MS } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { ShellContext, type Shell } from '../../staff/shell/hooks';
import { createLiveBus } from '../../staff/shell/live';
import type { PointLine, PointStation, PointViewBody } from '../contracts';
import { passLiveOf } from '../live';
import { PassScreen } from '../PassScreen';

// 03b v1.0.8 §3.2, §3.4 (Q-45; P3, frame 03b-C10–C13 / B13 PassCards): a station without a kitchen screen
// (`stations[].screenless`, HK2) is run from the Pass: Start / Done on its waiting lines, Done on its cooking lines,
// Undo for 30 s after this tablet's Done. The Pass does not know whether a line fired: Start on an unfired line →
// 409 ITEM_WRONG_STAGE { stage: 'added' } → "Not due yet" (brief Q-12). Lines of stations with a screen get nothing.

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
  } as unknown as Shell;
  // the page creates its Pass live before the socket's first catch-up (W0.6, IR-17b)
  passLiveOf(shell);
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: view } });
  return { shell, live, sent, at: (ms: number) => (now = ms) };
}
const wrongStage = (stage: string): HubResult<never> => ({ ok: false, error: { kind: 'api', status: 409, code: 'ITEM_WRONG_STAGE', details: { stage } } });

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
const actsOf = (id: string) => [...(m.container.querySelector(`.pl[data-id="${id}"] .pl__a`)?.querySelectorAll('button') ?? [])].map((b) => b.textContent);

describe('[03b Q-45] screenless lines on the Pass', () => {
  it('[03b Q-45] Start / Done (and Undo) only on lines of screenless stations; "Not due yet" for a line not fired', async () => {
    const view: PointViewBody = {
      point_id: 'PT',
      stations: [st('COLD', true), st('TANDOOR', false), st('KARAHI')],
      takeovers: [],
      orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T3' }, placed_at: 0, ready: null, lines: [line('SALAD', 'COLD', 'added'), line('NAAN', 'TANDOOR', 'added'), line('KARAHI', 'KARAHI', 'added')] }],
    };
    const s = shellWith(view, {
      StartItem: [wrongStage('added'), { ok: true, data: { started: ['SALAD'] } }],
      DoneItem: [{ ok: true, data: { done: ['SALAD'] } }],
      UndoDone: [{ ok: false, error: { kind: 'api', status: 409, code: 'ITEM_UNDO_WINDOW_CLOSED', details: {} } }],
    });
    show(s);
    expect(actsOf('SALAD')).toEqual(['Start', 'Done']);
    expect(actsOf('NAAN')).toEqual([]);
    expect(actsOf('KARAHI')).toEqual([]); // no screenless flag (before HK2): nothing
    m.click(m.button('Start'));
    await flush();
    expect(s.sent[0]).toMatchObject({ type: 'StartItem', payload: { order_item_id: 'SALAD' } });
    expect(m.container.querySelector('.pc__msg.c-warn')?.textContent).toBe('Not due yet');

    // fired now: Start → the ItemStarted frame → Done only
    m.click(m.button('Start'));
    await flush();
    s.live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'SALAD' } } });
    await flush();
    expect(actsOf('SALAD')).toEqual(['Done']);
    expect(m.container.querySelector('.pl[data-id="SALAD"] .pl__a')?.className).toBe('pl__a pl__a--1');
    expect(m.container.querySelector('.pc__msg')).toBeNull();

    // Done → frame → Undo with the time left; after the window the hub refuses → "Too late to undo"
    m.click(m.button('Done'));
    await flush();
    s.live.frame({ type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'SALAD' } } });
    await flush();
    expect(actsOf('SALAD')).toEqual(['Undo 0:30']);
    m.click(m.button('Undo'));
    await flush();
    expect(s.sent.map((c) => c.type)).toEqual(['StartItem', 'StartItem', 'DoneItem', 'UndoDone']);
    expect(m.container.querySelector('.pc__msg.c-danger')?.textContent).toBe('Too late to undo');
    s.at(1_000_000 + UNDO_DONE_MS + 1);
    show(s);
    expect(actsOf('SALAD')).toEqual([]);
  });

  it('[03b §3.2] Done early → 422 ITEM_DONE_CONFIRM_REQUIRED → inline line, the next Done sends confirm; a lost reply keeps its command_id', async () => {
    const view: PointViewBody = {
      point_id: 'PT',
      stations: [st('COLD', true)],
      takeovers: [],
      orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T3' }, placed_at: 0, ready: null, lines: [line('SALAD', 'COLD', 'cooking')] }],
    };
    const s = shellWith(view, {
      DoneItem: [
        { ok: false, error: { kind: 'api', status: 422, code: 'ITEM_DONE_CONFIRM_REQUIRED', details: { elapsed_ms: 60_000, cook_ms: 300_000 } } },
        { ok: false, error: { kind: 'network' } },
        { ok: true, data: { done: ['SALAD'] } },
      ],
    });
    show(s);
    m.click(m.button('Done'));
    await flush();
    expect(m.container.querySelector('.pc__msg.c-warn')?.textContent).toBe('Done already? 1:00 of 5:00 — tap again');
    m.click(m.button('Done'));
    await flush();
    m.click(m.button('Done'));
    await flush();
    expect(s.sent.map((c) => [c.payload, c.commandId === s.sent[1]!.commandId])).toEqual([
      [{ order_item_id: 'SALAD' }, false],
      [{ order_item_id: 'SALAD', confirm: true }, true],
      [{ order_item_id: 'SALAD', confirm: true }, true],
    ]);
  });

  it('[03b §3.2] a double tap on Done sends once; a 403 (run-pass taken away) shows the read-only line', async () => {
    const view: PointViewBody = {
      point_id: 'PT',
      stations: [st('COLD', true)],
      takeovers: [],
      orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T3' }, placed_at: 0, ready: null, lines: [line('SALAD', 'COLD', 'cooking')] }],
    };
    let release: (r: HubResult<unknown>) => void = () => undefined;
    const s = shellWith(view, {});
    const command = s.shell.api.command;
    (s.shell.api as unknown as { command: unknown }).command = (type: string, payload: unknown, opts: { commandId?: string }) => {
      void command(type, payload, opts);
      return new Promise((resolve) => (release = resolve));
    };
    show(s);
    m.click(m.button('Done'));
    m.click(m.button('Done'));
    await flush();
    expect(s.sent).toHaveLength(1);
    release({ ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: {} } });
    await flush();
    expect(m.container.querySelector('.pc__msg.c-danger')?.textContent).toBe('You can see the Pass but not run it. Ask a manager.');
  });
});
