import { aBranchConfigV1 } from '@pos/events/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { branchConfig } from '../../src/sync/branch-config-holder';
import { configPoller } from '../../src/sync/config-poller';
import { stubConfigCloud } from '../helpers/stub-config-cloud';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';

const BRANCH = 'branch-1';
const CONFIRMED = { tenant_id: 'tenant-a', branch_id: BRANCH, branch_name: 'Main', branch_api_key: 'key-1', confirmed_at: 1 };

describe('station validator from the branch config (§6.22)', () => {
  const hubs: TestHub[] = [];
  afterEach(async () => {
    for (const h of hubs.splice(0)) await h.close();
  });

  it('[01a §10 #57] before any config KDS pairing → 404 STATION_NOT_FOUND; after apply → paired; archived station → 404 STATION_NOT_FOUND', async () => {
    const cloud = stubConfigCloud();
    const h = await createTestHub({ configClient: cloud, config: { provisioned: { ...CONFIRMED } } });
    hubs.push(h);
    await seedDirectory(h);
    const tablet = pairDevice(h, { type: 'tablet' });
    const admin = openSession(h, { kind: 'admin', staffId: 'S_OWNER', deviceId: tablet.deviceId });
    let n = 0;
    async function pairKds(stationId: string) {
      n += 1;
      const created = await h.app.inject({
        method: 'POST',
        url: '/pair/requests',
        remoteAddress: `10.8.0.${n}`,
        payload: { device_name: `Kitchen ${n}` },
      });
      const request = created.json().data as { request_id: string; display_code: string };
      return h.app.inject({
        method: 'POST',
        url: '/admin/commands/approve-pairing-request',
        headers: { authorization: `Bearer ${tablet.token}`, 'x-admin-session': admin.token },
        payload: {
          command_id: `cmd-approve-${n}`,
          tenant_id: 'tenant-a',
          branch_id: BRANCH,
          command_type: 'ApprovePairingRequest',
          payload: { request_id: request.request_id, display_code: request.display_code, device_type: 'kds', station_id: stationId },
          occurred_at: h.clock.branchNow(),
          actor_id: 'S_OWNER',
          device_id: tablet.deviceId,
        },
      });
    }
    const kdsCount = () => h.deps.db.prepare(`SELECT COUNT(*) FROM devices WHERE device_type = 'kds'`).pluck().get();

    // before any config
    expect(branchConfig()).toBeNull();
    const before = await pairKds('S1');
    expect(before.statusCode).toBe(404);
    expect(before.json().error.code).toBe('STATION_NOT_FOUND');
    expect(kdsCount()).toBe(0);

    // after apply
    const base = aBranchConfigV1({ branch_id: BRANCH, config_version: 3 });
    const archived = { ...base.stations[0]!, station_id: 'S2', name: 'Old grill', is_archived: true };
    cloud.respondWithSnapshot({ ...base, stations: [...base.stations, archived] });
    expect((await configPoller(h.app).pollOnce()).outcome).toBe('applied');
    const paired = await pairKds('S1');
    expect(paired.statusCode).toBe(200);
    expect(paired.json().data.result).toMatchObject({ device_type: 'kds', station_id: 'S1' });
    expect(kdsCount()).toBe(1);

    // archived station, and a station the config does not know
    for (const stationId of ['S2', 'S9']) {
      const refused = await pairKds(stationId);
      expect(refused.statusCode).toBe(404);
      expect(refused.json().error.code).toBe('STATION_NOT_FOUND');
    }
    expect(kdsCount()).toBe(1);
  });
});
