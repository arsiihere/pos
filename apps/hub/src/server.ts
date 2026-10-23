/// <reference types="node" />
import { DomainError, statusOf, type ErrorCode } from '@pos/domain';
import type Database from 'better-sqlite3';
import Fastify, { type FastifyInstance, type FastifyRequest, LogController } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { HubConfig } from './config/schema.js';
import type { AuthGeneration } from './engine-host/auth-generation.js';
import type { StateHolder } from './engine-host/state-holder.js';
import type { Writer } from './engine-host/writer.js';
import type { Clock } from './lib/clock.js';
import type { IdGen } from './lib/ids.js';
import type { SecretGen } from './lib/secrets.js';
import { attachRouteGuards } from './auth/guards.js';
import { registerCommandRoutes } from './commands/route.js';
import { registerQueryRoutes } from './queries/registry.js';
import type { ProjectionRegistry } from './projections/registry.js';

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
  state: StateHolder<unknown>;
  projections: ProjectionRegistry;
  authGeneration: AuthGeneration;
  ownIPv4: string[];
  logStream?: NodeJS.WritableStream;
  testHooks?: { betweenGuardAndWriter?: () => Promise<void> };
}

export function buildHubServer(deps: HubDeps): FastifyInstance {
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
            url: req.url,
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

  app.setNotFoundHandler((request, reply) => {
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

  attachRouteGuards(app, {
    config: deps.config,
    ownIPv4: deps.ownIPv4,
    db: deps.db,
    writer: deps.writer,
    clock: deps.clock,
    authGeneration: deps.authGeneration,
  });
  registerCommandRoutes(app, deps);
  registerQueryRoutes(app, deps);
  return app;
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  return undefined;
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
