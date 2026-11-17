import { describe, expect, it, vi } from 'vitest';
import { createPermissions } from '../staff/shell/permissions';
import type { PendingVoid } from './contracts';
import { createPendingVoids } from './pending';
import { pendingVoid } from './test-fakes';

// 04 §8 Pending tag store (review #232): per-order newest-read-wins (IR-6, as refetch.ts); the roster is asked again
// after a failed read; reload reads every order a view asked for.

const ok = <T,>(data: T) => ({ ok: true as const, data });
const perms = createPermissions({ 'take-order': { grant: 'allowed', scope: 'branch' } });

function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe('04 §8 pending-voids store', () => {
  it('[04 §8 IR-6] an older answer never overwrites a newer one for the same order', async () => {
    const first = deferred();
    const second = deferred();
    const answers = [first, second];
    const query = vi.fn(() => answers.shift()!.promise);
    const store = createPendingVoids({ orders: {} as never, api: { query } as never, permissions: perms });
    const a = store.load(['O1']);
    const b = store.load(['O1']);
    second.resolve(ok({ orders: [] }));
    await b;
    first.resolve(ok({ orders: [{ order_id: 'O1', voids: [pendingVoid('K1') as PendingVoid] }] }));
    await a;
    expect(store.forLine('K1')).toBeNull();
  });

  it('[04 §8] reload reads the watched orders again; without a reader permission nothing is read', async () => {
    const query = vi.fn(async () => ok({ orders: [{ order_id: 'O1', voids: [pendingVoid('K1')] }] }));
    const store = createPendingVoids({ orders: {} as never, api: { query } as never, permissions: perms });
    await store.load(['O1', 'O2']);
    await store.reload();
    expect(query.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['/queries/pending-voids?order_ids=O1,O2', '/queries/pending-voids?order_ids=O1,O2']);
    expect(store.refundOf(['O1', 'O2'])).toBe(228_000);
    const none = createPendingVoids({ orders: {} as never, api: { query } as never, permissions: createPermissions({}) });
    await none.load(['O1']);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('[04 §8] a failed roster read is asked again on the next card', async () => {
    const roster = vi.fn().mockResolvedValueOnce({ ok: false, error: { kind: 'network' } }).mockResolvedValueOnce(ok({ staff: [{ staff_id: 'S1', display_name: 'Bilal' }] }));
    const store = createPendingVoids({ orders: {} as never, api: { roster, query: vi.fn() } as never, permissions: perms });
    expect(store.nameOf('S1')).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.nameOf('S1')).toBeNull();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.nameOf('S1')).toBe('Bilal');
    expect(roster).toHaveBeenCalledTimes(2);
  });
});
