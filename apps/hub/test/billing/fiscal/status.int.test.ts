// 05 plan §3 row 31 — the stuck alert tick, `GET /queries/fiscal-status` and `RetryFiscalNow`, over a real test hub
// (the real 0023 tables, 01d's alerts projection and tick, the commands and queries over HTTP as the client sends them).
// Spec 05 v1.0.13 §3.15 (Stuck, R-12 / G-22: raised and re-raised by a 01d tick; H1-18 expiry at day close), §5
// `fiscal_outbox` (partial indexes `fiscal_outbox_pending` / `fiscal_outbox_rejected`), §6.27, §6.28; plan ⚠️ P0.G
// G-12 (no runOnce await, no wake API) and G-22. Tests #73, #72 (RetryFiscalNow half), #77 (fiscal-status half).
// Outbox rows are written straight into `fiscal_outbox` (the fold's own tests cover how they get there); the clock is
// the test clock and every tick pass is run by hand, as the loop runs it (no timing asserts, 03a AD-32).
import type { EngineState } from '@pos/engine';
import { SnapshotBillingSchema, type BranchConfig, type DirectoryInput, type SnapshotBilling } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { alertsTick, registeredTicks, type TickDef } from '../../../src/alerts/tick';
import { hubBilling } from '../../../src/billing/defaults';
import { registerFiscalAdapter, resetFiscalAdapters } from '../../../src/billing/fiscal/port';
import {
  CREDENTIALS_SQL,
  FISCAL_STUCK_TICK,
  STUCK_SQL,
  fiscalStatus,
  fiscalStuckTick,
  retryFiscalNowCommand,
  stuckThresholdMs,
  type FiscalStatus,
} from '../../../src/billing/fiscal/status';
import { resetFiscalWorker, runOnce, type FiscalWorkerDeps, type FiscalWorkRow, type LoadedSubmission } from '../../../src/billing/fiscal/worker';
import { defineCommand } from '../../../src/commands/registry';
import { commandRegistry } from '../../../src/commands/route';
import { readOnlyDb } from '../../../src/engine-host/read-only-tx';
import { branchConfig, swapBranchConfig } from '../../../src/sync/branch-config-holder';
import { currentDirectory } from '../../../src/auth/guards';
import type { StaffDirectory } from '../../../src/auth/staff-directory';
import { statementCounter } from '../../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../../helpers/test-hub';
import { openDay, voidsMenu } from '../../voids/fixtures';
import { billingDirectory, post, signIn, STAFF, type Who } from '../fixtures';
import { aSubmission, fakeAdapter, type FakeAdapter } from './fake-adapter';

const TOKEN = 'TOKEN-MARKER-31';
const BRANCH = 'branch-1';
const STUCK_AFTER = 1_800_000;
const MIN = 60_000;

let hub: TestHub;
let fake: FakeAdapter;
let manager: Who;
let cashier: Who;
let waiter: Who;
let counter: ReturnType<typeof statementCounter> | null = null;

afterEach(async () => {
  counter = null;
  swapBranchConfig(null);
  resetFiscalAdapters();
  resetFiscalWorker();
  await hub?.close();
  hub = undefined as unknown as TestHub;
});

// ------------------------------------------------------------------------------------------------ set-up

/** The built-in PK document moved onto the test FAKE adapter, with two pos_ids and the given catch-up window. */
function billingDoc(o: { catchUp?: number | null; stuckAfter?: number }): SnapshotBilling {
  const pk = hubBilling({ currency_code: 'PKR', tax_classes: [], billing: undefined });
  return SnapshotBillingSchema.parse({
    ...pk.settings,
    fiscal: {
      ...pk.settings.fiscal,
      environment: 'sandbox',
      pos_ids: [
        { pos_id: 'POS-1', label: 'Counter' },
        { pos_id: 'POS-2', label: 'Tablets' },
      ],
      default_pos_id: 'POS-1',
      stuck_after_ms: o.stuckAfter ?? STUCK_AFTER,
      adapter_settings: { FAKE: {} },
    },
    jurisdiction: {
      ...pk.jurisdiction,
      jurisdiction_id: 'TEST-J',
      adapter_key: 'FAKE',
      rules: pk.jurisdiction.rules.map((r) => ({ ...r, catch_up_window_ms: o.catchUp === undefined ? null : o.catchUp })),
    },
    tax_profiles: [],
  });
}

