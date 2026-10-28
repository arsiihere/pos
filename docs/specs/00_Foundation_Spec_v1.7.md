# POS — Foundation Spec v1.7

| Field | Value |
|-------|-------|
| Doc type | Foundation Spec — Phase 0–1 |
| Version | v1.7 — **final foundation version** (D64) |
| Date | 2026-10-23 |
| Tier | T2 Production |
| Status | APPROVED — FINAL (2026-10-23). Engine core coding may begin; overrun handling waits for the tap-rate field test (D43); module specs wait for the §9 blockers |
| Author | Arslan Ahmed Arif |

> **Foundation freeze (D64).** v1.7 is the final version of the foundation spec. Issues found later are handled in the module specs (`docs/specs/README.md`) or as unit tests; they do not reopen this document. A module spec that needs a foundation-level change records it as a decision in its own spec, citing the section it overrides.

### Changes in v1.7 (second independent review of v1.6)

| Review item | Decision | Where |
|---|---|---|
| 1 — Shared Standards + spec index | D59 | §6, `docs/specs/README.md` |
| 2 — inferred ItemDone intent; single_tap start in same txn | D60 | §4.7 |
| 3 — lock loss during BUILDING | D61 | §4.3, §4.7 |
| 4 — engine_version on snapshots | D62 | §5.8 |
| 5 — §8 RLS row, §5.2 diagram, §5.8 step 4, chrony-wait, backup hour | D63 (backup hour); rest editorial | §8, §5.2, §5.8 |
| 6 — OQ15 offline billing today | — (open question) | §7 OQ15 |
| 7 — final-version note | D64 | header |

Sections renumbered: Shared Standards is the new §6; Open questions, Deferred and What comes next are now §7, §8, §9.

### Changes in v1.6 (independent review of v1.5)

| Review item | Decision | Where |
|---|---|---|
| 1, 15 — OQ4 tap dependency | D43 | §4.7 completion facts, §7 OQ4, §9 field test |
| 2 — tick mutations as events, no re-fire | D44 | §4.7, §5.8 step 6 |
| 3 — swap engine state after COMMIT | D45 | §5.9 steps 8–9a |
| 4 — schema_version + upcasters; integer money | D46, D47 | §4.1 |
| 5 — clock guard, cloud offset, RTC battery | D48 | §4.7, §4.1, §5.5, §5.8 |
| 6 — batch 3(b) prep; load compatibility | D49 | §4.7 |
| 7 — single stock authority | D50 | §3.1, §4.7, §5.9 step 5 |
| 8 — table lock auto-release + TTL | D51 | §4.3, §5.9 step 4 |
| 9 — immutable events, sync cursor, contiguity | D52 | §4.1, §5.5 |
| 10 — hub replacement/restore + USB backup | D53 | §5.6, §5.8, §5.10 |
| 11 — mechanical tenant scoping | D54 | §3.4 |
| 12 — YAGNI: one framework, kiosk, cheapest cloud | D55, D56, D57 | §1, §5.1, §5.3, §8 |
| 13, 16 — PRA requirements; P1 blocker | D58 | §3.5, §7 OQ15 |
| 14 — Test 2 wording; §9 OQ list; status line | editorial (no decision) | §4.7 test 2, §9, header |

---

## §1. Header

### Stack

Decided in Phase 0. Recorded in CLAUDE.md. Summary:

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm + Turborepo |
| Hub runtime | Node.js 22 LTS + Fastify 5 |
| Hub database | SQLite 3 — WAL mode, `PRAGMA synchronous = FULL` — via `better-sqlite3` |
| Hub deployment | systemd service, headless Ubuntu LTS mini PC; no Docker on restaurant hardware |
| Cloud runtime | Fastify 5 — same framework as the hub (D55) |
| Cloud database | PostgreSQL 16 — smallest managed tier; free tier or credits where the account qualifies (D57) |
| Cloud hosting | AWS ap-south-1 (Mumbai) — chosen on cost (D57); owner confirms in OQ10 |
| Real-time — LAN | WebSocket (`ws://`) hub ↔ devices; plain HTTP/WS on LAN (no TLS required on LAN) |
| Real-time — cloud | `@fastify/websocket` (`wss://`) for owner dashboard (D55) |
| Client — Android tablets | React + Capacitor; assets bundled on device; local SQLite event queue |
| Client — Windows cashier | Hub-served React app in Chrome or Edge kiosk mode; auto-start on Windows login; IndexedDB command queue (D56) |
| Client — KDS screens | React served directly by hub (`ws://hub-ip:port`); no offline shell |
| Shared packages | `@pos/domain`, `@pos/events`, `@pos/engine` |
| Event IDs | ULID (`ulid` npm package — time-ordered, 128-bit random suffix) |
| Schema validation | Zod — all shared event and command schemas in `@pos/events` |
| Language | TypeScript throughout |

### Tier rationale — T2 Production

Concrete races and invariants that T2 is needed to protect:

| Risk | T2 pattern used |
|------|-----------------|
| Two orders claim the last pre-cooked stock unit simultaneously (D7) | SQLite single-writer: stock check against the event-sourced stock projection inside `BEGIN IMMEDIATE`, then `StockReserved` event (D50) |
| Two order takers open the same table at the same time (D5) | Hub serialises events; second open rejected with current locker info |
| Void approved while cashier closes the bill (D11) | Hub rejects bill-close if any void is PENDING; state checked in same transaction |
| Power loss mid-write drops an event (D24) | `synchronous=FULL` + WAL; device retries until ack received |
| Cloud sync delivers duplicate events on retry | `INSERT … ON CONFLICT (event_id) DO NOTHING` (idempotent by ULID) |
| Sensitive actions untraceable | Immutable append-only audit log (required by E6 story); `events` is INSERT-only, enforced by SQLite triggers (D52) |
| Device retransmits a command already processed (D32) | `processed_commands` table: INSERT command_id + response in same transaction as event INSERT; repeated command_id returns stored response without writing new events |

T3 patterns (RLS, sagas, outbox per-table, stampede protection, load tests) are not justified at P1 scale (3 branches, ~10 concurrent devices per branch, ~200 orders/rush) and fail the YAGNI test. They are listed under §8 Deferred.

### Already implemented

Nothing. Greenfield.

### In scope — this spec

- Monorepo structure and shared package contracts
- Event store design (append-only, hub + cloud schemas)
- Sync protocol (hub → cloud, outbox via events table)
- Device pairing and hub discovery
- Authentication model (PIN + session + device token)
- Hub startup, snapshot, and power-loss recovery (D24)
- All key domain state machines (item lifecycle, table, order, void approval, timing engine)
- Timing engine architecture and state shape (`@pos/engine`)
- Cashier shift model (D21)
- Event schema versioning and money representation (D46, D47)
- Clock guard (D48), nightly local backup and hub replacement/restore (D53)
- Shared Standards for all modules: envelope, errors, endpoints, WS, naming, tests, migrations, folders (§6, D59)

### Out of scope — covered in per-module specs

- Full endpoint specs (Phase 3, one spec per module)
- Column-level data models with indexes (Phase 2, per module)
- UI and client implementation details
- Third-party integrations (FBR, WhatsApp, card terminals — post-pilot)
- E7–E14 stories (P2–P4)

---

## §2. Objective

Every P1 capability, as bullets:

- Define floors, tables, kitchen stations (slot and batch types), and menus with cook times, serve modes, and pre-cooked stock
- Accept orders for dine-in, takeaway, parking, and delivery; calculate per-item ETAs from a deterministic timing engine before the order taker submits
- Lock tables while order takers are working; prevent concurrent edits to the same table
- Dispatch hold-and-fire events to kitchen display screens and thermal printers; coordinate sync items so they land at the table together
- Warn waiters before an order slips past its promise; surface "X min late" on customer-facing pages without silently changing the original time
- Enforce role-based void and approval workflows with an item lifecycle state machine (five stages)
- Take cash, card (manual entry), and mixed-split payments; produce tax-compliant receipts
- Manage cashier shifts: float, petty cash, blind cash count, and shift variance; aggregate into a day-close Z report (D21)
- Provide a read-only remote owner view with sales, voids, discounts, payment method breakdown, sync status, and backup time — per branch and combined (D22)
- Run fully offline on local WiFi; sync events to cloud when internet returns
- Recover from a power cut in ≤ 90 seconds with no manual action (D24)
- Log every sensitive action in an immutable append-only audit trail
- Serve multiple branches of one tenant (P1 pilot: 3 branches of Arif Chatkhara)

---

## §3. Critical decisions and authority model

### 3.1 Authority table

| Domain | Single authority | Hub owns (live) | Cloud owns (canonical) | Must NEVER |
|--------|-----------------|-----------------|----------------------|------------|
| Live orders, ETAs, item stages | Hub (per branch) | Open orders, stage transitions, fire schedules, ETA state | Historical order records (replicated from events) | Cloud override live hub order state |
| Table locks | Hub (per branch) | Lock state, opener identity, last activity; auto-release on session expiry or lock TTL (D51) | (ephemeral; logged to audit) | Cloud release or create a table lock |
| Station queues and engine state | Hub (per branch) | Queue state, fire schedule, `EngineState` projection | (none) | Cloud dispatch `FireNow` events to a station |
| Live station capacity | Hub (per branch) | `capacityOverride` per station (manager setting, works offline — D37); capacity change is a recalculation trigger | (none) | Cloud modify live station capacity |
| Pre-cooked stock (D50) | Hub (per branch) | One stock projection derived from `StockSet` / `StockReserved` / `StockReleased` events; no separate stock table | Daily stock-setting history (from synced events) | Cloud decrement live stock; any hub code change a stock count except by appending one of those events |
| Print queue | Hub (per branch) | Queue, sent/acked state, reprint flags | (none) | Cloud add to or clear the print queue |
| Menu catalog | Cloud | Cached copy (read-only; refreshed on push) | Canonical menu, prices, station routes, combos | Hub write to the menu catalog |
| Item availability, live overrides | Hub (per branch) | Toggle per item (available/unavailable), live pre-cooked stock, scheduled overrides in effect | (availability events synced to cloud) | Cloud directly flip availability state on a live hub |
| Roles and permissions | Cloud | Cached copy (refreshed on push) | Canonical role definitions and staff-role assignments | Hub modify role definitions |
| Events | Shared | All events for its branch (INSERT-only); `sync_cursor.last_acked_seq` (D52) | All events for all branches (replicated) | Anyone UPDATE or DELETE an event row, hub or cloud |
| Staff PINs (D40) | Cloud | Cached argon2id hashes pushed from cloud, for offline PIN verification | Canonical argon2id hashes; PIN set and reset (requires internet — P1 limitation) | Hub create or modify a PIN hash; anyone store or transmit a plaintext PIN beyond the setting device |
| Cashier shift records | Hub (primary), Cloud (replica) | Live shift state, drawer amounts | Aggregated shift history | Anyone edit a closed shift record |
| Audit log | Hub (primary), Cloud (replica) | All audit entries for its branch | Aggregate across branches | Anyone delete or modify any audit entry |

### 3.2 Multi-tenancy

Every persistent record carries `tenant_id` (subscription / restaurant group) and `branch_id` (physical location). The P1 pilot: one tenant (`arif-chatkhara`), three branch IDs. The hub process knows its `branch_id` from a startup config file and refuses all requests for other branches. Cloud APIs enforce both dimensions via JWT claims resolved from PostgreSQL.

### 3.3 Menu and config push

Menu items, station configs, and role definitions are canonical on the cloud. The hub caches them in SQLite. On change, the cloud adds a record to `hub_push_queue`; the hub fetches it on the next sync poll and hot-reloads in-memory state. If the hub is offline, the change queues and applies on reconnect.

**Config snapshot (D25):** every `OrderPlaced` event snapshots the config values for every item in the order — cook time, station, serve mode, prep buffer, batch `program_id` / `stock_program_id` (D49), `price_minor` (D47), tax class — into the event payload. Those snapshotted values are the source of truth for that order's ETA and billing for its entire lifetime. Any subsequent menu change applies only to future orders. There is no conflict rule blocking menu edits while open orders exist.

### 3.4 Mandatory tenant scoping (D30, D54)

Every cloud route that reads or writes tenant data is tenant-scoped from P1: the pilot already has three branches, and P3 adds paying tenants to the same database. D54 makes scoping **mechanical**, so it does not rely on code review:

1. **Default-on guard.** The cloud registers a root `onRoute` hook that attaches the tenant-scope `preHandler` to **every** route. The guard resolves `tenant_id` and `branch_id` from the authenticated JWT claims (owner routes) or the branch API key (sync routes) and puts a frozen `TenantContext` on the request. A route opts out only by declaring `config: { tenantScope: 'none' }`; the only routes allowed to opt out are listed in one allowlist file (`/auth/login`, `/auth/refresh`, `/health`).
2. **Repository base class.** All data access goes through subclasses of `TenantScopedRepository`, whose constructor requires a `TenantContext`. Its query helpers always add `tenant_id = $1 AND branch_id = ANY($2)` to every WHERE clause. The raw database client is not exported from the data-access module, and a lint rule (`no-restricted-imports`) blocks importing it anywhere else.
3. **Tests that fail on a gap.** (a) A route-inventory test boots the app, collects every registered route through `onRoute`, and fails if any route lacks the guard and is not in the allowlist. (b) A repository test asserts that constructing a repository without a `TenantContext` throws. (c) A cross-tenant test calls every scoped route with tenant A's token and asserts that no tenant B row is ever returned.

### 3.5 Tax-authority integration (D9, D58)

D9 keeps all tax-authority transmission out of P1. D58 adds one conditional exception: **PRA (Punjab Revenue Authority) e-IMS integration is a P1 blocker if the pilot restaurant is required to issue PRA-integrated invoices** (OQ15).

What was checked (2026-10-23, secondary sources only; no PRA primary notice was found online, so it must be confirmed in OQ15):
- In late 2024 Punjab announced a phased integration of PRA's electronic invoice monitoring system (e-IMS) with restaurant POS systems, restaurants first. PRA reported about 2,500 restaurants registered and about 300 sales points integrated in that fiscal year.
- POS vendors describe the integration as mandatory for registered restaurants under the Punjab Sales Tax on Services Act 2012. Each invoice is posted to PRA and the receipt carries a PRA invoice number and a QR code that customers can verify in PRA's app.

Foundation impact, whatever the answer: bill close produces an `InvoiceIssued` event with integer-minor amounts (D47) and tax breakdown. If PRA is in P1, a hub-side **fiscal queue** (same shape as the print queue: durable, retried, acked) posts invoices to PRA when internet is available. Whether the receipt must wait for PRA's invoice number (online-only bill close) or may print first and post later decides the offline behaviour; that is part of OQ15 and is specified in the Billing spec.

### 3.6 P1 basic remote owner view (D22)

The cloud exposes a read-only REST + WebSocket endpoint for the owner. It shows, per branch and combined:

