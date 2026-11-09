import { describe, expect, it } from 'vitest';
import { parseEvent } from '../../codecs';
import '../../index';
import { payloadSchema } from '../../registry';

// 02a §6.19: one example per table-stream event.
const examples: Record<string, { payload: Record<string, unknown> }> = {
  TableOpened: {
    payload: { table_id: 'T1', seating_id: 'S1', holder_staff_id: 'W1', party_size: 4 },
  },
  TableLocked: {
    payload: { table_id: 'T1', seating_id: 'S1', staff_id: 'W1', replaced_device_id: 'D1' },
  },
  TableLockTouched: { payload: { table_id: 'T1', seating_id: 'S1' } },
  TableLockReleased: {
    payload: {
      table_id: 'T1',
      seating_id: 'S1',
      staff_id: 'W1',
      reason: 'force',
      by_staff_id: 'M1',
      note: 'left',
      alert_id: 'A1',
    },
  },
  TableHolderChanged: {
    payload: {
      table_id: 'T1',
      seating_id: 'S1',
      from_staff_id: 'W1',
      to_staff_id: 'W2',
      reason: 'handover',
      by_staff_id: 'W1',
      alert_id: 'A1',
      note: 'break',
    },
  },
  TableMoved: {
    payload: { seating_id: 'S1', from_table_id: 'T1', to_table_id: 'T2', by_staff_id: 'W1', note: 'window' },
  },
  TablesMerged: {
    payload: {
      into_seating_id: 'S1',
      into_table_id: 'T1',
      table_ids: ['T1', 'T2'],
      absorbed_seating_id: null,
      order_ids: ['O1'],
      by_staff_id: 'W1',
    },
  },
  SeatingSplit: {
    payload: { from_seating_id: 'S1', new_seating_id: null, to_table_id: 'T2', order_ids: ['O1'], by_staff_id: 'W1' },
  },
  BillRequested: { payload: { seating_id: 'S1', table_id: 'T1', by_staff_id: 'W1' } },
  TableCleaned: {
    payload: { seating_id: 'S1', table_ids: ['T1', 'T2'], reason: 'cleaned', by_staff_id: 'W1' },
  },
};

const TYPES = Object.keys(examples);

describe('02a table-stream events', () => {
  it('[02a §6.19] each table event round-trips with its §6.19 payload', () => {
    expect(TYPES).toHaveLength(10);
    for (const type of TYPES) {
      expect(payloadSchema(type, 1).parse(examples[type]!.payload), type).toEqual(examples[type]!.payload);
    }
  });

  it('[02a §6.19] optional keys may be absent; party_size, absorbed_seating_id and new_seating_id are nullable, not optional', () => {
    expect(payloadSchema('TableLocked', 1).safeParse({ table_id: 'T1', seating_id: 'S1', staff_id: 'W1' }).success).toBe(true);
    expect(
      payloadSchema('TableLockReleased', 1).safeParse({ table_id: 'T1', seating_id: 'S1', staff_id: 'W1', reason: 'released' }).success,
    ).toBe(true);
    const opened = examples.TableOpened!.payload;
    expect(payloadSchema('TableOpened', 1).safeParse({ ...opened, party_size: null }).success).toBe(true);
    expect(payloadSchema('TableOpened', 1).safeParse({ ...opened, party_size: 2.5 }).success).toBe(false);
    for (const [type, key] of [
      ['TableOpened', 'party_size'],
      ['TablesMerged', 'absorbed_seating_id'],
      ['SeatingSplit', 'new_seating_id'],
    ] as const) {
      const copy = { ...examples[type]!.payload };
      delete copy[key];
      expect(payloadSchema(type, 1).safeParse(copy).success, `${type}.${key}`).toBe(false);
    }
  });

  it("[02a §6.19] stream_type 'table'; TableMoved / SeatingSplit on the from table, TablesMerged on the into table", () => {
    for (const type of TYPES) {
      const { payload } = examples[type]!;
      // The writer picks the stream (T1 here: the primary, from or into table); the schemas do not carry it.
      const stream_id = 'T1';
      const parsed = parseEvent({
        event_id: 'E1',
        tenant_id: 'TN',
        branch_id: 'B1',
        stream_type: 'table',
        stream_id,
        event_type: type,
        schema_version: 1,
        payload,
        occurred_at: 1,
        recorded_at: 1,
        actor_id: 'W1',
        device_id: 'D1',
        seq: 1,
      });
      expect(parsed.stream_type, type).toBe('table');
      expect(parsed.schema_version, type).toBe(1);
    }
    expect(examples.TableMoved!.payload.from_table_id).toBe('T1');
    expect(examples.TablesMerged!.payload.into_table_id).toBe('T1');
  });

  it('[02a T7] no payload accepts a session id key', () => {
    for (const type of TYPES) {
      for (const key of ['session_id', 'staff_session_id']) {
        expect(payloadSchema(type, 1).safeParse({ ...examples[type]!.payload, [key]: 'X1' }).success, `${type}.${key}`).toBe(false);
      }
    }
  });

  it('[02a §6.19] TableLockReleased.reason enum is exactly the five reasons; alert_id optional', () => {
    const schema = payloadSchema('TableLockReleased', 1);
    const base = { table_id: 'T1', seating_id: 'S1', staff_id: 'W1' };
    for (const reason of ['released', 'force', 'session_expired', 'lock_ttl', 'holder_changed']) {
      expect(schema.safeParse({ ...base, reason }).success, reason).toBe(true);
    }
    for (const reason of ['expired', 'take_over', '']) {
      expect(schema.safeParse({ ...base, reason }).success, reason).toBe(false);
    }
    expect(schema.safeParse({ ...base, reason: 'released', alert_id: 'A1' }).success).toBe(true);
  });

  it('[02a §6.19] TableHolderChanged.reason enum take_over | handover | force_move', () => {
    const schema = payloadSchema('TableHolderChanged', 1);
    const base = { table_id: 'T1', seating_id: 'S1', from_staff_id: 'W1', to_staff_id: 'W2', by_staff_id: 'W1' };
    for (const reason of ['take_over', 'handover', 'force_move']) {
      expect(schema.safeParse({ ...base, reason }).success, reason).toBe(true);
    }
    expect(schema.safeParse({ ...base, reason: 'force' }).success).toBe(false);
  });

  it('[02a §6.19] TableCleaned.reason is cleaned | left_without_order', () => {
    const schema = payloadSchema('TableCleaned', 1);
    const base = { seating_id: 'S1', table_ids: ['T1'], by_staff_id: 'W1' };
    expect(schema.safeParse({ ...base, reason: 'left_without_order' }).success).toBe(true);
    expect(schema.safeParse({ ...base, reason: 'other' }).success).toBe(false);
  });
});
