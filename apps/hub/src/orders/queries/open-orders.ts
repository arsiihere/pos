import { DomainError } from '@pos/domain';
import { isOrderInEngine, type EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineQuery, queryRegistry } from '../../queries/registry.js';
import { keyBalances } from '../../billing/queries/key-balances.js';
import { passReadyTimesOf } from '../../kds/exports.js';
import { customerReadyAt } from '../../print/render/ready-at.js';
import { currentTableOf } from '../../tables/reads.js';
import type { CarType, LineView, OrderType, OrderView } from '../contracts.js';
import { orderLines } from '../exports.js';

// 02b v1.0.3 §6.16 GET /queries/open-orders: the open non-table orders (`orders_open`: not billed, not cancelled, not
// day-closed, §5) with token / car, has_phone, ready n / m, promise and "from <date>", by promise. `abandoned: true`
// (managers) adds open orders of any type that are abandoned (03a §4.3 To 02 #1). Statements: 2 (orders, lines);
// promise and stages from EngineState, the manager check from the directory, in memory.
//
// Readings (task 21 report): `managers` = 01d §3.4's target set (branch-scope `force-release-table-lock`, as
// alerts/targets.ts `managers`, owner R1); a caller outside it asking `abandoned: true` → 403. Abandoned = 03a §4.3
// To 02 #1 (`isOrderInEngine` false while the projection still shows an unserved live line), narrowed at the order
// level by owner R2 (2026-11-11): an order with no food line (`order_lines.is_food` = 0 on every line, i.e. only
// no-station / ready / zone-served lines, §3.3) is never abandoned; an order with a food line is abandoned on any live
// unserved line (a never-tapped water after the served karahi included). With an order_type,
// `abandoned: true` still adds the abandoned orders of every type (owner R12). Ready = a live line (deal
// headers left out, §3.4) served (`served_at`) or at engine stage done / served. promise_ms = the EngineOrder's
// promise while the order is in the engine (the predicate, 03a §3.3), else null (sorted last).
//
// v1.0.11 §6.16 (Q-9, #48): each row carries `placed_by { staff_id, name }` (the in-memory staff directory, 0
// statements; a placer no longer in it → name null) and `table_id`: for a dine-in row (only the abandoned list has
// them) the seating's current primary table (02a `currentTableOf`, one batched read, only when a dine-in row is
// listed; after a 02a move the new table), else null. Statements: 2, or 3 with a dine-in row.

/** The §5 `orders` columns of an open order (OrderView's) plus the contact columns, which only the catch-up may emit. */
export interface OpenOrderRow {
  order_id: string;
  order_type: OrderType;
  table_key: string;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  order_note: string | null;
  placed_by: string;
  placed_at: number;
  follow_up: number;
  sent_after_reconnect: number;
  has_phone: number;
  customer_name: string | null;
  phone: string | null;
  billed_at: number | null;
  bill_key: string | null;
  pickup_at_ms: number | null;
  pickup_boosted: number;
  unpaid_handover_approved_at: number | null;
  unpaid_handover_approved_due_minor: number | null;
}

const COLS = `o.order_id, o.order_type, o.table_key, o.business_date, o.token, o.car_number, o.car_type,
       o.order_note, o.placed_by, o.placed_at, o.follow_up, o.sent_after_reconnect, o.phone IS NOT NULL AS has_phone,
       o.customer_name, o.phone, o.billed_at, o.bill_key, o.pickup_at_ms, o.pickup_boosted,
       o.unpaid_handover_approved_at, o.unpaid_handover_approved_due_minor`;

// §6.16 v1.0.25: `orders_open` (§5, unchanged) UNION ALL `orders_open_takeaway_paid` (a billed takeaway with a live
// line not yet handed over: no deal header, live units > 0, `served_at` NULL). The types as a JSON list ('all' = 1).
const OPEN_ORDERS = `SELECT ${COLS} FROM orders o
 WHERE o.billed_at IS NULL AND o.cancelled_at IS NULL AND o.day_closed_at IS NULL
   AND (@all = 1 OR o.order_type IN (SELECT value FROM json_each(@types)))
UNION ALL
SELECT ${COLS} FROM orders o
 WHERE o.order_type = 'takeaway' AND o.billed_at IS NOT NULL AND o.cancelled_at IS NULL AND o.day_closed_at IS NULL
   AND (@all = 1 OR 'takeaway' IN (SELECT value FROM json_each(@types)))
   AND EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id = o.order_id AND l.line_kind <> 'deal'
                 AND l.served_at IS NULL AND l.units - l.removed_units - l.voided_units > 0)
 ORDER BY placed_at, order_id`;

