import type { FastifyInstance } from 'fastify';
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
import { registerHubRegistrationRoutes } from './modules/hub-registration/routes.js';
import { registerTenantScope } from './plugins/tenant-scope.js';

const SECRET_FIELDS = [
  'pin',
  'password',
  'registration_code',
  'refresh_token',
  'access_token',
  'branch_api_key',
] as const;

export interface CloudDeps {
  pool: pg.Pool;
  env: CloudEnv;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
}

export function buildCloudServer(deps: CloudDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: 'info',
      redact: {
        paths: SECRET_FIELDS.flatMap((name) => [name, `*.${name}`, `*.*.${name}`]),
        censor: '[Redacted]',
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
  return app;
}
