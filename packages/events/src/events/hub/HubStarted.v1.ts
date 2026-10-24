import { z } from 'zod';
import { defineEvent } from '../../registry.js';

export const HubStartedPayload = z.object({
  hub_down_at: z.number().int().nullable(),
  hub_up_at: z.number().int(),
  events_replayed: z.number().int(),
  missed_fires: z.number().int(),
  boot_ms: z.number().int(),
});

export const HubStarted = defineEvent({
  eventType: 'HubStarted',
  version: 1,
  payload: HubStartedPayload,
});
