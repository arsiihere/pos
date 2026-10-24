CREATE TABLE devices (
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
  CHECK ((device_type = 'kds')   = (station_id IS NOT NULL)),
  CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))
);

CREATE TABLE pairing_tokens (
  pairing_token_id    TEXT    PRIMARY KEY,
  branch_id           TEXT    NOT NULL,
  token_hash          TEXT    NOT NULL UNIQUE,
  device_type         TEXT    NOT NULL CHECK (device_type IN ('tablet','phone')),
  owner_staff_id      TEXT,
  created_by          TEXT    NOT NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  consumed_at         INTEGER,
  consumed_request_id TEXT,
  device_id           TEXT,
  CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))
);

CREATE TABLE pair_requests (
  request_id       TEXT    PRIMARY KEY,
  branch_id        TEXT    NOT NULL,
  poll_secret_hash TEXT    NOT NULL,
  display_code     TEXT    NOT NULL,
  device_name      TEXT    NOT NULL,
  requester_ip     TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL,
  approved_at      INTEGER,
  approved_by      TEXT,
  device_id        TEXT,
  delivery_token   TEXT
);
CREATE INDEX pair_requests_pending ON pair_requests (branch_id, expires_at)
  WHERE approved_at IS NULL;

CREATE TABLE admin_bootstrap_tokens (
  bootstrap_token_id TEXT    PRIMARY KEY,
  branch_id          TEXT    NOT NULL,
  token_hash         TEXT    NOT NULL UNIQUE,
  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,
  consumed_at        INTEGER,
  session_id         TEXT
);

CREATE TABLE staff_sessions (
  session_id       TEXT    PRIMARY KEY,
  branch_id        TEXT    NOT NULL,
  token_hash       TEXT    NOT NULL UNIQUE,
  kind             TEXT    NOT NULL CHECK (kind IN ('staff','admin','station')),
  staff_id         TEXT,
  station_id       TEXT,
  device_id        TEXT,
  idle_ttl_ms      INTEGER,
  started_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  ended_at         INTEGER,
  end_reason       TEXT,
  ended_by         TEXT,
  CHECK (kind = 'admin' OR device_id IS NOT NULL),
  CHECK ((kind = 'station') = (station_id IS NOT NULL)),
  CHECK ((kind = 'station') = (staff_id IS NULL)),
  CHECK ((kind = 'station') = (idle_ttl_ms IS NULL))
);
CREATE UNIQUE INDEX staff_sessions_active_device
  ON staff_sessions (device_id) WHERE ended_at IS NULL AND kind IN ('staff','station');
CREATE INDEX staff_sessions_active ON staff_sessions (branch_id) WHERE ended_at IS NULL;

CREATE TABLE auth_lockouts (
  branch_id         TEXT    NOT NULL,
  subject_type      TEXT    NOT NULL CHECK (subject_type IN ('staff','device','ip')),
  subject_id        TEXT    NOT NULL,
  failed_count      INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  locked_until      INTEGER,
  PRIMARY KEY (branch_id, subject_type, subject_id)
);
CREATE INDEX auth_lockouts_locked ON auth_lockouts (branch_id, locked_until) WHERE locked_until IS NOT NULL;
