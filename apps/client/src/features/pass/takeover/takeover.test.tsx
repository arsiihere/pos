import type { LineDetail } from '@pos/domain';
import type { KdsStationBody, StationPlanBody, WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { registerLineAction, type LineActionCtx } from '../../kds/slots';
import { ShellContext, type Shell } from '../../staff/shell/hooks';
import { createLiveBus } from '../../staff/shell/live';
import type { PointStation, PointViewBody } from '../contracts';
import { passLiveOf, type PassLive } from '../live';
import { PassScreen } from '../PassScreen';

// 03b v1.0.8 §3.6, §8 (Q-50, Q-56; P4, frames 03b-S03 PassTakeover, PassTakeoverUrdu, PassScreenBack): a dark station
// of this point gets a section "{Station} screen offline" above the cards, with that station's Now rows (the KDS's
// own row) and its Next, driven by the same frames as the KDS; Start / Done / Undo / Give me more / Lane under
// run-pass; 03c's line actions with surface 'takeover' and the takeover body's has_printer; when it ends with rows
// still in it → "Tandoor screen is back".

const ST = 'ST-TANDOOR';

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: `O-${id}`,
    station_id: ST,
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
    cook_ms: 300_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const nowLine = (id: string, over: Partial<KdsStationBody['now'][number]> = {}): KdsStationBody['now'][number] => ({
  ...detail(id),
  stage: 'added',
  fired_at: 1_000,
  started_at: null,
  mark: null,
  done_undone: false,
  ...over,
});
const body = (over: Partial<KdsStationBody> = {}): KdsStationBody => ({
  station_id: ST,
  day_open: true,
  sound_volume: 70,
  has_printer: false,
  lanes: { lanes_on: 2, lane_count: 2 },
  now: [],
  details: [],
  ...over,
});
const plan = (ids: string[]): StationPlanBody => ({
  station_id: ST,
  as_of_seq: 1,
  lines: ids.map((id) => ({ order_item_id: id, order_id: `O-${id}`, fire_ms: 50_000, deadline_ms: 90_000, mark: null, frozen: true })),
});
const STATIONS: PointStation[] = [
  { station_id: 'ST-KARAHI', name: 'Karahi', lanes: { lanes_on: 1, lane_count: 1 }, dark: false },
  { station_id: ST, name: 'Tandoor', lanes: { lanes_on: 2, lane_count: 2 }, dark: false },
];
const view = (over: Partial<PointViewBody> = {}): PointViewBody => ({ point_id: 'PT', stations: STATIONS, orders: [], takeovers: [], ...over });

let seq = 10;
const ev = (event_type: string, payload: Record<string, unknown>): WsServerMessage => ({ type: 'event', seq: (seq += 1), event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } });

function setup(o: { runPass?: boolean; answers?: Record<string, Array<HubResult<unknown>>> } = {}) {
  const live = createLiveBus();
  const sent: Array<{ type: string; payload: unknown }> = [];
  const toasts: string[] = [];
  const shell = {
    live,
    clock: { nowMs: () => 20_000, utcOffsetMs: 0 },
    api: {
      roster: () => new Promise(() => undefined),
      command: (type: string, payload: unknown) => {
        sent.push({ type, payload });
        return Promise.resolve(o.answers?.[type]?.shift() ?? { ok: false, error: { kind: 'network' } });
      },
      query: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
    },
    permissions: { allowed: (p: string) => p === 'run-pass' && o.runPass !== false },
    toasts: { show: (t: { text: string }) => toasts.push(t.text) },
    online: true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Asif' },
  } as unknown as Shell;
  const pass: PassLive = passLiveOf(shell);
  const raw = (f: WsServerMessage) => {
    // the staff page's onFrame: the bus, then the Pass (IR-17)
    live.frame(f);
    pass.frame(f);
  };
  return { shell, raw, sent, toasts };
}

let m: Mounted;
afterEach(() => m?.unmount());
function show(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <PassScreen />
    </ShellContext.Provider>,
  );
}

