import { fileURLToPath } from 'node:url';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aDevicePaired, aDeviceRevoked, aSessionEnded, aSessionStarted } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry, type Projection, type ProjectionRegistry } from '../../src/projections/registry';
import { freshDb } from '../helpers/db';
import { createTestHub } from '../helpers/test-hub';

// 01d §3.7, §5.2 row 4, BF-3: the device_bindings projection (which person a device is bound to).
const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const TENANT = 'tenant-1';
const BRANCH = 'branch-1';
const ALI = 'S_ALI';
const BILAL = 'S_BILAL';
const OWNER = 'S_OWNER';
const TAB = 'dev-tab';
const TAB2 = 'dev-tab2';
const KIOSK = 'dev-kiosk';
const KDS = 'dev-kds';
const PHONE = 'dev-phone';

interface Counted {
  event_type: string;
  reads: number;
  total: number;
}

interface Harness {
  db: Database.Database;
  clock: ReturnType<typeof fixedClock>;
  counted: Counted[];
  append(...events: PosEvent[]): void;
}

interface BindingRow {
  device_id: string;
  staff_id: string;
  session_id: string | null;
  since: number;
}

function draft(event: PosEvent): EventDraft {
  return {
    stream_type: event.stream_type,
    stream_id: event.stream_id,
    event_type: event.event_type,
    schema_version: event.schema_version,
    payload: event.payload,
    occurred_at: event.occurred_at,
    actor_id: event.actor_id,
    device_id: event.device_id,
  };
}

function paired(deviceId: string, type: 'tablet' | 'cashier_kiosk' | 'kds' | 'phone', owner: string | null = null): PosEvent {
  return aDevicePaired({
    stream_id: deviceId,
    payload: {
      device_id: deviceId,
      device_type: type,
      station_id: type === 'kds' ? 'ST_GRILL' : null,
      owner_staff_id: type === 'phone' ? owner : null,
    },
  });
}

function started(sessionId: string, deviceId: string, staffId: string | null, kind: 'staff' | 'station' | 'admin' = 'staff'): PosEvent {
  return aSessionStarted({
    stream_type: kind === 'station' ? 'station' : 'staff',
    stream_id: staffId ?? 'ST_GRILL',
    payload: {
      session_id: sessionId,
      kind,
      staff_id: staffId,
      station_id: kind === 'station' ? 'ST_GRILL' : null,
      device_id: deviceId,
      idle_ttl_ms: kind === 'station' ? null : 300_000,
    },
  });
}

function ended(sessionId: string, staffId: string | null, reason: string, kind: 'staff' | 'station' = 'staff'): PosEvent {
  return aSessionEnded({
    stream_type: kind === 'station' ? 'station' : 'staff',
    stream_id: staffId ?? 'ST_GRILL',
    payload: { session_id: sessionId, kind, staff_id: staffId, station_id: kind === 'station' ? 'ST_GRILL' : null, reason },
  });
}

function revoked(deviceId: string): PosEvent {
  return aDeviceRevoked({ stream_id: deviceId, payload: { device_id: deviceId } });
}

// Counts the statements (and the reading ones) run while the device_bindings projection's apply is on
// the stack, as task 14's projection tests do with the hub's statementCounter idea.
function countingRegistry(db: Database.Database, counted: Counted[]): ProjectionRegistry {
  const registry = createProjectionRegistry();
  let current: Counted | null = null;
  const prepare = db.prepare.bind(db);
  db.prepare = ((sql: string) => {
    const statement = prepare(sql);
    const wrap =
      <A extends unknown[], R>(original: (...args: A) => R) =>
      (...args: A): R => {
        if (current !== null) {
          current.total += 1;
          if (statement.reader) current.reads += 1;
        }
        return original(...args);
      };
    statement.get = wrap(statement.get.bind(statement));
    statement.all = wrap(statement.all.bind(statement));
    statement.run = wrap(statement.run.bind(statement));
    return statement;
  }) as typeof db.prepare;
  const register = registry.register.bind(registry);
  registry.register = (projection: Projection) => {
    if (projection.name !== 'device_bindings') return register(projection);
    register({
      ...projection,
      apply(tx, event, mode) {
        const entry: Counted = { event_type: event.event_type, reads: 0, total: 0 };
        current = entry;
        try {
          projection.apply(tx, event, mode);
        } finally {
          current = null;
          counted.push(entry);
        }
      },
    });
  };
  return registry;
}

