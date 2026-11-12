import { afterEach, describe, expect, it } from 'vitest';
import * as domain from './index';
import {
  AUDIT_ACTIONS,
  auditEventTypes,
  registerAuditAction,
  resetAuditActions,
  toAuditEntry,
  type AuditEvent,
  type AuditLookups,
  type AuditRequestRef,
} from './audit';

// 04 §3.6, §10 tests 50, 53, 56: the pure map with events-only lookups.

const ENV_ACTOR = 'st-env';
let seq = 0;

function ev(event_type: string, payload: Record<string, unknown>, over: Partial<AuditEvent> = {}): AuditEvent {
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

const VOID_REQ: AuditRequestRef = {
  kind: 'void_approval',
  requester_staff_id: 'st-hamza',
  order_id: 'O7',
  table_code: 'T12',
  answerer_staff_id: 'st-imran',
};

function lookups(requests: Record<string, AuditRequestRef> = {}, tables: Record<string, string> = {}): AuditLookups {
  return {
    requestOf: (id) => requests[id] ?? null,
    tableOf: (id) => tables[id] ?? null,
  };
}

const L = lookups(
  {
    A9: VOID_REQ,
    C1: { kind: 'comp', requester_staff_id: 'st-hamza', order_id: 'O7', table_code: 'T12', answerer_staff_id: null },
    R1: { kind: 'table_takeover', requester_staff_id: 'st-ali', order_id: null, table_code: null, answerer_staff_id: null },
  },
  { O7: 'tbl-12' },
);

function raised(kind: string, request: boolean, over: Record<string, unknown> = {}): Record<string, unknown> {
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
function fixtures(): Array<{ action: string; event: AuditEvent }> {
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
    { action: 'item_returned', event: ev('OrderLinesAdded', { order_id: 'O7', order_item_ids: ['K8'], groups: [], lines: [{ order_item_id: 'K8', return_of: { order_item_id: 'K1', mode: 'fix' } }] }) },
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

afterEach(() => resetAuditActions());

describe('AUDIT_ACTIONS', () => {
  it('[04 §3.6] holds exactly the action table', () => {
    expect([...AUDIT_ACTIONS].sort()).toStrictEqual(
      [
        'void_requested', 'void_answered', 'comp_answered', 'request_answered', 'request_withdrawn', 'request_pin_failed',
        'item_voided', 'item_moved_to_stock', 'item_removed', 'comp_requested', 'line_comped', 'item_returned',
        'line_weight_set', 'order_boosted', 'order_cancelled', 'day_opened', 'day_closed', 'table_lock_force_released',
        'table_holder_changed', 'pin_locked_out', 'device_pin_locked_out', 'pin_lockout_cleared', 'device_paired',
        'device_revoked', 'pairing_token_generated', 'station_paused', 'station_capacity_set', 'item_availability_set',
        'request_closed', 'stock_set', 'stock_added', 'zone_stock_set', 'zone_stock_added', 'stock_transferred_out',
      ].sort(),
    );
  });

  it('[04 §4.2] is exported from the domain index with toAuditEntry and registerAuditAction', () => {
    expect(domain.AUDIT_ACTIONS).toBe(AUDIT_ACTIONS);
    expect(domain.toAuditEntry).toBe(toAuditEntry);
    expect(domain.registerAuditAction).toBe(registerAuditAction);
  });
});

describe('toAuditEntry', () => {
  it('[04 #50] every AUDIT_ACTIONS row maps from its event fixture', () => {
    const all = fixtures();
    for (const { action, event } of all) {
      const entry = toAuditEntry(event, L);
      expect(entry?.action, event.event_type).toBe(action);
      expect(entry?.seq).toBe(event.seq);
      expect(entry?.event_id).toBe(event.event_id);
      expect(entry?.recorded_at).toBe(event.recorded_at);
      expect(entry?.device_id).toBe(event.device_id);
      // §3.6: the envelope actor is always kept.
      expect(entry?.detail.envelope_actor_id, action).toBe(event.actor_id);
    }
    expect(new Set(all.map((f) => f.action))).toStrictEqual(new Set(AUDIT_ACTIONS));
  });

  it('[04 #50] every mapped event type is in auditEventTypes(); the fixtures cover them all', () => {
    expect(new Set(fixtures().map((f) => f.event.event_type))).toStrictEqual(new Set(auditEventTypes()));
  });

  it('[04 #50] unmapped events → null (sessions, presence, engine, ItemServed, config applies)', () => {
    for (const t of ['SessionStarted', 'PresenceSet', 'ItemStarted', 'ItemDone', 'ItemServed', 'FireDispatched', 'BranchConfigApplied', 'StaffDirectoryApplied', 'ClockAlarm', 'AlertSeen', 'AlertDelivered', 'OrderPlaced', 'TicketReprinted', 'StockReleased', 'StockReserved']) {
      expect(toAuditEntry(ev(t, {}), L), t).toBeNull();
    }
  });

  it('[04 #50] filtered event shapes → null: a non-request alert, a non-force lock release, a moved StockAdded, a close of a non-request alert, an OrderLinesAdded without a fix line', () => {
    expect(toAuditEntry(ev('AlertRaised', raised('void_approval', false)), L)).toBeNull();
    expect(toAuditEntry(ev('AlertRaised', raised('table_takeover', true, { alert_id: 'R1' })), L)).toBeNull();
    expect(toAuditEntry(ev('TableLockReleased', { table_id: 't', seating_id: 's', staff_id: 'a', reason: 'released' }), L)).toBeNull();
    expect(toAuditEntry(ev('StockAdded', { stock_item_id: 'naan', quantity: 2, unit: 'piece', reason: 'moved', alert_id: 'A9' }), L)).toBeNull();
    expect(toAuditEntry(ev('AlertClosed', { alert_id: 'not-a-request', reason: 'done', by_staff_id: null, note: null }), L)).toBeNull();
    const remake = { order_id: 'O7', order_item_ids: ['K9'], groups: [], lines: [{ order_item_id: 'K9', return_of: { order_item_id: 'K1', mode: 'remake' } }, { order_item_id: 'K10', return_of: null }] };
    expect(toAuditEntry(ev('OrderLinesAdded', remake), L)).toBeNull();
  });

  it('[04 #56] OrderContactSet is never mapped', () => {
    expect(toAuditEntry(ev('OrderContactSet', { order_id: 'O7', customer_name: 'X', phone: '0300' }), L)).toBeNull();
    expect(auditEventTypes()).not.toContain('OrderContactSet');
    expect(() => registerAuditAction('OrderContactSet', () => null)).toThrow(/OrderContactSet/);
  });

  it('[04 #50] void_requested: requester as actor, item × units, amount, reason, disposition; table code from display', () => {
    const e = toAuditEntry(ev('AlertRaised', raised('void_approval', true), { actor_id: 'st-hamza' }), L)!;
    expect(e).toMatchObject({
      action: 'void_requested',
      actor_staff_id: 'st-hamza',
      approver_staff_id: null,
      method: null,
      subject_type: 'order',
      subject_id: 'O7',
      order_id: 'O7',
      table_code: 'T12',
      table_id: 'tbl-12',
      reason: 'quality',
      outcome: 'moved',
      amount_minor: 240000,
    });
    expect(e.detail).toMatchObject({ alert_id: 'A9', order_item_id: 'K1', item: 'Mutton Karahi', units: 1 });
  });

  it('[04 #50] *_answered: actor = requester, approver = answerer, method; on_requester_device kept', () => {
    const e = toAuditEntry(ev('RequestAnswered', { alert_id: 'A9', decision: 'approve', answerer_staff_id: 'st-imran', method: 'in_person', device_id: 'dev-1', on_requester_device: true }, { actor_id: 'st-hamza' }), L)!;
    expect(e).toMatchObject({ action: 'void_answered', actor_staff_id: 'st-hamza', approver_staff_id: 'st-imran', method: 'in_person', outcome: 'approved', order_id: 'O7', table_code: 'T12', table_id: 'tbl-12' });
    expect(e.detail).toMatchObject({ alert_id: 'A9', on_requester_device: true, envelope_actor_id: 'st-hamza' });
    const rej = toAuditEntry(ev('RequestAnswered', { alert_id: 'C1', decision: 'reject', answerer_staff_id: 'st-imran', method: 'pin', device_id: 'dev-2', on_requester_device: false }), L)!;
    expect(rej).toMatchObject({ action: 'comp_answered', outcome: 'rejected', actor_staff_id: 'st-hamza', approver_staff_id: 'st-imran' });
  });

  it('[04 #50] request_withdrawn: actor = requester', () => {
    const e = toAuditEntry(ev('RequestWithdrawn', { alert_id: 'A9', by_staff_id: 'st-hamza' }), L)!;
    expect(e).toMatchObject({ actor_staff_id: 'st-hamza', approver_staff_id: null, outcome: 'withdrawn', order_id: 'O7' });
  });

  it('[04 #50] request_pin_failed: actor = the named answerer, device, outcome; subject from the payload', () => {
    const e = toAuditEntry(fixtures().find((f) => f.action === 'request_pin_failed')!.event, L)!;
    expect(e).toMatchObject({ actor_staff_id: 'st-imran', approver_staff_id: null, method: 'pin', outcome: 'pin_invalid', subject_type: 'order', subject_id: 'O7', order_id: 'O7', table_id: 'tbl-12' });
  });

  it('[04 #50] request_closed (H7-3): actor = requester, approver = closer, outcome = close reason, kind kept', () => {
    const e = toAuditEntry(ev('AlertClosed', { alert_id: 'A9', reason: 'obsolete', by_staff_id: 'st-imran', note: null }), L)!;
    expect(e).toMatchObject({ action: 'request_closed', actor_staff_id: 'st-hamza', approver_staff_id: 'st-imran', outcome: 'obsolete', order_id: 'O7' });
    expect(e.detail).toMatchObject({ alert_id: 'A9', kind: 'void_approval', envelope_actor_id: ENV_ACTOR });
    const tick = toAuditEntry(ev('AlertClosed', { alert_id: 'C1', reason: 'expired', by_staff_id: null, note: null }, { actor_id: null }), L)!;
    expect(tick).toMatchObject({ actor_staff_id: 'st-hamza', approver_staff_id: null, outcome: 'expired' });
  });

  it('[04 #50] an approved item_voided: actor = payload requester, approver = payload approver, money, reason, disposition', () => {
    const e = toAuditEntry(ev('ItemVoided', { order_item_id: 'K1', units: 1, refund_minor: 240000, comp_voided_minor: 500, alert_id: 'A9', approver_staff_id: 'st-imran', note: 'cold', disposition_note: null, requester_staff_id: 'st-hamza', reason_code: 'quality', disposition: 'moved' }, { actor_id: 'st-imran' }), L)!;
    expect(e).toMatchObject({ action: 'item_voided', actor_staff_id: 'st-hamza', approver_staff_id: 'st-imran', reason: 'quality: cold', outcome: 'moved', amount_minor: 240000, order_id: 'O7', table_id: 'tbl-12', table_code: 'T12' });
    expect(e.detail).toMatchObject({ order_item_id: 'K1', units: 1, comp_voided_minor: 500, alert_id: 'A9', envelope_actor_id: 'st-imran' });
  });

  it('[04 #50] a direct item_voided: actor = requester (= envelope), approver null', () => {
    const e = toAuditEntry(ev('ItemVoided', { order_item_id: 'K1', units: 1, refund_minor: 100, comp_voided_minor: 0, alert_id: null, approver_staff_id: null, note: null, disposition_note: null, requester_staff_id: ENV_ACTOR, reason_code: 'too_late', disposition: 'wastage' }), L)!;
    expect(e).toMatchObject({ actor_staff_id: ENV_ACTOR, approver_staff_id: null, table_code: null, outcome: 'wastage' });
  });

  it('[04 #50] an ItemVoided without requester_staff_id (old event, H4-5) → actor = envelope actor', () => {
    const e = toAuditEntry(ev('ItemVoided', { order_item_id: 'K1', units: 2 }), L)!;
    expect(e).toMatchObject({ actor_staff_id: ENV_ACTOR, approver_staff_id: null, reason: null, outcome: null, amount_minor: null });
  });

  it('[04 #50] an approved item_moved_to_stock (H4-2): actor = requester, approver = answerer from audit_requests', () => {
    const e = toAuditEntry(ev('ItemMovedToStock', { order_item_id: 'K1', units: 1, alert_id: 'A9' }, { actor_id: 'st-imran' }), L)!;
    expect(e).toMatchObject({ action: 'item_moved_to_stock', actor_staff_id: 'st-hamza', approver_staff_id: 'st-imran' });
    expect(e.detail).toMatchObject({ order_item_id: 'K1', units: 1, alert_id: 'A9', envelope_actor_id: 'st-imran' });
  });

  it('[04 #50] item_moved_to_stock without alert_id → envelope actor, approver null', () => {
    const e = toAuditEntry(ev('ItemMovedToStock', { order_item_id: 'K1', units: 1 }), L)!;
    expect(e).toMatchObject({ actor_staff_id: ENV_ACTOR, approver_staff_id: null });
  });

  it('[04 #50] line_comped: actor = requester, approver, value, reason', () => {
    const e = toAuditEntry(ev('LineComped', { order_item_id: 'K1', units: 1, value_minor: 50000, reason_code: 'guest', note: 'regular', requester_staff_id: 'st-hamza', alert_id: 'C1', approver_staff_id: 'st-imran' }, { actor_id: 'st-imran' }), L)!;
    expect(e).toMatchObject({ actor_staff_id: 'st-hamza', approver_staff_id: 'st-imran', amount_minor: 50000, reason: 'guest: regular' });
  });

  it('[04 #50] reason is sliced to 200', () => {
    const e = toAuditEntry(ev('ItemVoided', { order_item_id: 'K1', units: 1, requester_staff_id: 'a', reason_code: 'other', note: 'x'.repeat(250) }), L)!;
    expect(e.reason).toHaveLength(200);
  });

  it('[04 #50] every other action: actor = envelope actor, approver null', () => {
    const special = new Set(['void_requested', 'comp_requested', 'void_answered', 'comp_answered', 'request_answered', 'request_withdrawn', 'request_pin_failed', 'item_voided', 'line_comped', 'item_moved_to_stock', 'request_closed']);
    for (const { action, event } of fixtures()) {
      if (special.has(action)) continue;
      const e = toAuditEntry(event, L)!;
      expect(e.actor_staff_id, action).toBe(event.actor_id);
      expect(e.approver_staff_id, action).toBeNull();
      expect(e.method, action).toBeNull();
    }
  });

  it('[04 §3.6] order rows get table_id from tableOf (placed-at table); others get null', () => {
    expect(toAuditEntry(ev('OrderBoosted', { order_id: 'O7' }), L)).toMatchObject({ subject_type: 'order', subject_id: 'O7', order_id: 'O7', table_id: 'tbl-12' });
    expect(toAuditEntry(ev('OrderBoosted', { order_id: 'O8' }, { stream_id: 'O8' }), L)).toMatchObject({ order_id: 'O8', table_id: null });
    expect(toAuditEntry(ev('StockSet', { stock_item_id: 'naan', on_hand: 1, unit: 'piece' }, { stream_type: 'stock', stream_id: 'naan' }), L)).toMatchObject({ subject_type: 'stock', subject_id: 'naan', order_id: null, table_id: null });
  });

  it('[04 §3.6] is pure: the same event and lookups give the same entry', () => {
    const e = ev('ItemVoided', { order_item_id: 'K1', units: 1, alert_id: 'A9', requester_staff_id: 'st-hamza' });
    expect(toAuditEntry(e, L)).toStrictEqual(toAuditEntry(e, L));
  });
});

describe('registerAuditAction', () => {
  it('[04 #53] adds a mapped action', () => {
    registerAuditAction('TicketReprinted', (event) => ({ action: 'ticket_reprinted', subject_type: 'order', subject_id: event.stream_id, detail: { ticket_id: event.payload['ticket_id'] } }));
    expect(auditEventTypes()).toContain('TicketReprinted');
    const e = toAuditEntry(ev('TicketReprinted', { ticket_id: 'tk-1' }), L)!;
    expect(e).toMatchObject({ action: 'ticket_reprinted', actor_staff_id: ENV_ACTOR, approver_staff_id: null, order_id: 'O7', table_id: 'tbl-12' });
    expect(e.detail).toStrictEqual({ ticket_id: 'tk-1', envelope_actor_id: ENV_ACTOR });
  });

  it('[04 #53] a duplicate event type → startup error (registered twice, or already mapped by 04)', () => {
    registerAuditAction('TicketReprinted', () => null);
    expect(() => registerAuditAction('TicketReprinted', () => null)).toThrow(/TicketReprinted/);
    expect(() => registerAuditAction('ItemVoided', () => null)).toThrow(/ItemVoided/);
  });

  it('[04 #53] a registered map cannot drop the envelope actor', () => {
    registerAuditAction('TicketReprinted', () => ({ action: 'ticket_reprinted', subject_type: 'order', subject_id: 'O7', detail: { envelope_actor_id: 'forged' } }));
    expect(toAuditEntry(ev('TicketReprinted', {}), L)!.detail.envelope_actor_id).toBe(ENV_ACTOR);
  });
});
