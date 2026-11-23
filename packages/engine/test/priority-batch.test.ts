// 03a v1.2.10 §3.5.7 PR-4 (batch), PR-5, §3.3 BQ-4 (g), §3.6.1 item 1, §3.10 BQ-5 (STAB-7): batch priority with the BQ
// queue: the fold's option (first hidden load / idle gap / after the queue) by the load's fire, the cascade shed by
// arrival key, priority members kept first, the fire's pull-in, fragile food with priority_land_ms; tests 148 (priority
// part), 149 (priority part), 155, 156, 162 (batch part), 163, 164, 165, 175. Kit: batch-kit.ts (capacity 8, cook 3 min,
// freeze 2 min, keep 1 min, freshness 2 min). No timing asserts (AD-32): every time is simulated engine time.
import { anOrderBatch } from '@pos/events/testing';
import type { ItemAddedPayload, PosEvent } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { getTickIntents, planOrder, type EngineState, type FireDispatchedDraft } from '../src/index';
import { at, capacityB, COOK, deepFreeze, fold, loadOf, M, nextSeq, orderEv, proposedB, queueFryer, runRounds, startB, submitB, unitParts, voidB, type BItem } from './batch-kit';
import { capacityEv, fireEv } from './priority-kit';

const prioritizedB = (order_id: string, group_id: string, ids: string[], t: number): PosEvent =>
  orderEv('LinePrioritized', order_id, { order_id, group_id, order_item_ids: ids, delay_ms: 0, at_ms: t }, t);
// One part's own group (an immediate part is its own group, §3.2) made priority at t.
const prioritizePart = (s: EngineState, id: string, t: number): EngineState => fold(s, [prioritizedB(s.lines[id]!.order_id, s.lines[id]!.group_id, [id], t)]);
const members = (s: EngineState, id: string): string[] => loadOf(s, id)!.order_item_ids;
const queue = (s: EngineState): string[][] =>
  Object.values(s.stations.F!.loads)
    .sort((a, b) => a.booked.start - b.booked.start)
    .map((l) => l.order_item_ids);

// Z ×8 is COOKING on [0, 3); then the orders' parts in the queue at +0 (all hidden until +1).
function cooking(): EngineState {
  let s = queueFryer();
  s = submitB(s, 'OZ', unitParts('Z', 8), at(0)).state;
  return runRounds(s, [], { until: 0, startAfter: 0 }).state;
}

// A mixed order (02b: lines on the slot station S1 and the batch station F), planned at now and folded at now.
type MItem = BItem & { slot?: boolean };
function submitM(state: EngineState, order_id: string, items: MItem[], now: number): EngineState {
  const p = proposedB(order_id, items);
  const lines = p.lines.map((l, i) =>
    items[i]!.slot === true ? ({ ...l, station_id: 'S1', program_id: null, program_cook_time_ms: null, cook_time_ms: items[i]!.cook } as ItemAddedPayload & typeof l) : l,
  );
  const plan = planOrder(state, deepFreeze({ ...p, lines }), now, {});
  const events = anOrderBatch({
    order_id,
    recorded_at: now,
    seq: nextSeq(items.length),
    lines: items.map((i) => ({
      order_item_id: i.id,
      item:
        i.slot === true
          ? { station_id: 'S1', program_id: null, program_cook_time_ms: null, stock_program_id: null, stock_program_cook_time_ms: null, cook_time_ms: i.cook, prep_buffer_ms: 0, serve_mode: i.mode ?? 'sync', quantity: 1 }
          : { station_id: 'F', program_id: 'P1', program_cook_time_ms: i.cook, stock_program_id: null, stock_program_cook_time_ms: null, cook_time_ms: 999_999, prep_buffer_ms: 0, serve_mode: i.mode ?? 'sync', quantity: 1 },
      line: { station_id: i.slot === true ? 'S1' : 'F', max_early_ms: i.early ?? 60_000, from_stock: false, weight_pct: 100, max_late_ms: null },
    })),
    order: { order_type: 'dine_in', pickup_at_ms: null, groups: plan.groups },
  });
  return fold(state, events);
}

