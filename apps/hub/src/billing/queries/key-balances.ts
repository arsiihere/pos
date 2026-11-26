// 05 v1.0.35 §6.2a `keyBalances(db, bill_keys)` — read export for 02b §6.16 `open-orders` (`bill.due_minor`) and the
// 02b unpaid hand-over checks (task B1-3; ⚠️ run 3 R3-B-1, D3). Not an endpoint: no permission, no event, no error of its
// own. Due of a key = Σ over its OPEN splits of that split's `balance_minor` (the split's total less its own net
// payments), computed as the bill view computes them (§6.1) before pending voids (as §6.2); closed splits add 0; a
// negative balance (a reopened bill with a lower total) is kept. A projected key (no bill row) is one open split, no
// payments, the rules in force now. A key with no unbilled, uncancelled order → `{ due_minor: 0, state: 'none' }`.
// Statements: 1 for any number of keys (≤ 300, §6.2's bound), 0 for []. Config in memory (the applied branch config).
import { DomainError } from '@pos/domain';
import type Database from 'better-sqlite3';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { billingAt, type BillOrderType } from '../commands/ensure-bill.js';
import { lineRows, NOT_IN_CORRECTIONS, OPEN_SPLIT_COLUMNS, openPart, type OpenPartBill, type Sum } from './open-bills.js';

export type KeyBalanceState = 'none' | 'projected' | 'open' | 'partly_paid';
export interface KeyBalance {
  due_minor: number;
  state: KeyBalanceState;
}

// 1: per asked key — its unbilled, uncancelled orders' lines (open-bills' KEYS rows), the live key bill (non-closed,
// non-absorbed, outside a corrections reopen) with its frozen rules, discount, closed units / shares and its open splits,
// each with its plan rows and live payments. Every collection is aggregated in its own subquery, never joined to another.
const KEY_BALANCES = `
WITH wanted AS (SELECT DISTINCT value AS bill_key FROM json_each(@keys)),
ko AS (
  SELECT o.order_id, o.bill_key, o.order_type, o.placed_at FROM orders o
  WHERE o.bill_key IN (SELECT bill_key FROM wanted) AND o.order_type <> 'dine_in' AND o.cancelled_at IS NULL
    AND o.billed_at IS NULL AND ${NOT_IN_CORRECTIONS})
SELECT w.bill_key,
  (SELECT business_date FROM billing_day WHERE k = 1) AS billing_date,
  (SELECT r.order_type FROM ko r WHERE r.bill_key = w.bill_key ORDER BY r.placed_at, r.order_id LIMIT 1) AS order_type,
  ${lineRows(`ko o JOIN order_lines l ON l.order_id = o.order_id WHERE o.bill_key = w.bill_key`)} AS sums,
  b.bill_id, b.state, b.sc_bp, b.sc_removed, b.discount_json, b.prices_include_tax, b.rounding_json, b.split_mode,
  COALESCE((SELECT SUM(i.discount_minor) FROM bill_splits bs JOIN invoices i ON i.invoice_id = bs.invoice_id
            WHERE bs.bill_id = b.bill_id AND bs.state = 'closed'), 0) AS closed_discount,
  (SELECT json_group_array(d.order_item_id) FROM bill_discount_lines d WHERE d.bill_id = b.bill_id) AS discount_line_ids,
  (SELECT json_group_array(json_object('id', c.order_item_id, 'units', c.units, 'share', c.share_minor))
     FROM closed_split_units c WHERE c.bill_id = b.bill_id) AS closed,
  ${OPEN_SPLIT_COLUMNS}
FROM wanted w
LEFT JOIN bills b ON b.bill_id = (
  SELECT x.bill_id FROM bills x
  WHERE x.scope = 'key' AND x.table_key = w.bill_key AND x.state <> 'closed' AND x.absorbed_into IS NULL
    AND x.reopen_mode IS NOT 'corrections'
  LIMIT 1)`;

type Row = Omit<OpenPartBill, 'sc_bp' | 'sc_removed' | 'prices_include_tax' | 'rounding_json'> & {
  bill_key: string;
  billing_date: string | null;
  order_type: BillOrderType | null;
  sums: string;
  bill_id: string | null;
  state: 'open' | 'partly_paid' | null;
  sc_bp: number | null;
  sc_removed: number | null;
  prices_include_tax: number | null;
  rounding_json: string | null;
  closed: string;
};

/** §6.2a: `Map<bill_key, { due_minor, state }>` with every asked key; 1 statement, 0 for []. */
export function keyBalances(db: Database.Database, bill_keys: readonly string[]): Map<string, KeyBalance> {
  const out = new Map<string, KeyBalance>();
  if (bill_keys.length === 0) return out;
  const rows = db.prepare(KEY_BALANCES).all({ keys: JSON.stringify(bill_keys) }) as Row[]; // 1
  const config = branchConfig();
  for (const r of rows) {
    if (r.order_type === null) {
      out.set(r.bill_key, { due_minor: 0, state: 'none' });
      continue;
    }
    if (config === null || r.billing_date === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');
    const { billing, rules } = billingAt(config, r.billing_date);
    const bill: OpenPartBill | null = r.bill_id === null ? null : (r as OpenPartBill);
    const { due_minor } = openPart(billing, rules, r.billing_date, {
      order_type: r.order_type,
      sums: JSON.parse(r.sums) as Sum[],
      closed: JSON.parse(r.closed) as Array<{ id: string; units: number; share: number }>,
      bill,
    });
    out.set(r.bill_key, { due_minor, state: r.state ?? 'projected' });
  }
  return out;
}
