/// <reference types="node" />
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DomainError } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { Clock } from '../lib/clock.js';

const TOKEN_TTL_S = 60 * 60;

export interface AccessClaims {
  sub: string;
  tenant_id: string;
  allowed_branch_ids: string[];
}

declare module 'fastify' {
  interface FastifyInstance {
    jwt: {
      sign(claims: AccessClaims): string;
      verify(token: string): AccessClaims;
    };
  }
}

export function registerJwt(app: FastifyInstance, secret: string, clock: Clock): void {
  app.decorate('jwt', {
    sign: (claims) => signJwt(secret, claims, clock.branchNow()),
    verify: (token) => verifyJwt(secret, token, clock.branchNow()),
  });
}

function signJwt(secret: string, claims: AccessClaims, nowMs: number): string {
  const nowS = Math.floor(nowMs / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: claims.sub,
      tenant_id: claims.tenant_id,
      allowed_branch_ids: claims.allowed_branch_ids,
      iat: nowS,
      exp: nowS + TOKEN_TTL_S,
    }),
  );
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}

function verifyJwt(secret: string, token: string, nowMs: number): AccessClaims {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) throw new DomainError('JWT_INVALID');
  const [headerPart, payloadPart, signature] = parts as [string, string, string];
  const expected = createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest('base64url');
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new DomainError('JWT_INVALID');
  }
  const header = parseJson(headerPart);
  const payload = parseJson(payloadPart);
  if (!isRecord(header) || header.alg !== 'HS256') throw new DomainError('JWT_INVALID');
  if (!isRecord(payload)) throw new DomainError('JWT_INVALID');
  const { sub, tenant_id, allowed_branch_ids, exp } = payload;
  if (typeof sub !== 'string' || sub.length === 0) throw new DomainError('JWT_INVALID');
  if (typeof tenant_id !== 'string' || tenant_id.length === 0) throw new DomainError('JWT_INVALID');
  if (!Array.isArray(allowed_branch_ids) || allowed_branch_ids.some((id) => typeof id !== 'string')) {
    throw new DomainError('JWT_INVALID');
  }
  if (typeof exp !== 'number' || nowMs >= exp * 1000) throw new DomainError('JWT_INVALID');
  return { sub, tenant_id, allowed_branch_ids };
}

function parseJson(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    throw new DomainError('JWT_INVALID');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}
