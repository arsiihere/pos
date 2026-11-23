// 03a §10.6: the Start / Done driver of the drill, on the real engine, the way the hub will drive it:
//   submit  checkOrderable → reserveStock → planOrder → the §4.2 batch, one recorded_at → applyEvent (strict);
//   tick    every 500 ms of simulated time a pass when due (firesDue's `now ≥ nextDueAt(state, now)`, §3.6.1), its
//           drafts stamped and folded in order, one recorded_at;
//   Start   tapped at the pass that fired the line (with 03b's lateStartShift draft when it gives one);
//   Done    tapped at Start + prep + cook; ItemServed when an order's last line is done.
// At one instant: Done taps, then the pass and its Start taps, then the submit.
//
// Idle passes are skipped: after each change the next pass is the first grid point ≥ nextDueAt(state, grid); a pass
// before it would be not due, so the hub would write nothing either. `everyTick` runs getTickIntents on every grid
// point instead, and harness.test.ts asserts both write the same events.
import { type PosEvent } from '@pos/events';
import { aBusinessDayClosed, aBusinessDayOpened, anEngineConfigApplied, anItemAdded, anItemStarted, anOrderBatch } from '@pos/events/testing';
import {
  applyEvent,
  applyEvents,
  checkOrderable,
  getAlertIntents,
  getTickIntents,
  MAX_DELAY_NO_LIMIT_MS,
  initialEngineState,
  lateStartShift,
  nextDueAt,
  ORDER_EXIT_AFTER_SERVED_MS,
  reserveStock,
  type EngineState,
  type ProposedOrder,
  type LinePrioritizedDraft,
  type TickDraft,
} from '../../src/index';
import { planOrderObserved } from '../../src/plan';
import { priorityRank } from '../../src/priority';
import { priorityTerms } from '../../src/slip';
import { generateDay, TICK_MS, type GenerateOptions, type SimDay, type SimOrder, type SimStation } from './generate';

export type Policy = 'waada_guard' | 'edf' | 'fifo';
export type RunOptions = {
  policy?: Policy;
  prune?: boolean;
  everyTick?: boolean;
  // Task 18: sees the live state after each fold, outside the re-plan stopwatch (the end of a day is drained, so live = replayed compares mid-day states too).
  watch?: (state: EngineState, last_seq: number) => void;
  // ⚠️ 03a v1.2.10 §10.6, test 172 (STAB-7): every line copies max_delay_ms = defaultMs (every `noLimitEvery`-th line of the
  // day "No limit", null), and a fires_alerts pass writes every LinePrioritized draft at each priority due (the host's
  // parking of priority_waits, cleared at any commit, FC-2). Off: the field is absent and no LinePrioritized is written.
  priority?: { defaultMs: number | null; noLimitEvery?: number };
  // Test 172's smoke: Start is tapped this long after the fire (fired lines slide meanwhile, §3.3), so re-plans push
  // waiting lines past their targets. Default 0 (tapped at the pass that fired the line).
  startLateMs?: number;
};

// Test 172's report (asserted only: the far-cap bound for groups a waiting line drives, checked at every pass).
export type PriorityStats = {
  lines: number;
  priority_lines: number;
  groups: number;
  priority_groups: number;
  delays_ms: number[]; // priority_delay_ms of every priority group
  no_limit_delays_ms: number[]; // of the priority groups with a No limit line
  overtakes: number; // a group's priority_land_ms moved later at another group's LinePrioritized fold
  overtakes_by_earlier_onset: number;
  bound_violations: string[]; // groups a waiting line drives, waiting past T + MAX_DELAY_NO_LIMIT_MS + one cook, not priority
};

export type SimResult = {
  events: PosEvent[];
  replanMs: number[]; // per submit: planOrder + the folds of its batch (§7.1 row 1)
  replacedLines: number[]; // per station re-plan: pass 1's free lines + the new lines there (the drill's len(free))
  overloadProbes: number[]; // per §3.5.6 search at a submit
  overloadStations: string[]; // the station of each overloadProbes entry
  liveState: EngineState;
  priority?: PriorityStats;
};

