-- 05 Billing v1.0.7 §5 (hub SQLite): the one hub migration of 05 (plan §2B.5 task 6; number re-taken in P0.1, 0021 is 02b's,
-- 0022 is 03c's). The block below is the spec §5 SQL text verbatim; it holds the fiscal_outbox / fiscal_credentials DDL
-- that task 6a staged in apps/hub/src/billing/fiscal/outbox-ddl.sql (plan PL-13), copied verbatim, that file deleted.
-- Projections `billing` and `shifts` (events-only, with reset) own the projection tables; invoice_buyers,
-- payment_references, fiscal_credentials, bill_print_jobs, bill_texts and the worker columns of fiscal_outbox are hub
-- state written by plain statements (never events, never synced).

-- projection billing ---------------------------------------------------------------------------------------
CREATE TABLE bills (
  bill_id            TEXT PRIMARY KEY,
  scope              TEXT NOT NULL CHECK (scope IN ('seating','key')),   -- v0.3 R2: 'key' = takeaway / parking table_key
  seating_id         TEXT,                                  -- dine_in
  table_key          TEXT,                                  -- takeaway / parking: 02b orders.bill_key (v0.4 H2-4, H2-16; column name kept)
  order_type         TEXT NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('open','partly_paid','closed')),
  opened_at          INTEGER NOT NULL,
  closed_at          INTEGER,
  sc_bp              INTEGER NOT NULL DEFAULT 0,            -- ChargeApplied (rule or manual); 0 after ChargeRemoved
  sc_removed         INTEGER NOT NULL DEFAULT 0 CHECK (sc_removed IN (0,1)),   -- sticky (B8)
  discount_json      TEXT,                                  -- { kind, value, reason_code, alert_id, frozen_minor|null } | NULL; whole bill only (v0.2, OQ-4); ⚠️ Changed in v1.0.7 (R-41 / G-38): frozen_minor set only by the DiscountFrozen fold, cleared by BillReopened
  split_mode         TEXT CHECK (split_mode IN ('items','amount','equal')),    -- NULL = one split
  buyer_waived       INTEGER NOT NULL DEFAULT 0 CHECK (buyer_waived IN (0,1)),
  check_printed_at   INTEGER,                               -- pulled status "check bill printed" (B17)
  reopen_count       INTEGER NOT NULL DEFAULT 0,
  reopen_mode        TEXT CHECK (reopen_mode IN ('full','corrections')),   -- v0.3 R2 (§3.10); NULL = never reopened; ⚠️ Changed in v1.0.7 (R-40 / G-37): set by the billing fold from BillReopened.mode (§6.13, §6.29)
  absorbed_into      TEXT,                                  -- §3.9 merge
  prices_include_tax INTEGER NOT NULL CHECK (prices_include_tax IN (0,1)),   -- v0.7.2 (H9-9): the mode in force at BillOpened, frozen for the bill
  rounding_json      TEXT NOT NULL,                         -- v0.8.2 (H16-2): { step_minor|null, mode, applies_to } frozen at BillOpened
  CHECK ((scope = 'seating') = (seating_id IS NOT NULL)),
  CHECK ((scope = 'key') = (table_key IS NOT NULL))
);
CREATE UNIQUE INDEX bills_live_seating ON bills (seating_id) WHERE seating_id IS NOT NULL AND absorbed_into IS NULL AND state <> 'closed' AND reopen_mode IS NOT 'corrections';  -- openBillOf(seating); one open bill per seating, a later one after close (v0.2, OQ-6)
CREATE UNIQUE INDEX bills_live_key     ON bills (table_key) WHERE table_key IS NOT NULL AND state <> 'closed' AND reopen_mode IS NOT 'corrections';  -- openBillOf(key) (v0.3 R2); ⚠️ Changed in v1.0.7 (R-40 / G-37): both bills_live_* predicates read reopen_mode as the fold wrote it from BillReopened.mode, in the reopen's own transaction: a 'corrections' reopen never re-enters either index (no clash with the newer bill on the seating / key, #37f), a 'full' one does; each BillReopened overwrites the mode
CREATE INDEX bills_open                ON bills (state, opened_at) WHERE state <> 'closed' AND absorbed_into IS NULL;  -- open-bills list, X flag
CREATE INDEX bills_seating             ON bills (seating_id);   -- ⚠️ Changed in v1.0.7 (task 6 review): every bill of a seating, corrections bills included (the bills_live_* indexes exclude them): §3.10 other-open-bill checks, §6.4a tile reader
CREATE INDEX bills_key                 ON bills (table_key);    -- ⚠️ Changed in v1.0.7 (task 6 review): every bill of a takeaway / parking key (02b bill_key), corrections bills included: §3.10 other-open-bill checks

