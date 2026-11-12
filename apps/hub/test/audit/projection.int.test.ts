import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditEventTypes, registerAuditAction, resetAuditActions } from '@pos/domain';
import { parseEvent, type PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { auditProjection } from '../../src/audit/projection';
import { boot, registerHubProjections } from '../../src/lib/boot';
import { createProjectionRegistry, type Projection } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import type { TestHub } from '../helpers/test-hub';
import { append, answer, dealX2, FX, openSeating, post, raiseVoid, removeLine, signIn, STAFF, stagedOrder, startVoids, VX } from '../voids/fixtures';
import { auditDirectory, withTestApply } from './fixtures';

// 04 §5, §3.6, §6.6: projection `audit` (a2) over the real 0018 tables, fed real events through the hub's writer.
// Tests 48, 54, 55, 55b, 55c. The kind's own `apply` is v7's; these tests swap in a minimal one (as the spike does) so
// an approve writes §6.7's events: ItemMovedToStock + its stock effects for a `moved` line, then the ItemVoided.

let hub: TestHub | undefined;
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  resetAuditActions();
  swapBranchConfig(null);
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await hub?.close();
  hub = undefined;
});

const branch = () => hub!.deps.config.provisioned?.branch_id ?? 'branch-unset';

/**
 * A service day (startVoids: day opened with stock counts), on a dine-in order at T4: void requests approved (wastage,
 * served line), rejected, withdrawn, approved as `moved` (the cooking karahi: ItemMovedToStock + StockAdded moved);
 * a comp request approved through 02b's kind (LineComped). Then an optional table move T4 → T5, a takeaway deal with a
 * removed part, a station paused and the day closed.
 */
async function serviceDay(o: { move?: boolean } = {}): Promise<{ order_id: string; served: string; cooking: string; done: string; approved: string; rejected: string; withdrawn: string; moved: string; comp: string; takeaway: string }> {
  hub = await startVoids({ directory: await auditDirectory() });
  const cashier = signIn(hub, STAFF.cashier);
  const manager = signIn(hub, STAFF.manager);
  openSeating(hub, { table_id: VX.tables.T4, seating_id: 'SEAT_A' });
  const s = stagedOrder(hub, { seating_id: 'SEAT_A' });
  const approved = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.served, disposition: 'wastage', reason_code: 'quality', note: 'cold' });
  const rejected = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.done, disposition: 'staff_meal' });
  const moved = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.cooking, disposition: 'moved' });
  expect(moved.values.line_dispositions).toEqual({ [s.cooking]: 'moved' });
  await withTestApply(async () => {
    expect((await answer(hub!, manager, approved.alert_id, 'approve')).status).toBe(200);
    expect((await answer(hub!, manager, rejected.alert_id, 'reject')).status).toBe(200);
    const m = await answer(hub!, manager, moved.alert_id, 'approve');
    expect(m.status, JSON.stringify(m.error)).toBe(200);
    expect(m.events.map((e) => e.event_type)).toEqual(expect.arrayContaining(['ItemMovedToStock', 'StockAdded', 'ItemVoided']));
  });
  const withdrawn = raiseVoid(hub, { requester: cashier, order_id: s.order_id, order_item_id: s.done, disposition: 'wastage' });
  expect((await answer(hub, cashier, withdrawn.alert_id, 'withdraw')).status).toBe(200);
  // 02b's comp request on the done naan, approved by the Manager: the real comp kind writes LineComped
  const asked = await post(hub, cashier, 'comp-line', 'CompLine', { order_item_id: s.done, units: 1, reason_code: 'guest', note: 'regular' });
  expect(asked.status, JSON.stringify(asked.error)).toBe(200);
  const comp = asked.result!.alert_id as string;
  const compAnswer = await answer(hub, manager, comp, 'approve');
  expect(compAnswer.status, JSON.stringify(compAnswer.error)).toBe(200);
  expect(compAnswer.events.map((e) => e.event_type)).toContain('LineComped');
  if (o.move === true) {
    append(hub, [{ stream_type: 'table', stream_id: VX.tables.T4, event_type: 'TableMoved', payload: { seating_id: 'SEAT_A', from_table_id: VX.tables.T4, to_table_id: VX.tables.T5, by_staff_id: STAFF.manager } }], { actor: STAFF.manager });
  }
  const d = dealX2(hub);
  removeLine(hub, d.order_id, d.naanPart, 1);
  append(hub, [{ stream_type: 'station', stream_id: FX.station, event_type: 'StationPauseSet', payload: { station_id: FX.station, paused: true } }], { actor: STAFF.manager });
  append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
  return { order_id: s.order_id, served: s.served, cooking: s.cooking, done: s.done, approved: approved.alert_id, rejected: rejected.alert_id, withdrawn: withdrawn.alert_id, moved: moved.alert_id, comp, takeaway: d.order_id };
}

