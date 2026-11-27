import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from './registry.js';

// ⚠️ 00 v1.14 M101 (owner 2026-11-28 Q8; QA BUG-12): input on the device is activity. The staff client sends this after
// the signed-in person's tap or key, at most once per 60 s, never on a timer, frame or poll. The route's session guard
// refreshes the session's activity in memory (M5, counts_as_activity); the query itself reads and writes nothing.
export function registerActivityQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'activity',
      sessionKind: 'device',
      session: 'required',
      countsAsActivity: true,
      querySchema: z.object({}),
      handle() {
        return { data: {} };
      },
    }),
  );
}
