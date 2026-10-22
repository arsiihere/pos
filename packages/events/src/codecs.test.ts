import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseEvent } from './codecs';
import { defineEvent } from './registry';

const validEvent = {
  event_id: '01JBF3Q8ZK4M2N6P7R9S0T1V2W',
  tenant_id: 't',
  branch_id: 'b',
  stream_type: 'order' as const,
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

describe('codecs', () => {
  it('[F §4.1, D46] parseEvent upcasts v1 to latest', () => {
    defineEvent({ eventType: 'TestThing', version: 1, payload: z.object({ a: z.number() }) });
    defineEvent({
      eventType: 'TestThing',
      version: 2,
      payload: z.object({ a: z.number(), b: z.string() }),
      upcastFromPrevious: (prev: unknown) => ({ ...(prev as { a: number }), b: 'x' }),
    });
    const parsed = parseEvent({
      ...validEvent,
      event_type: 'TestThing',
      schema_version: 1,
      payload: { a: 1 },
    });
    expect(parsed.payload).toEqual({ a: 1, b: 'x' });
    expect(parsed.schema_version).toBe(2);
  });

  it('[F §4.1] parseEvent rejects a bad payload', () => {
    defineEvent({ eventType: 'BadThing', version: 1, payload: z.object({ a: z.number() }) });
    expect(() =>
      parseEvent({ ...validEvent, event_type: 'BadThing', schema_version: 1, payload: { a: 'no' } }),
    ).toThrow();
  });
});
