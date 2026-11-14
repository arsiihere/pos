import type { LineDetail } from '@pos/domain';
import type { HubResult } from '../../../api/hub-admin';
import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, reply, type Mounted } from '../../../../test/dom';
import { setLanguage } from '../../../i18n';
import { notifySlots, registerLineTag, registerPassCardAction } from '../../kds/slots';
import { ShellContext, type Shell } from '../../staff/shell/hooks';
import { createLiveBus } from '../../staff/shell/live';
import type { PointLine, PointOrder, PointStation, PointViewBody } from '../contracts';
import { createStaffApi } from '../../staff/api';
import { passLiveOf } from '../live';
import { passPrintTransport, PassScreen } from '../PassScreen';
import { createPassStore } from '../store';
import { PassCard } from './PassCard';

// 03b v1.0.8 §3.4 (#74, Q-47, Q-50; P2, frames 03b-S02 Pass / PassRush / PassPortrait / PassUrdu / PassEmpty,
// 03b-C10–C13 PassCards): one card per order, oldest first, identifier big, lines grouped by station with a stage
// chip, the readiness pill, the 03c slot tags and card actions.

const UTC = 0;
const at = (h: number, min: number) => Date.UTC(2026, 10, 13, h, min);

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST-T',
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 2,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 60_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const line = (id: string, stage: PointLine['stage'], over: Partial<PointLine> = {}): PointLine => ({ ...detail(id), stage, handed_over: false, ...over });
const order = (order_id: string, lines: PointLine[], over: Partial<PointOrder> = {}): PointOrder => ({
  order_id,
  identifier: lines[0]?.identifier ?? { kind: 'table', label: 'T4' },
  placed_at: at(13, 12),
  lines,
  ready: null,
  ...over,
});
const STATIONS: PointStation[] = [
  { station_id: 'ST-K', name: 'Karahi', lanes: { lanes_on: 1, lane_count: 1 }, dark: false },
  { station_id: 'ST-T', name: 'Tandoor', lanes: { lanes_on: 2, lane_count: 2 }, dark: false },
  { station_id: 'ST-C', name: 'Cold', lanes: { lanes_on: 1, lane_count: 1 }, dark: false, screenless: true },
];

let m: Mounted;
const offs: Array<() => void> = [];
afterEach(() => {
  m?.unmount();
  m = undefined as unknown as Mounted;
  for (const off of offs.splice(0)) off();
  setLanguage('en');
});

function card(o: PointOrder, extra: Partial<Parameters<typeof PassCard>[0]> = {}) {
  m ??= mount();
  m.render(<PassCard order={o} stations={STATIONS} pointId="PT" utcOffsetMs={UTC} up {...extra} />);
}

