/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

// 05 v1.0.7 §5, plan §2B.5 task 6: hub migration 0023_billing. The rewind tests of earlier migrations go back to a
// pre-0023 hub with this helper; the table list is read from the migration itself, so it cannot drift from it.

export const BILLING_MIGRATION = '0023_billing.sql';
export const billingMigrationPath = fileURLToPath(new URL(`../../src/db/migrations/${BILLING_MIGRATION}`, import.meta.url));

/** Every table 0023 creates, in file order (dropping a table drops its indexes). */
export function billingTables(): string[] {
  const sql = readFileSync(billingMigrationPath, 'utf8').replace(/--[^\n]*/g, '');
  return [...sql.matchAll(/CREATE TABLE (\w+) \(/g)].map((m) => m[1]!);
}

/** Drops 0023's tables (the rewind tests then delete its checksum row and lower user_version themselves). */
export function dropBilling0023(db: Database.Database): void {
  for (const table of billingTables()) db.exec(`DROP TABLE ${table}`);
}
