// 05 §3.15 Stuck, §6.27 `GET /queries/fiscal-status`, §6.28 `RetryFiscalNow` (task 31; plan ⚠️ P0.G G-12, G-22).
// - Stuck rule (§3.15): a `pending` row older than the stuck limit, or any `rejected` row. The limit is
//   `stuck_after_ms`, or half the jurisdiction's `catch_up_window_ms` when that is smaller ("or a row older than half
//   the catch-up window"); "older than" is strict (age > limit). Read through the §5 partial indexes
//   `fiscal_outbox_pending` / `fiscal_outbox_rejected` (fiscal_outbox is never pruned).
// - G-22 (R-12, 05 v1.0.2): the `fiscal_outbox_stuck` alert is raised and re-raised by THIS 01d tick, never by the
//   worker. One alert at a time (dedupe `fiscal_stuck:<branch_id>`); closed `done` by the tick when nothing is stuck;
//   an alert that day close marked `expire_due` is left to 01d's own tick (registered first, so it closes `expired`
//   earlier in the same pass), after which this tick re-raises it while a row is still stuck (H1-18).
//   Envelope (01d §4.2 tickCtx): occurred_at = the pass's now, actor_id null, device_id 'hub'.
//   Statements: due 1; intents 1 + one alerts.raiseMany or one alerts.closeMany (fixed, whatever the outbox holds).
// - fiscal-status: `take-payment` or `view-reports`, the grant before any read (C8); ids, counts, codes and `set_at`
//   only — never a token (the token column is never selected), never a buyer. 3 statements.
// - RetryFiscalNow: `close-business-day`; one plain UPDATE (not an event) setting `next_try_at = now` on `pending`
//   rows. G-12: it never awaits `runOnce` and has no wake API — the worker's 1 s loop picks the rows up and sends them
//   with the same `idempotency_key = invoice_ref`. A `rejected` row is not resent (§6.28: it needs the fix the
//   rejection names). Result `{ pending_count }`.
import { DomainError } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { BranchConfig } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { alerts } from '../../alerts/raise.js';
import { cachedPrepare } from '../../alerts/statements.js';
import { registeredTicks, registerTick, type TickDef } from '../../alerts/tick.js';
import type { StaffDirectory } from '../../auth/staff-directory.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { defineQuery, queryRegistry, type QueryCtx } from '../../queries/registry.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { hubBilling, ruleInForce, type HubBilling } from '../defaults.js';
import { FISCAL_OUTBOX_STUCK } from '../kinds/index.js';
import { fiscalAdapterFor } from './port.js';
import { fiscalAdapterHealth } from './worker.js';

export const FISCAL_STUCK_TICK = 'fiscal_outbox_stuck';
const MINUTE_MS = 60_000;
/** The built-in `stuck_after_ms` (A-1 (3)), used only before any branch config is applied. */
const DEFAULT_STUCK_AFTER_MS = 1_800_000;

export const stuckDedupeKey = (branch_id: string): string => `fiscal_stuck:${branch_id}`;

/** The jurisdiction's catch-up window in force (the open business day's rule row; else the latest row). */
function catchUpWindowMs(billing: HubBilling, business_date: string | null): number | null {
  return ruleInForce(billing, business_date ?? '9999-12-31')?.catch_up_window_ms ?? null;
}

/** §3.15: the age above which a pending row is stuck — `stuck_after_ms`, or half the catch-up window if smaller. */
export function stuckThresholdMs(billing: HubBilling, business_date: string | null): number {
  const stuck = billing.settings.fiscal.stuck_after_ms;
  const window = catchUpWindowMs(billing, business_date);
  return window === null ? stuck : Math.min(stuck, Math.floor(window / 2));
}

const businessDateOf = (state: Readonly<EngineState>): string | null => (state as Partial<EngineState>).business_day?.business_date ?? null;

function thresholdNow(config: BranchConfig | null, state: Readonly<EngineState>): number {
  return config === null ? DEFAULT_STUCK_AFTER_MS : stuckThresholdMs(hubBilling(config), businessDateOf(state));
}

/**
 * The stuck facts and the open alert, 1 statement: pending rows older than `@cut`, the oldest pending, the rejected
 * count and the oldest rejected (by `ord`, the partial index order), and the open `fiscal_outbox_stuck` alert.
 */
export const STUCK_SQL = `SELECT
  (SELECT COUNT(*) FROM fiscal_outbox WHERE state = 'pending' AND queued_at < @cut) AS stuck_pending,
  (SELECT MIN(queued_at) FROM fiscal_outbox WHERE state = 'pending') AS oldest_pending_at,
  (SELECT COUNT(*) FROM fiscal_outbox WHERE state = 'rejected') AS rejected_count,
  (SELECT queued_at FROM fiscal_outbox WHERE state = 'rejected' ORDER BY ord LIMIT 1) AS oldest_rejected_at,
  (SELECT alert_id FROM alerts WHERE state = 'open' AND kind = '${FISCAL_STUCK_TICK}' ORDER BY raised_at LIMIT 1) AS alert_id,
  (SELECT expire_due FROM alerts WHERE state = 'open' AND kind = '${FISCAL_STUCK_TICK}' ORDER BY raised_at LIMIT 1) AS expire_due`;