/** The branch's open orders of `types` ('all' = every type), §3.3 Open (lists). 1 statement. */
export function openOrderRows(db: Database.Database, types: readonly OrderType[] | 'all'): OpenOrderRow[] {
  return db.prepare(OPEN_ORDERS).all({ all: types === 'all' ? 1 : 0, types: JSON.stringify(types === 'all' ? [] : types) }) as OpenOrderRow[];
}

/**
 * An open order as OrderView (§4.2): never cancelled or day-closed (the openOrderRows condition). No contact.
 * ⚠️ v1.0.25 §6.18 (G-1, M-4): `billed` / `billed_at` are the row's (a paid takeaway not yet handed over is listed).
 */
export function openOrderView(r: OpenOrderRow, lines: LineView[]): OrderView {
  return {
    order_id: r.order_id,
    order_type: r.order_type,
    table_key: r.table_key,
    business_date: r.business_date,
    token: r.token,
    car_number: r.car_number,
    car_type: r.car_type,
    order_note: r.order_note,
    placed_by: r.placed_by,
    placed_at: r.placed_at,
    follow_up: r.follow_up === 1,
    cancelled: false,
    cancelled_at: null,
    billed: r.billed_at !== null,
    billed_at: r.billed_at,
    day_closed_at: null,
    sent_after_reconnect: r.sent_after_reconnect === 1,
    has_phone: r.has_phone === 1,
    lines,
  };
}

/** A live line for day close, ready n / m and abandon: deal headers are left out (their parts count, §3.4). */
const counted = (l: LineView): boolean => l.line_kind !== 'deal' && l.live_units > 0;

export interface OpenOrder {
  order_id: string;
  order_type: OrderType;
  table_key: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  has_phone: boolean;
  placed_at: number;
  /** §6.16 v1.0.11 (Q-9): the placer; name from the staff directory, null when the placer is no longer in it */
  placed_by: { staff_id: string; name: string | null };
  /** §6.16 v1.0.11 (Q-9): a dine-in row's current primary table (02a `currentTableOf`); null for takeaway / parking */
  table_id: string | null;
  business_date: string;
  /** "from <date>": the order's business date when it is not the open day's date (a carried order); every order while no day is open (§6.16 R5) */
  from_date: string | null;
  ready: { n: number; m: number };
  promise_ms: number | null;
  abandoned: boolean;
  /** §6.16 v1.0.25: takeaway / parking only (dine-in null); `paid` once billed, else 05 `keyBalances` due */
  bill: { state: 'due' | 'paid'; due_minor: number } | null;
  /**
   * ⚠️ 02b v1.0.25 §6.16 (run 3 R3-M-8; D2): true only on an open, unbilled takeaway / parking row with an effective
   * approval (approved time and amount set) and a positive current due no higher than the approved amount; dine-in and
   * a paid row false. From the approval columns of the orders read and the batched due (no extra statement).
   */
  unpaid_handover_approved: boolean;
  /** §6.16 (R3-M-9): takeaway / parking = the D8 whole-bag epoch, dine-in = the Pass point history; null without one */
  ready_at: number | null;
  /** §6.16 (D8): the epoch's frozen window; null without an epoch (and for dine-in) */
  bag_ready_window_ms: number | null;
  /** §6.16: m = live lines (no deal header), n = those handed over (`served_at`) */
  handed: { n: number; m: number };
  /** §6.16: at most 6 live root lines, merged by part_of and then by name */
  lines_summary: Array<{ name: string; qty: number }>;
  lines_more: number;
  /** §6.16 (R3-M-1): the retained `orders.pickup_at_ms`; the effective one is null once boosted (§3.8) */
  pickup_at_ms: number | null;
  effective_pickup_at_ms: number | null;
  /** ⚠️ §6.16 (owner ruling BR-1): the engine's whole-order planned ready time (plannedReadyAt); null for dine-in */
  planned_ready_at_ms: number | null;
}

