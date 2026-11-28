// 03b v1.0.16 §3.5 "Order-level counter alert (R8, D8)" (run 3 R3-B-3, R3-M-9): one counter alert and one R8 epoch
// per complete takeaway / parking bag, across every point. A writer before-commit hook reconciles once per live writer
// transaction, after the business drafts and their projections, from the projected rows and the engine state folded
// through them (never on replay: boot replay does not use the writer).
// - A bag is complete when it has a live unserved non-deal line, every live engine line is done and in a current Ready
//   at its routed point or handed over, every live station-less line passes the pickup time gate, and a current
//   unsettled explicit Ready (MarkReadyToServe, not Handover's own) or a running epoch qualifies the order.
// - Complete, no epoch → one counter alert (ready_to_serve with counter_screen) and PassBagReadyChanged { ready }.
//   Incomplete with an epoch → its alert closes `obsolete` (`done` once nothing is left to serve) and the epoch clears.
//   A repeated check of the same complete period writes nothing; an epoch whose alert expired keeps its pair.
// Statements: 0 without a candidate order; else ≤ 2 batched reads (Ready / Handover / epoch facts; order and line
// facts) + one alerts.closeMany + one alerts.raiseMany with 01d's fixed bounds.
import type { Identifier } from '@pos/domain';
import type Database from 'better-sqlite3';
import { HUB_ENGINE_SETTING_DEFAULTS, type EventDraft, type PassBagReadyChangedPayload, type PosEvent } from '@pos/events';
import type { EngineState } from '@pos/engine';
import { alerts, type RaiseInput } from '../alerts/raise.js';
import type { TickDef } from '../alerts/tick.js';
import { rawDbOf } from '../engine-host/read-only-tx.js';
import type { PreCommit, WriterTx } from '../engine-host/writer.js';
import type { HubDeps } from '../server.js';
import { branchConfig } from '../sync/branch-config-holder.js';
import { identifierText } from './commands/ready.js';
import { pointOfLine } from './details.js';
import { READY_TO_SERVE_KIND } from './kinds.js';

/** §3.5 step 5: at most this many grouped entries on the card. */
const CARD_LINES_MAX = 20;
const ENGINE_LIVE = new Set(['added', 'cooking', 'done']);

// ⚠️ 03b v1.0.20 §3.5 (owner 2026-11-28 QA-R2, BUG-4, BUG-18): the named orders and their token members (every
// takeaway order of the same business date + token, index `orders_token_day`), in the same statement; 'm' rows give
// each takeaway member's bag key (`point_id`) and placement (`at`).
const FACTS_SQL = `
WITH ids AS (
  SELECT value AS order_id FROM json_each(@orders)
  UNION
  SELECT m.order_id FROM orders o
    JOIN orders m ON m.business_date = o.business_date AND m.token = o.token AND m.order_type = 'takeaway'
   WHERE o.order_id IN (SELECT value FROM json_each(@orders)) AND o.order_type = 'takeaway' AND o.token IS NOT NULL
)
SELECT 'm' AS k, o.order_id AS order_id, o.business_date || ':' || o.token AS point_id, o.placed_at AS at, NULL AS explicit,
       NULL AS ids, NULL AS since, NULL AS win, NULL AS alert_id
  FROM orders o WHERE o.order_id IN (SELECT order_id FROM ids) AND o.order_type = 'takeaway' AND o.token IS NOT NULL
UNION ALL
SELECT 'r', p.order_id, p.point_id, p.ready_at, p.ready_explicit,
       (SELECT json_group_array(r.order_item_id) FROM pass_ready_lines r
         WHERE r.order_id = p.order_id AND r.point_id = p.point_id AND r.settled_at IS NULL),
       NULL, NULL, NULL
  FROM pass_orders p WHERE p.ready_at IS NOT NULL AND p.order_id IN (SELECT order_id FROM ids)
UNION ALL
SELECT 'h', h.order_id, NULL, NULL, NULL, json_group_array(l.order_item_id), NULL, NULL, NULL
  FROM handovers h JOIN handover_lines l ON l.handover_id = h.handover_id
 WHERE h.order_id IN (SELECT order_id FROM ids) GROUP BY h.order_id
UNION ALL
SELECT 'b', order_id, point_id, NULL, NULL, NULL, bag_ready_since, bag_ready_window_ms, alert_id
  FROM pass_bag_ready WHERE order_id IN (SELECT order_id FROM ids)`;

