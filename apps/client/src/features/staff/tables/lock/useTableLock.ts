import { useEffect, useRef, useState } from 'react';
import { useShell, type Shell } from '../../shell/hooks';
import type { LockBannerState, MapTile, TableMapBody, UseTableLock } from '../contracts';
import { NOT_HELD_CODES, canSendOf, foldCatchUp, foldLockEvent, initialLock, type LockContext, type LockModel, type PendingBanner } from './lock-state';

// 02a §8 Order screen, Banners (D61, Q-3; 02a-B10): Touch once a minute while mounted, Release on unmount (both
// dropped offline, never queued), lock frames → banner. `canSend` false after the holder changed away from me,
// unless take-order-anywhere; this hook never takes the lock again (no OpenTable, no Touch after a holder change).
// The lock belongs to the seating (§3.3: it moves with TableMoved), so the hook is keyed by `seating_id`; the
// table it touches follows TableMoved, the catch-up and the `ref` prop. A `catch_up` (after a reconnect) is read
// again: frames in the gap are gone. `ref` null: the map's listener — only "a manager gave you F2" (force move to
// me), nothing sent.

export const TOUCH_EVERY_MS = 60_000;

/**
 * A Release scheduled by an unmount waits one microtask: React's StrictMode (dev) unmounts and mounts an effect
 * again at once, and that remount of the same seating cancels it, so the lock is not dropped under the screen.
 */
const pendingRelease = new Map<string, { cancelled: boolean }>();

function tilesOf(map: TableMapBody | null | undefined): MapTile[] {
  return (map?.floors ?? []).flatMap((f) => f.zones.flatMap((z) => z.tables));
}

function tableNameIn(map: TableMapBody | null | undefined, table_id: string): string | null {
  return tilesOf(map).find((t) => t.table_id === table_id)?.name ?? null;
}

