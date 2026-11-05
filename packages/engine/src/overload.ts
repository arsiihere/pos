// 03a §3.5.6 overload — weighted lateness (D5). Pure: no clock, no ids, no I/O; inputs are never mutated.
//
// When a re-plan leaves a late set, every free hidden line of the station (the pass-1 set: pruned lines, lines held
// by a void re-loop and frozen / fired / COOKING / done lines stay fixed in `base`; FIFO stations never get here)
// is re-placed with extended deadlines
//   d_Λ(L) = d(L) + min(Λ × 100 / w(L), max_late_ms(L) ?? ∞)          (d = the queued deadline, AD-12)
// for the smallest Λ (a multiple of cascade_step_ms; Λ = 0 first, then exponential, then binary, ≤ 16 probes) at
// which all fit. Keep is not applied.
//
// AD-15 (controller ruling 2026-11-06): the lines are placed backward, in descending d_Λ (the exact reverse of the
// ascending order (d_Λ, −urgency, order_item_id), urgency = the pass-1 tie key w × (t − placed_at)), each at
// latestFit(lo = max(t, d − max_early_ms), hi = d_Λ). The resulting execution order is EDF on d_Λ, and this is the
// reading under which §3.5.6's "optimal for one slot (Lawler)" holds (forward latestFit is not: test AD-15).
//
// Caps (§3.5.6 "a line held at its max_late_ms cap is not shifted further; if it still cannot fit it is placed at
// earliestFit after the others"; AD-15 Q3 / Q4):
//   - A capped line that cannot fit by d + max_late_ms even when every uncapped line gives way (the limit Λ → ∞:
//     the lines that have a cap, alone, backward against `base`) is *hopeless*: it leaves the search and is placed
//     at earliestFit after the others. success(Λ) = every other line fits by its d_Λ. (Read literally, "every line
//     not at its cap fits" would let a search stop at a Λ where a capped line is merely crowded out and push it far
//     past its cap; see the report of task 10.)
//   - If 16 probes find no success, the largest Λ probed is used and every line that did not fit there is placed at
//     earliestFit after the others.
//   - `capped` = the lines placed after the others, plus the lines whose final lateness (fire − d, after the AD-16
//     compaction below) is ≥ max_late_ms: §3.10 raises station_overload when a line reaches its cap.
// A reporting cap, never a refusal (D3): every line gets a placement.
import { earliestFit, latestFit, occupancy } from './profile.js';
import type { EngineLine, Profile } from './state.js';

export const OVERLOAD_MAX_PROBES = 16;

export type Booking = { start: number; end: number; units: number };
// capped: §3.5.6 / AD-15, stored on the line by applyMoves (absent = false).
export type Placement = { fire: number; booked: Booking; capped?: boolean };

// AD-4: the booking of a line fired at `fire` (prep off-station, D35).
export function bookingAt(line: Pick<EngineLine, 'units' | 'prep_ms' | 'cook_ms'>, cap: number, fire: number): Booking {
  const occ = occupancy(line.units, cap, line.cook_ms);
  return { start: fire + line.prep_ms, end: fire + line.prep_ms + occ.cook_ms, units: occ.units };
}

// A local, mutable working profile (never escapes: `snapshot` returns a fresh canonical copy). add() inserts at
// most two boundaries and bumps the segments between them in place; equal neighbours are left unmerged until
// snapshot, which latestFit / earliestFit read correctly (sorted boundaries, last u = 0).
export class Work implements Profile {
  readonly t: number[];
  readonly u: number[];
  constructor(p: Profile) {
    this.t = [...p.t];
    this.u = [...p.u];
  }
  private boundary(x: number): number {
    let lo = 0;
    let hi = this.t.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.t[mid]! < x) lo = mid + 1;
      else hi = mid;
    }
    if (this.t[lo] !== x) {
      this.t.splice(lo, 0, x);
      this.u.splice(lo, 0, lo > 0 ? this.u[lo - 1]! : 0);
    }
    return lo;
  }
  add(b: Booking, sign: 1 | -1 = 1): void {
    if (b.end <= b.start || b.units === 0) return;
    const i = this.boundary(b.start);
    const j = this.boundary(b.end);
    for (let k = i; k < j; k++) this.u[k]! += sign * b.units;
  }
  // Takes back exactly a booking this profile holds (the AD-16 compaction's own placements only).
  remove(b: Booking): void {
    this.add(b, -1);
  }
  snapshot(): Profile {
    const t: number[] = [];
    const u: number[] = [];
    let prev = 0;
    for (let k = 0; k < this.t.length; k++) {
      if (this.u[k] === prev) continue;
      t.push(this.t[k]!);
      u.push(this.u[k]!);
      prev = this.u[k]!;
    }
    return { t, u };
  }
}

