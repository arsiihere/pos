// 03a §3.3 "The profile is the timeline" (D24); F §4.7 slot formula. Pure, immutable, integer ms.
//
// A profile is a step function of units in use over time: t holds the boundaries (strictly
// increasing), u[i] the units in use on [t[i], t[i + 1]); before t[0] and from the last boundary on,
// 0 units are in use. Canonical form, kept by every function here: no zero-length segment, u ≥ 0,
// equal neighbours merged (the implicit 0 before t[0] is a neighbour, so u[0] > 0), last u = 0.
// The canonical form is unique, so adding then removing an interval returns a structurally equal profile.
//
// Preconditions (the spec states no rule for other values, so none is invented here): times are
// integer ms; cap ≥ 1 (capacityForLanes gives ≥ 1 per lane on); units ≥ 1 for a fit; prep ≥ 0;
// cook ≥ 0 (cook 0 is an empty interval, which always fits).
import type { Interval, Profile } from './state.js';

export type { Interval, Profile } from './state.js';

// AD-4 (developer ruling 2026-11-03): a line whose units exceed the station's effective capacity
// occupies the whole station for ceil(units / cap) consecutive rounds, i.e. all cap units over
// cook × rounds. Callers book exactly this occupancy with addInterval.
export function occupancy(units: number, cap: number, cook: number): { units: number; cook_ms: number; rounds: number } {
  if (units <= cap) return { units, cook_ms: cook, rounds: 1 };
  const rounds = Math.ceil(units / cap);
  return { units: cap, cook_ms: cook * rounds, rounds };
}

// Largest i with t[i] ≤ x, or −1 when x lies before every boundary (binary search).
function segmentAt(t: readonly number[], x: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid]! <= x) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// Adds delta units on [start, end) and returns a new canonical profile. One linear pass.
function shift(p: Profile, start: number, end: number, delta: number): Profile {
  if (end <= start || delta === 0) return p;
  const { t, u } = p;
  const n = t.length;
  const rawT: number[] = [];
  const rawU: number[] = [];
  let i = 0;
  let cur = 0; // the original units in use at the scan position
  while (i < n && t[i]! < start) {
    cur = u[i]!;
    rawT.push(t[i]!);
    rawU.push(cur);
    i++;
  }
  if (i < n && t[i] === start) cur = u[i++]!;
  rawT.push(start);
  rawU.push(cur + delta);
  while (i < n && t[i]! < end) {
    cur = u[i]!;
    rawT.push(t[i]!);
    rawU.push(cur + delta);
    i++;
  }
  if (i < n && t[i] === end) cur = u[i++]!;
  rawT.push(end);
  rawU.push(cur);
  while (i < n) {
    rawT.push(t[i]!);
    rawU.push(u[i]!);
    i++;
  }

  const outT: number[] = [];
  const outU: number[] = [];
  let prev = 0;
  for (let k = 0; k < rawT.length; k++) {
    const v = rawU[k]!;
    if (v < 0) throw new RangeError(`profile: units in use below zero at ${rawT[k]} (removed more than was booked)`);
    if (v === prev) continue;
    outT.push(rawT[k]!);
    outU.push(v);
    prev = v;
  }
  return { t: outT, u: outU };
}

export function addInterval(p: Profile, iv: Interval, units: number): Profile {
  return shift(p, iv.start, iv.end, units);
}

// Removing more than was booked breaks u ≥ 0: a caller bug, thrown as a RangeError.
export function removeInterval(p: Profile, iv: Interval, units: number): Profile {
  return shift(p, iv.start, iv.end, -units);
}

// Latest fire in [lo, hi] whose interval [fire + prep, fire + prep + cook) has u + units ≤ cap
// throughout (AD-4 occupancy applied), or null. Scans backward from hi; on a conflict segment [a, b)
// the next candidate is a − prep − cook. Each step moves the segment index j down by one, so the scan
// takes at most t.length + 1 steps after one binary search.
export function latestFit(p: Profile, lo: number, hi: number, prep: number, cook: number, units: number, cap: number): number | null {
  if (hi < lo) return null;
  const occ = occupancy(units, cap, cook);
  const need = occ.units;
  const dur = occ.cook_ms;
  if (dur <= 0) return hi;
  const { t, u } = p;
  let fire = hi;
  let s = fire + prep;
  let e = s + dur;
  // Segment holding the last instant e − 1; segment −1 is (−∞, t[0]) with 0 units, which always fits
  // because need ≤ cap.
  for (let j = segmentAt(t, e - 1); j >= 0; j--) {
    const segEnd = j + 1 < t.length ? t[j + 1]! : Infinity;
    if (segEnd <= s) break; // segment j lies wholly before the interval: it fits
    if (u[j]! + need > cap) {
      e = t[j]!;
      s = e - dur;
      fire = s - prep;
      if (fire < lo) return null;
    }
  }
  return fire;
}

// Earliest fire ≥ lo whose interval [fire + prep, fire + prep + cook) has u + units ≤ cap throughout
// (AD-4 occupancy applied). Scans forward; on a conflict segment [a, b) the next candidate is
// b − prep. Each step moves the segment index j up by one, and the last segment (0 units) always
// fits, so the scan takes at most t.length + 1 steps after one binary search.
export function earliestFit(p: Profile, lo: number, prep: number, cook: number, units: number, cap: number): number {
  const occ = occupancy(units, cap, cook);
  const need = occ.units;
  const dur = occ.cook_ms;
  if (dur <= 0) return lo;
  const { t, u } = p;
  let fire = lo;
  let s = fire + prep;
  let e = s + dur;
  // Segment holding s (or segment 0 when s precedes every boundary); every segment visited ends after s.
  for (let j = Math.max(segmentAt(t, s), 0); j < t.length; j++) {
    if (t[j]! >= e) break; // segment j starts at or after the interval's end: it fits
    if (u[j]! + need > cap) {
      // u[j] > 0 implies j is not the last segment, so t[j + 1] exists.
      s = t[j + 1]!;
      e = s + dur;
      fire = s - prep;
    }
  }
  return fire;
}

// Booked unit-ms in [from, to): the integral of u over the window (used by pressure, §3.10 D20).
export function bookedUnitMs(p: Profile, from: number, to: number): number {
  if (to <= from) return 0;
  const { t, u } = p;
  let total = 0;
  for (let j = Math.max(segmentAt(t, from), 0); j < t.length && t[j]! < to; j++) {
    const v = u[j]!;
    if (v === 0) continue;
    const segEnd = j + 1 < t.length ? t[j + 1]! : to;
    const overlap = Math.min(segEnd, to) - Math.max(t[j]!, from);
    if (overlap > 0) total += v * overlap;
  }
  return total;
}
