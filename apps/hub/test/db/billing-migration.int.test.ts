/// <reference types="node" />
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAuditAction, resetAuditActions } from '@pos/domain';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { freshDb } from '../helpers/db';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { BILLING_MIGRATION, billingMigrationPath, billingTables, dropBilling0023 } from './billing-0023';

// 05 v1.0.7 §5 (DDL), §5 "Audit refold" (04 v1.0.7 row V-3), plan §2B.5 task 6: hub migration 0023_billing.
// The migration is the §5 SQL block verbatim (the 6a fiscal DDL included, PL-13) plus the audit checkpoint delete.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const specPath = fileURLToPath(new URL('../../../../docs/specs/05_Billing_Spec_v1.0.7.md', import.meta.url));
const lf = (t: string): string => t.replace(/\r\n/g, '\n');
const AUDIT_DELETE = "DELETE FROM projection_checkpoints WHERE projection = 'audit';";

/** The ```sql block of spec §5, exactly as written. */
function specSql(): string {
  const spec = lf(readFileSync(specPath, 'utf8'));
  const s5 = spec.indexOf('\n## §5. Data model');
  const s6 = spec.indexOf('\n## §6.', s5);
  const section = spec.slice(s5, s6);
  const start = section.indexOf('```sql\n') + '```sql\n'.length;
  return section.slice(start, section.indexOf('\n```', start));
}

const TABLES = [
  'bills', 'bill_orders', 'bill_splits', 'bill_discount_lines', 'bill_split_lines', 'bill_payments', 'invoices',
  'invoice_taxes', 'fiscal_outbox', 'closed_split_units', 'carried_orders', 'z_reports', 'billing_day', 'shifts',
  'shift_signoffs', 'shift_handovers', 'shift_takings', 'petty_cash', 'invoice_buyers', 'bill_texts',
  'payment_references', 'fiscal_credentials', 'bill_print_jobs',
];

/** Primary key columns per table, in key order (§5). */
const PKS: Record<string, string[]> = {
  bills: ['bill_id'],
  bill_orders: ['bill_id', 'order_id'],
  bill_splits: ['bill_id', 'split_no'],
  bill_discount_lines: ['bill_id', 'order_item_id'],
  bill_split_lines: ['bill_id', 'split_no', 'order_item_id'],
  bill_payments: ['payment_id'],
  invoices: ['invoice_id'],
  invoice_taxes: ['invoice_id', 'tax_profile_id', 'tax_code', 'payment_class'],
  fiscal_outbox: ['invoice_id'],
  closed_split_units: ['bill_id', 'split_no', 'order_item_id'],
  carried_orders: ['order_id', 'business_date'],
  z_reports: ['business_date'],
  billing_day: ['k'],
  shifts: ['shift_id'],
  shift_signoffs: ['shift_id'],
  shift_handovers: ['shift_id', 'at'],
  shift_takings: ['shift_id', 'mode_id', 'taken_by_staff_id'],
  petty_cash: ['entry_id'],
  invoice_buyers: ['invoice_id'],
  bill_texts: ['subject_id', 'field'],
  payment_references: ['payment_id'],
  fiscal_credentials: ['pos_id', 'name'],
  bill_print_jobs: ['job_id'],
};

/** Named indexes: table, columns, unique, partial (§5). */
const INDEXES: Record<string, [string, string[], 0 | 1, 0 | 1]> = {
  bills_live_seating: ['bills', ['seating_id'], 1, 1],
  bills_live_key: ['bills', ['table_key'], 1, 1],
  bills_open: ['bills', ['state', 'opened_at'], 0, 1],
  bills_seating: ['bills', ['seating_id'], 0, 0],
  bills_key: ['bills', ['table_key'], 0, 0],
  bill_orders_order: ['bill_orders', ['order_id'], 0, 0],
  bill_split_lines_line: ['bill_split_lines', ['order_item_id'], 0, 0],
  bill_split_lines_order: ['bill_split_lines', ['order_id'], 0, 0],
  bill_payments_split: ['bill_payments', ['bill_id', 'split_no'], 0, 1],
  invoices_series_number: ['invoices', ['series', 'number'], 1, 0],
  invoices_ref: ['invoices', ['invoice_ref'], 1, 0],
  invoices_day: ['invoices', ['business_date', 'series'], 0, 0],
  invoices_bill: ['invoices', ['bill_id'], 0, 0],
  fiscal_outbox_pending: ['fiscal_outbox', ['ord'], 0, 1],
  fiscal_outbox_rejected: ['fiscal_outbox', ['ord'], 0, 1],
  closed_split_units_line: ['closed_split_units', ['order_item_id'], 0, 0],
  shifts_open_staff: ['shifts', ['staff_id'], 1, 1],
  shifts_open_drawer: ['shifts', ['drawer_device_id'], 1, 1],
  shifts_day: ['shifts', ['business_date'], 0, 0],
  shifts_signoff_pending: ['shifts', ['closed_at'], 0, 1],
  shift_signoffs_day: ['shift_signoffs', ['business_date'], 0, 0],
  petty_cash_shift: ['petty_cash', ['shift_id'], 0, 0],
  petty_cash_open: ['petty_cash', ['at'], 0, 1],
  bill_print_jobs_bill: ['bill_print_jobs', ['bill_id', 'created_at'], 0, 0],
};

