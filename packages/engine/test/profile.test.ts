import { describe, expect, it } from 'vitest';
import {
  addInterval,
  bookedUnitMs,
  earliestFit,
  latestFit,
  occupancy,
  removeInterval,
  type Interval,
  type Profile,
} from '../src/index';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const EMPTY: Profile = deepFreeze({ t: [], u: [] });
const iv = (start: number, end: number): Interval => deepFreeze({ start, end });

// Canonical form (03a §3.3): boundaries strictly increasing (so no zero-length segment), u ≥ 0,
// equal neighbours merged (the implicit 0 before t[0] counts as a neighbour), the last segment is 0.
function expectCanonical(p: Profile): void {
  expect(p.t.length).toBe(p.u.length);
  for (let i = 0; i < p.t.length; i++) {
    expect(Number.isInteger(p.t[i])).toBe(true);
    expect(p.u[i]!).toBeGreaterThanOrEqual(0);
    if (i > 0) expect(p.t[i]!).toBeGreaterThan(p.t[i - 1]!);
    expect(p.u[i]).not.toBe(i === 0 ? 0 : p.u[i - 1]);
  }
  if (p.u.length > 0) expect(p.u[p.u.length - 1]).toBe(0);
}

// Units in use at the instant x (reference reading of the profile, independent of src).
function unitsAt(p: Profile, x: number): number {
  let v = 0;
  for (let i = 0; i < p.t.length && p.t[i]! <= x; i++) v = p.u[i]!;
  return v;
}

// Brute force over every integer ms (boundaries are integers, so this equals the continuous check).
function fitsBrute(p: Profile, fire: number, prep: number, cook: number, units: number, cap: number): boolean {
  const occ = units > cap ? { units: cap, cook: cook * Math.ceil(units / cap) } : { units, cook };
  for (let x = fire + prep; x < fire + prep + occ.cook; x++) if (unitsAt(p, x) + occ.units > cap) return false;
  return true;
}

function build(intervals: Array<[number, number, number]>): Profile {
  let p: Profile = EMPTY;
  for (const [s, e, n] of intervals) p = deepFreeze(addInterval(p, iv(s, e), n));
  return p;
}

// mulberry32: a seeded, deterministic PRNG (no dependency; Math.random is banned in src and avoided here).
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

