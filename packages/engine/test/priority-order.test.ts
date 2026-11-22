// 03a v1.2.10 §3.5.7 PR-4 "The priority order" (STAB-7; re-review R-1, final check FC-1): the comparator by lateness onset
// max(priority_at − priority_delay_ms, arrival), then the arrival key, then order_item_id (plan task 15); test 167's
// order cases at comparator level, its tick-phase case and its FC-1 jump case.
import { describe, expect, it } from 'vitest';
import { priorityCmp, priorityRank, type PriorityRank } from '../src/priority';
import { priorityDueOf } from '../src/slip';
import { getTickIntents, groupReadiness, stationPlan, stationView, type EngineState } from '../src/index';
import { anOrderBatch, aStockSet } from '@pos/events/testing';
import { at, batchStation, configEvent, deepFreeze, fireEv, fold, G, kitchen, M, orderEv, S, stamp, startEv, stationEv, submit, Tg } from './priority-kit';

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

// ---- placement (plan task 18): the priority step places priority groups in the priority order --------------------------

// S1 (capacity 1) is held by W's COOKING line until +30; then the hidden lines of the given orders (cook 10, immediate).
// `patch` makes a line priority as the fold would leave it (priority_at, its group's priority_delay_ms and
// priority_land_ms), so the onsets are exact.
function queueOn(ids: string[], o: { follow?: string } = {}): EngineState {
  let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
  s = submit(s, 'OW', [{ id: 'w', cook: 30 * M, mode: 'immediate' }], at(0)).state;
  s = fold(s, [fireEv('S1', ['w'], at(0)), startEv('OW', 'w', at(0))]);
  for (const id of ids) s = submit(s, `O${id}`, [{ id, cook: 10 * M, mode: 'immediate', ...(o.follow === id ? { weight: 200 } : {}) }], at(0), o.follow === id ? { follow_up: true } : {}).state;
  return s;
}
function patch(s: EngineState, id: string, p: { since: number; delay: number; land: number; arrived?: number }): EngineState {
  const l = s.lines[id]!;
  const o = s.orders[l.order_id]!;
  const next = {
    ...s,
    lines: { ...s.lines, [id]: { ...l, priority_at: p.since, ...(p.arrived === undefined ? {} : { arrived_at: p.arrived }) } },
    orders: { ...s.orders, [l.order_id]: { ...o, groups: { ...o.groups, [l.group_id]: { ...o.groups[l.group_id]!, priority_delay_ms: p.delay, priority_land_ms: p.land } } } },
  };
  return deepFreeze({ ...next, priority_due: priorityDueOf(next) });
}
// A re-plan of S1 at t: a void of an unrelated line placed after the others.
function replan(s: EngineState, t: number): EngineState {
  const z = submit(s, 'OZZ', [{ id: 'zz', cook: M, mode: 'immediate' }], t).state;
  return fold(z, [orderEv('ItemVoided', 'OZZ', { order_item_id: 'zz', units: 1 }, t + 1)]);
}
const startOf = (s: EngineState, id: string): number => s.lines[id]!.booked!.start;

