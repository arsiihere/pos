/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildReceiptDoc, type DocContext, type FiscalSaleInvoiceFields, type FiscalSnapshot } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import {
  answerTransition,
  canCredit,
  insertOutboxRow,
  outboxRowFor,
  type FiscalRowState,
  type FiscalRowTransition,
  type OutboxInvoice,
  type OutboxRow,
} from '../../../src/billing/fiscal/outbox';
import { registerFiscalAdapter, resetFiscalAdapters, type FiscalAnswer } from '../../../src/billing/fiscal/port';
import { T } from '../../../src/lib/clock';
import { aSubmission, fakeAdapter } from './fake-adapter';
import { fiscalDdlText, freshOutboxDb, type OutboxDb } from './outbox-db';

const specPath = fileURLToPath(new URL('../../../../../docs/specs/05_Billing_Spec_v1.0.7.md', import.meta.url));

type Column = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };

let open: OutboxDb[] = [];
afterEach(() => {
  for (const fx of open) fx.cleanup();
  open = [];
  resetFiscalAdapters();
});
async function db(): Promise<OutboxDb> {
  const fx = await freshOutboxDb();
  open.push(fx);
  return fx;
}

function columns(fx: OutboxDb, table: string): Column[] {
  return fx.db.prepare(`PRAGMA table_info(${table})`).all() as Column[];
}

const lf = (t: string): string => t.replace(/\r\n/g, '\n');

/** One block of `text`: from the line starting with `first` (searched after `after`) to the first `last` line. */
function block(text: string, first: string, last: (line: string) => boolean, after = 0): string {
  const lines = lf(text).split('\n');
  const start = lines.findIndex((l, i) => i >= after && l.startsWith(first));
  expect(start, first).toBeGreaterThan(-1);
  const end = lines.findIndex((l, i) => i > start && last(l));
  expect(end, first).toBeGreaterThan(start);
  return lines.slice(start, end + 1).join('\n');
}
const OUTBOX_FIRST = 'CREATE TABLE fiscal_outbox (';
const OUTBOX_LAST = (l: string): boolean => l.startsWith('CREATE INDEX fiscal_outbox_rejected');   // 05 v1.0.7 (task 6 review): the block now ends with the rejected index
const CREDS_FIRST = 'CREATE TABLE fiscal_credentials (';
const CREDS_LAST = (l: string): boolean => l === ');';

/** The spec §5 text of a block, searched only inside §5. */
function specBlock(first: string, last: (line: string) => boolean): string {
  const spec = lf(readFileSync(specPath, 'utf8'));
  const section = spec.split('\n').findIndex((l) => l.startsWith('## §5. Data model'));
  expect(section).toBeGreaterThan(-1);
  return block(spec, first, last, section);
}

