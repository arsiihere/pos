import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStaffApi, type Device, type PageMeta } from '../../api';
import { createLiveBus } from '../../shell/live';
import { createIdbQueueStore } from './idb-store';
import { createEnqueue, queueOf } from './enqueue';
import { createMemoryQueueStore } from './memory-store';

// 02b v1.0.11 §3.12; 02a §8 Offline (Q-3) (25b): the Enqueue interface over the real queue, as the shell builds it.

const device: Device = { token: 'DEV-TOKEN', id: 'dev-1', type: 'tablet' };
const meta: PageMeta = { tenantId: 'ten', branchId: 'br', branchName: 'Gulberg', hubNowMs: 0, utcOffsetMs: 0 };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(o: { idb?: boolean } = {}) {
  const answers: Array<Response | 'network'> = [];
  const paths: string[] = [];
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/auth/pin') return json(200, { data: { session_token: 'TOK', session_id: 'S', staff_id: 'ali', display_name: 'Ali', role_ids: [], idle_ttl_ms: 1 } });
    paths.push(input);
    void init;
    const next = answers.shift();
    if (next === undefined || next === 'network') throw new TypeError('Failed to fetch');
    return next;
  });
  const api = createStaffApi({ device, meta, fetch, onSignedOut: () => {} });
  const live = createLiveBus();
  let revoked = 0;
  const enqueue = createEnqueue({
    api,
    device,
    clock: () => ({ nowMs: () => 50_000, utcOffsetMs: 0 }),
    live,
    ...(o.idb === true ? {} : { store: createMemoryQueueStore(), onDeviceRevoked: () => (revoked += 1) }),
    presence: () => ({ ownedElsewhere: async () => new Set<string>(), announceRemoved: () => {}, onRemoved: () => () => {}, dispose: () => {} }),
  });
  return { api, live, enqueue, answers, paths, revoked: () => revoked };
}

function reconnect(live: ReturnType<typeof createLiveBus>) {
  live.connection(true);
  live.connection(false);
  live.connection(true);
}

function idbRead(db: string, store: string): Promise<Array<[IDBValidKey, unknown]>> {
  return new Promise((resolve) => {
    const open = indexedDB.open(db);
    open.onupgradeneeded = () => open.result.createObjectStore(store);
    open.onsuccess = () => {
      const tx = open.result.transaction(store);
      const keys = tx.objectStore(store).getAllKeys();
      const values = tx.objectStore(store).getAll();
      tx.oncomplete = () => {
        open.result.close();
        resolve(keys.result.map((k, i) => [k, values.result[i]]));
      };
    };
  });
}

afterEach(async () => {
  for (const name of ['pos-queue', 'pos-device'])
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(name);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
    });
});

