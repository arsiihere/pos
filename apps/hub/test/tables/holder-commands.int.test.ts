import type { BranchConfig, DirectoryInput, EventDraft, PosEvent } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alerts } from '../../src/alerts/raise';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx, CommandDef } from '../../src/commands/registry';
import { toKebab } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { requireLock } from '../../src/tables/lock';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, endSessionNow, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §3.7, §6.6 TakeOverTable, §6.8 ForceMoveTable, T5, T10, T18, T20, §3.9 (closeHandover), §3.15.
// Seatings are seeded with real TableOpened / TableLocked / TablesMerged / BillClosed events through the hub writer
// (OpenTable is another lane's task); handovers through the real RequestTableHandover and 01d AnswerRequest.

const TENANT = 'tenant-a';
const BRANCH = 'branch-1';
const ALI = 'S_ALI'; // holder; take-order branch; lead MGR
const SARA = 'S_SARA'; // assignee of T1 (table assignment); take-order branch
const HINA = 'S_HINA'; // assignee of T2 only; take-order branch
const ZAIN = 'S_ZAIN'; // take-order my_floors F1; assignee of T9 (floor F2)
const BILAL = 'S_BILAL'; // take-order branch, assigned nothing, no force
const NOOR = 'S_NOOR'; // take-order branch, never signed in
const FAHAD = 'S_FAHAD'; // take-order + force-release-table-lock my_floors F2
const ASIF = 'S_ASIF'; // take-order + force-release-table-lock requires_approval
const KAMI = 'S_KAMI'; // take-order requires_approval only
const MGR = 'S_MGR'; // aDirectory manager: every permission allowed at branch scope
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
  const person = (staff_id: string, display_name: string, role_id: string, o: { floors?: string[]; lead?: string; tables?: string[] } = {}) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: o.lead ?? null,
    floor_ids: o.floors ?? [],
    ...(o.tables === undefined ? {} : { assigned_table_ids: o.tables, assigned_zone_ids: [] }),
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
      person(SARA, 'Sara', 'R_TAKER', { tables: ['T1'] }),
      person(HINA, 'Hina', 'R_TAKER', { tables: ['T2'] }),
      person(ZAIN, 'Zain', 'R_FLOOR', { floors: ['F1'], tables: ['T9'] }),
      person(BILAL, 'Bilal', 'R_TAKER'),
      person(NOOR, 'Noor', 'R_TAKER'),
      person(FAHAD, 'Fahad', 'R_FORCE_F2', { floors: ['F2'] }),
      person(ASIF, 'Asif', 'R_FORCE_APPROVAL'),
      person(KAMI, 'Kami', 'R_TAKER_APPROVAL'),
    ],
  } as DirectoryInput;
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
const handleStatements: Record<string, number> = {};
let closeStatements = 0;
const restores: Array<() => void> = [];

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  swapBranchConfig({ config: config(), snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  counter = statementCounter(hub.deps.db);
  // statements of each command's handle, and of the alerts.close call inside it
  for (const name of ['TakeOverTable', 'ForceMoveTable']) {
    handleStatements[name] = -1;
    const def = commandRegistry(hub.app).byPath(toKebab(name)) as CommandDef | undefined;
    if (def === undefined) continue;
    const original = def.handle;
    def.handle = (ctx, payload, cmd) => {
      const before = counter.count;
      closeStatements = 0;
      try {
        return original.call(def, ctx, payload, cmd);
      } finally {
        handleStatements[name] = counter.count - before;
      }
    };
    restores.push(() => {
      def.handle = original;
    });
  }
  const close = alerts.close.bind(alerts);
  vi.spyOn(alerts, 'close').mockImplementation((ctx, id, reason, note) => {
    const before = counter.count;
    try {
      return close(ctx, id, reason, note);
    } finally {
      closeStatements += counter.count - before;
    }
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const r of restores.splice(0)) r();
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

/** A seating opened and locked by `holder` on his device (TableOpened + TableLocked), optionally joined tables. */
function open(table_id: string, seating_id: string, holder: Who, o: { joined?: string[]; locked?: boolean } = {}): void {
  const by = { actor: holder.staffId, device: holder.deviceId };
  append(ev(table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder.staffId, party_size: 2 }, by));
  if (o.locked !== false) append(ev(table_id, 'TableLocked', { table_id, seating_id, staff_id: holder.staffId }, by));
  for (const joined of o.joined ?? []) {
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

function billClosed(table_id: string, seating_id: string, by: Who): void {
  append(ev(table_id, 'BillClosed', { seating_id }, { actor: by.staffId, device: by.deviceId }));
}

// ---------------------------------------------------------------------------------------------- calls

let commandSeq = 0;

interface Res {
  status: number;
  data?: { event_ids: string[]; result: Record<string, unknown> };
  error?: { code: string; details: Record<string, unknown> };
}

async function post(who: Who, command_type: string, payload: Record<string, unknown>, command_id?: string): Promise<Res> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${toKebab(command_type)}`,
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

const takeOver = (who: Who, payload: Record<string, unknown>, command_id?: string) => post(who, 'TakeOverTable', payload, command_id);
const forceMove = (who: Who, payload: Record<string, unknown>, command_id?: string) => post(who, 'ForceMoveTable', payload, command_id);
const requestHandover = async (who: Who, table_id: string, seating_id: string, to_staff_id: string): Promise<string> => {
  const r = await post(who, 'RequestTableHandover', { table_id, seating_id, to_staff_id });
  expect(r.status).toBe(200);
  return r.data!.result.alert_id as string;
};
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
  return hub.deps.db.prepare('SELECT kind, state, close_reason FROM alerts WHERE alert_id = ?').get(id) as Record<string, unknown>;
}

function holderOf(seating_id: string): string {
  return (hub.deps.db.prepare('SELECT holder_staff_id AS h FROM seatings WHERE seating_id = ?').get(seating_id) as { h: string }).h;
}

function lockOf(seating_id: string): { staff_id: string; device_id: string } | undefined {
  return hub.deps.db.prepare('SELECT staff_id, device_id FROM table_locks WHERE seating_id = ?').get(seating_id) as
    | { staff_id: string; device_id: string }
    | undefined;
}

function resultFor(alert_id: string): PosEvent | undefined {
  return events('AlertRaised').find(
    (e) => (e.payload as { kind: string; values?: { request_alert_id?: string } }).kind === 'request_result' &&
      (e.payload as { values: { request_alert_id: string } }).values.request_alert_id === alert_id,
  );
}

/** `requireLock` for `who` on his device through the writer (OpenTable is lane A's): the drafts it returns are appended. */
function lockAs(who: Who, table_id: string, seating_id: string): EventDraft[] {
  return hub.deps.writer.run((tx) => {
    const ctx = {
      tx,
      state: tx.state,
      clock: tx.clock,
      ids: tx.ids,
      secrets: hub.deps.secrets,
      actor: { kind: 'staff', staffId: who.staffId, stationId: null, sessionId: who.sessionId, deviceId: who.deviceId },
      permission: null,
      branch: { tenantId: TENANT, branchId: BRANCH },
      directory: currentDirectory(hub.app),
      config: hub.deps.config,
      queuedAt: null,
    } as unknown as CommandCtx;
    const drafts = requireLock(tx, { table_id, seating_id }, ctx);
    tx.append(drafts);
    return drafts;
  }).result;
}

// ---------------------------------------------------------------------------------------------- TakeOverTable

describe('02a TakeOverTable (§3.7, §6.6)', () => {
  it('[02a #10] take-over by the assignee → TableHolderChanged { take_over }; the old holder’s lock released holder_changed; pending handover closed obsolete with a result to its sender', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    signIn(BILAL);
    open('T1', 'SEAT1', ali);
    const pending = await requestHandover(ali, 'T1', 'SEAT1', BILAL);
    const r = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(r.data!.result).toEqual({ changed: true });
    const changed = events('TableHolderChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ stream_type: 'table', stream_id: 'T1', actor_id: SARA, device_id: sara.deviceId });
    expect(changed[0]!.payload).toEqual({ table_id: 'T1', seating_id: 'SEAT1', from_staff_id: ALI, to_staff_id: SARA, reason: 'take_over', by_staff_id: SARA });
    const released = events('TableLockReleased');
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ stream_type: 'table', stream_id: 'T1', actor_id: SARA });
    expect(released[0]!.payload).toEqual({ table_id: 'T1', seating_id: 'SEAT1', staff_id: ALI, reason: 'holder_changed' });
    expect(holderOf('SEAT1')).toBe(SARA);
    expect(lockOf('SEAT1')).toBeUndefined();
    // §3.9: the pending handover closed obsolete, the sender told
    expect(alertRow(pending)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    const closed = events('AlertClosed').find((e) => (e.payload as { alert_id: string }).alert_id === pending)!;
    expect(closed.payload).toMatchObject({ reason: 'obsolete', by_staff_id: SARA });
    expect(resultFor(pending)!.payload).toMatchObject({ target: { kind: 'person', staff_id: ALI }, values: { close_reason: 'obsolete' } });
    // all in one transaction (one command → its event ids)
    const ids = r.data!.event_ids;
    for (const e of [changed[0]!, released[0]!, closed]) expect(ids).toContain(e.event_id);
  });

  it('[02a #10] the assignee’s own lock (his other device) is kept (T20: only someone else’s lock is released)', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali, { locked: false });
    append(ev('T1', 'TableLocked', { table_id: 'T1', seating_id: 'SEAT1', staff_id: SARA }, { actor: SARA, device: 'DEV_SARA_OLD' }));
    const r = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(events('TableLockReleased')).toEqual([]);
    expect(lockOf('SEAT1')).toEqual({ staff_id: SARA, device_id: 'DEV_SARA_OLD' });
    expect(holderOf('SEAT1')).toBe(SARA);
  });

  it('[02a §6.6] no lock → TableHolderChanged only; no pending handover → no AlertClosed; statements 1 + byDedupeKey (2) without a close', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali, { locked: false });
    const r = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(r.data!.event_ids).toHaveLength(1);
    expect(events('TableLockReleased')).toEqual([]);
    expect(events('AlertClosed')).toEqual([]);
    expect(handleStatements.TakeOverTable).toBe(2);
    expect(closeStatements).toBe(0);
  });

  it('[02a §6.6] statements: 1 (seating + lock) + 1 byDedupeKey + the alerts.close bound', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    signIn(BILAL);
    open('T1', 'SEAT1', ali);
    await requestHandover(ali, 'T1', 'SEAT1', BILAL);
    const r = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(closeStatements).toBeGreaterThan(0);
    expect(handleStatements.TakeOverTable! - closeStatements).toBe(2);
  });

  it('[02a #11] take-over by a non-assignee → 403 not_assigned { table_id, assigned_staff_id, holder_staff_id }; on NEEDS_CLEANING → 409; outside scope → 403', async () => {
    const ali = signIn(ALI);
    const bilal = signIn(BILAL);
    const zain = signIn(ZAIN);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    const before = eventCount();
    const notAssigned = await takeOver(bilal, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(notAssigned.status).toBe(403);
    expect(notAssigned.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'not_assigned', table_id: 'T1', assigned_staff_id: SARA, holder_staff_id: ALI },
    });
    expect(eventCount()).toBe(before);
    // NEEDS_CLEANING
    open('T3', 'SEAT3', ali);
    billClosed('T3', 'SEAT3', ali);
    const cleaning = await takeOver(sara, { table_id: 'T3', seating_id: 'SEAT3' });
    expect(cleaning.status).toBe(409);
    expect(cleaning.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T3' } });
    // outside scope: Zain (my_floors F1) is T9's assignee, T9 is on F2
    open('T9', 'SEAT9', ali);
    const pending = await requestHandover(ali, 'T9', 'SEAT9', BILAL);
    const beforeScope = eventCount();
    const outside = await takeOver(zain, { table_id: 'T9', seating_id: 'SEAT9' });
    expect(outside.status).toBe(403);
    expect(outside.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    // scope last: the drafts were made, the transaction rolled back
    expect(eventCount()).toBe(beforeScope);
    expect(holderOf('SEAT9')).toBe(ALI);
    expect(lockOf('SEAT9')).toEqual({ staff_id: ALI, device_id: ali.deviceId });
    expect(alertRow(pending)).toMatchObject({ state: 'open' });
  });

  it('[02a §6.6] T10: a seating’s assignee is its primary table’s — naming the joined table works for Sara; Hina (assignee of the joined T2) → 403 not_assigned naming Sara', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    const hina = signIn(HINA);
    open('T1', 'SEAT1', ali, { joined: ['T2'] });
    const r = await takeOver(hina, { table_id: 'T2', seating_id: 'SEAT1' });
    expect(r.status).toBe(403);
    expect(r.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'not_assigned', table_id: 'T2', assigned_staff_id: SARA, holder_staff_id: ALI } });
    const ok = await takeOver(sara, { table_id: 'T2', seating_id: 'SEAT1' });
    expect(ok.status).toBe(200);
    expect(events('TableHolderChanged')[0]).toMatchObject({ stream_id: 'T1' });
    expect(events('TableHolderChanged')[0]!.payload).toMatchObject({ table_id: 'T1', to_staff_id: SARA });
  });

  it('[02a §6.6] holder = caller (the assignee holds it) → { changed: false }, no event', async () => {
    const sara = signIn(SARA);
    open('T1', 'SEAT1', sara);
    const before = eventCount();
    const r = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(r.data!.result).toEqual({ changed: false });
    expect(r.data!.event_ids).toEqual([]);
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.6] stale seating_id and a FREE table → 409 TABLE_SEATING_CHANGED (T18, §6 common rules)', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    const stale = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT_OLD' });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
    const free = await takeOver(sara, { table_id: 'T3', seating_id: 'SEAT1' });
    expect(free.status).toBe(409);
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T3', seating_id: 'SEAT1' } });
    expect(events('TableHolderChanged')).toEqual([]);
  });

  it('[02a §6.6] permission take-order: no grant / requires_approval → 403 at the pipeline, no event', async () => {
    const ali = signIn(ALI);
    const cash = signIn(CASH);
    const kami = signIn(KAMI);
    open('T1', 'SEAT1', ali);
    for (const who of [cash, kami]) {
      const r = await takeOver(who, { table_id: 'T1', seating_id: 'SEAT1' });
      expect(r.status).toBe(403);
      expect(r.error!.code).toBe('PERMISSION_DENIED');
    }
    expect(events('TableHolderChanged')).toEqual([]);
  });

  it('[02a §6.6] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    const first = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' }, 'cmd-take-1');
    const before = eventCount();
    const again = await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' }, 'cmd-take-1');
    expect(again.status).toBe(200);
    expect(again.data).toEqual(first.data);
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.6] payload: table_id and seating_id required → 400', async () => {
    const sara = signIn(SARA);
    const r = await takeOver(sara, { table_id: 'T1' });
    expect(r.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------- ForceMoveTable

describe('02a ForceMoveTable (§6.8)', () => {
  it('[02a #17] force move → TableHolderChanged { force_move, note }, the old holder’s lock released holder_changed, handover closed; to the holder → changed: false', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(SARA);
    signIn(BILAL);
    open('T1', 'SEAT1', ali);
    const pending = await requestHandover(ali, 'T1', 'SEAT1', BILAL);
    const r = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'Ali went home sick' });
    expect(r.status).toBe(200);
    expect(r.data!.result).toEqual({ changed: true });
    const changed = events('TableHolderChanged');
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ stream_type: 'table', stream_id: 'T1', actor_id: MGR, device_id: mgr.deviceId });
    expect(changed[0]!.payload).toEqual({
      table_id: 'T1',
      seating_id: 'SEAT1',
      from_staff_id: ALI,
      to_staff_id: SARA,
      reason: 'force_move',
      by_staff_id: MGR,
      note: 'Ali went home sick',
    });
    const released = events('TableLockReleased');
    expect(released).toHaveLength(1);
    expect(released[0]!.payload).toEqual({ table_id: 'T1', seating_id: 'SEAT1', staff_id: ALI, reason: 'holder_changed' });
    expect(holderOf('SEAT1')).toBe(SARA);
    expect(lockOf('SEAT1')).toBeUndefined();
    expect(alertRow(pending)).toMatchObject({ state: 'closed', close_reason: 'obsolete' });
    expect(resultFor(pending)!.payload).toMatchObject({ target: { kind: 'person', staff_id: ALI }, values: { close_reason: 'obsolete' } });
    // to the holder → { changed: false }, no event
    const before = eventCount();
    const same = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'again' });
    expect(same.status).toBe(200);
    expect(same.data!.result).toEqual({ changed: false });
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.8] a manager may move a table to himself (no is_requester); his own lock elsewhere kept', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    open('T1', 'SEAT1', ali, { locked: false });
    append(ev('T1', 'TableLocked', { table_id: 'T1', seating_id: 'SEAT1', staff_id: MGR }, { actor: MGR, device: 'DEV_MGR_OLD' }));
    const r = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: MGR, reason: 'closing up' });
    expect(r.status).toBe(200);
    expect(holderOf('SEAT1')).toBe(MGR);
    expect(events('TableLockReleased')).toEqual([]);
    expect(lockOf('SEAT1')).toEqual({ staff_id: MGR, device_id: 'DEV_MGR_OLD' });
  });

  it('[02a §6.8] T20: a lock held by the old holder is released even when the manager moves it elsewhere; a lock held by the new holder is kept', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(SARA);
    open('T1', 'SEAT1', ali, { locked: false });
    append(ev('T1', 'TableLocked', { table_id: 'T1', seating_id: 'SEAT1', staff_id: SARA }, { actor: SARA, device: 'DEV_SARA_OLD' }));
    const r = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' });
    expect(r.status).toBe(200);
    expect(events('TableLockReleased')).toEqual([]);
    expect(lockOf('SEAT1')).toEqual({ staff_id: SARA, device_id: 'DEV_SARA_OLD' });
  });

  it('[02a §6.8] statements: 1 (seating + lock) + 1 (receiver session) + 1 byDedupeKey + the alerts.close bound', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(SARA);
    signIn(BILAL);
    open('T1', 'SEAT1', ali);
    open('T3', 'SEAT3', ali);
    await requestHandover(ali, 'T1', 'SEAT1', BILAL);
    expect((await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' })).status).toBe(200);
    expect(closeStatements).toBeGreaterThan(0);
    expect(handleStatements.ForceMoveTable! - closeStatements).toBe(3);
    // none pending: no close
    expect((await forceMove(mgr, { table_id: 'T3', seating_id: 'SEAT3', to_staff_id: SARA, reason: 'r' })).status).toBe(200);
    expect(closeStatements).toBe(0);
    expect(handleStatements.ForceMoveTable).toBe(3);
  });

  it('[02a §6.8] receiver checks as §6.7 step 3: 422 no_permission / outside_scope; 409 HANDOVER_TARGET_UNAVAILABLE inactive / not_working; nothing written', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(KAMI);
    signIn(ZAIN);
    const sara = signIn(SARA);
    open('T1', 'SEAT1', ali);
    open('T9', 'SEAT9', ali);
    const before = eventCount();
    const cases: Array<[Record<string, unknown>, number, { code: string; details: Record<string, unknown> }]> = [
      [{ table_id: 'T1', seating_id: 'SEAT1', to_staff_id: KAMI }, 422, { code: 'HANDOVER_TARGET_INVALID', details: { reason: 'no_permission' } }],
      [{ table_id: 'T1', seating_id: 'SEAT1', to_staff_id: CASH }, 422, { code: 'HANDOVER_TARGET_INVALID', details: { reason: 'no_permission' } }],
      [{ table_id: 'T9', seating_id: 'SEAT9', to_staff_id: ZAIN }, 422, { code: 'HANDOVER_TARGET_INVALID', details: { reason: 'outside_scope' } }],
      [{ table_id: 'T1', seating_id: 'SEAT1', to_staff_id: 'S_GONE' }, 409, { code: 'HANDOVER_TARGET_UNAVAILABLE', details: { reason: 'inactive' } }],
      [{ table_id: 'T1', seating_id: 'SEAT1', to_staff_id: NOOR }, 409, { code: 'HANDOVER_TARGET_UNAVAILABLE', details: { reason: 'not_working' } }],
    ];
    for (const [payload, status, error] of cases) {
      const r = await forceMove(mgr, { ...payload, reason: 'r' });
      expect(r.status).toBe(status);
      expect(r.error).toEqual(error);
    }
    expect(eventCount()).toBe(before);
    // not working after signing out (the sign-out writes its own event)
    endSessionNow(hub, sara.sessionId);
    const afterSignOut = eventCount();
    const off = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' });
    expect(off.status).toBe(409);
    expect(off.error).toEqual({ code: 'HANDOVER_TARGET_UNAVAILABLE', details: { reason: 'not_working' } });
    expect(eventCount()).toBe(afterSignOut);
    expect(holderOf('SEAT1')).toBe(ALI);
  });

  it('[02a §6.8] stale seating_id / FREE table → 409 TABLE_SEATING_CHANGED; NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    open('T3', 'SEAT3', ali);
    billClosed('T3', 'SEAT3', ali);
    const stale = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT_OLD', to_staff_id: SARA, reason: 'r' });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
    const free = await forceMove(mgr, { table_id: 'T2', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' });
    expect(free.status).toBe(409);
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: 'SEAT1' } });
    const cleaning = await forceMove(mgr, { table_id: 'T3', seating_id: 'SEAT3', to_staff_id: SARA, reason: 'r' });
    expect(cleaning.status).toBe(409);
    expect(cleaning.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T3' } });
    expect(events('TableHolderChanged')).toEqual([]);
  });

  it('[02a §6.8] permission force-release-table-lock: none / requires_approval → 403 (§3.15); scope last: my_floors F2 on an F1 table → 403 outside_scope, rolled back', async () => {
    const ali = signIn(ALI);
    const bilal = signIn(BILAL);
    const asif = signIn(ASIF);
    const fahad = signIn(FAHAD);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    const pending = await requestHandover(ali, 'T1', 'SEAT1', BILAL);
    const before = eventCount();
    for (const who of [bilal, asif]) {
      const r = await forceMove(who, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' });
      expect(r.status).toBe(403);
      expect(r.error!.code).toBe('PERMISSION_DENIED');
    }
    const outside = await forceMove(fahad, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' });
    expect(outside.status).toBe(403);
    expect(outside.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T1'] } });
    expect(eventCount()).toBe(before);
    expect(holderOf('SEAT1')).toBe(ALI);
    expect(alertRow(pending)).toMatchObject({ state: 'open' });
    // on his own floor it passes
    open('T9', 'SEAT9', ali);
    const ok = await forceMove(fahad, { table_id: 'T9', seating_id: 'SEAT9', to_staff_id: SARA, reason: 'r' });
    expect(ok.status).toBe(200);
    expect(holderOf('SEAT9')).toBe(SARA);
  });

  it('[02a §6.8] reason 1–120: empty or 121 chars → 400', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    for (const reason of ['', 'x'.repeat(121)]) {
      const r = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason });
      expect(r.status).toBe(400);
    }
    expect((await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'x'.repeat(120) })).status).toBe(200);
  });

  it('[02a §6.8] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn(ALI);
    const mgr = signIn(MGR);
    signIn(SARA);
    open('T1', 'SEAT1', ali);
    const first = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' }, 'cmd-force-1');
    const before = eventCount();
    const again = await forceMove(mgr, { table_id: 'T1', seating_id: 'SEAT1', to_staff_id: SARA, reason: 'r' }, 'cmd-force-1');
    expect(again.status).toBe(200);
    expect(again.data).toEqual(first.data);
    expect(eventCount()).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------- #47

describe('02a #47 holder change releases the old holder’s lock (T20)', () => {
  it('[02a #47] take-over, accepted handover and force move each release the old holder’s lock holder_changed; the new holder takes the lock at once', async () => {
    const ali = signIn(ALI);
    const sara = signIn(SARA);
    const bilal = signIn(BILAL);
    const mgr = signIn(MGR);

    // take-over
    open('T1', 'SEAT1', ali);
    expect((await takeOver(sara, { table_id: 'T1', seating_id: 'SEAT1' })).status).toBe(200);
    // accepted handover
    open('T2', 'SEAT2', ali);
    const alertId = await requestHandover(ali, 'T2', 'SEAT2', BILAL);
    expect((await answer(bilal, alertId, 'accept')).status).toBe(200);
    // force move
    open('T3', 'SEAT3', ali);
    expect((await forceMove(mgr, { table_id: 'T3', seating_id: 'SEAT3', to_staff_id: BILAL, reason: 'r' })).status).toBe(200);

    const released = events('TableLockReleased').map((e) => e.payload as { seating_id: string; staff_id: string; reason: string });
    expect(released.map((p) => [p.seating_id, p.staff_id, p.reason])).toEqual([
      ['SEAT1', ALI, 'holder_changed'],
      ['SEAT2', ALI, 'holder_changed'],
      ['SEAT3', ALI, 'holder_changed'],
    ]);
    for (const [seating, table, who] of [['SEAT1', 'T1', sara], ['SEAT2', 'T2', bilal], ['SEAT3', 'T3', bilal]] as const) {
      expect(lockOf(seating)).toBeUndefined();
      const drafts = lockAs(who, table, seating);
      expect(drafts.map((d) => d.event_type)).toEqual(['TableLocked']);
      expect(lockOf(seating)).toEqual({ staff_id: who.staffId, device_id: who.deviceId });
    }
    // and the old holder no longer can
    expect(() => lockAs(ali, 'T1', 'SEAT1')).toThrow();
  });
});
