import type { LineDetail } from '@pos/domain';
import type { WsServerMessage } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../api/hub-admin';
import { flush } from '../../../test/dom';
import { subscribeFrames } from '../kds/slots';
import { createLiveBus } from '../staff/shell/live';
import type { RosterPerson } from '../staff/api';
import type { PointViewBody } from './contracts';
import { createPassLive, passLiveOf } from './live';
import { createPassNames } from './names';

// 03b v1.0.8 §3.4, §6.15 (P1; Q-55): names on the Pass come from the person signed in on this tablet (for what this
// tablet sent) or from `staff-roster` (an id the hub gave in a catch-up). The live layer feeds the store from the
// staff shell's live bus (catch-up + events, seq-ordered) and from the socket's other frames, and hands every frame
// to the slots' frame feed (Q-50).

const PT = 'PT-MAIN';

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST-TANDOOR',
    point_id: PT,
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
    cook_ms: 120_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}

function view(over: Partial<PointViewBody> = {}): PointViewBody {
  return {
    point_id: PT,
    stations: [{ station_id: 'ST-TANDOOR', name: 'Tandoor', lanes: { lanes_on: 1, lane_count: 1 }, dark: false }],
    orders: [
      { order_id: 'O1', identifier: { kind: 'table', label: 'T4' }, placed_at: 1_000, lines: [{ ...detail('A'), stage: 'done', handed_over: false }], ready: null },
    ],
    takeovers: [],
    ...over,
  };
}

type Roster = HubResult<{ staff: RosterPerson[] }>;
const person = (staff_id: string, display_name: string): RosterPerson => ({ staff_id, display_name, locked_until: null });

function rosterFake() {
  const calls: Array<(r: Roster) => void> = [];
  return {
    load: () => new Promise<Roster>((resolve) => calls.push(resolve)),
    calls,
    answer: (i: number, staff: RosterPerson[]) => calls[i]!({ ok: true, data: { staff } }),
  };
}

let seq = 100;
function ev(event_type: string, payload: Record<string, unknown>): WsServerMessage {
  seq += 1;
  return { type: 'event', seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } };
}

const offs: Array<() => void> = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

describe('[03b Q-55] Pass names', () => {
  it('[03b Q-55] a live ReadyToServe → at = hub clock at receipt; by = this device\'s person if it sent it, else the roster name at the next catch-up, else none', async () => {
    const live = createLiveBus();
    const roster = rosterFake();
    let now = 5_000;
    const pass = createPassLive({ live, now: () => now, roster: roster.load });
    offs.push(() => pass.dispose());
    live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: view() } });
    roster.answer(0, [person('S-ZAIN', 'Zain')]);
    await flush();

    // this tablet sent it: the signed-in person's name, even before any roster read knows them
    pass.names.remember('S-ASIF', 'Asif');
    pass.store.claimReady('AL1', 'S-ASIF');
    now = 9_000;
    live.frame(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A'], table_id: null, alert_id: 'AL1' }));
    let ready = pass.store.snapshot().view!.orders[0]!.ready!;
    expect(ready.at).toBe(9_000);
    expect(pass.names.name(ready.by)).toBe('Asif');

    // another tablet's Ready: no name until the next catch-up
    live.frame(ev('ReadyToServeUndone', { order_id: 'O1', point_id: PT, alert_id: 'AL1' }));
    live.frame(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A'], table_id: null, alert_id: 'AL2' }));
    ready = pass.store.snapshot().view!.orders[0]!.ready!;
    expect(ready.by).toBeNull();
    expect(pass.names.name(ready.by)).toBeNull();

    // the next catch-up gives the id; the roster (read again at that catch-up) gives the name
    live.frame({ type: 'catch_up', as_of_seq: 200, state: { point_view: view({ orders: [{ ...view().orders[0]!, ready: { at: 8_900, by: 'S-NOOR' } }] }) } });
    expect(roster.calls).toHaveLength(2);
    ready = pass.store.snapshot().view!.orders[0]!.ready!;
    expect(pass.names.name(ready.by)).toBeNull();
    roster.answer(1, [person('S-NOOR', 'Noor')]);
    await flush();
    expect(pass.names.name(ready.by)).toBe('Noor');
    // an id the roster does not know: no name (fillLine drops the part)
    expect(pass.names.name('S-GONE')).toBeNull();
  });

  it('[03b Q-55] a late roster reply never replaces a newer one; a failed read keeps the last names', async () => {
    const roster = rosterFake();
    const names = createPassNames(roster.load);
    let changes = 0;
    names.subscribe(() => (changes += 1));
    names.refresh();
    names.refresh();
    roster.answer(1, [person('S1', 'New')]);
    await flush();
    roster.answer(0, [person('S1', 'Old')]);
    await flush();
    expect(names.name('S1')).toBe('New');
    expect(changes).toBe(1);
    names.refresh();
    roster.calls[2]!({ ok: false, error: { kind: 'network' } });
    await flush();
    expect(names.name('S1')).toBe('New');
  });
});

