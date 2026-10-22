import { z } from 'zod';

export const WsClientMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth'),
    device_token: z.string(),
    session_token: z.string(),
  }),
  z.object({
    type: z.literal('ack'),
    last_seq: z.number().int(),
  }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

export const WsServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('catch_up'),
    as_of_seq: z.number().int(),
    state: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal('event'),
    seq: z.number().int(),
    event: z.object({
      event_id: z.string(),
      event_type: z.string(),
      schema_version: z.number().int().positive(),
      payload: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    type: z.literal('error'),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

export const WS_CLOSE = {
  CREDENTIALS: 4401,
  FORBIDDEN: 4403,
  UPGRADE: 4426,
  RESTARTING: 1012,
} as const;