describe('[03a v1.2.10 §3.5.7 PR-4 batch] the cascade shed by arrival key', () => {
  // R1 = A1..A8, R2 = B1..B8 (full), R3 = [X1, Q1], all hidden at +0.5; X placed before Q.
  function rounds(): EngineState {
    let s = cooking();
    for (const [o, n] of [['A', 8], ['B', 8], ['X', 1], ['Q', 1]] as const) s = submitB(s, `O${o}`, unitParts(o, n), at(0)).state;
    expect(queue(s)).toEqual([
      ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8'],
      ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'],
      ['Q1', 'X1'],
    ]);
    return s;
  }

  it('[03a #156] X joins R1; R1 passes its latest (A8) to R2, R2 passes B8 to R3: R3 = [B8, Q1]; no fired or frozen round changes', () => {
    const s0 = rounds();
    const names = ['A1', 'B1', 'Q1'].map((x) => loadOf(s0, x)!.load_id);
    const s = prioritizePart(s0, 'X1', at(0.5));
    expect(s.lines.X1!.priority_at).toBe(at(0.5));
    expect(members(s, 'X1')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'X1']);
    expect(members(s, 'A8')).toEqual(['A8', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7']);
    expect(members(s, 'Q1')).toEqual(['B8', 'Q1']);
    // Names and queue places kept (BQ-1); A8 never cooks after a B part, B8 never after Q.
    expect(['X1', 'A8', 'Q1'].map((x) => loadOf(s, x)!.load_id)).toEqual(names);
    expect(s.orders.OX!.groups[s.lines.X1!.group_id]!.priority_land_ms).toBe(loadOf(s, 'X1')!.booked.end);
  });

  it('[03a #163] arrival key, not join order: a second priority line Y joins R1, which passes A7 to R2; R2 passes B7 (its latest by arrival), not A7 or A8', () => {
    let s = rounds();
    s = submitB(s, 'OY', unitParts('Y', 1), at(0.25)).state;
    expect(members(s, 'Y1')).toEqual(['Q1', 'X1', 'Y1']);
    s = prioritizePart(s, 'X1', at(0.5));
    s = prioritizePart(s, 'Y1', at(0.75));
    expect(members(s, 'Y1')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'X1', 'Y1']);
    expect(members(s, 'A7')).toEqual(['A7', 'A8', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
    expect(members(s, 'Q1')).toEqual(['B7', 'B8', 'Q1']);
    // An addition's parts arrive at its own recorded_at, so they rank after an order placed before it.
    expect(s.lines.Y1!.arrived_at).toBe(at(0.25));
    expect(s.lines.Q1!.arrived_at).toBe(at(0));
  });

  it('[03a #175 (1), (3)] a full load of priority members only is skipped; X joins R2, which passes B8 on; a frozen load never takes or passes a member', () => {
    let s = rounds();
    for (let k = 1; k <= 8; k += 1) s = prioritizePart(s, `A${k}`, at(0.25) + k);
    expect(members(s, 'A1')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
    s = prioritizePart(s, 'X1', at(0.5));
    expect(members(s, 'A1')).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
    expect(members(s, 'X1')).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'X1']);
    expect(members(s, 'Q1')).toEqual(['B8', 'Q1']);
    // (3) At +1.5 R1 (fire +3) is frozen: a new priority part of R3 skips it and joins R2 (fire +6).
    let f = rounds();
    f = submitB(f, 'OW', unitParts('W', 1), at(1)).state;
    const r1 = loadOf(f, 'A1')!;
    f = prioritizePart(f, 'W1', at(1.5));
    expect(loadOf(f, 'A1')).toEqual(r1);
    expect(members(f, 'W1')).toContain('W1');
    expect(loadOf(f, 'W1')!.load_id).toBe(loadOf(rounds(), 'B1')!.load_id);
  });

  it('[03a #175 (2)] 8 → 4 on a hidden load of 6 priority parts and 1 other: it keeps o1–o4; o5, o6 and the other go on, none ahead of a higher rank', () => {
    let s = cooking();
    for (const o of ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'N']) s = submitB(s, `O${o}`, unitParts(o, 1), at(0)).state;
    for (let k = 1; k <= 6; k += 1) s = prioritizePart(s, `P${k}1`, at(0.25) + k);
    expect(members(s, 'P11')).toEqual(['N1', 'P11', 'P21', 'P31', 'P41', 'P51', 'P61']);
    s = fold(s, [capacityB(4, at(0.5))]);
    expect(members(s, 'P11')).toEqual(['P11', 'P21', 'P31', 'P41']);
    expect(members(s, 'P51')).toEqual(['N1', 'P51', 'P61']);
  });
});

