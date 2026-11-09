import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BranchConfig, DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { anAlertRaised, aBranchConfig } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { alertsTick } from '../../src/alerts/tick';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { openDb } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { boot } from '../../src/lib/boot';
import { fixedClock, T } from '../../src/lib/clock';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createLogCapture } from '../helpers/log-capture';
import { statementCounter } from '../helpers/statement-counter';
import { offlineCloud } from '../helpers/stub-cloud';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §3.8, §3.9, §6.7, §6.15, §11 step 12: RequestTableHandover, kind table_handover (accept / decline
// through 01d's AnswerRequest), closeHandover. Seatings are seeded with real TableOpened / TableLocked / BillClosed
// events through the hub writer (OpenTable is another lane's task); live orders as rows of the 0012 seating_orders.

const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const ALI = 'S_ALI'; // holder; take-order branch; lead MGR
const SARA = 'S_SARA'; // receiver; take-order branch
const NOOR = 'S_NOOR'; // take-order branch, never signed in
const ZAIN = 'S_ZAIN'; // take-order my_floors F1
const BILAL = 'S_BILAL'; // take-order branch, no force
const FAHAD = 'S_FAHAD'; // take-order + force-release-table-lock my_floors F2
const ASIF = 'S_ASIF'; // take-order + force-release-table-lock requires_approval
const KAMI = 'S_KAMI'; // take-order requires_approval only
const MGR = 'S_MGR'; // aDirectory manager: every permission allowed at branch scope (force-release-table-lock)
const CASH = 'S_CASH'; // aDirectory cashier: no take-order

type GrantType = 'allowed' | 'requires_approval';
function grant(permission: string, grant_type: GrantType, scope: 'branch' | 'my_floors' = 'branch') {
  return {
    permission,
    grant_type,
    approver_role_id: grant_type === 'requires_approval' ? 'R_MGR' : null,
    approver_role_ids: grant_type === 'requires_approval' ? ['R_MGR'] : [],
    scope,
  };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  const person = (staff_id: string, display_name: string, role_id: string, o: { floors?: string[]; lead?: string } = {}) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: o.lead ?? null,
    floor_ids: o.floors ?? [],
  });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order', 'allowed')]),
      role('R_FLOOR', [grant('take-order', 'allowed', 'my_floors')]),
      role('R_FORCE_F2', [grant('take-order', 'allowed'), grant('force-release-table-lock', 'allowed', 'my_floors')]),
      role('R_FORCE_APPROVAL', [grant('take-order', 'allowed'), grant('force-release-table-lock', 'requires_approval')]),
      role('R_TAKER_APPROVAL', [grant('take-order', 'requires_approval')]),
    ],
    staff: [
      ...base.staff,
      person(ALI, 'Ali', 'R_TAKER', { lead: MGR }),
      person(SARA, 'Sara', 'R_TAKER'),
      person(NOOR, 'Noor', 'R_TAKER'),
      person(ZAIN, 'Zain', 'R_FLOOR', { floors: ['F1'] }),
      person(BILAL, 'Bilal', 'R_TAKER'),
      person(FAHAD, 'Fahad', 'R_FORCE_F2', { floors: ['F2'] }),
      person(ASIF, 'Asif', 'R_FORCE_APPROVAL'),
      person(KAMI, 'Kami', 'R_TAKER_APPROVAL'),
    ],
  };
}

function config(): BranchConfig {
  const table = (table_id: string, name: string, sort_order: number) => ({ table_id, name, seats: 4, sort_order, zone_id: null });
  return aBranchConfig({
    floors: [
      { floor_id: 'F1', name: 'Ground', sort_order: 0, zones: [], tables: [table('T1', 'Table 1', 0), table('T2', 'Table 2', 1), table('T3', 'Table 3', 2)] },
      { floor_id: 'F2', name: 'Roof', sort_order: 1, zones: [], tables: [table('T9', 'Roof 9', 0)] },
    ],
  } as unknown as Partial<BranchConfig>);
}

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let handleStatements = -1;
let raiseStatements = 0;
let restoreHandle: () => void = () => undefined;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  swapBranchConfig({ config: config(), snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  counter = statementCounter(hub.deps.db);
  // statements of RequestTableHandover's handle, and of the alerts.raise call inside it
  const def = commandRegistry(hub.app).byPath('request-table-handover') as CommandDef | undefined;
  if (def !== undefined) {
    const original = def.handle;
    def.handle = (ctx, payload, cmd) => {
      const before = counter.count;
      raiseStatements = 0;
      try {
        return original.call(def, ctx, payload, cmd);
      } finally {
        handleStatements = counter.count - before;
      }
    };
    restoreHandle = () => {
      def.handle = original;
    };
  }
  const raise = alerts.raise.bind(alerts);
  vi.spyOn(alerts, 'raise').mockImplementation((ctx, input) => {
    const before = counter.count;
    try {
      return raise(ctx, input);
    } finally {
      raiseStatements += counter.count - before;
    }
  });
  handleStatements = -1;
});

