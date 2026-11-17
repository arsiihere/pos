import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import type { KdsApi } from '../../kds/contracts';
import type { PointStation } from '../contracts';
import { createPassStore } from '../store';
import { StationStrip } from './StationStrip';

// 03b v1.0.8 §3.4, §3.7 (Q-44, Q-45; P2, frame 03b-C13 in Pass / PassTakeover / PassPortrait): the point's stations
// with their lanes and screen state. "No screen" only for a screenless station (HK2); "Screen offline" for a dark one;
// Lane Off / On by the KDS rule (AD-46), live from LanesSet.

const st = (station_id: string, name: string, over: Partial<PointStation> = {}): PointStation => ({
  station_id,
  name,
  lanes: { lanes_on: 1, lane_count: 1 },
  dark: false,
  ...over,
});

let m: Mounted;
afterEach(() => m?.unmount());

describe('[03b §3.4] Pass station strip', () => {
  it('[03b Q-45] strip "No screen" chip only for stations[].screenless; lanes per station live from LanesSet (Q-44)', async () => {
    const store = createPassStore({ now: () => 1 });
    store.apply({
      type: 'catch_up',
      as_of_seq: 1,
      state: {
        point_view: {
          point_id: 'PT',
          orders: [],
          takeovers: [],
          stations: [
            st('K', 'Karahi'),
            st('T', 'Tandoor', { lanes: { lanes_on: 2, lane_count: 2 } }),
            st('F', 'Fryer', { screenless: false }),
            st('C', 'Cold', { screenless: true }),
            st('D', 'Grill', { dark: true }),
          ],
        },
      },
    });
    const sent: unknown[] = [];
    const api = {
      setLaneState: (p: unknown) => {
        sent.push(p);
        return Promise.resolve({ ok: true as const, data: { lanes_on: 1, lane_count: 2, capacity: 4 } });
      },
    } as unknown as KdsApi;
    m = mount();
    const show = () => m.render(<StationStrip stations={store.snapshot().view!.stations} api={api} up />);
    show();
    const tiles = [...m.container.querySelectorAll('.pst')];
    expect(tiles.map((el) => el.className)).toEqual(['pst off', 'pst', 'pst off', 'pst off', 'pst dark off']);
    expect(tiles.map((el) => el.querySelector('.w')?.textContent ?? '')).toEqual(['', '2 of 2 lanes', '', 'No screen', 'Screen offline']);
    expect(m.text().match(/No screen/g)).toHaveLength(1);
    // Tandoor: all lanes on → Lane Off, Lane On disabled
    expect(m.button('Lane On').hasAttribute('disabled')).toBe(true);
    m.click(m.button('Lane Off'));
    await flush();
    expect(sent).toEqual([{ station_id: 'T', lanes_on: 1 }]);

    // a LanesSet from another device updates the strip
    store.apply({ type: 'event', seq: 5, event: { event_id: 'E5', event_type: 'LanesSet', schema_version: 1, payload: { station_id: 'T', lanes_on: 1, lane_count: 2 } } });
    show();
    expect(m.container.querySelectorAll('.pst')[1]!.querySelector('.w')?.textContent).toBe('1 of 2 lanes');
    expect(m.buttons().some((b) => b.textContent?.includes('Lane Off'))).toBe(false);
    expect(m.button('Lane On').hasAttribute('disabled')).toBe(false);
  });

  it('[03b §3.4] without run-pass (no api) or offline: no lane buttons / buttons off', () => {
    const stations = [st('T', 'Tandoor', { lanes: { lanes_on: 2, lane_count: 2 } })];
    m = mount();
    m.render(<StationStrip stations={stations} api={null} up />);
    expect(m.buttons()).toHaveLength(0);
    expect(m.text()).toContain('2 of 2 lanes');
    m.render(<StationStrip stations={stations} api={{} as KdsApi} up={false} />);
    expect(m.buttons().every((b) => b.hasAttribute('disabled'))).toBe(true);
  });
});
