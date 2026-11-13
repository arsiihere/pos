import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { ShellContext, type Shell } from '../../staff/shell/hooks';
import { createLiveBus } from '../../staff/shell/live';
import type { PassApi, PassReceiver, PointLine, PointOrder, PointViewBody } from '../contracts';
import { passLiveOf } from '../live';
import { PassScreen } from '../PassScreen';
import { HandOverSheet } from './HandOverSheet';

// 03b v1.0.8 §3.5, §6.8, §6.11 (P3, frames 03b-D01 PassHandOver / PassHandOverInvalid / PassHandOverNobody, 03b-B11
// PassHanded / PassHandedLeft): the receiver tiles (table team first) from `pass-receivers`; one tap = Handover of
// every done line here (max 40); 422 PASS_RECEIVER_INVALID reloads the list; `remaining > 0` keeps the card with
// "{n} handed to {name} · {k} left".

function line(id: string, stage: PointLine['stage'], over: Partial<PointLine> = {}): PointLine {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST-T',
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T4 + T5' },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 6,
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
    ...over,
  };
}
const order = (lines: PointLine[]): PointOrder => ({ order_id: 'O1', identifier: { kind: 'table', label: 'T4 + T5' }, placed_at: 0, lines, ready: null });
const rcv = (staff_id: string, name: string, table_team = false): PassReceiver => ({ staff_id, name, table_team });

function fakeApi(o: { receivers: Array<HubResult<{ receivers: PassReceiver[] }>>; handover: Array<HubResult<{ handover_id: string; served_card_alert_id: string; remaining: number }>> }) {
  const calls: string[] = [];
  const payloads: unknown[] = [];
  const api = {
    passReceivers: (order_id: string) => {
      calls.push(`receivers:${order_id}`);
      return Promise.resolve(o.receivers.shift() ?? { ok: false, error: { kind: 'network' } });
    },
    handover: (p: unknown) => {
      calls.push('handover');
      payloads.push(p);
      return Promise.resolve(o.handover.shift() ?? { ok: false, error: { kind: 'network' } });
    },
  } as unknown as PassApi;
  return { api, calls, payloads };
}

let m: Mounted;
afterEach(() => m?.unmount());