- Sales total, order count, breakdown by payment method
- Void count and total value, discount count and total value
- Hub sync status (last synced event seq and timestamp)
- Last successful cloud backup timestamp

This is populated entirely from cloud projections derived from synced events. It does not hit any hub directly. Full analytics (promised vs actual, rush replay, leakage alerts) remain P2.

---

## §4. Domain rules and state machines

### 4.1 Event model

Every state mutation is an event, including mutations the fire scheduler makes on its own tick (D44). Events are appended only; no event row is ever updated or deleted, and the hub enforces this mechanically (D52). Projections are derived from events and are always rebuildable. This satisfies the "everything is an event" core principle and D24's recovery requirement.

**Event envelope — Zod schema in `@pos/events`:**

```typescript
const PosEventSchema = z.object({
  event_id:    z.string(),            // ULID; globally unique
  tenant_id:   z.string(),
  branch_id:   z.string(),
  stream_type: z.enum([               // aggregate type
    'order', 'table', 'station', 'stock',
    'shift', 'audit', 'hub', 'staff',
  ]),
  stream_id:   z.string(),            // aggregate ID within stream_type
  event_type:  z.string(),            // e.g. "OrderPlaced", "ItemVoided"
  schema_version: z.number().int().positive(), // payload version for this event_type (D46)
  payload:     z.record(z.unknown()), // typed per event_type in the discriminated union
  occurred_at: z.number().int(),      // Unix ms — device clock (what happened)
  recorded_at: z.number().int(),      // Unix ms — hub clock (when hub committed)
  actor_id:    z.string().nullable(), // staff member ID; null for system/engine events
  device_id:   z.string(),
  seq:         z.number().int(),      // hub-assigned monotone counter per branch
});
```

`seq` is the sync position: gap-free and increasing per branch. The hub records how far the cloud has acknowledged in `sync_cursor` (§5.5, D52) and never marks the event rows themselves.

**Schema versioning (D46):** every event carries the `schema_version` of its payload. Stored events are never rewritten. When a payload shape changes, the new version gets a new Zod schema and an **upcaster** in `@pos/events`: a pure function `vN → vN+1`. Upcasters are chained so that any stored version reads as the latest one. Upcasting runs on read (hub replay, `applyEvent`, cloud sync ingest), so the engine and projections only ever see the latest version. A version may only add fields with defaults or rename or split fields; a change that cannot be expressed as a pure upcast must be a new `event_type`. Each upcaster ships with a fixture test: a stored v1 payload upcast to latest equals the expected value.

**Money (D47):** every monetary amount everywhere (event payloads, command payloads, SQLite, PostgreSQL, API bodies) is an **integer count of minor currency units** (paisa for PKR). Field names end in `_minor` (e.g. `price_minor`, `tax_minor`, `total_minor`). The Zod type is `z.number().int()`; the column type is `INTEGER` in SQLite and `BIGINT` in PostgreSQL. Floats and decimal strings are never used for money. The currency is set per tenant (ISO 4217 code, `PKR` for the pilot). Tax and split calculations multiply in integers and round once, at a point the Billing spec defines, using the restaurant's configured rounding method (E8). Display formatting happens only in the client.

**Command schema — Zod schema in `@pos/events` (D32):**

```typescript
const PosCommandSchema = z.object({
  command_id:   z.string(),            // ULID; device-generated; idempotency key (D32)
  tenant_id:    z.string(),
  branch_id:    z.string(),
  command_type: z.string(),            // e.g. "SubmitOrder", "VoidItem"
  payload:      z.record(z.unknown()), // typed per command_type
  occurred_at:  z.number().int(),      // Unix ms — device clock
  actor_id:     z.string().nullable(),
  device_id:    z.string(),
});
```

**Hub event store (SQLite — hub app):**

```sql
CREATE TABLE events (
  event_id    TEXT    PRIMARY KEY,
  tenant_id   TEXT    NOT NULL,
  branch_id   TEXT    NOT NULL,
  stream_type TEXT    NOT NULL,
  stream_id   TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  schema_version INTEGER NOT NULL,  -- D46
  payload     TEXT    NOT NULL,   -- JSON
  occurred_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  actor_id    TEXT,
  device_id   TEXT    NOT NULL,
  seq         INTEGER NOT NULL
);

-- Indexes
CREATE UNIQUE INDEX events_branch_seq ON events (branch_id, seq);
CREATE        INDEX events_stream      ON events (stream_type, stream_id, seq);

-- Immutability (D52): event rows can never be changed or removed
CREATE TRIGGER events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;

-- Sync position (D52): the only mutable sync state; one row per branch
CREATE TABLE sync_cursor (
  branch_id       TEXT    PRIMARY KEY,
  last_acked_seq  INTEGER NOT NULL DEFAULT 0,  -- highest seq the cloud has confirmed
  cloud_offset_ms INTEGER,                     -- cloud_now − branchNow at last sync (D48)
  updated_at      INTEGER NOT NULL
);

-- Command idempotency store (D32)
-- Written atomically with every event INSERT; stores the response for replay on retransmit.
CREATE TABLE processed_commands (
  command_id    TEXT    PRIMARY KEY,  -- device-generated ULID
  branch_id     TEXT    NOT NULL,
  response_json TEXT    NOT NULL,     -- JSON-serialised HTTP response body
  recorded_at   INTEGER NOT NULL      -- Unix ms
);
CREATE INDEX processed_commands_branch ON processed_commands (branch_id, recorded_at);
```

**Durability contract:** every event INSERT runs inside `BEGIN IMMEDIATE`. The transaction is committed with `PRAGMA synchronous = FULL` and `PRAGMA journal_mode = WAL`. The device receives an HTTP 200 ack only after `stmt.run()` returns without error. Every command carries a device-generated `command_id` (ULID); the hub writes the response to `processed_commands` atomically with the event INSERT in the same transaction (D32). Devices must resend any unacknowledged command on reconnect; the hub returns the stored response for a repeated `command_id` without writing new events.

**Idempotency check placement (D32):** the hub looks up `command_id` twice. The first lookup runs before `BEGIN IMMEDIATE` as a fast path. The second runs **inside** the transaction, right after `BEGIN IMMEDIATE` and before any precondition check. Two retransmits of the same command can both miss the first lookup; the single-writer lock makes the in-transaction re-check authoritative. If the re-check finds the row, the hub runs `ROLLBACK` and returns the stored response. The `processed_commands.command_id` primary key is the final backstop.

**Retention (D32):** a daily hub job deletes `processed_commands` rows older than 7 days (`DELETE FROM processed_commands WHERE branch_id = ? AND recorded_at < branchNow − 7 d`, served by `processed_commands_branch`). Seven days is far longer than any device-to-hub outage on the branch LAN. A command retransmitted after its row is pruned is treated as new.

### 4.2 Item lifecycle state machine (D10, D18)

```
                ┌──────────────────────────────┐
                │  Item added to order          │
                └──────────────┬───────────────┘
                               │
           ┌───────────────────▼───────────────────────┐
           │            stage 1: ADDED                  │
           │         (cooking not started)              │─── remove (adder; no approval needed)
           └───────────────────┬───────────────────────┘     └─ reserved pre-cooked stock
                               │                                released to pool (D18)
                               │  ItemStarted (Start tap, or inferred per the
                               │  station's completion_mode — D43)
                               │  FireNow does NOT advance stage — D29
           ┌───────────────────▼───────────────────────┐
           │            stage 2: COOKING               │─── void (role: void-item)
           │                                           │     → ready stock or wastage; reason required (D29)
           │                                           │─── move-to-stock (role: move-item-to-stock)
           └───────────────────┬───────────────────────┘     └─ goes to ready-stock pool (D18/D29)
                               │  Done tap
           ┌───────────────────▼───────────────────────┐
           │            stage 3: COOKED                │─── move-to-stock (role: move-item-to-stock)
           │          (not yet served)                 │     └─ enters ready-stock pool for reassignment
           └───────────────────┬───────────────────────┘
                               │  runner delivers / waiter marks served
           ┌───────────────────▼───────────────────────┐
           │            stage 4: SERVED                │─── mark-returned (role: mark-item-returned)
           │                                           │     └─ reason required → wastage or staff-meal log
           │                                           │─── resell (owner-enabled flag; default OFF)
           └───────────────────────────────────────────┘     └─ creates a ready-stock item (not stage-1; Group C)

Each transition emits its own fact event (naming rule §6.6, D59): ItemStarted,
ItemDone, ItemServed, ItemRemoved (stage 1), ItemVoided, ItemMovedToStock,
ItemReturned, ItemResold. Each carries: item_id, previous_stage, next_stage,
actor_id (null when source = 'inferred', D43), and reason (required at stages 2+).
```

Guard: before accepting a stage transition, the hub reads the item's current stage from the projection. If the current stage does not match the expected previous stage the command is rejected with `ITEM_WRONG_STAGE`.

### 4.3 Table state machine (D5)

```
  ┌─────────┐                                          ┌──────────────────────┐
  │  FREE   │──── staff seats customer ──────────────►│      SEATED          │
  └─────────┘                                          └──────────┬───────────┘
       ▲                                                          │
       │                                               order taker opens table
       │                                           (fires TableLocked event)
       │                                                          │
       │                                          ┌──────────────▼───────────────┐
       │                                          │  LOCKED (overlay on any       │
       │                                          │  state from SEATED onward)    │
       │                                          │  released by: close action,   │
       │                                          │  manager force-release        │
       │                                          └──────────────┬───────────────┘
       │                                                         │ order submit
       │                                          ┌──────────────▼───────────────┐
       │                                          │         ORDERED              │
       │                                          └──────────────┬───────────────┘
       │                                                         │ first item served (D31)
       │                                          ┌──────────────▼───────────────┐
       │                                          │       FOOD_ON_TABLE          │
       │                                          └──────────────┬───────────────┘
       │                                                         │ customer requests bill
       │                                          ┌──────────────▼───────────────┐
       │                                          │       BILL_REQUESTED         │
       │                                          └──────────────┬───────────────┘
       │                                                         │ payment closed
       │                                          ┌──────────────▼───────────────┐
       └──────────────── cleaned ─────────────────│      NEEDS_CLEANING          │
                                                  └──────────────────────────────┘
```

Lock is a separate projection (`table_locks` table), not embedded in the state machine, so state and lock can be queried independently. Conflict prevention: the hub's SQLite single-writer serialises all `TableOpened` commands. The second actor receives `TABLE_ALREADY_LOCKED` with the locker's name.

**Lock scope (D39):** LOCKED restricts only creating and editing orders on the table. The following actions do not require holding the lock and proceed with only the relevant role permission: marking items served, requesting the bill, closing the bill, and marking the table as needing cleaning. This ensures a waiter holding the lock cannot block service or checkout actions by other staff.

**Lock auto-release (D51):** a lock belongs to the holder's **session**, not only the staff member. It is released automatically, with a `TableLockReleased` event (written by the fire-scheduler tick, D44) and the table colour updated on every device, when either:
- **Session ends:** the holding session logs out or passes its idle TTL (§5.7; 5 min default for order takers). `reason: 'session_expired'`.
- **Lock TTL:** `branchNow − lastActivityAt > table_lock_ttl_ms` (configurable per branch, default 10 min). `lastActivityAt` is refreshed by every command the holder sends for that table, including `TouchTableLock` (below). This covers a session kept alive by activity on another table. `reason: 'lock_ttl'`.

**Keeping the lock while building (D61):** BUILDING is device-local (§4.4), so a waiter who takes 10+ minutes over a large order sends no commands and would lose the lock. While the order screen for a locked table is open, the device sends `TouchTableLock { table_id }` at most **once per minute**. The hub:
1. checks that the caller's session holds the lock (otherwise `TABLE_LOCK_NOT_HELD`, 409);
2. if the last `TableLockTouched` for this lock is less than 50 s old, returns success **without writing**. This is the server-side rate limit, so a misbehaving client cannot flood the log;
3. otherwise writes `TableLockTouched { table_id, session_id }`; `applyEvent` sets `lastActivityAt`.

The lock state still changes only through events (D44). Volume is bounded at 1 event per open order screen per minute (≤ 600/hour for a 10-device branch). The touch also counts as session activity, so it keeps the idle session alive while the order screen is open.

Unsubmitted order edits live only on the device (BUILDING, §4.4) and survive the release. On the holder's next submit the hub re-checks the lock. If the table is free, the submit re-acquires the lock in the same transaction; if another actor now holds it, the hub returns `TABLE_ALREADY_LOCKED` with that actor's name. Manager force-release is unchanged and still audited.

### 4.4 Order state machine

```
  BUILDING ──submit──► OPEN ──all sync items cooked──► READY ──served──► SERVED
                         │                                                    │
                         └──── bill close (either state) ───────────────────►┘
                                                                              │
                                                                           BILLED
  Any state before BILLED:
    ──all items voided──► CANCELLED
```

BUILDING is local state on the device only (no events sent). OPEN begins with the first `OrderPlaced` event. BILLED is set by `BillClosed`.

### 4.5 Void approval state machine (D11)

```
  ┌─────────────┐  void requested   ┌────────────────┐
  │   (none)    │──────────────────►│    PENDING     │
  └─────────────┘                   └───────┬────────┘
                                            │
                        ┌───────────────────┼─────────────────┐
                        │                   │                 │
               approve             reject            timeout override
          (role: approve-void)               (manager; rule must be ON)
                        │                   │                 │
                 ┌──────▼──┐        ┌───────▼──┐    ┌────────▼──┐
                 │APPROVED │        │ REJECTED │    │OVERRIDDEN │
                 └─────────┘        └──────────┘    └───────────┘
```

A PENDING void: excluded from bill total; blocks table close; sends urgent push to all `approve-void` holders. APPROVED: item removed from bill. REJECTED: item reinstated at full price; waiter notified. OVERRIDDEN: bill closeable; manager + reason logged; configurable rule must be explicitly ON (default OFF).

### 4.6 Cashier shift model (D21)

A **shift** belongs to one cashier and covers a contiguous period at the drawer. A **day** aggregates all shifts for a branch. Shifts and days are independent of calendar time; a shift can span midnight.

```
  Shift lifecycle:
  ┌──────────────┐  cashier opens   ┌────────────┐  cashier blind-counts  ┌────────────┐
  │   (none)     │─────────────────►│    OPEN    │───────────────────────►│   CLOSED   │
  └──────────────┘                  └────────────┘                        └────────────┘

  Day lifecycle:
    Day open → one or more shifts open and close → day close
    Day close is blocked until all shifts for the day are CLOSED.
    Day-close Z report: sum of all closed shifts' floats, sales, voids, discounts,
    petty cash, and cash variances.
```

Each shift has: opening float, petty cash entries (with reasons), all payment transactions, a blind counted amount (entered before expected total is revealed), and the resulting variance.

### 4.7 Timing engine model (D13, D14, D16, D17, D23, D27, D33–D37, D42–D45, D48–D50)

