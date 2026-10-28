CREATE TABLE config_snapshots (                 -- S5: content-addressed, insert-only
  snapshot_hash  TEXT    PRIMARY KEY,           -- sha256 hex of canonicalJson(body)
  config_version INTEGER NOT NULL,
  body           TEXT    NOT NULL,              -- canonicalJson(raw snapshot), unknown fields kept (S28 d)
  received_at    INTEGER NOT NULL
);
CREATE TRIGGER config_snapshots_no_update BEFORE UPDATE ON config_snapshots
  BEGIN SELECT RAISE(ABORT, 'config snapshots are immutable'); END;
CREATE TRIGGER config_snapshots_no_delete BEFORE DELETE ON config_snapshots
  BEGIN SELECT RAISE(ABORT, 'config snapshots are immutable'); END;

CREATE TABLE branch_config (                    -- projection of BranchConfigApplied (rebuildable)
  branch_id      TEXT    PRIMARY KEY,
  config_version INTEGER NOT NULL,
  snapshot_schema_version INTEGER NOT NULL,     -- S28 b: ≠ SNAPSHOT_SCHEMA_VERSION → treated as body missing
  snapshot_hash  TEXT    NOT NULL,              -- body looked up in config_snapshots (may be absent, S5)
  applied_at     INTEGER NOT NULL               -- the event's recorded_at
);

CREATE TABLE item_availability (                -- projection of ItemMade{Una,A}vailable (rebuildable)
  item_id      TEXT    PRIMARY KEY,             -- itemAvailability(): WHERE item_id IN (…)
  is_available INTEGER NOT NULL CHECK (is_available IN (0,1)),
  changed_at   INTEGER NOT NULL,                -- the event's recorded_at
  changed_by   TEXT                             -- actor_id
);