// §7.1: the simulator's stopwatch, the one clock of test/sim (never in src, F §6.7).
// eslint-disable-next-line no-restricted-syntax
export const wallMs = (): number => performance.now();

const PROGRAM = (station_id: string): string => `${station_id}-p`;
const HOUR = 3_600_000;

const eventId = (seq: number): string => `01J${String(seq).padStart(23, '0')}`;
const nextGrid = (t: number): number => (Math.floor(t / TICK_MS) + 1) * TICK_MS;
const ceilGrid = (t: number): number => Math.ceil(t / TICK_MS) * TICK_MS;

// anEngineConfigApplied's defaults (01a v2.1 §5.2a) with the day's stations and one policy.
function configEvent(stations: readonly SimStation[], policy: Policy, at: number, seq: number): PosEvent {
  const base = anEngineConfigApplied();
  const station = (base.payload as { stations: Array<Record<string, unknown>> }).stations[0]!;
  return anEngineConfigApplied({
    recorded_at: at,
    occurred_at: at,
    seq,
    event_id: eventId(seq),
    payload: {
      stations: stations.map((s) => ({
        ...station,
        station_id: s.station_id,
        name: s.station_id,
        station_type: s.type,
        capacity: s.capacity,
        freshness_window_ms: s.freshness_window_ms,
        policy,
        reference_cook_ms: s.cook_ms,
        programs: s.type === 'batch' ? [{ program_id: PROGRAM(s.station_id), name: s.station_id, cook_time_ms: s.cook_ms, is_archived: false }] : [],
      })),
    },
  });
}

export function itemFields(s: SimStation, maxDelay?: number | null): Record<string, unknown> {
  return {
    ...(maxDelay === undefined ? {} : { max_delay_ms: maxDelay }),
    station_id: s.station_id,
    item_id: s.station_id,
    name: s.station_id,
    cook_time_ms: s.cook_ms,
    ...(s.type === 'batch' ? { program_id: PROGRAM(s.station_id), program_cook_time_ms: s.cook_ms } : {}),
  };
}

// The ProposedOrder 02 builds from branchConfig() (§4.2): the ItemAdded drafts + the config defaults of the line.
export function proposedOf(order: SimOrder, stations: ReadonlyMap<string, SimStation>, maxDelay?: (order_item_id: string) => number | null | undefined): ProposedOrder {
  const base = anItemAdded().payload;
  return {
    order_id: order.order_id,
    order: {
      order_type: order.order_type,
      table_id: order.table_id,
      table_key: order.table_key,
      follow_up: order.follow_up,
      pickup_at_ms: order.pickup_at_ms,
    },
    lines: order.lines.map((l) => ({
      ...base,
      order_id: order.order_id,
      order_item_id: l.order_item_id,
      ...itemFields(stations.get(l.station_id)!, maxDelay?.(l.order_item_id)),
      alternates: [],
      point_id: null,
      carry_ms: 0,
      weight_pct: 100,
      max_early_ms: 60_000,
      max_late_ms: null,
      max_carry_ms: null,
      cook_ms_override: null,
      return_of: null,
    })) as unknown as ProposedOrder['lines'],
  };
}

// One log and one state across the days of a run.
class Sim {
  state = initialEngineState();
  events: PosEvent[] = [];
  replanMs: number[] = [];
  replacedLines: number[] = [];
  overloadProbes: number[] = [];
  overloadStations: string[] = [];
  watch: RunOptions['watch'];
  priority: RunOptions['priority'];
  startLateMs = 0;
  stats: PriorityStats = { lines: 0, priority_lines: 0, groups: 0, priority_groups: 0, delays_ms: [], no_limit_delays_ms: [], overtakes: 0, overtakes_by_earlier_onset: 0, bound_violations: [] };
  readonly maxDelays = new Map<string, number | null>();
  readonly parked = new Map<string, number | null>();
  readonly opts: { prune?: boolean };
  readonly template = anItemStarted();