describe('[03a v1.2.10 §3.5.7 PR-4 batch, B-3, M-4, M-5] the option by the load\'s fire', () => {
  it('[03a #162 batch] the frozen Next load "Naan ×8 (T5 ×3, T6 ×5)" keeps its 8 members; T2\'s naan joins the first hidden load', () => {
    let s = cooking();
    s = submitB(s, 'OT5', unitParts('T5', 3), at(0)).state;
    s = submitB(s, 'OT6', unitParts('T6', 5), at(0)).state;
    s = submitB(s, 'OT2', unitParts('T2', 2), at(0)).state;
    s = submitB(s, 'OT7', unitParts('T7', 8), at(0)).state;
    const next = loadOf(s, 'T51')!;
    expect(next.order_item_ids).toHaveLength(8);
    // At +1.5 the Next load (fire +3) is frozen; T2's parts sit in the first hidden load.
    s = prioritizePart(s, 'T21', at(1.5));
    expect(loadOf(s, 'T51')).toEqual(next);
    expect(loadOf(s, 'T21')!.fire_ms).toBeGreaterThan(at(1.5) + 2 * M);
    expect(loadOf(s, 'T21')!.load_id).toBe(loadOf(s, 'T22')!.load_id);
  });

  it('[03a #164] idle gap before a held round: X forms a new load in the gap and fires now; H\'s booking does not move; a later naan never cooks ahead of X', () => {
    // Q1, Q2 (8 units each, cook 8) hold the tandoor until +16; H (a pickup at +20) is held to fire at +17; X (cook 3)
    // arrives at +0.5 and joins H's load (a new load would land at +23). Q1 and Q2 are voided at +1: the tandoor is idle.
    let s = queueFryer();
    s = submitB(s, 'OQ1', [{ id: 'Q1', cook: 8 * M, mode: 'immediate', units: 8 }], at(0)).state;
    s = submitB(s, 'OQ2', [{ id: 'Q2', cook: 8 * M, mode: 'immediate', units: 8 }], at(0)).state;
    s = submitB(s, 'OH', unitParts('H', 2, { mode: 'sync', early: 2 * M }), at(0), { pickup_at_ms: at(20) }).state;
    s = submitB(s, 'OX', unitParts('X', 1), at(0.5)).state;
    const h = loadOf(s, 'H1')!;
    expect(h.booked.start).toBeGreaterThan(at(15)); // held to the pickup (keep cushion included)
    expect(h.order_item_ids).toEqual(['H1', 'H2', 'X1']);
    s = fold(s, [voidB('OQ1', 'Q1', 8, at(1)), voidB('OQ2', 'Q2', 8, at(1))]);
    expect(loadOf(s, 'X1')!.load_id).toBe(h.load_id); // BQ-4: the room is not refilled, X is not moved by the voids
    s = prioritizePart(s, 'X1', at(1.5));
    expect(loadOf(s, 'X1')!.fire_ms).toBe(at(1.5));
    expect(loadOf(s, 'H1')!.booked).toEqual(h.booked);
    expect(members(s, 'H1')).toEqual(['H1', 'H2']);
    const fires = getTickIntents(s, at(1.5)).filter((d): d is FireDispatchedDraft => d.event_type === 'FireDispatched');
    expect(fires.map((d) => d.payload.order_item_ids)).toEqual([['X1']]);
    // A naan ordered after X joins X's load or a later one.
    const n = submitB(s, 'ON', unitParts('N', 1), at(1.5) + 1).state;
    expect(loadOf(n, 'N1')!.fire_ms).toBeGreaterThanOrEqual(loadOf(n, 'X1')!.fire_ms);
  });

  it('[03a #165] fire, not end: a sync naan (max_early 2 min) with lower bound +10 does not join the hidden load booked [+8, +11); it forms a load firing ≥ +10', () => {
    // H (pickup +11) holds [+8, +11) with room; G = karahi (S1, cook 15) + naan (F, early 2 min): T = +15, so the naan's
    // d_p = +12 and its fire bound +10 (an end bound would admit [+8, +11), which ends at +11 ≥ +10).
    let s = queueFryer();
    s = submitB(s, 'OH', unitParts('H', 2, { mode: 'sync', early: 2 * M }), at(0), { pickup_at_ms: at(11) }).state;
    s = submitM(s, 'OG', [{ id: 'kar', cook: 15 * M, slot: true }, { id: 'naan', cook: COOK, early: 2 * M }], at(0));
    // With the keep cushion H holds [+7, +10): it ends at the fire bound +10 but fires before it.
    expect(loadOf(s, 'H1')!.booked).toMatchObject({ start: at(7), end: at(10) });
    expect(loadOf(s, 'naan')!.load_id).not.toBe(loadOf(s, 'H1')!.load_id);
    s = fold(s, [prioritizedB('OG', s.lines.naan!.group_id, ['kar', 'naan'], at(0.5))]);
    expect(s.orders.OG!.groups[s.lines.naan!.group_id]!.priority_land_ms).toBe(at(15));
    expect(loadOf(s, 'naan')!.load_id).not.toBe(loadOf(s, 'H1')!.load_id);
    expect(loadOf(s, 'naan')!.fire_ms).toBeGreaterThanOrEqual(at(10));
  });
});

