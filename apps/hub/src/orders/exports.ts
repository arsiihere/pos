// 02b §4.2 read exports over `orders` / `order_lines` (§5) and 02a's `seating_orders` (P-1c, read-only join).
// Each export is exactly one SQL statement. "Live orders" (§3.13) = cancelled_at IS NULL; billed orders still count.
// Convention: an export takes `db`, runs 1 statement and never throws. Exception (⚠️ 04 row Q-2; G-16): `readOrder`
// takes the command's `ctx` (it reads through `ctx.tx.db` inside the caller's transaction) and throws
// `404 ORDER_NOT_FOUND`; it is still 1 statement.
import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { CommandCtx } from '../commands/registry.js';
import type { LineView, OrdersOf, OrderLines, OrderType, OrderView, SeatingTotals } from './contracts.js';
import { billedMinor, liveUnits } from './ledger.js';

// §3.4 billed_minor: item / option_child = refundable − comp − comp_voided − removed − refund; deal_part = 0;
// deal = line_total − Σ over its parts of (comp + comp_voided + removed + refund). A pending weight has refundable 0
// and a NULL total, so it contributes 0; a return line has refundable 0.
const BILLED = `CASE l.line_kind
    WHEN 'deal_part' THEN 0
    WHEN 'deal' THEN COALESCE(l.line_total_minor, 0) - COALESCE(
      (SELECT SUM(p.comp_minor + p.comp_voided_minor + p.removed_minor + p.refund_minor)
         FROM order_lines p WHERE p.order_id = l.order_id AND p.parent_order_item_id = l.order_item_id AND p.line_kind = 'deal_part'), 0)
    ELSE l.refundable_minor - l.comp_minor - l.comp_voided_minor - l.removed_minor - l.refund_minor
  END`;

const LINE_COLUMNS = `l.order_item_id AS l_order_item_id, l.order_id AS l_order_id, l.parent_order_item_id, l.line_kind,
  l.item_id, l.deal_id, l.name, l.sale_unit, l.quantity, l.units, l.comped_units, l.removed_units, l.voided_units,
  l.returned_units, l.refundable_minor, l.comp_minor, l.comp_voided_minor, l.removed_minor, l.refund_minor,
  l.line_total_minor, ${BILLED} AS billed_minor, l.return_of, l.served_from_zone_id, l.added_at, l.served_at,
  l.served_source, l.is_food, l.kitchen_note`;

type LineRow = Omit<LineView, 'order_item_id' | 'order_id' | 'live_units' | 'zone_served' | 'is_food'> & {
  l_order_item_id: string;
  l_order_id: string;
  is_food: number;
};

function toLine(r: LineRow): LineView {
  return {
    order_item_id: r.l_order_item_id,
    order_id: r.l_order_id,
    parent_order_item_id: r.parent_order_item_id,
    line_kind: r.line_kind,
    item_id: r.item_id,
    deal_id: r.deal_id,
    name: r.name,
    sale_unit: r.sale_unit,
    quantity: r.quantity,
    units: r.units,
    live_units: r.units - r.removed_units - r.voided_units,
    comped_units: r.comped_units,
    removed_units: r.removed_units,
    voided_units: r.voided_units,
    returned_units: r.returned_units,
    refundable_minor: r.refundable_minor,
    comp_minor: r.comp_minor,
    comp_voided_minor: r.comp_voided_minor,
    removed_minor: r.removed_minor,
    refund_minor: r.refund_minor,
    line_total_minor: r.line_total_minor,
    billed_minor: r.billed_minor,
    return_of: r.return_of,
    served_from_zone_id: r.served_from_zone_id,
    zone_served: r.served_from_zone_id !== null,
    added_at: r.added_at,
    served_at: r.served_at,
    served_source: r.served_source,
    is_food: r.is_food === 1,
    kitchen_note: r.kitchen_note,
  };
}

