import type { DirectoryInput } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/commands/registry';
import { commandRegistry } from '../../src/commands/route';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 02a v1.1.3 §6.2 TouchTableLock (D61), §6.3 ReleaseTableLock, §6.4 ForceReleaseTableLock; §10 #3 (touch), #7, #41 and
// the §10 preamble (retransmit, scope last, stale seating_id). Seatings and locks come from OpenTable through the route.

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
      { role_id: 'R_FORCE', name: 'Force', session_idle_ttl_ms: 3_600_000, permissions: [grant('force-release-table-lock', 'allowed')] },
      {
        role_id: 'R_FORCE_FLOOR',
        name: 'Force on my floors',
        session_idle_ttl_ms: 3_600_000,
        permissions: [grant('force-release-table-lock', 'allowed', 'my_floors')],
      },
      {
        role_id: 'R_FORCE_APPROVAL',
        name: 'Force with approval',
        session_idle_ttl_ms: 3_600_000,
        permissions: [grant('force-release-table-lock', 'requires_approval')],
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
      person('S_MGR', 'Manager', 'R_FORCE'),
      person('S_FMGR', 'Floor manager', 'R_FORCE_FLOOR', ['F1']),
      person('S_AMGR', 'Approval manager', 'R_FORCE_APPROVAL'),
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

/** Counts the statements of each `handle` call of one command path. */
function countHandle(path: string): { calls: number[]; restore(): void } {
  const def = commandRegistry(hub.app).byPath(path) as CommandDef;
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
  result?: Record<string, unknown>;
  eventTypes: string[];
  error?: { code: string; details: Record<string, unknown> };
}

const PATHS = {
  OpenTable: 'open-table',
  TouchTableLock: 'touch-table-lock',
  ReleaseTableLock: 'release-table-lock',
  ForceReleaseTableLock: 'force-release-table-lock',
} as const;

async function send(
  who: Who,
  command_type: keyof typeof PATHS,
  payload: Record<string, unknown>,
  command_id = `cmd-${(commandSeq += 1)}`,
): Promise<Reply> {
  const res = await hub.app.inject({
    method: 'POST',
    url: `/commands/${PATHS[command_type]}`,
    headers: { authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken },
    payload: {
      command_id,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type,
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

/** Opens `table_id` as `who` through OpenTable; returns the seating_id. */
async function openAs(who: Who, table_id: string, seating_id?: string): Promise<string> {
  const r = await send(who, 'OpenTable', seating_id === undefined ? { table_id } : { table_id, seating_id });
  expect(r.status).toBe(200);
  return r.result!.seating_id as string;
}

function lastTouch(): unknown {
  return hub.deps.db.prepare('SELECT last_touch_at FROM table_locks').pluck().get();
}

function eventsOf(type: string): Array<{ actor_id: string; device_id: string; stream_id: string; payload: unknown }> {
  return tableEvents()
    .filter((e) => e.event_type === type)
    .map((e) => ({ stream_id: e.stream_id, actor_id: e.actor_id, device_id: e.device_id, payload: e.payload }));
}

describe('02a TouchTableLock (§6.2, D61)', () => {
  it('[02a #7] first touch writes even within 50 s of the lock; then < 50 000 ms no write; at ≥ 50 000 writes again; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const seating_id = await openAs(ali, 'T1');
    expect(lastTouch()).toBeNull();
    const counted = countHandle('touch-table-lock');
    hub.clock.advance(1_000);
    const first = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(first.status).toBe(200);
    expect(first.result).toEqual({ touched: true });
    expect(first.eventTypes).toEqual(['TableLockTouched']);
    const touchedAt = lastTouch() as number;
    expect(touchedAt).toBeGreaterThan(0);
    hub.clock.advance(49_999);
    const within = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(within.result).toEqual({ touched: false });
    expect(within.eventTypes).toEqual([]);
    expect(lastTouch()).toBe(touchedAt);
    hub.clock.advance(1);
    const again = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id });
    counted.restore();
    expect(again.result).toEqual({ touched: true });
    expect(again.eventTypes).toEqual(['TableLockTouched']);
    expect(lastTouch()).toBe(touchedAt + 50_000);
    expect(counted.calls).toEqual([1, 1, 1]);
    expect(eventsOf('TableLockTouched')).toEqual([
      { stream_id: 'T1', actor_id: 'S_ALI', device_id: ali.deviceId, payload: { table_id: 'T1', seating_id } },
      { stream_id: 'T1', actor_id: 'S_ALI', device_id: ali.deviceId, payload: { table_id: 'T1', seating_id } },
    ]);
  });

  it('[02a #3 touch] same staff opens on device 2 (lock moves); Touch from device 1 → 409 TABLE_LOCK_NOT_HELD', async () => {
    await setUp();
    const phone = signIn('S_ALI');
    const seating_id = await openAs(phone, 'T1');
    const tablet = signIn('S_ALI');
    await openAs(tablet, 'T1', seating_id);
    const old = await send(phone, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(old.status).toBe(409);
    expect(old.error).toEqual({ code: 'TABLE_LOCK_NOT_HELD', details: { table_id: 'T1' } });
    const ok = await send(tablet, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(ok.result).toEqual({ touched: true });
    expect(eventsOf('TableLockTouched')).toHaveLength(1);
  });

  it('[02a §6.2] other staff, or no lock → 409 TABLE_LOCK_NOT_HELD', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const bilal = signIn('S_BILAL');
    const seating_id = await openAs(ali, 'T1');
    const other = await send(bilal, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(other.status).toBe(409);
    expect(other.error?.code).toBe('TABLE_LOCK_NOT_HELD');
    hub.deps.db.prepare('DELETE FROM table_locks').run();
    const none = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(none.status).toBe(409);
    expect(none.error).toEqual({ code: 'TABLE_LOCK_NOT_HELD', details: { table_id: 'T1' } });
    expect(eventsOf('TableLockTouched')).toEqual([]);
  });

  it('[02a §6.2] stale seating_id, or no seating → 409 TABLE_SEATING_CHANGED; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    await openAs(ali, 'T1');
    const counted = countHandle('touch-table-lock');
    const stale = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id: 'SEAT_OLD' });
    const free = await send(ali, 'TouchTableLock', { table_id: 'T2', seating_id: 'SEAT_OLD' });
    counted.restore();
    expect(counted.calls).toEqual([1, 1]);
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
    expect(free.status).toBe(409);
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: 'SEAT_OLD' } });
  });

  it('[02a §6.2] on a joined table the touch is written to the primary', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T4', 'S_ALI', { tables: ['T4', 'T5'] });
    await openAs(ali, 'T5', 'SEAT1');
    const r = await send(ali, 'TouchTableLock', { table_id: 'T5', seating_id: 'SEAT1' });
    expect(r.result).toEqual({ touched: true });
    expect(eventsOf('TableLockTouched')).toMatchObject([{ stream_id: 'T4', payload: { table_id: 'T4', seating_id: 'SEAT1' } }]);
  });

  it('[02a §6.2] NEEDS_CLEANING does not block (§12.2 lists no TABLE_NEEDS_CLEANING for 6.2)', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const seating_id = await openAs(ali, 'T1');
    hub.deps.db.prepare(`UPDATE seatings SET state = 'NEEDS_CLEANING'`).run();
    const r = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ touched: true });
  });

  it('[02a §6.2] D32 retransmit: same command_id → same response, no new event', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const seating_id = await openAs(ali, 'T1');
    const first = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id }, 'cmd-touch');
    hub.clock.advance(60_000);
    const replay = await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id }, 'cmd-touch');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(eventsOf('TableLockTouched')).toHaveLength(1);
  });

  it('[02a §6.2] payload must carry seating_id and nothing else → 400', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    await openAs(ali, 'T1');
    expect((await send(ali, 'TouchTableLock', { table_id: 'T1' })).status).toBe(400);
    expect((await send(ali, 'TouchTableLock', { table_id: 'T1', seating_id: 'x', extra: 1 })).status).toBe(400);
  });
});

