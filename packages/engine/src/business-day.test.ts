import { readFileSync } from 'node:fs';
import { parseEvent, type BranchConfig, type ConfigItem, type ConfigItemV1, type PosEvent } from '@pos/events';
import { aBranchConfig, aBranchConfigV1, aBusinessDayClosed, aBusinessDayOpened, aStockSet } from '@pos/events/testing';
import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  buildEngineState,
  dayDraws,
  dayStockUnit,
  ENGINE_STATE_VERSION,
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

function v2Item(config: BranchConfig, id: string): ConfigItem {
  const found = config.items.find((i) => i.item_id === id);
  if (found === undefined) throw new Error(id);
  return found;
}

function fold(events: readonly PosEvent[]): EngineState {
  return events.reduce(applyEvent, initialEngineState());
}

describe('@pos/engine business day', () => {
  it('[01a §10 #68] buildEngineState(engine-log.v2.json) equals engine-state.v2.json; the v1 log folds to the same v2 state', () => {
    expect(ENGINE_STATE_VERSION).toBe(2);
    const state = fixture(`engine-state.v${ENGINE_STATE_VERSION}.json`);
    for (const name of ['engine-log.v2.json', 'engine-log.v1.json']) {
      const log = (fixture(name) as unknown[]).map((e) => parseEvent(e));
      expect(log.map((e) => e.event_type), name).toEqual(
        expect.arrayContaining(['BusinessDayOpened', 'BusinessDayClosed', 'StockAdded', 'HubStarted']),
      );
      expect(buildEngineState(log), name).toEqual(state);
    }
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

  it('[01a S44] dayStockUnit and dayDraws return the frozen values while open and the config values for an unlisted item or with no day open', () => {
    // The day froze I3 at g / piece / 250; the snapshot has since changed it.
    const config = aBranchConfig();
    const changed: ConfigItem = { ...v2Item(config, 'I3'), stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 1 }] };
    const pieces = { stock_item_id: 'I3', stock_unit: 'piece' as const };
    const configUnits = { I3: 'piece' as const };
    const open = fold([aBusinessDayOpened({ recorded_at: T0 })]);
    expect(open.business_day).toMatchObject({
      stock_units: { I1: 'piece', I3: 'g' },
      draws: { I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }] } },
    });
    expect(dayStockUnit(open, pieces)).toBe('g');
    expect(dayDraws(open, changed, configUnits)).toEqual({
      sale_unit: 'piece',
      stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }],
    });
    expect(dayStockUnit(open, { stock_item_id: 'K1', stock_unit: 'g' })).toBe('g');
    expect(dayDraws(open, v2Item(config, 'I2'), {})).toEqual({ sale_unit: 'piece', stock_draws: [] });

    expect(dayStockUnit(initialEngineState(), pieces)).toBe('piece');
    expect(dayDraws(initialEngineState(), changed, configUnits)).toEqual({
      sale_unit: 'piece',
      stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 1 }],
    });
    const closed = applyEvent(open, aBusinessDayClosed({ recorded_at: T0 + 1000 }));
    expect(dayStockUnit(closed, pieces)).toBe('piece');
    expect(dayDraws(closed, changed, configUnits).stock_draws).toEqual([{ stock_item_id: 'I3', quantity_per_sale_unit: 1 }]);
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
