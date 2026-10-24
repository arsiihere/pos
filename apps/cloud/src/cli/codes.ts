/// <reference types="node" />
import { createHash } from 'node:crypto';
import type { SecretGen } from '../lib/secrets.js';

export function generateCode(secrets: SecretGen): string {
  const raw = secrets.crockford(12);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

export function normaliseCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function codeHash(code: string): string {
  return createHash('sha256').update(normaliseCode(code)).digest('hex');
}
