import type Database from "better-sqlite3";
import type { LineGuard, LineGuardEntry } from "../../orders/line-guard.js";
import type { MergeGuard } from "../../tables/contracts.js";

// 05 task 24 (05-plan §3 row 24): 05's two guards on 02a's and 02b's ordered lists, registered by registerBilling
// (billing/index.ts) after 04's (registerVoids runs first in buildHubServer). Each is 1 statement.

/**
 * §3.9, row T-1 (02a v1.1.8 `registerMergeGuard`): a merge (`seating_ids` = both seatings) or a seating split
 * (`seating_ids` = the source, `order_ids` = the moved orders; the rule reads the whole source bill, so `order_ids` is
 * not read) is refused `409 BILL_HAS_PAYMENTS { bill_id }` while a not-CLOSED, not-absorbed bill of those seatings has
 * a live payment, a discount, a closed split or `reopen_count ≥ 1` (H2-11, H4-3). The first such bill in
 * `seating_ids` order answers. `bills_seating` covers every bill of a seating, corrections bills included (a
 * corrections bill always has `reopen_count ≥ 1`). 1 statement.
 */
const MERGE = `SELECT b.bill_id
  FROM json_each(?) s JOIN bills b ON b.seating_id = s.value
  WHERE b.absorbed_into IS NULL AND b.state <> 'closed'
    AND (b.reopen_count >= 1
      OR b.discount_json IS NOT NULL
      OR EXISTS (SELECT 1 FROM bill_splits x WHERE x.bill_id = b.bill_id AND x.state = 'closed')
      OR EXISTS (SELECT 1 FROM bill_payments p WHERE p.bill_id = b.bill_id AND p.removed_at IS NULL))
  ORDER BY s.key, b.opened_at, b.bill_id
  LIMIT 1`;

export const billMergeGuard: MergeGuard = (db, q) => {
  const bill_id = db
    .prepare(MERGE)
    .pluck()
    .get(JSON.stringify(q.seating_ids)) as string | undefined;
  return bill_id === undefined
    ? null
    : { code: "BILL_HAS_PAYMENTS", details: { bill_id } };
};

/**
 * B15, row Q-3 (02b v1.0.17 `registerLineGuard`; R-16, R-33): per distinct touched id, Σ the units and the base shares
 * the closed splits of a not-CLOSED bill invoiced (`closed_split_units`, deleted by BillReopened) and the lowest such
 * split_no. ONE read for the whole list (the distinct ids; an id may repeat in `touched`).
 */
const CLOSED = `SELECT c.order_item_id, c.bill_id, MIN(c.split_no) AS split_no, SUM(c.units) AS units, SUM(c.share_minor) AS share_minor
  FROM closed_split_units c JOIN bills b ON b.bill_id = c.bill_id AND b.state <> 'closed'
  WHERE c.order_item_id IN (SELECT DISTINCT value FROM json_each(?))
  GROUP BY c.order_item_id, c.bill_id`;

interface Closed {
  order_item_id: string;
  bill_id: string;
  split_no: number;
  units: number;
  share_minor: number;
}

/**
 * Row Q-3's rules for one entry against the line's closed units C and closed share S (H1-6, H2-2, H3-4, R-33):
 * refused when `units_after < C`, `comped_after > units_after − C`, `money_changes` with any closed row (the R-33
 * parent deal entry), `base_after − S < 0`, or `base_after − S ≠ 0` while `units_after = C`. An amount / equal close
 * records the line's live units (R-64, H1-27), so these rules refuse every change to a line it froze.
 */
function refuses(t: LineGuardEntry, c: Closed): boolean {
  const residual = t.base_after_minor - c.share_minor;
  return (
    t.units_after < c.units ||
    t.comped_after > t.units_after - c.units ||
    t.money_changes ||
    residual < 0 ||
    (t.units_after === c.units && residual !== 0)
  );
}

/**
 * Every entry of `touched` is judged on its own, in list order; the first refusal answers `409 LINE_IN_CLOSED_SPLIT
 * { order_item_id, bill_id, split_no }`. 1 statement (0 for an empty list). `order_id` is not read: the callers name
 * lines of that order only.
 */
export const billLineGuard: LineGuard = (
  db: Database.Database,
  _order_id,
  touched,
) => {
  if (touched.length === 0) return null;
  const rows = db
    .prepare(CLOSED)
    .all(JSON.stringify(touched.map((t) => t.order_item_id))) as Closed[];
  if (rows.length === 0) return null;
  // One row per id in practice: a line is on one live bill, and a bill with a closed split is never merged (the merge
  // guard above refuses it). Should two not-CLOSED bills ever hold the same id, the first row read is kept.
  const byId = new Map<string, Closed>();
  for (const r of rows) if (!byId.has(r.order_item_id)) byId.set(r.order_item_id, r);
  for (const t of touched) {
    const c = byId.get(t.order_item_id);
    if (c !== undefined && refuses(t, c))
      return {
        code: "LINE_IN_CLOSED_SPLIT",
        details: {
          order_item_id: t.order_item_id,
          bill_id: c.bill_id,
          split_no: c.split_no,
        },
      };
  }
  return null;
};
