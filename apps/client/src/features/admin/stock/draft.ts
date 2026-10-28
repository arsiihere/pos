import type { Unit } from '@pos/domain';
import type { StockRow } from './badges';

// S55 (Q4): typed counts survive an idle sign-out on this tablet, for the same staff member and the same
// open day (keyed by its opened_at: business_date is only a label, S33). Each entry keeps the row's set_at
// from when it was typed, so a count saved or added since is never overwritten. Storage errors are
// ignored: the page works without it.
const PREFIX = 'stock-draft:';

export interface DraftEntry {
  item_id: string;
  on_hand: number;
  unit: Unit;
  base_set_at: number | null;
}

export interface Draft {
  saved_at: number;
  entries: DraftEntry[];
}

export function draftKey(branchId: string, openedAt: number, staffId: string): string {
  return `${PREFIX}${branchId}:${openedAt}:${staffId}`;
}

export function saveDraft(storage: Storage | null, key: string, draft: Draft): void {
  try {
    if (draft.entries.length === 0) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(draft));
  } catch {
    // blocked or full storage: the counts live in the page only
  }
}

export function removeDraft(storage: Storage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // nothing to remove
  }
}

// Reads this person's draft for the open day and deletes this branch's drafts of any other day.
export function loadDraft(storage: Storage | null, branchId: string, openedAt: number, staffId: string): Draft | null {
  if (storage === null) return null;
  try {
    const branchPrefix = `${PREFIX}${branchId}:`;
    const today = `${branchPrefix}${openedAt}:`;
    const old: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null && key.startsWith(branchPrefix) && !key.startsWith(today)) old.push(key);
    }
    for (const key of old) storage.removeItem(key);
    const raw = storage.getItem(draftKey(branchId, openedAt, staffId));
    return raw === null ? null : (JSON.parse(raw) as Draft);
  } catch {
    return null;
  }
}

// Entries come back as touched unless the item left the count, its unit changed, or someone saved or
// added to it since (listed so the person decides).
export function restoreDraft(
  draft: Draft,
  rows: readonly StockRow[],
): { touched: Map<string, number>; changed: { item_id: string; name: string; now: number }[] } {
  const touched = new Map<string, number>();
  const changed: { item_id: string; name: string; now: number }[] = [];
  for (const entry of draft.entries) {
    const row = rows.find((r) => r.meta.item_id === entry.item_id);
    if (row === undefined || !row.meta.is_stock_tracked || row.meta.stock_unit !== entry.unit) continue;
    if (row.item.set_at !== entry.base_set_at) changed.push({ item_id: entry.item_id, name: row.meta.name, now: row.item.on_hand });
    else touched.set(entry.item_id, entry.on_hand);
  }
  return { touched, changed };
}
