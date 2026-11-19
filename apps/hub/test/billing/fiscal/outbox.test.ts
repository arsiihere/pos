/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../../src/db/migrate';
import { fixedClock, T } from '../../../src/lib/clock';
import { freshDb } from '../../helpers/db';
import { fiscalDdlText, freshOutboxDb, migrationsDir, stagedDdlPath, type OutboxDb } from './outbox-db';

const specPath = fileURLToPath(new URL('../../../../../docs/specs/05_Billing_Spec_v1.0.md', import.meta.url));

type Column = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };

let open: OutboxDb[] = [];
afterEach(() => {
  for (const fx of open) fx.cleanup();
  open = [];
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
const OUTBOX_LAST = (l: string): boolean => l.startsWith('CREATE INDEX fiscal_outbox_pending');
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
function schemaNames(fx: { db: OutboxDb['db'] }): string[] {
  return (fx.db.prepare('SELECT name FROM sqlite_master ORDER BY name').all() as { name: string }[]).map((r) => r.name);
}
const FISCAL_OBJECTS = [
  'fiscal_credentials',
  'fiscal_outbox',
  'fiscal_outbox_pending',
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

describe('[05 task 6a] staged fiscal DDL (§5, B20, B22; plan PL-13)', () => {
  it('[05 §5] the fiscal DDL holds the spec §5 fiscal_outbox, fiscal_outbox_pending and fiscal_credentials text verbatim', () => {
    const ddl = fiscalDdlText();
    expect(block(ddl, OUTBOX_FIRST, OUTBOX_LAST)).toBe(specBlock(OUTBOX_FIRST, OUTBOX_LAST));
    expect(block(ddl, CREDS_FIRST, CREDS_LAST)).toBe(specBlock(CREDS_FIRST, CREDS_LAST));
  });

  it('[05 §5] the fiscal DDL creates exactly the two tables, their primary keys and fiscal_outbox_pending', async () => {
    const fx = await db();
    expect(fiscalObjects(fx)).toEqual(FISCAL_OBJECTS);
  });

  it.runIf(stagedDdlPath !== null)('[05 §5, PL-13] staged: the file holds only the two §5 blocks and comments', () => {
    let rest = lf(fiscalDdlText());
    rest = rest.replace(block(rest, OUTBOX_FIRST, OUTBOX_LAST), '').replace(block(rest, CREDS_FIRST, CREDS_LAST), '');
    expect(rest.split('\n').filter((l) => l.trim() !== '' && !l.trimStart().startsWith('--'))).toEqual([]);
  });

  it.runIf(stagedDdlPath !== null)('[05 §5, PL-13] staged: the migration runner never reads the file, and it adds nothing else', async () => {
    const path = stagedDdlPath!;
    expect(dirname(path)).not.toBe(migrationsDir);
    expect(readdirSync(migrationsDir)).not.toContain(basename(path));
    const fx = freshDb();
    try {
      await runMigrations(fx.db, { dir: migrationsDir, clock: fixedClock(T) });
      const migrated = schemaNames(fx);
      expect(migrated.filter((n) => FISCAL_OBJECTS.includes(n))).toEqual([]);
      const staged = await db();
      expect(schemaNames(staged).filter((n) => !migrated.includes(n))).toEqual(FISCAL_OBJECTS);
    } finally {
      fx.cleanup();
    }
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