interface StuckFacts {
  stuck_pending: number;
  oldest_pending_at: number | null;
  rejected_count: number;
  oldest_rejected_at: number | null;
  alert_id: string | null;
  expire_due: 0 | 1 | null;
}

type StuckAction = { kind: 'raise'; quantity: number; minutes_late: number } | { kind: 'close'; alert_id: string } | null;

function readFacts(db: Database.Database, cut: number): StuckFacts {
  return cachedPrepare(db, STUCK_SQL).get({ cut }) as StuckFacts;
}

/** The oldest stuck row's queued_at: the oldest pending once one is past the limit, the oldest rejected. */
function oldestStuckAt(f: StuckFacts): number | null {
  const at = [f.stuck_pending > 0 ? f.oldest_pending_at : null, f.rejected_count > 0 ? f.oldest_rejected_at : null].filter((v): v is number => v !== null);
  return at.length === 0 ? null : Math.min(...at);
}

function actionOf(f: StuckFacts, now: number): StuckAction {
  const quantity = f.stuck_pending + f.rejected_count;
  if (quantity > 0) {
    if (f.alert_id !== null) return null; // dedupe: one open alert (one marked expire_due is 01d's to expire first)
    const oldest = oldestStuckAt(f) ?? now;
    return { kind: 'raise', quantity, minutes_late: Math.max(0, Math.floor((now - oldest) / MINUTE_MS)) };
  }
  if (f.alert_id !== null && f.expire_due !== 1) return { kind: 'close', alert_id: f.alert_id };
  return null;
}

export const fiscalStuckTick: TickDef = {
  name: FISCAL_STUCK_TICK,
  due(db, state, now) {
    return actionOf(readFacts(db, now - thresholdNow(branchConfig(), state)), now) !== null;
  },
  intents(tx, state, now) {
    // race rule: re-read inside the tick's own writer.run
    const action = actionOf(readFacts(tx.db, now - thresholdNow(branchConfig(), state)), now);
    if (action === null) return [];
    const ctx = alerts.tickCtx(tx, now);
    if (action.kind === 'close') return alerts.closeMany(ctx, [{ alert_id: action.alert_id, reason: 'done' }]);
    return alerts
      .raiseMany(ctx, [
        {
          kind: FISCAL_OUTBOX_STUCK.kind,
          subject: { stream_type: 'hub', stream_id: tx.branchId },
          target: { kind: 'managers' },
          values: {},
          display: { kind_label_key: FISCAL_OUTBOX_STUCK.labels.card },
          details: { quantity: action.quantity, minutes_late: action.minutes_late },
          dedupe_key: stuckDedupeKey(tx.branchId),
        },
      ])
      .flatMap((r) => r.events);
  },
};

// ------------------------------------------------------------------------------------------------ §6.27 fiscal-status

export interface FiscalStatus {
  jurisdiction_id: string;
  adapter_key: string;
  environment: 'sandbox' | 'production';
  adapter_health: 'ok' | 'failing' | 'unknown';
  last_success_at: number | null;
  pending_count: number;
  oldest_pending_age_ms: number | null;
  rejected_count: number;
  catch_up_window_ms: number | null;
  stuck: boolean;
  token_missing: Array<{ pos_id: string; name: string }>;
  tokens: Array<{ pos_id: string; name: string; set_at: number }>;
}

/** (1) counts, oldest pending, last ack and the stuck count at `@cut`. `last_success_at` reads `acked_at` of every row. */
const STATUS_COUNTS_SQL = `SELECT
  (SELECT COUNT(*) FROM fiscal_outbox WHERE state = 'pending') AS pending_count,
  (SELECT MIN(queued_at) FROM fiscal_outbox WHERE state = 'pending') AS oldest_pending_at,
  (SELECT COUNT(*) FROM fiscal_outbox WHERE state = 'pending' AND queued_at < @cut) AS stuck_pending,
  (SELECT COUNT(*) FROM fiscal_outbox WHERE state = 'rejected') AS rejected_count,
  (SELECT MAX(acked_at) FROM fiscal_outbox WHERE state = 'acked') AS last_success_at`;
/** (2) the (adapter, pos_id) pairs of pending rows (H11-4: their adapters' credential names are needed too). */
const PENDING_POS_SQL = `SELECT DISTINCT adapter_key, pos_id FROM fiscal_outbox WHERE state = 'pending' AND pos_id IS NOT NULL`;
/** (3) the credentials, without the token column. */
export const CREDENTIALS_SQL = `SELECT pos_id, name, set_at FROM fiscal_credentials ORDER BY pos_id, name`;

