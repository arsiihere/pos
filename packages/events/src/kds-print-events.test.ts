import { describe, expect, it } from 'vitest';
import { parseEvent } from './codecs';
import './index';
import { latestVersion } from './registry';

// 03b §6.22 (7 events) and 03c §6.11 (3 events): schema_version 1, round-trip parse on their streams.
const envelope = (event_type: string, stream_type: string, stream_id: string, payload: Record<string, unknown>) => ({
  event_id: '01J00000000000000000000001',
  tenant_id: '01J00000000000000000000002',
  branch_id: 'B1',
  stream_type,
  stream_id,
  event_type,
  schema_version: 1,
  payload,
  occurred_at: 1_761_000_000_000,
  recorded_at: 1_761_000_000_000,
  actor_id: 'S_COOK',
  device_id: 'D1',
  seq: 1,
});

const CASES: Array<[string, string, string, Record<string, unknown>]> = [
  ['ReadyToServe', 'order', 'O1', { order_id: 'O1', point_id: 'P1', order_item_ids: ['L1', 'L2'], table_id: 'T4', alert_id: 'A1' }],
  ['ReadyToServeUndone', 'order', 'O1', { order_id: 'O1', point_id: 'P1', alert_id: null }],
  [
    'Handover',
    'order',
    'O1',
    { handover_id: 'H1', order_id: 'O1', point_id: 'P1', receiver_staff_id: 'S_WAIT', order_item_ids: ['L1'], alert_id: 'A2', ready_alert_closed: 'A1' },
  ],
  ['ReadyRetargeted', 'order', 'O1', { order_id: 'O1', point_id: 'P1', table_id: 'T5', alert_id: 'A3', previous_alert_id: 'A1' }],
  ['LanesSet', 'station', 'S1', { station_id: 'S1', lanes_on: 1, lane_count: 2 }],
  ['StationScreenSet', 'hub', 'B1', { station_id: 'S1', sound_volume: 70 }],
  ['DeviceRoleSet', 'hub', 'B1', { device_id: 'D2', point_id: 'P1', lane_label: null }],
  ['TicketReprinted', 'order', 'O1', { order_id: 'O1', station_id: null, ticket_ids: ['K1', 'K2'] }],
  [
    'PrinterSaved',
    'hub',
    'B1',
    { printer_id: 'PR1', name: 'Kitchen 1', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: false },
  ],
  ['StationOutputSet', 'hub', 'B1', { station_id: 'S1', mode: 'both', printer_id: 'PR1', show_taker: true, show_order_id: false }],
];

describe('[03b §6.22, 03c §6.11] 03b and 03c events', () => {
  it.each(CASES)('[03b §6.22 / 03c §6.11] %s round-trips at schema_version 1', (type, stream, id, payload) => {
    expect(latestVersion(type)).toBe(1);
    const stored = envelope(type, stream, id, payload);
    expect(parseEvent(stored)).toEqual(stored);
    expect(parseEvent(JSON.parse(JSON.stringify(parseEvent(stored))))).toEqual(stored);
  });

  it.each(CASES)('[03b §6.22 / 03c §6.11] %s refuses a payload missing any field', (type, stream, id, payload) => {
    for (const key of Object.keys(payload)) {
      const rest = { ...payload };
      delete rest[key];
      expect(() => parseEvent(envelope(type, stream, id, rest)), `${type}.${key}`).toThrow();
    }
  });

  it('[03b §6.22] value rules: Handover 1–40 lines; sound_volume 0–100; lanes ≥ 1; lane_label 1–20', () => {
    const bad = (type: string, stream: string, id: string, payload: Record<string, unknown>) =>
      expect(() => parseEvent(envelope(type, stream, id, payload)), JSON.stringify(payload)).toThrow();
    const handover = CASES[2]![3];
    bad('Handover', 'order', 'O1', { ...handover, order_item_ids: [] });
    bad('Handover', 'order', 'O1', { ...handover, order_item_ids: Array.from({ length: 41 }, (_, i) => `L${i}`) });
    expect(() => parseEvent(envelope('Handover', 'order', 'O1', { ...handover, ready_alert_closed: null }))).not.toThrow();
    bad('ReadyToServe', 'order', 'O1', { ...CASES[0]![3], order_item_ids: [] });
    bad('StationScreenSet', 'hub', 'B1', { station_id: 'S1', sound_volume: 101 });
    bad('StationScreenSet', 'hub', 'B1', { station_id: 'S1', sound_volume: -1 });
    bad('LanesSet', 'station', 'S1', { station_id: 'S1', lanes_on: 0, lane_count: 2 });
    bad('DeviceRoleSet', 'hub', 'B1', { device_id: 'D2', point_id: null, lane_label: '' });
    bad('DeviceRoleSet', 'hub', 'B1', { device_id: 'D2', point_id: null, lane_label: 'x'.repeat(21) });
  });

  it('[03c §3.2, §6.11] value rules: connection lan | usb; paper 58 | 80; name 1–40; mode screen | both | printer', () => {
    const printer = CASES[8]![3];
    const bad = (payload: Record<string, unknown>) => expect(() => parseEvent(envelope('PrinterSaved', 'hub', 'B1', payload))).toThrow();
    bad({ ...printer, connection: 'bluetooth' });
    bad({ ...printer, paper_width_mm: 72 });
    bad({ ...printer, name: '' });
    bad({ ...printer, name: 'x'.repeat(41) });
    expect(() => parseEvent(envelope('PrinterSaved', 'hub', 'B1', { ...printer, connection: 'usb', address: '/dev/usb/lp0', paper_width_mm: 58 }))).not.toThrow();
    expect(() => parseEvent(envelope('StationOutputSet', 'hub', 'B1', { ...CASES[9]![3], mode: 'paper' }))).toThrow();
    // 03c v1.0.6 §6.11 (Q-18): optional source, additive at v1
    const configSet = envelope('StationOutputSet', 'hub', 'B1', { ...CASES[9]![3], mode: 'screen', printer_id: null, source: 'config' });
    expect(parseEvent(configSet)).toEqual(configSet);
    expect(() => parseEvent(envelope('StationOutputSet', 'hub', 'B1', { ...CASES[9]![3], source: 'cloud' }))).toThrow();
    bad({ ...printer, archived: 'no' });
  });
});
