import type { BranchConfig, DirectoryInput, EventDraft } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { requireLock } from '../../src/tables/lock';
import { currentTableOf } from '../../src/tables/reads';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.1 §4.2 requireLock (+ P-1b), §2 (holder-only re-acquire), §3.15, T18. SG-3: a test-only command calls it.

let hub: TestHub;
let counter: ReturnType<typeof statementCounter>;
let lastStatements = -1;

type Grant = 'allowed' | 'requires_approval';

function grant(permission: string, grant_type: Grant, scope: 'branch' | 'my_floors' = 'branch') {
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
  const takeOrder = grant('take-order', 'allowed');
  const person = (staff_id: string, display_name: string, role_id: string, floor_ids: string[] = []) => ({
    staff_id,
    display_name,
    pin_hash: pin,
    role_ids: [role_id],
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  return {
    ...base,
    roles: [
      ...base.roles,
      { role_id: 'R_TAKER', name: 'Taker', session_idle_ttl_ms: 3_600_000, permissions: [takeOrder] },
      {
        role_id: 'R_ANYWHERE',
        name: 'Anywhere',
        session_idle_ttl_ms: 3_600_000,
        permissions: [takeOrder, grant('take-order-anywhere', 'allowed')],
      },
      {
        role_id: 'R_ANY_APPROVAL',
        name: 'Anywhere with approval',
        session_idle_ttl_ms: 3_600_000,
        permissions: [takeOrder, grant('take-order-anywhere', 'requires_approval')],
      },
      {
        role_id: 'R_ANY_FLOOR',
        name: 'Anywhere on my floors',
        session_idle_ttl_ms: 3_600_000,
        permissions: [takeOrder, grant('take-order-anywhere', 'allowed', 'my_floors')],
      },
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'Ali', 'R_TAKER'),
      person('S_BILAL', 'Bilal', 'R_ANYWHERE'),
      person('S_NOOR', 'Noor', 'R_TAKER'),
      person('S_SARA', 'Sara', 'R_ANY_APPROVAL'),
      person('S_ZAIN', 'Zain', 'R_ANY_FLOOR', ['F1']),
    ],
  };
}

const RequireLockPayload = z.object({ table_id: z.string(), seating_id: z.string(), via_order_id: z.string().optional() });

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  // SG-3: the test-only caller; queueable so X-Queued-At reaches ctx.queuedAt (00 v1.8 H-1).
  commandRegistry(hub.app).register(
    defineCommand({
      commandType: 'TestRequireLock',
      payloadSchema: RequireLockPayload,
      sessionKind: 'device',
      permission: 'take-order',
      queueable: true,
      handle(ctx, payload) {
        let table_id = payload.table_id;
        if (payload.via_order_id !== undefined) {
          table_id = currentTableOf(ctx.tx.db, [payload.via_order_id]).get(payload.via_order_id)?.primary_table_id ?? table_id;
        }
        const before = counter.count;
        let drafts: EventDraft[];
        try {
          drafts = requireLock(ctx.tx, { table_id, seating_id: payload.seating_id }, ctx);
        } finally {
          lastStatements = counter.count - before;
        }
        return { events: drafts, result: { drafts } };
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
    .prepare(
      'INSERT INTO table_locks (table_id, seating_id, staff_id, device_id, locked_at, last_activity_at) VALUES (?, ?, ?, ?, 1, 1)',
    )
    .run(table_id, seating_id, staff_id, device_id);
}

function lockRows(): unknown[] {
  return hub.deps.db.prepare('SELECT table_id, seating_id, staff_id, device_id FROM table_locks ORDER BY table_id').all();
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

async function call(
  who: Who,
  payload: z.infer<typeof RequireLockPayload>,
  o: { queuedAt?: number } = {},
): Promise<{ status: number; drafts: EventDraft[]; eventTypes: string[]; error?: { code: string; details: Record<string, unknown> } }> {
  commandSeq += 1;
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/test-require-lock',
    headers: {
      authorization: `Bearer ${who.token}`,
      'x-session-token': who.sessionToken,
      ...(o.queuedAt === undefined ? {} : { 'x-queued-at': String(o.queuedAt) }),
    },
    payload: {
      command_id: `cmd-${commandSeq}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'TestRequireLock',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as {
    data?: { event_ids: string[]; result: { drafts: EventDraft[] } };
    error?: { code: string; details: Record<string, unknown> };
  };
  const eventTypes =
    body.data === undefined
      ? []
      : (
          hub.deps.db
            .prepare(`SELECT event_type FROM events WHERE event_id IN (SELECT value FROM json_each(?)) ORDER BY seq`)
            .all(JSON.stringify(body.data.event_ids)) as Array<{ event_type: string }>
        ).map((r) => r.event_type);
  const error = body.error === undefined ? undefined : { code: body.error.code, details: body.error.details };
  return { status: res.statusCode, drafts: body.data?.result.drafts ?? [], eventTypes, error };
}

describe('02a requireLock (§4.2)', () => {
  it('[02a §4.2] holder, free lock → [TableLocked] on the primary table; 1 statement', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI', { tables: ['T1', 'T2'] });
    const r = await call(ali, { table_id: 'T2', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      stream_type: 'table',
      stream_id: 'T1',
      event_type: 'TableLocked',
      schema_version: 1,
      payload: { table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI' },
      actor_id: 'S_ALI',
      device_id: ali.deviceId,
    });
    expect(r.drafts[0]!.payload).not.toHaveProperty('replaced_device_id');
    expect(r.eventTypes).toEqual(['TableLocked']);
  });

  it('[02a §4.2] holder, held by (actor, device) → nothing; 1 statement', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    const r = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(r.drafts).toEqual([]);
    expect(r.eventTypes).toEqual([]);
  });

  it('[02a §4.2] holder, same actor on another device → [TableLocked { replaced_device_id }] (T15)', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_ALI', 'DEV_OLD');
    const r = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(r.drafts).toHaveLength(1);
    expect(r.drafts[0]).toMatchObject({
      event_type: 'TableLocked',
      stream_id: 'T1',
      payload: { table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI', replaced_device_id: 'DEV_OLD' },
      device_id: ali.deviceId,
    });
  });

  it('[02a §4.2] holder, held by other staff → 409 TABLE_ALREADY_LOCKED { locked_by_staff_id, locked_by_name }', async () => {
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_BILAL', 'DEV_B');
    const r = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(409);
    expect(lastStatements).toBe(1);
    expect(r.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_BILAL', locked_by_name: 'Bilal' },
    });
  });

  it('[02a §4.2] T18: no seating, or another seating → 409 TABLE_SEATING_CHANGED { table_id, seating_id }', async () => {
    const ali = signIn('S_ALI');
    const none = await call(ali, { table_id: 'T7', seating_id: 'SEAT_GONE' });
    expect(none.status).toBe(409);
    expect(lastStatements).toBe(1);
    expect(none.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T7', seating_id: 'SEAT_GONE' } });
    seat('SEAT2', 'T1', 'S_ALI');
    const other = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(other.status).toBe(409);
    expect(other.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT1' } });
  });

  it('[02a #32 requireLock] NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING, holder or not', async () => {
    const ali = signIn('S_ALI');
    const bilal = signIn('S_BILAL');
    seat('SEAT1', 'T1', 'S_ALI', { state: 'NEEDS_CLEANING' });
    for (const who of [ali, bilal]) {
      const r = await call(who, { table_id: 'T1', seating_id: 'SEAT1' });
      expect(r.status).toBe(409);
      expect(lastStatements).toBe(1);
      expect(r.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
    }
    expect(lockRows()).toEqual([]);
  });

  it("[02a #45] a moved order's old table → TABLE_SEATING_CHANGED; through currentTableOf → passes", async () => {
    const ali = signIn('S_ALI');
    // SEAT1 moved T1 → T5 with its order O1; a new party sits at T1.
    seat('SEAT1', 'T5', 'S_ALI', { orders: ['O1'] });
    const stale = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT1' } });
    seat('SEAT2', 'T1', 'S_NOOR');
    const taken = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(taken.status).toBe(409);
    expect(taken.error?.code).toBe('TABLE_SEATING_CHANGED');
    const current = await call(ali, { table_id: 'T1', seating_id: 'SEAT1', via_order_id: 'O1' });
    expect(current.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(current.drafts).toHaveLength(1);
    expect(current.drafts[0]).toMatchObject({ event_type: 'TableLocked', payload: { table_id: 'T5', seating_id: 'SEAT1', staff_id: 'S_ALI' } });
  });

  it('[02a #46] non-holder without take-order-anywhere → 403, free and held cases; old holder after a take-over → 403', async () => {
    const noor = signIn('S_NOOR');
    const ali = signIn('S_ALI');
    // free
    seat('SEAT1', 'T1', 'S_ALI');
    const free = await call(noor, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(free.status).toBe(403);
    expect(lastStatements).toBe(1);
    expect(free.error?.code).toBe('PERMISSION_DENIED');
    expect(free.error?.details).toMatchObject({ reason: 'not_holder', table_id: 'T1', holder_staff_id: 'S_ALI' });
    // held by the holder, and held by someone else
    lock('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    seat('SEAT2', 'T2', 'S_ALI');
    lock('T2', 'SEAT2', 'S_BILAL', 'DEV_B');
    for (const [table_id, seating_id] of [
      ['T1', 'SEAT1'],
      ['T2', 'SEAT2'],
    ] as const) {
      const held = await call(noor, { table_id, seating_id });
      expect(held.status).toBe(403);
      expect(held.error?.code).toBe('PERMISSION_DENIED');
    }
    // after a take-over: Ali took SEAT3 over from Noor (holder changed, Noor's lock released); Noor's draft submits.
    seat('SEAT3', 'T3', 'S_ALI');
    const old = await call(noor, { table_id: 'T3', seating_id: 'SEAT3' });
    expect(old.status).toBe(403);
    expect(old.error?.code).toBe('PERMISSION_DENIED');
    expect(lockRows()).toHaveLength(2);
  });

  it('[02a #53 requireLock] after a take-over, Bilal with take-order-anywhere → no TableLocked, lock stays free; Ali locks at once', async () => {
    const bilal = signIn('S_BILAL');
    const ali = signIn('S_ALI');
    // Ali took SEAT1 over from Bilal: holder = Ali, Bilal's lock released (T20).
    seat('SEAT1', 'T1', 'S_ALI', { orders: ['O1'] });
    const r = await call(bilal, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(r.drafts).toEqual([]);
    expect(r.eventTypes).toEqual([]);
    expect(lockRows()).toEqual([]);
    const opens = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(opens.status).toBe(200);
    expect(opens.drafts.map((d) => d.event_type)).toEqual(['TableLocked']);
  });

  it('[02a §4.2] non-holder with take-order-anywhere: held by (actor, device) → nothing; held by another → TABLE_ALREADY_LOCKED', async () => {
    const bilal = signIn('S_BILAL');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_BILAL', bilal.deviceId);
    const mine = await call(bilal, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(mine.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(mine.drafts).toEqual([]);
    seat('SEAT2', 'T2', 'S_ALI');
    lock('T2', 'SEAT2', 'S_ALI', 'DEV_A');
    const other = await call(bilal, { table_id: 'T2', seating_id: 'SEAT2' });
    expect(other.status).toBe(409);
    expect(lastStatements).toBe(1);
    expect(other.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T2', locked_by_staff_id: 'S_ALI', locked_by_name: 'Ali' },
    });
  });

  it('[02a §3.15] a requires_approval take-order-anywhere grant counts as denied → 403', async () => {
    const sara = signIn('S_SARA');
    seat('SEAT1', 'T1', 'S_ALI');
    const r = await call(sara, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(403);
    expect(lastStatements).toBe(1);
    expect(r.error?.code).toBe('PERMISSION_DENIED');
    expect(r.error?.details).toMatchObject({ reason: 'not_holder', table_id: 'T1', holder_staff_id: 'S_ALI' });
  });

  it('[02a §3.15] take-order-anywhere on my_floors: a table on another floor → 403 outside_scope; on my floor → passes', async () => {
    const config = {
      floors: [
        { floor_id: 'F1', tables: [{ table_id: 'T1', zone_id: null }] },
        { floor_id: 'F2', tables: [{ table_id: 'T9', zone_id: null }] },
      ],
    } as unknown as BranchConfig;
    swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
    const zain = signIn('S_ZAIN');
    seat('SEAT1', 'T1', 'S_ALI');
    seat('SEAT9', 'T9', 'S_ALI');
    const away = await call(zain, { table_id: 'T9', seating_id: 'SEAT9' });
    expect(away.status).toBe(403);
    expect(lastStatements).toBe(1);
    expect(away.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    const home = await call(zain, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(home.status).toBe(200);
    expect(home.drafts).toEqual([]);
  });

  it('[02a #60] ctx.queuedAt on a free lock → nothing taken, no TableLocked; held by the actor → nothing (AD-1)', async () => {
    const ali = signIn('S_ALI');
    const bilal = signIn('S_BILAL');
    seat('SEAT1', 'T1', 'S_ALI');
    const queuedAt = hub.clock.branchNow() - 1_000;
    const holder = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' }, { queuedAt });
    expect(holder.status).toBe(200);
    expect(lastStatements).toBe(1);
    expect(holder.drafts).toEqual([]);
    expect(holder.eventTypes).toEqual([]);
    const other = await call(bilal, { table_id: 'T1', seating_id: 'SEAT1' }, { queuedAt });
    expect(other.status).toBe(200);
    expect(other.drafts).toEqual([]);
    expect(lockRows()).toEqual([]);
    lock('T1', 'SEAT1', 'S_ALI', ali.deviceId);
    const held = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' }, { queuedAt });
    expect(held.status).toBe(200);
    expect(held.drafts).toEqual([]);
    // the same submit without X-Queued-At takes the free lock
    hub.deps.db.prepare('DELETE FROM table_locks').run();
    const live = await call(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(live.drafts.map((d) => d.event_type)).toEqual(['TableLocked']);
  });
});
