import { registerEventAudience } from './audience.js';

// §4.5: the KDS needs the config (station names, completion_mode); only ordering screens need stock,
// availability and the business day.
registerEventAudience('BranchConfigApplied', () => true);
for (const eventType of [
  'ItemMadeUnavailable',
  'ItemMadeAvailable',
  'StockSet',
  'StockAdded',
  'StockTransferredOut',
  'BusinessDayOpened',
  'BusinessDayClosed',
]) {
  registerEventAudience(eventType, (_event, socket) => socket.kind === 'staff');
}
