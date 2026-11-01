import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DomainError, ErrorCatalogue, statusOf } from './errors';

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('errors', () => {
  it('[F §6.2] every DomainError code used in source is in the catalogue', () => {
    const root = fileURLToPath(new URL('../../..', import.meta.url));
    const files = [...walk(join(root, 'apps')), ...walk(join(root, 'packages'))].filter((path) =>
      /\/(apps|packages)\/[^/]+\/src\//.test(path),
    );
    const used = new Set<string>();
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(/new DomainError\(\s*'([A-Z_]+)'/g)) {
        const code = match[1];
        if (code !== undefined) used.add(code);
      }
    }
    for (const code of used) expect(ErrorCatalogue).toHaveProperty(code);
  });

  it('[00 §9] spec 00 codes have their statuses', () => {
    expect(statusOf('PIN_INVALID')).toBe(401);
    expect(statusOf('DEVICE_NOT_OWNED')).toBe(403);
    expect(statusOf('HOST_NOT_ALLOWED')).toBe(403);
    expect(statusOf('STATION_LOGOUT_NOT_ALLOWED')).toBe(403);
    expect(statusOf('PAIRING_REQUEST_NOT_FOUND')).toBe(404);
    expect(statusOf('DEVICE_SESSION_ACTIVE')).toBe(409);
    expect(statusOf('REGISTRATION_CODE_KIND_UNSUPPORTED')).toBe(422);
    expect(statusOf('IP_LOCKED_OUT')).toBe(429);
    expect(statusOf('LOGIN_LOCKED_OUT')).toBe(429);
  });

  it('[01a §9] 01a codes have their statuses', () => {
    expect(statusOf('BRANCH_NOT_FOUND')).toBe(404);
    expect(statusOf('FLOOR_NOT_FOUND')).toBe(404);
    expect(statusOf('TABLE_NOT_FOUND')).toBe(404);
    expect(statusOf('PROGRAM_NOT_FOUND')).toBe(404);
    expect(statusOf('TAX_CLASS_NOT_FOUND')).toBe(404);
    expect(statusOf('CATEGORY_NOT_FOUND')).toBe(404);
    expect(statusOf('MENU_ITEM_NOT_FOUND')).toBe(404);
    expect(statusOf('CONFIG_NAME_TAKEN')).toBe(409);
    expect(statusOf('CONFIG_IN_USE')).toBe(409);
    expect(statusOf('BUSINESS_DAY_NOT_OPEN')).toBe(409);
    expect(statusOf('CONFIG_REFERENCE_INVALID')).toBe(422);
    expect(statusOf('IDEMPOTENCY_KEY_MISMATCH')).toBe(422);
    expect(statusOf('STOCK_NOT_TRACKED')).toBe(422);
  });

  it('[01b §9] 01b codes have their statuses', () => {
    expect(statusOf('ROLE_NOT_FOUND')).toBe(404);
    expect(statusOf('STAFF_NAME_TAKEN')).toBe(409);
    expect(statusOf('LAST_ADMIN_REQUIRED')).toBe(409);
    expect(statusOf('OWN_ADMIN_ACCESS')).toBe(409);
    expect(statusOf('STAFF_LINKED_TO_OWNER')).toBe(409);
    expect(statusOf('CONFIG_STALE')).toBe(409);
    expect(statusOf('PASSWORD_INVALID')).toBe(401);
    expect(statusOf('PASSWORD_UNCHANGED')).toBe(422);
    expect(statusOf('PASSWORD_CHANGE_REQUIRED')).toBe(403);
  });

  it('[01c §9] 01c codes have their statuses', () => {
    expect(statusOf('VARIANT_GROUP_NOT_FOUND')).toBe(404);
    expect(statusOf('STOCK_ITEM_NOT_FOUND')).toBe(404);
    expect(statusOf('MODIFIER_GROUP_NOT_FOUND')).toBe(404);
    expect(statusOf('DEAL_NOT_FOUND')).toBe(404);
  });

  it('[01d §9] 01d codes are in the catalogue with their statuses', () => {
    expect(ErrorCatalogue).toHaveProperty('ALERT_NOT_FOUND');
    expect(ErrorCatalogue).toHaveProperty('REQUEST_NOT_PENDING');
    expect(ErrorCatalogue).toHaveProperty('REQUEST_PIN_REQUIRED');
    expect(statusOf('ALERT_NOT_FOUND')).toBe(404);
    expect(statusOf('REQUEST_NOT_PENDING')).toBe(409);
    expect(statusOf('REQUEST_PIN_REQUIRED')).toBe(422);
  });

  it('[F §6.2] DomainError carries code and details', () => {
    const e = new DomainError('STAFF_NOT_FOUND', { staff_id: 'x' });
    expect(e.code).toBe('STAFF_NOT_FOUND');
    expect(e.details).toEqual({ staff_id: 'x' });
  });
});
