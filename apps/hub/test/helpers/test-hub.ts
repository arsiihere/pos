/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { screensOffered, type DeviceType, type ScreenKey, type SessionEndReason, type SessionKind } from '@pos/domain';
import { initialEngineState, type EngineState } from '@pos/engine';
import type { DeviceProfileSetPayload, DirectoryInput, PosEvent } from '@pos/events';
import type { InjectOptions } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { loadDeviceProfiles } from '../../src/auth/device-profile';
import { currentDirectory, swapDirectory } from '../../src/auth/guards';
import { createSession, endSession, type SessionRow } from '../../src/auth/session-store';
import { openReadOnly } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { hostFlags } from '../../src/engine-host/host-flags';
import { engineReducer, foldEngineBatch } from '../../src/engine-host/reducer';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter } from '../../src/engine-host/writer';
import type { HubConfig } from '../../src/config/schema';
import { registerHubProjections } from '../../src/lib/boot';
import { fixedClock } from '../../src/lib/clock';
import { sha256hex } from '../../src/lib/hash';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { createProjectionRegistry } from '../../src/projections/registry';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import type { ConfigClient } from '../../src/sync/config-client';
import { noteCommitted, setStockVersion } from '../../src/sync/stock-version';
import { buildHubServer, type HubDeps } from '../../src/server';
import { publisherFor } from '../../src/ws/server';
import { freshDb } from './db';
import { aDirectory } from './fixtures';
import { createLogCapture } from './log-capture';
import { stubConfigCloud } from './stub-config-cloud';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const DEFAULT_HOST = '192.168.10.2:3000';

export interface TestHub {
  app: FastifyInstance;
  deps: HubDeps;
  clock: ReturnType<typeof fixedClock>;
  published: PosEvent[][];
  logs(): string;
  close(): Promise<void>;
}

export async function createTestHub(o?: {
  provisioned?: boolean;
  config?: Partial<HubConfig>;
  testHooks?: { beforeCommit?: () => void; beforePublish?: () => void };
  configClient?: ConfigClient;
}): Promise<TestHub> {
  swapBranchConfig(null);
  setStockVersion(0);
  hostFlags.reserve_fallback_logged.clear();
  hostFlags.untrackedLineIds.clear(); // 02p AD-E23: no ids leak between test hubs
  const fx = freshDb();
  const clock = fixedClock(1_761_000_000_000);
  await runMigrations(fx.db, { dir: migrationsDir, clock });
  const readDb = openReadOnly(fx.path);
  const config = testConfig(fx.dir, o);
  // As boot with the step-3 replay over an empty log (03a §3.12).
  const state = createStateHolder<EngineState>(initialEngineState());
  state.setReducer(engineReducer, (s, events) => foldEngineBatch(s, events, () => clock.branchNow()));
  const projections = createProjectionRegistry();
  registerHubProjections(projections);
  // 04 §4.5 H-2: as boot step 4, catchUp writes every projection's first checkpoint row on the writer's branch.
  // It runs before any projection a test registers later (e.g. access_reconcile): applyAll only updates existing
  // rows, so such a test must call catchUp again, or live appends will not advance that projection's checkpoint.
  projections.catchUp(fx.db, config.provisioned?.branch_id ?? 'branch-unset');
  const authGeneration = createAuthGeneration();
  const ids = testIdGen();
  const published: PosEvent[][] = [];
  const publishSlot: { current: (events: PosEvent[]) => void } = { current: () => undefined };
  const deps: HubDeps = {
    config,
    db: fx.db,
    readDb,
    clock,
    ids,
    secrets: testSecrets(),
    writer: createWriter({
      db: fx.db,
      clock,
      ids,
      tenantId: config.provisioned?.tenant_id ?? 'tenant-unset',
      branchId: config.provisioned?.branch_id ?? 'branch-unset',
      projections,
      state,
      authGeneration,
      publish: (events) => {
        noteCommitted(events);
        published.push(events);
        publishSlot.current(events);
      },
      testHooks: o?.testHooks,
    }),
    state,
    projections,
    authGeneration,
    ownIPv4: ['192.168.10.2'],
    configClient: o?.configClient ?? stubConfigCloud(),
  };
  const capture = createLogCapture();
  deps.logStream = capture.stream;
  const app = buildHubServer(deps, { testCommands: true });
  const publish = publisherFor(app);
  if (publish !== undefined) publishSlot.current = publish;
  const rawInject = app.inject.bind(app);
  app.inject = ((opts?: InjectOptions | string) => {
    const options: InjectOptions = typeof opts === 'string' ? { url: opts } : { ...opts };
    options.headers = { host: DEFAULT_HOST, ...options.headers };
    return rawInject(options);
  }) as typeof app.inject;
  return {
    app,
    deps,
    clock,
    published,
    logs: () => capture.text(),
    async close() {
      await app.close();
      readDb.close();
      fx.cleanup();
    },
  };
}

