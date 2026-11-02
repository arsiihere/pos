import { fileURLToPath } from 'node:url';
import type { AlertTarget } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { alerts, bindAlertEnv, type RaiseInput } from '../../src/alerts/raise';
import { registerRoute, unregisterRoute } from '../../src/alerts/routes';
import { registerTargetResolver, targetKey, unregisterTargetResolver } from '../../src/alerts/targets';
import { alertsTick } from '../../src/alerts/tick';
import { StaffDirectory, type DirectoryCore } from '../../src/auth/staff-directory';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { readOnlyDb } from '../../src/engine-host/read-only-tx';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type Writer, type WriterTx } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry, type Projection } from '../../src/projections/registry';
import type { WsHub } from '../../src/ws/server';
import { freshDb } from '../helpers/db';
import { statementCounter } from '../helpers/statement-counter';
import { FAKE_STEP_1_MS, fakePager, fakeTableOwner, fakeZoneOrderTaker, registerFakes, resetFakes } from './fakes';

// 01d task 30: §10 test 35, the statement bounds asserted separately (§3.5 "Reads per tick", "Projection
// reads", "Several raises"; §7 Performance), on a migrated hub database with the alert projections and the
// test fakes (batched fake tableOwner / zone order taker resolvers, batched fake pager route).
//
// Spec naming (§3.5): R = resolver statements (one per resolver kind the alerts use), T = route statements
// (one `routesFor` per registered route). Here R = 2 (table_team + zone_order_taker, the §3.4.2 fallback read of
// a lead_fallback kind) and T = 1 (fakePager).
//
// Tick bound: the spec's 1 + 8 + R + T counts read (2), the dirty flags (task 31). With the flag clean the
// tick's count is exactly the bound.

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const BRANCH = 'branch-1';
const MGR = 'S_MGR'; // approve-void, branch scope (answerer of the requests)
const REQ = 'S_REQ'; // void-item requires approval by R_MGR (requester)
const L_BIG = 'S_LBIG'; // lead of 50
const L_SMALL = 'S_LSMALL'; // lead of 2
const PEOPLE = 150;
const pid = (i: number): string => `S_P${String(i).padStart(3, '0')}`;
const tid = (i: number): string => `T${String(i).padStart(3, '0')}`;

const R = 2; // table_team + zone_order_taker
const ROUTES = 1; // T: fakePager
const TICK_BOUND = 1 + 8 + R + ROUTES; // §3.5, with read (2)
const TICK_TODAY = 1 + 8 + R + ROUTES; // read (2), the dirty flags, included (task 31)

type Grant = DirectoryCore['roles'][number]['permissions'][number];
const grant = (g: Omit<Grant, 'approver_role_ids'> & { approver_role_ids?: string[] }): Grant => ({ ...g, approver_role_ids: g.approver_role_ids ?? [] });
const person = (staff_id: string, role_ids: string[], lead_staff_id: string | null): DirectoryCore['staff'][number] => ({
  staff_id,
  display_name: staff_id,
  pin_hash: 'h',
  role_ids,
  denied_permissions: [],
  lead_staff_id,
  floor_ids: [],
});

const dir = StaffDirectory.fromInput({
  directory_version: 1,
  roles: [
    { role_id: 'R0', name: 'r0', session_idle_ttl_ms: 300_000, permissions: [] },
    { role_id: 'R_MGR', name: 'mgr', session_idle_ttl_ms: 300_000, permissions: [grant({ permission: 'approve-void', grant_type: 'allowed', scope: 'branch' })] },
    {
      role_id: 'R_REQ',
      name: 'req',
      session_idle_ttl_ms: 300_000,
      permissions: [grant({ permission: 'void-item', grant_type: 'requires_approval', approver_role_ids: ['R_MGR'], scope: 'branch' })],
    },
  ],
  staff: [
    person(MGR, ['R_MGR'], null),
    person(REQ, ['R_REQ'], null),
    person(L_BIG, ['R0'], null),
    person(L_SMALL, ['R0'], null),
    ...Array.from({ length: PEOPLE }, (_, i) => person(pid(i), ['R0'], i < 50 ? L_BIG : i < 52 ? L_SMALL : null)),
  ],
  responsibilities: [],
});