type Row = Record<string, unknown>;
function insert(db: Database.Database, table: string, row: Row): void {
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
}

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  resetAuditActions();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function migrated(): Promise<Database.Database> {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  await runMigrations(fx.db, { dir: migrations, clock: fixedClock(T) });
  return fx.db;
}

function copyUpTo(parent: string, last: string): string {
  const target = join(parent, `migrations-${last}`);
  mkdirSync(target);
  for (const name of readdirSync(migrations)) {
    if (name.endsWith('.sql') && name.slice(0, 4) <= last.slice(0, 4)) copyFileSync(join(migrations, name), join(target, name));
  }
  return target;
}

const names = (db: Database.Database, type: string): string[] =>
  db.prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').pluck().all(type) as string[];

describe('[05 §5] hub migration 0023_billing — text', () => {
  it('[05 §5, PL-13] the migration holds the spec §5 SQL block verbatim (6a fiscal DDL included); outside it only comments and the audit checkpoint delete, last', () => {
    const sql = lf(readFileSync(billingMigrationPath, 'utf8'));
    const block = specSql();
    expect(block.startsWith('-- projection billing')).toBe(true);
    expect(sql.includes(block), 'the §5 block, byte for byte').toBe(true);
    const rest = sql.replace(block, '').split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('--'));
    expect(rest).toEqual([AUDIT_DELETE]);
    expect(sql.trimEnd().endsWith(AUDIT_DELETE), 'the delete is the last statement').toBe(true);
  });

  it('[05 §5, PL-13] the staged 6a file is gone and the migration is the only migration-dir file named for 05', () => {
    expect(() => readFileSync(fileURLToPath(new URL('../../src/billing/fiscal/outbox-ddl.sql', import.meta.url)))).toThrow(/ENOENT/);
    expect(readdirSync(migrations).filter((n) => n.startsWith('0023_'))).toEqual([BILLING_MIGRATION]);
    expect(billingTables()).toEqual(TABLES);
  });
});

const SHIFT_MIGRATION = '0024_billing_payments_shift.sql';

