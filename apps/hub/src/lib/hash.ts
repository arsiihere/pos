/// <reference types="node" />
import { createHash } from 'node:crypto';

export function sha256hex(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((v as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function payloadHash(payload: unknown): string {
  return sha256hex(canonicalJson(payload));
}
