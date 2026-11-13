import type { LineDetail } from '@pos/domain';
import { act, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { fakeTimers, type FakeTimers } from '../../alerts/test-fakes';
import type { KdsApi } from '../contracts';
import { StationView } from '../station/StationView';
import type { KdsRow, KdsView } from '../store';
import { createKdsApi, useKdsActions, type CompletionMode } from './actions';
import { LOAD_NOTICE_MS, loadNotice, type LoadNotice } from './batch';
import { RowActions } from './DoneEarly';
import { GiveMeMore } from './GiveMeMore';
import { InlineError } from './InlineError';

// 03b v1.0.8 §3.2, §8, #72 (K3; frames 03b-B01–B05, 03b-C07, B08, KdsBatch*): taps on the station view, wired the
// way KdsApp wires them.

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: `O-${id}`,
    station_id: 'ST',
    point_id: 'P1',
    identifier: { kind: 'table', label: `T-${id}` },
    order_type: 'dine_in',
    item_name: 'Paye',
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 360_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}
const row = (id: string, o: Partial<KdsRow> = {}): KdsRow => ({ order_item_id: id, order_id: `O-${id}`, stage: 'added', fired_at: 0, started_at: null, mark: null, done_undone: false, done_at: null, detail: detail(id), ...o });
const view = (rows: KdsRow[]): KdsView => ({
  station: { station_id: 'ST', day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [], details: [] },
  details: new Map(),
  arrived_at: new Map(),
  rows,
  plan: null,
  archived: null,
});

type Calls = Array<[string, unknown]>;
function fakeApi(replies: Partial<Record<keyof KdsApi, Array<HubResult<unknown>>>>, calls: Calls): KdsApi {
  const next = (name: keyof KdsApi) => async (p: unknown) => {
    calls.push([name, p]);
    const list = replies[name] ?? [];
    return (list.length > 1 ? list.shift() : list[0]) as never;
  };
  return { startItem: next('startItem'), doneItem: next('doneItem'), undoDone: next('undoDone'), giveMeMore: next('giveMeMore'), setLaneState: next('setLaneState') };
}

function Harness({ api, rows, nowMs, mode, timers, up = true }: { api: KdsApi; rows: KdsRow[]; nowMs: number; mode: CompletionMode; timers: FakeTimers; up?: boolean }) {
  const [load, setLoad] = useState<LoadNotice | null>(null);
  const actions = useKdsActions(api, timers, (r) => {
    setLoad(loadNotice(r));
    timers.setTimeout(() => setLoad(null), LOAD_NOTICE_MS);
  });
  return (
    <StationView
      view={view(rows)}
      nowMs={nowMs}
      utcOffsetMs={0}
      up={up}
      banner={load === null ? undefined : <div className="kbn c-info">{load.text}</div>}
      {...(load === null ? {} : { highlight: load.ids })}
      actionsFor={(r) => <RowActions row={r} mode={mode} nowMs={nowMs} up={up} state={actions.stateOf(r.order_item_id)} onTap={(a, c) => void actions.tap(r, a, c)} />}
      messageFor={(r) => <InlineError msg={actions.stateOf(r.order_item_id).msg} />}
      nextFooter={<GiveMeMore api={api} stationId="ST" up={up} timers={timers} />}
    />
  );
}

let m: Mounted;
afterEach(() => m?.unmount());
const card = (id: string) => m.container.querySelector(`[data-id="${id}"]`)!;
const apiErr = (code: string, details: Record<string, unknown> = {}, status = 409): HubResult<never> => ({ ok: false, error: { kind: 'api', status, code, details } });

