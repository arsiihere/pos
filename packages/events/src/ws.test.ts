import { describe, expect, it } from 'vitest';
import { WsAlertsOpen, WsClientMessage, WsServerMessage } from './ws';

const lockOnlyRow = {
  alert_id: '01JD…',
  kind: 'test_alert',
  family: 'info',
  step: 0,
  lock: { kind_label_key: 'alert.test_alert.lock', table_code: null, point_code: null, requester_name: 'Imran' },
  raised_at: 1761900000000,
};

// §6 batch 3 example JSON; its `"card": { … }` placeholder is filled with a valid card (§3.12).
const alertLockOnly = {
  alert_id: '01JD…',
  kind: 'void_approval',
  family: 'urgent',
  step: 1,
  escalation: false,
  set: 'answerer',
  for_staff_id: null,
  lock: { kind_label_key: 'alert.void_approval.lock', table_code: '12', point_code: null, requester_name: 'Hamza' },
  raised_at: 1761900000000,
};
const card = {
  kind_label_key: 'alert.void_approval.card',
  table_code: '12',
  point_code: null,
  requester_name: 'Hamza',
  details: { item: 'Mutton platter', quantity: 1, amount: 480000, reason: 'customer changed mind' },
};
const alertFrame = { type: 'alert', alert: { ...alertLockOnly, card } };

