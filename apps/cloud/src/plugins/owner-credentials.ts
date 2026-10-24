import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import {
  ownerByEmail,
  refreshTokenByHash,
  type OwnerUser,
  type RefreshToken,
} from '../db/credential-lookup.js';

declare module 'fastify' {
  interface FastifyInstance {
    ownerCredentials: {
      byEmail(email: string): Promise<OwnerUser | null>;
      refreshByHash(client: pg.PoolClient, hash: string, forUpdate: boolean): Promise<RefreshToken | null>;
    };
  }
}

export function registerOwnerCredentials(app: FastifyInstance, pool: pg.Pool): void {
  app.decorate('ownerCredentials', {
    byEmail: (email) => ownerByEmail(pool, email),
    refreshByHash: (client, hash, forUpdate) => refreshTokenByHash(client, hash, forUpdate),
  });
}
