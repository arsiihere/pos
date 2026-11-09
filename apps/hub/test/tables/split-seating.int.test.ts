import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { MergeGuard } from '../../src/tables/contracts';
import { registerMergeGuard, resetMergeGuard } from '../../src/tables/merge-guard';
import { currentTableOf, holdersOfOrders } from '../../src/tables/reads';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §3.12 / §6.11 SplitSeating; tests #28, #29, #30, #51; §10 preamble (row 6.11: 404, 409×6, 403).
// Seatings, locks, holders and orders are seeded with real events appended through the writer (TableOpened,
// TableLocked, TableHolderChanged, TablesMerged, OrderPlaced, OrderCancelled, BillClosed); pending handovers through
// the real RequestTableHandover command; no other lane's command is called.

let hub: TestHub;
// statements of the last `handle` call
const handlerReads = { count: 0 };

type Grant = 'allowed' | 'requires_approval';
type Scope = 'branch' | 'my_floors' | 'own_tables';

function grant(permission: string, grant_type: Grant, scope: Scope = 'branch') {
  const a = grant_type === 'requires_approval';
  return { permission, grant_type, approver_role_id: a ? 'R_MGR' : null, approver_role_ids: a ? ['R_MGR'] : [], scope };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({
    role_id,
    name: role_id,
    session_idle_ttl_ms: 3_600_000,
    permissions,
  });
  const person = (staff_id: string, display_name: string, role_id: string, extra: { floor_ids?: string[]; assigned_table_ids?: string[] } = {}) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids: extra.floor_ids ?? [],
    assigned_table_ids: extra.assigned_table_ids ?? [],
  });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order', 'allowed')]),
      role('R_FORCE', [grant('take-order', 'allowed'), grant('force-release-table-lock', 'allowed')]),
      role('R_FORCE_APPROVAL', [grant('take-order', 'allowed'), grant('force-release-table-lock', 'requires_approval')]),
      role('R_FLOOR', [grant('take-order', 'allowed', 'my_floors')]),
      role('R_OWN', [grant('take-order', 'allowed', 'own_tables')]),
      role('R_FORCE_FLOOR', [grant('take-order', 'allowed'), grant('force-release-table-lock', 'allowed', 'my_floors')]),
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'Ali', 'R_TAKER'),
      person('S_BILAL', 'Bilal', 'R_TAKER', { assigned_table_ids: ['T6'] }),
      person('S_NOOR', 'Noor', 'R_TAKER'),
      person('S_SARA', 'Sara', 'R_TAKER', { assigned_table_ids: ['T5'] }),
      person('S_BOSS', 'Manager', 'R_FORCE'),
      person('S_BOSS_APPR', 'Approval manager', 'R_FORCE_APPROVAL'),
      person('S_ZAIN', 'Zain', 'R_FLOOR', { floor_ids: ['F1'] }),
      person('S_OWEN', 'Owen', 'R_OWN'),
      person('S_FLO', 'Flo', 'R_FORCE_FLOOR', { floor_ids: ['F1'] }),
    ],
  };
}

// F1: T1–T4; F2: T5–T8. T9 is archived (absent from the config).
function installConfig(): void {
  const floor = (floor_id: string, ids: string[]) => ({ floor_id, tables: ids.map((table_id) => ({ table_id, zone_id: null })) });
  const config = { floors: [floor('F1', ['T1', 'T2', 'T3', 'T4']), floor('F2', ['T5', 'T6', 'T7', 'T8'])] } as unknown as BranchConfig;
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
}

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  installConfig();
  // The repo's pattern (set-presence.int.test.ts countHandle): count the statements of each `handle` call.
  const def = commandRegistry(hub.app).byPath('split-seating') as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      handlerReads.count = counter.count;
    }
  };
});

afterEach(async () => {
  resetMergeGuard();
  swapBranchConfig(null);
  await hub.close();
});

function append(draft: Omit<EventDraft, 'schema_version' | 'occurred_at'>): void {
  hub.deps.writer.run((tx) => tx.append([{ ...draft, schema_version: 1, occurred_at: hub.clock.branchNow() }]));
}

const SEED_DEVICE = 'DEV_SEED';

function opened(table_id: string, seating_id: string, holder: string): void {
  append({
    stream_type: 'table',
    stream_id: table_id,
    event_type: 'TableOpened',
    payload: { table_id, seating_id, holder_staff_id: holder, party_size: 2 },
    actor_id: holder,
    device_id: SEED_DEVICE,
  });
}

