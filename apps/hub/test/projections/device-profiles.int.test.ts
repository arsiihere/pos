import type { DeviceProfileSetPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { Projection, ProjectionRegistry } from '../../src/projections/registry';
import { registerHubProjections } from '../../src/lib/boot';
import { deviceProfilesProjection } from '../../src/projections/device-profiles';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, pairDevice, type TestHub } from '../helpers/test-hub';

// 05a §5.1, §5.2: projections `device_profiles` / `device_people` (fold = the whole profile, reset = DELETE both)
// and the forward-only UPDATE of devices.device_name / point_id (not part of the reset, §2).

const BRANCH = 'branch-1';

function profileSet(h: TestHub, p: Omit<DeviceProfileSetPayload, 'cause' | 'needs_review'> & Partial<Pick<DeviceProfileSetPayload, 'cause' | 'needs_review'>>): void {
  const payload: DeviceProfileSetPayload = { cause: 'edited', needs_review: false, ...p };
  h.deps.writer.run((tx) => {
    tx.append([
      {
        stream_type: 'hub',
        stream_id: p.device_id,
        event_type: 'DeviceProfileSet',
        schema_version: 1,
        payload,
        occurred_at: h.clock.branchNow(),
        actor_id: 'S_MGR',
        device_id: 'hub-admin',
      },
    ]);
  });
}

function snapshot(db: Database.Database): { profiles: unknown[]; people: unknown[] } {
  return {
    profiles: db.prepare('SELECT * FROM device_profiles ORDER BY device_id').all(),
    people: db.prepare('SELECT * FROM device_people ORDER BY device_id, staff_id').all(),
  };
}

function devicesRow(db: Database.Database, id: string): unknown {
  return db.prepare('SELECT device_name, point_id, lane_label FROM devices WHERE device_id = ?').get(id);
}