/** billingDirectory() with the Order taker's take-payment taken away: a person with neither take-payment nor view-reports. */
async function directory(): Promise<DirectoryInput> {
  const d = await billingDirectory();
  return { ...d, roles: d.roles.map((r) => (r.role_id === 'R_WAIT' ? { ...r, permissions: r.permissions.filter((p) => p.permission !== 'take-payment') } : r)) };
}

async function start(o: { catchUp?: number | null; stuckAfter?: number; credentialNames?: string[] } = {}): Promise<void> {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  const menu: BranchConfig = { ...voidsMenu(), billing: billingDoc(o) };
  openDay(hub, { menu });
  fake = fakeAdapter({ key: 'FAKE', ordering: 'strict_per_pos_id', credentialNames: o.credentialNames ?? ['token'] });
  registerFiscalAdapter(fake);
  commandRegistry(hub.app).register(countedRetry());
  manager = signIn(hub, STAFF.manager);
  cashier = signIn(hub, STAFF.cashier);
  waiter = signIn(hub, STAFF.orderTaker);
  counter = statementCounter(hub.deps.db);
}

let retryStatements = -1;
/** The real RetryFiscalNow handler under a test-only name, so its own statements are counted (02a SG-3 pattern). */
function countedRetry(): typeof retryFiscalNowCommand {
  return defineCommand({
    ...retryFiscalNowCommand,
    commandType: 'TestRetryFiscalNowCounted',
    handle(...args: Parameters<typeof retryFiscalNowCommand.handle>) {
      const before = counter!.count;
      try {
        return retryFiscalNowCommand.handle(...args);
      } finally {
        retryStatements = counter!.count - before;
      }
    },
  });
}

let seq = 0;
type RowState = 'pending' | 'acked' | 'rejected' | 'not_required';
/** One outbox row queued `age` ms before now (ord grows with each call). */
function addRow(o: { state?: RowState; age?: number; pos_id?: string | null; adapter_key?: string; next_try_at?: number; acked_at?: number | null; last_error?: string | null } = {}): string {
  seq += 1;
  const invoice_id = `INV-${String(seq).padStart(4, '0')}`;
  const now = hub.clock.branchNow();
  hub.deps.db
    .prepare(
      `INSERT INTO fiscal_outbox (invoice_id, ord, ref_invoice_id, jurisdiction_id, adapter_key, pos_id, state, queued_at, acked_at, attempts, next_try_at, last_error)
       VALUES (?, ?, NULL, 'TEST-J', ?, ?, ?, ?, ?, 2, ?, ?)`,
    )
    .run(
      invoice_id,
      100_000 + seq,
      o.adapter_key ?? 'FAKE',
      o.pos_id === undefined ? 'POS-1' : o.pos_id,
      o.state ?? 'pending',
      now - (o.age ?? 0),
      o.acked_at ?? (o.state === 'acked' ? now - (o.age ?? 0) + 1_000 : null),
      o.next_try_at ?? now + 300_000,
      o.last_error ?? null,
    );
  return invoice_id;
}

function setState(invoice_id: string, state: RowState): void {
  hub.deps.db.prepare('UPDATE fiscal_outbox SET state = ? WHERE invoice_id = ?').run(state, invoice_id);
}

function setToken(pos_id: string, name = 'token', at = hub.clock.branchNow()): void {
  hub.deps.db.prepare('INSERT INTO fiscal_credentials (pos_id, name, token, set_at, set_by_staff_id) VALUES (?, ?, ?, ?, ?)').run(pos_id, name, TOKEN, at, 'S_OWNER');
}

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