function locked(table_id: string, seating_id: string, staff_id: string, device_id: string): void {
  append({
    stream_type: 'table',
    stream_id: table_id,
    event_type: 'TableLocked',
    payload: { table_id, seating_id, staff_id },
    actor_id: staff_id,
    device_id,
  });
}

function placed(order_id: string, seating_id: string, by = 'S_ALI'): void {
  append({
    stream_type: 'order',
    stream_id: order_id,
    event_type: 'OrderPlaced',
    payload: {
      order_id,
      order_type: 'dine_in',
      table_id: null,
      table_key: `dine_in:${seating_id}`,
      follow_up: false,
      pickup_at_ms: null,
      order_item_ids: [`${order_id}-L1`],
      groups: [{ group_id: `${order_id}:0`, target_land_ms: 1, promise_ms: 2, order_item_ids: [`${order_id}-L1`] }],
      lines: [],
    },
    actor_id: by,
    device_id: SEED_DEVICE,
  });
}

function tableEvent(table_id: string, event_type: string, payload: Record<string, unknown>, by = 'S_ALI'): void {
  append({ stream_type: 'table', stream_id: table_id, event_type, payload, actor_id: by, device_id: SEED_DEVICE });
}

function joined(into_table_id: string, into_seating_id: string, table_id: string): void {
  tableEvent(into_table_id, 'TablesMerged', {
    into_seating_id,
    into_table_id,
    table_ids: [table_id],
    absorbed_seating_id: null,
    order_ids: [],
    by_staff_id: 'S_ALI',
  });
}

function needsCleaning(table_id: string, seating_id: string, order_id: string): void {
  placed(order_id, seating_id);
  tableEvent(table_id, 'BillClosed', { seating_id });
}

function eventTypesAll(): string[] {
  return hub.deps.db.prepare('SELECT event_type FROM events ORDER BY seq').pluck().all() as string[];
}

// Measured (as task 14): one alerts.close = 7 statements (the alert read, AlertClosed, and the request_result raise).
const CLOSE = 7;

function eventCount(): number {
  return hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number;
}

interface Who {
  staffId: string;
  deviceId: string;
  token: string;
  sessionToken: string;
}

function signIn(staffId: string): Who {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionToken: session.token };
}

let commandSeq = 0;

// A real pending handover through the RequestTableHandover command; the receiver needs a live session.
async function requestHandover(who: Who, table_id: string, seating_id: string, to_staff_id: string): Promise<string> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/request-table-handover',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: `cmd-handover-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'RequestTableHandover',
      payload: { table_id, seating_id, to_staff_id },
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { data: { result: { alert_id: string } } }).data.result.alert_id;
}

function alertState(alert_id: string): unknown {
  return hub.deps.db.prepare('SELECT state, close_reason FROM alerts WHERE alert_id = ?').get(alert_id);
}

function closedPayloads(): Array<Record<string, unknown>> {
  return (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'AlertClosed' ORDER BY seq`).pluck().all() as string[]).map(
    (j) => JSON.parse(j) as Record<string, unknown>,
  );
}

function resultPayloads(): Array<Record<string, unknown>> {
  return (hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'AlertRaised' ORDER BY seq`).pluck().all() as string[])
    .map((j) => JSON.parse(j) as Record<string, unknown>)
    .filter((a) => a.kind === 'request_result');
}

function cancelled(order_id: string): void {
  append({ stream_type: 'order', stream_id: order_id, event_type: 'OrderCancelled', payload: { order_id }, actor_id: 'S_ALI', device_id: SEED_DEVICE });
}

interface Res {
  status: number;
  body: {
    data?: { command_id: string; event_ids: string[]; result: { new_seating_id: string | null } };
    error?: { code: string; details: Record<string, unknown> };
  };
  statements: number;
  eventTypes: string[];
}

async function split(who: Who, payload: Record<string, unknown>, o: { commandId?: string } = {}): Promise<Res> {
  commandSeq += 1;
  handlerReads.count = -1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/split-seating',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: o.commandId ?? `cmd-split-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'SplitSeating',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const raw = res.json() as Res['body'];
  const body: Res['body'] = raw.error === undefined ? raw : { error: { code: raw.error.code, details: raw.error.details } };
  const eventTypes =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare('SELECT event_type FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq')
            .all(JSON.stringify(body.data.event_ids)) as Array<{ event_type: string }>
        ).map((r) => r.event_type);
  return { status: res.statusCode, body, statements: handlerReads.count, eventTypes };
}

