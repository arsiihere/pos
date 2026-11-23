// 03a v1.2.10 §3.5.7 PR-4, PR-5, PR-7 (STAB-7): the LinePrioritized fold on slot stations: priority_at, priority_delay_ms
// and priority_land_ms, the priority step of pass 1 (priority groups first, each as one group toward priority_land_ms),
// what it never touches (B-3), sticky, release, replay; tests 152, 154, 157, 162 (slot part), 169, 176 (slot part), 160
// (replay part). Kit: priority-kit.ts. No timing asserts (AD-32).
import { parseEvent, type PosEvent } from '@pos/events';
import { describe, expect, it } from 'vitest';
import { applyEvents, buildEngineState, getAlertIntents, liveInterval, type EngineState } from '../src/index';
import { at, capacityEv, configEvent, fireEv, fold, G, kitchen, landOf, M, orderEv, prioritizedEv, prioritize, S, startEv, submit, Tg } from './priority-kit';

const withoutDiag = (s: EngineState): Omit<EngineState, 'diagnostics'> => {
  const { diagnostics: _d, ...rest } = s;
  void _d;
  return rest;
};

// The owner's example (§10.3g #152): table A's fish, karahi and BBQ served together, BBQ max delay 5 min. The grill
// (capacity 1) cooks C's line, which overruns; Z's grill line was fired at +10 and nobody taps Start, so it slides
// behind the overrun. B (delivery, weight 300) ordered a BBQ after A. At +12 a re-plan of the grill finds A's BBQ late
// (the slide): the weighted search puts B's BBQ ahead of it, and A's BBQ lands at +37, 11 min past T = +26.
function ownerExample(log?: PosEvent[]): EngineState {
  let s = kitchen(
    [
      { station_id: 'FISH', capacity: 2 },
      { station_id: 'GRILL', capacity: 1 },
      { station_id: 'KAR', capacity: 2 },
    ],
    {},
    log,
  );
  s = submit(s, 'OC', [{ id: 'c', station: 'GRILL', cook: 10 * M, mode: 'immediate' }], at(0), {}, log).state;
  s = fold(s, [fireEv('GRILL', ['c'], at(0)), startEv('OC', 'c', at(0))], log);
  s = submit(s, 'OZ', [{ id: 'z', station: 'GRILL', cook: 10 * M, mode: 'immediate' }], at(0), {}, log).state;
  s = submit(
    s,
    'OA',
    [
      { id: 'fish', station: 'FISH', cook: 8 * M },
      { id: 'kar', station: 'KAR', cook: 12 * M },
      { id: 'bbq', station: 'GRILL', cook: 6 * M, maxDelay: 5 * M },
    ],
    at(0),
    {},
    log,
  ).state;
  s = submit(s, 'OB', [{ id: 'bbqB', station: 'GRILL', cook: 6 * M, mode: 'immediate', weight: 300 }], at(1), { order_type: 'delivery' }, log).state;
  s = fold(s, [fireEv('GRILL', ['z'], at(10))], log);
  s = submit(s, 'OX', [{ id: 'x', station: 'GRILL', cook: M, mode: 'immediate' }], at(12), {}, log).state;
  return s;
}

