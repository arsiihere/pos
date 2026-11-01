-- 01d §5.1 (spec 01d v1.0, SQL verbatim); also 00 v1.6 §5.1 H-12 (app_releases), H-14 (staff_sessions_staff_activity).
CREATE TABLE alerts (
  alert_id            TEXT    PRIMARY KEY,
  kind                TEXT    NOT NULL,
  family              TEXT    NOT NULL CHECK (family IN ('urgent','action','info')),
  subject_stream_type TEXT    NOT NULL,
  subject_stream_id   TEXT    NOT NULL,
  dedupe_key          TEXT    NOT NULL,
  requester_staff_id  TEXT,
  raised_device_id    TEXT    NOT NULL,     -- AlertRaised envelope device_id; 'hub' when tick-raised (v0.5 N2)
  raised_seq          INTEGER NOT NULL,     -- seq of AlertRaised; bounds the step-event read of §6.10 (v0.5 m12)
  hidden_session_id   TEXT,                 -- personal notices raised by an answer: the answering session never sees or closes it (§3.10, v1.0 R2)
  hidden_device_id    TEXT,                 -- … nor any session on that device; cleared on the next BusinessDayClosed (v1.0 R2)
  target_json         TEXT    NOT NULL,
  values_json         TEXT    NOT NULL,
  display_json        TEXT    NOT NULL,
  details_json        TEXT,                 -- signed-in-only approver context (§3.12); null = none
  request_json        TEXT,                 -- null = not a request
  step                INTEGER NOT NULL DEFAULT -1,
  next_due_at         INTEGER,              -- min(next undue step, raised_at + closes_on.after_ms); null = nothing pending (M1)
  expire_due          INTEGER NOT NULL DEFAULT 0 CHECK (expire_due IN (0,1)),  -- set by BusinessDayClosed (§3.5)
  state               TEXT    NOT NULL CHECK (state IN ('open','closed')),
  close_reason        TEXT    CHECK (close_reason IN ('answered','withdrawn','done','obsolete','overridden','undone','expired')),
  decision            TEXT,
  closed_by_staff_id  TEXT,
  raised_at           INTEGER NOT NULL,
  closed_at           INTEGER,
  CHECK ((state = 'closed') = (close_reason IS NOT NULL))
);
-- raise dedupe (A12): one open alert per (kind, key) (v0.4 m8)
CREATE UNIQUE INDEX alerts_open_dedupe ON alerts (kind, dedupe_key) WHERE state = 'open';
-- alerts.listOpen (§4.2, M8)
CREATE INDEX alerts_open_kind ON alerts (kind, raised_at) WHERE state = 'open';
-- tick: due steps (§3.5)
CREATE INDEX alerts_due ON alerts (next_due_at) WHERE state = 'open' AND next_due_at IS NOT NULL;
-- "my pending requests" (§6.8) and the no-approver check
CREATE INDEX alerts_requester ON alerts (requester_staff_id, state) WHERE request_json IS NOT NULL;
-- requests-to-answer and the staff catch-up: every open request (v0.5 N3)
CREATE INDEX alerts_open_requests ON alerts (raised_at) WHERE state = 'open' AND request_json IS NOT NULL;

CREATE TABLE alert_recipients (               -- every step's recipients, one row set per step, kept until retention (cumulative, v0.4 M2)
  alert_id      TEXT NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
  staff_id      TEXT,
  device_id     TEXT,
  for_staff_id  TEXT,
  recipient_set TEXT NOT NULL CHECK (recipient_set IN ('answerer','informed','recipient')),
  step          INTEGER NOT NULL,
  CHECK ((staff_id IS NULL) <> (device_id IS NULL))
);
-- by person (§6.7) and by device: alerts_open, catch-up and the receipt "was sent" check, over all steps (§6 batch 3)
CREATE INDEX alert_recipients_staff  ON alert_recipients (staff_id, alert_id)  WHERE staff_id IS NOT NULL;
CREATE INDEX alert_recipients_device ON alert_recipients (device_id, alert_id) WHERE device_id IS NOT NULL;
CREATE INDEX alert_recipients_alert  ON alert_recipients (alert_id);

CREATE TABLE alert_inbox (                    -- every person ever a recipient (inbox keeps past steps' people; with or without a route, v0.5 N5)
  staff_id   TEXT    NOT NULL,
  alert_id   TEXT    NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
  first_at   INTEGER NOT NULL,
  moved_to   TEXT,                            -- "Moved to Bilal" (G1-11c), set when a later step drops this person
  PRIMARY KEY (staff_id, alert_id)
);

CREATE TABLE alert_receipts (                 -- dedupe and receipt view (A11)
  alert_id   TEXT    NOT NULL,
  staff_id   TEXT    NOT NULL DEFAULT '',     -- '' for a device-target receipt
  device_id  TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('delivered','seen')),
  step       INTEGER NOT NULL DEFAULT -1,     -- delivered: the step shown (v0.4 m5); seen: -1
  at         INTEGER NOT NULL,
  PRIMARY KEY (alert_id, staff_id, device_id, kind, step)
);

CREATE TABLE request_seen (                   -- from RequestSeen (subject stream); stops the urgent repeat (§8.3)
  alert_id TEXT NOT NULL, staff_id TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (alert_id, staff_id)
);

CREATE TABLE device_bindings (                -- §3.7
  device_id  TEXT PRIMARY KEY,
  staff_id   TEXT NOT NULL,
  session_id TEXT,                            -- the SessionStarted that set it; null for a phone owner binding
  since      INTEGER NOT NULL
);
CREATE INDEX device_bindings_staff   ON device_bindings (staff_id);
CREATE INDEX device_bindings_session ON device_bindings (session_id) WHERE session_id IS NOT NULL;   -- SessionEnded → delete by id

CREATE TABLE alert_flags (                  -- persisted dirty flags read by the tick (§3.9)
  name TEXT PRIMARY KEY CHECK (name IN ('no_approver')), dirty INTEGER NOT NULL CHECK (dirty IN (0,1))
);
INSERT INTO alert_flags (name, dirty) VALUES ('no_approver', 1);

-- C-01b caches, replaced whole by applyStaffDirectory
CREATE TABLE no_pin_staff (
  staff_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, lead_staff_id TEXT
);
CREATE INDEX no_pin_staff_lead ON no_pin_staff (lead_staff_id);
-- §3.11
CREATE TABLE presence_today (
  staff_id TEXT PRIMARY KEY, present INTEGER NOT NULL CHECK (present IN (0,1)), set_by TEXT NOT NULL, at INTEGER NOT NULL
);

-- C-00 H-14: 00's staff_sessions, last activity per person for the binding rule (§3.4.3 (c), v0.5 N6)
CREATE INDEX staff_sessions_staff_activity ON staff_sessions (staff_id, last_activity_at);

-- §8.4, C-00 H-5 (installation state, written only by the hub CLI; not a projection)
CREATE TABLE app_releases (
  version_code     INTEGER PRIMARY KEY,
  version_name     TEXT    NOT NULL,
  sha256           TEXT    NOT NULL,
  staged_device_id TEXT,                      -- null = marked good, released to every tablet
  added_at         INTEGER NOT NULL
);