describe('[03a §3.3 profile] addInterval / removeInterval', () => {
  it('[03a §3.3 profile] add on an empty profile books [start, end) and ends at 0', () => {
    const p = addInterval(EMPTY, iv(100, 200), 2);
    expect(p).toEqual({ t: [100, 200], u: [2, 0] });
    expectCanonical(p);
    expect(EMPTY).toEqual({ t: [], u: [] });
  });

  it('[03a §3.3 profile] add merges equal neighbours (touching intervals form one segment)', () => {
    const p = build([
      [0, 10, 1],
      [10, 20, 1],
    ]);
    expect(p).toEqual({ t: [0, 20], u: [1, 0] });
    const q = build([
      [0, 10, 1],
      [20, 30, 1],
      [10, 20, 1],
    ]);
    expect(q).toEqual({ t: [0, 30], u: [1, 0] });
  });

  it('[03a §3.3 profile] overlapping adds sum their units per segment', () => {
    const p = build([
      [0, 30, 1],
      [10, 20, 2],
      [25, 40, 1],
    ]);
    expect(p).toEqual({ t: [0, 10, 20, 25, 30, 40], u: [1, 3, 1, 2, 1, 0] });
    expectCanonical(p);
  });

  it('[03a §3.3 profile] remove merges what the add split; add then remove = the original', () => {
    const base = build([
      [0, 30, 1],
      [50, 60, 2],
    ]);
    const added = deepFreeze(addInterval(base, iv(10, 55), 1));
    expect(added).toEqual({ t: [0, 10, 30, 50, 55, 60], u: [1, 2, 1, 3, 2, 0] });
    expect(removeInterval(added, iv(10, 55), 1)).toEqual(base);
    expect(removeInterval(deepFreeze(addInterval(EMPTY, iv(5, 9), 3)), iv(5, 9), 3)).toEqual({ t: [], u: [] });
  });

  it('[03a §3.3 profile] a zero-length interval or zero units changes nothing', () => {
    const base = build([[0, 10, 1]]);
    expect(addInterval(base, iv(5, 5), 1)).toEqual(base);
    expect(addInterval(base, iv(3, 8), 0)).toEqual(base);
    expect(removeInterval(base, iv(5, 5), 1)).toEqual(base);
  });

  it('[03a §3.3 profile] remove below zero is a bug and throws (u ≥ 0 invariant)', () => {
    const base = build([[0, 10, 1]]);
    expect(() => removeInterval(base, iv(5, 15), 1)).toThrow(RangeError);
    expect(() => removeInterval(base, iv(0, 10), 2)).toThrow(RangeError);
  });

  it('[03a AD-6] strict removeInterval (no callback) still throws a RangeError on underflow', () => {
    const base = build([[0, 10, 1]]);
    expect(() => removeInterval(base, iv(5, 15), 1)).toThrow(RangeError);
  });

  it('[03a AD-6] non-strict removeInterval clamps at 0, stays canonical, reports once with the first underflow instant and the largest deficit', () => {
    // u: [0,10)=1, [10,20)=3, [20,30)=1, then 0. Remove 2 on [5, 40): [5,10) -> -1, [10,20) -> 1, [20,30) -> -1, [30,40) -> -2.
    const base = build([
      [0, 30, 1],
      [10, 20, 2],
    ]);
    const snapshot = JSON.parse(JSON.stringify(base)) as Profile;
    const calls: Array<{ at: number; deficit: number }> = [];
    const out = removeInterval(base, iv(5, 40), 2, (u) => calls.push(u));
    expect(out).toEqual({ t: [0, 5, 10, 20], u: [1, 0, 1, 0] });
    expectCanonical(out);
    expect(calls).toEqual([{ at: 5, deficit: 2 }]);
    expect(base).toEqual(snapshot);

    // Removing from an empty profile clamps to the empty profile.
    const calls2: Array<{ at: number; deficit: number }> = [];
    expect(removeInterval(EMPTY, iv(100, 200), 3, (u) => calls2.push(u))).toEqual({ t: [], u: [] });
    expect(calls2).toEqual([{ at: 100, deficit: 3 }]);

    // Clamping merges equal neighbours: [0,10)=1 minus 2 on [0,10) leaves nothing.
    const calls3: Array<{ at: number; deficit: number }> = [];
    const q = removeInterval(build([[0, 10, 1], [20, 30, 1]]), iv(0, 10), 2, (u) => calls3.push(u));
    expect(q).toEqual({ t: [20, 30], u: [1, 0] });
    expectCanonical(q);
    expect(calls3).toEqual([{ at: 0, deficit: 1 }]);
  });

  it('[03a AD-6] non-strict add-then-remove without underflow returns the original and never calls the callback', () => {
    const base = build([
      [0, 30, 1],
      [50, 60, 2],
    ]);
    const added = deepFreeze(addInterval(base, iv(10, 55), 1));
    let called = 0;
    expect(removeInterval(added, iv(10, 55), 1, () => called++)).toEqual(base);
    expect(called).toBe(0);
  });

  it('[03a §3.3 profile] inputs are never mutated (deep-frozen inputs, structural equality after)', () => {
    const base = build([
      [0, 30, 1],
      [10, 20, 2],
    ]);
    const snapshot = JSON.parse(JSON.stringify(base)) as Profile;
    const added = addInterval(base, iv(5, 25), 1);
    removeInterval(added, iv(5, 25), 1);
    latestFit(base, 0, 100, 3, 7, 1, 3);
    earliestFit(base, 0, 3, 7, 4, 3);
    bookedUnitMs(base, 0, 100);
    expect(base).toEqual(snapshot);
    expect(added).not.toBe(base);
  });
});

