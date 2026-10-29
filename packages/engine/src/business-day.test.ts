import { readFileSync } from 'node:fs';
import { parseEvent, type ConfigItemV1, type PosEvent } from '@pos/events';
import { aBranchConfigV1, aBusinessDayClosed, aBusinessDayOpened, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  dayUnits,
  initialEngineState,
  openDayStartMs,
  stockLevel,
  type EngineState,
} from './index';

const T0 = 1_761_000_000_000;

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8')) as unknown;
}

function item(id: string, o: Partial<ConfigItemV1> = {}): ConfigItemV1 {
  const found = aBranchConfigV1().items.find((i) => i.item_id === id);
  if (found === undefined) throw new Error(id);
  return { ...found, ...o };
}

function fold(events: readonly PosEvent[]): EngineState {
  return events.reduce(applyEvent, initialEngineState());
}

describe('@pos/engine business day', () => {
  it('[01a §10 #68] buildEngineState(engine-log.v1.json) equals engine-state.v1.json', () => {
    const log = (fixture('engine-log.v1.json') as unknown[]).map((e) => parseEvent(e));
    expect(log.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['BusinessDayOpened', 'BusinessDayClosed', 'StockAdded', 'HubStarted']),
    );
    expect(buildEngineState(log)).toEqual(fixture('engine-state.v1.json'));
  });

  it('[01a S33] openDayStartMs is null before an open and after a close', () => {
    const before = initialEngineState();
    expect(openDayStartMs(before)).toBeNull();
    const open = applyEvent(before, aBusinessDayOpened({ recorded_at: T0 }));
    expect(openDayStartMs(open)).toBe(T0);
    expect(open.business_day).toMatchObject({ business_date: '2025-10-20', opened_at: T0, closed_at: null });
    const closed = applyEvent(open, aBusinessDayClosed({ recorded_at: T0 + 1000 }));
    expect(openDayStartMs(closed)).toBeNull();
    expect(closed.business_day?.closed_at).toBe(T0 + 1000);
    expect(applyEvent(before, aBusinessDayClosed())).toEqual(before);
  });

  it('[01a S44] dayUnits returns the frozen triple while open and the item own fields for an unlisted item or with no day open', () => {
    // The day froze I3 at g / piece / 250; the snapshot has since changed it.
    const changed = item('I3', { stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 });
    const open = fold([aBusinessDayOpened({ recorded_at: T0 })]);
    expect(dayUnits(open, changed)).toEqual({ stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 });
    expect(dayUnits(open, item('I2'))).toEqual({ stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 });
    expect(dayUnits(initialEngineState(), changed)).toEqual({
      stock_unit: 'piece',
      sale_unit: 'piece',
      stock_per_sale_unit: 1,
    });
    const closed = applyEvent(open, aBusinessDayClosed({ recorded_at: T0 + 1000 }));
    expect(dayUnits(closed, changed).stock_unit).toBe('piece');
  });

  it('[01a S46] stockLevel cases', () => {
    const open = fold([aBusinessDayOpened({ recorded_at: T0 })]);
    const start = openDayStartMs(open);
    const withThreshold = item('I1', { low_stock_threshold: 1_000 });
    const count = (n: number) => applyEvent(open, aStockSet({ recorded_at: T0 + 1, payload: { on_hand: n } }));

    expect(stockLevel(open, 'I1', start, withThreshold)).toBe('not_counted');
    expect(stockLevel(count(5), 'I1', null, withThreshold)).toBe('not_counted');
    expect(stockLevel(count(0), 'I1', start, withThreshold)).toBe('out');
    expect(stockLevel(count(1_000), 'I1', start, withThreshold)).toBe('low');
    expect(stockLevel(count(1_001), 'I1', start, withThreshold)).toBe('ok');
    expect(stockLevel(count(1), 'I1', start, item('I1', { low_stock_threshold: null }))).toBe('ok');
  });
});
