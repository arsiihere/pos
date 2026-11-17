import { TableHolderChangedPayload, TableLockReleasedPayload, TableLockedPayload, TableMovedPayload, TableCleanedPayload, TablesMergedPayload } from '@pos/events';
import type { SeatingRef } from '../contracts';

// 02a §8 Order screen, Banners (02a-B10; §3.3, §6.19): the lock state of one order screen, folded from the table
// frames the staff socket receives. Frames carry the payload only (no envelope device_id), so "this device holds
// the lock" is the hook's own knowledge: true when the screen mounts (it opens after OpenTable), false after a
// release / replace / holder change frame or a Touch that answers the lock is not ours, true again only after a
// Touch succeeds. A banner shows only when this device held the lock before the frame. Ids only here; the hook puts
// the names in.

export type PendingBanner =
  | { kind: 'released_by'; table_id: string; by_staff_id: string | null; reason: string | null }
  | { kind: 'released_ttl'; table_id: string }
  | { kind: 'other_device'; table_id: string }
  | { kind: 'holder_changed'; table_id: string; holder_staff_id: string; can_send: boolean }
  | { kind: 'force_moved_to_me'; table_id: string };

export interface LockModel {
  /** null: the map's listener (no order screen) — force moves to me only */
  ref: SeatingRef | null;
  holding: boolean;
  /** the holder changed away from me while this screen is open (Send by take-order-anywhere only, §8 Banners) */
  changedAway: boolean;
  /** a Touch succeeded or a catch-up showed the lock as mine: a later "not held" is a release, not a wrong guess */
  proven: boolean;
  banner: PendingBanner | null;
}

export interface LockContext {
  me: string | null;
  device_id: string;
  /** effective `take-order-anywhere` (R5) */
  anywhere: boolean;
}

export interface LockStep {
  model: LockModel;
  /** a TableLocked for me on this seating while not holding: one Touch tells whether it is this device's */
  verify: boolean;
}

export function initialLock(ref: SeatingRef | null): LockModel {
  return { ref, holding: ref !== null, changedAway: false, proven: false, banner: null };
}

export function canSendOf(model: LockModel, ctx: LockContext): boolean {
  return !model.changedAway || ctx.anywhere;
}

/**
 * The holder moved away from me on this seating (§8 Banners): Send off unless take-order-anywhere, whether or not
 * this device holds the lock right now. The banner shows when this screen held the lock or already shows a lock
 * banner (it explains why Send is gone); a screen that never held it stays quiet.
 */
function changedAwayTo(model: LockModel, table_id: string, holder_staff_id: string, ctx: LockContext): LockModel {
  const shows = model.holding || (model.banner !== null && model.banner.kind !== 'holder_changed');
  const banner: PendingBanner | null = shows ? { kind: 'holder_changed', table_id, holder_staff_id, can_send: ctx.anywhere } : model.banner;
  return { ...model, holding: false, changedAway: true, banner };
}

/** The `catch_up` tables part (02a §6.17 body), read again after a reconnect: frames in the gap are gone. */
export interface CatchUpTile {
  table_id: string;
  seating_id: string | null;
  primary_table_id: string | null;
  holder: { staff_id: string } | null;
  lock: { staff_id: string; mine: boolean } | null;
}

/**
 * 02a §8 Banners after a gap: the catch-up's tile of this seating is the truth. Holder elsewhere → the holder
 * change; the lock no longer mine while held → "Your table was released"; the seating gone (cleaned, absorbed) →
 * not held, no banner; the lock mine → held (proven).
 */
export function foldCatchUp(model: LockModel, tiles: readonly CatchUpTile[], ctx: LockContext): LockModel {
  const ref = model.ref;
  if (ref === null) return model;
  const of = tiles.filter((t) => t.seating_id === ref.seating_id);
  if (of.length === 0) return model.holding ? { ...model, holding: false } : model;
  const tile = of.find((t) => t.primary_table_id === null || t.table_id === t.primary_table_id) ?? of[0]!;
  const table_id = tile.primary_table_id ?? tile.table_id;
  const at: LockModel = table_id === ref.table_id ? model : { ...model, ref: { table_id, seating_id: ref.seating_id } };
  const holder = tile.holder?.staff_id ?? null;
  if (holder !== null && holder !== ctx.me) return at.changedAway ? at : changedAwayTo(at, table_id, holder, ctx);
  const back: LockModel = holder === ctx.me && at.changedAway ? { ...at, changedAway: false } : at;
  const mineLock = tile.lock?.mine === true;
  if (back.holding && !mineLock) return { ...back, holding: false, banner: { kind: 'released_by', table_id, by_staff_id: null, reason: null } };
  if (mineLock && !back.changedAway && (!back.holding || !back.proven)) return { ...back, holding: true, proven: true };
  return back;
}