CREATE TABLE bill_orders (              -- written at the bill's last close (B1); the reopen set (v0.2, OQ-6)
  bill_id TEXT NOT NULL, order_id TEXT NOT NULL, PRIMARY KEY (bill_id, order_id)
);
CREATE INDEX bill_orders_order ON bill_orders (order_id);                                  -- line guard (row Q-3)

CREATE TABLE bill_splits (
  bill_id   TEXT NOT NULL, split_no INTEGER NOT NULL CHECK (split_no BETWEEN 1 AND 20),
  plan_json TEXT,                                          -- amount: { share_minor }; equal: { n, k }; items: rows in bill_split_lines (v0.4, H2-15)
  state     TEXT NOT NULL CHECK (state IN ('open','closed')),
  invoice_id TEXT,                                         -- the current sale invoice when closed
  PRIMARY KEY (bill_id, split_no)
);

CREATE TABLE bill_discount_lines (      -- v0.4 (H2-8, owner Q-1): lines on the bill at the close that takes it from no closed split to one (v1.0.6, R-29: the first close, or the first after a reopen); only they carry the frozen discount
  bill_id TEXT NOT NULL, order_item_id TEXT NOT NULL, PRIMARY KEY (bill_id, order_item_id)
);                                        -- filled from that InvoiceIssued's discount_line_ids (v1.0.6, R-29: was "the first InvoiceIssued's"; one INSERT … SELECT json_each); cleared by BillReopened (H2-19); also read by §6.1 added_after_close

-- bill_split_shares removed in v0.8.1 (§26: pro_rata out of v1.0)

CREATE TABLE bill_split_lines (         -- v0.4 (H2-15): item-split plan entries, foldable from events alone
  bill_id TEXT NOT NULL, split_no INTEGER NOT NULL, order_item_id TEXT NOT NULL, order_id TEXT NOT NULL, units INTEGER NOT NULL,
  PRIMARY KEY (bill_id, split_no, order_item_id)
);
CREATE INDEX bill_split_lines_line  ON bill_split_lines (order_item_id);              -- ItemVoided / ItemRemoved fold
CREATE INDEX bill_split_lines_order ON bill_split_lines (order_id);                   -- SeatingSplit fold

CREATE TABLE bill_payments (
  payment_id        TEXT PRIMARY KEY,
  bill_id           TEXT NOT NULL, split_no INTEGER NOT NULL,
  mode_id           TEXT NOT NULL,
  payment_class     TEXT NOT NULL CHECK (payment_class IN ('cash','digital')),
  direction         TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount_minor      INTEGER NOT NULL CHECK (amount_minor > 0),
  tendered_minor    INTEGER CHECK (tendered_minor IS NULL OR tendered_minor >= amount_minor),   -- change = tendered − amount, on this row's shift (v0.3, H1-2, H1-3)
  has_reference     INTEGER NOT NULL DEFAULT 0 CHECK (has_reference IN (0,1)),   -- v0.3 (H1-20): the text is in payment_references
  taken_by_staff_id TEXT NOT NULL,
  shift_id          TEXT NOT NULL,
  added_at          INTEGER NOT NULL,
  removed_at        INTEGER,
  invoice_id        TEXT                                   -- set by InvoiceIssued; cleared by BillReopened (carried to the next close)
);
CREATE INDEX bill_payments_split ON bill_payments (bill_id, split_no) WHERE removed_at IS NULL;   -- bill view, close