  constructor(
    readonly policy: Policy,
    readonly prune: boolean,
    readonly everyTick: boolean,
  ) {
    this.opts = { prune };
  }

  get seq(): number {
    return this.events.length + 1;
  }

  append(e: PosEvent): void {
    this.parked.clear(); // FC-2: any commit un-parks every group
    this.events.push(e);
    this.state = applyEvent(this.state, e, this.opts);
    this.watch?.(this.state, this.events.length);
  }

  // The host's stamp on a draft (§3.6.1 Drafts): event_id, seq, occurred_at / recorded_at.
  stamp(d: Pick<TickDraft | LinePrioritizedDraft, 'stream_type' | 'stream_id' | 'event_type' | 'schema_version' | 'payload'>, at: number): PosEvent {
    const seq = this.seq;
    return {
      ...this.template,
      stream_type: d.stream_type,
      stream_id: d.stream_id,
      event_type: d.event_type,
      schema_version: d.schema_version,
      payload: d.payload as unknown as Record<string, unknown>,
      occurred_at: at,
      recorded_at: at,
      seq,
      event_id: eventId(seq),
    };
  }

  // An hub-stream day boundary, re-stamped: its payload names the day.
  boundary(e: PosEvent, at: number): void {
    this.append({ ...e, seq: this.seq, event_id: eventId(this.seq), occurred_at: at, recorded_at: at });
  }

  submit(order: SimOrder, stations: ReadonlyMap<string, SimStation>, dayStart: number): void {
    const now = order.at_ms;
    if (this.priority !== undefined) {
      for (const l of order.lines) {
        this.stats.lines++;
        const every = this.priority.noLimitEvery;
        this.maxDelays.set(l.order_item_id, every !== undefined && this.stats.lines % every === 0 ? null : this.priority.defaultMs);
      }
    }
    const md = this.priority === undefined ? undefined : (id: string) => this.maxDelays.get(id);
    const proposed = proposedOf(order, stations, md);
    checkOrderable(this.state, proposed);
    const stock = reserveStock(this.state, proposed, dayStart, [], {});
    const a = wallMs();
    const { plan, observed } = planOrderObserved(this.state, proposed, now, stock.from_stock, { prune: this.prune });
    let ms = wallMs() - a;
    const placed = new Map(plan.lines.map((l) => [l.order_item_id, l]));
    const batch = anOrderBatch({
      order_id: order.order_id,
      recorded_at: now,
      seq: this.seq,
      lines: order.lines.map((l) => {
        const p = placed.get(l.order_item_id)!;
        return {
          order_item_id: l.order_item_id,
          item: itemFields(stations.get(l.station_id)!, md?.(l.order_item_id)),
          line: { station_id: p.station_id, alternates: p.alternates, point_id: p.point_id, carry_ms: p.carry_ms, from_stock: p.from_stock },
        };
      }),
      order: { ...proposed.order, groups: plan.groups },
      reserved: stock.drafts.map((d) => d.payload),
    });
    const b = wallMs();
    // AD-28: one transaction's events, one call, as the host will.
    this.state = applyEvents(this.state, batch, this.opts);
    ms += wallMs() - b;
    this.events.push(...batch);
    this.watch?.(this.state, this.events.length);
    this.replanMs.push(ms);
    for (const station_id of new Set(order.lines.map((l) => l.station_id))) {
      const fresh = order.lines.filter((l) => l.station_id === station_id).length;
      this.replacedLines.push((observed.replaced[station_id] ?? 0) + fresh);
    }
    this.overloadProbes.push(...Object.values(observed.probes));
    this.overloadStations.push(...Object.keys(observed.probes));
  }