const sp = (from_table_id: string, seating_id: string, to_table_id: string, order_ids: string[]) => ({
  from_table_id,
  seating_id,
  to_table_id,
  order_ids,
});

function seatingRow(seating_id: string): Record<string, unknown> | undefined {
  return hub.deps.db
    .prepare('SELECT state, holder_staff_id, primary_table_id, close_reason FROM seatings WHERE seating_id = ?')
    .get(seating_id) as Record<string, unknown> | undefined;
}

function tablesOf(seating_id: string): string[] {
  return hub.deps.db.prepare('SELECT table_id FROM seating_tables WHERE seating_id = ? ORDER BY table_id').pluck().all(seating_id) as string[];
}

function ordersOf(seating_id: string): string[] {
  return hub.deps.db.prepare('SELECT order_id FROM seating_orders WHERE seating_id = ? ORDER BY order_id').pluck().all(seating_id) as string[];
}

function seatingOfTable(table_id: string): string | undefined {
  return hub.deps.db.prepare('SELECT seating_id FROM seating_tables WHERE table_id = ?').pluck().get(table_id) as string | undefined;
}

function lockRows(): unknown[] {
  return hub.deps.db.prepare('SELECT table_id, seating_id, staff_id, device_id FROM table_locks ORDER BY table_id').all();
}

function splitEvent(): Record<string, unknown> {
  const row = hub.deps.db
    .prepare(`SELECT stream_type, stream_id, actor_id, device_id, payload FROM events WHERE event_type = 'SeatingSplit' ORDER BY seq DESC LIMIT 1`)
    .get() as { stream_type: string; stream_id: string; actor_id: string; device_id: string; payload: string };
  return { ...row, payload: JSON.parse(row.payload) as unknown };
}

