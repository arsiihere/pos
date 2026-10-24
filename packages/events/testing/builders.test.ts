import { describe, expect, it } from 'vitest';
import { parseEvent } from '../src/codecs';
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
] as const;

describe('builders', () => {
  it('[F §6.7] every builder output parses', () => {
    for (const name of builderNames) {
      const build = builders[name];
      expect(parseEvent(build()), name).toMatchObject({ event_type: expect.any(String) });
    }
  });
});
