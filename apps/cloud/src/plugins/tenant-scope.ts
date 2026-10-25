/// <reference types="node" />
import { createHash } from 'node:crypto';
import { DomainError } from '@pos/domain';
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type pg from 'pg';
import { branchByApiKeyHash, registrationCodeByHash } from '../db/credential-lookup.js';
import type { TenantContext } from '../db/tenant-scoped-repository.js';

export const TENANT_SCOPE_ALLOWLIST = [
  'POST /v1/auth/login',
  'POST /v1/auth/refresh',
  'GET /v1/health',
  'GET /owner/', // S21: static owner pages (§7.1)
  'GET /owner/*',
] as const;

export type TenantScope = 'jwt' | 'branch-key' | 'registration-code' | 'none';

declare module 'fastify' {
  interface FastifyContextConfig {
    tenantScope?: TenantScope;
    tenantLevel?: boolean;
  }
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

const SCOPES = new Set<TenantScope>(['jwt', 'branch-key', 'registration-code', 'none']);

export interface ListedTenantScope {
  method: string;
  url: string;
  tenantScope: TenantScope;
}

const listed = new WeakMap<FastifyInstance, ListedTenantScope[]>();

export function listTenantScopes(app: FastifyInstance): ListedTenantScope[] {
  return listed.get(app) ?? [];
}

export function registerTenantScope(app: FastifyInstance, deps: { pool: pg.Pool }): void {
  const problems: string[] = [];
  const routes: ListedTenantScope[] = [];
  listed.set(app, routes);
  const handlers: Record<Exclude<TenantScope, 'none'>, preHandlerHookHandler> = {
    jwt: async (request) => {
      const token = bearer(request.headers.authorization);
      if (token === undefined) throw new DomainError('JWT_INVALID');
      const claims = app.jwt.verify(token);
      setTenant(request, claims.tenant_id, claims.allowed_branch_ids);
    },
    'branch-key': async (request) => {
      const key = bearer(request.headers.authorization);
      if (key === undefined) throw new DomainError('BRANCH_API_KEY_INVALID');
      const row = await branchByApiKeyHash(deps.pool, sha256hex(key));
      if (row === null || row.revoked_at !== null) throw new DomainError('BRANCH_API_KEY_INVALID');
      setTenant(request, row.tenant_id, [row.branch_id]);
    },
    'registration-code': async (request) => {
      const raw = registrationCodeOf(request.body);
      if (raw === undefined) throw new DomainError('REGISTRATION_CODE_INVALID');
      const client = await deps.pool.connect();
      try {
        const row = await registrationCodeByHash(client, sha256hex(normaliseCode(raw)), false);
        if (row === null) throw new DomainError('REGISTRATION_CODE_INVALID');
        setTenant(request, row.tenant_id, [row.branch_id]);
      } finally {
        client.release();
      }
    },
  };

  app.addHook('onRoute', (opts) => {
    const methods = (Array.isArray(opts.method) ? opts.method : [opts.method]).map((method) =>
      String(method).toUpperCase(),
    );
    const scope = opts.config?.tenantScope;
    let guard: preHandlerHookHandler | undefined;
    for (const method of methods) {
      const label = `${method} ${opts.url}`;
      if (!isScope(scope)) {
        problems.push(`route has no tenantScope: ${label}`);
        continue;
      }
      routes.push({ method, url: opts.url, tenantScope: scope });
      if (scope === 'none') {
        if (!isAllowlisted(method, opts.url)) problems.push(`tenantScope none is not allowlisted: ${label}`);
        continue;
      }
      guard = handlers[scope];
    }
    if (guard !== undefined) {
      const prior = opts.preHandler === undefined ? [] : [opts.preHandler].flat();
      opts.preHandler = [guard, ...prior];
    }
  });

  app.addHook('onReady', async () => {
    if (problems.length > 0) throw new Error(problems.join('; '));
  });
}

function isScope(value: unknown): value is TenantScope {
  return typeof value === 'string' && SCOPES.has(value as TenantScope);
}

function isAllowlisted(method: string, url: string): boolean {
  if ((TENANT_SCOPE_ALLOWLIST as readonly string[]).includes(`${method} ${url}`)) return true;
  return method === 'HEAD' && (TENANT_SCOPE_ALLOWLIST as readonly string[]).includes(`GET ${url}`);
}

function setTenant(request: FastifyRequest, tenantId: string, branchIds: readonly string[]): void {
  request.tenant = Object.freeze({
    tenantId,
    branchIds: Object.freeze([...branchIds]),
  });
}

function bearer(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match?.[1];
}

function registrationCodeOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('registration_code' in body)) return undefined;
  const code = (body as { registration_code?: unknown }).registration_code;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function normaliseCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

function sha256hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
