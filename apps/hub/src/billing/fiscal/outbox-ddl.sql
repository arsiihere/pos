-- 05 §5 (B20, B22), staged by task 6a (plan PL-13). NOT a migration: the runner reads only
-- apps/hub/src/db/migrations/NNNN_*.sql with sequential numbers (src/db/migrate.ts), and 0021 / 0022
-- are phase-0b rows. Only apps/hub/test/billing/fiscal/outbox-db.ts applies this file, after migrate().
-- Task 6 copies the two blocks below verbatim into the 05 migration and deletes this file.
-- The blocks are the spec §5 text exactly (apps/hub/test/billing/fiscal/outbox.test.ts checks it).

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

CREATE TABLE fiscal_credentials (       -- v0.2 (OQ-3, B22): written only by SetFiscalToken; never synced, logged, returned or put in an event
  pos_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'token',   -- v0.7.3 (H10-5): an adapter's named secrets (credentialNames); PRA: 'token'
  token TEXT NOT NULL, set_at INTEGER NOT NULL, set_by_staff_id TEXT NOT NULL,
  PRIMARY KEY (pos_id, name)
);
