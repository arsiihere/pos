import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { HubConfig } from '../config/schema.js';
import { readBranchConfigRow } from '../projections/branch-config.js';
import { configPoller } from '../sync/config-poller.js';
import { defineQuery, queryRegistry } from './registry.js';

// §6.21, S29: versions from 2 primary-key reads, the last poll and problem from the poller's memory.
// The admin guard already requires access-hub-admin; no further permission.
export function registerConfigStatusQuery(app: FastifyInstance, config: HubConfig): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'config-status',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const branchId = config.provisioned?.branch_id;
        const row = branchId === undefined ? undefined : readBranchConfigRow(ctx.db, branchId);
        const directory = ctx.db.prepare('SELECT directory_version FROM staff_directory_meta').get() as
          | { directory_version: number }
          | undefined;
        const poller = configPoller(app);
        return {
          data: {
            config_version: row?.config_version ?? null,
            snapshot_schema_version: row?.snapshot_schema_version ?? null,
            applied_at: row?.applied_at ?? null,
            directory_version: directory?.directory_version ?? null,
            last_poll: poller.lastPoll(),
            last_problem: poller.lastProblem(),
          },
        };
      },
    }),
  );
}