// ------------------------------------------------------------------------------------------- recorder

interface Exec {
  sql: string;
  reader: boolean;
}

/** Every statement executed on the connection (get / all / run), in order, with whether it returns rows. */
function recorder(db: Database.Database): Exec[] {
  const log: Exec[] = [];
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const wrap =
      <A extends unknown[], Res>(original: (...args: A) => Res) =>
      (...args: A): Res => {
        log.push({ sql, reader: statement.reader });
        return original(...args);
      };
    statement.get = wrap(statement.get.bind(statement));
    statement.all = wrap(statement.all.bind(statement));
    statement.run = wrap(statement.run.bind(statement));
    return statement;
  }) as typeof db.prepare;
  return log;
}

/** The fixed set of §3.5 (3)–(6) and (9), by statement text (targets.ts readFixed). */
const FIXED: Record<string, RegExp> = {
  sessions: /ended_at IS NULL AND kind = 'staff'/,
  bindings: /FROM device_bindings ORDER BY device_id/,
  devices: /FROM devices WHERE branch_id = \? AND revoked_at IS NULL/,
  presence: /FROM presence_today/,
  activity: /MAX\(last_activity_at\)/,
};
const fixedCounts = (log: readonly Exec[]): Record<string, number> =>
  Object.fromEntries(Object.entries(FIXED).map(([name, re]) => [name, log.filter((e) => re.test(e.sql)).length]));

// -------------------------------------------------------------------------------------------- harness

interface ProjectionEntry {
  event_type: string;
  reads: number;
}

interface Harness {
  db: Database.Database;
  writer: Writer;
  clock: ReturnType<typeof fixedClock>;
  log: Exec[];
  counter: ReturnType<typeof statementCounter>;
  /** reads of the `alerts` projection's apply, one entry per event it applied (spy scoped to its apply) */
  projection: ProjectionEntry[];
}

function harness(cleanups: Array<() => void>): Promise<Harness> {
  return (async () => {
    const fx = freshDb();
    cleanups.push(fx.cleanup);
    const clock = fixedClock(T);
    await runMigrations(fx.db, { dir: migrations, clock });
    const counter = statementCounter(fx.db);
    const log = recorder(fx.db);
    const projection: ProjectionEntry[] = [];
    const registry = createProjectionRegistry();
    const register = registry.register.bind(registry);
    registry.register = (p: Projection) => {
      if (p.name !== 'alerts') return register(p);
      register({
        ...p,
        apply(tx, event, mode) {
          const start = log.length;
          try {
            p.apply(tx, event, mode);
          } finally {
            projection.push({ event_type: event.event_type, reads: log.slice(start).filter((e) => e.reader).length });
          }
        },
      });
    };
    registerAlertProjections(registry);
    const state = createStateHolder({});
    state.setReducer((current) => current);
    const writer = createWriter({
      db: fx.db,
      clock,
      ids: testIdGen(),
      tenantId: 'tenant-1',
      branchId: BRANCH,
      projections: registry,
      state,
      authGeneration: createAuthGeneration(),
      publish: () => undefined,
    });
    const hub = { connectedSessions: () => [], alertSockets: () => [] } as unknown as WsHub;
    bindAlertEnv(fx.db, { directory: () => dir, ws: () => hub });
    // 0006 seeds the no_approver flag dirty; these scenarios measure the step pass with the flag clean
    fx.db.prepare('UPDATE alert_flags SET dirty = 0').run();
    return { db: fx.db, writer, clock, log, counter, projection };
  })();
}

