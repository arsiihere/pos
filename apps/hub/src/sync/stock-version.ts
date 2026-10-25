import type { PosEvent } from '@pos/events';

// §6.19: the seq of the last committed event that changes the stock page, held in memory.
export const STOCK_VERSION_EVENTS: ReadonlySet<string> = new Set([
  'StockSet',
  'StockAdded',
  'BusinessDayOpened',
  'BusinessDayClosed',
  'ItemMadeUnavailable',
  'ItemMadeAvailable',
]);

let current = 0;

export function stockVersion(): number {
  return current;
}

export function setStockVersion(seq: number): void {
  current = seq;
}

// Called after COMMIT with the appended events (S15: the boot fold sets the start value).
export function noteCommitted(events: readonly PosEvent[]): void {
  for (const event of events) {
    if (STOCK_VERSION_EVENTS.has(event.event_type) && event.seq > current) current = event.seq;
  }
}
