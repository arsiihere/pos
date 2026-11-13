import type { QueueEntry, QueueStore } from '../contracts';
import { byQueuedAt, entryRecord } from './idb-store';

// 02b v1.0.11 §3.12, owner Q-1 (25a): the queue store in memory — the same contract as the IndexedDB store, for
// tests and for a device whose IndexedDB is not available. `backing` stands for the storage (a test passes the same
// map to a second instance to model a reload). Entries are copied in and out (the frozen cart, #35).

export type MemoryQueueBacking = Map<string, QueueEntry>;

export function createMemoryQueueStore(backing: MemoryQueueBacking = new Map()): QueueStore {
  return {
    async put(entry) {
      backing.set(entry.entry_id, entryRecord(entry));
    },
    async list() {
      return [...backing.values()].map(entryRecord).sort(byQueuedAt);
    },
    async remove(entry_id) {
      backing.delete(entry_id);
    },
  };
}