describe('[03b §3.5] Hand over sheet', () => {
  it('[03b §3.5] Hand over sheet lists pass-receivers, table team first; one tap = Handover', async () => {
    const f = fakeApi({
      receivers: [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali'), rcv('S-BILAL', 'Bilal', true), rcv('S-DANISH', 'Danish')] } }],
      handover: [{ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 0 } }],
    });
    const handed: unknown[] = [];
    let closed = 0;
    m = mount();
    m.render(
      <HandOverSheet
        order={order([line('A', 'done'), line('B', 'done', { units: 2, item_name: 'Raita' }), line('C', 'cooking', { item_name: 'Karahi' })])}
        pointId="PT"
        api={f.api}
        up
        onClose={() => (closed += 1)}
        onHanded={(r) => handed.push(r)}
        onGone={() => undefined}
      />,
    );
    await flush();
    expect(m.container.querySelector('[role="dialog"] h2')?.textContent).toBe('Who is taking it?');
    expect(m.container.querySelector('.tcode')?.textContent).toBe('T4 + T5');
    expect([...m.container.querySelectorAll('.hosum > span')].map((s) => s.textContent)).toEqual(['6 xNaan', '2 xRaita']);
    const tiles = [...m.container.querySelectorAll('.rcv')];
    expect(tiles.map((t) => [t.className, t.querySelector('b')?.textContent, t.querySelector('small')?.textContent ?? null])).toEqual([
      ['rcv team', 'Bilal', 'T4 + T5 team'],
      ['rcv', 'Ali', null],
      ['rcv', 'Danish', null],
    ]);
    m.click(tiles[0]!);
    m.click(tiles[1]!); // a second tap while the first is in flight does nothing
    await flush();
    expect(f.calls).toEqual(['receivers:O1', 'handover']);
    expect(f.payloads).toEqual([{ order_id: 'O1', point_id: 'PT', receiver_staff_id: 'S-BILAL' }]);
    expect(handed).toEqual([{ handover_id: 'H1', name: 'Bilal', n: 2, left: 0 }]);
    expect(closed).toBe(1);
  });

  it('[03b §3.5] 422 PASS_RECEIVER_INVALID → list reloaded, "pick someone else"', async () => {
    const f = fakeApi({
      receivers: [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali'), rcv('S-BILAL', 'Bilal')] } }, { ok: true, data: { receivers: [rcv('S-BILAL', 'Bilal')] } }],
      handover: [{ ok: false, error: { kind: 'api', status: 422, code: 'PASS_RECEIVER_INVALID', details: { receiver_staff_id: 'S-ALI' } } }],
    });
    m = mount();
    m.render(<HandOverSheet order={order([line('A', 'done')])} pointId="PT" api={f.api} up onClose={() => undefined} onHanded={() => undefined} onGone={() => undefined} />);
    await flush();
    m.click(m.button('Ali'));
    await flush();
    expect(f.calls).toEqual(['receivers:O1', 'handover', 'receivers:O1']);
    expect(m.container.querySelector('.msg.c-danger')?.textContent).toBe("Ali can't take this order now — pick someone else");
    expect([...m.container.querySelectorAll('.rcv b')].map((b) => b.textContent)).toEqual(['Bilal']);
  });

  it('[03b §3.5] nobody can take it → "Nobody signed in…" and Cancel only; a lost reply keeps the sheet with a line', async () => {
    const f = fakeApi({ receivers: [{ ok: true, data: { receivers: [] } }], handover: [] });
    m = mount();
    m.render(<HandOverSheet order={order([line('A', 'done')])} pointId="PT" api={f.api} up onClose={() => undefined} onHanded={() => undefined} onGone={() => undefined} />);
    await flush();
    expect(m.container.querySelector('.msg.c-warn')?.textContent).toBe('Nobody signed in can take this order. Ask a waiter to sign in.');
    expect(m.buttons().map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Close', 'Cancel']);
    m.unmount();

    const g = fakeApi({ receivers: [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali')] } }], handover: [{ ok: false, error: { kind: 'network' } }] });
    m = mount();
    m.render(<HandOverSheet order={order([line('A', 'done')])} pointId="PT" api={g.api} up onClose={() => undefined} onHanded={() => undefined} onGone={() => undefined} />);
    await flush();
    m.click(m.button('Ali'));
    await flush();
    expect(m.container.querySelector('.msg.c-danger')?.textContent).toBe('No connection to the hub — try again.');
    expect(m.container.querySelector('.rcv')).not.toBeNull();
  });
});

function shellWith(view: PointViewBody, answers: Record<string, Array<HubResult<unknown>>>) {
  const live = createLiveBus();
  const sent: Array<{ type: string; payload: unknown; commandId?: string }> = [];
  const toasts: string[] = [];
  const shell = {
    live,
    clock: { nowMs: () => 0, utcOffsetMs: 0 },
    api: {
      roster: () => new Promise(() => undefined),
      command: (type: string, payload: unknown, opts: { commandId?: string } = {}) => {
        sent.push({ type, payload, ...(opts.commandId === undefined ? {} : { commandId: opts.commandId }) });
        return Promise.resolve(answers[type]?.shift() ?? { ok: false, error: { kind: 'network' } });
      },
      query: (path: string) => Promise.resolve(answers[path]?.shift() ?? { ok: false, error: { kind: 'network' } }),
    },
    permissions: { allowed: (p: string) => p === 'run-pass' },
    toasts: { show: (t: { text: string }) => toasts.push(t.text) },
    online: true,
    portrait: false,
    me: { staff_id: 'S-ASIF', name: 'Asif' },
  } as unknown as Shell;
  // the page creates its Pass live before the socket's first catch-up (W0.6, IR-17b)
  passLiveOf(shell);
  live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: view } });
  return { shell, live, sent, toasts };
}

describe('[03b §3.5] Hand over on the Pass card', () => {
  it('[03b §3.5 B4-2] result remaining > 0 → "40 handed · 5 left" and the card stays', async () => {
    const lines = Array.from({ length: 45 }, (_, i) => line(`L${i}`, 'done', { units: 1 }));
    const view: PointViewBody = { point_id: 'PT', stations: [], takeovers: [], orders: [order(lines)] };
    const s = shellWith(view, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali')] } }],
      Handover: [{ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 5 } }],
    });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Ali'));
    await flush();
    // the Handover frame marks the 40 lines it took
    s.live.frame({
      type: 'event',
      seq: 5,
      event: { event_id: 'E5', event_type: 'Handover', schema_version: 1, payload: { handover_id: 'H1', order_id: 'O1', point_id: 'PT', receiver_staff_id: 'S-ALI', order_item_ids: lines.slice(0, 40).map((l) => l.order_item_id), alert_id: 'AL', ready_alert_closed: null } },
    });
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.container.querySelectorAll('article.pc')).toHaveLength(1);
    expect(m.container.querySelector('.pc__msg.c-info')?.textContent).toBe('40 handed to Ali · 5 left — tap Hand over again');
    expect(m.button('Hand over')).toBeTruthy();
    expect(s.toasts).toEqual([]);
  });

  it('[03b §3.5] Hand over shows only with a done line; all handed → toast "Handed to Bilal" and "… waiting for Served"', async () => {
    const view: PointViewBody = { point_id: 'PT', stations: [], takeovers: [], orders: [order([line('A', 'cooking')])] };
    const s = shellWith(view, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-B', 'Bilal', true)] } }],
      Handover: [{ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 0 } }],
    });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    expect(m.buttons().some((b) => b.textContent?.includes('Hand over'))).toBe(false);
    s.live.frame({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: 'A' } } });
    await flush();
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Bilal'));
    await flush();
    // the Handover made the Ready (no open Ready before it): same commit, ReadyToServe first, without an alert
    s.live.frame({ type: 'event', seq: 3, event: { event_id: 'E3r', event_type: 'ReadyToServe', schema_version: 1, payload: { order_id: 'O1', point_id: 'PT', order_item_ids: ['A'], table_id: null, alert_id: null } } });
    s.live.frame({
      type: 'event',
      seq: 4,
      event: { event_id: 'E3', event_type: 'Handover', schema_version: 1, payload: { handover_id: 'H1', order_id: 'O1', point_id: 'PT', receiver_staff_id: 'S-B', order_item_ids: ['A'], alert_id: 'AL', ready_alert_closed: null } },
    });
    await flush();
    expect(s.toasts).toEqual(['Handed to Bilal']);
    // Q-55: this tablet's person on the Ready its own Handover made
    expect(m.container.querySelector('.pc__rdy > span')?.textContent).toBe('Ready · 12:00 AM · Asif');
    expect(m.container.querySelector('.pc__msg.c-info')?.textContent).toBe('Handed to Bilal · waiting for Served');
    expect(m.buttons().some((b) => b.textContent?.includes('Hand over'))).toBe(false);
    expect(s.sent.map((c) => c.type)).toEqual(['Handover']);
    expect(s.sent[0]!.commandId).toBeTruthy();
  });

  it('[00 M19] a Handover whose reply was lost keeps its command_id across leaving and opening the Pass again', async () => {
    const view: PointViewBody = { point_id: 'PT', stations: [], takeovers: [], orders: [order([line('A', 'done')])] };
    const s = shellWith(view, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali')] } }, { ok: true, data: { receivers: [rcv('S-ALI', 'Ali')] } }],
      Handover: [{ ok: false, error: { kind: 'network' } }, { ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 0 } }],
    });
    const open = () => {
      m = mount();
      m.render(
        <ShellContext.Provider value={s.shell}>
          <PassScreen />
        </ShellContext.Provider>,
      );
    };
    open();
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Ali'));
    await flush();
    m.unmount();
    open();
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Ali'));
    await flush();
    expect(s.sent.map((c) => c.type)).toEqual(['Handover', 'Handover']);
    expect(s.sent[1]!.commandId).toBe(s.sent[0]!.commandId);
  });

  it('[03b IR-6] a newer Handover frame of another tablet wins over this tablet\'s older reply: 40 to Ali (5 left), then the 5 to Bilal → no "Ali" line', async () => {
    const lines = Array.from({ length: 45 }, (_, i) => line(`L${i}`, 'done', { units: 1 }));
    const view: PointViewBody = { point_id: 'PT', stations: [], takeovers: [], orders: [order(lines)] };
    const s = shellWith(view, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali')] } }],
      Handover: [{ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 5 } }],
    });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Ali'));
    await flush();
    const ho = (seq: number, handover_id: string, receiver: string, ids: string[]) =>
      s.live.frame({ type: 'event', seq, event: { event_id: `E${seq}`, event_type: 'Handover', schema_version: 1, payload: { handover_id, order_id: 'O1', point_id: 'PT', receiver_staff_id: receiver, order_item_ids: ids, alert_id: 'AL', ready_alert_closed: null } } });
    ho(5, 'H1', 'S-ALI', lines.slice(0, 40).map((l) => l.order_item_id));
    await flush();
    expect(m.container.querySelector('.pc__msg')?.textContent).toBe('40 handed to Ali · 5 left — tap Hand over again');
    // another tablet hands the rest to Bilal
    ho(6, 'H2', 'S-BILAL', lines.slice(40).map((l) => l.order_item_id));
    await flush();
    expect(m.container.querySelector('.pc__msg')).toBeNull();
  });

  it('[03b §3.5 B4-2] the "left" count follows the live lines, not the reply', async () => {
    const lines = Array.from({ length: 45 }, (_, i) => line(`L${i}`, 'done', { units: 1 }));
    const view: PointViewBody = { point_id: 'PT', stations: [], takeovers: [], orders: [order(lines)] };
    const s = shellWith(view, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-ALI', 'Ali')] } }],
      Handover: [{ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 5 } }],
    });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Ali'));
    await flush();
    s.live.frame({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'Handover', schema_version: 1, payload: { handover_id: 'H1', order_id: 'O1', point_id: 'PT', receiver_staff_id: 'S-ALI', order_item_ids: lines.slice(0, 40).map((l) => l.order_item_id), alert_id: 'AL', ready_alert_closed: null } } });
    // two of the 5 left are served by a waiter meanwhile
    s.live.frame({ type: 'event', seq: 6, event: { event_id: 'E6', event_type: 'ItemServed', schema_version: 1, payload: { order_item_ids: ['L40', 'L41'], source: 'tap' } } });
    await flush();
    expect(m.container.querySelector('.pc__msg')?.textContent).toBe('40 handed to Ali · 3 left — tap Hand over again');
  });

  it('[03b §3.5 B10] after a hand-over (here one that made the Ready) Undo ready is not offered', async () => {
    const s = shellWith({ point_id: 'PT', stations: [], takeovers: [], orders: [order([line('A', 'done'), line('B', 'cooking')])] }, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-B', 'Bilal', true)] } }],
      Handover: [{ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 0 } }],
    });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Bilal'));
    await flush();
    s.live.frame({ type: 'event', seq: 3, event: { event_id: 'E3r', event_type: 'ReadyToServe', schema_version: 1, payload: { order_id: 'O1', point_id: 'PT', order_item_ids: ['A', 'B'], table_id: null, alert_id: null } } });
    s.live.frame({ type: 'event', seq: 4, event: { event_id: 'E3', event_type: 'Handover', schema_version: 1, payload: { handover_id: 'H1', order_id: 'O1', point_id: 'PT', receiver_staff_id: 'S-B', order_item_ids: ['A'], alert_id: 'AL', ready_alert_closed: null } } });
    await flush();
    expect(m.container.querySelector('.pc__rdy')).not.toBeNull();
    expect(m.buttons().some((b) => b.textContent?.startsWith('Undo'))).toBe(false);
  });

  it('[03b Q-55] a Handover reply that lands after the sheet was closed still names the Ready and toasts "Handed to …"', async () => {
    let release!: (r: HubResult<unknown>) => void;
    const s = shellWith({ point_id: 'PT', stations: [], takeovers: [], orders: [order([line('A', 'done'), line('B', 'cooking')])] }, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-B', 'Bilal', true)] } }],
    });
    const orig = (s.shell.api as unknown as { command: (...a: unknown[]) => Promise<unknown> }).command;
    (s.shell.api as unknown as { command: unknown }).command = (type: string, p: unknown, o: unknown) =>
      type === 'Handover' ? (void orig(type, p, o), new Promise((r) => (release = r))) : orig(type, p, o);
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Bilal'));
    m.click(m.button('Cancel'));
    s.live.frame({ type: 'event', seq: 3, event: { event_id: 'E3r', event_type: 'ReadyToServe', schema_version: 1, payload: { order_id: 'O1', point_id: 'PT', order_item_ids: ['A', 'B'], table_id: null, alert_id: null } } });
    s.live.frame({ type: 'event', seq: 4, event: { event_id: 'E3', event_type: 'Handover', schema_version: 1, payload: { handover_id: 'H1', order_id: 'O1', point_id: 'PT', receiver_staff_id: 'S-B', order_item_ids: ['A'], alert_id: 'AL', ready_alert_closed: null } } });
    release({ ok: true, data: { handover_id: 'H1', served_card_alert_id: 'AL', remaining: 0 } });
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.container.querySelector('.pc__rdy > span')?.textContent).toBe('Ready · 12:00 AM · Asif');
    expect(s.toasts).toEqual(['Handed to Bilal']);
  });

  it('[03b D01] Handover → 409 ORDER_NOT_IN_ENGINE closes the sheet with the card line', async () => {
    const s = shellWith({ point_id: 'PT', stations: [], takeovers: [], orders: [order([line('A', 'done')])] }, {
      '/queries/pass-receivers?order_id=O1': [{ ok: true, data: { receivers: [rcv('S-B', 'Bilal')] } }],
      Handover: [{ ok: false, error: { kind: 'api', status: 409, code: 'ORDER_NOT_IN_ENGINE', details: {} } }],
    });
    m = mount();
    m.render(
      <ShellContext.Provider value={s.shell}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    m.click(m.button('Hand over'));
    await flush();
    m.click(m.button('Bilal'));
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.container.querySelector('.pc__msg.c-danger')?.textContent).toBe('This order is no longer in the kitchen');
  });
});