export function foldLockEvent(model: LockModel, event: { event_type: string; payload: unknown }, ctx: LockContext): LockStep {
  const same = { model, verify: false };
  const ref = model.ref;
  const mine = (seating_id: string) => ref !== null && seating_id === ref.seating_id;
  switch (event.event_type) {
    case 'TableHolderChanged': {
      const p = TableHolderChangedPayload.safeParse(event.payload);
      if (!p.success || ctx.me === null) return same;
      const e = p.data;
      // the new holder is told of a force move (on the map, or on that table's screen)
      if (e.to_staff_id === ctx.me && e.reason === 'force_move' && (ref === null || mine(e.seating_id)))
        return { model: { ...model, changedAway: false, banner: { kind: 'force_moved_to_me', table_id: e.table_id } }, verify: false };
      if (!mine(e.seating_id)) return same;
      if (e.to_staff_id === ctx.me) return { model: { ...model, changedAway: false }, verify: false };
      if (e.from_staff_id !== ctx.me) return same;
      return { model: changedAwayTo(model, e.table_id, e.to_staff_id, ctx), verify: false };
    }
    case 'TableLockReleased': {
      const p = TableLockReleasedPayload.safeParse(event.payload);
      if (!p.success || !mine(p.data.seating_id) || !model.holding || p.data.staff_id !== ctx.me) return same;
      const e = p.data;
      const next = { ...model, holding: false };
      if (e.reason === 'force') return { model: { ...next, banner: { kind: 'released_by', table_id: e.table_id, by_staff_id: e.by_staff_id ?? null, reason: e.note ?? null } }, verify: false };
      if (e.reason === 'lock_ttl') return { model: { ...next, banner: { kind: 'released_ttl', table_id: e.table_id } }, verify: false };
      // released (by this device), session_expired (signed out anyway), holder_changed (its banner came with
      // TableHolderChanged, appended first in the same transaction): no banner
      return { model: next, verify: false };
    }
    case 'TableLocked': {
      const p = TableLockedPayload.safeParse(event.payload);
      if (!p.success || !mine(p.data.seating_id)) return same;
      const e = p.data;
      if (e.replaced_device_id !== undefined && e.replaced_device_id === ctx.device_id) {
        if (!model.holding) return same;
        return { model: { ...model, holding: false, banner: { kind: 'other_device', table_id: e.table_id } }, verify: false };
      }
      if (e.staff_id !== ctx.me) return model.holding ? { model: { ...model, holding: false }, verify: false } : same;
      // me, no device named: this device (Send re-acquired the free lock) or my other one; a holder-changed screen
      // never takes the lock back (§8 Banners)
      if (model.holding || model.changedAway) return same;
      return { model, verify: true };
    }
    case 'TableMoved': {
      const p = TableMovedPayload.safeParse(event.payload);
      if (!p.success || ref === null || !mine(p.data.seating_id) || ref.table_id !== p.data.from_table_id) return same;
      return { model: { ...model, ref: { table_id: p.data.to_table_id, seating_id: ref.seating_id } }, verify: false };
    }
    case 'TableCleaned': {
      const p = TableCleanedPayload.safeParse(event.payload);
      if (!p.success || !mine(p.data.seating_id) || !model.holding) return same;
      return { model: { ...model, holding: false }, verify: false };
    }
    case 'TablesMerged': {
      const p = TablesMergedPayload.safeParse(event.payload);
      if (!p.success || p.data.absorbed_seating_id === null || !mine(p.data.absorbed_seating_id) || !model.holding) return same;
      return { model: { ...model, holding: false }, verify: false };
    }
    default:
      return same;
  }
}

/** A Touch answer that says the lock is not this device's (or the seating is gone). */
export const NOT_HELD_CODES: ReadonlySet<string> = new Set(['TABLE_LOCK_NOT_HELD', 'TABLE_SEATING_CHANGED', 'TABLE_NOT_OPEN']);
