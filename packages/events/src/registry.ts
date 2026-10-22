import { z } from 'zod';

export interface EventDef<P extends z.ZodType = z.ZodType> {
  eventType: string;
  version: number;
  payload: P;
  upcastFromPrevious?: (prev: unknown) => unknown;
}

const registry = new Map<string, Map<number, EventDef>>();

export function defineEvent<P extends z.ZodType>(def: {
  eventType: string;
  version: number;
  payload: P;
  upcastFromPrevious?: (prev: unknown) => z.infer<P>;
}): EventDef<P> {
  const versions = registry.get(def.eventType) ?? new Map<number, EventDef>();
  if (versions.has(def.version)) {
    throw new Error(`duplicate event ${def.eventType} version ${def.version}`);
  }
  if (def.version !== 1 && !versions.has(def.version - 1)) {
    throw new Error(`version gap for ${def.eventType} version ${def.version}`);
  }
  const stored: EventDef<P> = {
    eventType: def.eventType,
    version: def.version,
    payload: def.payload,
    upcastFromPrevious: def.upcastFromPrevious,
  };
  versions.set(def.version, stored);
  registry.set(def.eventType, versions);
  return stored;
}

export function latestVersion(eventType: string): number {
  const versions = registry.get(eventType);
  if (versions === undefined || versions.size === 0) {
    throw new Error(`unknown event type ${eventType}`);
  }
  return Math.max(...versions.keys());
}

export function payloadSchema(eventType: string, version: number): z.ZodType {
  return registered(eventType, version).payload;
}

export function registered(eventType: string, version: number): EventDef {
  const def = registry.get(eventType)?.get(version);
  if (def === undefined) throw new Error(`unknown event ${eventType} version ${version}`);
  return def;
}
