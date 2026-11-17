import type { MessageKey } from '../../../i18n';
import type { HubError } from '../../../api/hub-admin';

// 02a §9 (+ the reused codes) → the toast key the Tables screens show (W0.3 strings). TABLE_SEATING_CHANGED is the
// "This table changed — refreshed" toast; the caller also reads `table-map` once (plan Global constraints).

/** 02a §9 additions, then the reused codes (§9 "Reused"). */
export const TABLE_ERROR_CODES = [
  'TABLE_NEEDS_CLEANING',
  'TABLE_NOT_OPEN',
  'TABLE_SEATING_CHANGED',
  'TABLE_HANDOVER_PENDING',
  'TABLE_HANDOVER_STALE',
  'HANDOVER_TARGET_INVALID',
  'HANDOVER_TARGET_UNAVAILABLE',
  'TABLE_NOT_FREE',
  'TABLE_MERGED',
  'MERGE_BLOCKED_BY_VOID',
  'SPLIT_INVALID',
  'TABLE_NO_ORDERS',
  'TABLE_HAS_OPEN_ORDERS',
  'TABLE_NOT_FOUND',
  'TABLE_ALREADY_LOCKED',
  'TABLE_LOCK_NOT_HELD',
  'PERMISSION_DENIED',
  'VALIDATION_FAILED',
] as const;
export type TableErrorCode = (typeof TABLE_ERROR_CODES)[number];

const KEYS: Record<TableErrorCode, MessageKey> = {
  TABLE_NEEDS_CLEANING: 'tables.err.TABLE_NEEDS_CLEANING',
  TABLE_NOT_OPEN: 'tables.err.TABLE_NOT_OPEN',
  TABLE_SEATING_CHANGED: 'tables.changed',
  TABLE_HANDOVER_PENDING: 'tables.err.TABLE_HANDOVER_PENDING',
  TABLE_HANDOVER_STALE: 'tables.err.TABLE_HANDOVER_STALE',
  HANDOVER_TARGET_INVALID: 'tables.err.HANDOVER_TARGET_INVALID',
  HANDOVER_TARGET_UNAVAILABLE: 'tables.err.HANDOVER_TARGET_UNAVAILABLE',
  TABLE_NOT_FREE: 'tables.err.TABLE_NOT_FREE',
  TABLE_MERGED: 'tables.err.TABLE_MERGED',
  MERGE_BLOCKED_BY_VOID: 'tables.err.MERGE_BLOCKED_BY_VOID',
  SPLIT_INVALID: 'tables.err.SPLIT_INVALID',
  TABLE_NO_ORDERS: 'tables.err.TABLE_NO_ORDERS',
  TABLE_HAS_OPEN_ORDERS: 'tables.err.TABLE_HAS_OPEN_ORDERS',
  TABLE_NOT_FOUND: 'tables.err.TABLE_NOT_FOUND',
  TABLE_ALREADY_LOCKED: 'tables.err.TABLE_ALREADY_LOCKED',
  TABLE_LOCK_NOT_HELD: 'tables.err.TABLE_LOCK_NOT_HELD',
  PERMISSION_DENIED: 'tables.err.PERMISSION_DENIED',
  VALIDATION_FAILED: 'tables.err.VALIDATION_FAILED',
};

/** 02a §9 `PERMISSION_DENIED.reason` (Q-15 outside_scope; other_owner → 22b's dialog, this is its toast). */
const DENIED: Record<string, MessageKey> = {
  outside_scope: 'tables.err.outside_scope',
  not_holder: 'tables.err.not_holder',
  not_assigned: 'tables.err.not_assigned',
  other_owner: 'tables.err.other_owner',
};

/** The toast key for a Tables command / query error. A lost hub = "Needs the hub". */
export function tableErrorKey(error: HubError): MessageKey {
  if (error.kind === 'network') return 'tables.toast.needs_hub';
  if (error.kind === 'signed_out') return 'tables.err.unknown';
  if (error.code === 'PERMISSION_DENIED') {
    const reason = error.details['reason'];
    if (typeof reason === 'string' && Object.hasOwn(DENIED, reason)) return DENIED[reason]!;
  }
  return (KEYS as Record<string, MessageKey | undefined>)[error.code] ?? 'tables.err.unknown';
}

/**
 * Q-3 / 02b §3.12 (integrator ruling, review #133): the hub's definitive refusal of a send — a 4xx other than
 * `426 CLIENT_UPGRADE_REQUIRED` and `403 DEVICE_REVOKED` — is `refused` (shown to the caller); anything else (a 5xx,
 * 426, DEVICE_REVOKED, a network error or a lost 2xx reply) is not an answer: null here, and a queued entry stays.
 */
export function definitiveRefusal(error: HubError): Extract<HubError, { kind: 'api' }> | null {
  if (error.kind !== 'api') return null;
  if (error.status < 400 || error.status > 499) return null;
  if (error.status === 426 || error.code === 'CLIENT_UPGRADE_REQUIRED' || error.code === 'DEVICE_REVOKED') return null;
  return error;
}