afterEach(async () => {
  vi.restoreAllMocks();
  restoreHandle();
  swapBranchConfig(null);
  await hub.close();
});

// ---------------------------------------------------------------------------------------------- seeding

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionId: string;
  sessionToken: string;
}

function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

function ev(stream_id: string, event_type: string, payload: Record<string, unknown>, by: { actor: string; device: string }): EventDraft {
  return {
    stream_type: 'table',
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: hub.clock.branchNow(),
    actor_id: by.actor,
    device_id: by.device,
  } as EventDraft;
}

function append(...drafts: EventDraft[]): void {
  hub.deps.writer.run((tx) => tx.append(drafts));
}

/** A seating opened and locked by `holder` on `device` (TableOpened + TableLocked), optionally joined tables. */
function open(table_id: string, seating_id: string, holder: Who, o: { joined?: string[]; locked?: boolean } = {}): void {
  const by = { actor: holder.staffId, device: holder.deviceId };
  append(ev(table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder.staffId, party_size: 2 }, by));
  if (o.locked !== false) append(ev(table_id, 'TableLocked', { table_id, seating_id, staff_id: holder.staffId }, by));
  for (const joined of o.joined ?? []) {
    // a joined FREE table (§3.11), as the TablesMerged fold writes it
    append(
      ev(
        table_id,
        'TablesMerged',
        { into_seating_id: seating_id, into_table_id: table_id, table_ids: [joined], absorbed_seating_id: null, order_ids: [], by_staff_id: holder.staffId },
        by,
      ),
    );
  }
}

function liveOrders(seating_id: string, n: number, cancelled = 0): void {
  for (let i = 0; i < n + cancelled; i += 1) {
    hub.deps.db
      .prepare('INSERT INTO seating_orders (order_id, seating_id, cancelled) VALUES (?, ?, ?)')
      .run(`${seating_id}-O${i}`, seating_id, i < n ? 0 : 1);
  }
}

function billClosed(table_id: string, seating_id: string, by: Who): void {
  append(ev(table_id, 'BillClosed', { seating_id }, { actor: by.staffId, device: by.deviceId }));
}

// ---------------------------------------------------------------------------------------------- calls

let commandSeq = 0;

interface Res {
  status: number;
  data?: { event_ids: string[]; result: { alert_id: string } };
  error?: { code: string; details: Record<string, unknown> };
}

async function post(who: Who, command_type: string, payload: Record<string, unknown>, command_id?: string): Promise<Res> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${command_type === 'AnswerRequest' ? 'answer-request' : 'request-table-handover'}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: command_id ?? `cmd-${commandSeq}`,
      tenant_id: TENANT,
      branch_id: BRANCH,
      command_type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as { data?: Res['data']; error?: Res['error'] };
  return {
    status: res.statusCode,
    ...(body.data === undefined ? {} : { data: body.data }),
    ...(body.error === undefined ? {} : { error: { code: body.error.code, details: body.error.details } }),
  };
}

const handover = (who: Who, payload: Record<string, unknown>, command_id?: string) => post(who, 'RequestTableHandover', payload, command_id);
const answer = (who: Who, alert_id: string, decision: 'accept' | 'decline') => post(who, 'AnswerRequest', { alert_id, decision, method: 'session' });

function events(type?: string): PosEvent[] {
  const rows = (
    type === undefined
      ? hub.deps.db.prepare('SELECT * FROM events ORDER BY seq').all()
      : hub.deps.db.prepare('SELECT * FROM events WHERE event_type = ? ORDER BY seq').all(type)
  ) as Array<Record<string, unknown>>;
  return rows.map((r) => ({ ...r, payload: JSON.parse(r.payload as string) }) as unknown as PosEvent);
}

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

