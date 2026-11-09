import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { cleanTableCommand, requestBillCommand } from '../../src/tables/commands/bill-clean';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a §3.13, §6.12 RequestBill, §6.13 CleanTable, §8 Offline (P-1f), §3.14. State is seeded with real events through
// the writer (lane rule 2); no other lane's command is called.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables' = 'branch') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, display_name: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 3_600_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_TAKER', [grant('take-order'), grant('clean-table')]),
      role('R_FLOOR', [grant('take-order', 'my_floors')]),
      role('R_OWN', [grant('take-order', 'own_tables')]),
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'Ali', 'R_TAKER'),
      person('S_ZAIN', 'Zain', 'R_FLOOR', ['F1']),
      person('S_OMAR', 'Omar', 'R_OWN'),
    ],
  };
}

const CONFIG = {
  floors: [
    { floor_id: 'F1', tables: [{ table_id: 'T1', zone_id: null }, { table_id: 'T2', zone_id: null }] },
    { floor_id: 'F2', tables: [{ table_id: 'T9', zone_id: null }] },
  ],
} as unknown as BranchConfig;

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  swapBranchConfig({ config: CONFIG, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
  // R-2D-6: the real CleanTable handler under a test-only name, so its own statements are counted (SG-3 pattern).
  commandRegistry(hub.app).register(
    defineCommand({
      ...cleanTableCommand,
      commandType: 'TestCleanTableCounted',
      handle(ctx, payload, cmd) {
        const before = counter.count;
        try {
          return cleanTableCommand.handle(ctx, payload, cmd);
        } finally {
          lastStatements = counter.count - before;
        }
      },
    }),
  );
  counter = statementCounter(hub.deps.db);
  lastStatements = -1;
});

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

// ------------------------------------------------------------------------------------------- seeding

function ev(stream_type: 'table' | 'order', stream_id: string, event_type: string, payload: Record<string, unknown>): EventDraft {
  return {
    stream_type,
    stream_id,
    event_type,
    schema_version: 1,
    payload,
    occurred_at: hub.clock.branchNow(),
    actor_id: 'S_ALI',
    device_id: 'D_SEED',
  } as EventDraft;
}

function append(...drafts: EventDraft[]): void {
  for (const d of drafts) {
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) => tx.append([d]));
  }
}

const opened = (table_id: string, seating_id: string, holder = 'S_ALI') =>
  ev('table', table_id, 'TableOpened', { table_id, seating_id, holder_staff_id: holder, party_size: 2 });
function placed(order_id: string, seating_id: string): EventDraft {
  const T = hub.clock.branchNow();
  return ev('order', order_id, 'OrderPlaced', {
    order_id,
    order_type: 'dine_in',
    table_id: null,
    table_key: `dine_in:${seating_id}`,
    follow_up: false,
    pickup_at_ms: null,
    order_item_ids: [`${order_id}-L1`],
    groups: [{ group_id: `${order_id}:0`, target_land_ms: T + 600_000, promise_ms: T + 900_000, order_item_ids: [`${order_id}-L1`] }],
    lines: [],
  });
}
const cancelled = (order_id: string) => ev('order', order_id, 'OrderCancelled', { order_id });
const foodServed = (order_id: string) => ev('order', order_id, 'OrderFoodServed', { order_id });
const billRequested = (seating_id: string, table_id: string) =>
  ev('table', table_id, 'BillRequested', { seating_id, table_id, by_staff_id: 'S_ALI' });
const billClosed = (seating_id: string, table_id: string) => ev('table', table_id, 'BillClosed', { seating_id });
const cleaned = (seating_id: string, table_ids: string[]) =>
  ev('table', table_ids[0]!, 'TableCleaned', { seating_id, table_ids, reason: 'cleaned', by_staff_id: 'S_ALI' });

/** A second table joined to an open seating (SQL into 0012, lane rule 2; merge is lane C's command). */
function join(table_id: string, seating_id: string): void {
  hub.deps.db.prepare('INSERT INTO seating_tables (table_id, seating_id, joined_at) VALUES (?, ?, ?)').run(table_id, seating_id, hub.clock.branchNow() + 1);
}