const TABLES = ['audit_entries', 'audit_requests', 'audit_orders', 'orders', 'order_lines'] as const;
function dump(db: Database.Database): Record<(typeof TABLES)[number], unknown[]> {
  const out = {} as Record<(typeof TABLES)[number], unknown[]>;
  for (const t of TABLES) out[t] = db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all();
  return out;
}

/** Rebuild from seq 0: delete the checkpoints of `names`, register the hub's projections on a fresh registry, catch up. */
function rebuild(db: Database.Database, names: string[], register: (r: ReturnType<typeof createProjectionRegistry>) => void = registerHubProjections): Record<string, number> {
  db.prepare(`DELETE FROM projection_checkpoints WHERE projection IN (SELECT value FROM json_each(?))`).run(JSON.stringify(names));
  const registry = createProjectionRegistry();
  register(registry);
  return registry.catchUp(db, branch()).replayed;
}

const rows = (db: Database.Database, action: string) =>
  db.prepare('SELECT * FROM audit_entries WHERE action = ? ORDER BY seq').all(action) as Array<Record<string, unknown> & { detail_json: string }>;

/** §3.6's "From event" column, written out (not derived from the map), plus §6.6's lookup source OrderPlaced. */
const MAPPED_EVENT_TYPES = [
  'AlertRaised', 'RequestAnswered', 'RequestWithdrawn', 'RequestPinFailed', 'ItemVoided', 'ItemMovedToStock', 'ItemRemoved',
  'LineComped', 'ItemReturned', 'OrderLinesAdded', 'LineWeightSet', 'OrderBoosted', 'OrderCancelled', 'BusinessDayOpened',
  'BusinessDayClosed', 'TableLockReleased', 'TableHolderChanged', 'StaffPinLockedOut', 'DevicePinLockedOut', 'PinLockoutCleared',
  'DevicePaired', 'DeviceRevoked', 'DevicePairingTokenGenerated', 'StationPauseSet', 'StationCapacitySet', 'ItemMadeAvailable',
  'ItemMadeUnavailable', 'AlertClosed', 'StockSet', 'StockAdded', 'ZoneStockSet', 'ZoneStockAdded', 'StockTransferredOut',
];

describe('[04 §6.6] projection audit: registration', () => {
  it('[04 §6.6] eventTypes = exactly the §3.6 mapped event types + OrderPlaced (each once); with reset', () => {
    resetAuditActions();
    const p = auditProjection();
    expect(p.name).toBe('audit');
    expect(new Set(p.eventTypes)).toEqual(new Set([...MAPPED_EVENT_TYPES, 'OrderPlaced']));
    expect(new Set(p.eventTypes)).toEqual(new Set([...auditEventTypes(), 'OrderPlaced']));
    expect(p.eventTypes).toHaveLength(MAPPED_EVENT_TYPES.length + 1);
    expect(p.reset).toBeTypeOf('function');
  });

  it('[04 #53, §6.6] an action registered before auditProjection() is folded; one registered after it throws (sealed)', () => {
    resetAuditActions();
    registerAuditAction('HubStarted', (e) => ({ action: 'hub_started', subject_type: 'hub', subject_id: e.stream_id }));
    const p = auditProjection();
    expect(new Set(p.eventTypes)).toEqual(new Set([...MAPPED_EVENT_TYPES, 'OrderPlaced', 'HubStarted']));
    expect(() => registerAuditAction('TicketReprinted', () => null)).toThrow(/startup only/);
    expect(auditProjection().eventTypes).not.toContain('TicketReprinted');
  });
});

