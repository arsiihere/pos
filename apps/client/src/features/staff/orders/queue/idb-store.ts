import type { QueueEntry, QueueStore } from '../contracts';

// 02b v1.0.11 §3.12, owner Q-1 / Q-2 (25a): the queue store of every hub-served client (kiosk, phone, browser
// tablet) in IndexedDB database `pos-queue` (never `pos-device`, the pairing keys). The SQLite store of 01d 9b (T1)
// implements the same `QueueStore`. A put resolves only when its transaction has completed, so a command is stored
// before its first send (#35). Only the QueueEntry fields are written: never a session token (Q-2).

export const QUEUE_DB = 'pos-queue';
const VERSION = 1;
export const ENTRIES = 'entries';
export const DRAFTS = 'drafts';
export const DRAFTS_BY_OWNER = 'by_device_staff';

export interface IdbOptions {
  /** the IndexedDB factory; `undefined` = none (site data blocked) → every call rejects. Default: `globalThis.indexedDB`. */
  indexedDB?: IDBFactory | undefined;
}

/** Where the factory comes from; read on every call, never at creation (the global getter can throw, review #156). */
export type FactorySource = () => IDBFactory | undefined;

export function factoryOf(o: IdbOptions): FactorySource {
  if ('indexedDB' in o) {
    const given = o.indexedDB;
    return () => given;
  }
  // blocked site data / private mode: reading the global can throw; it does so inside openQueueDb's try
  return () => (globalThis as { indexedDB?: IDBFactory }).indexedDB;
}

/** A DOMException (SecurityError, …) is not always an Error in every engine: keep its message. */
function asError(e: unknown, fallback: string): Error {
  if (e instanceof Error) return e;
  const message = typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : '';
  return new Error(message === '' ? fallback : message);
}

/** Opens `pos-queue`, creating both object stores (queue entries and drafts) whichever module opens it first. */
export function openQueueDb(source: FactorySource): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      const factory = source();
      if (factory === undefined) throw new Error('IndexedDB is not available');
      request = factory.open(QUEUE_DB, VERSION);
    } catch (e) {
      reject(asError(e, 'IndexedDB open failed'));
      return;
    }
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'entry_id' });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: 'draft_id' }).createIndex(DRAFTS_BY_OWNER, ['device_id', 'staff_id']);
    };
    request.onsuccess = () => {
      // an open that was blocked (and so already rejected) and succeeds later must not leak its connection
      if (settled) request.result.close();
      else {
        settled = true;
        resolve(request.result);
      }
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error('IndexedDB open blocked'));
    };
  });
}

/** §3.12, #35: a write is committed to disk before it resolves (a kiosk power cut must not lose a queued order). */
export const WRITE_OPTIONS: IDBTransactionOptions = { durability: 'strict' };

/** One transaction; resolves with `read()`'s value after the transaction completed (durable for a write). */
export async function inTransaction<T>(factory: FactorySource, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest | void, read?: (r: IDBRequest) => T): Promise<T> {
  const db = await openQueueDb(factory);
  return new Promise<T>((resolve, reject) => {
    let request: IDBRequest | void;
    let tx: IDBTransaction;
    try {
      tx = mode === 'readwrite' ? db.transaction(store, mode, WRITE_OPTIONS) : db.transaction(store, mode);
      request = run(tx.objectStore(store));
    } catch (e) {
      db.close();
      reject(asError(e, 'IndexedDB transaction failed'));
      return;
    }
    tx.oncomplete = () => {
      db.close();
      resolve(read !== undefined && request ? read(request) : (undefined as T));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
  });
}

/** Exactly the QueueEntry fields (Q-2: whatever else a caller hands in, a token included, is never written). */
export function entryRecord(e: QueueEntry): QueueEntry {
  const out: QueueEntry = {
    entry_id: e.entry_id,
    command_type: e.command_type,
    payload: structuredClone(e.payload),
    queued_at: e.queued_at,
    staff_id: e.staff_id,
    device_id: e.device_id,
    label: e.label,
    state: e.state,
  };
  if (e.table_id !== undefined) out.table_id = e.table_id;
  if (e.seating_id !== undefined) out.seating_id = e.seating_id;
  if (e.log_reason !== undefined) out.log_reason = e.log_reason;
  if (e.log_details !== undefined) {
    const kept = logDetailsRecord(e.log_details);
    if (kept !== undefined) out.log_details = kept;
  }
  return out;
}

/**
 * Review #165: of the hub's error `details` only what the queue log row reads is kept — the refused menu item or deal
 * id. Everything else (e.g. `locked_by_name` / `locked_by_staff_id` of TABLE_ALREADY_LOCKED) is never stored.
 */
export function logDetailsRecord(details: Record<string, unknown>): QueueEntry['log_details'] {
  const out: { item_id?: string; deal_id?: string } = {};
  if (typeof details['item_id'] === 'string') out.item_id = details['item_id'];
  if (typeof details['deal_id'] === 'string') out.deal_id = details['deal_id'];
  return out.item_id === undefined && out.deal_id === undefined ? undefined : out;
}

/** §3.12 replay order: queued_at, then entry_id. */
export function byQueuedAt(a: QueueEntry, b: QueueEntry): number {
  if (a.queued_at !== b.queued_at) return a.queued_at - b.queued_at;
  return a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0;
}

export function createIdbQueueStore(o: IdbOptions = {}): QueueStore {
  const factory = factoryOf(o);
  return {
    put: (entry) => inTransaction<void>(factory, ENTRIES, 'readwrite', (s) => s.put(entryRecord(entry))),
    async list() {
      const all = await inTransaction(factory, ENTRIES, 'readonly', (s) => s.getAll(), (r) => r.result as QueueEntry[]);
      return all.map(entryRecord).sort(byQueuedAt);
    },
    remove: (entry_id) => inTransaction<void>(factory, ENTRIES, 'readwrite', (s) => s.delete(entry_id)),
  };
}