describe('[03b §3.4] Pass card', () => {
  it('[03b §3.4] identifier, placed time, order note, lines by station with stage chips and options; readiness pill', () => {
    m = mount();
    const o = order('O1', [
      line('A', 'cooking', { station_id: 'ST-K', item_name: 'Chicken Karahi Full', options: ['No onion', '2 x Extra butter'], kitchen_note: 'less spicy', order_note: 'birthday, bring together', group_id: 'G1', serve_mode: 'sync' }),
      line('B', 'done', { units: 6, group_id: 'G1', serve_mode: 'sync' }),
      line('C', 'added', { station_id: 'ST-C', item_name: 'Raita', group_id: 'G1', serve_mode: 'sync' }),
    ]);
    card(o);
    const el = m.container.querySelector('article.pc')!;
    expect(el.className).toBe('pc hold');
    expect(el.querySelector('.pc__n')?.textContent).toBe('T4');
    expect(el.querySelector('.pc__m')?.textContent).toBe('placed 1:12 PM');
    expect(el.querySelector('.rd')?.textContent).toBe('HOLD AT PASS');
    expect(el.querySelector('.pc__on')?.textContent).toBe('birthday, bring together');
    expect([...el.querySelectorAll('.pc__g')].map((g) => g.textContent)).toEqual(['Karahi', 'Tandoor', 'Cold · no screen']);
    expect([...el.querySelectorAll('.pl')].map((p) => [p.querySelector('.pl__t')?.textContent, p.querySelector('.stg')?.textContent])).toEqual([
      ['2 xChicken Karahi Full', 'cooking'],
      ['6 xNaan', 'done'],
      ['2 xRaita', 'waiting'],
    ]);
    expect(el.querySelector('.pl__o')?.textContent).toBe('No onion · 2 x Extra butter · “less spicy”');

    // token with its day; parking plate with the car type; handed over lines muted; a Ready sent = `sent`
    card(order('O2', [line('D', 'done', { identifier: { kind: 'token', token: 12, date: '2026-11-10' }, handed_over: true })], { ready: { at: 1, by: null } }));
    expect(m.container.querySelector('.pc__n')?.textContent).toBe('#1210 Nov');
    expect(m.container.querySelector('article')?.className).toBe('pc sent');
    expect(m.container.querySelector('.pl')?.className).toBe('pl ho');
    expect(m.container.querySelector('.pl .stg')?.textContent).toBe('handed over');
    card(order('O3', [line('E', 'cooking', { identifier: { kind: 'parking', car_number: 'LEB 1234', car_type: 'sedan' } })]));
    expect(m.container.querySelector('.pc__n .plt')?.textContent).toBe('LEB 1234');
    expect(m.container.querySelector('.pc__n small')?.textContent).toBe('Sedan');
    expect(m.container.querySelector('.rd')?.textContent).toBe('Cooking');
  });

  it('[03b Q-47] after a re-sent point_lines detail the card identifier changes T4 → T9', () => {
    const store = createPassStore({ now: () => 1 });
    const view: PointViewBody = { point_id: 'PT', stations: STATIONS, takeovers: [], orders: [order('O1', [line('A', 'done')])] };
    store.apply({ type: 'catch_up', as_of_seq: 1, state: { point_view: view } });
    card(store.snapshot().view!.orders[0]!);
    expect(m.container.querySelector('.pc__n')?.textContent).toBe('T4');
    store.apply({ type: 'point_lines', point_id: 'PT', lines: [detail('A', { identifier: { kind: 'table', label: 'T9' } })] });
    card(store.snapshot().view!.orders[0]!);
    expect(m.container.querySelector('.pc__n')?.textContent).toBe('T9');
  });

  it('[03b Q-50] card renders passCardActions and re-renders on onSlotsChanged', async () => {
    let printed = false;
    let shown = false;
    const runs: string[] = [];
    offs.push(registerLineTag((l) => (printed && l.order_item_id === 'A' ? { key: 'printed', label: 'Printed' } : null)));
    offs.push(
      registerPassCardAction((o) =>
        shown ? { key: 'reprint', label: 'Reprint', run: () => (runs.push(`${o.order_id}@${o.point_id}`), Promise.resolve({ toast: 'Reprinting 2 tickets' })) } : null,
      ),
    );
    const toasts: string[] = [];
    card(order('O1', [line('A', 'done')]), { onToast: (text) => toasts.push(text) });
    expect(m.container.querySelector('.ptag')).toBeNull();
    expect(m.text()).not.toContain('Reprint');
    printed = true;
    shown = true;
    notifySlots();
    await flush();
    expect(m.container.querySelector('.pl .ptag')?.textContent).toBe('Printed');
    const btn = m.button('Reprint');
    expect(btn.className).toBe('btn rp');
    m.click(btn);
    m.click(btn); // a double tap runs once
    await flush();
    expect(runs).toEqual(['O1@PT']);
    expect(toasts).toEqual(['Reprinting 2 tickets']);
    // offline: the slot button is off
    card(order('O1', [line('A', 'done')]), { up: false });
    expect(m.button('Reprint').hasAttribute('disabled')).toBe(true);
  });
});

function fakeShell(view: PointViewBody | null, portrait = false): Shell {
  const live = createLiveBus();
  const shell = {
    live,
    clock: { nowMs: () => at(13, 30), utcOffsetMs: UTC },
    api: { roster: () => new Promise(() => undefined), command: () => new Promise(() => undefined) },
    permissions: { allowed: () => true },
    toasts: { show: () => undefined },
    online: true,
    portrait,
    me: { staff_id: 'S1', name: 'Asif' },
  } as unknown as Shell;
  // the page creates its Pass live before the socket's first catch-up (W0.6, IR-17b)
  passLiveOf(shell);
  if (view !== null) live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: view } });
  return shell;
}