function alertRow(id: string): Record<string, unknown> {
  return hub.deps.db
    .prepare('SELECT kind, state, close_reason, step, next_due_at, details_json, values_json, display_json, requester_staff_id FROM alerts WHERE alert_id = ?')
    .get(id) as Record<string, unknown>;
}

function openHandovers(): number {
  return (hub.deps.db.prepare(`SELECT COUNT(*) AS n FROM alerts WHERE kind = 'table_handover' AND state = 'open'`).get() as { n: number }).n;
}

function holderOf(seating_id: string): string {
  return (hub.deps.db.prepare('SELECT holder_staff_id AS h FROM seatings WHERE seating_id = ?').get(seating_id) as { h: string }).h;
}

function lockOf(seating_id: string): { staff_id: string; device_id: string } | undefined {
  return hub.deps.db.prepare('SELECT staff_id, device_id FROM table_locks WHERE seating_id = ?').get(seating_id) as
    | { staff_id: string; device_id: string }
    | undefined;
}

/** One `alerts` tick pass at the hub clock, as the loop runs it (due, then its own writer.run). */
function alertsPass(): void {
  const now = hub.clock.branchNow();
  if (!alertsTick.due(hub.deps.db, hub.deps.state.get(), now)) return;
  hub.deps.writer.run((tx) => tx.append(alertsTick.intents(tx, hub.deps.state.get(), now)));
}

function stepsOf(alert_id: string): PosEvent[] {
  return events().filter(
    (e) => (e.event_type === 'AttemptSent' || e.event_type === 'StepSkipped') && (e.payload as { alert_id: string }).alert_id === alert_id,
  );
}

// ---------------------------------------------------------------------------------------------- tests

