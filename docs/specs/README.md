# Spec index

Specs are the source of truth (CLAUDE.md). Module specs inherit the Shared Standards in the foundation spec (§6) and do not redefine them. The foundation is frozen at v1.7 (D64): later issues are fixed in module specs or covered by unit tests.

**File naming:** `NN_<Module>_Spec_v<major>.<minor>.md`. `NN` is the build order below (`03a`/`03b` keep the shared number). On a version bump the file is renamed and this index is updated in the same commit. The frozen foundation keeps its file name `00_Foundation_Spec_v1.7.md` and is listed as row **F**; module `00` is Hub Platform & Access (R2).

## Module map

This map replaces the "Suggested module spec order" table in foundation §9 (R2).

| # | Spec | Version | Status | Stories | Depends on | Blocked by |
|---|------|---------|--------|---------|------------|------------|
| F | [Foundation](00_Foundation_Spec_v1.7.md) | v1.7 | APPROVED — FINAL | All P1 (architecture, state machines, Shared Standards) | — | — |
| 00 | [Hub Platform & Access](00_Hub_Platform_Access_Spec_v1.0.md) | v1.0.1 | **APPROVED** (2026-10-23) — Reviews 1 and 2 applied; v1.0.1 patch closes MQ12 (M77) (`docs/reviews/00_review_1.md`, `00_review_2.md`) | E0 PIN login; E0 hardware AC3 (pairing, incl. staff phones R14); E6 roles AC3, 4, 6 (hub permission checks, default roles); E5 power loss AC2–4, 9, 10 (platform part); event store, command registry, migrations, provisioning, sessions, cloud owner auth | F | — |
| 01 | Restaurant Setup (+ cloud staff/role admin) | — | Not started | E1 (floors, stations, batch programs, menu, stock); E6 roles AC1, 2, 5, 7; D40 PIN set/reset; staff-to-branch assignment (R3) | 00 | — (OQ1 is installation only, R9; OQ14 non-blocking, R8) |
| 02 | Ordering + Tables | — | Not started | E2, part of E5 (device command queue) | 01; 03a engine core | — |
| 03a | Timing Engine (package + hub host) | — | Not started | E4 engine (`@pos/engine`); hub engine host: reducer registration, snapshots, replay, fire-scheduler tick, missed fires (§5.8 steps 2, 3, 6) (R4) | 00; event payload types from 02 | OQ4 only (overrun handling; tap-rate field test, D43) |
| 03b | KDS + Printing | — | Not started | E3 (KDS, station-scoped commands, printing, slip warnings on screens) | 02, 03a | — (printers non-blocking, R8) |
| 04 | Voids + Audit | — | Not started | E6 item lifecycle, pending void (D11), immutable audit log view | 02, 00 | — |
| 05 | Billing | — | Not started | E8 (payments, shifts, Z report, blind count, tax invoices) | 04 | — (OQ3 answered R7; OQ15 deferred R13) |
| 06 | Offline + Sync | — | Not started | E5 in full (sync, device queue, backup, hub restore) | 01–05 | — (OQ10, OQ11 answered R10) |
| 07 | Owner View | — | Not started | D22 (cloud projections, read-only dashboard) | 05, 06 | — |

**Build-order note:** 02 calls `calculateETA` and needs the hub engine host, both owned by 03a. 03a is built **before or alongside 02**, even though it is numbered after it (R4).

## Spec size budget

- A module spec covers about **10–25 commands/endpoints**.
- **Split** a spec that grows above ~30 commands/endpoints or ~60 build tasks.
- **Merge** a spec that has fewer than 5 commands/endpoints into its neighbour.
- Each split or merge is recorded below as a README decision and in the module map.

## Module spec approval checklist

Every module spec is checked against this list before its status moves to Approved. A reviewer ticks every line in the review file in `docs/reviews/`. One unticked line blocks approval.

**Section order (Module mode, exactly these 12 sections, in this order):**

- [ ] §1 Header: module name, version, depends on (spec + version), stories covered, in scope, out of scope, "inherits Shared Standards from Foundation v1.7".
- [ ] §2 Existing architecture that must not change (from the foundation and earlier modules).
- [ ] §3 Domain rules specific to this module (state machines, eligibility, conflicts, module decisions).
- [ ] §4 Contracts: what it consumes and what it exposes. Later modules rely only on what is listed here.
- [ ] §5 Data model and migrations (tables, columns, constraints, indexes with the query each one serves).
- [ ] §6 Endpoints, commands and events in the Phase 3 format, in batches of about 8.
- [ ] §7 Cross-cutting items for this module only, each YAGNI-justified.
- [ ] §8 Client contract (if the module has clients).
- [ ] §9 Error catalogue additions.
- [ ] §10 Tests: per-endpoint integration cases, concurrency and race cases, acceptance table (story AC → test).
- [ ] §11 Build order: an ordered checklist with target files, each item citing spec sections.
- [ ] §12 Definition of Done, final endpoint checklist, Open Questions, Deferred until needed.