describe('[02b §3.12] Enqueue', () => {
  it('[02b §3.12] only SubmitOrder, MarkServed, RequestBill, CleanTable are queueable; others → needs_hub', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    for (const type of ['CallWaiter', 'CompLine', 'RemoveItems', 'OpenTable']) {
      expect(await s.enqueue(type as 'SubmitOrder', {}, { label: type })).toEqual({ status: 'needs_hub' });
    }
    expect(s.paths).toEqual([]);
    for (const type of ['SubmitOrder', 'MarkServed', 'RequestBill', 'CleanTable'] as const) {
      expect((await s.enqueue(type, {}, { label: type })).status).toBe('queued');
    }
    expect(s.enqueue.pendingCount()).toBe(4);
  });

  it('[02b §3.12] nobody signed in → needs_hub, nothing stored', async () => {
    const s = setup();
    expect(await s.enqueue('RequestBill', { table_id: 'T4', seating_id: 'S1' }, { table_id: 'T4', seating_id: 'S1', label: 'Ask for bill' })).toEqual({ status: 'needs_hub' });
    expect(s.enqueue.pendingCount()).toBe(0);
  });

  it('[02a §8 Offline] Enqueue queues RequestBill / CleanTable with seating_id; TABLE_SEATING_CHANGED on replay → dropped into the log', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    const heard = vi.fn();
    s.enqueue.subscribe(heard);
    const bill = await s.enqueue('RequestBill', { table_id: 'T4', seating_id: 'S1' }, { table_id: 'T4', seating_id: 'S1', label: 'Ask for bill · T4' });
    const clean = await s.enqueue('CleanTable', { table_id: 'T5', seating_id: 'S2' }, { table_id: 'T5', seating_id: 'S2', label: 'Clean · T5' });
    expect([bill.status, clean.status]).toEqual(['queued', 'queued']);
    expect(heard).toHaveBeenCalled();
    expect([s.enqueue.pendingFor('T4'), s.enqueue.pendingFor('T5'), s.enqueue.pendingFor('T9'), s.enqueue.pendingCount()]).toEqual([1, 1, 0, 2]);
    const queue = queueOf(s.enqueue)!;
    expect(queue.queued().map((e) => [e.command_type, e.table_id, e.seating_id, (e.payload as { seating_id: string }).seating_id])).toEqual([
      ['RequestBill', 'T4', 'S1', 'S1'],
      ['CleanTable', 'T5', 'S2', 'S2'],
    ]);
    s.answers.push(json(409, { error: { code: 'TABLE_SEATING_CHANGED', message: 'x', details: { table_id: 'T4', seating_id: 'S1' } } }), json(200, { data: { command_id: 'x', event_ids: [], result: { reason: 'cleaned' } } }));
    reconnect(s.live);
    await queue.drain();
    expect(s.paths.slice(-2)).toEqual(['/commands/request-bill', '/commands/clean-table']);
    expect(queue.log().map((e) => [e.label, e.log_reason])).toEqual([['Ask for bill · T4', 'TABLE_SEATING_CHANGED']]);
    expect(s.enqueue.pendingCount()).toBe(0);
  });

  it('[02b §3.12] online: a 2xx is sent at once', async () => {
    const s = setup();
    await s.api.signIn('ali', '1', false);
    s.answers.push(json(200, { data: { command_id: 'x', event_ids: [], result: { requested: true } } }));
    expect(await s.enqueue('RequestBill', { table_id: 'T4', seating_id: 'S1' }, { table_id: 'T4', seating_id: 'S1', label: 'Ask for bill' })).toEqual({ status: 'sent', result: { requested: true } });
    expect(s.enqueue.pendingFor('T4')).toBe(0);
  });

  it('[02b §3.12] 403 DEVICE_REVOKED wipes pos-device keys but keeps every pos-queue entry', async () => {
    // the pairing page's keys (apps/hub/src/auth/pair-page.ts)
    await new Promise<void>((resolve) => {
      const open = indexedDB.open('pos-device', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('device');
      open.onsuccess = () => {
        const tx = open.result.transaction('device', 'readwrite');
        for (const [k, v] of [['token', 'DEV-TOKEN'], ['device_id', 'dev-1'], ['device_type', 'tablet'], ['other', 'kept']]) tx.objectStore('device').put(v, k);
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    const s = setup({ idb: true });
    await s.api.signIn('ali', '1', false);
    await s.enqueue('SubmitOrder', { order_id: 'O1', order_type: 'takeaway', lines: [] }, { label: 'Takeaway' });
    await s.enqueue('RequestBill', { table_id: 'T4', seating_id: 'S1' }, { table_id: 'T4', seating_id: 'S1', label: 'Ask for bill' });
    s.answers.push(json(403, { error: { code: 'DEVICE_REVOKED', message: 'x', details: {} } }));
    await queueOf(s.enqueue)!.drain();
    await vi.waitFor(async () => expect((await idbRead('pos-device', 'device')).map(([k]) => k)).toEqual(['other']));
    const kept = await createIdbQueueStore().list();
    expect(kept.map((e) => [e.command_type, e.state])).toEqual([
      ['SubmitOrder', 'queued'],
      ['RequestBill', 'queued'],
    ]);
  });
});
