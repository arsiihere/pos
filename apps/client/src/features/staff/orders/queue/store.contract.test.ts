import { IDBDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry, QueueStore } from '../contracts';
import { createIdbDraftStore } from '../drafts/idb-drafts';
import { createIdbQueueStore, QUEUE_DB } from './idb-store';
import { createMemoryQueueStore, type MemoryQueueBacking } from './memory-store';
import draftsIdbSource from '../drafts/idb-drafts.ts?raw';
import draftsMemorySource from '../drafts/memory-drafts.ts?raw';
import idbSource from './idb-store.ts?raw';
import memorySource from './memory-store.ts?raw';

// 02b v1.0.11 §3.12, §10 #35, owner Q-1 / Q-2 (25a): the queue store contract, run against the memory and the
// IndexedDB implementation (fake-indexeddb, Q-33). `reopen()` = the same device after a reload: a new store
// instance over the same storage.

interface Impl {
  name: string;
  /** a fresh, empty storage; `open()` gives a store instance over it (call again = after a reload) */
  fresh(): { open(): QueueStore; raw(): Promise<unknown[]> };
}

const impls: Impl[] = [
  {
    name: 'memory',
    fresh() {
      const backing: MemoryQueueBacking = new Map();
      return { open: () => createMemoryQueueStore(backing), raw: async () => [...backing.values()] };
    },
  },
  {
    name: 'IndexedDB',
    fresh() {
      const factory = new IDBFactory();
      return {
        open: () => createIdbQueueStore({ indexedDB: factory }),
        raw: () => rawIdb(factory),
      };
    },
  },
];

function rawIdb(factory: IDBFactory): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = factory.open(QUEUE_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const names = [...db.objectStoreNames];
      if (names.length === 0) {
        db.close();
        resolve([]);
        return;
      }
      const tx = db.transaction(names);
      const out: unknown[] = [];
      for (const n of names) {
        const all = tx.objectStore(n).getAll();
        all.onsuccess = () => out.push(...(all.result as unknown[]));
      }
      tx.oncomplete = () => {
        db.close();
        resolve(out);
      };
      tx.onerror = () => reject(tx.error);
    };
  });
}

function entry(over: Partial<QueueEntry> = {}): QueueEntry {
  return {
    entry_id: '01J0000000000000000000000A',
    command_type: 'SubmitOrder',
    payload: { order_id: '01J00000000000000000000ORD', order_type: 'takeaway', lines: [{ order_item_id: '01J0000000000000000000LINE', item_id: 'naan' }] },
    queued_at: 1_000,
    staff_id: 'staff-ali',
    device_id: 'dev-1',
    label: 'Takeaway · 1 item',
    state: 'queued',
    ...over,
  };
}

describe.each(impls)('[02b Q-1] queue store contract — $name', (impl) => {
  it('[02b #35] an entry is stored before the first send (put resolves before any fetch)', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    const seenAtFetch: string[][] = [];
    // the 25b pattern: await put, then send; at the moment of the send a reloaded page must already find it
    const fakeFetch = async () => {
      seenAtFetch.push((await storage.open().list()).map((e) => e.entry_id));
      return null;
    };
    await store.put(entry());
    await fakeFetch();
    expect(seenAtFetch).toEqual([['01J0000000000000000000000A']]);
  });

  it('[02b Q-1] list() in queued_at order, then entry id; survives a new store instance (reload)', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    await store.put(entry({ entry_id: 'C', queued_at: 2_000 }));
    await store.put(entry({ entry_id: 'B', queued_at: 1_000 }));
    await store.put(entry({ entry_id: 'A', queued_at: 2_000 }));
    await store.put(entry({ entry_id: 'D', queued_at: 500 }));
    expect((await store.list()).map((e) => e.entry_id)).toEqual(['D', 'B', 'A', 'C']);
    const reloaded = storage.open();
    expect((await reloaded.list()).map((e) => e.entry_id)).toEqual(['D', 'B', 'A', 'C']);
    expect((await reloaded.list())[1]).toEqual(entry({ entry_id: 'B', queued_at: 1_000 }));
  });

  it('[02b §3.12] put with the same entry_id replaces it (queued → log); remove deletes it, also after a reload', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    await store.put(entry({ entry_id: 'A' }));
    await store.put(entry({ entry_id: 'B', queued_at: 2_000 }));
    await store.put(entry({ entry_id: 'A', state: 'log', log_reason: 'reloaded' }));
    expect(await store.list()).toEqual([entry({ entry_id: 'A', state: 'log', log_reason: 'reloaded' }), entry({ entry_id: 'B', queued_at: 2_000 })]);
    await store.remove('A');
    await store.remove('missing');
    expect((await storage.open().list()).map((e) => e.entry_id)).toEqual(['B']);
  });

  it('[02b #35] frozen cart: changing the payload object after put or after list changes nothing stored', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    const e = entry();
    await store.put(e);
    (e.payload as { lines: unknown[] }).lines.push({ order_item_id: 'X' });
    const [listed] = await store.list();
    (listed!.payload as { lines: unknown[] }).lines.length = 0;
    expect((await storage.open().list())[0]!.payload).toEqual(entry().payload);
  });

  it('[02b Q-2] nothing written holds a session token', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    // a caller that wrongly hands one in: the store keeps only the QueueEntry fields
    await store.put({ ...entry(), session_token: 'SECRET-TOKEN', sessionToken: 'SECRET-TOKEN' } as QueueEntry);
    const raw = await storage.raw();
    expect(raw).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain('SECRET-TOKEN');
    expect(Object.keys(raw[0] as object).sort()).toEqual(Object.keys(entry()).sort());
  });
});

