import type Database from 'better-sqlite3';
import type { Writer } from '../engine-host/writer.js';

// 03c §5 (G-8, phase 0 P0.11): called from 00's sweeper purge() at the maintenance hour, after 01d's purgeAlerts.
// A no-op until task c22 (this file is c22's): acked / cancelled jobs, tickets, ticket lines and resolved skips older
// than 7 days. Returns the rows deleted.
export interface PrintRetentionDeps {
  db: Database.Database;
  writer: Writer;
}

export function purgePrint(deps: PrintRetentionDeps, branchId: string, now: number): number {
  void deps;
  void branchId;
  void now;
  return 0;
}
