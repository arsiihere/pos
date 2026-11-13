import { describe, expect, it, vi } from 'vitest';
import type { HubResult } from '../../../../api/hub-admin';
import { RESULT_HIDE_MS, createPendingHandovers, type MyRequest } from './pending-handovers';

// 02a §8 Handover waiting card, Q-14: the sender's device remembers { alert_id → table_id, seating_id, receiver } on
// send; after a reload it knows only what `my-requests` says (no receiver, table_code); a request_result frame →
// one my-requests read, diffed by alert_id.

const AT = 1_000_000;

function req(over: Partial<MyRequest> & { alert_id: string }): MyRequest {
  return {
    kind: 'table_handover',
    state: 'pending',
    close_reason: null,
    decision: null,
    answerer_name: null,
    raised_at: AT,
    waiting_ms: 0,
    ask_in_person: false,
    lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F4 + F5', requester_name: 'Ali' },
    ...over,
  };
}

function setup(replies: MyRequest[][]) {
  const store = createPendingHandovers();
  const queue = [...replies];
  const load = vi.fn(async (): Promise<HubResult<{ requests: MyRequest[] }>> => ({ ok: true, data: { requests: queue.shift() ?? [] } }));
  store.connect({ staff_id: 'ST-ALI', load, now: () => AT + 5 });
  return { store, load };
}

