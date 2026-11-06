// 03a §10.6, §7.1 (task 18): what the perf gate measures, apart from its asserts. Test code only; not in ./index, so no
// other test pulls node:fs through @pos/engine/sim.
/* eslint-disable no-restricted-imports -- test/sim, Node only: the gate saves each number to disk as it is measured */
import { createHash } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
/* eslint-enable no-restricted-imports */
import { type ConfigStockItem, type PosEvent } from '@pos/events';
import { aReturnLinesAdded, aStockAdded, aStockSet, anItemStarted, anOrderBatch } from '@pos/events/testing';
import {
  applyEvent,
  fromCheckpoint,
  getTickIntents,
  initialEngineState,
  nextDueAt,
  reserveStock,
  stationsLive,
  stockEffects,
  type EngineCheckpointV1,
  type EngineState,
  type ProposedOrder,
  type StockCtx,
} from '../../src/index';
import { exitedOrderIds } from '../../src/lifecycle';
import { planOrderObserved } from '../../src/plan';
import { itemFields, proposedOf, wallMs } from './run';
import type { SimDay, SimOrder, SimStation } from './generate';

// ---- numbers -----------------------------------------------------------------------------------------------------

// Nearest rank, so a reported percentile is always a real sample.
export function pctl(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]!;
}

export type Dist = { n: number; p50: number; p99: number; max: number; mean: number };
export function dist(samples: readonly number[]): Dist {
  return { n: samples.length, p50: pctl(samples, 0.5), p99: pctl(samples, 0.99), max: Math.max(...samples), mean: samples.reduce((a, b) => a + b, 0) / samples.length };
}

const WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '../../../../.superpowers/sdd/03a-plan');
// POS_PERF_OUT: a labelled diagnostic run writes elsewhere and never over the gate's own numbers.
const OUT = process.env.POS_PERF_OUT ?? WORKSPACE;
export const NUMBERS_FILE = join(OUT, 'task-18-numbers.json');

function writeDurably(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  writeSync(fd, text);
  fsyncSync(fd);
  closeSync(fd);
  renameSync(tmp, file);
}

// One section of the numbers file, on disk before the next step starts (a power cut loses only the step under way).
export function writeSection(file: string, section: string, data: unknown): void {
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    // no file yet
  }
  all[section] = data;
  writeDurably(file, `${JSON.stringify(all, null, 2)}\n`);
}

export function writeSamples(name: string, samples: readonly number[]): void {
  writeDurably(join(OUT, 'task-18-samples', `${name}.json`), `${JSON.stringify(samples)}\n`);
}

const machine = (): { load_1_5_15: number[]; cpu: string; at: string } => ({ load_1_5_15: loadavg(), cpu: cpus()[0]?.model ?? 'unknown', at: new Date().toISOString() });

// A step of the gate: its result, with its summary saved beside the machine's load before and after it.
export function step<R>(section: string, work: () => R, summary: (r: R) => unknown): R {
  const before = machine();
  const a = wallMs();
  const r = work();
  const step_s = (wallMs() - a) / 1_000;
  writeSection(NUMBERS_FILE, section, { ...(summary(r) as object), step_s, machine_before: before, machine_after: machine() });
  return r;
}

// ---- replay ------------------------------------------------------------------------------------------------------

// §3.12 boot steps 2–3 on the pure engine: the stored document parsed, fromCheckpoint, the fold of the log after it.
// `captureAt`: the index of an event whose state is handed back, at the cost of one comparison per event.
export function replayFrom(checkpoint: EngineCheckpointV1, events: readonly PosEvent[], startIndex: number, captureAt = -1): { ms: number; events: number; state: EngineState; captured: EngineState | null } {
  const stored = JSON.stringify(checkpoint);
  const a = wallMs();
  let state = fromCheckpoint(JSON.parse(stored) as EngineCheckpointV1);
  let captured: EngineState | null = null;
  for (let i = startIndex; i < events.length; i++) {
    state = applyEvent(state, events[i]!);
    if (i === captureAt) captured = state;
  }
  return { ms: wallMs() - a, events: events.length - startIndex, state, captured };
}

