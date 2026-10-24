/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import type { DeviceType, SessionEndReason, SessionKind } from '@pos/domain';
import type { DirectoryInput, PosEvent } from '@pos/events';
import type { InjectOptions } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { applyStaffDirectory } from '../../src/auth/apply-directory';
import { currentDirectory, swapDirectory } from '../../src/auth/guards';
import { createSession, endSession, type SessionRow } from '../../src/auth/session-store';
import { openReadOnly } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter } from '../../src/engine-host/writer';
import type { HubConfig } from '../../src/config/schema';
import { fixedClock } from '../../src/lib/clock';
import { sha256hex } from '../../src/lib/hash';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { createProjectionRegistry } from '../../src/projections/registry';
import { buildHubServer, type HubDeps } from '../../src/server';
import { publisherFor } from '../../src/ws/server';
import { freshDb } from './db';
import { aDirectory } from './fixtures';
import { createLogCapture } from './log-capture';

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
}): Promise<TestHub> {
  const fx = freshDb();
  const clock = fixedClock(1_761_000_000_000);
  await runMigrations(fx.db, { dir: migrationsDir, clock });
  const readDb = openReadOnly(fx.path);
  const config = testConfig(fx.dir, o);
  const state = createStateHolder<unknown>({});
  state.setReducer((current) => current);
  const projections = createProjectionRegistry();
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
        published.push(events);
        publishSlot.current(events);
      },
      testHooks: o?.testHooks,
    }),
    state,
    projections,
    authGeneration,
    ownIPv4: ['192.168.10.2'],
  };
  const capture = createLogCapture();
  deps.logStream = capture.stream;
  const app = buildHubServer(deps);
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

export function pairDevice(
  h: TestHub,
  o: { type: DeviceType; stationId?: string; ownerStaffId?: string },
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
      o.type,
      o.type,
      o.type === 'kds' ? (o.stationId ?? null) : null,
      o.type === 'phone' ? (o.ownerStaffId ?? null) : null,
      h.clock.branchNow(),
      'S_MGR',
    );
  return { deviceId, token };
}

export function openSession(
  h: TestHub,
  o: { kind: SessionKind; staffId?: string; deviceId?: string; stationId?: string },
): { sessionId: string; token: string } {
  const station = o.kind === 'station';
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
