import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { CLIENT_DIST_DIR, registerClientDist } from './lib/client-dist.js';
import type { CloudEnv } from './lib/env.js';
import type { Clock } from './lib/clock.js';
import type { IdGen } from './lib/ids.js';
import type { SecretGen } from './lib/secrets.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerJwt } from './plugins/jwt.js';
import { registerOwnerCredentials } from './plugins/owner-credentials.js';
import { registerConfigSyncRoutes } from './modules/config-sync/routes.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerHubRegistrationRoutes } from './modules/hub-registration/routes.js';
import { registerOwnerAuthRoutes } from './modules/owner-auth/routes.js';
import { registerRestaurantRoutes } from './modules/restaurant/routes.js';
import { registerStaffRolesRoutes } from './modules/staff-roles/routes.js';
import { registerTenantScope } from './plugins/tenant-scope.js';

const SECRET_HEADERS = ['authorization'] as const;

const SECRET_FIELDS = [
  'pin',
  'password',
  'registration_code',
  'refresh_token',
  'access_token',
  'branch_api_key',
  'current_password', // 01b §7.2
  'new_password',
] as const;

const HEADER_REDACT = new Set<string>(SECRET_HEADERS);

// Test-only seams (R6); production never sets them.
export interface CloudTestHooks {
  handlerStart?(route: string): void; // first line of a handler: tests reset pgCounter here (R9)
  afterTargetLock?(route: string): Promise<void>; // task 34
  afterReferenceLock?(route: string): Promise<void>; // task 34
  beforeBump?(): Promise<void>; // task 19
  beforePrune?(): Promise<void>; // task 15 (#122)
  afterTenantLock?(): Promise<void>; // 01b task 21: directoryWrite, right after tenants … FOR NO KEY UPDATE (#85)
  guardRead?(): Promise<void>; // 01b task 35: a rejection makes the JWT guard's owner-row read fail (#107)
}

export interface CloudDeps {
  pool: pg.Pool;
  env: CloudEnv;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
  logStream?: NodeJS.WritableStream;
  testHooks?: CloudTestHooks;
}

export function buildCloudServer(deps: CloudDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'info',
      ...(deps.logStream !== undefined ? { stream: deps.logStream } : {}),
      redact: {
        paths: SECRET_FIELDS.flatMap((name) => [name, `*.${name}`, `*.*.${name}`]),
        censor: '[Redacted]',
      },
      serializers: {
        req(req: FastifyRequest) {
          return {
            method: req.method,
            url: req.url,
            headers: redactHeaders(req.headers),
          };
        },
      },
    },
    genReqId: () => deps.ids.next(),
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);
  registerJwt(app, deps.env.JWT_SECRET, deps.clock);
  registerOwnerCredentials(app, deps.pool);
  registerTenantScope(app, { pool: deps.pool, ...(deps.testHooks !== undefined ? { testHooks: deps.testHooks } : {}) });
  registerHubRegistrationRoutes(app, deps);
  registerOwnerAuthRoutes(app, deps);
  registerHealthRoutes(app, deps);
  registerRestaurantRoutes(app, deps);
  registerConfigSyncRoutes(app, deps);
  registerStaffRolesRoutes(app, deps);
  // §7.1, S21: the built owner pages, static and without tenant scope.
  registerClientDist(app, { prefix: '/owner/', dir: CLIENT_DIST_DIR, routeConfig: { tenantScope: 'none' } });
  return app;
}

function redactHeaders(headers: FastifyRequest['headers']): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    copy[name] = HEADER_REDACT.has(name) ? '[Redacted]' : value;
  }
  return copy;
}