CREATE TABLE invoices (
  invoice_id      TEXT PRIMARY KEY,
  series          TEXT NOT NULL CHECK (series IN ('sale','credit')),
  number          INTEGER NOT NULL,                        -- gap-free per series (B13)
  invoice_ref     TEXT NOT NULL,                           -- '<prefix>' + 'S' | 'C' + number = the fiscal idempotency key (v0.6, H6-1; v0.7 J-6)
  bill_id         TEXT NOT NULL, split_no INTEGER NOT NULL,
  ref_invoice_id  TEXT,                                    -- credit → original
  business_date   TEXT NOT NULL,                           -- the open day at issue (Z key)
  issued_at       INTEGER NOT NULL,
  order_type      TEXT NOT NULL,
  jurisdiction_id TEXT NOT NULL, adapter_key TEXT NOT NULL,   -- v0.7 (J-1): recorded at issue; a credit copies its original's
  currency_code   TEXT NOT NULL,                           -- v0.7 (J-1): the tenant's currency at issue (v0.7.2 owner Q-1: one tenant = one currency)
  prices_include_tax INTEGER NOT NULL CHECK (prices_include_tax IN (0,1)),   -- v0.7 (J-3): the price mode used
  subtotal_minor  INTEGER NOT NULL, discount_minor INTEGER NOT NULL, service_charge_minor INTEGER NOT NULL,
  tax_minor       INTEGER NOT NULL, rounding_minor INTEGER NOT NULL, total_minor INTEGER NOT NULL,
  change_minor    INTEGER NOT NULL,
  payment_class   TEXT NOT NULL,                           -- the split's class, or 'mixed'
  has_buyer_id    INTEGER NOT NULL CHECK (has_buyer_id IN (0,1)),
  buyer_id_refused INTEGER NOT NULL CHECK (buyer_id_refused IN (0,1)),
  closed_by       TEXT NOT NULL,
  doc_json        TEXT NOT NULL,                           -- lines + tax rows (receipt reprint, Z); payments are joined by payment_id, regardless of removed_at, the event holds payment_ids only ⚠️ Changed in v1.0.2 (P0.1b, R-12 / G-6): was "as in the event")
  credited_by     TEXT,                                    -- the credit invoice_id once credited
  fiscal_number   TEXT, qr_payload TEXT                    -- FiscalNumberAssigned
);
CREATE UNIQUE INDEX invoices_series_number ON invoices (series, number);                  -- MAX+1, gap check
CREATE UNIQUE INDEX invoices_ref ON invoices (invoice_ref);                             -- v0.6 (H6-1): idempotency key unique across sale and credit
CREATE INDEX invoices_day   ON invoices (business_date, series);                         -- Z / X
CREATE INDEX invoices_bill  ON invoices (bill_id);                                       -- reopen, bill view

CREATE TABLE invoice_taxes (            -- v0.7 (J-2): one row per (profile, tax, payment class) — the rate snapshot of the invoice
  invoice_id TEXT NOT NULL, tax_profile_id TEXT NOT NULL, tax_code TEXT NOT NULL, payment_class TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq BETWEEN 1 AND 4), compound INTEGER NOT NULL CHECK (compound IN (0,1)), label TEXT NOT NULL,
  rate_bp INTEGER NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000), base_minor INTEGER NOT NULL, tax_minor INTEGER NOT NULL CHECK (tax_minor >= 0), rate_ref TEXT,
  PRIMARY KEY (invoice_id, tax_profile_id, tax_code, payment_class)
);                                                                                       -- Z tax by (tax code, profile, class) (joined by invoices_day)

CREATE TABLE fiscal_outbox (            -- rows by the billing fold (live + rebuild, INSERT OR IGNORE); worker columns below
  invoice_id   TEXT PRIMARY KEY,
  ord          INTEGER NOT NULL,                           -- the invoice event's seq (send order)
  ref_invoice_id TEXT,                                     -- credit waits for its original
  jurisdiction_id TEXT NOT NULL, adapter_key TEXT NOT NULL, pos_id TEXT,   -- v0.7 (J-1, J-6): was `authority`
  state        TEXT NOT NULL CHECK (state IN ('pending','acked','rejected','not_required')),
  queued_at    INTEGER NOT NULL,
  acked_at     INTEGER,
  -- worker-owned (plain statements; reset by a rebuild, which is harmless)
  attempts     INTEGER NOT NULL DEFAULT 0, next_try_at INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,                                       -- a short code only ('timeout', 'http_503', 'token_missing', …)
  in_flight_at INTEGER
);
CREATE INDEX fiscal_outbox_pending ON fiscal_outbox (ord) WHERE state = 'pending';       -- worker head, status, stuck check
CREATE INDEX fiscal_outbox_rejected ON fiscal_outbox (ord) WHERE state = 'rejected';     -- ⚠️ Changed in v1.0.7 (task 6 review): §3.15 stuck check (every tick) and §6.27 rejected_count; fiscal_outbox is never pruned, so without it both scan the table