**Inherits foundation §6 (does not redefine it):**

- [ ] §6.1 envelope: every response is `{ data }` or `{ error }`; no 204; idempotent replay returns the stored response with `Idempotent-Replay: true`.
- [ ] §6.2 errors: every new code is `<SUBJECT>_<CONDITION>`, has a status from the status map, a typed `details` shape and the condition that returns it; no existing code is renamed or reused.
- [ ] §6.3 hub HTTP: commands go through `POST /commands/:name` via the registry; each per-command script is a subset of the fixed processing order; queries make no writes and use a fixed number of SQL statements.
- [ ] §6.4 cloud HTTP: `/v1` prefix; `Idempotency-Key` on creating `POST`s (or a recorded reason why not); tenant guard on every route.
- [ ] §6.5 WS: new message types are added to the `WsServerMessage` / `WsClientMessage` unions; catch-up part defined per role.
- [ ] §6.6 naming: one fact per event (`<Subject><PastTenseVerb>`), commands `<Verb><Subject>`, snake_case on the wire, `_at` / `_ms` / `_minor` suffixes.
- [ ] §6.7 tests: per hub command, happy path + one test per error code + retransmit test (D32) + COMMIT-failure test where the engine is touched (D45); numbered spec tests cited in test names.
- [ ] §6.8 migrations: forward-only `NNNN_<name>.sql`; no edits to merged files; money as `_minor` integers; times as Unix ms.
- [ ] §6.9 folders: new files only inside the listed folders.

**Consistency:**

- [ ] Every foundation section the spec overrides is named in a decision with its reason (D64 freeze rule).
- [ ] Status codes match between §6 endpoints and §9 error catalogue; permissions used exist in the permission catalogue.
- [ ] No forward reference to an unwritten module except through an "Exposes" contract.
- [ ] Size is inside the spec size budget.
- [ ] Hostile self-review done: races, idempotency gaps, missing indexes, N+1, privacy leaks, over-engineering.

## README decisions (after the foundation freeze)

The foundation is frozen (D64). Owner answers and structural decisions that change a foundation default are recorded here and applied in the module spec that owns the topic.

