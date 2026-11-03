import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseEvent } from '../../codecs';
import '../../index';
import { payloadSchema } from '../../registry';

// 03a §4.2 stock-stream rows (stock / stock_item_id).
const STOCK_EVENTS = ['StockReserved', 'StockReleased', 'StockConsumed'];

const examples: Record<string, Record<string, unknown>> = {
  StockReserved: { stock_item_id: 'K1', order_item_id: 'L1', quantity: 500 },
  StockReleased: { stock_item_id: 'K1', order_item_id: 'L1', quantity: 500, reason: 'removed' },
  StockConsumed: { stock_item_id: 'K1', order_item_id: 'L1', quantity: 500 },
};

function without(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

describe('03a stock-stream events', () => {
  it('[03a §4.2] the 3 stock events are registered at schema_version 1 and each parses its example', () => {
    for (const type of STOCK_EVENTS) {
      expect(payloadSchema(type, 1).parse(examples[type]), type).toEqual(examples[type]);
    }
  });

  it('[03a §4.2] each schema refuses its payload with any one field missing, and a quantity of 0 or 1.5', () => {
    for (const type of STOCK_EVENTS) {
      for (const key of Object.keys(examples[type]!)) {
        expect(payloadSchema(type, 1).safeParse(without(examples[type]!, key)).success, `${type}.${key}`).toBe(false);
      }
      for (const quantity of [0, 1.5]) {
        expect(payloadSchema(type, 1).safeParse({ ...examples[type], quantity }).success, `${type} ${quantity}`).toBe(false);
      }
    }
  });

  it('[03a §4.2] StockReleased.reason is removed, voided, moved, recount, day_closed or abandoned; unit_changed and moved_to_stock are refused', () => {
    const schema = payloadSchema('StockReleased', 1);
    for (const reason of ['removed', 'voided', 'moved', 'recount', 'day_closed', 'abandoned']) {
      expect(schema.safeParse({ ...examples.StockReleased, reason }).success, reason).toBe(true);
    }
    for (const reason of ['unit_changed', 'moved_to_stock']) {
      expect(schema.safeParse({ ...examples.StockReleased, reason }).success, reason).toBe(false);
    }
  });
});

describe('StockAdded v2 (03a §4.5 A-19)', () => {
  const v2 = () => payloadSchema('StockAdded', 2);
  const base = { stock_item_id: 'K1', quantity: 500, unit: 'g' };

  it("[03a §4.2 A-19] StockAdded v2 parses with and without reason 'moved'; any other reason is refused", () => {
    expect(v2().parse(base)).toEqual(base);
    expect(v2().parse({ ...base, reason: 'moved' })).toEqual({ ...base, reason: 'moved' });
    expect(v2().safeParse({ ...base, reason: 'manual' }).success).toBe(false);
    expect(v2().safeParse({ ...base, reason: null }).success).toBe(false);
  });

  it('[03a §4.2 A-19] the stored StockAdded v1 and v2 fixtures still parse to the latest, without a reason', () => {
    const dir = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
    const latest = JSON.parse(readFileSync(`${dir}StockAdded.latest.json`, 'utf8')) as unknown;
    for (const name of ['StockAdded.v1.json', 'StockAdded.v2.json']) {
      const parsed = parseEvent(JSON.parse(readFileSync(`${dir}${name}`, 'utf8')));
      expect(parsed, name).toEqual(latest);
      expect(parsed.payload, name).not.toHaveProperty('reason');
    }
  });
});
