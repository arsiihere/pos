import { describe, expect, it } from 'vitest';
import { checkHandover, checkWholeToken, gateOf, parseBillRows, type CandidateOrder } from './candidate';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a When / Ask, §6.16 `bill` + `unpaid_handover_approved`, §8 OR-7; D2):
// the ONE candidate check every hand-over place uses (ready tile, token drawer, parking / per-line sheet, Pass).

const due = (due_minor: number, approved?: boolean) => ({ bill: { state: 'due' as const, due_minor }, ...(approved === undefined ? {} : { unpaid_handover_approved: approved }) });
const paid = { bill: { state: 'paid' as const, due_minor: 0 } };

describe('gateOf (§6.16 bill, D2 approval at one amount)', () => {
  it('paid, due 0 (fully comped) and dine-in (bill null) are free', () => {
    expect(gateOf(paid)).toEqual({ kind: 'free' });
    expect(gateOf(due(0))).toEqual({ kind: 'free' });
    expect(gateOf(due(-50))).toEqual({ kind: 'free' });
    expect(gateOf({ bill: null })).toEqual({ kind: 'free' });
  });
  it('no row, or a row without `bill` (a hub before B2-1), is unknown — never free', () => {
    expect(gateOf(undefined)).toEqual({ kind: 'unknown' });
    expect(gateOf({})).toEqual({ kind: 'unknown' });
  });
  it('an absent row is free only when the caller says so (a billed parking order read after its placement)', () => {
    expect(gateOf(undefined, { absentFree: true })).toEqual({ kind: 'free' });
  });
  it('Due unapproved; Due approved by the hub flag', () => {
    expect(gateOf(due(1_190))).toEqual({ kind: 'due', due_minor: 1_190, approved: false });
    expect(gateOf(due(1_190, true))).toEqual({ kind: 'due', due_minor: 1_190, approved: true });
    expect(gateOf(due(1_190, false))).toEqual({ kind: 'due', due_minor: 1_190, approved: false });
  });
  it('a local approval (the UnpaidHandoverApproved amount) covers the due while it has not risen above it', () => {
    expect(gateOf(due(1_190), { approvedDue: 1_190 })).toMatchObject({ approved: true });
    expect(gateOf(due(1_000), { approvedDue: 1_190 })).toMatchObject({ approved: true });
    // D2: the due rose above the approved amount → a new approval is needed
    expect(gateOf(due(1_400), { approvedDue: 1_190 })).toMatchObject({ approved: false });
  });
  it('the hub flag wins over a local approval once the hub sends it', () => {
    expect(gateOf(due(1_190, false), { approvedDue: 1_190 })).toMatchObject({ approved: false });
  });
});

describe('checkHandover (§3.7a When, §8 OR-7, test 90)', () => {
  const order = (order_id: string, live_ids: string[], gate: CandidateOrder['gate']): CandidateOrder => ({ order_id, live_ids, gate });

  it('a paid order hands over in full', () => {
    expect(checkHandover([order('A', ['a1', 'a2'], gateOf(paid))], ['a1', 'a2'])).toEqual({ ok: true });
  });
  it('a Due, unapproved order cannot give its last live line — the newest such order is named for the ask', () => {
    expect(checkHandover([order('A', ['a1', 'a2'], gateOf(due(900)))], ['a1', 'a2'])).toEqual({ ok: false, reason: 'due', order_id: 'A', due_minor: 900 });
  });
  it('Due approved at the same due hands over', () => {
    expect(checkHandover([order('A', ['a1'], gateOf(due(900), { approvedDue: 900 }))], ['a1'])).toEqual({ ok: true });
  });
  it('due rose above the approved amount → blocked again', () => {
    expect(checkHandover([order('A', ['a1'], gateOf(due(1_200), { approvedDue: 900 }))], ['a1'])).toMatchObject({ ok: false, reason: 'due', order_id: 'A' });
  });
  it('a partial serve that leaves a live line in the Due order is allowed (Give ready items now)', () => {
    expect(checkHandover([order('A', ['a1', 'a2'], gateOf(due(900)))], ['a1'])).toEqual({ ok: true });
  });
  it('lines reserved by a pending Undo count as taken: a second tap cannot take the last line', () => {
    expect(checkHandover([order('A', ['a1', 'a2'], gateOf(due(900)))], ['a2'], new Set(['a1']))).toMatchObject({ ok: false, reason: 'due' });
  });
  it('a mixed Due token: approving one order (D2) leaves the whole-token send blocked by the other', () => {
    const orders = [order('A', ['a1'], gateOf(due(900))), order('B', ['b1'], gateOf(due(900), { approvedDue: 900 }))];
    expect(checkHandover(orders, ['a1', 'b1'])).toEqual({ ok: false, reason: 'due', order_id: 'A', due_minor: 900 });
    // only the approved order's lines: allowed
    expect(checkHandover(orders, ['b1'])).toEqual({ ok: true });
  });
  it('two Due, unapproved orders: the newest attempted one is named', () => {
    const orders = [order('A', ['a1'], gateOf(due(900))), order('B', ['b1'], gateOf(due(300)))];
    expect(checkHandover(orders, ['a1', 'b1'])).toEqual({ ok: false, reason: 'due', order_id: 'B', due_minor: 300 });
  });
  it('unknown billing blocks any send of that order (missing or stale facts)', () => {
    expect(checkHandover([order('A', ['a1', 'a2'], { kind: 'unknown' })], ['a1'])).toEqual({ ok: false, reason: 'unknown' });
    // an order the send does not touch does not matter
    expect(checkHandover([order('A', ['a1'], { kind: 'unknown' }), order('B', ['b1'], gateOf(paid))], ['b1'])).toEqual({ ok: true });
  });
  it('parking: a billed parking order is absent from open-orders → free when the read came after it', () => {
    expect(checkHandover([order('P', ['p1'], gateOf(undefined, { absentFree: true }))], ['p1'])).toEqual({ ok: true });
    expect(checkHandover([order('P', ['p1'], gateOf(due(400)))], ['p1'])).toMatchObject({ ok: false, reason: 'due', order_id: 'P' });
  });
});

describe('checkWholeToken (the ready tile: every order of the token, every line)', () => {
  it('blocks on any Due, unapproved order and names the newest', () => {
    expect(checkWholeToken([{ order_id: 'A', gate: gateOf(paid) }, { order_id: 'B', gate: gateOf(due(500)) }])).toEqual({ ok: false, reason: 'due', order_id: 'B', due_minor: 500 });
    expect(checkWholeToken([{ order_id: 'A', gate: gateOf(paid) }, { order_id: 'B', gate: gateOf(due(500), { approvedDue: 500 }) }])).toEqual({ ok: true });
  });
});

describe('parseBillRows (open-orders `bill`, `unpaid_handover_approved`)', () => {
  it('reads both fields, and leaves them out when the hub does not send them', () => {
    const read = parseBillRows({ orders: [{ order_id: 'A', order_type: 'takeaway', bill: { state: 'due', due_minor: 700 }, unpaid_handover_approved: true }, { order_id: 'B', order_type: 'parking' }] }, 5);
    expect(read?.at).toBe(5);
    expect(read?.rows.get('A')).toEqual({ order_type: 'takeaway', bill: { state: 'due', due_minor: 700 }, unpaid_handover_approved: true });
    expect(read?.rows.get('B')).toEqual({ order_type: 'parking' });
    expect(parseBillRows({}, 0)).toBeNull();
  });
});