describe('02a SplitSeating (§3.12, §6.11)', () => {
  it('[02a #28] split orders to a FREE table → new seating with those whole orders, same holder; lock stays on S', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    placed('O3', 'SEAT1');
    locked('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O3', 'O2']));
    expect(r.status).toBe(200);
    const newId = r.body.data?.result.new_seating_id;
    expect(typeof newId).toBe('string');
    expect(newId).toHaveLength(26); // ctx.ids (ULID-shaped)
    expect(r.eventTypes).toEqual(['SeatingSplit']);
    expect(splitEvent()).toEqual({
      stream_type: 'table',
      stream_id: 'T1',
      actor_id: 'S_ALI',
      device_id: ali.deviceId,
      payload: { from_seating_id: 'SEAT1', new_seating_id: newId, to_table_id: 'T3', order_ids: ['O3', 'O2'], by_staff_id: 'S_ALI' },
    });
    expect(seatingRow(newId!)).toMatchObject({ primary_table_id: 'T3', holder_staff_id: 'S_ALI', state: 'ORDERED' });
    expect(ordersOf(newId!)).toEqual(['O2', 'O3']);
    expect(ordersOf('SEAT1')).toEqual(['O1']);
    expect(tablesOf(newId!)).toEqual(['T3']);
    expect(tablesOf('SEAT1')).toEqual(['T1']);
    expect(seatingRow('SEAT1')).toMatchObject({ primary_table_id: 'T1', holder_staff_id: 'S_ALI', state: 'ORDERED' });
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
    expect(currentTableOf(hub.deps.db, ['O2']).get('O2')).toEqual({ seating_id: newId, primary_table_id: 'T3', table_ids: ['T3'] });
    // 3 reads (S + lock, target, S's live orders) + 1 byDedupeKey; nothing pending → no close statements
    expect(r.statements).toBe(4);
    expect(eventTypesAll().filter((t) => t.startsWith('Alert'))).toEqual([]);
  });

  it('[02a #28] target assigned to someone other than the caller without force → 403 other_owner; with force → split, holder = S\'s holder', async () => {
    const ali = signIn('S_ALI');
    const mgr = signIn('S_BOSS');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const denied = await split(ali, sp('T1', 'SEAT1', 'T5', ['O2']));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA', holder_staff_id: 'S_ALI' },
    });
    expect(denied.eventTypes).toEqual([]);
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2']);
    const ok = await split(mgr, sp('T1', 'SEAT1', 'T5', ['O2']));
    expect(ok.status).toBe(200);
    const newId = ok.body.data!.result.new_seating_id!;
    expect(seatingRow(newId)).toMatchObject({ primary_table_id: 'T5', holder_staff_id: 'S_ALI' });
    expect((splitEvent().payload as { by_staff_id: string }).by_staff_id).toBe('S_BOSS');
  });

  it("[02a #28] a target assigned to the caller, or to nobody, needs no force", async () => {
    const bilal = signIn('S_BILAL');
    opened('T1', 'SEAT1', 'S_BILAL');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    placed('O3', 'SEAT1');
    expect((await split(bilal, sp('T1', 'SEAT1', 'T6', ['O2']))).status).toBe(200);
    expect((await split(bilal, sp('T1', 'SEAT1', 'T2', ['O3']))).status).toBe(200);
  });

  it('[02a #28] lock on S by another staff, or by the caller\'s other device → 409 TABLE_ALREADY_LOCKED; (caller, this device) passes', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    locked('T1', 'SEAT1', 'S_BILAL', 'DEV_B');
    const other = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(other.status).toBe(409);
    expect(other.body.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_BILAL', locked_by_name: 'Bilal' },
    });
    expect(other.eventTypes).toEqual([]);
    locked('T1', 'SEAT1', 'S_ALI', 'DEV_OLD');
    const own = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(own.body.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_ALI', locked_by_name: 'Ali' },
    });
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2']);
    locked('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    expect((await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']))).status).toBe(200);
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it('[02a #28 handover] pending handover of S closed obsolete: AlertClosed + request_result to the sender; 3 + 1 + close bound', async () => {
    const ali = signIn('S_ALI');
    signIn('S_SARA');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const a1 = await requestHandover(ali, 'T1', 'SEAT1', 'S_SARA');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(r.status).toBe(200);
    expect(r.eventTypes).toEqual(['SeatingSplit', 'AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(closedPayloads()).toEqual([{ alert_id: a1, reason: 'obsolete', by_staff_id: 'S_ALI', note: 'split: T3 from T1' }]);
    expect(resultPayloads()).toHaveLength(1);
    expect(resultPayloads()[0]).toMatchObject({
      kind: 'request_result',
      target: { kind: 'person', staff_id: 'S_ALI' },
      values: { request_alert_id: a1, close_reason: 'obsolete' },
    });
    expect(alertState(a1)).toEqual({ state: 'closed', close_reason: 'obsolete' });
    expect(r.statements).toBe(4 + CLOSE);
  });

  it('[02a #28 handover] a refused split closes nothing', async () => {
    const ali = signIn('S_ALI');
    signIn('S_SARA');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    const a1 = await requestHandover(ali, 'T1', 'SEAT1', 'S_SARA');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O1']));
    expect(r.body.error?.code).toBe('SPLIT_INVALID');
    expect(alertState(a1)).toEqual({ state: 'open', close_reason: null });
  });

  it('[02a §3.12] split orders to a joined table of S (not the primary) → the table leaves S and holds the new seating', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    joined('T1', 'SEAT1', 'T2');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T2', ['O2']));
    expect(r.status).toBe(200);
    const newId = r.body.data!.result.new_seating_id!;
    expect(tablesOf('SEAT1')).toEqual(['T1']);
    expect(tablesOf(newId)).toEqual(['T2']);
    expect(ordersOf(newId)).toEqual(['O2']);
    expect(seatingRow(newId)).toMatchObject({ primary_table_id: 'T2', holder_staff_id: 'S_ALI' });
  });

  it('[02a #29] detach a joined table with no orders → the table is FREE, no new seating; S keeps its orders and lock', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    joined('T1', 'SEAT1', 'T2');
    placed('O1', 'SEAT1');
    locked('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    const calls: unknown[] = [];
    registerMergeGuard((_db, q) => {
      calls.push(q);
      return { blocked: true, order_item_ids: ['X'] };
    });
    const r = await split(ali, sp('T1', 'SEAT1', 'T2', []));
    expect(r.status).toBe(200);
    expect(r.body.data?.result).toEqual({ new_seating_id: null });
    expect(r.eventTypes).toEqual(['SeatingSplit']);
    expect(splitEvent().payload).toEqual({ from_seating_id: 'SEAT1', new_seating_id: null, to_table_id: 'T2', order_ids: [], by_staff_id: 'S_ALI' });
    expect(seatingOfTable('T2')).toBeUndefined();
    expect(tablesOf('SEAT1')).toEqual(['T1']);
    expect(ordersOf('SEAT1')).toEqual(['O1']);
    expect(hub.deps.db.prepare(`SELECT COUNT(*) FROM seatings WHERE state <> 'CLOSED'`).pluck().get()).toBe(1);
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
    // no order moves: the 04 guard is not asked
    expect(calls).toEqual([]);
    // 2 reads (S + lock, target) + 1 byDedupeKey
    expect(r.statements).toBe(3);
  });

  it('[02a #29] detaching a joined table assigned to someone else lands no party: no force needed; its pending handover is closed', async () => {
    const ali = signIn('S_ALI');
    signIn('S_NOOR');
    opened('T1', 'SEAT1', 'S_ALI');
    joined('T1', 'SEAT1', 'T5');
    const a1 = await requestHandover(ali, 'T1', 'SEAT1', 'S_NOOR');
    const r = await split(ali, sp('T1', 'SEAT1', 'T5', []));
    expect(r.status).toBe(200);
    expect(r.eventTypes).toEqual(['SeatingSplit', 'AlertClosed', 'AlertRaised', 'AttemptSent']);
    expect(alertState(a1)).toEqual({ state: 'closed', close_reason: 'obsolete' });
    expect(r.statements).toBe(3 + CLOSE);
    expect(seatingOfTable('T5')).toBeUndefined();
  });

  it('[02a #30] split all live orders → 409 SPLIT_INVALID all_orders (cancelled ones stay and do not count)', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    placed('O3', 'SEAT1');
    cancelled('O3');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2', 'O1']));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'SPLIT_INVALID', details: { reason: 'all_orders' } });
    expect(r.eventTypes).toEqual([]);
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2', 'O3']);
    expect(seatingOfTable('T3')).toBeUndefined();
  });

  it('[02a #30] foreign orders (another seating\'s, unknown, or a cancelled one of S) → 409 SPLIT_INVALID not_in_seating { order_ids }', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    placed('O3', 'SEAT1');
    cancelled('O3');
    opened('T2', 'SEAT2', 'S_ALI');
    placed('O9', 'SEAT2');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O1', 'O9', 'OX', 'O3']));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'SPLIT_INVALID', details: { reason: 'not_in_seating', order_ids: ['O9', 'OX', 'O3'] } });
    expect(ordersOf('SEAT2')).toEqual(['O9']);
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2', 'O3']);
  });

  it('[02a #30] no orders to a FREE table, or to S\'s primary → 409 SPLIT_INVALID empty / TABLE_NOT_FREE', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', []));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'SPLIT_INVALID', details: { reason: 'empty' } });
    // the primary is never a split target (with or without orders)
    joined('T1', 'SEAT1', 'T2');
    expect((await split(ali, sp('T2', 'SEAT1', 'T1', []))).body.error).toEqual({ code: 'TABLE_NOT_FREE', details: { table_id: 'T1' } });
    expect((await split(ali, sp('T1', 'SEAT1', 'T1', ['O1']))).body.error).toEqual({ code: 'TABLE_NOT_FREE', details: { table_id: 'T1' } });
    expect(tablesOf('SEAT1')).toEqual(['T1', 'T2']);
  });

  it('[02a #51] holdersOfOrders gives one holder per order after a split and a handover of one part', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    const newId = r.body.data!.result.new_seating_id!;
    expect(holdersOfOrders(hub.deps.db, ['O1', 'O2'])).toEqual(new Map([['O1', 'S_ALI'], ['O2', 'S_ALI']]));
    // the split-off part is handed over to Sara (its real event)
    tableEvent('T3', 'TableHolderChanged', {
      table_id: 'T3',
      seating_id: newId,
      from_staff_id: 'S_ALI',
      to_staff_id: 'S_SARA',
      reason: 'handover',
      by_staff_id: 'S_SARA',
    });
    const holders = holdersOfOrders(hub.deps.db, ['O1', 'O2']);
    expect(holders.size).toBe(2);
    expect(holders).toEqual(new Map([['O1', 'S_ALI'], ['O2', 'S_SARA']]));
  });

  it('[02a §6.11] target with another seating → 409 TABLE_NOT_FREE { table_id }', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    opened('T2', 'SEAT2', 'S_ALI');
    const r = await split(ali, sp('T1', 'SEAT1', 'T2', ['O2']));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'TABLE_NOT_FREE', details: { table_id: 'T2' } });
    expect((await split(ali, sp('T1', 'SEAT1', 'T2', []))).body.error?.code).toBe('TABLE_NOT_FREE');
    expect(ordersOf('SEAT2')).toEqual([]);
  });

  it('[02a §3.14] archived or unknown FREE target → 404 TABLE_NOT_FOUND { table_id }; no config → fail closed', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T9', ['O2']));
    expect(r.status).toBe(404);
    expect(r.body.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id: 'T9' } });
    swapBranchConfig(null);
    expect((await split(ali, sp('T1', 'SEAT1', 'T2', ['O2']))).body.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id: 'T2' } });
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2']);
  });

  it('[02a §3.14] an archived joined table of S is found through seating_tables and can be detached', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    joined('T1', 'SEAT1', 'T9');
    expect((await split(ali, sp('T1', 'SEAT1', 'T9', []))).status).toBe(200);
    expect(tablesOf('SEAT1')).toEqual(['T1']);
  });

  it('[02a §6.11] stale seating_id, or a from table with no seating → 409 TABLE_SEATING_CHANGED { table_id, seating_id }', async () => {
    const ali = signIn('S_ALI');
    const none = await split(ali, sp('T1', 'SEAT_GONE', 'T3', ['O1']));
    expect(none.status).toBe(409);
    expect(none.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_GONE' } });
    expect(none.statements).toBe(1);
    opened('T1', 'SEAT_NEW', 'S_ALI');
    placed('O1', 'SEAT_NEW');
    const stale = await split(ali, sp('T1', 'SEAT_OLD', 'T3', ['O1']));
    expect(stale.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
  });

  it('[02a §6.11] NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING { table_id }', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O2', 'SEAT1');
    needsCleaning('T1', 'SEAT1', 'O1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
  });

  it('[02a §6.11] blocked by the 04 guard stub → 409 MERGE_BLOCKED_BY_VOID; the guard gets { seating_ids: [S], order_ids }', async () => {
    const ali = signIn('S_ALI');
    const calls: Array<Parameters<MergeGuard>[1]> = [];
    registerMergeGuard((_db, q) => {
      calls.push(q);
      return { blocked: true, order_item_ids: ['O2-L1'] };
    });
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'MERGE_BLOCKED_BY_VOID', details: { order_item_ids: ['O2-L1'] } });
    expect(calls).toEqual([{ seating_ids: ['SEAT1'], order_ids: ['O2'] }]);
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2']);
  });

  it('[02a §6.11] guard not blocking → split; 3 reads + the guard (its own statements) + 1 byDedupeKey', async () => {
    const ali = signIn('S_ALI');
    registerMergeGuard((db) => {
      db.prepare('SELECT 1').get();
      return { blocked: false, order_item_ids: [] };
    });
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const r = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(r.status).toBe(200);
    expect(r.statements).toBe(3 + 1 + 1);
  });

  it('[02a §6.11] non-holder without force → 403 not_holder; with force → split, holder stays', async () => {
    const noor = signIn('S_NOOR');
    const mgr = signIn('S_BOSS');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const denied = await split(noor, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'not_holder', table_id: 'T1', assigned_staff_id: null, holder_staff_id: 'S_ALI' },
    });
    expect(denied.statements).toBe(1);
    const ok = await split(mgr, sp('T1', 'SEAT1', 'T3', ['O2']));
    expect(ok.status).toBe(200);
    expect(seatingRow(ok.body.data!.result.new_seating_id!)).toMatchObject({ holder_staff_id: 'S_ALI' });
    expect(seatingRow('SEAT1')).toMatchObject({ holder_staff_id: 'S_ALI' });
  });

  it('[02a §3.15] requires_approval force grant counts as denied → 403 other_owner', async () => {
    const m = signIn('S_BOSS_APPR');
    opened('T1', 'SEAT1', 'S_BOSS_APPR');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const r = await split(m, sp('T1', 'SEAT1', 'T5', ['O2']));
    expect(r.status).toBe(403);
    expect(r.body.error?.details).toMatchObject({ reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA' });
  });

  it('[02a §6.11] payload: order_ids a set (C1) of ≤ 50; strict; required fields → VALIDATION_FAILED', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    expect((await split(ali, sp('T1', 'SEAT1', 'T3', ['O2', 'O2']))).body.error?.code).toBe('VALIDATION_FAILED');
    const many = Array.from({ length: 51 }, (_, i) => `O${i + 10}`);
    expect((await split(ali, sp('T1', 'SEAT1', 'T3', many))).body.error?.code).toBe('VALIDATION_FAILED');
    // 50 passes validation (then every id is foreign)
    expect((await split(ali, sp('T1', 'SEAT1', 'T3', many.slice(0, 50)))).body.error?.code).toBe('SPLIT_INVALID');
    expect((await split(ali, { ...sp('T1', 'SEAT1', 'T3', ['O2']), extra: 1 })).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await split(ali, { from_table_id: 'T1', seating_id: 'SEAT1', to_table_id: 'T3' })).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await split(ali, sp('T1', 'SEAT1', 'T3', ['']))).body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('[02a §6.11] scope over the from and to tables (C8): take-order my_floors, target on another floor → 403 outside_scope { table_ids }', async () => {
    const zain = signIn('S_ZAIN');
    opened('T1', 'SEAT1', 'S_ZAIN');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    placed('O3', 'SEAT1');
    const out = await split(zain, sp('T1', 'SEAT1', 'T7', ['O2']));
    expect(out.status).toBe(403);
    expect(out.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T7'] } });
    // the from table on another floor (S seated there)
    opened('T8', 'SEAT8', 'S_ZAIN');
    placed('O8', 'SEAT8');
    placed('O9', 'SEAT8');
    const from = await split(zain, sp('T8', 'SEAT8', 'T2', ['O9']));
    expect(from.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T8'] } });
    expect(ordersOf('SEAT8')).toEqual(['O8', 'O9']);
    expect((await split(zain, sp('T1', 'SEAT1', 'T3', ['O2']))).status).toBe(200);
  });

  it("[02a §6.11] scope own_tables: the caller's own seating and the target it lands on are covered", async () => {
    const owen = signIn('S_OWEN');
    opened('T1', 'SEAT1', 'S_OWEN');
    joined('T1', 'SEAT1', 'T2');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    expect((await split(owen, sp('T1', 'SEAT1', 'T3', ['O2']))).status).toBe(200);
    expect((await split(owen, sp('T1', 'SEAT1', 'T2', []))).status).toBe(200);
  });

  it('[02a §6.11] scope of the force grant (my_floors) over both tables; scope is checked last', async () => {
    const flo = signIn('S_FLO');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const out = await split(flo, sp('T1', 'SEAT1', 'T6', ['O2']));
    expect(out.status).toBe(403);
    expect(out.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T6'] } });
    // scope last: other_owner, SPLIT_INVALID, the lock and the 04 guard each win over outside_scope
    const zain = signIn('S_ZAIN');
    opened('T2', 'SEAT2', 'S_ZAIN');
    placed('O3', 'SEAT2');
    placed('O4', 'SEAT2');
    expect((await split(zain, sp('T2', 'SEAT2', 'T5', ['O4']))).body.error?.details).toMatchObject({ reason: 'other_owner' });
    expect((await split(zain, sp('T2', 'SEAT2', 'T7', ['O3', 'O4']))).body.error?.code).toBe('SPLIT_INVALID');
    registerMergeGuard(() => ({ blocked: true, order_item_ids: ['L'] }));
    expect((await split(zain, sp('T2', 'SEAT2', 'T7', ['O4']))).body.error?.code).toBe('MERGE_BLOCKED_BY_VOID');
    resetMergeGuard();
    locked('T2', 'SEAT2', 'S_BILAL', 'DEV_B');
    expect((await split(zain, sp('T2', 'SEAT2', 'T7', ['O4']))).body.error?.code).toBe('TABLE_ALREADY_LOCKED');
    expect((await split(flo, sp('T1', 'SEAT1', 'T3', ['O2']))).status).toBe(200);
  });

  it('[02a §6.11] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    placed('O2', 'SEAT1');
    const first = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']), { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const events = eventCount();
    const again = await split(ali, sp('T1', 'SEAT1', 'T3', ['O2']), { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(events);
  });
});
