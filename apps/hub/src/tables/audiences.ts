import { registerEventAudience } from '../ws/audience.js';

// 02a v1.1.3 §6.19 Audiences: every `table`-stream event of §6.19 goes to the staff sockets and cashier kiosks of the
// branch (the hub is one branch; ids only, no totals); TableMoved, TablesMerged and SeatingSplit also go to KDS
// stations. Registered once per process at this module's load, like 00's and 03a's audience lists.

export const TABLE_EVENT_TYPES = [
  'TableOpened',
  'TableLocked',
  'TableLockTouched',
  'TableLockReleased',
  'TableHolderChanged',
  'TableMoved',
  'TablesMerged',
  'SeatingSplit',
  'BillRequested',
  'TableCleaned',
] as const;

export const KDS_TABLE_EVENT_TYPES: ReadonlySet<string> = new Set(['TableMoved', 'TablesMerged', 'SeatingSplit']);

for (const eventType of TABLE_EVENT_TYPES) {
  const kds = KDS_TABLE_EVENT_TYPES.has(eventType);
  registerEventAudience(
    eventType,
    (_event, socket) => socket.kind === 'staff' || socket.deviceType === 'cashier_kiosk' || (kds && socket.kind === 'station'),
  );
}