`@pos/engine` is a pure TypeScript package — no I/O, no timers, no Node.js APIs. It is the only place that computes ETAs and fire schedules. It exports:

```typescript
// Rebuild full state from scratch (on hub startup)
function buildEngineState(events: PosEvent[]): EngineState

// Incremental update (on each new event)
function applyEvent(state: EngineState, event: PosEvent): EngineState

// Query: ETA for a set of items being added to an order (preview, no mutation)
function calculateETA(
  state: EngineState,
  items: ProposedItem[],        // item config + serve mode
  branchNow: number,            // current hub clock ms
): ETAResult[]

// Query: everything the fire-scheduler tick must record right now (D44).
// Pure: returns intents only. The hub turns each intent into an event,
// commits it, then applies it with applyEvent (D45).
function getTickIntents(
  state: EngineState,
  branchNow: number,
): TickIntent[]

type TickIntent =
  | { kind: 'FireDispatched';      itemIds: OrderItemId[]; loadId: string | null;
                                   stationId: StationId; dueAt: number }
  | { kind: 'ReservationsShifted'; stationId: StationId; cause: 'overrun' | 'late_start';
                                   shifts: Array<{ itemId: OrderItemId; byMs: number }> }
  | { kind: 'SlipWarned';          orderId: OrderId; estimatedLandTime: number;
                                   originalPromise: number }
  | { kind: 'TableLockReleased';   tableId: TableId;
                                   reason: 'session_expired' | 'lock_ttl' }   // D51
  | { kind: 'ItemStarted';         itemId: OrderItemId; startedAt: number;
                                   source: 'inferred' }                       // single_tap (D60)
  | { kind: 'ItemDone';            itemId: OrderItemId; doneAt: number;
                                   source: 'inferred' }                       // auto_done (D60)
```

**Inferred completion facts (D60):** all intents from one tick are written in **one** transaction (D44). On a `single_tap` station, `getTickIntents` returns an `ItemStarted { source: 'inferred', startedAt: dueAt }` right after each `FireDispatched` for that station. The two events commit together, so an item is never fired without being started. On an `auto_done` station, `getTickIntents` returns `ItemDone { source: 'inferred', doneAt }` once `branchNow ≥ startedAt + prep_buffer_ms + cook_time_ms` and no tapped Done exists. A tapped Done that arrives later is rejected with `ITEM_WRONG_STAGE` (normal stage guard, §4.2).

**Tick mutations are events (D44):** the engine state changes **only** through `applyEvent`. The fire scheduler (§5.2, every 500 ms) calls `getTickIntents`, writes one event per intent (`FireDispatched`, `ReservationsShifted`, `SlipWarned`, `TableLockReleased`) in a single `BEGIN IMMEDIATE` transaction, commits it, then applies the events (D45). Consequences:

- **No re-fire on restart.** `applyEvent(FireDispatched)` sets `firedAt` on the item or load. `getTickIntents` never returns a `FireDispatched` for an item or load whose `firedAt` is set. Replay restores `firedAt`, so a fire dispatched before a power cut is not dispatched again. Its kitchen ticket is recovered by the print queue (reprint), not by a new fire.
- **No repeated slip warnings.** `applyEvent(SlipWarned)` stores `lastSlipWarnedEstimate` on the order. A new `SlipWarned` is produced only when the estimated land time has grown by at least another `slip_threshold_ms` since the last warning.
- **Bounded shift volume.** An overrun grows continuously, so cascade shifts (D42) are quantised to `cascade_step_ms` (default 60 000): each shift is rounded up to a whole step, and a five-minute overrun produces about five `ReservationsShifted` events, not one every tick.
- Replay of the event log alone rebuilds exactly the state the live hub had. Nothing is derived from wall-clock time during replay.

**Branch clock (`branchNow`):** the engine never reads a clock; the hub passes `branchNow` into every engine call. The hub derives it once per process from a boot wall-clock reading plus monotonic elapsed time:

```typescript
// captured once at hub process start, after replay (§5.8 step 3a)
const lastRecordedAt = maxRecordedAtInEventLog();      // 0 on first ever start
const wall           = Date.now();
if (wall <= lastRecordedAt) emitClockAlarm(wall, lastRecordedAt);  // D48
const bootWallMs = Math.max(wall, lastRecordedAt + 1);  // never earlier than the log
const bootMonoMs = performance.now();

// every engine call, fire-scheduler tick and recorded_at stamp
const branchNow = () => bootWallMs + (performance.now() - bootMonoMs);
```

`branchNow` is therefore Unix ms that never jumps backwards or forwards while the hub runs, even if the OS wall clock is stepped. The hub OS runs NTP (chrony) in **slew** mode once booted; it is never stepped while the hub runs, so `branchNow` and the OS wall clock stay within NTP drift of each other. Every `now` in §4.7, §5.8 and §5.9 means `branchNow`. Event `recorded_at` is stamped with `branchNow`; `occurred_at` stays the device wall clock (Group C).

**Clock guard (D48):** `branchNow` must never be earlier than the newest `recorded_at` already in the log. A dead RTC battery or an unsynced boot can make the OS clock start in the past.
- **At boot:** if `Date.now() ≤ max(recorded_at)`, the hub writes a `ClockAlarm` audit event `{ wall_ms, last_recorded_at, delta_ms, source: 'boot' }`, shows a red banner on the admin UI and every KDS, and starts `branchNow` at `max(recorded_at) + 1` (code above), so `recorded_at` and `seq` order stay consistent. Service continues: ETAs are relative and stay correct; only absolute clock times shown to people are wrong until NTP corrects them and the hub restarts during a quiet period.
- **At each sync:** the cloud returns `cloud_now` in every sync response. The hub stores `cloud_offset_ms = cloud_now − branchNow` (taken at the request midpoint) in `sync_cursor` (§4.1). If `|cloud_offset_ms| > clock_alarm_threshold_ms` (default 60 000), the hub writes a `ClockAlarm` event with `source: 'cloud_offset'`, at most once per hour while the condition holds. The cloud keeps the latest offset per branch for report correction; the hub never corrects its own clock from it.
- **Installation:** the RTC (CMOS) battery is checked and replaced on install (§5.8 installation checklist).

**Station types (D13):**

```
Slot station   capacity = N concurrent items
               A new item may start only when a slot is free for its entire cook duration.
               Station time covers the cook interval only; prep buffer happens off-station (D35).

Batch station  capacity = M items per load
               All items in a load start and finish together and run one cook
               program (D49): a load only contains items with the same program_id.
               Fire rule: never past the latest-start of the earliest-deadline item.
               freshness_window = 0 → only the earliest-deadline item's load fires;
               no other items pulled in (D17).
```

**ETA formula — slot station (D4, D27, D35):**

`start_at` is the earliest moment where the item's cook interval (excluding prep) fits within station capacity:

```
start_at = earliest t ≥ now such that for every instant s in [t + prep_buffer_ms, t + prep_buffer_ms + effective_cook_time_ms):
             count({ r in reservations | r.startsAt ≤ s < r.endsAt }) < capacity
ETA(item) = start_at + prep_buffer_ms + effective_cook_time_ms
Station reservation written: { startsAt: start_at + prep_buffer_ms, endsAt: ETA(item) }
```

The cook interval `[t + prep_buffer_ms, ETA)` is what occupies the station; prep happens off-station and does not block other items (D35). Checking the entire cook interval prevents a long item from being slotted into a gap that looks free at its start instant but closes before it would finish.

**ETA formula — batch station (D4, D14, D17, D27, D34, D49):**

```
candidate = first batch b where:
              b.startsAt > now                                           // batch not yet fired (D34)
              AND b.programId = item.programId                           // compatible load (D49)
              AND |b.items| < capacity                                   // room in batch
              AND b.endsAt ≤ item.target_land_time                       // item not ready late
              AND item.target_land_time − b.endsAt ≤ freshnessWindowMs   // not too early
if candidate:
  ETA(item) = candidate.endsAt
else:
  // new load: prep happens off-station (D35), so the load can start once prep is done
  // AND the station is free
  station_free_at = max(r.live_endsAt for r in reservations)     // now if no reservations
  load_start      = max(now + prep_buffer_ms, station_free_at)
  ETA(item)       = load_start + effective_cook_time_ms
  // new load reservation: { startsAt: load_start, endsAt: ETA(item) }

effective_cook_time_ms = stock_time_ms      if pre-cooked stock > 0
                       = full_cook_time_ms  otherwise
// At a batch station the cook time belongs to the program, not the item:
// effective_cook_time_ms = programs[item.programId].cookTimeMs, where
// item.programId = item.stock_program_id if pre-cooked stock > 0, else item.program_id (D49).
```

**Load compatibility (D49):** a batch station defines one or more **cook programs** (e.g. fryer at 180 °C for 6 min; reheat for 2 min). Each item routed to a batch station carries a `program_id`, and optionally a `stock_program_id` for reheating pre-cooked stock; both are snapshotted into `OrderPlaced` (D25). A load runs exactly one program: its `cookTimeMs` is the program's, and only items with the same `program_id` can join it. Items with different programs are never mixed in one load, even when capacity is free.

The `b.startsAt > now` guard prevents adding items to a batch that has already fired (D34). For immediate items at a batch station: join the earliest not-yet-fired load with room (`b.startsAt > now AND |b.items| < capacity`); if none exists, create a new load (Group C). The two freshness conditions express opposite bounds: `b.endsAt ≤ target_land_time` prevents a late delivery; `target_land_time − b.endsAt ≤ freshnessWindowMs` prevents the item sitting cold. When `freshnessWindowMs = 0` these collapse to `b.endsAt = target_land_time`; only an exact-match batch qualifies.

**Completion facts and tap dependency (D43):**

The engine never reads taps directly. It consumes two facts per item: `ItemStarted { item_id, started_at, source }` and `ItemDone { item_id, done_at, source }`, where `source: 'tap' | 'inferred'`. Each station has a `completion_mode` that decides which facts the hub infers:

| `completion_mode` | Start | Done | Effect |
|---|---|---|---|
| `two_tap` (design default) | tapped | tapped | Full overrun detection (D33, D42), hold at pass |
| `single_tap` | inferred when `FireDispatched` is committed (`started_at = dispatch time`) | tapped | Overrun detection from dispatch time; no late-start detection. Overrides D29 for this station only. Replaces the KDS "skip-start" option |
| `auto_done` | tapped | inferred at `started_at + prep + cook` unless tapped earlier | No overrun can occur (`live_endsAt = planned_endsAt`); cascade never triggers; hold at pass releases on the inferred Done |

What depends on the tap-rate field test (§9, OQ4): only **overrun handling** (D33 live end, late-start shift, D42 cascade) and **hold at pass**. These read only the completion facts above, so switching a station between modes is a config change with no engine code change. The engine core (slot and batch ETA, reservation timeline, hold-and-fire, D34–D37, D49) does not depend on taps and can be coded now. The field test result sets the default `completion_mode` per station type.

**Overrun handling (D33):**

An item **overruns** when it is still COOKING past its planned station `endsAt`. The engine tracks a live end time:

```
// While item is in stage COOKING:
live_endsAt(item) = max(planned_endsAt, now)
```

The item's station occupancy extends in real time; any subsequent item on the same station must wait for `live_endsAt`.

**Late Start:** if Start is tapped after `latest_start` (`actualStartAt > latest_start`), the reservation shifts to the actual cook interval:

```
reservation = {
  startsAt: actualStartAt + prep_buffer_ms,
  endsAt:   actualStartAt + prep_buffer_ms + cook_time_ms,
}
```

**Estimated land time** (used for slip warnings and recalculation triggers — D33, D6):

```
// Item in stage COOKING (Start already tapped):
estimated_land_time = actualStartAt + prep_buffer_ms + cook_time_ms

// Item in stage ADDED, already past its latest_start (overdue to start):
estimated_land_time = now + prep_buffer_ms + cook_time_ms

// Item in stage ADDED, still on schedule (now ≤ latest_start):
estimated_land_time = target_land_time   // unchanged
```

A slip warning fires when `estimated_land_time > original_promise + slip_threshold_ms` (configurable, default 5 min).

**Overrun and late-start cascade (D42):**

An overrun (`live_endsAt` growing past `planned_endsAt`) or a late Start (reservation shifted to the actual cook interval) can push one reservation into the next on the same station. The engine resolves this by cascading down that station's timeline:

```
// Computed, never applied in place (D44):
//   overrun    → getTickIntents returns a ReservationsShifted intent (cause 'overrun')
//   late Start → the Start command handler writes ItemStarted + ReservationsShifted
//                (cause 'late_start') in the same transaction
// For the affected station only. Deterministic given (state, branchNow).
for each reservation r on the station whose items are all still ADDED (fired or not), in startsAt order:
  if r overlaps capacity given the live intervals of all earlier reservations:
    needed = smallest delay so that [r.startsAt + needed, r.endsAt + needed) fits
    shift  = ceil(needed / cascade_step_ms) × cascade_step_ms   // quantised (D44)
    add { itemId: r.itemId, byMs: shift } to the intent
    (later reservations are checked against r's shifted interval)

// applyEvent(ReservationsShifted), for each shift:
//   r.startsAt += byMs; r.endsAt += byMs
//   item(r).latestStartAt += byMs          // unfired: FireNow moves later with it
//   item(r).estimated_land_time = r.endsAt  // fired: firedAt stays set, no second fire;
//                                           // KDS shows the new start time on the ticket
// COOKING items are never shifted; their live_endsAt already reflects reality.
// Batch station: same rule applied to whole loads not yet started (a load never overlaps the previous one).
```

- The cascade stays on the overrunning station. Reservations on other stations, including sync siblings of displaced items, do **not** move.
- An order's `target_land_time` does **not** change (D6, D23): the original promise is kept and lateness is shown as a slip. A slip warning goes to each affected order whose `estimated_land_time > original_promise + slip_threshold_ms`.
- Sync siblings that finish on their original schedule wait at the pass (see **KDS hold at pass** below).

**Hold-and-fire (D14, D16, D23, D35, D36):**

Sync items are held at their cook interval, not dispatched at the earliest available slot. Before the sync capacity loop, **immediate items are tentatively reserved first** (D36); their station intervals count against capacity in all sync checks below.

The resolution loop makes **full passes** over all sync items. Advancing `candidate_tlt` for one item can expose a new conflict for an item already checked in the same pass; a pass is only trusted when it completes with no advancement. Termination is guaranteed because `candidate_tlt` only increases and the number of reservations is finite.