describe('[02b Q-1] queue store — IndexedDB specifics', () => {
  afterEach(() => vi.restoreAllMocks());

  /** every transaction the stores open: its mode, options and whether it had completed */
  function watchTransactions() {
    const seen: Array<{ mode: string | undefined; options: unknown; completed: boolean }> = [];
    const original = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, ...args: Parameters<IDBDatabase['transaction']>) {
      const tx = original.apply(this, args);
      const row = { mode: args[1], options: args[2], completed: false };
      seen.push(row);
      tx.addEventListener('complete', () => (row.completed = true));
      return tx;
    });
    return seen;
  }

  it('[02b #35] put resolves only after its transaction completed', async () => {
    const seen = watchTransactions();
    await createIdbQueueStore({ indexedDB: new IDBFactory() }).put(entry());
    const writes = seen.filter((t) => t.mode === 'readwrite');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.completed).toBe(true);
  });

  it('[02b §3.12] every write (queue and drafts) asks for durability strict (a power cut must not lose a queued order)', async () => {
    const seen = watchTransactions();
    const factory = new IDBFactory();
    const queue = createIdbQueueStore({ indexedDB: factory });
    await queue.put(entry());
    await queue.remove('01J0000000000000000000000A');
    await createIdbDraftStore({ indexedDB: factory }).put({ draft_id: 'D', device_id: 'd', staff_id: 's', order_type: 'takeaway', cart: {}, updated_at: 1, held: false });
    await queue.list();
    const writes = seen.filter((t) => t.mode === 'readwrite');
    expect(writes).toHaveLength(3);
    for (const w of writes) expect(w.options).toEqual({ durability: 'strict' });
  });

  it('[02b §3.12] a globalThis.indexedDB getter that throws (blocked site data): creating the store does not throw, each call rejects', async () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    try {
      const store = createIdbQueueStore();
      const drafts = createIdbDraftStore();
      await expect(store.put(entry())).rejects.toThrow('blocked');
      await expect(store.list()).rejects.toThrow('blocked');
      await expect(store.remove('x')).rejects.toThrow('blocked');
      await expect(drafts.list('d', 's')).rejects.toThrow('blocked');
    } finally {
      if (before === undefined) delete (globalThis as { indexedDB?: unknown }).indexedDB;
      else Object.defineProperty(globalThis, 'indexedDB', before);
    }
  });

  it('[02b §3.12] an open that was blocked and later succeeds closes its connection', async () => {
    const closed: boolean[] = [];
    const request = { result: { close: () => closed.push(true) } } as unknown as IDBOpenDBRequest & { onblocked: () => void; onsuccess: () => void };
    const factory = { open: () => request } as unknown as IDBFactory;
    const put = createIdbQueueStore({ indexedDB: factory }).put(entry());
    request.onblocked();
    await expect(put).rejects.toThrow('blocked');
    request.onsuccess();
    expect(closed).toEqual([true]);
  });

  it('[02b §3.12] uses the database pos-queue, never pos-device', async () => {
    const factory = new IDBFactory();
    await createIdbQueueStore({ indexedDB: factory }).put(entry());
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).toEqual(['pos-queue']);
  });

  it('[02b §3.12] no IndexedDB (blocked site data): put and list reject — the caller decides', async () => {
    const store = createIdbQueueStore({ indexedDB: undefined });
    await expect(store.put(entry())).rejects.toThrow();
    await expect(store.list()).rejects.toThrow();
  });
});

describe('[02b Q-1] no Capacitor', () => {
  it('[02b Q-1] the stores import no Capacitor module', () => {
    const sources = { 'idb-store.ts': idbSource, 'memory-store.ts': memorySource, 'idb-drafts.ts': draftsIdbSource, 'memory-drafts.ts': draftsMemorySource };
    for (const [file, src] of Object.entries(sources)) {
      expect(src.length, file).toBeGreaterThan(0);
      expect(src, file).not.toMatch(/capacitor/i);
    }
  });
});
