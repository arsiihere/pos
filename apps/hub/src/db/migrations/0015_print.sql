-- 03c v1.0.1 §5 (hub SQLite), verbatim (F-1 replaces Foundation §5.8's print_jobs DDL; no print_jobs table existed).
-- print_config projection (reset): PrinterSaved, StationOutputSet
CREATE TABLE printers (
  printer_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  connection TEXT NOT NULL CHECK (connection IN ('lan','usb')), address TEXT NOT NULL,
  paper_width_mm INTEGER NOT NULL CHECK (paper_width_mm IN (58,80)),
  archived_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX printers_name_active ON printers (name) WHERE archived_at IS NULL;        -- CONFIG_NAME_TAKEN

CREATE TABLE station_outputs (
  station_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('screen','both','printer')),
  printer_id TEXT,
  show_taker INTEGER NOT NULL DEFAULT 1 CHECK (show_taker IN (0,1)),
  show_order_id INTEGER NOT NULL DEFAULT 1 CHECK (show_order_id IN (0,1)),
  CHECK (mode = 'screen' OR printer_id IS NOT NULL)
);
CREATE INDEX station_outputs_printer ON station_outputs (printer_id);                        -- CONFIG_IN_USE

-- worker-owned (plain statements)
CREATE TABLE printer_runtime (
  printer_id TEXT PRIMARY KEY,
  supports_status INTEGER CHECK (supports_status IN (0,1)),   -- NULL unknown; learned at test print / first LAN answer
  last_status TEXT, last_status_at INTEGER, last_clean_at INTEGER, last_ack_at INTEGER, last_error TEXT,
  problem_alert_id TEXT
);
CREATE TABLE print_fold_skips (
  event_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, order_ids TEXT NOT NULL,
  reason TEXT NOT NULL, at INTEGER NOT NULL, alerted_at INTEGER
);

-- kitchen_tickets projection (forward-only; jobs only live)
CREATE TABLE tickets (
  ticket_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, order_id TEXT NOT NULL,
  fire_event_id TEXT NOT NULL, fired_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('scheduled','early_fill','pulled'))
);
CREATE INDEX tickets_order ON tickets (order_id);                                             -- reprint by order, slips
CREATE INDEX tickets_station_fired ON tickets (station_id, fired_at);                         -- fallback per dark station
CREATE INDEX tickets_fired ON tickets (fired_at);                                             -- retention

CREATE TABLE ticket_lines (
  order_item_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, station_id TEXT NOT NULL, done_at INTEGER
);
CREATE INDEX ticket_lines_ticket ON ticket_lines (ticket_id);

CREATE TABLE print_jobs (                        -- F-1; hub state, never synced
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('kitchen','reprint','cancel','first','coming_up','document','test')),
  printer_id TEXT, station_id TEXT, ticket_id TEXT, order_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL, sent_at INTEGER, sent_printer_id TEXT, acked_at INTEGER, cancelled_at INTEGER,
  suspect_at INTEGER, suspect_resolved_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  is_reprint INTEGER NOT NULL DEFAULT 0 CHECK (is_reprint IN (0,1)),
  CHECK (printer_id IS NOT NULL OR station_id IS NOT NULL)
);
CREATE INDEX print_jobs_pending ON print_jobs (created_at) WHERE acked_at IS NULL AND cancelled_at IS NULL;  -- FIFO heads, boot
CREATE INDEX print_jobs_ticket ON print_jobs (ticket_id) WHERE ticket_id IS NOT NULL;                       -- printed / live-job checks
CREATE UNIQUE INDEX print_jobs_one_live_kitchen ON print_jobs (ticket_id)
  WHERE kind = 'kitchen' AND cancelled_at IS NULL;                                                          -- at-fire vs fallback never double
CREATE INDEX print_jobs_suspect ON print_jobs (station_id) WHERE suspect_at IS NOT NULL AND suspect_resolved_at IS NULL; -- recovery
CREATE INDEX print_jobs_acked_by_printer ON print_jobs (sent_printer_id, acked_at) WHERE acked_at IS NOT NULL AND suspect_at IS NULL; -- suspect marking