```
// 1. Tentatively reserve immediate items (D36)
for each immediate item i:
  compute start_at using slot/batch ETA formula (against existing reservations only)
  tentative[station(i)] += { startsAt: start_at + i.prep_buffer_ms, endsAt: ETA(i) }

// 2. Candidate target land time — sync items only (D16).
//    ETA(i) here is the slot/batch formula against existing reservations only;
//    tentative immediate intervals are applied in step 3.
//    Immediate items are excluded; they land at their own ETA. Their tentative
//    intervals still count against capacity in step 3 (D36).
candidate_tlt = max(ETA(i) for all sync items in order)

// 3. Capacity check — full passes. On any advancement, continue checking the
//    remaining items in this pass, then repeat full passes until one pass
//    completes with no advancement.
//    Capacity checks use: existing station reservations ∪ tentative immediate intervals (D36).
repeat:
  all_fit = true
  for each sync item i:

    if station(i) is a slot station:
      // Station interval = [candidate_tlt − cook_i, candidate_tlt) — prep excluded (D35)
      interval_start = candidate_tlt − i.cook_time_ms
      for each instant s in [interval_start, candidate_tlt):
        if count({ r in (reservations ∪ tentative) | r.startsAt ≤ s < r.endsAt }) ≥ capacity:
          candidate_tlt += smallest advance that clears this conflict
          all_fit = false
          break s-loop   // exit instant loop only; continue remaining sync items

    else:  // batch station
      // "fits" for a sync item at a batch station means one of:
      //   (a) joins existing load b: b.startsAt > now
      //                              AND b.programId = i.programId          (D49)
      //                              AND |b.items| < capacity
      //                              AND b.endsAt ≤ candidate_tlt
      //                              AND candidate_tlt − b.endsAt ≤ freshnessWindowMs
      //   (b) creates new load with station interval
      //       [candidate_tlt − program(i).cookTimeMs, candidate_tlt)       — prep excluded (D35, D49)
      //       AND candidate_tlt − program(i).cookTimeMs ≥ now + i.prep_buffer_ms   (prep done in time)
      //       AND no overlap against any existing load on that station
      if not fits:
        candidate_tlt += smallest advance to the next time (a) or (b) holds
        all_fit = false

until all_fit  // repeat the full pass if any advancement occurred

target_land_time = candidate_tlt
// Fixed at submit. Recalculated only on void, boost, stock update, or capacity change (D23, D37).

// 4. Write reservations and latest-start times
for each sync item i:
  latest_start = target_land_time − i.cook_time_ms − i.prep_buffer_ms
  write { startsAt: latest_start + i.prep_buffer_ms, endsAt: target_land_time } to station i  // slot (D35)
  — or join/create batch load ending at target_land_time                                        // batch

for each immediate item i:
  write { startsAt: start_at + i.prep_buffer_ms, endsAt: ETA(i) } to station i  // from tentative (D35)
  dispatch FireNow at start_at
```

**Intra-order collisions (D36):** when two sync items are on the same capacity-limited station, their hold intervals both end at `candidate_tlt` and always overlap. The engine serialises them: sort same-station sync items longest-cook-time-first; assign the first item the interval `[candidate_tlt − cook_A, candidate_tlt)`, then advance `candidate_tlt += cook_B` for the second item (giving it interval `[old_tlt, old_tlt + cook_B)` = `[candidate_tlt_new − cook_B, candidate_tlt_new)`). Each item gets its own individual land time; the order's `target_land_time` = the latest individual land time. The full-pass loop then checks whether the advanced `candidate_tlt` creates conflicts on other stations and repeats if so.

**KDS hold at pass (D36, D42):** when a sync item is marked Done while other sync items in the same order are not yet Done, the KDS and expo views show it as **HOLD AT PASS**: it is not sent to the table. When the last sync item in the order is Done, all of the order's sync items show as ready to run together. This covers staggered same-station items (D36) and siblings of an item delayed by a cascade (D42). Immediate items are never held.

**Live station capacity (D37):**

A manager may change a station's live capacity (`capacityOverride`) at any time from the hub admin UI. This works offline. A capacity change is a recalculation trigger (extends D23): all reservations on the affected station are rebuilt with the new effective capacity; items that can no longer fit their current slot are moved to the earliest fitting time; slip warnings are emitted for every affected order.

**Reservation lifecycle:**

| Event | Effect on reservation timeline |
|-------|-------------------------------|
| Order placed — sync item | Write `{ startsAt: latest_start + prep_buffer_ms, endsAt: target_land_time }` to station (D35) |
| Order placed — immediate item | Write `{ startsAt: start_at + prep_buffer_ms, endsAt: ETA }` to station (D35) |
| Start tapped on time | Record `actualStartAt`; no reservation change |
| Start tapped late (`actualStartAt > latest_start`, D33) | Shift reservation to `[actualStartAt + prep_buffer_ms, actualStartAt + prep_buffer_ms + cook_time_ms)`; `live_endsAt = max(planned_endsAt, now)` while COOKING |
| `FireDispatched` (D44) | Set `firedAt` on the item or load; no reservation change; it is never fired again, including after replay |
| Overrun or late Start pushes into the next reservation (D42, D44) | `ReservationsShifted` event: later not-yet-started reservations on the same station move by the quantised shift; their `latestStartAt` and estimated land time update; `target_land_time` unchanged; `SlipWarned` events for affected orders past threshold |
| Done (station reports item complete) | Set `reservation.endsAt = actual_done_time`; capacity freed from `actual_done_time` onward |
| Void (any stage before served) | Remove the item's reservation; recalculate `target_land_time` for remaining sync items in the same order (D23) |
| Boost (D3) | Re-reserve the boosted order at earliest fitting interval (starting now); displace conflicting reservations later; emit slip warnings to affected orders |
| Station capacity changed (D37) | Rebuild all station reservations with new effective capacity; emit slip warnings for displaced orders |

**Engine state shape:**

```typescript
interface EngineState {
  stations: Record<StationId, StationState>;  // slot or batch
  // The ONLY pre-cooked stock state on the hub (D50). Derived solely from
  // StockSet / StockReserved / StockReleased events; no SQL stock table exists.
  stock: Record<ItemId, number>;
  orders: Record<OrderId, {
    targetLandTime: number | null;            // fixed at submit; recalc on void/boost/stock/capacity
    lastSlipWarnedEstimate: number | null;    // set by SlipWarned (D44)
    items: Record<OrderItemId, {
      stage: ItemStage;
      serveMode: 'immediate' | 'sync';
      latestStartAt: number | null;
      etaMs: number | null;
      firedAt: number | null;                 // set by FireDispatched; never re-fired (D44)
    }>;
  }>;
  tableLocks: Record<TableId, {
    lockedBy: StaffId;
    sessionId: SessionId;                     // lock dies with the session (D51)
    lockedAt: number;
    lastActivityAt: number;                   // refreshed by every holder command on the table,
                                              // incl. TableLockTouched (D51, D61)
  } | null>;
}

interface SlotStationState {
  type: 'slot';
  capacity: number;                // from station config
  capacityOverride: number | null; // manager live override (D37); effective = capacityOverride ?? capacity
  // Sorted by startsAt. ETA search scans [t + prep, t + prep + cook) for each candidate t (D35).
  reservations: Array<{
    itemId: OrderItemId;
    orderId: OrderId;
    startsAt: number;        // ms — station occupancy start = start_at + prep_buffer_ms (D35)
    endsAt: number;          // ms — station occupancy end = ETA (both sync and immediate)
    actualStartAt: number | null;  // ms — when Start was tapped; null until stage 2 (D33)
  }>;
}

interface BatchStationState {
  type: 'batch';
  capacity: number;
  capacityOverride: number | null; // manager live override (D37)
  freshnessWindowMs: number;
  programs: Record<ProgramId, {    // load compatibility (D49)
    name: string;                  // e.g. "Fry 180 °C"
    cookTimeMs: number;            // every load of this program cooks this long
  }>;
  // Sorted by startsAt.
  reservations: Array<{
    loadId: string;         // ULID — identifies this batch
    programId: ProgramId;   // all items in the load share it (D49)
    items: OrderItemId[];
    startsAt: number;       // ms — station occupancy start; prep is off-station (D35)
    endsAt: number;         // ms — startsAt + programs[programId].cookTimeMs; updated on Done
    firedAt: number | null; // set by FireDispatched (D44)
  }>;
}
```

**Required unit tests for `@pos/engine`:**

Each test uses pure in-memory state; no I/O, no timers. All times are relative to an arbitrary epoch `T`.

| # | Test | Setup | Assert |
|---|------|-------|--------|
| 1 | Slot: future reservation blocks a long item | Capacity 1. Reservation A: `[T+10, T+30)`. Item B: `cook_time = 25 ms`, `prep_buffer = 0`. | `start_at(B) ≥ T+30`. The gap `[T+0, T+10)` is only 10 ms; `[T+0, T+25)` overlaps A, so B cannot start before T+30. |
| 2 | Hold-and-fire: single sync item lands at its slot-formula ETA (no advancement) | Capacity 1. Existing reservation `[T+5, T+20)`. Order with one sync item S, `cook_time = 20 ms`, `prep_buffer = 0`. `branchNow = T`. | Step 2: no free 20 ms interval before T+20, so `ETA(S) = T+40` and `candidate_tlt = T+40`. Step 3: S's interval `[T+20, T+40)` fits on the first pass; no advancement. `target_land_time = T+40`; `latest_start = T+20`; reservation `[T+20, T+40)` written. (Advancement in step 3 is covered by tests 5 and 7.) |
| 3 | Batch: item joins only when both freshness conditions hold | `freshnessWindowMs = 5 000`. Batch A: `endsAt = T+10 000`. Items with `target_land_time` of T+10 000, T+14 000, T+16 000. | T+10 000 joins A (exact match). T+14 000 joins A (diff = 4 000 ≤ 5 000). T+16 000 does NOT join A (diff = 6 000 > 5 000). |
| 4 | Done early frees capacity for next item | Capacity 1. Reservation A: `[T, T+20)`. Reservation B: `[T+20, T+40)`. Done event for A arrives at T+10. Item C: `cook_time = 5 ms`, added at T+11. | A's `endsAt` → T+10. `start_at(C) = T+11`; reservation `[T+11, T+16)` fits without overlapping B. |
| 5 | Hold-and-fire: advancing tlt for one item creates a new conflict for an already-checked item | Station X: capacity 1, reservation `[T+30, T+50)`. Station Y: capacity 1, reservations `[T+5, T+20)` and `[T+45, T+60)`. Two sync items: A on station X (`cook_time = 20 ms`), B on station Y (`cook_time = 20 ms`). ETA(A) = T+20, ETA(B) = T+40; initial `candidate_tlt = T+40`. Items checked B then A. | Pass 1: B's interval `[T+20, T+40)` fits; A's interval `[T+20, T+40)` overlaps `[T+30, T+50)` → tlt → T+70; `all_fit = false`. Pass 2 (repeat): B's interval `[T+50, T+70)` overlaps `[T+45, T+60)` → tlt → T+80; A's interval `[T+60, T+80)` fits; `all_fit = false`. Pass 3 (repeat): B's interval `[T+60, T+80)` fits; A's interval `[T+60, T+80)` fits. Final `target_land_time = T+80`. |
| 6 | Same-station sync items serialised (D36) | Capacity 1 slot station X, empty. Order with two sync items: A (`cook_time = 20 ms`, `prep_buffer = 0`), B (`cook_time = 15 ms`, `prep_buffer = 0`). Sorted longest-first: A then B. `branchNow = T`. | A reservation: `[T, T+20)`. B reservation: `[T+20, T+35)`. `target_land_time = T+35`. A's individual land time = T+20; B's = T+35. |
| 7 | Immediate item's tentative reservation blocks sync item on same station (D36) | Capacity 1 slot station X. Immediate item I: `prep_buffer = 0`, `cook_time = 10 ms`, tentative reservation `[T+5, T+15)`. Sync item S: `cook_time = 20 ms`, `prep_buffer = 0`. `branchNow = T`. | S's station interval `[candidate_tlt − 20, candidate_tlt)` must not overlap `[T+5, T+15)`. Earliest valid `candidate_tlt = T+35`; S's interval = `[T+15, T+35)`. |
| 8 | Overrunning item blocks next slot (D33) | Capacity 1 slot station. Item A: planned `endsAt = T+20`. `now = T+25` (A still COOKING). Item B: `cook_time = 10 ms`, `prep_buffer = 0`. | `live_endsAt(A) = T+25`. `start_at(B) ≥ T+25`; B cannot start until A's live end. B's ETA ≥ T+35. |
| 9 | Fired batch is closed to new joiners (D34) | Batch station, `freshnessWindowMs = 5 000`. Load L: `startsAt = T−5` (past), `endsAt = T+1 000`, 1 item, capacity = 3. Sync item X: `target_land_time = T+500` (within freshness window of L). | X does NOT join L (`L.startsAt ≤ now`). A new load is created for X. |
| 10 | Prep buffer does not occupy station (D35) | Capacity 1 slot station. Existing reservation R: `[T, T+8)`. Item A: `prep_buffer = 10 ms`, `cook_time = 20 ms`. `branchNow = T`. | A's station interval = `[T+10, T+30)` (prep not included). R ends at T+8 < T+10, so R does not block A. `start_at(A) = T`; ETA(A) = T+30. |
| 11 | Capacity reduction triggers recalculation (D37) | Capacity 2 slot station. Reservations: A = `[T+5, T+25)`, B = `[T+10, T+30)`. Manager sets `capacityOverride = 1`. | A and B now conflict (overlap `[T+10, T+25)` with capacity 1). Engine rebuilds: A keeps `[T+5, T+25)` (earlier); B moves to earliest fitting slot `[T+25, T+45)`. Slip warning emitted for B's order. |
| 12 | Overrun cascades down the station; promise unchanged (D42) | Capacity 1 slot station X, `completion_mode = two_tap`, `slip_threshold_ms = 3`, `cascade_step_ms = 5`. A (order O1): COOKING, planned `[T, T+20)`. B (order O2, sync, ADDED): reservation `[T+20, T+30)`, `target_land_time = T+30`. C (order O3, sync, ADDED): reservation `[T+30, T+40)`, `target_land_time = T+40`. O2 also has sync item B2 on station Y, reservation `[T+20, T+30)`. Tick at `branchNow = T+25`, A still COOKING. | `live_endsAt(A) = T+25`. B → `[T+25, T+35)`, `latestStartAt = T+25`. C → `[T+35, T+45)`, `latestStartAt = T+35`. B2 on Y unchanged `[T+20, T+30)`. `targetLandTime` of O2 = T+30 and O3 = T+40 (unchanged). Estimated land time O2 = T+35, O3 = T+45 → slip warnings for O2 and O3 (5 > 3). All of the above arrive as one `ReservationsShifted` intent plus two `SlipWarned` intents; `state` is unchanged until they are applied. |
| 13 | Replay does not re-fire (D44) | Slot station, item A `latestStartAt = T+10`. Event log: `OrderPlaced`, then `FireDispatched(A)` at T+10. Rebuild state with `buildEngineState(log)`; call `getTickIntents(state, T+60)`. Then a second log with the same `OrderPlaced` but no `FireDispatched`. | First log: no `FireDispatched` intent for A (`firedAt = T+10`). Second log: exactly one `FireDispatched` intent for A (missed fire). Calling `getTickIntents` twice on the same state returns the same intents (pure). |
| 14 | Batch loads never mix programs (D49) | Batch station, capacity 4, programs P1 (`cookTimeMs = 6 000`) and P2 (`cookTimeMs = 2 000`). Unfired load L (P1) with 1 item, `endsAt = T+10 000`. Sync item X has `program_id = P2` and `target_land_time = T+10 000`. | X does NOT join L, despite free capacity and an exact freshness match. A new P2 load is created whose station interval does not overlap L. |
| 15 | New batch load excludes prep from station time (D35, D49) | Empty batch station, program P (`cookTimeMs = 20`). Sync item X: `program_id = P`, `prep_buffer = 10`. `branchNow = T`. | ETA formula: `load_start = max(T+10, T) = T+10`; `ETA(X) = T+30`. Step 3(b): load interval `[T+10, T+30)`; `T+10 ≥ now + prep` holds. Reservation `[T+10, T+30)`, not `[T, T+30)`. |