describe('[03b §3.2] KDS taps', () => {
  it('[03b §3.2] Start / Done one tap; Undo 30 s (UNDO_DONE_MS) then gone', async () => {
    const calls: Calls = [];
    const timers = fakeTimers();
    const api = fakeApi({ startItem: [{ ok: true, data: { started: ['A'] } }], doneItem: [{ ok: true, data: { done: ['A'] } }], undoDone: [{ ok: true, data: { undone: ['A'], ready_undone: [] } }] }, calls);
    m = mount();
    const show = (r: KdsRow, nowMs: number) => m.render(<Harness api={api} rows={[r]} nowMs={nowMs} mode="two_tap" timers={timers} />);
    show(row('A'), 1_000);
    m.click(m.button('Start', card('A')));
    expect(card('A').querySelector('.btn--start')?.classList.contains('busy')).toBe(true);
    await flush();
    expect(calls).toEqual([['startItem', { order_item_id: 'A' }]]);
    show(row('A', { stage: 'cooking', started_at: 1_000 }), 400_000);
    m.click(m.button('Done', card('A')));
    await flush();
    expect(calls[1]).toEqual(['doneItem', { order_item_id: 'A' }]);
    // the ItemDone frame: the row stays greyed in place with Undo and its countdown from the hub's done_at
    show(row('A', { stage: 'done', started_at: 1_000, done_at: 400_000 }), 406_000);
    expect(card('A').classList.contains('s-done')).toBe(true);
    expect(card('A').querySelector('.btn--undo')?.textContent).toBe('Undo 0:24');
    m.click(m.button('Undo', card('A')));
    await flush();
    expect(calls[2]).toEqual(['undoDone', { order_item_id: 'A' }]);
    show(row('A', { stage: 'done', started_at: 1_000, done_at: 400_000 }), 430_000);
    expect(card('A').querySelector('.kl__acts .btn')).toBeNull();
  });

  it('[03b §3.2] 422 ITEM_DONE_CONFIRM_REQUIRED → inline "Done early?" → DoneItem { confirm: true }', async () => {
    const calls: Calls = [];
    const timers = fakeTimers();
    const api = fakeApi({ doneItem: [apiErr('ITEM_DONE_CONFIRM_REQUIRED', { elapsed_ms: 120_000, cook_ms: 360_000 }, 422), { ok: true, data: { done: ['A'] } }] }, calls);
    m = mount();
    m.render(<Harness api={api} rows={[row('A', { stage: 'cooking', started_at: 0 })]} nowMs={120_000} mode="two_tap" timers={timers} />);
    m.click(m.button('Done', card('A')));
    await flush();
    const confirm = card('A').querySelector('.btn--confirm');
    expect(confirm?.textContent).toBe('Done already? 2:00 of 6:00 — tap again');
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    m.click(confirm);
    await flush();
    expect(calls).toEqual([
      ['doneItem', { order_item_id: 'A' }],
      ['doneItem', { order_item_id: 'A', confirm: true }],
    ]);
    // untouched, the confirm goes back after a few seconds
    m.unmount();
    const api2 = fakeApi({ doneItem: [apiErr('ITEM_DONE_CONFIRM_REQUIRED', { elapsed_ms: 1_000, cook_ms: 360_000 }, 422)] }, []);
    m = mount();
    m.render(<Harness api={api2} rows={[row('B', { stage: 'cooking', started_at: 0 })]} nowMs={1_000} mode="two_tap" timers={timers} />);
    m.click(m.button('Done', card('B')));
    await flush();
    expect(card('B').querySelector('.btn--confirm')).not.toBeNull();
    timers.advance(5_000);
    await flush();
    expect(card('B').querySelector('.btn--confirm')).toBeNull();
    expect(card('B').querySelector('.btn--done')).not.toBeNull();
  });

  it('[03b §3.2] two_tap Done before Start → "Tap Start first" inline', async () => {
    const calls: Calls = [];
    const api = fakeApi({ doneItem: [apiErr('ITEM_WRONG_STAGE', { stage: 'added' })] }, calls);
    m = mount();
    // the screen thought the station was single-tap (mode not loaded right): Done on an added line
    m.render(<Harness api={api} rows={[row('A')]} nowMs={1_000} mode="single_tap" timers={fakeTimers()} />);
    m.click(m.button('Done', card('A')));
    await flush();
    expect(card('A').querySelector('.kl__msg')?.textContent).toBe('Tap Start first');
    expect(card('A').querySelector('.kl__msg')?.className).toBe('kl__msg c-warn');
    expect(card('A').querySelector('.btn--start.hot')).not.toBeNull();
  });

  it('[03b #72] 409 ITEM_WRONG_STAGE { stage: "done" } (the loser) shows no error', async () => {
    const api = fakeApi({ doneItem: [apiErr('ITEM_WRONG_STAGE', { stage: 'done' })], startItem: [apiErr('ITEM_WRONG_STAGE', { stage: 'cooking' })] }, []);
    m = mount();
    m.render(<Harness api={api} rows={[row('A', { stage: 'cooking', started_at: 0 }), row('B')]} nowMs={300_000} mode="two_tap" timers={fakeTimers()} />);
    m.click(m.button('Done', card('A')));
    m.click(m.button('Start', card('B')));
    await flush();
    expect(m.container.querySelectorAll('.kl__msg')).toHaveLength(0);
    // other refusals do show their line on the row
    m.unmount();
    const api2 = fakeApi({ doneItem: [apiErr('ITEM_WRONG_STAGE', { stage: 'out_of_engine' })] }, []);
    m = mount();
    m.render(<Harness api={api2} rows={[row('C', { stage: 'cooking', started_at: 0 })]} nowMs={300_000} mode="two_tap" timers={fakeTimers()} />);
    m.click(m.button('Done', card('C')));
    await flush();
    expect(card('C').querySelector('.kl__msg')?.textContent).toBe('This order is no longer in the kitchen');
  });

  it('[03b §3.2] batch rows of one load_id highlight together; Start / Done act on the load', async () => {
    const calls: Calls = [];
    const timers = fakeTimers();
    const api = fakeApi({ startItem: [{ ok: true, data: { started: ['A', 'B', 'C'] } }], doneItem: [{ ok: true, data: { done: ['A', 'B', 'C'] } }] }, calls);
    m = mount();
    const rows = [row('A'), row('B'), row('C'), row('D')];
    m.render(<Harness api={api} rows={rows} nowMs={1_000} mode="two_tap" timers={timers} />);
    // before a tap: no grouping
    expect(m.container.querySelectorAll('.s-hl')).toHaveLength(0);
    m.click(m.button('Start', card('B')));
    await flush();
    expect(calls).toEqual([['startItem', { order_item_id: 'B' }]]); // one command; the hub acts on the load
    expect([...m.container.querySelectorAll('.s-hl')].map((e) => e.getAttribute('data-id'))).toEqual(['A', 'B', 'C']);
    expect(m.container.querySelector('.kbn')?.textContent).toBe('One tap started the whole load (3 lines)');
    timers.advance(LOAD_NOTICE_MS);
    await flush();
    expect(m.container.querySelectorAll('.s-hl')).toHaveLength(0);
    expect(m.container.querySelector('.kbn')).toBeNull();
    m.render(<Harness api={api} rows={rows.map((r) => ({ ...r, stage: 'cooking', started_at: 0 }))} nowMs={300_000} mode="two_tap" timers={timers} />);
    m.click(m.button('Done', card('A')));
    await flush();
    expect(m.container.querySelector('.kbn')?.textContent).toBe('One tap finished the whole load — Undo on any line undoes all');
  });

  it('[03b §3.2] a double tap sends one command (Start, Done, Undo, Give me more), whatever the render timing', async () => {
    const calls: Calls = [];
    const gate: Array<() => void> = [];
    const slow = <T,>(data: T) => () => new Promise<HubResult<T>>((r) => gate.push(() => r({ ok: true, data })));
    const next = (name: keyof KdsApi, reply: () => Promise<HubResult<unknown>>) => async (p: unknown) => {
      calls.push([name, p]);
      return reply() as never;
    };
    const api: KdsApi = {
      startItem: next('startItem', slow({ started: ['A'] })),
      doneItem: next('doneItem', slow({ done: ['B'] })),
      undoDone: next('undoDone', slow({ undone: ['C'], ready_undone: [] })),
      giveMeMore: next('giveMeMore', slow({ pulled: ['X'] })),
      setLaneState: next('setLaneState', slow({ lanes_on: 1, lane_count: 1, capacity: 1 })),
    };
    m = mount();
    m.render(
      <Harness api={api} rows={[row('A'), row('B', { stage: 'cooking', started_at: 0 }), row('C', { stage: 'done', started_at: 0, done_at: 290_000 })]} nowMs={300_000} mode="two_tap" timers={fakeTimers()} />,
    );
    const twice = (el: HTMLElement) => {
      // two clicks in one tick: the second lands before React re-renders the disabled button
      act(() => {
        el.click();
        el.click();
      });
    };
    twice(m.button('Start', card('A')));
    twice(m.button('Done', card('B')));
    twice(m.button('Undo', card('C')));
    twice(m.button('Give me more'));
    await flush();
    expect(calls.map(([name]) => name)).toEqual(['startItem', 'doneItem', 'undoDone', 'giveMeMore']);
    for (const g of gate.splice(0)) g();
    await flush();
    // after the reply, a new tap goes out again
    m.click(m.button('Give me more'));
    await flush();
    expect(calls.filter(([name]) => name === 'giveMeMore')).toHaveLength(2);
  });

  it('[03b §3.2 D32] a re-tap after a lost reply sends the same command_id (the hub replays, no second pull / start)', async () => {
    const bodies: Array<{ command_type: string; command_id: string }> = [];
    let lose = true;
    const fetch = async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(init!.body as string) as { command_type: string; command_id: string });
      if (lose) throw new TypeError('down');
      return new Response(JSON.stringify({ data: { command_id: 'x', event_ids: [], result: { pulled: ['X'], started: ['A'], done: ['B'], undone: ['C'], ready_undone: [] } } }), { status: 200 });
    };
    let n = 0;
    const api = createKdsApi({ fetch, meta: { tenantId: 'T', branchId: 'B', branchName: '', hubNowMs: 0, utcOffsetMs: 0 }, deviceId: 'D', deviceToken: 'DEV', sessionToken: 'SS', nowMs: () => 0, newCommandId: () => `ID${++n}` });
    m = mount();
    m.render(
      <Harness api={api} rows={[row('A'), row('B', { stage: 'cooking', started_at: 0 }), row('C', { stage: 'done', started_at: 0, done_at: 290_000 })]} nowMs={300_000} mode="two_tap" timers={fakeTimers()} />,
    );
    const tapAll = async () => {
      for (const [label, id] of [['Start', 'A'], ['Done', 'B'], ['Undo', 'C']] as const) {
        m.click(m.button(label, card(id)));
        await flush();
      }
      m.click(m.button('Give me more'));
      await flush();
    };
    await tapAll(); // every reply lost: nothing shows (B06 covers a dead socket)
    expect(m.container.querySelectorAll('.kl__msg')).toHaveLength(0);
    lose = false;
    await tapAll(); // the cook taps again: the same ids, the hub replays
    const byType = (type: string) => bodies.filter((b) => b.command_type === type).map((b) => b.command_id);
    for (const type of ['StartItem', 'DoneItem', 'UndoDone', 'GiveMeMore']) {
      const sent = byType(type);
      expect(sent, type).toHaveLength(2);
      expect(sent[0], type).toBe(sent[1]);
    }
    await tapAll(); // answered: the next intent gets a new id
    expect(new Set(byType('GiveMeMore')).size).toBe(2);
  });

  it('[03b §3.2] Give me more → pulled null → "Nothing to pull"', async () => {
    const calls: Calls = [];
    const timers = fakeTimers();
    const api = fakeApi({ giveMeMore: [{ ok: true, data: { pulled: null } }, { ok: true, data: { pulled: ['X'] } }] }, calls);
    m = mount();
    m.render(<Harness api={api} rows={[]} nowMs={1_000} mode="two_tap" timers={timers} />);
    m.click(m.button('Give me more'));
    await flush();
    expect(calls).toEqual([['giveMeMore', { station_id: 'ST' }]]);
    expect(m.container.querySelector('.kmore .kl__msg')?.textContent).toBe('Nothing to pull right now');
    timers.advance(5_000);
    await flush();
    expect(m.container.querySelector('.kmore .kl__msg')).toBeNull();
    m.click(m.button('Give me more'));
    await flush();
    expect(m.container.querySelector('.kmore .kl__msg')).toBeNull();
    // socket down: disabled
    m.render(<Harness api={api} rows={[]} nowMs={1_000} mode="two_tap" timers={timers} up={false} />);
    expect((m.button('Give me more') as HTMLButtonElement).disabled).toBe(true);
  });
});