/** One pass of `tick` as the loop runs it: due on the read-only view, then its own writer.run with the intents appended. */
function pass(tick: TickDef = fiscalStuckTick): { due: boolean; dueStatements: number; intentStatements: number; events: Stored[] } {
  const now = hub.clock.branchNow();
  const before = counter!.count;
  const due = tick.due(readOnlyDb(hub.deps.db), hub.deps.state.get() as EngineState, now);
  const dueStatements = counter!.count - before;
  if (!due) return { due, dueStatements, intentStatements: -1, events: [] };
  let intentStatements = -1;
  const { appended } = hub.deps.writer.run((tx) => {
    const start = counter!.count;
    const drafts = tick.intents(tx, hub.deps.state.get() as EngineState, now);
    intentStatements = counter!.count - start;
    return tx.append(drafts);
  });
  return {
    due,
    dueStatements,
    intentStatements,
    events: appended.map((e) => ({ event_type: e.event_type, stream_type: e.stream_type, stream_id: e.stream_id, actor_id: e.actor_id, device_id: e.device_id, payload: e.payload as Record<string, unknown> })),
  };
}

/** Every alert of the kind, oldest first. */
function stuckAlerts(): Array<{ alert_id: string; state: string; dedupe_key: string; closed_reason: string | null; details: Record<string, unknown> }> {
  return (
    hub.deps.db
      .prepare(`SELECT alert_id, state, dedupe_key, close_reason AS closed_reason, details_json FROM alerts WHERE kind = 'fiscal_outbox_stuck' ORDER BY raised_at, raised_seq`)
      .all() as Array<{ alert_id: string; state: string; dedupe_key: string; closed_reason: string | null; details_json: string | null }>
  ).map((a) => ({ alert_id: a.alert_id, state: a.state, dedupe_key: a.dedupe_key, closed_reason: a.closed_reason, details: a.details_json === null ? {} : (JSON.parse(a.details_json) as Record<string, unknown>) }));
}

function closeDay(): void {
  hub.clock.advance(1_000);
  const now = hub.clock.branchNow();
  hub.deps.writer.run((tx) =>
    tx.append([{ stream_type: 'hub', stream_id: tx.branchId, event_type: 'BusinessDayClosed', schema_version: 1, payload: {}, occurred_at: now, actor_id: STAFF.manager, device_id: 'D_FIXTURE' }]),
  );
}

async function status(who: Who): Promise<{ statusCode: number; body: string; data: FiscalStatus; error?: { code: string; details: Record<string, unknown> } }> {
  const res = await hub.app.inject({ method: 'GET', url: '/queries/fiscal-status', headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken } });
  const body = res.json() as { data: FiscalStatus; error?: { code: string; details: Record<string, unknown> } };
  return { statusCode: res.statusCode, body: res.body, data: body.data, ...(body.error === undefined ? {} : { error: body.error }) };
}

const retry = (who: Who, payload: Record<string, unknown> = {}) => post(hub, who, 'retry-fiscal-now', 'RetryFiscalNow', payload);

function row(invoice_id: string): { state: string; next_try_at: number; attempts: number; last_error: string | null } {
  return hub.deps.db.prepare('SELECT state, next_try_at, attempts, last_error FROM fiscal_outbox WHERE invoice_id = ?').get(invoice_id) as {
    state: string;
    next_try_at: number;
    attempts: number;
    last_error: string | null;
  };
}

// ================================================================================================ the stuck tick (#73)

