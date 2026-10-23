/// <reference types="node" />
import { DomainError, type DeviceType } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, type ZodError } from 'zod';
import { activity, endSession, findSessionByToken, isIdleExpired } from '../auth/session-store.js';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';

export interface QueryCtx {
  db: Database.Database;
  page: { cursor: string | null; limit: number };
}

export interface QueryDef<Q extends z.ZodType = z.ZodType> {
  resource: string;
  sessionKind: 'device' | 'admin';
  session: 'required' | 'none';
  allowStation?: boolean;
  deviceTypes?: DeviceType[];
  countsAsActivity?: boolean;
  querySchema: Q;
  handle(ctx: QueryCtx, q: z.infer<Q>): { data: unknown; meta?: unknown };
}

export function defineQuery<Q extends z.ZodType>(d: QueryDef<Q>): QueryDef<Q> {
  return d;
}

export function pageParams(input: { cursor?: string; limit?: number }): { cursor: string | null; limit: number } {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new DomainError('VALIDATION_FAILED', {
      issues: [{ path: 'limit', message: 'limit must be at most 200' }],
    });
  }
  return { cursor: input.cursor ?? null, limit };
}

export function createQueryRegistry(): {
  register(d: QueryDef): void;
  byResource(resource: string): QueryDef | undefined;
} {
  const byResource = new Map<string, QueryDef>();
  return {
    register(d) {
      byResource.set(d.resource, d);
    },
    byResource(resource) {
      return byResource.get(resource);
    },
  };
}

export interface QueryRouteDeps {
  db: Database.Database;
  readDb: Database.Database;
  writer: Writer;
  clock: Clock;
}

export function registerQueryRoutes(app: FastifyInstance, deps: QueryRouteDeps): void {
  const registry = createQueryRegistry();
  registerTestQueries(registry);
  app.get('/queries/:resource', { config: { group: 'device' } }, async (request) =>
    runQuery(request, deps, registry, 'device'),
  );
  app.get('/admin/queries/:resource', { config: { group: 'admin' } }, async (request) =>
    runQuery(request, deps, registry, 'admin'),
  );
}

function runQuery(
  request: FastifyRequest,
  deps: QueryRouteDeps,
  registry: ReturnType<typeof createQueryRegistry>,
  routeKind: 'device' | 'admin',
): { data: unknown; meta?: unknown } {
  const params = request.params as { resource?: string };
  const def = registry.byResource(params.resource ?? '');
  if (def === undefined || def.sessionKind !== routeKind) throw new DomainError('ROUTE_NOT_FOUND');
  if (routeKind === 'device' && def.session === 'required') requireDeviceSession(request, deps, def.allowStation === true);
  const deviceType = request.device?.device_type;
  if (def.deviceTypes !== undefined && (deviceType === undefined || !def.deviceTypes.includes(deviceType))) {
    throw new DomainError('DEVICE_TYPE_NOT_ALLOWED');
  }
  const parsed = def.querySchema.safeParse(request.query);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', { issues: zodIssues(parsed.error) });
  const page = pageParams(pagingOf(parsed.data));
  const body = def.handle({ db: deps.readDb, page }, parsed.data);
  if (def.countsAsActivity === true && request.session !== undefined) {
    activity.touch(request.session.session_id, deps.clock.branchNow());
  }
  return body;
}

function requireDeviceSession(request: FastifyRequest, deps: QueryRouteDeps, allowStation: boolean): void {
  const token = headerValue(request, 'x-session-token');
  const session = token === undefined ? undefined : findSessionByToken(deps.db, token);
  if (session === undefined || session.device_id !== request.device?.device_id) throw new DomainError('SESSION_INVALID');
  if (session.kind !== 'staff' && !(session.kind === 'station' && allowStation)) throw new DomainError('SESSION_INVALID');
  if (session.ended_at !== null) throw new DomainError('SESSION_EXPIRED');
  if (isIdleExpired(session, deps.clock.branchNow())) {
    endIdle(deps, token!);
    throw new DomainError('SESSION_EXPIRED');
  }
  request.session = session;
}

function endIdle(deps: QueryRouteDeps, token: string): void {
  deps.writer.run((tx) => {
    const fresh = findSessionByToken(tx.db, token);
    if (fresh === undefined || fresh.ended_at !== null) return;
    endSession(tx, fresh, 'idle_timeout', null, null, fresh.device_id ?? 'hub');
  });
}

function pagingOf(value: unknown): { cursor?: string; limit?: number } {
  if (typeof value !== 'object' || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    cursor: typeof record.cursor === 'string' ? record.cursor : undefined,
    limit: typeof record.limit === 'number' ? record.limit : undefined,
  };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first.length === 0) return undefined;
  return first;
}

function zodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function registerTestQueries(registry: ReturnType<typeof createQueryRegistry>): void {
  registry.register(
    defineQuery({
      resource: 'test-quiet',
      sessionKind: 'device',
      session: 'required',
      querySchema: z.object({}),
      handle(ctx) {
        ctx.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
        return { data: { ok: true } };
      },
    }),
  );
  registry.register(
    defineQuery({
      resource: 'test-activity',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: true,
      querySchema: z.object({}),
      handle(ctx) {
        ctx.db.prepare('SELECT COUNT(*) FROM events').pluck().get();
        return { data: { ok: true } };
      },
    }),
  );
  registry.register(
    defineQuery({
      resource: 'test-page',
      sessionKind: 'device',
      session: 'none',
      querySchema: z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().optional(),
      }),
      handle(ctx) {
        return { data: { limit: ctx.page.limit } };
      },
    }),
  );
  registry.register(
    defineQuery({
      resource: 'test-tablet',
      sessionKind: 'device',
      session: 'none',
      deviceTypes: ['tablet'],
      querySchema: z.object({}),
      handle() {
        return { data: { ok: true } };
      },
    }),
  );
}
