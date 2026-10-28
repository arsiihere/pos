import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Clock } from '../lib/clock.js';
import { hubTime } from '../lib/hub-time.js';
import { currentConfigEntry } from '../sync/branch-config-holder.js';
import { defineQuery, queryRegistry } from './registry.js';

// §6.23, S47: the current snapshot for staff and station clients, from memory (0 statements).
export function registerBranchConfigQuery(app: FastifyInstance, clock: Clock): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'branch-config',
      sessionKind: 'device',
      session: 'required',
      allowStation: true,
      countsAsActivity: false,
      querySchema: z.object({}),
      handle() {
        const entry = currentConfigEntry();
        if (entry === null) return { data: null };
        return {
          data: {
            config_version: entry.configVersion,
            snapshot_hash: entry.snapshotHash,
            snapshot: entry.config,
            hub_time: hubTime(clock),
          },
        };
      },
    }),
  );
}
