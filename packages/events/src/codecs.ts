import { z } from 'zod';
import { type EventDraft, type PosEvent, PosEventSchema } from './envelope.js';
import { type EventDef, latestVersion, payloadSchema, registered } from './registry.js';

export function parseEvent(raw: unknown): PosEvent {
  const envelope = PosEventSchema.safeParse(raw);
  if (!envelope.success) throw envelope.error;
  const event = envelope.data;
  const latest = latestVersion(event.event_type);
  if (event.schema_version > latest) {
    throw new Error(`schema_version ${event.schema_version} is newer than ${event.event_type} v${latest}`);
  }
  let version = event.schema_version;
  let payload: unknown = event.payload;
  while (version < latest) {
    const next = registered(event.event_type, version + 1);
    if (next.upcastFromPrevious === undefined) {
      throw new Error(`missing upcaster for ${event.event_type} version ${version + 1}`);
    }
    payload = next.upcastFromPrevious(payload);
    version += 1;
  }
  const parsed = payloadSchema(event.event_type, version).safeParse(payload);
  if (!parsed.success) throw parsed.error;
  return { ...event, schema_version: version, payload: parsed.data as PosEvent['payload'] };
}

export function draftOf<P extends z.ZodType>(
  def: EventDef<P>,
  d: {
    stream_type: PosEvent['stream_type'];
    stream_id: string;
    payload: z.infer<P>;
    occurred_at: number;
    actor_id: string | null;
    device_id: string;
  },
): EventDraft {
  return {
    stream_type: d.stream_type,
    stream_id: d.stream_id,
    event_type: def.eventType,
    schema_version: def.version,
    payload: d.payload as PosEvent['payload'],
    occurred_at: d.occurred_at,
    actor_id: d.actor_id,
    device_id: d.device_id,
  };
}
