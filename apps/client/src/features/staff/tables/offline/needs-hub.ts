// 02a §8 Offline (02-B02 TableSheetOffline, TableMapOffline): what the table sheet can do while the hub is away.
// Open, Take over, Hand over, Force release / Force move, Move, Merge, Split and Call waiter need the hub (shown
// disabled, "Needs the hub"; never queued, Call waiter included, 02b v1.0 P-1f). Ask for bill and Clean go through
// the one `Enqueue` (Q-3): its answer says queued or "Needs the hub" (until 25b), so they are not marked here.

export type TableAction =
  | 'open'
  | 'take_over'
  | 'hand_over'
  | 'force_release'
  | 'force_move'
  | 'move'
  | 'merge'
  | 'split'
  | 'call_waiter'
  | 'ask_bill'
  | 'clean';

export const NEEDS_HUB_ACTIONS: ReadonlySet<TableAction> = new Set<TableAction>([
  'open',
  'take_over',
  'hand_over',
  'force_release',
  'force_move',
  'move',
  'merge',
  'split',
  'call_waiter',
]);

/** True when the action is shown disabled "Needs the hub" while offline. */
export function needsHub(action: TableAction): boolean {
  return NEEDS_HUB_ACTIONS.has(action);
}
