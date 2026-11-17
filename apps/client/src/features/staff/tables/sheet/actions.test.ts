import { describe, expect, it } from 'vitest';
import type { Resolution } from '../../api';
import { createPermissions } from '../../shell/permissions';
import type { MapTile } from '../contracts';
import { sheetModel, type SheetAction } from './actions';

// 02a §8 Rules (R5), §3.15: every table-sheet button only with its grant `allowed`; `requires_approval` = not shown.
// Variants = handoff frames TableSheet (holder), TableSheetAssignee, TableSheetOther, TableSheetWaiter,
// TableSheetManager, TableSheetClean, TableSheetOffline.

const ME = 'ST-ALI';
const allow: Resolution = { grant: 'allowed', scope: 'branch' };
const ask: Resolution = { grant: 'requires_approval', approver_role_ids: ['R1'], scope: 'branch' };
const perms = (...names: string[]) => createPermissions(Object.fromEntries(names.map((n) => [n, allow])));

function tile(over: Partial<MapTile> = {}): MapTile {
  return {
    table_id: 'TB7',
    name: 'F7',
    seats: 4,
    archived: false,
    state: 'ORDERED',
    seating_id: 'S7',
    party_size: 3,
    primary_table_id: 'TB7',
    joined_table_names: ['F7'],
    holder: { staff_id: ME, name: 'Ali' },
    assignee: null,
    lock: null,
    opened_at: 0,
    bill_requested_at: null,
    live_order_count: 2,
    ...over,
  };
}

const ids = (list: SheetAction[]) => list.map((a) => a.id);
const BILAL = { staff_id: 'ST-BIL', name: 'Bilal' };