describe('[03a v1.2.10 §3.5.7 PR-5, re-review R-4, R-2] fragile and together', () => {
  // S1 (capacity 1 in the kit's config) is held by W's 30 min line from +0; G = karahi (S1, cook 12) + naan (F, early 2).
  function group(): EngineState {
    let s = fold(queueFryer(), [capacityEv('S1', 1, at(-1))]);
    s = submitM(s, 'OW', [{ id: 'w', cook: 30 * M, slot: true, mode: 'immediate' }], at(0));
    return submitM(s, 'OG', [{ id: 'kar', cook: 12 * M, slot: true }, { id: 'naan', cook: COOK, early: 2 * M }], at(0));
  }
  const gid = (s: EngineState): string => s.lines.naan!.group_id;
  const land = (s: EngineState, id: string): number => (s.lines[id]!.booked ?? loadOf(s, id)!.booked).end;

  it('[03a #155] priority at t: priority_land_ms = the karahi\'s earliest land; the naan fires no earlier than d_p − 2 min and lands with it, through a submit and a re-plan', () => {
    let s = group();
    expect(land(s, 'kar')).toBe(at(42));
    // W is voided at +1: S1 is free, so the karahi's earliest land from t = +2 is +14.
    s = fold(s, [voidB('OW', 'w', 1, at(1))]);
    const t = at(2);
    s = fold(s, [prioritizedB('OG', gid(s), ['kar', 'naan'], t)]);
    const P = s.orders.OG!.groups[gid(s)]!.priority_land_ms!;
    expect(P).toBe(t + 12 * M);
    expect(land(s, 'kar')).toBe(P);
    const d_p = P - COOK;
    expect(loadOf(s, 'naan')!.fire_ms).toBeGreaterThanOrEqual(d_p - 2 * M);
    expect(P - land(s, 'naan')).toBeLessThanOrEqual(2 * M);
    expect(land(s, 'naan')).toBeLessThanOrEqual(P);
    // A new order's submit and an unrelated re-plan keep both.
    s = submitB(s, 'ON', unitParts('N', 3), at(3)).state;
    s = fold(s, [voidB('ON', 'N3', 1, at(3.5))]);
    expect(s.orders.OG!.groups[gid(s)]!.priority_land_ms).toBe(P);
    expect(land(s, 'kar')).toBe(P);
    expect(P - land(s, 'naan')).toBeLessThanOrEqual(2 * M);
    expect(loadOf(s, 'naan')!.fire_ms).toBeGreaterThanOrEqual(d_p - 2 * M);
  });

  it('[03a #155 R-4] frozen sibling: the karahi frozen with its planned land +42; priority_land_ms ≥ +42 and the naan lands within 2 min of it', () => {
    let s = group();
    const t = at(29); // the karahi (fire +30) is frozen, the naan (held to +42) hidden
    s = fold(s, [prioritizedB('OG', gid(s), ['kar', 'naan'], t)]);
    const P = s.orders.OG!.groups[gid(s)]!.priority_land_ms!;
    expect(P).toBeGreaterThanOrEqual(at(42));
    expect(land(s, 'kar')).toBe(at(42));
    expect(at(42) - land(s, 'naan')).toBeLessThanOrEqual(2 * M);
  });

  it('[03a #155 R-2] sliding sibling: a fired-not-started karahi packed to land later gives priority_land_ms ≥ its live land', () => {
    let s = group();
    // W fired at +0 and never started (slides); the karahi fired early at +1, packed behind W: it lands at t + 30 + 12.
    s = fold(s, [fireEv('S1', ['w'], at(0)), fireEv('S1', ['kar'], at(1))]);
    const t = at(5);
    s = fold(s, [prioritizedB('OG', gid(s), ['kar', 'naan'], t)]);
    expect(s.orders.OG!.groups[gid(s)]!.priority_land_ms).toBeGreaterThanOrEqual(t + 42 * M);
    void startB;
  });
});

