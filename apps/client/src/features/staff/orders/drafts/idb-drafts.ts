import type { Draft, DraftStore } from '../contracts';
import { DRAFTS, DRAFTS_BY_OWNER, factoryOf, inTransaction, type IdbOptions } from '../queue/idb-store';

// 02b v1.0.11 §3.12 "Drafts in progress", owner Q-1 / Q-2 (25a): drafts per (device, staff) in the `drafts` object
// store of IndexedDB `pos-queue`; they survive restarts. Only the Draft fields are written (never a session token).

/** Exactly the Draft fields; the cart is copied (a later change to the caller's object changes nothing stored). */
export function draftRecord(d: Draft): Draft {
  const out: Draft = {
    draft_id: d.draft_id,
    device_id: d.device_id,
    staff_id: d.staff_id,
    order_type: d.order_type,
    cart: structuredClone(d.cart),
    updated_at: d.updated_at,
    held: d.held,
  };
  if (d.table_id !== undefined) out.table_id = d.table_id;
  if (d.seating_id !== undefined) out.seating_id = d.seating_id;
  return out;
}

/** updated_at, then draft_id. */
export function byUpdatedAt(a: Draft, b: Draft): number {
  if (a.updated_at !== b.updated_at) return a.updated_at - b.updated_at;
  return a.draft_id < b.draft_id ? -1 : a.draft_id > b.draft_id ? 1 : 0;
}

export function createIdbDraftStore(o: IdbOptions = {}): DraftStore {
  const factory = factoryOf(o);
  return {
    put: (draft) => inTransaction<void>(factory, DRAFTS, 'readwrite', (s) => s.put(draftRecord(draft))),
    async list(device_id, staff_id) {
      const all = await inTransaction(factory, DRAFTS, 'readonly', (s) => s.index(DRAFTS_BY_OWNER).getAll([device_id, staff_id]), (r) => r.result as Draft[]);
      return all.map(draftRecord).sort(byUpdatedAt);
    },
    remove: (draft_id) => inTransaction<void>(factory, DRAFTS, 'readwrite', (s) => s.delete(draft_id)),
  };
}
