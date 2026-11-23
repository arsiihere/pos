// 03a v1.2.10 §3.5.7 PR-1–PR-3 (STAB-7): the delay, the level crossing `priority_due` (B-1, R-3), the draft with condition
// 3 at now and `priority_waits` / recheck_at (R-2, FC-3); tests 153 (engine part), 166, 167 (far cap), 168 (engine
// (a)–(c)), 171, 177. Kit: priority-kit.ts (every fold checks priority_due = priorityDueOf, test 106). No timing asserts.
import { parseEvent } from '@pos/events';
import { anItemAdded } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { buildEngineState, getAlertIntents, MAX_DELAY_NO_LIMIT_MS, nextAlertDueAt, priorityRecheckAt, type EngineState } from '../src/index';
import { priorityDueOf } from '../src/slip';
import { at, capacityEv, deepFreeze, doneEv, fireEv, fold, G, kitchen, landOf, M, orderEv, prioritizedEv, S, startEv, submit, Tg, type Item } from './priority-kit';

const drafted = (s: EngineState, now: number): string[] => getAlertIntents(s, now).prioritized.map((d) => d.payload.group_id);
const waits = (s: EngineState, now: number): Array<{ group_id: string; recheck_at: number | null }> => getAlertIntents(s, now).priority_waits;

// One immediate line on a roomy station, fired at its planned fire at(0) by nobody: its estimate is max(at(10), t + 10 min),
// so with limit L it crosses T + L at at(0) + L + 1.
function oneLine(o: { maxDelay?: number | null; mode?: Item['mode']; settings?: Parameters<typeof kitchen>[1] } = {}): EngineState {
  const s = kitchen([{ station_id: 'S1', capacity: 4 }], o.settings);
  return submit(s, 'O1', [{ id: 'A', cook: 10 * M, mode: o.mode ?? 'immediate', ...(o.maxDelay === undefined ? {} : { maxDelay: o.maxDelay }) }], at(0)).state;
}

describe('[03a v1.2.10 §3.5.7 PR-3] the level crossing and the draft', () => {
  it('[03a #153] priority_due is the crossing; drafted at it, not at − 1; pure; an idle kitchen has none; an immediate line crosses on its own estimate', () => {
    const idle = kitchen([{ station_id: 'S1' }]);
    expect(idle.priority_due).toEqual({});
    expect(getAlertIntents(idle, at(60))).toMatchObject({ prioritized: [], priority_waits: [] });
    const s = oneLine({ maxDelay: 5 * M });
    expect(s.lines.A!.fire_ms).toBe(at(0));
    expect(Tg(s, 'O1')).toBe(at(10));
    expect(s.priority_due).toEqual({ [G('O1')]: at(5) + 1 });
    // The earliest term (slips: the immediate line has no slip): next_alert_due_at is the priority crossing.
    expect(s.slip_due).toEqual({});
    expect(s.next_alert_due_at).toBe(at(5) + 1);
    expect(nextAlertDueAt(s, new Set(['t:O1']))).toBe(at(5) + 1); // the priority term ignores the skipped keys
    expect(nextAlertDueAt(s, undefined, new Map([[G('O1'), at(9)]]))).toBe(at(9)); // parked: at its recheck_at
    expect(nextAlertDueAt(s, undefined, new Map([[G('O1'), null]]))).toBeNull();
    expect(drafted(s, at(5))).toEqual([]);
    expect(waits(s, at(5))).toEqual([]);
    const a = getAlertIntents(s, at(5) + 1);
    expect(a.prioritized).toEqual([
      {
        stream_type: 'order',
        stream_id: 'O1',
        event_type: 'LinePrioritized',
        schema_version: 1,
        payload: { order_id: 'O1', group_id: G('O1'), order_item_ids: ['A'], delay_ms: 5 * M + 1, at_ms: at(5) + 1 },
      },
    ]);
    expect(a.priority_waits).toEqual([]);
    // Pure: the same drafts twice; the draft is valid against the v1 schema.
    expect(getAlertIntents(s, at(5) + 1)).toEqual(a);
    expect(parseEvent(prioritizedEv(a.prioritized[0]!, at(5) + 1)).event_type).toBe('LinePrioritized');
  });

  it('[03a #153 / #167] max_delay_ms null and an absent field are "No limit": no crossing at 5 min, the far cap at 30 min', () => {
    for (const s of [oneLine({ maxDelay: null }), oneLine({})]) {
      expect(s.lines.A!.max_delay_ms).toBeNull();
      expect(s.priority_due).toEqual({ [G('O1')]: at(0) + MAX_DELAY_NO_LIMIT_MS + 1 });
      expect(drafted(s, at(5) + 1)).toEqual([]);
      expect(drafted(s, at(30))).toEqual([]);
      expect(drafted(s, at(30) + 1)).toEqual([G('O1')]);
    }
    expect(MAX_DELAY_NO_LIMIT_MS).toBe(1_800_000);
  });

  it('[03a #166] the strict `>`: delay = 60 000 is not priority, 60 001 is; 1 800 000 and null cross at the same delay', () => {
    const s = oneLine({ maxDelay: 60_000 });
    expect(s.priority_due[G('O1')]).toBe(at(1) + 1);
    expect(s.priority_due[G('O1')]).toBeGreaterThan(at(1));
    expect(drafted(s, at(1))).toEqual([]);
    expect(getAlertIntents(s, at(1) + 1).prioritized[0]!.payload.delay_ms).toBe(60_001);
    expect(oneLine({ maxDelay: 1_800_000 }).priority_due).toEqual(oneLine({ maxDelay: null }).priority_due);
  });

  it('[03a #153 (1), (2)] independent of every slip term: a slip opened at +3 and slips off both still draft at the +5 crossing', () => {
    // (1) slip_threshold_ms 3 min, BBQ max delay 5 min (a sync line).
    let s = oneLine({ maxDelay: 5 * M, mode: 'sync', settings: { slip_threshold_ms: 3 * M } });
    expect(s.slip_due).toEqual({ 't:O1': at(3) + 1 });
    expect(s.priority_due).toEqual({ [G('O1')]: at(5) + 1 });
    const item = getAlertIntents(s, at(3) + 1).slips[0]!;
    s = fold(s, [
      orderEv(
        'SlipWarned',
        'O1',
        { table_key: item.table_key, order_ids: item.order_ids, alert_id: 'AL1', estimated_land_ms: item.estimate, target_land_ms: item.target, promise_ms: item.promise },
        at(3) + 1,
      ),
    ]);
    expect(s.slips['t:O1']!.alert_id).toBe('AL1');
    expect(s.priority_due).toEqual({ [G('O1')]: at(5) + 1 });
    expect(drafted(s, at(5) + 1)).toEqual([G('O1')]);
    // (2) slip_threshold_ms null (slips off, as a state value): no slip due, the crossing is still due and drafted.
    const base = oneLine({ maxDelay: 5 * M });
    const off = deepFreeze({ ...base, config: { ...base.config!, settings: { ...base.config!.settings, slip_threshold_ms: null as unknown as number } } });
    expect(getAlertIntents(off, at(30)).slips).toEqual([]);
    expect(priorityDueOf(off)).toEqual({ [G('O1')]: at(5) + 1 });
    expect(drafted(off, at(5) + 1)).toEqual([G('O1')]);
  });
});

