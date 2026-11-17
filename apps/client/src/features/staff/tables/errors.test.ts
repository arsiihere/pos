import { describe, expect, it } from 'vitest';
import { en } from '../../../i18n/en';
import { definitiveRefusal, TABLE_ERROR_CODES, tableErrorKey } from './errors';

const api = (code: string, details: Record<string, unknown> = {}) => ({ kind: 'api' as const, status: 409, code, details });

describe('[02a §9] Tables error toasts', () => {
  it('[02a §9] every §9 code maps to a toast key; TABLE_SEATING_CHANGED → tables.changed', () => {
    // §9 table (13 codes) + "Reused" (5)
    const section9 = [
      'TABLE_NEEDS_CLEANING', 'TABLE_NOT_OPEN', 'TABLE_SEATING_CHANGED', 'TABLE_HANDOVER_PENDING', 'TABLE_HANDOVER_STALE',
      'HANDOVER_TARGET_INVALID', 'HANDOVER_TARGET_UNAVAILABLE', 'TABLE_NOT_FREE', 'TABLE_MERGED', 'MERGE_BLOCKED_BY_VOID',
      'SPLIT_INVALID', 'TABLE_NO_ORDERS', 'TABLE_HAS_OPEN_ORDERS',
      'TABLE_NOT_FOUND', 'TABLE_ALREADY_LOCKED', 'TABLE_LOCK_NOT_HELD', 'PERMISSION_DENIED', 'VALIDATION_FAILED',
    ];
    expect([...TABLE_ERROR_CODES].sort()).toEqual([...section9].sort());
    for (const code of section9) {
      const key = tableErrorKey(api(code));
      expect(key in en, code).toBe(true);
      expect(key, code).not.toBe('tables.err.unknown');
    }
    expect(tableErrorKey(api('TABLE_SEATING_CHANGED'))).toBe('tables.changed');
    expect(en['tables.changed']).toBe('This table changed — refreshed');
    expect(tableErrorKey(api('TABLE_HAS_OPEN_ORDERS', { order_count: 2 }))).toBe('tables.err.TABLE_HAS_OPEN_ORDERS');
  });

  it('[02a Q-15] PERMISSION_DENIED reasons; network and unknown codes', () => {
    expect(tableErrorKey(api('PERMISSION_DENIED', { reason: 'outside_scope', table_ids: ['TB4'] }))).toBe('tables.err.outside_scope');
    expect(en['tables.err.outside_scope']).toBe('This table is outside your floors');
    expect(tableErrorKey(api('PERMISSION_DENIED', { reason: 'not_assigned' }))).toBe('tables.err.not_assigned');
    expect(tableErrorKey(api('PERMISSION_DENIED', { reason: 'something_new' }))).toBe('tables.err.PERMISSION_DENIED');
    expect(tableErrorKey({ kind: 'network' })).toBe('tables.toast.needs_hub');
    expect(tableErrorKey(api('NOT_A_CODE'))).toBe('tables.err.unknown');
  });
});

describe('[02b §3.12] what counts as refused (review #133)', () => {
  it('[02b §3.12] a definitive 4xx is refused; 5xx, 426, 403 DEVICE_REVOKED and a network error are not', () => {
    expect(definitiveRefusal({ kind: 'api', status: 409, code: 'TABLE_NO_ORDERS', details: {} })).toMatchObject({ code: 'TABLE_NO_ORDERS' });
    expect(definitiveRefusal({ kind: 'api', status: 403, code: 'PERMISSION_DENIED', details: {} })).not.toBeNull();
    expect(definitiveRefusal({ kind: 'api', status: 503, code: 'SERVICE_UNAVAILABLE', details: {} })).toBeNull();
    expect(definitiveRefusal({ kind: 'api', status: 500, code: 'INTERNAL_ERROR', details: {} })).toBeNull();
    expect(definitiveRefusal({ kind: 'api', status: 426, code: 'CLIENT_UPGRADE_REQUIRED', details: {} })).toBeNull();
    expect(definitiveRefusal({ kind: 'api', status: 403, code: 'DEVICE_REVOKED', details: {} })).toBeNull();
    expect(definitiveRefusal({ kind: 'network' })).toBeNull();
  });
});