// A line as the search reads it: w = weightOf (§3.5.2), urgency = w × (t − placed_at) (the pass-1 tie key).
export type OverloadLine = Pick<EngineLine, 'order_item_id' | 'deadline_ms' | 'max_early_ms' | 'max_late_ms' | 'units' | 'prep_ms' | 'cook_ms'> & {
  w: number;
  urgency: number;
};

export type OverloadResult = {
  profile: Profile; // base + every placement
  placements: Array<[string, Placement]>; // one per input line
  capped: string[]; // sorted order_item_ids
  probes: number; // Λ probes run (≤ OVERLOAD_MAX_PROBES), for the simulator (task 18)
  lambda: number; // the chosen Λ
};

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// Ascending (key, −urgency, order_item_id); callers walk it backward for the placement.
function ascending<X extends { key: number; L: OverloadLine }>(xs: X[]): X[] {
  return xs.sort((a, b) => a.key - b.key || b.L.urgency - a.L.urgency || byId(a.L.order_item_id, b.L.order_item_id));
}

const loOf = (L: OverloadLine, t: number): number => Math.max(t, L.deadline_ms - L.max_early_ms);
// Λ × 100 / w in integer ms; a weight below 1 % is read as 1 % (no division by zero).
const stretch = (L: OverloadLine, lambda: number): number => Math.floor((lambda * 100) / Math.max(1, L.w));

type Probe = { ok: boolean; work: Work; placements: Map<string, Placement>; failed: OverloadLine[] };

// One probe: the lines backward in descending d_Λ, each at latestFit(lo, d_Λ) on a fresh copy of base.
function probe(base: Profile, lines: readonly OverloadLine[], cap: number, t: number, lambda: number): Probe {
  const work = new Work(base);
  const placements = new Map<string, Placement>();
  const failed: OverloadLine[] = [];
  const order = ascending(
    lines.map((L) => ({ L, key: L.deadline_ms + (L.max_late_ms === null ? stretch(L, lambda) : Math.min(stretch(L, lambda), L.max_late_ms)) })),
  );
  for (let k = order.length - 1; k >= 0; k--) {
    const { L, key } = order[k]!;
    const fire = latestFit(work, loOf(L, t), key, L.prep_ms, L.cook_ms, L.units, cap);
    if (fire === null) {
      failed.push(L);
      continue;
    }
    const booked = bookingAt(L, cap, fire);
    work.add(booked);
    placements.set(L.order_item_id, { fire, booked });
  }
  return { ok: failed.length === 0, work, placements, failed };
}

