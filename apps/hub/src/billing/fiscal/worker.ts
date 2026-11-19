// 05 §3.15 (B20, B21), task 29a: the fiscal worker skeleton over `fiscal_outbox`.
// - One request in flight per hub (a process-wide lock serialises every pass, timer or manual).
// - Order: an adapter with `ordering: 'strict_per_pos_id'` sends each pos_id's oldest pending row by `ord`;
//   while that row backs off (or lacks a credential / submission) only that pos_id's later rows wait.
//   With `ordering: 'none'` every row is sent on its own. A credit waits for its original's answer and
//   steps aside meanwhile; a credit of a `rejected` original is rejected without a send.
// - Back-off 5 s, 30 s, 2 min, then 5 min; a `rejected` row is never resent (it is no longer `pending`).
// - At least once with the same key: `in_flight_at` is set before the send and cleared only after
//   `onAnswer` committed, so a crash in between leaves a pending row that is resent with
//   `idempotency_key = invoice_ref`.
// - Credentials (every `credentialNames` entry) are read from `fiscal_credentials` at send; a missing one
//   keeps the row pending with `last_error: 'token_missing'` and never holds another pos_id.
// - `health()` at most every 60 s per adapter while rows wait. `last_error` holds short codes only; logs
//   carry ids, outcomes and codes — never a token, a buyer field or a request body.
// Seams for phase 0b (plan PL-16, PL-18): `loadSubmission(row)` and `onAnswer(row, answer)` are injected;
// task 29b supplies the real ones (events, invoice_buyers); P0.18 adds the boot call.
import type Database from 'better-sqlite3';
import type { Clock } from '../../lib/clock.js';
import { answerTransition } from './outbox.js';
import type { FiscalAdapter, FiscalAnswer, FiscalCreditSubmission, FiscalSubmission } from './port.js';

/** §3.15: 5 s, 30 s, 2 min, then 5 min (attempt n waits BACKOFF_MS[min(n, 4) - 1]). */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 300_000] as const;
/** §3.15 Health: at most every 60 s while rows wait. */
export const HEALTH_EVERY_MS = 60_000;
/** Loop period of startFiscalWorker (the 03c print worker's 1 s loop). */
export const FISCAL_LOOP_MS = 1_000;

/** Short codes the core writes to `last_error` (adapters add their own: 'timeout', 'http_503', …). */
export const FISCAL_ERRORS = {
  token_missing: 'token_missing',
  adapter_unknown: 'adapter_unknown',
  adapter_error: 'adapter_error',
  answer_not_committed: 'answer_not_committed',
  load_failed: 'load_failed',
  original_rejected: 'original_rejected',
  original_missing: 'original_missing',
  invalid_code: 'invalid_code',
} as const;

/** A pending `fiscal_outbox` row as the worker reads it. */
export type FiscalWorkRow = {
  invoice_id: string;
  ord: number;
  ref_invoice_id: string | null;
  jurisdiction_id: string;
  adapter_key: string;
  pos_id: string | null;
  attempts: number;
  next_try_at: number;
  in_flight_at: number | null;
};

/**
 * What `loadSubmission` returns: the neutral submission without the parts the worker owns
 * (idempotency_key = invoice_ref, credentials, and the row's pos_id / jurisdiction_id).
 * H10-6: `config` is built for the **row's** adapter (`base_urls[row.adapter_key][environment] ?? null`,
 * `adapter_settings[row.adapter_key] ?? {}`), never the branch's current one.
 */
export type LoadedSubmission =
  | {
      ok: true;
      /** Built from InvoiceIssued / InvoiceCredited (29b). */
      submission: Omit<FiscalSubmission, 'idempotency_key' | 'credentials' | 'pos_id' | 'jurisdiction_id'>;
      /** A credit's original (29b: the original invoice + its FiscalNumberAssigned); null for a sale. */
      original: FiscalCreditSubmission['original'] | null;
    }
  /** A short code: the row stays pending (e.g. 'adapter_settings_invalid', §3.15). */
  | { ok: false; error_code: string };

/** The answers `onAnswer` receives: never `retry` (the worker handles it on the row). */
export type FiscalFinalAnswer = Exclude<FiscalAnswer, { outcome: 'retry' }>;

