import { DomainError } from '@pos/domain';
import { isOrderInEngine, type EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineQuery, queryRegistry } from '../../queries/registry.js';
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
}

// `orders_open` (§5): its partial-index condition, the types as a JSON list ('all types' = 1).
const OPEN_ORDERS = `SELECT o.order_id, o.order_type, o.table_key, o.business_date, o.token, o.car_number, o.car_type,
       o.order_note, o.placed_by, o.placed_at, o.follow_up, o.sent_after_reconnect, o.phone IS NOT NULL AS has_phone,
       o.customer_name, o.phone
  FROM orders o
 WHERE o.billed_at IS NULL AND o.cancelled_at IS NULL AND o.day_closed_at IS NULL
   AND (? = 1 OR o.order_type IN (SELECT value FROM json_each(?)))
 ORDER BY o.placed_at, o.order_id`;

/** The branch's open orders of `types` ('all' = every type). 1 statement. */
export function openOrderRows(db: Database.Database, types: readonly OrderType[] | 'all'): OpenOrderRow[] {
  return db.prepare(OPEN_ORDERS).all(types === 'all' ? 1 : 0, JSON.stringify(types === 'all' ? [] : types)) as OpenOrderRow[];
}

/** An open order as OrderView (§4.2): never cancelled, billed or day-closed (the `orders_open` condition). No contact. */
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
    billed: false,
    billed_at: null,
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
  business_date: string;
  /** "from <date>": the order's business date when it is not the open day's date (a carried order); every order while no day is open (§6.16 R5) */
  from_date: string | null;
  ready: { n: number; m: number };
  promise_ms: number | null;
  abandoned: boolean;
}

export type OpenOrdersFilter = { order_type: 'takeaway' | 'parking' | 'all'; abandoned: boolean };

export function openOrdersBody(db: Database.Database, state: Readonly<EngineState>, filter: OpenOrdersFilter, now: number): { orders: OpenOrder[] } {
  const types: OrderType[] = filter.order_type === 'all' ? ['takeaway', 'parking'] : [filter.order_type];
  const rows = openOrderRows(db, filter.abandoned ? 'all' : types);
  const lines = orderLines(db, rows.map((r) => r.order_id));
  // §6.16 R5 (v1.0.4; owner 2026-11-11 G-1): "today" is the open day's date only; after BusinessDayClosed the engine keeps
  // the closed day (closed_at set), and with no open day every order gets from_date = its business_date.
  const day = state.business_day;
  const today = day !== null && day.closed_at === null ? day.business_date : null;
  const out: OpenOrder[] = [];
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
      business_date: r.business_date,
      from_date: r.business_date === today ? null : r.business_date,
      ready: { n: ready, m: live.length },
      promise_ms: inEngine ? state.orders[r.order_id]!.promise_ms : null,
      abandoned,
    });
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
        return { data: openOrdersBody(ctx.db, ctx.state, { order_type: q.order_type ?? 'all', abandoned }, ctx.now) };
      },
    }),
  );
}
