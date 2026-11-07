-- F §5.8 snapshot table (D62), as specified there
CREATE TABLE engine_snapshots (
  snapshot_id    TEXT    PRIMARY KEY,
  branch_id      TEXT    NOT NULL,
  taken_at       INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  state_json     TEXT    NOT NULL
);
CREATE INDEX eng_snap_branch ON engine_snapshots (branch_id, taken_at DESC);
  -- serves: boot step 2 "latest snapshot" and retention (keep 2; v0.2, pre-G2 #37)

-- D26 day-close checkpoint (version-independent document)
CREATE TABLE engine_checkpoints (
  checkpoint_id     TEXT    PRIMARY KEY,
  branch_id         TEXT    NOT NULL,
  taken_at          INTEGER NOT NULL,
  last_seq          INTEGER NOT NULL,     -- max seq of the commit that folded BusinessDayClosed (v0.4, G2 #5)
  checkpoint_schema INTEGER NOT NULL,     -- 1
  body_json         TEXT    NOT NULL
);
CREATE INDEX eng_ckpt_branch ON engine_checkpoints (branch_id, last_seq DESC);
  -- serves: boot step 2 fallback; retention keeps 2 (v0.2, pre-G2 #37)

-- §3 #2: replay by (stream_type, event_type) since a seq
CREATE INDEX events_branch_stream ON events (branch_id, stream_type, seq);
  -- serves: the four replay statements and the two stock_version reads of §3.12 (v0.2, pre-G2 #3)