describe('[03a v1.2.10 §3.5.7 PR-4, PR-6] the order among priority groups, weights and boost at placement', () => {
  it('[03a #167 order] two priority groups wanting one grill slot: the earlier onset takes it; the other\'s priority_land_ms moves later (Sticky cause 2)', () => {
    let s = queueOn(['a', 'b']);
    expect([startOf(s, 'a'), startOf(s, 'b')]).toEqual([at(30), at(40)]);
    // Both target +40; b's onset (+10) is earlier than a's (+20).
    s = patch(s, 'a', { since: at(24), delay: 4 * M, land: at(40) });
    s = patch(s, 'b', { since: at(24), delay: 14 * M, land: at(40) });
    s = replan(s, at(25));
    expect(startOf(s, 'b')).toBe(at(30));
    expect(startOf(s, 'a')).toBe(at(40));
    expect(s.orders.Oa!.groups[G('Oa')]!.priority_land_ms).toBe(at(50));
    expect(s.orders.Ob!.groups[G('Ob')]!.priority_land_ms).toBe(at(40));
  });

  it('[03a #167, FC-1 jump] a group whose raw onset precedes its arrival ranks at its arrival: A keeps the slot and its priority_land_ms', () => {
    let s = queueOn(['a', 'b']);
    s = patch(s, 'a', { since: at(5) + 100, delay: 5 * M + 100, land: at(40) }); // onset +0
    s = patch(s, 'b', { since: at(21), delay: 30 * M, land: at(40), arrived: at(20) }); // raw onset −9, arrival +20
    s = replan(s, at(25));
    expect(startOf(s, 'a')).toBe(at(30));
    expect(s.orders.Oa!.groups[G('Oa')]!.priority_land_ms).toBe(at(40));
  });

  it('[03a #159] weights order only non-priority lines: a priority dine-in line goes ahead of a follow-up line with twice the weight; a boost still goes ahead of it', () => {
    let s = queueOn(['f', 'p'], { follow: 'f' });
    expect(startOf(s, 'f')).toBe(at(30));
    s = patch(s, 'p', { since: at(24), delay: 5 * M, land: at(40) });
    s = replan(s, at(25));
    expect(startOf(s, 'p')).toBe(at(30));
    expect(startOf(s, 'f')).toBe(at(40));
    // OrderBoosted of f (a human jump, D4): f goes ahead of the priority line.
    s = fold(s, [orderEv('OrderBoosted', 'Of', { order_id: 'Of' }, at(26))]);
    expect(startOf(s, 'f')).toBe(at(30));
    expect(startOf(s, 'p')).toBeGreaterThanOrEqual(at(40));
    expect(s.lines.f!.mark).toBe('boost');
  });
});