// live = replayed for a report line; key order does not count.
export const sameState = (a: EngineState, b: EngineState): boolean => isDeepStrictEqual(a, b);

export const digestOf = (state: EngineState): string => createHash('sha256').update(JSON.stringify(state)).digest('hex');

// RunOptions.watch: a digest of the live state about every `every` events. A digest, never the state: ~100 retained
// states of thousands of lines roughly doubled the day's run and replay in the task 18 gate run (GC; see its report).
export function keepEvery(into: Map<number, string>, every: number): (state: EngineState, seq: number) => void {
  let next = every;
  return (state, seq) => {
    if (seq < next) return;
    into.set(seq, digestOf(state));
    next = seq + every;
  };
}

// ---- the peak ----------------------------------------------------------------------------------------------------

export type PeakPoint = { state: EngineState; seq: number; at: number; lines: number; unfired: number };
export type Peak = {
  byUnfired: PeakPoint; // most lines waiting to fire: the re-plan rows
  byLines: PeakPoint; // most lines in the state: the snapshot row
  fold_by_type: Record<string, { n: number; mean_ms: number; total_ms: number }>;
  fold_mean_ms: number;
  live_compared: number;
  live_mismatches: number[];
};

const unfiredOf = (s: EngineState): number => {
  let n = 0;
  for (const id in s.stations) n += s.stations[id]!.unfired.length;
  return n;
};

// A separate, untimed fold of the whole log (per-event clocks would disturb the replay's own number). States are
// immutable, so it keeps the two peak states by reference, and compares against the live digests `live` kept.
// Only instants' ends count as a peak: never a state in the middle of a batch.
export function peakPass(events: readonly PosEvent[], live: ReadonlyMap<number, string>): Peak {
  let state = initialEngineState();
  const totals = new Map<string, { n: number; total_ms: number }>();
  let byUnfired: PeakPoint | null = null;
  let byLines: PeakPoint | null = null;
  let total = 0;
  let live_compared = 0;
  const live_mismatches: number[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const a = wallMs();
    state = applyEvent(state, e);
    const ms = wallMs() - a;
    total += ms;
    const row = totals.get(e.event_type) ?? { n: 0, total_ms: 0 };
    row.n++;
    row.total_ms += ms;
    totals.set(e.event_type, row);
    const kept = live.get(i + 1);
    if (kept !== undefined) {
      live_compared++;
      if (kept !== digestOf(state)) live_mismatches.push(i + 1);
    }
    if (events[i + 1] !== undefined && events[i + 1]!.recorded_at === e.recorded_at) continue;
    const unfired = unfiredOf(state);
    const lines = Object.keys(state.lines).length;
    const point = { state, seq: i + 1, at: e.recorded_at, lines, unfired };
    if (byUnfired === null || unfired > byUnfired.unfired) byUnfired = point;
    if (byLines === null || lines > byLines.lines) byLines = point;
  }
  return {
    byUnfired: byUnfired!,
    byLines: byLines!,
    fold_by_type: Object.fromEntries([...totals].map(([k, v]) => [k, { n: v.n, total_ms: v.total_ms, mean_ms: v.total_ms / v.n }])),
    fold_mean_ms: total / events.length,
    live_compared,
    live_mismatches,
  };
}

const timed = (n: number, work: () => void): number[] => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = wallMs();
    work();
    out.push(wallMs() - a);
  }
  return out;
};

const TEMPLATE = anItemStarted();
const eventIdOf = (seq: number): string => `01K${String(seq).padStart(23, '0')}`;
function stamped(e: Pick<PosEvent, 'stream_type' | 'stream_id' | 'event_type' | 'schema_version' | 'payload'>, at: number, seq: number): PosEvent {
  return { ...TEMPLATE, ...e, occurred_at: at, recorded_at: at, seq, event_id: eventIdOf(seq) };
}

