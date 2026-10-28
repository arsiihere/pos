import { describe, expect, it } from 'vitest';
import { parseEvent } from '../src/codecs';
import { BranchConfigSnapshotSchemaV1, isStockTracked } from '../src/config';
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
] as const;

describe('builders', () => {
  it('[F §6.7] every builder output parses', () => {
    for (const name of builderNames) {
      const build = builders[name];
      expect(parseEvent(build()), name).toMatchObject({ event_type: expect.any(String) });
    }
  });

  it('[01a §4.3] aBranchConfig is a valid snapshot with I1, I3 tracked and I2 not', () => {
    const config = builders.aBranchConfig();
    expect(BranchConfigSnapshotSchemaV1.parse(config)).toEqual(config);
    expect(config.stations.find((s) => s.name === 'Karahi')?.station_type).toBe('slot');
    const item = (id: string) => {
      const found = config.items.find((i) => i.item_id === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    expect(isStockTracked(config, item('I1'))).toBe(true);
    expect(item('I1').stock_unit).toBe('piece');
    expect(isStockTracked(config, item('I3'))).toBe(true);
    expect(item('I3')).toMatchObject({ stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 });
    expect(isStockTracked(config, item('I2'))).toBe(false);
    expect(builders.aBranchConfig({ config_version: 9 }).config_version).toBe(9);
  });
});
