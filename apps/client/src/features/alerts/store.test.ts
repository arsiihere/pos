import { describe, expect, it } from 'vitest';
import { createAlertStore, REMINDER_MS, URGENT_REPEAT_MS } from './store';
import { BASE_GAIN, STEP_UP_GAIN } from './sounds';
import { fakeTimers, recordingSink, view } from './test-fakes';

function setup(o: { alwaysOn?: boolean } = {}) {
  const timers = fakeTimers();
  const sink = recordingSink(timers);
  const store = createAlertStore({ sink, timers, alwaysOn: o.alwaysOn ?? false });
  return { timers, sink, store };
}

const requestResult = (outcome: 'approved' | 'rejected' | 'withdrawn' | 'obsolete' | 'overridden') =>
  view({
    alert_id: `R-${outcome}`,
    kind: 'request_result',
    family: 'info',
    set: 'recipient',
    outcome,
    lock: { kind_label_key: 'alert.request_result.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
  });

describe('[01d §8.3] sounds per family', () => {
  it('[01d §8.3] urgent: two-tone at once, then every 10 s until alert_seen, then one reminder per 2 min', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    expect(sink.played).toEqual([{ sound: 'urgent', gain: BASE_GAIN, at: 0 }]);
    timers.advance(URGENT_REPEAT_MS * 3);
    expect(sink.played.map((p) => p.at)).toEqual([0, 10_000, 20_000, 30_000]);

    timers.advance(5_000); // 35 s
    store.onSeen('A1');
    timers.advance(URGENT_REPEAT_MS * 3);
    expect(sink.played).toHaveLength(4); // no more 10 s repeats
    timers.advance(REMINDER_MS - URGENT_REPEAT_MS * 3);
    expect(sink.played.map((p) => p.at)).toEqual([0, 10_000, 20_000, 30_000, 155_000]);
    timers.advance(REMINDER_MS);
    expect(sink.played.at(-1)).toEqual({ sound: 'urgent', gain: BASE_GAIN, at: 275_000 });
  });

  it('[01d §8.3] urgent: alert_closed stops every repeat and drops the banner', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    store.onClosed({ type: 'alert_closed', alert_id: 'A1', reason: 'answered', decision: 'approve', by_name: 'Sana' });
    timers.advance(REMINDER_MS * 3);
    expect(sink.played).toHaveLength(1);
    expect(timers.pending()).toBe(0);
    const s = store.snapshot();
    expect(s.banners).toEqual([]);
    expect(s.rows[0]).toMatchObject({ state: 'closed', close_reason: 'answered', decision: 'approve', by_name: 'Sana' });
  });

  it('[01d §8.3] not seen by the escalation step → the 2-min reminder with one volume step-up', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    timers.advance(45_000);
    store.onAlert(view({ alert_id: 'A1', step: 1 })); // reminder step: one more sound, the 10 s repeat goes on
    timers.advance(75_000); // 120 s
    const before = sink.played.length;
    store.onAlert(view({ alert_id: 'A1', step: 2, escalation: true }));
    expect(sink.played.at(-1)).toEqual({ sound: 'urgent', gain: STEP_UP_GAIN, at: 120_000 });
    timers.advance(URGENT_REPEAT_MS * 6);
    expect(sink.played).toHaveLength(before + 1); // no 10 s repeat after the escalation step
    timers.advance(REMINDER_MS - URGENT_REPEAT_MS * 6);
    expect(sink.played.at(-1)).toEqual({ sound: 'urgent', gain: STEP_UP_GAIN, at: 240_000 });
    expect([BASE_GAIN, STEP_UP_GAIN]).toEqual([0.6, 0.8]); // CHANGES §4: 0.6 → 0.8
  });

  it('[01d §8.3] action: one double ding, no repeat; info: one chime, no repeat', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'B1', kind: 'ready_to_serve', family: 'action', set: 'recipient' }));
    store.onAlert(view({ alert_id: 'C1', kind: 'test_alert', family: 'info', set: 'recipient' }));
    timers.advance(REMINDER_MS * 5);
    expect(sink.played.map((p) => p.sound)).toEqual(['action', 'info']);
    // a later step of the action alert is one more ding (re-sent only by the next step)
    store.onAlert(view({ alert_id: 'B1', kind: 'ready_to_serve', family: 'action', set: 'recipient', step: 1 }));
    expect(sink.played.map((p) => p.sound)).toEqual(['action', 'info', 'action']);
  });

  it('[01d §8.3] a request_result plays rising when approved, falling when rejected (AD-82)', () => {
    const { sink, store } = setup();
    for (const o of ['approved', 'rejected', 'withdrawn', 'obsolete', 'overridden'] as const) store.onAlert(requestResult(o));
    expect(sink.played.map((p) => p.sound)).toEqual(['rising', 'falling', 'info', 'info']); // withdrawn: none
  });

  it('[01d §8.3] the same (alert_id, step) twice sounds once', () => {
    const { sink, store } = setup();
    store.onAlert(view({ alert_id: 'C1', kind: 'test_alert', family: 'info' }));
    store.onAlert(view({ alert_id: 'C1', kind: 'test_alert', family: 'info' }));
    expect(sink.played).toHaveLength(1);
  });

  it('[01d §8.3] always-on screens: one sound per step, then the badge only', () => {
    const { timers, sink, store } = setup({ alwaysOn: true });
    store.onAlert(view({ alert_id: 'A1' }));
    timers.advance(REMINDER_MS * 3);
    expect(sink.played).toHaveLength(1);
    store.onAlert(view({ alert_id: 'A1', step: 1 }));
    store.onAlert(view({ alert_id: 'A1', step: 2, escalation: true }));
    timers.advance(REMINDER_MS * 3);
    expect(sink.played.map((p) => p.at)).toEqual([0, 360_000, 360_000]);
    expect(timers.pending()).toBe(0); // the banners hid themselves; no repeat is waiting
    expect(store.snapshot().banners).toEqual([]);
    expect(store.snapshot().unseen).toBe(1);
  });

  it('[01d §8.3] urgent seen on another device (alert_seen) hides the banner at once', () => {
    const { store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    expect(store.snapshot().banners.map((b) => b.alert_id)).toEqual(['A1']);
    store.onSeen('A1');
    expect(store.snapshot().banners).toEqual([]);
    expect(store.snapshot().unseen).toBe(0);
  });

  it('[01d §8.3] action and info banners hide by themselves; urgent stays until opened', () => {
    const { timers, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    store.onAlert(view({ alert_id: 'B1', kind: 'ready_to_serve', family: 'action', set: 'recipient' }));
    store.onAlert(view({ alert_id: 'C1', kind: 'test_alert', family: 'info', set: 'recipient' }));
    expect(store.snapshot().banners.map((b) => b.alert_id)).toEqual(['C1', 'B1', 'A1']); // newest on top
    timers.advance(4_000);
    expect(store.snapshot().banners.map((b) => b.alert_id)).toEqual(['B1', 'A1']);
    timers.advance(2_000);
    expect(store.snapshot().banners.map((b) => b.alert_id)).toEqual(['A1']);
    timers.advance(REMINDER_MS);
    expect(store.snapshot().banners.map((b) => b.alert_id)).toEqual(['A1']);
    store.open('A1');
    expect(store.snapshot().banners).toEqual([]);
  });
});