  // One day: orders in time order; returns when every line is served and nothing is due.
  drive(day: SimDay): void {
    const stations = new Map(day.stations.map((s) => [s.station_id, s]));
    const remaining = new Map<string, number>();
    const linesOf = new Map<string, string[]>();
    const doneAt = new Map<number, string[]>(); // tap instant → lines, in tap order
    const startAt = new Map<number, string[]>(); // startLateMs: Start tap instant → lines
    const instants = new MinHeap();
    let i = 0;
    let open = 0;

    const tapDone = (t: number): void => {
      const ids = doneAt.get(t);
      if (ids === undefined) return;
      doneAt.delete(t);
      for (const id of ids) {
        const order_id = this.state.lines[id]!.order_id;
        this.append(this.stamp({ stream_type: 'order', stream_id: order_id, event_type: 'ItemDone', schema_version: 1, payload: { order_item_id: id, done_at: t, source: 'tap' } }, t));
        const left = remaining.get(order_id)! - 1;
        remaining.set(order_id, left);
        open--;
        if (left === 0) {
          this.append(this.stamp({ stream_type: 'order', stream_id: order_id, event_type: 'ItemServed', schema_version: 1, payload: { order_item_ids: linesOf.get(order_id)!, source: 'tap' } } as never, t));
        }
      }
    };

    const tapStart = (id: string, t: number): void => {
      const line = this.state.lines[id]!;
      const shift = lateStartShift(this.state, id, t);
      this.append(this.stamp({ stream_type: 'order', stream_id: line.order_id, event_type: 'ItemStarted', schema_version: 1, payload: { order_item_id: id, started_at: t, source: 'tap' } }, t));
      if (shift !== null) this.append(this.stamp(shift, t));
      const at = t + line.prep_ms + line.cook_ms;
      const list = doneAt.get(at);
      if (list === undefined) {
        doneAt.set(at, [id]);
        instants.push(at);
      } else {
        list.push(id);
      }
    };

    // AD-28: one tick transaction's events, one call, as the host will.
    const pass = (t: number): void => {
      const fired: string[] = [];
      const stamped: PosEvent[] = [];
      for (const d of getTickIntents(this.state, t)) {
        const e = this.stamp(d, t);
        this.events.push(e);
        stamped.push(e);
        if (d.event_type === 'FireDispatched') fired.push(...d.payload.order_item_ids);
      }
      if (stamped.length > 0) {
        this.state = applyEvents(this.state, stamped, this.opts);
        this.watch?.(this.state, this.events.length);
      }
      if (this.startLateMs === 0) for (const id of fired) tapStart(id, t);
      else if (fired.length > 0) {
        const at = ceilGrid(t + this.startLateMs);
        startAt.set(at, [...(startAt.get(at) ?? []), ...fired]);
        instants.push(at);
      }
      if (this.priority !== undefined) this.priorityPass(t);
    };

    let tick = Number.POSITIVE_INFINITY;
    for (;;) {
      const submit = day.orders[i]?.at_ms ?? Number.POSITIVE_INFINITY;
      const tap = instants.peek() ?? Number.POSITIVE_INFINITY;
      const t = Math.min(submit, tap, tick);
      if (t === Number.POSITIVE_INFINITY) break;
      if (tap === t) {
        instants.pop();
        tapDone(t);
        const starts = startAt.get(t);
        if (starts !== undefined) {
          startAt.delete(t);
          for (const id of starts) if (this.state.lines[id]?.stage === 'added') tapStart(id, t);
        }
      }
      if (t % TICK_MS === 0) {
        if (this.everyTick) pass(t);
        else {
          const fires = nextDueAt(this.state, t);
          const pr = this.priority === undefined ? null : this.priorityDue();
          if ((fires !== null && t >= fires) || (pr !== null && t >= pr)) pass(t);
        }
      }
      while (i < day.orders.length && day.orders[i]!.at_ms === t) {
        const order = day.orders[i++]!;
        remaining.set(order.order_id, order.lines.length);
        linesOf.set(order.order_id, order.lines.map((l) => l.order_item_id));
        open += order.lines.length;
        this.submit(order, stations, day.start_ms);
      }
      const g = nextGrid(t);
      if (this.everyTick) {
        tick = open > 0 ? g : Number.POSITIVE_INFINITY;
      } else {
        const fires = nextDueAt(this.state, g);
        const pr = this.priority === undefined ? null : this.priorityDue();
        const due = fires === null ? pr : pr === null ? fires : Math.min(fires, pr);
        tick = due === null ? Number.POSITIVE_INFINITY : Math.max(g, ceilGrid(due));
      }
    }
  }

