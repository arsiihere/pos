import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { MergeGuard } from '../../src/tables/contracts';
import { registerMergeGuard, resetMergeGuard } from '../../src/tables/merge-guard';
import { currentTableOf } from '../../src/tables/reads';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §3.11 / §6.10 MergeTables and §4.1 row 04 (registerMergeGuard); tests #24–#27, #54, #54b; §10 preamble.
// Seatings, locks, holders and orders are seeded with real events appended through the writer (TableOpened,
// TableLocked, TableHolderChanged, OrderPlaced, BillClosed, BillRequested); no other lane's command is called.

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
  const def = commandRegistry(hub.app).byPath('merge-tables') as CommandDef;
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

interface Res {
  status: number;
  body: {
    data?: { command_id: string; event_ids: string[]; result: { seating_id: string; table_ids: string[] } };
    error?: { code: string; details: Record<string, unknown> };
  };
  statements: number;
  eventTypes: string[];
}

async function merge(who: Who, payload: Record<string, unknown>, o: { commandId?: string } = {}): Promise<Res> {
  commandSeq += 1;
  handlerReads.count = -1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/merge-tables',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: o.commandId ?? `cmd-merge-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'MergeTables',
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

const mg = (into_table_id: string, into_seating_id: string, table_id: string, table_seating_id: string | null) => ({
  into_table_id,
  into_seating_id,
  table_id,
  table_seating_id,
});

function seatingRow(seating_id: string): Record<string, unknown> {
  return hub.deps.db
    .prepare('SELECT state, holder_staff_id, primary_table_id, close_reason, bill_requested_at FROM seatings WHERE seating_id = ?')
    .get(seating_id) as Record<string, unknown>;
}

function tablesOf(seating_id: string): string[] {
  return hub.deps.db.prepare('SELECT table_id FROM seating_tables WHERE seating_id = ? ORDER BY table_id').pluck().all(seating_id) as string[];
}

function ordersOf(seating_id: string): string[] {
  return hub.deps.db.prepare('SELECT order_id FROM seating_orders WHERE seating_id = ? ORDER BY order_id').pluck().all(seating_id) as string[];
}

function lockRows(): unknown[] {
  return hub.deps.db.prepare('SELECT table_id, seating_id, staff_id, device_id FROM table_locks ORDER BY table_id').all();
}

function mergedPayload(): Record<string, unknown> {
  const row = hub.deps.db
    .prepare(`SELECT stream_type, stream_id, actor_id, device_id, payload FROM events WHERE event_type = 'TablesMerged' ORDER BY seq DESC LIMIT 1`)
    .get() as { stream_type: string; stream_id: string; actor_id: string; device_id: string; payload: string };
  return { ...row, payload: JSON.parse(row.payload) as unknown };
}

describe('02a MergeTables (§3.11, §6.10)', () => {
  it('[02a #24] merge a FREE table → joins the seating ("T4 + T5"); TablesMerged on the into table; 2 reads, no guard registered', async () => {
    const ali = signIn('S_ALI');
    opened('T4', 'SEAT1', 'S_ALI');
    locked('T4', 'SEAT1', 'S_ALI', ali.deviceId);
    const r = await merge(ali, mg('T4', 'SEAT1', 'T7', null));
    expect(r.status).toBe(200);
    expect(r.body.data?.result).toEqual({ seating_id: 'SEAT1', table_ids: ['T4', 'T7'] });
    expect(r.eventTypes).toEqual(['TablesMerged']);
    expect(mergedPayload()).toEqual({
      stream_type: 'table',
      stream_id: 'T4',
      actor_id: 'S_ALI',
      device_id: ali.deviceId,
      payload: {
        into_seating_id: 'SEAT1',
        into_table_id: 'T4',
        table_ids: ['T7'],
        absorbed_seating_id: null,
        order_ids: [],
        by_staff_id: 'S_ALI',
      },
    });
    expect(tablesOf('SEAT1')).toEqual(['T4', 'T7']);
    expect(seatingRow('SEAT1')).toMatchObject({ primary_table_id: 'T4', holder_staff_id: 'S_ALI' });
    // the lock stays on S (merge takes no lock)
    expect(lockRows()).toMatchObject([{ table_id: 'T4', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
    expect(r.statements).toBe(2);
  });

  it('[02a #25] merge absorbing own seating → orders move, absorbed CLOSED `merged`, its lock gone; S keeps holder and primary; 3 reads', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    opened('T2', 'SEAT2', 'S_ALI');
    placed('O2', 'SEAT2');
    placed('O3', 'SEAT2');
    locked('T2', 'SEAT2', 'S_ALI', ali.deviceId);
    const r = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(r.status).toBe(200);
    expect(r.body.data?.result).toEqual({ seating_id: 'SEAT1', table_ids: ['T1', 'T2'] });
    expect(mergedPayload().payload).toEqual({
      into_seating_id: 'SEAT1',
      into_table_id: 'T1',
      table_ids: ['T2'],
      absorbed_seating_id: 'SEAT2',
      order_ids: ['O2', 'O3'],
      by_staff_id: 'S_ALI',
    });
    expect(ordersOf('SEAT1')).toEqual(['O1', 'O2', 'O3']);
    expect(ordersOf('SEAT2')).toEqual([]);
    expect(tablesOf('SEAT1')).toEqual(['T1', 'T2']);
    expect(seatingRow('SEAT2')).toMatchObject({ state: 'CLOSED', close_reason: 'merged' });
    expect(seatingRow('SEAT1')).toMatchObject({ primary_table_id: 'T1', holder_staff_id: 'S_ALI', state: 'ORDERED' });
    expect(lockRows()).toEqual([]);
    expect(currentTableOf(hub.deps.db, ['O2']).get('O2')).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T1', table_ids: ['T1', 'T2'] });
    expect(r.statements).toBe(3);
  });

  it.todo('[02a #25 handover] both pending handovers closed obsolete — after task 12');

  it('[02a §3.11] absorbing a merged seating moves all of its tables; result lists every table of S', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    joined('T2', 'SEAT2', 'T3');
    // naming S2 by its joined table absorbs the whole seating
    const r = await merge(ali, mg('T1', 'SEAT1', 'T3', 'SEAT2'));
    expect(r.status).toBe(200);
    expect(r.body.data?.result).toEqual({ seating_id: 'SEAT1', table_ids: ['T1', 'T2', 'T3'] });
    expect((mergedPayload().payload as { table_ids: string[] }).table_ids).toEqual(['T2', 'T3']);
    expect(tablesOf('SEAT1')).toEqual(['T1', 'T2', 'T3']);
    expect(tablesOf('SEAT2')).toEqual([]);
  });

  it('[02a §3.1] bill_requested_at of S cleared when S2 brings an order; kept when S2 has none', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    placed('O1', 'SEAT1');
    tableEvent('T1', 'BillRequested', { seating_id: 'SEAT1', table_id: 'T1', by_staff_id: 'S_ALI' });
    opened('T2', 'SEAT2', 'S_ALI');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'))).status).toBe(200);
    expect(seatingRow('SEAT1')).toMatchObject({ state: 'BILL_REQUESTED' });
    opened('T3', 'SEAT3', 'S_ALI');
    placed('O3', 'SEAT3');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T3', 'SEAT3'))).status).toBe(200);
    expect(seatingRow('SEAT1')).toMatchObject({ state: 'ORDERED', bill_requested_at: null });
  });

  it("[02a #26] absorbing another holder's seating without force → 403 other_owner; with force → merged", async () => {
    const ali = signIn('S_ALI');
    const mgr = signIn('S_BOSS');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_NOOR');
    placed('O2', 'SEAT2', 'S_NOOR');
    const denied = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'other_owner', table_id: 'T2', assigned_staff_id: null, holder_staff_id: 'S_NOOR' },
    });
    expect(denied.eventTypes).toEqual([]);
    expect(ordersOf('SEAT2')).toEqual(['O2']);
    // a force holder merges (S's holder stays Ali)
    const ok = await merge(mgr, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(ok.status).toBe(200);
    expect(ordersOf('SEAT1')).toEqual(['O2']);
    expect(seatingRow('SEAT1')).toMatchObject({ holder_staff_id: 'S_ALI' });
    expect(seatingRow('SEAT2')).toMatchObject({ state: 'CLOSED', close_reason: 'merged' });
  });

  it('[02a #27] blocked by the 04 guard stub → 409 MERGE_BLOCKED_BY_VOID { order_item_ids }; the guard gets { seating_ids: [S, S2] }', async () => {
    const ali = signIn('S_ALI');
    const calls: Array<Parameters<MergeGuard>[1]> = [];
    registerMergeGuard((_db, q) => {
      calls.push(q);
      return { blocked: true, order_item_ids: ['O2-L1'] };
    });
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    placed('O2', 'SEAT2');
    const r = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'MERGE_BLOCKED_BY_VOID', details: { order_item_ids: ['O2-L1'] } });
    expect(calls).toEqual([{ seating_ids: ['SEAT1', 'SEAT2'] }]);
    expect(ordersOf('SEAT2')).toEqual(['O2']);
    // a join asks about S only
    calls.length = 0;
    expect((await merge(ali, mg('T1', 'SEAT1', 'T3', null))).body.error?.code).toBe('MERGE_BLOCKED_BY_VOID');
    expect(calls).toEqual([{ seating_ids: ['SEAT1'] }]);
  });

  it('[02a #27] guard not blocking → merged; 3 reads + the guard (its own statements are the guard\'s)', async () => {
    const ali = signIn('S_ALI');
    registerMergeGuard((db) => {
      db.prepare('SELECT 1').get();
      return { blocked: false, order_item_ids: [] };
    });
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    const r = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(r.status).toBe(200);
    expect(r.statements).toBe(3 + 1);
  });

  it('[02a #27] unregistered guard → never blocked; resetMergeGuard removes a stub', async () => {
    const ali = signIn('S_ALI');
    registerMergeGuard(() => ({ blocked: true, order_item_ids: ['X'] }));
    resetMergeGuard();
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'))).status).toBe(200);
  });

  it('[02a #27] other side locked by another device → 409 TABLE_ALREADY_LOCKED { table_id, locked_by_staff_id, locked_by_name }', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    locked('T2', 'SEAT2', 'S_ALI', 'DEV_OTHER');
    const own = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(own.status).toBe(409);
    expect(own.body.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T2', locked_by_staff_id: 'S_ALI', locked_by_name: 'Ali' },
    });
    expect(own.eventTypes).toEqual([]);
    expect(seatingRow('SEAT2')).toMatchObject({ state: 'SEATED' });
  });

  it('[02a §6.10] a lock on S by another staff, or by the caller\'s other device → 409 TABLE_ALREADY_LOCKED (into table)', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    locked('T1', 'SEAT1', 'S_BILAL', 'DEV_B');
    const other = await merge(ali, mg('T1', 'SEAT1', 'T3', null));
    expect(other.status).toBe(409);
    expect(other.body.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_BILAL', locked_by_name: 'Bilal' },
    });
    locked('T1', 'SEAT1', 'S_ALI', 'DEV_OLD');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T3', null))).body.error?.code).toBe('TABLE_ALREADY_LOCKED');
    // a lock by (caller, this device) on either side passes
    locked('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    opened('T2', 'SEAT2', 'S_ALI');
    locked('T2', 'SEAT2', 'S_ALI', ali.deviceId);
    expect((await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'))).status).toBe(200);
    expect(lockRows()).toMatchObject([{ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it("[02a #54] Bilal opens Sara's FREE T5, then absorbs T3 into it without force → 403 other_owner", async () => {
    const bilal = signIn('S_BILAL');
    opened('T5', 'SEAT5', 'S_BILAL');
    opened('T3', 'SEAT3', 'S_BILAL');
    const r = await merge(bilal, mg('T5', 'SEAT5', 'T3', 'SEAT3'));
    expect(r.status).toBe(403);
    expect(r.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA', holder_staff_id: 'S_BILAL' },
    });
    expect(tablesOf('SEAT3')).toEqual(['T3']);
  });

  it("[02a #54b] mirror: Bilal opens Sara's FREE T5, then absorbs T5 into his T3 without force → 403; Bilal's own seatings on his or nobody's tables → pass", async () => {
    const bilal = signIn('S_BILAL');
    opened('T5', 'SEAT5', 'S_BILAL');
    opened('T3', 'SEAT3', 'S_BILAL');
    const r = await merge(bilal, mg('T3', 'SEAT3', 'T5', 'SEAT5'));
    expect(r.status).toBe(403);
    expect(r.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA', holder_staff_id: 'S_BILAL' },
    });
    // T6 is Bilal's, T4 nobody's
    opened('T6', 'SEAT6', 'S_BILAL');
    opened('T4', 'SEAT4', 'S_BILAL');
    const ok = await merge(bilal, mg('T6', 'SEAT6', 'T4', 'SEAT4'));
    expect(ok.status).toBe(200);
    expect(ok.body.data?.result).toEqual({ seating_id: 'SEAT6', table_ids: ['T6', 'T4'] });
  });

  it("[02a §3.11] joining a FREE table assigned to someone else without force → 403 other_owner (holder null); with force → joins", async () => {
    const ali = signIn('S_ALI');
    const mgr = signIn('S_BOSS');
    opened('T1', 'SEAT1', 'S_ALI');
    const r = await merge(ali, mg('T1', 'SEAT1', 'T5', null));
    expect(r.status).toBe(403);
    expect(r.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA', holder_staff_id: null },
    });
    opened('T2', 'SEAT2', 'S_BOSS');
    expect((await merge(mgr, mg('T2', 'SEAT2', 'T5', null))).status).toBe(200);
    expect(tablesOf('SEAT2')).toEqual(['T2', 'T5']);
  });

  it('[02a §3.15] requires_approval force grant counts as denied → 403 other_owner', async () => {
    const m = signIn('S_BOSS_APPR');
    opened('T1', 'SEAT1', 'S_BOSS_APPR');
    const r = await merge(m, mg('T1', 'SEAT1', 'T5', null));
    expect(r.status).toBe(403);
    expect(r.body.error?.details).toMatchObject({ reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA' });
  });

  it('[02a §6.10] non-holder of S without force → 403 not_holder; with force → merged, S keeps its holder', async () => {
    const noor = signIn('S_NOOR');
    const mgr = signIn('S_BOSS');
    opened('T1', 'SEAT1', 'S_ALI');
    const denied = await merge(noor, mg('T1', 'SEAT1', 'T2', null));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'not_holder', table_id: 'T1', assigned_staff_id: null, holder_staff_id: 'S_ALI' },
    });
    expect(denied.statements).toBe(1);
    const ok = await merge(mgr, mg('T1', 'SEAT1', 'T2', null));
    expect(ok.status).toBe(200);
    expect(seatingRow('SEAT1')).toMatchObject({ holder_staff_id: 'S_ALI' });
    expect(tablesOf('SEAT1')).toEqual(['T1', 'T2']);
  });

  it('[02a §3.14] archived or unknown FREE table → 404 TABLE_NOT_FOUND { table_id }; no config → fail closed', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    const r = await merge(ali, mg('T1', 'SEAT1', 'T9', null));
    expect(r.status).toBe(404);
    expect(r.body.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id: 'T9' } });
    swapBranchConfig(null);
    const none = await merge(ali, mg('T1', 'SEAT1', 'T2', null));
    expect(none.body.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id: 'T2' } });
    expect(tablesOf('SEAT1')).toEqual(['T1']);
  });

  it('[02a §3.14] an archived table that still has a seating is absorbed (found through seating_tables)', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T9', 'SEAT9', 'S_ALI');
    const r = await merge(ali, mg('T1', 'SEAT1', 'T9', 'SEAT9'));
    expect(r.status).toBe(200);
    expect(tablesOf('SEAT1')).toEqual(['T1', 'T9']);
  });

  it('[02a §6.10] stale into_seating_id, or an into table with no seating → 409 TABLE_SEATING_CHANGED { table_id, seating_id }', async () => {
    const ali = signIn('S_ALI');
    const none = await merge(ali, mg('T1', 'SEAT_GONE', 'T2', null));
    expect(none.status).toBe(409);
    expect(none.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_GONE' } });
    expect(none.statements).toBe(1);
    opened('T1', 'SEAT_NEW', 'S_ALI');
    const stale = await merge(ali, mg('T1', 'SEAT_OLD', 'T2', null));
    expect(stale.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
  });

  it('[02a §6.10] other side: table_seating_id null while the table has a seating, given while FREE, or stale → 409 TABLE_SEATING_CHANGED', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    const nullGiven = await merge(ali, mg('T1', 'SEAT1', 'T2', null));
    expect(nullGiven.status).toBe(409);
    expect(nullGiven.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: null } });
    expect(nullGiven.eventTypes).toEqual([]);
    const free = await merge(ali, mg('T1', 'SEAT1', 'T3', 'SEAT3'));
    expect(free.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T3', seating_id: 'SEAT3' } });
    const stale = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT_OLD'));
    expect(stale.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: 'SEAT_OLD' } });
    // a joined table of S itself, shown as FREE: it has a seating → TABLE_SEATING_CHANGED
    joined('T1', 'SEAT1', 'T4');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T4', null))).body.error).toEqual({
      code: 'TABLE_SEATING_CHANGED',
      details: { table_id: 'T4', seating_id: null },
    });
    expect(tablesOf('SEAT2')).toEqual(['T2']);
  });

  it('[02a §6.10] NEEDS_CLEANING on either side → 409 TABLE_NEEDS_CLEANING { table_id }', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    needsCleaning('T2', 'SEAT2', 'O2');
    const other = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(other.status).toBe(409);
    expect(other.body.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T2' } });
    needsCleaning('T1', 'SEAT1', 'O1');
    const into = await merge(ali, mg('T1', 'SEAT1', 'T3', null));
    expect(into.body.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
  });

  it('[02a §6.10] the same table or seating on both sides → VALIDATION_FAILED', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    joined('T1', 'SEAT1', 'T2');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T1', 'SEAT1'))).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT1'))).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await merge(ali, mg('T1', 'SEAT1', 'T1', null))).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await merge(ali, { ...mg('T1', 'SEAT1', 'T3', null), extra: 1 })).body.error?.code).toBe('VALIDATION_FAILED');
    expect((await merge(ali, { into_table_id: 'T1', into_seating_id: 'SEAT1', table_id: 'T3' })).body.error?.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[02a §6.10] scope over all tables (C8): take-order my_floors, a table of either side on another floor → 403 outside_scope { table_ids }', async () => {
    const zain = signIn('S_ZAIN');
    opened('T1', 'SEAT1', 'S_ZAIN');
    const out = await merge(zain, mg('T1', 'SEAT1', 'T7', null));
    expect(out.status).toBe(403);
    expect(out.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T7'] } });
    // S's own joined table on another floor (seeded), and S2's tables
    opened('T2', 'SEAT2', 'S_ZAIN');
    joined('T2', 'SEAT2', 'T8');
    const s2 = await merge(zain, mg('T1', 'SEAT1', 'T2', 'SEAT2'));
    expect(s2.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T8'] } });
    const into = await merge(zain, mg('T2', 'SEAT2', 'T3', null));
    expect(into.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T8'] } });
    expect((await merge(zain, mg('T1', 'SEAT1', 'T3', null))).status).toBe(200);
  });

  it("[02a §6.10] scope own_tables: the caller's own seatings and a FREE table joining them are covered", async () => {
    const owen = signIn('S_OWEN');
    opened('T1', 'SEAT1', 'S_OWEN');
    opened('T2', 'SEAT2', 'S_OWEN');
    expect((await merge(owen, mg('T1', 'SEAT1', 'T2', 'SEAT2'))).status).toBe(200);
    expect((await merge(owen, mg('T1', 'SEAT1', 'T3', null))).status).toBe(200);
    expect(tablesOf('SEAT1')).toEqual(['T1', 'T2', 'T3']);
  });

  it('[02a §6.10] scope of the force grant (my_floors) over all tables; scope is checked last', async () => {
    const flo = signIn('S_FLO');
    opened('T1', 'SEAT1', 'S_ALI');
    const out = await merge(flo, mg('T1', 'SEAT1', 'T6', null));
    expect(out.status).toBe(403);
    expect(out.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T6'] } });
    // scope last: an earlier rule (other_owner without force; the 04 guard) wins over outside_scope
    const zain = signIn('S_ZAIN');
    opened('T2', 'SEAT2', 'S_ZAIN');
    expect((await merge(zain, mg('T2', 'SEAT2', 'T5', null))).body.error?.details).toMatchObject({ reason: 'other_owner' });
    registerMergeGuard(() => ({ blocked: true, order_item_ids: ['L'] }));
    expect((await merge(zain, mg('T2', 'SEAT2', 'T7', null))).body.error?.code).toBe('MERGE_BLOCKED_BY_VOID');
    resetMergeGuard();
    expect((await merge(flo, mg('T1', 'SEAT1', 'T3', null))).status).toBe(200);
  });

  it('[02a §6.10] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn('S_ALI');
    opened('T1', 'SEAT1', 'S_ALI');
    opened('T2', 'SEAT2', 'S_ALI');
    const first = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'), { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const events = eventCount();
    const again = await merge(ali, mg('T1', 'SEAT1', 'T2', 'SEAT2'), { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(events);
  });
});
