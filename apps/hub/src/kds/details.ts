import { childQuantity, type Identifier, type LineDetail } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import { branchConfig } from '../sync/branch-config-holder.js';
import { currentTableOf } from '../tables/reads.js';

// 03b §3.1, §4.2, §4.4 (task b11): line details for the KDS, the Pass and 03c's tickets. Two statements per call:
// one read over order_lines + orders (+ the parent, the option children, the returned line and its order, the order
// taker's name) and one 02a currentTableOf for every dine-in order named. Station, point and times come from the
// engine (D7); a line the engine does not hold has no details (the screens show a placeholder, §3.3).

type OrderType = LineDetail['order_type'];
type CarType = 'sedan' | 'mini' | 'large';

interface OrderPart {
  order_id: string;
  order_type: OrderType;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
}

interface Row {
  order_item_id: string;
  order_id: string;
  line_kind: 'item' | 'option_child' | 'deal' | 'deal_part';
  name: string;
  sale_unit: 'piece' | 'g' | 'ml';
  live_units: number;
  kitchen_note: string | null;
  options_json: string | null; // 02b v1.0.7: the plain options [{ name, quantity }], NULL = none
  order_type: OrderType;
  business_date: string;
  token: number | null;
  car_number: string | null;
  car_type: CarType | null;
  order_note: string | null;
  placed_by_name: string | null;
  parent_kind: Row['line_kind'] | null;
  parent_name: string | null;
  children: string; // JSON [{ id, name, live }] of the line's option children
  r_order_item_id: string | null;
  r_name: string | null;
  r_order_id: string | null;
  r_order_type: OrderType | null;
  r_business_date: string | null;
  r_token: number | null;
  r_car_number: string | null;
  r_car_type: CarType | null;
}

const SQL = `
SELECT l.order_item_id, l.order_id, l.line_kind, l.name, l.sale_unit, l.units - l.removed_units - l.voided_units AS live_units,
       l.kitchen_note, l.options_json, o.order_type, o.business_date, o.token, o.car_number, o.car_type, o.order_note,
       s.display_name AS placed_by_name,
       p.line_kind AS parent_kind, p.name AS parent_name,
       (SELECT json_group_array(json_object('id', c.order_item_id, 'name', c.name, 'live', c.units - c.removed_units - c.voided_units))
          FROM (SELECT * FROM order_lines c0
                 WHERE c0.order_id = l.order_id AND c0.parent_order_item_id = l.order_item_id AND c0.line_kind = 'option_child'
                 ORDER BY c0.added_at, c0.rowid) c) AS children,
       r.order_item_id AS r_order_item_id, r.name AS r_name,
       ro.order_id AS r_order_id, ro.order_type AS r_order_type, ro.business_date AS r_business_date, ro.token AS r_token,
       ro.car_number AS r_car_number, ro.car_type AS r_car_type
  FROM (SELECT DISTINCT value FROM json_each(?)) j
  JOIN order_lines l ON l.order_item_id = j.value
  JOIN orders o ON o.order_id = l.order_id
  LEFT JOIN staff s ON s.staff_id = o.placed_by
  LEFT JOIN order_lines p ON p.order_item_id = l.parent_order_item_id
  LEFT JOIN order_lines r ON r.order_item_id = l.return_of
  LEFT JOIN orders ro ON ro.order_id = r.order_id`;

/** §3.1: a line's point is EngineLine.point_id, else its station's point (01a branchConfig); 0 statements. */
export function pointOfLine(state: EngineState, order_item_id: string): string | null {
  const line = state.lines[order_item_id];
  if (line === undefined) return null;
  if (line.point_id !== null) return line.point_id;
  return branchConfig()?.stations.find((s) => s.station_id === line.station_id)?.point_id ?? null;
}

/** 01d P-1: a table name gets the "T" prefix only when it is all digits ("4" → "T4", "Family 2" as is). */
export function tableLabel(name: string): string {
  return /^[0-9]+$/.test(name) ? `T${name}` : name;
}

/** §4.4 (v1.0.3, B3-2): an option entry, "name", or "<q> x name" when the quantity is > 1. */
export function optionText(name: string, quantity: number): string {
  return quantity > 1 ? `${quantity} x ${name}` : name;
}

/**
 * §4.4 (v1.0.3, B3-2): a line's plain options (02b v1.0.7 `order_lines.options_json`) as option entries, each quantity
 * scaled to the line's live units with 01c childQuantity: a piece line → quantity × live units; a g / ml item line →
 * the quantity once (never per gram). A deal part scales as a piece (its units are its portions, the g / ml part's
 * = the deal quantity), as 02b's option charges and cascade do (build-submit B2, ledger cascadeUnits).
 */
