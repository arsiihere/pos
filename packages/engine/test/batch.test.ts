// Batch-station loads (task 13): F §4.7 batch (D14, D17, D34, D35, D49), 03a §3.2 (batch cook time from the line
// copies), §3.3 (load id `station_id:earliest order_item_id`, a name, not membership; `loads` on StationRuntime),
// §3.6.1 item 1 (freshness capped per line by max_early_ms), BF-1 (currentProgram), AD-5 (Load shape), AD-6 / AD-7
// (a load is booked once and removed exactly). The F tests 3, 9, 14, 15 are in foundation.test.ts.
import { describe, expect, it } from 'vitest';
import { buildEngineState, liveInterval, type EngineState } from '../src/index';
import { currentProgram } from '../src/batch';
import { batchConfig, batchEvents, CONFIG_COOK, etaB, fireLoad, fold, fryer, loadOf, proposedB, startB, submitB, T, voidB } from './batch-kit';
import { planOrder } from '../src/plan';
import { liveProfile } from '../src/live';
import type { PosEvent } from '@pos/events';

const M = 60_000;

describe('@pos/engine batch loads (task 13)', () => {
  it('[03a #44] program cook times come from the ItemAdded copies, never config (B1); a from-stock line runs its copied stock program (BF-1)', () => {
    const { plan, state: s } = submitB(fryer(), 'O1', [{ id: 'A', cook: 6_000 }], T);
    expect(s.lines.A!.cook_ms).toBe(6_000);
    expect(loadOf(s, 'A')!.booked).toEqual({ start: T, end: T + 6_000, units: 4 });
    expect(etaB(plan, 'A')).toBe(T + 6_000);
    expect(etaB(plan, 'A')).not.toBe(T + CONFIG_COOK);
    // From stock: the copied stock program P2 and its copied cook time; the line's program ids stay as copied.
    const st = submitB(fryer(), 'O2', [{ id: 'S', cook: 6_000, stock: { program: 'P2', cook: 2_000 }, from_stock: true }], T).state;
    expect(st.lines.S).toMatchObject({ from_stock: true, cook_ms: 2_000, full_cook_ms: 6_000, program_id: 'P1', stock_program_id: 'P2' });
    expect(loadOf(st, 'S')).toMatchObject({ program_id: 'P2', booked: { start: T, end: T + 2_000, units: 4 } });
  });

  it('[03a #44] max_early_ms caps the freshness window per line (D3 "batch: caps freshness")', () => {
    // Load A ends at T + 10 000; the station's window is 5 000; X's target is 4 000 after A's end.
    const s0 = submitB(fryer({ freshness: 5_000 }), 'OA', [{ id: 'A0', cook: 6_000 }], T, { pickup_at_ms: T + 10_000 }).state;
    const capped = submitB(s0, 'OX', [{ id: 'X', cook: 6_000, early: 3_000 }], T, { pickup_at_ms: T + 14_000 }).state;
    expect(loadOf(capped, 'X')!.load_id).toBe('F:X');
    const roomy = submitB(s0, 'OY', [{ id: 'Y', cook: 6_000, early: 5_000 }], T, { pickup_at_ms: T + 14_000 }).state;
    expect(loadOf(roomy, 'Y')!.load_id).toBe('F:A0');
  });

  it('[03a BF-1] currentProgram(line) = from_stock ? stock_program_id : program_id; program ids are never rewritten', () => {
    expect(currentProgram({ from_stock: true, program_id: 'P1', stock_program_id: 'P2' })).toBe('P2');
    expect(currentProgram({ from_stock: false, program_id: 'P1', stock_program_id: 'P2' })).toBe('P1');
    expect(currentProgram({ from_stock: false, program_id: null, stock_program_id: null })).toBeNull();
    // A fresh P1 line never joins a from-stock line's P2 load, even with an exact freshness match.
    const s0 = submitB(fryer(), 'OS', [{ id: 'S', cook: 6_000, stock: { program: 'P2', cook: 2_000 }, from_stock: true }], T, { pickup_at_ms: T + 10_000 }).state;
    const s = submitB(s0, 'OF', [{ id: 'X', cook: 2_000 }], T, { pickup_at_ms: T + 10_000 }).state;
    expect(loadOf(s, 'X')!.load_id).not.toBe(loadOf(s, 'S')!.load_id);
  });

  it('[03a §3.3] the lines of one order with one program share one load, booked once; another program queues behind it (D36)', () => {
    const { plan, state: s } = submitB(
      fryer(),
      'O1',
      [
        { id: 'A', cook: 6_000 },
        { id: 'B', cook: 6_000 },
        { id: 'C', cook: 2_000, program: 'P2' },
      ],
      T,
    );
    expect(loadOf(s, 'A')).toEqual({ load_id: 'F:A', program_id: 'P1', order_item_ids: ['A', 'B'], fire_ms: expect.any(Number), booked: expect.any(Object) });
    const ab = loadOf(s, 'A')!;
    const c = loadOf(s, 'C')!;
    expect(c.load_id).toBe('F:C');
    expect(ab.booked.end - ab.booked.start).toBe(6_000);
    expect(c.booked.end - c.booked.start).toBe(2_000);
    // The two loads never overlap and the order lands with its last load.
    expect(c.booked.start >= ab.booked.end || c.booked.end <= ab.booked.start).toBe(true);
    expect(plan.groups[0]!.target_land_ms).toBe(Math.max(ab.booked.end, c.booked.end));
    // Each load holds the station once (4 units), never 4 per line.
    expect(Math.max(...s.stations.F!.profile.u)).toBe(4);
    expect([...s.stations.F!.unfired].sort()).toEqual(['A', 'B', 'C']);
  });

  it('[03a §3.3] a load has room for `capacity` units only (F §4.7 |b.items| < capacity)', () => {
    let s = submitB(fryer({ capacity: 2 }), 'OA', [{ id: 'A0', cook: 6_000 }], T, { pickup_at_ms: T + 10_000 }).state;
    s = submitB(s, 'OB', [{ id: 'B', cook: 6_000, units: 2 }], T, { pickup_at_ms: T + 10_000 }).state;
    expect(loadOf(s, 'B')!.load_id).toBe('F:B');
    s = submitB(s, 'OC', [{ id: 'C', cook: 6_000 }], T, { pickup_at_ms: T + 10_000 }).state;
    expect(loadOf(s, 'C')!.load_id).toBe('F:A0');
  });

  it('[03a §3.3] an immediate line joins the earliest unfired load with room; else a new load (F §4.7)', () => {
    const s0 = submitB(fryer(), 'OA', [{ id: 'A0', cook: 6_000 }], T, { pickup_at_ms: T + 10_000 }).state;
    const r = submitB(s0, 'OI', [{ id: 'I', cook: 6_000, mode: 'immediate' }], T);
    expect(loadOf(r.state, 'I')!.load_id).toBe('F:A0');
    expect(etaB(r.plan, 'I')).toBe(T + 10_000);
    // Another program: a new load (after A, which holds the station).
    const q = submitB(s0, 'OQ', [{ id: 'Q', cook: 2_000, program: 'P2', mode: 'immediate' }], T);
    expect(loadOf(q.state, 'Q')).toMatchObject({ load_id: 'F:Q', booked: { start: T, end: T + 2_000, units: 4 } });
  });

  it('[03a §3.3] a batch line with no program is a writer bug (01a S11: a batch route requires one)', () => {
    const p = proposedB('O1', [{ id: 'A', cook: 6_000 }]);
    const bad = { ...p, lines: p.lines.map((l) => ({ ...l, program_id: null })) };
    expect(() => planOrder(fryer(), bad, T, {})).toThrow(/program_id_null/);
  });

  it('[03a §3.6.1] FireDispatched for a load fires all its lines; the fired load packs as one unit and is closed to joiners (D34)', () => {
    const s0 = submitB(fryer(), 'O1', [{ id: 'A', cook: 6_000 }, { id: 'B', cook: 6_000 }], T).state;
    const id = loadOf(s0, 'A')!.load_id;
    const s = fold(s0, [fireLoad(id, ['A'], T)]);
    for (const x of ['A', 'B']) expect(s.lines[x]).toMatchObject({ fired_at: T, load_id: id, booked: null });
    expect(s.stations.F!.loads).toEqual({});
    expect(s.stations.F!.unfired).toEqual([]);
    expect(s.stations.F!.profile).toEqual({ t: [], u: [] });
    expect(liveInterval(s, 'A', T)).toEqual({ start: T, end: T + 6_000 });
    expect(liveInterval(s, 'B', T)).toEqual({ start: T, end: T + 6_000 });
    // A new line of the same program goes after the fired load (it holds the whole station), in a new load.
    const r = submitB(s, 'O2', [{ id: 'X', cook: 6_000, mode: 'immediate' }], T);
    expect(loadOf(r.state, 'X')).toMatchObject({ load_id: 'F:X', booked: { start: T + 6_000, end: T + 12_000, units: 4 } });
    // Started members keep holding the station as one load until both are done.
    const started = fold(s, [startB('O1', 'A', T + 1_000)]);
    expect(liveInterval(started, 'A', T + 1_000)).toEqual({ start: T + 1_000, end: T + 7_000 });
    expect(liveInterval(started, 'B', T + 1_000)).toEqual({ start: T + 1_000, end: T + 7_000 });
  });

  it('[03a AD-7] a load is booked once and removed exactly: a void keeps it for the other members, the last void removes it', () => {
    const s0 = submitB(fryer(), 'O1', [{ id: 'A', cook: 6_000 }, { id: 'B', cook: 6_000 }], T).state;
    const booked = loadOf(s0, 'A')!.booked;
    expect(s0.stations.F!.profile).toEqual({ t: [booked.start, booked.end], u: [4, 0] });
    const one = fold(s0, [voidB('O1', 'A', 1, T + 1)]);
    expect(loadOf(one, 'B')).toMatchObject({ load_id: 'F:A', order_item_ids: ['B'], booked });
    expect(one.stations.F!.profile).toEqual(s0.stations.F!.profile);
    expect(one.stations.F!.unfired).toEqual(['B']);
    const none = fold(one, [voidB('O1', 'B', 1, T + 2)]);
    expect(none.stations.F!.loads).toEqual({});
    expect(none.stations.F!.profile).toEqual({ t: [], u: [] });
    expect(none.stations.F!.unfired).toEqual([]);
  });

  it('[03a AD-6] removing a load whose booking is not in the profile: strict throws; non-strict records profile_underflow', () => {
    const s0 = submitB(fryer(), 'O1', [{ id: 'A', cook: 6_000 }], T).state;
    const broken: EngineState = { ...s0, stations: { ...s0.stations, F: { ...s0.stations.F!, profile: { t: [], u: [] } } } };
    expect(() => fold(broken, [voidB('O1', 'A', 1, T + 1)])).toThrow(/below zero/);
    const lax = fold(broken, [voidB('O1', 'A', 1, T + 1)], { strict: false });
    expect(lax.diagnostics).toContainEqual(expect.objectContaining({ kind: 'profile_underflow', station_id: 'F' }));
    expect(lax.stations.F!.loads).toEqual({});
  });

  it('[03a #81 load] a load id is station_id:<earliest order_item_id> before firing and FireDispatched.load_id after; it stays when its naming line is voided before the fire; snapshot + replay = full replay', () => {
    const cfg = batchConfig({ freshness: 0 });
    // Hidden (fire > t + freeze_ms): a delivery picked up in an hour. Frozen: an order for now.
    const hp = planOrder(fryer({ freshness: 0 }), proposedB('OH', [{ id: 'H2', cook: 6 * M }, { id: 'H1', cook: 6 * M }], { pickup_at_ms: T + 60 * M }), T, {});
    const hidden = batchEvents('OH', [{ id: 'H2', cook: 6 * M }, { id: 'H1', cook: 6 * M }], T, hp, { pickup_at_ms: T + 60 * M });
    let s = fold(fryer({ freshness: 0 }), hidden);
    expect(loadOf(s, 'H1')).toMatchObject({ load_id: 'F:H1', order_item_ids: ['H1', 'H2'] });
    expect(s.lines.H2!.load_id).toBe('F:H1');
    const fp = planOrder(s, proposedB('OZ', [{ id: 'Z1', cook: 6_000 }, { id: 'Z2', cook: 6_000 }]), T, {});
    const frozen = batchEvents('OZ', [{ id: 'Z1', cook: 6_000 }, { id: 'Z2', cook: 6_000 }], T, fp);
    s = fold(s, frozen);
    expect(loadOf(s, 'Z2')!.load_id).toBe('F:Z1');
    // Void the naming lines before the fire (the hidden load is re-formed by the void's re-plan, §3.5.3): names stay.
    const tail = [voidB('OH', 'H1', 1, T + 1_000), voidB('OZ', 'Z1', 1, T + 1_000), fireLoad('F:Z1', ['Z2'], T + 2_000)];
    const v = fold(s, tail.slice(0, 2));
    expect(loadOf(v, 'H2')).toMatchObject({ load_id: 'F:H1', order_item_ids: ['H2'] });
    expect(loadOf(v, 'Z2')).toMatchObject({ load_id: 'F:Z1', order_item_ids: ['Z2'] });
    const f = fold(v, tail.slice(2));
    expect(f.lines.Z2).toMatchObject({ fired_at: T + 2_000, load_id: 'F:Z1' });
    expect(Object.keys(f.stations.F!.loads)).toEqual(['F:H1']);
    // Snapshot (JSON round trip) + replay of the rest = full replay.
    const head = [cfg, ...hidden, ...frozen];
    const snap = JSON.parse(JSON.stringify(buildEngineState(head))) as EngineState;
    let resumed = snap;
    for (const e of tail) resumed = fold(resumed, [e]);
    expect(resumed).toEqual(buildEngineState([...head, ...tail]));
    expect(resumed).toEqual(f);
  });

  it('[03a §3.5.3] a re-plan re-forms hidden loads: lines that shared a load stay together, the load keeps its name', () => {
    const s0 = submitB(fryer({ freshness: 0 }), 'OH', [{ id: 'H1', cook: 6 * M }, { id: 'H2', cook: 6 * M }], T, { pickup_at_ms: T + 60 * M }).state;
    const before = loadOf(s0, 'H1')!;
    expect(before.order_item_ids).toEqual(['H1', 'H2']);
    // A later submit on F runs pass 1 on F: the hidden load is re-placed within its slack (keep first, D6).
    const s = submitB(s0, 'ON', [{ id: 'N', cook: 2 * M, program: 'P2', mode: 'immediate' }], T + 1_000).state;
    const after = loadOf(s, 'H1')!;
    expect(after).toMatchObject({ load_id: 'F:H1', order_item_ids: ['H1', 'H2'] });
    expect(s.lines.H1!.fire_ms).toBe(after.fire_ms);
    expect(s.lines.H2!.fire_ms).toBe(after.fire_ms);
    expect(after.booked.end).toBeLessThanOrEqual(before.booked.end);
    expect(Math.max(...s.stations.F!.profile.u)).toBe(4);
  });
  it('[03a §3.3] a joiner with more prep than the members joins and moves the load\'s fire earlier (F §4.7 step 3(a); AD-5)', () => {
    const s0 = submitB(fryer({ freshness: 2 * M }), 'OA', [{ id: 'A', cook: 6 * M }], T, { pickup_at_ms: T + 60 * M }).state;
    expect(loadOf(s0, 'A')!.fire_ms).toBe(loadOf(s0, 'A')!.booked.start);
    const s = submitB(s0, 'OJ', [{ id: 'J', cook: 6 * M, prep: 2 * M }], T + 1_000, { pickup_at_ms: T + 60 * M }).state;
    const load = loadOf(s, 'J')!;
    expect(load).toMatchObject({ load_id: 'F:A', order_item_ids: ['A', 'J'] });
    expect(load.fire_ms).toBe(load.booked.start - 2 * M);
    expect(s.lines.A!.fire_ms).toBe(load.fire_ms);
    expect(s.lines.J!.fire_ms).toBe(load.fire_ms);
  });

  it('[03a §3.5.6] the overload search keeps loads whole (D14): members still share loads, no over-booking, rebuild = live', () => {
    const events: PosEvent[] = [batchConfig({ capacity: 2, freshness: 0 })];
    let s = fryer({ capacity: 2, freshness: 0 });
    const add = (order_id: string, items: Parameters<typeof proposedB>[1], now: number, pickup: number | null): void => {
      const plan = planOrder(s, proposedB(order_id, items, { pickup_at_ms: pickup }), now, {});
      const evs = batchEvents(order_id, items, now, plan, { pickup_at_ms: pickup });
      events.push(...evs);
      s = fold(s, evs);
    };
    add('OA', [{ id: 'A1', cook: 6 * M }, { id: 'A2', cook: 6 * M }], T, T + 30 * M);
    add('OB', [{ id: 'B1', cook: 6 * M }, { id: 'B2', cook: 6 * M }], T, T + 40 * M);
    add('OZ', [{ id: 'Z', cook: 60 * M, program: 'P2' }], T, T + 180 * M);
    add('OW', [{ id: 'W', cook: M, program: 'P2' }], T, T + 300 * M);
    expect(loadOf(s, 'A1')!.order_item_ids).toEqual(['A1', 'A2']);
    // Z starts now and holds the fryer for an hour: both hidden loads are late at the next re-plan of F, here the
    // void of W (§3.5.3 trigger, unpruned).
    const st = [startB('OZ', 'Z', T + 1_000), voidB('OW', 'W', 1, T + 2_000)];
    events.push(...st);
    s = fold(s, st);
    const a = loadOf(s, 'A1')!;
    const b = loadOf(s, 'B1')!;
    expect(a.order_item_ids).toEqual(['A1', 'A2']);
    expect(b.order_item_ids).toEqual(['B1', 'B2']);
    expect(a.load_id).not.toBe(b.load_id);
    const z = liveInterval(s, 'Z', T + 2_000)!;
    for (const x of [a, b]) expect(x.booked.start).toBeGreaterThanOrEqual(z.end);
    expect(a.booked.start >= b.booked.end || a.booked.end <= b.booked.start).toBe(true);
    for (const id of ['A1', 'A2']) expect(s.lines[id]!.fire_ms).toBe(a.fire_ms);
    expect(Math.max(...liveProfile(s, 'F', T + 2_000).u)).toBeLessThanOrEqual(2);
    expect(buildEngineState(events)).toEqual(s);
  });
});