const BF7_ITEM = 'BF7';
const BF7_LINES = 20;
const STOCK_COOK_MS = 60_000;

// The slot station with the most lines waiting to fire: where a re-place costs the most.
function busiestSlot(state: EngineState): SimStation['station_id'] {
  const slots = Object.values(state.stations).filter((s) => s.type === 'slot');
  return slots.reduce((a, b) => (b.unfired.length > a.unfired.length ? b : a)).station_id;
}

// BF-7's peak: the day has no draws, so the peak state gains a count of 0 on one stock item and 20 single-line orders
// drawing on it, planned and folded as submits (cook_fresh, so they wait at full cook). Untimed.
function withWaitingLines(state0: EngineState, day: SimDay, at: number, seq0: number): { state: EngineState; ctx: StockCtx; ids: string[]; seq: number } {
  const station_id = busiestSlot(state0);
  const station = day.stations.find((s) => s.station_id === station_id)!;
  const stations = new Map(day.stations.map((s) => [s.station_id, s]));
  const item: ConfigStockItem = { stock_item_id: BF7_ITEM, name: BF7_ITEM, stock_unit: 'piece', carries_over: false, station_id, low_stock_threshold: null };
  const ctx: StockCtx = { dayStartMs: day.start_ms, stockItems: [item], configStockUnits: { [BF7_ITEM]: 'piece' } };
  const stockFields = { stock_time_ms: STOCK_COOK_MS, stock_draws: [{ stock_item_id: BF7_ITEM, quantity: 1 }], out_of_stock_behaviour: 'cook_fresh' };
  let seq = seq0;
  let state = applyEvent(state0, { ...aStockSet({ stream_id: BF7_ITEM, payload: { stock_item_id: BF7_ITEM, on_hand: 0, unit: 'piece' } }), occurred_at: at, recorded_at: at, seq: ++seq, event_id: eventIdOf(seq) });
  const ids: string[] = [];
  for (let i = 0; i < BF7_LINES; i++) {
    const order_id = `BF7O${i}`;
    const id = `BF7L${i}`;
    const order: SimOrder = { order_id, at_ms: at, order_type: 'takeaway', follow_up: false, table_id: null, table_key: `takeaway:${order_id}`, pickup_at_ms: at + station.cook_ms + 300_000, lines: [{ order_item_id: id, station_id }] };
    const base = proposedOf(order, stations);
    const proposed = { ...base, lines: base.lines.map((l) => ({ ...l, ...stockFields })) } as unknown as ProposedOrder;
    const stock = reserveStock(state, proposed, day.start_ms, ctx.stockItems, ctx.configStockUnits);
    if (stock.drafts.length !== 0) throw new Error('BF-7: a waiting line must not reserve at submit');
    const { plan } = planOrderObserved(state, proposed, at, stock.from_stock, { prune: true });
    const p = plan.lines[0]!;
    const batch = anOrderBatch({
      order_id,
      recorded_at: at,
      seq: seq + 1,
      lines: [{ order_item_id: id, item: { ...itemFields(station), ...stockFields }, line: { station_id: p.station_id, alternates: p.alternates, point_id: p.point_id, carry_ms: p.carry_ms, from_stock: false } }],
      order: { ...proposed.order, groups: plan.groups },
    });
    for (const e of batch) state = applyEvent(state, e);
    seq += batch.length;
    ids.push(id);
  }
  return { state, ctx, ids, seq };
}

const FLIP_FIELDS = (s: EngineState, id: string): string => {
  const l = s.lines[id]!;
  return JSON.stringify([l.fire_ms, l.booked, l.load_id]);
};
const movedLines = (a: EngineState, b: EngineState, except: ReadonlySet<string>): number => {
  let n = 0;
  for (const id in a.lines) {
    if (except.has(id) || b.lines[id] === undefined) continue;
    if (FLIP_FIELDS(a, id) !== FLIP_FIELDS(b, id)) n++;
  }
  return n;
};