describe('[03a v1.2.10 §3.5.7 PR-4] the LinePrioritized fold on slot stations', () => {
  it('[03a #152] the owner\'s example: A\'s BBQ takes the next free grill unit ahead of B\'s later BBQ; A\'s waiting lines land with it; T and the promise unchanged', () => {
    const s0 = ownerExample();
    expect(Tg(s0, 'OA')).toBe(at(26));
    expect(s0.lines.bbqB!.fire_ms!).toBeLessThan(s0.lines.bbq!.fire_ms!);
    expect(landOf(s0, 'bbq')).toBeGreaterThan(at(26) + 5 * M);
    // The karahi is still waiting (frozen, not fired) when the BBQ crosses, so a waiting line drives the delay.
    expect(s0.lines.kar).toMatchObject({ stage: 'added', fired_at: null });
    const drafts = getAlertIntents(s0, at(12)).prioritized;
    expect(drafts.map((d) => d.payload)).toEqual([{ order_id: 'OA', group_id: G('OA'), order_item_ids: ['fish', 'kar', 'bbq'], delay_ms: landOf(s0, 'bbq') - at(26), at_ms: at(12) }]);
    const t = at(12) + S;
    const s = fold(s0, [prioritizedEv(drafts[0]!, t)]);
    for (const id of ['fish', 'kar', 'bbq']) expect(s.lines[id]!.priority_at, id).toBe(t);
    const g = s.orders.OA!.groups[G('OA')]!;
    // delay(g, recorded_at) from the state before the placement (the BBQ's estimate then), not the payload's.
    expect(g.priority_delay_ms).toBe(landOf(s0, 'bbq') - at(26));
    // The next free grill time: after Z's packed interval [t, t + 10 min).
    expect(s.lines.bbq!.booked!.start).toBe(t + 10 * M);
    expect(g.priority_land_ms).toBe(landOf(s, 'bbq'));
    expect(s.lines.bbqB!.fire_ms!).toBeGreaterThanOrEqual(s.lines.bbq!.booked!.end);
    // The hidden fish lands with it; the frozen karahi keeps its place (never touched, B-3).
    expect(landOf(s, 'fish')).toBe(g.priority_land_ms);
    expect(s.lines.kar!.fire_ms).toBe(s0.lines.kar!.fire_ms);
    expect(s.lines.kar!.booked).toEqual(s0.lines.kar!.booked);
    expect(Tg(s, 'OA')).toBe(at(26));
    expect(s.orders.OA!.promise_ms).toBe(s0.orders.OA!.promise_ms);
    expect(s.lines.fish!.deadline_ms).toBe(s0.lines.fish!.deadline_ms);
    // The crossing is consumed: no entry, no second draft (condition 1 fails).
    expect(s.priority_due[G('OA')]).toBeUndefined();
    expect(getAlertIntents(s, at(30)).prioritized.map((d) => d.payload.group_id)).not.toContain(G('OA'));
  });

  it('[03a #157] nothing cooking or fired is pre-empted: COOKING and fired-not-started lines keep their live intervals; a fired priority line only carries the mark', () => {
    // A's karahi is fired (not started) before the fold.
    const s0 = fold(ownerExample(), [fireEv('KAR', ['kar'], at(12))]);
    const t = at(12) + S;
    const before = Object.fromEntries(['c', 'z', 'kar'].map((id) => [id, liveInterval(s0, id, t)]));
    const s = prioritize(s0, at(12) + S);
    expect(s.lines.kar!.priority_at).toBe(t);
    for (const id of ['c', 'z', 'kar']) expect(liveInterval(s, id, t), id).toEqual(before[id]);
    expect(s.lines.kar!.fired_at).toBe(at(12));
  });

  it('[03a #162 slot] a frozen line of another order is never moved: the priority line takes the first free capacity after it', () => {
    // GRILL capacity 2: Q and W fired at +0 by nobody (frozen); A's BBQ (max delay 1 min) held to T = +16 with its
    // karahi. The drop to 1 at +1 pushes W to [+10, +20) and A's BBQ to land at +26; at +8 W is frozen again.
    let s = kitchen([
      { station_id: 'GRILL', capacity: 2 },
      { station_id: 'KAR', capacity: 2 },
    ]);
    s = submit(s, 'OQ', [{ id: 'q', station: 'GRILL', cook: 10 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OW', [{ id: 'w', station: 'GRILL', cook: 10 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OA', [
      { id: 'kar', station: 'KAR', cook: 16 * M },
      { id: 'bbq', station: 'GRILL', cook: 6 * M, maxDelay: M },
    ], at(0)).state;
    s = fold(s, [capacityEv('GRILL', 1, at(1))]);
    expect(s.lines.w!.booked).toMatchObject({ start: at(10), end: at(20) });
    expect(landOf(s, 'bbq')).toBe(at(26));
    const w = s.lines.w!;
    const after = prioritize(s, at(8));
    expect(after.lines.bbq!.priority_at).toBe(at(8));
    // W keeps its fire, booking and mark (the fold adds no 'moved'); the BBQ's earliest fit would need W's [+10, +16).
    expect(after.lines.w).toEqual(w);
    expect(after.lines.bbq!.booked).toMatchObject({ start: at(20), end: at(26) });
  });

  it('[03a #154] sticky: kept through a re-plan and a new order; never raised twice; the fold reads neither delay_ms nor at_ms; Start ends it', () => {
    const s0 = ownerExample();
    const d = getAlertIntents(s0, at(12)).prioritized[0]!;
    const t = at(12) + S;
    // Z's Start is tapped at the fold, so its slide stops (a slide is fixed input that may move the land later, PR-4).
    const a = fold(s0, [prioritizedEv(d, t), startEv('OZ', 'z', t)]);
    const P = a.orders.OA!.groups[G('OA')]!.priority_land_ms!;
    // Two events that differ only in delay_ms and at_ms fold to the same state.
    const e1 = prioritizedEv(d, t);
    const e2 = { ...e1, payload: { ...e1.payload, delay_ms: 1, at_ms: 7 } };
    expect(withoutDiag(fold(s0, [e2]))).toEqual(withoutDiag(fold(s0, [e1])));
    // A new grill order with a heavy weight never moves the priority line later.
    let s = submit(a, 'OD', [{ id: 'bbqD', station: 'GRILL', cook: 6 * M, mode: 'immediate', weight: 900 }], at(13), { order_type: 'delivery' }).state;
    expect(landOf(s, 'bbq')).toBe(P);
    expect(s.orders.OA!.groups[G('OA')]!.priority_land_ms).toBe(P);
    // A void re-plans the grill: still priority, still at P; on time again, never drafted again.
    s = fold(s, [orderEv('ItemVoided', 'OB', { order_item_id: 'bbqB', units: 1 }, at(13) + S)]);
    expect(s.lines.bbq!.priority_at).toBe(t);
    expect(landOf(s, 'bbq')).toBe(P);
    expect(s.priority_due[G('OA')]).toBeUndefined();
    for (const now of [at(14), at(40)]) expect(getAlertIntents(s, now).prioritized.map((x) => x.payload.group_id)).not.toContain(G('OA'));
    // Start ends it: the line is no longer placed as priority (it is in flight).
    s = fold(s, [fireEv('GRILL', ['bbq'], at(14)), startEv('OA', 'bbq', at(14))]);
    expect(s.lines.bbq!.stage).toBe('cooking');
    expect(s.lines.bbq!.priority_at).toBe(t);
  });

  it('[03a #169] release keeps priority: a released line keeps priority_at, its new group copies priority_delay_ms and keeps the source T; the rest keeps priority_land_ms', () => {
    const s0 = prioritize(ownerExample(), at(12) + S);
    const g0 = s0.orders.OA!.groups[G('OA')]!;
    // The frozen karahi is expedited: it keeps its placement and its group takes the source T (P3).
    const s = fold(s0, [orderEv('ItemsReleased', 'OA', { order_id: 'OA', alert_id: null, released: [], expedite: ['kar'] }, at(13))]);
    const gk = s.lines.kar!.group_id;
    expect(gk).not.toBe(G('OA'));
    expect(s.lines.kar!.priority_at).toBe(at(12) + S);
    expect(s.orders.OA!.groups[gk]).toMatchObject({ target_land_ms: at(26), priority_delay_ms: g0.priority_delay_ms, priority_land_ms: null });
    expect(s.orders.OA!.groups[G('OA')]!.priority_land_ms).toBe(g0.priority_land_ms);
  });

  it('[03a #176 slot] a group whose lines are all frozen keeps priority_land_ms null and moves nothing; a capacity drop making its line hidden sets it', () => {
    // GRILL capacity 3: Q, W and A's immediate BBQ (max delay 1 min) fire at +0 by nobody (frozen).
    let s = kitchen([{ station_id: 'GRILL', capacity: 3 }]);
    s = submit(s, 'OQ', [{ id: 'q', station: 'GRILL', cook: 10 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OW', [{ id: 'w', station: 'GRILL', cook: 10 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OA', [{ id: 'zbbq', station: 'GRILL', cook: 6 * M, mode: 'immediate', maxDelay: M }], at(0)).state;
    expect(s.priority_due[G('OA')]).toBe(at(1) + 1);
    const before = s;
    s = prioritize(s, at(1) + 1);
    expect(s.lines.zbbq!.priority_at).toBe(at(1) + 1);
    expect(s.orders.OA!.groups[G('OA')]!.priority_land_ms).toBeNull();
    for (const id of ['q', 'w', 'zbbq']) expect(s.lines[id]!.booked, id).toEqual(before.lines[id]!.booked);
    // The drop to 1 at +2 keeps q and pushes w and zbbq past their deadlines (immediate lines: deadline = fire): the
    // priority line is placed before the §3.5.6 search (PR-6) at its first fit after q, now hidden, and the fold sets
    // priority_land_ms to its land (d_p is defined from then on); w goes after it.
    s = fold(s, [capacityEv('GRILL', 1, at(2))]);
    expect(s.lines.zbbq!.booked).toMatchObject({ start: at(10), end: at(16) });
    expect(s.lines.zbbq!.fire_ms!).toBeGreaterThan(at(2) + 2 * M);
    expect(s.orders.OA!.groups[G('OA')]!.priority_land_ms).toBe(at(16));
    expect(s.lines.w!.booked).toMatchObject({ start: at(16), end: at(26) });
  });

  it('[03a #160 replay] snapshot + replay = full replay = live with priority groups (priority_land_ms, priority_delay_ms, priority_due)', () => {
    const log: PosEvent[] = [];
    let s = ownerExample(log);
    s = prioritize(s, at(12) + S, log);
    s = submit(s, 'OD', [{ id: 'bbqD', station: 'GRILL', cook: 6 * M, mode: 'immediate' }], at(13), {}, log).state;
    const parsed = log.map((e) => parseEvent(e));
    expect(parsed.some((e) => e.event_type === 'LinePrioritized')).toBe(true);
    const full = buildEngineState(parsed);
    expect(withoutDiag(full)).toEqual(withoutDiag(s));
    expect(full.orders.OA!.groups[G('OA')]).toEqual(s.orders.OA!.groups[G('OA')]);
    const k = Math.floor(parsed.length / 2);
    const snap = JSON.parse(JSON.stringify(buildEngineState(parsed.slice(0, k)))) as EngineState;
    expect(withoutDiag(applyEvents(snap, parsed.slice(k)))).toEqual(withoutDiag(s));
    void configEvent;
  });
});
