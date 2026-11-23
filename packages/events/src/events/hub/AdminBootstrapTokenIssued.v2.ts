import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 05a §4.2, §6.11: `issued_by` gains 'recovery' (the hub admin home's recovery link at zero admin devices).
export const AdminBootstrapTokenIssuedPayloadV2 = z.object({
  bootstrap_token_id: z.string(),
  expires_at: z.number().int(),
  issued_by: z.enum(['setup', 'cli', 'restore', 'recovery']),
});

// v1 is a subset of v2: the upcast is the identity.
export const AdminBootstrapTokenIssuedV2 = defineEvent({
  eventType: 'AdminBootstrapTokenIssued',
  version: 2,
  payload: AdminBootstrapTokenIssuedPayloadV2,
  upcastFromPrevious: (prev) => prev as z.infer<typeof AdminBootstrapTokenIssuedPayloadV2>,
});
