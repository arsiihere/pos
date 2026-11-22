// 03a v1.2.10 §3.3 BQ-1–BQ-6, §3.5.3, §3.5.6, §3.10 BQ-5, §10.3g tests 143–151 (STAB-6): the unfired loads of a batch
// station are a queue kept through every re-plan; rounds in arrival order. Kit: batch-kit.ts (queueFryer, unitParts,
// runRounds). No timing asserts (AD-32): every time below is simulated engine time.
import { parseEvent } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { applyEvents, buildEngineState, getAlertIntents, type EngineState } from '../src/index';
import { at, etaB, loadOf, queueConfig, queueFryer, roundsOf, runRounds, submitB, unitParts, voidB, M, type RoundFire } from './batch-kit';

const ORDERS_143 = [['A', 5, 0], ['B', 10, 1], ['C', 2, 2], ['D', 2, 3], ['E', 4, 5], ['F', 3, 7], ['G', 2, 9], ['H', 1, 12]] as const;

describe('[03a v1.2.10 §3.3 BQ-6] per-unit parts on a batch station', () => {
  it('[03a #145] "3 now, 7 next": B ×10 fills the 3 free spots of A\'s hidden load and forms the next; C ×3 after it', () => {
    let s = queueFryer();
    // a cooking load of 8 on [0, 3)
    s = submitB(s, 'OZ', unitParts('Z', 8), at(0)).state;
    s = runRounds(s, [], { until: 0, startAfter: 0 }).state;
    expect(Object.keys(s.stations.F!.loads)).toEqual([]);
    const a = submitB(s, 'OA', unitParts('A', 5), at(0));
    expect(loadOf(a.state, 'A1')!.booked).toMatchObject({ start: at(3), end: at(6) });
    const b = submitB(a.state, 'OB', unitParts('B', 10), at(1));
    for (const k of [1, 2, 3]) expect(etaB(b.plan, `B${k}`), `B${k}`).toBe(at(6));
    for (const k of [4, 5, 6, 7, 8, 9, 10]) expect(etaB(b.plan, `B${k}`), `B${k}`).toBe(at(9));
    expect(loadOf(b.state, 'B1')!.load_id).toBe(loadOf(b.state, 'A1')!.load_id);
    expect(loadOf(b.state, 'B4')!.booked).toMatchObject({ start: at(6), end: at(9) });
    const c = submitB(b.state, 'OC', unitParts('C', 3), at(2));
    expect(etaB(c.plan, 'C1')).toBe(at(9));
    expect(loadOf(c.state, 'C1')!.load_id).toBe(loadOf(c.state, 'B4')!.load_id);
    expect(etaB(c.plan, 'C2')).toBe(at(12));
    expect(etaB(c.plan, 'C3')).toBe(at(12));
    expect(loadOf(c.state, 'C2')!.booked).toMatchObject({ start: at(9), end: at(12) });
  });
});

