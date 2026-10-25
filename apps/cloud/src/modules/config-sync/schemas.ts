import { z } from 'zod';

export { SyncConfigEnvelopeSchema as SyncConfigResponse } from '@pos/events';

export const SyncConfigQuery = z.object({
  config_version: z.coerce.number().int().min(0),
  directory_version: z.coerce.number().int().min(0),
});

export type SyncConfigQueryInput = z.infer<typeof SyncConfigQuery>;