CREATE TABLE closed_split_units (       -- v0.2 (OQ-6): units each closed split invoiced; deleted for the bill by BillReopened.
                                         -- v0.3 (H1-27): filled by one INSERT … SELECT … FROM json_each(InvoiceIssued.lines);
                                         -- amount / equal splits store the line's live units at that close (the whole line freezes)
  bill_id TEXT NOT NULL, split_no INTEGER NOT NULL, order_item_id TEXT NOT NULL, units INTEGER NOT NULL, share_minor INTEGER NOT NULL,
  PRIMARY KEY (bill_id, split_no, order_item_id)
);
CREATE INDEX closed_split_units_line ON closed_split_units (order_item_id);             -- 05 line guard (row Q-3), 1 statement

CREATE TABLE carried_orders (order_id TEXT NOT NULL, business_date TEXT NOT NULL, reason_code TEXT NOT NULL, PRIMARY KEY (order_id, business_date));  -- v0.6 (H6-10)  -- day-close guard
CREATE TABLE z_reports (business_date TEXT PRIMARY KEY, z_no INTEGER NOT NULL UNIQUE, issued_at INTEGER NOT NULL, report_json TEXT NOT NULL);
CREATE TABLE billing_day (k INTEGER PRIMARY KEY CHECK (k = 1), business_date TEXT, opened_at INTEGER);  -- current day key

-- projection shifts ----------------------------------------------------------------------------------------
CREATE TABLE shifts (
  shift_id        TEXT PRIMARY KEY,
  staff_id        TEXT NOT NULL,
  drawer_device_id TEXT,                                   -- non-NULL = drawer shift (B11)
  business_date   TEXT NOT NULL,
  opened_at       INTEGER NOT NULL,
  float_minor     INTEGER NOT NULL CHECK (float_minor >= 0),
  state           TEXT NOT NULL CHECK (state IN ('open','closed')),   -- v0.6 (owner Q-2): no counted state
  variance_state  TEXT CHECK (variance_state IN ('pending','approved','disputed')),   -- NULL = within threshold or skipped
  expected_cash_minor INTEGER NOT NULL,                    -- running (§3.7); never returned before counted_at (B23)
  counted_minor   INTEGER, counted_at INTEGER, variance_minor INTEGER,
  count_skipped   INTEGER NOT NULL DEFAULT 0 CHECK (count_skipped IN (0,1)),
  variance_alert_id TEXT,                                  -- ⚠️ Changed in v1.0.7 (R-42 / G-39): ShiftCounted.variance_alert_id (NULL within the threshold)
  closed_at       INTEGER, closed_by TEXT
);
CREATE UNIQUE INDEX shifts_open_staff  ON shifts (staff_id) WHERE state = 'open';                       -- SHIFT_ALREADY_OPEN
CREATE UNIQUE INDEX shifts_open_drawer ON shifts (drawer_device_id) WHERE state = 'open' AND drawer_device_id IS NOT NULL;  -- DRAWER_IN_USE
CREATE INDEX shifts_day ON shifts (business_date);
CREATE INDEX shifts_signoff_pending ON shifts (closed_at) WHERE variance_state = 'pending';   -- v0.6.2 (H8-1): "pending sign-offs" on X / Z
CREATE TABLE shift_signoffs (            -- v0.6.2 (H8-1): "variance sign-offs" of the report's day, any shift date
  shift_id TEXT PRIMARY KEY, outcome TEXT NOT NULL CHECK (outcome IN ('approved','disputed')),
  approver_staff_id TEXT NOT NULL, signed_at INTEGER NOT NULL, business_date TEXT NOT NULL
);
CREATE INDEX shift_signoffs_day ON shift_signoffs (business_date);                                                         -- Z / X, day-close guard