describe('[04 #48] audit rows of a service day; rebuild from seq 0 = live', () => {
  it('[04 #48, §3.6] live rows: requester as actor and answerer as approver on the approve, method, outcomes, placed-at table', async () => {
    const day = await serviceDay();
    const db = hub!.deps.db;
    expect(rows(db, 'void_requested').map((r) => [r.actor_staff_id, r.approver_staff_id, r.outcome, r.table_id])).toEqual([
      [STAFF.cashier, null, 'wastage', VX.tables.T4],
      [STAFF.cashier, null, 'staff_meal', VX.tables.T4],
      [STAFF.cashier, null, 'moved', VX.tables.T4],
      [STAFF.cashier, null, 'wastage', VX.tables.T4],
    ]);
    expect(rows(db, 'void_answered').map((r) => [r.actor_staff_id, r.approver_staff_id, r.method, r.outcome])).toEqual([
      [STAFF.cashier, STAFF.manager, 'pin', 'approved'],
      [STAFF.cashier, STAFF.manager, 'pin', 'rejected'],
      [STAFF.cashier, STAFF.manager, 'pin', 'approved'],
    ]);
    const voided = rows(db, 'item_voided');
    expect(voided.map((r) => [r.actor_staff_id, r.approver_staff_id, r.outcome])).toEqual([
      [STAFF.cashier, STAFF.manager, 'wastage'],
      [STAFF.cashier, STAFF.manager, 'moved'],
    ]);
    expect(voided[0]).toMatchObject({ order_id: day.order_id, table_id: VX.tables.T4, reason: 'quality: cold' });
    expect(JSON.parse(voided[0]!.detail_json)).toMatchObject({ order_item_id: day.served, alert_id: day.approved, envelope_actor_id: STAFF.manager });
    // §3.6 (H4-2): the approved move — actor = requester and approver = answerer from audit_requests; envelope = the Manager
    const [moved] = rows(db, 'item_moved_to_stock');
    expect(moved).toMatchObject({ actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, order_id: day.order_id, table_id: VX.tables.T4 });
    expect(JSON.parse(moved!.detail_json)).toMatchObject({ order_item_id: day.cooking, alert_id: day.moved, envelope_actor_id: STAFF.manager });
    expect(rows(db, 'stock_added')).toEqual([]); // the moved StockAdded is covered by item_moved_to_stock
    // 02b's comp: requested by the Cashier, approved by the Manager through LineComped
    expect(rows(db, 'comp_requested')).toMatchObject([{ actor_staff_id: STAFF.cashier, approver_staff_id: null, reason: 'guest: regular' }]);
    expect(rows(db, 'comp_answered')).toMatchObject([{ actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, method: 'pin', outcome: 'approved' }]);
    const [comped] = rows(db, 'line_comped');
    expect(comped).toMatchObject({ actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager, order_id: day.order_id, reason: 'guest: regular', table_id: VX.tables.T4 });
    expect(comped!.amount_minor).toBeGreaterThan(0);
    expect(JSON.parse(comped!.detail_json)).toMatchObject({ order_item_id: day.done, alert_id: day.comp, envelope_actor_id: STAFF.manager });
    expect(rows(db, 'request_withdrawn').map((r) => r.actor_staff_id)).toEqual([STAFF.cashier]);
    expect(rows(db, 'item_removed')).toMatchObject([{ order_id: day.takeaway, table_id: null }]);
    expect(rows(db, 'station_paused')).toMatchObject([{ actor_staff_id: STAFF.manager, subject_id: FX.station, outcome: 'paused' }]);
    expect(rows(db, 'day_opened')).toHaveLength(1);
    expect(rows(db, 'day_closed')).toMatchObject([{ actor_staff_id: STAFF.manager, subject_type: 'day' }]);
    expect(rows(db, 'stock_set').length).toBeGreaterThan(0);
    // audit_requests: every request with its answerer; audit_orders: both orders with their placed-at table
    const byId = (a: { alert_id: string }, b: { alert_id: string }) => a.alert_id.localeCompare(b.alert_id);
    expect(db.prepare('SELECT alert_id, kind, requester_staff_id, order_id, answerer_staff_id FROM audit_requests WHERE kind IN (?, ?) ORDER BY alert_id').all('void_approval', 'comp')).toEqual(
      [
        { alert_id: day.approved, kind: 'void_approval', requester_staff_id: STAFF.cashier, order_id: day.order_id, answerer_staff_id: STAFF.manager },
        { alert_id: day.rejected, kind: 'void_approval', requester_staff_id: STAFF.cashier, order_id: day.order_id, answerer_staff_id: STAFF.manager },
        { alert_id: day.moved, kind: 'void_approval', requester_staff_id: STAFF.cashier, order_id: day.order_id, answerer_staff_id: STAFF.manager },
        { alert_id: day.withdrawn, kind: 'void_approval', requester_staff_id: STAFF.cashier, order_id: day.order_id, answerer_staff_id: null },
        { alert_id: day.comp, kind: 'comp', requester_staff_id: STAFF.cashier, order_id: day.order_id, answerer_staff_id: STAFF.manager },
      ].sort(byId),
    );
    expect(db.prepare('SELECT order_id, table_id FROM audit_orders ORDER BY order_id').all()).toEqual(
      [{ order_id: day.order_id, table_id: VX.tables.T4 }, { order_id: day.takeaway, table_id: null }].sort((a, b) => a.order_id.localeCompare(b.order_id)),
    );
    // every row's seq / event_id / recorded_at / device_id is its event's
    const events = new Map((db.prepare('SELECT seq, event_id, recorded_at, device_id FROM events').all() as Array<{ seq: number }>).map((e) => [e.seq, e]));
    for (const r of db.prepare('SELECT seq, event_id, recorded_at, device_id FROM audit_entries').all() as Array<{ seq: number }>) expect(r).toEqual(events.get(r.seq));
  });

  it('[04 #48] orders + audit rebuilt from seq 0 = live, row for row, in either registration order and audit alone', async () => {
    await serviceDay();
    const db = hub!.deps.db;
    const live = dump(db);
    expect(live.audit_entries.length).toBeGreaterThan(10);
    expect(rebuild(db, ['orders', 'audit']).audit).toBeGreaterThan(0);
    expect(dump(db)).toEqual(live);
    const alone = (r: ReturnType<typeof createProjectionRegistry>) => r.register(auditProjection());
    rebuild(db, ['audit'], alone);
    expect(dump(db)).toEqual(live);
    // registered first, before every other projection: the same rows (§5: events only, order does not matter)
    rebuild(db, ['orders', 'audit'], (r) => {
      r.register(auditProjection());
      const rest: Projection[] = [];
      registerHubProjections({ register: (p: Projection) => (p.name === 'audit' ? undefined : rest.push(p)), afterCatchUp: (fn: (tx: Database.Database) => void) => r.afterCatchUp(fn) } as never);
      for (const p of rest) r.register(p);
    });
    expect(dump(db)).toEqual(live);
  });
});

