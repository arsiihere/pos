import type { MessageKey } from '../../../../i18n';
import type { Permissions } from '../../shell/permissions';
import type { MapTile } from '../contracts';

// 02a §8 Table sheet, Rules (R5), Offline; §3.15 (02-S06 frames TableSheet, …Assignee, …Other, …Waiter, …Manager,
// …Clean, …Offline). Which buttons the sheet shows for one tile, from the person's grants only (Q-15: no floor
// list; `requires_approval` = not granted). A shown button that cannot act now is `off` with the reason shown on
// tap (handoff PROMPT step 6). Offline every hub-only action is off "Needs the hub"; Ask for bill and Clean go
// through the queue (§8 Offline).

export type ActionId =
  | 'take_order'
  | 'add_items'
  | 'take_over'
  | 'mark_clean'
  | 'bill'
  | 'call'
  | 'hand'
  | 'more'
  | 'force_move'
  | 'release_other'
  | 'release_mine'
  | 'move'
  | 'join'
  | 'split'
  | 'clean';

export interface SheetAction {
  id: ActionId;
  /** why it cannot act now (shown on tap), or null */
  off: MessageKey | null;
  /** a hub-only action (wifi-off mark while offline) */
  needsHub: boolean;
  /** the primary Take order while someone else holds the lock: a tap shows TableBusy */
  busy?: boolean;
}

export type SheetTitle = { kind: 'mine' } | { kind: 'theirs'; name: string } | { kind: 'clean' } | { kind: 'free' };

export interface SheetModel {
  title: SheetTitle;
  primary: SheetAction | null;
  /** the action grid (≤ 4, More last when it has items) */
  acts: SheetAction[];
  /** under More */
  more: SheetAction[];
  /** the read-only line: someone else's table, or a waiter */
  note: 'read_only' | 'waiter' | null;
  offline: boolean;
  /** someone else's lock (the padlock line, TableBusy) */
  lockedBy: { name: string } | null;
  /** my own lock on another screen (TableBusyOwn, T15) */
  ownElsewhere: boolean;
}

/** Ask for bill and Clean are queueable (00 v1.8 H-1); everything else needs the hub. */
const QUEUEABLE: ReadonlySet<ActionId> = new Set(['bill', 'clean', 'mark_clean']);

export function sheetModel(tile: MapTile, me: string | null, perms: Permissions, online: boolean): SheetModel {
  const takeOrder = perms.allowed('take-order');
  const anywhere = perms.allowed('take-order-anywhere');
  const force = perms.allowed('force-release-table-lock');
  const cleanGrant = perms.allowed('clean-table');
  const offline = !online;

  const lock = tile.lock;
  const ownElsewhere = lock !== null && me !== null && lock.staff_id === me && !lock.mine;
  const lockedBy = lock !== null && lock.staff_id !== me ? { name: lock.name ?? '' } : null;

  const act = (id: ActionId, why: MessageKey | null = null, busy = false): SheetAction => {
    const needsHub = !QUEUEABLE.has(id);
    const off = offline && needsHub ? 'tables.toast.needs_hub' : why;
    return busy ? { id, off, needsHub, busy } : { id, off, needsHub };
  };
  const withMore = (acts: SheetAction[], more: SheetAction[]): SheetAction[] =>
    more.length === 0 ? acts : [...acts, { id: 'more', off: more.every((a) => a.off !== null) ? 'tables.toast.needs_hub' : null, needsHub: false }];
  const model = (title: SheetTitle, primary: SheetAction | null, acts: SheetAction[], more: SheetAction[], note: SheetModel['note']): SheetModel => ({
    title,
    primary,
    acts: withMore(acts, more),
    more,
    note,
    offline,
    lockedBy,
    ownElsewhere,
  });

  // a free table: open a new seating
  if (tile.seating_id === null) return model({ kind: 'free' }, takeOrder ? act('take_order') : null, [], [], takeOrder ? null : 'waiter');

  // bill paid, waiting for cleaning (final, §3.1): only Clean
  if (tile.state === 'NEEDS_CLEANING') return model({ kind: 'clean' }, cleanGrant ? act('mark_clean') : null, [], [], null);

  const mine = me !== null && tile.holder?.staff_id === me;
  const assignee = me !== null && tile.assignee?.staff_id === me;
  const title: SheetTitle = mine ? { kind: 'mine' } : { kind: 'theirs', name: tile.holder?.name ?? '' };
  const hasOrders = tile.live_order_count > 0;

  const open = () => act(hasOrders && mine ? 'add_items' : 'take_order', null, lockedBy !== null);
  let primary: SheetAction | null = null;
  if (takeOrder && mine) primary = open();
  else if (takeOrder && assignee) primary = act('take_over');
  else if (takeOrder && anywhere) primary = open();

  const bill = takeOrder ? [act('bill', hasOrders ? null : 'tables.err.TABLE_NO_ORDERS')] : [];
  const call = takeOrder ? [act('call')] : [];
  const clean = cleanGrant ? [act('clean', hasOrders ? 'tables.err.TABLE_HAS_OPEN_ORDERS' : null)] : [];
  const joined = tile.joined_table_names.length > 1;
  const party = [act('move', joined ? 'sheet.split_first' : null), act('join'), act('split')];

  if (mine && takeOrder) {
    const more = [...party, ...(lock?.mine === true ? [act('release_mine')] : []), ...(hasOrders ? [] : clean)];
    return model(title, primary, [...bill, ...call, act('hand')], more, null);
  }
  if (force) {
    // the manager (02-S06 TableSheetManager): release / force move first, hand over and the party moves under More
    // Hand over, Move, Join, Split register `take-order` (§6.7, §6.9–§6.11; force is their second permission, §3.15)
    const first = lockedBy !== null ? [act('release_other')] : call;
    const more = [...(takeOrder ? [act('hand'), ...party] : []), ...(hasOrders ? [] : clean)];
    return model(title, primary, [...first, act('force_move'), ...bill], more, null);
  }
  // a Take order primary (take-order-anywhere) contradicts "Only Ali or a manager can take orders"
  const note: SheetModel['note'] = !takeOrder ? 'waiter' : assignee || primary !== null ? null : 'read_only';
  return model(title, primary, [...bill, ...call, ...clean], [], note);
}