function testConfig(dir: string, o?: { provisioned?: boolean; config?: Partial<HubConfig> }): HubConfig {
  const config: HubConfig = {
    cloud_base_url: 'https://cloud.example',
    http_port: 3000,
    data_dir: dir,
    backup_dir: dir,
    min_client_version: '1.0.0',
    cors_origins: ['http://localhost'],
    maintenance_hour: 4,
    auth: {
      pin_max_failures: 5,
      device_max_failures: 10,
      device_failure_window_ms: 300_000,
      pin_lockout_ms: 900_000,
      argon2_concurrency: 2,
      admin_argon2_concurrency: 1,
    },
    guest_network_cidrs: ['192.168.20.0/24'],
    backup_encryption_key: Buffer.alloc(32, 1).toString('base64'),
    ...o?.config,
  };
  if (o?.provisioned === false) {
    config.provisioned = undefined;
    config.advertised_host = undefined;
    return config;
  }
  config.advertised_host ??= '192.168.10.2';
  config.provisioned ??= {
    tenant_id: 'tenant-a',
    branch_id: 'branch-1',
    branch_name: 'Main',
    branch_api_key: 'test-branch-api-key',
  };
  return config;
}

export async function seedDirectory(h: TestHub, d?: DirectoryInput): Promise<void> {
  const input = d ?? (await aDirectory());
  h.deps.writer.run((tx) => {
    applyStaffDirectory(tx, input, (next) => {
      swapDirectory(h.app, next);
    });
  });
}

/** 05a §4.2: a device profile as a test sets it (plan task 8); `staff_ids` only for `listed`. */
export interface DeviceProfileInput {
  access: 'everyone' | 'listed';
  staff_ids?: string[];
  screens: ScreenKey[];
  point_id?: string | null;
}