describe('[03b §3.4] Pass screen cards', () => {
  it('[03b §3.4] "+n more lines" fold; oldest first; Urdu RTL, identifiers LTR; portrait', () => {
    const many = Array.from({ length: 12 }, (_, i) => line(`L${i}`, 'cooking', { order_id: 'O-OLD', identifier: { kind: 'table', label: 'Family 4' } }));
    const view: PointViewBody = {
      point_id: 'PT',
      stations: STATIONS,
      takeovers: [],
      orders: [
        order('O-NEW', [line('N', 'done', { order_id: 'O-NEW', identifier: { kind: 'table', label: 'T9' } })], { placed_at: at(13, 20) }),
        order('O-OLD', many, { placed_at: at(13, 0) }),
      ],
    };
    m = mount();
    m.render(
      <ShellContext.Provider value={fakeShell(view)}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    expect([...m.container.querySelectorAll('.pc__n')].map((n) => n.textContent)).toEqual(['Family 4', 'T9']);
    const first = m.container.querySelector('article.pc')!;
    expect(first.querySelectorAll('.pl')).toHaveLength(7);
    expect(first.querySelector('.pc__more')?.textContent).toBe('+5 more lines');
    expect(m.container.querySelector('.pcards')?.className).toBe('pcards');
    expect(m.container.querySelector('.pstrip')?.className).toBe('pstrip');
    m.unmount();

    // portrait: one column, the strip wraps (IR-18 classes in kds-03-additions.css)
    m = mount();
    m.render(
      <ShellContext.Provider value={fakeShell(view, true)}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    expect(m.container.querySelector('.pcards')?.className).toBe('pcards pcards--1');
    expect(m.container.querySelector('.pstrip')?.className).toBe('pstrip pstrip--wrap');
    m.unmount();

    // Urdu: the words change, identifiers / quantities / times stay LTR (pulse-03: .pc__n, .q, .num)
    setLanguage('ur');
    m = mount();
    m.render(<PassCard order={order('O1', [line('A', 'done', { group_id: 'G', serve_mode: 'sync' }), line('B', 'cooking', { group_id: 'G', serve_mode: 'sync' })])} stations={STATIONS} pointId="PT" utcOffsetMs={UTC} up />);
    expect(m.container.querySelector('.rd')?.textContent).toBe('پاس پر روکیں');
    expect(m.container.querySelector('.pc__n')?.textContent).toBe('T4');
    expect(m.container.querySelector('.pc__m')?.textContent).toBe('آرڈر 1:12 PM');
    expect(m.container.querySelector('.pc__m .num')?.textContent).toBe('1:12 PM');
    expect(m.container.querySelector('.pl__t .q')?.textContent).toBe('2 x');
  });

  it('[03b §3.4] no orders → "No orders at the Pass"', () => {
    m = mount();
    m.render(
      <ShellContext.Provider value={fakeShell({ point_id: 'PT', stations: STATIONS, takeovers: [], orders: [] })}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    expect(m.container.querySelector('.empty.empty--pass b')?.textContent).toBe('No orders at the Pass');
    // the 01d Ring at 96 px: full ok ring, the kitchen icon at 36 px
    expect(m.container.querySelector('.empty--pass .ring.ring--96.c-ok svg circle.val')?.getAttribute('stroke-dasharray')).toBe('100.0 100');
    expect(m.container.querySelector('.empty--pass .ring__in .ico.ico--36')).not.toBeNull();
  });

  it('[03b IR-15] Pass Reprint transport: the given command_id goes into the envelope, so a retry after a lost reply prints once', async () => {
    const bodies: Array<{ path: string; body: Record<string, unknown> | null }> = [];
    let lose = true;
    const api = createStaffApi({
      device: { token: 'DT', id: 'D1', type: 'tablet' },
      meta: { tenantId: 'TN', branchId: 'BR', branchName: '', hubNowMs: 0, utcOffsetMs: 0 },
      onSignedOut: () => undefined,
      newCommandId: () => 'NEW-ID',
      fetch: (input, init) => {
        bodies.push({ path: input, body: init?.body === undefined ? null : (JSON.parse(String(init.body)) as Record<string, unknown>) });
        if (lose) {
          lose = false;
          return Promise.reject(new Error('lost'));
        }
        return Promise.resolve(reply(200, { data: { command_id: 'CMD-1', event_ids: [], result: { job_ids: ['J1'] } } }));
      },
    });
    let reprint = true;
    const transport = passPrintTransport({ current: { api, permissions: { allowed: (p: string) => p === 'reprint-ticket' && reprint } } as unknown as Shell });
    expect(await transport.command('ReprintTicket', { ticket_id: 'TK1' }, 'CMD-1')).toEqual({ ok: false, error: { kind: 'network' } });
    expect(await transport.command('ReprintTicket', { ticket_id: 'TK1' }, 'CMD-1')).toEqual({ ok: true, data: { job_ids: ['J1'] } });
    expect(bodies.map((b) => [b.path, b.body?.['command_id'], b.body?.['command_type']])).toEqual([
      ['/commands/reprint-ticket', 'CMD-1', 'ReprintTicket'],
      ['/commands/reprint-ticket', 'CMD-1', 'ReprintTicket'],
    ]);
    // without a given id the api mints one; order-tickets on the staff session; the reprint-ticket grant
    await transport.command('ReprintTicket', { ticket_id: 'TK2' });
    expect(bodies[2]!.body?.['command_id']).toBe('NEW-ID');
    await transport.orderTickets('O 1');
    expect(bodies[3]!.path).toBe('/queries/order-tickets?order_id=O%201');
    expect(transport.canReprint()).toBe(true);
    reprint = false;
    expect(transport.canReprint()).toBe(false);
  });

  it('[03b IR-15] one print transport for the page: lost reply → Pass left and opened again on a renewed session → tap again → same command_id', async () => {
    const ids: Array<[string, string | undefined]> = [];
    const apiOf = (name: string) => ({
      roster: () => new Promise(() => undefined),
      command: (_type: string, _payload: unknown, opts: { commandId?: string }) => {
        ids.push([name, opts.commandId]);
        return Promise.resolve({ ok: false, error: { kind: 'network' } });
      },
      query: () =>
        Promise.resolve({ ok: true, data: { tickets: [{ ticket_id: 'TK', station_id: 'ST-T', station_name: 'Tandoor', fired_at: 1, printed: true, has_printer: true }] } }),
    });
    const view: PointViewBody = { point_id: 'PT', stations: STATIONS, takeovers: [], orders: [order('O-RP', [line('RP', 'done', { order_id: 'O-RP' })])] };
    const shell1 = { ...fakeShell(view), api: apiOf('first') } as unknown as Shell;
    m = mount();
    m.render(
      <ShellContext.Provider value={shell1}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    await flush();
    m.click(m.button('Reprint'));
    await flush();
    m.unmount();
    // the person signs in again (a new session, a new api object); the Pass is opened again
    const shell2 = { ...shell1, api: apiOf('second') } as unknown as Shell;
    m = mount();
    m.render(
      <ShellContext.Provider value={shell2}>
        <PassScreen />
      </ShellContext.Provider>,
    );
    await flush();
    m.click(m.button('Reprint'));
    await flush();
    expect(ids).toHaveLength(2);
    expect(ids[0]![0]).toBe('first');
    expect(ids[1]![0]).toBe('second');
    expect(ids[1]![1]).toBe(ids[0]![1]);
    expect(ids[0]![1]).toBeTruthy();
  });

  it('[03b IR-19] a 403 on Reprint hides it for that person only: D denied → D signs out → E signs in → E sees Reprint; D again → hidden', async () => {
    const denied: HubResult<never> = { ok: false, error: { kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: {} } };
    const calls: string[] = [];
    const api = {
      roster: () => new Promise(() => undefined),
      command: () => {
        calls.push('command');
        return Promise.resolve(denied);
      },
      query: () =>
        Promise.resolve({ ok: true, data: { tickets: [{ ticket_id: 'TK', station_id: 'ST-T', station_name: 'Tandoor', fired_at: 1, printed: true, has_printer: true }] } }),
    };
    const view: PointViewBody = { point_id: 'PT', stations: STATIONS, takeovers: [], orders: [order('O-DN', [line('DN', 'done', { order_id: 'O-DN' })])] };
    const base = fakeShell(view);
    const as = (staff_id: string) => ({ ...base, api, me: { staff_id, name: staff_id } }) as unknown as Shell;
    const open = async (shell: Shell) => {
      m?.unmount();
      m = mount();
      m.render(
        <ShellContext.Provider value={shell}>
          <PassScreen />
        </ShellContext.Provider>,
      );
      await flush();
    };
    await open(as('S-D'));
    m.click(m.button('Reprint'));
    await flush();
    expect(calls).toEqual(['command']);
    expect(m.buttons().some((b) => b.textContent?.includes('Reprint'))).toBe(false);
    // D signs out, E (who holds reprint-ticket) signs in
    await open(as('S-E'));
    expect(m.button('Reprint')).toBeTruthy();
    // D again: still hidden for D
    await open(as('S-D'));
    expect(m.buttons().some((b) => b.textContent?.includes('Reprint'))).toBe(false);
  });
});
