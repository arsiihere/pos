import { useSyncExternalStore } from 'react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import type { KdsApi, SetLaneStatePayload } from '../contracts';
import { createKdsStore } from '../store';
import { LaneControl, laneTargets, type Lanes } from './LaneControl';

// 03b v1.0.8 §3.7, AD-46, Q-44 (K4; frames KdsLaneStates, KdsLaneOff, KdsLaneCustom).

function api(sent: SetLaneStatePayload[], reply: (p: SetLaneStatePayload) => HubResult<{ lanes_on: number; lane_count: number; capacity: number }>): KdsApi {
  const no = async () => ({ ok: false as const, error: { kind: 'network' as const } });
  return {
    startItem: no,
    doneItem: no,
    undoDone: no,
    giveMeMore: no,
    setLaneState: async (p) => {
      sent.push(p);
      return reply(p);
    },
  };
}

let m: Mounted;
afterEach(() => m?.unmount());
const lanesText = () => m.container.querySelector('.st')?.textContent;

describe('[03b §3.7] lane control', () => {
  it('[03b §3.7 AD-46] Lane Off sends lane_count − 1, Lane On lane_count; Lane Off hidden at lane_count 1 or lanes_on 1; custom shows "Custom capacity"', async () => {
    expect(laneTargets({ lanes_on: 2, lane_count: 2 })).toEqual({ off: 1, on: null });
    expect(laneTargets({ lanes_on: 2, lane_count: 3 })).toEqual({ off: 1, on: 3 });
    expect(laneTargets({ lanes_on: 1, lane_count: 2 })).toEqual({ off: null, on: 2 });
    expect(laneTargets({ lanes_on: 1, lane_count: 1 })).toEqual({ off: null, on: null });
    expect(laneTargets({ lanes_on: null, lane_count: 3 })).toEqual({ off: 2, on: 3 });

    const sent: SetLaneStatePayload[] = [];
    const a = api(sent, (p) => ({ ok: true, data: { lanes_on: p.lanes_on, lane_count: 2, capacity: 4 } }));
    m = mount();
    const show = (lanes: Lanes) => m.render(<LaneControl lanes={lanes} stationId="ST" api={a} up />);
    show({ lanes_on: 2, lane_count: 2 });
    expect(lanesText()).toBe('Lanes: 2 of 2 on');
    expect((m.button('Lane On') as HTMLButtonElement).disabled).toBe(true);
    m.click(m.button('Lane Off'));
    await flush();
    expect(sent).toEqual([{ station_id: 'ST', lanes_on: 1 }]);
    // the own result shows at once (before HK1's LanesSet): 1 of 2 on, Lane Off hidden at the minimum
    expect(lanesText()).toBe('Lanes: 1 of 2 on');
    expect(m.buttons().some((b) => b.textContent === 'Lane Off')).toBe(false);
    m.click(m.button('Lane On'));
    await flush();
    expect(sent[1]).toEqual({ station_id: 'ST', lanes_on: 2 });
    m.unmount();

    m = mount();
    show({ lanes_on: null, lane_count: 3 });
    expect(lanesText()).toBe('Custom capacity');
    m.click(m.button('Lane Off'));
    await flush();
    expect(sent[2]).toEqual({ station_id: 'ST', lanes_on: 2 });
    m.unmount();

    // out of range → the fallback line, no change
    m = mount();
    m.render(<LaneControl lanes={{ lanes_on: 2, lane_count: 2 }} stationId="ST" api={api([], () => ({ ok: false, error: { kind: 'api', status: 400, code: 'VALIDATION_FAILED', details: {} } }))} up />);
    m.click(m.button('Lane Off'));
    await flush();
    expect(m.text()).toContain("Can't change lanes now");
    expect(lanesText()).toBe('Lanes: 2 of 2 on');
  });

  it('[03b Q-44] a LanesSet frame updates lanes_on live', () => {
    const store = createKdsStore({ stationId: 'ST', now: () => 0 });
    store.apply({
      type: 'catch_up',
      as_of_seq: 1,
      state: { kds_station: { station_id: 'ST', day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 2, lane_count: 2 }, now: [], details: [] } },
    });
    function Live() {
      const v = useSyncExternalStore(store.subscribe, store.snapshot);
      return <LaneControl lanes={v.station!.lanes} stationId="ST" api={api([], () => ({ ok: false, error: { kind: 'network' } }))} up />;
    }
    m = mount();
    m.render(<Live />);
    expect(lanesText()).toBe('Lanes: 2 of 2 on');
    // another lane screen (or the Pass) turned a lane off
    act(() => store.apply({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'LanesSet', schema_version: 1, payload: { station_id: 'ST', lanes_on: 1, lane_count: 2 } } }));
    expect(lanesText()).toBe('Lanes: 1 of 2 on');
  });
});
