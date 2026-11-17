import { describe, expect, it } from 'vitest';
import { createLiveBus, type LiveMessage } from './live';

const ev = (seq: number, event_type = 'TableOpened') => ({ type: 'event' as const, seq, event: { event_id: `E${seq}`, event_type, schema_version: 1, payload: {} } });

describe('[02 W0.6] live bus', () => {
  it('[02 W0.6] catch_up / event frames reach subscribers in seq order; reconnect and visibilitychange→visible are published', () => {
    const bus = createLiveBus();
    const got: LiveMessage[] = [];
    const off = bus.subscribe((m) => got.push(m));
    bus.connection(true); // the first connect is no reconnect
    bus.frame({ type: 'catch_up', as_of_seq: 10, state: { tables: { as_of_seq: 10, floors: [] } } });
    bus.frame(ev(9)); // covered by the catch-up
    bus.frame(ev(11));
    bus.frame(ev(11)); // a duplicate
    bus.frame(ev(12, 'ItemAdded'));
    bus.frame({ type: 'error', error: { code: 'X', message: 'm' } });
    bus.connection(false);
    bus.connection(false);
    bus.connection(true);
    bus.frame({ type: 'catch_up', as_of_seq: 20, state: {} });
    bus.frame(ev(21));
    bus.visibility('hidden');
    bus.visibility('visible');
    expect(got.map((m) => (m.kind === 'event' ? `event:${m.seq}` : m.kind === 'catch_up' ? `catch_up:${m.as_of_seq}` : m.kind))).toEqual([
      'catch_up:10',
      'event:11',
      'event:12',
      'reconnect',
      'catch_up:20',
      'event:21',
      'visible',
    ]);
    expect(bus.lastSeq()).toBe(21);
    expect(bus.part('tables')).toBeUndefined(); // the second catch-up had no tables part
    off();
    bus.frame(ev(22));
    expect(got).toHaveLength(7);
  });

  it('[02 W0.6] the last catch-up parts stay readable for a screen that mounts later', () => {
    const bus = createLiveBus();
    const tables = { as_of_seq: 3, floors: [] };
    bus.frame({ type: 'catch_up', as_of_seq: 3, state: { tables, orders: { orders: [], zone_stock: [] } } });
    expect(bus.part('tables')).toBe(tables);
    expect(bus.part('orders')).toEqual({ orders: [], zone_stock: [] });
  });
});
