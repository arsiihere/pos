# 00 — Hub Platform & Access — Module Spec v0.5

## §1. Header

| Field | Value |
|-------|-------|
| Module | 00 Hub Platform & Access |
| Version | v0.5 — **Draft, complete** (all 12 sections); awaiting hostile review |
| Date | 2026-10-23 |
| Depends on | Foundation Spec v1.7 (APPROVED — FINAL) |
| Inherits | **Shared Standards from Foundation v1.7 §6**, unchanged except where a decision in §3.1 names the section it overrides (D64 freeze rule) |
| Tier | T2 Production (foundation §1) |
| Already implemented | Nothing. Greenfield (foundation §1) |

### Changes in v0.5

| Change | Decision | Where |
|---|---|---|
| iOS Safari (not standalone): the pair page does **not** pair. It asks the staff member to add it to the Home Screen and open it from there; pairing happens inside the home-screen app, from the `?t=` kept in the saved URL. Replaces the v0.4 "hint after pairing" | owner request (client contract only; no API change) | §8.2, §12.3 MQ10 |

### Changes in v0.4

| Change | Decision | Where |
|---|---|---|
| iOS Safari: after pairing, show an "Add to Home Screen" hint so the phone keeps its device token; "Pair this phone again" stays as the fallback | owner request (client contract only) | §8.2, §12.3 MQ10 |

### Changes in v0.3 (owner answers, README R5–R15)

| Change | Decision | Where |
|---|---|---|
| New device class `phone` (staff personal phones, BYOD, incl. iPhone): hub-served browser client, QR pairing, owned by one staff member, revoked automatically when that staff member leaves | Takeover default confirmed: any staff member with a correct PIN (owner setting later) | README R11 (M20 unchanged) | §12.4 |
| Hub-served browser clients: no service worker on plain-HTTP origins; no secure-context-only APIs | README R15 | §8.2 |

Station rules (M30, M31) are unchanged.

### Changes in v0.2 (owner review of v0.1)

| Review item | Decision | Where |
|---|---|---|
| A1 — replay without session | M19, M34 | §3.7, §5.1, §6.1, §8 |
| A2 — takeover on a shared device | M20 | §3.4, §6.9, §8 |
| A3 — PIN hashes are crackable from a copied DB | M21 | §3.1, §7.9, README requirement on 06 |
| A4 — CLI reissue for a pending branch | M22 | §6.27 |
| A5 — argon2 concurrency cap | M23 | §3.5, §7.4 |
| A6 — no WS frame before auth | M24 | §6.21 |
| A7 — tenant-level tables in D54 tests | M25 | §10.3 |
| A8 — library versions re-checked | M26 | §7.11 |
| MQ1 — cloud staff/role admin | M27 | §1 out of scope, README |
| MQ2 — engine host | M28 | §3.8, README |
| MQ3 — default roles | M29 | §6.26 |
| MQ4 — kitchen screens | M30, M31 | §3.3, §3.4, §3.9, §4.2, §5.1, §6.7, §6.11 |
| v0.1 batches 2 and 3, §7–§12 | M32, M33, M35, M36, M37 | §6.11–§6.27, §7–§12 |

### Stories covered