describe('[05a §5.1] projection device_profiles', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function hub(): Promise<TestHub> {
    const h = await createTestHub();
    cleanups.push(() => h.close());
    return h;
  }

  it('[05a §5.1] registered once in registerHubProjections, eventTypes [DeviceProfileSet], with reset', () => {
    const seen: Projection[] = [];
    registerHubProjections({ register: (p: Projection) => seen.push(p), afterCatchUp: () => undefined } as unknown as ProjectionRegistry);
    const mine = seen.filter((p) => p.name === 'device_profiles');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.eventTypes).toEqual(['DeviceProfileSet']);
    expect(mine[0]!.reset).toBeTypeOf('function');
  });

  it('[05a §5.1] the fold upserts the whole profile and replaces the device people', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet' });
    profileSet(h, { device_id: deviceId, device_name: 'Front', access: 'listed', staff_ids: ['S_ALI', 'S_BILAL'], screens: ['dine_in', 'takeaway'], point_id: null, profile_version: 1, cause: 'approved' });
    expect(snapshot(h.deps.db)).toEqual({
      profiles: [{ device_id: deviceId, access: 'listed', screens: '["dine_in","takeaway"]', profile_version: 1, needs_review: 0 }],
      people: [
        { device_id: deviceId, staff_id: 'S_ALI' },
        { device_id: deviceId, staff_id: 'S_BILAL' },
      ],
    });
    profileSet(h, { device_id: deviceId, device_name: 'Front', access: 'listed', staff_ids: ['S_BILAL', 'S_CARA'], screens: ['takeaway'], point_id: null, profile_version: 2 });
    expect(snapshot(h.deps.db)).toEqual({
      profiles: [{ device_id: deviceId, access: 'listed', screens: '["takeaway"]', profile_version: 2, needs_review: 0 }],
      people: [
        { device_id: deviceId, staff_id: 'S_BILAL' },
        { device_id: deviceId, staff_id: 'S_CARA' },
      ],
    });
  });

  it('[05a §5.2] access = everyone ⇔ no device_people rows; listed ⇒ its rows; kds devices have no profile row', async () => {
    const h = await hub();
    const tab = pairDevice(h, { type: 'tablet' }).deviceId;
    const kds = pairDevice(h, { type: 'kds', stationId: 'st-1' }).deviceId;
    profileSet(h, { device_id: tab, device_name: 'T', access: 'listed', staff_ids: ['S_ALI'], screens: ['dine_in'], point_id: null, profile_version: 1 });
    profileSet(h, { device_id: tab, device_name: 'T', access: 'everyone', staff_ids: [], screens: ['dine_in'], point_id: null, profile_version: 2, cause: 'directory', needs_review: true });
    const { profiles, people } = snapshot(h.deps.db);
    expect(profiles).toEqual([{ device_id: tab, access: 'everyone', screens: '["dine_in"]', profile_version: 2, needs_review: 1 }]);
    expect(people).toEqual([]);
    expect(h.deps.db.prepare('SELECT count(*) AS n FROM device_profiles WHERE device_id = ?').get(kds)).toEqual({ n: 0 });
  });

  it('[05a §5.1] devices.device_name and devices.point_id = the last event\'s (forward-only; lane_label untouched)', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet', name: 'Old' });
    h.deps.db.prepare(`UPDATE devices SET lane_label = 'L1' WHERE device_id = ?`).run(deviceId);
    profileSet(h, { device_id: deviceId, device_name: 'Pass 1', access: 'everyone', staff_ids: [], screens: ['pass', 'dine_in'], point_id: 'pt-1', profile_version: 1 });
    expect(devicesRow(h.deps.db, deviceId)).toEqual({ device_name: 'Pass 1', point_id: 'pt-1', lane_label: 'L1' });
    profileSet(h, { device_id: deviceId, device_name: 'Front 2', access: 'everyone', staff_ids: [], screens: ['dine_in'], point_id: null, profile_version: 2 });
    expect(devicesRow(h.deps.db, deviceId)).toEqual({ device_name: 'Front 2', point_id: null, lane_label: 'L1' });
  });

  it('[05a §5.1] one DeviceProfileSet folds in 4 statements whatever the number of people', async () => {
    const h = await hub();
    const { deviceId } = pairDevice(h, { type: 'tablet' });
    const db = h.deps.db;
    const fold = deviceProfilesProjection();
    const counter = statementCounter(db);
    for (const staff_ids of [['S_ALI'], ['S_ALI', 'S_BILAL', 'S_CARA', 'S_DAN']]) {
      counter.reset();
      const payload: DeviceProfileSetPayload = { device_id: deviceId, device_name: 'T', access: 'listed', staff_ids, screens: ['dine_in'], point_id: null, profile_version: 1, cause: 'edited', needs_review: false };
      db.transaction(() => fold.apply(db, { event_type: 'DeviceProfileSet', payload } as never, 'live'))();
      expect(counter.count).toBe(4);
    }
  });

  it('[05a #14] replay rebuilds device_profiles / device_people exactly, including needs_review', async () => {
    const h = await hub();
    const a = pairDevice(h, { type: 'tablet' }).deviceId;
    const b = pairDevice(h, { type: 'cashier_kiosk' }).deviceId;
    const c = pairDevice(h, { type: 'phone', ownerStaffId: 'S_ALI' }).deviceId;
    profileSet(h, { device_id: a, device_name: 'A', access: 'everyone', staff_ids: [], screens: ['pass', 'dine_in', 'takeaway'], point_id: 'pt-1', profile_version: 1, cause: 'upgrade', needs_review: true });
    profileSet(h, { device_id: b, device_name: 'B', access: 'listed', staff_ids: ['S_ALI', 'S_BILAL'], screens: ['takeaway', 'cashier'], point_id: null, profile_version: 1, cause: 'approved' });
    profileSet(h, { device_id: c, device_name: 'C', access: 'listed', staff_ids: ['S_ALI'], screens: ['dine_in', 'manager'], point_id: null, profile_version: 1, cause: 'upgrade', needs_review: true });
    profileSet(h, { device_id: b, device_name: 'B2', access: 'everyone', staff_ids: [], screens: ['takeaway'], point_id: null, profile_version: 2, cause: 'directory', needs_review: true });
    profileSet(h, { device_id: c, device_name: 'C', access: 'listed', staff_ids: ['S_ALI', 'S_BILAL'], screens: ['dine_in'], point_id: null, profile_version: 2, cause: 'edited' });
    const folded = snapshot(h.deps.db);
    expect(folded.profiles).toEqual([
      { device_id: a, access: 'everyone', screens: '["pass","dine_in","takeaway"]', profile_version: 1, needs_review: 1 },
      { device_id: b, access: 'everyone', screens: '["takeaway"]', profile_version: 2, needs_review: 1 },
      { device_id: c, access: 'listed', screens: '["dine_in"]', profile_version: 2, needs_review: 0 },
    ].sort((x, y) => x.device_id.localeCompare(y.device_id)));

    // Drift the tables, drop the checkpoint: catchUp resets and replays from seq 0 (registry.ts, §5.1).
    h.deps.db.prepare(`UPDATE device_profiles SET needs_review = 0, screens = '[]'`).run();
    h.deps.db.prepare(`INSERT INTO device_people (device_id, staff_id) VALUES (?, 'S_GHOST')`).run(a);
    h.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'device_profiles'`).run();
    const { replayed } = h.deps.projections.catchUp(h.deps.db, BRANCH);
    expect(replayed.device_profiles).toBe(5);
    expect(snapshot(h.deps.db)).toEqual(folded);
  });

  it('[05a §5.1] reset deletes both tables and leaves devices alone; reset + replay = the folded rows', async () => {
    const h = await hub();
    const a = pairDevice(h, { type: 'tablet' }).deviceId;
    profileSet(h, { device_id: a, device_name: 'A', access: 'listed', staff_ids: ['S_ALI'], screens: ['pass'], point_id: 'pt-2', profile_version: 1 });
    const folded = snapshot(h.deps.db);
    const fold = deviceProfilesProjection();
    fold.reset!(h.deps.db);
    expect(snapshot(h.deps.db)).toEqual({ profiles: [], people: [] });
    expect(devicesRow(h.deps.db, a)).toEqual({ device_name: 'A', point_id: 'pt-2', lane_label: null });
    h.deps.db.prepare(`DELETE FROM projection_checkpoints WHERE projection = 'device_profiles'`).run();
    h.deps.projections.catchUp(h.deps.db, BRANCH);
    expect(snapshot(h.deps.db)).toEqual(folded);
  });
});