describe('02a RequestTableHandover (§6.7) and kind table_handover (§6.15)', () => {
  it('[02a §6.7] happy path: AlertRaised to the receiver, values / display / details, dedupe key, result { alert_id }; 1 + 1 + raise statements', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    open('T1', 'SEAT1', ali, { joined: ['T2'] });
    liveOrders('SEAT1', 2, 1);
    const r = await handover(ali, { table_id: 'T2', seating_id: 'SEAT1', to_staff_id: SARA, note: 'my shift ends' });
    expect(r.status).toBe(200);
    const alertId = r.data!.result.alert_id;
    expect(r.data!.result).toEqual({ alert_id: alertId });
    expect(handleStatements - raiseStatements).toBe(2);
    expect(raiseStatements).toBeGreaterThan(0);
    const raised = events('AlertRaised').find((e) => (e.payload as { alert_id: string }).alert_id === alertId)!;
    expect(raised).toMatchObject({ stream_type: 'table', stream_id: 'T1', actor_id: ALI, device_id: ali.deviceId });
    expect(raised.payload).toMatchObject({
      kind: 'table_handover',
      family: 'action',
      subject_stream_type: 'table',
      subject_stream_id: 'T1',
      dedupe_key: 'table_handover:SEAT1',
      requester_staff_id: ALI,
      target: { kind: 'person', staff_id: SARA },
      values: { table_id: 'T2', seating_id: 'SEAT1', from_staff_id: ALI },
      display: { kind_label_key: 'alert.table_handover.lock', table_code: 'Table 1 + Table 2', requester_name: 'Ali' },
      details: { quantity: 2 },
      request: { answers: ['accept', 'decline'], right_mode: 'named', receiver_staff_id: SARA },
    });
    expect(raised.payload).not.toHaveProperty('details.amount'); // AD-3: no seatingTotals yet
    const step0 = stepsOf(alertId)[0]!;
    expect(step0.payload).toMatchObject({ step: 0 });
    expect((step0.payload as { recipients: Array<{ staff_id: string; set: string }> }).recipients).toContainEqual(
      expect.objectContaining({ staff_id: SARA, set: 'answerer' }),
    );
    // no 02a event: the holder is unchanged until the receiver accepts
    expect(events('TableHolderChanged')).toEqual([]);
    expect(holderOf('SEAT1')).toBe(ALI);
  });

  it('[02a #12] handover accept → TableHolderChanged { handover }, to_staff_id = answerer; holder changes; request closed answered', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali, { locked: false });
    const r = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA });
    const alertId = r.data!.result.alert_id;
    const a = await answer(sara, alertId, 'accept');
    expect(a.status).toBe(200);
    const changed = events('TableHolderChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ stream_type: 'table', stream_id: 'T1', actor_id: SARA, device_id: sara.deviceId });
    expect(changed[0]!.payload).toEqual({
      table_id: 'T1',
      seating_id: 'SEAT1',
      reason: 'handover',
      alert_id: alertId,
      from_staff_id: ALI,
      to_staff_id: SARA,
      by_staff_id: SARA,
    });
    // no lock → no release
    expect(events('TableLockReleased')).toEqual([]);
    expect(holderOf('SEAT1')).toBe(SARA);
    expect(alertRow(alertId)).toMatchObject({ state: 'closed', close_reason: 'answered' });
  });

  it('[02a #52] accept while the old holder’s tablet holds the lock → TableHolderChanged and TableLockReleased { holder_changed }, both with alert_id; no 500', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    expect(lockOf('SEAT1')).toEqual({ staff_id: ALI, device_id: ali.deviceId });
    const alertId = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    const a = await answer(sara, alertId, 'accept');
    expect(a.status).toBe(200);
    const changed = events('TableHolderChanged');
    const released = events('TableLockReleased');
    expect(changed).toHaveLength(1);
    expect(released).toHaveLength(1);
    expect(changed[0]!.payload).toMatchObject({ alert_id: alertId, reason: 'handover', to_staff_id: SARA });
    expect(released[0]).toMatchObject({ stream_type: 'table', stream_id: 'T1' });
    expect(released[0]!.payload).toEqual({ table_id: 'T1', seating_id: 'SEAT1', staff_id: ALI, reason: 'holder_changed', alert_id: alertId });
    expect(lockOf('SEAT1')).toBeUndefined();
    expect(holderOf('SEAT1')).toBe(SARA);
  });

  it('[02a §3.8] accept: a lock the receiver holds himself (his other device) is kept (T20: only someone else’s lock is released)', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali, { locked: false });
    append(ev('T1', 'TableLocked', { table_id: 'T1', seating_id: 'SEAT1', staff_id: SARA }, { actor: SARA, device: 'DEV_SARA_OLD' }));
    const alertId = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    expect((await answer(sara, alertId, 'accept')).status).toBe(200);
    expect(events('TableLockReleased')).toEqual([]);
    expect(lockOf('SEAT1')).toEqual({ staff_id: SARA, device_id: 'DEV_SARA_OLD' });
  });

  it('[02a #13 accept] accept after BillClosed → 409 TABLE_HANDOVER_STALE, request still open, no holder change', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    liveOrders('SEAT1', 1);
    const alertId = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    billClosed('T1', 'SEAT1', ali);
    expect((hub.deps.db.prepare(`SELECT state FROM seatings WHERE seating_id = 'SEAT1'`).get() as { state: string }).state).toBe('NEEDS_CLEANING');
    const before = eventCount();
    const a = await answer(sara, alertId, 'accept');
    expect(a.status).toBe(409);
    expect(a.error).toEqual({ code: 'TABLE_HANDOVER_STALE', details: { table_id: 'T1', seating_id: 'SEAT1' } });
    expect(eventCount()).toBe(before);
    expect(alertRow(alertId)).toMatchObject({ state: 'open' });
    expect(holderOf('SEAT1')).toBe(ALI);
  });

  it('[02a §3.8] accept stale defence: holder no longer the sender, or the seating closed → 409 TABLE_HANDOVER_STALE', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    open('T3', 'SEAT3', ali);
    const a1 = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    const a3 = (await handover(ali, { table_id: 'T3', seating_id: 'SEAT3', to_staff_id: SARA })).data!.result.alert_id;
    // a raw holder change (no closeHandover: that is task 13's) and a raw clean (task 17's) leave the requests open
    append(
      ev('T1', 'TableHolderChanged', { table_id: 'T1', seating_id: 'SEAT1', from_staff_id: ALI, to_staff_id: BILAL, reason: 'take_over', by_staff_id: BILAL }, { actor: BILAL, device: 'DEV_B' }),
    );
    append(ev('T3', 'TableCleaned', { seating_id: 'SEAT3', table_ids: ['T3'], reason: 'left_without_order', by_staff_id: ALI }, { actor: ALI, device: ali.deviceId }));
    for (const id of [a1, a3]) {
      const r = await answer(sara, id, 'accept');
      expect(r.status).toBe(409);
      expect(r.error?.code).toBe('TABLE_HANDOVER_STALE');
      expect(alertRow(id)).toMatchObject({ state: 'open' });
    }
    expect(events('TableHolderChanged')).toHaveLength(1);
  });

  it('[02a #14] decline → no 02a event; request closed answered, the sender gets the request_result', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    const alertId = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    const tableEventsBefore = events().filter((e) => e.event_type.startsWith('Table')).length;
    const a = await answer(sara, alertId, 'decline');
    expect(a.status).toBe(200);
    expect(events().filter((e) => e.event_type.startsWith('Table')).length).toBe(tableEventsBefore);
    expect(holderOf('SEAT1')).toBe(ALI);
    expect(lockOf('SEAT1')).toEqual({ staff_id: ALI, device_id: ali.deviceId });
    expect(alertRow(alertId)).toMatchObject({ state: 'closed', close_reason: 'answered' });
    const result = events('AlertRaised').find((e) => (e.payload as { kind: string }).kind === 'request_result')!;
    expect(result.payload).toMatchObject({ target: { kind: 'person', staff_id: ALI }, values: { request_alert_id: alertId, decision: 'decline' } });
  });

  it('[02a #15] second handover → 409 TABLE_HANDOVER_PENDING { table_id, alert_id, to_staff_id }; receiver not working → 409 HANDOVER_TARGET_UNAVAILABLE; receiver = sender → 422 is_requester', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    const mgr = signIn(MGR);
    signIn(BILAL);
    open('T1', 'SEAT1', ali);
    const first = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    const before = eventCount();

    const second = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: BILAL });
    expect(second.status).toBe(409);
    expect(second.error).toEqual({ code: 'TABLE_HANDOVER_PENDING', details: { table_id: 'T1', alert_id: first, to_staff_id: SARA } });
    expect(eventCount()).toBe(before);
    expect(openHandovers()).toBe(1);

    open('T3', 'SEAT3', ali);
    const noor = await handover(ali, { table_id: 'T3', seating_id: 'SEAT3', to_staff_id: NOOR });
    expect(noor.status).toBe(409);
    expect(noor.error).toEqual({ code: 'HANDOVER_TARGET_UNAVAILABLE', details: { reason: 'not_working' } });

    // a manager (force) sending to himself: a table taken by a manager is ForceMoveTable (G4-1 #6)
    const self = await handover(mgr, { table_id: 'T3', seating_id: 'SEAT3', to_staff_id: MGR });
    expect(self.status).toBe(422);
    expect(self.error).toEqual({ code: 'HANDOVER_TARGET_INVALID', details: { reason: 'is_requester' } });
    expect(openHandovers()).toBe(1);
  });

  it('[02a §6.7] receiver checks: is_holder, no_permission (none / requires_approval), outside_scope (my_floors), inactive, not_working after sign-out', async () => {
    const ali = signIn(ALI);
    signIn(CASH);
    signIn(ZAIN);
    signIn(KAMI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    open('T9', 'SEAT9', ali);
    const expectInvalid = async (table_id: string, seating_id: string, to: string, status: number, code: string, reason: string) => {
      const r = await handover(ali, { table_id, seating_id, to_staff_id: to });
      expect(r.status).toBe(status);
      expect(r.error).toEqual({ code, details: { reason } });
    };
    await expectInvalid('T1', 'SEAT1', ALI, 422, 'HANDOVER_TARGET_INVALID', 'is_holder');
    await expectInvalid('T1', 'SEAT1', CASH, 422, 'HANDOVER_TARGET_INVALID', 'no_permission');
    await expectInvalid('T1', 'SEAT1', KAMI, 422, 'HANDOVER_TARGET_INVALID', 'no_permission');
    await expectInvalid('T9', 'SEAT9', ZAIN, 422, 'HANDOVER_TARGET_INVALID', 'outside_scope'); // Zain: my_floors F1, T9 on F2
    await expectInvalid('T1', 'SEAT1', 'S_GONE', 409, 'HANDOVER_TARGET_UNAVAILABLE', 'inactive'); // not in the directory
    endSessionNow(hub, sara.sessionId);
    await expectInvalid('T1', 'SEAT1', SARA, 409, 'HANDOVER_TARGET_UNAVAILABLE', 'not_working');
    // Zain's my_floors covers T1 (F1): passes
    const ok = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: ZAIN });
    expect(ok.status).toBe(200);
    expect(openHandovers()).toBe(1);
  });

  it('[02a §6.7] seating checks (T18): stale seating_id, FREE table → 409 TABLE_SEATING_CHANGED; NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    const stale = await handover(ali, { table_id: 'T1', seating_id: 'SEAT_OLD', to_staff_id: SARA });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
    const free = await handover(ali, { table_id: 'T3', seating_id: 'SEAT1', to_staff_id: SARA });
    expect(free.status).toBe(409);
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T3', seating_id: 'SEAT1' } });
    liveOrders('SEAT1', 1);
    billClosed('T1', 'SEAT1', ali);
    const dirty = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA });
    expect(dirty.status).toBe(409);
    expect(dirty.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
    expect(openHandovers()).toBe(0);
  });

  it('[02a §6.7] sender rule: a non-holder without force → 403 not_holder; requires_approval force → 403 not_holder (§3.15); allowed force → raised, from_staff_id = holder', async () => {
    const ali = signIn(ALI);
    const bilal = signIn(BILAL);
    const asif = signIn(ASIF);
    const mgr = signIn(MGR);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    for (const who of [bilal, asif]) {
      const r = await handover(who, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA });
      expect(r.status).toBe(403);
      expect(r.error).toEqual({
        code: 'PERMISSION_DENIED',
        details: { reason: 'not_holder', table_id: 'T1', assigned_staff_id: null, holder_staff_id: ALI },
      });
    }
    expect(openHandovers()).toBe(0);
    const ok = await handover(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA });
    expect(ok.status).toBe(200);
    expect(alertRow(ok.data!.result.alert_id)).toMatchObject({ requester_staff_id: MGR });
    expect(JSON.parse(alertRow(ok.data!.result.alert_id).values_json as string)).toEqual({ table_id: 'T1', seating_id: 'SEAT1', from_staff_id: ALI });
    expect(JSON.parse(alertRow(ok.data!.result.alert_id).display_json as string)).toMatchObject({ requester_name: 'Manager' });
  });

  it('[02a §6.7] scope last (C8): holder with take-order my_floors off the floor, force my_floors off the floor → 403 outside_scope { table_ids }; nothing raised', async () => {
    const zain = signIn(ZAIN);
    const fahad = signIn(FAHAD);
    signIn(SARA);
    open('T9', 'SEAT9', zain); // Zain holds a table on F2 (his scope: F1)
    const own = await handover(zain, { table_id: 'T9', seating_id: 'SEAT9', to_staff_id: SARA });
    expect(own.status).toBe(403);
    expect(own.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    const ali = signIn(ALI);
    open('T1', 'SEAT1', ali);
    const forced = await handover(fahad, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA }); // Fahad: force on F2, T1 on F1
    expect(forced.status).toBe(403);
    expect(forced.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T1'] } });
    expect(openHandovers()).toBe(0);
    expect(events('AlertRaised').filter((e) => (e.payload as { kind: string }).kind === 'table_handover')).toEqual([]);
    // Fahad on his own floor: passes
    const roof = await handover(fahad, { table_id: 'T9', seating_id: 'SEAT9', to_staff_id: SARA });
    expect(roof.status).toBe(200);
  });

  it('[02a §6.7] D32 retransmit: the same command_id → the same response, no new event', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    const first = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA }, 'cmd-handover-1');
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA }, 'cmd-handover-1');
    expect(again.status).toBe(200);
    expect(again.data).toEqual(first.data);
    expect(eventCount()).toBe(before);
    expect(openHandovers()).toBe(1);
  });

  it('[02a §6.7] payload: note over 120 characters → 400 VALIDATION_FAILED', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    const r = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, note: 'x'.repeat(121) });
    expect(r.status).toBe(400);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
  });

  it('[02a #48] handover on SEATED with no live order → alerts.raise input has details: {}; raised, card without quantity / amount', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    liveOrders('SEAT1', 0, 1); // a cancelled order is not live
    const r = await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA });
    expect(r.status).toBe(200);
    const raise = vi.mocked(alerts.raise);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise.mock.calls[0]![1].details).toEqual({});
    expect(JSON.parse(alertRow(r.data!.result.alert_id).details_json as string)).toEqual({});
  });

  it('[02a #16] steps: answerer at 0, reminder to the receiver at 60 s, the sender’s lead informed at 120 s (fake clock)', async () => {
    const ali = signIn(ALI);
    signIn(SARA);
    signIn(MGR); // Ali's lead
    open('T1', 'SEAT1', ali);
    const raisedAt = hub.clock.branchNow();
    const id = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    const recipients = (e: PosEvent) => (e.payload as { recipients: Array<{ staff_id: string; set: string }> }).recipients;
    expect(stepsOf(id).map((e) => (e.payload as { step: number }).step)).toEqual([0]);
    hub.clock.set(raisedAt + 59_999);
    alertsPass();
    expect(stepsOf(id)).toHaveLength(1);
    hub.clock.set(raisedAt + 60_000);
    alertsPass();
    expect(stepsOf(id)).toHaveLength(2);
    expect(stepsOf(id)[1]!.payload).toMatchObject({ step: 1 });
    expect(recipients(stepsOf(id)[1]!)).toContainEqual(expect.objectContaining({ staff_id: SARA, set: 'answerer' }));
    hub.clock.set(raisedAt + 119_999);
    alertsPass();
    expect(stepsOf(id)).toHaveLength(2);
    hub.clock.set(raisedAt + 120_000);
    alertsPass();
    expect(stepsOf(id)).toHaveLength(3);
    expect(stepsOf(id)[2]!.payload).toMatchObject({ step: 2 });
    expect(recipients(stepsOf(id)[2]!)).toContainEqual(expect.objectContaining({ staff_id: MGR, set: 'informed' }));
    // requests never expire: still open, no further step
    expect(alertRow(id)).toMatchObject({ state: 'open', step: 2, next_due_at: null });
  });
});

