import { afterEach, describe, expect, it } from 'vitest';
import { insertOutboxRow, type OutboxRow } from '../../../src/billing/fiscal/outbox';
import type { FiscalAdapter } from '../../../src/billing/fiscal/port';
import {
  BACKOFF_MS,
  FISCAL_LOOP_MS,
  HEALTH_EVERY_MS,
  backoffMs,
  fiscalAdapterHealth,
  resetFiscalWorker,
  runOnce,
  shortCode,
  startFiscalWorker,
  type FiscalFinalAnswer,
  type FiscalTimers,
  type FiscalWorkerDeps,
  type FiscalWorkRow,
  type LoadedSubmission,
} from '../../../src/billing/fiscal/worker';
import { fixedClock, T } from '../../../src/lib/clock';
import { createLogCapture } from '../../helpers/log-capture';
import { aSubmission, fakeAdapter, type FakeAdapter } from './fake-adapter';
import { freshOutboxDb, type OutboxDb } from './outbox-db';

// Markers that must never reach a log line (#77): the token, a buyer's name and tax ID, a request body field.
const TOKEN = 'test-token';
const BUYER_NAME = 'BUYER-NAME-MARKER';
const BUYER_ID = 'BUYER-ID-MARKER';

let open: OutboxDb[] = [];
afterEach(() => {
  for (const fx of open) fx.cleanup();
  open = [];
  resetFiscalWorker();
});

type Harness = {
  fx: OutboxDb;
  clock: ReturnType<typeof fixedClock>;
  deps: FiscalWorkerDeps;
  /** committed answers (the fake onAnswer = 29b's writer tx + the fold's state change) */
  committed: { invoice_id: string; answer: FiscalFinalAnswer }[];
  logs(): string;
  /** make the next onAnswer calls throw (fault injection: crash before the commit) */
  failCommits(n: number): void;
  add(row: Partial<OutboxRow> & { invoice_id: string; ord: number }): void;
  setToken(pos_id: string, name?: string, token?: string): void;
  row(invoice_id: string): Record<string, unknown>;
};

async function harness(adapters: FiscalAdapter[]): Promise<Harness> {
  const fx = await freshOutboxDb();
  open.push(fx);
  const clock = fixedClock(T);
  const committed: Harness['committed'] = [];
  const cap = createLogCapture();
  const line = (level: string) => (obj: Record<string, unknown>, msg?: string) =>
    cap.stream.write(`${JSON.stringify({ level, msg, ...obj })}\n`);
  let failing = 0;
  const byKey = new Map(adapters.map((a) => [a.key, a]));
  const deps: FiscalWorkerDeps = {
    db: fx.db,
    clock,
    adapterFor: (key) => byKey.get(key) ?? null,
    loadSubmission: (row: FiscalWorkRow): LoadedSubmission => {
      const full = aSubmission();
      const base: Omit<typeof full, 'idempotency_key' | 'credentials' | 'pos_id' | 'jurisdiction_id'> = {
        currency_code: full.currency_code,
        currency_exponent: full.currency_exponent,
        prices_include_tax: full.prices_include_tax,
        seller: full.seller,
        config: full.config,
        invoice: full.invoice,
      };
      const ref = `REF-${row.invoice_id}`;
      return {
        ok: true,
        submission: {
          ...base,
          invoice: {
            ...base.invoice,
            invoice_ref: ref,
            buyer: { name: BUYER_NAME, tax_id: { type: 'TEST', value: BUYER_ID } },
          },
        },
        original: row.ref_invoice_id === null ? null : { invoice_ref: `REF-${row.ref_invoice_id}`, fiscal_number: 'F-orig', issued_at: T },
      };
    },
    onAnswer: (row, answer) => {
      if (failing > 0) {
        failing -= 1;
        throw new Error(`crash before commit ${TOKEN}`);
      }
      committed.push({ invoice_id: row.invoice_id, answer });
      const acked = answer.outcome === 'ok' || (answer.outcome === 'duplicate' && answer.fiscal_number !== null);
      fx.db
        .prepare('UPDATE fiscal_outbox SET state = ?, acked_at = ? WHERE invoice_id = ?')
        .run(acked ? 'acked' : 'rejected', acked ? clock.branchNow() : null, row.invoice_id);
    },
    log: { info: line('info'), error: line('error') },
  };
  return {
    fx,
    clock,
    deps,
    committed,
    logs: cap.text,
    failCommits: (n) => {
      failing = n;
    },
    add: (r) =>
      insertOutboxRow(fx.db, {
        ref_invoice_id: null,
        jurisdiction_id: 'TEST-J',
        adapter_key: adapters[0]!.key,
        pos_id: 'POS-1',
        state: 'pending',
        queued_at: T,
        ...r,
      }),
    setToken: (pos_id, name = 'token', token = TOKEN) =>
      fx.db
        .prepare(
          `INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, 'staff-1')
           ON CONFLICT (pos_id, name) DO UPDATE SET token = excluded.token`,
        )
        .run(pos_id, name, token, T),
    row: (id) =>
      fx.db
        .prepare('SELECT state, attempts, next_try_at, last_error, in_flight_at FROM fiscal_outbox WHERE invoice_id = ?')
        .get(id) as Record<string, unknown>,
  };
}

