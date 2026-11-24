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