describe('[02a Q-14] pending handovers', () => {
  it('[02a Q-14] remember on send: table, seating and receiver; the hub row adds raised_at and ask_in_person', async () => {
    const { store } = setup([[req({ alert_id: 'H1', raised_at: AT - 1 }), req({ alert_id: 'C1', kind: 'comp' })]]);
    store.remember({ alert_id: 'H1', table_id: 'TB-F4', seating_id: 'SE-1', receiver_name: 'Sara' });
    expect(store.forTable('TB-F4', 'F4 + F5')).toMatchObject({ alert_id: 'H1', receiver_name: 'Sara', raised_at: AT + 5 });
    await store.refresh();
    expect(store.forTable('TB-F4', 'F4 + F5')).toMatchObject({ alert_id: 'H1', receiver_name: 'Sara', raised_at: AT - 1, ask_in_person: false });
    // only table_handover rows; another table has none
    expect(store.forTable('TB-F9', 'F9')).toBeNull();
  });

  it('[02a Q-14] after reload: "Waiting for an answer", attached by table_code = joined names', async () => {
    const { store } = setup([[req({ alert_id: 'H1' })]]);
    await store.refresh();
    expect(store.forTable('TB-F4', 'F4 + F5')).toMatchObject({ alert_id: 'H1', receiver_name: null, table_id: null });
    expect(store.forTable('TB-F4', 'F4')).toBeNull();
    // results of earlier requests are not news after a reload
    expect(store.results()).toEqual([]);
  });

  it('[02a Q-14] request_result → one my-requests read; the closed handover becomes a result and leaves the waiting list', async () => {
    const { store, load } = setup([
      [req({ alert_id: 'H1' }), req({ alert_id: 'H2', lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F7' } })],
      [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', close_reason: 'answered', answerer_name: 'Sara' }), req({ alert_id: 'H2', lock: { kind_label_key: 'alert.table_handover.lock', table_code: 'F7' } })],
    ]);
    store.remember({ alert_id: 'H1', table_id: 'TB-F4', seating_id: 'SE-1', receiver_name: 'Sara' });
    await store.refresh();
    const seen = vi.fn();
    store.subscribe(seen);
    await store.resultSeen('RES-1', 'F4 + F5', AT - 10);
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.forTable('TB-F4', 'F4 + F5')).toBeNull();
    expect(store.results()).toEqual([{ id: 'H1', outcome: 'declined', name: 'Sara', table_code: 'F4 + F5', table_id: 'TB-F4', seating_id: 'SE-1', at: AT + 5 }]);
    // the generic 01d result banner for RES-1 gives way to the handover result
    expect(store.isHandoverResult('RES-1')).toBe(true);
    expect(store.isHandoverResult('RES-2')).toBe(false);
    expect(seen).toHaveBeenCalled();
    store.dismiss('H1');
    expect(store.results()).toEqual([]);
  });

  it('[02a Q-14] accepted → "accepted" result named by the answerer; withdrawn by me → no result; obsolete → "closed"', async () => {
    const { store } = setup([
      [req({ alert_id: 'H1' }), req({ alert_id: 'H2' }), req({ alert_id: 'H3' })],
      [
        req({ alert_id: 'H1', state: 'approved', decision: 'accept', close_reason: 'answered', answerer_name: 'Sara' }),
        req({ alert_id: 'H2', state: 'withdrawn', close_reason: 'withdrawn' }),
        req({ alert_id: 'H3', state: 'closed', close_reason: 'obsolete' }),
      ],
    ]);
    await store.refresh();
    await store.refresh();
    expect(store.results().map((r) => [r.id, r.outcome, r.name])).toEqual([
      ['H1', 'accepted', 'Sara'],
      ['H3', 'closed', null],
    ]);
  });

  it('[02a §8 Handover waiting card] withdrawn() drops the entry at once; another person signing in starts empty', async () => {
    const { store } = setup([[req({ alert_id: 'H1' })]]);
    await store.refresh();
    store.withdrawn('H1');
    expect(store.forTable('TB-F4', 'F4 + F5')).toBeNull();
    store.remember({ alert_id: 'H5', table_id: 'TB-F4', seating_id: 'SE-1', receiver_name: 'Sara' });
    store.connect({ staff_id: 'ST-SARA', load: async () => ({ ok: true, data: { requests: [] } }), now: () => AT });
    expect(store.forTable('TB-F4', 'F4 + F5')).toBeNull();
  });

  it('[02a Q-14] a failed read changes nothing', async () => {
    const store = createPendingHandovers();
    store.connect({ staff_id: 'ST-ALI', load: async () => ({ ok: false, error: { kind: 'network' } }), now: () => AT });
    store.remember({ alert_id: 'H1', table_id: 'TB-F4', seating_id: 'SE-1', receiver_name: 'Sara' });
    await store.refresh();
    expect(store.forTable('TB-F4', null)).toMatchObject({ alert_id: 'H1' });
  });
  it('[02a Q-14] a request_result that arrives during a read is mapped by the next read (no double banner)', async () => {
    let release: () => void = () => {};
    const store = createPendingHandovers();
    const replies = [
      [req({ alert_id: 'H1' })],
      // read in flight when RES-1 arrives: the close is not in it yet
      [req({ alert_id: 'H1' })],
      [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })],
    ];
    let n = 0;
    store.connect({
      staff_id: 'ST-X',
      load: async () => {
        n += 1;
        if (n === 2) await new Promise<void>((r) => (release = r));
        return { ok: true, data: { requests: replies.shift() ?? [] } };
      },
      now: () => AT,
    });
    await store.refresh();
    const inFlight = store.refresh();
    const seen = store.resultSeen('RES-1', 'F4 + F5', AT);
    release();
    await inFlight;
    await seen;
    expect(store.results().map((r) => r.id)).toEqual(['H1']);
    expect(store.isHandoverResult('RES-1')).toBe(true);
  });

  it('[02a Q-14] a comp result (another table) is never taken for the handover that closed at the same time', async () => {
    const { store } = setup([[req({ alert_id: 'H1' })], [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })]]);
    await store.refresh();
    await store.resultSeen('RES-COMP', 'F9', AT);
    expect(store.results().map((r) => r.id)).toEqual(['H1']);
    expect(store.isHandoverResult('RES-COMP')).toBe(false);
  });

  it('[02a Q-14] an accepted result hides 4 s after it is first shown (never unseen); disconnect clears everything', async () => {
    vi.useFakeTimers();
    try {
      const { store } = setup([
        [req({ alert_id: 'H1' }), req({ alert_id: 'H2' })],
        [req({ alert_id: 'H1', state: 'approved', decision: 'accept', answerer_name: 'Sara' }), req({ alert_id: 'H2', state: 'approved', decision: 'accept', answerer_name: 'Bilal' })],
      ]);
      await store.refresh();
      await store.refresh();
      // H2 never got a slot: it waits; H1 was shown
      store.shown('H1');
      await vi.advanceTimersByTimeAsync(RESULT_HIDE_MS);
      expect(store.results().map((r) => r.id)).toEqual(['H2']);
      await vi.advanceTimersByTimeAsync(10 * RESULT_HIDE_MS);
      expect(store.results().map((r) => r.id)).toEqual(['H2']);
      store.shown('H2');
      store.shown('H2');
      await vi.advanceTimersByTimeAsync(RESULT_HIDE_MS);
      expect(store.results()).toEqual([]);
      store.remember({ alert_id: 'H9', table_id: 'TB-F4', seating_id: 'SE-1', receiver_name: 'Sara' });
      store.disconnect();
      expect(store.forTable('TB-F4', null)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('[02a Q-14] a request_result that comes after its result is already shown (the read in flight had the close) is matched to it', async () => {
    let release: () => void = () => {};
    const store = createPendingHandovers();
    const replies = [[req({ alert_id: 'H1' })], [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })], []];
    let n = 0;
    const load = vi.fn(async () => {
      n += 1;
      if (n === 2) await new Promise<void>((r) => (release = r));
      return { ok: true as const, data: { requests: replies.shift() ?? [] } };
    });
    store.connect({ staff_id: 'ST-Y', load, now: () => AT });
    await store.refresh();
    const inFlight = store.refresh();
    release();
    await inFlight;
    expect(store.results().map((r) => r.id)).toEqual(['H1']);
    // the result is on screen, unclaimed; its request_result now arrives: matched at once, no other read
    await store.resultSeen('RES-1', 'F4 + F5', AT);
    expect(store.isHandoverResult('RES-1')).toBe(true);
    expect(load).toHaveBeenCalledTimes(2);
    // a second request_result of the same table finds nothing unclaimed
    await store.resultSeen('RES-2', 'F4 + F5', AT - 10);
    expect(store.isHandoverResult('RES-2')).toBe(false);
  });
  it('[02a Q-14] another request\'s result on the same table (a void on F4 after a declined F4 handover) is never taken: it was raised after the device learnt the handover result', async () => {
    const { store } = setup([[req({ alert_id: 'H1' })], [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })]]);
    await store.refresh();
    await store.refresh();
    expect(store.results().map((r) => [r.id, r.at])).toEqual([['H1', AT + 5]]);
    await store.resultSeen('RES-VOID', 'F4 + F5', AT + 60_000);
    expect(store.isHandoverResult('RES-VOID')).toBe(false);
  });

  it('[02a Q-14] two unclaimed results of one table: a request_result takes the first one learnt at or after it', async () => {
    const store = createPendingHandovers();
    const times = [AT + 100, AT + 200];
    const replies = [[req({ alert_id: 'H1' }), req({ alert_id: 'H2' })], [req({ alert_id: 'H1', state: 'rejected', decision: 'decline' }), req({ alert_id: 'H2' })], [req({ alert_id: 'H2', state: 'rejected', decision: 'decline' })]];
    store.connect({ staff_id: 'ST-Z', load: async () => ({ ok: true, data: { requests: replies.shift() ?? [] } }), now: () => times.shift() ?? AT });
    await store.refresh();
    await store.refresh();
    await store.refresh();
    expect(store.results().map((r) => [r.id, r.at])).toEqual([['H1', AT + 100], ['H2', AT + 200]]);
    await store.resultSeen('RES-B', 'F4 + F5', AT + 150);
    await store.resultSeen('RES-A', 'F4 + F5', AT + 50);
    expect(store.isHandoverResult('RES-B')).toBe(true);
    expect(store.isHandoverResult('RES-A')).toBe(true);
  });
  it('[02a Q-14] several request_results waiting at once claim oldest raised_at first (the later void never takes the decline)', async () => {
    const store = createPendingHandovers();
    const replies = [[req({ alert_id: 'H1' })], [req({ alert_id: 'H1', state: 'rejected', decision: 'decline', answerer_name: 'Sara' })]];
    // the decline is learnt at AT + 10 s, after both results were raised
    store.connect({ staff_id: 'ST-W', load: async () => ({ ok: true, data: { requests: replies.shift() ?? [] } }), now: () => AT + 10_000 });
    await store.refresh();
    const a = store.resultSeen('RES-VOID', 'F4 + F5', AT + 5_000);
    const b = store.resultSeen('RES-DECL', 'F4 + F5', AT + 1_000);
    await Promise.all([a, b]);
    expect(store.isHandoverResult('RES-DECL')).toBe(true);
    expect(store.isHandoverResult('RES-VOID')).toBe(false);
  });

  it('[02a Q-14] a request_result raised before two unclaimed results takes the first one learnt', async () => {
    const store = createPendingHandovers();
    const times = [AT + 100, AT + 200];
    const replies = [[req({ alert_id: 'H1' }), req({ alert_id: 'H2' })], [req({ alert_id: 'H1', state: 'rejected', decision: 'decline' }), req({ alert_id: 'H2' })], [req({ alert_id: 'H2', state: 'rejected', decision: 'decline' })]];
    store.connect({ staff_id: 'ST-V', load: async () => ({ ok: true, data: { requests: replies.shift() ?? [] } }), now: () => times.shift() ?? AT });
    await store.refresh();
    await store.refresh();
    await store.refresh();
    await store.resultSeen('RES-EARLY', 'F4 + F5', AT);
    // H1 is claimed: a second early result takes H2, a third finds nothing
    await store.resultSeen('RES-EARLY-2', 'F4 + F5', AT + 150);
    expect(store.isHandoverResult('RES-EARLY')).toBe(true);
    expect(store.isHandoverResult('RES-EARLY-2')).toBe(true);
    await store.resultSeen('RES-EARLY-3', 'F4 + F5', AT);
    expect(store.isHandoverResult('RES-EARLY-3')).toBe(false);
  });
});