---

## §5. Architecture

### 5.1 Monorepo layout

```
pos/
├── apps/
│   ├── hub/          Node.js 22 + Fastify 5
│   │                 SQLite event store, engine host, print queue, WS server
│   ├── cloud/        Fastify 5 + PostgreSQL (D55)
│   │                 Sync target, owner view API, menu admin, staff/roles
│   └── client/       React (TypeScript)
│                     Built once; Capacitor on Android, browser (kiosk) elsewhere (D56)
├── packages/
│   ├── domain/       @pos/domain  — TypeScript types, enums, value objects
│   ├── events/       @pos/events  — Zod schemas for every event + command type
│   └── engine/       @pos/engine  — pure timing engine (no runtime deps)
├── turbo.json
└── pnpm-workspace.yaml
```

`@pos/engine` has zero runtime dependencies and is fully unit-testable without a database or timer. The hub wraps it with I/O (reading events from SQLite, `setInterval` for fire-schedule ticks). The cloud imports it only for ETL and report validation.

### 5.2 Hub internal architecture

```
┌──────────────────────────────────── Hub process ───────────────────────────────────────┐
│                                                                                         │
│  ┌───────────────┐   ┌─────────────────────────────────────────────────────────────┐  │
│  │ HTTP/WS server│   │  Command handler                                            │  │
│  │ Fastify       │──►│  1. validate device_token + session_token                   │  │
│  │ port 3000     │   │  2. parse + Zod-validate command (@pos/events)              │  │
│  └───────────────┘   │  3. BEGIN IMMEDIATE (SQLite single writer)                  │  │
│         │            │  4. check preconditions against projections                 │  │
│         │            │  5. call @pos/engine pure function if ETA needed            │  │
│         │            │  6. INSERT events + processed_commands (seq = next val)     │  │
│         │            │  7. UPDATE projections; nextState = reduce(applyEvent)      │  │
│         │ ack only   │  8. COMMIT (synchronous=FULL); on failure: ROLLBACK,        │  │
│         │ after      │     discard nextState                                       │  │
│         │            │  9. engineState = nextState — only after COMMIT (D45)       │  │
│         │            │  10. respond HTTP 200 { data: … } to device                 │  │
│         │ commit     └─────────────────────────────────────────────────────────────┘  │
│         │                                    │ swap after commit (step 9)             │
│         │                     ┌──────────────▼─────────────────────────────────────┐  │
│         │                     │  In-memory EngineState                             │  │
│         ▼                     │  (@pos/engine — rebuilt from snapshot + replay     │  │
│  ┌──────────────┐             │   on startup per D24)                              │  │
│  │ WebSocket    │◄────────────│                                                    │  │
│  │ broadcaster  │             └────────────────────────────────────────────────────┘  │
│  │ (push events │                                                                      │
│  │  to devices) │             ┌────────────────────────────────────────────────────┐  │
│  └──────────────┘             │  Fire scheduler (setInterval 500ms)                │  │
│                               │  — getTickIntents(state, branchNow) (D44)          │  │
│  ┌──────────────┐             │  — commit events, then apply + push to KDS/print   │  │
│  │ Print queue  │◄────────────└────────────────────────────────────────────────────┘  │
│  │ (SQLite)     │                                                                      │
│  └──────────────┘             ┌────────────────────────────────────────────────────┐  │
│         │                     │  Sync agent (runs every 5 s while internet up)     │  │
│         │ ESC/POS             │  — SELECT events WHERE seq > last_acked_seq        │  │
│  ┌──────▼───────┐             │  — POST /sync/events → cloud                       │  │
│  │ Printers     │             │  — UPDATE sync_cursor on ack (D52)                 │  │
│  │ (USB/LAN)    │             │  — fetch hub_push_queue (menu/role changes)        │  │
│  └──────────────┘             └────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Cloud architecture

```
┌──────────────────────────────── AWS ap-south-1 (D57) ─────────────────────────────────┐
│                                                                                       │
│  ┌──────────────────────────────┐        ┌──────────────────────────────────────┐   │
│  │ Fastify API (Docker — D55)   │        │ PostgreSQL 16                        │   │
│  │                              │◄──────►│ — events (all branches, replicated)  │   │
│  │ POST /sync/events            │        │ — projections (owner view, reports)  │   │
│  │ GET  /owner/dashboard        │        │ — menu catalog (canonical)           │   │
│  │ WS   /owner/live             │        │ — staff, roles, permissions          │   │
│  │ POST /admin/menu             │        │ — hub_push_queue                     │   │
│  │ POST /admin/roles            │        │ — cashier_shift_aggregates           │   │
│  └──────────────────────────────┘        └──────────────────────────────────────┘   │
│                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
       ▲
       │ HTTPS (sync agent, 5 s poll when internet available)
       │
   Hub (restaurant LAN)
```

Cloud does not push to the hub in real time. Config changes travel via `hub_push_queue` and are fetched on the next sync poll.

### 5.4 Real-time transport (LAN — WS)

```
Device                                        Hub
  │                                            │
  │── ws://hub-ip:3000/ws ───────────────────►│
  │   Headers: Authorization: Bearer <device_token>
  │   Query:   ?session=<session_token>&last_seq=<N>
  │                                            │
  │◄── catch-up snapshot (all open state      │
  │     relevant to device role,              │
  │     + events seq > N)  ───────────────────│
  │                                            │
  │◄── event push (each new committed event) ─│
  │    { event_id, event_type, payload, seq }  │
  │                                            │
  │── ack: { last_seq: N } ──────────────────►│  (device acks batches)
  │                                            │
  │── reconnect (exponential backoff, max 5s) ►│  hub re-sends catch-up on reconnect
```

The catch-up on reconnect means KDS screens re-render automatically after hub restart (D24) with no manual refresh.

### 5.5 Sync protocol (hub → cloud) (D48, D52)

```
Hub                                                    Cloud
 │                                                       │
 │── POST /sync/events ─────────────────────────────►   │
 │   {                                                   │
 │     branch_id,                                        │
 │     tenant_id,                                        │
 │     from_seq: sync_cursor.last_acked_seq + 1,        │
 │     events: [ seq from_seq … from_seq+n−1, n ≤ 500 ]  │
 │   }                                                   │
 │                                                       │─ contiguity check (below)
 │                                                       │─ INSERT events
 │                                                       │  ON CONFLICT (event_id) DO NOTHING
 │                                                       │─ last_received_seq = max seq
 │                                                       │─ update projections
 │                                                       │─ return push_queue items
 │                                                       │
 │◄── { last_received_seq, cloud_now, push_queue } ─────│
 │                                                       │
 │── UPDATE sync_cursor                                  │
 │   SET last_acked_seq = last_received_seq,            │
 │       cloud_offset_ms = cloud_now − branchNow (D48)  │
 │                                                       │
 │── apply push_queue (menu/role updates)                │
