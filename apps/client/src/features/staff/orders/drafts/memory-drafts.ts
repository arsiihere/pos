import type { Draft, DraftStore } from '../contracts';
import { byUpdatedAt, draftRecord } from './idb-drafts';

// 02b v1.0.11 §3.12, owner Q-1 (25a): drafts in memory — the IndexedDB draft store's contract, for tests and for a
// device without IndexedDB. `backing` stands for the storage (the same map in a second instance = a reload).

export type MemoryDraftBacking = Map<string, Draft>;

export function createMemoryDraftStore(backing: MemoryDraftBacking = new Map()): DraftStore {
  return {
    async put(draft) {
      backing.set(draft.draft_id, draftRecord(draft));
    },
    async list(device_id, staff_id) {
      return [...backing.values()]
        .filter((d) => d.device_id === device_id && d.staff_id === staff_id)
        .map(draftRecord)
        .sort(byUpdatedAt);
    },
    async remove(draft_id) {
      backing.delete(draft_id);
    },
  };
}