describe('02a ReleaseTableLock (§6.3)', () => {
  it('[02a §6.3] held by (caller, device) → TableLockReleased { reason: released }; the lock is gone; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const seating_id = await openAs(ali, 'T1');
    const counted = countHandle('release-table-lock');
    const r = await send(ali, 'ReleaseTableLock', { table_id: 'T1', seating_id });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.result).toEqual({ released: true });
    expect(r.eventTypes).toEqual(['TableLockReleased']);
    expect(eventsOf('TableLockReleased')).toEqual([
      {
        stream_id: 'T1',
        actor_id: 'S_ALI',
        device_id: ali.deviceId,
        payload: { table_id: 'T1', seating_id, staff_id: 'S_ALI', reason: 'released' },
      },
    ]);
    expect(lockRows()).toEqual([]);
    expect(seatingRows()).toMatchObject([{ seating_id, state: 'SEATED' }]);
  });

  it('[02a §6.3] not (caller, device) → released: false, no event: other device, other staff, no lock', async () => {
    await setUp();
    const phone = signIn('S_ALI');
    const seating_id = await openAs(phone, 'T1');
    const tablet = signIn('S_ALI');
    const bilal = signIn('S_BILAL');
    for (const who of [tablet, bilal]) {
      const r = await send(who, 'ReleaseTableLock', { table_id: 'T1', seating_id });
      expect(r.status).toBe(200);
      expect(r.result).toEqual({ released: false });
      expect(r.eventTypes).toEqual([]);
    }
    expect(lockRows()).toHaveLength(1);
    await send(phone, 'ReleaseTableLock', { table_id: 'T1', seating_id });
    const none = await send(phone, 'ReleaseTableLock', { table_id: 'T1', seating_id });
    expect(none.result).toEqual({ released: false });
    expect(eventsOf('TableLockReleased')).toHaveLength(1);
  });

  it('[02a §6.3] stale seating_id, or no seating → 409 TABLE_SEATING_CHANGED; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    await openAs(ali, 'T1');
    const counted = countHandle('release-table-lock');
    const stale = await send(ali, 'ReleaseTableLock', { table_id: 'T1', seating_id: 'SEAT_OLD' });
    const free = await send(ali, 'ReleaseTableLock', { table_id: 'T2', seating_id: 'SEAT_OLD' });
    counted.restore();
    expect(counted.calls).toEqual([1, 1]);
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: 'SEAT_OLD' } });
    expect(lockRows()).toHaveLength(1);
  });

  it('[02a §6.3] on a joined table the release is written to the primary', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    seat('SEAT1', 'T4', 'S_ALI', { tables: ['T4', 'T5'] });
    await openAs(ali, 'T5', 'SEAT1');
    const r = await send(ali, 'ReleaseTableLock', { table_id: 'T5', seating_id: 'SEAT1' });
    expect(r.result).toEqual({ released: true });
    expect(eventsOf('TableLockReleased')).toMatchObject([{ stream_id: 'T4', payload: { table_id: 'T4', seating_id: 'SEAT1' } }]);
    expect(lockRows()).toEqual([]);
  });

  it('[02a §6.3] D32 retransmit: same command_id → same response, no new event', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const seating_id = await openAs(ali, 'T1');
    const first = await send(ali, 'ReleaseTableLock', { table_id: 'T1', seating_id }, 'cmd-rel');
    const replay = await send(ali, 'ReleaseTableLock', { table_id: 'T1', seating_id }, 'cmd-rel');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.result).toEqual({ released: true });
    expect(eventsOf('TableLockReleased')).toHaveLength(1);
  });
});

