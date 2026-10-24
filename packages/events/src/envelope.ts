import { z } from 'zod';

export const StreamTypeSchema = z.enum([
  'order',
  'table',
  'station',
  'stock',
  'shift',
  'audit',
  'hub',
  'staff',
]);

export const PosEventSchema = z.object({
  event_id: z.string(),
  tenant_id: z.string(),
  branch_id: z.string(),
  stream_type: StreamTypeSchema,
  stream_id: z.string(),
  event_type: z.string(),
  schema_version: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
  occurred_at: z.number().int(),
  recorded_at: z.number().int(),
  actor_id: z.string().nullable(),
  device_id: z.string(),
  seq: z.number().int(),
});

export type PosEvent = z.infer<typeof PosEventSchema>;

export const PosCommandSchema = z.object({
  command_id: z.string(),
  tenant_id: z.string(),
  branch_id: z.string(),
  command_type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurred_at: z.number().int(),
  actor_id: z.string().nullable(),
  device_id: z.string(),
});

export type PosCommand = z.infer<typeof PosCommandSchema>;

export type EventDraft = Omit<PosEvent, 'event_id' | 'seq' | 'recorded_at' | 'tenant_id' | 'branch_id'>;