const sentKeys = (a: FakeAdapter): string[] => a.calls.map((c) => c.sub.idempotency_key);

describe('[05 task 29a] fiscal worker skeleton (§3.15, B20, B21)', () => {
  it('[05 #70 same-key half] a crash between the answer and the onAnswer commit → the restart resends the same idempotency key; one commit', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'inv-1', ord: 1 });
    fake.script({ outcome: 'ok', fiscal_number: 'F-1', qr_payload: null }, { outcome: 'duplicate', fiscal_number: 'F-1' });
    h.failCommits(1);
    await runOnce(h.deps);
    expect(h.committed).toEqual([]);
    // Not committed: still pending and in flight, backing off like a retry.
    expect(h.row('inv-1')).toMatchObject({ state: 'pending', in_flight_at: T, attempts: 1, next_try_at: T + 5_000, last_error: 'answer_not_committed' });
    // "restart": a new process has no in-memory state; the row is still pending and in flight.
    resetFiscalWorker();
    h.clock.advance(BACKOFF_MS[0]);
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-inv-1', 'REF-inv-1']);
    expect(fake.calls.every((c) => c.sub.idempotency_key === c.sub.invoice.invoice_ref)).toBe(true);
    expect(h.committed).toEqual([{ invoice_id: 'inv-1', answer: { outcome: 'duplicate', fiscal_number: 'F-1' } }]);
    expect(h.row('inv-1')).toMatchObject({ state: 'acked', in_flight_at: null, last_error: null });
    await runOnce(h.deps);
    expect(fake.calls).toHaveLength(2);
  });

  it('[05 #71] strict_per_pos_id: a backing-off head of pos_id 1 holds only pos_id 1; pos_id 2 goes on', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.setToken('POS-2');
    h.add({ invoice_id: 'a1', ord: 1, pos_id: 'POS-1' });
    h.add({ invoice_id: 'a2', ord: 2, pos_id: 'POS-1' });
    h.add({ invoice_id: 'b1', ord: 3, pos_id: 'POS-2' });
    h.add({ invoice_id: 'b2', ord: 4, pos_id: 'POS-2' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    fake.script({ outcome: 'retry', error_code: 'timeout' });
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-a1', 'REF-b1', 'REF-b2']);
    expect(h.row('a2')).toMatchObject({ state: 'pending', attempts: 0 });
    await runOnce(h.deps); // a1 still backing off: a2 waits
    expect(fake.calls).toHaveLength(3);
    h.clock.advance(BACKOFF_MS[0]);
    await runOnce(h.deps);
    expect(sentKeys(fake).slice(3)).toEqual(['REF-a1', 'REF-a2']);
  });

  it('[05 #71] pos_id 2 with a missing credential never holds pos_id 1', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'b1', ord: 1, pos_id: 'POS-2' });
    h.add({ invoice_id: 'a1', ord: 2, pos_id: 'POS-1' });
    h.add({ invoice_id: 'b2', ord: 3, pos_id: 'POS-2' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-a1']);
    expect(h.row('b1')).toMatchObject({ state: 'pending', last_error: 'token_missing', attempts: 0 });
    expect(h.row('b2')).toMatchObject({ state: 'pending', last_error: null });
    h.setToken('POS-2');
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-a1', 'REF-b1', 'REF-b2']);
  });

  it('[05 #71] ordering none: a backing-off row holds nothing', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    h.add({ invoice_id: 'a2', ord: 2 });
    h.add({ invoice_id: 'a3', ord: 3 });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    fake.script({ outcome: 'retry', error_code: 'http_503' });
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-a1', 'REF-a2', 'REF-a3']);
    expect(h.row('a1')).toMatchObject({ state: 'pending', attempts: 1, last_error: 'http_503' });
    expect(h.row('a3')).toMatchObject({ state: 'acked' });
  });

  for (const ordering of ['strict_per_pos_id', 'none'] as const) {
    it(`[05 #71] ${ordering}: a credit waits for its original's answer and steps aside meanwhile`, async () => {
      const fake = fakeAdapter({ key: 'FAKE', ordering });
      const h = await harness([fake]);
      h.setToken('POS-1');
      h.setToken('POS-2');
      // The original waits for its answer on pos_id 2 behind a backing-off head (strict) or itself backs off (none).
      h.add({ invoice_id: 'head', ord: 1, pos_id: 'POS-2' });
      h.add({ invoice_id: 'orig', ord: 2, pos_id: 'POS-2' });
      h.add({ invoice_id: 'credit', ord: 3, pos_id: 'POS-2', ref_invoice_id: 'orig' });
      h.add({ invoice_id: 'other', ord: 4, pos_id: 'POS-1' });
      fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
      fake.script({ outcome: 'retry', error_code: 'timeout' }, ...(ordering === 'none' ? [{ outcome: 'retry' as const, error_code: 'timeout' }] : []));
      await runOnce(h.deps);
      expect(sentKeys(fake)).toEqual(ordering === 'none' ? ['REF-head', 'REF-orig', 'REF-other'] : ['REF-head', 'REF-other']);
      expect(h.row('credit')).toMatchObject({ state: 'pending', attempts: 0, last_error: null });
      h.clock.advance(BACKOFF_MS[0]);
      await runOnce(h.deps);
      // The original is answered first, then its credit, with the original's number.
      const tail = fake.calls.slice(ordering === 'none' ? 3 : 2);
      expect(tail.map((c) => [c.kind, c.sub.idempotency_key])).toEqual([
        ['sale', 'REF-head'],
        ['sale', 'REF-orig'],
        ['credit', 'REF-credit'],
      ]);
      const credit = tail[2]!;
      expect(credit.kind === 'credit' && credit.sub.original).toEqual({ invoice_ref: 'REF-orig', fiscal_number: 'F-orig', issued_at: T });
    });
  }

  it('[05 #71, §3.15] a credit of a rejected original is rejected without a send', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'orig', ord: 1 });
    h.add({ invoice_id: 'credit', ord: 2, ref_invoice_id: 'orig' });
    fake.script({ outcome: 'rejected', error_code: 'http_400', http_status: 400 });
    await runOnce(h.deps);
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-orig']);
    expect(h.committed).toEqual([
      { invoice_id: 'orig', answer: { outcome: 'rejected', error_code: 'http_400', http_status: 400 } },
      { invoice_id: 'credit', answer: { outcome: 'rejected', error_code: 'original_rejected', http_status: null } },
    ]);
    expect(h.row('credit')).toMatchObject({ state: 'rejected', last_error: 'original_rejected' });
  });

  it('[05 §3.15] a credit of a rejected original whose rejection cannot be committed backs off, holds only its pos_id', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.setToken('POS-2');
    h.add({ invoice_id: 'orig', ord: 1, pos_id: 'POS-1', state: 'rejected' });
    h.add({ invoice_id: 'credit', ord: 2, pos_id: 'POS-1', ref_invoice_id: 'orig' });
    h.add({ invoice_id: 'later', ord: 3, pos_id: 'POS-1' });
    h.add({ invoice_id: 'b1', ord: 4, pos_id: 'POS-2' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const real = h.deps.onAnswer;
    let tries = 0;
    h.deps.onAnswer = (row, answer) => {
      if (row.invoice_id === 'credit') {
        tries += 1;
        throw new Error('refused');
      }
      return real(row, answer);
    };
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-b1']); // later (pos_id 1) held behind the credit; pos_id 2 goes on
    expect(h.row('credit')).toMatchObject({ state: 'pending', attempts: 1, next_try_at: T + 5_000, last_error: 'answer_not_committed' });
    await runOnce(h.deps);
    await runOnce(h.deps);
    expect(tries).toBe(1); // not retried every loop
    h.clock.advance(BACKOFF_MS[0]);
    await runOnce(h.deps);
    expect(tries).toBe(2);
    expect(fake.calls.filter((c) => c.kind === 'credit')).toEqual([]); // never sent
  });

  it('[05 #72 back-off half] 5 s, 30 s, 2 min, then 5 min on a fake clock; nothing is sent before next_try_at', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    fake.setDefault({ outcome: 'retry', error_code: 'timeout' });
    const waits = [5_000, 30_000, 120_000, 300_000, 300_000, 300_000];
    for (const [i, wait] of waits.entries()) {
      await runOnce(h.deps);
      expect(fake.calls).toHaveLength(i + 1);
      expect(h.row('a1')).toMatchObject({ attempts: i + 1, next_try_at: h.clock.branchNow() + wait, last_error: 'timeout', in_flight_at: null });
      h.clock.advance(wait - 1);
      await runOnce(h.deps);
      expect(fake.calls).toHaveLength(i + 1);
      h.clock.advance(1);
    }
    expect([1, 2, 3, 4, 5, 99].map(backoffMs)).toEqual([5_000, 30_000, 120_000, 300_000, 300_000, 300_000]);
  });

  it('[05 #72 back-off half] a rejected row is never resent', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    fake.script({ outcome: 'rejected', error_code: 'http_422', http_status: 422 });
    await runOnce(h.deps);
    for (let i = 0; i < 3; i += 1) {
      h.clock.advance(BACKOFF_MS[3]);
      await runOnce(h.deps);
    }
    expect(fake.calls).toHaveLength(1);
    expect(h.row('a1')).toMatchObject({ state: 'rejected', last_error: 'http_422', in_flight_at: null });
  });

  for (const ordering of ['strict_per_pos_id', 'none'] as const) {
    it(`[05 §3.15] ${ordering}: an answer that cannot be committed backs off and never holds another pos_id`, async () => {
      const fake = fakeAdapter({ key: 'FAKE', ordering });
      const h = await harness([fake]);
      h.setToken('POS-1');
      h.setToken('POS-2');
      h.add({ invoice_id: 'a1', ord: 1, pos_id: 'POS-1' });
      h.add({ invoice_id: 'a2', ord: 2, pos_id: 'POS-1' });
      h.add({ invoice_id: 'b1', ord: 3, pos_id: 'POS-2' });
      fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
      // Every commit of a pos_id 1 answer fails (e.g. 29b's event refused); pos_id 2 commits.
      const real = h.deps.onAnswer;
      h.deps.onAnswer = (row, answer) => {
        if (row.pos_id === 'POS-1') throw new Error('refused');
        return real(row, answer);
      };
      await runOnce(h.deps);
      expect(sentKeys(fake)).toEqual(ordering === 'none' ? ['REF-a1', 'REF-a2', 'REF-b1'] : ['REF-a1', 'REF-b1']);
      expect(h.row('a1')).toMatchObject({ state: 'pending', attempts: 1, next_try_at: T + 5_000, in_flight_at: T, last_error: 'answer_not_committed' });
      const before = fake.calls.length;
      await runOnce(h.deps);
      await runOnce(h.deps);
      expect(fake.calls).toHaveLength(before); // not resent every loop
      h.clock.advance(BACKOFF_MS[0]);
      await runOnce(h.deps);
      expect(sentKeys(fake).slice(before)[0]).toBe('REF-a1'); // same key after the back-off
      expect(h.row('a1')).toMatchObject({ attempts: 2, next_try_at: T + 5_000 + 30_000 });
    });
  }

  it('[05 §3.15] a malformed adapter answer is a retry (adapter_error), never a crash of the pass', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    const bad = [
      { outcome: 'rejected', http_status: 400 },
      { outcome: 'error' },
      { outcome: 'ok', fiscal_number: '', qr_payload: null },
      { outcome: 'ok', fiscal_number: 7, qr_payload: null },
      { outcome: 'duplicate', fiscal_number: 3 },
      { outcome: 'retry' },
      null,
    ];
    bad.forEach((_, i) => h.add({ invoice_id: `m${i}`, ord: i + 1 }));
    h.add({ invoice_id: 'good', ord: 99 });
    fake.script(...(bad as never[]), { outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    await runOnce(h.deps);
    for (let i = 0; i < bad.length; i += 1) {
      expect(h.row(`m${i}`), JSON.stringify(bad[i])).toMatchObject({ state: 'pending', attempts: 1, last_error: 'adapter_error', in_flight_at: null });
    }
    expect(h.row('good')).toMatchObject({ state: 'acked' });
    expect(shortCode(undefined)).toBe('invalid_code');
  });

  it('[05 §3.15] a throwing loadSubmission keeps the row pending (load_failed), holds only its pos_id, logs once', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.setToken('POS-2');
    h.add({ invoice_id: 'a1', ord: 1, pos_id: 'POS-1' });
    h.add({ invoice_id: 'a2', ord: 2, pos_id: 'POS-1' });
    h.add({ invoice_id: 'b1', ord: 3, pos_id: 'POS-2' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const real = h.deps.loadSubmission;
    h.deps.loadSubmission = (row) => {
      if (row.invoice_id === 'a1') throw new Error(`boom ${TOKEN}`);
      return real(row);
    };
    await runOnce(h.deps);
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-b1']);
    expect(h.row('a1')).toMatchObject({ state: 'pending', attempts: 0, last_error: 'load_failed' });
    expect(h.logs().split('fiscal.load_failed').length - 1).toBe(1);
    expect(h.logs()).not.toContain(TOKEN);
  });

  it('[05 §3.15] a credit without its original row, or without a loaded original, stays pending (original_missing)', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'orig', ord: 1 });
    h.add({ invoice_id: 'c-lost', ord: 2, ref_invoice_id: 'nowhere' });
    h.add({ invoice_id: 'c-noload', ord: 3, ref_invoice_id: 'orig' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const real = h.deps.loadSubmission;
    h.deps.loadSubmission = (row) => {
      const l = real(row) as LoadedSubmission;
      return row.invoice_id === 'c-noload' && l.ok ? { ...l, original: null } : l;
    };
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-orig']);
    expect(h.row('c-lost')).toMatchObject({ state: 'pending', last_error: 'original_missing', attempts: 0 });
    expect(h.row('c-noload')).toMatchObject({ state: 'pending', last_error: 'original_missing', attempts: 0 });
  });

  it('[05 §3.15] the submission carries the row\'s pos_id and jurisdiction, whatever the loader returns', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1, jurisdiction_id: 'J-ROW' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const real = h.deps.loadSubmission;
    h.deps.loadSubmission = (row) => {
      const l = real(row) as LoadedSubmission;
      return l.ok ? { ...l, submission: { ...l.submission, pos_id: 'POS-OTHER', jurisdiction_id: 'J-OTHER' } as never } : l;
    };
    await runOnce(h.deps);
    expect(fake.calls[0]!.sub).toMatchObject({ pos_id: 'POS-1', jurisdiction_id: 'J-ROW', credentials: { token: TOKEN } });
  });

  it('[05 #72 back-off half] next_try_at counts from the answer, not the send', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    const slow: FakeAdapter = {
      ...fake,
      async submitSale(sub) {
        h.clock.advance(20_000); // the request takes 20 s
        return fake.submitSale(sub);
      },
    };
    h.deps.adapterFor = () => slow;
    fake.setDefault({ outcome: 'retry', error_code: 'timeout' });
    await runOnce(h.deps);
    expect(h.row('a1')).toMatchObject({ attempts: 1, next_try_at: T + 20_000 + 5_000 });
  });

  it('[05 §3.15] after stop() a running pass sends and writes nothing more', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    h.add({ invoice_id: 'a2', ord: 2 });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    let stop: () => void = () => undefined;
    const stopping: FakeAdapter = {
      ...fake,
      async submitSale(sub) {
        const a = await fake.submitSale(sub);
        stop(); // SIGTERM while the first request is out
        return a;
      },
    };
    const queue: (() => void)[] = [];
    const timers: FiscalTimers = { setTimer: (fn) => queue.push(fn), clearTimer: () => undefined };
    stop = startFiscalWorker({ ...h.deps, adapterFor: () => stopping, timers });
    queue.shift()!();
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); // drain the tick's pass
    expect(sentKeys(fake)).toEqual(['REF-a1']);
    expect(h.row('a1')).toMatchObject({ state: 'pending', in_flight_at: T }); // answer not written after stop
    expect(queue).toEqual([]); // no new tick
  });

  it('[05 §3.15] each answer outcome: ok / duplicate with a number ack, rejected / duplicate without a number reject, retry backs off', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    for (let i = 1; i <= 5; i += 1) h.add({ invoice_id: `r${i}`, ord: i });
    fake.script(
      { outcome: 'ok', fiscal_number: 'F-1', qr_payload: 'qr' },
      { outcome: 'duplicate', fiscal_number: 'F-2' },
      { outcome: 'duplicate', fiscal_number: null },
      { outcome: 'rejected', error_code: 'http_400', http_status: 400 },
      { outcome: 'retry', error_code: 'http_503' },
    );
    await runOnce(h.deps);
    expect(['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => h.row(id))).toEqual([
      { state: 'acked', attempts: 0, next_try_at: 0, last_error: null, in_flight_at: null },
      { state: 'acked', attempts: 0, next_try_at: 0, last_error: null, in_flight_at: null },
      { state: 'rejected', attempts: 0, next_try_at: 0, last_error: 'duplicate_no_number', in_flight_at: null },
      { state: 'rejected', attempts: 0, next_try_at: 0, last_error: 'http_400', in_flight_at: null },
      { state: 'pending', attempts: 1, next_try_at: T + 5_000, last_error: 'http_503', in_flight_at: null },
    ]);
    expect(h.committed.map((c) => c.invoice_id)).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('[05 §3.15] an adapter that throws is a retry; free text from an adapter never reaches last_error', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    h.add({ invoice_id: 'a2', ord: 2 });
    h.add({ invoice_id: 'a3', ord: 3 });
    fake.script(
      { throws: `socket hang up ${TOKEN}` },
      { outcome: 'retry', error_code: `Upstream said: ${BUYER_NAME} is invalid` },
      { outcome: 'rejected', error_code: `Bearer ${TOKEN} refused`, http_status: 401 },
    );
    await runOnce(h.deps);
    expect(h.row('a1')).toMatchObject({ state: 'pending', attempts: 1, last_error: 'adapter_error' });
    expect(h.row('a2')).toMatchObject({ state: 'pending', attempts: 1, last_error: 'invalid_code' });
    expect(h.row('a3')).toMatchObject({ state: 'rejected', last_error: 'invalid_code' });
    expect(h.committed[0]!.answer).toEqual({ outcome: 'rejected', error_code: 'invalid_code', http_status: 401 });
    expect(['HTTP_503', 'timeout', 'x'.repeat(41), 'a b'].map(shortCode)).toEqual(['http_503', 'timeout', 'invalid_code', 'invalid_code']);
  });

  it('[05 §3.15, H10-5] credentials: every credentialNames entry, read from fiscal_credentials at send', async () => {
    const fake = fakeAdapter({ key: 'FAKE', credentialNames: ['api_key', 'device_key'] });
    const h = await harness([fake]);
    h.add({ invoice_id: 'a1', ord: 1 });
    fake.setDefault({ outcome: 'retry', error_code: 'timeout' });
    h.setToken('POS-1', 'api_key', 'test-token-1');
    await runOnce(h.deps);
    expect(fake.calls).toHaveLength(0);
    expect(h.row('a1')).toMatchObject({ last_error: 'token_missing', attempts: 0 });
    h.setToken('POS-1', 'device_key', 'test-token-2');
    await runOnce(h.deps);
    expect(fake.calls[0]!.sub.credentials).toEqual({ api_key: 'test-token-1', device_key: 'test-token-2' });
    // Replaced between sends: the next send carries the new one (no cache).
    h.setToken('POS-1', 'api_key', 'test-token-3');
    h.clock.advance(BACKOFF_MS[0]);
    await runOnce(h.deps);
    expect(fake.calls[1]!.sub.credentials).toEqual({ api_key: 'test-token-3', device_key: 'test-token-2' });
  });

  it('[05 §3.15] a failed loadSubmission (e.g. adapter_settings_invalid) keeps the row pending and holds only its pos_id', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.setToken('POS-2');
    h.add({ invoice_id: 'a1', ord: 1, pos_id: 'POS-1' });
    h.add({ invoice_id: 'a2', ord: 2, pos_id: 'POS-1' });
    h.add({ invoice_id: 'b1', ord: 3, pos_id: 'POS-2' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const real = h.deps.loadSubmission;
    h.deps.loadSubmission = (row) => (row.invoice_id === 'a1' ? { ok: false, error_code: 'adapter_settings_invalid' } : real(row));
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-b1']);
    expect(h.row('a1')).toMatchObject({ state: 'pending', attempts: 0, last_error: 'adapter_settings_invalid' });
  });

  it('[05 §3.15] a row whose adapter is not registered stays pending and holds only its pos_id', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'x1', ord: 1, adapter_key: 'GONE' });
    h.add({ invoice_id: 'a1', ord: 2 });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    await runOnce(h.deps);
    expect(sentKeys(fake)).toEqual(['REF-a1']);
    expect(h.row('x1')).toMatchObject({ state: 'pending', last_error: 'adapter_unknown' });
  });

  it('[05 §3.15] one request in flight per hub: overlapping passes never send concurrently', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    let inFlight = 0;
    let peak = 0;
    const slow: FakeAdapter = {
      ...fake,
      async submitSale(sub) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setImmediate(r));
        inFlight -= 1;
        return fake.submitSale(sub);
      },
    };
    const h = await harness([slow]);
    h.setToken('POS-1');
    for (let i = 1; i <= 4; i += 1) h.add({ invoice_id: `a${i}`, ord: i });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const counts = await Promise.all([runOnce(h.deps), runOnce(h.deps), runOnce(h.deps)]);
    expect(peak).toBe(1);
    expect(counts).toEqual([4, 0, 0]);
    expect(fake.calls).toHaveLength(4);
  });

  it('[05 §3.15] health() at most every 60 s per adapter while rows wait; never with no row waiting', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    await runOnce(h.deps);
    expect(fake.healthCalls).toBe(0);
    h.add({ invoice_id: 'a1', ord: 1 }); // no token: it waits
    fake.setHealth('failing');
    await runOnce(h.deps);
    expect(fake.healthCalls).toBe(1);
    expect(fiscalAdapterHealth('FAKE')).toEqual({ at: T, result: 'failing' });
    h.clock.advance(HEALTH_EVERY_MS - 1);
    await runOnce(h.deps);
    expect(fake.healthCalls).toBe(1);
    h.clock.advance(1);
    fake.setHealth('ok');
    await runOnce(h.deps);
    expect(fake.healthCalls).toBe(2);
    expect(fiscalAdapterHealth('FAKE')).toEqual({ at: T + HEALTH_EVERY_MS, result: 'ok' });
  });

  it('[05 #77 worker half] captured log: no token, no buyer field, no request body; ids and short codes only', async () => {
    const fake = fakeAdapter({ key: 'FAKE', ordering: 'none' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    for (let i = 1; i <= 5; i += 1) h.add({ invoice_id: `a${i}`, ord: i });
    h.add({ invoice_id: 'nt', ord: 6, pos_id: 'POS-NT' });
    fake.script(
      { outcome: 'ok', fiscal_number: 'F-1', qr_payload: 'qr' },
      { outcome: 'retry', error_code: 'timeout' },
      { outcome: 'rejected', error_code: `Bearer ${TOKEN}`, http_status: 401 },
      { throws: `body ${BUYER_NAME} ${BUYER_ID} ${TOKEN}` },
    );
    await runOnce(h.deps);
    h.failCommits(1);
    fake.script({ outcome: 'ok', fiscal_number: 'F-5', qr_payload: null });
    h.clock.advance(BACKOFF_MS[0]);
    await runOnce(h.deps);
    const text = h.logs();
    expect(text).toContain('fiscal.sent');
    expect(text).toContain('fiscal.answered');
    expect(text).toContain('fiscal.answer_not_committed');
    for (const bad of [TOKEN, BUYER_NAME, BUYER_ID, 'credentials', 'buyer', 'tax_id', 'lines', 'Paye', 'unit_price_minor', 'Bearer']) {
      expect(text, bad).not.toContain(bad);
    }
    for (const l of text.trim().split('\n')) {
      const obj = JSON.parse(l) as Record<string, unknown>;
      expect(Object.keys(obj).every((k) => ['level', 'msg', 'invoice_id', 'adapter_key', 'outcome', 'error_code', 'attempts'].includes(k)), l).toBe(true);
    }
  });

  it('[05 §3.15] startFiscalWorker runs a pass on its loop and stops cleanly', async () => {
    const fake = fakeAdapter({ key: 'FAKE' });
    const h = await harness([fake]);
    h.setToken('POS-1');
    h.add({ invoice_id: 'a1', ord: 1 });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F', qr_payload: null });
    const queue: { fn: () => void; ms: number; id: number }[] = [];
    let next = 0;
    const timers: FiscalTimers = {
      setTimer: (fn, ms) => {
        next += 1;
        queue.push({ fn, ms, id: next });
        return next;
      },
      clearTimer: (id) => {
        const i = queue.findIndex((q) => q.id === id);
        if (i >= 0) queue.splice(i, 1);
      },
    };
    const stop = startFiscalWorker({ ...h.deps, timers });
    expect(queue.map((q) => q.ms)).toEqual([0]);
    queue.shift()!.fn();
    await new Promise((r) => setImmediate(r));
    await runOnce(h.deps); // waits for the tick's pass (the lock)
    await new Promise((r) => setImmediate(r));
    expect(fake.calls).toHaveLength(1);
    expect(queue.map((q) => q.ms)).toEqual([FISCAL_LOOP_MS]);
    stop();
    expect(queue).toEqual([]);
  });
});
