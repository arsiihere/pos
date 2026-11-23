-- migrate:foreign-keys-off
-- 05a v1.0.1 §5.1 (00 H-5). The runner turns foreign keys off for this file and runs foreign_key_check before commit.

-- 1. Rebuild devices without CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL)).
--    Every column of 0002 and 0008, in order; the kds/station CHECK is kept. No index, trigger or FK refers to devices.
CREATE TABLE devices_v2 (
  device_id      TEXT    PRIMARY KEY,
  branch_id      TEXT    NOT NULL,
  token_hash     TEXT    NOT NULL UNIQUE,
  device_name    TEXT    NOT NULL,
  device_type    TEXT    NOT NULL CHECK (device_type IN ('tablet','cashier_kiosk','kds','phone')),
  station_id     TEXT,
  owner_staff_id TEXT,
  paired_at      INTEGER NOT NULL,
  paired_by      TEXT    NOT NULL,
  last_seen_at   INTEGER,
  revoked_at     INTEGER,
  revoked_by     TEXT,
  point_id       TEXT,
  lane_label     TEXT,
  CHECK ((device_type = 'kds') = (station_id IS NOT NULL))
);

INSERT INTO devices_v2 (device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id,
                        paired_at, paired_by, last_seen_at, revoked_at, revoked_by, point_id, lane_label)
SELECT device_id, branch_id, token_hash, device_name, device_type, station_id, owner_staff_id,
       paired_at, paired_by, last_seen_at, revoked_at, revoked_by, point_id, lane_label
FROM devices;

DROP TABLE devices;
ALTER TABLE devices_v2 RENAME TO devices;

-- 2. The projections of DeviceProfileSet (registerHubProjections; reset = DELETE of both).
CREATE TABLE device_profiles (           -- projection of DeviceProfileSet; staff devices only
  device_id       TEXT    PRIMARY KEY REFERENCES devices(device_id),
  access          TEXT    NOT NULL CHECK (access IN ('everyone','listed')),
  screens         TEXT    NOT NULL,      -- JSON array, ordered, 1–6
  profile_version INTEGER NOT NULL,      -- SetDeviceProfile expected_version
  needs_review    INTEGER NOT NULL CHECK (needs_review IN (0,1))   -- from DeviceProfileSet.needs_review
);

CREATE TABLE device_people (             -- projection of DeviceProfileSet.staff_ids (listed devices)
  device_id TEXT NOT NULL REFERENCES devices(device_id),
  staff_id  TEXT NOT NULL,
  PRIMARY KEY (device_id, staff_id)
);
CREATE INDEX device_people_staff ON device_people (staff_id);   -- M-5 and H-4 device_count

-- 3. The pair page's hardware hint (a form default only).
ALTER TABLE pair_requests ADD COLUMN hardware_hint TEXT
  CHECK (hardware_hint IN ('tablet','cashier_kiosk','kds','phone'));