describe('[04 #54] the audit fold reads no table but its own', () => {
  it('[04 #54] every statement the fold prepares names only audit_entries / audit_requests / audit_orders (reset included)', async () => {
    await serviceDay({ move: true });
    const db = hub!.deps.db;
    const seen: string[] = [];
    const spy = { prepare: (sql: string) => (seen.push(sql), db.prepare(sql)) } as unknown as Database.Database;
    const p = auditProjection();
    const log = (db.prepare('SELECT * FROM events ORDER BY seq').all() as Array<Record<string, unknown> & { payload: string }>).map((row) =>
      parseEvent({ ...row, payload: JSON.parse(row.payload) as PosEvent['payload'] }),
    );
    const live = dump(db);
    db.transaction(() => {
      p.reset!(spy);
      for (const e of log) if (p.eventTypes.includes(e.event_type)) p.apply(spy, e, 'catchup');
    })();
    expect(dump(db)).toEqual(live);
    expect(seen.length).toBeGreaterThan(log.length / 2);
    const tableRefs = (sql: string) => [...sql.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    const own = new Set(['audit_entries', 'audit_requests', 'audit_orders']);
    for (const sql of seen) {
      const refs = tableRefs(sql);
      expect(refs.length, sql).toBeGreaterThan(0);
      for (const t of refs) expect(own.has(t), `${t} in ${sql}`).toBe(true);
    }
  });
});

describe('[04 #55] rebuild = live after alert retention and a table move', () => {
  it('[04 #55, H1-8] alerts rows deleted and the seating moved T4 → T5: rebuild from seq 0 equals live; order rows keep the placed-at table', async () => {
    const day = await serviceDay({ move: true });
    const db = hub!.deps.db;
    const live = dump(db);
    // after the move, rows of the dine-in order still carry T4 (OrderPlaced.table_id), not the seating's current table
    expect(rows(db, 'item_voided')[0]).toMatchObject({ table_id: VX.tables.T4 });
    // alert retention (01d) deletes the alert rows; the audit fold never read them
    db.pragma('foreign_keys = OFF');
    for (const t of ['alert_receipts', 'alert_seen', 'alert_attempts', 'alerts']) {
      const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
      if (exists !== undefined) db.prepare(`DELETE FROM ${t}`).run();
    }
    db.pragma('foreign_keys = ON');
    expect(db.prepare('SELECT COUNT(*) FROM alerts').pluck().get()).toBe(0);
    rebuild(db, ['audit']);
    expect(dump(db)).toEqual(live);
    expect(rows(db, 'void_answered').map((r) => r.actor_staff_id)).toEqual([STAFF.cashier, STAFF.cashier, STAFF.cashier]);
    expect(rows(db, 'item_moved_to_stock')).toMatchObject([{ actor_staff_id: STAFF.cashier, approver_staff_id: STAFF.manager }]);
    expect(db.prepare('SELECT COUNT(*) FROM audit_requests WHERE alert_id IN (?, ?, ?, ?, ?)').pluck().get(day.approved, day.rejected, day.withdrawn, day.moved, day.comp)).toBe(5);
  });
});

// ------------------------------------------------------------------------------------------- boot (55b, 55c)

const WALL = 1_761_000_000_000;
/** Earlier than every recorded_at: boot step 3a appends a ClockAlarm before catch-up (00 #100's forced alarm). */
const DECOY_AT = 1;

function bootDir(): { configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pos-audit-boot-'));
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
  return { configPath };
}

async function bootOnce(configPath: string, wall: number, body: (deps: Awaited<ReturnType<typeof boot>>['deps']) => void = () => undefined): Promise<void> {
  const booted = await boot({ configPath, wallNow: () => wall, monoNow: () => 0, configClient: stubConfigCloud(), cloudClient: offlineCloud() });
  try {
    body(booted.deps);
  } finally {
    await booted.stop();
  }
}

/** Two mapped events through the writer that need no branch config: a PIN lockout cleared, an item made available. */
function appendMapped(deps: Awaited<ReturnType<typeof boot>>['deps']): void {
  deps.writer.run((tx) =>
    tx.append([
      { stream_type: 'staff', stream_id: 'S_WAIT', event_type: 'PinLockoutCleared', schema_version: 1, payload: { subject_type: 'staff', subject_id: 'S_WAIT' }, occurred_at: deps.clock.branchNow(), actor_id: 'S_MGR', device_id: 'D1' },
      { stream_type: 'stock', stream_id: 'I1', event_type: 'ItemMadeAvailable', schema_version: 1, payload: { item_id: 'I1' }, occurred_at: deps.clock.branchNow(), actor_id: 'S_MGR', device_id: 'D1' },
    ]),
  );
}

interface AfterBoot {
  alarms: number;
  checkpoint: number | undefined;
  maxSeq: number;
  actions: Array<{ seq: number; action: string }>;
  mappedSeqs: number[];
}

function inspect(deps: Awaited<ReturnType<typeof boot>>['deps'], mapped: string[]): AfterBoot {
  const db = deps.db;
  return {
    alarms: db.prepare(`SELECT COUNT(*) FROM events WHERE event_type = 'ClockAlarm'`).pluck().get() as number,
    checkpoint: db.prepare(`SELECT last_seq FROM projection_checkpoints WHERE branch_id = 'branch-1' AND projection = 'audit'`).pluck().get() as number | undefined,
    maxSeq: db.prepare('SELECT MAX(seq) FROM events').pluck().get() as number,
    actions: db.prepare('SELECT seq, action FROM audit_entries ORDER BY seq').all() as Array<{ seq: number; action: string }>,
    mappedSeqs: db.prepare(`SELECT seq FROM events WHERE event_type IN (SELECT value FROM json_each(?)) ORDER BY seq`).pluck().all(JSON.stringify(mapped)) as number[],
  };
}

describe('[04 #55c] first boot after the 04 migration, forced clock alarm', () => {
  it('[04 #55c, H8-1] no audit checkpoint and empty audit tables (a pre-04 hub) + a boot-time ClockAlarm → audit holds rows from seq 0; checkpoint = MAX(seq)', async () => {
    const { configPath } = bootDir();
    await bootOnce(configPath, WALL, (deps) => {
      appendMapped(deps);
      // the state a pre-04 hub has right after 0018 runs: tables empty, no `audit` checkpoint row
      deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'audit'`).run();
      for (const t of ['audit_entries', 'audit_requests', 'audit_orders']) deps.db.prepare(`DELETE FROM ${t}`).run();
    });
    let after: AfterBoot | undefined;
    await bootOnce(configPath, DECOY_AT, (deps) => {
      after = inspect(deps, ['PinLockoutCleared', 'ItemMadeAvailable']);
    });
    expect(after!.alarms).toBe(1); // step 3a appended the alarm (live, before catch-up)
    expect(after!.mappedSeqs).toHaveLength(2);
    expect(after!.actions).toEqual([
      { seq: after!.mappedSeqs[0], action: 'pin_lockout_cleared' },
      { seq: after!.mappedSeqs[1], action: 'item_availability_set' },
    ]);
    expect(after!.checkpoint).toBe(after!.maxSeq);
  });
});

describe('[04 #55b] a new mapping of an old event type + the checkpoint-delete migration', () => {
  const mapHubStarted = () =>
    registerAuditAction('HubStarted', (e) => ({ action: 'hub_started', subject_type: 'hub', subject_id: e.stream_id }));

  it.each([
    ['without', WALL + 60_000],
    ['with a forced boot-time ClockAlarm', DECOY_AT],
  ] as const)('[04 #55b, H2-12, H8-1] %s: the old HubStarted of boot 1 appears after the next boot; earlier rows exactly once', async (_label, wall) => {
    const { configPath } = bootDir();
    await bootOnce(configPath, WALL, appendMapped); // boot 1: HubStarted not mapped yet
    resetAuditActions(); // a new process: boot 1's projection sealed this one's registry
    mapHubStarted(); // the later module's registerAuditAction (startup, before boot 2 builds the projection)
    await bootOnce(configPath, WALL + 30_000, (deps) => {
      // the shipped hub migration: DELETE FROM projection_checkpoints WHERE projection = 'audit'
      deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'audit'`).run();
    });
    let after: AfterBoot | undefined;
    await bootOnce(configPath, wall, (deps) => {
      after = inspect(deps, ['HubStarted', 'PinLockoutCleared', 'ItemMadeAvailable']);
    });
    const hubStarted = after!.actions.filter((a) => a.action === 'hub_started').map((a) => a.seq);
    const mapped = after!.actions.filter((a) => ['hub_started', 'pin_lockout_cleared', 'item_availability_set'].includes(a.action)).map((a) => a.seq);
    expect(hubStarted.length).toBeGreaterThanOrEqual(2); // boot 1's HubStarted (seq before the mapping) is in
    expect(hubStarted[0]).toBeLessThan(after!.mappedSeqs.find((s) => !hubStarted.includes(s))!);
    expect(mapped).toEqual(after!.mappedSeqs); // every mapped event exactly once, from seq 0
    expect(after!.checkpoint).toBe(after!.maxSeq);
    if (wall === DECOY_AT) expect(after!.alarms).toBe(1);
  });

  it('[04 #55b] control: the mapping without the checkpoint delete → boot 1\'s HubStarted stays missing (why the migration ships)', async () => {
    const { configPath } = bootDir();
    let firstHubStarted: number | undefined;
    await bootOnce(configPath, WALL, (deps) => {
      firstHubStarted = deps.db.prepare(`SELECT MIN(seq) FROM events WHERE event_type = 'HubStarted'`).pluck().get() as number;
    });
    resetAuditActions(); // a new process
    mapHubStarted();
    let after: AfterBoot | undefined;
    await bootOnce(configPath, WALL + 30_000, (deps) => {
      after = inspect(deps, ['HubStarted']);
    });
    expect(after!.actions.map((a) => a.seq)).not.toContain(firstHubStarted);
  });
});
