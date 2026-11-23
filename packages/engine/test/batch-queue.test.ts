// 03a v1.2.10 §3.3 BQ-1–BQ-6, §3.5.3, §3.5.6, §3.10 BQ-5, §10.3g tests 143–151 (STAB-6): the unfired loads of a batch
// station are a queue kept through every re-plan; rounds in arrival order. Kit: batch-kit.ts (queueFryer, unitParts,
// runRounds). No timing asserts (AD-32): every time below is simulated engine time.
import { parseEvent, type PosEvent } from '@pos/events';
import { aStockAdded, aStockReserved, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvents, buildEngineState, getAlertIntents, type EngineState } from '../src/index';
import { at, capacityB, COOK, etaB, fold, loadOf, nextSeq, queueConfig, queueFryer, roundsOf, runRounds, submitB, unitParts, voidB, M, type RoundFire } from './batch-kit';

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

describe('[03a v1.2.10 §3.3 BQ-3, BQ-4, §3.6.1 item 1] membership and pull-in', () => {
  it('[03a #146] new lines never jump the queue: join the earliest load with room, else a load after the last', () => {
    // Z ×8 cooks [0, 3); A ×8 [3, 6), B ×8 [6, 9), C ×8 [9, 12) queue behind it; B1–B3 are voided (room 3 in B's load).
    const voids = (_s: EngineState, t: number) => (t === at(0.25) ? ['B1', 'B2', 'B3'].map((x) => voidB('OB', x, 1, t)) : []);
    let s = runRounds(queueFryer(), [['Z', 8, 0], ['A', 8, 0], ['B', 8, 0], ['C', 8, 0]], { until: 0.25, startAfter: 0, extra: voids }).state;
    const names = ['A4', 'B4', 'C1'].map((x) => loadOf(s, x)!.load_id);
    const bookings = names.map((n) => s.stations.F!.loads[n]!.booked);
    s = submitB(s, 'OX', unitParts('X', 3), at(0.5)).state;
    for (const x of ['X1', 'X2', 'X3']) expect(loadOf(s, x)!.load_id, x).toBe(names[1]); // the earliest load with room
    s = submitB(s, 'OY', unitParts('Y', 1), at(0.75)).state;
    const y = loadOf(s, 'Y1')!;
    expect(names).not.toContain(y.load_id);
    expect(y.booked.start).toBeGreaterThanOrEqual(bookings[2]!.end); // after the last queued load
    expect(names.map((n) => s.stations.F!.loads[n]!.booked)).toEqual(bookings); // no queued load moved
  });

  it('[03a #146] a new immediate line uses the idle time before a load held for a pickup 30 min away; the held load does not move later', () => {
    let s = queueFryer();
    s = submitB(s, 'OP', unitParts('P', 8, { mode: 'sync' }), at(0), { pickup_at_ms: at(30) }).state;
    const held = loadOf(s, 'P1')!;
    expect(held.booked.end).toBe(at(30));
    s = submitB(s, 'OX', unitParts('X', 1), at(1)).state;
    expect(loadOf(s, 'X1')!.booked).toMatchObject({ start: at(1), end: at(4) });
    // The held load keeps its members and name; the new line does not move it. The re-plan's own keep cushion (BQ-2:
    // latestFit by d(b) − keep, D6) may land it up to keep (1 min) earlier, never later.
    const after = loadOf(s, 'P1')!;
    expect(after).toMatchObject({ load_id: held.load_id, order_item_ids: held.order_item_ids });
    expect(after.booked.end).toBeLessThanOrEqual(at(30));
    expect(after.booked.end).toBeGreaterThanOrEqual(at(29));
  });

  it('[03a #148] a void in a hidden load keeps its name, members and place; the room is not refilled from later loads; the pull-in goes in queue order, then arrival', () => {
    // Freshness 10 min, so the loads behind the first are inside the pull-in window. Z ×8 cooks [0, 3). The ×2 placed at
    // +0.5 is order "AA": younger than B and C, but its ids sort first, so an id order would pull it ahead of B.
    const orders = [['Z', 8, 0], ['A', 8, 0], ['B', 8, 0], ['C', 8, 0], ['AA', 2, 0.5]] as const;
    const events = (s: EngineState, t: number) =>
      t === at(0.25) ? [voidB('OB', 'B1', 1, t), voidB('OB', 'B2', 1, t)] : t === at(0.75) ? [voidB('OA', 'A1', 1, t), voidB('OA', 'A2', 1, t)] : [];
    const early = runRounds(queueFryer({ freshness: 10 * M }), orders.slice(0, 4), { until: 0, startAfter: 0 }).state;
    const [l1, l2, l3] = ['A1', 'B1', 'C1'].map((x) => loadOf(early, x)!);
    const mid = runRounds(queueFryer({ freshness: 10 * M }), orders, { until: 0.5, startAfter: 0, extra: events }).state;
    // B1, B2 voided: B's load keeps its name, B3–B8 and its place; C's load keeps its members; AA ×2 joins B's load.
    expect(mid.stations.F!.loads[l2!.load_id]!.order_item_ids).toEqual(['AA1', 'AA2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
    expect(mid.stations.F!.loads[l2!.load_id]!.booked).toEqual(l2!.booked);
    expect(mid.stations.F!.loads[l3!.load_id]!.order_item_ids).toEqual(l3!.order_item_ids);
    // A1, A2 voided at +0.75: A's load keeps 6 members; the re-plan does not refill it from B's or C's load (Q1).
    const run = runRounds(queueFryer({ freshness: 10 * M }), orders, { until: 3, startAfter: 0, extra: events });
    const fireA = run.fires.find((f) => f.load_id === l1!.load_id)!;
    expect(fireA.at).toBe(at(3));
    // The fire pulls in 2: B's load first (queue order), its oldest members (arrival key), never a part of C's load.
    expect(fireA.ids).toEqual(['A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B3', 'B4']);
  });
  it('[03a #150] a program flip: the flipped member leaves its hidden load (the load keeps the rest, its place and name) and joins the first compatible stock-program load with room, else forms one', () => {
    const stockEv = (e: PosEvent, t: number): PosEvent => {
      const sq = nextSeq();
      return { ...e, recorded_at: t, occurred_at: t, seq: sq, event_id: `01J${String(sq).padStart(23, '0')}` };
    };
    const flipTo = (s: EngineState, t: number): EngineState =>
      fold(s, [
        stockEv(aStockAdded({ stream_id: 'KB', payload: { stock_item_id: 'KB', quantity: 1, unit: 'piece' } }), t),
        stockEv(aStockReserved({ stream_id: 'KB', payload: { stock_item_id: 'KB', order_item_id: 'A1', quantity: 1 } }), t),
      ]);
    const stocked = { stock: { program: 'P2', cook: M }, draws: [{ stock_item_id: 'KB', quantity: 1 }] };
    for (const withP2 of [false, true]) {
      // Freshness 5 min. Z ×8 cooks [0, 3); [W ×1 on P2, cook 1 min: [3, 4)]; A ×3 (A1 can come from stock) and B ×5 on P1
      // share the next load.
      let s = fold(queueFryer({ freshness: 5 * M }), [stockEv(aStockSet({ stream_id: 'KB', payload: { stock_item_id: 'KB', on_hand: 0, unit: 'piece' } }), at(-1))]);
      s = runRounds(s, [['Z', 8, 0]], { until: 0, startAfter: 0 }).state;
      if (withP2) s = submitB(s, 'OW', [{ id: 'W1', cook: M, program: 'P2', mode: 'immediate', early: 60 * M }], at(0.25)).state;
      s = submitB(s, 'OA', [{ id: 'A1', cook: COOK, mode: 'immediate', early: 60 * M, ...stocked }, ...unitParts('A', 3).slice(1)], at(0.25)).state;
      s = submitB(s, 'OB', unitParts('B', 5), at(0.25)).state;
      const load = loadOf(s, 'A1')!;
      expect(load.order_item_ids).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5']);
      const after = flipTo(s, at(0.5));
      expect(after.lines.A1).toMatchObject({ from_stock: true, cook_ms: M });
      const kept = after.stations.F!.loads[load.load_id]!;
      expect(kept.order_item_ids).toEqual(['A2', 'A3', 'B1', 'B2', 'B3', 'B4', 'B5']);
      expect(kept.booked).toEqual(load.booked);
      const flipped = loadOf(after, 'A1')!;
      expect(flipped.program_id).toBe('P2');
      if (withP2) expect(flipped.order_item_ids).toEqual(['A1', 'W1']);
      else expect(flipped.order_item_ids).toEqual(['A1']);
    }
  });
});

describe('[03a v1.2.10 §3.10 BQ-5] capacity drop as a cascade', () => {
  // K ×8 cooks [0, 3); X ×4, Y ×2, V ×2 fill the next load [3, 6) and Z ×3 forms [6, 9); V1, V2 are voided at +0.25, so
  // the first hidden load holds 6 parts (X ×4 then Y ×2) and the next 3 (Z, arrived after Y).
  const orders = [['K', 8, 0], ['X', 4, 0], ['Y', 2, 0], ['V', 2, 0], ['Z', 3, 0]] as const;
  const voids = (t: number) => (t === at(0.25) ? [voidB('OV', 'V1', 1, t), voidB('OV', 'V2', 1, t)] : []);

  it('[03a #149] 8 → 4: X stays; Y moves to the next load, which passes its latest Z part on to a new load after the last: [X×4], [Y×2, Z×2], [Z×1]', () => {
    const run = runRounds(queueFryer(), orders, { until: 0.5, startAfter: 0, extra: (_s, t) => [...voids(t), ...(t === at(0.5) ? [capacityB(4, t)] : [])] });
    const s = run.state;
    const loads = Object.values(s.stations.F!.loads).sort((a, b) => a.booked.start - b.booked.start);
    expect(loads.map((l) => l.order_item_ids)).toEqual([['X1', 'X2', 'X3', 'X4'], ['Y1', 'Y2', 'Z1', 'Z2'], ['Z3']]);
    for (let k = 1; k < loads.length; k += 1) expect(loads[k]!.booked.start).toBeGreaterThanOrEqual(loads[k - 1]!.booked.end);
    for (const l of loads) expect(l.booked.units).toBe(4);
    expect(withoutDiag(buildEngineState([queueConfig(), ...run.events].map((e) => parseEvent(e))))).toEqual(withoutDiag(s));
  });

  it('[03a #149, P4] a frozen load of 6 stays whole in AD-4 rounds', () => {
    // At +1.5 the first load (fire +3) is frozen (fire ≤ t + 2 min).
    const run = runRounds(queueFryer(), orders, { until: 1.5, startAfter: 0, extra: (_s, t) => [...voids(t), ...(t === at(1.5) ? [capacityB(4, t)] : [])] });
    const first = loadOf(run.state, 'X1')!;
    expect(first.order_item_ids).toEqual(['X1', 'X2', 'X3', 'X4', 'Y1', 'Y2']);
    expect(first.booked.end - first.booked.start).toBe(2 * COOK); // two rounds of 4
  });
});

describe('[03a v1.2.10 §3.3 BQ-1, §10.3g #143 property] arrival order on random days', () => {
  // m-2 scope: immediate one-unit lines (per-unit parts) on one batch station, no capacity drop, no boost, no priority.
  // Random orders (1–6 parts) on the 15 s grid, Start tapped 0–3 min after each fire (two_tap, so loads slide).
  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4_294_967_296;
    };
  }
  it('[03a #143] property, 50 seeds: round(u) ≤ round(v) whenever u arrived before v; live = replay', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const r = prng(14_300 + seed);
      const used = new Set<number>();
      const orders: Array<[string, number, number]> = [];
      for (let k = 0; k < 14; k += 1) {
        let q = Math.floor(r() * 80); // quarter-minutes in [0, 20)
        while (used.has(q)) q = (q + 1) % 80;
        used.add(q);
        orders.push([`Q${String.fromCharCode(65 + k)}`, 1 + Math.floor(r() * 6), q / 4]);
      }
      const delays = Array.from({ length: 64 }, () => Math.floor(r() * 13) * 15_000);
      const run = runRounds(queueFryer(), orders, { until: 60, startAfter: (i) => delays[i % delays.length]! });
      // arrival key: placement time, then order id, then part index
      const key = new Map<string, [number, string, number]>();
      for (const [oid, n, min] of orders) for (let i = 1; i <= n; i += 1) key.set(`${oid}${i}`, [min, oid, i]);
      const round = new Map<string, number>();
      run.fires.forEach((f, i) => f.ids.forEach((id) => round.set(id, i)));
      expect(round.size, `seed ${seed}: every part fired`).toBe(key.size);
      const ids = [...key.keys()].sort((a, b) => {
        const [ta, oa, ia] = key.get(a)!;
        const [tb, ob, ib] = key.get(b)!;
        return ta - tb || (oa < ob ? -1 : oa > ob ? 1 : 0) || ia - ib;
      });
      for (let i = 1; i < ids.length; i += 1) {
        expect(round.get(ids[i - 1]!)!, `seed ${seed}: ${ids[i - 1]} before ${ids[i]}`).toBeLessThanOrEqual(round.get(ids[i]!)!);
      }
      expect(withoutDiag(buildEngineState([queueConfig(), ...run.events].map((e) => parseEvent(e)))), `seed ${seed} live = replay`).toEqual(withoutDiag(run.state));
    }
  }, 120_000);
});

