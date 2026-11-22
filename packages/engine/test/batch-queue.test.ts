// 03a v1.2.10 §3.3 BQ-1–BQ-6, §3.5.3, §3.5.6, §3.10 BQ-5, §10.3g tests 143–151 (STAB-6): the unfired loads of a batch
// station are a queue kept through every re-plan; rounds in arrival order. Kit: batch-kit.ts (queueFryer, unitParts,
// runRounds). No timing asserts (AD-32): every time below is simulated engine time.
import { describe, expect, it } from 'vitest';
import { at, etaB, loadOf, queueFryer, runRounds, submitB, unitParts } from './batch-kit';

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
