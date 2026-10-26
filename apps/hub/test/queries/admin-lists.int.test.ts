import { aBranchConfig } from '@pos/events/testing';
import type { BranchConfig } from '@pos/events';
import { afterEach, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

// 00 v1.3 M88: the admin list queries behind the hub admin pages (§6.18a–c).
const cleanups: Array<() => Promise<void>> = [];

async function open(): Promise<TestHub> {
  const hub = await createTestHub();
  cleanups.push(() => hub.close());
  await seedDirectory(hub, await aDirectory());
  return hub;
}

function adminOn(hub: TestHub, staffId: string) {
  const device = pairDevice(hub, { type: 'tablet' });
  const session = openSession(hub, { kind: 'admin', staffId, deviceId: device.deviceId });
  return { device, session };
}

function get(hub: TestHub, admin: ReturnType<typeof adminOn>, resource: string) {
  return hub.app.inject({
    method: 'GET',
    url: `/admin/queries/${resource}`,
    headers: { authorization: `Bearer ${admin.device.token}`, 'x-admin-session': admin.session.token },
  });
}

function withConfig(config: BranchConfig): void {
  swapBranchConfig({ config, snapshotHash: 'h'.repeat(64), configVersion: config.config_version, snapshotSchemaVersion: 1, appliedAt: 0 });
}

describe('admin list queries (§6.18a–c, M88)', () => {
  afterEach(async () => {
    swapBranchConfig(null);
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it('[00 §10 #145] stations: archived left out; at most 3 category names in category order, only categories with an item on the station; no config → empty; no queries', async () => {
    const hub = await open();
    const admin = adminOn(hub, 'S_MGR');
    expect((await get(hub, admin, 'stations')).json().data).toEqual({ stations: [] });

    const base = aBranchConfig();
    const station = base.stations[0]!;
    const cats = ['Naan', 'Roti', 'Kulcha', 'Paratha', 'Empty'].map((name, i) => ({ category_id: `C${i}`, name, sort_order: 5 - i, availability_windows: [] }));
    const item = base.items[0]!;
    withConfig({
      ...base,
      stations: [
        { ...station, station_id: 'T', name: 'Tandoor', location_label: 'Back wall' },
        { ...station, station_id: 'K', name: 'Karahi' },
        { ...station, station_id: 'OLD', name: 'Old grill', is_archived: true },
      ],
      categories: cats,
      items: [
        { ...item, item_id: 'a', station_id: 'T', category_id: 'C0' },
        { ...item, item_id: 'b', station_id: 'T', category_id: 'C1' },
        { ...item, item_id: 'c', station_id: 'T', category_id: 'C2' },
        { ...item, item_id: 'd', station_id: 'T', category_id: 'C3' },
        { ...item, item_id: 'e', station_id: 'K', category_id: 'C0' },
      ],
    });
    const counter = statementCounter(hub.deps.readDb);
    const res = await get(hub, admin, 'stations');
    expect(res.statusCode).toBe(200);
    expect(counter.count).toBe(0);
    expect(res.json().data).toEqual({
      stations: [
        { station_id: 'T', name: 'Tandoor', location_label: 'Back wall', category_names: ['Paratha', 'Kulcha', 'Roti'] },
        { station_id: 'K', name: 'Karahi', location_label: null, category_names: ['Naan'] },
      ],
    });
  });
});