describe('[03b §3.6] Pass takeover sections', () => {
  it('[03b §3.6] "Tandoor screen offline" section with that station\'s Now / Next rows; Start / Done / Undo / Give me more / Lane under run-pass', async () => {
    const s = setup({ answers: { StartItem: [{ ok: true, data: { started: ['A'] } }], GiveMeMore: [{ ok: true, data: { pulled: null } }] } });
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view(), station_plan: [plan(['N1'])] } });
    show(s.shell);
    expect(m.container.querySelector('.tko')).toBeNull();
    s.raw({ type: 'station_takeover', station_id: ST, active: true, view: body({ now: [nowLine('A'), nowLine('B', { stage: 'cooking', started_at: 5_000 })], details: [detail('N1', { identifier: { kind: 'table', label: 'T7' }, units: 4 })] }) });
    await flush();
    const sec = m.container.querySelector('section.tko')!;
    expect(sec.getAttribute('aria-label')).toBe('Tandoor screen offline');
    expect(sec.querySelector('.tko__h b')?.textContent).toBe('Tandoor screen offline');
    expect(sec.querySelector('.tko__h small')?.textContent).toBe('Its Now and Next are here. Tap for the cooks until the screen is back.');
    expect([...sec.querySelectorAll('.kcards article.kl')].map((a) => a.getAttribute('data-id'))).toEqual(['A', 'B']);
    expect([...sec.querySelectorAll('.knx .knr')].map((r) => r.getAttribute('data-id'))).toEqual(['N1']);
    // the section sits above the cards, the strip shows the station dark
    expect(m.container.querySelector('.pscroll')?.firstElementChild?.className).toBe('tko');
    expect(m.container.querySelector('.pst.dark b')?.textContent).toBe('Tandoor');

    // Start on a row (the staff session, the KDS command shape); the ItemStarted frame moves it
    m.click(m.button('Start', sec.querySelector('article[data-id="A"]')!));
    await flush();
    expect(s.sent[0]).toEqual({ type: 'StartItem', payload: { order_item_id: 'A' } });
    s.raw(ev('ItemStarted', { order_item_id: 'A', started_at: 19_000 }));
    await flush();
    expect(m.container.querySelector('section.tko article[data-id="A"]')?.className).toContain('s-cook');
    // Give me more and the lane control are in the section's header
    m.click(m.button('Give me more', m.container.querySelector('.tko__h')!));
    await flush();
    expect(s.sent[1]).toEqual({ type: 'GiveMeMore', payload: { station_id: ST } });
    expect(m.container.querySelector('.tko__h')?.textContent).toContain('Lane Off');
    m.unmount();

    // without run-pass: rows only, no buttons in the section
    const r = setup({ runPass: false });
    r.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view({ takeovers: [body({ now: [nowLine('A')] })], stations: STATIONS.map((st) => (st.station_id === ST ? { ...st, dark: true } : st)) }) } });
    show(r.shell);
    expect(m.container.querySelectorAll('section.tko article.kl')).toHaveLength(1);
    expect(m.container.querySelector('section.tko')?.querySelectorAll('button')).toHaveLength(0);
  });

  it('[03b Q-50] takeover rows render lineActions with surface "takeover" and the takeover body\'s has_printer', async () => {
    const seen: LineActionCtx[] = [];
    const runs: string[] = [];
    const off = registerLineAction((line, ctx) => {
      seen.push(ctx);
      return ctx.surface === 'takeover' && ctx.has_printer ? { key: 'reprint', label: 'Reprint', run: () => (runs.push(line.order_item_id), Promise.resolve({ toast: 'Reprinting 1 tickets' })) } : null;
    });
    try {
      const s = setup();
      s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view({ takeovers: [body({ now: [nowLine('A')] })] }) } });
      show(s.shell);
      expect(seen.some((c) => c.surface === 'takeover' && c.station_id === ST && !c.has_printer)).toBe(true);
      // K2's LineRow asks its own slot with surface 'kds'; on the Pass it always gets has_printer false (no KDS Reprint)
      expect(seen.filter((c) => c.surface === 'kds').every((c) => !c.has_printer)).toBe(true);
      expect(m.text()).not.toContain('Reprint');
      // the takeover station gets a printer
      s.raw({ type: 'station_notice', station_id: ST, kind: 'output', has_printer: true });
      await flush();
      expect(seen.filter((c) => c.surface === 'kds').every((c) => !c.has_printer)).toBe(true);
      expect(seen.some((c) => c.surface === 'takeover' && c.has_printer)).toBe(true);
      expect([...m.container.querySelectorAll('section.tko .kl button')].map((b) => b.textContent)).toEqual(['Start', 'Reprint']);
      m.click(m.button('Reprint', m.container.querySelector('section.tko')!));
      await flush();
      expect(runs).toEqual(['A']);
      expect(s.toasts).toEqual(['Reprinting 1 tickets']);
    } finally {
      off();
    }
  });

  it('[03b Q-56] takeover end with rows still in the section → toast "Tandoor screen is back"; end with an empty section → no toast', async () => {
    const s = setup();
    s.raw({ type: 'catch_up', as_of_seq: 1, state: { point_view: view() } });
    show(s.shell);
    s.raw({ type: 'station_takeover', station_id: ST, active: true, view: body({ now: [nowLine('A')] }) });
    await flush();
    s.raw({ type: 'station_takeover', station_id: ST, active: false });
    await flush();
    expect(m.container.querySelector('section.tko')).toBeNull();
    expect(s.toasts).toEqual(['Tandoor screen is back']);

    // again, but every line got done and left before the end (Now / Next empty): it ends quietly
    s.raw({ type: 'station_takeover', station_id: ST, active: true, view: body({ now: [nowLine('B')] }) });
    s.raw(ev('ItemServed', { order_item_ids: ['B'], source: 'tap' }));
    await flush();
    expect(m.container.querySelectorAll('section.tko article.kl')).toHaveLength(0);
    s.raw({ type: 'station_takeover', station_id: ST, active: false });
    await flush();
    expect(s.toasts).toEqual(['Tandoor screen is back']);
  });
});
