import type Database from 'better-sqlite3';

// 03a v1.2 §4.4 (Q-1, R-1): 02a's reader pair for the `dine_in` slip receiver and the card's table label, registered
// together by 02a at startup. Each is one statement over every order id it is given; `db` is the tick's read-only view
// (readOnlyDb). 02a v1.1.1 §4.2 types. Until registered, the slip goes to `placed_by` with `table_code: null`.
export type HoldersOfOrders = (db: Database.Database, order_ids: readonly string[]) => Map<string, string>;
export type CurrentTableOf = (db: Database.Database, order_ids: readonly string[]) => Map<string, { seating_id: string; primary_table_id: string; table_ids: string[] }>;

interface SlipReaders {
  holdersOfOrders: HoldersOfOrders;
  currentTableOf: CurrentTableOf;
}

let readers: SlipReaders | null = null;

export function registerSlipReaders(r: SlipReaders): void {
  readers = { holdersOfOrders: r.holdersOfOrders, currentTableOf: r.currentTableOf };
}

export function slipReaders(): SlipReaders | null {
  return readers;
}

// Tests only: back to the §4.4 stub.
export function resetSlipReaders(): void {
  readers = null;
}