| Story | ACs covered here | ACs covered elsewhere |
|---|---|---|
| E0 Staff — PIN login on shared devices | 2, 3 (actor attribution mechanism), 4, 5, 6; edge cases (shared device, guest WiFi) | 1 dropped (M27); 7 PIN set/reset → 01 |
| E0 Hardware — printers, drawer, multiple terminals | 3 (pairing, manage-devices, audit) | 1, 2, 4, 5 → 03b; 6 kiosk shell → 03b/client |
| E6 Custom roles and permissions | 3, 4 (effective permission on the hub, D19); 6 (default role set via seed, M29) | 1, 2, 5, 7 (role CRUD, audit of changes, last-admin guard) → 01 |
| E5 Hub restart after power loss | 2, 3, 4 (boot orchestration, migrations, projection rebuild), 9 (HubStarted, heartbeat), 10 (budget for 00's steps) | 4 engine replay, 5 missed fires → 03a host; 7 print queue → 03b |
| E5 Device resilience during hub restart | 3 (hub side: replay without session, M19) | 1, 2, 4 device queue → 02 |

### In scope
- **Hub platform:** SQLite connection, migrations runner (§6.8) with encrypted pre-migration backup (M21), event store and `appendEvents` (§4.1), `processed_commands` (D32), projection registry and rebuild (§5.8 step 4), commit-then-swap writer (D45), command and query registries with generic routes (§6.3), boot orchestrator (§5.8 steps 0, 1, 1a, 3a, 4, 7, 8), heartbeat (D41), clock and boot clock guard (D48), error handler (§6.2), route guards, encrypted-file helper.
- **Hub access:** `/setup` provisioning (new-branch codes), device pairing and revocation (§5.6), staff, admin and station sessions (§5.7, D28, M30), PIN lockouts, takeover, force logout, idle expiry, staff directory cache and effective permissions (D19).
- **Hub WS transport:** auth message, keepalive, ordered push, catch-up and audience framework other modules plug into (§5.4, §6.5).
- **Cloud access:** migrations runner, error handler, tenant-scope guard (D54) with three credential types, owner login/refresh/logout (JWT), registration-code exchange, CLI `seed-tenant` and `issue-registration-code`, canonical staff/role tables and the permission catalogue.

### Out of scope
- Cloud staff and role admin routes and UI, PIN set/reset, staff-to-branch assignment → **01** (M27).
- Engine host: reducer registration, snapshots, replay, fire-scheduler tick, missed fires (§5.8 steps 2, 3, 6) → **03a** (M28).
- Print queue resume (step 5) → 03b. Station-scoped commands (`StartItem`, `DoneItem`) → 03b.
- Replace-hub codes and restore (§5.10), sync agent, `hub_push_queue`, cloud-offset `ClockAlarm`, nightly backup → 06.
- Device-side command queue policy → 02 (M19 open item).
- Business commands (orders, tables, voids, bills). Customer-facing routes (P2, D20).

---

## §2. Existing architecture that must not change

From the foundation; this module implements these and may not alter them except through a §3.1 decision:

| Item | Source |
|---|---|
| `events` table shape, indexes and immutability triggers; `sync_cursor` | §4.1 |
| `processed_commands` (extended with `device_id` by M19) | §4.1, D32 |
| `PosEventSchema`, `PosCommandSchema` envelopes; ULID IDs; `schema_version` + upcasters | §4.1, D46 |
| Durability: `BEGIN IMMEDIATE`, WAL, `synchronous=FULL`; ack only after COMMIT | §4.1, D24 |
| Two-step idempotency check (fast path, then authoritative re-check in the transaction) | §4.1, D32 |
| Commit-then-swap: in-memory state changes only after COMMIT | D45 |
| Fixed command processing order; one command = one transaction; commands over HTTP only | §6.3 |
| `seq` = `MAX(seq) + 1` per branch, gap-free | §4.1, §5.9 step 7 |
| Device token 256-bit, stored as SHA-256; pairing token 256-bit, single-use, 10-min TTL | §5.6, D53 |
| PIN auth on hub, no internet; lockout 5 per staff / 10 per device in 5 min, 15 min; per-role idle TTL | §5.7, D28 |
| Hub never creates or modifies a PIN hash | D40, §3.1 |
| `/setup` only while unprovisioned, registration code only, 404 forever after | §5.6, D38 |
| `branchNow` from boot wall clock + monotonic; never earlier than the log | §4.7, D48 |
| Heartbeat every 60 s into `hub_heartbeat`; `HubStarted` audit event | §5.8, D41 |
| Envelope, error catalogue, status map, naming, test and migration rules | §6 |
| Cloud tenant scoping: default-on guard, repository base class, route-inventory and cross-tenant tests | §3.4, D54 |

---

## §3. Domain rules

### 3.1 Module decisions

Each decision states the failure it prevents (YAGNI test) and any foundation section it overrides.

| # | Decision | Prevents / reason | Overrides |
|---|---|---|---|
| M1 | **Cloud access minimum lives here.** 00 includes the cloud migrations runner, error handler, tenant guard (D54), owner login/refresh/logout and the registration-code exchange. | Provisioning (D38) needs a cloud endpoint and 01 needs owner auth; without these, 00 could not be built or tested alone. | — |
| M2 | **Tenants and registration codes are created by a cloud CLI in P1** (§6.26, §6.27), not an HTTP route. | P1 has one tenant and three branches, installed by the developer. An HTTP route would need owner UI and abuse controls for 3 uses. Revisit with replace-hub UI (06) or P3 onboarding. | — |
| M3 | **The initial staff directory arrives in the provisioning response.** Later updates come through `applyStaffDirectory()` (§4.2), called by 06 sync. | Without it the hub has no PIN hashes after setup, so nobody could open `/admin` to pair the first device until sync (06) exists. | — |
| M4 | **Sessions are a mutable table plus events.** `staff_sessions` holds token hash and activity; `SessionStarted` / `SessionEnded` record the facts. | D51 releases table locks when a session ends; the tick is a pure function of events (D44), so the end of a session must be an event or replay would not rebuild lock state. | — |
| M5 | **Session activity is tracked in memory and flushed every 15 s** by the session sweeper. Every authenticated request (queries included) updates it. | §6.3 forbids writes in queries; a write per request would add a transaction per GET. Cost: after a crash a session may expire up to 15 s early. | — |
| M6 | **One active device-bound session per device** (staff or station), enforced by a partial unique index (§5.1). The same staff member logging in again replaces their own session (`'replaced'`). Another staff member: see M20. | E0 edge case "previous session must be explicitly closed or timed out". Replace-by-same-staff covers a lost login response. | — |
| M7 | **Admin session = session with `kind = 'admin'`**, no device, requires permission `access-hub-admin`. Admin events use `device_id = 'hub-admin'`; system events use `device_id = 'hub'`. Admin PIN failures count against the staff counter and a per-IP counter. | `events.device_id` is NOT NULL and the admin browser has no device token (§5.6 step 1). Roles are custom (E6), so "manager" (D38) must be a permission, not a role name. | — |
| M8 | **PIN hash format is argon2id in PHC string form only**, minimum `m=19456, t=2, p=1`. bcrypt is not accepted. Weaker hashes are rejected when a directory is applied. Argon2 slows online guessing; it does **not** protect a copied database (M21). | We control every setting device (D40), so a second algorithm adds code with no user. | §5.7 "argon2id (preferred) or bcrypt" → argon2id only |
| M9 | **Session tokens are stored as SHA-256 hashes**, like device tokens. | A copied database or backup would otherwise contain live session tokens. | §5.7 (made specific) |
| M10 | **Effective permission (D19)**: `denied` if the owner set a denial; else the most permissive grant across roles, `allowed` > `requires_approval` > `not_granted`. For `requires_approval`, approver roles = union across the staff member's roles with that grant. The registry rejects `requires_approval` with `PERMISSION_DENIED` unless the command declares `approvable: true` (04). | Implements E6 AC3–4 once, so no handler re-implements it. | — |
| M11 | **Idle TTL for a multi-role staff member** = the maximum `session_idle_ttl_ms` across their roles. | D19 "most permissive" applied to TTL; otherwise two implementations would differ. | — |
| M12 | **WS authenticates with the first client message**, `{ type: 'auth', device_token, session_token }`, within 5 s, else close `4401`. Never headers, never the query string. | Browsers and the Capacitor WebView cannot set `Authorization` on a WebSocket; query-string tokens land in access logs. | §5.4 (header and query credentials) |
| M13 | **Provisioning finishes with a process restart** (exit 0; systemd `Restart=always`). | Every module reads `branch_id` at boot; a second, rarely-tested "become provisioned while running" path is avoided. | — |
| M14 | **Credential exchanges are retry-safe by rotation, not by stored response.** `/setup` → cloud exchange uses `Idempotency-Key: <setup_attempt_id>`; `/devices/pair` uses `pair_request_id`. A repeat after success issues a **new** secret and revokes the previous one. | A lost response after commit would leave a consumed code and no secret; a stored response would keep the plaintext secret in the database. | §6.4 stored-response idempotency, for `/v1/hubs/register` only |
| M15 | **The tenant guard accepts a third credential type**, the registration code, on `/v1/hubs/register` only. | Keeps the unscoped-route allowlist unchanged and the route-inventory test meaningful. | §3.4 item 1 (credential list) |
| M16 | **Tenant-level cloud tables** (`tenants`, `owner_users`, `owner_refresh_tokens`, `staff`, `roles`, `role_permissions`, `staff_roles`, `staff_permission_denials`) carry `tenant_id` only and are reached through `TenantLevelRepository` (adds `tenant_id = $1` to every WHERE). Branch-level tables keep both columns. | Staff work at several branches and roles are tenant-wide (E6); a `branch_id` would duplicate staff rows per branch and split PIN resets. | §6.8 "every tenant table has `tenant_id` and `branch_id`" and §3.4 item 2, for these tables only |
| M17 | **Projection checkpoints table**, updated by each projection writer in the same transaction. | Projections that delete rows lose their max seq, so "compare max(seq) in each projection table" is unreliable. | §5.8 step 4 (mechanism) |
| M18 | **Staff directory held in memory**, loaded at boot and swapped after the commit that applies a new one (D45 pattern). | Every command checks a permission; the map makes that zero SQL. The directory is tens of rows. | — |
| M19 | **Replay without a session.** On `POST /commands/:name`, when the session is missing, ended or unknown, the hub still runs the idempotency fast path with the device token alone: if `command_id` exists **and** its stored `device_id` equals the calling device, it returns the stored `{ status, body }` with `Idempotent-Replay: true` and no new effects. Otherwise the session error is returned. `processed_commands` gains `device_id`; a `command_id` stored for another device is rejected with `400 VALIDATION_FAILED`. | A tablet whose session idled out during a hub restart would otherwise never learn that its queued order was committed, and would show it as failed or resend under a new id. Matching the device stops another device reading a stored response (which may hold a pairing token). **Open item for 02:** queued commands that were never processed and whose session has ended (re-login as the original staff to send, or discard). | §4.1 `processed_commands` shape (+`device_id`); §5.7 "mutating requests carry `X-Session-Token`" (replay only) |
| M20 | **Takeover.** Another staff member with a correct PIN on a device with an active staff session gets `409 DEVICE_SESSION_ACTIVE { staff_id, display_name, can_take_over: true }`. The client confirms and retries with `takeover: true`; the holder's session ends with `'taken_over'` (`ended_by` = new staff) and D51 releases their table locks. No permission is required: the correct PIN of a staff member at the device is the authority. | Without it a forgotten logout blocks a shared tablet for up to the holder's idle TTL (5 min for order takers, 60 min for a manager) in the middle of service. | — |
| M21 | **A copied hub database exposes PINs.** A 4–6 digit PIN has at most 10⁶ values; any argon2 setting usable on the hub is crackable offline in hours. So no backup may hold the database in plaintext. 00 encrypts its own pre-migration backups (AES-256-GCM, §7.9) with `backup_encryption_key`, generated at provisioning and kept **only** in the hub config file. **Requirement on 06:** nightly USB backups are encrypted the same way, with the same key, never stored on the USB drive; 06 must also solve key availability for a USB restore on a replacement hub (§5.10 source b). | A lost or copied `POSBACKUP` drive would otherwise leak every staff PIN of the branch, and with them the ability to void, discount and approve as anyone. | §5.8 nightly backup note "PINs are already argon2id hashes" (no longer a protection claim); §6.8 pre-migration backup (now encrypted) |
| M22 | **CLI reissue for a pending branch.** `issue-registration-code --branch-id <id>` issues a new `new_branch` code for a branch still in `pending_hub` and expires its unconsumed codes. | A failed or abandoned setup would otherwise force a second branch row for the same restaurant. | — |
| M23 | **Argon2 verify concurrency cap.** A semaphore (default 2, `auth.argon2_concurrency`) is shared by `/auth/pin` and `/admin/auth`. When full, a request waits up to 2 s, then gets `503 SERVICE_UNAVAILABLE { retry_after_ms }` with `Retry-After`. | Each verify uses ~19 MiB and tens of ms of CPU; a burst of logins at shift change (or a script on the staff WiFi) could otherwise starve the event loop's thread pool and delay order commands. | §6.2 status map note "503 cloud only" (hub returns it for this and for setup, §9) |
| M24 | **No WS frame before auth.** Until the auth message succeeds, the hub sends nothing on the socket: no `catch_up`, no `event`, no `error` frame; a failure closes with a code only. `catch_up` always carries the full role-scoped open state as of `as_of_seq`, so the client's `last_seq` is not needed. | An unauthenticated socket must not learn anything about the branch, not even through an error frame. Full-state catch-up removes the "events since N" path, which would need its own gap handling. | §5.4 ("events seq > N" in catch-up; `last_seq` query param) |
| M25 | **D54 tests cover tenant-level routes.** The route-inventory test checks every route regardless of repository type. The cross-tenant test seeds two tenants with staff, roles, owners and branches and calls every scoped route, including those that use `TenantLevelRepository`. Constructing either repository without a `TenantContext` throws. | M16 adds a second repository class; without this, tenant-level routes could escape the tests that make scoping mechanical. | — |
| M26 | **Library versions pinned** as checked against the npm registry on 2026-10-23 (§7.11). Vitest stays on **4.1.12**: foundation §6.7 fixes 4.x, and 5.x (5.0.0, 2026-09-03) is a separate upgrade decision. | Unpinned majors drift between dev, CI and the hub. | — |
| M27 | **MQ1 answered.** 01 Restaurant Setup owns cloud staff/role admin, PIN set/reset and staff-to-branch assignment. 00 keeps `seed-tenant` for dev and testing. **Duplicate PINs are allowed:** login is `staff_id` + PIN (pick name, then PIN), so two staff with the same PIN cannot log in as each other. The uniqueness requirement is dropped unless 01 finds a reason. | Salted hashes make duplicate detection impossible on the cloud; it would only add work at the setting device for no security gain. | E0 PIN AC1 "duplicate PINs are rejected" (story, not foundation) |
| M28 | **MQ2 answered.** 03a is "Timing Engine (package + hub host)" and owns reducer registration, snapshots, replay, fire-scheduler tick and missed fires (§5.8 steps 2, 3, 6). 00 provides the hooks (§4.2). 03a is built before or alongside 02. | — | — |
| M29 | **MQ3 answered.** `seed-tenant` seeds Owner, Manager, Cashier, Order taker (§6.26). TTLs are **to confirm with the owner**. No Kitchen staff role (M30). Each later module that adds a permission states its default grants and appends them to `default-roles.ts`. | — | — |
| M30 | **MQ4 answered: station sessions.** A new session kind `'station'`, only for `device_type = 'kds'`. The KDS device is bound to one `station_id` at pairing; `POST /auth/station` opens a session with no PIN and no idle timeout. Events from a station session carry `actor_id = null`; `device_id` identifies the KDS and so the station. A station session may call only commands declared `stationScoped: true` (03b: `StartItem`, `DoneItem`); staff sessions may call those too if their permissions allow. WS accepts station sessions. | Cooks will not log in with a PIN on a greasy shared screen; a shared "kitchen" staff identity would give the illusion of attribution while meaning nothing. | §4.2 "actor_id null when source = 'inferred'" (also null for station taps); §5.7 "session identifies the staff actor" |
| M31 | **The station binding is chosen when the pairing token is generated.** `GenerateDevicePairingToken` takes `{ device_type, station_id? }` (station required iff `kds`); the token carries both and `/devices/pair` must match `device_type`. Station existence is checked through `registerStationValidator` (§4.2), which 01 registers. Rebinding = revoke + re-pair. | The manager is authenticated in the admin UI where stations can be listed; the KDS browser at pair time has no credentials to list stations. | — |
| M32 | **Admin login roster** `GET /admin/login-roster` lists only staff whose effective `access-hub-admin` is `allowed`, without a session. | The admin browser has no device token, so it cannot use the device roster, and typing a ULID staff id is not usable. | — |
| M33 | **Owner login protection.** Opaque 256-bit refresh tokens, stored hashed, rotated on every refresh; reuse of a rotated token revokes all of that user's refresh tokens. 10 failed logins per account in 15 min lock it for 15 min. | Owner login is internet-facing, unlike PIN login. | — |
| M34 | **Order of replay and permission.** The idempotency fast path runs **before** the permission check. Replay returns a response that was authorised when it was produced and has no effects. | Supersedes the v0.1 note in §3.7; required by M19 (no session ⇒ no permission to check). | — |
| M35 | **CORS for the Capacitor origin.** The hub allows CORS (credentials not used; tokens are headers) for origins in `cors_origins` (default `["http://localhost"]`, §8.1). Hub-served kiosk, KDS and admin pages are same-origin. | The Android app's WebView origin is not the hub; without CORS every request from the tablet fails. | — |
| M36 | **Deploy folder.** The systemd unit lives in `apps/hub/deploy/hub.service`. | §6.9 has no place for OS-level install files; without one the unit would end up outside version control or inside `src/`. | §6.9 folder list (adds `apps/hub/deploy/`) |
| M38 | **Device type `phone` (README R14).** A staff member's personal phone (Android or iPhone) runs the hub-served browser client: no install, QR pairing, no service worker (R15). A phone is **owned by one staff member**, chosen when the pairing token is generated (`owner_staff_id`, required iff `phone`). Only the owner can open a staff session on it (`403 DEVICE_NOT_OWNED` for anyone else), so takeover (M20) never applies on a phone. When `applyStaffDirectory` removes the owner (staff exit, deactivation or unassignment from the branch), the same transaction revokes every phone they own (`DeviceRevoked { reason: 'owner_removed' }`, `actor_id` null). Station rules (M30) are unaffected: only `kds` opens station sessions. | A personal phone left paired after a staff member quits would keep a valid device token on the staff WiFi; a phone that any colleague could log into would let staff act as each other from a device that leaves the building. | — |
| M37 | **00 contributes a `hub` catch-up part:** `{ hub: { clock_alarm: { wall_ms, last_recorded_at } \| null, branch_name } }` for every socket. | D48 shows the clock banner on every KDS; a KDS that connects after the `ClockAlarm` event would otherwise never see it. | — |
| M38 | §3.3, §3.4, §4.2, §5.1, §6.7, §6.8, §6.9, §6.19, §8.2, §9, §10, §11 |

### 3.2 Provisioning state

```
  ┌──────────────────┐  POST /setup/provision ok    ┌──────────────────────┐  restart (M13)  ┌─────────────┐
  │  UNPROVISIONED   │─────────────────────────────►│ PROVISIONED_PENDING  │────────────────►│ PROVISIONED │
  │ config has no    │  directory + HubProvisioned  │ config written,      │                 │ /setup → 404│
  │ branch_id / key  │  committed; config written   │ process exiting      │                 │ forever     │
  └──────────────────┘                              └──────────────────────┘                 └─────────────┘
```

- **Provisioned** means the config file contains `provisioned.branch_id` and `provisioned.branch_api_key`. Nothing else decides it.
- While UNPROVISIONED every route except `GET /health`, `POST /setup/provision` and the static setup page returns `409 HUB_NOT_PROVISIONED`.
- One provisioning attempt at a time (in-process flag); a second gets `409 SETUP_IN_PROGRESS`.
- Crash between the SQLite commit and the config write: still UNPROVISIONED; the retry reuses `setup_attempt_id`; the cloud rotates the key (M14); the hub sees `HubProvisioned` for that `branch_id` already in the log and does not write it again.

### 3.3 Device lifecycle

```
  (pairing token issued with device_type [+ station_id]) ──POST /devices/pair──► ACTIVE ──RevokeDevice──► REVOKED
```

- A device row is created only by a successful pair. `REVOKED` is terminal: its token gets `403 DEVICE_REVOKED`; re-pairing creates a new row.
- `device_type ∈ { tablet, cashier_kiosk, kds, phone }`. `kds` devices have a `station_id` and may only open station sessions; other types may only open staff sessions (`403 DEVICE_TYPE_NOT_ALLOWED`). `phone` devices have an `owner_staff_id`; only the owner may log in (M38).
- A phone is revoked automatically when its owner is removed from the branch directory (M38).
- Revoking ends the device's active session in the same transaction (`'device_revoked'`) and closes its sockets with `4403`.

### 3.4 Session lifecycle

| Kind | Opened by | Device | Actor in events | Idle TTL | Allowed calls |
|---|---|---|---|---|---|
| `staff` | `POST /auth/pin` | tablet, cashier_kiosk or phone (owner only, M38), required | `staff_id` | `ttlFor(staff)` (M11) | commands, queries, WS |
| `station` | `POST /auth/station` | kds, required | `null` | none | `stationScoped` commands, queries declaring `allowStation`, WS |
| `admin` | `POST /admin/auth` | none (`'hub-admin'`) | `staff_id` | `ttlFor(staff)` | `/admin/*` |

```
                     open
  (none) ─────────────────────────► ACTIVE ──┬── logout (staff/admin) ─────────────► ENDED 'logout'
                                             ├── same staff, or new station session ► ENDED 'replaced'      (M6)
                                             ├── other staff, takeover: true ──────► ENDED 'taken_over'    (M20)
                                             ├── idle > ttl (sweeper; not station) ► ENDED 'idle_timeout'
                                             ├── ForceLogoutSession ───────────────► ENDED 'forced'
                                             ├── RevokeDevice ─────────────────────► ENDED 'device_revoked'
                                             ├── staff removed on directory apply ─► ENDED 'staff_removed'
                                             └── boot reconciliation ──────────────► ENDED 'hub_restored'
```

- Every transition to ENDED writes exactly one `SessionEnded { session_id, kind, staff_id, station_id, reason, ended_by }` event (`ended_by` = staff who caused it, for `taken_over` and `forced`; else null). ENDED is terminal.
- **Session sweeper** (every 15 s, one `writer.run`): flush in-memory activity (M5) and `devices.last_seen_at`; end every ACTIVE non-station session with `branchNow − last_activity_at > idle_ttl_ms`.
- **Boot reconciliation** (step 4b): every session with a `SessionStarted` event and no `SessionEnded` event that is not ACTIVE in `staff_sessions` gets `SessionEnded { reason: 'hub_restored' }`. Covers restore from cloud (§5.10), where `staff_sessions` is empty but events are not; D51 then releases orphaned locks on the first tick.
- An ended session token gets `401 SESSION_EXPIRED`; an unknown one `401 SESSION_INVALID` (except the M19 replay path and `/auth/logout`).

### 3.5 PIN verification and lockout

Order of checks for `POST /auth/pin` and `POST /admin/auth`:

1. Guards (§3.9): guest network, device token (pin) / none (admin).
2. Rate-subject lockout — device (`/auth/pin`) or client IP (`/admin/auth`): `locked_until > branchNow` → `429 DEVICE_LOCKED_OUT`.
3. Staff lockout: `locked_until > branchNow` → `429 PIN_LOCKED_OUT`.
4. Staff in the directory, else `404 STAFF_NOT_FOUND` (not counted; staff IDs are public on the roster).
5. Acquire the argon2 semaphore (M23): wait ≤ 2 s, else `503 SERVICE_UNAVAILABLE { retry_after_ms: 1000 }`.
6. `argon2.verify(pin_hash, pin)` **outside** any transaction; release the semaphore.
7. `writer.run`: re-read both lockout rows (a parallel attempt may have locked them during step 6). Locked now → `429`, even if the PIN was correct.
8. Mismatch → increment counters; on a threshold set `locked_until` and append the lockout event; commit; `401 PIN_INVALID { attempts_remaining }`.
9. Match → reset the staff counter (the device/IP counter is not reset); continue with the endpoint's success steps in the same transaction.

| Subject | Threshold | Window | Lock | Event |
|---|---|---|---|---|
| `staff` | `auth.pin_max_failures` (5) consecutive | until a success or a clear | `auth.pin_lockout_ms` (900 000) | `StaffPinLockedOut` |
| `device` / `ip` | `auth.device_max_failures` (10) | fixed window `auth.device_failure_window_ms` (300 000) from the first failure | `auth.pin_lockout_ms` | `DevicePinLockedOut` |

The fixed window can allow up to 19 failures across a window boundary; the per-staff limit of 5 is the real guard on any one PIN.

### 3.6 Effective permission (M10)

```
resolve(staff_id, permission):
  if (staff_id, permission) in staff_permission_denials → { grant: 'denied' }
  grants = [ rp.grant_type for rp in role_permissions
             where rp.role_id in staff_roles(staff_id) and rp.permission = permission ]
  if 'allowed' in grants           → { grant: 'allowed' }
  if 'requires_approval' in grants → { grant: 'requires_approval',
                                       approver_role_ids: union of approver_role_id of those rows }
  → { grant: 'not_granted' }
```

**Registry rule:** staff/admin session: `allowed` → continue; `requires_approval` with `approvable: true` → continue with the resolution in `ctx.permission`; otherwise `403 PERMISSION_DENIED { permission, grant }`. Station session: the command must be `stationScoped`, else `403 PERMISSION_DENIED { permission, session_kind: 'station' }`; no staff permission is checked (the station binding is the authority; 03b handlers check the item belongs to `ctx.actor.stationId`).

**Permission catalogue** (`@pos/domain/src/permissions.ts`): E6 AC2 list (`void-item`, `move-item-to-stock`, `mark-item-returned`, `apply-discount`, `apply-refund`, `apply-comp`, `reopen-bill`, `edit-menu`, `view-reports`, `take-order-anywhere`, `boost-order`, `approve-void`, `force-release-table-lock`, `reprint-ticket`, `view-audit-log`, `manage-roles`, `manage-staff`) + `manage-devices` (D38) + `access-hub-admin` (M7). Later modules append in their own spec; a unit test fails if a command declares a permission missing from the catalogue.

### 3.7 Command pipeline (implements §6.3 order)

```
POST /commands/:name   or   POST /admin/commands/:name
 ── guards (§3.9): provisioned, guest net, client version, device token | admin session
 ── registry lookup ──────────────────────────────────── unknown → 404 ROUTE_NOT_FOUND
 ── Zod: PosCommandSchema; :name ↔ command_type ──────── 400 VALIDATION_FAILED
 ── branch_id = config branch_id ─────────────────────── 403 BRANCH_MISMATCH
 ── idempotency fast path (M19, M34):
      row = SELECT … FROM processed_commands WHERE command_id = ?
      row and row.device_id = caller device ('hub-admin' for admin) → replay { status, body }, Idempotent-Replay: true
      row and device differs → 400 VALIDATION_FAILED (issue: command_id already used)
 ── device session, staff or station (/commands only; /admin is already checked by its guard) ── 401 SESSION_INVALID / SESSION_EXPIRED
 ── body actor_id = session staff_id (null for station) ─ 400 VALIDATION_FAILED
 ── payload Zod (command payloadSchema) ──────────────── 400 VALIDATION_FAILED
 ── session kind ↔ command (stationScoped / sessionKind), permission (§3.6) ── 403 PERMISSION_DENIED
 ── writer.run(tx ⇒ {
        idempotency re-check (same rules as fast path) ── hit → ROLLBACK, replay
        { events, result } = command.handle(ctx)         synchronous; may throw DomainError
        appended = appendEvents(tx, events)              seq = MAX(seq)+1…, recorded_at = branchNow
        INSERT processed_commands { command_id, branch_id, device_id, response_json: { status: 200, body } }
        projections.apply(tx, appended)                  + checkpoints (M17)
        nextState = appended.reduce(reducer, state)
      })
 ── COMMIT → swap state → respond 200 → ws.publish(appended)
```

- `handle` is synchronous: better-sqlite3 transactions cannot span an `await`. Async work (argon2) happens in route code before the writer.
- A `DomainError` from `handle` rolls back; nothing is stored (§6.1), so a retransmit is evaluated again.
- A command with no events (e.g. a no-op) still writes its `processed_commands` row.

### 3.8 Boot sequence ownership (§5.8)

| Step | What | Owner |
|---|---|---|
| 0 | Load and Zod-validate hub config; unprovisioned → setup mode (step 1, 1a, then 7 with only `/health` and `/setup`) | 00 |
| 1 | Open SQLite: WAL, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000` | 00 |
| 1a | Migrations: encrypted pre-migration backup when `user_version > 0` and the hub is provisioned; per-file transaction; checksum check | 00 |
| 2–3 | Snapshot load and replay into engine state | 03a (M28) |
| 3a | Clock guard: start `branchNow`; `ClockAlarm { source: 'boot' }` if `Date.now() ≤ MAX(recorded_at)` | 00 |
| 4 | Projection consistency: `reset` + replay every projection whose checkpoint < `MAX(seq)` | 00 |
| 4a | Load `StaffDirectory` (M18) | 00 |
| 4b | Session reconciliation (§3.4) | 00 |
| 5 | Print queue resume | 03b |
| 6 | Missed fires | 03a |
| 7 | Open HTTP + WS; start session sweeper (15 s) and heartbeat (60 s) | 00 |
| 8 | `HubStarted { hub_down_at, hub_up_at, events_replayed, missed_fires, boot_ms }` | 00 (counts reported by steps 3 and 6 through `bootCtx`) |

A step that throws stops boot; the process exits non-zero and systemd restarts it. `GET /health` reports `boot_step` while booting.

### 3.9 Route guards

Applied by a root `onRoute` hook. A hub route-inventory test fails if any route lacks the guard set for its group.

| Guard | Applies to | Failure |
|---|---|---|
| provisioned | all except `/health`, `/setup/*`, static setup page | `409 HUB_NOT_PROVISIONED` |
| guest network (`guest_network_cidrs`, Node `net.BlockList`) | all except `/health` | `403 GUEST_NETWORK_FORBIDDEN` (WS: close `4403`) |
| client version (`X-Client-Version` < `min_client_version`; absent = hub-served client, passes) | `/commands/*`, `/queries/*`, `/auth/*`, `/devices/pair`, `/ws` | `426 CLIENT_UPGRADE_REQUIRED` (WS: close `4426`) |
| device token (`Authorization: Bearer`, SHA-256 lookup) | `/commands/*`, `/queries/*`, `/auth/*` | `401 DEVICE_TOKEN_INVALID`; revoked → `403 DEVICE_REVOKED` |
| device session (`X-Session-Token`, kind staff/station, `session.device_id = device`) | `/commands/*` (after the M19 fast path), `/queries/*` that declare `session: 'required'`, `POST /auth/logout` (accepts ended sessions) | `401 SESSION_INVALID` / `401 SESSION_EXPIRED` |
| admin session (`X-Admin-Session`, kind admin) | `/admin/*` except `POST /admin/auth`, `GET /admin/login-roster` | `401 ADMIN_SESSION_REQUIRED` |
| pairing token | `POST /devices/pair` (in handler) | `401 PAIRING_TOKEN_INVALID` |
| WS auth message | `/ws` (§6.21) | close `4401` / `4403` |

### 3.10 Hub config file

`/etc/pos-hub/config.json`, mode `0600`, owned by the hub service user, written atomically (temp file, fsync, rename, fsync dir). Zod schema in `apps/hub/src/config/`:

```json
{
  "cloud_base_url": "https://api.example-pos.app/v1",
  "http_port": 3000,
  "advertised_host": "192.168.10.2",
  "data_dir": "/var/lib/pos-hub",
  "backup_dir": "/media/POSBACKUP",
  "guest_network_cidrs": ["192.168.20.0/24"],
  "cors_origins": ["http://localhost"],
  "min_client_version": "1.0.0",
  "auth": { "pin_max_failures": 5, "device_max_failures": 10, "device_failure_window_ms": 300000,
            "pin_lockout_ms": 900000, "argon2_concurrency": 2 },
  "setup_attempt_id": "01JBF3Q8ZK4M2N6P7R9S0T1V2W",
  "provisioned": { "tenant_id": "01JB…", "branch_id": "01JB…", "branch_api_key": "…" },
  "backup_encryption_key": "<base64, 32 bytes>"
}
```

`setup_attempt_id`, `provisioned` and `backup_encryption_key` are written only by `/setup/provision`. The installer edits the rest. The branch API key and the backup key live here and never in SQLite, so neither reaches a backup (D53, M21).

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| Foundation | Envelopes and schemas (§4.1), Shared Standards (§6), `EngineState` type only (00 never calls engine functions) |
| 01 | Writes to the cloud staff/role tables (§5.2) and bumps `tenants.directory_version` on every change; registers `registerStationValidator` on the hub |
| 03a | Registers the reducer and boot steps 2, 3, 6 |
| 06 | Calls `applyStaffDirectory` on push; uses `encryptFile` / `decryptFile` and `backup_encryption_key` |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src`):**

| Export | Shape | Used by |
|---|---|---|
| `defineCommand` | `{ commandType, payloadSchema, sessionKind: 'device' \| 'admin', permission, approvable?, stationScoped?, handle(ctx): { events: EventDraft[], result } }`. `permission` may be `null` only when `stationScoped` and the command is never allowed to staff | every module with commands |
| `defineQuery` | `{ resource, sessionKind: 'device' \| 'admin', session: 'required' \| 'none', allowStation?, querySchema, handle(ctx) }`; `ctx.db` is a read-only connection | every module with queries |
| `CommandCtx` | `{ tx, state (read-only), clock, ids, actor: { kind, staffId \| null, stationId \| null, sessionId, deviceId }, permission, branch: { tenantId, branchId } }` | handlers |
| `EventDraft` | `PosEvent` without `event_id`, `seq`, `recorded_at`, `tenant_id`, `branch_id` | handlers |
| `writer.run(fn)` | the only path that writes events (§3.7 inner part); returns appended events | registry, 03a tick, sweeper, auth routes |
| `registerProjection` | `{ name, eventTypes, apply(tx, event), reset(tx) }` | modules with projection tables |
| `registerReducer` | `(state, event) => state`, folded by the writer and replay | 03a |
| `registerBootStep` | `{ step: '2' \| '3' \| '5' \| '6', run(bootCtx) }` | 03a, 03b |
| `registerCatchUp` | `{ part, appliesTo(socketCtx), build(db, state) }`; parts merged into `catch_up.state` | 02, 03b, 04, 05 |
| `registerEventAudience` | `(eventType, (event, socketCtx) => boolean)`; events with no audience are not pushed | every module with pushed events |
| `registerStationValidator` | `(tx, stationId) => boolean`; until registered, every `station_id` is rejected | 01 |
| `StaffDirectory` | `resolve(staffId, permission)`, `get(staffId)`, `ttlFor(staffId)`, `version` | registry, 04 approvals |
| `applyStaffDirectory(tx, directory)` | validates hashes (M8), replaces the cache, appends `StaffDirectoryApplied`, ends sessions of removed staff, revokes phones they own (M38); swap after commit | 06 |
| `encryptFile(src, dst, key)` / `decryptFile` | AES-256-GCM file format (§7.9) | 06 |
| `clock.branchNow()`, `ids.next()` | §6.7 determinism | everyone |

**Socket context** passed to audiences and catch-up: `{ deviceId, deviceType, sessionId, kind, staffId, stationId }`.

**Events introduced (all `schema_version: 1`):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to |
|---|---|---|---|
| `HubProvisioned` | `hub` / branch_id | `{ tenant_id, branch_id, setup_attempt_id, hub_version }` | — |
| `HubStarted` | `hub` / branch_id | `{ hub_down_at \| null, hub_up_at, events_replayed, missed_fires, boot_ms }` | — |
| `ClockAlarm` | `hub` / branch_id | `{ wall_ms, last_recorded_at, delta_ms, source: 'boot' \| 'cloud_offset' }` (06 writes `cloud_offset`) | all sockets (banner, D48) |
| `StaffDirectoryApplied` | `hub` / branch_id | `{ directory_version, staff_count, role_count, removed_staff_ids }` | — |
| `DevicePairingTokenGenerated` | `hub` / pairing_token_id | `{ pairing_token_id, device_type, station_id \| null, owner_staff_id \| null, expires_at }` | — |
| `DevicePaired` | `hub` / device_id | `{ device_id, device_name, device_type, station_id \| null, owner_staff_id \| null, pairing_token_id }` | — |
| `DeviceRevoked` | `hub` / device_id | `{ device_id, reason \| null, cause: 'manual' \| 'owner_removed' }` (`owner_removed`: `actor_id` null, M38) | the revoked device's sockets (then close `4403`) |
| `SessionStarted` | `staff` / staff_id, or `station` / station_id | `{ session_id, kind, staff_id \| null, station_id \| null, device_id \| null, idle_ttl_ms \| null }` | — |
| `SessionEnded` | as `SessionStarted` | `{ session_id, kind, staff_id \| null, station_id \| null, reason, ended_by \| null }`; reason ∈ `logout, replaced, taken_over, idle_timeout, forced, device_revoked, staff_removed, hub_restored` | that session's sockets (then close `4401`) |
| `StaffPinLockedOut` | `staff` / staff_id | `{ staff_id, locked_until, failed_count }` | — |
| `DevicePinLockedOut` | `hub` / device_id or `ip:<addr>` | `{ subject_type: 'device' \| 'ip', subject_id, locked_until, failed_count }` | — |
| `PinLockoutCleared` | `staff` / staff_id, or `hub` / subject | `{ subject_type: 'staff' \| 'device' \| 'ip', subject_id }` | — |

`SessionEnded` is the only signal that a session ended; D51's `session_expired` lock release (03a tick, 02 locks) consumes it for kinds `staff` and `admin`.

**Cloud (`apps/cloud/src`):** `TenantScopedRepository`, `TenantLevelRepository` (M16), `tenant-scope` plugin (JWT, branch API key, registration code), `jwt` plugin, error handler, idempotency store (§6.4), migrations runner, tables in §5.2, `default-roles.ts`.

---

## §5. Data model and migrations

### 5.1 Hub (SQLite)

**`0001_event_store.sql`** — foundation §4.1 `events` (+ 2 indexes, 2 triggers) and `sync_cursor` verbatim; §5.8 `hub_heartbeat` verbatim; plus:

```sql
CREATE TABLE processed_commands (           -- §4.1 + device_id (M19)
  command_id    TEXT    PRIMARY KEY,
  branch_id     TEXT    NOT NULL,
  device_id     TEXT    NOT NULL,           -- caller device, or 'hub-admin'
  response_json TEXT    NOT NULL,           -- { status, body }
  recorded_at   INTEGER NOT NULL
);
CREATE INDEX processed_commands_branch ON processed_commands (branch_id, recorded_at);  -- 7-day prune

CREATE TABLE projection_checkpoints (       -- M17
  branch_id  TEXT    NOT NULL,
  projection TEXT    NOT NULL,
  last_seq   INTEGER NOT NULL,
  PRIMARY KEY (branch_id, projection)
);
```

**`0002_devices_sessions.sql`:**

```sql
CREATE TABLE devices (
  device_id    TEXT    PRIMARY KEY,
  branch_id    TEXT    NOT NULL,
  token_hash   TEXT    NOT NULL UNIQUE,     -- serves every device-authenticated request
  device_name  TEXT    NOT NULL,
  device_type  TEXT    NOT NULL CHECK (device_type IN ('tablet','cashier_kiosk','kds','phone')),
  station_id   TEXT,                         -- M30/M31
  owner_staff_id TEXT,                       -- M38: phones only
  paired_at    INTEGER NOT NULL,
  paired_by    TEXT    NOT NULL,             -- staff who generated the pairing token
  last_seen_at INTEGER,
  revoked_at   INTEGER,
  revoked_by   TEXT,
  CHECK ((device_type = 'kds') = (station_id IS NOT NULL)),
  CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))
);
-- no index on owner_staff_id: the M38 revoke scans tens of device rows once per directory apply

CREATE TABLE pairing_tokens (
  pairing_token_id    TEXT    PRIMARY KEY,
  branch_id           TEXT    NOT NULL,
  token_hash          TEXT    NOT NULL UNIQUE,   -- serves POST /devices/pair
  device_type         TEXT    NOT NULL CHECK (device_type IN ('tablet','cashier_kiosk','kds','phone')),
  station_id          TEXT,
  owner_staff_id      TEXT,                      -- M38
  created_by          TEXT    NOT NULL,
  created_at          INTEGER NOT NULL,
  expires_at          INTEGER NOT NULL,
  consumed_at         INTEGER,
  consumed_request_id TEXT,
  device_id           TEXT,
  CHECK ((device_type = 'kds') = (station_id IS NOT NULL)),
  CHECK ((device_type = 'phone') = (owner_staff_id IS NOT NULL))
);

CREATE TABLE staff_sessions (
  session_id       TEXT    PRIMARY KEY,
  branch_id        TEXT    NOT NULL,
  token_hash       TEXT    NOT NULL UNIQUE,    -- M9; serves every session lookup
  kind             TEXT    NOT NULL CHECK (kind IN ('staff','admin','station')),
  staff_id         TEXT,
  station_id       TEXT,
  device_id        TEXT,
  client_ip        TEXT    NOT NULL,
  idle_ttl_ms      INTEGER,                    -- NULL only for station
  started_at       INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  ended_at         INTEGER,
  end_reason       TEXT,
  ended_by         TEXT,
  CHECK ((kind = 'admin')   = (device_id IS NULL)),
  CHECK ((kind = 'station') = (station_id IS NOT NULL)),
  CHECK ((kind = 'station') = (staff_id IS NULL)),
  CHECK ((kind = 'station') = (idle_ttl_ms IS NULL))
);
-- M6: one active device-bound session per device
CREATE UNIQUE INDEX staff_sessions_active_device
  ON staff_sessions (device_id) WHERE ended_at IS NULL AND kind IN ('staff','station');
-- sweeper, admin sessions list, boot reconciliation: WHERE ended_at IS NULL
CREATE INDEX staff_sessions_active ON staff_sessions (branch_id) WHERE ended_at IS NULL;

CREATE TABLE auth_lockouts (
  branch_id         TEXT    NOT NULL,
  subject_type      TEXT    NOT NULL CHECK (subject_type IN ('staff','device','ip')),
  subject_id        TEXT    NOT NULL,
  failed_count      INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  locked_until      INTEGER,
  PRIMARY KEY (branch_id, subject_type, subject_id)     -- §3.5 steps 2, 3, 7
);
CREATE INDEX auth_lockouts_locked ON auth_lockouts (branch_id, locked_until)
  WHERE locked_until IS NOT NULL;                       -- rosters show who is locked
```

**`0003_staff_directory.sql`** — cache of cloud data (D40). Replaced whole by `applyStaffDirectory`; the only hub tables where DELETE is normal.

```sql
CREATE TABLE staff (staff_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL,
  display_name TEXT NOT NULL, pin_hash TEXT NOT NULL);
CREATE TABLE roles (role_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, name TEXT NOT NULL,
  session_idle_ttl_ms INTEGER NOT NULL CHECK (session_idle_ttl_ms > 0));
CREATE TABLE role_permissions (
  role_id          TEXT NOT NULL REFERENCES roles(role_id),
  permission       TEXT NOT NULL,
  grant_type       TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  approver_role_id TEXT REFERENCES roles(role_id),
  CHECK ((grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)),
  PRIMARY KEY (role_id, permission));
CREATE TABLE staff_roles (staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  role_id TEXT NOT NULL REFERENCES roles(role_id), PRIMARY KEY (staff_id, role_id));
CREATE TABLE staff_permission_denials (staff_id TEXT NOT NULL REFERENCES staff(staff_id),
  permission TEXT NOT NULL, PRIMARY KEY (staff_id, permission));
CREATE TABLE staff_directory_meta (branch_id TEXT PRIMARY KEY,
  directory_version INTEGER NOT NULL, applied_at INTEGER NOT NULL);
```

`not_granted` is the absence of a row. The directory is read whole at boot and after apply (6 fixed SELECTs), so no secondary indexes.

**Retention** (sweeper, once per day): delete `staff_sessions` ended > 7 days ago; `pairing_tokens` expired > 7 days ago; `processed_commands` older than 7 days (D32); `auth_lockouts` rows with no lock and a window older than 1 day.

### 5.2 Cloud (PostgreSQL 16)

**`0001_platform.sql`.** Times are `BIGINT` Unix ms (§6.8). Tenant-level tables per M16.

```sql
CREATE TABLE schema_migrations (version INT PRIMARY KEY, name TEXT NOT NULL,
  checksum TEXT NOT NULL, applied_at BIGINT NOT NULL);

-- tenant-level (M16)
CREATE TABLE tenants (
  tenant_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  directory_version BIGINT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL);
CREATE TABLE owner_users (
  tenant_id TEXT NOT NULL REFERENCES tenants, user_id TEXT NOT NULL,
  email TEXT NOT NULL, display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  allowed_branch_ids TEXT[] NOT NULL,
  failed_login_count INT NOT NULL DEFAULT 0, login_window_started_at BIGINT,
  login_locked_until BIGINT,                                         -- M33
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, user_id));
CREATE UNIQUE INDEX owner_users_email ON owner_users (lower(email)); -- login lookup (pre-tenant)
CREATE TABLE owner_refresh_tokens (
  tenant_id TEXT NOT NULL, token_id TEXT NOT NULL, user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  rotated_at BIGINT, revoked_at BIGINT,
  PRIMARY KEY (tenant_id, token_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES owner_users);
CREATE UNIQUE INDEX owner_refresh_tokens_hash ON owner_refresh_tokens (token_hash);  -- refresh lookup
CREATE INDEX owner_refresh_tokens_user ON owner_refresh_tokens (tenant_id, user_id)
  WHERE revoked_at IS NULL;                                          -- reuse → revoke all
CREATE TABLE staff (
  tenant_id TEXT NOT NULL REFERENCES tenants, staff_id TEXT NOT NULL,
  display_name TEXT NOT NULL, pin_hash TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id));
CREATE TABLE roles (
  tenant_id TEXT NOT NULL REFERENCES tenants, role_id TEXT NOT NULL, name TEXT NOT NULL,
  is_admin_role BOOLEAN NOT NULL DEFAULT false,
  session_idle_ttl_ms INTEGER NOT NULL CHECK (session_idle_ttl_ms > 0),
  PRIMARY KEY (tenant_id, role_id));
CREATE TABLE role_permissions (
  tenant_id TEXT NOT NULL, role_id TEXT NOT NULL, permission TEXT NOT NULL,
  grant_type TEXT NOT NULL CHECK (grant_type IN ('allowed','requires_approval')),
  approver_role_id TEXT,
  CHECK ((grant_type = 'requires_approval') = (approver_role_id IS NOT NULL)),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES roles,
  FOREIGN KEY (tenant_id, approver_role_id) REFERENCES roles (tenant_id, role_id));
CREATE TABLE staff_roles (
  tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, role_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, role_id),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff, FOREIGN KEY (tenant_id, role_id) REFERENCES roles);
CREATE TABLE staff_permission_denials (
  tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, permission TEXT NOT NULL,
  PRIMARY KEY (tenant_id, staff_id, permission),
  FOREIGN KEY (tenant_id, staff_id) REFERENCES staff);

-- branch-level
CREATE TABLE branches (
  tenant_id TEXT NOT NULL REFERENCES tenants, branch_id TEXT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending_hub','active')), created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id));
CREATE UNIQUE INDEX branches_branch_id ON branches (branch_id);
CREATE TABLE staff_branches (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, staff_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, staff_id),                     -- directory build per branch
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches, FOREIGN KEY (tenant_id, staff_id) REFERENCES staff);
CREATE TABLE registration_codes (
  code_hash TEXT PRIMARY KEY,                                       -- exchange lookup (pre-tenant)
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('new_branch','replace_hub')),
  created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
  consumed_at BIGINT, consumed_attempt_id TEXT,
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE INDEX registration_codes_branch ON registration_codes (tenant_id, branch_id)
  WHERE consumed_at IS NULL;                                        -- M22 reissue expires old codes
CREATE TABLE branch_api_keys (
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, key_id TEXT NOT NULL,
  key_hash TEXT NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT,
  PRIMARY KEY (tenant_id, key_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES branches);
CREATE UNIQUE INDEX branch_api_keys_hash ON branch_api_keys (key_hash);        -- sync auth (pre-tenant)
CREATE UNIQUE INDEX branch_api_keys_one_active
  ON branch_api_keys (tenant_id, branch_id) WHERE revoked_at IS NULL;          -- one live key per branch

CREATE TABLE idempotency_keys (                                     -- §6.4 store, used by 01+
  tenant_id TEXT NOT NULL, key TEXT NOT NULL, route TEXT NOT NULL,
  status INT NOT NULL, body JSONB NOT NULL, created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, key));
CREATE INDEX idempotency_keys_expiry ON idempotency_keys (tenant_id, created_at);
```

The four global unique indexes (`owner_users_email`, `owner_refresh_tokens_hash`, `branch_api_keys_hash`, `registration_codes.code_hash`) plus `branches_branch_id` serve credential lookups that run **before** a tenant is known. They are queried only by `db/credential-lookup.ts`, used only by the tenant-scope and auth plugins; the raw client stays unexported (D54).

---

## §6. Endpoints

Common rules for every hub endpoint: guards per §3.9; errors through the §6.2 handler; all times `branchNow`. Common error sets:

- **G-hub** (any hub route after the provisioned guard): `403 GUEST_NETWORK_FORBIDDEN`, `409 HUB_NOT_PROVISIONED`.
- **G-dev** (device routes): G-hub + `401 DEVICE_TOKEN_INVALID`, `403 DEVICE_REVOKED`, `426 CLIENT_UPGRADE_REQUIRED`.
- **G-admin** (admin routes): G-hub + `401 ADMIN_SESSION_REQUIRED`.

### Batch 1 — blank hub to logged-in staff

#### 6.1 `POST /commands/:name` and `POST /admin/commands/:name` — generic command route

| | |
|---|---|
| Permission | per command (§3.6) |
| Auth | `/commands/*`: device token + device session (after the M19 fast path). `/admin/commands/*`: admin session |
| Input | `PosCommandSchema`; `payload` by the command's schema; `command_type` = PascalCase of `:name` |
| Processing | §3.7, exactly |
| Idempotency | D32 two-step + M19 device match |
| Response | `200 { data: { command_id, event_ids, result } }` |
| Errors | G-dev or G-admin; `400 VALIDATION_FAILED`; `401 SESSION_INVALID` / `SESSION_EXPIRED`; `403 BRANCH_MISMATCH` / `PERMISSION_DENIED`; `404 ROUTE_NOT_FOUND`; plus the command's own |
| Query count | fast path 1 SELECT; transaction: re-check 1, `MAX(seq)` 1, 1 prepared INSERT per event, 1 INSERT `processed_commands`, projection writes per the command's spec |

#### 6.2 `GET /queries/:resource` and `GET /admin/queries/:resource` — generic query route

| | |
|---|---|
| Auth | `/queries/*`: device token; + device session when the query declares `session: 'required'`; station sessions only when `allowStation`. `/admin/queries/*`: admin session |
| Input | query string by `querySchema`; lists that can grow without bound use `cursor` + `limit` (default 50, max 200) |
| Processing | resolve; validate; `handle(ctx)` on the read-only connection; no transaction, no writes; refresh in-memory session activity (M5) |
| Response | `200 { data, meta? }` (`meta.next_cursor` for paginated) |
| Errors | G-dev or G-admin; `400 VALIDATION_FAILED`; `401 SESSION_*`; `404 ROUTE_NOT_FOUND`; query's own |
| Query count | fixed per query, declared in its spec (CLAUDE.md no N+1) |

#### 6.3 `GET /health`

| | |
|---|---|
| Auth | none (no guest-network guard, so the installer can check from any port) |
| Processing | in-memory boot state; when the DB is open, `SELECT MAX(seq)` |
| Response | `200 { data: { status: 'booting' \| 'setup' \| 'ready', boot_step, provisioned, branch_id \| null, max_seq \| null, hub_version, clock_alarm } }` |
| Errors | none |

#### 6.4 `POST /setup/provision` (hub)

| | |
|---|---|
| Auth | registration code in the body (D38); route exists only while UNPROVISIONED |
| Input | `{ registration_code: string (12 Crockford base32; dashes/spaces/case ignored), guest_network_cidrs: CIDR[], advertised_host: IPv4 }` |

Processing:
1. Provisioned → `404 ROUTE_NOT_FOUND`. Flag set → `409 SETUP_IN_PROGRESS`; else set it (cleared in `finally`).
2. Validate; normalise the code.
3. No `setup_attempt_id` in config → generate and write config atomically (M14).
4. `POST {cloud_base_url}/hubs/register`, header `Idempotency-Key: <setup_attempt_id>`, body `{ registration_code, hub_version, accepted_kinds: ['new_branch'] }`, timeout 10 s. Network error → `503 SERVICE_UNAVAILABLE { retry_after_ms: 5000 }`. Cloud error → same status and code.
5. Zod-validate the response, including every `pin_hash` (M8). Invalid → `500 INTERNAL_ERROR`, nothing written.
6. `writer.run`: `applyStaffDirectory`; append `HubProvisioned` unless one exists for this `branch_id`.
7. Generate `backup_encryption_key` (32 random bytes) unless present; write config atomically with `provisioned`, `guest_network_cidrs`, `advertised_host`, key.
8. `200 { data: { tenant_id, branch_id, branch_name, restarting: true } }`; exit(0) after the response is flushed (M13).

| | |
|---|---|
| Errors | `400 VALIDATION_FAILED`, `401 REGISTRATION_CODE_INVALID`, `403 GUEST_NETWORK_FORBIDDEN`, `404 ROUTE_NOT_FOUND`, `409 SETUP_IN_PROGRESS`, `422 REGISTRATION_CODE_KIND_UNSUPPORTED`, `503 SERVICE_UNAVAILABLE` |
| Events | `StaffDirectoryApplied`, `HubProvisioned` |
| Never logged | registration code, branch API key, backup key, pin hashes |

#### 6.5 `POST /v1/hubs/register` (cloud)

| | |
|---|---|
| Auth | registration code via tenant-scope plugin (M15). Unknown, expired, or consumed by another attempt → `401 REGISTRATION_CODE_INVALID` (one code for all, so the response does not reveal which codes exist) |
| Headers | `Idempotency-Key: <ULID>` required |
| Input | `{ registration_code, hub_version: semver, accepted_kinds: ('new_branch' \| 'replace_hub')[] (min 1) }` |

Processing (one transaction):
1. `SELECT … FROM registration_codes WHERE code_hash = $1 FOR UPDATE`. Valid when `expires_at > now` and (`consumed_at IS NULL` or (`consumed_attempt_id = Idempotency-Key` and `now − consumed_at < 3 600 000`)).
2. `kind ∉ accepted_kinds` → `422 REGISTRATION_CODE_KIND_UNSUPPORTED`; not consumed.
3. New 256-bit key: revoke the branch's live key; INSERT the new hash.
4. If unconsumed: set `consumed_at`, `consumed_attempt_id`; branch `status = 'active'`.
5. Directory in 5 fixed queries: branch + tenant; active staff ⨝ `staff_branches`; roles referenced by those staff or as approvers; their `role_permissions`; `staff_roles` + `staff_permission_denials` for those staff.
6. COMMIT; respond.

| | |
|---|---|
| Response | `200 { data: { tenant_id, branch_id, branch_name, currency_code, kind, branch_api_key, directory: { directory_version, staff: [{ staff_id, display_name, pin_hash, role_ids, denied_permissions }], roles: [{ role_id, name, session_idle_ttl_ms, permissions: [{ permission, grant_type, approver_role_id }] }] } } }` |
| Idempotency | M14 rotation |
| Concurrency | `FOR UPDATE` serialises two exchanges of one code; `branch_api_keys_one_active` guarantees one live key |
| Errors | `400 VALIDATION_FAILED`, `401 REGISTRATION_CODE_INVALID`, `422 REGISTRATION_CODE_KIND_UNSUPPORTED`, `500 INTERNAL_ERROR` |
| Audit | the hub's `HubProvisioned` event (reaches the cloud through 06); log line `hub_registered { tenant_id, branch_id, kind, rotated }` |

#### 6.6 `POST /admin/auth` — admin session

| | |
|---|---|
| Input | `{ staff_id: ULID, pin: /^\d{4,6}$/ }` |
| Processing | §3.5 with rate subject `ip`; on match, in the same transaction: `access-hub-admin` must be `allowed` (else `403 PERMISSION_DENIED`, counters stay reset); INSERT session `kind 'admin'`, `idle_ttl_ms = ttlFor`; append `SessionStarted` (`device_id 'hub-admin'`) |
| Response | `200 { data: { admin_session_token, session_id, staff_id, display_name, idle_ttl_ms } }` |
| Idempotency | none: a retry creates a second admin session; the orphan idles out |
| Errors | G-hub; `400 VALIDATION_FAILED`, `401 PIN_INVALID`, `403 PERMISSION_DENIED`, `404 STAFF_NOT_FOUND`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` |
| Events | `SessionStarted`; lockout events on threshold |

#### 6.7 `POST /admin/commands/generate-device-pairing-token` — `GenerateDevicePairingToken`

| | |
|---|---|
| Permission | `manage-devices` (D38) |
| Payload | `{ device_type: 'tablet' \| 'cashier_kiosk' \| 'kds' \| 'phone', station_id?: string, owner_staff_id?: ULID }`; `station_id` required iff `kds`, `owner_staff_id` required iff `phone` (else `400 VALIDATION_FAILED`) |
| Handler | if `kds`: `stationValidator(tx, station_id)` false → `404 STATION_NOT_FOUND`. If `phone`: `owner_staff_id` not in the directory → `404 STAFF_NOT_FOUND`. Generate 256-bit token (base64url) + `pairing_token_id`; `expires_at = branchNow + 600 000`; INSERT `pairing_tokens` (hash); event `DevicePairingTokenGenerated` |
| Result | `{ pairing_token, pairing_token_id, expires_at, pair_url: "http://<advertised_host>:<port>/pair?t=<pairing_token>" }`; the admin UI renders `pair_url` as a QR |
| Idempotency | D32; the stored response holds the plaintext token, which is useless after 10 min or one pair (accepted) |
| Errors | §6.1; `404 STATION_NOT_FOUND` |

#### 6.8 `POST /devices/pair`

| | |
|---|---|
| Auth | pairing token in the body; guards: provisioned, guest network, client version |
| Input | `{ pairing_token, pair_request_id: ULID, device_name: string(1–40), device_type }` |

Processing (`writer.run`):
1. Look up by `sha256(pairing_token)`. Missing or `expires_at ≤ branchNow` → `401 PAIRING_TOKEN_INVALID`.
2. `device_type ≠ token.device_type` → `403 DEVICE_TYPE_NOT_ALLOWED`.
3. Consumed: same `pair_request_id`, `branchNow − consumed_at < 600 000`, device not revoked → **rotate** (M14): new token, `UPDATE devices SET token_hash`; no event. Otherwise `401 PAIRING_TOKEN_INVALID`.
4. Unconsumed: if the token is for a `phone` whose owner is no longer in the directory → `401 PAIRING_TOKEN_INVALID`. New `device_id`, 256-bit `device_token`; INSERT `devices` (with token's `station_id` and `owner_staff_id`); mark token consumed; append `DevicePaired` (`actor_id` = token `created_by`, `device_id` = new device).

| | |
|---|---|
| Response | `200 { data: { device_id, device_token, device_type, station_id \| null, owner_staff_id \| null, branch_id, branch_name, hub_version } }` |
| Errors | G-hub; `400 VALIDATION_FAILED`, `401 PAIRING_TOKEN_INVALID`, `403 DEVICE_TYPE_NOT_ALLOWED`, `426 CLIENT_UPGRADE_REQUIRED` |
| Events | `DevicePaired` |

#### 6.9 `POST /auth/pin` — staff session

| | |
|---|---|
| Auth | device token; device type `tablet`, `cashier_kiosk` or `phone` (else `403 DEVICE_TYPE_NOT_ALLOWED`) |
| Input | `{ staff_id: ULID, pin: /^\d{4,6}$/, takeover?: boolean (default false) }` |
| Owner check | `phone` and `staff_id ≠ owner_staff_id` → `403 DEVICE_NOT_OWNED`, checked **before** §3.5 step 2 so it is not counted as a PIN failure and no PIN is verified (M38) |

Processing: §3.5 with rate subject `device`; on match, in the same transaction:
1. Active session on this device:
   - same `staff_id` → end it `'replaced'`.
   - other staff, `takeover` false → ROLLBACK; `409 DEVICE_SESSION_ACTIVE { staff_id, display_name, can_take_over: true }` (holder's). Counters stay reset.
   - other staff, `takeover` true → end it `'taken_over'`, `ended_by` = new staff (M20).
2. INSERT session `kind 'staff'`, `idle_ttl_ms = ttlFor`; append `SessionStarted`.
3. COMMIT. Two logins racing on one device: the partial unique index fails the loser inside its transaction → mapped to `409 DEVICE_SESSION_ACTIVE`.

| | |
|---|---|
| Response | `200 { data: { session_token, session_id, staff_id, role_ids, display_name, idle_ttl_ms } }` (foundation §5.7 fields + `session_id`, `idle_ttl_ms`) |
| Idempotency | same-staff replace (M6) |
| Errors | G-dev; `400 VALIDATION_FAILED`, `401 PIN_INVALID`, `403 DEVICE_TYPE_NOT_ALLOWED` / `DEVICE_NOT_OWNED`, `404 STAFF_NOT_FOUND`, `409 DEVICE_SESSION_ACTIVE`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` |
| Events | `SessionStarted`; `SessionEnded` (`replaced` / `taken_over`); lockout events |

#### 6.10 `POST /auth/logout`

| | |
|---|---|
| Auth | device token + `X-Session-Token` (ended sessions accepted) |
| Processing | `writer.run`: load session by hash (must belong to this device, else `401 SESSION_INVALID`); kind `station` → `403 DEVICE_TYPE_NOT_ALLOWED` (station sessions end only by force or revoke); if active: end `'logout'`, append `SessionEnded` |
| Response | `200 { data: { session_id, ended_at, already_ended } }` |
| Errors | G-dev; `401 SESSION_INVALID`; `403 DEVICE_TYPE_NOT_ALLOWED` |
| Events | `SessionEnded` |

### Batch 2 — station sessions and hub access admin

#### 6.11 `POST /auth/station` — station session (M30)

| | |
|---|---|
| Auth | device token; device type `kds` (else `403 DEVICE_TYPE_NOT_ALLOWED`) |
| Input | `{}` |
| Processing | `writer.run`: if an active station session exists for the device → end it `'replaced'`; INSERT session `kind 'station'`, `station_id` = device's, `idle_ttl_ms NULL`; append `SessionStarted` (stream `station`) |
| Response | `200 { data: { session_token, session_id, station_id } }` |
| Idempotency | replace: a retry ends the previous session and returns a new one |
| Errors | G-dev; `403 DEVICE_TYPE_NOT_ALLOWED` |
| Events | `SessionStarted`, `SessionEnded` (`replaced`) |

#### 6.12 `POST /admin/auth/logout`

| | |
|---|---|
| Auth | `X-Admin-Session` (ended sessions accepted) |
| Processing | as §6.10 for kind `admin` |
| Response | `200 { data: { session_id, ended_at, already_ended } }` |
| Errors | G-hub; `401 ADMIN_SESSION_REQUIRED` (unknown token) |

#### 6.13 `GET /admin/login-roster` (M32)

| | |
|---|---|
| Auth | none beyond provisioned + guest network |
| Processing | from `StaffDirectory` (memory): staff whose `access-hub-admin` resolves `allowed`; 1 SELECT on `auth_lockouts` for `locked_until` |
| Response | `200 { data: { staff: [{ staff_id, display_name, locked_until \| null }] } }`, sorted by `display_name` |
| Errors | G-hub |
| Query count | 1 |

#### 6.14 `POST /admin/commands/revoke-device` — `RevokeDevice`

| | |
|---|---|
| Permission | `manage-devices` |
| Payload | `{ device_id, reason?: string(≤200) }` |
| Handler | device missing → `404 DEVICE_NOT_FOUND`; already revoked → return result with `already_revoked: true`, no events; else set `revoked_at/by`, end its active session `'device_revoked'` (`ended_by` = actor), append `DeviceRevoked { cause: 'manual' }` |
| Result | `{ device_id, revoked_at, already_revoked }` |
| Post-commit | sockets of the device get `DeviceRevoked` then close `4403` |
| Errors | §6.1; `404 DEVICE_NOT_FOUND` |
| Events | `DeviceRevoked`, `SessionEnded` |

#### 6.15 `POST /admin/commands/force-logout-session` — `ForceLogoutSession`

| | |
|---|---|
| Permission | `manage-staff` |
| Payload | `{ session_id }` |
| Handler | missing → `404 SESSION_NOT_FOUND`; already ended → `already_ended: true`, no events; else end `'forced'`, `ended_by` = actor; append `SessionEnded`. Any kind, including the caller's own admin session |
| Result | `{ session_id, ended_at, already_ended }` |
| Errors | §6.1; `404 SESSION_NOT_FOUND` |
| Events | `SessionEnded` (E0 PIN AC5: forced logout logged) |

#### 6.16 `POST /admin/commands/clear-pin-lockout` — `ClearPinLockout`

| | |
|---|---|
| Permission | `manage-staff` |
| Payload | `{ subject_type: 'staff' \| 'device' \| 'ip', subject_id }` |
| Handler | row missing or not locked → `cleared: false`, no events; else reset `failed_count = 0`, `locked_until = NULL`; append `PinLockoutCleared` |
| Result | `{ subject_type, subject_id, cleared }` |
| Errors | §6.1 |
| Events | `PinLockoutCleared` (D28: lockout clearable by a manager) |

#### 6.17 `GET /admin/queries/devices`

| | |
|---|---|
| Input | `?include_revoked=false` |
| Response | `{ devices: [{ device_id, device_name, device_type, station_id, paired_at, paired_by_name, last_seen_at, revoked_at, active_session: { session_id, kind, staff_id, display_name } \| null }] }` |
| Query count | 1 (devices LEFT JOIN active sessions); names from `StaffDirectory`; last-seen from memory merged over the column. Bounded list (a branch has tens of devices), returned whole |

#### 6.18 `GET /admin/queries/sessions`

| | |
|---|---|
| Response | `{ sessions: [{ session_id, kind, staff_id, display_name, station_id, device_id, device_name, started_at, last_activity_at, idle_ttl_ms }] }` — active only |
| Query count | 1 (active sessions LEFT JOIN devices, served by `staff_sessions_active`); activity from memory. Bounded by devices + admins |

#### 6.19 `GET /queries/staff-roster`

| | |
|---|---|
| Auth | device token, `session: 'none'`; device type `tablet` / `cashier_kiosk` / `phone` |
| Response | `{ staff: [{ staff_id, display_name, locked_until \| null }], active_session: { staff_id, display_name } \| null }` sorted by `display_name`; on a `phone` the list holds only the owner (M38) |
| Query count | 2 (lockouts; this device's active session) |
| Errors | G-dev; `403 DEVICE_TYPE_NOT_ALLOWED` |

#### 6.20 `GET /queries/session`

| | |
|---|---|
| Auth | device token + device session; `allowStation: true` |
| Response | `{ session_id, kind, staff: { staff_id, display_name, role_ids } \| null, station_id \| null, idle_ttl_ms \| null, permissions: { [permission]: { grant, approver_role_ids? } } }`; station sessions get `permissions: {}` |
| Query count | 0 beyond the session guard (directory in memory) |
| Errors | G-dev; `401 SESSION_*` |

### Batch 3 — WebSocket and cloud access

#### 6.21 `GET /ws` — hub WebSocket (M12, M24)

Handshake and auth:
1. Upgrade: guest-network check (close `4403`), client-version check (close `4426`). Start a 5 s timer.
2. **Nothing is sent before auth succeeds** — no `catch_up`, no `event`, no `error` frame. Any first frame that is not a valid `auth` message, or no message within 5 s → close `4401`.
3. `{ type: 'auth', device_token, session_token }`: device valid and not revoked (else `4401`; revoked `4403`); session active, kind `staff` or `station`, same device (else `4401`).
4. Synchronously (no `await` between them, so no commit can interleave): read `as_of_seq` = last committed seq; build `catch_up.state` from 00's `hub` part (M37) and every `registerCatchUp` part whose `appliesTo(socketCtx)`; register the socket for publishing; send `{ type: 'catch_up', as_of_seq, state }`.

After auth:
- Each committed event goes to the sockets for which its audience returns true, in ascending `seq`, as `{ type: 'event', seq, event }` (§6.5).
- Client `{ type: 'ack', last_seq }` is accepted and recorded in memory for diagnostics only.
- Keepalive: ping every 15 s; no pong for 30 s → terminate. Pongs and acks do **not** refresh session activity (M5): an app left open with nobody using it still idles out at its role TTL (E0 PIN AC4).
- `SessionEnded` for the socket's session: send the event, close `4401`. `DeviceRevoked`: send, close `4403`. Hub shutdown: close `1012`.
- Tokens are never accepted from the query string or headers on `/ws`.

| | |
|---|---|
| Query count | catch-up: sum of the registered parts' declared fixed counts |
| Library | `@fastify/websocket` 11.3.4 (on `ws` 8.x) |

#### 6.22 `POST /v1/auth/login` (cloud, allowlisted)

| | |
|---|---|
| Input | `{ email, password: string(8–200) }` |
| Processing | `credential-lookup` by `lower(email)`; unknown email → verify against a fixed dummy hash (equal timing), `401 LOGIN_INVALID`. Locked (`login_locked_until > now`) → `429 LOGIN_LOCKED_OUT { retry_after_ms }`. Verify argon2id; mismatch → count (window 15 min, threshold 10 → lock 15 min, M33), `401 LOGIN_INVALID`. Match → reset counter; issue JWT (HS256, 1 h; claims `sub, tenant_id, allowed_branch_ids`) and refresh token (256-bit, 30 d, hash stored) |
| Response | `200 { data: { access_token, access_expires_at, refresh_token, refresh_expires_at, user: { user_id, display_name, tenant_id, allowed_branch_ids } } }` |
| Idempotency | none needed: a retry issues another refresh token; unused ones expire |
| Errors | `400 VALIDATION_FAILED`, `401 LOGIN_INVALID`, `429 LOGIN_LOCKED_OUT` |
| Never logged | password, tokens |

#### 6.23 `POST /v1/auth/refresh` (cloud, allowlisted)

| | |
|---|---|
| Input | `{ refresh_token }` |
| Processing | one transaction: lookup by hash `FOR UPDATE`. Missing, expired or revoked → `401 REFRESH_TOKEN_INVALID`. Already rotated → revoke all live tokens of the user (M33), `401 REFRESH_TOKEN_INVALID`. Else set `rotated_at`, insert a new token, issue a new JWT with claims re-read from `owner_users` |
| Response | as §6.22 |
| Concurrency | `FOR UPDATE` makes two refreshes of one token: one wins, the other sees `rotated_at` (treated as reuse) |
| Errors | `400 VALIDATION_FAILED`, `401 REFRESH_TOKEN_INVALID` |

#### 6.24 `POST /v1/auth/logout` (cloud, JWT)

| | |
|---|---|
| Input | `{ refresh_token }` |
| Processing | revoke the token if it belongs to the JWT's user (`TenantLevelRepository`); otherwise do nothing (no information leak) |
| Response | `200 { data: { revoked: boolean } }` |
| Errors | `400 VALIDATION_FAILED`, `401 JWT_INVALID` |

#### 6.25 `GET /v1/health` (cloud, allowlisted)

`200 { data: { status: 'ok', version, db: 'ok' } }` after `SELECT 1`; DB failure → `503 SERVICE_UNAVAILABLE`.

#### 6.26 CLI `pnpm --filter cloud seed-tenant`

| | |
|---|---|
| Args | `--name <tenant> --currency PKR --owner-email <email> --owner-name <name>`; prompts (no echo) for owner password and owner PIN, twice each |
| Processing | one transaction: refuse if the email exists; create tenant, default roles (below), `owner_users` (argon2id password), owner `staff` (argon2id PIN, M8 params) with the Owner role. Prints `tenant_id`, `user_id`, `staff_id` |
| Use | dev, tests, and pilot setup until 01's staff admin exists (M27) |

**Default roles (M29; TTLs to confirm with owner):**

| Role | `is_admin_role` | Idle TTL | Grants |
|---|---|---|---|
| Owner | true | 60 min | every catalogue permission `allowed` |
| Manager | false | 60 min | every permission except `manage-roles`, `allowed` |
| Cashier | false | 30 min | `apply-discount` requires approval (Manager), `reprint-ticket` allowed; 05 appends billing permissions |
| Order taker | false | 5 min | none from the 00 catalogue; 02 appends ordering permissions |

Each module that adds a permission appends its default grants to `apps/cloud/src/modules/staff-roles/default-roles.ts` in its own task.

#### 6.27 CLI `pnpm --filter cloud issue-registration-code`

| | |
|---|---|
| Args | `--tenant-id <id>` and either `--branch-name <name>` (new branch) or `--branch-id <id>` (reissue, M22) |
| Processing | one transaction. New: create branch `pending_hub`; assign every staff member holding an `is_admin_role` role to it (`staff_branches`), so an admin can open `/admin` after setup. Reissue: branch must exist and be `pending_hub`, else exit 1 with a message; set `expires_at = now` on its unconsumed codes. Then generate 12 Crockford base32 chars (60 bits), store `sha256` of the normalised code, `kind 'new_branch'`, `expires_at = now + 24 h` |
| Output | `XXXX-XXXX-XXXX`, branch id, expiry. The code is printed once and never stored in plaintext |

### 6.28 Endpoint count

Hub: 6.1–6.4, 6.6–6.21 = 20 (incl. 4 admin commands). Cloud: 6.5, 6.22–6.25 = 5. CLI: 2. **Total 27**, inside the budget (README); no split needed. If 01 or later review adds cloud access routes past ~30, the cloud access part (6.5, 6.22–6.27) splits out first.

---

## §7. Cross-cutting

Each item names the failure it prevents.

### 7.1 Hub request pipeline order

`onRequest`: assign `request_id` (ULID) → provisioned → guest network → client version → device token / admin session (per route group). `preValidation`: Zod (fastify-type-provider-zod). Handler. `onSend`: `Idempotent-Replay` / `Retry-After` headers. Error handler: `DomainError` → catalogue status; Zod → `VALIDATION_FAILED`; anything else → `INTERNAL_ERROR` (logged with stack, never returned). Prevents: a route reaching its handler without its guards (checked by the route-inventory test).

### 7.2 Logging and redaction

Fastify's pino logger, JSON to journald. Fields on every line: `request_id`, `branch_id`, `device_id`, `session_id`, `staff_id`, `route`, `status`, `ms`. Redacted paths: `req.headers.authorization`, `req.headers["x-session-token"]`, `req.headers["x-admin-session"]`, and any body field named `pin`, `password`, `pairing_token`, `registration_code`, `refresh_token`, `device_token`, `session_token`, `admin_session_token`, `branch_api_key`, `access_token`. Request and response bodies are never logged. A test greps captured log output of the whole auth test suite for every secret it used. Prevents: PINs and tokens in journald or support bundles.

### 7.3 Timers

| Timer | Interval | Work |
|---|---|---|
| Session sweeper | 15 s | flush activity and `last_seen_at`; end idle sessions (§3.4) |
| Heartbeat | 60 s | upsert `hub_heartbeat` (D41) |
| Retention | daily (first sweep after local midnight) | §5.1 retention |

Each runs through `writer.run` (sweeper, retention) or a single statement (heartbeat), so it serialises with commands under `BEGIN IMMEDIATE`. Prevents: idle sessions never ending; `processed_commands` growing without bound.

### 7.4 Argon2 semaphore (M23)

One process-wide semaphore, size `auth.argon2_concurrency`; waiters queue FIFO with a 2 s deadline. Prevents: a login burst starving the libuv pool used by other async work.

### 7.5 CORS (M35)

`@fastify/cors` is **not** added; the hub sets `Access-Control-Allow-Origin` for origins in `cors_origins` on `/commands`, `/queries`, `/auth`, `/devices/pair` and answers `OPTIONS` preflight (allowed headers: `Authorization`, `X-Session-Token`, `X-Client-Version`, `Content-Type`). `/admin/*` and `/setup/*` send no CORS headers (same-origin only). Prevents: tablet requests failing in the WebView; another LAN origin driving admin routes from a browser.

### 7.6 Cloud rate limiting

Only owner login (M33) and the code entropy (deferred limit, §12). Prevents: password guessing on the internet-facing login.

### 7.7 Env and config

Hub: config file (§3.10) only; no env vars except `POS_HUB_CONFIG` (path override for tests). Cloud: `DATABASE_URL`, `JWT_SECRET` (≥ 32 bytes), `PORT`, `HUB_MIN_VERSION`. Missing or invalid → refuse to start (Zod-validated).

### 7.8 Performance targets (hub mini PC, measured in the 00 smoke test)

| Path | Target |
|---|---|
| `/auth/pin` p95, no contention | ≤ 300 ms |
| Command pipeline overhead (no-op command) p95 | ≤ 5 ms |
| 00's boot steps (0, 1, 3a, 4 with no rebuild, 4a, 4b, 7) | ≤ 5 s, leaving the rest of the 90 s budget (D24) to migrations, replay and missed fires |

### 7.9 Encrypted file format (M21)

`encryptFile(src, dst, key)`: stream AES-256-GCM (`node:crypto`). File = `POSENC1\n` (8 bytes) ‖ 12-byte random IV ‖ ciphertext ‖ 16-byte tag. Written to `dst.tmp`, fsync, rename. `decryptFile` verifies the tag before writing any output. The plaintext SQLite copy is made in `data_dir` (same disk as the live DB, no new exposure) and deleted after encryption. Pre-migration backups: `POSBACKUP/pre-migrate-<from>-<to>.sqlite.enc`, or `data_dir` when the drive is missing. Prevents: PIN hashes and business data readable from a copied drive.

### 7.10 Folder placement (§6.9)

All files land in existing §6.9 folders: `apps/hub/src/{config,db,commands,queries,projections,engine-host,ws,auth,setup,lib}`, `apps/cloud/src/{plugins,modules/{hub-registration,owner-auth,staff-roles},db,lib}`. `engine-host/` holds only the generic state holder and writer in 00; 03a adds tick and snapshots there. No new top-level folder.

### 7.11 Library versions (M26, checked against the npm registry 2026-10-23)

| Package | Version | Use |
|---|---|---|
| `fastify` | 5.12.7 | hub + cloud |
| `fastify-type-provider-zod` | 7.0.0 (peer: fastify ^5.5, zod ≥ 4.1.5) | validation |
| `zod` | 4.6.7 | schemas |
| `better-sqlite3` | 13.0.3 | hub DB |
| `@node-rs/argon2` | 2.2.2 (`verify(hashed, password)` takes the PHC string) | PIN and password hashes |
| `@fastify/websocket` | 11.3.4 (on `ws` ^8.16; `ws` latest 8.22.0) | hub WS |
| `@fastify/jwt` | 10.2.5 | cloud JWT |
| `pg` | 8.23.1 | cloud DB |
| `ulid` | 3.0.2 | IDs |
| `vitest` | **4.1.12** (5.0.5 exists; foundation §6.7 fixes 4.x) | tests |

No other runtime dependency: CIDR matching uses `node:net` `BlockList`; encryption uses `node:crypto`; semaphore and migrations runner are in-repo (~50 lines each).

---

## §8. Client contract

### 8.1 Capacitor app (tablets)

- **Transport:** the hub is plain HTTP/WS on the LAN (foundation §1). Capacitor 6+ serves the app from an `https://localhost` origin by default, which would make every hub call mixed content. Requirement: `server.androidScheme: 'http'` (origin `http://localhost`, matching `cors_origins`) and an Android network security config that permits cleartext **only** to private ranges (`10/8`, `172.16/12`, `192.168/16`), not a global `usesCleartextTraffic`. To verify against current Capacitor docs during the 02 client work (source checked here: community reports only, MQ7).
- **Pairing:** scan the QR (`pair_url`), extract `t`, send `POST /devices/pair` with a new `pair_request_id` kept until success; on a lost response retry with the same id (M14).
- **Token storage:** `device_token` in Android Keystore-backed secure storage (plugin chosen in 02); `session_token` in memory only (app restart = log in again).
- **Headers:** `Authorization`, `X-Session-Token`, `X-Client-Version` on every request.

### 8.2 Hub-served browsers (cashier kiosk, KDS, staff phones, admin)

- **No service worker, no secure-context-only APIs (README R15).** The hub origin is plain HTTP on the LAN, so service workers do not run (except on the kiosk, which Chrome/Edge launches with `--unsafely-treat-insecure-origin-as-secure=http://<hub-ip>:3000`). The client never depends on a service worker; the command queue is IndexedDB only. IDs use `crypto.getRandomValues` (available without a secure context); `crypto.randomUUID` and `crypto.subtle` are not used.
- Pairing (kiosk, KDS): the manager opens `/admin` **on that browser**, generates a token for this device type (and station for KDS), and the admin UI navigates the same tab to `pair_url`; the token is never typed.
- `device_token` in IndexedDB (kiosk and KDS run on hardware inside the restaurant). `admin_session_token` in `sessionStorage` (closing the tab ends access client-side; the server TTL still applies).
- KDS: after pairing, call `POST /auth/station` on every load; no login screen.
- **Phones (M38):** the manager generates a `phone` token for the staff member in `/admin` on any admin browser; the staff member scans the QR with the phone camera, which opens `pair_url` in the phone browser; the hub-served pair page asks for a device name and calls `POST /devices/pair`. The roster shows only the owner, so login is PIN only. The device token is in IndexedDB. Browsers may clear site storage of rarely used origins (Safari: script-written storage after 7 days without use); home-screen web apps are reportedly exempt (MQ10).
- **Pair page rules (phones):**
  1. **Already paired** (a device token exists in this context's storage) → ignore `t` and go to the login screen. This matters because the home-screen app always starts on the saved `pair_url`.
  2. **iOS Safari, not standalone** (iOS user agent and `navigator.standalone !== true`) → **do not call `POST /devices/pair`.** Show "Add to Home Screen, then open it from there" with the Share → Add to Home Screen steps (key `pairing.ios_add_to_home`). Leave the URL untouched, including `?t=<pairing_token>`, so the saved home-screen app opens on `pair_url`.
  3. **iOS standalone** (`navigator.standalone === true`) or **any other phone browser** → ask for a device name, then call `POST /devices/pair` as usual (new `pair_request_id`, retried with the same id on a lost response, M14).
  4. **`401 PAIRING_TOKEN_INVALID`** (the 10-minute token expired before the app was opened, or it was already used) → "Ask a manager for a new QR" (key `pairing.token_expired`). A new QR on iOS means adding a new home-screen icon; the old icon can be deleted.
- Pairing inside the standalone context works whether or not iOS shares storage between Safari and the home-screen app: the token is stored where it is used. Safari itself never holds a device token on iOS.
- **Fallback, all phones:** a phone whose storage was cleared has no token; the app (which reopens on the old `pair_url`) hits rule 4 and shows "Pair this phone again — ask a manager for a new QR". Re-pairing creates a new device row; the old one stays until a manager revokes it or the owner leaves.

### 8.3 Login flow (tablet, kiosk, phone)

1. `GET /queries/staff-roster` → name grid (locked names greyed with time left).
2. Pick name → PIN pad → `POST /auth/pin`.
3. (tablet, kiosk) `409 DEVICE_SESSION_ACTIVE` with `can_take_over` → dialog "Bilal is logged in — log him out?" (key `auth.takeover.confirm`) → retry with `takeover: true`.
4. Success → `GET /queries/session` for permissions; hide actions whose grant is `not_granted` / `denied`; show "needs approval" for `requires_approval`.
5. Open `/ws`, send `auth` as the first frame.

### 8.4 Error handling

| Code | Client behaviour |
|---|---|
| `SESSION_EXPIRED`, `SESSION_INVALID`, WS close `4401` | go to login; keep unsent drafts (BUILDING) on the device |
| `DEVICE_TOKEN_INVALID`, `DEVICE_REVOKED`, WS `4403` (non-guest) | wipe `device_token`; show "This device must be paired again" |
| `GUEST_NETWORK_FORBIDDEN`, WS `4403` (before auth) | "Connect to the staff WiFi" |
| `CLIENT_UPGRADE_REQUIRED`, WS `4426` | blocking "Update the app" screen |
| `PIN_INVALID` | shake PIN pad; show `attempts_remaining` when ≤ 2 |
| `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT` | show time left from `retry_after_ms` |
| `SERVICE_UNAVAILABLE` | retry once after `retry_after_ms`, then show "Hub busy, try again" |
| `HUB_NOT_PROVISIONED` | "Hub is being set up" |
| WS `1012` or drop | reconnect with backoff (max 5 s, §5.4); re-send `auth` |

All text through `errors.<code>` / `auth.*` translation keys (D12).

### 8.5 Command queue replay (M19)

On reconnect the device resends every unacknowledged command with its original `command_id`, even when its session has ended. A `200` with `Idempotent-Replay: true` means the command had been committed: remove it from the queue. A `401 SESSION_*` means it was never processed: keep it and apply 02's policy (open item, M19).

---

## §9. Error catalogue additions

Appended to foundation §6.2 and `@pos/domain/src/errors.ts` when this spec is approved (the one allowed foundation edit, D64).

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `PIN_INVALID` | 401 | `{ attempts_remaining }` | PIN does not match (§3.5) |
| `LOGIN_INVALID` | 401 | `{}` | cloud email/password wrong or unknown email (§6.22) |
| `REFRESH_TOKEN_INVALID` | 401 | `{}` | refresh token unknown, expired, revoked or reused (§6.23) |
| `DEVICE_TYPE_NOT_ALLOWED` | 403 | `{ device_type, allowed: string[] }` | session kind or pairing type does not fit the device (§3.3, §6.8–§6.11, §6.19) |
| `DEVICE_NOT_OWNED` | 403 | `{ device_id }` | a staff member other than the owner tries to log in on a `phone` (M38) |
| `STAFF_NOT_FOUND` | 404 | `{ staff_id }` | `staff_id` not in the hub directory |
| `STATION_NOT_FOUND` | 404 | `{ station_id }` | station validator rejects the id (§6.7) |
| `DEVICE_NOT_FOUND` | 404 | `{ device_id }` | `RevokeDevice` target missing |
| `SESSION_NOT_FOUND` | 404 | `{ session_id }` | `ForceLogoutSession` target missing |
| `DEVICE_SESSION_ACTIVE` | 409 | `{ staff_id, display_name, can_take_over }` | another staff member holds the device (M6, M20) |
| `HUB_NOT_PROVISIONED` | 409 | `{}` | non-setup route before provisioning |
| `SETUP_IN_PROGRESS` | 409 | `{}` | second `/setup/provision` while one runs |
| `REGISTRATION_CODE_KIND_UNSUPPORTED` | 422 | `{ kind, accepted_kinds }` | code kind not accepted by this hub (§6.5) |
| `LOGIN_LOCKED_OUT` | 429 | `{ retry_after_ms }` | owner account locked (M33) |

**Existing codes with extended `details`** (additive): `PERMISSION_DENIED { permission, grant?, session_kind? }`; `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT { retry_after_ms }` (as §6.2); `SERVICE_UNAVAILABLE { retry_after_ms }`.

**Status-map note:** the hub returns `503 SERVICE_UNAVAILABLE` in two places, `/setup/provision` (cloud unreachable) and the argon2 semaphore (M23). Foundation §6.2 calls 503 cloud-only; both hub uses are off the order/payment path.

---

## §10. Tests

Conventions per foundation §6.7: hub integration tests in `apps/hub/test/**/*.int.test.ts` on a temp SQLite file through `inject()`; cloud in `apps/cloud/test/**/*.int.test.ts` on PostgreSQL 16. Test names cite `[00 §10 #n]`. Argon2 in tests uses the M8 minimum params (a fixture of precomputed hashes keeps the suite fast).

### 10.1 Per-endpoint cases

| # | Endpoint | Case |
|---|---|---|
| 1 | §6.1 | no-op test command: happy path writes 1 event + 1 `processed_commands` row with `device_id` |
| 2 | §6.1 | retransmit same `command_id`, same device, valid session → identical body, `Idempotent-Replay: true`, no new rows |
| 3 | §6.1 | retransmit after the session ended → stored response replayed (M19) |
| 4 | §6.1 | retransmit from another device → `400 VALIDATION_FAILED`, nothing replayed |
| 5 | §6.1 | new `command_id` after the session ended → `401 SESSION_EXPIRED` |
| 6 | §6.1 | `:name` ≠ `command_type` → 400; unknown name → 404 `ROUTE_NOT_FOUND` |
| 7 | §6.1 | `branch_id` ≠ config → 403 `BRANCH_MISMATCH` |
| 8 | §6.1 | body `actor_id` ≠ session staff → 400 |
| 9 | §6.1 | grant `not_granted` → 403; `denied` overriding an `allowed` role → 403; `requires_approval` on a non-approvable command → 403; on an approvable one → handler sees approver roles |
| 10 | §6.1 | station session on a non-`stationScoped` command → 403 `{ session_kind: 'station' }`; on a `stationScoped` test command → 200 with `actor_id null` |
| 11 | §6.1 | handler throws `DomainError` → error envelope, no rows, retransmit evaluated again |
| 12 | §6.1 | forced COMMIT failure → state unchanged, nothing published (D45) |
| 13 | §6.2 | query makes no writes (DB `total_changes` unchanged) and refreshes in-memory activity |
| 14 | §6.3 | `/health` in setup, booting and ready states; no guest-network guard |
| 15 | §6.4 | happy path against a stub cloud: directory applied, `HubProvisioned` written, config has key + `backup_encryption_key`, process exit requested |
| 16 | §6.4 | after provisioning → 404 |
| 17 | §6.4 | concurrent second call → 409 `SETUP_IN_PROGRESS` |
| 18 | §6.4 | cloud unreachable → 503; cloud 401 / 422 passed through |
| 19 | §6.4 | cloud returns a weak `pin_hash` → 500, nothing written |
| 20 | §6.4 | crash after commit before config write; retry → same `setup_attempt_id` sent, no second `HubProvisioned` |
| 21 | §6.4 | other routes before provisioning → 409 `HUB_NOT_PROVISIONED` |
| 22 | §6.5 | happy path: code consumed, branch active, one live key, directory contents correct (staff of this branch only) |
| 23 | §6.5 | same `Idempotency-Key` within 1 h → new key, previous revoked |
| 24 | §6.5 | other key after consumption, expired code, unknown code → identical 401 |
| 25 | §6.5 | `replace_hub` code with `accepted_kinds ['new_branch']` → 422 and the code stays unconsumed |
| 26 | §6.6 | happy path; staff without `access-hub-admin` → 403 and staff counter reset |
| 27 | §6.6 | IP counter: 10 failures across staff → `DEVICE_LOCKED_OUT`, event `subject_type 'ip'` |
| 28 | §6.7 | happy path for tablet; kds with valid station; kds without station → 400; unknown station → 404; no `manage-devices` → 403; retransmit → same token |
| 29 | §6.8 | happy path; expired token → 401; used token by another request → 401; `device_type` mismatch → 403 |
| 30 | §6.8 | retry with same `pair_request_id` → new token works, old token → 401 `DEVICE_TOKEN_INVALID`, no second `DevicePaired` |
| 31 | §6.9 | happy path; wrong PIN → 401 with `attempts_remaining`; 5th failure → `StaffPinLockedOut`, next correct PIN → 429 |
| 32 | §6.9 | 10 failures from one device across staff → `DEVICE_LOCKED_OUT` |
| 33 | §6.9 | same staff again → previous session ended `replaced` |
| 34 | §6.9 | other staff without takeover → 409 with holder and `can_take_over: true`; nothing written |
| 35 | §6.9 | other staff with `takeover: true` → holder `SessionEnded { reason: 'taken_over', ended_by }` |
| 36 | §6.9 | kds device → 403 `DEVICE_TYPE_NOT_ALLOWED`; guest-network IP → 403; old client version → 426 |
| 37 | §6.9 | semaphore full for 2 s → 503 with `retry_after_ms` |
| 38 | §6.10 | logout; repeat → `already_ended: true`, one event total; station session → 403 |
| 39 | §6.11 | happy path; second call replaces; tablet → 403 |
| 40 | §6.12 | admin logout; repeat idempotent |
| 41 | §6.13 | lists only staff with `access-hub-admin` allowed; shows lock time |
| 42 | §6.14 | revoke ends session, publishes `DeviceRevoked`, closes socket `4403`; retransmit same `command_id` → identical response; new command on a revoked device → `already_revoked`; unknown → 404; no `manage-devices` → 403 |
| 43 | §6.15 | force logout of staff, station and admin sessions; event has `ended_by`; retransmit → identical response; new command on an ended session → `already_ended`; unknown → 404; no `manage-staff` → 403 |
| 44 | §6.16 | clear staff, device and ip locks; retransmit → identical response; unlocked subject → `cleared: false`, no event; no `manage-staff` → 403 |
| 45 | §6.17–§6.18 | lists, fixed query count (statement counter = 1) with 1 and 20 devices |
| 46 | §6.19 | roster with active session and locks; 2 statements with 1 and 30 staff |
| 47 | §6.20 | staff permissions map equals `resolve` for every catalogue entry; station → `{}` |
| 48 | §6.21 | no frame of any kind before auth: connect, wait 5.1 s, assert zero frames received and close `4401` |
| 49 | §6.21 | first frame not `auth`, bad device, bad session, admin session → close `4401` with zero frames; revoked device → `4403` |
| 50 | §6.21 | tokens in query string ignored (connection still requires the auth frame) |
| 51 | §6.21 | catch-up `as_of_seq` then events strictly ascending; event committed during catch-up build is delivered exactly once; after a boot `ClockAlarm`, a new socket's catch-up has `hub.clock_alarm` set (M37) |
| 52 | §6.21 | `SessionEnded` delivered then close `4401`; idle socket without pong terminated at 30 s; an open socket with pongs only does not keep the session past its TTL |
| 53 | §6.22 | login happy path; wrong password and unknown email both 401 with similar timing (within 2×); 10 failures → 429 |
| 54 | §6.23 | refresh rotates; reuse of rotated token → 401 and all user tokens revoked; concurrent refresh → one 200, one 401 |
| 55 | §6.24 | logout revokes own token; another user's token → `revoked: false`, still valid |
| 56 | §6.26 | seed creates roles per table, owner can log in to cloud and (after setup) to hub admin; duplicate email refused |
| 57 | §6.27 | new branch + code; reissue for `pending_hub` expires old code; reissue for `active` refused |

### 10.2 Platform, boot and race cases

| # | Case |
|---|---|
| 58 | Two concurrent retransmits of one new command: exactly one set of events; both get the same body (D32 re-check) |
| 59 | Parallel wrong PINs crossing the threshold while a correct PIN is verifying: correct PIN gets 429 (§3.5 step 7) |
| 60 | Two `/auth/pin` for different staff on one device at once: one 200, one 409 (partial unique index) |
| 61 | Two `/v1/hubs/register` with one code and different keys: one 200, one 401 |
| 62 | `events` UPDATE and DELETE raise (D52 triggers) |
| 63 | `seq` gap-free across 1 000 commands with forced rollbacks in between |
| 64 | Migrations: checksum change of an applied file → boot refuses; pre-migration backup is encrypted, decrypts to a DB with the old `user_version` |
| 65 | `encryptFile` / `decryptFile` round trip; a flipped byte fails the tag and writes no output |
| 66 | Clock guard: `Date.now()` ≤ max `recorded_at` → `ClockAlarm`, `branchNow` starts at max + 1 |
| 67 | Projection rebuild: checkpoint behind `MAX(seq)` → `reset` + replay gives the same rows as live application |
| 68 | Boot reconciliation: `SessionStarted` without `SessionEnded` and empty `staff_sessions` → `SessionEnded 'hub_restored'` |
| 69 | Sweeper ends idle staff and admin sessions at `ttl + ≤15 s`, never station sessions; multi-role TTL = max (M11) |
| 70 | `applyStaffDirectory` removing a staff member ends their sessions `'staff_removed'`; permission change takes effect on the next command |
| 71 | `HubStarted` carries `hub_down_at` from `hub_heartbeat`; null on first boot |
| 72 | Hub route inventory: every route has its guard set; adding an unguarded test route fails the test |
| 73 | Log redaction: no secret used by the auth suites appears in captured logs |
| 74 | Permission catalogue: a command declaring an unknown permission fails the unit test |
| 75 | `TenantScopedRepository` and `TenantLevelRepository` without a `TenantContext` throw (M25) |
| 76 | Cloud route inventory covers every route, including tenant-level ones (M25) |
| 77 | Cross-tenant: two seeded tenants; every scoped route with tenant A's JWT returns no tenant B row (M25) |
| 78 | Unit: `resolve()` truth table over denial / allowed / requires_approval / none, with multiple roles and multiple approvers |
| 79 | Smoke on target hardware: §7.8 targets |
| 80 | Phone pairing: `GenerateDevicePairingToken` for `phone` without `owner_staff_id` → 400; unknown owner → 404; pair → device has `owner_staff_id` (M38) |
| 81 | Phone login: owner → 200; another staff member with a correct PIN → `403 DEVICE_NOT_OWNED`, no PIN verified, no counter change, no takeover offered |
| 82 | Phone roster lists only the owner |
| 83 | `applyStaffDirectory` removing the owner revokes their phones in the same transaction (`DeviceRevoked { cause: 'owner_removed' }`, `actor_id` null), ends the phone session, closes its socket `4403`; other devices untouched |
| 84 | Pairing a phone whose owner was removed after the token was generated → `401 PAIRING_TOKEN_INVALID` |

### 10.3 Acceptance table

| Story AC | Test(s) |
|---|---|
| E0 PIN AC1 (unique PINs) | dropped (M27); none |
| E0 PIN AC2 (hub-local, argon2, no internet) | 31, 15 (directory from provisioning; no cloud call at login) |
| E0 PIN AC3 (actions attributed) | 1, 8, 10 (actor from session; station → null by M30) |
| E0 PIN AC4 (per-role idle logout) | 69 |
| E0 PIN AC5 (manager force logout, logged) | 43 |
| E0 PIN AC6 (staff and device lockout, clearable, logged) | 31, 32, 27, 44, 59 |
| E0 PIN AC7 (PIN distribution) | 15, 19, 70 (hub only receives hashes; 01 owns setting) |
| E0 PIN edge: shared device | 33, 34, 35, 60 |
| E0 PIN edge: guest WiFi | 36, 49 |
| E0 Hardware AC3 (pairing, manage-devices, audit; "any number of tablets or phones") | 26, 28, 29, 30, 42, 80, 82 |
| README R14 BYOD phones (owner-only login, revoke on exit) | 80–84 |
| E6 roles AC3 (grant levels, owner-only denied) | 9, 78 |
| E6 roles AC4 (most permissive across roles) | 9, 47, 78 |
| E6 roles AC6 (default role set) | 56 |
| E5 power loss AC2 (no manual action) | 14, 15 (exit 0 → systemd restart), 71 |
| E5 power loss AC3 (durable ack, idempotent retransmit) | 2, 3, 12, 58 |
| E5 power loss AC4 (migrations, projection rebuild) | 64, 67 |
| E5 power loss AC9 (restart audit with heartbeat) | 71 |
| E5 power loss AC10 (90 s, 00's share) | 79 |
| E5 device resilience AC3 (no lost order across restart, hub side) | 3, 58 |
| D38 setup protected by code, then 404 | 15, 16, 24 |
| D48 clock guard at boot and banner | 66, 51 |
| D51 lock release input (`SessionEnded` for every end) | 35, 38, 42, 43, 68, 69, 70 |
| D54 tenant scoping | 75, 76, 77 |
| M21 encrypted backups (00's part) | 64, 65 |

---

## §11. Build order

One task per commit; each cites its sections; TDD (tests from §10 first).

| # | Task | Files | Spec |
|---|---|---|---|
| 1 | Monorepo skeleton: pnpm workspace, Turborepo, root `vitest.config.ts` (`test.projects`), TS config, lint rule `no-restricted-imports` for the cloud DB client | `pnpm-workspace.yaml`, `turbo.json`, `vitest.config.ts`, `tsconfig.base.json`, `.eslintrc` | F §5.1, §6.7, M26 |
| 2 | `@pos/domain`: ids, error catalogue + `DomainError` + catalogue-coverage test, permission catalogue + test | `packages/domain/src/{ids,errors,permissions,enums}.ts` | §3.6, §9, F §6.2 |
| 3 | `@pos/events`: envelopes, codecs, 00 event schemas v1, WS unions (incl. `auth`), builders, fixtures | `packages/events/src/{envelope,codecs,ws}.ts`, `events/{hub,staff,station}/*.v1.ts`, `testing/`, `fixtures/` | §4.2, §6.21, F §6.5–§6.7 |
| 4 | Hub lib: clock (`branchNow`, fixed/stepping clocks), ID generator, semaphore, CIDR matcher, `encryptFile`/`decryptFile` | `apps/hub/src/lib/{clock,ids,semaphore,net,crypto-file}.ts` | §7.4, §7.9, F §4.7 |
| 5 | Hub config loader + atomic writer | `apps/hub/src/config/` | §3.10 |
| 6 | DB connection + migrations runner (checksums, encrypted pre-migration backup) | `apps/hub/src/db/{connection,migrate}.ts` | §3.8 step 1–1a, F §6.8, M21 |
| 7 | Migration 0001 (event store, `processed_commands` + `device_id`, checkpoints, heartbeat) | `apps/hub/src/db/migrations/0001_event_store.sql` | §5.1 |
| 8 | `appendEvents`, projection registry + checkpoints + rebuild, reducer registry, writer (commit-then-swap, publish hook) | `apps/hub/src/engine-host/{writer,state-holder}.ts`, `apps/hub/src/projections/registry.ts` | §3.7, §4.2, M17, F D45 |
| 9 | Fastify server, error handler, request id, logger redaction | `apps/hub/src/server.ts` | §7.1, §7.2 |
| 10 | Migrations 0002, 0003 | `apps/hub/src/db/migrations/0002_devices_sessions.sql`, `0003_staff_directory.sql` | §5.1 |
| 11 | `StaffDirectory` + `resolve` + `applyStaffDirectory` (incl. phone revoke on owner removal) | `apps/hub/src/auth/staff-directory.ts` | §3.6, M10, M11, M18, M38 |
| 12 | Route guards + hub route-inventory test | `apps/hub/src/auth/guards.ts` | §3.9 |
| 13 | Command registry + generic command route (incl. M19 replay) | `apps/hub/src/commands/registry.ts`, `apps/hub/src/commands/route.ts` | §3.7, §6.1 |
| 14 | Query registry + generic query route | `apps/hub/src/queries/registry.ts` | §6.2 |
| 15 | Boot orchestrator (steps 0, 1, 1a, 3a, 4, 4a, 7, 8), heartbeat, `/health` | `apps/hub/src/main.ts`, `apps/hub/src/lib/boot.ts` | §3.8, §6.3, F §5.8 |
| 16 | Cloud skeleton: server, error handler, env, migrations runner, migration 0001 | `apps/cloud/src/{main,server}.ts`, `apps/cloud/src/db/{migrate,client}.ts`, `migrations/0001_platform.sql` | §5.2, §7.7 |
| 17 | Cloud tenant-scope plugin (3 credentials), credential lookup, both repository classes, route inventory + repository tests | `apps/cloud/src/plugins/tenant-scope.ts`, `apps/cloud/src/db/{credential-lookup,tenant-scoped-repository,tenant-level-repository}.ts` | M15, M16, M25, F §3.4 |
| 18 | CLI `seed-tenant` + `default-roles.ts` | `apps/cloud/src/modules/staff-roles/{default-roles,seed-tenant}.ts` | §6.26, M29 |
| 19 | CLI `issue-registration-code` | `apps/cloud/src/modules/hub-registration/issue-code.ts` | §6.27, M22 |
| 20 | `POST /v1/hubs/register` | `apps/cloud/src/modules/hub-registration/{routes,service,repository,schemas}.ts` | §6.5, M14 |
| 21 | Hub `POST /setup/provision` + setup page | `apps/hub/src/setup/` | §6.4, §3.2, M13 |
| 22 | PIN verification + lockouts | `apps/hub/src/auth/pin.ts` | §3.5, M23 |
| 23 | `POST /admin/auth`, `POST /admin/auth/logout`, `GET /admin/login-roster` | `apps/hub/src/auth/admin-session.ts` | §6.6, §6.12, §6.13 |
| 24 | `GenerateDevicePairingToken`, station validator hook, phone owner | `apps/hub/src/commands/generate-device-pairing-token.ts` | §6.7, M31, M38 |
| 25 | `POST /devices/pair` | `apps/hub/src/auth/pairing.ts` | §6.8, M38 |
| 26 | `POST /auth/pin` (takeover, phone owner check), `POST /auth/logout` | `apps/hub/src/auth/staff-session.ts` | §6.9, §6.10, M6, M20, M38 |
| 27 | `POST /auth/station` | `apps/hub/src/auth/station-session.ts` | §6.11, M30 |
| 28 | Session sweeper, boot reconciliation, retention | `apps/hub/src/auth/session-sweeper.ts` | §3.4, §5.1, §7.3 |
| 29 | `RevokeDevice`, `ForceLogoutSession`, `ClearPinLockout` | `apps/hub/src/commands/{revoke-device,force-logout-session,clear-pin-lockout}.ts` | §6.14–§6.16 |
| 30 | Queries: devices, sessions, staff-roster, session | `apps/hub/src/queries/{devices,sessions,staff-roster,session}.ts` | §6.17–§6.20 |
| 31 | WS server: auth frame, catch-up registry, audiences, publish, keepalive, closes | `apps/hub/src/ws/{server,catch-up,audience}.ts` | §6.21, M12, M24 |
| 32 | CORS | `apps/hub/src/server.ts` | §7.5, M35 |
| 33 | Cloud `POST /v1/auth/login`, `/refresh`, `/logout`, JWT plugin | `apps/cloud/src/plugins/jwt.ts`, `apps/cloud/src/modules/owner-auth/` | §6.22–§6.24, M33 |
| 34 | Cloud `GET /v1/health`; cross-tenant test suite | `apps/cloud/src/modules/health/`, `apps/cloud/test/cross-tenant.int.test.ts` | §6.25, M25 |
| 35 | systemd unit (`Restart=always`, `After=time-sync.target`) + smoke test on hardware | `apps/hub/deploy/hub.service`, `apps/hub/test/smoke/` | §7.8, M13, M36, F §5.8 |
| 36 | Append §9 codes to foundation §6.2 and `errors.ts`; README status → Implemented | `docs/specs/00_Foundation_Spec_v1.7.md`, `packages/domain/src/errors.ts`, `docs/specs/README.md` | §9, D64 |

36 tasks, inside the 60-task budget.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

- Every §10 test exists with its `[00 §10 #n]` name and passes; `grep` finds exactly one test per number.
- Hub and cloud route-inventory tests and the cross-tenant test pass.
- §7.8 targets met on the pilot hub hardware (or the gap recorded in `docs/reviews/`).
- No secret appears in logs (test 73).
- §9 codes appended to foundation §6.2 and `errors.ts`.
- README status updated; spec version bumped to v1.0 at approval.

### 12.2 Endpoint checklist

| § | Route / command | Auth | Permission | Idempotency | Events | Tests |
|---|---|---|---|---|---|---|
| 6.1 | `POST /commands/:name`, `/admin/commands/:name` | device+session / admin | per command | D32 + M19 | per command | 1–12, 58 |
| 6.2 | `GET /queries/:r`, `/admin/queries/:r` | device(+session) / admin | per query | n/a | — | 13 |
| 6.3 | `GET /health` | none | — | n/a | — | 14 |
| 6.4 | `POST /setup/provision` | code | — | M14 | `HubProvisioned`, `StaffDirectoryApplied` | 15–21 |
| 6.5 | `POST /v1/hubs/register` | code (M15) | — | M14 | — (log) | 22–25, 61 |
| 6.6 | `POST /admin/auth` | none | `access-hub-admin` | none needed | `SessionStarted`, lockouts | 26, 27 |
| 6.7 | `GenerateDevicePairingToken` | admin | `manage-devices` | D32 | `DevicePairingTokenGenerated` | 28, 80 |
| 6.8 | `POST /devices/pair` | pairing token | — | M14 | `DevicePaired` | 29, 30, 84 |
| 6.9 | `POST /auth/pin` | device | — | M6 replace | `SessionStarted`, `SessionEnded`, lockouts | 31–37, 59, 60, 81 |
| 6.10 | `POST /auth/logout` | device+session | — | natural | `SessionEnded` | 38 |
| 6.11 | `POST /auth/station` | device (kds) | — | replace | `SessionStarted`, `SessionEnded` | 39 |
| 6.12 | `POST /admin/auth/logout` | admin | — | natural | `SessionEnded` | 40 |
| 6.13 | `GET /admin/login-roster` | none | — | n/a | — | 41 |
| 6.14 | `RevokeDevice` | admin | `manage-devices` | D32 | `DeviceRevoked`, `SessionEnded` | 42 |
| 6.15 | `ForceLogoutSession` | admin | `manage-staff` | D32 | `SessionEnded` | 43 |
| 6.16 | `ClearPinLockout` | admin | `manage-staff` | D32 | `PinLockoutCleared` | 44 |
| 6.17 | `GET /admin/queries/devices` | admin | — | n/a | — | 45 |
| 6.18 | `GET /admin/queries/sessions` | admin | — | n/a | — | 45 |
| 6.19 | `GET /queries/staff-roster` | device | — | n/a | — | 46 |
| 6.20 | `GET /queries/session` | device+session | — | n/a | — | 47 |
| 6.21 | `GET /ws` | auth frame | — | n/a | pushes | 48–52 |
| 6.22 | `POST /v1/auth/login` | none (allowlist) | — | none needed | — | 53 |
| 6.23 | `POST /v1/auth/refresh` | none (allowlist) | — | rotation | — | 54 |
| 6.24 | `POST /v1/auth/logout` | JWT | — | natural | — | 55 |
| 6.25 | `GET /v1/health` | none (allowlist) | — | n/a | — | — (smoke) |
| 6.26 | CLI `seed-tenant` | shell | — | refuses duplicate | — | 56 |
| 6.27 | CLI `issue-registration-code` | shell | — | reissue (M22) | — | 57 |

### 12.3 Open questions

| # | Question | Blocks |
|---|---|---|
| MQ5 | **Default role TTLs** (Owner 60, Manager 60, Cashier 30, Order taker 5 min): confirm with the restaurant owner. | Nothing in code (seed values); pilot comfort |
| MQ6 | **02 device queue policy** for commands never processed whose session ended: re-login as the original staff to send, or discard (M19). | 02 spec |
| MQ7 | **Capacitor LAN transport:** confirm `androidScheme: 'http'` + private-range cleartext config against current Capacitor docs and the pilot tablets' Android version (OQ2). | 02 client build |
| MQ8 | **06 backup key availability:** restoring a USB backup onto a *replacement* hub needs `backup_encryption_key`, which lives only in the dead hub's config (M21). Options for 06: key printed on the install record and kept by the owner; or escrowed to the cloud encrypted. | 06 spec (§5.10 source b) |
| MQ9 | **Vitest 5** (5.0.0 released 2026-09-03): stay on 4.x per foundation §6.7, or record an upgrade decision. | Nothing now |
| MQ10 | **iOS checks on a real iPhone** (current iOS on the pilot staff phones): (a) the home-screen app saved from `pair_url` opens on the full URL **including the `?t=` query string**; (b) `navigator.standalone` is `true` there and `false` in Safari; (c) the home-screen app keeps its IndexedDB device token past 7 days without use; (d) the full flow fits inside the 10-minute token TTL for a typical staff member. If (a) fails, a fallback is needed (e.g. the pair page puts the token in the URL path) — record it as a spec change. | Phone client work (02 or later) |

Closed in v0.2: MQ1 (M27), MQ2 (M28), MQ3 (M29), MQ4 (M30).

### 12.4 Deferred until needed

| Item | Why deferred |
|---|---|
| Rate limit on `/v1/hubs/register` | 60-bit codes with a 24 h TTL make guessing infeasible. Revisit when codes are issued by an HTTP route (M2). |
| bcrypt verification | M8. Revisit only if PINs are imported from another system. |
| HTTP route to issue registration codes | M2. Revisit with replace-hub UI (06) or P3 onboarding. |
| Sliding-window device lockout | Fixed window is enough given the per-staff limit (§3.5). |
| WS backpressure handling | LAN, tens of sockets, small frames. Revisit if a KDS falls behind (dropped pongs would show it first). |
| Security headers / CSP on hub-served pages | LAN-only, same-origin, no third-party content. Revisit when customer-facing pages ship (P2, D20). |
| Session takeover permission | M20, confirmed by the owner (README R11): any staff member with a correct PIN may take over. An owner setting comes later; revisit then. |
