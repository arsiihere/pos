import type { FastifyInstance, FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import type { CloudEnv } from './lib/env.js';
import type { Clock } from './lib/clock.js';
import type { IdGen } from './lib/ids.js';
import type { SecretGen } from './lib/secrets.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerJwt } from './plugins/jwt.js';
import { registerOwnerCredentials } from './plugins/owner-credentials.js';
import { registerHealthRoutes } from './modules/health/routes.js';
import { registerHubRegistrationRoutes } from './modules/hub-registration/routes.js';
import { registerOwnerAuthRoutes } from './modules/owner-auth/routes.js';
import { registerTenantScope } from './plugins/tenant-scope.js';

const SECRET_HEADERS = ['authorization'] as const;

const SECRET_FIELDS = [
  'pin',
  'password',
  'registration_code',
  'refresh_token',
  'access_token',
  'branch_api_key',
] as const;

const HEADER_REDACT = new Set<string>(SECRET_HEADERS);

// Test-only seams (R6); production never sets them.
export interface CloudTestHooks {
  handlerStart?(route: string): void; // first line of a handler: tests reset pgCounter here (R9)
  afterTargetLock?(route: string): Promise<void>; // task 34
  afterReferenceLock?(route: string): Promise<void>; // task 34
  beforeBump?(): Promise<void>; // task 19
  beforePrune?(): Promise<void>; // task 15 (#122)
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
  registerTenantScope(app, { pool: deps.pool });
  registerHubRegistrationRoutes(app, deps);
  registerOwnerAuthRoutes(app, deps);
  registerHealthRoutes(app, deps);
  return app;
}

function redactHeaders(headers: FastifyRequest['headers']): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(headers)) {
    copy[name] = HEADER_REDACT.has(name) ? '[Redacted]' : value;
  }
  return copy;
}
