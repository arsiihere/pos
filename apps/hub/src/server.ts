/// <reference types="node" />
import { DomainError, statusOf, type ErrorCode } from '@pos/domain';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyRequest, LogController } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { HubConfig } from './config/schema.js';
import type { AuthGeneration } from './engine-host/auth-generation.js';
import { registerEngineHost } from './engine-host/index.js';
import type { EngineState } from '@pos/engine';
import type { StateHolder } from './engine-host/state-holder.js';
import type { Writer } from './engine-host/writer.js';
import type { Clock } from './lib/clock.js';
import type { IdGen } from './lib/ids.js';
import type { SecretGen } from './lib/secrets.js';
import { registerAlerts } from './alerts/index.js';
import { registerTables } from './tables/index.js';
import { registerAppUpdateRoutes } from './app-update/routes.js';
import { registerAdminBootstrapRoutes } from './auth/admin-bootstrap.js';
import { registerAdminRoutes } from './auth/admin-session.js';
import { registerStaffSessionRoutes } from './auth/staff-session.js';
import { registerStationSessionRoutes } from './auth/station-session.js';
import { attachRouteGuards, swapDirectory, type RouteGroup } from './auth/guards.js';
import { registerPairRoutes } from './auth/pairing.js';
import { registerPairRequestRoutes } from './auth/pair-requests.js';
import { registerAddPrecookedStock } from './commands/add-precooked-stock.js';
import { registerApprovePairingRequest } from './commands/approve-pairing-request.js';
import { registerClearPinLockout } from './commands/clear-pin-lockout.js';
import { registerCloseBusinessDay } from './commands/close-business-day.js';
import { registerForceLogoutSession } from './commands/force-logout-session.js';
import { registerGenerateDevicePairingToken } from './commands/generate-device-pairing-token.js';
import { registerOpenBusinessDay } from './commands/open-business-day.js';
import { registerRevokeDevice } from './commands/revoke-device.js';
import { registerSetItemAvailability } from './commands/set-item-availability.js';
import { registerSetPrecookedStock } from './commands/set-precooked-stock.js';
import { registerSetStationCapacity } from './commands/set-station-capacity.js';
import { registerSetStationPause } from './commands/set-station-pause.js';
import { registerCommandRoutes } from './commands/route.js';
import { hubTime } from './lib/hub-time.js';
import { CLIENT_DIST_DIR, registerClientDist, STAFF_DIST_DIR } from './lib/client-dist.js';
import { registerAdminPage } from './admin/routes.js';
import { Semaphore } from './lib/semaphore.js';
import { registerUiAssets } from './lib/ui-assets.js';
import { registerBranchConfigQuery } from './queries/branch-config.js';
import { registerConfigStatusQuery } from './queries/config-status.js';
import { registerDevicesQuery } from './queries/devices.js';
import { registerQueryRoutes } from './queries/registry.js';
import { registerSessionQuery } from './queries/session.js';
import { registerSessionsQuery } from './queries/sessions.js';
import { registerStationsQuery } from './queries/stations.js';
import { registerStationsLiveQuery } from './queries/stations-live.js';
import { registerLockoutsQuery } from './queries/lockouts.js';
import { registerStaffQuery } from './queries/staff.js';
import { registerStaffRosterQuery } from './queries/staff-roster.js';
import { registerStockQuery } from './queries/stock.js';
import type { ProjectionRegistry } from './projections/registry.js';
import { httpConfigClient, type ConfigClient } from './sync/config-client.js';
import { bindConfigPoller, createConfigPoller } from './sync/config-poller.js';
// §6.22: registers the station validator at module load, before the server listens.
import './sync/station-validator.js';
// §4.5: the restaurant event audiences, registered at module load.
import './ws/restaurant-audiences.js';
// 03a §6.4: the station-config event audiences, registered at module load.
import { registerEngineCatchUp } from './ws/engine-audiences.js';
import { registerRestaurantCatchUp } from './ws/restaurant-catch-up.js';
import { registerWs } from './ws/server.js';

const SECRET_HEADERS = [
  'authorization',
  'x-session-token',
  'x-admin-session',
  'x-admin-bootstrap',
  'x-poll-secret',
] as const;

const SECRET_FIELDS = [
  'pin',
  'password',
  'pairing_token',
  'registration_code',
  'refresh_token',
  'device_token',
  'session_token',
  'admin_session_token',
  'branch_api_key',
  'access_token',
  'backup_encryption_key',
  'bootstrap_token',
  'poll_secret',
  'delivery_token',
] as const;

export const REDACT_PATHS: string[] = [
  ...SECRET_HEADERS.map((name) => `req.headers["${name}"]`),
  ...SECRET_FIELDS.flatMap((name) => [name, `*.${name}`, `*.*.${name}`, `*.*.*.${name}`]),
];