describe('[03a v1.2.10 §3.6.1 item 2] auto-fill takes priority lines first', () => {
  it('[03a #158] one idle unit, an eligible priority line and an eligible older non-priority line: the priority line is fired', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    s = submit(s, 'OW', [{ id: 'w', cook: 10 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'Oa', [{ id: 'a', cook: 5 * M, mode: 'immediate', early: 30 * M }], at(0)).state;
    s = submit(s, 'Ob', [{ id: 'b', cook: 5 * M, mode: 'immediate', early: 30 * M }], at(0)).state;
    s = fold(s, [orderEv('ItemVoided', 'OW', { order_item_id: 'w', units: 1 }, at(0) + S)]);
    expect([startOf(s, 'a'), startOf(s, 'b')]).toEqual([at(9), at(14)]); // the keep cushion
    const fill = (x: EngineState): string[][] =>
      getTickIntents(x, at(1))
        .filter((d) => d.event_type === 'FireDispatched')
        .map((d) => (d.payload as { order_item_ids: string[]; reason: string }).order_item_ids);
    expect(fill(s)).toEqual([['a']]);
    s = patch(s, 'b', { since: at(0) + 2 * S, delay: 5 * M, land: at(19) });
    expect(fill(s)).toEqual([['b']]);
  });
});

describe('[03a v1.2.10 §3.5.7 PR-8] views carry priority on priority lines only', () => {
  it('[03a #161] stationView, stationPlan and groupReadiness carry priority { since_ms, minutes_late }; minutes_late follows now; 0 when on time again; Start drops it', () => {
    let s = queueOn(['a', 'b']);
    s = patch(s, 'b', { since: at(24), delay: 5 * M, land: at(50) });
    // b lands at its T (+50): a sticky priority on a group that is on time again.
    expect(Tg(s, 'Ob')).toBe(at(50));
    const plan = stationPlan(s, 'S1', at(25)).lines;
    expect(plan.find((l) => l.order_item_id === 'b')!.priority).toEqual({ since_ms: at(24), minutes_late: 0 });
    expect(plan.find((l) => l.order_item_id === 'a')!.priority).toBeUndefined();
    // At +45 b's estimate is max(+50, +45 + 10) = +55: 5 min late; frozen at +48 so it is in Next.
    expect(stationPlan(s, 'S1', at(45)).lines.find((l) => l.order_item_id === 'b')!.priority).toEqual({ since_ms: at(24), minutes_late: 5 });
    expect(stationView(s, 'S1', at(48) + 30 * S).next.find((l) => l.order_item_id === 'b')!.priority).toEqual({ since_ms: at(24), minutes_late: 9 });
    expect(stationView(s, 'S1', at(48) + 30 * S).next.find((l) => l.order_item_id === 'a')?.priority).toBeUndefined();
    expect(groupReadiness(s, 'Ob', at(45))).toEqual([{ group_id: G('Ob'), done: [], waiting: [], hold: false, priority: { since_ms: at(24), minutes_late: 5 } }]);
    expect(groupReadiness(s, 'Oa', at(45))[0]!.priority).toBeUndefined();
    // Start ends it.
    s = fold(s, [fireEv('S1', ['b'], at(46)), startEv('Ob', 'b', at(46))]);
    expect(stationView(s, 'S1', at(47)).now.find((l) => l.order_item_id === 'b')!.priority).toBeUndefined();
    expect(groupReadiness(s, 'Ob', at(47))[0]!.priority).toBeUndefined();
  });
});

describe('[03a v1.2.10 §3.5.7 PR-9] paused stations, stock lines, type changes', () => {
  it('[03a #170] a priority line on a paused slot station is still placed first there (never routed off it)', () => {
    let s = queueOn(['a', 'b']);
    s = fold(s, [stationEv('StationPauseSet', 'S1', { station_id: 'S1', paused: true }, at(24))]);
    s = fold(s, [orderEv('LinePrioritized', 'Ob', { order_id: 'Ob', group_id: G('Ob'), order_item_ids: ['b'], delay_ms: 0, at_ms: at(25) }, at(25))]);
    expect(s.lines.b!.station_id).toBe('S1');
    expect(startOf(s, 'b')).toBe(at(30));
    expect(startOf(s, 'a')).toBe(at(40));
  });

  it('[03a #170] a from-stock line becomes priority: the fold writes, moves and releases no reservation', () => {
    let s = kitchen([{ station_id: 'S1', capacity: 1 }]);
    s = fold(s, [stamp(aStockSet({ payload: { stock_item_id: 'K1', on_hand: 10, unit: 'piece' } }), at(-1))]);
    s = submit(s, 'OW', [{ id: 'w', cook: 30 * M, mode: 'immediate' }], at(0)).state;
    s = fold(s, [fireEv('S1', ['w'], at(0)), startEv('OW', 'w', at(0))]);
    const events = anOrderBatch({
      order_id: 'OD',
      recorded_at: at(0),
      seq: 9_000,
      lines: [{ order_item_id: 'd', item: { cook_time_ms: 10 * M, stock_time_ms: 5 * M, serve_mode: 'immediate', stock_draws: [{ stock_item_id: 'K1', quantity: 1 }], out_of_stock_behaviour: 'cook_fresh' }, line: { from_stock: true } }],
      order: { groups: [{ group_id: 'OD:0', target_land_ms: at(35), promise_ms: at(38), order_item_ids: ['d'] }], table_key: 't:OD' },
      reserved: [{ stock_item_id: 'K1', order_item_id: 'd', quantity: 1 }],
    }).map((e) => stamp(e, at(0)));
    s = fold(s, events);
    expect(s.lines.d!.from_stock).toBe(true);
    const stock = s.stock;
    s = fold(s, [orderEv('LinePrioritized', 'OD', { order_id: 'OD', group_id: 'OD:0', order_item_ids: ['d'], delay_ms: 0, at_ms: at(25) }, at(25))]);
    expect(s.lines.d!.priority_at).toBe(at(25));
    expect(s.stock).toEqual(stock);
    expect(s.lines.d!.draws).toEqual([{ stock_item_id: 'K1', quantity: 1, reserved: 1 }]);
  });

  it('[03a #170] a station switched slot → batch keeps the line\'s priority_at, priority_land_ms and priority_delay_ms', () => {
    let s = queueOn(['a', 'b']);
    s = patch(s, 'b', { since: at(24), delay: 14 * M, land: at(50) });
    const g = s.orders.Ob!.groups[G('Ob')]!;
    s = fold(s, [configEvent([batchStation('S1', { capacity: 1 })], {}, at(25))]);
    expect(s.stations.S1!.type).toBe('batch');
    expect(s.lines.b!.priority_at).toBe(at(24));
    expect(s.orders.Ob!.groups[G('Ob')]).toMatchObject({ priority_land_ms: g.priority_land_ms, priority_delay_ms: g.priority_delay_ms });
  });
});
