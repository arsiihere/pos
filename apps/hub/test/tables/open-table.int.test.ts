import type { DirectoryInput } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §6.1 OpenTable, §3.2, §3.14 (archived = absent from branchConfig(), AD-2), §3.15, T15, T18; §10 #1–#6,
// #39, #43, #56 and the §10 preamble (retransmit, scope last, stale seating_id).

let hub: TestHub;

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
      {
        role_id: 'R_FLOOR_TAKER',
        name: 'Taker on my floors',
        session_idle_ttl_ms: 3_600_000,
        permissions: [grant('take-order', 'allowed', 'my_floors')],
      },
    ],
    staff: [
      ...base.staff,
      person('S_ALI', 'Ali', 'R_TAKER'),
      person('S_BILAL', 'Bilal', 'R_ANYWHERE'),
      person('S_NOOR', 'Noor', 'R_TAKER'),
      person('S_SARA', 'Sara', 'R_ANY_APPROVAL'),
      person('S_ZAIN', 'Zain', 'R_ANY_FLOOR', ['F1']),
      person('S_FAIZ', 'Faiz', 'R_FLOOR_TAKER', ['F1']),
    ],
  };
}

// F1: T1–T5; F2: T9. T_OLD is archived (absent from the config, AD-2).
function withFloors(): void {
  const table = (table_id: string, sort_order: number) => ({ table_id, name: table_id, seats: 4, sort_order, zone_id: null });
  const config = aBranchConfig({
    floors: [
      { floor_id: 'F1', name: 'Ground', sort_order: 0, zones: [], tables: ['T1', 'T2', 'T3', 'T4', 'T5'].map(table) },
      { floor_id: 'F2', name: 'Roof', sort_order: 1, zones: [], tables: [table('T9', 0)] },
    ],
  });
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: 1, snapshotSchemaVersion: 4, appliedAt: 0 });
}

async function setUp(o: { beforeCommit?: () => void } = {}): Promise<void> {
  hub = await createTestHub(o.beforeCommit === undefined ? undefined : { testHooks: { beforeCommit: o.beforeCommit } });
  await seedDirectory(hub, await directory());
  withFloors();
}

afterEach(async () => {
  swapBranchConfig(null);
  await hub.close();
});