function bf7(point: PeakPoint, day: SimDay, samples: number): AtPeak['bf7'] {
  const at = point.at + 1;
  const { state, ctx, ids, seq } = withWaitingLines(point.state, day, at, point.seq);
  const hidden = ids.filter((id) => state.lines[id]!.fire_ms! > at + state.config!.stations.find((s) => s.station_id === state.lines[id]!.station_id)!.freeze_ms).length;
  const add = { ...aStockAdded({ stream_id: BF7_ITEM, payload: { stock_item_id: BF7_ITEM, quantity: BF7_LINES, unit: 'piece' } }), occurred_at: at + 1, recorded_at: at + 1, seq: seq + 1, event_id: eventIdOf(seq + 1) };
  let end: EngineState = state;
  let reserved = 0;
  const ms = timed(samples, () => {
    let s = state;
    let n = seq;
    reserved = 0;
    for (const d of stockEffects(state, [add], ctx)) {
      if (d === add) s = applyEvent(s, add);
      else {
        reserved++;
        s = applyEvent(s, stamped(d as never, at + 1, ++n + 1));
      }
    }
    end = s;
  });
  const set = new Set(ids);
  return { ms: dist(ms), reserved, hidden_before: hidden, flipped: ids.filter((id) => !state.lines[id]!.from_stock && end.lines[id]!.from_stock).length, other_lines_moved: movedLines(state, end, set), station_id: state.lines[ids[0]!]!.station_id, waiting_on_station: state.stations[state.lines[ids[0]!]!.station_id]!.unfired.length };
}

function capacityDrop(point: PeakPoint, samples: number): NonNullable<AtPeak['capacity_drop']> {
  const station_id = busiestSlot(point.state);
  const from = point.state.stations[station_id]!.capacity;
  const to = Math.max(1, Math.floor((from * 3) / 4));
  const at = point.at + 1;
  const e = stamped({ stream_type: 'station', stream_id: station_id, event_type: 'StationCapacitySet', schema_version: 1, payload: { station_id, capacity_override: to, previous: null, reason: 'manager' } }, at, point.seq + 1);
  let end = point.state;
  const ms = timed(samples, () => {
    end = applyEvent(point.state, e);
  });
  return { ms: dist(ms), station_id, from, to, waiting_on_station: point.state.stations[station_id]!.unfired.length, lines_moved: movedLines(point.state, end, new Set()) };
}

// §3.8a with returns_boost (default true): 02's ReturnToKitchen on the most recently served line of the busiest station
// that has one: planOrder + the folds of its batch.
function returnBoost(point: PeakPoint, day: SimDay, events: readonly PosEvent[], samples: number): NonNullable<AtPeak['return_boost']> {
  const state = point.state;
  const busiest = busiestSlot(state);
  const served = Object.values(state.lines).filter((l) => l.stage === 'served');
  const here = served.filter((l) => l.station_id === busiest);
  const pool = here.length > 0 ? here : served;
  if (pool.length === 0) throw new Error('no served line at the peak');
  const line = pool.reduce((a, b) => ((b.done_at ?? 0) > (a.done_at ?? 0) ? b : a));
  const added = events.find((e) => e.event_type === 'ItemAdded' && (e.payload as { order_item_id: string }).order_item_id === line.order_item_id)!;
  const order = day.orders.find((o) => o.order_id === line.order_id)!;
  const stations = new Map(day.stations.map((s) => [s.station_id, s]));
  const id = `${line.order_item_id}R`;
  const at = point.at + 1;
  const proposed = {
    order_id: order.order_id,
    order: proposedOf(order, stations).order,
    lines: [{ ...added.payload, order_item_id: id, line_kind: 'item', options: [], alternates: [], point_id: null, carry_ms: 0, weight_pct: 100, max_early_ms: 60_000, max_late_ms: null, max_carry_ms: null, cook_ms_override: null, return_of: { order_item_id: line.order_item_id, mode: 'remake' } }],
  } as unknown as ProposedOrder;
  const groups = Object.keys(state.orders[line.order_id]!.groups).length;
  let end = state;
  const ms = timed(samples, () => {
    const { plan } = planOrderObserved(state, proposed, at, { [id]: false }, { prune: true });
    const batch = aReturnLinesAdded(added, 'remake', { order_item_id: id, recorded_at: at, target_land_ms: plan.groups[0]!.target_land_ms, promise_ms: plan.groups[0]!.promise_ms, group_index: groups });
    let s = state;
    let n = point.seq;
    for (const e of batch) {
      n++;
      s = applyEvent(s, { ...e, seq: n, event_id: eventIdOf(n) });
    }
    end = s;
  });
  return { ms: dist(ms), station_id: line.station_id, waiting_on_station: state.stations[line.station_id]!.unfired.length, mark: end.lines[id]!.mark, lines_moved: movedLines(state, end, new Set([id])) };
}