```

**Immutable events (D52):** sync never writes to `events`. The only state that changes is the single `sync_cursor` row (§4.1). Pending events are `seq > last_acked_seq`, read through the `events_branch_seq` index.

**Contiguity (D52):** the cloud stores `last_received_seq` per branch and accepts a batch only when:
- the batch's seqs are contiguous (`from_seq, from_seq+1, …` with no gaps), **and**
- `from_seq ≤ last_received_seq + 1`. A batch that starts at or below `last_received_seq` is a retransmit; its overlap is dropped by `ON CONFLICT (event_id) DO NOTHING`.

Otherwise the cloud writes nothing and replies `409 { "error": { "code": "SYNC_SEQ_GAP", "details": { "last_received_seq": N } } }` (envelope §6.1). The hub then sets `last_acked_seq = min(last_acked_seq, last_received_seq)` and resends from there. A gap therefore cannot be silently skipped. Since the cloud's copy is gap-free, it is a usable source for hub restore (§5.10).

Sync is idempotent by ULID event ID and by seq. Batch size ≤ 500 events; if more are pending, the hub polls again immediately after the ack.

### 5.6 Device pairing

**First-run provisioning (D38, OQ12):** `hub:3000/setup` exists only while the hub is unprovisioned (no `branch_id` or branch API key in hub config). It is protected **by the one-time branch registration code only**: no manager PIN can exist yet, because PIN hashes reach the hub only through cloud sync (D40). The installer enters the code; the hub exchanges it with the cloud over HTTPS for the branch API key and `branch_id`, stores both, and writes a `HubProvisioned` audit event. The code is single-use and is consumed by the cloud on exchange. Once provisioned, `/setup` returns 404 permanently, and all later admin access goes through the `/admin` manager PIN session below. A registration code is either **new-branch** (creates the branch) or **replace-hub** (bound to an existing `branch_id`; starts the restore flow in §5.10, D53).

```
Setup flow (admin, LAN only):
  1. Admin opens hub:3000/admin in a browser on the LAN.
     The admin UI requires a manager PIN session (D38):
     POST /admin/auth { staff_id, pin } → { admin_session_token }
     (same argon2id verification as device PIN auth; all /admin/* requests carry X-Admin-Session header)
  2. Manager generates a pairing QR (requires "manage-devices" permission — D38):
     POST /admin/devices/pairing-token → { hub_ip, hub_port, pairing_token }
     — pairing_token: 256-bit random, single-use, 10-minute TTL
     — DevicePairingTokenGenerated event written to audit log (actor = manager)
  3. Staff member scans QR on their device (Capacitor app)
  4. Device POSTs { pairing_token, device_name, device_type }
     to hub POST /devices/pair
  5. Hub verifies pairing_token; creates device record; returns device_token
     — device_token: 256-bit random, non-expiring until explicitly revoked
     — hub stores only SHA-256(device_token) (D53: backups never hold usable tokens)
     — DevicePaired event written to audit log
  6. Device stores device_token in secure storage; uses in all future requests
  7. Manager can revoke any device from hub admin (requires "manage-devices" permission);
     device_token invalidated; DeviceRevoked event written to audit log
```

Device tokens are hub-only (never synced to cloud). A device is authenticated to the hub; a staff member is authenticated within the session on top of the device.

### 5.7 Authentication model

**LAN devices → Hub:**
- Every request: `Authorization: Bearer <device_token>` (identifies the device)
- Mutating requests additionally carry: `X-Session-Token: <session_token>` (identifies the staff actor)

**Staff → App (PIN login — D28):**
- Device sends `POST /auth/pin` with `{ staff_id, pin }` — PIN is transmitted as plaintext over the staff WiFi network (staff network is separate from the guest network; see network separation below)
- Hub verifies the PIN against a stored argon2id (preferred) or bcrypt hash; if match: returns `{ session_token, staff_id, role_ids, display_name }`
- Lockout: 5 consecutive failed attempts for the same `staff_id` lock the account for 15 minutes (configurable); lockout clearable by a manager (D28); lockout event written to audit log. Per-device rate limit (Group C): ≥ 10 failed attempts from the same `device_id` within 5 minutes triggers a 15-minute device lockout regardless of which `staff_id` attempted.
- Session token: 256-bit random, stored in hub SQLite
- Session TTL: configurable per role; default 5 minutes idle for order takers, 1 hour for managers
- Auto-logout: hub rejects session_token if idle longer than the role's configured TTL
- No internet required for PIN auth; hub is the authority for its branch's PIN store

**PIN distribution (D40):**

PIN lifecycle:
1. Owner or manager sets or resets a staff PIN in the cloud admin UI. The setting device hashes the PIN with argon2id locally before any transmission; the plaintext PIN never leaves the setting device.
2. Cloud stores the argon2id hash only.
3. On the next hub sync, the cloud pushes the new hash to every hub where the staff member is assigned; the hub stores it in the local staff table for offline verification.
4. Adding a new staff member or resetting a PIN requires an internet connection (P1 limitation). The hub cannot create or update PIN hashes on its own; it only receives hashes pushed from the cloud.

**Network separation (D28):**
- Staff WiFi (hub SSID) is physically or logically separate from the customer guest network
- The hub rejects all staff API traffic (POST /auth/pin and all write commands) that arrives from IP ranges belonging to the guest network; guest network ranges are set in hub config at installation
- Customer-facing routes (order tracking pages) are served on a separate path with no staff auth requirement

**Hub → Cloud (sync):**
- `Authorization: Bearer <branch_api_key>` — issued by cloud at branch registration; stored in hub config file

**Owner → Cloud (owner view):**
- `POST /auth/login` with email + password → cloud issues JWT (access token 1 h, refresh token 30 d)
- JWT claims include `tenant_id` and `allowed_branch_ids`; enforced by the default-on tenant guard (§3.4, D54)

### 5.8 Hub startup and power-loss recovery (D24)

Target: hub fully operational within 90 seconds of power returning, no manual action.

**Installation checklist** (installation, not runtime; each item ticked in the install record):
- SSD storage (write-ahead log survives power cuts faster than HDD)
- BIOS "power on after AC loss" enabled
- Hub, router, and kitchen printers on a UPS
- RTC (CMOS) battery checked; replaced if older than 2 years or if the BIOS clock was wrong at install (D48)
- BIOS clock set to UTC; chrony installed (not systemd-timesyncd). Enable `chrony-wait.service` (`chronyc waitsync`, ordered before `time-sync.target`) with a drop-in setting `TimeoutStartSec=30s`, so the wait fits inside the 90 s budget. `hub.service` has `After=time-sync.target` and `Wants=time-sync.target` (not `Requires=`), so a failed or timed-out wait never blocks the hub. Do **not** use `systemd-time-wait-sync.service`: it waits on systemd-timesyncd and does not reliably detect chrony sync. Confirm the installed unit with `systemctl cat chrony-wait.service`. After the wait, chrony slews only (D48)
- USB backup drive labelled `POSBACKUP` plugged into the hub, mounted at a fixed path, and kept in the same locked enclosure as the hub (D53)

**Startup sequence:**

```
systemd triggers hub process
  │
  ├─ 1. Open SQLite with WAL + synchronous=FULL
  │
  ├─ 1a. Apply pending migrations (§6.8): pre-migration backup copy first;
  │      each file in its own transaction; refuse to start on checksum mismatch
  │
  ├─ 2. Load latest engine_snapshot (D62):
  │      SELECT * FROM engine_snapshots
  │      WHERE branch_id = ? ORDER BY taken_at DESC LIMIT 1
  │      if snapshot.engine_version ≠ ENGINE_STATE_VERSION (exported by @pos/engine):
  │        skip the snapshot; state = empty; replay from seq 0 (full replay);
  │        take a fresh snapshot once startup completes
  │
  ├─ 3. Replay events since snapshot:
  │      SELECT * FROM events WHERE branch_id = ? AND seq > snapshot.last_seq
  │      ORDER BY seq ASC
  │      → for each event: state = applyEvent(state, upcast(event))   (D46)
  │
  ├─ 3a. Clock guard (D48):
  │      lastRecordedAt = SELECT MAX(recorded_at) FROM events WHERE branch_id = ?
  │      if Date.now() ≤ lastRecordedAt: write ClockAlarm event (own transaction, first write)
  │      start branchNow at max(Date.now(), lastRecordedAt + 1)
  │
  ├─ 4. Consistency check on projection tables:
  │      Compare max(seq) in each projection table against max(seq) in events.
  │      If projections are stale: rebuild them from the events table (replay
  │      seq > projection's max seq through the projection writers). Never from
  │      EngineState: projections hold data the engine does not (bills, shifts, audit).
  │
  ├─ 5. Resume print queue:
  │      SELECT * FROM print_jobs WHERE acked_at IS NULL ORDER BY created_at ASC
  │      — If sent_at IS NOT NULL: set is_reprint = 1, re-enqueue
  │      — If sent_at IS NULL:     enqueue normally
  │
  ├─ 6. Dispatch missed fires (D44):
  │      intents = getTickIntents(state, branchNow)
  │      — returns FireDispatched only for items/loads with firedAt = null, so
  │        fires already dispatched before the outage are NOT re-fired; their
  │        tickets are covered by step 5 (reprint)
  │      — returns SlipWarned for orders now past threshold (deduplicated per D44)
  │      write all intents as events in one transaction; COMMIT; then apply (D45)
  │      push FireNow to KDS WS (on connect) + print queue for each FireDispatched
  │
  ├─ 7. Open HTTP + WebSocket server; begin accepting connections
  │      Devices reconnect; hub sends catch-up on each WS connect
  │
  └─ 8. INSERT HubStarted event into audit log:
         { hub_down_at: last_beat from hub_heartbeat (written every 60 s — D41),
           hub_up_at: now, events_replayed: count, missed_fires: count }
         Then start the heartbeat writer: every 60 s, UPDATE hub_heartbeat SET last_beat = now()
```

**Nightly local backup (D53):**
- At `backup_time`, the hub copies the database with the SQLite online backup API (`db.backup()` in better-sqlite3) to `POSBACKUP/pos-<branch_id>-<YYYYMMDD>.sqlite`. Writes continue during the copy.
- **`backup_time` default (D63):** the start of the branch's **quietest hour**: the local hour with the fewest committed events, averaged over the last 14 days, recomputed nightly. Ties go to the earliest hour after closing. Until 14 days of data exist, the default is 04:00. A manager can pin a fixed `backup_time` in hub admin, which overrides the computed value.
- The copy is verified with `PRAGMA integrity_check` and by checking that its `MAX(seq)` matches the live database's `MAX(seq)` at backup start. The last 7 nightly files are kept.
- The hub writes a `BackupCompleted { file, max_seq, bytes }` or `BackupFailed { reason }` audit event. The owner view (D22) shows the last successful local backup next to the cloud sync status, and alerts if there has been no successful backup for more than 24 hours.
- Device tokens are stored only as SHA-256 hashes (§5.6), so a lost backup drive does not expose usable device tokens. PINs are already argon2id hashes (D40).

**Engine version (D62):** `@pos/engine` exports an integer `ENGINE_STATE_VERSION`. It is bumped whenever the `EngineState` shape or the meaning of `applyEvent` changes; a CI check fails if either changes without a bump (the snapshot fixture test, §6.7). A snapshot written by a different version is never deserialised. Full replay is a pure reducer over the log; at pilot volume (well under 1 M events per branch per year) it fits inside the 90 s startup budget. Older-version snapshots are deleted after the fresh snapshot is written.

**Snapshot schedule:**
- Every 500 committed events (configurable)
- On clean shutdown (SIGTERM handler)

**Snapshot schema:**
```sql
CREATE TABLE engine_snapshots (
  snapshot_id  TEXT    PRIMARY KEY,   -- ULID
  branch_id    TEXT    NOT NULL,
  taken_at     INTEGER NOT NULL,      -- Unix ms
  last_seq     INTEGER NOT NULL,      -- hub seq of last event in this snapshot
  engine_version INTEGER NOT NULL,    -- ENGINE_STATE_VERSION that wrote state_json (D62)
  state_json   TEXT    NOT NULL       -- JSON-serialised EngineState
);
CREATE INDEX eng_snap_branch ON engine_snapshots (branch_id, taken_at DESC);
```

**Print queue schema:**
```sql
CREATE TABLE print_jobs (
  job_id      TEXT    PRIMARY KEY,  -- ULID
  branch_id   TEXT    NOT NULL,
  station_id  TEXT,
  printer_url TEXT    NOT NULL,     -- tcp://ip:port or usb://serial
  payload     BLOB    NOT NULL,     -- ESC/POS bytes
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER,              -- NULL = not sent yet
  acked_at    INTEGER,              -- NULL = not confirmed by printer
  is_reprint  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX print_jobs_unacked ON print_jobs (branch_id, acked_at)
                                 WHERE acked_at IS NULL;
```

Duplicate ticket on restart is acceptable (D24). Missing ticket is not. A `REPRINT` header line is prepended to any job reprinted after hub restart.

**Heartbeat schema (D41):**
```sql
CREATE TABLE hub_heartbeat (
  branch_id  TEXT    NOT NULL PRIMARY KEY,
  last_beat  INTEGER NOT NULL   -- Unix ms; updated every 60 s while hub is running
);
```
The hub upserts this row every 60 seconds. On startup, `last_beat` is the best available estimate of when the hub went down (`hub_down_at` in the HubStarted audit event). If no row exists yet (first ever start), `hub_down_at` is null.

### 5.9 Request lifecycle example — order submit (happy path)

```
Order-taker device (Capacitor)
  │
  │ 1. User taps Submit
  │    App generates command_id (ULID) and builds OrderSubmitCommand
  │    App validates command locally (Zod, @pos/events PosCommandSchema)
  │    App enqueues command in local SQLite (Capacitor)
  │
  ▼
Hub (Fastify)
  │
  │ 2. POST /commands/submit-order
  │    Validate: device_token (device must exist and not be revoked)
  │              session_token (staff session must be valid and not expired)
  │              body: Zod parse PosCommandSchema (includes command_id)
  │
  │ 2.5. Idempotency check — D32 (before acquiring the write lock):
  │    SELECT response_json FROM processed_commands
  │    WHERE command_id = ? AND branch_id = ?
  │    — If found: return stored response immediately; skip steps 3–10
  │
  │ 3. BEGIN IMMEDIATE (SQLite — single writer, blocks concurrent writes)
  │
  │ 3.5. Idempotency re-check — D32 (inside the transaction; authoritative):
  │    same SELECT as 2.5
  │    — If found: ROLLBACK; return stored response; skip steps 4–10
  │
  │ 4. Precondition checks (read projections inside transaction):
  │    — Dine-in orders only: table must be locked by this session's actor,
  │      or free (lock auto-released — D51), in which case this submit
  │      re-acquires it; locked by another actor → TABLE_ALREADY_LOCKED
  │      (takeaway, parking and delivery orders have no table; no lock check)
  │    — Each item: available, not sold out, station exists
  │    — Actor has permission to place orders
  │
  │ 5. Stock reservation (D50) — read the single stock projection:
  │    for each item with pre-cooked stock configured:
  │      if engineState.stock[item_id] − (units already claimed in this command) > 0:
  │        add StockReserved { item_id, order_item_id, qty: 1 } to the event batch
  │      else:
  │        use full cook time (no error; corrected ETA returned — D7)
  │    No race: BEGIN IMMEDIATE makes this the only writer, and engineState only
  │    changes after a COMMIT (step 9a), so no other command can see a half-applied claim.
  │
  │ 6. Calculate ETAs:
  │    etas = calculateETA(engineState, proposedItems, branchNow())
  │    (@pos/engine — pure function, no I/O; prices in the snapshot are *_minor — D47)
  │
  │ 7. Build OrderPlaced event + ItemAdded events (one per item) + StockReserved events
  │    (each with its schema_version — D46)
  │    Assign seq = (SELECT MAX(seq) FROM events WHERE branch_id = ?) + 1
  │    INSERT INTO events … (all events in one statement batch)
  │    INSERT INTO processed_commands (command_id, branch_id, response_json, recorded_at)
  │    — response built from the etas and event_ids being returned (D32; same transaction)
  │
  │ 8. UPDATE order and table projections (SQLite, same transaction)
  │    Compute the next engine state WITHOUT touching the live one (D45):
  │      nextState = events.reduce(applyEvent, engineState)   // applyEvent never mutates its input
  │
  │ 9. COMMIT (synchronous=FULL — fsync before returning)
  │    — If COMMIT or any earlier step throws: ROLLBACK; discard nextState;
  │      the live engineState is untouched; return the error
  │
  │ 9a. Only after COMMIT succeeds: engineState = nextState   (D45)
  │     (better-sqlite3 is synchronous, so no other command runs between 9 and 9a)
  │
  │ 10. HTTP 200 → { data: { command_id, event_ids: [...], result: { etas: [...] } } }  (§6.3)
  │     Device removes command from local queue; shows ETAs to order taker
  │
  │ 11. WebSocket broadcast to all connected devices (committed events only):
  │     — OrderPlaced (table map color → ORDERED for all)
  │     — ItemAdded events to KDS devices (each carries latestStartAt; KDS sorts by it)
  │     — StockReserved (live countdown; item shows sold out when its count reaches 0)
  │
  └── (async) Sync agent picks up events with seq > last_acked_seq on next 5 s tick (D52)
```

The same commit-then-swap rule (D45) applies to every writer: fire-scheduler ticks (D44), admin commands and startup step 6.

### 5.10 Hub replacement and restore (D53)

Used when a branch's hub is dead, stolen or replaced. Target: the new hub is operational in ≤ 15 minutes (E0 backups story).

```
1. Owner, in the cloud admin: "Replace hub" for the branch
   → cloud revokes the old branch API key; issues a single-use replace-hub
     registration code bound to the existing branch_id
2. Installer: new hub (installation checklist done) → hub:3000/setup → enters code
   → hub receives branch_id + new branch API key
3. Choose restore source, best first:
   a. Old hub's disk, if readable              → full database, nothing lost
   b. Newest file on the POSBACKUP USB drive   → full database up to backup max_seq
   c. Cloud only                               → events only
4. After (b) or (c): pull the tail from the cloud
     GET /sync/events?from_seq=<local max seq + 1>   (branch API key; paged, 500/page)
   until the local max seq = cloud last_received_seq (gap-free, D52)
5. Rebuild: snapshot + replay (startup steps 2–4); clock guard (step 3a)
6. Set sync_cursor.last_acked_seq = cloud last_received_seq; new seq continues from local max
7. Write HubRestored audit event { source, restored_max_seq, cloud_tail_from, cloud_tail_to }
8. Normal startup continues from step 5 (print queue) of §5.8
```

- **What can be lost:** only events that never reached the cloud **and** are newer than the restored backup, i.e. events written during an internet outage after the last nightly backup, on a hub whose disk is unreadable. The `HubRestored` event and the admin UI state this window explicitly.
- **Devices:** source (a) or (b) keeps the hashed device tokens, so paired devices reconnect on their own. Source (c) has no device table (device tokens are hub-only, §5.6), so every device must re-pair.
- **Staff PINs:** pushed again by the cloud on the first sync (D40).
- **Open orders and table locks:** rebuilt from events. Locks whose sessions no longer exist are released on the first tick (D51).

---

## §6. Shared Standards (D59)

Every module spec inherits these standards and does not redefine them. A module adds only its own error codes (§6.2), commands and events (§6.6), and tables (§6.8). Library versions were checked 2026-10-23: Fastify 5 with `fastify-type-provider-zod` 7.x (requires Zod ≥ 4.2); Vitest 4.x (`test.projects`; the old workspace file is deprecated).

### 6.1 Response envelope

Every HTTP response body, on hub and cloud, is one of two shapes. A 2xx response never carries an error, and every response has a body (no 204).

**Success:**

```json
{
  "data": {
    "command_id": "01JBF3Q8ZK4M2N6P7R9S0T1V2W",
    "event_ids": ["01JBF3Q90A1B2C3D4E5F6G7H8J", "01JBF3Q90A1B2C3D4E5F6G7H8K"],
    "result": {
      "order_id": "01JBF3Q90A1B2C3D4E5F6G7H8M",
      "target_land_time": 1761235500000,
      "items": [
        { "order_item_id": "01JBF3Q90A1B2C3D4E5F6G7H8N", "serve_mode": "sync", "eta": 1761235500000 },
        { "order_item_id": "01JBF3Q90A1B2C3D4E5F6G7H8P", "serve_mode": "immediate", "eta": 1761235140000 }
      ]
    }
  }
}
```

Paginated lists add `"meta": { "next_cursor": "<opaque>" | null }` (§6.3).

**Error:**

```json
{
  "error": {
    "code": "TABLE_ALREADY_LOCKED",
    "message": "Table 12 is open on another device",
    "details": { "table_id": "T12", "locked_by": { "staff_id": "01JB…", "display_name": "Bilal" } },
    "request_id": "01JBF3QA7X2Y3Z4A5B6C7D8E9F"
  }
}
```

- `code` comes from the catalogue (§6.2). Clients branch on `code` only.
- `message` is English fallback text for logs and developers. Clients show the translated text for the key `errors.<code>` (D12) and never display `message` directly.
- `details` is typed per code in `@pos/domain` (an empty object when the code has none). It never contains stack traces, SQL, or another tenant's data.
- `request_id` is a ULID generated per request and written to every log line for that request.
- Validation failures use `VALIDATION_FAILED` with `details.issues: [{ "path": "payload.items.0.qty", "message": "…" }]` derived from the Zod error.

**Idempotent replay (D32):** `processed_commands.response_json` stores `{ status, body }` for successful commands only. A retransmit returns the identical status and body with the header `Idempotent-Replay: true`. A rejected command writes nothing (no event, no stored response), so a retransmit is evaluated again. That is safe because the rejection had no side effects.

### 6.2 Error codes

**Naming:** `UPPER_SNAKE_CASE`, shaped `<SUBJECT>_<CONDITION>`. The subject is a domain noun (`TABLE`, `ITEM`, `ORDER`, `STOCK`, `SHIFT`, `VOID`, `SESSION`, `DEVICE`, `SYNC`, `CLIENT`). A code is part of the API contract: once merged it is never renamed or reused for another meaning (CLAUDE.md).

**Single catalogue:** `@pos/domain/src/errors.ts` exports `ErrorCatalogue = { TABLE_ALREADY_LOCKED: { status: 409 }, … } as const`. Domain code throws `new DomainError(code, details)`. One Fastify error handler per app maps it to the envelope and status from the catalogue, and maps any other thrown value to `INTERNAL_ERROR`. A unit test fails if any `DomainError` code used in source is missing from the catalogue. **Adding codes (rule from the v1.7 review):** a new error code is defined in the module spec that introduces it (code, status, `details` shape, when it is returned) and appended to the status-map table above and to `errors.ts` in the same change. This is the only kind of foundation edit allowed after the freeze (D64); it never changes an existing code.

**HTTP status map:**

| Status | Meaning | Shared codes defined by the foundation |
|---|---|---|
| 400 | Malformed or schema-invalid request | `VALIDATION_FAILED` |
| 401 | Missing, invalid or expired credentials | `DEVICE_TOKEN_INVALID`, `SESSION_INVALID`, `SESSION_EXPIRED`, `ADMIN_SESSION_REQUIRED`, `PAIRING_TOKEN_INVALID`, `REGISTRATION_CODE_INVALID`, `BRANCH_API_KEY_INVALID`, `JWT_INVALID`; spec 00 §9: `PIN_INVALID`, `LOGIN_INVALID`, `REFRESH_TOKEN_INVALID`; 01b §9: `PASSWORD_INVALID` |
| 403 | Authenticated but not allowed | `PERMISSION_DENIED`, `GUEST_NETWORK_FORBIDDEN` (D28), `DEVICE_REVOKED`, `BRANCH_MISMATCH` (hub only, §3.2); spec 00 §9: `DEVICE_TYPE_NOT_ALLOWED`, `DEVICE_NOT_OWNED`, `HOST_NOT_ALLOWED`, `STATION_LOGOUT_NOT_ALLOWED`; 01b §9: `PASSWORD_CHANGE_REQUIRED` |
| 404 | Not found, **or belongs to another tenant** (cloud never answers 403 across tenants, so foreign IDs are indistinguishable from missing ones) | `<ENTITY>_NOT_FOUND` (e.g. `ORDER_NOT_FOUND`, `TABLE_NOT_FOUND`), `ROUTE_NOT_FOUND`; spec 00 §9: `STAFF_NOT_FOUND`, `STATION_NOT_FOUND`, `DEVICE_NOT_FOUND`, `SESSION_NOT_FOUND`, `PAIRING_REQUEST_NOT_FOUND`; 01a §9: `BRANCH_NOT_FOUND`, `FLOOR_NOT_FOUND`, `TABLE_NOT_FOUND`, `PROGRAM_NOT_FOUND`, `TAX_CLASS_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `MENU_ITEM_NOT_FOUND`; 01b §9: `ROLE_NOT_FOUND` |
| 409 | Current state forbids the action; it may succeed after the state changes | `TABLE_ALREADY_LOCKED`, `TABLE_LOCK_NOT_HELD` (D61), `ITEM_WRONG_STAGE` (§4.2), `VOID_PENDING` (D11), `SYNC_SEQ_GAP` (D52); spec 00 §9: `DEVICE_SESSION_ACTIVE`, `HUB_NOT_PROVISIONED`, `SETUP_IN_PROGRESS`; 01a §9: `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `BUSINESS_DAY_NOT_OPEN`; 01b §9: `STAFF_NAME_TAKEN`, `LAST_ADMIN_REQUIRED`, `OWN_ADMIN_ACCESS`, `STAFF_LINKED_TO_OWNER`, `CONFIG_STALE` |
| 422 | Well-formed, but breaks a business rule that does not depend on concurrent state | Module-defined (e.g. `SPLIT_TOTAL_MISMATCH`, `REASON_REQUIRED`); spec 00 §9: `REGISTRATION_CODE_KIND_UNSUPPORTED`; 01a §9: `CONFIG_REFERENCE_INVALID`, `IDEMPOTENCY_KEY_MISMATCH`, `STOCK_NOT_TRACKED`; 01b §9: `PASSWORD_UNCHANGED` |
| 426 | Client build older than the hub supports | `CLIENT_UPGRADE_REQUIRED` |
| 429 | Rate limit or lockout; `details.retry_after_ms` + `Retry-After` header | `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT` (§5.7); spec 00 §9: `IP_LOCKED_OUT`, `LOGIN_LOCKED_OUT` (reserved, not returned since spec 00 M73) |
| 500 | Bug | `INTERNAL_ERROR` |
| 503 | Required dependency unavailable (cloud only; the hub has no remote dependency on its request path) | `SERVICE_UNAVAILABLE` |

### 6.3 Hub HTTP conventions

**Base:** `http://<hub-ip>:3000`, LAN only, with no version prefix. KDS and kiosk clients are served by the hub from the same build, so they cannot drift from it. The Capacitor app is the only client that can be older than the hub (its assets are bundled on the device). It therefore sends `X-Client-Version: <semver>` on every request, and the hub answers `426 CLIENT_UPGRADE_REQUIRED` below its configured `min_client_version`.

**Route groups:**

| Route | Purpose | Auth |
|---|---|---|
| `POST /commands/<command-name>` | Every staff write | `Authorization: Bearer <device_token>` + `X-Session-Token` |
| `GET /queries/<resource>` | Reads (table map, open orders, menu cache, station queue) | device token; + session where the data is staff-specific |
| `POST /auth/pin`, `POST /auth/logout` | Staff session (§5.7) | device token |
| `POST /devices/pair` | Pairing (§5.6) | pairing token |
| `POST /admin/commands/<command-name>`, `GET /admin/queries/<resource>` | Hub admin, same convention as staff commands | `X-Admin-Session` (D38) |
| `/setup` | First-run and replace-hub provisioning | registration code only (D38, D53) |
| `GET /ws` | Real-time (§6.5) | device token + session |
| `GET /health` | systemd/installer check; returns startup step and `max_seq` | none (LAN only) |

**Command endpoint convention:**
1. `<command-name>` is the kebab-case form of `command_type` (`SubmitOrder` → `/commands/submit-order`). A body whose `command_type` does not match the path is rejected with `VALIDATION_FAILED`.
2. Body = the `PosCommandSchema` envelope (§4.1). `payload` is validated by that command's Zod schema in `@pos/events`.
3. Each command is one module, `{ commandType, payloadSchema, handle }`, registered in a command registry. A single generic route `POST /commands/:name` dispatches through the registry, so no hand-written command route can skip steps 4–5.
4. Processing order is fixed, and every module spec's per-command script is a subset of it, in this order: idempotency fast path → `BEGIN IMMEDIATE` → idempotency re-check → precondition checks → pure engine call → INSERT events + `processed_commands` → projections + `nextState` → `COMMIT` → swap state (D45) → respond → WS broadcast (§5.9).
5. One command = one transaction = all or nothing. A handler never calls another command.
6. Response: `200 { data: { command_id, event_ids, result } }`; `result` is command-specific and defined in the module spec.
7. Commands travel over HTTP only, never over WS, so the ack and idempotency rules have one path.

**Query convention:** no transaction and no writes. Bounded lists (tables on a floor, open orders at one station) are returned whole. A list that can grow without bound (audit log, closed bills) takes `?cursor=<opaque>&limit=<n>` (default 50, max 200) and returns `meta.next_cursor`. Every query uses a fixed number of SQL statements, whatever the result size (no N+1, CLAUDE.md).

### 6.4 Cloud HTTP conventions

- **Base:** `https://<api-host>/v1`. Paths elsewhere in this spec (e.g. `/sync/events`) are shown without the prefix. The version prefix is justified because three hubs upgrade independently and all call the cloud. A breaking change ships as `/v2`, and `/v1` keeps serving until every hub reports a newer version (sync requests carry `hub_version`).
- **Auth groups:** `/v1/sync/*` uses the branch API key; `/v1/owner/*` and `/v1/admin/*` use the JWT; `/v1/auth/*` and `/v1/health` are the tenant-scope allowlist (D54).
- **Style:** cloud config (menu, staff, roles, branches) is canonical relational data, not event-sourced. Routes are plain REST resources: `GET/POST /v1/admin/menu-items`, `PATCH /v1/admin/menu-items/:id`. Same envelope (§6.1) and catalogue (§6.2).
- **Idempotency:** every cloud `POST` that creates a resource requires an `Idempotency-Key` header (ULID). The key and response are stored per tenant for 24 h; a repeat returns the stored response. Justification: the owner and managers edit from phones on mobile data, where a retried "add staff member" would otherwise create duplicates. `/v1/sync/events` does not need the header: it is idempotent by `event_id` and `seq` (D52).

### 6.5 WebSocket message format

One JSON message per text frame. Shapes are Zod discriminated unions on `type` in `@pos/events/src/ws.ts` (`WsServerMessage`, `WsClientMessage`); both ends validate every frame.

**Hub → device:**

```json
{ "type": "catch_up", "as_of_seq": 10452, "state": { "tables": [], "open_orders": [], "station_queue": [] } }
{ "type": "event", "seq": 10453, "event": { "event_id": "01JB…", "event_type": "ItemStarted", "schema_version": 1, "payload": { "item_id": "01JB…", "started_at": 1761235020000, "source": "tap" } } }
{ "type": "error", "error": { "code": "SESSION_EXPIRED", "message": "Session expired" } }
```

**Device → hub:**

```json
{ "type": "ack", "last_seq": 10453 }
```

- `catch_up.state` is scoped to the device's role (a KDS gets its stations' queues; an order taker gets the table map and its orders). Each module spec defines its part of the shape.
- Only committed events are pushed (D45), in strictly ascending `seq`. A client that sees a gap reconnects with its `last_seq`; a duplicate `seq` is ignored.
- Keepalive: the hub sends a protocol-level ping every 15 s and drops a socket with no pong for 30 s. Clients reconnect with backoff (max 5 s, §5.4).
- Close codes: `4401` credentials invalid or expired, `4403` forbidden (guest network, revoked device), `4426` client upgrade required, `1012` hub restarting.
- **Cloud owner view** (`wss://…/v1/owner/live`) carries projection updates, not events: `{ "type": "update", "resource": "branch_summary", "branch_id": "…", "data": { … } }`, plus the same `error` shape and close codes.

### 6.6 Naming rules

| Thing | Rule | Examples |
|---|---|---|
| Event type | PascalCase `<Subject><PastTenseVerb>`, one fact per event. No generic `…Updated` / `…Changed` events carrying a diff | `OrderPlaced`, `ItemStarted`, `StockReserved`, `FireDispatched`, `TableLockTouched` |
| Command type | PascalCase `<Verb><Subject>`, imperative | `SubmitOrder`, `StartItem`, `VoidItem`, `TouchTableLock` |
| Command path | kebab-case of the command type | `/commands/touch-table-lock` |
| Schema files | `@pos/events/src/events/<stream>/<EventType>.v<N>.ts`; `@pos/events/src/commands/<CommandType>.ts` | `events/order/OrderPlaced.v1.ts` |
| Wire and storage fields | `snake_case` (event and command payloads, HTTP bodies, SQL columns) | `order_item_id`, `target_land_time` |
| In-memory TypeScript | `camelCase` (`EngineState`, services). Conversion happens only in the `@pos/events` codecs | `targetLandTime` |
| Timestamps | `<name>_at`, integer Unix ms; hub-side times are `branchNow` (§4.7) | `recorded_at`, `started_at` |
| Durations | `<name>_ms`, integer | `prep_buffer_ms`, `table_lock_ttl_ms` |
| Money | `<name>_minor`, integer (D47) | `price_minor`, `tax_minor` |
| IDs | `<entity>_id`, ULID string, no prefix | `order_id`, `load_id` |
| Booleans | `is_` / `has_` prefix | `is_reprint` |
| Enum values | lower_snake string literals | `'two_tap'`, `'session_expired'` |
| SQL | tables plural snake_case; indexes `<table>_<purpose>` | `print_jobs`, `events_branch_seq` |

### 6.7 Test conventions and fixtures

**Runner:** Vitest 4.x. The root `vitest.config.ts` declares `test.projects: ['packages/*', 'apps/*']`; each project uses `defineProject`. Turborepo runs `test` per package.

| Kind | Location | Rules |
|---|---|---|
| Unit | `*.test.ts` next to the source | Pure code only (engine, upcasters, codecs, money). No I/O, no timers |
| Hub integration | `apps/hub/test/**/*.int.test.ts` | Real better-sqlite3 on a temp file per test file (WAL on, migrations applied); requests through Fastify `inject()`; no network |
| Cloud integration | `apps/cloud/test/**/*.int.test.ts` | Real PostgreSQL 16 (docker compose service, same in dev and CI); migrations applied once per run; tables truncated between test files |
| E2E | Pipeline step 9 (webapp-testing / Playwright) | Per module spec |

**Determinism:** code under test never calls `Date.now()`, `performance.now()`, `Math.random()` or `ulid()` directly. It receives a `Clock` (`branchNow`) and an `IdGen`. Tests use `fixedClock(T)` / `steppingClock(T, stepMs)` and a deterministic ULID generator. Engine tests use the epoch `T = 1_761_000_000_000` (§4.7 tests are written relative to `T`).

**Builders:** `@pos/events/testing`, a subpath export of the existing package (no new package), provides builders that return schema-valid objects with overridable fields: `anOrderPlaced({ … })`, `anItemStarted({ … })`, `aSlotStation({ capacity: 1 })`, `aBatchStation({ programs: { … } })`. Each builder has a test that its output parses with its own Zod schema.

**Fixtures:**
- `packages/events/fixtures/<EventType>.v<N>.json`: one stored sample per schema version, never edited after merge. The upcaster test upcasts every fixture to the latest version and compares it with `<EventType>.latest.json` (D46).
- `packages/engine/fixtures/engine-state.v<ENGINE_STATE_VERSION>.json`: the state produced by a fixed event log. The test fails if `buildEngineState(log)` differs from the fixture while `ENGINE_STATE_VERSION` is unchanged (D62).

**Traceability:** a test that implements a numbered spec test cites it in its name: `it('[§4.7 #12] overrun cascades down the station; promise unchanged')`. Every numbered test in a spec has exactly one matching test (checkable with grep).

**Required per hub command:** happy path; one test per error code it can return; retransmit with the same `command_id` returns the identical response and writes no new events (D32); for commands that touch the engine, a forced COMMIT failure leaves `engineState` unchanged (D45).

**Required per cloud route:** covered by the route-inventory and cross-tenant tests (D54); plus validation and happy path. There is no coverage-percentage target at T2: the rule is one test per spec rule.

### 6.8 Migration conventions

**Shared rules (SQLite and PostgreSQL):**
- Plain SQL files, forward-only, no down migrations. Recovery from a bad migration is restore from backup (D53).
- Named `NNNN_<snake_description>.sql` (4-digit, sequential, no gaps), in `apps/hub/src/db/migrations/` and `apps/cloud/src/db/migrations/`.
- A merged migration is never edited (CLAUDE.md). Each app's runner (about 50 lines, no library) stores a SHA-256 checksum per applied file and refuses to start if an applied file has changed.
- Money columns are `_minor` integers (D47). Times are integer Unix ms in both databases, so replicated event fields stay byte-identical between hub and cloud.
- The content of the `events` table is never migrated. Payload changes go through `schema_version` and upcasters (D46). Its structure may only gain nullable or defaulted columns.

**Hub (SQLite):**
- Runs at startup as step 1a (§5.8), before the snapshot load. The applied version is `PRAGMA user_version`.
- Before the first pending migration, the runner copies the database with `db.backup()` to `POSBACKUP/pre-migrate-<from>-<to>.sqlite` (local disk if the USB drive is missing). Justification: upgrades run unattended on restaurant hardware with no DBA, so a failed migration must be recoverable by restoring one file.
- Each file runs in its own transaction, together with its `user_version` bump.
- Column changes SQLite cannot `ALTER` use the table-rebuild pattern (create new → copy → drop → rename) inside the transaction. The runner sets `PRAGMA foreign_keys = OFF` before the transaction, because the pragma cannot change inside one, and runs `PRAGMA foreign_key_check` before commit.
- Upgrades are scheduled outside service hours, since migrations add to boot time and so count against the 90 s target.

**Cloud (PostgreSQL):**
- Run as a deploy step (`pnpm --filter cloud migrate`) before the new app version starts, never on app boot. Applied versions are kept in `schema_migrations (version, name, checksum, applied_at)`.
- Each file runs in a transaction, unless its first line is `-- migrate:no-transaction` (required for `CREATE INDEX CONCURRENTLY`).
- **Expand/contract:** because hubs on older versions keep calling `/v1`, every migration must stay compatible with the previous app version. Add nullable or defaulted columns, backfill, and remove old columns only in a later release.
- Every tenant table has `tenant_id` and `branch_id` `NOT NULL`, and every index on it leads with `tenant_id` (D30, D54).

### 6.9 Folder layout per app

Extends §5.1. A module spec adds files inside these folders; a new top-level folder needs a spec change.

```
apps/hub/
├── src/
│   ├── main.ts                    boot sequence (§5.8)
│   ├── server.ts                  Fastify instance, plugins, error handler (§6.2)
│   ├── config/                    hub config loader (branch_id, keys) — Zod-validated
│   ├── db/                        connection.ts (WAL, synchronous=FULL), migrate.ts, migrations/
│   ├── commands/<command-name>.ts one module per command, via the registry (§6.3)
│   ├── queries/<resource>.ts
│   ├── projections/<projection>.ts  event → SQL projection writers (live and rebuild, §5.8 step 4)
│   ├── engine-host/               state holder (commit-then-swap), tick scheduler, snapshots
│   ├── ws/                        catch-up builder, broadcaster
│   ├── auth/                      device token, PIN, session, admin session
│   ├── print/                     print queue, ESC/POS
│   ├── sync/                      sync agent, restore pull (§5.10)
│   ├── backup/                    nightly backup (D53, D63)
│   ├── setup/                     /setup provisioning
│   └── lib/                       clock (branchNow), ids, errors
└── test/                          *.int.test.ts, helpers

apps/cloud/
├── src/
│   ├── main.ts, server.ts
│   ├── plugins/                   tenant-scope.ts (D54), jwt.ts, branch-key.ts, error-handler.ts
│   ├── modules/<module>/          routes.ts, service.ts, repository.ts, schemas.ts
│   │                              (sync, owner-view, menu, staff-roles, branches)
│   ├── db/                        client.ts (not exported outside db/), tenant-scoped-repository.ts,
│   │                              migrate.ts, migrations/
│   └── lib/
└── test/                          *.int.test.ts, route-inventory.int.test.ts (D54)

apps/client/
└── src/
    ├── app/                       routing, shell detection
    ├── features/<feature>/        ordering, tables, kds, cashier, admin
    ├── api/                       typed command/query client, WS client (uses @pos/events)
    ├── offline/command-queue/     one interface: Capacitor SQLite on Android, IndexedDB in kiosk (D56)
    ├── i18n/                      translation keys (D12), errors.<code> keys
    └── shells/                    capacitor/, kiosk/

packages/domain/src/               ids.ts, money.ts, errors.ts (catalogue §6.2), enums.ts
packages/events/src/               envelope.ts, codecs.ts, ws.ts, commands/, events/<stream>/, upcasters/
packages/events/testing/           builders (subpath export @pos/events/testing)
packages/events/fixtures/          versioned event samples (§6.7)
packages/engine/src/               state.ts, apply-event.ts, eta/, hold-and-fire/, tick/, version.ts
packages/engine/fixtures/          engine-state.v<N>.json (D62)
```

---

## §7. Open questions

Unresolved items that must be settled before the named module spec is written. **P1 blocker** = must be resolved before the named P1 work starts.

| # | Question | Blocks |
|---|----------|--------|
| OQ1 | Hub hardware: Linux mini PC with SSD + UPS is the target (D24); exact model and budget not yet chosen. Must be confirmed before installation guide is written. | E5, installation |
| OQ2 | Tablet model and Android OS version for Capacitor. Capacitor 6 requires Android 5.1+. Confirm Android 6+ before E3 (KDS) client spec. | E3 |
| OQ3 | Card terminal model at Arif Chatkhara. Affects the "record amount manually" UX flow for the cashier terminal. | E8 |
| OQ4 | **P1 blocker for overrun handling only (D43).** Will kitchen staff reliably tap Start and Done? D33 overrun, D42 cascade and hold at pass depend on it, as do P2 learned cook times. Resolved by the tap-rate field test (§9), which sets the default `completion_mode` per station. Does **not** block the engine core (ETA, reservations, hold-and-fire). | E4 overrun handling (P1), E4 learned times (P2) |
| OQ5 | Customer add-from-phone with a locked table: queue the addition until unlock, or a "customer channel" permission bypasses the lock? | E9 (P2) |
| OQ6 | Pricing model (monthly vs yearly, per branch vs per device). Decide after 10–15 owner conversations (P3 gate). | E12 |
| OQ7 | Which 3 features do owners outside the pilot say they would pay for? Required before any P3 story is built. | E7, E11 |
| OQ8 | Resolved by D22 — basic remote owner view is P1. | — |
| OQ9 | Resolved by D23 — hold-and-fire re-plans only on void, boost, stock update; faster-than-expected queue re-planning is P2. | — |
| OQ10 | **Narrowed by D57.** Default is ap-south-1, chosen on cost; cloud latency does not affect P1 operations, which run on the hub. Remaining question for the owner: any objection to hosting in Mumbai (data-residency preference)? If yes, use me-central-1. | Cloud setup |
| OQ11 | Cloud cost ceiling. D57 sets the shape: one small instance plus the smallest single-AZ managed Postgres, on the free tier or credits if the AWS account qualifies. Confirm the monthly budget and check current AWS free-tier eligibility for the account before the cloud setup spec. | Cloud setup |
| OQ12 | **Resolved.** First-run provisioning uses a setup wizard on the hub admin page (hub:3000/setup). The cloud generates a one-time branch registration code; the installer enters it in the wizard; the hub exchanges it for the branch API key and sets its branch_id automatically. No manual config file editing required. | — |
| OQ13 | **Resolved.** Each branch has its own independent LAN and its own hub. Branches do not share a local network; cross-branch coordination is cloud-only. | — |
| OQ14 | Printer connectivity: preference is network (LAN/TCP-IP) thermal printers for easier cable management in a busy kitchen. USB is the fallback. `node-escpos` supports both; confirm actual printer model before E3 (printing) spec. | E3 |
| OQ15 | **P1 blocker (D58).** Does Arif Chatkhara currently issue PRA-integrated invoices (PRA e-IMS: invoice number and QR on each receipt)? If yes, PRA integration is required in P1. If yes, also confirm: does PRA require the PRA invoice number on the receipt at the time of sale (needs internet at bill close), or does it accept delayed posting while offline? **Also confirm how bills are issued today when the internet is down:** an offline bill with PRA submission later, or no bill at all without internet. This decides whether offline-first billing survives PRA. **Owner: Arslan**, to check with the restaurant owner or accountant. | E8 Billing spec, P1 scope |

---

## §8. Deferred until needed

Patterns considered and deferred with the YAGNI test result:

| Pattern | Why deferred |
|---------|--------------|
| Transactional outbox (separate outbox table) | The events table IS the outbox. `seq > sync_cursor.last_acked_seq` is the pending-sync set (D52). A separate outbox table adds complexity with no benefit at this scale. Revisit if sync volume exceeds SQLite read throughput (~P4). |
| Row-level security (PostgreSQL RLS) | App-level tenant scoping is mechanically enforced (D54): a default-on guard on every route, a tenant-scoped repository base class with no raw client export, and tests that fail on any unguarded route or cross-tenant read. RLS would duplicate that protection at the cost of per-connection session variables and policy migrations. Revisit at P3 (first paying tenant beyond the pilot) or P4 if any query path bypasses the repository layer (reporting tools, ad-hoc SQL access). |
| Redis / external cache | No hot read path identified in P1. Hub reads projections from SQLite (local, sub-ms). Cloud owner view is low-traffic. Revisit when owner dashboard has > 50 concurrent sessions. |
| Kubernetes / ECS | Single Docker container on one AWS instance is sufficient for P1–P3. Revisit at P4 multi-tenant scale. |
| Message broker (SQS, RabbitMQ, Kafka) | All async work is intra-hub (fire scheduler, print queue) or point-to-point hub→cloud sync. No fan-out, no competing consumers. A broker would be over-engineering. |
| Saga / distributed transaction | All business-critical mutations happen within a single SQLite transaction on the hub. No distributed write that would need compensation at P1. |
| Cursor pagination on events | The sync endpoint streams events by ascending seq with a configurable page size. This is equivalent to keyset pagination and is already correct. No extra pattern needed. |
| iOS app | Explicitly out of P1 (confirmed in Q5). Capacitor makes it a future packaging option with no core changes. |
| Second backend framework for the cloud — **removed (D55)** | The P1 cloud surface is small: sync ingest, restore pull, owner view (REST + one WS), menu/role admin, JWT auth. Fastify, already used on the hub, covers all of it with plugins (`@fastify/jwt`, `@fastify/websocket`, Zod type provider). One framework means one validation, error and test setup shared by hub and cloud, and one thing for a solo developer to learn. A DI/module framework pays off with a large team; revisit at P4 if the cloud team grows past 3 developers. |
| Native desktop shell for the Windows cashier — **removed (D56)** | The cashier app needs no native access: printing and drawer kick go through the hub's print queue over the LAN, and the app is useless without the hub anyway. Chrome or Edge in kiosk mode, auto-started at login (Windows Assigned Access where the edition supports it), with a service worker for assets and IndexedDB for the command queue, gives the same result without a native toolchain or a signed installer. Revisit if the cashier needs a device attached to the cashier PC itself (USB cash drawer, customer display, card terminal SDK). |
| Larger cloud footprint (multi-AZ RDS, bigger instances, latency-chosen region) — **deferred (D57)** | Cloud is off the hot path in P1: orders, ETAs and payments run on the hub; the cloud only receives async sync and serves the owner view. Pick the cheapest acceptable region (ap-south-1) and the smallest single-AZ managed Postgres (free tier or credits where eligible); the gap-free event copy plus local USB backups (D53) cover single-AZ risk. Revisit at P3 (paying tenants) or if owner-view latency is reported as a problem. |
| Rewriting stored events on schema change — **rejected (D46)** | Upcasters on read keep events immutable and need no migration step. Revisit only if upcast chains exceed ~5 versions for one event type; then add a snapshot cut-over, still without rewriting rows. |
| Fiscal integration beyond PRA — **deferred (D58)** | FBR and other authorities stay out of P1 (D9). Only PRA, and only if OQ15 says it is mandatory for the pilot. |

---

## §9. What comes next

This is the **foundation spec**: architecture, state machines and Shared Standards (§6). Endpoint specs, data models and module-specific cross-cutting concerns are written per module, inheriting §6. It is frozen at v1.7 (D64). The index of all specs is `docs/specs/README.md`.

**Suggested module spec order:**

| # | Module spec | Stories covered | Depends on |
|---|------------|-----------------|------------|
| 1 | Restaurant Setup | E1 (floors, stations, menu, stock) | Foundation |
| 2 | Ordering + Tables | E2, partial E5 (device queue) | Restaurant Setup |
| 3 | Timing Engine + KDS | E3, E4 (hold-and-fire, KDS, printing, slip warnings) | Ordering |
| 4 | Roles + Audit | E6 (permissions, void workflow, audit log) | Ordering |
| 5 | Billing | E8 (payments, shifts, Z report, blind count) | Roles + Audit |
| 6 | Offline + Sync | E5 full (sync protocol, device queue) | All above |
| 7 | Basic Owner View | D22 (cloud sync projections, read-only dashboard) | Billing, Sync |

**Before coding (engine):**
- Engine core (slot/batch ETA, reservation timeline, hold-and-fire, D34–D37, D44–D46, D49, D50) may be coded now (v1.7 approved).
- Overrun handling (D33 live end, late-start shift, D42 cascade, hold at pass) waits for the **tap-rate field test** below. Its interfaces (completion facts, `completion_mode`) are fixed now by D43, so the core does not change when it lands.

**Tap-rate field test (D43, resolves OQ4) — before coding overrun handling:**

| | |
|---|---|
| Where | One pilot branch: tandoor (slot) station first, then one batch station (fryer) |
| How | Minimal hub-served KDS page with large Start and Done buttons, no engine behind it. A supervisor logs actual start/finish times on paper for a sample of items in each session |
| Duration | 2 weeks, covering at least 4 dinner rushes |
| Measures | % of items with a Start tap; % with a Done tap; median and p90 delay between the real event and the tap; % of taps on the wrong item |
| Decision rule (proposed; owner may adjust) | Start ≥ 80 % **and** Done ≥ 90 %, with p90 delay ≤ 60 s → `two_tap`. Done passes but Start fails → `single_tap`. Done fails → `auto_done` |
| Output | Result written to docs/reviews/; default `completion_mode` per station type recorded as a spec change (v1.7) |

**Before starting module spec 1:**
Resolve OQ1 (hardware), OQ10 (region confirmation, narrowed by D57), OQ11 (cost ceiling), OQ14 (printer connectivity).
OQ12 and OQ13 are already resolved. OQ15 (PRA) must be answered before the Billing spec (module 5) and before P1 scope is final.