  // The earliest priority due not parked (a parked group counts at its recheck_at), as the host's nextAlertDueAt.
  priorityDue(): number | null {
    let min: number | null = null;
    for (const [gid, d] of Object.entries(this.state.priority_due)) {
      const v = this.parked.has(gid) ? this.parked.get(gid)! : d;
      if (v !== null && (min === null || v < min)) min = v;
    }
    return min;
  }

  // The priority half of a fires_alerts pass (§6.2a step 7): one transaction of its drafts; the waits parked.
  priorityPass(t: number): void {
    this.checkBound(t);
    const due = this.priorityDue();
    if (due === null || due > t) return;
    const a = getAlertIntents(this.state, t);
    const before = this.lands();
    const stamped = a.prioritized.map((d) => this.stamp(d, t));
    if (stamped.length > 0) {
      this.events.push(...stamped);
      this.parked.clear();
      this.state = applyEvents(this.state, stamped, this.opts);
      this.watch?.(this.state, this.events.length);
      const newRanks = new Map(a.prioritized.map((d) => [d.payload.group_id, priorityRank(this.state, d.payload.order_id, d.payload.group_id)]));
      for (const d of a.prioritized) {
        const g = this.state.orders[d.payload.order_id]?.groups[d.payload.group_id];
        if (g === undefined || g.priority_delay_ms === null) continue;
        this.stats.priority_groups++;
        this.stats.priority_lines += d.payload.order_item_ids.length;
        this.stats.delays_ms.push(g.priority_delay_ms);
        if (d.payload.order_item_ids.some((id) => this.maxDelays.get(id) === null)) this.stats.no_limit_delays_ms.push(g.priority_delay_ms);
      }
      for (const [gid, [order_id, land]] of before) {
        const now = this.state.orders[order_id]?.groups[gid]?.priority_land_ms ?? null;
        if (now === null || now <= land) continue;
        this.stats.overtakes++;
        const mine = priorityRank(this.state, order_id, gid);
        if (mine !== null && [...newRanks.values()].some((r) => r !== null && r.onset < mine.onset)) this.stats.overtakes_by_earlier_onset++;
      }
    }
    for (const w of a.priority_waits) this.parked.set(w.group_id, w.recheck_at);
  }

  lands(): Map<string, [string, number]> {
    const out = new Map<string, [string, number]>();
    for (const o of Object.values(this.state.orders)) for (const [gid, g] of Object.entries(o.groups)) if (g.priority_land_ms !== null) out.set(gid, [o.order_id, g.priority_land_ms]);
    return out;
  }

  // Test 172's bound: a group a waiting line drives (E_w > F), not priority, never waits past T + MAX_DELAY_NO_LIMIT_MS +
  // one cook (its longest waiting line's): its crossing was due before then, so a pass drafted it.
  checkBound(t: number): void {
    for (const o of Object.values(this.state.orders)) {
      for (const [gid, g] of Object.entries(o.groups)) {
        if (g.priority_delay_ms !== null || o.awaiting > 0) continue;
        let cook = 0;
        for (const id of g.line_ids) {
          const l = this.state.lines[id];
          if (l !== undefined && l.stage === 'added' && l.fired_at === null) cook = Math.max(cook, l.prep_ms + l.cook_ms + l.carry_ms);
        }
        if (cook === 0) continue;
        const terms = priorityTerms(this.state, o.order_id, gid, t);
        if (terms === null || !(terms.waiting > terms.fixed)) continue;
        if (terms.waiting > g.target_land_ms + MAX_DELAY_NO_LIMIT_MS + cook && this.stats.bound_violations.length < 20) this.stats.bound_violations.push(`${gid}@${t}`);
      }
    }
  }

