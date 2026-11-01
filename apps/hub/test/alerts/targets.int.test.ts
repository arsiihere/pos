import { fileURLToPath } from 'node:url';
import { DomainError } from '@pos/domain';
import type { EventDraft, PosEvent } from '@pos/events';
import { aBusinessDayClosed, aPresenceSet } from '@pos/events/testing';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { StepDef } from '../../src/alerts/kinds';
import { resolveStep, resolveTargets, type AlertRow, type BatchReads } from '../../src/alerts/targets';
import { StaffDirectory } from '../../src/auth/staff-directory';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter, type WriterTx } from '../../src/engine-host/writer';
import { fixedClock, T } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { registerAlertProjections } from '../../src/projections/alerts';
import { createProjectionRegistry } from '../../src/projections/registry';
import type { WsHub } from '../../src/ws/server';
import { freshDb } from '../helpers/db';
import { statementCounter } from '../helpers/statement-counter';
import { fakePoint, fakeTableOwner, registerFakes, resetFakes } from './fakes';

// 01d §3.4, §3.4.1, BF-8 on a migrated hub database: presence_today from PresenceSet events, always_on from
// `devices`, and the batch-shaped test resolvers (fakeTableOwner, fakePoint) inside a writer transaction.
// batchReads' body is task 18; this file reads the rows it needs by hand (readsFrom).

const migrations = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const BRANCH = 'branch-1';
const KAMRAN = 'S_KAMRAN';
const ALI = 'S_ALI';
const BILAL = 'S_BILAL';
const HAMZA = 'S_HAMZA';
const ws = {} as WsHub;

const dir = StaffDirectory.fromInput({
  directory_version: 1,
  roles: [{ role_id: 'R1', name: 'r', session_idle_ttl_ms: 300_000, permissions: [] }],
  staff: [KAMRAN, ALI, BILAL, HAMZA].map((staff_id) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: 'h',
    role_ids: ['R1'],
    denied_permissions: [],
    lead_staff_id: staff_id === KAMRAN ? null : KAMRAN,
    floor_ids: [],
  })),
  responsibilities: [],
});

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

async function harness(cleanups: Array<() => void>) {
  const fx = freshDb();
  cleanups.push(fx.cleanup);
  const clock = fixedClock(T);
  await runMigrations(fx.db, { dir: migrations, clock });
  const registry = createProjectionRegistry();
  registerAlertProjections(registry);
  const state = createStateHolder({});
  state.setReducer((current) => current);
  const writer = createWriter({
    db: fx.db,
    clock,
    ids: testIdGen(),
    tenantId: 'tenant-1',
    branchId: BRANCH,
    projections: registry,
    state,
    authGeneration: createAuthGeneration(),
    publish: () => undefined,
  });
  return { db: fx.db, clock, writer };
}

function insertDevice(db: Database.Database, deviceId: string, type: string, o: { station?: string; owner?: string; revoked?: boolean } = {}): void {
  db.prepare(
    `INSERT INTO devices (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id, paired_at, paired_by, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'S_ADMIN', ?)`,
  ).run(deviceId, BRANCH, `hash-${deviceId}`, deviceId, type, o.station ?? null, o.owner ?? null, T, o.revoked === true ? T : null);
}

// Hand-built BatchReads (task 18 builds the real one): presence_today and devices not revoked.
function readsFrom(db: Database.Database, resolved: BatchReads['resolved'] = new Map()): BatchReads {
  const presence = db.prepare('SELECT staff_id, present FROM presence_today').all() as Array<{ staff_id: string; present: number }>;
  const devices = db.prepare('SELECT device_id, device_type FROM devices WHERE revoked_at IS NULL ORDER BY device_id').all() as BatchReads['devices'];
  return {
    sessions: [],
    bindings: [],
    devices,
    presence: new Map(presence.map((row) => [row.staff_id, row.present === 1])),
    activity: new Map(),
    prevRecipients: new Map(),
    resolved,
  };
}

function alert(over: Partial<AlertRow> = {}): AlertRow {
  return {
    alert_id: 'A1',
    kind: 't_point_like',
    requester_staff_id: null,
    target: { kind: 'always_on' },
    values: {},
    request: null,
    step: -1,
    raised_at: T,
    ...over,
  };
}

const raisedStep: StepDef = { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] };
const presence = (staff_ids: string[], present: boolean) =>
  aPresenceSet({ payload: { business_day_id: '01J00000000000000000000012', staff_ids, present, set_by: KAMRAN } });

