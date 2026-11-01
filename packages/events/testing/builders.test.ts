import { describe, expect, it } from 'vitest';
import { parseEvent } from '../src/codecs';
import { BranchConfigSnapshotSchemaV2, isStockTracked } from '../src/config';
import '../src/index';
import * as builders from './index';

const builderNames = [
  'aHubProvisioned',
  'aHubStarted',
  'aClockAlarm',
  'aStaffDirectoryApplied',
  'aAdminBootstrapTokenIssued',
  'aDevicePairingTokenGenerated',
  'aDevicePaired',
  'aDeviceTokenRotated',
  'aDeviceRevoked',
  'aDevicePinLockedOut',
  'aSessionStarted',
  'aSessionEnded',
  'aStaffPinLockedOut',
  'aPinLockoutCleared',
  'aBranchConfigApplied',
  'aStockSet',
  'aStockAdded',
  'aBusinessDayOpened',
  'aBusinessDayClosed',
  'anItemMadeUnavailable',
  'anItemMadeAvailable',
  'anAlertRaised',
  'anAttemptSent',
  'aRequestAnswered',
  'anAlertClosed',
  'aPresenceSet',
] as const;

describe('builders', () => {
  it('[F §6.7] every builder output parses', () => {
    for (const name of builderNames) {
      const build = builders[name];
      expect(parseEvent(build()), name).toMatchObject({ event_type: expect.any(String) });
    }
  });

  it('[01c §4.6] aBranchConfig is a valid schema-2 snapshot: K1 in g at Karahi, Half I1 500 g, Full I3 1 000 g, I2 untracked', () => {
    const config = builders.aBranchConfig();
    expect(BranchConfigSnapshotSchemaV2.parse(config)).toEqual(config);
    expect(config.snapshot_schema_version).toBe(2);
    const karahi = config.stations.find((s) => s.name === 'Karahi');
    expect(karahi?.station_type).toBe('slot');
    expect(config.stock_items).toEqual([
      expect.objectContaining({ stock_item_id: 'K1', stock_unit: 'g', station_id: karahi?.station_id }),
    ]);
    const item = (id: string) => {
      const found = config.items.find((i) => i.item_id === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    expect(item('I1')).toMatchObject({ variant_name: 'Half', sale_unit: 'piece' });
    expect(item('I1').stock_draws).toEqual([{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }]);
    expect(item('I3')).toMatchObject({ variant_name: 'Full', sale_unit: 'piece' });
    expect(item('I3').stock_draws).toEqual([{ stock_item_id: 'K1', quantity_per_sale_unit: 1000 }]);
    expect(isStockTracked(item('I1'))).toBe(true);
    expect(isStockTracked(item('I3'))).toBe(true);
    expect(isStockTracked(item('I2'))).toBe(false);
    expect(builders.aBranchConfig({ config_version: 9 }).config_version).toBe(9);
  });

  it('[01c §5.1] aBranchConfigItemStock is a valid schema-2 snapshot: stock items I1 (piece, 1) and I3 (g, 250) at Karahi, I2 untracked', () => {
    const config = builders.aBranchConfigItemStock();
    expect(BranchConfigSnapshotSchemaV2.parse(config)).toEqual(config);
    expect(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit, s.station_id])).toEqual([
      ['I1', 'piece', 'S1'],
      ['I3', 'g', 'S1'],
    ]);
    const item = (id: string) => {
      const found = config.items.find((i) => i.item_id === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    expect(item('I1').stock_draws).toEqual([{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }]);
    expect(item('I3').stock_draws).toEqual([{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }]);
    expect(isStockTracked(item('I2'))).toBe(false);
    expect(builders.aBranchConfigItemStock({ config_version: 9 }).config_version).toBe(9);
  });
});