CREATE TABLE shift_handovers (shift_id TEXT NOT NULL, at INTEGER NOT NULL, counted_minor INTEGER NOT NULL,
  expected_minor INTEGER NOT NULL, variance_minor INTEGER NOT NULL, by_staff_id TEXT NOT NULL, PRIMARY KEY (shift_id, at));

CREATE TABLE shift_takings (            -- per shift × mode × taker (X / Z / shift close breakdown, Q10)
  shift_id TEXT NOT NULL, mode_id TEXT NOT NULL, taken_by_staff_id TEXT NOT NULL,
  in_minor INTEGER NOT NULL DEFAULT 0, out_minor INTEGER NOT NULL DEFAULT 0, change_minor INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (shift_id, mode_id, taken_by_staff_id)
);

CREATE TABLE petty_cash (
  entry_id TEXT PRIMARY KEY, shift_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('advance','out','in')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  category_id TEXT, advance_staff_id TEXT, at INTEGER NOT NULL,   -- v0.5.1 (H4-4): paid_to / note columns dropped (texts in bill_texts)
  settled_at INTEGER, settled_shift_id TEXT, spent_minor INTEGER, returned_minor INTEGER
);
CREATE INDEX petty_cash_shift ON petty_cash (shift_id);                                  -- shift view, Z
CREATE INDEX petty_cash_open  ON petty_cash (at) WHERE kind = 'advance' AND settled_at IS NULL;   -- open advances list

-- hub state (not projections) ------------------------------------------------------------------------------
CREATE TABLE invoice_buyers (           -- B19: the only place a buyer tax ID lives; written by CloseSplit; never synced, logged or returned
  invoice_id TEXT PRIMARY KEY, buyer_name TEXT NOT NULL,
  id_type TEXT NOT NULL,                   -- v0.7 (J-4): a type of the jurisdiction's accepted_types ('CNIC', 'NTN', …)
  id_value TEXT NOT NULL                   -- normalised (strip characters removed); never leaves the hub except to the adapter and that receipt
);
CREATE TABLE bill_texts (               -- v0.4 (H2-22), v0.5 (H3-5): every free text a 05 command takes; hub-only, never synced
  subject_id TEXT NOT NULL,              -- the id the command mints and its event carries (entry_id, payment_id, note_id)
  field TEXT NOT NULL CHECK (field IN ('note','paid_to')), text TEXT NOT NULL,
  PRIMARY KEY (subject_id, field)
);
CREATE TABLE payment_references (       -- v0.3 (H1-20): hub-only; written by AddPayment; never synced, logged or in an event
  payment_id TEXT PRIMARY KEY, reference TEXT NOT NULL
);
CREATE TABLE fiscal_credentials (       -- v0.2 (OQ-3, B22): written only by SetFiscalToken; never synced, logged, returned or put in an event
  pos_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'token',   -- v0.7.3 (H10-5): an adapter's named secrets (credentialNames); PRA: 'token'
  token TEXT NOT NULL, set_at INTEGER NOT NULL, set_by_staff_id TEXT NOT NULL,
  PRIMARY KEY (pos_id, name)
);
CREATE TABLE bill_print_jobs (          -- B18: job ids per bill document (03c jobs are not events)
  job_id TEXT PRIMARY KEY, bill_id TEXT, doc_kind TEXT NOT NULL CHECK (doc_kind IN ('check','receipt','credit','report','no_sale')),
  ref_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX bill_print_jobs_bill ON bill_print_jobs (bill_id, created_at DESC);        -- bill view print status

-- Audit refold (§5 "Audit refold", v0.3 H1-8; 04 v1.0.7 row V-3): 05 maps events with history (02a BillRequested), so
-- the `audit` projection refolds from seq 0 with 05's maps at the next boot. Safe by 00 v1.10 H-2 (applyAll only
-- updates existing checkpoint rows). Other checkpoints stay; no data UPDATE.
DELETE FROM projection_checkpoints WHERE projection = 'audit';
