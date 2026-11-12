// 03a v1.2.4 §4.2 test 140 (04 §4.5 T-1, 04 #49): the void fields on ItemVoided, ItemMovedToStock, StockReleased,
// StockAdded v2 and StockReserved are ignored by every engine fold — the same stream with and without them folds
// to an equal state (strict mode).
import { type PosEvent } from '@pos/events';
import { anEngineConfigApplied, anItemStarted, anOrderBatch, aStockAdded, aStockReleased, aStockReserved, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import { applyEvent, initialEngineState, type EngineState } from '../src/index';

const T = 1_761_000_000_000; // the builders' T
const DAY = T - 3_600_000;
const HIDDEN_PICKUP = T + 3_600_000;

function deepFreeze<V>(value: V): V {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function fold(events: PosEvent[]): EngineState {
  let s = deepFreeze(initialEngineState());
  for (const e of events) s = deepFreeze(applyEvent(s, deepFreeze(e)));
  return s;
}

let seq = 1_000;
const nextSeq = (n = 0): number => {
  const s = seq;
  seq += n + 1;
  return s;
};
const stamp = (e: PosEvent, at: number): PosEvent => {
  const s = nextSeq();
  return { ...e, recorded_at: at, occurred_at: at, seq: s, event_id: `01J${String(s).padStart(23, '0')}` };
};
const orderEv = (event_type: string, order_id: string, payload: Record<string, unknown>, at: number): PosEvent =>
  stamp({ ...anItemStarted(), event_type, stream_id: order_id, payload }, at);

function submit(order_id: string, id: string, quantity: number, from_stock: boolean, at: number): PosEvent[] {
  const s = nextSeq(4 * 1 + 2);
  return anOrderBatch({
    order_id,
    recorded_at: at,
    seq: s,
    lines: [
      {
        order_item_id: id,
        item: { name: 'Seekh kebab', quantity, stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'KB', quantity }], out_of_stock_behaviour: 'cook_fresh' },
        line: { from_stock },
      },
    ],
    order: { order_type: 'delivery', pickup_at_ms: HIDDEN_PICKUP },
    reserved: from_stock ? [{ stock_item_id: 'KB', order_item_id: id, quantity }] : [],
  });
}

describe('[03a #140, 04 #49] engine folds ignore the 04 void fields', () => {
  it('[03a #140, 04 #49] ItemMovedToStock, StockReleased, StockAdded v2, ItemVoided, StockReserved fold to the same state with and without the new fields', () => {
    const setup = [
      stamp(anEngineConfigApplied(), DAY - 60_000),
      stamp(aStockSet({ stream_id: 'KB', payload: { stock_item_id: 'KB', on_hand: 10, unit: 'piece' } }), DAY),
      ...submit('O1', 'L', 3, true, T),
      ...submit('O2', 'M', 1, false, T + 1),
    ];
    const at = T + 1_000;
    // A move of 1 of L's 3 units to stock, then M reserves it (the StockAdded reservation).
    const bare = [
      orderEv('ItemMovedToStock', 'O1', { order_item_id: 'L', units: 1 }, at),
      stamp(aStockReleased({ payload: { stock_item_id: 'KB', order_item_id: 'L', quantity: 1, reason: 'moved' } }), at),
      stamp(aStockAdded({ stream_id: 'KB', payload: { stock_item_id: 'KB', quantity: 1, unit: 'piece', reason: 'moved' } }), at),
      orderEv('ItemVoided', 'O1', { order_item_id: 'L', units: 1, refund_minor: 5_000, comp_voided_minor: 0 }, at),
      stamp(aStockReserved({ payload: { stock_item_id: 'KB', order_item_id: 'M', quantity: 1 } }), at),
    ];
    const voidFields = {
      alert_id: 'A1',
      approver_staff_id: 'S_MGR',
      note: 'cold',
      disposition_note: null,
      requester_staff_id: 'S_ALI',
      reason_code: 'quality',
      disposition: 'moved',
    };
    const withFields = bare.map((e) => ({
      ...e,
      payload: { ...(e.payload as Record<string, unknown>), ...(e.event_type === 'ItemVoided' ? voidFields : { alert_id: 'A1' }) },
    })) as PosEvent[];
    expect(withFields.map((e) => e.event_type)).toEqual(['ItemMovedToStock', 'StockReleased', 'StockAdded', 'ItemVoided', 'StockReserved']);
    const s0 = fold(setup);
    const a = bare.reduce((s, e) => deepFreeze(applyEvent(s, deepFreeze(e))), s0);
    const b = withFields.reduce((s, e) => deepFreeze(applyEvent(s, deepFreeze(e))), s0);
    expect(b).toEqual(a);
    expect(a).not.toEqual(s0); // the stream did change the state
  });
});