  result(): SimResult {
    const priority = this.priority === undefined ? {} : { priority: { ...this.stats, groups: this.countGroups() } };
    return { events: this.events, replanMs: this.replanMs, replacedLines: this.replacedLines, overloadProbes: this.overloadProbes, overloadStations: this.overloadStations, liveState: this.state, ...priority };
  }

  countGroups(): number {
    let n = 0;
    for (const e of this.events) if (e.event_type === 'OrderPlaced' || e.event_type === 'OrderLinesAdded') n += ((e.payload as { groups?: unknown[] }).groups ?? []).length;
    return n;
  }
}

class MinHeap {
  private readonly a: number[] = [];
  peek(): number | undefined {
    return this.a[0];
  }
  push(x: number): void {
    const a = this.a;
    let i = a.length;
    a.push(x);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]! <= x) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = x;
  }
  pop(): void {
    const a = this.a;
    const x = a.pop()!;
    const n = a.length;
    if (n === 0) return;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && a[c + 1]! < a[c]!) c++;
      if (a[c]! >= x) break;
      a[i] = a[c]!;
      i = c;
    }
    a[i] = x;
  }
}

function dayOpened(day: SimDay): PosEvent {
  return aBusinessDayOpened({ payload: { business_date: new Date(day.start_ms).toISOString().slice(0, 10), stock_units: {}, draws: {} } });
}

function opening(sim: Sim, day: SimDay): void {
  const at = day.start_ms - 1;
  sim.boundary(dayOpened(day), at);
}

export function runDay(day: SimDay, o: RunOptions = {}): SimResult {
  const policy = o.policy ?? 'waada_guard';
  const sim = new Sim(policy, o.prune ?? true, o.everyTick ?? false);
  sim.watch = o.watch;
  sim.priority = o.priority;
  sim.startLateMs = o.startLateMs ?? 0;
  sim.append(configEvent(day.stations, policy, day.start_ms - 2, sim.seq));
  opening(sim, day);
  sim.drive(day);
  return sim.result();
}

// §7.1 "replay of 2 days": two generated business days, each opened and closed, on one log and one state (a deferred
// checkpoint that was never written), with per-day ids. drive returns when the day's last line is done, which on an
// over-capacity day is long after its 18 h of orders, so each close comes at max(start + 23 h, the day's last event) plus
// the exit time, past every order's exit (§3.3), and the next day starts no earlier than 24 h on, after that close.
// `shape` changes a generated day before it runs (a test's small over-capacity day).
export function twoDayLog(seed: number, o: Pick<GenerateOptions, 'orders'> & { shape?: (day: SimDay) => SimDay } = {}): SimResult {
  const shape = o.shape ?? ((day: SimDay): SimDay => day);
  const gen: GenerateOptions = o.orders === undefined ? {} : { orders: o.orders };
  const first = shape(generateDay(seed, { ...gen, id_prefix: 'D1' }));
  const sim = new Sim('waada_guard', true, false);
  sim.append(configEvent(first.stations, 'waada_guard', first.start_ms - 2, sim.seq));
  const closeDay = (day: SimDay): number => {
    opening(sim, day);
    sim.drive(day);
    const close = Math.max(day.start_ms + 23 * HOUR, sim.events.at(-1)!.recorded_at) + ORDER_EXIT_AFTER_SERVED_MS;
    sim.boundary(aBusinessDayClosed(), close);
    return close;
  };
  const closed = closeDay(first);
  closeDay(shape(generateDay(seed + 1, { ...gen, id_prefix: 'D2', start_ms: Math.max(first.start_ms + 24 * HOUR, ceilGrid(closed + TICK_MS)) })));
  return sim.result();
}