describe('[03a v1.2.10 §3.5.7 PR-3, re-review R-2] only a waiting line triggers, on the live estimate', () => {
  // Raita (R, cook 10, max delay 5) and naan (N, cook 2) served together; Z (N, cook 20) is ahead of the naan on N, so T =
  // +22 and the raita's planned fire is +12. Z and the naan are fired and nobody taps Start, so they slide: at t the naan's
  // packed land is t + 22 min, past the raita's estimate max(+22, t + 10 min).
  function slide(): EngineState {
    let s = kitchen([
      { station_id: 'N', capacity: 1 },
      { station_id: 'R', capacity: 1 },
    ]);
    s = submit(s, 'OZ', [{ id: 'z', station: 'N', cook: 20 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OG', [
      { id: 'raita', station: 'R', cook: 10 * M, maxDelay: 5 * M },
      { id: 'naan', station: 'N', cook: 2 * M },
    ], at(0)).state;
    expect(Tg(s, 'OG')).toBe(at(22));
    expect(s.lines.raita!.fire_ms).toBe(at(12));
    return fold(s, [fireEv('N', ['z'], at(0)), fireEv('N', ['naan'], at(0) + S)]);
  }

  it('[03a #168 (a)] a sliding fired sibling drives the delay: due by the level crossing, never drafted while it slides, listed with recheck_at', () => {
    const s = slide();
    expect(s.priority_due).toEqual({ [G('OG')]: at(17) + 1 });
    // Both rise with slope 1 and the naan stays 12 min ahead while Z slides ahead of it; the first instant is Z's
    // abandon by time (AD-13, order_abandon_ms after its last fold), where Z leaves the packing (FC-3, below).
    const x = s.orders.OZ!.last_line_fold_at + s.config!.settings.order_abandon_ms;
    for (const now of [at(17) + 1, at(18), at(25), at(40)]) {
      expect(drafted(s, now), `at ${now}`).toEqual([]);
      expect(waits(s, now)).toEqual([{ group_id: G('OG'), recheck_at: x }]);
    }
  });

  it('[03a #168 (d), FC-3] abandon ahead: Z leaves the packing by time alone at x; recheck_at is the first instant ≥ x, drafted there', () => {
    const s = slide();
    const x = s.orders.OZ!.last_line_fold_at + s.config!.settings.order_abandon_ms;
    expect(x).toBeGreaterThan(at(40));
    expect(priorityRecheckAt(s, G('OG'), at(18))).toBe(x);
    expect(drafted(s, x - 1)).toEqual([]);
    expect(drafted(s, x)).toEqual([G('OG')]);
  });

  it('[03a #168 (b)] the slide stops: Start on the naan fixes its land; the raita is the latest line and is drafted with every not-started line', () => {
    const s = fold(slide(), [startEv('OG', 'naan', at(25))]);
    expect(s.priority_due).toEqual({ [G('OG')]: at(17) + 1 });
    const d = getAlertIntents(s, at(25)).prioritized;
    expect(d.map((x) => x.payload)).toEqual([{ order_id: 'OG', group_id: G('OG'), order_item_ids: ['raita'], delay_ms: 13 * M, at_ms: at(25) }]);
  });

  it('[03a #168 (c)] a COOKING sibling: recheck_at is the first instant the waiting naan passes its live land, drafted there; an overrun counts', () => {
    // Karahi (K, cook 10) and naan (N, cook 4, max delay 5): T = +10. The karahi's Start is tapped at +8, so it lands at
    // +18. The naan (fire +6, never fired) is estimated max(+10, t + 4): over T + 5 from +11 + 1 ms.
    let s = kitchen([
      { station_id: 'K', capacity: 1 },
      { station_id: 'N', capacity: 1 },
    ]);
    s = submit(s, 'OK', [
      { id: 'k', station: 'K', cook: 10 * M },
      { id: 'n', station: 'N', cook: 4 * M, maxDelay: 5 * M },
    ], at(0)).state;
    s = fold(s, [fireEv('K', ['k'], at(0)), startEv('OK', 'k', at(8))]);
    expect(s.priority_due).toEqual({ [G('OK')]: at(11) + 1 });
    expect(drafted(s, at(12))).toEqual([]);
    expect(waits(s, at(12))).toEqual([{ group_id: G('OK'), recheck_at: at(14) + 1 }]);
    expect(priorityRecheckAt(s, G('OK'), at(12))).toBe(at(14) + 1);
    expect(drafted(s, at(14))).toEqual([]);
    expect(drafted(s, at(14) + 1)).toEqual([G('OK')]);
  });

  it('[03a #168 (c)] overrun: the karahi still COOKING past its planned land lands no earlier than now + carry, so it drives the delay; a Done fixes it', () => {
    // Karahi (K, cook 4, carry 6): T = +10; Start tapped at +4 → planned land +14, then it overruns. Y (N, cook 20) is
    // COOKING on N from +0; a capacity drop on N at +1 pushes the naan (N, cook 4, max delay 5) behind it: planned land +24.
    let s = kitchen([
      { station_id: 'K', capacity: 1 },
      { station_id: 'N', capacity: 2 },
    ]);
    s = submit(s, 'OY', [{ id: 'y', station: 'N', cook: 20 * M, mode: 'immediate' }], at(0)).state;
    s = submit(s, 'OK', [
      { id: 'k', station: 'K', cook: 4 * M, carry: 6 * M },
      { id: 'n', station: 'N', cook: 4 * M, maxDelay: 5 * M },
    ], at(0)).state;
    expect(Tg(s, 'OK')).toBe(at(10));
    s = fold(s, [fireEv('N', ['y'], at(0)), startEv('OY', 'y', at(0)), fireEv('K', ['k'], at(0)), startEv('OK', 'k', at(4)), capacityEv('N', 1, at(1))]);
    const P_n = landOf(s, 'n');
    expect(P_n).toBe(at(24));
    // Already over its level when the drop re-planned it: due from the order's placed_at (R-3).
    expect(s.priority_due).toEqual({ [G('OK')]: at(0) });
    // At +19 the naan is estimated +24 and the overrunning karahi +19 + 6 = +25 (its fixed land +14 would draft it).
    expect(drafted(s, at(19))).toEqual([]);
    expect(waits(s, at(19))).toEqual([{ group_id: G('OK'), recheck_at: null }]);
    // Before the overrun (+10: the karahi's live land is its planned +14) the naan drives the delay.
    expect(drafted(s, at(10))).toEqual([G('OK')]);
    // Done at +21 (lands +27): the naan passes it at +23 + 1 ms.
    s = fold(s, [doneEv('OK', 'k', at(21))]);
    expect(waits(s, at(21))).toEqual([{ group_id: G('OK'), recheck_at: at(23) + 1 }]);
  });
});

describe('[03a v1.2.10 §3.5.7 PR-2 (m-3)] groups of additions and releases', () => {
  it('[03a #171] an OrderLinesAdded group crosses against its own target; a released group against its source T; immediate per line', () => {
    let s = kitchen([
      { station_id: 'S1', capacity: 4 },
      { station_id: 'S2', capacity: 4 },
    ]);
    s = submit(s, 'O1', [
      { id: 'A', cook: 10 * M, maxDelay: 5 * M },
      { id: 'B', station: 'S2', cook: 4 * M, maxDelay: 5 * M },
      { id: 'I', station: 'S2', cook: 6 * M, mode: 'immediate', maxDelay: 2 * M },
    ], at(0)).state;
    const gi = s.lines.I!.group_id;
    expect(gi).not.toBe(G('O1'));
    expect(s.priority_due).toEqual({ [G('O1')]: at(5) + 1, [gi]: at(2) + 1 });
    // B is frozen at +4.5 (fire +6): an expedite keeps its placement and its new group takes the source T.
    s = fold(s, [orderEv('ItemsReleased', 'O1', { order_id: 'O1', alert_id: null, released: [], expedite: ['B'] }, at(4) + 30 * S)]);
    const gb = s.lines.B!.group_id;
    expect(s.orders.O1!.groups[gb]!.target_land_ms).toBe(at(10));
    expect(s.priority_due[gb]).toBe(at(11) + 1);
    expect(s.priority_due[G('O1')]).toBe(at(5) + 1);
    // An addition at +4 with its own group and target.
    const added = addLine(s, 'O1', { id: 'C', cook: 10 * M, maxDelay: 5 * M }, at(4));
    const gc = added.lines.C!.group_id;
    expect(added.orders.O1!.groups[gc]!.target_land_ms).toBe(at(14));
    expect(added.priority_due[gc]).toBe(at(9) + 1);
  });

  it('[03a #177] the due of an already-late group is a pure value: from its placed_at, unchanged by an unrelated fold, equal to a full recompute and a replay', () => {
    const log: Parameters<typeof fold>[2] = [];
    let s = kitchen(
      [
        { station_id: 'S1', capacity: 2 },
        { station_id: 'S2', capacity: 2 },
      ],
      {},
      log,
    );
    s = submit(s, 'O2', [{ id: 'A1', cook: 10 * M, mode: 'immediate' }], at(0), {}, log).state;
    s = submit(s, 'O1', [{ id: 'Z1', cook: 10 * M, mode: 'immediate', maxDelay: 60_000 }], at(0), {}, log).state;
    // f1 at +1: the drop to 1 pushes the frozen Z1 (after A1 in (fire, id) order) to land at +20, over T + 1 min.
    s = fold(s, [capacityEv('S1', 1, at(1))], log);
    expect(landOf(s, 'Z1')).toBe(at(20));
    expect(s.priority_due[G('O1')]).toBe(at(0));
    expect(drafted(s, at(1))).toContain(G('O1'));
    // f2 at +2 touches only another table.
    s = submit(s, 'O3', [{ id: 'C1', station: 'S2', cook: 5 * M, mode: 'immediate' }], at(2), {}, log).state;
    expect(s.priority_due[G('O1')]).toBe(at(0));
    expect(buildEngineState(log.map((e) => parseEvent(e))).priority_due).toEqual(s.priority_due);
  });
});

// An addition (P-10) to an order in the engine: OrderLinesAdded with one new group, then its ItemAdded, at t.
function addLine(s: EngineState, order_id: string, i: Item, t: number): EngineState {
  const order = s.orders[order_id]!;
  const gid = `${order_id}:${order.next_group_index}`;
  const T = t + (i.prep ?? 0) + i.cook + (i.carry ?? 0);
  const listed = orderEv(
    'OrderLinesAdded',
    order_id,
    {
      order_id,
      order_item_ids: [i.id],
      groups: [{ group_id: gid, target_land_ms: T, promise_ms: T + 180_000, order_item_ids: [i.id] }],
      lines: [{ order_item_id: i.id, station_id: i.station ?? 'S1', alternates: [], point_id: null, carry_ms: i.carry ?? 0, from_stock: false, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null }],
    },
    t,
  );
  const base = anItemAdded().payload;
  const item = orderEv(
    'ItemAdded',
    order_id,
    { ...base, order_id, order_item_id: i.id, station_id: i.station ?? 'S1', cook_time_ms: i.cook, prep_buffer_ms: i.prep ?? 0, serve_mode: i.mode ?? 'sync', quantity: 1, max_delay_ms: i.maxDelay ?? null },
    t,
  );
  return fold(s, [listed, item]);
}
