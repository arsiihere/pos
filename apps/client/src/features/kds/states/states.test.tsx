import 'fake-indexeddb/auto';
import type { LineDetail } from '@pos/domain';
import type { KdsStationBody } from '@pos/events';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubClock } from '../../../app/hub-clock';
import { flush, mount, reply, type Mounted } from '../../../../test/dom';
import type { SocketLike } from '../../alerts/socket';
import { fakeTimers, recordingSink } from '../../alerts/test-fakes';
import { KdsApp } from '../KdsApp';

// 03b v1.0.8 §3.3, §3.10, Q-44 (K4; frames 03b-F01 KdsDayNotStarted, 03b-B07 KdsArchived, 03b-C09 header): the screen
// states on a live KDS, from frames, without a reconnect.

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  frame(obj: unknown): void {
    this.readyState = 1;
    act(() => this.onmessage?.({ data: JSON.stringify(obj) }));
  }
}

const ST = 'ST-TANDOOR';
const detail = (id: string): LineDetail => ({
  order_item_id: id,
  order_id: `O-${id}`,
  station_id: ST,
  point_id: 'P1',
  identifier: { kind: 'table', label: `T-${id}` },
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
});
const body = (o: Partial<KdsStationBody>): KdsStationBody => ({
  station_id: ST,
  day_open: true,
  sound_volume: 70,
  has_printer: false,
  lanes: { lanes_on: 2, lane_count: 2 },
  now: [],
  details: [],
  ...o,
});
const ev = (event_type: string, payload: Record<string, unknown> = {}) => ({ type: 'event', seq: 5, event: { event_id: `E-${event_type}`, event_type, schema_version: 1, payload } });

let m: Mounted;
let sockets: FakeSocket[];
const calls: Array<[string, unknown]> = [];
beforeEach(() => {
  sockets = [];
  calls.length = 0;
});
afterEach(() => m?.unmount());

async function open(first: KdsStationBody, cfg: { is_archived?: boolean } = {}) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init?.body === undefined ? undefined : JSON.parse(init.body as string)]);
    if (url === '/auth/station') return reply(200, { data: { session_token: 'SS', session_id: 'SID', station_id: ST } });
    if (url === '/queries/branch-config')
      return reply(200, { data: { snapshot: { stations: [{ station_id: ST, name: 'Tandoor', completion_mode: 'two_tap', station_type: 'slot', is_archived: cfg.is_archived ?? false }] }, hub_time: { now_ms: 1_000_000, utc_offset_ms: 0 } } });
    return reply(200, { data: { command_id: 'C', event_ids: [], result: { started: ['A'] } } });
  });
  const timers = fakeTimers();
  m = mount();
  m.render(
    <KdsApp
      page={{ meta: { tenantId: 'T', branchId: 'B', branchName: 'Gulberg', hubNowMs: 1_000_000, utcOffsetMs: 0 }, clock: createHubClock({ now_ms: 1_000_000, utc_offset_ms: 0 }, () => 0) }}
      fetch={fetch}
      timers={timers}
      sink={recordingSink(timers)}
      readKey={async (k) => ({ token: 'DEV', device_id: 'D-K1', device_type: 'kds' })[k] ?? null}
      createSocket={() => {
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      }}
    />,
  );
  await flush(12);
  sockets[0]!.frame({ type: 'catch_up', as_of_seq: 1, state: { kds_station: first } });
  await flush(12);
}

describe('[03b §3.3] KDS screen states', () => {
  it('[03b Q-44] BusinessDayOpened leaves "Day not started", BusinessDayClosed enters it, without reconnect', async () => {
    await open(body({ day_open: false }));
    expect(m.text()).toContain('Day not started');
    expect(m.text()).toContain('Tandoor'); // the header stays
    expect(m.container.querySelectorAll('main button, .kfull button')).toHaveLength(0);
    expect(m.buttons().some((b) => b.textContent === 'Lane Off')).toBe(false); // no button at all
    sockets[0]!.frame(ev('BusinessDayOpened', { business_date: '2026-11-13' }));
    expect(m.text()).not.toContain('Day not started');
    expect(m.text()).toContain('Nothing to cook right now');
    expect(m.button('Lane Off')).toBeTruthy();
    sockets[0]!.frame(ev('BusinessDayClosed'));
    expect(m.text()).toContain('Day not started');
    expect(sockets).toHaveLength(1);
  });

  it('[03b §3.10] station_notice archived → banner, open rows still work', async () => {
    await open(body({ now: [{ ...detail('A'), stage: 'added', fired_at: 999_000, started_at: null, mark: null, done_undone: false }] }));
    expect(m.container.querySelector('.kbn')).toBeNull();
    sockets[0]!.frame({ type: 'station_notice', station_id: ST, kind: 'archived', open_lines: 3 });
    expect(m.container.querySelector('.kbn.c-warn')?.textContent).toBe('Station archived — finish open tickets3 open');
    m.click(m.button('Start'));
    await flush();
    expect(calls.some(([url, b]) => url === '/commands/start-item' && (b as { payload: unknown }).payload !== undefined)).toBe(true);
    // the lines are gone → the banner goes
    sockets[0]!.frame(ev('ItemServed', { order_item_ids: ['A'], source: 'tap' }));
    expect(m.container.querySelector('.kbn')).toBeNull();
  });

  it('[03b §8] header: station name from branch-config, lanes, Live; the coming-up strip', async () => {
    await open(body({ now: [{ ...detail('A'), stage: 'cooking', fired_at: 999_000, started_at: 999_000, mark: null, done_undone: false }] }));
    expect(m.container.querySelector('.kbar__st strong')?.textContent).toBe('Tandoor');
    expect(m.container.querySelector('.kbar .st')?.textContent).toBe('Lanes: 2 of 2 on');
    expect(m.container.querySelector('.kbar .live')?.textContent).toBe('Live');
    expect(m.container.querySelector('.kcu')?.textContent).toBe('Coming up2Naan');
  });
});