const HEADER_REDACT = new Set<string>(SECRET_HEADERS);

export interface HubDeps {
  config: HubConfig;
  db: Database.Database;
  readDb: Database.Database;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
  writer: Writer;
  state: StateHolder<EngineState>;
  projections: ProjectionRegistry;
  authGeneration: AuthGeneration;
  ownIPv4: string[];
  logStream?: NodeJS.WritableStream;
  configClient?: ConfigClient;
  testHooks?: {
    betweenGuardAndWriter?: () => Promise<void>;
    betweenVerifyAndWriter?: () => Promise<void>;
    // 01d §3.5 (m11): between a tick's `due` and its writer.run (alerts/tick.ts)
    betweenDueAndRun?: (name: string) => Promise<void>;
  };
}

export interface BuildHubOptions {
  // Test harness only: boot() never sets it, so the production entry cannot register TestNoop & co.
  testCommands?: boolean;
}

export function buildHubServer(deps: HubDeps, options: BuildHubOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'info',
      stream: deps.logStream,
      redact: {
        paths: REDACT_PATHS.filter((path) => !path.startsWith('req.headers')),
        censor: '[Redacted]',
      },
      serializers: {
        req(req: FastifyRequest) {
          return {
            method: req.method,
            url: redactQueryToken(req.url),
            headers: redactHeaders(req.headers),
          };
        },
      },
    },
    genReqId: () => deps.ids.next(),
    logController: new LogController({ requestIdLogLabel: 'request_id' }),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  installHubErrors(app);

  attachRouteGuards(app, {
    config: deps.config,
    ownIPv4: deps.ownIPv4,
    db: deps.db,
    writer: deps.writer,
    clock: deps.clock,
    authGeneration: deps.authGeneration,
  });
  registerCommandRoutes(app, deps, options.testCommands === true);
  registerGenerateDevicePairingToken(app);
  registerApprovePairingRequest(app, deps);
  registerAdminPage(app, deps);
  registerRevokeDevice(app);
  registerForceLogoutSession(app);
  registerClearPinLockout(app);
  registerOpenBusinessDay(app);
  registerCloseBusinessDay(app);
  registerSetPrecookedStock(app);
  registerAddPrecookedStock(app);
  registerSetItemAvailability(app);
  registerSetStationCapacity(app);
  registerSetStationPause(app);
  registerPairRoutes(app, deps);
  registerPairRequestRoutes(app, deps);
  registerQueryRoutes(app, deps);
  registerDevicesQuery(app);
  registerSessionsQuery(app);
  registerStationsQuery(app);
  registerLockoutsQuery(app);
  registerStaffQuery(app);
  registerStaffRosterQuery(app, deps.clock);
  registerStockQuery(app, deps.clock);
  registerConfigStatusQuery(app, deps.config);
  registerBranchConfigQuery(app, deps.clock);
  registerStationsLiveQuery(app, deps.writer);
  // The catch-up parts read this server's clock; a closed server removes them.
  const stopCatchUp = registerRestaurantCatchUp(deps.clock);
  app.addHook('onClose', async () => stopCatchUp());
  const stopEngineCatchUp = registerEngineCatchUp(deps.clock);
  app.addHook('onClose', async () => stopEngineCatchUp());
  registerSessionQuery(app);
  const semaphores = {
    pin: new Semaphore(deps.config.auth.argon2_concurrency),
    admin: new Semaphore(deps.config.auth.admin_argon2_concurrency),
  };
  registerAdminRoutes(app, deps, semaphores);
  registerAdminBootstrapRoutes(app, deps, semaphores.admin);
  registerStaffSessionRoutes(app, deps, semaphores.pin);
  registerStationSessionRoutes(app, deps);
  registerWs(app, deps);
  registerAppUpdateRoutes(app, deps);
  registerAlerts(app, deps);
  registerTables(app, deps);
  registerUiAssets(app);
  // §7.1: the built /admin/stock page; no credentials, like 00's admin pages (M79).
  registerClientDist(app, { prefix: '/admin/stock/', dir: CLIENT_DIST_DIR, routeConfig: { group: 'admin-page' } });
  // 01d task 41: the staff entry, the same way. Its commands need the envelope ids, which no device route
  // returns, and its 12-hour times the hub clock (S47), so index.html carries them (proposed AD).
  registerClientDist(app, {
    prefix: '/staff/',
    dir: STAFF_DIST_DIR,
    routeConfig: { group: 'admin-page' },
    indexMeta: () => {
      const provisioned = deps.config.provisioned;
      if (provisioned === undefined) return null;
      const time = hubTime(deps.clock);
      return {
        'pos-tenant-id': provisioned.tenant_id,
        'pos-branch-id': provisioned.branch_id,
        'pos-branch-name': provisioned.branch_name,
        'pos-hub-now-ms': String(time.now_ms),
        'pos-hub-utc-offset-ms': String(time.utc_offset_ms),
      };
    },
  });
  installCors(app, deps.config.cors_origins);
  bindConfigPoller(
    app,
    createConfigPoller({
      config: deps.config,
      db: deps.db,
      writer: deps.writer,
      clock: deps.clock,
      client:
        deps.configClient ?? httpConfigClient(deps.config.cloud_base_url, deps.config.provisioned?.branch_api_key ?? ''),
      setDirectory: (d) => {
        swapDirectory(app, d);
      },
      log: app.log,
    }),
  );
  registerEngineHost(app, deps);
  return app;
}