describe('[05 §3.15 Stuck, G-22] the fiscal_outbox_stuck tick (01d registerTick)', () => {
  it('[05 P0.G G-22] registered once per process, after 01d’s own alerts tick (so a day-close expiry is closed before the re-raise)', async () => {
    await start();
    const second = await createTestHub();
    await second.close();
    const ticks = registeredTicks();
    expect(ticks.filter((t) => t.name === FISCAL_STUCK_TICK)).toEqual([fiscalStuckTick]);
    expect(ticks.indexOf(alertsTick)).toBeLessThan(ticks.indexOf(fiscalStuckTick));
  });

  it('[05 #73] threshold: a pending row exactly stuck_after_ms old is not stuck; 1 ms older it is → one alert to the managers, details counts only', async () => {
    await start();
    addRow({ age: STUCK_AFTER });
    expect(pass().due).toBe(false);
    expect(stuckAlerts()).toEqual([]);

    hub.clock.advance(1);
    const p = pass();
    expect(p.due).toBe(true);
    expect(p.events.map((e) => e.event_type)).toEqual(['AlertRaised', 'AttemptSent']);
    const raised = p.events[0]!;
    expect(raised).toMatchObject({ stream_type: 'hub', stream_id: BRANCH, actor_id: null, device_id: 'hub' });
    expect(raised.payload).toMatchObject({ kind: 'fiscal_outbox_stuck', dedupe_key: `fiscal_stuck:${BRANCH}`, target: { kind: 'managers' }, details: { quantity: 1, minutes_late: 30 } });
    // counts only: no invoice id, no ref, no pos_id, no code in the alert
    expect(Object.keys(raised.payload['details'] as object).sort()).toEqual(['minutes_late', 'quantity']);
    expect(JSON.stringify(raised.payload)).not.toContain('INV-');
    expect(stuckAlerts()).toMatchObject([{ state: 'open', dedupe_key: `fiscal_stuck:${BRANCH}` }]);
  });

  it('[05 #73] half the catch-up window: a smaller limit than stuck_after_ms wins; a larger one does not', async () => {
    await start({ catchUp: 2 * 1_000_000 }); // half = 1 000 000 < 1 800 000
    expect(stuckThresholdMs(hubBilling(branchConfig()!), null)).toBe(1_000_000);
    addRow({ age: 1_000_000 });
    expect(pass().due).toBe(false);
    hub.clock.advance(1);
    expect(pass().events.map((e) => e.event_type)).toContain('AlertRaised');
  });

  it('[05 #73] a catch-up window larger than twice stuck_after_ms leaves stuck_after_ms in force', async () => {
    await start({ catchUp: 604_800_000 });
    addRow({ age: STUCK_AFTER });
    expect(pass().due).toBe(false);
    hub.clock.advance(1);
    expect(pass().due).toBe(true);
  });

  it('[05 #73] a rejected row is stuck at once, whatever its age; acked and not_required rows never are', async () => {
    await start();
    addRow({ state: 'acked', age: 10 * STUCK_AFTER });
    addRow({ state: 'not_required', age: 10 * STUCK_AFTER });
    addRow({ age: 1_000 }); // young pending
    expect(pass().due).toBe(false);
    addRow({ state: 'rejected', age: 2 * MIN, last_error: 'mode_unmapped' });
    const p = pass();
    expect(p.events[0]!.payload).toMatchObject({ details: { quantity: 1, minutes_late: 2 } });
  });

  it('[05 #73] quantity = every stuck row (old pending + rejected); minutes_late = the oldest one’s age in whole minutes', async () => {
    await start();
    addRow({ state: 'rejected', age: 45 * MIN + 59_000 });
    addRow({ age: 31 * MIN });
    addRow({ age: 50 * MIN + 1 });
    addRow({ age: 1_000 }); // not stuck
    expect(pass().events[0]!.payload).toMatchObject({ details: { quantity: 3, minutes_late: 50 } });
  });

  it('[05 #73] dedupe: one open alert at a time — later passes while stuck (even with more rows stuck) raise nothing', async () => {
    await start();
    addRow({ age: STUCK_AFTER + 1 });
    expect(pass().events.map((e) => e.event_type)).toContain('AlertRaised');
    expect(pass().due).toBe(false);
    addRow({ state: 'rejected' });
    addRow({ age: STUCK_AFTER + 5 });
    hub.clock.advance(10 * MIN);
    expect(pass().due).toBe(false);
    expect(stuckAlerts().map((a) => a.state)).toEqual(['open']);
  });

  it('[05 #73] closed `done` by the tick when no row is stuck any more; nothing due afterwards', async () => {
    await start();
    const a = addRow({ age: STUCK_AFTER + 1 });
    const b = addRow({ state: 'rejected' });
    pass();
    setState(a, 'acked');
    expect(pass().due).toBe(false); // b is still rejected: still stuck, the open alert stays
    setState(b, 'acked');
    const p = pass();
    expect(p.events.map((e) => e.event_type)).toEqual(['AlertClosed']);
    expect(p.events[0]).toMatchObject({ actor_id: null, device_id: 'hub', payload: { reason: 'done', by_staff_id: null } });
    expect(stuckAlerts()).toMatchObject([{ state: 'closed', closed_reason: 'done' }]);
    expect(pass().due).toBe(false);
  });

  it('[05 #73, H1-18] after a day-close expiry the tick re-raises with the same dedupe key while a row is still stuck', async () => {
    await start();
    addRow({ state: 'rejected' });
    const first = pass().events[0]!.payload['alert_id'] as string;
    closeDay();
    // marked expire_due by the projection, still open until 01d's tick: the fiscal tick neither closes nor raises
    expect(pass().due).toBe(false);
    const expiry = pass(alertsTick);
    expect(expiry.events).toMatchObject([{ event_type: 'AlertClosed', payload: { alert_id: first, reason: 'expired' } }]);
    const again = pass();
    expect(again.events.map((e) => e.event_type)).toEqual(['AlertRaised', 'AttemptSent']);
    expect(again.events[0]!.payload).toMatchObject({ dedupe_key: `fiscal_stuck:${BRANCH}`, details: { quantity: 1 } });
    expect(again.events[0]!.payload['alert_id']).not.toBe(first);
    const all = stuckAlerts();
    expect(all.map((a) => [a.state, a.closed_reason])).toEqual([
      ['closed', 'expired'],
      ['open', null],
    ]);
    expect(new Set(all.map((a) => a.dedupe_key))).toEqual(new Set([`fiscal_stuck:${BRANCH}`]));
  });

  it('[05 #73, H1-18] cleared before the day-close expiry: expired by 01d, never closed `done` twice, not re-raised', async () => {
    await start();
    const a = addRow({ state: 'rejected' });
    pass();
    closeDay();
    setState(a, 'acked');
    expect(pass().due).toBe(false); // expire_due: 01d's tick closes it
    pass(alertsTick);
    expect(pass().due).toBe(false);
    expect(stuckAlerts().map((x) => [x.state, x.closed_reason])).toEqual([['closed', 'expired']]);
  });

  it('[05 §5, §3.15] statements: due is 1 whatever the outbox holds; intents are fixed (1 stuck row = 40 stuck rows)', async () => {
    await start();
    addRow({ age: 1 });
    expect(pass().dueStatements).toBe(1);
    addRow({ state: 'rejected' });
    const one = pass();
    expect(one.dueStatements).toBe(1);
    const raiseCount = one.intentStatements;
    expect(raiseCount).toBeGreaterThan(0);
    // the same hub raising with 40 stuck rows: close it first, then add rows
    hub.deps.db.prepare(`UPDATE fiscal_outbox SET state = 'acked'`).run();
    const closed = pass();
    expect(closed.dueStatements).toBe(1);
    const closeCount = closed.intentStatements;
    for (let i = 0; i < 20; i += 1) addRow({ state: 'rejected' });
    for (let i = 0; i < 20; i += 1) addRow({ age: STUCK_AFTER + 1 + i });
    const forty = pass();
    expect(forty.dueStatements).toBe(1);
    expect(forty.events[0]!.payload).toMatchObject({ details: { quantity: 40 } });
    expect(forty.intentStatements).toBe(raiseCount);
    hub.deps.db.prepare(`UPDATE fiscal_outbox SET state = 'acked'`).run();
    expect(pass().intentStatements).toBe(closeCount);
  });

  it('[05 §5] the tick reads the outbox through its partial indexes (never a scan of the never-pruned table)', async () => {
    await start();
    const plans = (hub.deps.db.prepare(`EXPLAIN QUERY PLAN ${STUCK_SQL}`).all({ cut: 0 }) as Array<{ detail: string }>).map((p) => p.detail);
    const outbox = plans.filter((d) => d.includes('fiscal_outbox'));
    expect(outbox.length).toBeGreaterThan(0);
    for (const d of outbox) expect(d, d).toMatch(/USING (COVERING )?INDEX fiscal_outbox_(pending|rejected)/);
  });
});