describe('[03b §8 Q-50] Pass live', () => {
  it('[03b §8 Q-50] bus catch-up and events and the socket\'s other frames reach the store and publishFrame in arrival order', () => {
    const live = createLiveBus();
    const roster = rosterFake();
    const pass = createPassLive({ live, now: () => 7_000, roster: roster.load });
    offs.push(() => pass.dispose());
    const seen: string[] = [];
    offs.push(subscribeFrames((f) => seen.push(f.type === 'event' ? f.event.event_type : f.type)));

    live.frame({ type: 'catch_up', as_of_seq: 50, state: { point_view: view() } });
    pass.frame({ type: 'point_lines', point_id: PT, lines: [{ ...detail('B'), group_id: 'G-B', serve_mode: 'immediate' }] });
    live.frame(ev('ItemStarted', { order_item_id: 'B' }));
    pass.frame({ type: 'station_takeover', station_id: 'ST-TANDOOR', active: false });
    // the bus's frames given to frame() again are ignored there (the bus already delivered them)
    pass.frame({ type: 'catch_up', as_of_seq: 50, state: {} });
    expect(seen).toEqual(['catch_up', 'point_lines', 'ItemStarted', 'station_takeover']);
    expect(pass.store.snapshot().view!.orders[0]!.lines.map((l) => [l.order_item_id, l.stage])).toEqual([
      ['A', 'done'],
      ['B', 'cooking'],
    ]);
    // a catch-up without point_view (a tablet with no point) reads no roster
    live.frame({ type: 'catch_up', as_of_seq: 60, state: {} });
    expect(roster.calls).toHaveLength(1);

    pass.dispose();
    live.frame(ev('ItemDone', { order_item_id: 'B' }));
    expect(seen).toHaveLength(5);
  });

  it('[03b §8 IR-17b] created after the bus\'s catch-up: starts empty and publishes nothing (no replay of stale parts); one live per shell', () => {
    const live = createLiveBus();
    live.frame({ type: 'catch_up', as_of_seq: 9, state: { point_view: view(), station_plan: [], kds_printed: [] } });
    live.frame(ev('ReadyToServe', { order_id: 'O1', point_id: PT, order_item_ids: ['A'], table_id: null, alert_id: 'AL1' }));
    const seen: WsServerMessage[] = [];
    offs.push(subscribeFrames((f) => seen.push(f)));
    const roster = rosterFake();
    const shell = { live, clock: { nowMs: () => 1, utcOffsetMs: 0 }, api: { roster: roster.load } };
    const pass = passLiveOf(shell);
    offs.push(() => pass.dispose());
    expect(passLiveOf(shell)).toBe(pass);
    expect(pass.store.snapshot().view).toBeNull();
    expect(seen).toEqual([]);
    expect(roster.calls).toHaveLength(0);
    // the next catch-up (a reconnect) fills it
    live.frame({ type: 'catch_up', as_of_seq: 20, state: { point_view: view() } });
    expect(pass.store.snapshot().view?.point_id).toBe(PT);
  });
});
