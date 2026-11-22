// 03a v1.2.10 §3.5.7 PR-4 "The priority order" (STAB-7; re-review R-1, final check FC-1): the comparator by lateness onset
// max(priority_at − priority_delay_ms, arrival), then the arrival key, then order_item_id (plan task 15); test 167's
// order cases at comparator level, its tick-phase case and its FC-1 jump case.
import { describe, expect, it } from 'vitest';
import { priorityCmp, priorityRank, type PriorityRank } from '../src/priority';
import type { EngineState } from '../src/index';
import { at, deepFreeze, G, kitchen, M, S, submit } from './priority-kit';

// Orders O1…On (one immediate line each, listed at `arrived`), then each made a priority group by hand: its line's
// priority_at and its group's priority_delay_ms (what the LinePrioritized fold stores).
function groups(spec: Array<{ id: string; arrived: number; since: number; delay: number }>): EngineState {
  let s = kitchen([{ station_id: 'S1', capacity: 8 }]);
  for (const g of [...spec].sort((a, b) => a.arrived - b.arrived)) s = submit(s, g.id, [{ id: `${g.id}L`, cook: 10 * M, mode: 'immediate' }], g.arrived).state;
  const lines = { ...s.lines };
  const orders = { ...s.orders };
  for (const g of spec) {
    lines[`${g.id}L`] = { ...lines[`${g.id}L`]!, priority_at: g.since };
    const o = orders[g.id]!;
    orders[g.id] = { ...o, groups: { ...o.groups, [G(g.id)]: { ...o.groups[G(g.id)]!, priority_delay_ms: g.delay } } };
  }
  return deepFreeze({ ...s, lines, orders });
}

const ranked = (s: EngineState, ids: string[]): string[] =>
  ids
    .map((id) => priorityRank(s, id, G(id)))
    .filter((r): r is PriorityRank => r !== null)
    .sort(priorityCmp(s))
    .map((r) => r.group_id.replace(/:0$/, ''));

// "12:mm:ss.ms" relative to at(0) = 12:00.
const hm = (min: number, sec = 0, ms = 0): number => at(min) + sec * S + ms;

describe('[03a v1.2.10 §3.5.7 PR-4] the priority order by lateness onset', () => {
  it('[03a #167] the earliest onset first, not the larger delay', () => {
    // P1 at 12:05:00 with 5:00.1 (onset 11:59:59.9); P2 at 12:13:00 with 12:00 (onset 12:01) → P1 first.
    const a = groups([
      { id: 'P1', arrived: hm(-20), since: hm(5), delay: 5 * M + 100 },
      { id: 'P2', arrived: hm(-20) + S, since: hm(13), delay: 12 * M },
    ]);
    expect(priorityRank(a, 'P1', G('P1'))!.onset).toBe(hm(-1, 59, 900));
    expect(ranked(a, ['P2', 'P1'])).toEqual(['P1', 'P2']);
    // P2 at 12:10:00 with 12:00 (onset 11:58) → P2 first.
    const b = groups([
      { id: 'P1', arrived: hm(-20), since: hm(5), delay: 5 * M + 100 },
      { id: 'P2', arrived: hm(-20) + S, since: hm(10), delay: 12 * M },
    ]);
    expect(ranked(b, ['P1', 'P2'])).toEqual(['P2', 'P1']);
  });

  it('[03a #167] equal onsets → the earlier arrival, then order_item_id; a group that is not priority has no rank', () => {
    const s = groups([
      { id: 'PB', arrived: hm(-20) + S, since: hm(5), delay: 5 * M },
      { id: 'PA', arrived: hm(-20), since: hm(6), delay: 6 * M },
    ]);
    expect(ranked(s, ['PB', 'PA'])).toEqual(['PA', 'PB']);
    const same = groups([
      { id: 'QB', arrived: hm(-20), since: hm(5), delay: 5 * M },
      { id: 'QA', arrived: hm(-20), since: hm(5), delay: 5 * M },
    ]);
    // Same arrived_at: the arrival key's order_id decides (QA < QB).
    expect(ranked(same, ['QB', 'QA'])).toEqual(['QA', 'QB']);
    const plain = submit(kitchen([{ station_id: 'S1' }]), 'O9', [{ id: 'x', cook: M, mode: 'immediate' }], at(0)).state;
    expect(priorityRank(plain, 'O9', G('O9'))).toBeNull();
  });

  it('[03a #167] tick phase: P1 with 5:00.1 at 12:05:00.0 stays ahead of P3 crossing later with 5:00.4 (fails on "larger delay first")', () => {
    const s = groups([
      { id: 'P1', arrived: hm(-20), since: hm(5), delay: 5 * M + 100 },
      { id: 'P3', arrived: hm(-20) + S, since: hm(5, 0, 500), delay: 5 * M + 400 },
    ]);
    expect(ranked(s, ['P3', 'P1'])).toEqual(['P1', 'P3']);
  });

  it('[03a #167, FC-1] jump case: a group whose raw onset falls before it was placed ranks at its arrival, behind an older late group', () => {
    // A (T 12:00) prioritised at 12:05:00.1 with 5:00.1 → onset 12:00. B placed at 12:20, its hidden land jumped by a
    // capacity drop, drafted at 12:21 with 30:00 → raw onset 11:51, before B existed; its onset is its arrival 12:20.
    const s = groups([
      { id: 'A', arrived: hm(-10), since: hm(5, 0, 100), delay: 5 * M + 100 },
      { id: 'B', arrived: hm(20), since: hm(21), delay: 30 * M },
    ]);
    expect(priorityRank(s, 'B', G('B'))!.onset).toBe(hm(20));
    expect(ranked(s, ['B', 'A'])).toEqual(['A', 'B']);
  });
});
