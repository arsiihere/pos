// Test data for 04 §10 test 50 (not exported from the package index): one event fixture per row of the §3.6 action
// table, in the real @pos/events payload shapes, and events-only lookups. Used by `audit.test.ts` (pure map) and by
// the hub's `test/audit/fixtures-parse.int.test.ts`, which parses every fixture with the @pos/events registry first.
import type { AuditEvent, AuditLookups, AuditRequestRef } from './audit.js';

export const ENV_ACTOR = 'st-env';
let seq = 0;

export function ev(event_type: string, payload: Record<string, unknown>, over: Partial<AuditEvent> = {}): AuditEvent {
  seq += 1;
  return {
    seq,
    event_id: `ev-${seq}`,
    event_type,
    stream_type: 'order',
    stream_id: 'O7',
    recorded_at: 1_000 + seq,
    actor_id: ENV_ACTOR,
    device_id: 'dev-1',
    payload,
    ...over,
  };
}

export const VOID_REQ: AuditRequestRef = {
  kind: 'void_approval',
  requester_staff_id: 'st-hamza',
  order_id: 'O7',
  table_code: 'T12',
  answerer_staff_id: 'st-imran',
};

export function lookups(requests: Record<string, AuditRequestRef> = {}, tables: Record<string, string> = {}): AuditLookups {
  return {
    requestOf: (id) => requests[id] ?? null,
    tableOf: (id) => tables[id] ?? null,
  };
}

export const L = lookups(
  {
    A9: VOID_REQ,
    C1: { kind: 'comp', requester_staff_id: 'st-hamza', order_id: 'O7', table_code: 'T12', answerer_staff_id: null },
    R1: { kind: 'table_takeover', requester_staff_id: 'st-ali', order_id: null, table_code: null, answerer_staff_id: null },
  },
  { O7: 'tbl-12' },
);

export function raised(kind: string, request: boolean, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    alert_id: kind === 'void_approval' ? 'A9' : 'C1',
    kind,
    family: 'urgent',
    subject_stream_type: 'order',
    subject_stream_id: 'O7',
    dedupe_key: `${kind}:K1`,
    requester_staff_id: 'st-hamza',
    target: { kind: 'answerers' },
    values:
      kind === 'void_approval'
        ? { order_id: 'O7', order_item_id: 'K1', units: 1, reason_code: 'quality', note: null, disposition: 'moved', disposition_note: null, touched_ids: ['K1'], line_dispositions: { K1: 'moved' }, refund_minor: 240000, comp_voided_minor: 0 }
        : { order_id: 'O7', order_item_id: 'K1', units: 1, reason_code: 'guest', note: null },
    display: { kind_label_key: `alert.${kind}.lock`, table_code: 'T12', requester_name: 'Hamza' },
    details: { item: 'Mutton Karahi', quantity: 1, amount: 240000, reason: 'quality', disposition: 'void.disposition.moved' },
    hidden_from: null,
    request: request ? { answers: ['approve', 'reject'], right_mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void', approver_role_ids: ['r-mgr'], receiver_staff_id: null, needs_pin: 'always' } : null,
    ...over,
  };
}