const ORDERS_SQL = `
SELECT o.order_id, o.order_type, o.placed_by, o.placed_at, o.business_date, o.token, o.car_number, o.car_type,
       (SELECT json_group_array(json_object('id', l.order_item_id, 'name', l.name, 'units', l.units - l.removed_units - l.voided_units,
               'part_of', l.part_of, 'station', l.station_id, 'kind', l.line_kind, 'served', l.served_at IS NOT NULL))
          FROM order_lines l WHERE l.order_id = o.order_id) AS lines
  FROM orders o WHERE o.order_id IN (SELECT value FROM json_each(?))`;

interface FactRow {
  k: 'm' | 'r' | 'h' | 'b';
  order_id: string;
  point_id: string | null;
  at: number | null;
  explicit: number | null;
  ids: string | null;
  since: number | null;
  win: number | null;
  alert_id: string | null;
}

interface OrderRow {
  order_id: string;
  order_type: 'dine_in' | 'takeaway' | 'parking';
  placed_by: string;
  placed_at: number;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: 'sedan' | 'mini' | 'large' | null;
  lines: string;
}

interface LineRow {
  id: string;
  name: string;
  units: number;
  part_of: string | null;
  station: string | null;
  kind: string;
  served: number;
}

interface Epoch {
  since: number;
  window_ms: number;
  alert_id: string | null;
  point_id: string;
}

interface OrderFacts {
  readies: Array<{ point_id: string; at: number; explicit: boolean; ids: Set<string> }>;
  handed: Set<string>;
  epoch: Epoch | null;
}

/** Tests only: reports the reconciliation's own read count (its 01d raise / close excluded). */
let probe: ((reads: number) => void) | null = null;
export function registerBagReadyProbe(fn: ((reads: number) => void) | null): void {
  probe = fn;
}

// The orders with a running epoch, per hub db (memory): loaded once at registration (after boot's catch-up) and kept
// after every commit from PassBagReadyChanged, so a transaction that cannot change an epoch reads nothing.
const epochsByDb = new WeakMap<object, Set<string>>();

/** Once per server (lane B6): the before-commit reconciliation. 1 statement at registration. */
export function registerBagReady(deps: Pick<HubDeps, 'writer' | 'db'>): void {
  const epochs = new Set((deps.db.prepare('SELECT order_id FROM pass_bag_ready').all() as Array<{ order_id: string }>).map((r) => r.order_id));
  epochsByDb.set(deps.db, epochs);
  deps.writer.addBeforeCommit((pre) => reconcileBags(pre, epochs));
  deps.writer.addAfterCommit((appended) => {
    for (const e of appended) {
      if (e.event_type !== 'PassBagReadyChanged') continue;
      const p = e.payload as PassBagReadyChangedPayload;
      if (p.ready === null) epochs.delete(p.order_id);
      else epochs.add(p.order_id);
    }
  });
}

/** The orders of `db`'s hub with a running epoch (memory; the deadline tick). */
export function runningEpochs(db: Database.Database): ReadonlySet<string> {
  return epochsByDb.get(rawDbOf(db)) ?? new Set();
}

const counterScreen = (t: string | undefined): 'takeaway' | 'parking' | null => (t === 'takeaway' || t === 'parking' ? t : null);

/** §3.5: the orders a transaction names (every order-stream event but the reconciliation's own), for the reconciliation. */
function namedOrders(appended: readonly PosEvent[]): string[] {
  const out = new Set<string>();
  for (const e of appended) if (e.stream_type === 'order' && e.event_type !== 'PassBagReadyChanged') out.add(e.stream_id);
  return [...out];
}