// ================================================================================================ fiscal-status (§6.27)

describe('[05 §6.27] GET /queries/fiscal-status', () => {
  it('[05 §6.27] take-payment (Cashier) or view-reports (Manager) may read it; a person with neither → 403', async () => {
    await start();
    expect((await status(cashier)).statusCode).toBe(200);
    expect((await status(manager)).statusCode).toBe(200);
    const denied = await status(waiter);
    expect(denied.statusCode).toBe(403);
    expect(denied.error).toMatchObject({ code: 'PERMISSION_DENIED', details: { permission: 'take-payment' } });
  });

  it('[05 §6.27, H11-4] the result: jurisdiction, adapter, counts, oldest age, stuck, catch-up, tokens per name and the missing ones', async () => {
    await start({ catchUp: 604_800_000, credentialNames: ['api_key', 'device_key'] });
    const t0 = hub.clock.branchNow();
    addRow({ state: 'acked', age: 50 * MIN, acked_at: t0 - 40 * MIN });
    addRow({ state: 'acked', age: 20 * MIN, acked_at: t0 - 10 * MIN });
    addRow({ age: 5 * MIN });
    addRow({ age: 2 * MIN, pos_id: 'POS-9' }); // a pending row on a pos_id the settings no longer list
    addRow({ state: 'rejected', age: 60 * MIN });
    addRow({ state: 'not_required', age: 90 * MIN });
    setToken('POS-1', 'api_key', t0 - 1_000);
    setToken('POS-2', 'api_key', t0 - 2_000);
    setToken('POS-2', 'device_key', t0 - 3_000);
    const r = await status(cashier);
    expect(r.statusCode).toBe(200);
    expect(r.data).toEqual({
      jurisdiction_id: 'TEST-J',
      adapter_key: 'FAKE',
      environment: 'sandbox',
      adapter_health: 'unknown',
      last_success_at: t0 - 10 * MIN,
      pending_count: 2,
      oldest_pending_age_ms: 5 * MIN,
      rejected_count: 1,
      catch_up_window_ms: 604_800_000,
      stuck: true,
      token_missing: [
        { pos_id: 'POS-1', name: 'device_key' },
        { pos_id: 'POS-9', name: 'api_key' },
        { pos_id: 'POS-9', name: 'device_key' },
      ],
      tokens: [
        { pos_id: 'POS-1', name: 'api_key', set_at: t0 - 1_000 },
        { pos_id: 'POS-2', name: 'api_key', set_at: t0 - 2_000 },
        { pos_id: 'POS-2', name: 'device_key', set_at: t0 - 3_000 },
      ],
    });
  });

  it('[05 §6.27] an empty outbox: zero counts, nulls, not stuck; adapter health from the worker’s last check', async () => {
    await start();
    setToken('POS-1');
    setToken('POS-2');
    const r = await status(manager);
    expect(r.data).toMatchObject({ last_success_at: null, pending_count: 0, oldest_pending_age_ms: null, rejected_count: 0, catch_up_window_ms: null, stuck: false, token_missing: [], adapter_health: 'unknown' });
    // the worker's health check (29a, at most every 60 s while rows wait) is what fiscal-status shows
    addRow({ age: 1_000, next_try_at: hub.clock.branchNow() + 60_000 });
    fake.setHealth('failing');
    await runOnce(workerDeps());
    expect((await status(manager)).data.adapter_health).toBe('failing');
  });

  it('[05 §6.27] stuck agrees with the tick: a young pending row only → false; past the threshold → true', async () => {
    await start();
    addRow({ age: STUCK_AFTER });
    expect((await status(cashier)).data.stuck).toBe(false);
    hub.clock.advance(1);
    expect((await status(cashier)).data.stuck).toBe(true);
  });

  it('[05 #77, OQ-3] never a token, never a buyer: the token value is in no answer and no log line', async () => {
    await start();
    setToken('POS-1');
    setToken('POS-2', 'token', hub.clock.branchNow() - 5);
    addRow({ age: STUCK_AFTER + 1 });
    const r = await status(manager);
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(TOKEN);
    expect(JSON.stringify(r.data.tokens)).toBe(JSON.stringify([
      { pos_id: 'POS-1', name: 'token', set_at: hub.clock.branchNow() },
      { pos_id: 'POS-2', name: 'token', set_at: hub.clock.branchNow() - 5 },
    ]));
    for (const t of r.data.tokens) expect(Object.keys(t).sort()).toEqual(['name', 'pos_id', 'set_at']);
    pass();
    await retry(manager);
    expect(hub.logs()).not.toContain(TOKEN);
    // the credentials read selects exactly the three non-secret columns (a future SELECT of the secret fails here)
    expect(CREDENTIALS_SQL.match(/^SELECT (.*) FROM fiscal_credentials/)?.[1]?.split(',').map((c) => c.trim())).toEqual(['pos_id', 'name', 'set_at']);
  });

  it('[05 §6.27] statements: 3, whatever the number of rows and credentials', async () => {
    await start();
    const count = (): number => {
      const before = counter!.count;
      fiscalStatus({ db: hub.deps.db, directory: currentDirectoryOf(), config: branchConfigNow(), staffId: STAFF.cashier, now: hub.clock.branchNow(), state: hub.deps.state.get() as EngineState });
      return counter!.count - before;
    };
    expect(count()).toBe(3);
    for (let i = 0; i < 30; i += 1) {
      addRow({ age: i * MIN });
      addRow({ state: 'rejected' });
      addRow({ state: 'acked', age: i });
      addRow({ pos_id: `POS-X${i}` });
      setToken(`POS-T${i}`);
    }
    expect(count()).toBe(3);
  });

  it('[05 C8] the grant before any read: a refused caller costs 0 statements', async () => {
    await start();
    const before = counter!.count;
    expect(() =>
      fiscalStatus({ db: hub.deps.db, directory: currentDirectoryOf(), config: branchConfigNow(), staffId: STAFF.orderTaker, now: hub.clock.branchNow(), state: hub.deps.state.get() as EngineState }),
    ).toThrow(expect.objectContaining({ code: 'PERMISSION_DENIED' }));
    expect(counter!.count - before).toBe(0);
  });
});

