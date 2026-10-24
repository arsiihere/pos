import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const AdminBootstrapTokenIssuedPayload = z.object({
  bootstrap_token_id: z.string(),
  expires_at: z.number().int(),
  issued_by: z.enum(['setup', 'cli', 'restore']),
});

export const AdminBootstrapTokenIssued = defineEvent({
  eventType: 'AdminBootstrapTokenIssued',
  version: 1,
  payload: AdminBootstrapTokenIssuedPayload,
});