describe('[01d §8.1] silent kind', () => {
  it('[01d §8.1] approval_receipt (silent) → no sound, no banner, badge only, never re-notified', () => {
    const { timers, sink, store } = setup();
    const receipt = view({ alert_id: 'S1', kind: 'approval_receipt', family: 'info', set: 'recipient', silent: true });
    store.onAlert(receipt);
    expect(sink.played).toEqual([]);
    expect(store.snapshot().banners).toEqual([]);
    expect(store.snapshot().unseen).toBe(1);
    expect(store.snapshot().rows.map((r) => r.alert_id)).toEqual(['S1']);

    // reconnect: a fresh store (nothing shown) still never re-notifies a silent row
    const again = setup();
    again.store.onCatchUp([{ ...receipt, seen_by_me: false, from_business_day: null }]);
    timers.advance(REMINDER_MS);
    again.timers.advance(REMINDER_MS);
    expect(again.sink.played).toEqual([]);
    expect(again.store.snapshot().banners).toEqual([]);
    expect(again.store.snapshot().unseen).toBe(1);
  });
});

describe('[01d #59 client] re-notify after a reconnect (m6)', () => {
  it('[01d #59 client] a lost alert frame, then a reconnect row not in the shown set and not seen_by_me → re-notified once', () => {
    const { timers, sink, store } = setup();
    // the frame for A1 step 0 was lost (hub crash between commit and send)
    store.onCatchUp([{ ...view({ alert_id: 'A1' }), seen_by_me: false, from_business_day: null }]);
    expect(sink.played).toEqual([{ sound: 'urgent', gain: BASE_GAIN, at: 0 }]);
    expect(store.snapshot().banners.map((b) => b.alert_id)).toEqual(['A1']);
    // a second reconnect with the same (alert_id, step) does not notify again
    store.onCatchUp([{ ...view({ alert_id: 'A1' }), seen_by_me: false, from_business_day: null }]);
    // and the live frame arriving late is the same step: no second sound
    store.onAlert(view({ alert_id: 'A1' }));
    expect(sink.played).toHaveLength(1);
    // the urgent 10 s repeat then resumes
    timers.advance(URGENT_REPEAT_MS);
    expect(sink.played).toHaveLength(2);
  });

  it('[01d #59 client] alerts_open rows (no escalation / set / seen_by_me) re-notify the same way; action once', () => {
    const { timers, sink, store } = setup();
    store.onCatchUp([
      { alert_id: 'B1', kind: 'ready_to_serve', family: 'action', step: 0, lock: { kind_label_key: 'alert.ready_to_serve.lock' }, raised_at: 0 },
    ]);
    timers.advance(REMINDER_MS);
    expect(sink.played.map((p) => p.sound)).toEqual(['action']);
  });

  it('[01d #59 client] a row already shown, or seen_by_me, or info is listed without a sound', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    store.onCatchUp([
      { ...view({ alert_id: 'A1' }), seen_by_me: false, from_business_day: null },
      { ...view({ alert_id: 'A2' }), seen_by_me: true, from_business_day: null },
      { ...view({ alert_id: 'C1', kind: 'test_alert', family: 'info', set: 'recipient' }), seen_by_me: false, from_business_day: null },
    ]);
    expect(sink.played).toHaveLength(1);
    expect(store.snapshot().rows.map((r) => r.alert_id).sort()).toEqual(['A1', 'A2', 'C1']);
    // A2 was seen elsewhere: the same state as alert_seen, so its 2-min reminder runs (§8.3)
    timers.advance(REMINDER_MS);
    // at 2 min: A1's 10 s repeat (never seen) and A2's first reminder
    expect(sink.played.filter((p) => p.at === REMINDER_MS).map((p) => p.sound)).toEqual(['urgent', 'urgent']);
  });

  it('[01d #59 client] a new step of a shown alert in the catch-up is re-notified once', () => {
    const { sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    store.onCatchUp([{ ...view({ alert_id: 'A1', step: 1 }), seen_by_me: false, from_business_day: null }]);
    expect(sink.played).toHaveLength(2);
  });

  it('[01d #59 client] an open alert missing from the catch-up was closed while away: no more sound', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    store.onCatchUp([]);
    timers.advance(REMINDER_MS * 2);
    expect(sink.played).toHaveLength(1);
    expect(store.snapshot().banners).toEqual([]);
    expect(store.snapshot().rows[0]).toMatchObject({ state: 'closed' });
  });

  it('[01d #59 client] a catch-up row with no card keeps the card the client already holds (AD-162/163)', () => {
    const { store } = setup();
    const card = { kind_label_key: 'alert.void_approval.card', table_code: '12', requester_name: 'Hamza', details: { amount: 220_000 } };
    store.onAlert(view({ alert_id: 'A1', card }));
    store.onCatchUp([{ alert_id: 'A1', kind: 'void_approval', family: 'urgent', step: 0, lock: { kind_label_key: 'alert.void_approval.lock' }, raised_at: 0 }]);
    expect(store.snapshot().rows[0]?.card).toEqual(card);
  });
});