/** §4.2 / §3.13: Σ billed_minor over the seating's live orders' lines; order_count = live orders (billed ones count). */
export const seatingTotals: SeatingTotals = (db: Database.Database, seating_id: string) => {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(b.billed), 0) AS total_minor, COUNT(DISTINCT o.order_id) AS order_count
         FROM seating_orders so
         JOIN orders o ON o.order_id = so.order_id AND o.cancelled_at IS NULL
         LEFT JOIN (SELECT l.order_id, ${BILLED} AS billed FROM order_lines l) b ON b.order_id = o.order_id
        WHERE so.seating_id = ?`,
    )
    .get(seating_id) as { total_minor: number; order_count: number };
  return { total_minor: row.total_minor, order_count: row.order_count };
};

/** §4.2: lines per order, ordered by added_at then insertion (rowid). Every requested id has an entry. */
export const orderLines: OrderLines = (db: Database.Database, order_ids: readonly string[]) => {
  const out = new Map<string, LineView[]>(order_ids.map((id) => [id, []]));
  if (order_ids.length === 0) return out;
  const rows = db
    .prepare(
      `SELECT ${LINE_COLUMNS} FROM order_lines l
        WHERE l.order_id IN (SELECT value FROM json_each(?))
        ORDER BY l.order_id, l.added_at, l.rowid`,
    )
    .all(JSON.stringify(order_ids)) as LineRow[];
  for (const r of rows) out.get(r.l_order_id)!.push(toLine(r));
  return out;
};

type OrderRow = LineRow & {
  order_id: string;
  order_type: OrderView['order_type'];
  table_key: string;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: OrderView['car_type'];
  order_note: string | null;
  placed_by: string;
  placed_at: number;
  follow_up: number;
  cancelled_at: number | null;
  billed_at: number | null;
  day_closed_at: number | null;
  sent_after_reconnect: number;
  has_phone: number;
};

/**
 * §4.2: the seating's orders (every order of seating_orders, cancelled ones included, flagged `cancelled`) with their
 * lines, one joined statement; orders by placed_at, order_id; lines by added_at, insertion order.
 */
export const ordersOf: OrdersOf = (db: Database.Database, seating_id: string) => {
  const rows = db
    .prepare(
      `SELECT o.order_id, o.order_type, o.table_key, o.business_date, o.token, o.car_number, o.car_type, o.order_note,
              o.placed_by, o.placed_at, o.follow_up, o.cancelled_at, o.billed_at, o.day_closed_at,
              o.sent_after_reconnect, o.phone IS NOT NULL AS has_phone,
              ${LINE_COLUMNS}
         FROM seating_orders so
         JOIN orders o ON o.order_id = so.order_id
         LEFT JOIN order_lines l ON l.order_id = o.order_id
        WHERE so.seating_id = ?
        ORDER BY o.placed_at, o.order_id, l.added_at, l.rowid`,
    )
    .all(seating_id) as OrderRow[];
  const out: OrderView[] = [];
  for (const r of rows) {
    let order = out[out.length - 1];
    if (order === undefined || order.order_id !== r.order_id) {
      order = {
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
        cancelled: r.cancelled_at !== null,
        cancelled_at: r.cancelled_at,
        billed: r.billed_at !== null,
        billed_at: r.billed_at,
        day_closed_at: r.day_closed_at,
        sent_after_reconnect: r.sent_after_reconnect === 1,
        has_phone: r.has_phone === 1,
        lines: [],
      };
      out.push(order);
    }
    if (r.l_order_item_id !== null) order.lines.push(toLine(r));
  }
  return out;
};

/** 02b §4.2 `readOrder` head (04 row Q-2; G-14, G-16). */
export interface ReadOrderHead {
  order_id: string;
  order_type: OrderType;
  placed_by: string;
  billed_at: number | null;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: OrderView['car_type'];
  /** 02a seating_orders → seatings (read-only join, P-1c, no state filter): the order's last seating */
  seating_id: string | null;
  /** non-null for a closed seating too; "no current table" is `table_ids.length === 0` (G-14) */
  primary_table_id: string | null;
  holder_staff_id: string | null;
  /** the seating's seating_tables, joined_at then table_id (02a currentTableOf's order); [] once the seating is cleaned */
  table_ids: string[];
}

/** 02b §4.2 `readOrder` line: the line view plus the zone count of a zone line (§3.10). */
export type ReadOrderLine = LineView & { zone_on_hand: number | null };

// One statement: the order, its seating (02a, P-1c) with its tables (aggregate ORDER BY inside, SQLite ≥ 3.44), and its
// lines with the zone count of each zone line.
const READ_ORDER = `SELECT o.order_id, o.order_type, o.placed_by, o.billed_at, o.token, o.car_number, o.car_type, o.business_date,
       so.seating_id, s.primary_table_id, s.holder_staff_id,
       (SELECT json_group_array(st.table_id ORDER BY st.joined_at, st.table_id)
          FROM seating_tables st WHERE st.seating_id = so.seating_id) AS table_ids_json,
       l.order_item_id, l.parent_order_item_id, l.line_kind, l.item_id, l.deal_id, l.name, l.sale_unit, l.quantity,
       l.units, l.comped_units, l.removed_units, l.voided_units, l.returned_units, l.refundable_minor, l.comp_minor,
       l.comp_voided_minor, l.removed_minor, l.refund_minor, l.line_total_minor, l.return_of, l.served_from_zone_id,
       l.added_at, l.served_at, l.served_source, l.is_food, l.kitchen_note, zs.on_hand AS zone_on_hand
  FROM orders o
  LEFT JOIN seating_orders so ON so.order_id = o.order_id
  LEFT JOIN seatings s ON s.seating_id = so.seating_id
  LEFT JOIN order_lines l ON l.order_id = o.order_id
  LEFT JOIN zone_stock zs ON zs.zone_id = l.served_from_zone_id AND zs.item_id = l.item_id
 WHERE o.order_id = ?
 ORDER BY l.added_at, l.rowid`;

type ReadOrderRow = Omit<ReadOrderHead, 'table_ids'> & { table_ids_json: string | null } & Omit<
    ReadOrderLine,
    'order_id' | 'live_units' | 'billed_minor' | 'zone_served' | 'is_food' | 'order_item_id'
  > & { order_item_id: string | null; is_food: number };

/**
 * 02b §4.2 (04 row Q-2; G-14, G-16): the order head and its lines, 1 statement, through `ctx.tx.db`; throws
 * `404 ORDER_NOT_FOUND`. Used by `RemoveItems` and 04's identifier / `VoidItems`.
 */
export function readOrder(ctx: CommandCtx, order_id: string): { order: ReadOrderHead; lines: ReadOrderLine[] } {
  const rows = ctx.tx.db.prepare(READ_ORDER).all(order_id) as ReadOrderRow[];
  const first = rows[0];
  if (first === undefined) throw new DomainError('ORDER_NOT_FOUND', { order_id });
  const { order_type, placed_by, billed_at, business_date, token, car_number, car_type, seating_id, primary_table_id, holder_staff_id } = first;
  // json_group_array over no rows is '[]'; a NULL seating gives NULL (no seating_tables row matches NULL).
  const table_ids = first.table_ids_json === null ? [] : (JSON.parse(first.table_ids_json) as string[]);
  const lines: ReadOrderLine[] = rows
    .filter((r): r is ReadOrderRow & { order_item_id: string } => r.order_item_id !== null)
    .map((r) => ({
      order_item_id: r.order_item_id,
      order_id,
      parent_order_item_id: r.parent_order_item_id,
      line_kind: r.line_kind,
      item_id: r.item_id,
      deal_id: r.deal_id,
      name: r.name,
      sale_unit: r.sale_unit,
      quantity: r.quantity,
      units: r.units,
      live_units: liveUnits(r),
      comped_units: r.comped_units,
      removed_units: r.removed_units,
      voided_units: r.voided_units,
      returned_units: r.returned_units,
      refundable_minor: r.refundable_minor,
      comp_minor: r.comp_minor,
      comp_voided_minor: r.comp_voided_minor,
      removed_minor: r.removed_minor,
      refund_minor: r.refund_minor,
      line_total_minor: r.line_total_minor,
      billed_minor: 0,
      return_of: r.return_of,
      served_from_zone_id: r.served_from_zone_id,
      zone_served: r.served_from_zone_id !== null,
      added_at: r.added_at,
      served_at: r.served_at,
      served_source: r.served_source,
      is_food: r.is_food === 1,
      kitchen_note: r.kitchen_note,
      zone_on_hand: r.zone_on_hand,
    }));
  // §3.4 billed_minor (the ledger's rule; a deal from its parts)
  for (const l of lines) l.billed_minor = billedMinor(l, l.line_kind === 'deal' ? lines.filter((p) => p.parent_order_item_id === l.order_item_id && p.line_kind === 'deal_part') : []);
  const order: ReadOrderHead = {
    order_id,
    order_type,
    placed_by,
    billed_at,
    business_date,
    token,
    car_number,
    car_type,
    seating_id,
    primary_table_id,
    holder_staff_id,
    table_ids,
  };
  return { order, lines };
}