describe('[03a v1.2.10 §3.3 BQ-1, BQ-2] rounds in arrival order', () => {
  it('[03a #143] rounds in arrival order through a slide (Start 2 min after each fire, Done never tapped)', () => {
    // Fails on v1.2.7 (the ×3 placed at +7 fires behind the ×2 placed at +9 and the ×1 placed at +12).
    const run = runRounds(queueFryer(), ORDERS_143, { until: 40, startAfter: 2 * M });
    expect(roundsOf(run.fires)).toEqual([['A×5'], ['B×8'], ['B×2', 'C×2', 'D×2', 'E×2'], ['E×2', 'F×3', 'G×2', 'H×1']]);
    expectArrivalOrder(run.fires);
  });

  it('[03a #151] single_tap: the same arrival order with no slide, fired at +0, +3, +6, +9, +12', () => {
    // §10.3g #151 "the same round membership, fires at +0, +3, +6, +9, +12": with no slide the fourth round fires at
    // +9, before H is placed (+12), so H cooks alone at +12 (the proposal §2 single_tap run); every other round is #143's.
    const run = runRounds(queueFryer({ mode: 'single_tap' }), ORDERS_143, { until: 40 });
    expect(roundsOf(run.fires)).toEqual([['A×5'], ['B×8'], ['B×2', 'C×2', 'D×2', 'E×2'], ['E×2', 'F×3', 'G×2'], ['H×1']]);
    expect(run.fires.map((f) => f.at)).toEqual([at(0), at(3), at(6), at(9), at(12)]);
    expectArrivalOrder(run.fires);
  });

  it('[03a #144] a hidden load is never broken up by a re-plan: a slide moves the queue behind it later together', () => {
    // A ×8 fires at +0 and nobody taps Start, so it slides; the tick fires B at +3 and C at +6 (fired, not started, packed
    // behind A). At +7 the live packing ends at +16 (A [7, 10), B [10, 13), C [13, 16)), past the start of the hidden
    // load E [12, 15); a void of one unit of H (a re-plan with no prune) re-places the queue.
    const orders = [['A', 8, 0], ['B', 8, 0], ['C', 8, 0], ['D', 8, 0], ['E', 8, 0], ['G', 8, 0], ['H', 2, 0]] as const;
    const before = runRounds(queueFryer(), orders, { until: 6.75 }).state;
    const names = ['E1', 'G1', 'H1'].map((x) => loadOf(before, x)!.load_id);
    expect(names.map((n) => before.stations.F!.loads[n]!.booked.start)).toEqual([at(12), at(15), at(18)]);
    const run = runRounds(queueFryer(), orders, { until: 7, extra: (_s, t) => (t === at(7) ? [voidB('OH', 'H2', 1, t)] : []) });
    const s = run.state;
    const after = names.map((n) => s.stations.F!.loads[n]!);
    expect(after.map((l) => l.order_item_ids)).toEqual([
      ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8'],
      ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8'],
      ['H1'],
    ]);
    expect(after[0]!.booked.start).toBeGreaterThanOrEqual(at(16));
    for (let k = 1; k < after.length; k += 1) expect(after[k]!.booked.start).toBeGreaterThanOrEqual(after[k - 1]!.booked.end);
    // D26: a full replay, and a snapshot taken mid-log plus the rest, both give the live state.
    const log = [queueConfig(), ...run.events].map((e) => parseEvent(e));
    expect(withoutDiag(buildEngineState(log))).toEqual(withoutDiag(s));
    const k = Math.floor(log.length / 2);
    const snap = JSON.parse(JSON.stringify(buildEngineState(log.slice(0, k)))) as EngineState;
    expect(withoutDiag(applyEvents(snap, log.slice(k)))).toEqual(withoutDiag(s));
  });

  it('[03a #147] a late queue keeps queue order whatever the weights; capped past max_late_ms; no load over another', () => {
    // A ×8 fires at +0 and nobody taps Start for 12 min; the tick fires B, C, D at their times (packed behind A). At +12
    // the packing ends at +24, so the hidden loads G [15, 18), H [18, 21), I [21, 24) are late. H's members weigh 10×
    // (a follow-up / expedite weight), I's have max_late_ms 5 min. A void of one unit of J re-plans the station.
    const orders = [
      ['A', 8, 0], ['B', 8, 0], ['C', 8, 0], ['D', 8, 0], ['E', 8, 0], ['G', 8, 0], ['H', 8, 0, { weight: 1000 }], ['I', 8, 0, { maxLate: 5 * M }], ['J', 2, 0],
    ] as const;
    const before = runRounds(queueFryer(), orders, { until: 11.75 }).state;
    const names = ['G1', 'H1', 'I1', 'J1'].map((x) => loadOf(before, x)!.load_id);
    const s = runRounds(queueFryer(), orders, { until: 12, extra: (_s, t) => (t === at(12) ? [voidB('OJ', 'J2', 1, t)] : []) }).state;
    const loads = names.map((n) => s.stations.F!.loads[n]!);
    expect(loads.map((l) => l.order_item_ids.length)).toEqual([8, 8, 8, 1]);
    expect(loads[0]!.booked.start).toBeGreaterThanOrEqual(at(24));
    for (let k = 1; k < loads.length; k += 1) expect(loads[k]!.booked.start).toBeGreaterThanOrEqual(loads[k - 1]!.booked.end);
    // capped: I is late by ≥ 9 min ≥ its 5 min max_late_ms; G and H have no cap. station_overload on the next pass.
    expect(s.lines.I1!.capped).toBe(true);
    expect(s.lines.G1!.capped).toBe(false);
    expect(s.lines.H1!.capped).toBe(false);
    expect(getAlertIntents(s, at(12)).overload).toEqual(expect.arrayContaining([expect.objectContaining({ station_id: 'F', capped: true })]));
  });
});

// For every unit u of an order and every unit v of a later order (order ids are in arrival order), round(u) ≤ round(v).
function expectArrivalOrder(fires: readonly RoundFire[]): void {
  const round = new Map<string, number>();
  fires.forEach((f, i) => f.ids.forEach((id) => round.set(id, i)));
  const byOrder = new Map<string, number[]>();
  for (const [id, r] of round) byOrder.set(id.replace(/\d+$/, ''), [...(byOrder.get(id.replace(/\d+$/, '')) ?? []), r]);
  const orders = [...byOrder.keys()].sort();
  for (let i = 0; i < orders.length; i += 1) {
    for (let j = i + 1; j < orders.length; j += 1) {
      expect(Math.max(...byOrder.get(orders[i]!)!), `${orders[i]} before ${orders[j]}`).toBeLessThanOrEqual(Math.min(...byOrder.get(orders[j]!)!));
    }
  }
}

function withoutDiag(s: EngineState): Omit<EngineState, 'diagnostics'> {
  return { ...s, diagnostics: undefined } as unknown as Omit<EngineState, 'diagnostics'>;
}
