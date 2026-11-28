// 03a v1.2.11 test 190 (b) (PK-6, M-4, m-14; 02b-tk L-CLOSE-2): a priority placement (§3.5.7 PR-4) of another order pushes
// a waiting held line of a pickup order later → its key slips, as for a capacity drop (test 190 (a), slip.test.ts).
// PR-4 places a priority group by its latest fit and only reorders hidden lines, so the push needs both orders waiting:
// a capacity drop leaves the held drink first by deadline; the dine-in group then crosses its max delay and its priority
// placement takes the next free unit ahead of the drink.
import { describe, expect, it } from 'vitest';
import { getAlertIntents } from '../src/index';
import { at, capacityEv, fireEv, fold, kitchen, M, prioritize, startEv, submit } from './priority-kit';

describe('[03a #190 (b)] a priority placement pushes a waiting held line', () => {
  it('another order\'s PR-4 placement goes ahead of the held drink and pushes it later → takeaway:<order_id> slips', () => {
    const P = at(20);
    const KEY = 'takeaway:O1';
    let s = kitchen([{ station_id: 'S1', capacity: 2 }]);
    // Z (35 min) and Z2 (15 min) cook on both units from 0.
    ({ state: s } = submit(s, 'OZ', [{ id: 'Z', cook: 35 * M, mode: 'immediate' }, { id: 'Z2', cook: 15 * M, mode: 'immediate' }], at(0)));
    s = fold(s, [fireEv('S1', ['Z', 'Z2'], at(0)), startEv('OZ', 'Z', at(0)), startEv('OZ', 'Z2', at(0))]);
    // O1: a held 2-min drink for the pickup at +20; OA: a dine-in 10-min line with a 1-minute max delay.
    ({ state: s } = submit(s, 'O1', [{ id: 'D', cook: 2 * M, mode: 'immediate', maxDelay: null }], at(0), { order_type: 'takeaway', key: KEY, pickup_at_ms: P }));
    ({ state: s } = submit(s, 'OA', [{ id: 'A', cook: 10 * M, maxDelay: M }], at(0)));
    expect(s.lines.D!.booked!.end).toBeLessThanOrEqual(P);
    // one unit from +5: both wait behind Z; by deadline the drink is first
    s = fold(s, [capacityEv('S1', 1, at(5))]);
    expect(s.lines.D!.booked!.start).toBeLessThan(s.lines.A!.booked!.start);
    const drinkBefore = s.lines.D!.booked!.end;
    // the drink is late by less than the 30-min far cap of "No limit": only the dine-in group is due for priority
    const due = s.priority_due['OA:0'];
    expect(due).toBeDefined();
    const t = Math.max(due!, at(5));
    expect(s.priority_due['O1:0'] ?? Number.POSITIVE_INFINITY).toBeGreaterThan(t);
    const placed = prioritize(s, t);
    expect(placed.lines.A!.priority_at).toBe(t);
    expect(placed.lines.D!.priority_at).toBeNull();
    // the priority line goes first; the held drink is pushed later, past T_L + threshold
    expect(placed.lines.A!.booked!.start).toBeLessThan(placed.lines.D!.booked!.start);
    expect(placed.lines.D!.booked!.end).toBeGreaterThan(drinkBefore);
    expect(placed.lines.D!.booked!.end).toBeGreaterThan(P + 120_000);
    const slipDue = placed.slip_due[KEY];
    expect(slipDue).toBeDefined();
    const slips = getAlertIntents(placed, Math.max(slipDue!, t)).slips.filter((x) => x.table_key === KEY);
    expect(slips).toHaveLength(1);
    // ⚠️ Changed by 03a v1.2.12 (owner 2026-11-28): target = p − padding (180 s, the fixture's), promise = p
    expect(slips[0]).toMatchObject({ order_ids: ['O1'], target: P - 180_000, promise: P });
  });
});