/** Every schema object (tables, indexes incl. autoindexes) of the two fiscal tables. */
function fiscalObjects(fx: OutboxDb): string[] {
  return (
    fx.db
      .prepare("SELECT name FROM sqlite_master WHERE tbl_name IN ('fiscal_outbox', 'fiscal_credentials') ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}
const FISCAL_OBJECTS = [
  'fiscal_credentials',
  'fiscal_outbox',
  'fiscal_outbox_pending',
  'fiscal_outbox_rejected',
  'sqlite_autoindex_fiscal_credentials_1',
  'sqlite_autoindex_fiscal_outbox_1',
];

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    invoice_id: 'inv-1',
    ord: 1,
    ref_invoice_id: null,
    jurisdiction_id: 'PK',
    adapter_key: 'none',
    pos_id: null,
    state: 'not_required',
    queued_at: T,
    ...over,
  };
}
const INSERT =
  'INSERT INTO fiscal_outbox (invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at) ' +
  'VALUES (@invoice_id, @ord, @ref_invoice_id, @jurisdiction_id, @adapter_key, @pos_id, @state, @queued_at)';

describe('[05 task 6] fiscal DDL in migration 0023 (§5, B20, B22)', () => {
  it('[05 §5] the fiscal DDL holds the spec §5 fiscal_outbox, fiscal_outbox_pending, fiscal_outbox_rejected and fiscal_credentials text verbatim', () => {
    const ddl = fiscalDdlText();
    expect(block(ddl, OUTBOX_FIRST, OUTBOX_LAST)).toBe(specBlock(OUTBOX_FIRST, OUTBOX_LAST));
    expect(block(ddl, CREDS_FIRST, CREDS_LAST)).toBe(specBlock(CREDS_FIRST, CREDS_LAST));
  });

  it('[05 §5] the fiscal DDL creates exactly the two tables, their primary keys, fiscal_outbox_pending and (v1.0.7) fiscal_outbox_rejected', async () => {
    const fx = await db();
    expect(fiscalObjects(fx)).toEqual(FISCAL_OBJECTS);
  });

  it('[05 §5] fiscal_outbox columns, types, NOT NULL, defaults and primary key', async () => {
    const fx = await db();
    expect(columns(fx, 'fiscal_outbox')).toEqual([
      { cid: 0, name: 'invoice_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 1 },
      { cid: 1, name: 'ord', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 2, name: 'ref_invoice_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { cid: 3, name: 'jurisdiction_id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 4, name: 'adapter_key', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 5, name: 'pos_id', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { cid: 6, name: 'state', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 7, name: 'queued_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 8, name: 'acked_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
      { cid: 9, name: 'attempts', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 },
      { cid: 10, name: 'next_try_at', type: 'INTEGER', notnull: 1, dflt_value: '0', pk: 0 },
      { cid: 11, name: 'last_error', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
      { cid: 12, name: 'in_flight_at', type: 'INTEGER', notnull: 0, dflt_value: null, pk: 0 },
    ]);
  });

  it('[05 §5] fiscal_outbox state CHECK accepts exactly pending, acked, rejected, not_required', async () => {
    const fx = await db();
    const insert = fx.db.prepare(INSERT);
    ['pending', 'acked', 'rejected', 'not_required'].forEach((state, i) =>
      insert.run(row({ invoice_id: `inv-${i}`, ord: i + 1, state })),
    );
    for (const state of ['sent', 'failed', 'PENDING', '']) {
      expect(() => insert.run(row({ invoice_id: `bad-${state}`, state }))).toThrow(/CHECK constraint failed/);
    }
    expect(() => insert.run(row({ invoice_id: 'null-state', state: null }))).toThrow(/NOT NULL/);
    const n = fx.db.prepare('SELECT COUNT(*) AS n FROM fiscal_outbox').get() as { n: number };
    expect(n.n).toBe(4);
  });

  it('[05 §5] fiscal_outbox worker columns default to attempts 0, next_try_at 0, no error, not in flight', async () => {
    const fx = await db();
    fx.db.prepare(INSERT).run(row({ state: 'pending', adapter_key: 'fake', pos_id: 'POS-1' }));
    expect(fx.db.prepare('SELECT attempts, next_try_at, last_error, in_flight_at, acked_at FROM fiscal_outbox').get()).toEqual({
      attempts: 0,
      next_try_at: 0,
      last_error: null,
      in_flight_at: null,
      acked_at: null,
    });
  });

  it('[05 §5] fiscal_outbox primary key invoice_id: a second insert fails, INSERT OR IGNORE keeps the first row', async () => {
    const fx = await db();
    fx.db.prepare(INSERT).run(row({ ord: 7 }));
    expect(() => fx.db.prepare(INSERT).run(row({ ord: 8 }))).toThrow(/UNIQUE constraint failed: fiscal_outbox.invoice_id/);
    fx.db.prepare(INSERT.replace('INSERT INTO', 'INSERT OR IGNORE INTO')).run(row({ ord: 9, state: 'pending' }));
    expect(fx.db.prepare('SELECT ord, state FROM fiscal_outbox').all()).toEqual([{ ord: 7, state: 'not_required' }]);
  });

  it('[05 §5] INSERT OR IGNORE also swallows CHECK and NOT NULL failures (so 28a validates a row before inserting)', async () => {
    const fx = await db();
    const ignore = fx.db.prepare(INSERT.replace('INSERT INTO', 'INSERT OR IGNORE INTO'));
    expect(ignore.run(row({ invoice_id: 'bad-state', state: 'sent' })).changes).toBe(0);
    expect(ignore.run(row({ invoice_id: 'bad-null', jurisdiction_id: null })).changes).toBe(0);
    expect(fx.db.prepare('SELECT COUNT(*) AS n FROM fiscal_outbox').get()).toEqual({ n: 0 });
  });

  it('[05 §5] fiscal_outbox_pending is a partial index on (ord) WHERE state = pending, used by the worker head', async () => {
    const fx = await db();
    const list = fx.db.prepare('PRAGMA index_list(fiscal_outbox)').all() as { name: string; unique: number; partial: number }[];
    const idx = list.find((i) => i.name === 'fiscal_outbox_pending');
    expect(idx).toMatchObject({ unique: 0, partial: 1 });
    expect((fx.db.prepare('PRAGMA index_info(fiscal_outbox_pending)').all() as { name: string }[]).map((c) => c.name)).toEqual([
      'ord',
    ]);
    const sql = (fx.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'fiscal_outbox_pending'").get() as { sql: string })
      .sql;
    expect(sql).toBe("CREATE INDEX fiscal_outbox_pending ON fiscal_outbox (ord) WHERE state = 'pending'");
    // The worker head (all pending, and per pos_id). SQLite matches a partial index only when the query
    // writes the literal `state = 'pending'`, never a bound parameter — 29a's queries must do the same.
    for (const [query, args] of [
      ["SELECT invoice_id FROM fiscal_outbox WHERE state = 'pending' ORDER BY ord LIMIT 1", []],
      ["SELECT invoice_id FROM fiscal_outbox WHERE state = 'pending' AND pos_id = ? ORDER BY ord LIMIT 1", ['POS-1']],
    ] as const) {
      const plan = (fx.db.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...args) as { detail: string }[]).map((p) => p.detail);
      expect(plan.join(' | '), query).toMatch(/USING (COVERING )?INDEX fiscal_outbox_pending/);
      expect(plan.join(' | '), query).not.toMatch(/TEMP B-TREE/);
    }
  });

  it('[05 §5, B22] fiscal_credentials columns, name default token, primary key (pos_id, name)', async () => {
    const fx = await db();
    expect(columns(fx, 'fiscal_credentials')).toEqual([
      { cid: 0, name: 'pos_id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
      { cid: 1, name: 'name', type: 'TEXT', notnull: 1, dflt_value: "'token'", pk: 2 },
      { cid: 2, name: 'token', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 3, name: 'set_at', type: 'INTEGER', notnull: 1, dflt_value: null, pk: 0 },
      { cid: 4, name: 'set_by_staff_id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 0 },
    ]);
    const ins = fx.db.prepare('INSERT INTO fiscal_credentials (pos_id, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?)');
    ins.run('POS-1', 'test-token', T, 'staff-1');
    expect(fx.db.prepare('SELECT name FROM fiscal_credentials').get()).toEqual({ name: 'token' });
    expect(() => ins.run('POS-1', 'test-token', T, 'staff-1')).toThrow(
      /UNIQUE constraint failed: fiscal_credentials.pos_id, fiscal_credentials.name/,
    );
    // H10-5: a second credential name for one pos_id is a second row.
    fx.db
      .prepare('INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, ?)')
      .run('POS-1', 'device_key', 'test-token', T, 'staff-1');
    expect(fx.db.prepare('SELECT COUNT(*) AS n FROM fiscal_credentials').get()).toEqual({ n: 2 });
  });
});

// ---- 28a: outbox rows, credit rule, answer transitions (§3.15, B20, H6-8, H9-6) ----

const PRA_SNAPSHOT: FiscalSnapshot = {
  adapter_key: 'PRA',
  pos_id: 'POS-1',
  required: true,
  capabilities: { ordering: 'strict_per_pos_id', credit: true },
  credit_support: 'credit_invoice',
  rounding: { step_minor: 100, mode: 'nearest', applies_to: 'all' },
  receipt: {
    fiscal_number_label: 'PRA invoice no.',
    tax_reg_labels: [{ code: 'NTN', label: 'NTN' }],
    show_qr: true,
    qr_url_template: 'https://example.test/verify/{fiscal_number}',
    buyer_id_on_receipt: true,
  },
  seller_registrations: [{ code: 'NTN', number: '1234567' }],
  payment_codes: [{ payment_id: 'pay-1', authority_code: '1' }],
};
/** The `PK` jurisdiction (adapter `none`): nothing fiscal. */
const PK_SNAPSHOT: FiscalSnapshot = {
  ...PRA_SNAPSHOT,
  adapter_key: 'none',
  pos_id: null,
  required: false,
  capabilities: { ordering: 'none', credit: true },
  receipt: { fiscal_number_label: null, tax_reg_labels: [], show_qr: false, qr_url_template: null, buyer_id_on_receipt: false },
  seller_registrations: [],
  payment_codes: [{ payment_id: 'pay-1', authority_code: null }],
};

function sale(id: string, jurisdiction_id: string, fiscal: FiscalSnapshot, issued_at = T): OutboxInvoice {
  return { invoice_id: id, series: 'sale', issued_at, jurisdiction_id, fiscal };
}
function credit(id: string, ref: string, jurisdiction_id: string, fiscal: FiscalSnapshot, issued_at = T + 1000): OutboxInvoice {
  return { invoice_id: id, series: 'credit', ref_invoice_id: ref, issued_at, jurisdiction_id, fiscal };
}
function rows(fx: OutboxDb): unknown[] {
  return fx.db
    .prepare('SELECT invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at, attempts FROM fiscal_outbox ORDER BY ord')
    .all();
}

describe('[05 task 28a] outbox rows (§3.15, B20)', () => {
  it('[05 #69 outbox-row half] adapter none → not_required; a fiscalized snapshot → pending under its jurisdiction, adapter and pos_id', () => {
    expect(outboxRowFor(sale('inv-1', 'PK', PK_SNAPSHOT), 11)).toEqual({
      invoice_id: 'inv-1',
      ord: 11,
      ref_invoice_id: null,
      jurisdiction_id: 'PK',
      adapter_key: 'none',
      pos_id: null,
      state: 'not_required',
      queued_at: T,
    });
    expect(outboxRowFor(sale('inv-2', 'PK-PB', PRA_SNAPSHOT), 12)).toEqual({
      invoice_id: 'inv-2',
      ord: 12,
      ref_invoice_id: null,
      jurisdiction_id: 'PK-PB',
      adapter_key: 'PRA',
      pos_id: 'POS-1',
      state: 'pending',
      queued_at: T,
    });
    // Adapter none is never fiscalized, even if a snapshot claimed `required`.
    expect(outboxRowFor(sale('inv-3', 'PK', { ...PK_SNAPSHOT, required: true }), 13).state).toBe('not_required');
  });

  it('[05 P0.19a §3.1, R-8] required under a real (test fake) adapter → pending; adapter none → not_required whatever required says', () => {
    const fake = fakeAdapter().key;
    const testSnapshot: FiscalSnapshot = { ...PRA_SNAPSHOT, adapter_key: fake };
    expect(outboxRowFor(sale('inv-t', 'TEST', testSnapshot), 21)).toMatchObject({ state: 'pending', adapter_key: fake, pos_id: 'POS-1' });
    expect(outboxRowFor(sale('inv-t2', 'TEST', { ...testSnapshot, required: false }), 22).state).toBe('not_required');
    expect(outboxRowFor(sale('inv-n', 'PK', { ...PK_SNAPSHOT, required: true }), 23).state).toBe('not_required');
  });

  it('[05 P0.19a G-1] outboxRowFor is pending iff the receipt shows the fiscal block (same snapshot, both builders agree)', () => {
    const fake = fakeAdapter().key;
    const ctx: DocContext = {
      width_cols: 48,
      currency_exponent: 2,
      utc_offset_ms: 0,
      branch_name: 'B',
      template: {
        header_lines: [],
        footer_lines: [],
        show: { tax_reg_no: false, address: false, phone: false, cashier: false, order_no: false, bill_no: false },
        address: null,
        phone: null,
      },
    };
    const snapshots: FiscalSnapshot[] = [
      { ...PRA_SNAPSHOT, adapter_key: fake, required: true },
      { ...PRA_SNAPSHOT, adapter_key: fake, required: false },
      { ...PK_SNAPSHOT, required: true },
      { ...PK_SNAPSHOT, required: false },
    ];
    for (const [i, fiscal] of snapshots.entries()) {
      const invoice: FiscalSaleInvoiceFields = {
        series: 'sale',
        invoice_id: `inv-${i}`,
        invoice_ref: `S${i}`,
        issued_at: T,
        order_type: 'dine_in',
        jurisdiction_id: 'J',
        currency_code: 'PKR',
        prices_include_tax: false,
        lines: [],
        service_charge: null,
        subtotal_minor: 0,
        discount_minor: 0,
        taxes: [],
        rounding_minor: 0,
        total_minor: 0,
        payment_ids: [],
        buyer_id_refused: false,
        fiscal,
      };
      const doc = buildReceiptDoc(
        { invoice, payments: [], change_minor: 0, cashier_name: null, order_label: null, bill_label: null, fiscal_number: null, is_reprint: false },
        ctx,
      );
      const block = doc.blocks.some((b) => 'text' in b && b.text.includes('FISCAL NUMBER PENDING'));
      expect(block, `${fiscal.adapter_key} × required ${String(fiscal.required)}`).toBe(outboxRowFor(invoice, i + 1).state === 'pending');
    }
  });

  it('[05 #69 outbox-row half] a non-fiscalized order type (delivery, Q17) → not_required under a fiscal adapter', () => {
    // The close sets fiscal.required = false for an order type with fiscalize: false (H8-3).
    const delivery = { ...PRA_SNAPSHOT, required: false };
    expect(outboxRowFor(sale('inv-d', 'PK-PB', delivery), 5)).toMatchObject({ state: 'not_required', adapter_key: 'PRA' });
  });

  it('[05 #69 outbox-row half, #78 row half] PK → PK-PB: rows follow each snapshot (earlier PK not_required, later PK-PB pending; the switched_at decision is the close\'s, task 17)', async () => {
    const fx = await db();
    const switchedAt = T + 60_000;
    // Issued before switched_at: the snapshot in force was PK (adapter none).
    insertOutboxRow(fx.db, outboxRowFor(sale('inv-early', 'PK', PK_SNAPSHOT, switchedAt - 1), 1));
    insertOutboxRow(fx.db, outboxRowFor(sale('inv-late', 'PK-PB', PRA_SNAPSHOT, switchedAt + 1), 2));
    expect(rows(fx)).toEqual([
      { invoice_id: 'inv-early', ord: 1, ref_invoice_id: null, jurisdiction_id: 'PK', adapter_key: 'none', pos_id: null, state: 'not_required', queued_at: switchedAt - 1, attempts: 0 },
      { invoice_id: 'inv-late', ord: 2, ref_invoice_id: null, jurisdiction_id: 'PK-PB', adapter_key: 'PRA', pos_id: 'POS-1', state: 'pending', queued_at: switchedAt + 1, attempts: 0 },
    ]);
  });

  it('[05 #69 outbox-row half] a fiscalized sale without a pos_id is refused (never a pending row the worker cannot send)', () => {
    expect(() => outboxRowFor(sale('inv-x', 'PK-PB', { ...PRA_SNAPSHOT, pos_id: null }), 1)).toThrow(/needs a pos_id/);
  });

  it('[05 #69 outbox-row half, #88] insertOutboxRow is INSERT OR IGNORE: a replayed fold writes nothing and changes nothing', async () => {
    const fx = await db();
    const row = outboxRowFor(sale('inv-1', 'PK-PB', PRA_SNAPSHOT), 7);
    expect(insertOutboxRow(fx.db, row)).toBe(true);
    fx.db.prepare("UPDATE fiscal_outbox SET attempts = 2, last_error = 'timeout' WHERE invoice_id = 'inv-1'").run();
    expect(insertOutboxRow(fx.db, { ...row, ord: 99, state: 'not_required' })).toBe(false);
    expect(fx.db.prepare('SELECT ord, state, attempts, last_error FROM fiscal_outbox').all()).toEqual([
      { ord: 7, state: 'pending', attempts: 2, last_error: 'timeout' },
    ]);
  });

  it('[05 #69 outbox-row half, B20] insertOutboxRow throws on a row OR IGNORE would silently drop', async () => {
    const fx = await db();
    const good = outboxRowFor(sale('inv-1', 'PK-PB', PRA_SNAPSHOT), 1);
    const bad: Record<string, unknown>[] = [
      { state: 'sent' },
      { jurisdiction_id: null },
      { jurisdiction_id: '' },
      { adapter_key: null },
      { invoice_id: null },
      { ord: 1.5 },
      { ord: '1' },
      { queued_at: null },
      { pos_id: '' },
      { ref_invoice_id: '' },
      { adapter_key: '' },
      { queued_at: -1 },
    ];
    for (const over of bad) {
      expect(() => insertOutboxRow(fx.db, { ...good, ...over } as OutboxRow), JSON.stringify(over)).toThrow(/invalid fiscal_outbox row/);
    }
    expect(rows(fx)).toEqual([]);
  });

  it('[05 #69 outbox-row half] a rolled-back transaction leaves no outbox row', async () => {
    const fx = await db();
    const close = fx.db.transaction(() => {
      insertOutboxRow(fx.db, outboxRowFor(sale('inv-1', 'PK-PB', PRA_SNAPSHOT), 1));
      throw new Error('commit failed');
    });
    expect(() => close.immediate()).toThrow('commit failed');
    expect(rows(fx)).toEqual([]);
  });

  it('[05 #78 credit-rule half, H6-8, H9-6] a credit follows its original: jurisdiction, adapter and pos_id, even after a switch', async () => {
    const fx = await db();
    const original = outboxRowFor(sale('inv-1', 'PK-PB', PRA_SNAPSHOT), 1);
    insertOutboxRow(fx.db, original);
    // Credited after the branch switched back to PK, from a device that maps to another pos_id: the credit
    // copies the original's jurisdiction and snapshot (§6.13, H9-6), and the row is the original's.
    const row = outboxRowFor(credit('cr-1', 'inv-1', 'PK-PB', PRA_SNAPSHOT), 2, original);
    expect(row).toEqual({
      invoice_id: 'cr-1',
      ord: 2,
      ref_invoice_id: 'inv-1',
      jurisdiction_id: 'PK-PB',
      adapter_key: 'PRA',
      pos_id: 'POS-1',
      state: 'pending',
      queued_at: T + 1000,
    });
    insertOutboxRow(fx.db, row);
    expect((rows(fx) as { invoice_id: string }[]).map((r) => r.invoice_id)).toEqual(['inv-1', 'cr-1']);
    // Defensive: even a credit whose fields named today's setting (a task-19 bug) is routed by its original's row.
    const today = { ...PK_SNAPSHOT, pos_id: 'POS-9' };
    expect(outboxRowFor(credit('cr-2', 'inv-1', 'PK', today), 3, original)).toMatchObject({
      jurisdiction_id: 'PK-PB',
      adapter_key: 'PRA',
      pos_id: 'POS-1',
      state: 'pending',
    });
  });

  it('[05 #78 credit-rule half, H6-8] a credit state follows its original: not_required ↔ not_required; acked / pending / rejected → fiscalized', () => {
    const base = outboxRowFor(sale('inv-1', 'PK-PB', PRA_SNAPSHOT), 1);
    const states: [FiscalRowState, FiscalRowState][] = [
      ['not_required', 'not_required'],
      ['pending', 'pending'],
      ['acked', 'pending'],
      // A credit of a rejected original is queued and rejected by the worker after its original (§3.15 Order).
      ['rejected', 'pending'],
    ];
    for (const [orig, want] of states) {
      expect(outboxRowFor(credit('cr', 'inv-1', 'PK-PB', PRA_SNAPSHOT), 2, { ...base, state: orig }).state).toBe(want);
    }
    // An original issued under PK stays local even when the credit is made under PK-PB.
    const local = outboxRowFor(sale('inv-2', 'PK', PK_SNAPSHOT), 3);
    expect(outboxRowFor(credit('cr-2', 'inv-2', 'PK-PB', PRA_SNAPSHOT), 4, local)).toMatchObject({
      state: 'not_required',
      jurisdiction_id: 'PK',
      adapter_key: 'none',
      pos_id: null,
    });
  });

  it('[05 #78 credit-rule half] a credit needs its own original row; a sale takes none', () => {
    const original = outboxRowFor(sale('inv-1', 'PK-PB', PRA_SNAPSHOT), 1);
    expect(() => outboxRowFor(credit('cr', 'inv-1', 'PK-PB', PRA_SNAPSHOT), 2)).toThrow(/original outbox row missing/);
    expect(() => outboxRowFor(credit('cr', 'inv-OTHER', 'PK-PB', PRA_SNAPSHOT), 2, original)).toThrow(/not inv-OTHER/);
    expect(() => outboxRowFor(sale('inv-2', 'PK-PB', PRA_SNAPSHOT), 2, original)).toThrow(/a sale has no original/);
  });

  it('[05 #78b credit-rule half] canCredit = the original snapshot\'s capabilities.credit AND credit_support = credit_invoice', () => {
    expect(canCredit(PRA_SNAPSHOT)).toBe(true);
    expect(canCredit({ ...PRA_SNAPSHOT, capabilities: { ordering: 'strict_per_pos_id', credit: false } })).toBe(false);
    expect(canCredit({ ...PRA_SNAPSHOT, credit_support: 'none' })).toBe(false);
    expect(canCredit({ ...PRA_SNAPSHOT, capabilities: { ordering: 'none', credit: false }, credit_support: 'none' })).toBe(false);
    // Read from the original's snapshot only: a fake adapter registered today with credit = true does not matter.
    registerFiscalAdapter(fakeAdapter({ key: 'PRA', credit: true }));
    expect(canCredit({ ...PRA_SNAPSHOT, capabilities: { ordering: 'strict_per_pos_id', credit: false } })).toBe(false);
  });
});

describe('[05 task 28a] answer → row transition (§3.15, #74)', () => {
  const cases: [string, FiscalAnswer, FiscalRowTransition][] = [
    ['ok', { outcome: 'ok', fiscal_number: 'F-1', qr_payload: 'qr-1' }, { to: 'acked', fiscal_number: 'F-1', qr_payload: 'qr-1' }],
    ['retry', { outcome: 'retry', error_code: 'http_503' }, { to: 'retry', error_code: 'http_503' }],
    ['rejected', { outcome: 'rejected', error_code: 'http_400', http_status: 400 }, { to: 'rejected', error_code: 'http_400', http_status: 400 }],
    ['duplicate with a number', { outcome: 'duplicate', fiscal_number: 'F-1' }, { to: 'acked', fiscal_number: 'F-1', qr_payload: null }],
    [
      'duplicate without a number',
      { outcome: 'duplicate', fiscal_number: null },
      { to: 'rejected', error_code: 'duplicate_no_number', http_status: null },
    ],
  ];

  // The core never branches on the adapter key: the same suite runs against fakes keyed FAKE and PRA.
  for (const key of ['FAKE', 'PRA']) {
    for (const [name, answer, want] of cases) {
      it(`[05 #74] ${name} answered by adapter ${key} gives §3.15's transition`, async () => {
        const fake = fakeAdapter({ key });
        fake.script(answer);
        const got = await fake.submitSale(aSubmission());
        expect(answerTransition(got)).toEqual(want);
      });
    }
  }

  it('[05 #74] outbox rows do not depend on the adapter key beyond none', () => {
    for (const key of ['FAKE', 'PRA', 'OTHER-X']) {
      const row = outboxRowFor(sale('inv-1', 'TEST-J', { ...PRA_SNAPSHOT, adapter_key: key }), 1);
      expect(row).toMatchObject({ state: 'pending', adapter_key: key, pos_id: 'POS-1' });
    }
  });

  it('[05 #74] the core fiscal files hold no adapter key literal but none', () => {
    for (const file of ['outbox.ts', 'port.ts']) {
      const raw = readFileSync(fileURLToPath(new URL(`../../../src/billing/fiscal/${file}`, import.meta.url)), 'utf8');
      // Code only: §3.15's own comments name 'PRA' as an example key.
      const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/['"`](PRA|PK-PB|FBR|SRB|KPRA|BRA)['"`]/);
    }
  });
});