describe('[02a §8 Rules] table sheet actions', () => {
  it('[02a §8 Rules] actions matrix: each button only with its grant allowed; requires_approval = not shown (§3.15)', () => {
    // holder (TableSheet): Add items, Ask for bill · Call waiter · Hand over · More (Move, Join, Split)
    const holder = sheetModel(tile(), ME, perms('take-order'), true);
    expect(holder.title).toEqual({ kind: 'mine' });
    expect(holder.primary?.id).toBe('add_items');
    expect(ids(holder.acts)).toEqual(['bill', 'call', 'hand', 'more']);
    expect(ids(holder.more)).toEqual(['move', 'join', 'split']);
    // my lock on this device adds "Release my lock"; a seated table with no order shows Take order and Clean in More
    const seated = sheetModel(tile({ state: 'SEATED', live_order_count: 0, lock: { staff_id: ME, name: 'Ali', mine: true } }), ME, perms('take-order', 'clean-table'), true);
    expect(seated.primary?.id).toBe('take_order');
    expect(seated.acts.find((a) => a.id === 'bill')?.off).toBe('tables.err.TABLE_NO_ORDERS');
    expect(ids(seated.more)).toEqual(['move', 'join', 'split', 'release_mine', 'clean']);
    // a joined seating cannot move: "Split first"
    const joined = sheetModel(tile({ joined_table_names: ['F4', 'F5'] }), ME, perms('take-order'), true);
    expect(joined.more.find((a) => a.id === 'move')?.off).toBe('sheet.split_first');

    // assignee, someone else holds (TableSheetAssignee): Take over from Bilal; Ask for bill · Call waiter · Clean
    const assignee = sheetModel(tile({ holder: BILAL, assignee: { staff_id: ME, name: 'Ali' }, lock: { ...BILAL, mine: false } }), ME, perms('take-order', 'clean-table'), true);
    expect(assignee.title).toEqual({ kind: 'theirs', name: 'Bilal' });
    expect(assignee.primary?.id).toBe('take_over');
    expect(ids(assignee.acts)).toEqual(['bill', 'call', 'clean']);
    expect(assignee.acts.find((a) => a.id === 'clean')?.off).toBe('tables.err.TABLE_HAS_OPEN_ORDERS');
    expect(assignee.note).toBeNull();
    expect(assignee.lockedBy).toEqual({ name: 'Bilal' });

    // another order taker (TableSheetOther): read-only line, no primary, no Clean without clean-table
    const other = sheetModel(tile({ holder: BILAL }), ME, perms('take-order'), true);
    expect(other.primary).toBeNull();
    expect(other.note).toBe('read_only');
    expect(ids(other.acts)).toEqual(['bill', 'call']);

    // waiter, no take-order (TableSheetWaiter)
    const waiter = sheetModel(tile({ holder: BILAL }), ME, perms('mark-served'), true);
    expect(waiter.primary).toBeNull();
    expect(waiter.acts).toEqual([]);
    expect(waiter.more).toEqual([]);
    expect(waiter.note).toBe('waiter');

    // manager (TableSheetManager): Take order (busy) · Release Bilal's lock · Force move · Ask for bill · More (Hand over …)
    const manager = sheetModel(
      tile({ holder: BILAL, lock: { ...BILAL, mine: false } }),
      ME,
      perms('take-order', 'take-order-anywhere', 'force-release-table-lock'),
      true,
    );
    expect(manager.primary).toMatchObject({ id: 'take_order', busy: true });
    expect(ids(manager.acts)).toEqual(['release_other', 'force_move', 'bill', 'more']);
    expect(ids(manager.more)).toEqual(['hand', 'move', 'join', 'split']);
    // without take-order-anywhere the manager does not open someone else's table
    expect(sheetModel(tile({ holder: BILAL }), ME, perms('take-order', 'force-release-table-lock'), true).primary).toBeNull();

    // to clean (TableSheetClean): Mark clean only, with clean-table
    const toClean = sheetModel(tile({ state: 'NEEDS_CLEANING', live_order_count: 0 }), ME, perms('take-order', 'clean-table'), true);
    expect(toClean.title).toEqual({ kind: 'clean' });
    expect(toClean.primary?.id).toBe('mark_clean');
    expect(toClean.acts).toEqual([]);
    expect(sheetModel(tile({ state: 'NEEDS_CLEANING' }), ME, perms('take-order'), true).primary).toBeNull();

    // free table: Take order with take-order only
    const free = tile({ state: 'FREE', seating_id: null, holder: null, live_order_count: 0, opened_at: null });
    expect(sheetModel(free, ME, perms('take-order'), true)).toMatchObject({ title: { kind: 'free' }, primary: { id: 'take_order' }, acts: [] });
    expect(sheetModel(free, ME, perms(), true).primary).toBeNull();

    // requires_approval counts as not granted (§3.15): nothing a grant would show
    const approval = createPermissions({ 'take-order': ask, 'force-release-table-lock': ask, 'clean-table': ask, 'take-order-anywhere': ask });
    const asked = sheetModel(tile({ holder: BILAL, lock: { ...BILAL, mine: false } }), ME, approval, true);
    expect(asked.primary).toBeNull();
    expect(asked.acts).toEqual([]);
    expect(asked.more).toEqual([]);
  });

  it('[02a §8 Rules] force-release-table-lock alone shows Release and Force move, never the take-order actions (review #161)', () => {
    const force = sheetModel(tile({ holder: BILAL, lock: { ...BILAL, mine: false } }), ME, perms('force-release-table-lock'), true);
    expect(force.primary).toBeNull();
    expect(ids(force.acts)).toEqual(['release_other', 'force_move']);
    expect(force.more).toEqual([]);
    const noLock = sheetModel(tile({ holder: BILAL, state: 'SEATED', live_order_count: 0 }), ME, perms('force-release-table-lock', 'clean-table'), true);
    expect(ids(noLock.acts)).toEqual(['force_move', 'more']);
    expect(ids(noLock.more)).toEqual(['clean']);
    // take-order-anywhere: a Take order primary, so no "Only Ali or a manager can take orders" line
    const anywhere = sheetModel(tile({ holder: BILAL }), ME, perms('take-order', 'take-order-anywhere'), true);
    expect(anywhere.primary?.id).toBe('take_order');
    expect(anywhere.note).toBeNull();
  });

  it('[02a §8 Offline] offline: every hub action is off "Needs the hub"; Ask for bill and Clean stay on', () => {
    const off = sheetModel(tile({ state: 'SEATED', live_order_count: 0 }), ME, perms('take-order', 'clean-table'), false);
    expect(off.offline).toBe(true);
    expect(off.primary).toMatchObject({ id: 'take_order', off: 'tables.toast.needs_hub', needsHub: true });
    expect(off.acts.find((a) => a.id === 'call')?.off).toBe('tables.toast.needs_hub');
    expect(off.acts.find((a) => a.id === 'hand')?.off).toBe('tables.toast.needs_hub');
    expect(off.more.find((a) => a.id === 'clean')?.off).toBeNull();
    expect(off.acts.find((a) => a.id === 'more')?.off).toBeNull(); // Clean inside More still works
    const bill = sheetModel(tile(), ME, perms('take-order'), false);
    expect(bill.acts.find((a) => a.id === 'bill')?.off).toBeNull();
    expect(bill.acts.find((a) => a.id === 'more')?.off).toBe('tables.toast.needs_hub'); // every item inside needs the hub
    const assignee = sheetModel(tile({ holder: BILAL, assignee: { staff_id: ME, name: 'Ali' } }), ME, perms('take-order'), false);
    expect(assignee.primary).toMatchObject({ id: 'take_over', off: 'tables.toast.needs_hub' });
    const manager = sheetModel(tile({ holder: BILAL, lock: { ...BILAL, mine: false } }), ME, perms('take-order', 'force-release-table-lock'), false);
    expect(manager.acts.find((a) => a.id === 'release_other')?.off).toBe('tables.toast.needs_hub');
  });

  it('[02a Q-25] my own lock on another screen is not someone else\'s lock', () => {
    const own = sheetModel(tile({ lock: { staff_id: ME, name: 'Ali', mine: false } }), ME, perms('take-order', 'force-release-table-lock'), true);
    expect(own.ownElsewhere).toBe(true);
    expect(own.lockedBy).toBeNull();
    expect(ids(own.acts)).not.toContain('release_other');
    expect(own.more.map((a) => a.id)).not.toContain('release_mine');
  });
});