| # | Decision | Effect | Applied in |
|---|----------|--------|------------|
| R1 | **OQ10 answered:** hosting in India is **not** acceptable. Final region: see R10. | Overrides the D57 default of AWS ap-south-1 (Mumbai) in foundation §1 (stack table) and §5.3 (architecture diagram). | 06 Offline + Sync / 07 Owner View |
| R2 | **Module map replaced.** New module 00 Hub Platform & Access holds the event store, command registry, migrations runner, provisioning, device pairing, PIN/session and permission checks. Timing Engine + KDS is split into 03a (package + hub host, R4) and 03b (KDS + Printing). Roles + Audit becomes 04 Voids + Audit, because permission checks move to 00. | Replaces the foundation §9 module order. | This README |
| R3 | **Spec 00 MQ1 answered:** 01 Restaurant Setup owns cloud staff/role admin, PIN set/reset and staff-to-branch assignment. 00 keeps the `seed-tenant` CLI for dev and testing. Duplicate PINs are allowed (login is staff + PIN); the E0 PIN AC1 uniqueness rule is dropped unless 01 finds a reason. | 01 scope grows; E0 PIN AC1 dropped | 00 (M27), 01 |
| R4 | **Spec 00 MQ2 answered:** 03a is renamed "Timing Engine (package + hub host)" and owns the hub engine host (§5.8 steps 2, 3, 6). | 03a scope grows; build order | 00 (M28), 03a |
| R5 | **Roles are fully custom** (E6, D19 confirmed) and the number of devices per branch is **unlimited**. **New client requirement:** every UI view derives from the logged-in staff member's effective permissions (00 `GET /queries/session`); there are no role-named screens. The order-taker view is one shared view whose actions appear or hide per permission. | No fixed role list or device cap anywhere in code or UI | 02 and all later client work |
| R6 | **Volume design assumption:** 2,000 orders per day per branch (≈ 40,000 events per day) until a real count from the pilot arrives. | Sizing input for snapshots and replay | 03a |
| R7 | **Payments: no card-terminal integration** (card amount entered manually; answers OQ3). **New:** an "online" payment mode (bank transfer, wallets, Raast). Payment modes are an **owner-configurable list**, not a fixed enum. | Adds to E8 | 05 |
| R8 | **Printers:** small thermal ESC/POS. Support both 58 mm and 80 mm paper and both USB and LAN connections until the models are confirmed. OQ14 is **non-blocking**. | Printer layer must handle both widths and both transports | 03b |
| R9 | **Hub hardware:** a PC and a UPS already exist. Open: can that PC be dedicated to the hub on Linux? If not, buy a mini PC. **OQ1 stays open for installation only**; it blocks no spec. | Installation guide | installation |
| R10 | **Cloud: AWS me-central-1** with the smallest footprint (D57 shape: one small instance, smallest single-AZ managed Postgres). **OQ11 = keep it minimal.** | Overrides foundation §1 / §5.3 "ap-south-1". Unblocks 06 and 07 | 06, 07 |
| R11 | **Takeover default confirmed:** any staff member with a correct PIN may take over a shared device (00 M20). An owner setting may restrict it later. | No change to spec 00 behaviour | 00 |
| R12 | **New: fully customizable receipt template** with variables (business name, NTN / tax IDs, address, footer, and others). | Extends the E0 receipt-template story | 05 (content and variables), 03b (rendering and printing) |
| R13 | **Tax-authority integration (PRA / FBR) deferred to the end** (D9). **OQ15 no longer blocks P1.** Risk: restaurant sales tax in Punjab is generally collected by PRA; confirm the requirement before P3 sales. | Overrides D58 (PRA as a conditional P1 blocker) and foundation §3.5 / §7 OQ15 status | 05 |
| R14 | **New device class: staff personal phones (BYOD), including iPhones.** Hub-served browser client (no install, QR pairing); device type `phone`; each phone owned by one staff member and revoked when they leave. | Spec 00 change (v0.3, M38) | 00, 02 and later client work |
| R15 | **Foundation bug — service workers on the LAN.** Service workers only run on secure origins; the hub is plain HTTP, so D56's "service worker for assets" does not work. **Kiosk:** launch Chrome/Edge with `--unsafely-treat-insecure-origin-as-secure=http://<hub-ip>:3000`. **Phones:** no service worker; IndexedDB command queue only; acceptable because nothing works without the hub. **All browser clients:** no secure-context-only APIs (e.g. `crypto.randomUUID`, `crypto.subtle`); ULIDs use `crypto.getRandomValues`. | Overrides D56 (foundation §8 "Native desktop shell" row: service worker for assets) | 00 §8.2, 02 and all client work, kiosk install |
| R17 | **QR codes:** hub-served pages and the hub CLI use one library, `qrcode@1.5.4`, rendered on the hub (SVG for pages, terminal for the CLI). Later modules that need a QR (e.g. 03b, 05 receipts) reuse spec 00's `qrSvg` helper instead of adding a library. | Closes spec 00 MQ12 | 00 (M72, M77), 03b, 05 |
| R16 | **LAN plaintext risk accepted for P1** (owner sign-off pending, spec 00 MQ11): PINs and bearer tokens cross the staff WiFi unencrypted (D28). Mitigation: personal phones (R14) join a **separate SSID with client isolation** that can reach only the hub port; restaurant devices stay on the staff SSID. LAN TLS revisited at P3. | Installation checklist; spec 00 M54 | installation, 00 |

## Requirements carried to other modules

Raised while writing an earlier spec; the receiving module spec must address each one (and cite it) before approval.

