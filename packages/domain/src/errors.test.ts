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

  it('[03a §9] 03a codes and 01a POINT_NOT_FOUND have their statuses', () => {
    expect(statusOf('STATION_PAUSED')).toBe(409);
    expect(statusOf('STATION_PAUSE_DISABLED')).toBe(409);
    expect(statusOf('ORDER_NOT_IN_ENGINE')).toBe(409);
    expect(statusOf('RETURN_ALREADY_OPEN')).toBe(409);
    expect(statusOf('POINT_NOT_FOUND')).toBe(404);
  });

  it('[03a §9] ORDER_NOT_IN_ENGINE { order_id } serialises to the F §6.1 envelope', () => {
    const e = new DomainError('ORDER_NOT_IN_ENGINE', { order_id: '01JBF3Q90A1B2C3D4E5F6G7H8M' });
    const body = JSON.parse(
      JSON.stringify({ error: { code: e.code, message: e.message, details: e.details, request_id: 'r1' } }),
    );
    expect(statusOf(e.code)).toBe(409);
    expect(body).toEqual({
      error: {
        code: 'ORDER_NOT_IN_ENGINE',
        message: 'ORDER_NOT_IN_ENGINE',
        details: { order_id: '01JBF3Q90A1B2C3D4E5F6G7H8M' },
        request_id: 'r1',
      },
    });
  });

  it('[F §6.2] DomainError carries code and details', () => {
    const e = new DomainError('STAFF_NOT_FOUND', { staff_id: 'x' });
    expect(e.code).toBe('STAFF_NOT_FOUND');
    expect(e.details).toEqual({ staff_id: 'x' });
  });
});

describe('[01a A-1] ZONE_NOT_FOUND', () => {
  it('[01a A-1] ZONE_NOT_FOUND is 404', () => {
    expect(statusOf('ZONE_NOT_FOUND')).toBe(404);
  });
});

describe('[02a §9] table codes', () => {
  it('[02a §9] each new code has its status', () => {
    const expected: Record<string, number> = {
      TABLE_NEEDS_CLEANING: 409,
      TABLE_NOT_OPEN: 409,
      TABLE_SEATING_CHANGED: 409,
      TABLE_HANDOVER_PENDING: 409,
      TABLE_HANDOVER_STALE: 409,
      HANDOVER_TARGET_INVALID: 422,
      HANDOVER_TARGET_UNAVAILABLE: 409,
      TABLE_NOT_FREE: 409,
      TABLE_MERGED: 409,
      MERGE_BLOCKED_BY_VOID: 409,
      SPLIT_INVALID: 409,
      TABLE_NO_ORDERS: 409,
      TABLE_HAS_OPEN_ORDERS: 409,
    };
    expect(Object.keys(expected)).toHaveLength(13);
    for (const [code, status] of Object.entries(expected)) {
      expect(ErrorCatalogue).toHaveProperty(code);
      expect(ErrorCatalogue[code as keyof typeof ErrorCatalogue].status).toBe(status);
    }
  });

  it('[02a §9] TABLE_NOT_FOUND, TABLE_ALREADY_LOCKED, TABLE_LOCK_NOT_HELD unchanged', () => {
    expect(statusOf('TABLE_NOT_FOUND')).toBe(404);
    expect(statusOf('TABLE_ALREADY_LOCKED')).toBe(409);
    expect(statusOf('TABLE_LOCK_NOT_HELD')).toBe(409);
  });
});

describe('[02b §9] ordering codes', () => {
  it('[02b §9] each new code has its status', () => {
    const expected: Record<string, number> = {
      ORDER_NOT_FOUND: 404,
      ORDER_ITEM_ID_IN_USE: 409,
      ITEM_UNAVAILABLE: 409,
      ITEM_OUT_OF_HOURS: 409,
      ITEM_SOLD_OUT: 409,
      OPTION_CHOICE_INVALID: 422,
      ZONE_ITEM_NOT_CONFIGURED: 422,
      STOCK_INSUFFICIENT: 409,
      LINE_NOT_WEIGHED: 409,
      LINE_WEIGHT_PENDING: 409,
      LINE_ALREADY_SETTLED: 409,
      COMP_NOT_ALLOWED: 409,
      COMP_PENDING: 409,
      ORDER_BILLED: 409,
    };
    expect(Object.keys(expected)).toHaveLength(14);
    for (const [code, status] of Object.entries(expected)) {
      expect(ErrorCatalogue).toHaveProperty(code);
      expect(ErrorCatalogue[code as keyof typeof ErrorCatalogue].status).toBe(status);
    }
  });

  it('[02b §9] reused codes unchanged', () => {
    const reused: Record<string, number> = {
      BUSINESS_DAY_NOT_OPEN: 409,
      ORDER_NOT_IN_ENGINE: 409,
      RETURN_ALREADY_OPEN: 409,
      STATION_PAUSED: 409,
      ITEM_WRONG_STAGE: 409,
      MENU_ITEM_NOT_FOUND: 404,
      DEAL_NOT_FOUND: 404,
      ZONE_NOT_FOUND: 404,
      SESSION_EXPIRED: 401,
      PERMISSION_DENIED: 403,
      VALIDATION_FAILED: 400,
    };
    for (const [code, status] of Object.entries(reused)) {
      expect(ErrorCatalogue).toHaveProperty(code);
      expect(ErrorCatalogue[code as keyof typeof ErrorCatalogue].status).toBe(status);
    }
  });

  it('[03b §9] 03b codes have their statuses', () => {
    expect(statusOf('ITEM_UNDO_WINDOW_CLOSED')).toBe(409);
    expect(statusOf('PASS_UNDO_WINDOW_CLOSED')).toBe(409);
    expect(statusOf('ITEM_DONE_CONFIRM_REQUIRED')).toBe(422);
    expect(statusOf('PASS_RECEIVER_INVALID')).toBe(422);
  });

  it('[03c §9] 03c codes have their statuses', () => {
    expect(statusOf('PRINTER_NOT_FOUND')).toBe(404);
    expect(statusOf('PRINT_JOB_NOT_FOUND')).toBe(404);
    expect(statusOf('PRINT_JOB_NOT_PENDING')).toBe(409);
  });

  it('[03c v1.0.6 §9, Q-14] ALERT_ALREADY_CLOSED is 409', () => {
    expect(statusOf('ALERT_ALREADY_CLOSED')).toBe(409);
  });
});