describe('02a ForceReleaseTableLock (§6.4)', () => {
  it('[02a #41] releases another staff\'s lock: TableLockReleased { reason: force, by_staff_id, note } on the primary; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const mgr = signIn('S_MGR');
    const seating_id = await openAs(ali, 'T1');
    const counted = countHandle('force-release-table-lock');
    const r = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: 'Ali left the floor' });
    counted.restore();
    expect(r.status).toBe(200);
    expect(counted.calls).toEqual([1]);
    expect(r.result).toEqual({ released: true });
    expect(r.eventTypes).toEqual(['TableLockReleased']);
    expect(eventsOf('TableLockReleased')).toEqual([
      {
        stream_id: 'T1',
        actor_id: 'S_MGR',
        device_id: mgr.deviceId,
        payload: { table_id: 'T1', seating_id, staff_id: 'S_ALI', reason: 'force', by_staff_id: 'S_MGR', note: 'Ali left the floor' },
      },
    ]);
    expect(lockRows()).toEqual([]);
    const reopened = await openAs(ali, 'T1', seating_id);
    expect(reopened).toBe(seating_id);
  });

  it('[02a #41] no lock → released: false, no event', async () => {
    await setUp();
    const mgr = signIn('S_MGR');
    seat('SEAT1', 'T1', 'S_ALI');
    const r = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id: 'SEAT1', reason: 'check' });
    expect(r.status).toBe(200);
    expect(r.result).toEqual({ released: false });
    expect(r.eventTypes).toEqual([]);
    expect(eventsOf('TableLockReleased')).toEqual([]);
  });

  it('[02a §6.4] stale seating_id, or no seating → 409 TABLE_SEATING_CHANGED; 1 statement', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const mgr = signIn('S_MGR');
    await openAs(ali, 'T1');
    const counted = countHandle('force-release-table-lock');
    const stale = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id: 'SEAT_OLD', reason: 'x' });
    const free = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T2', seating_id: 'SEAT_OLD', reason: 'x' });
    counted.restore();
    expect(counted.calls).toEqual([1, 1]);
    expect(stale.status).toBe(409);
    expect(stale.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T1', seating_id: 'SEAT_OLD' } });
    expect(free.error).toEqual({ code: 'TABLE_SEATING_CHANGED', details: { table_id: 'T2', seating_id: 'SEAT_OLD' } });
    expect(lockRows()).toHaveLength(1);
  });

  it('[02a §6.4] scope (C8, last): my_floors releases on his floor; another floor → 403 outside_scope, lock kept', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const fmgr = signIn('S_FMGR');
    const s1 = await openAs(ali, 'T1');
    const s9 = await openAs(ali, 'T9');
    const counted = countHandle('force-release-table-lock');
    const out = await send(fmgr, 'ForceReleaseTableLock', { table_id: 'T9', seating_id: s9, reason: 'x' });
    counted.restore();
    expect(counted.calls).toEqual([1]);
    expect(out.status).toBe(403);
    expect(out.error).toEqual({ code: 'PERMISSION_DENIED', details: { reason: 'outside_scope', table_ids: ['T9'] } });
    expect(lockRows()).toHaveLength(2);
    // a stale seating answers 409 before the scope check
    const stale = await send(fmgr, 'ForceReleaseTableLock', { table_id: 'T9', seating_id: 'SEAT_OLD', reason: 'x' });
    expect(stale.error?.code).toBe('TABLE_SEATING_CHANGED');
    const inside = await send(fmgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id: s1, reason: 'x' });
    expect(inside.status).toBe(200);
    expect(inside.result).toEqual({ released: true });
    expect(lockRows()).toHaveLength(1);
  });

  it('[02a §6.4] without the permission, or with requires_approval → 403 (no event, lock kept)', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const noor = signIn('S_NOOR');
    const amgr = signIn('S_AMGR');
    const seating_id = await openAs(ali, 'T1');
    for (const who of [noor, amgr]) {
      const r = await send(who, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: 'x' });
      expect(r.status).toBe(403);
      expect(r.error?.code).toBe('PERMISSION_DENIED');
    }
    expect(lockRows()).toHaveLength(1);
    expect(eventsOf('TableLockReleased')).toEqual([]);
  });

  it('[02a §6.4] reason is required, 1–120 characters → 400', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const mgr = signIn('S_MGR');
    const seating_id = await openAs(ali, 'T1');
    expect((await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id })).status).toBe(400);
    expect((await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: '' })).status).toBe(400);
    expect((await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: 'x'.repeat(121) })).status).toBe(400);
    const ok = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: 'x'.repeat(120) });
    expect(ok.status).toBe(200);
  });

  it('[02a §6.4] D32 retransmit: same command_id → same response, no new event', async () => {
    await setUp();
    const ali = signIn('S_ALI');
    const mgr = signIn('S_MGR');
    const seating_id = await openAs(ali, 'T1');
    const first = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: 'x' }, 'cmd-force');
    const replay = await send(mgr, 'ForceReleaseTableLock', { table_id: 'T1', seating_id, reason: 'x' }, 'cmd-force');
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.result).toEqual({ released: true });
    expect(eventsOf('TableLockReleased')).toHaveLength(1);
  });
});