describe('[05 v1.0.11 §5, R-56] hub migration 0024_billing_payments_shift', () => {
  const plan = (db: Database.Database, q: string): string => (db.prepare(`EXPLAIN QUERY PLAN ${q}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');

  it('[05 v1.0.11 §5, R-56] the migration is the one index statement, under a header that cites 05 v1.0.11 §5 and R-56; 0023 is untouched', () => {
    const sql = lf(readFileSync(join(migrations, SHIFT_MIGRATION), 'utf8'));
    const header = sql.split('\n').filter((l) => l.trimStart().startsWith('--')).join('\n');
    expect(header).toMatch(/05 v1\.0\.11 §5/);
    expect(header).toMatch(/R-56/);
    const rest = sql.split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('--'));
    expect(rest).toEqual(['CREATE INDEX bill_payments_shift ON bill_payments (shift_id, mode_id, taken_by_staff_id);']);
    expect(lf(readFileSync(billingMigrationPath, 'utf8')), '0023 never edited').not.toMatch(/bill_payments_shift/);
  });

  it('[05 v1.0.11 §5, R-56] bill_payments_shift is on bill_payments, not unique, not partial, columns (shift_id, mode_id, taken_by_staff_id) in that order', async () => {
    const db = await migrated();
    const ix = (db.pragma('index_list(bill_payments)') as Array<{ name: string; unique: number; partial: number }>).find((i) => i.name === 'bill_payments_shift');
    expect(ix, 'bill_payments_shift').toBeDefined();
    expect([ix!.unique, ix!.partial]).toEqual([0, 0]);
    expect((db.pragma('index_info(bill_payments_shift)') as Array<{ seqno: number; name: string }>).map((c) => c.name)).toEqual(['shift_id', 'mode_id', 'taken_by_staff_id']);
  });

  it('[05 v1.0.11 §5, R-56] a query by shift_id on bill_payments (the takings read) uses bill_payments_shift', async () => {
    const db = await migrated();
    expect(plan(db, "SELECT mode_id, taken_by_staff_id, SUM(amount_minor) FROM bill_payments WHERE shift_id = 'SH1' GROUP BY mode_id, taken_by_staff_id")).toMatch(/USING (COVERING )?INDEX bill_payments_shift \(shift_id=\?/);
    expect(plan(db, "SELECT payment_id FROM bill_payments WHERE shift_id = 'SH1' AND mode_id = 'cash'")).toMatch(/USING (COVERING )?INDEX bill_payments_shift \(shift_id=\? AND mode_id=\?\)/);
  });

  it('[05 v1.0.11 §5, R-56] a fresh database and a database at 23 both end at 24 with the index; re-run is a no-op', async () => {
    const fresh = await migrated();
    expect(fresh.pragma('user_version', { simple: true })).toBe(24);
    expect(names(fresh, 'index')).toContain('bill_payments_shift');

    const fx = freshDb();
    cleanups.push(fx.cleanup);
    const { db, dir } = fx;
    await runMigrations(db, { dir: copyUpTo(dir, '0023'), clock: fixedClock(T) });
    expect(names(db, 'index')).not.toContain('bill_payments_shift');
    const indexesBefore = names(db, 'index');
    const tablesBefore = names(db, 'table');
    insert(db, 'bills', BILL);
    insert(db, 'bill_payments', PAYMENT);
    const result = await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    expect(result).toEqual({ from: 23, to: 24, applied: [SHIFT_MIGRATION] });
    expect(db.pragma('user_version', { simple: true })).toBe(24);
    expect(names(db, 'index').filter((n) => !indexesBefore.includes(n))).toEqual(['bill_payments_shift']);
    expect(names(db, 'table'), 'no table change').toEqual(tablesBefore);
    expect(db.prepare('SELECT COUNT(*) FROM bill_payments').pluck().get(), 'rows kept').toBe(1);
    expect(plan(db, "SELECT * FROM bill_payments WHERE shift_id = 'SH1'")).toMatch(/bill_payments_shift/);
    expect(await runMigrations(db, { dir: migrations, clock: fixedClock(T + 1) })).toEqual({ from: 24, to: 24, applied: [] });
  });
});

describe('[05 §5] hub migration 0023_billing — schema', () => {
  it('[05 §5] a 0022 database migrates to 0023: exactly the 23 tables and the 24 named indexes (+ primary-key / UNIQUE autoindexes); only the audit checkpoint is deleted; re-run is a no-op', async () => {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    const { db, dir } = fx;
    await runMigrations(db, { dir: copyUpTo(dir, '0022'), clock: fixedClock(T) });
    const tablesBefore = names(db, 'table');
    const indexesBefore = names(db, 'index');
    const othersBefore = [...names(db, 'view'), ...names(db, 'trigger')];
    const cp = db.prepare('INSERT INTO projection_checkpoints (branch_id, projection, last_seq) VALUES (?, ?, ?)');
    for (const p of ['audit', 'orders', 'tables', 'kitchen_tickets']) cp.run('branch-1', p, 42);

    const upTo23 = copyUpTo(dir, '0023'); // 0024 (R-56) is the next describe's subject
    const result = await runMigrations(db, { dir: upTo23, clock: fixedClock(T) });
    expect(result).toEqual({ from: 22, to: 23, applied: [BILLING_MIGRATION] });
    expect(db.pragma('user_version', { simple: true })).toBe(23);
    expect(names(db, 'table').filter((n) => !tablesBefore.includes(n))).toEqual([...TABLES].sort());
    const newIndexes = names(db, 'index').filter((n) => !indexesBefore.includes(n));
    expect(newIndexes.filter((n) => !n.startsWith('sqlite_autoindex_'))).toEqual(Object.keys(INDEXES).sort());
    expect([...names(db, 'view'), ...names(db, 'trigger')], 'no new view, no new trigger').toEqual(othersBefore);
    expect(db.prepare('SELECT projection, last_seq FROM projection_checkpoints ORDER BY projection').all(), 'V-3: only audit refolds').toEqual([
      { projection: 'kitchen_tickets', last_seq: 42 },
      { projection: 'orders', last_seq: 42 },
      { projection: 'tables', last_seq: 42 },
    ]);
    expect(await runMigrations(db, { dir: upTo23, clock: fixedClock(T + 1) })).toEqual({ from: 23, to: 23, applied: [] });
  });

  it('[05 §5] every table has the §5 primary key', async () => {
    const db = await migrated();
    for (const table of TABLES) {
      const cols = (db.pragma(`table_info(${table})`) as Array<{ name: string; pk: number }>).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
      expect(cols.map((c) => c.name), table).toEqual(PKS[table]);
    }
  });

  it('[05 §5] every named index: its table, key columns, uniqueness and partial WHERE', async () => {
    const db = await migrated();
    for (const [name, [table, cols, unique, partial]] of Object.entries(INDEXES)) {
      const list = db.pragma(`index_list(${table})`) as Array<{ name: string; unique: number; partial: number }>;
      const ix = list.find((i) => i.name === name);
      expect(ix, name).toBeDefined();
      expect([ix!.unique, ix!.partial], name).toEqual([unique, partial]);
      expect((db.pragma(`index_info(${name})`) as Array<{ name: string }>).map((c) => c.name), name).toEqual(cols);
    }
    const desc = (db.pragma('index_xinfo(bill_print_jobs_bill)') as Array<{ name: string | null; desc: number; key: number }>).filter((c) => c.key === 1);
    expect(desc.map((c) => [c.name, c.desc])).toEqual([['bill_id', 0], ['created_at', 1]]);
    expect(db.prepare('SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?').pluck().get('z_reports', 'z_no')).toBe(1);
    const zUnique = (db.pragma('index_list(z_reports)') as Array<{ name: string; unique: number; origin: string }>).filter((i) => i.origin === 'u');
    expect(zUnique.map((i) => (db.pragma(`index_info(${i.name})`) as Array<{ name: string }>).map((c) => c.name))).toEqual([['z_no']]);
  });

  it('[05 v1.0.7 §5, task 6 review] bills_seating, bills_key and fiscal_outbox_rejected exist on their tables; only fiscal_outbox_rejected is partial, WHERE state = \'rejected\'', async () => {
    const db = await migrated();
    const sqlOf = db.prepare("SELECT tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name = ?");
    expect(sqlOf.get('bills_seating')).toEqual({ tbl_name: 'bills', sql: 'CREATE INDEX bills_seating             ON bills (seating_id)' });
    expect(sqlOf.get('bills_key')).toEqual({ tbl_name: 'bills', sql: 'CREATE INDEX bills_key                 ON bills (table_key)' });
    expect(sqlOf.get('fiscal_outbox_rejected')).toEqual({ tbl_name: 'fiscal_outbox', sql: "CREATE INDEX fiscal_outbox_rejected ON fiscal_outbox (ord) WHERE state = 'rejected'" });
    const plan = (q: string): string => (db.prepare(`EXPLAIN QUERY PLAN ${q}`).all() as Array<{ detail: string }>).map((r) => r.detail).join(' | ');
    expect(plan("SELECT invoice_id FROM fiscal_outbox WHERE state = 'rejected' ORDER BY ord"), 'the stuck check uses the partial index').toMatch(/fiscal_outbox_rejected/);
    expect(plan("SELECT bill_id FROM bills WHERE seating_id = 'S1'")).toMatch(/bills_seating|bills_live_seating/);
  });

  it('[05 §5, reviewer B] every money (_minor, _bp) and count column is declared INTEGER', async () => {
    const db = await migrated();
    const COUNTS = ['reopen_count', 'attempts', 'number', 'z_no', 'units', 'split_no', 'seq', 'ord'];
    const checked: string[] = [];
    for (const table of TABLES) {
      for (const c of db.pragma(`table_info(${table})`) as Array<{ name: string; type: string }>) {
        if (/_minor$|_bp$/.test(c.name) || COUNTS.includes(c.name)) {
          checked.push(`${table}.${c.name}`);
          expect(c.type, `${table}.${c.name}`).toBe('INTEGER');
        }
      }
    }
    for (const col of ['bills.sc_bp', 'bills.reopen_count', 'bill_payments.amount_minor', 'bill_payments.tendered_minor', 'invoices.number', 'invoices.total_minor',
      'invoice_taxes.rate_bp', 'invoice_taxes.tax_minor', 'fiscal_outbox.attempts', 'fiscal_outbox.ord', 'closed_split_units.units', 'closed_split_units.share_minor',
      'z_reports.z_no', 'shifts.float_minor', 'shifts.expected_cash_minor', 'shifts.variance_minor', 'shift_handovers.counted_minor', 'shift_takings.in_minor',
      'petty_cash.amount_minor', 'petty_cash.returned_minor']) {
      expect(checked, 'the scan covered it').toContain(col);
    }
  });

  it('[05 §5, B12, R-29] the bills fields R-29 and the tile marks read: reopen_count NOT NULL DEFAULT 0, check_printed_at, reopen_mode, prices_include_tax, rounding_json', async () => {
    const db = await migrated();
    const cols = Object.fromEntries((db.pragma('table_info(bills)') as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>).map((c) => [c.name, [c.type, c.notnull, c.dflt_value]]));
    expect(cols['reopen_count']).toEqual(['INTEGER', 1, '0']);
    expect(cols['check_printed_at']).toEqual(['INTEGER', 0, null]);
    expect(cols['reopen_mode']).toEqual(['TEXT', 0, null]);
    expect(cols['prices_include_tax']).toEqual(['INTEGER', 1, null]);
    expect(cols['rounding_json']).toEqual(['TEXT', 1, null]);
    expect(Object.keys(cols)).toHaveLength(19);
  });
});

// ------------------------------------------------------------------------------------------------ CHECK constraints

const BILL: Row = { bill_id: 'B1', scope: 'seating', seating_id: 'S1', table_key: null, order_type: 'dine_in', state: 'open', opened_at: 1, prices_include_tax: 0, rounding_json: '{}' };
const INVOICE: Row = {
  invoice_id: 'I1', series: 'sale', number: 1, invoice_ref: 'S1', bill_id: 'B1', split_no: 1, business_date: '2026-11-20', issued_at: 1, order_type: 'dine_in',
  jurisdiction_id: 'PK-PB', adapter_key: 'none', currency_code: 'PKR', prices_include_tax: 0, subtotal_minor: 100, discount_minor: 0, service_charge_minor: 0,
  tax_minor: 16, rounding_minor: 0, total_minor: 116, change_minor: 0, payment_class: 'cash', has_buyer_id: 0, buyer_id_refused: 0, closed_by: 'S', doc_json: '{}',
};
const PAYMENT: Row = { payment_id: 'P1', bill_id: 'B1', split_no: 1, mode_id: 'cash', payment_class: 'cash', direction: 'in', amount_minor: 100, tendered_minor: null, taken_by_staff_id: 'S', shift_id: 'SH1', added_at: 1 };
const SHIFT: Row = { shift_id: 'SH1', staff_id: 'S', business_date: '2026-11-20', opened_at: 1, float_minor: 0, state: 'open', expected_cash_minor: 0 };

/** table, a valid row, accepted variants, refused variants (each refused by a CHECK). */
const CHECKS: Array<[string, Row, Row[], Row[]]> = [
  ['bills', BILL,
    [{ scope: 'key', seating_id: null, table_key: 'takeaway:O1' }, { state: 'partly_paid' }, { state: 'closed' }, { split_mode: 'items' }, { split_mode: 'amount' }, { split_mode: 'equal' }, { reopen_mode: 'full' }, { reopen_mode: 'corrections' }, { sc_removed: 1, buyer_waived: 1, prices_include_tax: 1 }],
    [{ scope: 'table' }, { state: 'void' }, { state: 'OPEN' }, { sc_removed: 2 }, { split_mode: 'pro_rata' }, { buyer_waived: 2 }, { reopen_mode: 'partial' }, { prices_include_tax: 2 },
      { seating_id: null }, { table_key: 'k' }, { scope: 'key' }, { scope: 'key', seating_id: null }]],
  ['bill_splits', { bill_id: 'B1', split_no: 1, state: 'open' }, [{ split_no: 20 }, { state: 'closed' }], [{ split_no: 0 }, { split_no: 21 }, { state: 'paid' }]],
  ['bill_payments', PAYMENT,
    [{ payment_class: 'digital' }, { direction: 'out' }, { tendered_minor: 100 }, { tendered_minor: 500 }, { has_reference: 1 }],
    [{ payment_class: 'card' }, { payment_class: 'mixed' }, { direction: 'refund' }, { amount_minor: 0 }, { amount_minor: -1 }, { tendered_minor: 99 }, { has_reference: 2 }]],
  ['invoices', INVOICE,
    [{ series: 'credit' }, { payment_class: 'mixed' }, { prices_include_tax: 1, has_buyer_id: 1, buyer_id_refused: 1 }],
    [{ series: 'refund' }, { prices_include_tax: 2 }, { has_buyer_id: 2 }, { buyer_id_refused: -1 }]],
  ['invoice_taxes', { invoice_id: 'I1', tax_profile_id: 'TP', tax_code: 'GST', payment_class: 'cash', seq: 1, compound: 0, label: 'GST', rate_bp: 1600, base_minor: 100, tax_minor: 16 },
    [{ seq: 4 }, { compound: 1 }, { rate_bp: 0 }, { rate_bp: 10_000 }, { tax_minor: 0 }],
    [{ seq: 0 }, { seq: 5 }, { compound: 2 }, { rate_bp: -1 }, { rate_bp: 10_001 }, { tax_minor: -1 }]],
  ['fiscal_outbox', { invoice_id: 'I1', ord: 1, jurisdiction_id: 'PK', adapter_key: 'none', state: 'pending', queued_at: 1 },
    [{ state: 'acked' }, { state: 'rejected' }, { state: 'not_required' }], [{ state: 'sent' }]],
  ['billing_day', { k: 1, business_date: '2026-11-20', opened_at: 1 }, [], [{ k: 2 }, { k: 0 }]],
  ['shifts', SHIFT,
    [{ state: 'closed' }, { variance_state: 'pending' }, { variance_state: 'approved' }, { variance_state: 'disputed' }, { count_skipped: 1 }, { float_minor: 5_000 }],
    [{ float_minor: -1 }, { state: 'counted' }, { variance_state: 'rejected' }, { count_skipped: 2 }]],
  ['shift_signoffs', { shift_id: 'SH1', outcome: 'approved', approver_staff_id: 'M', signed_at: 1, business_date: '2026-11-20' }, [{ outcome: 'disputed' }], [{ outcome: 'pending' }]],
  ['petty_cash', { entry_id: 'E1', shift_id: 'SH1', kind: 'out', amount_minor: 1, at: 1 }, [{ kind: 'advance' }, { kind: 'in' }], [{ kind: 'refund' }, { amount_minor: 0 }]],
  ['bill_texts', { subject_id: 'X1', field: 'note', text: 't' }, [{ field: 'paid_to' }], [{ field: 'reference' }]],
  ['bill_print_jobs', { job_id: 'J1', bill_id: null, doc_kind: 'check', ref_id: 'S1', created_at: 1 },
    [{ doc_kind: 'receipt' }, { doc_kind: 'credit' }, { doc_kind: 'report' }, { doc_kind: 'no_sale' }], [{ doc_kind: 'invoice' }]],
];

describe('[05 §5] hub migration 0023_billing — CHECK constraints', () => {
  it.each(CHECKS.map((c) => [c[0], c] as const))('[05 §5] %s: every listed value passes, every other is refused by its CHECK', async (_t, [table, base, good, bad]) => {
    const db = await migrated();
    const pk = PKS[table]!;
    let n = 0;
    const keyed = (row: Row): Row => {
      n += 1;
      // a fresh key per row (billing_day has one fixed key and is emptied instead)
      if (table === 'billing_day') {
        db.prepare('DELETE FROM billing_day').run();
        return row;
      }
      const out: Row = { ...row, [pk[0]!]: `${String(row[pk[0]!])}-${n}` };
      // and fresh values for the table's UNIQUE indexes, so only a CHECK can refuse the row
      for (const col of ['seating_id', 'table_key', 'invoice_ref', 'staff_id']) if (typeof out[col] === 'string') out[col] = `${String(out[col])}-${n}`;
      if (table === 'invoices') out['number'] = n;
      return out;
    };
    insert(db, table, keyed(base));
    for (const over of good) expect(() => insert(db, table, keyed({ ...base, ...over })), JSON.stringify(over)).not.toThrow();
    for (const over of bad) expect(() => insert(db, table, keyed({ ...base, ...over })), JSON.stringify(over)).toThrow(/CHECK constraint failed/);
  });

  it('[05 §5] NOT NULL money and frozen-at-open fields are refused when missing', async () => {
    const db = await migrated();
    expect(() => insert(db, 'bills', { ...BILL, rounding_json: null })).toThrow(/NOT NULL constraint failed: bills.rounding_json/);
    expect(() => insert(db, 'bills', { ...BILL, prices_include_tax: null })).toThrow(/NOT NULL constraint failed: bills.prices_include_tax/);
    expect(() => insert(db, 'invoices', { ...INVOICE, currency_code: null })).toThrow(/NOT NULL constraint failed: invoices.currency_code/);
    expect(() => insert(db, 'invoices', { ...INVOICE, total_minor: null })).toThrow(/NOT NULL constraint failed: invoices.total_minor/);
    expect(() => insert(db, 'shifts', { ...SHIFT, expected_cash_minor: null })).toThrow(/NOT NULL constraint failed: shifts.expected_cash_minor/);
    insert(db, 'bills', BILL);
    expect(db.prepare("SELECT sc_bp, sc_removed, buyer_waived, reopen_count FROM bills WHERE bill_id = 'B1'").get()).toEqual({ sc_bp: 0, sc_removed: 0, buyer_waived: 0, reopen_count: 0 });
    insert(db, 'bill_payments', PAYMENT);
    expect(db.prepare("SELECT has_reference FROM bill_payments WHERE payment_id = 'P1'").pluck().get()).toBe(0);
    insert(db, 'fiscal_credentials', { pos_id: 'POS-1', token: 'test-token', set_at: 1, set_by_staff_id: 'O' });
    expect(db.prepare('SELECT name FROM fiscal_credentials').pluck().get()).toBe('token');
  });
});

// ------------------------------------------------------------------------------------------------ unique indexes

describe('[05 §5] hub migration 0023_billing — unique indexes', () => {
  it('[05 §5, OQ-6, R2, §3.10] bills_live_seating / bills_live_key: one live bill per seating / key; closed, absorbed and corrections bills do not count', async () => {
    const db = await migrated();
    insert(db, 'bills', BILL);
    expect(() => insert(db, 'bills', { ...BILL, bill_id: 'B2' })).toThrow(/UNIQUE constraint failed: bills.seating_id/);
    expect(() => insert(db, 'bills', { ...BILL, bill_id: 'B2', state: 'partly_paid' })).toThrow(/UNIQUE/);
    insert(db, 'bills', { ...BILL, bill_id: 'B3', state: 'closed' });
    insert(db, 'bills', { ...BILL, bill_id: 'B4', absorbed_into: 'B1' });
    insert(db, 'bills', { ...BILL, bill_id: 'B5', reopen_mode: 'corrections' });
    insert(db, 'bills', { ...BILL, bill_id: 'B6', reopen_mode: 'full', seating_id: 'S2' });
    expect(() => insert(db, 'bills', { ...BILL, bill_id: 'B7', seating_id: 'S2' }), 'a full-edit reopen is live').toThrow(/UNIQUE/);

    const KEY = { ...BILL, scope: 'key', seating_id: null, table_key: 'takeaway:O1', order_type: 'takeaway' };
    insert(db, 'bills', { ...KEY, bill_id: 'K1' });
    expect(() => insert(db, 'bills', { ...KEY, bill_id: 'K2' })).toThrow(/UNIQUE constraint failed: bills.table_key/);
    insert(db, 'bills', { ...KEY, bill_id: 'K3', state: 'closed' });
    insert(db, 'bills', { ...KEY, bill_id: 'K4', reopen_mode: 'corrections' });
  });

  it('[05 §5, B13, H6-1] invoices: one number per series; invoice_ref unique across sale and credit', async () => {
    const db = await migrated();
    insert(db, 'invoices', INVOICE);
    expect(() => insert(db, 'invoices', { ...INVOICE, invoice_id: 'I2', invoice_ref: 'S1b' })).toThrow(/UNIQUE constraint failed: invoices.series, invoices.number/);
    insert(db, 'invoices', { ...INVOICE, invoice_id: 'I3', series: 'credit', invoice_ref: 'C1' });
    expect(() => insert(db, 'invoices', { ...INVOICE, invoice_id: 'I4', series: 'credit', number: 2, invoice_ref: 'S1' })).toThrow(/UNIQUE constraint failed: invoices.invoice_ref/);
  });

  it('[05 §5, B11, B23] shifts: one open shift per staff, one open shift per drawer; shifts without a drawer never collide; z_no unique', async () => {
    const db = await migrated();
    insert(db, 'shifts', SHIFT);
    expect(() => insert(db, 'shifts', { ...SHIFT, shift_id: 'SH2' })).toThrow(/UNIQUE constraint failed: shifts.staff_id/);
    insert(db, 'shifts', { ...SHIFT, shift_id: 'SH3', state: 'closed' });
    insert(db, 'shifts', { ...SHIFT, shift_id: 'SH4', staff_id: 'S2' });
    insert(db, 'shifts', { ...SHIFT, shift_id: 'SH5', staff_id: 'S3', drawer_device_id: 'DRAWER' });
    expect(() => insert(db, 'shifts', { ...SHIFT, shift_id: 'SH6', staff_id: 'S4', drawer_device_id: 'DRAWER' })).toThrow(/UNIQUE constraint failed: shifts.drawer_device_id/);
    insert(db, 'shifts', { ...SHIFT, shift_id: 'SH7', staff_id: 'S4', drawer_device_id: 'DRAWER', state: 'closed' });
    insert(db, 'z_reports', { business_date: '2026-11-19', z_no: 1, issued_at: 1, report_json: '{}' });
    expect(() => insert(db, 'z_reports', { business_date: '2026-11-20', z_no: 1, issued_at: 2, report_json: '{}' })).toThrow(/UNIQUE constraint failed: z_reports.z_no/);
  });
});

// ------------------------------------------------------------------------------------------------ V-3 audit refold

const WALL = 1_761_000_000_000;

function bootDir(): { configPath: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-0023-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const dataDir = join(dir, 'data');
  mkdirSync(dataDir);
  const configPath = join(dir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      cloud_base_url: 'https://cloud.example',
      http_port: 3000,
      data_dir: dataDir,
      backup_dir: dataDir,
      min_client_version: '1.0.0',
      backup_encryption_key: Buffer.alloc(32, 7).toString('base64'),
      advertised_host: '192.168.10.2',
      provisioned: { tenant_id: 'tenant-a', branch_id: 'branch-1', branch_name: 'Main', branch_api_key: 'test-branch-api-key' },
    }),
  );
  return { configPath, dbPath: join(dataDir, 'hub.sqlite') };
}

type Deps = Awaited<ReturnType<typeof boot>>['deps'];
async function bootOnce(configPath: string, wall: number, body: (deps: Deps) => void = () => undefined): Promise<void> {
  const booted = await boot({ configPath, wallNow: () => wall, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
  try {
    body(booted.deps);
  } finally {
    await booted.stop();
  }
}

/** 04-mapped events and 02a BillRequested events through the writer (no branch config needed). */
function appendHistory(deps: Deps, n: number): void {
  const at = deps.clock.branchNow();
  deps.writer.run((tx) =>
    tx.append([
      { stream_type: 'staff', stream_id: `S_WAIT${n}`, event_type: 'PinLockoutCleared', schema_version: 1, payload: { subject_type: 'staff', subject_id: `S_WAIT${n}` }, occurred_at: at, actor_id: 'S_MGR', device_id: 'D1' },
      { stream_type: 'table', stream_id: `T${n}`, event_type: 'BillRequested', schema_version: 1, payload: { seating_id: `SEAT${n}`, table_id: `T${n}`, by_staff_id: 'S_ALI' }, occurred_at: at, actor_id: 'S_ALI', device_id: 'D1' },
      { stream_type: 'stock', stream_id: `I${n}`, event_type: 'ItemMadeAvailable', schema_version: 1, payload: { item_id: `I${n}` }, occurred_at: at, actor_id: 'S_MGR', device_id: 'D1' },
    ]),
  );
}

/**
 * Stand-in for 05's own `bill_requested` map (task 32a, §6.30): registered at startup, before the projection is built.
 * Its shape does not matter here — the subject is that a mapping of an event type with history refolds (V-3).
 */
const mapBillRequested = (): void =>
  registerAuditAction('BillRequested', (e) => ({ action: 'bill_requested', subject_type: 'table', subject_id: String(e.payload['seating_id']) }));

const auditRows = (db: Database.Database): Row[] => db.prepare('SELECT * FROM audit_entries ORDER BY seq').all() as Row[];
const seqsOf = (db: Database.Database, type: string): number[] => db.prepare('SELECT seq FROM events WHERE event_type = ? ORDER BY seq').pluck().all(type) as number[];
const auditCheckpoint = (db: Database.Database): number | undefined =>
  db.prepare("SELECT last_seq FROM projection_checkpoints WHERE projection = 'audit'").pluck().get() as number | undefined;

/** Back to a pre-0023 hub (as 0022 left it): 0023's tables gone, its checksum row gone, user_version 22; checkpoints kept. */
function toPre0023(db: Database.Database): void {
  dropBilling0023(db);
  db.prepare('DELETE FROM migration_checksums WHERE version >= 23').run();
  db.pragma('user_version = 22');
}

describe('[05 #87 rebuild half] [04 v1.0.7 V-3] 0023 deletes the audit checkpoint: rebuild = live, with old BillRequested events', () => {
  it('[05 #87, V-3, H1-8] a pre-0023 hub with BillRequested history boots onto 0023 with the map registered: old BillRequested rows appear, every earlier row is unchanged; a later rebuild equals the live log', async () => {
    const { configPath, dbPath } = bootDir();
    await bootOnce(configPath, WALL, (deps) => appendHistory(deps, 1)); // boot 1: BillRequested has no audit map yet

    const pre = openDb(dbPath);
    toPre0023(pre);
    const before = auditRows(pre);
    const oldBillRequested = seqsOf(pre, 'BillRequested');
    expect(oldBillRequested).toHaveLength(1);
    expect(before.map((r) => r['action'])).not.toContain('bill_requested');
    expect(before.map((r) => r['action'])).toEqual(expect.arrayContaining(['pin_lockout_cleared', 'item_availability_set']));
    expect(auditCheckpoint(pre), 'the pre-0023 audit checkpoint is at the head').toBe(pre.prepare('SELECT MAX(seq) FROM events').pluck().get());
    pre.close();

    resetAuditActions(); // a new process: boot 1's projection sealed this one's registry
    mapBillRequested();
    let live: Row[] = [];
    await bootOnce(configPath, WALL + 30_000, (deps) => {
      const db = deps.db;
      expect(db.pragma('user_version', { simple: true })).toBe(24);
      const rows = auditRows(db);
      expect(rows.filter((r) => r['action'] === 'bill_requested').map((r) => r['seq']), 'the old BillRequested is in the log').toEqual(oldBillRequested);
      expect(rows.filter((r) => r['action'] !== 'bill_requested'), 'every earlier row, column for column').toEqual(before);
      appendHistory(deps, 2); // live, with the map in force
      live = auditRows(db);
      expect(live.filter((r) => r['action'] === 'bill_requested').map((r) => r['seq'])).toEqual(seqsOf(db, 'BillRequested'));
      expect(auditCheckpoint(db)).toBe(db.prepare('SELECT MAX(seq) FROM events').pluck().get());
    });

    const again = openDb(dbPath);
    again.prepare("DELETE FROM projection_checkpoints WHERE projection = 'audit'").run(); // force a full rebuild
    again.close();
    resetAuditActions();
    mapBillRequested();
    await bootOnce(configPath, WALL + 60_000, (deps) => {
      const rebuilt = auditRows(deps.db);
      const liveSeqs = new Set(live.map((r) => r['seq']));
      expect(rebuilt.filter((r) => liveSeqs.has(r['seq'])), 'rebuild = live, row for row').toEqual(live);
      expect(rebuilt.filter((r) => !liveSeqs.has(r['seq'])).map((r) => r['action']), 'only boot 3\'s own new events follow').not.toContain('bill_requested');
    });
  });
});
