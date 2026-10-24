import { DomainError, statusOf, type ErrorCode } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export function registerErrorHandler(app: FastifyInstance): void {
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
    const statusCode = statusCodeOf(error);
    if (statusCode === 404) {
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

function retryAfterHeader(status: number, details: Record<string, unknown>): string | undefined {
  if (status !== 429 && status !== 503) return undefined;
  const ms = details.retry_after_ms;
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return undefined;
  return String(Math.ceil(ms / 1000));
}

function errorBody(code: ErrorCode, message: string, details: Record<string, unknown>, requestId: string) {
  return { error: { code, message, details, request_id: requestId } };
}