describe('ws', () => {
  it('[00 §6.21, M12] WsClientMessage accepts auth and ack only', () => {
    expect(WsClientMessage.safeParse({ type: 'auth', device_token: 'd', session_token: 's' }).success).toBe(true);
    expect(WsClientMessage.safeParse({ type: 'ack', last_seq: 1 }).success).toBe(true);
    expect(WsClientMessage.safeParse({ type: 'catch_up', as_of_seq: 1, state: {} }).success).toBe(false);
    expect(WsClientMessage.safeParse({ type: 'error', error: { code: 'X', message: 'm' } }).success).toBe(false);
  });

  it('[00 H-2] auth without session_token parses (alert mode)', () => {
    const parsed = WsClientMessage.safeParse({ type: 'auth', device_token: 'd' });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toStrictEqual({ type: 'auth', device_token: 'd' });
  });

  it('[00 H-2] receipt parses with the §6 batch 3 example and refuses seen or a bad step', () => {
    expect(WsClientMessage.safeParse({ type: 'receipt', alert_id: '01JD…', kind: 'delivered', step: 1 }).success).toBe(
      true,
    );
    expect(WsClientMessage.safeParse({ type: 'receipt', alert_id: '01JD…', kind: 'delivered', step: 0 }).success).toBe(
      true,
    );
    expect(WsClientMessage.safeParse({ type: 'receipt', alert_id: '01JD…', kind: 'seen', step: 1 }).success).toBe(false);
    for (const step of [-1, 1.5, '1', null]) {
      expect(WsClientMessage.safeParse({ type: 'receipt', alert_id: '01JD…', kind: 'delivered', step }).success).toBe(
        false,
      );
    }
    expect(WsClientMessage.safeParse({ type: 'receipt', alert_id: '', kind: 'delivered', step: 1 }).success).toBe(false);
  });

  it('[01d §6] the four alert frames parse with the spec example JSON', () => {
    expect(
      WsServerMessage.safeParse({ type: 'alerts_open', alerts: [lockOnlyRow], binding_route_until: null }).success,
    ).toBe(true);
    expect(WsServerMessage.safeParse(alertFrame).success).toBe(true);
    expect(WsServerMessage.safeParse({ type: 'alert_seen', alert_id: '01JD…' }).success).toBe(true);
    expect(
      WsServerMessage.safeParse({
        type: 'alert_closed',
        alert_id: '01JD…',
        reason: 'answered',
        decision: 'approve',
        by_name: 'Imran',
      }).success,
    ).toBe(true);
  });

  it('[01d §6] an alert frame without card (lock only) parses; alert_closed outside a request has null decision', () => {
    expect(WsServerMessage.safeParse({ type: 'alert', alert: alertLockOnly }).success).toBe(true);
    expect(
      WsServerMessage.safeParse({ type: 'alert_closed', alert_id: '01JD…', reason: 'expired', decision: null, by_name: null })
        .success,
    ).toBe(true);
    expect(
      WsServerMessage.safeParse({ type: 'alert_closed', alert_id: '01JD…', reason: 'gone', decision: null, by_name: null })
        .success,
    ).toBe(false);
  });

  it('[01d §6] alerts_open rows refuse a card key', () => {
    const withCard = { ...lockOnlyRow, card };
    expect(WsServerMessage.safeParse({ type: 'alerts_open', alerts: [withCard], binding_route_until: null }).success).toBe(
      false,
    );
    expect(WsAlertsOpen.safeParse({ type: 'alerts_open', alerts: [withCard], binding_route_until: null }).success).toBe(
      false,
    );
    const withDetails = { ...lockOnlyRow, details: { amount: 480000 } };
    expect(WsAlertsOpen.safeParse({ type: 'alerts_open', alerts: [withDetails], binding_route_until: null }).success).toBe(
      false,
    );
  });

  it('[01d AD-23, AD-165] alerts_open rows refuse answers, needs_pin, silent and raised_device_id (signed-in only)', () => {
    // AD-165: raised_device_id is signed-in only, like the AD-23 fields
    for (const extra of [
      { answers: ['approve', 'reject'] },
      { needs_pin: 'always' },
      { silent: true },
      { answers: null },
      { raised_device_id: 'dev-hamza' },
    ]) {
      expect(WsAlertsOpen.safeParse({ type: 'alerts_open', alerts: [{ ...lockOnlyRow, ...extra }], binding_route_until: null }).success).toBe(
        false,
      );
    }
  });

  it('[01d AD-82, §8.3] alerts_open rows take outcome (lock-safe) and seen_by_me', () => {
    const row = { ...lockOnlyRow, kind: 'request_result', outcome: 'approved', seen_by_me: true };
    expect(WsAlertsOpen.parse({ type: 'alerts_open', alerts: [row], binding_route_until: null }).alerts[0]).toMatchObject({
      outcome: 'approved',
      seen_by_me: true,
    });
    expect(WsAlertsOpen.safeParse({ type: 'alerts_open', alerts: [{ ...row, outcome: 'answered' }], binding_route_until: null }).success).toBe(false);
    expect(WsAlertsOpen.safeParse({ type: 'alerts_open', alerts: [{ ...row, seen_by_me: 'no' }], binding_route_until: null }).success).toBe(false);
  });

  it('[01d BF-5] binding_route { until: null } and alerts_open.binding_route_until parse', () => {
    expect(WsServerMessage.safeParse({ type: 'binding_route', until: null }).success).toBe(true);
    expect(WsServerMessage.safeParse({ type: 'binding_route', until: 1761907200000 }).success).toBe(true);
    expect(WsServerMessage.safeParse({ type: 'binding_route', until: 1.5 }).success).toBe(false);
    expect(WsServerMessage.safeParse({ type: 'binding_route' }).success).toBe(false);
    expect(
      WsServerMessage.safeParse({ type: 'alerts_open', alerts: [lockOnlyRow], binding_route_until: 1761907200000 })
        .success,
    ).toBe(true);
    expect(WsServerMessage.safeParse({ type: 'alerts_open', alerts: [] }).success).toBe(false);
  });

  it('[03a §3.6.3] the station_plan frame is in WsServerMessage', () => {
    const line = { order_item_id: 'L1', order_id: 'O1', fire_ms: 1761900000000, deadline_ms: 1761900060000, mark: null, frozen: true };
    const frame = { type: 'station_plan', station_id: 'S1', as_of_seq: 42, lines: [line] };
    expect(WsServerMessage.parse(frame)).toEqual(frame);
    expect(WsServerMessage.safeParse({ ...frame, lines: [] }).success).toBe(true);
    // fire_ms as in the §3.3 Line (`number | null`); deadline_ms is always set.
    expect(WsServerMessage.safeParse({ ...frame, lines: [{ ...line, fire_ms: null }] }).success).toBe(true);
    expect(WsServerMessage.safeParse({ ...frame, lines: [{ ...line, deadline_ms: null }] }).success).toBe(false);
    for (const mark of ['expedite', 'boost', 'pulled', 'return', 'moved']) {
      expect(WsServerMessage.safeParse({ ...frame, lines: [{ ...line, mark, frozen: false }] }).success, mark).toBe(true);
    }
    expect(WsServerMessage.safeParse({ ...frame, lines: [{ ...line, mark: 'rush' }] }).success).toBe(false);
    for (const key of Object.keys(line)) {
      const rest: Record<string, unknown> = { ...line };
      delete rest[key];
      expect(WsServerMessage.safeParse({ ...frame, lines: [rest] }).success, key).toBe(false);
    }
    for (const key of ['station_id', 'as_of_seq', 'lines']) {
      const rest: Record<string, unknown> = { ...frame };
      delete rest[key];
      expect(WsServerMessage.safeParse(rest).success, key).toBe(false);
    }
  });
});
