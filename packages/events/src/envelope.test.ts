import { describe, expect, it } from 'vitest';
import { PosCommandSchema, PosEventSchema } from './envelope';

const validEvent = {
  event_id: '01JBF3Q8ZK4M2N6P7R9S0T1V2W',
  tenant_id: 't',
  branch_id: 'b',
  stream_type: 'order',
  stream_id: 's',
  event_type: 'OrderPlaced',
  schema_version: 1,
  payload: {},
  occurred_at: 1,
  recorded_at: 2,
  actor_id: null,
  device_id: 'd',
  seq: 1,
};

const validCommand = {
  command_id: 'c',
  tenant_id: 't',
  branch_id: 'b',
  command_type: 'SubmitOrder',
  payload: {},
  occurred_at: 1,
  actor_id: null,
  device_id: 'd',
};

describe('envelope', () => {
  it('[F §4.1] PosEventSchema rejects an unknown stream_type', () => {
    expect(PosEventSchema.safeParse({ ...validEvent, stream_type: 'device' }).success).toBe(false);
  });

  it('[F §4.1] PosCommandSchema requires command_id and device_id', () => {
    const withoutCommand: Record<string, unknown> = { ...validCommand };
    delete withoutCommand.command_id;
    const withoutDevice: Record<string, unknown> = { ...validCommand };
    delete withoutDevice.device_id;
    expect(PosCommandSchema.safeParse(withoutCommand).success).toBe(false);
    expect(PosCommandSchema.safeParse(withoutDevice).success).toBe(false);
  });
});