describe('[03a v1.2.10 §3.10 BQ-5, §3.6.1 item 1] priority members kept and pulled first', () => {
  it('[03a #149 priority] 8 → 4 with Y1 priority: the over-capacity load keeps Y1 and X1–X3; X4 moves on', () => {
    const orders = [['K', 8, 0], ['X', 4, 0], ['Y', 2, 0], ['V', 2, 0], ['Z', 3, 0]] as const;
    const run = runRounds(queueFryer(), orders, {
      until: 0.5,
      startAfter: 0,
      extra: (s, t) => [
        ...(t === at(0.25) ? [voidB('OV', 'V1', 1, t), voidB('OV', 'V2', 1, t)] : []),
        ...(t === at(0.25) + 15_000 ? [prioritizedB('OY', s.lines.Y1!.group_id, ['Y1'], t)] : []),
        ...(t === at(0.5) ? [capacityB(4, t)] : []),
      ],
    });
    expect(queue(run.state)).toEqual([['X1', 'X2', 'X3', 'Y1'], ['X4', 'Y2', 'Z1', 'Z2'], ['Z3']]);
  });

  it('[03a #148 priority] the fire\'s pull-in takes a priority member within the window first', () => {
    // Freshness 10 min: A's load fires at +3 with 2 free spots; B's load and C's load are within the window. C5 (in C's
    // load) is a priority member: it is pulled first, then B's oldest.
    const orders = [['Z', 8, 0], ['A', 8, 0], ['B', 8, 0], ['C', 8, 0]] as const;
    const voids = (_s: EngineState, t: number): PosEvent[] => (t === at(0.75) ? [voidB('OA', 'A1', 1, t), voidB('OA', 'A2', 1, t)] : []);
    let s = runRounds(queueFryer({ freshness: 10 * M }), orders, { until: 2.75, startAfter: 0, extra: voids }).state;
    expect(members(s, 'A3')).toEqual(['A3', 'A4', 'A5', 'A6', 'A7', 'A8']);
    const gid = s.lines.C5!.group_id;
    const o = s.orders.OC!;
    s = deepFreeze({
      ...s,
      lines: { ...s.lines, C5: { ...s.lines.C5!, priority_at: at(1) } },
      orders: { ...s.orders, OC: { ...o, groups: { ...o.groups, [gid]: { ...o.groups[gid]!, priority_delay_ms: 0, priority_land_ms: loadOf(s, 'C5')!.booked.end } } } },
    });
    const fire = getTickIntents(s, at(3)).find((d): d is FireDispatchedDraft => d.event_type === 'FireDispatched' && d.payload.order_item_ids.includes('A3'))!;
    // Without the priority rule the queue order pulls B1, B2.
    expect(fire.payload.order_item_ids).toEqual(['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B1', 'C5']);
  });
});