describe('02a table_handover apply (§3.8)', () => {
  it('[02a §3.8] apply reads the seating in 1 statement; decline → [] with no statement', async () => {
    const { TABLE_HANDOVER } = await import('../../src/tables/kinds');
    const ali = signIn(ALI);
    open('T1', 'SEAT1', ali);
    const alert = { alert_id: 'HO1', values: { table_id: 'T1', seating_id: 'SEAT1', from_staff_id: ALI } };
    const facts = (decision: 'accept' | 'decline') => ({ decision, answerer_staff_id: SARA, method: 'session' as const, device_id: 'DEV_S', answered_at: 0 });
    const out = hub.deps.writer.run((tx) => {
      const ctx = { tx, clock: tx.clock, actor: { staffId: SARA, deviceId: 'DEV_S' }, alert } as unknown as Parameters<
        NonNullable<typeof TABLE_HANDOVER.request>['apply']
      >[0];
      const before = counter.count;
      const accepted = TABLE_HANDOVER.request!.apply(ctx, facts('accept'));
      const acceptStatements = counter.count - before;
      const mid = counter.count;
      const declined = TABLE_HANDOVER.request!.apply(ctx, facts('decline'));
      return { accepted: accepted.map((d) => d.event_type), acceptStatements, declined, declineStatements: counter.count - mid };
    }).result;
    expect(out).toEqual({ accepted: ['TableHolderChanged', 'TableLockReleased'], acceptStatements: 1, declined: [], declineStatements: 0 });
  });
});

