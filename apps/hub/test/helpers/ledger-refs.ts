// 02b v1.0.13 §3.4 (owner 2026-11-12, 04 Q-19): a cascade child is a LedgerRef, which carries the line's
// option_quantity (order_lines.option_quantity). orderLines' LineView has no such field (§4.2), so test seeders that
// plan a void / remove / comp from orderLines rows add it here (1 statement, outside any counted handler).
import type Database from 'better-sqlite3';
import type { LineView } from '../../src/orders/contracts';

export function withOptionQuantity<L extends Pick<LineView, 'order_item_id'>>(db: Database.Database, lines: readonly L[]): Array<L & { option_quantity: number | null }> {
  const rows = db
    .prepare('SELECT order_item_id, option_quantity FROM order_lines WHERE order_item_id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(lines.map((l) => l.order_item_id))) as Array<{ order_item_id: string; option_quantity: number | null }>;
  const q = new Map(rows.map((r) => [r.order_item_id, r.option_quantity]));
  return lines.map((l) => {
    if (!q.has(l.order_item_id)) throw new Error(`withOptionQuantity: no order_lines row ${l.order_item_id}`);
    return { ...l, option_quantity: q.get(l.order_item_id)! };
  });
}
