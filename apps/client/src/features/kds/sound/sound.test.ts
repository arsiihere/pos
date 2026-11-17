import type { KdsStationBody, StationPlanBody, WsServerMessage } from '@pos/events';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { row as alertRow, NOW } from '../../../../test/alert-rows';
import { mount, type Mounted } from '../../../../test/dom';
import { BASE_GAIN, STEP_UP_GAIN } from '../../alerts/sounds';
import { fakeTimers, recordingSink } from '../../alerts/test-fakes';
import { createKdsStore } from '../store';
import { createKdsSound, gainFor } from './sound';
import { LockLines, soundBlocked, TapForSound } from './TapForSound';

// 03b v1.0.8 §3.8, §8, E3-KDS AC5 (K5; frames KdsLockSound, AlertLockDark): the client sound test.

const ST = 'ST';
const body = (o: Partial<KdsStationBody> = {}): KdsStationBody => ({ station_id: ST, day_open: true, sound_volume: 50, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [], details: [], ...o });
const plan = (ids: Array<[string, StationPlanBody['lines'][number]['mark']]>): StationPlanBody => ({
  station_id: ST,
  as_of_seq: 1,
  lines: ids.map(([id, mark]) => ({ order_item_id: id, order_id: `O-${id}`, fire_ms: 0, deadline_ms: 0, mark, frozen: true })),
});
const fire = (ids: string[]): WsServerMessage => ({ type: 'event', seq: 2, event: { event_id: `F-${ids.join()}`, event_type: 'FireDispatched', schema_version: 1, payload: { station_id: ST, order_item_ids: ids, load_id: null, due_at: 0, reason: 'scheduled' } } });

function setup(first: KdsStationBody, p: StationPlanBody) {
  const timers = fakeTimers();
  const sink = recordingSink(timers);
  const store = createKdsStore({ stationId: ST, now: () => 1_000 });
  const sound = createKdsSound(sink);
  store.subscribe(() => sound.onView(store.snapshot()));
  store.apply({ type: 'catch_up', as_of_seq: 1, state: { kds_station: first, station_plan: [p] } });
  return { store, sink };
}

let m: Mounted;
afterEach(() => m?.unmount());

describe('[03b §8] KDS sounds', () => {
  it('[03b §8] a new Now line plays the chime at sound_volume; a mark / return the strong sound', () => {
    const { store, sink } = setup(body({ now: [] }), plan([['A', null], ['B', 'boost'], ['C', 'return'], ['D', null]]));
    expect(sink.played).toEqual([]); // a catch-up never sounds
    store.apply(fire(['A']));
    expect(sink.played.map((p) => [p.sound, p.gain])).toEqual([['info', BASE_GAIN * 0.5]]);
    store.apply(fire(['B']));
    store.apply(fire(['C', 'D'])); // one sound per frame, the strongest
    expect(sink.played.map((p) => [p.sound, p.gain])).toEqual([
      ['info', BASE_GAIN * 0.5],
      ['urgent', STEP_UP_GAIN * 0.5],
      ['urgent', STEP_UP_GAIN * 0.5],
    ]);
    // other changes (a start) and a reconnect's catch-up do not sound
    store.apply({ type: 'event', seq: 3, event: { event_id: 'S', event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: 'A', started_at: 1, source: 'tap' } } });
    store.apply({ type: 'catch_up', as_of_seq: 4, state: { kds_station: body({ now: [] }) } });
    expect(sink.played).toHaveLength(3);
    expect(gainFor(0, false)).toBe(0);
    expect(gainFor(100, true)).toBe(STEP_UP_GAIN);
  });

  it('[03b Q-44] StationScreenSet for this station changes the volume for the next sound', () => {
    const { store, sink } = setup(body({ sound_volume: 80 }), plan([['A', null], ['B', null], ['C', null]]));
    store.apply(fire(['A']));
    store.apply({ type: 'event', seq: 5, event: { event_id: 'V', event_type: 'StationScreenSet', schema_version: 1, payload: { station_id: ST, sound_volume: 20 } } });
    store.apply({ type: 'event', seq: 6, event: { event_id: 'V2', event_type: 'StationScreenSet', schema_version: 1, payload: { station_id: 'OTHER', sound_volume: 100 } } });
    store.apply(fire(['B']));
    store.apply({ type: 'event', seq: 7, event: { event_id: 'V3', event_type: 'StationScreenSet', schema_version: 1, payload: { station_id: ST, sound_volume: 0 } } });
    store.apply(fire(['C']));
    expect(sink.played.map((p) => p.gain)).toEqual([BASE_GAIN * 0.8, BASE_GAIN * 0.2]); // 0 = silent
  });

  it('[03b §8] the browser blocks audio → "Tap to turn on sound" once', () => {
    const resume = vi.fn(async () => undefined);
    const ctx = { state: 'suspended', resume } as unknown as ReturnType<Parameters<typeof soundBlocked>[0]>;
    expect(soundBlocked(() => ctx)).toBe(true);
    expect(soundBlocked(() => ({ ...ctx!, state: 'running' }))).toBe(false);
    expect(soundBlocked(() => null)).toBe(false);
    let done = 0;
    m = mount();
    m.render(createElement(TapForSound, { audio: () => ctx, onTurnedOn: () => (done += 1) }));
    m.click(m.button('Tap to turn on sound'));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(done).toBe(1);
  });

  it('[03b §8] 01d lock lines render on the dark KDS kit', () => {
    m = mount();
    m.render(
      createElement(LockLines, {
        rows: [
          alertRow({ alert_id: 'R1', kind: 'ready_to_serve', family: 'action', escalation: true, lock: { kind_label_key: 'alert.void_approval.lock', table_code: '4', point_code: null, requester_name: 'Hamza' }, raised_at: NOW }),
          alertRow({ alert_id: 'R2', state: 'closed' }),
        ],
        utcOffsetMs: 0,
      }),
    );
    const lines = m.container.querySelectorAll('.lockp__r.lockp__r--kds');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.querySelector('.fam.fam--action')).not.toBeNull();
    expect(lines[0]!.querySelector('.atag.c-danger')?.textContent).toBe('Escalated');
    expect(lines[0]!.querySelector('.ac__time')?.textContent).toBe('2:04 PM');
    expect(m.buttons()).toHaveLength(0); // a station session answers nothing; no details on a lock line
    expect(m.text()).not.toContain('Customer changed mind');
  });
});
