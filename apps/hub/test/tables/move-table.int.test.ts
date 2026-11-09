import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { statementCounter } from '../helpers/statement-counter';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { holdersOfOrders, currentTableOf } from '../../src/tables/reads';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §3.10 / §6.9 MoveTable; tests #22, #23, #42; §10 preamble. Seatings, locks and holder changes are
// seeded with SQL or real events appended through the writer; no other lane's command is called.

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
      role('R_FORCE_FLOOR', [grant('take-order', 'allowed'), grant('force-release-table-lock', 'allowed', 'my_floors')]),
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'Ali', 'R_TAKER'),
      person('S_BILAL', 'Bilal', 'R_TAKER'),
      person('S_NOOR', 'Noor', 'R_TAKER'),
      person('S_SARA', 'Sara', 'R_TAKER', { assigned_table_ids: ['T5'] }),
      person('S_BOSS', 'Manager', 'R_FORCE'),
      person('S_BOSS_APPR', 'Approval manager', 'R_FORCE_APPROVAL'),
      person('S_ZAIN', 'Zain', 'R_FLOOR', { floor_ids: ['F1'] }),
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
  const def = commandRegistry(hub.app).byPath('move-table') as CommandDef;
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
  swapBranchConfig(null);
  await hub.close();
});

function seat(seating_id: string, primary: string, holder: string, o: { tables?: string[]; state?: string; orders?: string[] } = {}): void {
  const { db } = hub.deps;
  db.prepare('INSERT INTO seatings (seating_id, primary_table_id, state, holder_staff_id, opened_at) VALUES (?, ?, ?, ?, 1)').run(
    seating_id,
    primary,
    o.state ?? 'SEATED',
    holder,
  );
  for (const t of o.tables ?? [primary]) {
    db.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, 1)').run(t, seating_id);
  }
  for (const order_id of o.orders ?? []) {
    db.prepare('INSERT INTO seating_orders (order_id, seating_id) VALUES (?, ?)').run(order_id, seating_id);
  }
}

function lock(table_id: string, seating_id: string, staff_id: string, device_id: string): void {
  hub.deps.db
    .prepare('INSERT INTO table_locks (table_id, seating_id, staff_id, device_id, locked_at, last_activity_at) VALUES (?, ?, ?, ?, 1, 1)')
    .run(table_id, seating_id, staff_id, device_id);
}

function lockRows(): unknown[] {
  return hub.deps.db.prepare('SELECT table_id, seating_id, staff_id, device_id, last_touch_at FROM table_locks ORDER BY table_id').all();
}

function append(draft: Omit<EventDraft, 'schema_version' | 'occurred_at'>): void {
  hub.deps.writer.run((tx) => tx.append([{ ...draft, schema_version: 1, occurred_at: hub.clock.branchNow() }]));
}

function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) FROM events').pluck().get() as number);
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
  body: { data?: { command_id: string; event_ids: string[]; result: { primary_table_id: string } }; error?: { code: string; details: Record<string, unknown> } };
  statements: number;
  eventTypes: string[];
}

