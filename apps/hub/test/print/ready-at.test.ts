import { describe, expect, it } from 'vitest';
import { customerReadyAt } from '../../src/print/render/ready-at';

const state = {
  orders: { o: { promise_ms: 200, target_land_ms: 150 } },
  stations: { s: { loads: { l: { booked: { start: 10, end: 80, units: 1 } } } } },
};
const line = {
  order_id: 'o', station_id: 's', carry_ms: 10, cook_ms: 30, load_id: null,
  booked: null, done_at: null, started_at: null, fired_at: null, fire_ms: null,
};
const booked = { start: 5, end: 70, units: 1 };

describe('[03c v1.0.16 §4.2 #58] customer ready time', () => {
  it.each([
    [{ done_at: 60, booked, load_id: 'l', started_at: 20 }, 70],
    [{ booked, load_id: 'l', started_at: 20 }, 80],
    [{ load_id: 'l', started_at: 20 }, 90],
    [{ started_at: 20, fired_at: 15, fire_ms: 10 }, 60],
    [{ fired_at: 15, fire_ms: 10 }, 55],
    [{ fire_ms: 10 }, 50],
    [{ load_id: 'missing', fire_ms: 0 }, 40],
  ] as const)('applies timing precedence to %j', (overrides, land_at) => {
    expect(customerReadyAt(state, { ...line, ...overrides })).toEqual({ land_at, ready_at: land_at + 50 });
  });

  it('returns null without a start or a known order', () => {
    expect(customerReadyAt(state, line)).toBeNull();
    expect(customerReadyAt(state, { ...line, order_id: 'missing', done_at: 10 })).toBeNull();
  });
});

// ⚠️ BR-1 (owner 2026-11-27; 03c v1.0.16 §4.2, 03a PK-1, PK-5): a boosted order keeps its promise while the boost
// moves its target land (plan.ts boostOrder), so (promise − target_land) no longer is the padding: its customer time is
// land + the engine's padding (paddingOf: the station's, else the branch's per order type; 0 on FIFO / EDF). An order
// never boosted keeps land + (promise − target_land), byte for byte (the cases above).
describe('[03c §4.2; BR-1] customer ready time of a boosted order', () => {
  const config = {
    stations: [
      { station_id: 's', policy: 'waada_guard', promise_padding_ms: null },
      { station_id: 'f', policy: 'fifo', promise_padding_ms: 900 },
      { station_id: 'p', policy: 'waada_guard', promise_padding_ms: 7 },
    ],
    settings: { promise_padding_takeaway_ms: 30, promise_padding_dine_in_ms: 40, promise_padding_parking_ms: 20 },
  } as never;
  // the boost moved the target land to 50 (from 150); the stored promise stays 200
  const boosted = { promise_ms: 200, target_land_ms: 50, boosted: true, order_type: 'takeaway' as const };
  const at = (order: object, o: object = {}) => customerReadyAt({ ...state, config, orders: { o: order } } as never, { ...line, fire_ms: 10, ...o });

  it('land + the takeaway padding (earlier than the promise), not land + (promise − target_land)', () => {
    expect(at(boosted)).toEqual({ land_at: 50, ready_at: 80 });
    expect(at({ ...boosted, order_type: 'parking' })).toEqual({ land_at: 50, ready_at: 70 });
  });

  it('the station override; 0 on a FIFO station', () => {
    expect(at(boosted, { station_id: 'p' })).toEqual({ land_at: 50, ready_at: 57 });
    expect(at(boosted, { station_id: 'f' })).toEqual({ land_at: 50, ready_at: 50 });
  });

  it('an order never boosted is unchanged: land + (promise − target_land)', () => {
    expect(at({ ...boosted, boosted: false, target_land_ms: 150 })).toEqual({ land_at: 50, ready_at: 100 });
  });
});