export function plainOptionTexts(
  options_json: string | null,
  line: { line_kind: string; sale_unit: 'piece' | 'g' | 'ml'; live_units: number },
): string[] {
  if (options_json === null) return [];
  const unit = line.line_kind === 'deal_part' ? 'piece' : line.sale_unit;
  return (JSON.parse(options_json) as Array<{ name: string; quantity: number }>).map((o) =>
    optionText(o.name, childQuantity(Math.max(0, o.quantity), Math.max(0, line.live_units), unit)),
  );
}

/** §4.2: details of the engine lines among `order_item_ids`; 2 statements (none for an empty list). */
export function buildLineDetails(db: Database.Database, state: EngineState, order_item_ids: readonly string[]): Map<string, LineDetail> {
  const out = new Map<string, LineDetail>();
  if (order_item_ids.length === 0) return out;
  const rows = (db.prepare(SQL).all(JSON.stringify(order_item_ids)) as Row[]).filter(
    (r) => state.lines[r.order_item_id] !== undefined && r.line_kind !== 'deal',
  );
  const dineIn = new Set<string>();
  for (const r of rows) {
    if (r.order_type === 'dine_in') dineIn.add(r.order_id);
    if (r.r_order_type === 'dine_in' && r.r_order_id !== null) dineIn.add(r.r_order_id);
  }
  const tables = currentTableOf(db, [...dineIn]);
  const config = branchConfig();
  const tableNames = new Map((config?.floors ?? []).flatMap((f) => f.tables.map((t) => [t.table_id, t.name] as const)));
  const today = state.business_day?.business_date ?? null;

  const identifier = (o: OrderPart): Identifier => {
    if (o.order_type === 'dine_in') {
      const current = tables.get(o.order_id);
      // Primary first, then the joined tables in join order; with no seating row, the engine's table at submit.
      const ids =
        current === undefined
          ? [state.orders[o.order_id]?.table_id].filter((t): t is string => typeof t === 'string')
          : [current.primary_table_id, ...current.table_ids.filter((t) => t !== current.primary_table_id)];
      return { kind: 'table', label: ids.map((t) => tableLabel(tableNames.get(t) ?? t)).join(' + ') };
    }
    if (o.order_type === 'takeaway') return { kind: 'token', token: o.token ?? 0, date: o.business_date === today ? null : o.business_date };
    return { kind: 'parking', car_number: o.car_number ?? '', car_type: o.car_type ?? 'sedan' };
  };

  for (const r of rows) {
    const line = state.lines[r.order_item_id]!;
    const point_id = pointOfLine(state, r.order_item_id);
    if (point_id === null) continue;
    const children = JSON.parse(r.children) as Array<{ id: string; name: string; live: number }>;
    const return_of =
      line.return_of === null || r.r_order_item_id === null || r.r_order_id === null || r.r_order_type === null
        ? null
        : {
            order_item_id: r.r_order_item_id,
            mode: line.return_of.mode,
            item_name: r.r_name ?? '',
            identifier: identifier({
              order_id: r.r_order_id,
              order_type: r.r_order_type,
              business_date: r.r_business_date ?? '',
              token: r.r_token,
              car_number: r.r_car_number,
              car_type: r.r_car_type,
            }),
          };
    out.set(r.order_item_id, {
      order_item_id: r.order_item_id,
      order_id: r.order_id,
      station_id: line.station_id,
      point_id,
      identifier: identifier(r),
      order_type: r.order_type,
      item_name: r.name,
      units: r.live_units,
      line_kind: r.line_kind as LineDetail['line_kind'],
      // A child at its own station shows its parent ("3 x Naan - for Chicken Karahi"); a deal part its deal.
      for_parent: r.line_kind === 'option_child' ? r.parent_name : null,
      deal_name: r.line_kind === 'deal_part' && r.parent_kind === 'deal' ? r.parent_name : null,
      // §4.4: option children with no station (never engine lines) ride on their parent's row, live ones only, with
      // their live units; then the plain options (v1.0.3, B3-2).
      options: [
        ...children.filter((c) => state.lines[c.id] === undefined && c.live > 0).map((c) => optionText(c.name, c.live)),
        ...plainOptionTexts(r.options_json, r),
      ],
      kitchen_note: r.kitchen_note,
      order_note: r.order_note,
      return_of,
      cook_ms: line.cook_ms,
      prep_ms: line.prep_ms,
      from_stock: line.from_stock,
      placed_by_name: r.placed_by_name,
    });
  }
  return out;
}