async function move(
  who: Who,
  payload: Record<string, unknown>,
  o: { commandId?: string } = {},
): Promise<Res> {
  commandSeq += 1;
  handlerReads.count = -1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/move-table',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id: o.commandId ?? `cmd-move-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'MoveTable',
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

const mv = (seating_id: string, from_table_id: string, to_table_id: string, extra: Record<string, unknown> = {}) => ({
  from_table_id,
  seating_id,
  to_table_id,
  ...extra,
});

function primaryOf(seating_id: string): string {
  return hub.deps.db.prepare('SELECT primary_table_id FROM seatings WHERE seating_id = ?').pluck().get(seating_id) as string;
}

function tablesOf(seating_id: string): string[] {
  return hub.deps.db.prepare('SELECT table_id FROM seating_tables WHERE seating_id = ? ORDER BY table_id').pluck().all(seating_id) as string[];
}

function handedOver(table_id: string, seating_id: string, from: string, to: string, by: string, device: string): void {
  append({
    stream_type: 'table',
    stream_id: table_id,
    event_type: 'TableHolderChanged',
    payload: { table_id, seating_id, from_staff_id: from, to_staff_id: to, reason: 'handover', by_staff_id: by },
    actor_id: by,
    device_id: device,
  });
}

describe('02a MoveTable (§3.10, §6.9)', () => {
  it('[02a #22] move → seating, orders, lock follow; holder stays; result { primary_table_id }; TableMoved on the from table; 2 statements', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI', { orders: ['O1'] });
    lock('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    const r = await move(ali, mv('SEAT1', 'T1', 'T3', { reason: 'window seat' }));
    expect(r.status).toBe(200);
    expect(r.body.data?.result).toEqual({ primary_table_id: 'T3' });
    expect(r.eventTypes).toEqual(['TableMoved']);
    const ev = hub.deps.db
      .prepare(`SELECT stream_type, stream_id, actor_id, device_id, payload FROM events WHERE event_type = 'TableMoved'`)
      .get() as { stream_type: string; stream_id: string; actor_id: string; device_id: string; payload: string };
    expect(ev).toMatchObject({ stream_type: 'table', stream_id: 'T1', actor_id: 'S_ALI', device_id: ali.deviceId });
    expect(JSON.parse(ev.payload)).toEqual({ seating_id: 'SEAT1', from_table_id: 'T1', to_table_id: 'T3', by_staff_id: 'S_ALI', note: 'window seat' });
    expect(primaryOf('SEAT1')).toBe('T3');
    expect(hub.deps.db.prepare('SELECT holder_staff_id FROM seatings WHERE seating_id = ?').pluck().get('SEAT1')).toBe('S_ALI');
    expect(tablesOf('SEAT1')).toEqual(['T3']);
    expect(lockRows()).toMatchObject([{ table_id: 'T3', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
    expect(currentTableOf(hub.deps.db, ['O1']).get('O1')).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T3', table_ids: ['T3'] });
    // a new party opens the old table; the order still belongs to Ali's party
    seat('SEAT2', 'T1', 'S_NOOR');
    expect(holdersOfOrders(hub.deps.db, ['O1']).get('O1')).toBe('S_ALI');
    expect(r.statements).toBe(2);
  });

  it('[02a §6.9] reason is optional (no note in the event)', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    const r = await move(ali, mv('SEAT1', 'T1', 'T2'));
    expect(r.status).toBe(200);
    const payload = JSON.parse(hub.deps.db.prepare(`SELECT payload FROM events WHERE event_type = 'TableMoved'`).pluck().get() as string);
    expect(payload).not.toHaveProperty('note');
  });

  it('[02a §3.10] a free lock stays free (MoveTable does not take a lock)', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    const r = await move(ali, mv('SEAT1', 'T1', 'T2'));
    expect(r.status).toBe(200);
    expect(lockRows()).toEqual([]);
  });

  it('[02a #42] TableMoved re-keys the lock; Touch on the new table works', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    expect((await move(ali, mv('SEAT1', 'T1', 'T2'))).status).toBe(200);
    expect(lockRows()).toMatchObject([{ table_id: 'T2', seating_id: 'SEAT1', last_touch_at: null }]);
    append({
      stream_type: 'table',
      stream_id: 'T2',
      event_type: 'TableLockTouched',
      payload: { table_id: 'T2', seating_id: 'SEAT1' },
      actor_id: 'S_ALI',
      device_id: ali.deviceId,
    });
    const rows = lockRows() as Array<{ table_id: string; last_touch_at: number | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.table_id).toBe('T2');
    expect(rows[0]!.last_touch_at).not.toBeNull();
  });

  it.todo('[02a #22 handover] pending handover closed obsolete — after task 12');

  it('[02a #23] merged seating → 409 TABLE_MERGED { seating_id, table_ids }', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI', { tables: ['T1', 'T2'] });
    const r = await move(ali, mv('SEAT1', 'T1', 'T3'));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'TABLE_MERGED', details: { seating_id: 'SEAT1', table_ids: ['T1', 'T2'] } });
    expect(r.statements).toBe(1);
    expect(r.eventTypes).toEqual([]);
  });

  it('[02a #23] to a busy table → 409 TABLE_NOT_FREE { table_id }', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    seat('SEAT2', 'T3', 'S_NOOR');
    const r = await move(ali, mv('SEAT1', 'T1', 'T3'));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'TABLE_NOT_FREE', details: { table_id: 'T3' } });
    expect(r.statements).toBe(2);
    // moving onto its own table is the same error
    expect((await move(ali, mv('SEAT1', 'T1', 'T1'))).body.error?.code).toBe('TABLE_NOT_FREE');
  });

  it("[02a #23] to Sara's table by Bilal → 403 other_owner; Bilal hands over to Sara, Sara moves → passes", async () => {
    const bilal = signIn('S_BILAL');
    const sara = signIn('S_SARA');
    seat('SEAT1', 'T1', 'S_BILAL', { orders: ['O1'] });
    const denied = await move(bilal, mv('SEAT1', 'T1', 'T5'));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA', holder_staff_id: 'S_BILAL' },
    });
    expect(denied.eventTypes).toEqual([]);
    expect(primaryOf('SEAT1')).toBe('T1');
    // the handover (simulated by its real event): Sara is holder and T5's assignee
    handedOver('T1', 'SEAT1', 'S_BILAL', 'S_SARA', 'S_BILAL', bilal.deviceId);
    const ok = await move(sara, mv('SEAT1', 'T1', 'T5'));
    expect(ok.status).toBe(200);
    expect(ok.body.data?.result).toEqual({ primary_table_id: 'T5' });
    expect(primaryOf('SEAT1')).toBe('T5');
  });

  it('[02a #23] with force-release-table-lock → passes (target assigned to someone else)', async () => {
    const mgr = signIn('S_BOSS');
    seat('SEAT1', 'T1', 'S_BOSS');
    const r = await move(mgr, mv('SEAT1', 'T1', 'T5'));
    expect(r.status).toBe(200);
    expect(primaryOf('SEAT1')).toBe('T5');
  });

  it('[02a #23] a target assigned to the caller, or to nobody → free, on any floor', async () => {
    const sara = signIn('S_SARA');
    seat('SEAT1', 'T1', 'S_SARA');
    expect((await move(sara, mv('SEAT1', 'T1', 'T5'))).status).toBe(200); // her own, other floor
    expect((await move(sara, mv('SEAT1', 'T5', 'T7'))).status).toBe(200); // nobody's
  });

  it('[02a §3.15] requires_approval force grant counts as denied → 403 other_owner', async () => {
    const m = signIn('S_BOSS_APPR');
    seat('SEAT1', 'T1', 'S_BOSS_APPR');
    const r = await move(m, mv('SEAT1', 'T1', 'T5'));
    expect(r.status).toBe(403);
    expect(r.body.error?.details).toMatchObject({ reason: 'other_owner', table_id: 'T5', assigned_staff_id: 'S_SARA' });
  });

  it('[02a §6.9] non-holder without force → 403 not_holder; with force → moves the seating', async () => {
    const noor = signIn('S_NOOR');
    const mgr = signIn('S_BOSS');
    seat('SEAT1', 'T1', 'S_ALI');
    const denied = await move(noor, mv('SEAT1', 'T1', 'T2'));
    expect(denied.status).toBe(403);
    expect(denied.body.error).toEqual({
      code: 'PERMISSION_DENIED',
      details: { reason: 'not_holder', table_id: 'T1', assigned_staff_id: null, holder_staff_id: 'S_ALI' },
    });
    expect(denied.statements).toBe(1);
    const ok = await move(mgr, mv('SEAT1', 'T1', 'T2'));
    expect(ok.status).toBe(200);
    expect(primaryOf('SEAT1')).toBe('T2');
  });

  it('[02a §3.14] archived or unknown free target → 404 TABLE_NOT_FOUND { table_id }', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    const r = await move(ali, mv('SEAT1', 'T1', 'T9'));
    expect(r.status).toBe(404);
    expect(r.body.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id: 'T9' } });
    expect(primaryOf('SEAT1')).toBe('T1');
  });

  it('[02a §3.14] no branch config → a free target is not found (fail closed)', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    swapBranchConfig(null);
    const r = await move(ali, mv('SEAT1', 'T1', 'T2'));
    expect(r.status).toBe(404);
    expect(r.body.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id: 'T2' } });
  });

  it('[02a §3.14] an archived target that still has a seating is busy → TABLE_NOT_FREE, not 404', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    seat('SEAT9', 'T9', 'S_NOOR');
    expect((await move(ali, mv('SEAT1', 'T1', 'T9'))).body.error?.code).toBe('TABLE_NOT_FREE');
  });

  it('[02a §6.9] stale seating_id, or a table with no seating → 409 TABLE_SEATING_CHANGED { table_id, seating_id }', async () => {
    const ali = signIn('S_ALI');
    const none = await move(ali, mv('SEAT_GONE', 'T4', 'T3'));
    expect(none.status).toBe(409);
    expect(none.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T4', seating_id: 'SEAT_GONE' } });
    expect(none.statements).toBe(1);
    seat('SEAT2', 'T1', 'S_ALI');
    const stale = await move(ali, mv('SEAT1', 'T1', 'T3'));
    expect(stale.body.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT1' } });
  });

  it('[02a §6.9] NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING { table_id }', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI', { state: 'NEEDS_CLEANING' });
    const r = await move(ali, mv('SEAT1', 'T1', 'T2'));
    expect(r.status).toBe(409);
    expect(r.body.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
  });

  it('[02a §6.9] lock by another staff or by own other device → 409 TABLE_ALREADY_LOCKED', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_BILAL', 'DEV_B');
    const other = await move(ali, mv('SEAT1', 'T1', 'T2'));
    expect(other.status).toBe(409);
    expect(other.body.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_BILAL', locked_by_name: 'Bilal' },
    });
    expect(other.statements).toBe(2);
    hub.deps.db.prepare('DELETE FROM table_locks').run();
    lock('T1', 'SEAT1', 'S_ALI', 'DEV_OLD');
    const own = await move(ali, mv('SEAT1', 'T1', 'T2'));
    expect(own.status).toBe(409);
    expect(own.body.error?.code).toBe('TABLE_ALREADY_LOCKED');
    expect(primaryOf('SEAT1')).toBe('T1');
  });

  it('[02a §6.9] a force holder: another staff\'s lock → 409 TABLE_ALREADY_LOCKED; the force caller\'s own lock moves', async () => {
    const mgr = signIn('S_BOSS');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_ALI', 'DEV_A');
    expect((await move(mgr, mv('SEAT1', 'T1', 'T2'))).body.error?.code).toBe('TABLE_ALREADY_LOCKED');
    hub.deps.db.prepare('DELETE FROM table_locks').run();
    lock('T1', 'SEAT1', 'S_BOSS', mgr.deviceId);
    expect((await move(mgr, mv('SEAT1', 'T1', 'T2'))).status).toBe(200);
    expect(lockRows()).toMatchObject([{ table_id: 'T2', staff_id: 'S_BOSS' }]);
  });

  it('[02a §6.9] scope on both tables (C8): take-order my_floors, target on another floor → 403 outside_scope { table_ids }', async () => {
    const zain = signIn('S_ZAIN');
    seat('SEAT1', 'T1', 'S_ZAIN');
    const r = await move(zain, mv('SEAT1', 'T1', 'T6'));
    expect(r.status).toBe(403);
    expect(r.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T6'] } });
    expect(primaryOf('SEAT1')).toBe('T1');
    // from table outside the scope too
    seat('SEAT2', 'T7', 'S_ZAIN');
    const away = await move(zain, mv('SEAT2', 'T7', 'T2'));
    expect(away.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T7'] } });
    // both inside
    expect((await move(zain, mv('SEAT1', 'T1', 'T2'))).status).toBe(200);
  });

  it('[02a §6.9] scope of the force grant (my_floors) over both tables; scope is checked last', async () => {
    const flo = signIn('S_FLO');
    seat('SEAT1', 'T1', 'S_ALI');
    const out = await move(flo, mv('SEAT1', 'T1', 'T6'));
    expect(out.status).toBe(403);
    expect(out.body.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T6'] } });
    // scope last: an earlier rule (other_owner without force) wins over outside_scope
    const zain = signIn('S_ZAIN');
    seat('SEAT2', 'T2', 'S_ZAIN');
    const first = await move(zain, mv('SEAT2', 'T2', 'T5'));
    expect(first.body.error?.details).toMatchObject({ reason: 'other_owner' });
    // inside the force scope
    expect((await move(flo, mv('SEAT1', 'T1', 'T3'))).status).toBe(200);
  });

  it('[02a §6.9] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    const first = await move(ali, mv('SEAT1', 'T1', 'T2'), { commandId: 'cmd-same' });
    expect(first.status).toBe(200);
    const events = eventCount();
    const again = await move(ali, mv('SEAT1', 'T1', 'T2'), { commandId: 'cmd-same' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(events);
    expect(primaryOf('SEAT1')).toBe('T2');
  });

  it('[02a §6.9] reason longer than 120 → VALIDATION_FAILED; empty reason too', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    for (const reason of ['x'.repeat(121), '']) {
      const r = await move(ali, mv('SEAT1', 'T1', 'T2', { reason }));
      expect(r.body.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(primaryOf('SEAT1')).toBe('T1');
  });
});
