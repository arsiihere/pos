import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEvent } from './codecs';
import './index';
import { payloadSchema } from './registry';

describe('fixtures', () => {
  it('[F §6.7, D46] every stored fixture upcasts to its .latest.json', () => {
    const dir = fileURLToPath(new URL('../fixtures/', import.meta.url));
    const v1Files = readdirSync(dir)
      .filter((name) => name.endsWith('.v1.json'))
      .sort();
    expect(v1Files).toHaveLength(14);
    for (const name of v1Files) {
      const v1 = JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown;
      const latest = JSON.parse(readFileSync(join(dir, name.replace('.v1.json', '.latest.json')), 'utf8')) as unknown;
      expect(parseEvent(v1)).toEqual(latest);
    }
  });

  it('[00 §4.2] DevicePaired requires exactly one pairing source id', () => {
    const schema = payloadSchema('DevicePaired', 1);
    const base = {
      device_id: 'd',
      device_name: 'n',
      device_type: 'kds',
      station_id: 'st',
      owner_staff_id: null,
    };
    expect(schema.safeParse({ ...base, pairing_token_id: 't', pairing_request_id: null }).success).toBe(true);
    expect(schema.safeParse({ ...base, pairing_token_id: null, pairing_request_id: 'r' }).success).toBe(true);
    expect(schema.safeParse({ ...base, pairing_token_id: null, pairing_request_id: null }).success).toBe(false);
    expect(schema.safeParse({ ...base, pairing_token_id: 't', pairing_request_id: 'r' }).success).toBe(false);
  });

  it('[00 §4.2] AdminBootstrapTokenIssued requires issued_by', () => {
    const schema = payloadSchema('AdminBootstrapTokenIssued', 1);
    const base = { bootstrap_token_id: 'b', expires_at: 1, issued_by: 'setup' as const };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ bootstrap_token_id: 'b', expires_at: 1 }).success).toBe(false);
    expect(schema.safeParse({ ...base, issued_by: 'cli' }).success).toBe(true);
    expect(schema.safeParse({ ...base, issued_by: 'restore' }).success).toBe(true);
    expect(schema.safeParse({ ...base, issued_by: 'owner' }).success).toBe(false);
  });
});