/**
 * Memory pre-check (0 statements): an order can change its epoch only when it has one (it may end), or when every live
 * engine line is done (it may start). A takeaway / parking order still cooking, or one with only station-less lines and
 * no epoch, is skipped; an order the engine no longer holds matters only with an epoch.
 */
function mayChange(state: EngineState, order_id: string, epochs: ReadonlySet<string>): boolean {
  if (epochs.has(order_id)) return true;
  const order = state.orders[order_id];
  if (order === undefined || counterScreen(order.order_type) === null) return false;
  // ⚠️ 03b v1.0.20 (QA-R2, BUG-4): a takeaway order may end its token's epoch (an addition sent, a line un-done) while
  // any epoch runs; the reconciliation reads its token members
  if (order.order_type === 'takeaway' && epochs.size > 0) return true;
  const live = order.line_ids.filter((id) => ENGINE_LIVE.has(state.lines[id]?.stage ?? ''));
  return live.length > 0 && live.every((id) => state.lines[id]!.stage === 'done');
}

function reconcileBags(pre: PreCommit, epochs: ReadonlySet<string>): void {
  const named = namedOrders(pre.appended);
  if (named.length === 0) return;
  const tx = pre.tx();
  const state = tx.state as EngineState;
  const candidates = named.filter((id) => mayChange(state, id, epochs));
  if (candidates.length === 0) return;
  reconcileOrders(tx, candidates, { completing: completingPoints(pre.appended) });
}

/** §3.5 R3-M-9: the point of each order's latest Ready press in the transaction (the completing Ready). */
function completingPoints(appended: readonly PosEvent[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of appended) {
    if (e.event_type !== 'ReadyToServe') continue;
    const p = e.payload as { order_id: string; point_id: string; alert_id: string | null };
    if (p.alert_id !== null) out.set(p.order_id, p.point_id);
  }
  return out;
}

/** One order's §3.5 completeness facts (the engine still holds it as takeaway / parking). */
interface Member {
  order_id: string;
  row: OrderRow;
  facts: OrderFacts;
  lines: LineRow[];
  engineLive: string[];
  stationLess: LineRow[];
  /** a live unserved non-deal line is left */
  anyLive: boolean;
  /** the v1.0.16 order rule (every engine line covered, the time gate, an explicit Ready or a running epoch) */
  complete: boolean;
}

/**
 * §3.5 (⚠️ 03b v1.0.20, owner 2026-11-28 QA-R2, BUG-4, BUG-18): reconcile these orders' **bags** in `tx` (the
 * before-commit hook; the pickup deadline tick). A bag is a takeaway token (its members read in the facts statement),
 * else the order alone. One counter alert per complete bag, an epoch per member sharing it. ≤ 2 batched reads, one
 * closeMany and one raiseMany.
 */
