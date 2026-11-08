// 03a test 94 (§3.12, G2 #3): the event types with a case in applyEvent's fold are exactly ENGINE_REPLAY_EVENTS, so live
// (which folds every appended event) and replay (which reads only the lists) cannot diverge. The fold's switch is
// exhaustive at the type level (apply-event.ts: a `never` default, and a case outside the union does not compile); here
// the source's case set and every registered event type are checked at run time.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PosEvent } from '@pos/events';
import { anEngineConfigApplied, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildEngineState, ENGINE_REPLAY_EVENTS, type ReplayEventType } from '../src/index';

const SRC = join(__dirname, '../src/apply-event.ts');
const EVENTS_DIR = join(__dirname, '../../events/src/events');

const union = [...ENGINE_REPLAY_EVENTS.order, ...ENGINE_REPLAY_EVENTS.station, ...ENGINE_REPLAY_EVENTS.stock, ...ENGINE_REPLAY_EVENTS.hub];

// Every event type @pos/events registers: each schema file is <EventType>.v<n>.ts, one defineEvent each.
function registeredTypes(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(EVENTS_DIR, { recursive: true, encoding: 'utf8' })) {
    const m = /([A-Za-z0-9]+)\.v\d+\.ts$/.exec(f);
    if (m !== null) out.add(m[1]!);
  }
  return [...out].sort();
}

// The string cases of `function fold(` in the source.
function foldCases(): string[] {
  const src = readFileSync(SRC, 'utf8');
  const start = src.indexOf('function fold(state');
  const end = src.indexOf('export function buildEngineState');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return [...src.slice(start, end).matchAll(/^\s*case '([A-Za-z0-9]+)':/gm)].map((m) => m[1]!).sort();
}

describe('ENGINE_REPLAY_EVENTS', () => {
  it('[03a #94] the case set of applyEvent = the union of ENGINE_REPLAY_EVENTS, no type twice', () => {
    expect(new Set(union).size).toBe(union.length);
    expect(foldCases()).toEqual([...union].sort());
    // Type level: a listed type is the switch's union member (a listed name that is not one fails tsc here).
    const first: ReplayEventType = 'StationPauseSet';
    expect(union).toContain(first);
  });

  it('[03a #94] the applyEvent cases equal the union of the lists, with StockTransferredOut', () => {
    // 03a v1.2 Q-5 (§3.12): on the stock list and in ReplayEventType (a name off the union fails tsc here).
    const moved: ReplayEventType = 'StockTransferredOut';
    expect(ENGINE_REPLAY_EVENTS.stock).toContain(moved);
    expect(foldCases()).toContain(moved);
    expect(foldCases()).toEqual([...union].sort());
    // Handled, so not the "other" path: a transfer of a counted stock item changes the state.
    const T = 1_761_000_000_000;
    const state = buildEngineState([{ ...anEngineConfigApplied(), event_type: 'StockSet', stream_type: 'stock', stream_id: 'K1', payload: { stock_item_id: 'K1', on_hand: 5, unit: 'piece' }, recorded_at: T, occurred_at: T, seq: 1 } as PosEvent]);
    const e = { ...anEngineConfigApplied(), event_type: moved, stream_type: 'stock', stream_id: 'K1', payload: { stock_item_id: 'K1', quantity: 2, zone_id: 'Z1' }, recorded_at: T + 1, occurred_at: T + 1, seq: 2 } as PosEvent;
    expect(Object.is(applyEvent(state, e), state)).toBe(false);
    expect(applyEvent(state, e).stock.K1!.on_hand).toBe(3);
  });

  it('[03a #94] every listed type is a registered event type', () => {
    const registered = registeredTypes();
    expect(registered.length).toBeGreaterThan(union.length);
    for (const t of union) expect(registered, t).toContain(t);
  });

  it('[03a #94] any other registered type returns the same object (Object.is) and removes nothing', () => {
    const T = 1_761_000_000_000;
    const state = buildEngineState([
      anEngineConfigApplied({ recorded_at: T, occurred_at: T, seq: 1 }),
      ...anOrderBatch({ order_id: 'O1', recorded_at: T, seq: 2, lines: [{ order_item_id: 'L1', item: { cook_time_ms: 60_000, serve_mode: 'immediate' } }] }),
    ]);
    const others = registeredTypes().filter((t) => !(union as readonly string[]).includes(t));
    expect(others.length).toBeGreaterThan(0);
    // Long past every exit clock: a handled fold would remove O1 here.
    const later = T + 86_400_000 * 30;
    for (const event_type of [...others, 'NotARegisteredType']) {
      const e = { ...anEngineConfigApplied(), event_type, payload: {}, recorded_at: later, occurred_at: later } as PosEvent;
      expect(Object.is(applyEvent(state, e), state), event_type).toBe(true);
      expect(Object.is(applyEvent(state, e, { strict: false }), state), event_type).toBe(true);
    }
  });

  it('[03a #94] every fold built so far is reached: a listed type on the state does not take the "other" path', () => {
    const T = 1_761_000_000_000;
    const state = buildEngineState([anEngineConfigApplied({ recorded_at: T, occurred_at: T, seq: 1 })]);
    const station = (event_type: string, payload: Record<string, unknown>): PosEvent => ({ ...anEngineConfigApplied(), event_type, payload, recorded_at: T + 1, occurred_at: T + 1 });
    expect(applyEvent(state, station('StationPauseSet', { station_id: 'S1', paused: true })).stations.S1!.paused).toBe(true);
    expect(applyEvent(state, station('StationCapacitySet', { station_id: 'S1', capacity_override: 2 })).stations.S1!.capacity_override).toBe(2);
  });
});