export const useTableLock: UseTableLock = (ref) => {
  const shell = useShell();
  const shellRef = useRef<Shell>(shell);
  shellRef.current = shell;
  const key = ref?.seating_id ?? null;
  const [view, setView] = useState<{ key: string | null; banner: LockBannerState | null; canSend: boolean }>({ key, banner: null, canSend: true });
  const releaseRef = useRef<() => Promise<void>>(async () => {});
  const modelRef = useRef<LockModel>(initialLock(ref));

  useEffect(() => {
    const s = () => shellRef.current;
    const pending = key === null ? undefined : pendingRelease.get(key);
    if (pending !== undefined) pending.cancelled = true;
    // a StrictMode remount keeps what the first mount learnt (the table after a move); a new seating starts afresh
    if (modelRef.current.ref?.seating_id !== key || key === null) modelRef.current = initialLock(ref);
    let alive = true;
    let released = false;
    /** bumped whenever a frame changes `holding`: a Touch reply sent before it is stale */
    let gen = 0;
    let roster: Promise<Map<string, string>> | null = null;
    let tables: Promise<TableMapBody | null> | null = null;
    const ctx = (): LockContext => ({
      me: s().me?.staff_id ?? null,
      device_id: s().device.id,
      anywhere: s().permissions.allowed('take-order-anywhere'),
    });
    setView({ key, banner: null, canSend: canSendOf(modelRef.current, ctx()) });

    const nameOf = async (staff_id: string | null): Promise<string | null> => {
      if (staff_id === null) return null;
      roster ??= s()
        .api.roster()
        .then((a) => new Map(a.ok ? a.data.staff.map((p) => [p.staff_id, p.display_name] as const) : []));
      return (await roster).get(staff_id) ?? null;
    };
    const tableOf = async (table_id: string): Promise<string> => {
      const known = tableNameIn(s().live.part('tables') as TableMapBody | undefined, table_id);
      if (known !== null) return known;
      tables ??= s()
        .tables.tableMap()
        .then((a) => (a.ok ? a.data : null));
      return tableNameIn(await tables, table_id) ?? '';
    };
    const resolve = async (b: PendingBanner): Promise<LockBannerState> => {
      const table = await tableOf(b.table_id);
      switch (b.kind) {
        case 'released_by':
          return { kind: 'released_by', table, by_name: await nameOf(b.by_staff_id), reason: b.reason };
        case 'released_ttl': {
          const ttl = s().config.config()?.table_lock_ttl_ms ?? null;
          if (ttl === null) return { kind: 'released_by', table, by_name: null, reason: null };
          return { kind: 'released_ttl', table, minutes: Math.max(1, Math.round(ttl / 60_000)) };
        }
        case 'other_device':
          return { kind: 'other_device', table };
        case 'holder_changed':
          return { kind: 'holder_changed', table, holder_name: await nameOf(b.holder_staff_id), can_send: b.can_send };
        case 'force_moved_to_me':
          return { kind: 'force_moved_to_me', table };
      }
    };

    /** the one way the model changes: a newer banner is resolved and shown, canSend follows */
    const apply = (next: LockModel) => {
      const before = modelRef.current;
      if (next === before) return;
      if (next.holding !== before.holding) gen += 1;
      modelRef.current = next;
      const canSend = canSendOf(next, ctx());
      const banner = next.banner;
      if (banner === before.banner || banner === null) {
        setView((v) => ({ ...v, key, canSend }));
        return;
      }
      void resolve(banner).then((state) => {
        // a newer banner (or an unmount) wins
        if (alive && modelRef.current.banner === banner) setView({ key, banner: state, canSend: canSendOf(modelRef.current, ctx()) });
      });
    };

    const touch = async () => {
      const at = modelRef.current.ref;
      if (at === null || released || !s().online) return;
      const sent = gen;
      const answer = await s().tables.touchTableLock(at);
      // an unmount, a release or a frame that changed `holding` since the send makes this reply stale
      if (!alive || released || sent !== gen) return;
      const m = modelRef.current;
      if (answer.ok) {
        apply({ ...m, holding: true, proven: true });
        return;
      }
      if (answer.error.kind !== 'api' || !NOT_HELD_CODES.has(answer.error.code) || !m.holding) return;
      // a lock this device had proven is gone without a frame (missed in a gap): say it was released
      const lost = m.proven && answer.error.code === 'TABLE_LOCK_NOT_HELD';
      apply({ ...m, holding: false, ...(lost ? { banner: { kind: 'released_by' as const, table_id: at.table_id, by_staff_id: null, reason: null } } : {}) });
    };

    const off = s().live.subscribe((msg) => {
      if (released) return;
      if (msg.kind === 'catch_up') {
        const part = msg.state['tables'] as TableMapBody | undefined;
        if (part !== undefined) apply(foldCatchUp(modelRef.current, tilesOf(part), ctx()));
        return;
      }
      if (msg.kind !== 'event') return;
      const step = foldLockEvent(modelRef.current, msg.event, ctx());
      apply(step.model);
      if (step.verify) void touch();
    });
    const timer =
      key === null
        ? null
        : setInterval(() => {
            if (modelRef.current.holding) void touch();
          }, TOUCH_EVERY_MS);

    const release = async () => {
      const at = modelRef.current.ref;
      if (released || at === null) return;
      released = true;
      modelRef.current = { ...modelRef.current, holding: false };
      if (!s().online) return;
      await s().tables.releaseTableLock(at);
    };
    releaseRef.current = release;

    return () => {
      alive = false;
      off();
      if (timer !== null) clearInterval(timer);
      if (key === null || released) return;
      const ticket = { cancelled: false };
      pendingRelease.set(key, ticket);
      queueMicrotask(() => {
        if (pendingRelease.get(key) === ticket) pendingRelease.delete(key);
        if (!ticket.cancelled) void release();
      });
    };
    // the effect belongs to the seating only; the shell is read through shellRef (it is rebuilt every render)
  }, [key]);

  // the screen passes the seating's current table (after a move): Touch and Release go there, nothing is released
  const table_id = ref?.table_id ?? null;
  useEffect(() => {
    const m = modelRef.current;
    if (table_id === null || m.ref === null || m.ref.seating_id !== key || m.ref.table_id === table_id) return;
    modelRef.current = { ...m, ref: { table_id, seating_id: m.ref.seating_id } };
  }, [table_id, key]);

  const current = view.key === key ? view : { banner: null, canSend: true };
  return { banner: current.banner, canSend: current.canSend, release: () => releaseRef.current() };
};