export function reconcileOrders(tx: WriterTx, order_ids: readonly string[], o: { completing?: ReadonlyMap<string, string> } = {}): void {
  const state = tx.state as EngineState;
  const now = tx.clock.branchNow();
  let reads = 1;
  const factRows = tx.db.prepare(FACTS_SQL).all({ orders: JSON.stringify(order_ids) }) as FactRow[];
  const facts = new Map<string, OrderFacts>(order_ids.map((id) => [id, { readies: [], handed: new Set(), epoch: null }]));
  const bagOf = new Map<string, string>();
  const placedAt = new Map<string, number>();
  for (const r of factRows) {
    let f = facts.get(r.order_id);
    if (f === undefined) facts.set(r.order_id, (f = { readies: [], handed: new Set(), epoch: null }));
    if (r.k === 'm') {
      bagOf.set(r.order_id, `token:${r.point_id!}`);
      placedAt.set(r.order_id, r.at!);
    } else if (r.k === 'r') f.readies.push({ point_id: r.point_id!, at: r.at!, explicit: r.explicit === 1, ids: new Set(JSON.parse(r.ids ?? '[]') as string[]) });
    else if (r.k === 'h') for (const id of JSON.parse(r.ids ?? '[]') as string[]) f.handed.add(id);
    else f.epoch = { since: r.since!, window_ms: r.win!, alert_id: r.alert_id, point_id: r.point_id! };
  }
  const all = [...facts.keys()];
  // the order and line facts: only for orders the engine still holds as takeaway / parking
  const engineOrders = all.filter((id) => counterScreen(state.orders[id]?.order_type) !== null);
  const rows = new Map<string, OrderRow>();
  if (engineOrders.length > 0) {
    reads += 1;
    for (const r of tx.db.prepare(ORDERS_SQL).all(JSON.stringify(engineOrders)) as OrderRow[]) rows.set(r.order_id, r);
  }
  probe?.(reads);

  // each order's facts, then its bag
  const bags = new Map<string, { ids: string[]; members: Member[] }>();
  for (const order_id of all) {
    const key = bagOf.get(order_id) ?? order_id;
    let bag = bags.get(key);
    if (bag === undefined) bags.set(key, (bag = { ids: [], members: [] }));
    bag.ids.push(order_id);
    const order = state.orders[order_id];
    const row = rows.get(order_id);
    if (order === undefined || counterScreen(order.order_type) === null || row === undefined) continue; // dropped
    const f = facts.get(order_id)!;
    const lines = JSON.parse(row.lines) as LineRow[];
    const engineLive = order.line_ids.filter((id) => ENGINE_LIVE.has(state.lines[id]?.stage ?? ''));
    const stationLess = lines.filter((l) => l.station === null && l.kind !== 'deal' && l.served === 0 && l.units > 0);
    const anyLive = engineLive.length > 0 || stationLess.length > 0;
    const covered = (id: string): boolean => {
      if (state.lines[id]!.stage !== 'done') return false;
      if (f.handed.has(id)) return true;
      const point = pointOfLine(state, id);
      return f.readies.some((r) => r.point_id === point && r.ids.has(id));
    };
    const pickup = order.boosted ? null : order.pickup_at_ms;
    const timeGate = stationLess.length === 0 || pickup === null || now >= pickup;
    const explicitReady = f.readies.some((r) => r.explicit && r.ids.size > 0);
    const complete = anyLive && engineLive.every(covered) && timeGate && (explicitReady || f.epoch !== null);
    bag.members.push({ order_id, row, facts: f, lines, engineLive, stationLess, anyLive, complete });
  }

  const ctx = alerts.tickCtx(tx, now);
  const closes = new Map<string, 'obsolete' | 'done'>();
  const clears: string[] = [];
  const raises: Array<{ order_ids: string[]; input: RaiseInput; point_id: string; window_ms: number }> = [];
  for (const bag of bags.values()) {
    const epochIds = bag.ids.filter((id) => facts.get(id)!.epoch !== null);
    const live = bag.members.filter((m) => m.anyLive).sort((a, b) => (placedAt.get(a.order_id) ?? a.row.placed_at) - (placedAt.get(b.order_id) ?? b.row.placed_at) || (a.order_id < b.order_id ? -1 : 1));
    const alertIds = new Set(epochIds.map((id) => facts.get(id)!.epoch!.alert_id).filter((a): a is string => a !== null));
    const liveIds = new Set(live.map((m) => m.order_id));
    const complete = live.length > 0 && live.every((m) => m.complete);
    if (complete) {
      const held = live.every((m) => m.facts.epoch !== null) && alertIds.size <= 1 && new Set(live.map((m) => m.facts.epoch!.alert_id)).size === 1;
      if (held) {
        // the same complete period: only a member that left (served, no live line) gives up its epoch
        for (const id of epochIds) if (!liveIds.has(id)) clears.push(id);
        continue;
      }
      // a new complete period (or a member joined a running one): the old alert goes, one new alert for the bag
      for (const a of alertIds) closes.set(a, 'obsolete');
      clears.push(...epochIds);
      const point_id = bagEscalationPoint(state, live, o.completing);
      const window_ms = branchConfig()?.engine_settings.ready_window_ms ?? HUB_ENGINE_SETTING_DEFAULTS.ready_window_ms;
      raises.push({ order_ids: live.map((m) => m.order_id), point_id, window_ms, input: counterInput(state, live, point_id, window_ms) });
    } else if (epochIds.length > 0) {
      for (const a of alertIds) closes.set(a, live.length > 0 ? 'obsolete' : 'done');
      clears.push(...epochIds);
    }
  }
  if (closes.size === 0 && clears.length === 0 && raises.length === 0) return;

  const drafts: EventDraft[] = closes.size === 0 ? [] : alerts.closeMany(ctx, [...closes].map(([alert_id, reason]) => ({ alert_id, reason })));
  for (const order_id of clears) drafts.push(bagDraft(now, { order_id, ready: null }));
  if (drafts.length > 0) tx.append(drafts);
  if (raises.length === 0) return;
  const raised = alerts.raiseMany(ctx, raises.map((r) => r.input));
  const appended = tx.append(raised.flatMap((r) => r.events));
  const recorded = new Map(
    appended.filter((e) => e.event_type === 'AlertRaised').map((e) => [String((e.payload as { alert_id: string }).alert_id), e.recorded_at] as const),
  );
  const starts = raises.flatMap((r, i) => {
    const alert_id = raised[i]!.alert_id;
    return r.order_ids.map((order_id) =>
      bagDraft(now, { order_id, ready: { bag_ready_since: recorded.get(alert_id) ?? now, bag_ready_window_ms: r.window_ms, alert_id, point_id: r.point_id } }),
    );
  });
  tx.append(starts);
}