describe('02a closeHandover (§3.9)', () => {
  it('[02a §3.9] closes the seating’s pending handover obsolete with the note (AlertClosed + request_result to the sender); none pending → []; byDedupeKey 1 statement', async () => {
    const { closeHandover } = await import('../../src/tables/handover');
    const ali = signIn(ALI);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    const alertId = (await handover(ali, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA })).data!.result.alert_id;
    const ctxOf = (tx: Parameters<Parameters<typeof hub.deps.writer.run>[0]>[0]) =>
      ({
        tx,
        state: tx.state,
        clock: tx.clock,
        ids: tx.ids,
        secrets: hub.deps.secrets,
        actor: { kind: 'staff', staffId: BILAL, stationId: null, sessionId: 'x', deviceId: 'DEV_B' },
        permission: null,
        branch: { tenantId: TENANT, branchId: BRANCH },
        directory: undefined,
        config: hub.deps.config,
        queuedAt: null,
      }) as unknown as Parameters<typeof closeHandover>[0];

    const none = hub.deps.writer.run((tx) => {
      const before = counter.count;
      const drafts = closeHandover(ctxOf(tx), 'SEAT_NONE', 'moved');
      return { drafts, statements: counter.count - before };
    }).result;
    expect(none).toEqual({ drafts: [], statements: 1 });

    const { result } = hub.deps.writer.run((tx) => {
      const drafts = closeHandover(ctxOf(tx), 'SEAT1', 'taken over');
      tx.append(drafts);
      return drafts;
    });
    expect(result.map((d) => d.event_type)).toEqual(['AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(result[0]!.payload).toMatchObject({ alert_id: alertId, reason: 'obsolete', by_staff_id: BILAL, note: 'taken over' });
    expect(result[1]!.payload).toMatchObject({
      kind: 'request_result',
      target: { kind: 'person', staff_id: ALI },
      values: { request_alert_id: alertId, close_reason: 'obsolete' },
    });
    expect(alertRow(alertId)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
  });
});

// ---------------------------------------------------------------------------------------------- §11 step 12

describe('02a §11 step 12: kinds at module top level', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const c of cleanups.splice(0)) c();
  });

  it('[02a §11 step 12] an open table_handover replayed at boot is a known kind: step 0 due at raised_at, no unknown_kind line', async () => {
    const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    const dir = mkdtempSync(join(tmpdir(), 'pos-02a-kinds-'));
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
        provisioned: { tenant_id: TENANT, branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'k' },
      }),
    );
    const db = openDb(join(dataDir, 'hub.sqlite'));
    await runMigrations(db, { dir: migrations, clock: fixedClock(T) });
    const raised = anAlertRaised({
      stream_type: 'table',
      stream_id: 'T1',
      payload: {
        alert_id: 'HO1',
        kind: 'table_handover',
        family: 'action',
        subject_stream_type: 'table',
        subject_stream_id: 'T1',
        dedupe_key: 'table_handover:SEAT1',
        requester_staff_id: ALI,
        target: { kind: 'person', staff_id: SARA },
        values: { table_id: 'T1', seating_id: 'SEAT1', from_staff_id: ALI },
        display: { kind_label_key: 'alert.table_handover.lock', table_code: 'Table 1', requester_name: 'Ali' },
        details: {},
        request: {
          answers: ['accept', 'decline'],
          right_mode: 'named',
          base_permission: null,
          range_permission: null,
          approver_role_ids: [],
          receiver_staff_id: SARA,
          needs_pin: 'never',
        },
      },
    });
    db.prepare(
      `INSERT INTO events (
        event_id, tenant_id, branch_id, stream_type, stream_id, event_type,
        schema_version, payload, occurred_at, recorded_at, actor_id, device_id, seq
      ) VALUES ('evt-1', ?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, 1)`,
    ).run(TENANT, BRANCH, raised.stream_type, raised.stream_id, raised.event_type, JSON.stringify(raised.payload), T, T, ALI, raised.device_id);
    db.close();
    const capture = createLogCapture();
    const booted = await boot({
      configPath,
      wallNow: () => T + 10_000,
      monoNow: () => 0,
      logStream: capture.stream,
      configClient: stubConfigCloud(),
      cloudClient: offlineCloud(),
    });
    try {
      expect(booted.step()).toBe('8');
      const row = booted.deps.db.prepare('SELECT kind, state, step, next_due_at FROM alerts WHERE alert_id = ?').get('HO1');
      // a known kind has step 0 pending at raised_at; the P-8 unknown-kind path would persist next_due_at NULL
      expect(row).toEqual({ kind: 'table_handover', state: 'open', step: -1, next_due_at: T });
      expect(capture.text()).not.toContain('unknown_kind');
    } finally {
      await booted.stop();
    }
  });
});