const display = { kind_label_key: 'alert.k' };

function twoStep(n: number, target: AlertTarget, key = 'due'): RaiseInput {
  return { kind: 't_two_step', subject: { stream_type: 'hub', stream_id: BRANCH }, target, display, dedupe_key: `${key}:${n}` };
}

/** §10 #35 (a): mixed person, team and table-team targets; a single alert is table-team (same resolver kinds). */
function mixedTarget(i: number, n: number): AlertTarget {
  if (n === 1) return { kind: 'table_team', table_id: tid(i) };
  switch (i % 3) {
    case 0:
      return { kind: 'person', staff_id: pid(i) };
    case 1:
      return { kind: 'team', lead_staff_id: L_BIG, depth: 'direct' };
    default:
      return { kind: 'table_team', table_id: tid(i) };
  }
}

const voidInput = (n: number): RaiseInput => ({
  kind: 't_approval',
  subject: { stream_type: 'order', stream_id: `O${n}` },
  target: { kind: 'answerers' },
  values: { order_id: `O${n}` },
  display,
  details: { item: 'Mutton platter', quantity: 1, amount: 480_000, reason: 'customer changed mind' },
  dedupe_key: `void:O${n}`,
  requester_staff_id: REQ,
  request: { approver_role_ids: ['R_MGR'] },
});

const tableInput = (i: number): RaiseInput => ({
  kind: 't_action',
  subject: { stream_type: 'table', stream_id: tid(i) },
  target: { kind: 'table_team', table_id: tid(i) },
  display,
  dedupe_key: `act:${i}`,
});

function raiseAll(h: Harness, inputs: RaiseInput[]): string[] {
  return h.writer.run((tx) => {
    const results = alerts.raiseMany(alerts.tickCtx(tx, h.clock.branchNow()), inputs);
    tx.append(results.flatMap((r) => r.events));
    return results.map((r) => r.alert_id);
  }).result;
}

interface TickMeasure {
  /** statements of `due` + `intents` (+ batchReads, resolvers, routesFor inside intents), statementCounter */
  statements: number;
  /** of those, the ones that read (SELECT): every one of them */
  reads: number;
  fixed: Record<string, number>;
  /** `alerts` projection reads per event applied by the tick's transaction */
  projection: ProjectionEntry[];
  /** `alerts` projection reads per AlertClosed of a closeMany of the due alerts */
  closes: ProjectionEntry[];
  steps: number;
}

/**
 * Raises `due` alerts of mixed targets at T, then `others` open alerts that are not due at the tick (half with
 * a later step, half with none), runs the alerts tick once at T + step 1, and closes the stepped alerts.
 */
