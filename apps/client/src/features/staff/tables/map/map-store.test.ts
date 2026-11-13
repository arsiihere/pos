import { describe, expect, it } from 'vitest';
import { fakeTimers } from '../../../alerts/test-fakes';
import { createLiveBus } from '../../shell/live';
import type { TableMapBody, TablesApi } from '../contracts';
import { createMapStore } from './map-store';

// 02a v1.1.6 §8 Table map (Q-5, Q-35): the map from catch-up and frame-driven `table-map` reads; no timer.

const tile = (table_id: string) => ({
  table_id,
  name: table_id,
  seats: 4,
  archived: false,
  state: 'FREE' as const,
  seating_id: null,
  party_size: null,
  primary_table_id: null,
  joined_table_names: [],
  holder: null,
  assignee: null,
  lock: null,
  opened_at: null,
  bill_requested_at: null,
  live_order_count: 0,
});
const body = (as_of_seq: number, ...ids: string[]): TableMapBody => ({
  as_of_seq,
  floors: [{ floor_id: 'F1', name: 'Ground', archived: false, zones: [{ zone_id: null, name: null, tables: ids.map(tile) }] }],
});

const ev = (seq: number, event_type: string) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload: {} } });

function setup() {
  const timers = fakeTimers();
  const live = createLiveBus();
  const reads: Array<(b: TableMapBody) => void> = [];
  const tables = {
    tableMap: () =>
      new Promise((resolve) => {
        reads.push((data) => resolve({ ok: true, data }));
      }),
  } as unknown as TablesApi;
  const store = createMapStore({ tables, live, timers });
  live.connection(true);
  live.frame({ type: 'catch_up', as_of_seq: 10, state: { tables: body(10, 'T1') } });
  return { timers, live, reads, store };
}
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