export type AtPeak = {
  snapshot: { ms: Dist; first_ms: number; bytes: number; lines: number; unfired: number; seq: number; bytes_at_unfired_peak: number };
  bf7: { ms: Dist; reserved: number; flipped: number; hidden_before: number; other_lines_moved: number; station_id: string; waiting_on_station: number } | null;
  capacity_drop: { ms: Dist; station_id: string; from: number; to: number; waiting_on_station: number; lines_moved: number } | null;
  return_boost: { ms: Dist; station_id: string; waiting_on_station: number; mark: string | null; lines_moved: number } | null;
  stations_live: { ms: Dist; in_flight: number };
  tick_intents: { ms: Dist; drafts: number; now_minus_peak_ms: number };
  removal_scan: { ms: Dist; orders: number };
  errors: Record<string, string>;
};

// Each row from the same immutable state, so one sample never leans on another's result. A row that throws is reported,
// and never takes the gate's other numbers with it.
export function measureAtPeak(peak: Peak, day: SimDay, events: readonly PosEvent[], o: { samples: number }): AtPeak {
  const point = peak.byUnfired;
  const errors: Record<string, string> = {};
  const guarded = <R>(name: string, work: () => R): R | null => {
    try {
      return work();
    } catch (e) {
      errors[name] = e instanceof Error ? e.message : String(e);
      return null;
    }
  };
  let bytes = 0;
  const ser = timed(o.samples, () => {
    bytes = JSON.stringify(peak.byLines.state).length;
  });
  const now = Math.max(point.at, nextDueAt(point.state, point.at) ?? point.at);
  let drafts = 0;
  const tick = timed(o.samples, () => {
    drafts = getTickIntents(point.state, now).length;
  });
  const live = timed(o.samples, () => {
    stationsLive(point.state, point.at);
  });
  const scan = timed(o.samples, () => {
    exitedOrderIds(point.state, point.at);
  });
  return {
    snapshot: { ms: dist(ser), first_ms: ser[0]!, bytes, lines: peak.byLines.lines, unfired: peak.byLines.unfired, seq: peak.byLines.seq, bytes_at_unfired_peak: JSON.stringify(point.state).length },
    bf7: guarded('bf7', () => bf7(point, day, o.samples)),
    capacity_drop: guarded('capacity_drop', () => capacityDrop(point, o.samples)),
    return_boost: guarded('return_boost', () => returnBoost(point, day, events, o.samples)),
    stations_live: { ms: dist(live), in_flight: Object.values(point.state.lines).filter((l) => l.fired_at !== null && l.done_at === null).length },
    tick_intents: { ms: dist(tick), drafts, now_minus_peak_ms: now - point.at },
    removal_scan: { ms: dist(scan), orders: Object.keys(point.state.orders).length },
    errors,
  };
}

export const peakSummary = (p: PeakPoint): { seq: number; at: number; lines: number; unfired: number } => ({ seq: p.seq, at: p.at, lines: p.lines, unfired: p.unfired });