function writerOn(db: Database.Database, clock: ReturnType<typeof fixedClock>, registry: ProjectionRegistry) {
  const state = createStateHolder({});
  state.setReducer((current) => current);
  return createWriter({
    db,
    clock,
    ids: testIdGen(),
    tenantId: TENANT,
    branchId: BRANCH,
    projections: registry,
    state,
    authGeneration: createAuthGeneration(),
    publish: () => undefined,
  });
}

async function harness(cleanups: Array<() => void>): Promise<Harness> {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  const clock = fixedClock(T);
  await runMigrations(fx.db, { dir: migrations, clock });
  const counted: Counted[] = [];
  const registry = countingRegistry(fx.db, counted);
  registerAlertProjections(registry);
  const writer = writerOn(fx.db, clock, registry);
  return {
    db: fx.db,
    clock,
    counted,
    append(...events) {
      writer.run((tx) => tx.append(events.map(draft)));
    },
  };
}

function bindings(db: Database.Database): BindingRow[] {
  return db.prepare('SELECT device_id, staff_id, session_id, since FROM device_bindings ORDER BY device_id').all() as BindingRow[];
}

function binding(db: Database.Database, deviceId: string): BindingRow | undefined {
  return db.prepare('SELECT device_id, staff_id, session_id, since FROM device_bindings WHERE device_id = ?').get(deviceId) as
    | BindingRow
    | undefined;
}

function insertDevice(db: Database.Database, deviceId: string, type: string, o: { station?: string; owner?: string } = {}): void {
  db.prepare(
    `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S_ADMIN')`,
  ).run(deviceId, BRANCH, `hash-${deviceId}`, deviceId, type, o.station ?? null, o.owner ?? null, T);
}

