import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const HubProvisionedPayload = z.object({
  tenant_id: z.string(),
  branch_id: z.string(),
  hub_version: z.string(),
});

export const HubProvisioned = defineEvent({
  eventType: 'HubProvisioned',
  version: 1,
  payload: HubProvisionedPayload,
});
