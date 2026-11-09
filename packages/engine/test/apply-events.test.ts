// 03a §7.1, AD-28 (task 18c): applyEvents(state, events) copies the maps once and folds into that private copy. It changes
// no result: the folds compared here read JSON too, so map key order counts, as it does for a reader that walks a map. The
// generated full day is in day.perf.test.ts.
import { createHash } from 'node:crypto';
import type { PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anAlertClosed, anEngineConfigApplied, anItemAdded, anOrderBatch, aStockAdded, aStockConsumed, aStockReleased, aStockReserved, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { foldNamed } from '../src/apply-event';
import * as engine from '../src/index';
import { applyEvent, applyEvents, buildEngineState, initialEngineState, type ApplyOptions, type EngineLine, type EngineState } from '../src/index';
import { BatchMaps, exitedOrderIds, FoldScope } from '../src/lifecycle';
import { slipDueOf, upkeepSlips } from '../src/slip';
import { deepFreeze } from './batch-kit';
import { generateDay, runDay, twoDayLog } from './sim/index';

const sha = (x: unknown): string => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const json = (s: EngineState): string => JSON.stringify(s);
const NON_STRICT: ApplyOptions = { strict: false };

const perEvent = (state: EngineState, events: readonly PosEvent[], opts?: ApplyOptions): EngineState => events.reduce((s, e) => applyEvent(s, e, opts), state);

function chunksOf<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Folded in chunks: every chunk's result against the per-event fold at the same place, as text (key order) and as a value.
function expectSameByChunks(start: EngineState, events: readonly PosEvent[], size: number, opts?: ApplyOptions): void {
  let batched = start;
  let single = start;
  for (const chunk of chunksOf(events, size)) {
    batched = applyEvents(batched, chunk, opts);
    single = perEvent(single, chunk, opts);
    expect(batched).toEqual(single);
    expect(json(batched)).toBe(json(single));
  }
}

function checkUpkeep(s: EngineState): void {
  expect(s.slip_due).toEqual(slipDueOf(s));
  const vals = Object.values(s.slip_due);
  expect(s.next_alert_due_at).toBe(vals.length === 0 ? null : Math.min(...vals));
}

// ---- a hostile log: the day's real events, with writer bugs and legal surprises between them, seeded ------------------

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const THREE_HOURS = 3 * 3_600_000;

function hostileLog(seed: number, orders = 30, density = 0.15): PosEvent[] {
  const r = prng(seed);
  const day = runDay(generateDay(seed, { orders }));
  let state = initialEngineState();
  let n = 0;
  const log: PosEvent[] = [];
  const stamp = (e: PosEvent, at: number): PosEvent => {
    n++;
    return { ...e, recorded_at: at, occurred_at: at, seq: 1_000_000 + n, event_id: `01Z${String(n).padStart(23, '0')}` };
  };
  const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(r() * list.length)];
  const envelope = (at: PosEvent, event_type: string, stream_id: string, payload: Record<string, unknown>): PosEvent => ({ ...at, event_type, stream_id, payload, schema_version: 1 });

  const makers: Array<(at: PosEvent, line: EngineLine | undefined, other: EngineLine | undefined) => PosEvent[]> = [
    // Writes its lines into the fold's copy, then finds the group id wrong: the classic write-then-throw.
    (at) => anOrderBatch({ order_id: `BADG${n}`, recorded_at: at.recorded_at, seq: 1, lines: [{ order_item_id: `BADGL${n}` }], order: { groups: [{ group_id: `BADG${n}:7`, target_land_ms: at.recorded_at + 60_000, promise_ms: at.recorded_at + 240_000, order_item_ids: [`BADGL${n}`] }] } }).slice(0, 1),
    // A listed line not in order_item_ids: throws before it writes.
    (at) => {
      const placed = anOrderBatch({ order_id: `BADL${n}`, recorded_at: at.recorded_at, seq: 1 })[0]!;
      return [{ ...placed, payload: { ...placed.payload, order_item_ids: [] } }];
    },
    // A whole order on a station with a real id, one listed line naming no real station (dropped), then a deal line.
    (at, line) => {
      const station_id = line?.station_id ?? 'tandoor';
      const oid = `MIX${n}`;
      return anOrderBatch({
        order_id: oid,
        recorded_at: at.recorded_at,
        seq: 1,
        lines: [
          { order_item_id: `${oid}A`, item: { station_id, cook_time_ms: 60_000 }, line: { station_id } },
          { order_item_id: `${oid}B`, item: { station_id: 'GHOST', cook_time_ms: 60_000 }, line: { station_id: 'GHOST' } },
          { order_item_id: `${oid}C`, item: { station_id: null, cook_time_ms: null }, line: { station_id } },
        ],
        order: { groups: [{ group_id: `${oid}:0`, target_land_ms: at.recorded_at + 600_000, promise_ms: at.recorded_at + 780_000, order_item_ids: [`${oid}A`, `${oid}B`, `${oid}C`] }] },
      });
    },
    (at) => [envelope(at, 'ItemAdded', 'GHOST-ORDER', { ...anItemAdded().payload, order_id: 'GHOST-ORDER', order_item_id: 'GHOST' })],
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemAdded', line.order_id, { ...anItemAdded().payload, order_id: line.order_id, order_item_id: 'GHOST-LINE' })]),
    (at, line, other) => (line === undefined ? [] : [envelope(at, 'FireDispatched', line.station_id, { station_id: line.station_id, order_item_ids: [line.order_item_id, other?.order_item_id ?? 'GHOST', 'GHOST'], load_id: null, due_at: at.recorded_at, reason: 'pulled' })]),
    (at, line, other) => (line === undefined ? [] : [envelope(at, 'ReservationsShifted', line.station_id, { station_id: line.station_id, cause: 'overrun', shifts: [{ order_item_id: line.order_item_id, by_ms: 60_000 }, { order_item_id: line.order_item_id, by_ms: 120_000 }, { order_item_id: other?.order_item_id ?? 'GHOST', by_ms: 60_000 }] })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemStarted', r() < 0.5 ? line.order_id : 'WRONG-STREAM', { order_item_id: line.order_item_id, started_at: at.recorded_at, source: 'tap' })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemDone', line.order_id, { order_item_id: line.order_item_id, done_at: at.recorded_at, source: 'tap' })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemDoneUndone', line.order_id, { order_item_id: line.order_item_id })]),
    (at, line, other) => (line === undefined ? [] : [envelope(at, 'ItemServed', line.order_id, { order_item_ids: [line.order_item_id, other?.order_item_id ?? 'GHOST', 'GHOST'], source: 'tap' })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemVoided', line.order_id, { order_item_id: line.order_item_id, units: line.units })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemRemoved', line.order_id, { order_item_id: line.order_item_id })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemReturned', line.order_id, { order_item_id: line.order_item_id, replacement_order_item_id: 'GHOST' })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'ItemMovedToStock', line.order_id, { order_item_id: line.order_item_id })]),
    (at, line) => [envelope(at, 'OrderBoosted', line?.order_id ?? 'GHOST', { order_id: line?.order_id ?? 'GHOST' })],
    (at, line, other) => (line === undefined ? [] : [envelope(at, 'ItemsReleased', line.order_id, { order_id: line.order_id, released: [line.order_item_id], expedite: [other?.order_item_id ?? 'GHOST'] })]),
    (at, line) => [aStockSet({ recorded_at: at.recorded_at, payload: { stock_item_id: line?.station_id ?? 'K', on_hand: 2, unit: 'piece' } })],
    (at) => [aStockAdded({ recorded_at: at.recorded_at, payload: { stock_item_id: 'K', quantity: 1, unit: r() < 0.5 ? 'piece' : 'kg' } })],
    (at, line) => [aStockReserved({ recorded_at: at.recorded_at, stream_id: 'K', payload: { stock_item_id: 'K', order_item_id: line?.order_item_id ?? 'GHOST', quantity: 1 } })],
    (at, line) => [aStockReleased({ recorded_at: at.recorded_at, stream_id: 'K', payload: { stock_item_id: 'K', order_item_id: line?.order_item_id ?? 'GHOST', quantity: 1, reason: 'void' } })],
    (at, line) => [aStockConsumed({ recorded_at: at.recorded_at, stream_id: 'K', payload: { stock_item_id: 'K', order_item_id: line?.order_item_id ?? 'GHOST', quantity: 1 } })],
    (at, line) => [envelope(at, 'SlipWarned', 'H', { table_key: line === undefined ? 'GHOST-KEY' : (state.orders[line.order_id]?.table_key ?? 'GHOST-KEY'), order_ids: line === undefined ? ['GHOST'] : [line.order_id], estimated_land_ms: at.recorded_at, alert_id: `AL${n % 3}` })],
    (_at, line) => [anAlertClosed({ stream_type: 'order', stream_id: line?.order_id ?? 'GHOST', payload: { alert_id: `AL${n % 3}`, reason: 'done' } })],
    (at, line) => (line === undefined ? [] : [envelope(at, 'StationCapacitySet', line.station_id, { station_id: line.station_id, capacity_override: 1 + Math.floor(r() * 6) })]),
    (at, line) => (line === undefined ? [] : [envelope(at, 'StationPauseSet', line.station_id, { station_id: line.station_id, paused: r() < 0.5 })]),
    // The config path of the upkeep: it walks every order before and after, so it needs the true "before" of `orders`.
    () => {
      const config = state.config;
      if (config === null) return [];
      return [anEngineConfigApplied({ payload: { ...config, settings: { ...config.settings, slip_threshold_ms: 60_000 + Math.floor(r() * 300_000) } } as never })];
    },
    () => [aBusinessDayClosed()],
    () => [aBusinessDayOpened({ payload: { business_date: '2026-11-08', stock_units: {}, draws: {} } })],
  ];

  const push = (e: PosEvent): void => {
    try {
      state = applyEvent(state, e, NON_STRICT);
      log.push(e);
    } catch {
      // A throw in both modes (test 'parity of a throw' below): the log goes on without it.
    }
  };

  for (const real of day.events) {
    if (r() < density) {
      const ids = Object.keys(state.lines);
      const line = ids.length === 0 ? undefined : state.lines[pick(ids)!];
      const other = ids.length === 0 ? undefined : state.lines[pick(ids)!];
      // A jump puts the removal step in front of the bad event: the rollback must keep what the removal did.
      const at = real.recorded_at + (r() < 0.2 ? THREE_HOURS : 0);
      // The first one is always the write-then-throw, so no seed's log misses it.
      const maker = log.length === 0 || n === 0 ? makers[0]! : pick(makers)!;
      for (const e of maker({ ...real, recorded_at: at }, line, other)) push(stamp(e, at));
    }
    push(real);
  }
  return log;
}

// ---- the tests ---------------------------------------------------------------------------------------------------------

describe('[03a AD-28] applyEvents = the per-event fold', () => {
  const small = runDay(generateDay(7, { orders: 40 })).events;

  it('[03a AD-28] exported from the package; its internals are not', () => {
    expect(Object.keys(engine)).toContain('applyEvents');
    for (const name of ['foldNamed', 'FoldScope', 'BatchMaps']) expect(Object.keys(engine)).not.toContain(name);
  });

  it('[03a AD-28] after every prefix of a small day: same state, slip_due = its full recompute', () => {
    const events = runDay(generateDay(7, { orders: 12 })).events;
    let single = initialEngineState();
    let due = 0;
    events.forEach((e, i) => {
      single = applyEvent(single, e);
      const batched = applyEvents(initialEngineState(), events.slice(0, i + 1));
      expect(json(batched), `after event ${i} ${e.event_type}`).toBe(json(single));
      checkUpkeep(batched);
      if (Object.keys(batched.slip_due).length > 0) due++;
    });
    expect(due).toBeGreaterThan(0);
  });

  it('[03a AD-28] each event folded in the middle of a batch sees the right "before" (7-event windows from every position)', () => {
    let single = initialEngineState();
    small.forEach((e, i) => {
      const window = small.slice(i, i + 7);
      const batched = applyEvents(single, window);
      expect(json(batched), `window at ${i}`).toBe(json(perEvent(single, window)));
      checkUpkeep(batched);
      single = applyEvent(single, e);
    });
  });

  it.each([1, 7, 500, Number.MAX_SAFE_INTEGER])('[03a AD-28] the normal day at 200 orders, chunks of %d', (size) => {
    const events = runDay(generateDay(7, { orders: 200 })).events;
    expectSameByChunks(initialEngineState(), events, size);
  }, 120_000);

  it.each([
    ['seed 11, 200 orders', () => runDay(generateDay(11, { orders: 200 })).events],
    ['seed 3, 120 orders', () => runDay(generateDay(3, { orders: 120 })).events],
    ['overload, seed 7, 100 orders', () => runDay(generateDay(7, { orders: 100, overload: true })).events],
    ['EDF', () => runDay(generateDay(7, { orders: 60 }), { policy: 'edf' }).events],
    ['FIFO', () => runDay(generateDay(7, { orders: 60 }), { policy: 'fifo' }).events],
    ['two days on one log', () => twoDayLog(7, { orders: 60 }).events],
  ] as const)('[03a AD-28] fixture day: %s', (_name, log) => {
    const events = log();
    for (const size of [7, 500]) expectSameByChunks(initialEngineState(), events, size);
  }, 120_000);

  it('[03a AD-28] buildEngineState (chunks of 500) = the per-event fold', () => {
    const events = runDay(generateDay(7, { orders: 100 })).events;
    expect(events.length).toBeGreaterThan(1_000);
    expect(json(buildEngineState(events))).toBe(json(perEvent(initialEngineState(), events)));
    expect(json(buildEngineState(events, NON_STRICT))).toBe(json(perEvent(initialEngineState(), events, NON_STRICT)));
  }, 120_000);

  it('[03a AD-28] the run still writes the same events and reaches the same state (hash of seed 7, 200 orders)', () => {
    const run = runDay(generateDay(7, { orders: 200 }));
    expect(sha(run.events)).toBe('18f0dd7a8446930962642b75d00ef3690a7bc6d4e380a2e7a996417eff4fe289');
    // Task 18d: the events are the same; the state hash moved only for the two new line fields (with `expedited` and `rounds`
    // stripped it is the old 3a7ed3c2…).
    expect(sha(run.liveState)).toBe('ad0ddb7f155bf36430801facb281e746277e7f7b707f6557e74fe140e0ce70d2');
  }, 120_000);
});

describe('[03a AD-28, AD-8] non-strict: a bad event inside a batch leaves what the per-event fold leaves', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('[03a AD-28] hostile log, seed %d', (seed) => {
    const log = hostileLog(seed);
    const end = perEvent(initialEngineState(), log, NON_STRICT);
    // The property must not pass on a log that never got to the hard paths.
    const reasons = new Set(end.diagnostics.map((d) => (d.detail as { reason?: string }).reason));
    expect(reasons.has('group_id_invalid')).toBe(true);
    expect(reasons.size).toBeGreaterThan(2);
    for (const size of [1, 2, 7, 50, log.length]) expectSameByChunks(initialEngineState(), log, size, NON_STRICT);
    checkUpkeep(applyEvents(initialEngineState(), log, NON_STRICT));
  }, 120_000);

  it('[03a AD-28, AD-6] a fold that writes and then throws, with a removal step in front, mid-batch', () => {
    const run = runDay(generateDay(7, { orders: 10 }));
    const live = run.liveState;
    const after = run.events.at(-1)!.recorded_at + THREE_HOURS;
    const good = anOrderBatch({ order_id: 'GOOD', recorded_at: after, seq: 2_000_000, lines: [{ order_item_id: 'G1', item: { station_id: 'tandoor', cook_time_ms: 60_000 }, line: { station_id: 'tandoor' } }], order: { groups: [{ group_id: 'GOOD:0', target_land_ms: after + 600_000, promise_ms: after + 780_000, order_item_ids: ['G1'] }] } });
    const bad = anOrderBatch({ order_id: 'BAD', recorded_at: after, seq: 2_000_010, lines: [{ order_item_id: 'L9' }], order: { groups: [{ group_id: 'BAD:7', target_land_ms: after + 60_000, promise_ms: after + 240_000, order_item_ids: ['L9'] }] } })[0]!;
    // The bad event first (its removal step, on the input), then in the middle (on the private copy), then last.
    const invalid = (s: EngineState): number => s.diagnostics.filter((d) => d.kind === 'invalid_event').length;
    for (const list of [[bad, ...good], [...good, bad], [good[0]!, bad, good[1]!], [bad, bad, ...good, bad]]) {
      const batched = applyEvents(deepFreeze(live), deepFreeze(list), NON_STRICT);
      expect(json(batched)).toBe(json(perEvent(live, list, NON_STRICT)));
      expect(batched.lines.L9).toBeUndefined();
      expect(batched.orders.BAD).toBeUndefined();
      expect(batched.lines.G1).toBeDefined();
      expect(invalid(batched) - invalid(live)).toBe(list.filter((e) => e === bad).length);
    }
  });
});

describe('[03a AD-28] throws: what the per-event fold throws, at the same event', () => {
  const firstThrow = (events: readonly PosEvent[], opts?: ApplyOptions): { index: number; message: string } | null => {
    let s = initialEngineState();
    for (let i = 0; i < events.length; i++) {
      try {
        s = applyEvent(s, events[i]!, opts);
      } catch (e) {
        return { index: i, message: (e as Error).message };
      }
    }
    return null;
  };

  it.each([1, 2, 3, 4])('[03a AD-28] strict, hostile log, seed %d', (seed) => {
    const log = hostileLog(seed, 12, 0.3);
    const thrown = firstThrow(log);
    expect(thrown).not.toBeNull();
    const { index, message } = thrown!;
    expect(() => applyEvents(initialEngineState(), log)).toThrow(message);
    // The same event: the batch up to it folds, and one more throws.
    expect(json(applyEvents(initialEngineState(), log.slice(0, index)))).toBe(json(perEvent(initialEngineState(), log.slice(0, index))));
    expect(() => applyEvents(initialEngineState(), log.slice(0, index + 1))).toThrow(message);
  }, 120_000);

  it('[03a AD-28, §3.3 E-4] a headerless OrderLinesAdded on an absent order: strict both throw InvalidEvent(order_not_in_engine); non-strict both skip it with the same diagnostic', () => {
    const events = runDay(generateDay(7, { orders: 5 })).events;
    const added = { ...events[2]!, event_type: 'OrderLinesAdded', stream_id: 'ABSENT', payload: { order_id: 'ABSENT', order_item_ids: ['X'], groups: [], lines: [] } };
    const list = [...events.slice(0, 3), added, ...events.slice(3)];
    expect(() => perEvent(initialEngineState(), list)).toThrow('invalid event (order_not_in_engine) for line X');
    expect(() => applyEvents(initialEngineState(), list)).toThrow('invalid event (order_not_in_engine) for line X');
    const batch = applyEvents(initialEngineState(), list, NON_STRICT);
    expect(json(batch)).toBe(json(perEvent(initialEngineState(), list, NON_STRICT)));
    expect(batch.diagnostics.filter((d) => d.detail.reason === 'order_not_in_engine').map((d) => d.event_id)).toEqual([added.event_id]);
  });

  it('[03a AD-28] a throw leaves the input as it was', () => {
    const events = runDay(generateDay(7, { orders: 10 })).events;
    const state = deepFreeze(perEvent(initialEngineState(), events.slice(0, 40)));
    const text = json(state);
    const bad = anOrderBatch({ order_id: 'BAD', recorded_at: events[40]!.recorded_at, seq: 1, order: { groups: [{ group_id: 'BAD:7', target_land_ms: 1, promise_ms: 2, order_item_ids: ['L1'] }] } })[0]!;
    expect(() => applyEvents(state, [...events.slice(40, 60), bad])).toThrow('group_id_invalid');
    expect(json(state)).toBe(text);
  });
});

describe('[03a AD-28, §2.1] pure at the boundary', () => {
  const events = runDay(generateDay(7, { orders: 40 })).events;

  it('[03a AD-28] frozen inputs: never written, and a state handed back is never written by a later call', () => {
    // Every state a call hands back is frozen and kept, then the fold goes on from it: a write into a kept map would throw,
    // and a kept state's text would change.
    const kept: Array<{ state: EngineState; text: string }> = [];
    let s = deepFreeze(initialEngineState());
    for (const chunk of chunksOf(events, 25)) {
      s = deepFreeze(applyEvents(s, deepFreeze(chunk)));
      kept.push({ state: s, text: json(s) });
    }
    expect(json(s)).toBe(json(perEvent(initialEngineState(), events)));
    for (const { state, text } of kept) expect(json(state)).toBe(text);
  });

  it('[03a AD-28] not frozen either: a state kept across calls does not change, nor do two calls from one state meet', () => {
    const mid = applyEvents(initialEngineState(), events.slice(0, 200));
    const text = json(mid);
    const a = applyEvents(mid, events.slice(200, 300));
    const textA = json(a);
    expect(a.lines).not.toBe(mid.lines);
    expect(a.orders).not.toBe(mid.orders);
    const b = applyEvents(mid, events.slice(200, 260));
    expect(b.lines).not.toBe(a.lines);
    applyEvents(a, events.slice(300, 400));
    expect(json(mid)).toBe(text);
    expect(json(a)).toBe(textA);
    expect(json(b)).toBe(json(perEvent(mid, events.slice(200, 260))));
  });

  it('[03a AD-28] a late start from a kept state: the same list from the same state gives the same text twice', () => {
    const mid = applyEvents(initialEngineState(), events.slice(0, 300));
    expect(json(applyEvents(mid, events.slice(300)))).toBe(json(applyEvents(mid, events.slice(300))));
  });

  it('[03a AD-28] Object.is: an empty list, and a list that changes nothing, return the state itself', () => {
    const state = deepFreeze(perEvent(initialEngineState(), events.slice(0, 100)));
    expect(applyEvents(state, [])).toBe(state);
    const at = events[99]!;
    const absent = [
      { ...at, event_type: 'ItemStarted', stream_id: 'NOPE', payload: { order_item_id: 'NOPE', started_at: at.recorded_at, source: 'tap' } },
      { ...at, event_type: 'ItemDone', stream_id: 'NOPE', payload: { order_item_id: 'NOPE', done_at: at.recorded_at, source: 'tap' } },
      { ...at, event_type: 'SomethingElse', payload: {} },
    ];
    expect(perEvent(state, absent)).toBe(state);
    expect(applyEvents(state, absent)).toBe(state);
    expect(applyEvents(state, deepFreeze(absent))).toBe(state);
  });

  it('[03a AD-28] an unchanged list gives no change of map either: lines and orders keep their references', () => {
    const state = perEvent(initialEngineState(), events.slice(0, 100));
    const at = events[99]!;
    const next = applyEvents(state, [{ ...at, event_type: 'StationPauseSet', stream_id: 'tandoor', payload: { station_id: 'tandoor', paused: true } }]);
    expect(next).not.toBe(state);
    expect(next.lines).toBe(state.lines);
    expect(next.orders).toBe(state.orders);
  });

  it('[P-7] touchedStations by reference works across returned states', () => {
    const touched = (a: EngineState, b: EngineState): string[] => Object.keys({ ...a.stations, ...b.stations }).filter((id) => a.stations[id] !== b.stations[id]);
    let batched = perEvent(initialEngineState(), events.slice(0, 3));
    let single = batched;
    let moved = 0;
    for (const chunk of chunksOf(events.slice(3), 11)) {
      const nextBatched = applyEvents(batched, chunk);
      const nextSingle = perEvent(single, chunk);
      const ids = touched(batched, nextBatched);
      expect(ids).toEqual(touched(single, nextSingle));
      moved += ids.length;
      // Untouched stations keep their reference through a whole batch.
      for (const id of Object.keys(nextBatched.stations)) if (!ids.includes(id)) expect(nextBatched.stations[id]).toBe(batched.stations[id]);
      batched = nextBatched;
      single = nextSingle;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe('[03a §7.1, AD-28] one copy per batch', () => {
  // The batch loop of applyEvents, watching each fold: which folds copied the line map.
  function copies(events: readonly PosEvent[]): { folds: number; lineCopies: number; orderCopies: number; replans: number; removals: number } {
    const input = initialEngineState();
    let s = input;
    const own = new BatchMaps();
    const n = { folds: 0, lineCopies: 0, orderCopies: 0, replans: 0, removals: 0 };
    for (const e of events) {
      const { next, named } = foldNamed(s, e, {}, own);
      n.folds++;
      if (next.lines !== s.lines && own.lines !== null) n.lineCopies++;
      if (next.orders !== s.orders && own.orders !== null) n.orderCopies++;
      if (named.whole) n.replans++;
      if (exitedOrderIds(s, e.recorded_at).length > 0) n.removals++;
      s = upkeepSlips(s, next, e.recorded_at, named);
      own.adopt(input, s);
    }
    return n;
  }

  it('[03a AD-28] the batch map: "before" is the first value, rollback gives the sealed map back, a delete never touches it', () => {
    const line = (v: number): EngineLine => ({ fire_ms: v }) as unknown as EngineLine;
    const [a0, a1, a2, a3, a4, b0] = [0, 1, 2, 3, 4, 5].map(line) as [EngineLine, EngineLine, EngineLine, EngineLine, EngineLine, EngineLine];
    const map: Record<string, EngineLine> = { a: a0, b: b0 };
    const own = new BatchMaps();
    own.lines = map;
    const state = { ...initialEngineState(), lines: map };
    const scope = new FoldScope(own);
    expect(scope.writableLines(state)).toBe(map);
    scope.setLine(map, 'a', a1);
    scope.setLine(map, 'a', a2);
    expect(scope.lines.before(map, 'a')).toBe(a0);
    expect(scope.lines.before(map, 'b')).toBe(b0);
    expect(scope.lines.wroteInPlace).toBe(true);
    scope.seal();
    expect(scope.writableLines(state)).toBe(map);
    scope.setLine(map, 'a', a3);
    scope.setLine(map, 'a', a4);
    scope.setLine(map, 'n', a4);
    expect(scope.lines.before(map, 'n')).toBeUndefined();
    const copy = scope.deletableLines(state);
    expect(copy).not.toBe(map);
    delete copy.b;
    expect(map.b).toBe(b0);
    scope.rollback();
    expect(map).toEqual({ a: a2, b: b0 });
    expect(Object.keys(map)).toEqual(['a', 'b']);
    expect(scope.lines.before(map, 'a')).toBe(a0);
  });

  it('[03a AD-28] a fold with no re-plan and no removal writes the batch\'s map in place', () => {
    const n = copies(runDay(generateDay(7, { orders: 100 })).events);
    expect(n.folds).toBeGreaterThan(1_000);
    expect(n.lineCopies).toBeLessThanOrEqual(n.replans + n.removals);
    expect(n.orderCopies).toBeLessThanOrEqual(n.replans + n.removals);
    expect(n.lineCopies).toBeLessThan(n.folds / 2);
  }, 120_000);

  it('[03a AD-28] the input is read for one copy, not one per event', () => {
    const events = runDay(generateDay(7, { orders: 40 })).events;
    const state = perEvent(initialEngineState(), events.slice(0, 400));
    let gets = 0;
    const lines = new Proxy(state.lines, {
      get(target, key, receiver) {
        if (typeof key === 'string') gets++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    applyEvents({ ...state, lines }, events.slice(400, 600));
    expect(gets).toBeLessThan(2 * Object.keys(state.lines).length + 500);
  });
});

describe('[03a §3.3, §3.12] live = replay at an AlertClosed off the order stream (task 20 review)', () => {
  it('[03a §3.12] a hub-stream AlertClosed returns state itself and runs no removal step; live and replay remove at the same event', () => {
    const at = 1_761_000_000_000;
    const config = { ...anEngineConfigApplied({ recorded_at: at, occurred_at: at }), seq: 1 };
    const batch = anOrderBatch({ order_id: 'O1', recorded_at: at, seq: 2 });
    const served: PosEvent = { ...batch[1]!, event_type: 'ItemServed', seq: 10, event_id: 'served', recorded_at: at + 1_000, payload: { order_item_ids: ['L1'], source: 'tap' } };
    const late = at + 1_000 + 1_800_000 + 60_000;
    const hubClose: PosEvent = { ...anAlertClosed({ payload: { alert_id: 'AL-other', reason: 'done' } }), stream_type: 'hub', seq: 11, recorded_at: late, occurred_at: late };
    const log = [config, ...batch, served, hubClose];
    const before = applyEvents(initialEngineState(), log.slice(0, -1), NON_STRICT);
    expect(Object.keys(before.orders)).toEqual(['O1']);
    expect(applyEvent(before, hubClose, NON_STRICT)).toBe(before);
    const lists = engine.ENGINE_REPLAY_EVENTS as unknown as Record<string, readonly string[]>;
    const replayed = log.filter((e) => lists[e.stream_type]?.includes(e.event_type) === true);
    expect(replayed).not.toContain(hubClose);
    const live = applyEvents(initialEngineState(), log, NON_STRICT);
    expect(json(live)).toBe(json(applyEvents(initialEngineState(), replayed, NON_STRICT)));
    expect(json(live)).toBe(json(perEvent(initialEngineState(), log, NON_STRICT)));
    // the same close on the order stream is a listed fold: its removal step takes the exited order out
    const orderClose: PosEvent = { ...hubClose, stream_type: 'order', stream_id: 'O1' };
    expect(applyEvent(before, orderClose, NON_STRICT).orders).toEqual({});
  });
});
