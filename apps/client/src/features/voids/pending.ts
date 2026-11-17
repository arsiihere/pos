import { useContext, useEffect, useSyncExternalStore } from 'react';
import type { Permission, VoidDisposition, VoidReasonCode } from '@pos/domain';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { pendingVoids } from './api';
import type { PendingVoid } from './contracts';

// 04 §8 Pending tag (handoff 04-B01, decision 9; §10 #58): the open void requests of the orders on screen, from
// `pending-voids` (§6.4). A view reads them each time it reads its orders (mount, its 02b order frames — ItemVoided,
// OrderCancelled, ItemServed … —, a reconnect, the page turning visible) and after its own VoidItems / WithdrawRequest,
// so the tag follows every read of the view. One store per staff page (keyed by its orders api), as 02b's pending
// comps. pending-voids gives no reason or disposition: the requester's card shows them only for requests this device
// sent (its memory, for the page's life).

export interface SentVoid {
  alert_id: string;
  reason: VoidReasonCode;
  disposition: VoidDisposition;
}

/** §6.4: take-order, void-item or approve-void (any grant) may read pending-voids (R5). */
const READERS: readonly Permission[] = ['take-order', 'void-item', 'approve-void'];

export interface PendingVoidsStore {
  /** read pending-voids for these orders; their entries are replaced by the answer (an order not listed has none) */
  load(order_ids: readonly string[]): Promise<void>;
  /** read again every order a view asked for (01d `alert` / `alert_closed` frames, StaffApp) */
  reload(): Promise<void>;
  /** the page's latest shell (its api and the signed-in person's permissions) */
  use(shell: ShellPart): void;
  /** the open void request that locks this line (its named line or one it touches), or null */
  forLine(order_item_id: string): PendingVoid | null;
  /** Σ refund_minor of the open requests of these orders (what the screen's total leaves out) */
  refundOf(order_ids: readonly string[]): number;
  forget(alert_id: string): void;
  /** a staff name for "Asked by …" (the staff roster, read once), or null */
  nameOf(staff_id: string): string | null;
  remember(sent: SentVoid): void;
  sent(alert_id: string): SentVoid | null;
  version(): number;
  subscribe(listener: () => void): () => void;
}

type ShellPart = Pick<Shell, 'orders' | 'api' | 'permissions'>;

export function createPendingVoids(first: ShellPart): PendingVoidsStore {
  let shell = first;
  const byOrder = new Map<string, PendingVoid[]>();
  /** IR-6 (as refetch.ts): per order, only the newest read's answer is applied */
  const seq = new Map<string, number>();
  const watched = new Set<string>();
  const sent = new Map<string, SentVoid>();
  let names: Map<string, string> | null = null;
  let rosterAsked = false;
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const l of [...listeners]) l();
  };
  const may = () =>
    READERS.some((p) => {
      const g = shell.permissions.resolution(p).grant;
      return g === 'allowed' || g === 'requires_approval';
    });
  const all = () => [...byOrder.values()].flat();
  const load = async (order_ids: readonly string[]) => {
    const ids = [...new Set(order_ids)];
    if (ids.length === 0 || !may()) return;
    for (const id of ids) watched.add(id);
    // §6.4: 1–40 ids per read; all reads start now, each order keeps only the answer of its newest read
    await Promise.all(
      Array.from({ length: Math.ceil(ids.length / 40) }, async (_, k) => {
        const chunk = ids.slice(k * 40, k * 40 + 40);
        const mine = new Map(chunk.map((id) => [id, (seq.get(id) ?? 0) + 1]));
        for (const [id, n] of mine) seq.set(id, n);
        const answer = await pendingVoids(shell.api, { order_ids: chunk });
        if (!answer.ok) return;
        const listed = new Map(answer.data.orders.map((o) => [o.order_id, o.voids]));
        let hit = false;
        for (const [id, n] of mine) {
          if (seq.get(id) !== n) continue; // a newer read of this order is out
          hit = true;
          const voids = listed.get(id);
          if (voids === undefined) byOrder.delete(id);
          else byOrder.set(id, voids);
        }
        if (hit) changed();
      }),
    );
  };
  return {
    load,
    reload: () => load([...watched]),
    use(next) {
      shell = next;
    },
    forLine: (id) => all().find((v) => v.order_item_id === id || v.touched_ids.includes(id)) ?? null,
    refundOf: (order_ids) => order_ids.reduce((sum, id) => sum + (byOrder.get(id) ?? []).reduce((s, v) => s + v.refund_minor, 0), 0),
    forget(alert_id) {
      let hit = false;
      for (const [id, voids] of byOrder) {
        const left = voids.filter((v) => v.alert_id !== alert_id);
        if (left.length !== voids.length) {
          byOrder.set(id, left);
          hit = true;
        }
      }
      if (hit) changed();
    },
    nameOf(staff_id) {
      if (names === null && !rosterAsked) {
        rosterAsked = true;
        void shell.api.roster().then((r) => {
          if (!r.ok) {
            rosterAsked = false; // asked again on the next card
            return;
          }
          names = new Map(r.data.staff.map((p) => [p.staff_id, p.display_name]));
          changed();
        });
      }
      return names?.get(staff_id) ?? null;
    },
    remember(s) {
      sent.set(s.alert_id, s);
    },
    sent: (alert_id) => sent.get(alert_id) ?? null,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

const perPage = new WeakMap<object, PendingVoidsStore>();

export function pendingVoidsOf(shell: ShellPart): PendingVoidsStore {
  let store = perPage.get(shell.orders);
  if (store === undefined) {
    store = createPendingVoids(shell);
    perPage.set(shell.orders, store);
  }
  store.use(shell);
  return store;
}

/** A VoidItems pending answer of this device (one per entry). */
export function rememberVoid(shell: ShellPart, s: SentVoid): void {
  pendingVoidsOf(shell).remember(s);
}

/** The view's read: pending-voids for its orders, again whenever `readKey` changes (each answer of its own read). */
export function usePendingVoidsRead(order_ids: readonly string[], readKey: unknown): void {
  const shell = useContext(ShellContext);
  const key = order_ids.join(',');
  useEffect(() => {
    if (shell === null || key === '') return;
    void pendingVoidsOf(shell).load(key.split(','));
    // the shell object changes on every render (StaffApp); its orders api does not
  }, [key, readKey, shell?.orders]);
}

/** The open void request locking a line, live; null outside a staff shell (component tests of other screens). */
export function useLinePendingVoid(order_item_id: string): PendingVoid | null {
  const shell = useContext(ShellContext);
  const store = shell === null ? null : pendingVoidsOf(shell);
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.version ?? zero);
  return store?.forLine(order_item_id) ?? null;
}

/** The screen's pending refund (Σ refund_minor of its orders' open requests), live. */
export function usePendingRefund(order_ids: readonly string[]): number {
  const shell = useContext(ShellContext);
  const store = shell === null ? null : pendingVoidsOf(shell);
  useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.version ?? zero);
  return store?.refundOf(order_ids) ?? 0;
}

const noSubscribe = () => () => {};
const zero = () => 0;
