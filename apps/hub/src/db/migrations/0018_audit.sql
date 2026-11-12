-- 04 §3.6: read model of the curated audit actions; folded from events only; projection reset deletes all three tables.
-- Names: staff_names (00 row H-1), joined at read; never part of the fold.
CREATE TABLE audit_entries (
  seq               INTEGER PRIMARY KEY,          -- the event's seq (one row per mapped event)
  event_id          TEXT    NOT NULL UNIQUE,
  recorded_at       INTEGER NOT NULL,             -- envelope recorded_at, hub clock (E6 AC3); same order as seq
  action            TEXT    NOT NULL,             -- AUDIT_ACTIONS
  actor_staff_id    TEXT,                         -- the person who did it (§3.6 columns per action; requester on approved voids / comps)
  approver_staff_id TEXT,
  method            TEXT CHECK (method IN ('session','pin','in_person')),
  device_id         TEXT    NOT NULL,
  subject_type      TEXT    NOT NULL,             -- order / table / staff / device / station / stock / day
  subject_id        TEXT    NOT NULL,
  order_id          TEXT,
  table_code        TEXT,                         -- request rows: AlertRaised.display.table_code
  table_id          TEXT,                         -- order rows: the table the order was placed at (audit_orders)
  reason            TEXT,                         -- reason_code[: note], ≤ 200
  outcome           TEXT,                         -- approved / rejected / withdrawn / disposition / mode
  amount_minor      INTEGER,                      -- refund, comp value, … (D47)
  detail_json       TEXT    NOT NULL              -- the rest, small (≤ 2 KB)
);
-- GET /queries/audit-log: newest first in a time range …
CREATE INDEX audit_entries_time   ON audit_entries (recorded_at DESC, seq DESC);
-- … by staff member (as actor or approver; two index scans in one UNION ALL statement)
CREATE INDEX audit_entries_actor  ON audit_entries (actor_staff_id, recorded_at DESC, seq DESC);
CREATE INDEX audit_entries_appr   ON audit_entries (approver_staff_id, recorded_at DESC, seq DESC) WHERE approver_staff_id IS NOT NULL;
-- … by action type
CREATE INDEX audit_entries_action ON audit_entries (action, recorded_at DESC, seq DESC);

-- lookups folded by the same projection (never deleted by alert retention)
CREATE TABLE audit_requests (
  alert_id           TEXT PRIMARY KEY,            -- AlertRaised with request ≠ null
  kind               TEXT NOT NULL,
  requester_staff_id TEXT,
  order_id           TEXT,                        -- subject when subject_stream_type = 'order'
  table_code         TEXT,
  answerer_staff_id  TEXT                         -- set by the fold on RequestAnswered (v0.5, H4-2)
);
CREATE TABLE audit_orders (
  order_id TEXT PRIMARY KEY,                      -- OrderPlaced
  table_id TEXT                                   -- null for takeaway / parking
);