async function tickScenario(cleanups: Array<() => void>, due: number, others = 0): Promise<TickMeasure> {
  const h = await harness(cleanups);
  for (let i = 0; i < PEOPLE; i += 1) {
    fakeTableOwner.owners.set(tid(i), pid(i));
    fakePager.refs.set(pid(i), [`P-${pid(i)}`]);
  }
  fakeZoneOrderTaker.takers.set(tid(2), pid(3));
  const ids = raiseAll(
    h,
    Array.from({ length: due }, (_, i) => twoStep(i, mixedTarget(i, due))),
  );
  if (others > 0) {
    h.clock.set(T + FAKE_STEP_1_MS / 2);
    raiseAll(
      h,
      Array.from({ length: others }, (_, i) => {
        const target: AlertTarget = { kind: 'person', staff_id: pid(i % PEOPLE) };
        return i % 2 === 0
          ? twoStep(i, target, 'other')
          : { kind: 't_info', subject: { stream_type: 'hub', stream_id: BRANCH }, target, display, dedupe_key: `info:${i}` };
      }),
    );
  }
  h.db.prepare('UPDATE alert_flags SET dirty = 0').run(); // nothing above marks it, but be explicit
  h.clock.set(T + FAKE_STEP_1_MS);
  const now = h.clock.branchNow();
  fakeTableOwner.calls.length = 0;
  fakeZoneOrderTaker.calls.length = 0;
  fakePager.calls.length = 0;

  // (a) the tick's own reads: due (outside the transaction, read-only view) and intents (inside)
  const start = h.log.length;
  h.counter.reset();
  expect(alertsTick.due(readOnlyDb(h.db), {} as never, now)).toBe(true);
  let statements = h.counter.count;
  const dueEnd = h.log.length;
  let tickLog: Exec[] = [];
  h.projection.length = 0;
  const { result: appended } = h.writer.run((tx) => {
    h.counter.reset();
    const at = h.log.length;
    const drafts = alertsTick.intents(tx, {} as never, now);
    statements += h.counter.count;
    tickLog = [...h.log.slice(start, dueEnd), ...h.log.slice(at)];
    return tx.append(drafts);
  });
  const projection = [...h.projection];
  const steps = appended.filter((e) => e.event_type === 'AttemptSent' || e.event_type === 'EscalationStepped').length;
  // one resolver call per kind and one routesFor per route, whatever the number of due alerts
  expect(fakeTableOwner.calls).toHaveLength(1);
  expect(fakeZoneOrderTaker.calls).toHaveLength(1);
  expect(fakePager.calls.length).toBeLessThanOrEqual(1);

  // (b) the close events of the same alerts
  h.projection.length = 0;
  h.writer.run((tx) => tx.append(alerts.closeMany(alerts.tickCtx(tx, now), ids.map((alert_id) => ({ alert_id, reason: 'done' as const })))));
  const closes = h.projection.filter((e) => e.event_type === 'AlertClosed');

  return { statements, reads: tickLog.filter((e) => e.reader).length, fixed: fixedCounts(tickLog), projection, closes, steps };
}

/**
 * §10 #35 (a): the tick's reads are the same count for 1 and for 150 due alerts and within 1 + 8 + R + T.
 * Throws (a failed expectation) when either does not hold: a per-person route or resolver fails here.
 */
function expectTickBound(one: TickMeasure, many: TickMeasure): void {
  expect(many.statements, 'tick statements grow with the number of due alerts').toBe(one.statements);
  expect(one.statements, 'tick statements over 1 + 8 + R + T').toBeLessThanOrEqual(TICK_BOUND);
  expect(many.statements, 'tick statements over 1 + 8 + R + T').toBeLessThanOrEqual(TICK_BOUND);
}