/**
 * ⚠️ 02b v1.0.25 §6.16 `planned_ready_at_ms` (owner ruling BR-1, 2026-11-27), also on the catch-up part `orders`
 * (§6.18): the engine's current whole-order planned ready time of an open takeaway / parking order, from the in-memory
 * engine state (0 statements). The latest planned land (03c `customerReadyAt(...).land_at`: the engine's land rule) of
 * the order's engine lines not yet ready (stage `added` / `cooking`; held lines included). null for a dine-in order,
 * when the order is not in the engine, when every live line is ready (no such line left), or when such a line has no
 * land yet (unknown: the client keeps the promise). The stored promise never changes (03a PK-5).
 */
export function plannedReadyAt(state: Readonly<EngineState>, order_id: string, order_type: OrderType, now: number): number | null {
  if (order_type === 'dine_in' || !isOrderInEngine(state as EngineState, order_id, now)) return null;
  let latest: number | null = null;
  for (const id of state.orders[order_id]!.line_ids) {
    const line = state.lines[id];
    if (line === undefined || (line.stage !== 'added' && line.stage !== 'cooking')) continue;
    const land = customerReadyAt(state, line)?.land_at ?? null;
    if (land === null) return null;
    latest = latest === null ? land : Math.max(latest, land);
  }
  return latest;
}

const SUMMARY_MAX = 6;

/** §6.16 `lines_summary`: live root lines (item, deal) in added_at order, merged by part_of then by equal name. */
function linesSummary(lines: readonly LineView[]): { lines_summary: OpenOrder['lines_summary']; lines_more: number } {
  const roots = lines
    .filter((l) => (l.line_kind === 'item' || l.line_kind === 'deal') && l.return_of === null && l.live_units > 0)
    .sort((a, b) => a.added_at - b.added_at);
  const byPart = new Map<string, { name: string; qty: number }>();
  for (const l of roots) {
    const key = l.part_of ?? l.order_item_id;
    const qty = l.sale_unit === 'piece' ? l.live_units : 1; // a weighed line counts 1
    const e = byPart.get(key);
    if (e === undefined) byPart.set(key, { name: l.name, qty });
    else e.qty += qty;
  }
  const byName = new Map<string, { name: string; qty: number }>();
  for (const e of byPart.values()) {
    const n = byName.get(e.name);
    if (n === undefined) byName.set(e.name, { ...e });
    else n.qty += e.qty;
  }
  const all = [...byName.values()];
  return { lines_summary: all.slice(0, SUMMARY_MAX), lines_more: Math.max(0, all.length - SUMMARY_MAX) };
}

export type OpenOrdersFilter = { order_type: 'takeaway' | 'parking' | 'all'; abandoned: boolean };