describe('01d device_bindings projection', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01d #27] sign-in sets the binding with session_id; idle timeout keeps it; logout ends it; an older session’s end does not end a newer binding; takeover moves it', async () => {
    const h = await harness(cleanups);
    h.append(paired(TAB, 'tablet'));
    h.append(started('sess-1', TAB, ALI));
    expect(binding(h.db, TAB)).toEqual({ device_id: TAB, staff_id: ALI, session_id: 'sess-1', since: T });

    h.clock.advance(1_000);
    h.append(ended('sess-1', ALI, 'idle_timeout'));
    expect(binding(h.db, TAB)).toEqual({ device_id: TAB, staff_id: ALI, session_id: 'sess-1', since: T });

    // A newer sign-in on the same device; then the older session's end arrives → the newer binding stays.
    h.append(started('sess-2', TAB, BILAL));
    expect(binding(h.db, TAB)).toEqual({ device_id: TAB, staff_id: BILAL, session_id: 'sess-2', since: T + 1_000 });
    h.append(ended('sess-1', ALI, 'logout'));
    expect(binding(h.db, TAB)).toMatchObject({ staff_id: BILAL, session_id: 'sess-2' });

    // Takeover (00: same device, another person): taken_over end, then the new SessionStarted overwrites.
    h.clock.advance(1_000);
    h.append(ended('sess-2', BILAL, 'taken_over'), started('sess-3', TAB, ALI));
    expect(binding(h.db, TAB)).toEqual({ device_id: TAB, staff_id: ALI, session_id: 'sess-3', since: T + 2_000 });

    h.append(ended('sess-3', ALI, 'logout'));
    expect(binding(h.db, TAB)).toBeUndefined();
  });

  it('[01d #27] phone → its owner (session_id null); a SessionStarted plus logout on the phone leave the owner row (m2)', async () => {
    const h = await harness(cleanups);
    h.append(paired(PHONE, 'phone', OWNER));
    const owner = { device_id: PHONE, staff_id: OWNER, session_id: null, since: T };
    expect(binding(h.db, PHONE)).toEqual(owner);
    h.clock.advance(1_000);
    h.append(started('sess-p', PHONE, ALI));
    expect(binding(h.db, PHONE)).toEqual(owner);
    h.append(ended('sess-p', ALI, 'logout'));
    expect(binding(h.db, PHONE)).toEqual(owner);
    h.append(aBusinessDayClosed());
    expect(binding(h.db, PHONE)).toEqual(owner);
    h.append(revoked(PHONE));
    expect(binding(h.db, PHONE)).toBeUndefined();
  });

  it('[01d #27] rebuild: reset + replay gives identical rows; after a simulated cloud-only restore (sessions ended hub_restored) no binding is left', async () => {
    const h = await harness(cleanups);
    h.append(paired(TAB, 'tablet'), paired(TAB2, 'tablet'), paired(PHONE, 'phone', OWNER), paired(KIOSK, 'cashier_kiosk'), paired(KDS, 'kds'));
    h.clock.advance(500);
    h.append(started('s1', TAB, ALI), started('s2', TAB2, BILAL), started('s3', KIOSK, ALI), started('s4', KDS, null, 'station'));
    h.clock.advance(500);
    h.append(ended('s1', ALI, 'idle_timeout'), started('s5', TAB, BILAL), ended('s2', BILAL, 'logout'), started('s6', TAB2, ALI));
    const live = bindings(h.db);
    expect(live.map((row) => [row.device_id, row.staff_id, row.session_id])).toEqual([
      [PHONE, OWNER, null],
      [TAB, BILAL, 's5'],
      [TAB2, ALI, 's6'],
    ]);

    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'device_bindings'`).run();
    h.db.prepare(`INSERT INTO device_bindings (device_id, staff_id, session_id, since) VALUES ('stale', 'S_X', 'sx', 1)`).run();
    const fresh = createProjectionRegistry();
    registerAlertProjections(fresh);
    expect(fresh.catchUp(h.db, BRANCH).replayed.device_bindings).toBeGreaterThan(0);
    expect(bindings(h.db)).toEqual(live);

    // Cloud-only restore (00 M40 step 4b): every open session ends hub_restored, matched by session_id.
    h.append(ended('s5', BILAL, 'hub_restored'), ended('s6', ALI, 'hub_restored'));
    expect(bindings(h.db).filter((row) => row.session_id !== null)).toEqual([]);
    expect(bindings(h.db)).toEqual([{ device_id: PHONE, staff_id: OWNER, session_id: null, since: T }]);
  });

  it('[01d BF-3] a cashier signed in on a kiosk and a station session on a KDS write no device_bindings row; the type map is rebuilt on replay', async () => {
    const h = await harness(cleanups);
    h.append(paired(KIOSK, 'cashier_kiosk'), paired(KDS, 'kds'));
    h.append(started('s-k', KIOSK, ALI), started('s-d', KDS, null, 'station'));
    // A staff session on a KDS (not opened by 00 today) still binds no one: the type decides, not the kind.
    h.append(started('s-d2', KDS, BILAL));
    expect(bindings(h.db)).toEqual([]);

    h.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'device_bindings'`).run();
    const fresh = createProjectionRegistry();
    registerAlertProjections(fresh);
    fresh.catchUp(h.db, BRANCH);
    expect(bindings(h.db)).toEqual([]);
  });

  it('[01d BF-3] type unknown to the projection’s map (no replay since start) → one read of devices by id per SessionStarted, then cached; kiosk still no row', async () => {
    const h = await harness(cleanups);
    insertDevice(h.db, KIOSK, 'cashier_kiosk');
    insertDevice(h.db, TAB, 'tablet');
    insertDevice(h.db, PHONE, 'phone', { owner: OWNER });
    // The hub restarted with every checkpoint at the tip: the projection's in-memory map is empty.
    const counted: Counted[] = [];
    const registry = countingRegistry(h.db, counted);
    registerAlertProjections(registry);
    const writer = writerOn(h.db, h.clock, registry);
    const append = (...events: PosEvent[]) => writer.run((tx) => tx.append(events.map(draft)));

    append(started('s-k', KIOSK, ALI));
    append(started('s-t', TAB, BILAL));
    append(started('s-p', PHONE, ALI));
    append(started('s-k2', KIOSK, BILAL), started('s-t2', TAB, ALI));
    expect(bindings(h.db).map((row) => [row.device_id, row.staff_id, row.session_id])).toEqual([[TAB, ALI, 's-t2']]);
    expect(counted.map((c) => [c.event_type, c.reads, c.total])).toEqual([
      ['SessionStarted', 1, 1], // kiosk: devices read, no write
      ['SessionStarted', 1, 2], // tablet: devices read + upsert
      ['SessionStarted', 1, 1], // phone: devices read, ignored (m2)
      ['SessionStarted', 0, 0], // kiosk again: cached
      ['SessionStarted', 0, 1], // tablet again: cached, upsert
    ]);
  });

  it('[01d §3.7] SessionEnded: idle_timeout / replaced keep the row; taken_over leaves it to the new SessionStarted; the other six delete WHERE session_id = ?', async () => {
    const keep = ['idle_timeout', 'replaced', 'taken_over'];
    const remove = ['logout', 'forced', 'staff_removed', 'credentials_changed', 'device_revoked', 'hub_restored'];
    for (const reason of [...keep, ...remove]) {
      const h = await harness(cleanups);
      h.append(paired(TAB, 'tablet'), paired(TAB2, 'tablet'), paired(PHONE, 'phone', OWNER));
      h.append(started('s1', TAB, ALI), started('s2', TAB2, BILAL));
      h.append(ended('s1', ALI, reason));
      const rows = bindings(h.db).map((row) => [row.device_id, row.session_id]);
      const others = [
        [PHONE, null],
        [TAB2, 's2'],
      ];
      expect({ reason, rows }).toEqual({
        reason,
        rows: keep.includes(reason) ? [others[0], [TAB, 's1'], others[1]] : others,
      });
    }
  });

  it('[01d §3.7] BusinessDayClosed deletes every row with a session_id and keeps phone rows; DeviceRevoked deletes the device’s row', async () => {
    const h = await harness(cleanups);
    h.append(paired(TAB, 'tablet'), paired(TAB2, 'tablet'), paired(PHONE, 'phone', OWNER));
    h.append(started('s1', TAB, ALI), started('s2', TAB2, BILAL));
    h.append(revoked(TAB2));
    expect(bindings(h.db).map((row) => row.device_id)).toEqual([PHONE, TAB]);
    h.append(aBusinessDayClosed());
    expect(bindings(h.db)).toEqual([{ device_id: PHONE, staff_id: OWNER, session_id: null, since: T }]);
  });

  it('[01d §3.7] an admin session binds no one; a station session on an unknown-type device binds no one (no staff)', async () => {
    const h = await harness(cleanups);
    h.append(paired(TAB, 'tablet'));
    h.append(started('s-a', TAB, ALI, 'admin'), started('s-x', 'dev-unknown', null, 'station'));
    expect(bindings(h.db)).toEqual([]);
  });

  it('[01d §3.5 M10] device_bindings reads ≤ 2 statements per event (0 when the type is known)', async () => {
    const h = await harness(cleanups);
    h.append(paired(TAB, 'tablet'), paired(PHONE, 'phone', OWNER), paired(KIOSK, 'cashier_kiosk'));
    h.append(started('s1', TAB, ALI), started('s2', KIOSK, BILAL), ended('s1', ALI, 'logout'), revoked(KIOSK), aBusinessDayClosed());
    for (const c of h.counted) expect({ event: c.event_type, ok: c.reads <= 2 }).toEqual({ event: c.event_type, ok: true });
    expect(h.counted.map((c) => [c.event_type, c.reads, c.total])).toEqual([
      ['DevicePaired', 0, 0],
      ['DevicePaired', 0, 1],
      ['DevicePaired', 0, 0],
      ['SessionStarted', 0, 1],
      ['SessionStarted', 0, 0],
      ['SessionEnded', 0, 1],
      ['DeviceRevoked', 0, 1],
      ['BusinessDayClosed', 0, 1],
    ]);
  });

  it('[01d §5.2] wiring: boot and the test hub register device_bindings (an appended SessionStarted lands)', async () => {
    const hub = await createTestHub();
    cleanups.push(() => void hub.close());
    hub.deps.writer.run((tx) => tx.append([draft(paired('dev-w', 'tablet')), draft(started('s-w', 'dev-w', ALI))]));
    expect(binding(hub.deps.db, 'dev-w')).toMatchObject({ staff_id: ALI, session_id: 's-w' });
  });
});
