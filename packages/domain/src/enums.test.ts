import { describe, expect, it } from 'vitest';
import { TABLE_STATES, type TableState } from './enums';

describe('[02a §3.1] TableState', () => {
  it('[02a §3.1] TableState = FREE | SEATED | ORDERED | FOOD_ON_TABLE | BILL_REQUESTED | NEEDS_CLEANING', () => {
    expect([...TABLE_STATES]).toEqual([
      'FREE',
      'SEATED',
      'ORDERED',
      'FOOD_ON_TABLE',
      'BILL_REQUESTED',
      'NEEDS_CLEANING',
    ]);
    const s: TableState = 'FREE';
    expect(TABLE_STATES).toContain(s);
    expect(TABLE_STATES).not.toContain('CLOSED');
  });
});
