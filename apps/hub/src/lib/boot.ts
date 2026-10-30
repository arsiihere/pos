/// <reference types="node" />
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from '@pos/domain';
import { applyEvent, type EngineState } from '@pos/engine';
import '@pos/events';
import type { EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { attachRouteGuards } from '../auth/guards.js';
import { startSweeper } from '../auth/session-sweeper.js';
import { StaffDirectory } from '../auth/staff-directory.js';
import { loadHubConfig } from '../config/load.js';
import { isConfirmed, isProvisioned, type HubConfig } from '../config/schema.js';
import { openDb, openReadOnly } from '../db/connection.js';
import { runMigrations } from '../db/migrate.js';
import { deleteLeftoverPlaintext, makePreMigrateBackup } from '../db/pre-migrate-backup.js';
import { createAuthGeneration } from '../engine-host/auth-generation.js';
import { createStateHolder } from '../engine-host/state-holder.js';
import { createWriter } from '../engine-host/writer.js';
import { registerAccessReconcile, restoreEmptyStaffSessions } from '../projections/access-reconcile.js';
import { registerRestaurantProjections } from '../projections/branch-config.js';
import { createProjectionRegistry } from '../projections/registry.js';
import { buildHubServer, installHubErrors, type HubDeps } from '../server.js';
import { publisherFor } from '../ws/server.js';
import { httpCloudClient, type CloudClient } from '../setup/cloud-client.js';
import { startConfirmTask } from '../setup/confirm-task.js';
import { registerSetupRoutes } from '../setup/provision.js';
import { createBranchClock, type Clock } from './clock.js';
import { createHostMatcher } from './net.js';
import { readHeartbeat, registerHealth, startHeartbeat } from './health.js';
import { ulidGen } from './ids.js';
import { registerUiAssets } from './ui-assets.js';
import type { ConfigClient } from '../sync/config-client.js';
import { noteCommitted } from '../sync/stock-version.js';
import { cryptoSecrets } from './secrets.js';

const migrationsDir = fileURLToPath(new URL('../db/migrations', import.meta.url));

export interface BootContext {
  config: HubConfig;
  db: Database.Database;
  app?: FastifyInstance;
  // 01a §2: set by a step-3 fold; createDeps builds the state holder from it.
  initialState?: unknown;
}

type BootStep = '2' | '3' | '5' | '6';

const registered: Record<BootStep, Array<(ctx: BootContext) => void | Promise<void>>> = {
  '2': [],
  '3': [],
  '5': [],
  '6': [],
};

export function registerBootStep(step: BootStep, run: (ctx: BootContext) => void | Promise<void>): void {
  registered[step].push(run);
}

export interface BootOptions {
  configPath: string;
  wallNow: () => number;
  monoNow: () => number;
  listen?: boolean;
  ifaces?: string[];
  logStream?: NodeJS.WritableStream;
  // 01a §3.4: the config poll client; tests pass a stub (default: HTTP to cloud_base_url).
  configClient?: ConfigClient;
  // 00 M41: the hub confirm client; tests pass a stub (default: HTTP to cloud_base_url).
  cloudClient?: CloudClient;
}

export interface BootHandle {
  deps: HubDeps;
  app: FastifyInstance;
  step(): string;
  stop(): Promise<void>;
}

export async function boot(opts: BootOptions): Promise<BootHandle> {
  const startedMono = opts.monoNow();
  const beat: { stop: () => void } = { stop: () => undefined };
  let stopConfirm: () => void = () => undefined;
  let current = '0';
  let phase: 'booting' | 'setup' | 'ready' = 'booting';
  const config = loadHubConfig(opts.configPath);
  current = '1';
  deleteLeftoverPlaintext(config.data_dir);
  const db = openDb(join(config.data_dir, 'hub.sqlite'));
  let readDb: Database.Database | undefined;
  try {
    current = '1a';
    await runMigrations(db, {
      dir: migrationsDir,
      clock: { branchNow: () => opts.wallNow() },
      backup: makePreMigrateBackup({ db, config, secrets: cryptoSecrets }),
    });
    readDb = openReadOnly(join(config.data_dir, 'hub.sqlite'));
    const provisioned = isProvisioned(config) ? config.provisioned : undefined;
    if (provisioned === undefined) {
      const deps = createDeps(config, db, readDb, wallClock(opts.wallNow, opts.monoNow), opts.ifaces, opts.logStream);
      const app = Fastify({ logger: false, genReqId: () => deps.ids.next() });
      const allowHost = createHostMatcher({
        port: config.http_port,
        advertisedHost: config.advertised_host ?? null,
        ownIPv4: deps.ownIPv4,
      });
      installHubErrors(app, (request) => {
        if (!allowHost(request.headers.host)) throw new DomainError('HOST_NOT_ALLOWED');
        throw new DomainError('HUB_NOT_PROVISIONED');
      });
      attachRouteGuards(app, deps);
      phase = 'setup';
      current = '7';
      registerHealth(app, () => healthRead(phase, current, false, false, null, null, db));
      registerUiAssets(app);
      registerSetupRoutes(app, {
        ...deps,
        cloud: httpCloudClient(config.cloud_base_url),
        configPath: opts.configPath,
        exit: (code) => {
          process.exit(code);
        },
      });
      if (opts.listen === true) await app.listen({ host: '0.0.0.0', port: config.http_port });
      return handle(deps, app, db, readDb, () => current, beat);
    }
    const ctx: BootContext = { config, db };
    current = '2';
    await runStep('2', ctx);
    current = '3';
    await runStep('3', ctx);
    current = '3a';
    const row = db
      .prepare('SELECT recorded_at FROM events WHERE branch_id = ? ORDER BY seq DESC LIMIT 1')
      .get(provisioned.branch_id) as { recorded_at: number } | undefined;
    const opened =
      row === undefined
        ? { clock: wallClock(opts.wallNow, opts.monoNow), alarm: null }
        : createBranchClock({ wallNow: opts.wallNow, monoNow: opts.monoNow, lastRecordedAt: row.recorded_at });
    const publishSlot: { current: (events: PosEvent[]) => void } = { current: () => undefined };
    const deps = createDeps(config, db, readDb, opened.clock, opts.ifaces, opts.logStream, publishSlot, ctx.initialState);
    if (opts.configClient !== undefined) deps.configClient = opts.configClient;
    if (opened.alarm !== null) {
      const alarm = opened.alarm;
      deps.writer.run((tx) => {
        const draft: EventDraft = {
          stream_type: 'hub',
          stream_id: provisioned.branch_id,
          event_type: 'ClockAlarm',
          schema_version: 1,
          payload: { ...alarm, source: 'boot' },
          occurred_at: deps.clock.branchNow(),
          actor_id: null,
          device_id: 'hub',
        };
        tx.append([draft]);
      });
    }
    registerAccessReconcile({ projections: deps.projections, writer: deps.writer, clock: deps.clock });
    current = '4';
    const caught = deps.projections.catchUp(db, provisioned.branch_id);
    const eventsReplayed = Object.values(caught.replayed).reduce((sum, count) => sum + count, 0);
    current = '4a';
    void StaffDirectory.load(db);
    current = '4b';
    restoreEmptyStaffSessions(db, deps.writer, deps.clock, provisioned.branch_id);
    current = '5';
    const app = buildHubServer(deps);
    const publish = publisherFor(app);
    if (publish !== undefined) publishSlot.current = publish;
    ctx.app = app;
    registerHealth(app, () =>
      healthRead(phase, current, true, isConfirmed(config), provisioned.branch_id, opened.alarm, db),
    );
    await runStep('5', ctx);
    current = '6';
    await runStep('6', ctx);
    current = '7';
    if (!isConfirmed(config)) {
      stopConfirm = startConfirmTask({
        cloud: opts.cloudClient ?? httpCloudClient(config.cloud_base_url),
        config,
        configPath: opts.configPath,
        clock: deps.clock,
        log: {
          error(obj, msg) {
            app.log.error(obj, msg);
          },
        },
      });
    }
    if (opts.listen === true) await app.listen({ host: '0.0.0.0', port: config.http_port });
    const hubDownAt = readHeartbeat(db, provisioned.branch_id);
    const hubUpAt = deps.clock.branchNow();
    deps.writer.run((tx) => {
      tx.append([
        {
          stream_type: 'hub',
          stream_id: provisioned.branch_id,
          event_type: 'HubStarted',
          schema_version: 1,
          payload: {
            hub_down_at: hubDownAt,
            hub_up_at: hubUpAt,
            events_replayed: eventsReplayed,
            missed_fires: 0,
            boot_ms: Math.max(0, Math.round(opts.monoNow() - startedMono)),
          },
          occurred_at: hubUpAt,
          actor_id: null,
          device_id: 'hub',
        },
      ]);
    });
    current = '8';
    phase = 'ready';
    const stopHeart = startHeartbeat(db, deps.clock, provisioned.branch_id);
    const stopSweep = startSweeper(deps);
    beat.stop = () => {
      stopConfirm();
      stopHeart();
      stopSweep();
    };
    return handle(deps, app, db, readDb, () => current, beat);
  } catch (error) {
    stopConfirm();
    readDb?.close();
    db.close();
    throw error;
  }
}

function handle(
  deps: HubDeps,
  app: FastifyInstance,
  db: Database.Database,
  readDb: Database.Database,
  step: () => string,
  beat: { stop: () => void },
): BootHandle {
  return {
    deps,
    app,
    step,
    async stop() {
      beat.stop();
      await app.close();
      readDb.close();
      db.close();
    },
  };
}

function healthRead(
  status: 'booting' | 'setup' | 'ready',
  bootStep: string,
  provisioned: boolean,
  confirmed: boolean,
  branchId: string | null,
  clockAlarm: { wall_ms: number; last_recorded_at: number; delta_ms: number } | null,
  db: Database.Database,
) {
  return { status, bootStep, provisioned, confirmed, branchId, clockAlarm, db };
}

async function runStep(step: BootStep, ctx: BootContext): Promise<void> {
  for (const run of registered[step]) await run(ctx);
}

function wallClock(wallNow: () => number, monoNow: () => number): Clock {
  const wall = wallNow();
  const mono = monoNow();
  return { branchNow: () => Math.floor(wall + (monoNow() - mono)) };
}

function createDeps(
  config: HubConfig,
  db: Database.Database,
  readDb: Database.Database,
  clock: Clock,
  ifaces: string[] | undefined,
  logStream: NodeJS.WritableStream | undefined,
  publishSlot?: { current: (events: PosEvent[]) => void },
  initialState?: unknown,
): HubDeps {
  const provisioned = config.provisioned;
  // 01a §2, S15: with no step-3 handler the state is {} as before.
  const state = createStateHolder<EngineState>((initialState ?? {}) as EngineState);
  state.setReducer(applyEvent);
  const projections = createProjectionRegistry();
  registerRestaurantProjections(projections);
  const authGeneration = createAuthGeneration();
  const ids = ulidGen(clock);
  const deps: HubDeps = {
    config,
    db,
    readDb,
    clock,
    ids,
    secrets: cryptoSecrets,
    writer: createWriter({
      db,
      clock,
      ids,
      tenantId: provisioned?.tenant_id ?? 'tenant-unset',
      branchId: provisioned?.branch_id ?? 'branch-unset',
      projections,
      state,
      authGeneration,
      publish: (events) => {
        noteCommitted(events);
        publishSlot?.current(events);
      },
    }),
    state,
    projections,
    authGeneration,
    ownIPv4: ifaces ?? localIPv4(),
    logStream: logStream ?? process.stdout,
  };
  return deps;
}

function localIPv4(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4') found.push(entry.address);
    }
  }
  return found;
}
