import { describe, expect, it } from 'vitest';
import type { PointLine, PointOrder } from '../contracts';
import { createPassStore } from '../store';
import { readiness } from './readiness';

// 03b v1.0.8 §3.4 (Q-46, #74; P2): the Pass computes Ready / HOLD AT PASS itself from the live stages it holds, the
// lines' serve group and serve mode (HK2). Ready = no sync line here is added / cooking; HOLD = a done sync line waits
// for a sibling of its group (a hint, never a block); an immediate line never waits and is never held.

function line(id: string, stage: PointLine['stage'], over: Partial<PointLine> = {}): PointLine {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id: 'ST-T',
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: id,
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 60_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    stage,
    handed_over: false,
    ...over,
  };
}
const sync = (g: string) => ({ group_id: g, serve_mode: 'sync' as const });
const order = (lines: PointLine[], over: Partial<PointOrder> = {}): PointOrder => ({
  order_id: 'O1',
  identifier: { kind: 'table', label: 'T4' },
  placed_at: 0,
  lines,
  ready: null,
  ...over,
});

describe('[03b §3.4] Pass readiness', () => {
  it('[03b #74 Q-46] Ready (green) when no sync line here is added / cooking; HOLD AT PASS hint when a done line waits for a sync sibling of its group_id; an immediate line green alone', () => {
    // every sync line done → Ready
    expect(readiness(order([line('A', 'done', sync('G1')), line('B', 'done', sync('G1'))])).state).toBe('ready');
    // a done line of G1 waits for its cooking sibling → HOLD, and only that done line is held
    const hold = readiness(order([line('A', 'done', sync('G1')), line('B', 'cooking', sync('G1')), line('C', 'done', sync('G2'))]));
    expect(hold.state).toBe('hold');
    expect([...hold.held]).toEqual(['A']);
    // a sync line waiting with no done sibling → still cooking (no hint)
    expect(readiness(order([line('A', 'added', sync('G1')), line('B', 'done', sync('G2'))])).state).toBe('cooking');
    // an immediate done line beside a cooking sync group: never held, the card is not Ready
    const imm = readiness(order([line('A', 'done', { group_id: 'G9', serve_mode: 'immediate' }), line('B', 'cooking', sync('G1'))]));
    expect(imm.state).toBe('cooking');
    expect(imm.held.has('A')).toBe(false);
    // an immediate line cooking does not block a Ready of the done sync lines
    expect(readiness(order([line('A', 'cooking', { group_id: 'G9', serve_mode: 'immediate' }), line('B', 'done', sync('G1'))])).state).toBe('ready');
    // nothing done yet (all immediate, cooking) → cooking
    expect(readiness(order([line('A', 'cooking', { group_id: 'G9', serve_mode: 'immediate' })])).state).toBe('cooking');
    // a Ready already sent → sent; every line handed over → none
    expect(readiness(order([line('A', 'done', sync('G1'))], { ready: { at: 1, by: null } })).state).toBe('sent');
    expect(readiness(order([line('A', 'done', { ...sync('G1'), handed_over: true })])).state).toBe('none');
  });

  it('[03b Q-46] ItemsReleased sets its released / expedite lines immediate', () => {
    const store = createPassStore({ now: () => 1 });
    store.apply({
      type: 'catch_up',
      as_of_seq: 1,
      state: { point_view: { point_id: 'PT', stations: [], takeovers: [], orders: [order([line('A', 'done', sync('G1')), line('B', 'cooking', sync('G1'))])] } },
    });
    expect(readiness(store.snapshot().view!.orders[0]!).state).toBe('hold');
    store.apply({ type: 'event', seq: 2, event: { event_id: 'E2', event_type: 'ItemsReleased', schema_version: 1, payload: { order_id: 'O1', alert_id: null, released: ['A'], expedite: [] } } });
    const r = readiness(store.snapshot().view!.orders[0]!);
    expect(r.held.size).toBe(0);
    expect(r.state).toBe('cooking');
  });

  it('[03b Q-46] without group_id / serve_mode (before HK2) → no HOLD hint, each done line green alone', () => {
    const r = readiness(order([line('A', 'done'), line('B', 'cooking'), line('C', 'added')]));
    expect(r.state).toBe('ready');
    expect(r.held.size).toBe(0);
    expect(readiness(order([line('B', 'cooking')])).state).toBe('cooking');
  });
});
