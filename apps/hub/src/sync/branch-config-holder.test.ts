import { aBranchConfig } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { branchConfig, currentConfigEntry, swapBranchConfig, type ConfigEntry } from './branch-config-holder';

describe('branch config holder', () => {
  afterEach(() => {
    swapBranchConfig(null);
  });

  it('[01a §4.2] swapBranchConfig then branchConfig returns it; null resets', () => {
    expect(branchConfig()).toBeNull();
    expect(currentConfigEntry()).toBeNull();
    const entry: ConfigEntry = {
      config: aBranchConfig({ config_version: 7 }),
      snapshotHash: 'a'.repeat(64),
      configVersion: 7,
      snapshotSchemaVersion: 1,
      appliedAt: 1_761_000_000_000,
    };
    swapBranchConfig(entry);
    expect(branchConfig()).toBe(entry.config);
    expect(currentConfigEntry()).toBe(entry);
    swapBranchConfig(null);
    expect(branchConfig()).toBeNull();
    expect(currentConfigEntry()).toBeNull();
  });
});
