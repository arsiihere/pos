import { describe, expect, it, vi } from 'vitest';
import { createLiveBus } from '../../shell/live';
import { concerns, createLiveReader, ORDER_FRAMES, REFETCH_DEBOUNCE_MS, SEATING_FRAMES } from './refetch';

// 02b v1.0.11 §8 Table view (Q-6, H1; IR-6): open views read again on frames, debounced; no timer. The table view's
// orders part and the order view both read through this (OrdersPart.test / OrderView.test check their screens).

function fakeTimers() {
  let now = 0;
  const due: Array<{ at: number; fn: () => void; id: number }> = [];
  let next = 1;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++;
      due.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id: unknown) => {
      const i = due.findIndex((d) => d.id === id);
      if (i >= 0) due.splice(i, 1);
    },
    advance(ms: number) {
      now += ms;
      for (const d of due.filter((x) => x.at <= now)) {
        due.splice(due.indexOf(d), 1);
        d.fn();
      }
    },
  };
}

const ev = (seq: number, event_type: string, payload: Record<string, unknown>) => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload } });

describe('[02b Q-6] live re-read', () => {
  it('[02b Q-6] an order frame or ItemStarted / ItemDone / ItemDoneUndone / FireDispatched for an open view → one seating-orders read, debounced 250 ms; no Refresh line; "Updated {time}" only offline', async () => {
    for (const type of ['ItemStarted', 'ItemDone', 'ItemDoneUndone', 'FireDispatched', 'ItemServed', 'OrderBoosted', 'OpenOrderBillChanged']) expect(ORDER_FRAMES.has(type), type).toBe(true); // 02b v1.0.25 §6.19 (R3-M-8): + OpenOrderBillChanged
    const live = createLiveBus();
    const timers = fakeTimers();
    const query = vi.fn(async () => ({ ok: true as const, data: { orders: [], total_minor: 0 } }));
    const onAnswer = vi.fn();
    const orders = new Set(['O1']);
    const lines = new Set(['L1']);
    const reader = createLiveReader({ live, query, relevant: (e) => ORDER_FRAMES.has(e.event_type) && concerns(e.payload, orders, lines), onAnswer, ...timers });
    live.frame(ev(1, 'ItemStarted', { order_item_ids: ['L1'] }));
    live.frame(ev(2, 'ItemDone', { order_item_ids: ['L1'] }));
    live.frame(ev(3, 'ItemDoneUndone', { order_item_ids: ['L1'] }));
    live.frame(ev(4, 'FireDispatched', { order_ids: ['O1'] }));
    // another seating's line, a table frame outside the set: no read
    live.frame(ev(5, 'ItemServed', { order_item_ids: ['OTHER'] }));
    live.frame(ev(6, 'TableLockTouched', {}));
    timers.advance(REFETCH_DEBOUNCE_MS - 1);
    expect(query).not.toHaveBeenCalled();
    timers.advance(1);
    await Promise.resolve();
    expect(query).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(onAnswer).toHaveBeenCalledTimes(1);
    // reconnect and visible are triggers too; no timer otherwise
    live.connection(true);
    live.connection(false);
    live.connection(true);
    live.visibility('visible');
    timers.advance(REFETCH_DEBOUNCE_MS);
    expect(query).toHaveBeenCalledTimes(2);
    timers.advance(60_000);
    expect(query).toHaveBeenCalledTimes(2);
    reader.dispose();
    live.frame(ev(7, 'ItemDone', { order_item_ids: ['L1'] }));
    timers.advance(REFETCH_DEBOUNCE_MS);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('[02b Q-6] IR-6: a reply is dropped when a triggering frame came after its request; the follow-up read answers', async () => {
    const live = createLiveBus();
    const timers = fakeTimers();
    const replies: Array<(v: { ok: true; data: number }) => void> = [];
    const query = vi.fn(() => new Promise<{ ok: true; data: number }>((resolve) => replies.push(resolve)));
    const onAnswer = vi.fn();
    const reader = createLiveReader({ live, query, relevant: () => true, onAnswer, ...timers });
    const first = reader.read();
    live.frame(ev(1, 'ItemDone', {}));
    replies.shift()!({ ok: true, data: 1 });
    await first;
    expect(onAnswer).not.toHaveBeenCalled();
    timers.advance(REFETCH_DEBOUNCE_MS);
    replies.shift()!({ ok: true, data: 2 });
    await Promise.resolve();
    await Promise.resolve();
    expect(onAnswer).toHaveBeenCalledWith({ ok: true, data: 2 });
    // two reads in flight: only the newest answers
    const a = reader.read();
    const b = reader.read();
    replies[1]!({ ok: true, data: 4 });
    replies[0]!({ ok: true, data: 3 });
    await Promise.all([a, b]);
    expect(onAnswer).toHaveBeenLastCalledWith({ ok: true, data: 4 });
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('[05 row T-3 (6)] [05 #37b 02a half] the table view\'s table frames add SeatingReopened and BillClosed (the seating\'s state changes); order frames unchanged', () => {
    expect([...SEATING_FRAMES].sort()).toEqual(['BillClosed', 'SeatingReopened', 'SeatingSplit', 'TableMoved', 'TablesMerged']);
    expect(ORDER_FRAMES.has('SeatingReopened')).toBe(false);
    expect(ORDER_FRAMES.has('BillClosed')).toBe(false);
  });

  it('[05 rows Q-2, Q-4, Q-5, G-26] OrdersUnbilled and LineCompRemoved are order frames; OrdersCarriedOver is not (it changes nothing a view shows)', () => {
    expect(ORDER_FRAMES.has('OrdersUnbilled')).toBe(true);
    expect(ORDER_FRAMES.has('LineCompRemoved')).toBe(true);
    expect(ORDER_FRAMES.has('OrdersCarriedOver')).toBe(false);
    expect(concerns({ order_ids: ['O1'], bill_id: 'BL1' }, new Set(['O1']), new Set())).toBe(true);
    expect(concerns({ order_item_id: 'L1', units: 1, comp_minor: 100 }, new Set(), new Set(['L1']))).toBe(true);
  });

  it('[02b Q-6] concerns: by order id, line id, or a frame that names neither', () => {
    const o = new Set(['O1']);
    const l = new Set(['L1']);
    expect(concerns({ order_id: 'O1' }, o, l)).toBe(true);
    expect(concerns({ order_ids: ['O9', 'O1'] }, o, l)).toBe(true);
    expect(concerns({ order_item_id: 'L1' }, o, l)).toBe(true);
    expect(concerns({ order_item_ids: ['L9'] }, o, l)).toBe(false);
    expect(concerns({ order_id: 'O9' }, o, l)).toBe(false);
    expect(concerns({ station_id: 'X' }, o, l)).toBe(true);
  });
});