/** The R8 state change, written by the hub (as the tick ctx: actor null, device 'hub'). */
function bagDraft(now: number, payload: PassBagReadyChangedPayload): EventDraft {
  return {
    stream_type: 'order',
    stream_id: payload.order_id,
    event_type: 'PassBagReadyChanged',
    schema_version: 1,
    payload,
    occurred_at: now,
    actor_id: null,
    device_id: 'hub',
  };
}

/**
 * §3.5 (R3-M-9; ⚠️ 03b v1.0.20 per bag): the completing Ready's point (of any member); for a non-point trigger the most
 * recent current Ready at an active point over the bag (equal times by point id); with only Handovers, the routed point
 * of the first live engine line by id.
 */
function bagEscalationPoint(state: EngineState, live: readonly Member[], completing: ReadonlyMap<string, string> | undefined): string {
  for (const m of live) {
    const c = completing?.get(m.order_id);
    if (c !== undefined) return c;
  }
  const active = new Set((branchConfig()?.points ?? []).filter((p) => !p.is_archived).map((p) => p.point_id));
  const current = live
    .flatMap((m) => m.facts.readies)
    .filter((r) => active.has(r.point_id))
    .sort((a, b) => b.at - a.at || (a.point_id < b.point_id ? -1 : a.point_id > b.point_id ? 1 : 0))[0];
  if (current !== undefined) return current.point_id;
  const first = live.flatMap((m) => m.engineLive).sort()[0];
  return (first === undefined ? null : pointOfLine(state, first)) ?? live.find((m) => m.facts.epoch !== null)?.facts.epoch?.point_id ?? live[0]!.order_id;
}