// §3.5.6 search on one station. `base` = the fixed profile (fixed + pruned + held lines); `lines` = every free
// hidden line of the station; cap = its effective capacity; step = cascade_step_ms (≥ 1). compact = false skips the
// AD-16 compaction (only the AD-16 property test compares against it).
export function overloadPlace(base: Profile, lines: readonly OverloadLine[], cap: number, t: number, step: number, compact = true): OverloadResult {
  // Hopeless capped lines: in the limit Λ → ∞ every uncapped line lies past them, so only the lines with a cap
  // compete, backward at d + max_late_ms against base. One pass, not a Λ probe.
  const withCap = lines.filter((L) => L.max_late_ms !== null);
  const hopeless = new Set(withCap.length === 0 ? [] : probe(base, withCap, cap, t, Number.MAX_SAFE_INTEGER).failed.map((L) => L.order_item_id));
  const searched = lines.filter((L) => !hopeless.has(L.order_item_id));

  let probes = 0;
  const found: { best: { lambda: number; p: Probe } | null; largest: { lambda: number; p: Probe } | null } = { best: null, largest: null };
  const run = (n: number): boolean => {
    probes++;
    const p = probe(base, searched, cap, t, n * step);
    if (found.largest === null || n * step >= found.largest.lambda) found.largest = { lambda: n * step, p };
    if (p.ok && (found.best === null || n * step < found.best.lambda)) found.best = { lambda: n * step, p };
    return p.ok;
  };
  if (!run(0)) {
    let lo = 0;
    let n = 1;
    let hi: number | null = null;
    while (probes < OVERLOAD_MAX_PROBES) {
      if (run(n)) {
        hi = n;
        break;
      }
      lo = n;
      n *= 2;
    }
    while (hi !== null && hi - lo > 1 && probes < OVERLOAD_MAX_PROBES) {
      const mid = lo + Math.floor((hi - lo) / 2);
      if (run(mid)) hi = mid;
      else lo = mid;
    }
  }
  const chosen = (found.best ?? found.largest)!;
  const { work, placements } = chosen.p;
  const lambda = chosen.lambda;

  // The leftovers (hopeless, or not fitted at the largest Λ when the budget ran out) at earliestFit after the
  // others, in ascending (d + cap, −urgency, order_item_id).
  const left = [...lines.filter((L) => hopeless.has(L.order_item_id)), ...chosen.p.failed];
  const capped = new Set<string>();
  for (const { L } of ascending(left.map((L) => ({ L, key: L.deadline_ms + (L.max_late_ms ?? stretch(L, lambda)) })))) {
    const fire = earliestFit(work, loOf(L, t), L.prep_ms, L.cook_ms, L.units, cap);
    const booked = bookingAt(L, cap, fire);
    work.add(booked);
    placements.set(L.order_item_id, { fire, booked });
    capped.add(L.order_item_id);
  }
  // AD-16 (developer ruling 2026-11-06): forward compaction. Backward latestFit(hi = d_Λ) can leave a line later
  // than it needs to be (a free slot by its own deadline lies before it). In execution order (ascending fire, ties
  // by order_item_id) each line is taken off the local profile and moved earlier, never later:
  // min(current fire, latestFit(lo, d) ?? earliestFit(lo)), then re-added. Λ and the order are the search's.
  // One extra linear pass (one fit pair + one remove / add per line).
  const exec = lines
    .map((L) => ({ L, fire: placements.get(L.order_item_id)!.fire }))
    .sort((a, b) => a.fire - b.fire || byId(a.L.order_item_id, b.L.order_item_id));
  for (const { L, fire: current } of compact ? exec : []) {
    const old = placements.get(L.order_item_id)!;
    work.remove(old.booked);
    const lo = loOf(L, t);
    const fire = Math.min(current, latestFit(work, lo, L.deadline_ms, L.prep_ms, L.cook_ms, L.units, cap) ?? earliestFit(work, lo, L.prep_ms, L.cook_ms, L.units, cap));
    const booked = fire === current ? old.booked : bookingAt(L, cap, fire);
    work.add(booked);
    if (fire !== current) placements.set(L.order_item_id, { fire, booked });
  }
  // Held at the cap, from the final placement (§3.10: a line reaches its max_late_ms cap; AD-16).
  for (const L of withCap) if (placements.get(L.order_item_id)!.fire - L.deadline_ms >= L.max_late_ms!) capped.add(L.order_item_id);

  return {
    profile: work.snapshot(),
    placements: lines.map((L) => [L.order_item_id, placements.get(L.order_item_id)!]),
    capped: [...capped].sort(byId),
    probes,
    lambda,
  };
}