export interface FiscalStatusCtx {
  db: Database.Database;
  directory: StaffDirectory;
  config: BranchConfig | null;
  staffId: string | null;
  now: number;
  state: Readonly<EngineState>;
}

const PERMISSIONS = ['take-payment', 'view-reports'] as const;

/** §6.27: 3 statements; 0 when refused (the grant first, C8). */
export function fiscalStatus(c: FiscalStatusCtx): FiscalStatus {
  const { staffId, directory } = c;
  const held = staffId !== null && PERMISSIONS.some((p) => {
    const g = directory.resolve(staffId, p).grant;
    return g === 'allowed' || g === 'requires_approval';
  });
  if (!held) throw new DomainError('PERMISSION_DENIED', { permission: PERMISSIONS[0], grant: staffId === null ? 'not_granted' : directory.resolve(staffId, PERMISSIONS[0]).grant });
  if (c.config === null) throw new DomainError('BUSINESS_DAY_NOT_OPEN');

  const billing = hubBilling(c.config);
  const business_date = businessDateOf(c.state);
  const cut = c.now - stuckThresholdMs(billing, business_date);
  const counts = c.db.prepare(STATUS_COUNTS_SQL).get({ cut }) as {
    pending_count: number;
    oldest_pending_at: number | null;
    stuck_pending: number;
    rejected_count: number;
    last_success_at: number | null;
  }; // 1
  const pendingPos = c.db.prepare(PENDING_POS_SQL).all() as Array<{ adapter_key: string; pos_id: string }>; // 2
  const tokens = c.db.prepare(CREDENTIALS_SQL).all() as Array<{ pos_id: string; name: string; set_at: number }>; // 3

  // H11-4: every credential name of the branch's adapter for each configured pos_id, and of each pending row's adapter
  // for its pos_id; the ones with no row are missing
  const { adapter_key, jurisdiction_id } = billing.jurisdiction;
  const wanted = new Map<string, { pos_id: string; name: string }>();
  const want = (key: string, pos_id: string): void => {
    for (const name of fiscalAdapterFor(key)?.credentialNames ?? []) wanted.set(`${pos_id}\u0000${name}`, { pos_id, name });
  };
  for (const p of billing.settings.fiscal.pos_ids) want(adapter_key, p.pos_id);
  for (const p of pendingPos) want(p.adapter_key, p.pos_id);
  const present = new Set(tokens.map((t) => `${t.pos_id}\u0000${t.name}`));
  const token_missing = [...wanted.entries()]
    .filter(([k]) => !present.has(k))
    .map(([, v]) => v)
    .sort((a, b) => (a.pos_id === b.pos_id ? (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) : a.pos_id < b.pos_id ? -1 : 1));

  return {
    jurisdiction_id,
    adapter_key,
    environment: billing.settings.fiscal.environment,
    adapter_health: fiscalAdapterHealth(adapter_key)?.result ?? 'unknown',
    last_success_at: counts.last_success_at,
    pending_count: counts.pending_count,
    oldest_pending_age_ms: counts.oldest_pending_at === null ? null : c.now - counts.oldest_pending_at,
    rejected_count: counts.rejected_count,
    catch_up_window_ms: catchUpWindowMs(billing, business_date),
    stuck: counts.stuck_pending + counts.rejected_count > 0,
    token_missing,
    tokens: tokens.map((t) => ({ pos_id: t.pos_id, name: t.name, set_at: t.set_at })),
  };
}

// ------------------------------------------------------------------------------------------------ §6.28 RetryFiscalNow

export const RetryFiscalNowPayload = z.object({}).strict();

export const retryFiscalNowCommand = defineCommand({
  commandType: 'RetryFiscalNow',
  payloadSchema: RetryFiscalNowPayload,
  sessionKind: 'device',
  permission: 'close-business-day',
  handle(ctx) {
    const now = ctx.clock.branchNow();
    // 1 statement; no event; G-12: no runOnce await — the worker's loop sends on its next pass
    const pending_count = ctx.tx.db.prepare(`UPDATE fiscal_outbox SET next_try_at = ? WHERE state = 'pending'`).run(now).changes;
    return { events: [], result: { pending_count } };
  },
});

/** Registers the query, the command and (once per process) the stuck tick. Called from billing/index.ts. */
export function registerFiscalStatus(app: FastifyInstance): void {
  // §4.2: the tick list is process-wide and registerTick throws on a second name; every server build gets here
  if (!registeredTicks().some((t) => t.name === FISCAL_STUCK_TICK)) registerTick(fiscalStuckTick);
  commandRegistry(app).register(retryFiscalNowCommand);
  queryRegistry(app).register(
    defineQuery({
      resource: 'fiscal-status',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({}).strict(),
      handle(ctx: QueryCtx) {
        return { data: fiscalStatus({ db: ctx.db, directory: ctx.directory, config: ctx.branchConfig, staffId: ctx.session?.staff_id ?? null, now: ctx.now, state: ctx.state }) };
      },
    }),
  );
}