describe('[01d #61 client] earlier business day (BF-4)', () => {
  it('[01d #61 client] a row with from_business_day → listed, no sound, no banner, no repeat', () => {
    const { timers, sink, store } = setup();
    store.onCatchUp([{ ...view({ alert_id: 'Y1' }), seen_by_me: false, from_business_day: '2026-11-01' }]);
    timers.advance(REMINDER_MS * 3);
    expect(sink.played).toEqual([]);
    expect(store.snapshot().banners).toEqual([]);
    expect(store.snapshot().rows[0]).toMatchObject({ alert_id: 'Y1', from_business_day: '2026-11-01', state: 'open' });
    expect(store.snapshot().unseen).toBe(1);
  });
});

describe('[01d §8.1] inbox rows', () => {
  it('[01d §8.1] the inbox query adds rows without any sound and keeps closed rows closed', () => {
    const { timers, sink, store } = setup();
    store.onInbox([
      { ...view({ alert_id: 'A1' }), seen_by_me: false, moved_to_name: null, for_staff_name: null, state: 'open', close_reason: null },
      { ...view({ alert_id: 'A2' }), seen_by_me: false, moved_to_name: null, for_staff_name: null, state: 'closed', close_reason: 'answered' },
    ]);
    timers.advance(REMINDER_MS);
    expect(sink.played).toEqual([]);
    expect(store.snapshot().unseen).toBe(1); // closed rows do not count
  });

  it('[01d §8.1] open() marks a row seen locally and moves an urgent alert to the 2-min reminder', () => {
    const { timers, sink, store } = setup();
    store.onAlert(view({ alert_id: 'A1' }));
    store.open('A1');
    timers.advance(URGENT_REPEAT_MS * 5);
    expect(sink.played).toHaveLength(1);
    expect(store.snapshot().unseen).toBe(0);
  });

  it('[01d §8.1] subscribers hear every change; dispose clears every timer', () => {
    const { timers, store } = setup();
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.onAlert(view({ alert_id: 'A1' }));
    expect(calls).toBe(1);
    const first = store.snapshot();
    expect(store.snapshot()).toBe(first); // stable between changes (useSyncExternalStore)
    off();
    store.onSeen('A1');
    expect(calls).toBe(1);
    store.dispose();
    expect(timers.pending()).toBe(0);
  });
});
