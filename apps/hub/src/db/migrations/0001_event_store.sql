CREATE TABLE events (
  event_id    TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  branch_id   TEXT    NOT NULL,
  stream_type TEXT    NOT NULL,
  stream_id   TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,
  payload     TEXT    NOT NULL,
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  actor_id    TEXT,
  device_id   TEXT    NOT NULL,
  seq         INTEGER NOT NULL
);

CREATE UNIQUE INDEX events_branch_seq ON events (branch_id, seq);
CREATE INDEX events_stream ON events (stream_type, stream_id, seq);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;

CREATE TABLE sync_cursor (
  branch_id       TEXT    PRIMARY KEY,
  last_acked_seq  INTEGER NOT NULL DEFAULT 0,
  cloud_offset_ms INTEGER,
  updated_at      INTEGER NOT NULL
);

CREATE TABLE hub_heartbeat (
  branch_id  TEXT    NOT NULL PRIMARY KEY,
  last_beat  INTEGER NOT NULL
);

CREATE TABLE processed_commands (
  command_id    TEXT    PRIMARY KEY,
  branch_id     TEXT    NOT NULL,
  device_id     TEXT    NOT NULL,
  session_id    TEXT,
  command_type  TEXT    NOT NULL,
  payload_hash  TEXT    NOT NULL,
  response_json TEXT    NOT NULL,
  recorded_at   INTEGER NOT NULL
);
CREATE INDEX processed_commands_branch ON processed_commands (branch_id, recorded_at);

CREATE TABLE projection_checkpoints (
  branch_id  TEXT    NOT NULL,
  projection TEXT    NOT NULL,
  last_seq   INTEGER NOT NULL,
  PRIMARY KEY (branch_id, projection)
);
