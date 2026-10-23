/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import type { InjectOptions } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { openReadOnly } from '../../src/db/connection';
import { runMigrations } from '../../src/db/migrate';
import { createAuthGeneration } from '../../src/engine-host/auth-generation';
import { createStateHolder } from '../../src/engine-host/state-holder';
import { createWriter } from '../../src/engine-host/writer';
import type { HubConfig } from '../../src/config/schema';
import { fixedClock } from '../../src/lib/clock';
import { testIdGen } from '../../src/lib/ids';
import { testSecrets } from '../../src/lib/secrets';
import { createProjectionRegistry } from '../../src/projections/registry';
import { buildHubServer, type HubDeps } from '../../src/server';
import { freshDb } from './db';
import { createLogCapture } from './log-capture';

const migrationsDir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
const DEFAULT_HOST = '192.168.10.2:3000';

export interface TestHub {
  app: FastifyInstance;
  deps: HubDeps;
  clock: ReturnType<typeof fixedClock>;
  logs(): string;
  close(): Promise<void>;
}

export async function createTestHub(o?: { provisioned?: boolean; config?: Partial<HubConfig> }): Promise<TestHub> {
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
      publish: () => undefined,
    }),
    state,
    projections,
    authGeneration,
    ownIPv4: ['192.168.10.2'],
  };
  const capture = createLogCapture();
  deps.logStream = capture.stream;
  const app = buildHubServer(deps);
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
    branch_api_key: 'test-branch-api-key',
  };
  return config;
}