describe('01d targets on the hub database', () => {
  const cleanups: Array<() => void> = [];
  beforeEach(() => registerFakes());
  afterEach(() => {
    resetFakes();
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('[01d #1] table_team via the registered fakeTableOwner: depth direct and owner, one call, one statement', async () => {
    const h = await harness(cleanups);
    fakeTableOwner.owners.set('T12', KAMRAN);
    fakeTableOwner.owners.set('T14', HAMZA);
    const counter = statementCounter(h.db);
    const { result } = h.writer.run((tx: WriterTx) => {
      counter.reset();
      const resolved = resolveTargets(tx, [
        { kind: 'table_team', table_id: 'T12' },
        { kind: 'table_team', table_id: 'T12', depth: 'owner' },
        { kind: 'table_team', table_id: 'T14' },
        { kind: 'table_team', table_id: 'T99' },
      ]);
      const statements = counter.count;
      const reads = readsFrom(tx.db, resolved);
      const direct = resolveStep(raisedStep, alert({ target: { kind: 'table_team', table_id: 'T12', depth: 'direct' } }), reads, dir, ws);
      const owner = resolveStep(raisedStep, alert({ target: { kind: 'table_team', table_id: 'T12', depth: 'owner' } }), reads, dir, ws);
      const noReports = resolveStep(raisedStep, alert({ target: { kind: 'table_team', table_id: 'T14' } }), reads, dir, ws);
      const unknown = resolveStep(raisedStep, alert({ target: { kind: 'table_team', table_id: 'T99' } }), reads, dir, ws);
      return { statements, direct, owner, noReports, unknown };
    });
    expect(result.statements).toBe(1);
    expect(fakeTableOwner.calls).toHaveLength(1);
    expect(fakeTableOwner.calls[0]!.map((t) => t.table_id)).toEqual(['T12', 'T14', 'T99']);
    expect(result.direct.map((r) => r.staff_id)).toEqual([KAMRAN, ALI, BILAL, HAMZA]);
    expect(result.owner.map((r) => r.staff_id)).toEqual([KAMRAN]);
    expect(result.noReports.map((r) => r.staff_id)).toEqual([HAMZA]);
    expect(result.unknown).toEqual([]);
  });

  it('[01d §3.4] a step point target from values resolves through fakePoint, called once with every point', async () => {
    const h = await harness(cleanups);
    fakePoint.devices.set('P1', ['D_TAB1', 'D_TAB2']);
    fakePoint.devices.set('P2', ['D_TAB3']);
    const step: StepDef = {
      at: { ms: 0 },
      to: [
        { target: { kind: 'point', from_value: 'point_id' }, set: 'recipient' },
        { target: { kind: 'managers' }, set: 'recipient' },
      ],
    };
    const { result } = h.writer.run((tx) => {
      const resolved = resolveTargets(tx, [
        { kind: 'point', point_id: 'P1' },
        { kind: 'point', point_id: 'P2' },
      ]);
      return resolveStep(step, alert({ values: { point_id: 'P1', table_id: 'T1' } }), readsFrom(tx.db, resolved), dir, ws);
    });
    expect(fakePoint.calls).toHaveLength(1);
    expect(fakePoint.calls[0]!.map((t) => t.point_id)).toEqual(['P1', 'P2']);
    expect(result).toEqual([
      { staff_id: null, device_id: 'D_TAB1', set: 'recipient' },
      { staff_id: null, device_id: 'D_TAB2', set: 'recipient' },
    ]);
  });

  it('[01d §3.4] table_team with no registered resolver → VALIDATION_FAILED target_unavailable', async () => {
    const h = await harness(cleanups);
    resetFakes();
    let caught: unknown;
    try {
      h.writer.run((tx) => resolveTargets(tx, [{ kind: 'table_team', table_id: 'T12' }]));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DomainError);
    expect((caught as DomainError).details).toEqual({ issue: 'target_unavailable', target_kind: 'table_team' });
    registerFakes();
  });

  it('[01d §3.4] always_on = kiosk + KDS devices not revoked', async () => {
    const h = await harness(cleanups);
    insertDevice(h.db, 'D_KDS', 'kds', { station: 'ST_GRILL' });
    insertDevice(h.db, 'D_KIOSK', 'cashier_kiosk');
    insertDevice(h.db, 'D_KIOSK_OLD', 'cashier_kiosk', { revoked: true });
    insertDevice(h.db, 'D_PHONE', 'phone', { owner: ALI });
    insertDevice(h.db, 'D_TAB', 'tablet');
    const out = resolveStep(raisedStep, alert({ target: { kind: 'always_on' } }), readsFrom(h.db), dir, ws);
    expect(out.map((r) => r.device_id)).toEqual(['D_KDS', 'D_KIOSK']);
  });

  it('[01d BF-8] presence_today from PresenceSet: Ali 0, Bilal 1, Hamza not ticked → only Ali is skipped', async () => {
    const h = await harness(cleanups);
    const team = alert({ target: { kind: 'team', lead_staff_id: KAMRAN, depth: 'direct' } });
    // nobody ticked → everyone present
    expect(resolveStep(raisedStep, team, readsFrom(h.db), dir, ws).map((r) => r.staff_id)).toEqual([ALI, BILAL, HAMZA]);
    h.writer.run((tx) => tx.append([draft(presence([ALI], false)), draft(presence([BILAL], true))]));
    expect(h.db.prepare('SELECT staff_id, present FROM presence_today ORDER BY staff_id').all()).toEqual([
      { staff_id: ALI, present: 0 },
      { staff_id: BILAL, present: 1 },
    ]);
    expect(resolveStep(raisedStep, team, readsFrom(h.db), dir, ws).map((r) => r.staff_id)).toEqual([BILAL, HAMZA]);
    // a signed-in absent person counts as present
    const signedIn = { ...readsFrom(h.db), sessions: [{ session_id: 'ss1', staff_id: ALI, device_id: 'D_TAB', last_activity_at: T }] };
    expect(resolveStep(raisedStep, team, signedIn, dir, ws).map((r) => r.staff_id)).toEqual([ALI, BILAL, HAMZA]);
    // person targets are never filtered
    expect(resolveStep(raisedStep, alert({ target: { kind: 'person', staff_id: ALI } }), readsFrom(h.db), dir, ws)).toEqual([
      { staff_id: ALI, device_id: null, set: 'recipient' },
    ]);
    // day close clears the list → everyone present again
    h.writer.run((tx) => tx.append([draft(aBusinessDayClosed())]));
    expect(resolveStep(raisedStep, team, readsFrom(h.db), dir, ws).map((r) => r.staff_id)).toEqual([ALI, BILAL, HAMZA]);
  });
});
