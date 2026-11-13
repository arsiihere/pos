import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { Draft, DraftStore } from '../contracts';
import { QUEUE_DB } from '../queue/idb-store';
import { createIdbDraftStore } from './idb-drafts';
import { createMemoryDraftStore, type MemoryDraftBacking } from './memory-drafts';

// 02b v1.0.11 §3.12 "Drafts in progress", §10 #35, owner Q-1 / Q-2 (25a): the draft store contract, run against the
// memory and the IndexedDB implementation (fake-indexeddb, Q-33). `open()` again = the same device after a reload.

interface Impl {
  name: string;
  fresh(): { open(): DraftStore; raw(): Promise<unknown[]> };
}

const impls: Impl[] = [
  {
    name: 'memory',
    fresh() {
      const backing: MemoryDraftBacking = new Map();
      return { open: () => createMemoryDraftStore(backing), raw: async () => [...backing.values()] };
    },
  },
  {
    name: 'IndexedDB',
    fresh() {
      const factory = new IDBFactory();
      return { open: () => createIdbDraftStore({ indexedDB: factory }), raw: () => rawDrafts(factory) };
    },
  },
];

function rawDrafts(factory: IDBFactory): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const open = factory.open(QUEUE_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const all = db.transaction('drafts').objectStore('drafts').getAll();
      all.onsuccess = () => {
        db.close();
        resolve(all.result as unknown[]);
      };
      all.onerror = () => reject(all.error);
    };
  });
}

function draft(over: Partial<Draft> = {}): Draft {
  return {
    draft_id: 'D1',
    device_id: 'dev-1',
    staff_id: 'staff-ali',
    order_type: 'dine_in',
    table_id: 'T4',
    seating_id: 'S1',
    cart: { lines: [{ item_id: 'karahi', quantity: 1 }] },
    updated_at: 1_000,
    held: false,
    ...over,
  };
}

describe.each(impls)('[02b Q-1] draft store contract — $name', (impl) => {
  it('[02b #35] drafts survive reload, keyed (device_id, staff_id)', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    await store.put(draft({ draft_id: 'D2', updated_at: 2_000, held: true }));
    await store.put(draft({ draft_id: 'D1' }));
    await store.put(draft({ draft_id: 'D3', staff_id: 'staff-sara' }));
    await store.put(draft({ draft_id: 'D4', device_id: 'dev-2' }));
    const reloaded = storage.open();
    expect(await reloaded.list('dev-1', 'staff-ali')).toEqual([draft({ draft_id: 'D1' }), draft({ draft_id: 'D2', updated_at: 2_000, held: true })]);
    expect((await reloaded.list('dev-1', 'staff-sara')).map((d) => d.draft_id)).toEqual(['D3']);
    expect((await reloaded.list('dev-2', 'staff-ali')).map((d) => d.draft_id)).toEqual(['D4']);
    expect(await reloaded.list('dev-2', 'staff-sara')).toEqual([]);
  });

  it('[02b §3.12] put with the same draft_id replaces it; remove deletes it, also after a reload', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    await store.put(draft());
    await store.put(draft({ cart: { lines: [] }, updated_at: 3_000, held: true }));
    expect(await store.list('dev-1', 'staff-ali')).toEqual([draft({ cart: { lines: [] }, updated_at: 3_000, held: true })]);
    await store.remove('D1');
    await store.remove('missing');
    expect(await storage.open().list('dev-1', 'staff-ali')).toEqual([]);
  });

  it('[02b §3.12] a changed cart object after put or list changes nothing stored', async () => {
    const storage = impl.fresh();
    const store = storage.open();
    const d = draft();
    await store.put(d);
    (d.cart as { lines: unknown[] }).lines.push({ item_id: 'x' });
    const [listed] = await store.list('dev-1', 'staff-ali');
    (listed!.cart as { lines: unknown[] }).lines.length = 0;
    expect((await storage.open().list('dev-1', 'staff-ali'))[0]!.cart).toEqual(draft().cart);
  });

  it('[02b Q-2] nothing written holds a session token', async () => {
    const storage = impl.fresh();
    await storage.open().put({ ...draft(), session_token: 'SECRET-TOKEN' } as Draft);
    const raw = await storage.raw();
    expect(raw).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain('SECRET-TOKEN');
    expect(Object.keys(raw[0] as object).sort()).toEqual(Object.keys(draft()).sort());
  });
});

describe('[02b Q-1] draft store — IndexedDB specifics', () => {
  it('[02b §3.12] the drafts live in pos-queue next to the queue (never pos-device); both stores exist whichever opens first', async () => {
    const factory = new IDBFactory();
    await createIdbDraftStore({ indexedDB: factory }).put(draft());
    expect((await factory.databases()).map((d) => d.name)).toEqual(['pos-queue']);
    const names = await new Promise<string[]>((resolve) => {
      const open = factory.open(QUEUE_DB);
      open.onsuccess = () => {
        const list = [...open.result.objectStoreNames];
        open.result.close();
        resolve(list);
      };
    });
    expect(names.sort()).toEqual(['drafts', 'entries']);
  });
});