function seat(seating_id: string, primary: string, holder: string, o: { tables?: string[]; state?: string } = {}): void {
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

function seatingRows(): unknown[] {
  return hub.deps.db.prepare('SELECT seating_id, primary_table_id, state, holder_staff_id, party_size FROM seatings ORDER BY seating_id').all();
}

function tableEvents(): Array<{ event_type: string; stream_id: string; device_id: string; actor_id: string; payload: unknown }> {
  return (
    hub.deps.db
      .prepare(`SELECT event_type, stream_id, device_id, actor_id, payload FROM events WHERE stream_type = 'table' ORDER BY seq`)
      .all() as Array<{ event_type: string; stream_id: string; device_id: string; actor_id: string; payload: string }>
  ).map((r) => ({ ...r, payload: JSON.parse(r.payload) as unknown }));
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

/** Counts the statements of each `handle` call of OpenTable (§6.1 script step 1: one read). */
function countHandle(): { calls: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath('open-table') as CommandDef;
  const counter = statementCounter(hub.deps.db);
  const original = def.handle;
  const calls: number[] = [];
  def.handle = (ctx, payload, cmd) => {
    counter.reset();
    try {
      return original.call(def, ctx, payload, cmd);
    } finally {
      calls.push(counter.count);
    }
  };
  return {
    calls,
    restore() {
      def.handle = original;
    },
  };
}

let commandSeq = 0;

interface Reply {
  status: number;
  body: unknown;
  result?: { seating_id: string; primary_table_id: string; opened: boolean; holder_staff_id: string };
  eventTypes: string[];
  error?: { code: string; details: Record<string, unknown> };
}

async function open(
  who: Who,
  payload: { table_id: string; seating_id?: string; party_size?: number },
  command_id = `cmd-${(commandSeq += 1)}`,
): Promise<Reply> {
  const res = await hub.app.inject({
    method: 'POST',
    url: '/commands/open-table',
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'OpenTable',
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: who.staffId,
      device_id: who.deviceId,
    },
  });
  const body = res.json() as {
    data?: { event_ids: string[]; result: Reply['result'] };
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
  return { status: res.statusCode, body, result: body.data?.result, eventTypes, error };
}

describe('02a OpenTable (§6.1)', () => {
  it('[02a #1] open FREE → TableOpened + TableLocked (device from envelope), SEATED; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const counted = countHandle();
    const r = await open(ali, { table_id: 'T1', party_size: 4 });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.eventTypes).toEqual(['TableOpened', 'TableLocked']);
    const seating_id = r.result!.seating_id;
    expect(r.result).toEqual({ seating_id, primary_table_id: 'T1', opened: true, holder_staff_id: 'S_ALI' });
    expect(tableEvents()).toEqual([
      {
        event_type: 'TableOpened',
        stream_id: 'T1',
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { table_id: 'T1', seating_id, holder_staff_id: 'S_ALI', party_size: 4 },
      },
      {
        event_type: 'TableLocked',
        stream_id: 'T1',
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { table_id: 'T1', seating_id, staff_id: 'S_ALI' },
      },
    ]);
    expect(seatingRows()).toEqual([{ seating_id, primary_table_id: 'T1', state: 'SEATED', holder_staff_id: 'S_ALI', party_size: 4 }]);
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id, staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it('[02a §6.1] party_size is optional: TableOpened carries party_size null', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const r = await open(ali, { table_id: 'T1' });
    expect(r.status).toBe(200);
    expect(tableEvents()[0]!.payload).toEqual({ table_id: 'T1', seating_id: r.result!.seating_id, holder_staff_id: 'S_ALI', party_size: null });
    expect(r.result!.opened).toBe(true);
  });

  it('[02a §6.1] party_size on an already-open seating is ignored (owner 2026-11-10, Q3)', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    const r = await open(ali, { table_id: 'T1', seating_id: 'SEAT1', party_size: 6 });
    expect(r.status).toBe(200);
    expect(r.eventTypes).toEqual(['TableLocked']);
    expect(r.result!.opened).toBe(true);
    expect(seatingRows()).toMatchObject([{ seating_id: 'SEAT1', party_size: null }]);
  });

  it('[02a #2] open again on the same device → no event, opened: false; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const first = await open(ali, { table_id: 'T1' });
    const seating_id = first.result!.seating_id;
    const counted = countHandle();
    const again = await open(ali, { table_id: 'T1', seating_id });
    counted.restore();
    expect(again.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(again.eventTypes).toEqual([]);
    expect(again.result).toEqual({ seating_id, primary_table_id: 'T1', opened: false, holder_staff_id: 'S_ALI' });
    expect(tableEvents()).toHaveLength(2);
  });

  it('[02a #3 open] same staff, other device → TableLocked { replaced_device_id } (T15); the lock moves', async () => {
    await setUp();
    const phone = signIn('S_ALI');
    const first = await open(phone, { table_id: 'T1' });
    const seating_id = first.result!.seating_id;
    const tablet = signIn('S_ALI');
    const counted = countHandle();
    const r = await open(tablet, { table_id: 'T1', seating_id });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.eventTypes).toEqual(['TableLocked']);
    expect(r.result).toEqual({ seating_id, primary_table_id: 'T1', opened: true, holder_staff_id: 'S_ALI' });
    expect(tableEvents()[2]).toEqual({
      event_type: 'TableLocked',
      stream_id: 'T1',
      actor_id: 'S_ALI',
      device_id: tablet.deviceId,
      payload: { table_id: 'T1', seating_id, staff_id: 'S_ALI', replaced_device_id: phone.deviceId },
    });
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id, staff_id: 'S_ALI', device_id: tablet.deviceId }]);
  });

  it('[02a #4] other staff → 409 TABLE_ALREADY_LOCKED with the locker name; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const bilal = signIn('S_BILAL');
    const first = await open(ali, { table_id: 'T1' });
    const seating_id = first.result!.seating_id;
    const counted = countHandle();
    const r = await open(bilal, { table_id: 'T1', seating_id });
    counted.restore();
    expect(r.status).toBe(409);
    expect(counted.calls).toEqual([1]);
    expect(r.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_ALI', locked_by_name: 'Ali' },
    });
    expect(tableEvents()).toHaveLength(2);
  });

  it('[02a §6.1] holder = caller, lock held by other staff → 409 TABLE_ALREADY_LOCKED', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_BILAL', 'DEV_B');
    const r = await open(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(r.status).toBe(409);
    expect(r.error).toEqual({
      code: 'TABLE_ALREADY_LOCKED',
      details: { table_id: 'T1', locked_by_staff_id: 'S_BILAL', locked_by_name: 'Bilal' },
    });
  });

  it('[02a §6.1] open seating, unlocked, holder = caller → TableLocked; opened: true (owner 2026-11-10)', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T1', 'S_ALI');
    const counted = countHandle();
    const r = await open(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.eventTypes).toEqual(['TableLocked']);
    expect(r.result).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T1', opened: true, holder_staff_id: 'S_ALI' });
    expect(tableEvents()[0]!.payload).toEqual({ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI' });
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it('[02a #5] holder ≠ caller: no take-order-anywhere → 403; requires_approval → 403 (§3.15); allowed → lock, holder kept', async () => {
    await setUp();
    const noor = signIn('S_NOOR');
    const sara = signIn('S_SARA');
    const bilal = signIn('S_BILAL');
    seat('SEAT1', 'T1', 'S_ALI');
    for (const who of [noor, sara]) {
      const counted = countHandle();
      const denied = await open(who, { table_id: 'T1', seating_id: 'SEAT1' });
      counted.restore();
      expect(denied.status).toBe(403);
      expect(counted.calls).toEqual([1]);
      expect(denied.error).toEqual({
        code: 'PERMISSION_DENIED',
        details: { reason: 'not_holder', table_id: 'T1', assigned_staff_id: null, holder_staff_id: 'S_ALI' },
      });
    }
    expect(lockRows()).toEqual([]);
    const counted = countHandle();
    const r = await open(bilal, { table_id: 'T1', seating_id: 'SEAT1' });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.eventTypes).toEqual(['TableLocked']);
    expect(r.result).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T1', opened: true, holder_staff_id: 'S_ALI' });
    expect(tableEvents()[0]).toMatchObject({ actor_id: 'S_BILAL', payload: { table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_BILAL' } });
    expect(lockRows()).toEqual([{ table_id: 'T1', seating_id: 'SEAT1', staff_id: 'S_BILAL', device_id: bilal.deviceId }]);
    expect(seatingRows()).toMatchObject([{ seating_id: 'SEAT1', holder_staff_id: 'S_ALI' }]);
  });

  it('[02a §6.1] holder ≠ caller with take-order-anywhere: own lock here → no event; own other device → moves; other staff → 409', async () => {
    await setUp();
    const bilal = signIn('S_BILAL');
    seat('SEAT1', 'T1', 'S_ALI');
    lock('T1', 'SEAT1', 'S_BILAL', bilal.deviceId);
    const mine = await open(bilal, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(mine.status).toBe(200);
    expect(mine.eventTypes).toEqual([]);
    expect(mine.result).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T1', opened: false, holder_staff_id: 'S_ALI' });
    seat('SEAT2', 'T2', 'S_ALI');
    lock('T2', 'SEAT2', 'S_BILAL', 'DEV_B_OLD');
    const moved = await open(bilal, { table_id: 'T2', seating_id: 'SEAT2' });
    expect(moved.status).toBe(200);
    expect(moved.eventTypes).toEqual(['TableLocked']);
    expect(moved.result).toEqual({ seating_id: 'SEAT2', primary_table_id: 'T2', opened: true, holder_staff_id: 'S_ALI' });
    expect(tableEvents()[0]!.payload).toEqual({ table_id: 'T2', seating_id: 'SEAT2', staff_id: 'S_BILAL', replaced_device_id: 'DEV_B_OLD' });
    seat('SEAT3', 'T3', 'S_ALI');
    lock('T3', 'SEAT3', 'S_ALI', 'DEV_A');
    const other = await open(bilal, { table_id: 'T3', seating_id: 'SEAT3' });
    expect(other.status).toBe(409);
    expect(other.error).toEqual({ code: 'TABLE_ALREADY_LOCKED', details: { table_id: 'T3', locked_by_staff_id: 'S_ALI', locked_by_name: 'Ali' } });
  });

  it('[02a #6] two opens on one FREE table → one seating', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const bilal = signIn('S_BILAL');
    const [a, b] = await Promise.all([open(ali, { table_id: 'T1' }), open(bilal, { table_id: 'T1' })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    expect(winner.result!.opened).toBe(true);
    expect(loser.error?.code).toBe('TABLE_ALREADY_LOCKED');
    expect(seatingRows()).toHaveLength(1);
    expect(tableEvents().filter((e) => e.event_type === 'TableOpened')).toHaveLength(1);
    expect(lockRows()).toHaveLength(1);
  });

  it('[02a #39] COMMIT failure during OpenTable → no seating, no lock; the retry opens', async () => {
    let fail = false;
    await setUp({
      beforeCommit() {
        if (fail) throw new Error('forced commit failure');
      },
    });
    const ali = signIn('S_ALI');
    fail = true;
    const failed = await open(ali, { table_id: 'T1' }, 'cmd-commit');
    expect(failed.status).toBe(500);
    expect(seatingRows()).toEqual([]);
    expect(hub.deps.db.prepare('SELECT COUNT(*) FROM seating_tables').pluck().get()).toBe(0);
    expect(lockRows()).toEqual([]);
    expect(tableEvents()).toEqual([]);
    fail = false;
    const retry = await open(ali, { table_id: 'T1' }, 'cmd-commit');
    expect(retry.status).toBe(200);
    expect(retry.result!.opened).toBe(true);
    expect(seatingRows()).toHaveLength(1);
    expect(lockRows()).toHaveLength(1);
  });

  it('[02a #43] open on a joined table locks the primary', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T4', 'S_ALI', { tables: ['T4', 'T5'] });
    const counted = countHandle();
    const r = await open(ali, { table_id: 'T5', seating_id: 'SEAT1' });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.result).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T4', opened: true, holder_staff_id: 'S_ALI' });
    expect(tableEvents()).toEqual([
      {
        event_type: 'TableLocked',
        stream_id: 'T4',
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { table_id: 'T4', seating_id: 'SEAT1', staff_id: 'S_ALI' },
      },
    ]);
    expect(lockRows()).toEqual([{ table_id: 'T4', seating_id: 'SEAT1', staff_id: 'S_ALI', device_id: ali.deviceId }]);
  });

  it('[02a #56] OpenTable { seating_id: S } on a FREE table (S cleaned) → TABLE_SEATING_CHANGED; without seating_id → new seating', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const counted = countHandle();
    const stale = await open(ali, { table_id: 'T1', seating_id: 'SEAT_CLEANED' });
    counted.restore();
    expect(stale.status).toBe(409);
    expect(counted.calls).toEqual([1]);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_CLEANED' } });
    expect(tableEvents()).toEqual([]);
    const fresh = await open(ali, { table_id: 'T1' });
    expect(fresh.status).toBe(200);
    expect(fresh.result!.opened).toBe(true);
    expect(fresh.result!.seating_id).not.toBe('SEAT_CLEANED');
  });

  it('[02a §6.1] stale seating_id on an open seating → 409 TABLE_SEATING_CHANGED (T18), before NEEDS_CLEANING', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT2', 'T1', 'S_ALI', { state: 'NEEDS_CLEANING' });
    const counted = countHandle();
    const r = await open(ali, { table_id: 'T1', seating_id: 'SEAT1' });
    counted.restore();
    expect(r.status).toBe(409);
    expect(counted.calls).toEqual([1]);
    expect(r.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT1' } });
  });

  it('[02a §6.1] NEEDS_CLEANING → 409 TABLE_NEEDS_CLEANING, with or without seating_id; holder or not', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const noor = signIn('S_NOOR');
    seat('SEAT1', 'T1', 'S_ALI', { state: 'NEEDS_CLEANING' });
    for (const [who, payload] of [
      [ali, { table_id: 'T1', seating_id: 'SEAT1' }],
      [ali, { table_id: 'T1' }],
      [noor, { table_id: 'T1' }],
    ] as const) {
      const counted = countHandle();
      const r = await open(who, payload);
      counted.restore();
      expect(r.status).toBe(409);
      expect(counted.calls).toEqual([1]);
      expect(r.error).toEqual({ code: 'TABLE_NEEDS_CLEANING', details: { table_id: 'T1' } });
    }
    expect(lockRows()).toEqual([]);
  });

  it('[02a §3.14] FREE archived table (absent from the config, AD-2) and an unknown id → 404 TABLE_NOT_FOUND; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    for (const table_id of ['T_OLD', 'T_NOPE']) {
      const counted = countHandle();
      const r = await open(ali, { table_id });
      counted.restore();
      expect(r.status).toBe(404);
      expect(counted.calls).toEqual([1]);
      expect(r.error).toEqual({ code: 'TABLE_NOT_FOUND', details: { table_id } });
    }
    expect(seatingRows()).toEqual([]);
    expect(tableEvents()).toEqual([]);
  });

  it('[02a §3.14] an archived table that still has a seating opens through seating_tables', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T_OLD', 'S_ALI');
    const r = await open(ali, { table_id: 'T_OLD', seating_id: 'SEAT1' });
    expect(r.status).toBe(200);
    expect(r.eventTypes).toEqual(['TableLocked']);
    expect(r.result).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T_OLD', opened: true, holder_staff_id: 'S_ALI' });
  });

  it('[02a §6.1] D32 retransmit: same command_id → same response, no new event', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const first = await open(ali, { table_id: 'T1' }, 'cmd-once');
    hub.clock.advance(5_000);
    const replay = await open(ali, { table_id: 'T1' }, 'cmd-once');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.result!.opened).toBe(true);
    expect(tableEvents()).toHaveLength(2);
    expect(seatingRows()).toHaveLength(1);
  });

  it('[02a §6.1] scope (C8, last): take-order my_floors opens a FREE table on his floor; another floor → 403 outside_scope', async () => {
    await setUp();
    const faiz = signIn('S_FAIZ');
    const counted = countHandle();
    const out = await open(faiz, { table_id: 'T9' });
    counted.restore();
    expect(out.status).toBe(403);
    expect(counted.calls).toEqual([1]);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    expect(seatingRows()).toEqual([]);
    const inside = await open(faiz, { table_id: 'T1' });
    expect(inside.status).toBe(200);
    expect(inside.result!.opened).toBe(true);
  });

  it('[02a §6.1] scope (C8, last): take-order-anywhere my_floors takes a lock on his floor; another floor → 403 outside_scope after the lock checks', async () => {
    await setUp();
    const zain = signIn('S_ZAIN');
    seat('SEAT1', 'T1', 'S_ALI');
    const inside = await open(zain, { table_id: 'T1', seating_id: 'SEAT1' });
    expect(inside.status).toBe(200);
    expect(inside.eventTypes).toEqual(['TableLocked']);
    expect(inside.result).toEqual({ seating_id: 'SEAT1', primary_table_id: 'T1', opened: true, holder_staff_id: 'S_ALI' });
    seat('SEAT9', 'T9', 'S_ALI');
    const counted = countHandle();
    const out = await open(zain, { table_id: 'T9', seating_id: 'SEAT9' });
    counted.restore();
    expect(out.status).toBe(403);
    expect(counted.calls).toEqual([1]);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    // the lock checks come first: a lock by another staff answers 409 even outside the scope
    lock('T9', 'SEAT9', 'S_ALI', 'DEV_A');
    const locked = await open(zain, { table_id: 'T9', seating_id: 'SEAT9' });
    expect(locked.status).toBe(409);
    expect(locked.error?.code).toBe('TABLE_ALREADY_LOCKED');
  });
});