// ================================================================================================ RetryFiscalNow (§6.28)

describe('[05 §6.28, G-12] RetryFiscalNow', () => {
  it('[05 §6.28] needs close-business-day: the Cashier is refused 403, the Manager is allowed', async () => {
    await start();
    const denied = await retry(cashier);
    expect(denied.status).toBe(403);
    expect(denied.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect((await retry(manager)).status).toBe(200);
  });

  it('[05 #72 RetryFiscalNow half] pending rows get next_try_at = now (attempts and last_error kept); rejected, acked and not_required rows untouched; no event', async () => {
    await start();
    const later = hub.clock.branchNow() + 300_000;
    const a = addRow({ age: STUCK_AFTER + 1, next_try_at: later, last_error: 'timeout' });
    const b = addRow({ age: 10, next_try_at: later, pos_id: 'POS-2' });
    const rej = addRow({ state: 'rejected', next_try_at: later, last_error: 'mode_unmapped' });
    const ack = addRow({ state: 'acked', next_try_at: later });
    const nr = addRow({ state: 'not_required', next_try_at: later });
    const eventsBefore = (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
    hub.clock.advance(1_000);
    const now = hub.clock.branchNow();
    const r = await retry(manager);
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ pending_count: 2 });
    expect(r.events).toEqual([]);
    expect(row(a)).toEqual({ state: 'pending', next_try_at: now, attempts: 2, last_error: 'timeout' });
    expect(row(b)).toMatchObject({ state: 'pending', next_try_at: now });
    expect(row(rej)).toEqual({ state: 'rejected', next_try_at: later, attempts: 2, last_error: 'mode_unmapped' });
    expect(row(ack)).toMatchObject({ state: 'acked', next_try_at: later });
    expect(row(nr)).toMatchObject({ state: 'not_required', next_try_at: later });
    expect((hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM events WHERE event_type NOT IN ('CommandProcessed')`).get() as { n: number }).n).toBe(eventsBefore);
  });

  it('[05 §6.28, G-12] the command never sends (no runOnce await, no wake API); the worker’s next pass resends the same key; the rejected row is not resent', async () => {
    await start();
    setToken('POS-1');
    const pending = addRow({ age: STUCK_AFTER + 1, next_try_at: hub.clock.branchNow() + 300_000 });
    addRow({ state: 'rejected' });
    fake.setDefault({ outcome: 'ok', fiscal_number: 'F-1', qr_payload: null });
    const deps = workerDeps();
    expect(await runOnce(deps)).toBe(0); // backing off
    const r = await retry(manager);
    expect(r.result).toEqual({ pending_count: 1 });
    expect(fake.calls).toEqual([]); // the command sent nothing
    expect(await runOnce(deps)).toBe(1);
    expect(fake.calls.map((c) => c.sub.idempotency_key)).toEqual([`REF-${pending}`]);
  });

  it('[05 §6.28] statements: 1 (one plain UPDATE), whatever the number of pending rows', async () => {
    await start();
    addRow();
    expect((await post(hub, manager, 'test-retry-fiscal-now-counted', 'TestRetryFiscalNowCounted', {})).status).toBe(200);
    expect(retryStatements).toBe(1);
    for (let i = 0; i < 40; i += 1) addRow({ pos_id: `POS-${i}` });
    const r = await post(hub, manager, 'test-retry-fiscal-now-counted', 'TestRetryFiscalNowCounted', {});
    expect(r.result).toEqual({ pending_count: 41 });
    expect(retryStatements).toBe(1);
  });

  it('[05 §6.28] the payload is `{}`: an extra key → 400 VALIDATION_FAILED', async () => {
    await start();
    const r = await retry(manager, { invoice_id: 'INV-0001' });
    expect(r.status).toBe(400);
    expect(r.error).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

// ------------------------------------------------------------------------------------------------ helpers (late)

function currentDirectoryOf(): StaffDirectory {
  return currentDirectory(hub.app);
}

function branchConfigNow(): BranchConfig | null {
  return branchConfig();
}

/** 29a's worker over the hub's database with the FAKE adapter and a stub loadSubmission (idempotency_key = `REF-<id>`). */
function workerDeps(): FiscalWorkerDeps {
  return {
    db: hub.deps.db,
    clock: hub.clock,
    adapterFor: (key) => (key === 'FAKE' ? fake : null),
    loadSubmission: (r: FiscalWorkRow): LoadedSubmission => {
      const full = aSubmission();
      return {
        ok: true,
        submission: { currency_code: full.currency_code, currency_exponent: full.currency_exponent, prices_include_tax: full.prices_include_tax, seller: full.seller, config: full.config, invoice: { ...full.invoice, invoice_ref: `REF-${r.invoice_id}` } },
        original: null,
      };
    },
    onAnswer: (r) => {
      hub.deps.db.prepare(`UPDATE fiscal_outbox SET state = 'acked', acked_at = ? WHERE invoice_id = ?`).run(hub.clock.branchNow(), r.invoice_id);
    },
  };
}