export function pairDevice(
  h: TestHub,
  o: { type: DeviceType; stationId?: string; ownerStaffId?: string; name?: string; profile?: DeviceProfileInput },
): { deviceId: string; token: string } {
  const branchId = h.deps.config.provisioned?.branch_id;
  if (branchId === undefined) throw new Error('pairDevice requires a provisioned hub');
  const deviceId = h.deps.ids.next();
  const token = h.deps.secrets.token256();
  h.deps.db
    .prepare(
      `INSERT INTO devices (
        device_id, branch_id, token_hash, device_name, device_type,
        station_id, owner_staff_id, paired_at, paired_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      deviceId,
      branchId,
      sha256hex(token),
      o.name ?? o.type,
      o.type,
      o.type === 'kds' ? (o.stationId ?? null) : null,
      o.type === 'phone' ? (o.ownerStaffId ?? null) : null,
      h.clock.branchNow(),
      'S_MGR',
    );
  if (o.profile !== undefined) appendDeviceProfile(h, deviceId, o.profile);
  return { deviceId, token };
}

/**
 * 05a §4.2: appends a `DeviceProfileSet` v1 for the device through the writer, so the `device_profiles` projection and
 * the `deviceProfile` map see it. `profile_version` = the previous one + 1 (N-4); `cause` = `approved` for the first,
 * `edited` after; `device_name` = the device's current name.
 */
export function appendDeviceProfile(h: TestHub, deviceId: string, p: DeviceProfileInput): void {
  // 05a §3.6 / §6.3: `listed` needs 1–20 people, and a kds device has no profile.
  if (p.access === 'listed' && (p.staff_ids === undefined || p.staff_ids.length === 0)) {
    throw new Error(`appendDeviceProfile: listed profile for ${deviceId} needs staff_ids`);
  }
  h.deps.writer.run((tx) => {
    const device = tx.db.prepare('SELECT device_name, device_type FROM devices WHERE device_id = ?').get(deviceId) as
      | { device_name: string; device_type: string }
      | undefined;
    if (device === undefined) throw new Error(`device ${deviceId} not found`);
    if (device.device_type === 'kds') throw new Error(`appendDeviceProfile: kds device ${deviceId} has no profile`);
    // A fixture-only legacy row (`profile_version` 0, see `openSession`) counts as no profile.
    const row = tx.db.prepare('SELECT profile_version FROM device_profiles WHERE device_id = ?').get(deviceId) as { profile_version: number } | undefined;
    const prev = row === undefined || row.profile_version === 0 ? undefined : row;
    const payload: DeviceProfileSetPayload = {
      device_id: deviceId,
      device_name: device.device_name,
      access: p.access,
      staff_ids: p.access === 'listed' ? (p.staff_ids ?? []) : [],
      screens: p.screens,
      point_id: p.point_id ?? null,
      profile_version: (prev?.profile_version ?? 0) + 1,
      cause: prev === undefined ? 'approved' : 'edited',
      needs_review: false,
    };
    tx.append([
      {
        stream_type: 'hub',
        stream_id: deviceId,
        event_type: 'DeviceProfileSet',
        schema_version: 1,
        payload,
        occurred_at: h.clock.branchNow(),
        actor_id: 'S_MGR',
        device_id: 'hub-admin',
      },
    ]);
  });
}

/**
 * A staff or admin session written straight to the session store.
 *
 * 05a §3.3a (R-1): a staff device with no profile is masked as `everyone`. Tests written before 05a open a manager's
 * session on a `pairDevice` device with no profile and expect today's (unmasked) rights, so unless `legacyProfile` is
 * false a staff / admin session on a non-kds device with no `device_profiles` row puts its person on a fixture-only
 * **legacy** profile: `listed`, the screens offered for the hardware (`pass` only with a `point_id`),
 * `profile_version` 0. It is written to the projection tables directly (no event, as `pairDevice` writes `devices`),
 * and the next session's person is added to it. `appendDeviceProfile` treats such a row as no profile. Tests of
 * 05a set an explicit profile (`pairDevice({ profile })`, `withProfile`) or pass `legacyProfile: false`.
 */
export function openSession(
  h: TestHub,
  o: { kind: SessionKind; staffId?: string; deviceId?: string; stationId?: string; legacyProfile?: boolean },
): { sessionId: string; token: string } {
  const station = o.kind === 'station';
  if (!station && o.deviceId !== undefined && o.staffId !== undefined && o.legacyProfile !== false) {
    legacyProfile(h, o.deviceId, o.staffId);
  }
  return h.deps.writer.run((tx) =>
    createSession(tx, {
      kind: o.kind,
      staffId: station ? null : (o.staffId ?? null),
      stationId: station ? (o.stationId ?? null) : null,
      deviceId: o.deviceId ?? null,
      idleTtlMs: station ? null : currentDirectory(h.app).ttlFor(o.staffId ?? ''),
      eventDeviceId: o.deviceId ?? (o.kind === 'admin' ? 'hub-admin' : 'hub'),
    }),
  ).result;
}

function legacyProfile(h: TestHub, deviceId: string, staffId: string): void {
  const db = h.deps.db;
  const device = db.prepare('SELECT device_type, point_id FROM devices WHERE device_id = ?').get(deviceId) as
    | { device_type: DeviceType; point_id: string | null }
    | undefined;
  if (device === undefined || device.device_type === 'kds') return;
  const row = db.prepare('SELECT profile_version FROM device_profiles WHERE device_id = ?').get(deviceId) as { profile_version: number } | undefined;
  if (row !== undefined && row.profile_version !== 0) return;
  if (row === undefined) {
    const screens = screensOffered(device.device_type).filter((k) => k !== 'pass' || device.point_id !== null);
    db.prepare("INSERT INTO device_profiles (device_id, access, screens, profile_version, needs_review) VALUES (?, 'listed', ?, 0, 0)").run(
      deviceId,
      JSON.stringify(device.point_id === null ? screens : ['pass', ...screens.filter((k) => k !== 'pass')]),
    );
  }
  db.prepare('INSERT OR IGNORE INTO device_people (device_id, staff_id) VALUES (?, ?)').run(deviceId, staffId);
  loadDeviceProfiles(db);
}

export function endSessionNow(h: TestHub, id: string, reason: SessionEndReason = 'logout'): void {
  const row = h.deps.db
    .prepare(
      `SELECT session_id, kind, staff_id, station_id, device_id, idle_ttl_ms, last_activity_at, ended_at, token_hash
       FROM staff_sessions WHERE session_id = ?`,
    )
    .get(id) as SessionRow | undefined;
  if (row === undefined) throw new Error(`session ${id} not found`);
  h.deps.writer.run((tx) => {
    const deviceId = row.kind === 'admin' && row.device_id === null ? 'hub-admin' : (row.device_id ?? 'hub');
    endSession(tx, row, reason, null, null, deviceId);
  });
}
