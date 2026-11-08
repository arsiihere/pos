import type { PosEvent } from '@pos/events';

// §6.19: the seq of the last committed event that changes the stock page, held in memory.
// ⚠️ 03a A-17: gains StockReserved, StockReleased, StockConsumed. Split by stream for boot's two reads (§3.12).
// ⚠️ 01a v2.3 A-1 (02b): gains StockTransferredOut.
export const STOCK_VERSION_STOCK_EVENTS = [
  'StockSet',
  'StockAdded',
  'ItemMadeUnavailable',
  'ItemMadeAvailable',
  'StockReserved',
  'StockReleased',
  'StockConsumed',
  'StockTransferredOut',
] as const;
export const STOCK_VERSION_HUB_EVENTS = ['BusinessDayOpened', 'BusinessDayClosed'] as const;

export const STOCK_VERSION_EVENTS: ReadonlySet<string> = new Set([...STOCK_VERSION_STOCK_EVENTS, ...STOCK_VERSION_HUB_EVENTS]);

let current = 0;

export function stockVersion(): number {
  return current;
}

export function setStockVersion(seq: number): void {
  current = seq;
}

// Called after COMMIT with the appended events (03a §3.12: boot step 3 sets the start value).
export function noteCommitted(events: readonly PosEvent[]): void {
  for (const event of events) {
    if (STOCK_VERSION_EVENTS.has(event.event_type) && event.seq > current) current = event.seq;
  }
}