function seating(id: string): { state: string; bill_requested_at: number | null; close_reason: string | null } {
  return hub.deps.db.prepare('SELECT state, bill_requested_at, close_reason FROM seatings WHERE seating_id = ?').get(id) as {
    state: string;
    bill_requested_at: number | null;
    close_reason: string | null;
  };
}
function tableRows(): unknown[] {
  return hub.deps.db.prepare('SELECT table_id, seating_id FROM seating_tables ORDER BY table_id').all();
}
function eventCount(): number {
  return (hub.deps.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n;
}

// ------------------------------------------------------------------------------------------- calls

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

interface Stored {
  event_type: string;
  stream_type: string;
  stream_id: string;
  actor_id: string | null;
  device_id: string;
  payload: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
  result: Record<string, unknown> | undefined;
  events: Stored[];
  error?: { code: string; details: Record<string, unknown> };
}

let commandSeq = 0;

async function call(
  who: Who,
  type: 'RequestBill' | 'CleanTable' | 'TestCleanTableCounted',
  payload: { table_id: string; seating_id: string },
  o: { queuedAt?: number; commandId?: string } = {},
): Promise<Reply> {
  commandSeq += 1;
  const path = { RequestBill: 'request-bill', CleanTable: 'clean-table', TestCleanTableCounted: 'test-clean-table-counted' }[type];
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${path}`,
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
      ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
    },
    payload: {
      command_id: o.commandId ?? `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: type,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as {
    data?: { event_ids: string[]; result: Record<string, unknown> };
    error?: { code: string; details: Record<string, unknown> };
  };
  const events =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(
              `SELECT event_type, stream_type, stream_id, actor_id, device_id, payload AS payload_json FROM events
                WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
            )
            .all(JSON.stringify(body.data.event_ids)) as Array<Omit<Stored, 'payload'> & { payload_json: string }>
        ).map(({ payload_json, ...rest }) => ({ ...rest, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, body, result: body.data?.result, events, error };
}

// ------------------------------------------------------------------------------------------- RequestBill

describe('RequestBill (02a §6.12, §3.13)', () => {
  it('[02a #31 command] ORDERED → BillRequested on the primary table, BILL_REQUESTED; repeat → requested: false, no event; a new OrderPlaced clears the bill', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'));
    expect(seating('S1').state).toBe('ORDERED');

    const first = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(first.status).toBe(200);
    expect(first.result).toEqual({ requested: true });
    expect(first.events).toEqual([
      {
        event_type: 'BillRequested',
        stream_type: 'table',
        stream_id: 'T1',
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { seating_id: 'S1', table_id: 'T1', by_staff_id: 'S_ALI' },
      },
    ]);
    expect(seating('S1').state).toBe('BILL_REQUESTED');

    const before = eventCount();
    const repeat = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(repeat.status).toBe(200);
    expect(repeat.result).toEqual({ requested: false });
    expect(repeat.events).toEqual([]);
    expect(eventCount()).toBe(before);

    append(placed('O2', 'S1'));
    expect(seating('S1')).toMatchObject({ state: 'ORDERED', bill_requested_at: null });
  });

  it('[02a #31 command] FOOD_ON_TABLE → BillRequested; a call naming a joined table drafts on the primary', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), foodServed('O1'));
    join('T2', 'S1');
    expect(seating('S1').state).toBe('FOOD_ON_TABLE');
    const r = await call(ali, 'RequestBill', { table_id: 'T2', seating_id: 'S1' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ requested: true });
    expect(r.events.map((e) => [e.event_type, e.stream_id, e.payload.table_id])).toEqual([['BillRequested', 'T1', 'T1']]);
    expect(seating('S1').state).toBe('BILL_REQUESTED');
  });

  it('[02a §6.12] SEATED → 409 TABLE_NO_ORDERS, no event', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'));
    const before = eventCount();
    const r = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_NO_ORDERS', details: { table_id: 'T1' } });
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.12] stale seating_id (another seating on the table) → 409 TABLE_SEATING_CHANGED', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billClosed('S1', 'T1'), cleaned('S1', ['T1']), opened('T1', 'S2'), placed('O2', 'S2'));
    const r = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
    expect(seating('S2').bill_requested_at).toBeNull();
  });

  it('[02a §6.12] no seating on the table → 409 TABLE_SEATING_CHANGED', async () => {
    const ali = signIn('S_ALI');
    const r = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
  });

  it('[02a §6.12] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'));
    const first = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' }, { commandId: 'bill-once' });
    const before = eventCount();
    const again = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' }, { commandId: 'bill-once' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02a §6.12] scope (C8): my_floors outside the floor → 403 outside_scope; on the floor → passes', async () => {
    const zain = signIn('S_ZAIN');
    append(opened('T9', 'S9'), placed('O9', 'S9'), opened('T1', 'S1'), placed('O1', 'S1'));
    const out = await call(zain, 'RequestBill', { table_id: 'T9', seating_id: 'S9' });
    expect(out.status).toBe(403);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    expect(seating('S9').state).toBe('ORDERED');
    const ok = await call(zain, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(ok.status).toBe(200);
    expect(ok.result).toEqual({ requested: true });
  });

  it('[02a §6.12] scope (C8): own_tables → only the seating whose holder is the caller', async () => {
    const omar = signIn('S_OMAR');
    append(opened('T1', 'S1', 'S_ALI'), placed('O1', 'S1'), opened('T2', 'S2', 'S_OMAR'), placed('O2', 'S2'));
    const out = await call(omar, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(out.status).toBe(403);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T1'] } });
    const ok = await call(omar, 'RequestBill', { table_id: 'T2', seating_id: 'S2' });
    expect(ok.status).toBe(200);
  });

  it('[02a §6.12] scope is checked last: a state error wins over outside_scope', async () => {
    const zain = signIn('S_ZAIN');
    append(opened('T9', 'S9'));
    const r = await call(zain, 'RequestBill', { table_id: 'T9', seating_id: 'S9' });
    expect(r.error?.code).toBe('TABLE_NO_ORDERS');
  });
});

// ------------------------------------------------------------------------------------------- CleanTable

describe('CleanTable (02a §6.13, §3.13)', () => {
  it('[02a #32 commands] BillClosed → NEEDS_CLEANING: RequestBill → 409 TABLE_NEEDS_CLEANING; Clean → TableCleaned cleaned, table FREE', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billRequested('S1', 'T1'), billClosed('S1', 'T1'));
    expect(seating('S1').state).toBe('NEEDS_CLEANING');

    const bill = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' });
    expect(bill.status).toBe(409);
    expect(bill.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });

    const clean = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' });
    expect(clean.status).toBe(200);
    expect(clean.result).toEqual({ reason: 'cleaned' });
    expect(clean.events).toEqual([
      {
        event_type: 'TableCleaned',
        stream_type: 'table',
        stream_id: 'T1',
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { seating_id: 'S1', table_ids: ['T1'], reason: 'cleaned', by_staff_id: 'S_ALI' },
      },
    ]);
    expect(seating('S1')).toMatchObject({ state: 'CLOSED', close_reason: 'cleaned' });
    expect(tableRows()).toEqual([]);
  });

  it('[02a #33] every order cancelled → SEATED → Clean gives left_without_order; a never-ordered SEATED table too', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billRequested('S1', 'T1'), cancelled('O1'), opened('T2', 'S2'));
    expect(seating('S1').state).toBe('SEATED');

    const a = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' });
    expect(a.status).toBe(200);
    expect(a.result).toEqual({ reason: 'left_without_order' });
    expect(a.events.map((e) => e.payload.reason)).toEqual(['left_without_order']);
    expect(seating('S1')).toMatchObject({ state: 'CLOSED', close_reason: 'left_without_order' });

    const b = await call(ali, 'CleanTable', { table_id: 'T2', seating_id: 'S2' });
    expect(b.result).toEqual({ reason: 'left_without_order' });
    expect(tableRows()).toEqual([]);
  });

  it('[02a #34] live orders (ORDERED / FOOD_ON_TABLE / BILL_REQUESTED) → 409 TABLE_HAS_OPEN_ORDERS { table_id, order_count }', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), placed('O2', 'S1'), placed('O3', 'S1'), cancelled('O3'));
    expect(seating('S1').state).toBe('ORDERED');
    const ordered = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' });
    expect(ordered.status).toBe(409);
    expect(ordered.error).toEqual({ code: 'TABLE_HAS_OPEN_ORDERS', details: { table_id: 'T1', order_count: 2 } });

    append(foodServed('O1'), foodServed('O2'));
    expect(seating('S1').state).toBe('FOOD_ON_TABLE');
    expect((await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' })).error?.code).toBe('TABLE_HAS_OPEN_ORDERS');

    append(billRequested('S1', 'T1'));
    expect(seating('S1').state).toBe('BILL_REQUESTED');
    const before = eventCount();
    const billed = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' });
    expect(billed.error).toEqual({ code: 'TABLE_HAS_OPEN_ORDERS', details: { table_id: 'T1', order_count: 2 } });
    expect(eventCount()).toBe(before);
    expect(seating('S1').state).toBe('BILL_REQUESTED');
  });

  it('[02a §6.13] stale seating_id and no seating → 409 TABLE_SEATING_CHANGED', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S2'));
    const stale = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
    const none = await call(ali, 'CleanTable', { table_id: 'T2', seating_id: 'S1' });
    expect(none.status).toBe(409);
    expect(none.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: 'S1' } });
    expect(seating('S2').state).toBe('SEATED');
  });

  it('[02a §6.13] D32 retransmit: same command_id → same response, no new event', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'));
    const first = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' }, { commandId: 'clean-once' });
    expect(first.status).toBe(200);
    const before = eventCount();
    const again = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' }, { commandId: 'clean-once' });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(eventCount()).toBe(before);
  });

  it('[02a #44] queued Clean with an old seating_id after a new party sat → TABLE_SEATING_CHANGED, the new seating untouched', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billClosed('S1', 'T1'), cleaned('S1', ['T1']), opened('T1', 'S2'));
    const before = eventCount();
    const r = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' }, { queuedAt: hub.clock.branchNow() - 5_000 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
    expect(eventCount()).toBe(before);
    expect(seating('S2').state).toBe('SEATED');
    expect(tableRows()).toEqual([{ table_id: 'T1', seating_id: 'S2' }]);
  });

  it('[02a #49] queued Clean for a seating already cleaned (table FREE) → TABLE_SEATING_CHANGED', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billClosed('S1', 'T1'), cleaned('S1', ['T1']));
    const r = await call(ali, 'CleanTable', { table_id: 'T1', seating_id: 'S1' }, { queuedAt: hub.clock.branchNow() - 5_000 });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'S1' } });
  });

  it('[02a §6.13] merged seating: TableCleaned on the primary with every table of the seating; called through a joined table', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'));
    join('T2', 'S1');
    const r = await call(ali, 'CleanTable', { table_id: 'T2', seating_id: 'S1' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => [e.event_type, e.stream_id, e.payload.table_ids])).toEqual([['TableCleaned', 'T1', ['T1', 'T2']]]);
    expect(tableRows()).toEqual([]);
  });

  it('[02a §6.13] statements: 1 + 2 byDedupeKey + closeMany (nothing open → no AlertClosed)', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), billClosed('S1', 'T1'));
    const r = await call(ali, 'TestCleanTableCounted', { table_id: 'T1', seating_id: 'S1' });
    expect(r.status).toBe(200);
    expect(r.events.map((e) => e.event_type)).toEqual(['TableCleaned']);
    // 1 seating read + 2 byDedupeKey; closeMany with nothing to close reads nothing (alerts/raise.ts)
    expect(lastStatements).toBe(3);
  });
});

// ------------------------------------------------------------------------------------------- archived, queueable

describe('archived tables and the offline queue (02a §3.14, §8 P-1f)', () => {
  it('[02a #40 bill, clean] a seated table absent from the branch config: RequestBill and CleanTable work', async () => {
    const ali = signIn('S_ALI');
    append(opened('T7', 'S7'), placed('O7', 'S7'));
    expect(CONFIG.floors.some((f) => f.tables.some((t) => t.table_id === 'T7'))).toBe(false);
    const bill = await call(ali, 'RequestBill', { table_id: 'T7', seating_id: 'S7' });
    expect(bill.status).toBe(200);
    expect(bill.result).toEqual({ requested: true });
    append(billClosed('S7', 'T7'));
    const clean = await call(ali, 'CleanTable', { table_id: 'T7', seating_id: 'S7' });
    expect(clean.status).toBe(200);
    expect(clean.result).toEqual({ reason: 'cleaned' });
    expect(seating('S7').state).toBe('CLOSED');
  });

  it('[02a §6.12] an archived seated table has no floor: a my_floors caller is outside scope; own_tables holder passes', async () => {
    const zain = signIn('S_ZAIN');
    const omar = signIn('S_OMAR');
    append(opened('T7', 'S7', 'S_OMAR'), placed('O7', 'S7'));
    const out = await call(zain, 'RequestBill', { table_id: 'T7', seating_id: 'S7' });
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T7'] } });
    const ok = await call(omar, 'RequestBill', { table_id: 'T7', seating_id: 'S7' });
    expect(ok.status).toBe(200);
  });

  it('[02a #61] RequestBill and CleanTable are registered queueable; a call carrying X-Queued-At is accepted', async () => {
    expect(requestBillCommand.queueable).toBe(true);
    expect(cleanTableCommand.queueable).toBe(true);
    const registry = commandRegistry(hub.app);
    expect(registry.byPath('request-bill')?.queueable).toBe(true);
    expect(registry.byPath('clean-table')?.queueable).toBe(true);
    expect(registry.byPath('request-bill')?.permission).toBe('take-order');
    expect(registry.byPath('clean-table')?.permission).toBe('clean-table');

    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'), opened('T2', 'S2'));
    const queuedAt = hub.clock.branchNow() - 5_000;
    const bill = await call(ali, 'RequestBill', { table_id: 'T1', seating_id: 'S1' }, { queuedAt });
    expect(bill.status).toBe(200);
    expect(bill.result).toEqual({ requested: true });
    const clean = await call(ali, 'CleanTable', { table_id: 'T2', seating_id: 'S2' }, { queuedAt });
    expect(clean.status).toBe(200);
    expect(clean.result).toEqual({ reason: 'left_without_order' });
  });

  it('[02a §6.12] payload: seating_id is required (VALIDATION_FAILED)', async () => {
    const ali = signIn('S_ALI');
    append(opened('T1', 'S1'), placed('O1', 'S1'));
    const r = await call(ali, 'RequestBill', { table_id: 'T1' } as unknown as { table_id: string; seating_id: string });
    expect(r.status).toBe(400);
    expect(r.error?.code).toBe('VALIDATION_FAILED');
  });
});