describe('01d statement bounds (§3.5, §7; test 35)', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => registerFakes());
  afterEach(() => {
    unregisterRoute('pager_per_person');
    resetFakes();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01d #35] (a) tick reads: due + intents + batchReads are the same count for 1 and 150 due alerts (person, team, table-team), ≤ 1 + 8 + R + T, activity read (9) included; a per-person route or resolver fails (a)', async () => {
    const one = await tickScenario(cleanups, 1);
    const many = await tickScenario(cleanups, 150);
    expect(one.steps).toBe(1);
    expect(many.steps).toBe(150);
    expectTickBound(one, many);
    // pinned: pre-check 1 + select 1 + flags 1 + fixed 5 (incl. activity) + previous step 1 + R 2 + T 1
    expect(one.statements).toBe(TICK_TODAY);
    expect(many.statements).toBe(TICK_TODAY);
    // every statement of the tick is a read, and the fixed set (with the activity read (9)) runs once
    expect(many.reads).toBe(many.statements);
    expect(many.fixed).toEqual({ sessions: 1, bindings: 1, devices: 1, presence: 1, activity: 1 });
    expect(one.fixed).toEqual(many.fixed);

    // a route that runs one statement per person: the bound helper fails
    unregisterRoute('pager');
    registerRoute({
      route: 'pager_per_person',
      format: 'short_code',
      ack: false,
      receipts: [],
      routesFor: (tx, staffIds) => {
        const out = new Map<string, Array<{ route_ref: string }>>();
        for (const staffId of staffIds) {
          const row = tx.db.prepare('SELECT ? AS staff_id').get(staffId) as { staff_id: string };
          out.set(row.staff_id, [{ route_ref: `PP-${row.staff_id}` }]);
        }
        return out;
      },
      send: () => undefined,
    });
    const routeOne = await tickScenario(cleanups, 1);
    const routeMany = await tickScenario(cleanups, 150);
    expect(routeMany.statements).toBeGreaterThan(TICK_BOUND);
    expect(() => expectTickBound(routeOne, routeMany)).toThrow(/grow with the number of due alerts/);
  });

  it('[01d #35] (a) a per-table resolver: one statement per table fails the tick bound', async () => {
    unregisterTargetResolver('table_team');
    registerTargetResolver('table_team', (tx: WriterTx, targets) => {
      fakeTableOwner.calls.push(targets); // keeps the scenario's one-call-per-kind check on the call, not the statements
      const out = new Map<string, { staff_ids: string[]; device_ids: string[] }>();
      for (const target of targets) {
        const row = tx.db.prepare('SELECT ? AS table_id').get(target.table_id) as { table_id: string };
        out.set(targetKey({ kind: 'table_team', table_id: row.table_id }), { staff_ids: [pid(0)], device_ids: [] });
      }
      return out;
    });
    const one = await tickScenario(cleanups, 1);
    const many = await tickScenario(cleanups, 150);
    expect(many.statements).toBeGreaterThan(TICK_BOUND);
    expect(() => expectTickBound(one, many)).toThrow(/grow with the number of due alerts/);
  });

  it('[01d #35] (b) projection reads: ≤ 2 per step / close event (≤ 2 × 150 for 150 due), the same with 10 or 1 000 other open alerts not due', async () => {
    const ten = await tickScenario(cleanups, 150, 10);
    const thousand = await tickScenario(cleanups, 150, 1000);
    for (const m of [ten, thousand]) {
      expect(m.steps).toBe(150);
      const steps = m.projection.filter((e) => e.event_type === 'AttemptSent' || e.event_type === 'EscalationStepped');
      expect(steps).toHaveLength(150);
      for (const e of [...steps, ...m.closes]) expect(e.reads, e.event_type).toBeLessThanOrEqual(2);
      const total = steps.reduce((sum, e) => sum + e.reads, 0);
      expect(total).toBeLessThanOrEqual(2 * 150);
      expect(m.closes).toHaveLength(150);
      expect(m.closes.reduce((sum, e) => sum + e.reads, 0)).toBeLessThanOrEqual(2 * 150);
    }
    // no scan of open alerts: the counts do not move with the number of other open alerts
    expect(thousand.projection).toEqual(ten.projection);
    expect(thousand.closes).toEqual(ten.closes);
    // nor do the tick's own reads
    expect(thousand.statements).toBe(ten.statements);
  });

  it('[01d #35] (c) raise is independent of team size: a team of 2 and of 50 issue the same count, ≤ 6 + R + T; a table-team raise via the fake tableOwner ≤ 6 + R + T', async () => {
    const h = await harness(cleanups);
    for (let i = 0; i < PEOPLE; i += 1) fakePager.refs.set(pid(i), [`P-${pid(i)}`]);
    fakeTableOwner.owners.set(tid(0), pid(0));
    const cold = (input: RaiseInput): { statements: number; recipients: number; fixed: Record<string, number> } =>
      h.writer.run((tx) => {
        h.counter.reset();
        const at = h.log.length;
        const r = alerts.raise(alerts.tickCtx(tx, h.clock.branchNow()), input);
        const statements = h.counter.count;
        const fixed = fixedCounts(h.log.slice(at));
        tx.append(r.events);
        const sent = r.events.find((e) => e.event_type === 'AttemptSent')?.payload as { recipients: unknown[] };
        return { statements, recipients: sent.recipients.length, fixed };
      }).result;
    const info = (lead: string, n: number): RaiseInput => ({
      kind: 't_info',
      subject: { stream_type: 'hub', stream_id: BRANCH },
      target: { kind: 'team', lead_staff_id: lead, depth: 'direct' },
      display,
      dedupe_key: `team:${n}`,
    });
    const small = cold(info(L_SMALL, 1));
    const big = cold(info(L_BIG, 2));
    expect(small.recipients).toBe(2);
    expect(big.recipients).toBe(50);
    expect(big.statements).toBe(small.statements);
    // dedupe 1 + fixed 5 (activity included) + R 0 + T 1
    expect(small.statements).toBe(1 + 5 + 0 + ROUTES);
    expect(small.statements).toBeLessThanOrEqual(6 + 0 + ROUTES);
    expect(small.fixed).toEqual({ sessions: 1, bindings: 1, devices: 1, presence: 1, activity: 1 });
    // table team (lead_fallback kind): + table_team + zone_order_taker
    fakeTableOwner.calls.length = 0;
    const table = cold(tableInput(0));
    expect(fakeTableOwner.calls).toHaveLength(1);
    expect(table.statements).toBe(1 + 5 + R + ROUTES);
    expect(table.statements).toBeLessThanOrEqual(6 + R + ROUTES);
  });

  it('[01d #35] (d) many in one transaction: raiseMany of 20 = one raise; closeMany of 10 requests = one close; 20 single raises read the fixed set once', async () => {
    const h = await harness(cleanups);
    for (let i = 0; i < PEOPLE; i += 1) {
      fakeTableOwner.owners.set(tid(i), pid(i));
      fakePager.refs.set(pid(i), [`P-${pid(i)}`]);
    }
    fakePager.refs.set(REQ, ['P-REQ']);
    const measure = (fn: (tx: WriterTx) => { events: Parameters<WriterTx['append']>[0] }): number =>
      h.writer.run((tx) => {
        h.counter.reset();
        const { events } = fn(tx);
        const count = h.counter.count;
        tx.append(events);
        return count;
      }).result;
    const ctx = (tx: WriterTx) => alerts.tickCtx(tx, h.clock.branchNow());

    const one = measure((tx) => ({ events: alerts.raise(ctx(tx), tableInput(0)).events }));
    const twenty = measure((tx) => ({ events: alerts.raiseMany(ctx(tx), Array.from({ length: 20 }, (_, i) => tableInput(i + 1))).flatMap((r) => r.events) }));
    expect(one).toBe(1 + 5 + R + ROUTES);
    expect(twenty).toBe(one);

    const requests = raiseAll(h, Array.from({ length: 11 }, (_, i) => voidInput(i)));
    const closeOne = measure((tx) => ({ events: alerts.closeMany(ctx(tx), [{ alert_id: requests[0] as string, reason: 'obsolete' }]) }));
    const closeTen = measure((tx) => ({
      events: alerts.closeMany(
        ctx(tx),
        requests.slice(1).map((alert_id) => ({ alert_id, reason: 'obsolete' as const })),
      ),
    }));
    // alert read 1 + request_result raiseMany: dedupe 1 + fixed 5 + R 0 (person) + T 1
    expect(closeOne).toBe(1 + 1 + 5 + 0 + ROUTES);
    expect(closeTen).toBe(closeOne);

    const loop = h.writer.run((tx) => {
      const at = h.log.length;
      const events = Array.from({ length: 20 }, (_, i) => alerts.raise(ctx(tx), tableInput(i + 100)).events).flat();
      const fixed = fixedCounts(h.log.slice(at));
      tx.append(events);
      return { fixed };
    }).result;
    expect(loop.fixed).toEqual({ sessions: 1, bindings: 1, devices: 1, presence: 1, activity: 1 });
  });
});