/** One fixture per row of the §3.6 action table (both event types where a row names two). */
export function fixtures(): Array<{ action: string; event: AuditEvent }> {
  return [
    { action: 'void_requested', event: ev('AlertRaised', raised('void_approval', true)) },
    { action: 'void_answered', event: ev('RequestAnswered', { alert_id: 'A9', decision: 'approve', answerer_staff_id: 'st-imran', method: 'pin', device_id: 'dev-2', on_requester_device: false }) },
    { action: 'comp_answered', event: ev('RequestAnswered', { alert_id: 'C1', decision: 'reject', answerer_staff_id: 'st-imran', method: 'session', device_id: 'dev-2', on_requester_device: false }) },
    { action: 'request_answered', event: ev('RequestAnswered', { alert_id: 'R1', decision: 'accept', answerer_staff_id: 'st-imran', method: 'session', device_id: 'dev-2', on_requester_device: false }, { stream_type: 'table', stream_id: 'tbl-4' }) },
    { action: 'request_withdrawn', event: ev('RequestWithdrawn', { alert_id: 'A9', by_staff_id: 'st-hamza' }) },
    { action: 'request_pin_failed', event: ev('RequestPinFailed', { alert_id: 'A9', subject_stream_type: 'order', subject_stream_id: 'O7', answerer_staff_id: 'st-imran', method: 'pin', device_id: 'dev-1', requester_staff_id: 'st-hamza', outcome: 'pin_invalid', error_code: 'PIN_INVALID' }, { stream_type: 'audit', stream_id: 'A9' }) },
    { action: 'item_voided', event: ev('ItemVoided', { order_item_id: 'K1', units: 1, refund_minor: 240000, comp_voided_minor: 0, alert_id: 'A9', approver_staff_id: 'st-imran', note: null, disposition_note: null, requester_staff_id: 'st-hamza', reason_code: 'quality', disposition: 'moved' }) },
    { action: 'item_moved_to_stock', event: ev('ItemMovedToStock', { order_item_id: 'K1', units: 1 }) },
    { action: 'item_removed', event: ev('ItemRemoved', { order_item_id: 'K2', units: 1 }) },
    { action: 'comp_requested', event: ev('AlertRaised', raised('comp', true)) },
    { action: 'line_comped', event: ev('LineComped', { order_item_id: 'K1', units: 1, value_minor: 50000, reason_code: 'guest', note: 'regular', requester_staff_id: 'st-hamza', alert_id: 'C1', approver_staff_id: 'st-imran' }) },
    { action: 'item_returned', event: ev('ItemReturned', { order_item_id: 'K1', mode: 'remake', replacement_order_item_id: 'K9' }) },
    { action: 'item_returned', event: ev('OrderLinesAdded', { order_id: 'O7', order_item_ids: ['K8'], groups: [], lines: [{ order_item_id: 'K8', station_id: 'S1', alternates: [], point_id: null, carry_ms: 0, from_stock: false, weight_pct: 100, max_early_ms: 0, max_late_ms: null, max_carry_ms: null, return_of: { order_item_id: 'K1', mode: 'fix' }, cook_ms_override: null }] }) },
    { action: 'line_weight_set', event: ev('LineWeightSet', { order_item_id: 'F1', quantity: 750, line_total_minor: 337500 }) },
    { action: 'order_boosted', event: ev('OrderBoosted', { order_id: 'O7' }) },
    { action: 'order_cancelled', event: ev('OrderCancelled', { order_id: 'O7' }) },
    { action: 'day_opened', event: ev('BusinessDayOpened', { business_date: '2026-11-12', stock_units: {}, draws: {} }, { stream_type: 'hub', stream_id: 'br-1' }) },
    { action: 'day_closed', event: ev('BusinessDayClosed', {}, { stream_type: 'hub', stream_id: 'br-1' }) },
    { action: 'table_lock_force_released', event: ev('TableLockReleased', { table_id: 'tbl-4', seating_id: 'se-1', staff_id: 'st-ali', reason: 'force', by_staff_id: ENV_ACTOR }, { stream_type: 'table', stream_id: 'tbl-4' }) },
    { action: 'table_holder_changed', event: ev('TableHolderChanged', { table_id: 'tbl-4', seating_id: 'se-1', from_staff_id: 'st-ali', to_staff_id: 'st-hamza', reason: 'handover', by_staff_id: ENV_ACTOR }, { stream_type: 'table', stream_id: 'tbl-4' }) },
    { action: 'pin_locked_out', event: ev('StaffPinLockedOut', { staff_id: 'st-ali', locked_until: 9_000, failed_count: 5 }, { stream_type: 'staff', stream_id: 'st-ali', actor_id: null }) },
    { action: 'device_pin_locked_out', event: ev('DevicePinLockedOut', { subject_type: 'device', subject_id: 'dev-3', locked_until: 9_000, failed_count: 10 }, { stream_type: 'hub', stream_id: 'br-1', actor_id: null }) },
    { action: 'pin_lockout_cleared', event: ev('PinLockoutCleared', { subject_type: 'staff', subject_id: 'st-ali' }, { stream_type: 'staff', stream_id: 'st-ali' }) },
    { action: 'device_paired', event: ev('DevicePaired', { device_id: 'dev-4', device_name: 'Tab 4', device_type: 'tablet', station_id: null, owner_staff_id: null, pairing_token_id: 'pt-1', pairing_request_id: null }, { stream_type: 'hub', stream_id: 'br-1' }) },
    { action: 'device_revoked', event: ev('DeviceRevoked', { device_id: 'dev-4', reason: 'lost', cause: 'manual' }, { stream_type: 'hub', stream_id: 'br-1' }) },
    { action: 'pairing_token_generated', event: ev('DevicePairingTokenGenerated', { pairing_token_id: 'pt-1', device_type: 'tablet', owner_staff_id: null, expires_at: 9_000 }, { stream_type: 'hub', stream_id: 'br-1' }) },
    { action: 'station_paused', event: ev('StationPauseSet', { station_id: 'grill', paused: true }, { stream_type: 'station', stream_id: 'grill' }) },
    { action: 'station_capacity_set', event: ev('StationCapacitySet', { station_id: 'grill', capacity_override: 3, previous: null, reason: 'manager' }, { stream_type: 'station', stream_id: 'grill' }) },
    { action: 'item_availability_set', event: ev('ItemMadeAvailable', { item_id: 'karahi' }, { stream_type: 'stock', stream_id: 'karahi' }) },
    { action: 'item_availability_set', event: ev('ItemMadeUnavailable', { item_id: 'karahi' }, { stream_type: 'stock', stream_id: 'karahi' }) },
    { action: 'request_closed', event: ev('AlertClosed', { alert_id: 'A9', reason: 'obsolete', by_staff_id: 'st-imran', note: null }) },
    { action: 'stock_set', event: ev('StockSet', { stock_item_id: 'naan', on_hand: 40, unit: 'piece' }, { stream_type: 'stock', stream_id: 'naan' }) },
    { action: 'stock_added', event: ev('StockAdded', { stock_item_id: 'naan', quantity: 10, unit: 'piece' }, { stream_type: 'stock', stream_id: 'naan' }) },
    { action: 'zone_stock_set', event: ev('ZoneStockSet', { zone_id: 'z-1', item_id: 'pepsi', on_hand: 24, previous: 20 }, { stream_type: 'table', stream_id: 'z-1' }) },
    { action: 'zone_stock_added', event: ev('ZoneStockAdded', { zone_id: 'z-1', item_id: 'pepsi', quantity: 6, transfers: [] }, { stream_type: 'table', stream_id: 'z-1' }) },
    { action: 'stock_transferred_out', event: ev('StockTransferredOut', { stock_item_id: 'pepsi', quantity: 6, zone_id: 'z-1' }, { stream_type: 'stock', stream_id: 'pepsi' }) },
  ];
}
