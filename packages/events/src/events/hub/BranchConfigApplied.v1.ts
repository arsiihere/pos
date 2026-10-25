import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const BranchConfigAppliedPayload = z.object({
  config_version: z.number().int().positive(),
  snapshot_schema_version: z.number().int().positive(),
  snapshot_hash: z.string().regex(/^[0-9a-f]{64}$/),
  previous_config_version: z.number().int().positive().nullable(),
});

export const BranchConfigApplied = defineEvent({
  eventType: 'BranchConfigApplied',
  version: 1,
  payload: BranchConfigAppliedPayload,
});