const CORS_GROUPS = new Set<RouteGroup>(['device', 'device-session', 'pair', 'pair-request']);
const CORS_HEADERS = 'Authorization, X-Session-Token, X-Client-Version, X-Poll-Secret, Content-Type, X-Queued-At';
const CORS_METHODS = 'GET, POST';

function installCors(app: FastifyInstance, origins: readonly string[]): void {
  app.addHook('onRequest', async (request, reply) => {
    if (request.method !== 'OPTIONS' || !isCorsPath(request.url)) return;
    const origin = allowedOrigin(request, origins);
    if (origin === undefined) return;
    void reply.header('Access-Control-Allow-Origin', origin);
    void reply.header('Vary', 'Origin');
    void reply.header('Access-Control-Allow-Headers', CORS_HEADERS);
    void reply.header('Access-Control-Allow-Methods', CORS_METHODS);
    return reply.status(200).send({ data: {} });
  });

  app.addHook('onSend', async (request, reply) => {
    const group = request.routeOptions.config.group;
    if (group === undefined || !CORS_GROUPS.has(group)) return;
    const origin = allowedOrigin(request, origins);
    if (origin === undefined) return;
    void reply.header('Access-Control-Allow-Origin', origin);
    void reply.header('Vary', 'Origin');
  });
}

function isCorsPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (path.startsWith('/admin') || path.startsWith('/setup')) return false;
  return (
    path === '/commands' ||
    path.startsWith('/commands/') ||
    path === '/queries' ||
    path.startsWith('/queries/') ||
    path === '/auth' ||
    path.startsWith('/auth/') ||
    path === '/devices/pair' ||
    path.startsWith('/devices/pair/') ||
    path === '/pair' ||
    path.startsWith('/pair/')
  );
}

function allowedOrigin(request: FastifyRequest, origins: readonly string[]): string | undefined {
  const header = request.headers.origin;
  const origin = Array.isArray(header) ? header[0] : header;
  if (origin === undefined || !origins.includes(origin)) return undefined;
  return origin;
}

export function installHubErrors(app: FastifyInstance, notFound?: (request: FastifyRequest) => void): void {
  app.setNotFoundHandler((request, reply) => {
    if (notFound !== undefined) {
      notFound(request);
      return;
    }
    return reply.status(404).send(errorBody('ROUTE_NOT_FOUND', 'ROUTE_NOT_FOUND', {}, String(request.id)));
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);
    if (error instanceof DomainError) {
      const status = statusOf(error.code);
      const retryAfter = retryAfterHeader(status, error.details);
      if (retryAfter !== undefined) void reply.header('Retry-After', retryAfter);
      return reply.status(status).send(errorBody(error.code, error.message, error.details, requestId));
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      const issues = error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: issue.message ?? 'invalid',
      }));
      return reply.status(400).send(errorBody('VALIDATION_FAILED', 'VALIDATION_FAILED', { issues }, requestId));
    }
    if (statusCodeOf(error) === 404) {
      return reply.status(404).send(errorBody('ROUTE_NOT_FOUND', 'ROUTE_NOT_FOUND', {}, requestId));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send(errorBody('INTERNAL_ERROR', 'INTERNAL_ERROR', {}, requestId));
  });
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  return undefined;
}

function redactQueryToken(url: string): string {
  return url.replace(/([?&](?:t|device_token|session_token)=)[^&]*/g, '$1[Redacted]');
}

function redactHeaders(headers: FastifyRequest['headers']): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    copy[name] = HEADER_REDACT.has(name) ? '[Redacted]' : value;
  }
  return copy;
}

function retryAfterHeader(status: number, details: Record<string, unknown>): string | undefined {
  if (status !== 429 && status !== 503) return undefined;
  const ms = details.retry_after_ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  return String(Math.ceil(ms / 1000));
}

function errorBody(code: ErrorCode, message: string, details: Record<string, unknown>, requestId: string) {
  return { error: { code, message, details, request_id: requestId } };
}
