import { describe, expect, expectTypeOf, it } from 'vitest';
import * as domain from './index';
import {
  VOID_DISPOSITIONS,
  VOID_REASON_CODES,
  type VoidBlock,
  type VoidDisposition,
  type VoidReasonCode,
} from './voids';

describe('void constants', () => {
  it('[04 §4.4] VOID_REASON_CODES holds the five reasons exactly', () => {
    expect(VOID_REASON_CODES).toStrictEqual([
      'customer_changed_mind',
      'wrong_order_taken',
      'too_late',
      'quality',
      'other',
    ]);
  });

  it('[04 §4.4] VOID_DISPOSITIONS holds the four dispositions exactly', () => {
    expect(VOID_DISPOSITIONS).toStrictEqual(['moved', 'wastage', 'staff_meal', 'other']);
  });

  it('[04 §4.4] the types are the literal unions of §4.4', () => {
    expectTypeOf<VoidReasonCode>().toEqualTypeOf<
      'customer_changed_mind' | 'wrong_order_taken' | 'too_late' | 'quality' | 'other'
    >();
    expectTypeOf<VoidDisposition>().toEqualTypeOf<'moved' | 'wastage' | 'staff_meal' | 'other'>();
    expectTypeOf<VoidBlock>().toEqualTypeOf<
      'not_movable_stage' | 'stock_not_tracked' | 'day_closed' | 'move_not_granted'
    >();
  });

  it('[04 §4.4] exported from @pos/domain', () => {
    expect(domain.VOID_REASON_CODES).toBe(VOID_REASON_CODES);
    expect(domain.VOID_DISPOSITIONS).toBe(VOID_DISPOSITIONS);
  });
});
