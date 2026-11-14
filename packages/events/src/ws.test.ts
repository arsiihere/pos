import type { LineDetail } from '@pos/domain';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { LineDetailSchema, WsAlertsOpen, WsClientMessage, WsServerMessage } from './ws';

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
    // Task 16b: every unfired line listed has a planned fire; deadline_ms is always set.
    expect(WsServerMessage.safeParse({ ...frame, lines: [{ ...line, fire_ms: null }] }).success).toBe(false);
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

  const detail = {
    order_item_id: 'L1',
    order_id: 'O1',
    station_id: 'S1',
    point_id: 'P1',
    identifier: { kind: 'table', label: 'T4 + T5' },
    order_type: 'dine_in',
    item_name: 'Mutton Karahi',
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: ['Extra spicy'],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 600_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: 'Ali',
  };

  it('[03b §4.4] LineDetailSchema infers exactly the @pos/domain LineDetail', () => {
    expectTypeOf<z.infer<typeof LineDetailSchema>>().toEqualTypeOf<LineDetail>();
  });

  it('[03b §6.16] kds_lines and point_lines frames carry LineDetail rows', () => {
    const kds = { type: 'kds_lines', station_id: 'S1', lines: [detail] };
    const point = { type: 'point_lines', point_id: 'P1', lines: [{ ...detail, group_id: 'O1:0', serve_mode: 'sync' }] };
    expect(WsServerMessage.parse(kds)).toEqual(kds);
    expect(WsServerMessage.parse(point)).toEqual(point);
    const returned = { ...detail, return_of: { order_item_id: 'L0', mode: 'remake', item_name: 'Naan', identifier: { kind: 'token', token: 12, date: '2026-11-10' } } };
    expect(WsServerMessage.safeParse({ ...kds, lines: [returned] }).success).toBe(true);
    const parking = { ...detail, order_type: 'parking', identifier: { kind: 'parking', car_number: 'LEB 1234', car_type: 'sedan' } };
    expect(WsServerMessage.safeParse({ ...kds, lines: [parking] }).success).toBe(true);
    for (const key of Object.keys(detail)) {
      const rest: Record<string, unknown> = { ...detail };
      delete rest[key];
      expect(WsServerMessage.safeParse({ ...kds, lines: [rest] }).success, key).toBe(false);
    }
    expect(WsServerMessage.safeParse({ ...kds, lines: [{ ...detail, line_kind: 'deal' }] }).success).toBe(false);
    expect(WsServerMessage.safeParse({ ...kds, lines: [{ ...detail, identifier: { kind: 'parking', car_number: 'X', car_type: 'van' } }] }).success).toBe(false);
  });

  it('[03b #67] point_lines lines carry group_id and serve_mode (Q-46); kds_lines lines do not', () => {
    const frame = (line: Record<string, unknown>) => ({ type: 'point_lines', point_id: 'P1', lines: [line] });
    const full = { ...detail, group_id: 'O1:0', serve_mode: 'immediate' };
    expect(WsServerMessage.parse(frame(full))).toEqual(frame(full));
    expect(WsServerMessage.safeParse(frame(detail)).success).toBe(false);
    expect(WsServerMessage.safeParse(frame({ ...full, serve_mode: 'later' })).success).toBe(false);
    expect(WsServerMessage.safeParse(frame({ ...detail, serve_mode: 'sync' })).success).toBe(false);
    expect(WsServerMessage.safeParse({ type: 'kds_lines', station_id: 'S1', lines: [detail] }).success).toBe(true);
  });

  it('[03b §3.6, §6.14, §6.16] station_takeover: active with the kds_station body as view, inactive without', () => {
    const view = {
      station_id: 'S1',
      day_open: true,
      sound_volume: 70,
      has_printer: true, // v1.0.6 Q-20
      lanes: { lanes_on: null, lane_count: 2 },
      now: [{ ...detail, stage: 'cooking', fired_at: 1, started_at: 2, mark: 'boost', done_undone: true }], // v1.0.5 B2-3
      details: [detail],
    };
    const start = { type: 'station_takeover', station_id: 'S1', active: true, view };
    expect(WsServerMessage.parse(start)).toEqual(start);
    expect(WsServerMessage.parse({ type: 'station_takeover', station_id: 'S1', active: false })).toEqual({ type: 'station_takeover', station_id: 'S1', active: false });
    expect(WsServerMessage.safeParse({ ...start, view: { ...view, now: [{ ...view.now[0], stage: 'baking' }] } }).success).toBe(false);
    const noFlag: Record<string, unknown> = { ...view.now[0] };
    delete noFlag.done_undone;
    expect(WsServerMessage.safeParse({ ...start, view: { ...view, now: [noFlag] } }).success, 'done_undone is required (v1.0.5 B2-3)').toBe(false);
    const noPrinter: Record<string, unknown> = { ...view };
    delete noPrinter.has_printer;
    expect(WsServerMessage.safeParse({ ...start, view: noPrinter }).success, 'has_printer is required (v1.0.6 Q-20)').toBe(false);
  });

  it('[03b §3.10] station_notice { station_id, kind: archived, open_lines }', () => {
    const notice = { type: 'station_notice', station_id: 'S1', kind: 'archived', open_lines: 3 };
    expect(WsServerMessage.parse(notice)).toEqual(notice);
    expect(WsServerMessage.safeParse({ ...notice, kind: 'paused' }).success).toBe(false);
    expect(WsServerMessage.safeParse({ ...notice, open_lines: -1 }).success).toBe(false);
  });

  it('[03b v1.0.6 §3.10, Q-20] station_notice { kind: output, has_printer }; has_printer only with output, open_lines only with archived', () => {
    const notice = { type: 'station_notice', station_id: 'S1', kind: 'output', has_printer: true };
    expect(WsServerMessage.parse(notice)).toEqual(notice);
    expect(WsServerMessage.safeParse({ type: 'station_notice', station_id: 'S1', kind: 'output', open_lines: 2 }).success).toBe(false);
    expect(WsServerMessage.safeParse({ type: 'station_notice', station_id: 'S1', kind: 'archived', has_printer: true }).success).toBe(false);
  });

  it('[03c §3.8] printed_lines { station_id, order_item_ids }', () => {
    const printed = { type: 'printed_lines', station_id: 'S1', order_item_ids: ['L1', 'L2'] };
    expect(WsServerMessage.parse(printed)).toEqual(printed);
    expect(WsServerMessage.safeParse({ type: 'printed_lines', station_id: 'S1' }).success).toBe(false);
  });
});
