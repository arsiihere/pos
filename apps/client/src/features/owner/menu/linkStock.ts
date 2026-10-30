import type { CloudAdmin, CloudError, StockUnit } from '../../../api/cloud-admin';

// 01c §8 (m7, N9), contract §2 "Create a stock item with this name": three calls with no new endpoint.
//   1. §6.7 POST the stock item (keeps overnight off, Q9), with the mini-form's one Idempotency-Key.
//   2. §6.9 PUT "Counted here" at each branch where the item is routed, with that route's station (no alert).
//   3. The item PATCH with its one draw (a new item takes the draw on its own POST instead).
// Before any PUT the stock item is re-read (§6.6) and only the rows still missing are sent, each with the
// version just read, so a retry after a lost response never answers CONFIG_STALE (test #124). A retry of
// step 1 reuses the key, so a lost 201 is replayed instead of a name-taken error.
export interface LinkPlan {
  name: string;
  stockUnit: StockUnit;
  key: string;
  stations: readonly { branch_id: string; station_id: string }[];
  quantity: number;
  // null: a new item, linked by the form (its POST carries stock_draws).
  itemId: string | null;
}

export type LinkStep = 1 | 2 | 3;

export type LinkResult =
  | { ok: true; stockItemId: string }
  | { ok: false; stockItemId: string | null; step: LinkStep; error: CloudError };

export async function linkStock(
  api: CloudAdmin,
  plan: LinkPlan,
  known: string | null,
  onStep: (step: LinkStep) => void,
): Promise<LinkResult> {
  onStep(1);
  let stockItemId = known;
  if (stockItemId === null) {
    const created = await api.createStockItem({ name: plan.name, stock_unit: plan.stockUnit, carries_over: false }, plan.key);
    if (!created.ok) return { ok: false, stockItemId: null, step: 1, error: created.error };
    stockItemId = created.data.stock_item.stock_item_id;
  }

  onStep(2);
  if (plan.stations.length > 0) {
    const read = await api.listStockItems({});
    if (!read.ok) return { ok: false, stockItemId, step: 2, error: read.error };
    const rows = read.data.stock_items.find((s) => s.stock_item_id === stockItemId)?.branches ?? [];
    for (const target of plan.stations) {
      const row = rows.find((r) => r.branch_id === target.branch_id);
      if (row === undefined || row.station_id === target.station_id) continue;
      const put = await api.putStockItemBranch(stockItemId, target.branch_id, {
        expected_version: row.version,
        station_id: target.station_id,
        low_stock_threshold: null,
      });
      if (!put.ok) return { ok: false, stockItemId, step: 2, error: put.error };
    }
  }

  onStep(3);
  if (plan.itemId !== null) {
    const patched = await api.patchMenuItem(plan.itemId, {
      stock_draws: [{ stock_item_id: stockItemId, quantity_per_sale_unit: plan.quantity }],
    });
    if (!patched.ok) return { ok: false, stockItemId, step: 3, error: patched.error };
  }
  return { ok: true, stockItemId };
}