describe('[02a §8 Table map] map store', () => {
  it('[02a §8 Table map] catch_up.state.tables replaces the map', () => {
    const { live, store } = setup();
    expect(store.current()?.as_of_seq).toBe(10);
    expect(store.tile('T1')?.name).toBe('T1');
    expect(store.tile('T9')).toBeNull();
    live.frame({ type: 'catch_up', as_of_seq: 30, state: { tables: body(30, 'T2') } });
    expect(store.tile('T1')).toBeNull();
    expect(store.tile('T2')).not.toBeNull();
  });

  it('[02a Q-5] any table frame except TableLockTouched, any order frame of orders/audiences.ts and BillClosed → one table-map read, debounced 250 ms', () => {
    const types = [
      'TableOpened', 'TableLocked', 'TableLockReleased', 'TableHolderChanged', 'TableMoved', 'TablesMerged', 'SeatingSplit', 'BillRequested', 'TableCleaned',
      'OrderPlaced', 'ItemAdded', 'OrderLinesAdded', 'ItemRemoved', 'ItemVoided', 'ItemServed', 'ItemReturned', 'ItemsReleased', 'OrderBoosted',
      'OrderCancelled', 'OrderFoodServed', 'OrderFoodCleared', 'OrdersBilled', 'LineWeightSet', 'OrderContactSet', 'LineComped', 'BillClosed',
    ];
    for (const type of types) {
      const { live, reads, timers } = setup();
      live.frame(ev(11, type));
      live.frame(ev(12, type));
      live.frame(ev(13, type));
      timers.advance(249);
      expect(reads, type).toHaveLength(0);
      timers.advance(1);
      expect(reads, type).toHaveLength(1);
    }
  });

  it('[02a Q-5] TableLockTouched triggers no read', () => {
    const { live, reads, timers } = setup();
    live.frame(ev(11, 'TableLockTouched'));
    timers.advance(10_000);
    expect(reads).toHaveLength(0);
  });

  it('[02a Q-35] ItemStarted, ItemDone, ItemDoneUndone, FireDispatched and SlipWarned trigger no read', () => {
    const { live, reads, timers } = setup();
    ['ItemStarted', 'ItemDone', 'ItemDoneUndone', 'FireDispatched', 'SlipWarned', 'ZoneStockSet', 'AlertRaised'].forEach((t, i) => live.frame(ev(11 + i, t)));
    timers.advance(10_000);
    expect(reads).toHaveLength(0);
  });

  it('[02a Q-5] reconnect and visibilitychange→visible each trigger one read', async () => {
    const { live, reads, timers } = setup();
    live.connection(false);
    live.connection(true);
    timers.advance(250);
    expect(reads).toHaveLength(1);
    reads[0]?.(body(10, 'T1'));
    await settle();
    live.visibility('hidden');
    timers.advance(250);
    expect(reads).toHaveLength(1);
    live.visibility('visible');
    timers.advance(250);
    expect(reads).toHaveLength(2);
  });

  it('[02a Q-5] a reply older than a read-triggering frame seen meanwhile is dropped; a lock touch or kitchen frame does not drop it', async () => {
    const { live, reads, timers, store } = setup();
    let notified = 0;
    store.subscribe(() => (notified += 1));
    live.frame(ev(11, 'TableOpened'));
    timers.advance(250);
    live.frame(ev(12, 'TableLockTouched'));
    live.frame(ev(13, 'ItemStarted'));
    reads[0]?.(body(11, 'OK'));
    await settle();
    expect(store.tile('OK')).not.toBeNull();
    expect(notified).toBe(1);
    // a triggering frame in flight: the reply is dropped
    live.frame(ev(14, 'TableOpened'));
    timers.advance(250);
    live.frame(ev(15, 'TableCleaned'));
    reads[1]?.(body(14, 'STALE'));
    await settle();
    expect(store.tile('STALE')).toBeNull();
    expect(notified).toBe(1);
  });

  it('[02a Q-5] a triggering frame during a read schedules exactly one follow-up read after it', async () => {
    const { live, reads, timers, store } = setup();
    live.frame(ev(11, 'TableOpened'));
    timers.advance(250);
    live.frame(ev(12, 'TableOpened'));
    live.frame(ev(13, 'TableMoved'));
    timers.advance(1000);
    expect(reads).toHaveLength(1); // not while the first is in flight
    reads[0]?.(body(11, 'A'));
    await settle();
    expect(store.tile('A')).toBeNull(); // 11 < 13
    expect(reads).toHaveLength(1);
    timers.advance(250);
    expect(reads).toHaveLength(2);
    reads[1]?.(body(13, 'B'));
    await settle();
    expect(store.tile('B')).not.toBeNull();
    timers.advance(10_000);
    expect(reads).toHaveLength(2);
  });

  it('[02a Q-5] no timer: no read while no frame arrives (fake clock, 10 min)', () => {
    const { reads, timers } = setup();
    timers.advance(10 * 60_000);
    expect(reads).toHaveLength(0);
    expect(timers.pending()).toBe(0);
  });

  it('[02a Q-5] a failed read keeps the last map; dispose stops the store', async () => {
    const timers = fakeTimers();
    const live = createLiveBus();
    let calls = 0;
    const tables = { tableMap: async () => { calls += 1; return { ok: false, error: { kind: 'network' } }; } } as unknown as TablesApi;
    const store = createMapStore({ tables, live, timers });
    live.frame({ type: 'catch_up', as_of_seq: 5, state: { tables: body(5, 'T1') } });
    live.frame(ev(6, 'TableOpened'));
    timers.advance(250);
    await settle();
    expect(calls).toBe(1);
    expect(store.tile('T1')).not.toBeNull();
    store.dispose();
    live.frame(ev(7, 'TableOpened'));
    timers.advance(250);
    expect(calls).toBe(1);
  });

  it('[02a §8 Table map] a screen that mounts after the catch-up starts from the last tables part', () => {
    const live = createLiveBus();
    live.frame({ type: 'catch_up', as_of_seq: 4, state: { tables: body(4, 'T7') } });
    const store = createMapStore({ tables: {} as TablesApi, live, timers: fakeTimers() });
    expect(store.tile('T7')).not.toBeNull();
  });
});
