import type { DeviceProfileSetPayload } from '@pos/events';
import type { Projection } from './registry.js';

// 05a §5.1, §5.2: projections `device_profiles` / `device_people` of DeviceProfileSet (the whole profile each time;
// replay = last event per device wins), plus a forward-only UPDATE of devices.device_name / point_id (the
// `device_roles` pattern, §2: `devices` is not a projection, so that UPDATE is not part of the reset). The fold is
// the only writer of devices.point_id (K-1). 4 statements per event, whatever the number of people.

const UPSERT_PROFILE = `
  INSERT INTO device_profiles (device_id, access, screens, profile_version, needs_review)
  VALUES (@device_id, @access, @screens, @profile_version, @needs_review)
  ON CONFLICT (device_id) DO UPDATE SET
    access = excluded.access, screens = excluded.screens,
    profile_version = excluded.profile_version, needs_review = excluded.needs_review`;
const DELETE_PEOPLE = 'DELETE FROM device_people WHERE device_id = ?';
const INSERT_PEOPLE = 'INSERT INTO device_people (device_id, staff_id) SELECT ?, value FROM json_each(?)';
const UPDATE_DEVICE = 'UPDATE devices SET device_name = ?, point_id = ? WHERE device_id = ?';

export function deviceProfilesProjection(): Projection {
  return {
    name: 'device_profiles',
    eventTypes: ['DeviceProfileSet'],
    apply(tx, event) {
      if (event.event_type !== 'DeviceProfileSet') return;
      const p = event.payload as DeviceProfileSetPayload;
      tx.prepare(UPSERT_PROFILE).run({
        device_id: p.device_id,
        access: p.access,
        screens: JSON.stringify(p.screens),
        profile_version: p.profile_version,
        needs_review: p.needs_review ? 1 : 0,
      });
      tx.prepare(DELETE_PEOPLE).run(p.device_id);
      // §5.2: `everyone` ⇔ no device_people rows (its staff_ids are empty by contract).
      tx.prepare(INSERT_PEOPLE).run(p.device_id, JSON.stringify(p.access === 'listed' ? p.staff_ids : []));
      tx.prepare(UPDATE_DEVICE).run(p.device_name, p.point_id, p.device_id);
    },
    reset(tx) {
      tx.prepare('DELETE FROM device_people').run();
      tx.prepare('DELETE FROM device_profiles').run();
    },
  };
}