export interface FiscalWorkerLog {
  info?(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export interface FiscalTimers {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export interface FiscalWorkerDeps {
  db: Database.Database;
  clock: Clock;
  /** Adapter lookup by the row's recorded adapter_key (port.ts `fiscalAdapterFor`). */
  adapterFor(key: string): FiscalAdapter | null;
  loadSubmission(row: FiscalWorkRow): LoadedSubmission | Promise<LoadedSubmission>;
  /**
   * Commits the answer (29b: `FiscalNumberAssigned` for ok / duplicate with a number, `FiscalSubmitRejected`
   * otherwise, in one writer transaction; the billing fold moves the row to `acked` / `rejected`). Map it
   * with outbox.ts `answerTransition`. The same transaction should also clear `in_flight_at` and set
   * `last_error` (the error code on a reject, null on an ack); the worker repeats both afterwards.
   * A throw = not committed: the row stays pending and in flight, backs off, and is resent with the same key.
   */
  onAnswer(row: FiscalWorkRow, answer: FiscalFinalAnswer): void | Promise<void>;
  log?: FiscalWorkerLog;
  timers?: FiscalTimers;
}

const nodeTimers: FiscalTimers = {
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as NodeJS.Timeout),
};

// ---- process-wide state (one hub = one process) ----
let lock: Promise<unknown> = Promise.resolve();
const health = new Map<string, { at: number; result: 'ok' | 'failing' }>();

/** The last health() result per adapter key (for fiscal-status, §6.27), or null before the first check. */
export function fiscalAdapterHealth(key: string): { at: number; result: 'ok' | 'failing' } | null {
  return health.get(key) ?? null;
}

/** Tests only: forget the health cache and the lock (a "restarted hub"). */
export function resetFiscalWorker(): void {
  health.clear();
  lock = Promise.resolve();
}

/** A short code for `last_error` / logs: `[a-z0-9_]`, ≤ 40 chars; anything else (free text) is dropped. */
export function shortCode(code: unknown): string {
  if (typeof code !== 'string') return FISCAL_ERRORS.invalid_code;
  const c = code.toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(c) ? c : FISCAL_ERRORS.invalid_code;
}

/** An adapter's answer as the port types it, or null (an adapter bug: treated as a retry). */
function checkedAnswer(a: unknown): FiscalAnswer | null {
  if (a === null || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const str = (v: unknown): boolean => typeof v === 'string' && v.length > 0;
  const strOrNull = (v: unknown): boolean => v === null || str(v);
  switch (o['outcome']) {
    case 'ok':
      return str(o['fiscal_number']) && strOrNull(o['qr_payload']) ? (o as FiscalAnswer) : null;
    case 'retry':
      return typeof o['error_code'] === 'string' ? (o as FiscalAnswer) : null;
    case 'rejected':
      return typeof o['error_code'] === 'string' && (o['http_status'] === null || Number.isInteger(o['http_status']))
        ? (o as FiscalAnswer)
        : null;
    case 'duplicate':
      return strOrNull(o['fiscal_number']) ? (o as FiscalAnswer) : null;
    default:
      return null;
  }
}

export function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]!;
}

/**
 * One pass over the pending rows; resolves with the number of requests sent. Passes never overlap.
 * A pass waits on each adapter call; bounding it is the adapter's timeout (§3.15: the adapter owns
 * timeouts). Command paths (RetryFiscalNow, task 31) must not await it.
 */
export function runOnce(deps: FiscalWorkerDeps): Promise<number> {
  return runGuarded(deps, () => false);
}

function runGuarded(deps: FiscalWorkerDeps, stopped: () => boolean): Promise<number> {
  const run = lock.then(() => pass(deps, stopped));
  lock = run.catch(() => undefined);
  return run;
}

/** Starts the loop (after listen, §3.15); returns the stop function. */
export function startFiscalWorker(deps: FiscalWorkerDeps): () => void {
  const timers = deps.timers ?? nodeTimers;
  let stopped = false;
  let timer: unknown = null;
  const tick = (): void => {
    timer = null;
    void runGuarded(deps, () => stopped)
      .catch((error: unknown) => logError(deps, { error_code: errorName(error) }, 'fiscal.pass_failed'))
      .finally(() => {
        if (!stopped) timer = timers.setTimer(tick, FISCAL_LOOP_MS);
      });
  };
  timer = timers.setTimer(tick, 0);
  return () => {
    stopped = true;
    if (timer !== null) timers.clearTimer(timer);
    timer = null;
  };
}

async function pass(deps: FiscalWorkerDeps, stopped: () => boolean): Promise<number> {
  const { db } = deps;
  const rows = db
    .prepare(
      `SELECT invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, attempts, next_try_at, in_flight_at
       FROM fiscal_outbox WHERE state = 'pending' ORDER BY ord`,
    )
    .all() as FiscalWorkRow[];
  if (rows.length === 0) return 0;
  await checkHealth(deps, rows);

  const blocked = new Set<string>();
  let sent = 0;
  for (const row of rows) {
    // after stop() the DB may be closed (SIGTERM): the pass writes and sends nothing more
    if (stopped()) return sent;
    const adapter = deps.adapterFor(row.adapter_key);
    const group = `${row.adapter_key}\u0000${row.pos_id ?? ''}`;
    // An unknown adapter's ordering is unknown: hold its pos_id, as strict would.
    const strict = adapter === null || adapter.capabilities.ordering === 'strict_per_pos_id';
    if (strict && blocked.has(group)) continue;
    const hold = (): void => {
      if (strict) blocked.add(group);
    };
    if (adapter === null) {
      setError(db, row, FISCAL_ERRORS.adapter_unknown);
      hold();
      continue;
    }

    if (row.ref_invoice_id !== null) {
      const original = db.prepare('SELECT state FROM fiscal_outbox WHERE invoice_id = ?').pluck().get(row.ref_invoice_id) as
        | string
        | undefined;
      if (original === 'pending') continue; // waits for its original's answer and steps aside
      if (original === 'rejected') {
        // §3.15: a credit of a rejected original becomes rejected too — no send. A commit that failed
        // backs off like any other row.
        if (row.next_try_at > deps.clock.branchNow()) {
          hold();
          continue;
        }
        if (!(await commit(deps, row, { outcome: 'rejected', error_code: FISCAL_ERRORS.original_rejected, http_status: null }))) {
          hold();
        }
        continue;
      }
      if (original === undefined) {
        setError(db, row, FISCAL_ERRORS.original_missing);
        hold();
        continue;
      }
    }

    if (row.next_try_at > deps.clock.branchNow()) {
      hold(); // backing off
      continue;
    }

    const credentials = credentialsFor(db, row.pos_id, adapter.credentialNames);
    if (credentials === null) {
      setError(db, row, FISCAL_ERRORS.token_missing);
      hold();
      continue;
    }

    let loaded: LoadedSubmission;
    try {
      loaded = await deps.loadSubmission(row);
    } catch (error) {
      if (setError(db, row, FISCAL_ERRORS.load_failed)) {
        logError(deps, { invoice_id: row.invoice_id, error_code: errorName(error) }, 'fiscal.load_failed');
      }
      hold();
      continue;
    }
    if (!loaded.ok) {
      setError(db, row, shortCode(loaded.error_code));
      hold();
      continue;
    }
    if (row.ref_invoice_id !== null && loaded.original === null) {
      setError(db, row, FISCAL_ERRORS.original_missing);
      hold();
      continue;
    }

    const sub: FiscalSubmission = {
      ...loaded.submission,
      idempotency_key: loaded.submission.invoice.invoice_ref,
      pos_id: row.pos_id, // §3.15 v1.0.2 (R-9 / G-7): null stays null, never ''
      jurisdiction_id: row.jurisdiction_id,
      credentials,
    };
    db.prepare('UPDATE fiscal_outbox SET in_flight_at = ? WHERE invoice_id = ?').run(deps.clock.branchNow(), row.invoice_id);
    let answer: FiscalAnswer;
    try {
      const raw: unknown =
        row.ref_invoice_id === null
          ? await adapter.submitSale(sub)
          : await adapter.submitCredit({ ...sub, original: loaded.original! });
      answer = checkedAnswer(raw) ?? { outcome: 'retry', error_code: FISCAL_ERRORS.adapter_error };
    } catch {
      answer = { outcome: 'retry', error_code: FISCAL_ERRORS.adapter_error };
    }
    sent += 1;
    if (stopped()) return sent;

    const t = answerTransition(answer);
    if (t.to === 'retry') {
      const code = shortCode(t.error_code);
      const attempts = backOff(deps, row, code, true);
      logInfo(deps, { invoice_id: row.invoice_id, adapter_key: row.adapter_key, outcome: 'retry', error_code: code, attempts }, 'fiscal.sent');
      hold();
      continue;
    }
    const final: FiscalFinalAnswer =
      answer.outcome === 'rejected' ? { ...answer, error_code: shortCode(answer.error_code) } : (answer as FiscalFinalAnswer);
    if (!(await commit(deps, row, final))) hold();
  }
  return sent;
}

/**
 * attempts + 1 and next_try_at = now (after the answer) + back-off, guarded on `pending` (1 statement).
 * `clearInFlight` false keeps the in-flight mark: an answer that was not committed is resent with the same key.
 */
function backOff(deps: FiscalWorkerDeps, row: FiscalWorkRow, code: string, clearInFlight: boolean): number {
  const now = deps.clock.branchNow();
  const attempts = deps.db
    .prepare(
      `UPDATE fiscal_outbox SET attempts = attempts + 1,
              next_try_at = ? + CASE attempts + 1 WHEN 1 THEN ? WHEN 2 THEN ? WHEN 3 THEN ? ELSE ? END,
              last_error = ?, in_flight_at = CASE WHEN ? = 1 THEN NULL ELSE in_flight_at END
       WHERE invoice_id = ? AND state = 'pending' RETURNING attempts`,
    )
    .pluck()
    .get(now, ...BACKOFF_MS, code, clearInFlight ? 1 : 0, row.invoice_id) as number | undefined;
  return attempts ?? row.attempts + 1;
}

/**
 * onAnswer, then clear the in-flight mark. A throw = not committed: the row stays pending and in flight,
 * backs off like a retry (so it never resends every loop or holds another pos_id) and is resent with the
 * same key. Returns whether the answer was committed.
 */
async function commit(deps: FiscalWorkerDeps, row: FiscalWorkRow, answer: FiscalFinalAnswer): Promise<boolean> {
  const t = answerTransition(answer);
  try {
    await deps.onAnswer(row, answer);
  } catch (error) {
    const attempts = backOff(deps, row, FISCAL_ERRORS.answer_not_committed, false);
    logError(deps, { invoice_id: row.invoice_id, error_code: errorName(error), attempts }, 'fiscal.answer_not_committed');
    return false;
  }
  deps.db
    .prepare('UPDATE fiscal_outbox SET in_flight_at = NULL, last_error = ? WHERE invoice_id = ?')
    .run(t.to === 'rejected' ? t.error_code : null, row.invoice_id);
  logInfo(
    deps,
    { invoice_id: row.invoice_id, adapter_key: row.adapter_key, outcome: t.to, ...(t.to === 'rejected' ? { error_code: t.error_code } : {}) },
    'fiscal.answered',
  );
  return true;
}

/** Every credential name of the adapter for this pos_id, or null when one is missing (1 statement). */
function credentialsFor(db: Database.Database, pos_id: string | null, names: string[]): Record<string, string> | null {
  if (names.length === 0) return {};
  if (pos_id === null) return null;
  const found = db.prepare('SELECT name, token FROM fiscal_credentials WHERE pos_id = ?').all(pos_id) as {
    name: string;
    token: string;
  }[];
  const out: Record<string, string> = {};
  for (const name of names) {
    const hit = found.find((f) => f.name === name);
    if (hit === undefined) return null;
    out[name] = hit.token;
  }
  return out;
}

/** Sets last_error when it changes (a waiting row is not rewritten every loop); returns whether it did. */
function setError(db: Database.Database, row: FiscalWorkRow, code: string): boolean {
  return (
    db.prepare('UPDATE fiscal_outbox SET last_error = ? WHERE invoice_id = ? AND last_error IS NOT ?').run(code, row.invoice_id, code)
      .changes === 1
  );
}

async function checkHealth(deps: FiscalWorkerDeps, rows: FiscalWorkRow[]): Promise<void> {
  for (const key of new Set(rows.map((r) => r.adapter_key))) {
    const adapter = deps.adapterFor(key);
    if (adapter === null) continue;
    const now = deps.clock.branchNow();
    const last = health.get(key);
    if (last !== undefined && now - last.at < HEALTH_EVERY_MS) continue;
    let result: 'ok' | 'failing';
    try {
      result = (await adapter.health()) === 'ok' ? 'ok' : 'failing';
    } catch {
      result = 'failing';
    }
    health.set(key, { at: now, result });
  }
}

/** An error's class name only (never its message, which may carry a request body or a token). */
function errorName(error: unknown): string {
  return shortCode(error instanceof Error ? error.name : 'unknown');
}

function logInfo(deps: FiscalWorkerDeps, obj: Record<string, unknown>, msg: string): void {
  try {
    deps.log?.info?.(obj, msg);
  } catch {
    // a broken logger never stops the worker
  }
}
function logError(deps: FiscalWorkerDeps, obj: Record<string, unknown>, msg: string): void {
  try {
    deps.log?.error(obj, msg);
  } catch {
    // a broken logger never stops the worker
  }
}