| To | Requirement | From |
|----|-------------|------|
| 01 | Register `registerStationValidator` on the hub so KDS pairing can bind a station; append new permissions with default role grants to `default-roles.ts`; bump `tenants.directory_version` on every staff/role change. | 00 §4.2, M29, M31 |
| 02 | **Queued-command policy after session end:** a device command that was never processed and whose session has ended is either re-sent after re-login as the original staff, or discarded. Replay of already-processed commands is handled by 00 (M19). | 00 M19, MQ6 |
| 02 | Capacitor LAN transport: confirm `androidScheme: 'http'` and a cleartext policy limited to private ranges. | 00 §8.1, MQ7 |
| 03a | `EngineState` drops BILLED and CANCELLED orders; the replay checkpoint is the last day-close; estimate events per day from real order volume to size snapshots and replay against the 90 s budget. | owner review of 00 v0.1 |
| 03b | `StartItem` / `DoneItem` are `stationScoped` commands; their events carry `actor_id = null` and the KDS `device_id` (station sessions, 00 M30). | 00 M30 |
| 06 | **Encrypted USB backups:** nightly backups are encrypted (00 `encryptFile`, AES-256-GCM) with `backup_encryption_key`, kept only in the hub config file and never on the USB drive. Solve key availability for restoring a USB backup onto a replacement hub. | 00 M21, MQ8 |
| 06 | Call `applyStaffDirectory` on every staff/role push; write `ClockAlarm { source: 'cloud_offset' }` using 00's event schema. | 00 §4.2 |
| 06 | Call `setMaintenanceHour(h)` with the D63 quiet hour so 00's retention runs then (00 M66). Restore (§5.10) relies on 00's forward access reconciliation (00 M40); the restore flow must append the cloud tail before 00's boot step 4. | 00 M40, M66 |
| 06 | **Admin access after replace-hub restore:** after any restore (§5.10), call 00's `issueAdminBootstrap(tx, 'restore')` and show the first-admin link to the installer, so a restored hub (especially from the cloud only, with no paired devices) is never locked out (00 M72). | 00 M72, Review 2 N1 |
| 06 | **Re-apply the cloud directory after a USB restore, before accepting logins:** the restored staff cache can be older than the last directory the hub applied, so staff removed after the backup could log in. Fetch and `applyStaffDirectory` the current cloud directory before the hub opens `/auth/*` (00 M51 accepts it because its version is newer). | Review 2 note A |
| 01 / 07 | **Tell the owner about a locked login out of band** (e-mail or dashboard notice on the next successful login): since 00 M73 a locked owner account answers `401` like a wrong password, so the owner cannot see the lock in the login response. | 00 M73, Review 2 N2 |
| 01 | No `is_admin_role` flag: admin access is the `access-hub-admin` permission; the "at least one admin" guard (E6 AC7) checks that permission (00 M57). The cloud `idempotency_keys` store (§6.4) is built in 01, its first user (00 M69). Staff-role edits bump `tenants.directory_version` strictly upward (00 M51). | 00 M51, M57, M69 |
| 02 | Queries that clients poll must not declare `countsAsActivity: true`; only user actions keep a session alive (00 M59). | 00 M59 |
| 05 | **Open cash shift on takeover:** when a takeover (00 M20, R11) ends a cashier's session on the cashier kiosk while their shift is open, define what happens to the shift (hand over, block takeover on an open drawer, or require the shift to be closed first). | Review 1 #38 |
| 02 + client | UI views derive from effective permissions; one shared order-taker view (R5). Browser clients (kiosk, KDS, phones) use no service worker except the flagged kiosk, no secure-context-only APIs, IndexedDB command queue, ULIDs from `crypto.getRandomValues` (R15). Phone client: hub-served, QR pairing, owner-only login (R14, 00 M38); on iOS Safari the pair page does not pair: the staff member adds it to the Home Screen and pairs from the home-screen app (00 §8.2); verify on a real iPhone that the saved URL keeps `?t=` (00 MQ10). | README R5, R14, R15 |
| 03a | Size snapshots and replay for **2,000 orders/day/branch (≈ 40k events/day)** with the day-close checkpoint, against the 90 s boot budget (R6). | README R6 |
| 03b | ESC/POS on 58 mm and 80 mm paper, USB and LAN printers (R8); render the customizable receipt template (R12). | README R8, R12 |
| 05 | Owner-configurable payment-mode list including an "online" mode (bank transfer, wallets, Raast); card amounts entered manually, no terminal integration (R7). Customizable receipt template with variables (R12). PRA/FBR integration out of P1 (R13). | README R7, R12, R13 |
| Installation | Decide whether the existing PC can be dedicated to the hub on Linux, else buy a mini PC (OQ1, R9). Kiosk shortcut with the insecure-origin flag (R15). Separate phone SSID with client isolation, reaching only the hub port (R16). Hub OS time zone set to the restaurant's local zone (00 M66 maintenance hour). | README R9, R15 |

**Still open:** OQ1 (hub hardware, installation only, R9); OQ2 (tablet model, Android version); OQ4 (tap-rate field test, blocks 03a overrun handling only). OQ3, OQ10, OQ11, OQ14 and OQ15 are answered or made non-blocking by R7, R10, R8 and R13.

Open questions and blockers are tracked in the foundation spec §7. Decisions are logged in `docs/stories/stories-refined.md` §1. Reviews go in `docs/reviews/`.
