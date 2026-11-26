// ⚠️ 03a v1.2.11 §3.3 "D7 Pass archive fold", §3.12, run 3 reconcile (a), test 195 (engine part): PassPointLinesMoved
// (03b v1.0.16 §6.22) applies each recorded move to its named line: point_id = to_point_id, carry_ms and alternates
// replaced by the recorded destination facts, from_point_id / from_point_name kept; stage and bookings preserved. The
// live fold, a snapshot-tail replay and a full rebuild consume the same facts, whatever the later routing config says.
import { parseEvent, type EngineConfig, type PosEvent } from '@pos/events';
import { aFireDispatched, anEngineConfigApplied, anItemStarted, anOrderBatch } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, buildEngineState, ENGINE_REPLAY_EVENTS, initialEngineState, type EngineState } from '../src/index';

const T0 = 1_761_000_000_000;
const M = 60_000;
const BASE = parseEvent(anEngineConfigApplied()).payload as unknown as EngineConfig;
const S1 = BASE.stations[0]!;

let seq = 1;
const stamp = (e: PosEvent, t: number): PosEvent => {
  const s = seq++;
  return { ...e, seq: s, event_id: `01JM${String(s).padStart(22, '0')}`, recorded_at: t, occurred_at: t };
};
const config = (t: number) =>
  stamp(
    anEngineConfigApplied({
      payload: {
        stations: [
          { ...S1, station_id: 'S1', capacity: 2, point_id: 'PA', carry_times: [{ point_id: 'PA', carry_ms: 0 }, { point_id: 'PB', carry_ms: 30_000 }, { point_id: 'PC', carry_ms: 60_000 }] },
          { ...S1, station_id: 'S2', capacity: 2, point_id: 'PA', carry_times: [{ point_id: 'PB', carry_ms: 15_000 }] },
        ],
      },
    }),
    t,
  );
const moved = (order_id: string, moves: Array<Record<string, unknown>>, t: number): PosEvent =>
  stamp({ ...anItemStarted(), stream_type: 'order', stream_id: order_id, event_type: 'PassPointLinesMoved', schema_version: 1, payload: { order_id, moves } }, t);

function fold(events: PosEvent[], from: EngineState = initialEngineState()): EngineState {
  let s = from;
  for (const e of events) s = applyEvent(s, e);
  return s;
}
const strip = (s: EngineState) => ({ ...s, diagnostics: [] });

describe('[03a #195] PassPointLinesMoved fold (D7)', () => {
  it('is on the order replay list', () => {
    expect(ENGINE_REPLAY_EVENTS.order).toContain('PassPointLinesMoved');
  });

  it('moves the named lines to the recorded point with its carry facts and keeps the source; stage and bookings unchanged; live = snapshot tail = full rebuild after a later routing change', () => {
    seq = 1;
    const head = [
      config(T0 - 60 * M),
      ...anOrderBatch({
        order_id: 'O1',
        recorded_at: T0,
        seq: 100,
        lines: [
          { order_item_id: 'A1', item: { station_id: 'S1', cook_time_ms: 10 * M, serve_mode: 'sync' }, line: { station_id: 'S1', point_id: 'PA', alternates: [{ station_id: 'S2', carry_ms: 0, home: false }] } },
          { order_item_id: 'A2', item: { station_id: 'S1', cook_time_ms: 5 * M, serve_mode: 'sync' }, line: { station_id: 'S1', point_id: 'PA' } },
        ],
        order: { order_type: 'takeaway', table_id: null, table_key: 'takeaway:O1', groups: [{ group_id: 'O1:0', target_land_ms: T0 + 40 * M, promise_ms: T0 + 43 * M, order_item_ids: ['A1', 'A2'] }] },
      }).map((e) => stamp(e, T0)),
      stamp(aFireDispatched({ stream_id: 'S1', payload: { station_id: 'S1', order_item_ids: ['A2'], load_id: null, due_at: T0 + M, reason: 'scheduled' } }), T0 + M),
      stamp({ ...anItemStarted(), stream_id: 'O1', payload: { order_item_id: 'A2', started_at: T0 + M, source: 'tap' } }, T0 + M),
    ];
    const before = fold(head);
    expect(before.lines.A1).toMatchObject({ point_id: 'PA', from_point_id: null, from_point_name: null });
    const snapshot = JSON.parse(JSON.stringify(before)) as EngineState;

    const move = moved('O1', [
      { order_item_id: 'A1', from_point_id: 'PA', from_point_name: 'Pass A', to_point_id: 'PB', carry_ms: 30_000, alternates: [{ station_id: 'S2', carry_ms: 15_000, home: false }] },
      { order_item_id: 'A2', from_point_id: 'PA', from_point_name: 'Pass A', to_point_id: 'PB', carry_ms: 30_000, alternates: [] },
    ], T0 + 2 * M);
    // A later config: routing now prefers PC (order types are not in the engine config); carry rows unchanged.
    const later = config(T0 + 3 * M);
    const tail = [move, later];

    const live = fold(tail, before);
    for (const id of ['A1', 'A2']) {
      expect(live.lines[id], id).toMatchObject({ point_id: 'PB', carry_ms: 30_000, from_point_id: 'PA', from_point_name: 'Pass A' });
      // stage and execution bookings preserved by the move itself
      const atMove = applyEvent(before, move).lines[id]!;
      expect({ ...atMove, point_id: 'PA', carry_ms: before.lines[id]!.carry_ms, alternates: before.lines[id]!.alternates, from_point_id: null, from_point_name: null }, id).toEqual(before.lines[id]);
    }
    expect(live.lines.A1!.alternates).toEqual([{ station_id: 'S2', carry_ms: 15_000, home: false }]);
    expect(live.lines.A2!.stage).toBe('cooking');

    const fromSnapshot = fold(tail, snapshot);
    const rebuilt = buildEngineState([...head, ...tail]);
    expect(strip(fromSnapshot)).toEqual(strip(live));
    expect(strip(rebuilt)).toEqual(strip(live));
  });

  it('a move naming an unknown line or another order\'s line changes nothing for it', () => {
    seq = 1;
    const head = [
      config(T0 - 60 * M),
      ...anOrderBatch({ order_id: 'O1', recorded_at: T0, seq: 100, lines: [{ order_item_id: 'A1', item: { station_id: 'S1' }, line: { station_id: 'S1', point_id: 'PA' } }] }).map((e) => stamp(e, T0)),
    ];
    const before = fold(head);
    const after = applyEvent(before, moved('O2', [{ order_item_id: 'A1', from_point_id: 'PA', from_point_name: 'Pass A', to_point_id: 'PB', carry_ms: 1, alternates: [] }, { order_item_id: 'ZZ', from_point_id: 'PA', from_point_name: 'Pass A', to_point_id: 'PB', carry_ms: 1, alternates: [] }], T0 + M));
    expect(after.lines).toEqual(before.lines);
  });
});