export function openOrdersBody(
  db: Database.Database,
  state: Readonly<EngineState>,
  directory: StaffDirectory,
  filter: OpenOrdersFilter,
  now: number,
): { orders: OpenOrder[] } {
  const types: OrderType[] = filter.order_type === 'all' ? ['takeaway', 'parking'] : [filter.order_type];
  const rows = openOrderRows(db, filter.abandoned ? 'all' : types);
  const lines = orderLines(db, rows.map((r) => r.order_id));
  // §6.16 R5 (v1.0.4; owner 2026-11-11 G-1): "today" is the open day's date only; after BusinessDayClosed the engine keeps
  // the closed day (closed_at set), and with no open day every order gets from_date = its business_date.
  const day = state.business_day;
  const today = day !== null && day.closed_at === null ? day.business_date : null;
  const out: OpenOrder[] = [];
  const billOf = new Map<string, OpenOrderRow>(); // takeaway / parking rows listed
  for (const r of rows) {
    const own = lines.get(r.order_id)!;
    const inEngine = isOrderInEngine(state, r.order_id, now);
    const abandoned = !inEngine && own.some((l) => l.is_food) && own.some((l) => counted(l) && l.served_at === null);
    if (!types.includes(r.order_type) && !abandoned) continue; // `abandoned: true` adds the other types' abandoned orders only
    const live = own.filter(counted);
    const ready = live.filter((l) => {
      const stage = inEngine ? state.lines[l.order_item_id]?.stage : undefined;
      return l.served_at !== null || stage === 'done' || stage === 'served';
    }).length;
    out.push({
      order_id: r.order_id,
      order_type: r.order_type,
      table_key: r.table_key,
      token: r.token,
      car_number: r.car_number,
      car_type: r.car_type,
      has_phone: r.has_phone === 1,
      placed_at: r.placed_at,
      placed_by: { staff_id: r.placed_by, name: directory.get(r.placed_by)?.display_name ?? null },
      table_id: null,
      business_date: r.business_date,
      from_date: r.business_date === today ? null : r.business_date,
      ready: { n: ready, m: live.length },
      promise_ms: inEngine ? state.orders[r.order_id]!.promise_ms : null,
      abandoned,
      bill: null,
      unpaid_handover_approved: false,
      ready_at: null,
      bag_ready_window_ms: null,
      handed: { n: live.filter((l) => l.served_at !== null).length, m: live.length },
      ...linesSummary(own),
      pickup_at_ms: r.pickup_at_ms,
      effective_pickup_at_ms: (inEngine ? state.orders[r.order_id]!.boosted : r.pickup_boosted === 1) ? null : r.pickup_at_ms,
      planned_ready_at_ms: plannedReadyAt(state, r.order_id, r.order_type, now),
    });
    if (r.order_type !== 'dine_in') billOf.set(r.order_id, r);
  }
  // §6.16 (B-1): one 05 keyBalances read for every unbilled takeaway / parking key, none when there is none
  const keys = [...new Set([...billOf.values()].filter((r) => r.billed_at === null && r.bill_key !== null).map((r) => r.bill_key!))];
  const balances = keys.length > 0 ? keyBalances(db, keys) : new Map<string, { due_minor: number }>();
  // §6.16 (R3-M-9): one 03b passReadyTimesOf read, only with a row
  const times = out.length > 0 ? passReadyTimesOf(db, out.map((o) => o.order_id)) : new Map();
  for (const o of out) {
    const t = times.get(o.order_id);
    const r = billOf.get(o.order_id);
    if (r === undefined) {
      o.ready_at = t?.ready_at ?? null; // dine-in: the existing point-history meaning
      continue;
    }
    o.ready_at = t?.bag_ready_since ?? null;
    o.bag_ready_window_ms = t?.bag_ready_window_ms ?? null;
    o.bill =
      r.billed_at !== null
        ? { state: 'paid', due_minor: 0 }
        : { state: 'due', due_minor: r.bill_key === null ? 0 : (balances.get(r.bill_key)?.due_minor ?? 0) };
    const approvedDue = r.unpaid_handover_approved_at === null ? null : r.unpaid_handover_approved_due_minor;
    o.unpaid_handover_approved = r.billed_at === null && approvedDue !== null && o.bill.due_minor > 0 && o.bill.due_minor <= approvedDue;
  }
  // §6.16 v1.0.11 (Q-9): one batched 02a read, only when a dine-in row is listed
  const dineIn = out.filter((o) => o.order_type === 'dine_in');
  if (dineIn.length > 0) {
    const tables = currentTableOf(db, dineIn.map((o) => o.order_id));
    for (const o of dineIn) o.table_id = tables.get(o.order_id)?.primary_table_id ?? null;
  }
  // by promise; no promise last; then placement
  out.sort(
    (a, b) =>
      (a.promise_ms ?? Number.POSITIVE_INFINITY) - (b.promise_ms ?? Number.POSITIVE_INFINITY) ||
      a.placed_at - b.placed_at ||
      (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0),
  );
  return { orders: out };
}

/** 01d §3.4 `managers`: branch-scope holders of `force-release-table-lock` (alerts/targets.ts `managers`). */
function requireManager(directory: StaffDirectory, staffId: string | null): void {
  const r = staffId === null ? null : directory.resolve(staffId, 'force-release-table-lock');
  if (r !== null && r.grant === 'allowed' && r.scope === 'branch') return;
  throw new DomainError('PERMISSION_DENIED', { permission: 'force-release-table-lock', reason: 'managers_only' });
}

export function registerOpenOrdersQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'open-orders',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({
        order_type: z.enum(['takeaway', 'parking', 'all']).optional(),
        abandoned: z.enum(['true', 'false']).optional(),
      }),
      handle(ctx, q) {
        const abandoned = q.abandoned === 'true';
        if (abandoned) requireManager(ctx.directory, ctx.session?.staff_id ?? null);
        return { data: openOrdersBody(ctx.db, ctx.state, ctx.directory, { order_type: q.order_type ?? 'all', abandoned }, ctx.now) };
      },
    }),
  );
}