/** §3.5 step 5 for the bag: subject, values and target of its oldest live member; details = the whole bag. */
function counterInput(state: EngineState, live: readonly Member[], point_id: string, window_ms: number): RaiseInput {
  const head = live[0]!;
  const order_id = head.order_id;
  const row = head.row;
  const screen = counterScreen(row.order_type)!;
  const order = state.orders[order_id]!;
  // the complete bag: every live engine line and every live station-less line; split parts grouped, units summed
  const entries = new Map<string, { name: string; quantity: number; state: string }>();
  for (const m of live) {
    const byId = new Map(m.lines.map((l) => [l.id, l]));
    for (const l of [...m.engineLive.map((id) => byId.get(id)).filter((l): l is LineRow => l !== undefined), ...m.stationLess]) {
      const key = l.part_of ?? l.id;
      const units = Math.max(1, l.units);
      const had = entries.get(key);
      if (had === undefined) entries.set(key, { name: l.name, quantity: units, state: 'ready' });
      else had.quantity += units;
    }
  }
  const today = state.business_day?.business_date ?? null;
  const identifier: Identifier =
    screen === 'takeaway'
      ? { kind: 'token', token: row.token ?? 0, date: row.business_date === today ? null : row.business_date }
      : { kind: 'parking', car_number: row.car_number ?? '', car_type: row.car_type ?? 'sedan' };
  const pointName = branchConfig()?.points.find((p) => p.point_id === point_id)?.name ?? null;
  return {
    kind: READY_TO_SERVE_KIND,
    subject: { stream_type: 'order', stream_id: order_id },
    target: { kind: 'person', staff_id: order.placed_by ?? row.placed_by },
    values: { order_id, point_id, table_id: '', window_ms, counter_screen: screen },
    display: { table_code: screen === 'takeaway' ? `#${row.token ?? 0}` : 'PARKING', point_code: pointName, kind_label_key: 'alert.ready_to_serve' },
    details: { identifier: identifierText(identifier), lines: [...entries.values()].slice(0, CARD_LINES_MAX) },
    dedupe_key: `counter-ready:${order_id}`,
  };
}

// ------------------------------------------------------------------------------------------- pickup deadline tick

export const BAG_READY_DEADLINE_TICK = 'bag_ready_deadline';

// Per hub db: order → the pickup time whose deadline was rechecked (a boost or a new pickup time rechecks again).
const handledByDb = new WeakMap<object, Map<string, number>>();

/**
 * §3.5 (R3-B-3): a held station-less line blocks the bag until the pickup time. Candidates (memory): a takeaway /
 * parking engine order, not boosted, its pickup time reached, no running epoch, and every live engine line done; each
 * pickup time is rechecked once. The recheck is the reconciliation itself (it fires only when every other condition
 * still holds): its ≤ 2 batched reads for all candidates together, one raiseMany. Events are appended in `intents`.
 */
function deadlineCandidates(db: Database.Database, state: Readonly<EngineState>, now: number): Array<{ order_id: string; pickup: number }> {
  const epochs = runningEpochs(db);
  const handled = handledByDb.get(rawDbOf(db)); // `due` gets the read-only view, `intents` the writer's db
  const out: Array<{ order_id: string; pickup: number }> = [];
  for (const id in state.orders) {
    const order = state.orders[id]!;
    if (counterScreen(order.order_type) === null || order.boosted || order.pickup_at_ms === null || order.pickup_at_ms > now) continue;
    if (epochs.has(id) || handled?.get(id) === order.pickup_at_ms) continue;
    const live = order.line_ids.filter((l) => ENGINE_LIVE.has(state.lines[l]?.stage ?? ''));
    if (live.length > 0 && live.every((l) => state.lines[l]!.stage === 'done')) out.push({ order_id: id, pickup: order.pickup_at_ms });
  }
  return out;
}

export const bagReadyDeadlineTick: TickDef = {
  name: BAG_READY_DEADLINE_TICK,
  due(db, state, now) {
    return deadlineCandidates(db, state, now).length > 0;
  },
  intents(tx, state, now) {
    const candidates = deadlineCandidates(tx.db, state, now);
    if (candidates.length === 0) return [];
    const key = rawDbOf(tx.db);
    let handled = handledByDb.get(key);
    if (handled === undefined) handledByDb.set(key, (handled = new Map()));
    reconcileOrders(tx, candidates.map((c) => c.order_id));
    for (const c of candidates) handled.set(c.order_id, c.pickup);
    return [];
  },
};