describe('[03a §3.3 profile] latestFit / earliestFit', () => {
  // cap 1, busy [100, 200).
  const busy = build([[100, 200, 1]]);

  it('[03a §3.3 profile] latestFit returns the latest fire in [lo, hi] whose interval fits, null when none', () => {
    expect(latestFit(EMPTY, 0, 500, 0, 50, 1, 1)).toBe(500);
    expect(latestFit(busy, 0, 300, 0, 50, 1, 1)).toBe(300);
    expect(latestFit(busy, 0, 180, 0, 50, 1, 1)).toBe(50); // [50, 100) ends where the booking starts
    expect(latestFit(busy, 60, 180, 0, 50, 1, 1)).toBeNull(); // 50 < lo
    expect(latestFit(busy, 120, 110, 0, 50, 1, 1)).toBeNull(); // empty range
    expect(latestFit(busy, 0, 180, 0, 50, 1, 2)).toBe(180); // cap 2 leaves room beside it
  });

  it('[03a §3.3 profile] earliestFit returns the earliest fire ≥ lo whose interval fits', () => {
    expect(earliestFit(EMPTY, 70, 0, 50, 1, 1)).toBe(70);
    expect(earliestFit(busy, 0, 0, 50, 1, 1)).toBe(0);
    expect(earliestFit(busy, 60, 0, 50, 1, 1)).toBe(200);
    expect(earliestFit(busy, 60, 0, 50, 1, 2)).toBe(60);
  });

  it('[03a §3.3 profile] prep shifts the interval [fire + prep, fire + prep + cook), not the fire bound', () => {
    // hi = 150 bounds the fire; the interval [200, 250) lies past hi and still fits.
    expect(latestFit(busy, 0, 150, 50, 50, 1, 1)).toBe(150);
    // fire 0 → [50, 110) conflicts with [100, 200) → next fire b − prep = 150 → [200, 260).
    expect(earliestFit(busy, 0, 50, 60, 1, 1)).toBe(150);
    // F §4.7 test 10: R = [T, T+8), prep 10, cook 20 → start_at = T (prep does not occupy the station).
    const T = 1_761_000_000_000;
    expect(earliestFit(build([[T, T + 8, 1]]), T, 10, 20, 1, 1)).toBe(T);
  });

  it('[03a §3.3 profile] a conflict segment [a, b) jumps to a − prep − cook backward and b − prep forward', () => {
    // backward: fire 180 → [190, 220) hits [100, 200) → a − prep − cook = 100 − 10 − 30 = 60 → [70, 100).
    expect(latestFit(busy, 0, 180, 10, 30, 1, 1)).toBe(60);
    // forward: fire 80 → [90, 120) hits [100, 200) → b − prep = 190 → [200, 230).
    expect(earliestFit(busy, 80, 10, 30, 1, 1)).toBe(190);
    // F §4.7 test 2: reservation [T+5, T+20), cap 1, cook 20, prep 0, now T → start T+20, ETA T+40.
    const T = 1_761_000_000_000;
    expect(earliestFit(build([[T + 5, T + 20, 1]]), T, 0, 20, 1, 1)).toBe(T + 20);
    // F §4.7 test 7: tentative [T+5, T+15), cook 20 → interval [T+15, T+35).
    expect(earliestFit(build([[T + 5, T + 15, 1]]), T, 0, 20, 1, 1)).toBe(T + 15);
  });

  it('[03a §3.3 profile] a fit walks across several conflict segments (multi-unit, partial capacity)', () => {
    // cap 3: [0,10)=2, [10,20)=3, [20,30)=1, [30,40)=3, then 0.
    const p = build([
      [0, 40, 1],
      [0, 20, 1],
      [10, 20, 1],
      [30, 40, 2],
    ]);
    expect(p).toEqual({ t: [0, 10, 20, 30, 40], u: [2, 3, 1, 3, 0] });
    expect(earliestFit(p, 0, 0, 5, 2, 3)).toBe(20); // needs u ≤ 1
    expect(earliestFit(p, 0, 0, 15, 2, 3)).toBe(40);
    expect(earliestFit(p, 0, 0, 5, 1, 3)).toBe(0);
    expect(earliestFit(p, 0, 0, 15, 1, 3)).toBe(40);
    expect(latestFit(p, -100, 35, 0, 15, 2, 3)).toBe(-15); // ends at 0
    expect(latestFit(p, -100, 25, 0, 5, 2, 3)).toBe(25); // [25, 30) u = 1 fits 2 more
  });
});

describe('[03a §3.3 profile] bookedUnitMs', () => {
  it('[03a §3.3 profile] bookedUnitMs integrates units × ms over [from, to)', () => {
    const p = build([
      [0, 30, 1],
      [10, 20, 2],
    ]);
    expect(bookedUnitMs(p, 0, 30)).toBe(10 * 1 + 10 * 3 + 10 * 1);
    expect(bookedUnitMs(p, 15, 25)).toBe(5 * 3 + 5 * 1);
    expect(bookedUnitMs(p, -100, 1000)).toBe(50);
    expect(bookedUnitMs(p, 30, 1000)).toBe(0);
    expect(bookedUnitMs(p, 20, 10)).toBe(0);
    expect(bookedUnitMs(EMPTY, 0, 1000)).toBe(0);
  });
});

describe('[03a §3.3 profile] AD-4 units > capacity occupy the whole station in rounds', () => {
  it('[03a §3.3 profile] AD-4 occupancy(): units ≤ cap is one cook; units > cap is cap units for ceil(units / cap) rounds', () => {
    expect(occupancy(3, 3, 600)).toEqual({ units: 3, cook_ms: 600, rounds: 1 });
    expect(occupancy(1, 3, 600)).toEqual({ units: 1, cook_ms: 600, rounds: 1 });
    expect(occupancy(4, 3, 600)).toEqual({ units: 3, cook_ms: 1200, rounds: 2 });
    expect(occupancy(6, 3, 600)).toEqual({ units: 3, cook_ms: 1200, rounds: 2 });
    expect(occupancy(7, 3, 600)).toEqual({ units: 3, cook_ms: 1800, rounds: 3 });
  });

  it('[03a §3.3 profile] AD-4 units 4 on cap 3, cook 600: placed after an existing booking ends, not beside it, and books cap 3 for 1200 ms', () => {
    const p = build([[0, 600, 1]]); // 2 units free beside it
    const fire = earliestFit(p, 0, 0, 600, 4, 3);
    expect(fire).toBe(600);
    const occ = occupancy(4, 3, 600);
    const booked = addInterval(p, iv(fire, fire + occ.cook_ms), occ.units);
    expect(booked).toEqual({ t: [0, 600, 1800], u: [1, 3, 0] });
    // latest fire ≤ 2000 for which the station is empty for 1200 ms: any ≥ 600.
    expect(latestFit(p, 0, 2000, 0, 600, 4, 3)).toBe(2000);
    // the station is busy [0, 600) and [1500, 1600): the empty 900 ms gap does not hold 1200 ms.
    const q = build([
      [0, 600, 1],
      [1500, 1600, 1],
    ]);
    expect(latestFit(q, 0, 1000, 0, 600, 4, 3)).toBeNull();
    expect(latestFit(q, -2000, 1000, 0, 600, 4, 3)).toBe(-1200);
    expect(earliestFit(q, 0, 0, 600, 4, 3)).toBe(1600);
    // prep shifts it too: fire 900 + prep 100 → [1000, 2200) hits [1500,1600) → next b − prep = 1500.
    expect(earliestFit(q, 900, 100, 600, 4, 3)).toBe(1500);
  });

  it('[03a §3.3 profile] AD-4 property: 200 random profiles, fits agree with a brute-force scan over every integer ms', () => {
    const r = prng(0x03a4);
    for (let k = 0; k < 200; k++) {
      const cap = int(r, 1, 4);
      const intervals: Array<[number, number, number]> = [];
      const count = int(r, 0, 8);
      for (let j = 0; j < count; j++) {
        const s = int(r, 0, 55);
        intervals.push([s, s + int(r, 1, 15), int(r, 1, cap)]);
      }
      const p = build(intervals);
      expectCanonical(p);
      // the profile reads the same as a naive per-ms array.
      for (let x = -2; x < 75; x++) {
        expect(unitsAt(p, x)).toBe(intervals.reduce((n, [s, e, m]) => n + (s <= x && x < e ? m : 0), 0));
      }
      // removing every interval (in reverse) returns the empty profile.
      let back = p;
      for (const [s, e, n] of [...intervals].reverse()) {
        back = deepFreeze(removeInterval(back, iv(s, e), n));
        expectCanonical(back);
      }
      expect(back).toEqual({ t: [], u: [] });

      for (let q = 0; q < 6; q++) {
        const units = int(r, 1, cap * 2 + 1); // includes units > cap (AD-4)
        const prep = int(r, 0, 8);
        const cook = int(r, 1, 12);
        const lo = int(r, -20, 70);
        const hi = lo + int(r, -3, 40);
        const occ = occupancy(units, cap, cook);

        let brute: number | null = null;
        for (let f = hi; f >= lo; f--) {
          if (fitsBrute(p, f, prep, cook, units, cap)) {
            brute = f;
            break;
          }
        }
        const late = latestFit(p, lo, hi, prep, cook, units, cap);
        expect(late, `latest #${k}/${q}`).toBe(brute);

        let bruteE = lo;
        while (!fitsBrute(p, bruteE, prep, cook, units, cap)) bruteE++;
        const early = earliestFit(p, lo, prep, cook, units, cap);
        expect(early, `earliest #${k}/${q}`).toBe(bruteE);

        // the whole interval of a fit has u + units ≤ cap under the occupancy rule.
        for (const f of late === null ? [early] : [early, late]) {
          for (let x = f + prep; x < f + prep + occ.cook_ms; x++) expect(unitsAt(p, x) + occ.units).toBeLessThanOrEqual(cap);
        }
      }
    }
  });

  it('[03a §3.3 profile] AD-4 both scans terminate with a step count bounded by the boundaries', () => {
    // 4 000 alternating segments: busy 1 ms, free 1 ms, cap 1; cook 2 never fits until the end.
    const n = 2000;
    const t: number[] = [];
    const u: number[] = [];
    for (let i = 0; i < n; i++) {
      t.push(2 * i, 2 * i + 1);
      u.push(1, 0);
    }
    let reads = 0;
    const counted = new Proxy(t, {
      get(target, key, recv) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, recv) as unknown;
      },
    });
    const p = deepFreeze({ t: counted, u });
    const bound = 4 * t.length + 64;

    reads = 0;
    expect(earliestFit(p, 0, 0, 2, 1, 1)).toBe(2 * n - 1);
    expect(reads).toBeLessThanOrEqual(bound);

    expect(latestFit(p, 0, 2 * n - 1, 0, 2, 1, 1)).toBe(2 * n - 1);
    reads = 0;
    expect(latestFit(p, 0, 2 * n - 2, 0, 2, 1, 1)).toBeNull();
    expect(reads).toBeLessThanOrEqual(bound);

    // units > cap (AD-4, rounds 3): needs the station empty for 6 ms; never before the end either.
    reads = 0;
    expect(earliestFit(p, 0, 0, 2, 3, 1)).toBe(2 * n - 1);
    expect(reads).toBeLessThanOrEqual(bound);
    reads = 0;
    expect(latestFit(p, -3, 2 * n - 2, 0, 2, 3, 1)).toBeNull();
    expect(reads).toBeLessThanOrEqual(bound);
  });
});
