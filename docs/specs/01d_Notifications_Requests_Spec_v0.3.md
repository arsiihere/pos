# 01d — Notifications and requests — Module Spec v0.3 (DRAFT, G4 pending)

## §1. Header

| | |
|---|---|
| Module | 01d Notifications and requests |
| Version | **v0.3 — DRAFT** (2026-11-01, G2 completeness check applied: `docs/reviews/01d_v0.2_g2_completeness.md`, 0 BLOCKER, 10 MAJOR, 17 MINOR). Next: G4 hostile review in a fresh session. v0.2: developer review of v0.1. v0.1: first draft from G0 + G1. |
| Inherits | Shared Standards from **Foundation v1.7** §6 (envelope, error naming, hub HTTP and WS conventions, naming, tests, migrations, folders). Not redefined here. |
| Depends on | Foundation v1.7; **00 Hub Platform & Access v1.5** (command and query registry, writer, WS, sessions, PIN check, directory); **01b Staff and Roles v1.3** (effective permission with scope and approvers, `leadOf`, `teamOf`); **01a Restaurant Setup v2.0** (business day events only; 01d changes nothing in 01a) |
| Inputs | `docs/stories/01d-g0-decisions.md` (G0 register, with G1 markers), `docs/stories/01d-g1-decisions.md` (G1 record, G1-1 … G1-24), `docs/stories/01d-notifications-teams-refined.md` (2026-10-27 owner record) |
| Tier | T2 Production (CLAUDE.md). Races that matter here: two answers at once (first wins), answer vs. close, raise twice for one subject. |
| Changes other specs | §4.5 (R26). Every change there is **Proposed — needs approval** and is applied by version bump at approval, not by this draft. |

### Changes in v0.3 (G2 completeness check, 2026-11-01)

Finding numbers are the G2 review's (`docs/reviews/01d_v0.2_g2_completeness.md` §1). Rulings by the developer where the review left a choice; owner answers by the developer as the owner's proxy, 2026-11-01.

| # | Change | G2 finding | Sections |
|---|---|---|---|
| 1 | **Tick pre-check.** One read-only statement outside the lock (`alerts_due` + `alert_flags`) decides whether to open `writer.run`; the select inside `writer.run` stays authoritative (race rule kept). Test 22 = no `writer.run` when idle; test 34 rewritten for the single synchronous connection. | 1, §0 | §3.5, §7, §10 tests 22, 34 |
| 2 | **One clock, separate transactions.** `registerTick({ name, due(db, state, now), intents(tx, state, now) })`; each registered tick (01d alerts, later 03a fires) gets its own `writer.run`, opened only when its `due` is true; a throwing tick is logged and does not stop the others. | 1, 4 | §3.5, §4.2, §4.3 To 03a, §10 test 37 |
| 3 | **`routesFor` is batch-shaped:** `routesFor(tx, staffIds[]) → Map`, one statement per registered route per tick; the tick's statement bound counts it. | 6 | §3.4.3, §3.5, §3.8, §10 test 35 |
| 4 | **Foundation WS rows:** C-F F-5 (§6.3 `/ws` row), F-6 (§5.4), F-7 (§6.5); H-2 now cites 00 §6.21 and `ws.ts`. | 2 | §4.5 C-F, C-00 |
| 5 | **Catch-up interface:** C-00 H-7, `build(db, state, socketCtx)`; alert-mode sockets kept in a separate list outside `deliver()`, audiences and catch-up. | 3 | §3.7, §4.5 H-1, H-7, §6 batch 3 |
| 6 | **`session_id` on `device_bindings`;** bindings rebuilt exactly from `SessionStarted` / `SessionEnded` (incl. `hub_restored` after a restore). | 5 | §3.7, §5.1, §5.2, §10 test 27 |
| 7 | **Retention:** `alert_recipients` purged with its alert (`ON DELETE CASCADE` on every child table, ordered batches); the sweeper timer catches and logs (C-00 H-8). | 7 | §5.1, §4.5 H-8, §10 test 38 |
| 8 | **`alert_seen` frame** so the 10 s urgent repeat stops on all of the person's devices (G1-14a). | 8 | §3.6, §6 batch 3, §8.3, H-2, §10 test 39 |
| 9 | **Per-request `no_approver` deferred** to §12.4; the per-permission warning stays. Test 10 updated. | 9 | §3.3 rule 5, §3.9, §12.4, §10 test 10 |
| 10 | **APK update, pilot minimum:** `GET /app/android/latest`, `GET /app/android/<version_code>.apk`, developer CLI `app-release add` / `mark-good` (C-00 H-5). No other staging state. | 10 | §8.4, §4.5 H-5, §6.11 bis, §10 test 40 |
| 11 | **Directory bound raised** for `no_pin_staff` (C-01b B-5, R32 c); **`pager_ids` moved** to 01e's 01b bump. | 11, 12 | §4.5 C-01b, §5.1, §4.3 To 01e |
| 12 | `permission: null` wording; `pinCheck` placement after the idempotency fast path, its errors; full tick reads list and bound; idle-session lag; step `to` is a list; "for Ali" rows; device-target sockets; no event push of `RequestAnswered` / `RequestWithdrawn`; `SendTestAlert` payload and key; in-transaction dedupe in `raise`; receipt buffer on commit, empty flush skipped, dedupe before buffering, **receipt rate limit dropped**; `alert-receipts` reads step events by subject stream; missing tests; exact §4.5 sections; decision records. | 13–27 | §3.3–§3.9, §4.2, §4.5, §6, §7, §10, §12 |
| 13 | **Owner answers:** Q3 confirmed (no one answers their own request); **G1-20 kept** — "Present today" is no longer marked proposed. | 27 | §1, §3.4.1, §3.11, §6.6, §12.3 |

### Changes in v0.2 (developer review of v0.1, 2026-11-01)

| # | Change | Sections |
|---|---|---|
| 1 | No `permission: null`: commands that check their right in the handler declare `permission: 'checked-in-handler'`, which the registry accepts only for a fixed list (`AnswerRequest`, `WithdrawRequest`, `MarkAlertsSeen`); a test proves each listed handler runs its right check. `pinCheck` stays. | §4.5 H-3, §6.2–6.4, §10 test 33 |
| 2 | Q4 → tick: day-close expiry and the `no_approver` check run on the 01d tick (≤ 500 ms after the cause); H-7 (`writer.onAppended`) dropped. | §3.5, §3.9, §4.5 C-00, §5.2 |
| 3 | Q9 → constants: approval timings and the PIN-per-kind map are one constants module (`ALERT_CONSTANTS`) with the G0 / G1 values; no 01a change (C-01a removed). Configurable timings and "a branch may add a PIN to accept kinds" (G1-10e) moved to §12.4 as post-pilot settings (R18). | A7, A14, §3.3, §3.5, §4.1, §4.3, §4.5, §5.4, §8.1, §10 test 11, §11, §12.1, §12.4 |
| 4 | Race rule: the tick selects due alerts **inside** `writer.run` (`BEGIN IMMEDIATE`), never before. New test: answer racing the tick never writes a step after `RequestAnswered`. | §3.5, §10 test 34 |
| 5 | Batched reads per tick and per raise: a fixed statement count, independent of the number of alerts; resolvers registered by later modules are batch-shaped. New test counts statements. | §3.4, §3.5, §4.2, §10 test 35 |
| 6 | §12.3 answered (developer, 2026-11-01): Q1 managers = branch-scope `force-release-table-lock`; Q2 `manage-staff`; Q3 no self-answer for anyone, with the step-0 and `no_approver` fallback (developer answer, owner to confirm); Q4 tick; Q5 00; Q6 agreed; Q7 text; Q8 403 `not_approver`; Q9 constants. | §3.3, §3.4, §3.9, §3.11, §4.5, §5.1, §12.3 |

Words used here: **alert** = one notification record; **request** = an alert that waits for an answer; **kind** = a registered alert type; **step** = one scheduled send of an alert; **route** = a way an alert reaches a person or device (screen, alert connection, pager); **answerer** = a person who may answer a request; **informed** = a person told read-only; **binding** = the person whose alerts a session-less device shows.

### Stories covered

| Story | Part covered here |
|---|---|
| E-NOTIF (refined stories §1) | AC1 targets (person, permission, team; plus table's team and point devices as registered resolvers), AC2 R1 screen and R3 escalation, R2 for **restaurant tablets** (the alert connection of §3.7 and the app's background service), AC3 no internet, AC6 audit. AC4 iPhones unchanged (R22). AC5 only for approvals (§3.9); the general warning is deferred (§12.4). |
| E-REQ | AC1–AC7 for every request kind, owned once here (G1-7). |
| E6-TEAM | Use of the team tree as a target (`teamOf`, walk rules §3.4). |
| README "To 01d" rows | Targets, routes, escalation, requests answered with the answerer's own PIN, checked on arrival, first answer wins, in-person fallback (row "01d — Notification targets…"); directory changes stay additive (§4.5 C-01b); the thin Android app is narrowed to restaurant tablets (G1-15, G1-19); cross-team task requests deferred (§12.4). |

### In scope (pilot)

- The alert record, kinds, steps, escalation, the tick that sends steps (§3.1–§3.6).
- Requests: answer rules, PIN per kind, in-person fallback, withdraw, close by the owning module, result to the requester (§3.3).
- Targets and their resolution, including the interfaces later modules register (§3.4).
- Routes: screen (staff-session WS), the device-level **alert connection** (§3.7), and the **route interface** 01e plugs the pager into (§3.8).
- Delivery receipts (delivered, seen), batched on `audit`; request seen on the subject stream (§3.6).
- "No one can approve" warning per permission (§3.9), the `test_alert` kind (§3.10), "Present today" (§3.11; G1-20 kept, owner answer 2026-11-01).
- Inbox and request queries (§6 batch 2), alert frames (§6 batch 3).
- Android tablet app: background service, lock-screen text, hub-hosted silent update with the pilot-minimum endpoints (§8, §4.5 H-5).

### Out of scope

- **01e Device gateway (pilot, mandatory, own spec after the hardware spike):** compact device protocol, `pager_bridge`, headless pairing, ESP32 station button devices, the pager route itself, pager assignment by shift, device health (G0 D3–D5, G1–G7, G1-17a). 01d only defines the route interface (§3.8).
- Kitchen and serving model, zones, zone stock, comps, lanes (G0 §4, §5, §5a): owned by 01a, 01b, 02, 03a, 03b, 05. Those modules register their kinds and resolvers here (§4.2).
- The request kinds of other modules (void 04, discount 05, comp 02/05, table handover 02, zone-stock transfer 01a/02, Ready to serve 03a/03b, slip warning 03a): each module registers its own kind and handler. 01d ships `test_alert`, `request_result` and `no_approver` only (§3.10).
- Personal-phone alert app (G1-19), general "no route" warning, everything in §12.4.

---

## §2. Existing architecture that must not change

- **Foundation §4.1:** every state change is an event; events are append-only; `stream_type` enum stays `order, table, station, stock, shift, audit, hub, staff` (no new value).
- **Foundation §6.3:** commands travel over HTTP only (`POST /commands/<name>`), one command = one transaction; queries never write. Alert frames over WS are pushes, not commands; the only device → hub WS data frame added (`receipt`) records a delivery fact, not a staff action (§6, batch 3). The `/ws` auth row, §5.4 and §6.5 text that alert mode changes are listed in §4.5 C-F F-5–F-7.
- **00 writer:** one synchronous better-sqlite3 connection; every `writer.run` is `BEGIN IMMEDIATE` and, on commit, swaps state and runs every `addAfterCommit` hook (`apps/hub/src/engine-host/writer.ts`). 01d opens `writer.run` only when it has work (§3.5).
- **00 §3.7 command pipeline** and `writer.run` as the only event writer; **00 M39** auth re-check inside the transaction; **00 §3.5** PIN check and lockout (reused, not copied).
- **00 M12** first-frame WS auth; **00 §6.21** publish filter (`seq > as_of_seq`) for event frames.
- **00 M38** phones are browser-only, owned by one person (kept; G1-19).
- **01b §3.3** effective permission: `grant`, `approver_role_ids`, `scope`; **01b §3.5** `leadOf`, `teamOf` (direct reports); reporting lines grant nothing (R5).
- **01b B18 a** directory changes are additive.
- **01a S33** business day: `BusinessDayOpened` / `BusinessDayClosed` (kept by 05).
- **Foundation §1 stack:** the Android client is React + Capacitor with **bundled assets** and a local SQLite command queue (G1-15 keeps it).

---

## §3. Domain rules

### 3.1 Module decisions

| ID | Decision | Prevents | G1 source |
|---|---|---|---|
| A1 | **01d owns the alert and request record and the answer rules; owning modules register a kind and a handler for the effect.** | First-answer-wins, right checks and attempts rebuilt five times (void, discount, comp, handover, zone transfer). | G1-7 |
| A2 | **One record, the alert.** A request is an alert with an answer part. | Two parallel lifecycles for "tell" and "ask". | G1-21 |
| A3 | **Alert events live on the subject's stream** (`order`, `table`, `stock`; `hub` / branch_id for subject-less alerts). **Receipts live on `audit`.** | Receipts (~5 000 per rush) loading the streams 03a replays. | G1-7, G1-8a, G1-21.9 |
| A4 | **Answer in the same transaction as its effect.** The kind's `apply` runs inside the answer command's transaction; it throws → rollback, the request stays pending, the answerer gets the error. | Approved requests whose effect never happened. | G1-7a |
| A5 | **The right to answer is checked when the answer arrives** (permission and range, §3.3). | An approver whose right was removed after the request was raised. | G0 N6, G1-7c |
| A6 | **Escalation widens who is told, never who may answer.** | A timer loosening a permission scope. | G1-9 |
| A7 | **Each kind declares whether an answer needs a PIN.** Money kinds always; accept kinds never in the pilot (constant; a branch setting is post-pilot, §12.4). In person always. | A tablet left signed in for 60 min approving money; PIN friction on routine accepts. | G1-10 |
| A8 | **Steps are sent by a 500 ms tick from persisted state; when several steps are due at once, only the latest is sent and the earlier ones are recorded skipped.** The tick opens a write transaction only when a read-only pre-check finds work (§3.5). | A burst of stale steps after a restart or a slow tick; two empty write transactions (state swap, every after-commit hook) per second all day. | G1-16, v0.3 #1 |
| A9 | **Alerts reach devices over a device-level connection that outlives the staff session.** | A pocketed device going silent when its session idles out (Waiter 5 min, Order taker 15 min). | G1-13 |
| A10 | **Routes are derived per person, not set.** A person with no route has their alerts shown on their lead's devices. | A route setting that disagrees with what the person actually carries today. | G1-18 |
| A11 | **Receipts: first delivered and first seen per person per device per alert, batched (≤ 1 s or 100), lossy on crash.** | One fsync per receipt under `synchronous=FULL`. | G1-8b, c |
| A12 | **Raise is idempotent by `dedupe_key`** while an alert with that key is open. | Two Ready-to-serve alerts for one order and point from a double tap or retry. | G1-21.4 |
| A13 | **Raise-side permission belongs to the owning module**; 01d checks only the answer side. | Two modules disagreeing on who may ask. | G1-21.8 |
| A14 | **Pilot values are constants** in one module, `ALERT_CONSTANTS` (`packages/domain/src/alert-constants.ts`): approval timings (`approval_repeat_ms` 45 000, `approval_branch_ms` 120 000) and the PIN-per-kind map (money kinds `always`, accept kinds `never`). Kinds of later modules add their constants there (handover 60 s / 2 min, zone transfer 60 s, Ready to serve attempts 2). Making them branch settings waits until an owner asks (R18; §12.4). | Scattered magic numbers; a settings pipeline (cloud column, snapshot field, CLI) nobody asked for yet. | G0-1, G1-10, v0.2 #3 |

### 3.2 The alert

```
            raise (owning module's command, or 01d's tick / directory hooks)
  (none) ───────────────────────────────► OPEN ──┬── RequestAnswered ────────► CLOSED 'answered'
                                                  ├── RequestWithdrawn ───────► CLOSED 'withdrawn'
                                                  ├── AlertClosed 'done' ──────► CLOSED 'done'       (owner: e.g. Handover)
                                                  ├── AlertClosed 'obsolete' ──► CLOSED 'obsolete'   (owner, reason text)
                                                  ├── AlertClosed 'overridden' ► CLOSED 'overridden' (04 void override)
                                                  ├── AlertClosed 'undone' ────► CLOSED 'undone'     (e.g. Ready to serve reverted)
                                                  └── AlertClosed 'expired' ───► CLOSED 'expired'    (kind closes_on after_ms; tick)
   OPEN: steps sent by the tick (§3.5); receipts recorded (§3.6). CLOSED is terminal.
```

Fields (projection `alerts`, §5.2): `alert_id` (ULID), `kind`, `family` (`urgent` | `action` | `info`), `subject_stream_type`, `subject_stream_id`, `dedupe_key`, `requester_staff_id` (null for system alerts), `target` (§3.4, as raised), `values` (kind-specific JSON, e.g. `{ "window_ms": 20000 }`), `display` (label params, §3.12), `request` (null, or `{ answers, right, needs_pin, approver_role_ids }`), `step` (last step sent, −1 before the first), `next_due_at` (null when no step is pending), `state`, `close_reason`, `closed_by_staff_id`, `raised_at`, `closed_at`.

**Only requests wait for an answer.** A non-request alert closes when its owner closes it, when its `closes_on` rule fires (§3.5), or at business-day close (§3.5, step "day close").

### 3.3 Requests

**States (01d):** `pending` (= alert OPEN with a request part) → `approved` | `rejected` (answered) | `withdrawn` | `closed` (`obsolete`, `overridden`, `done`). Accept kinds use the same values with the kind's labels (Accept / Decline).

**Foundation §4.5 mapping (G1-7f):**

| §4.5 void state | 01d | Owner |
|---|---|---|
| PENDING | `pending` | 01d (record, steps, escalation); 04 (bill effect) |
| APPROVED | `approved` | 01d accepts the answer; 04's `apply` removes the item from the bill |
| REJECTED | `rejected` | 01d accepts; 04's `apply` reinstates; the requester gets `request_result`; 04 raises the rejected-void notice to the table's order taker (G0 N9) |
| OVERRIDDEN | closed `overridden` | **04**: rule ON, manager's right, reason, its own event; then `alerts.close(…, 'overridden')` |
| — | `withdrawn` | 01d; 04 defines the item effect (proposed: as if the void never happened, 04 to confirm) |

**Answer rules (`AnswerRequest`, §6.2):**

1. The alert exists (`404 ALERT_NOT_FOUND`), has a request part and is pending (`409 REQUEST_NOT_PENDING { state, answered_by_staff_id, answered_by_name, decision }` — the client shows "Already approved by Imran").
2. **Who answers:** `method = 'session'` (the signed-in person, no PIN), `'pin'` (the signed-in person with their PIN), or `'in_person'` (another person, named by `answerer_staff_id`, with **their** PIN, on this device; G1-7d). In person always needs a PIN (G1-10c).
3. **PIN needed:** money kinds (`needs_pin: 'always'`) → method must be `pin` or `in_person`, else `422 REQUEST_PIN_REQUIRED`. Accept kinds (`needs_pin: 'never'` in the pilot, from `ALERT_CONSTANTS`) accept `session`. In person always takes a PIN (rule 2). The money rule is fixed in the spec; a branch setting to add a PIN to accept kinds is post-pilot (G1-10e, §12.4). No PIN-free window after a PIN answer (G1-10f).
4. **PIN check** reuses 00 §3.5 (device and staff lockout, argon2 semaphore, counted failures) for the answerer, through the built `checkPin(…, onMatch)` with `onMatch` = the pipeline's transaction body (§4.5 C-00 H-3, `pinCheck` hook): `401 PIN_INVALID`, `429 PIN_LOCKED_OUT`, `429 DEVICE_LOCKED_OUT`, `404 STAFF_NOT_FOUND` (unknown `answerer_staff_id`, not counted), `503 SERVICE_UNAVAILABLE` (argon2 semaphore wait > 2 s). **Order:** the PIN check runs after the idempotency fast path (a retry of an answered request replays the stored `200` without argon2) and **before** rules 1 and 5–6, so an in-person PIN is checked, and a wrong one counted, before "Already approved by Imran" is shown. Failures count on this device (for in person: the requester's device).
5. **Not self, for everyone** (Q3; confirmed by the developer as the owner's proxy, 2026-11-01): the answerer is not the requester → else `403 PERMISSION_DENIED { reason: 'self' }`. The requester is also left out of every answerer set (§3.4): if the requester is the only in-range approver signed in, step 0 goes to the other branch-scope approvers (§3.5); if there are none, step 0 is written with no answerers, the request stays pending, and the requester's card says "ask in person" from `approval_branch_ms` (§8.1). A per-request "no one can answer" warning is deferred (§12.4); the per-permission warning (§3.9) still shows while no branch-scope approver is signed in.
6. **Right and range, at answer time** (G1-23), by the kind's `right`:
   - `{ mode: 'approval', base_permission, range_permission? }`. The answerer holds a role in `resolve(requester, base_permission).approver_role_ids` **read now** (empty — the requester's grant is no longer `requires_approval` — → `403 PERMISSION_DENIED { reason: 'not_approver' }`; owning modules close such stale requests `obsolete`, Q8). If `range_permission` is set (voids: `approve-void`), the answerer's `resolve(answerer, range_permission)` must be `allowed` (else `403 { reason: 'not_approver' }`) and its scope must cover the request: `branch` covers all; `my_team` covers a requester **anywhere below the answerer in the team tree** (walk `teamOf` down, depth ≤ active staff at the branch; 01b §3.5 leaves the walk to 01d). Not covered → `403 { reason: 'out_of_range' }`. Without `range_permission` (discount, comp in the pilot): branch-wide.
   - `{ mode: 'named' }`: the answerer is the `receiver_staff_id` given at raise (handover receiver, sibling zone's order taker), else `403 { reason: 'not_receiver' }`.
   - The answerer must be in the hub directory with a PIN (people in `no_pin_staff` can never answer).
7. In the same transaction: append `RequestAnswered`; call `kind.apply(ctx, answer)` and append its events; append the `request_result` alert to the requester (§3.10); post-commit: `alert_closed` frames to every recipient (§6 batch 3).

**Withdraw (`WithdrawRequest`):** only the requester (`403 { reason: 'not_requester' }`), only while pending (`409 REQUEST_NOT_PENDING`). The kind's optional `onWithdraw(ctx)` runs in the transaction (04's void effect). Targets get `alert_closed`.

**Close by the owning module (`alerts.close`):** reasons `done`, `obsolete` (with `note`), `overridden`, `undone`. A request closed `obsolete` or `overridden` also gets a `request_result` alert to the requester (G1-21.2). Closing a closed alert is a no-op returning no events (the owner may race an answer: whichever commits first wins; the second sees the alert closed).

**No expiry for requests** (G0-1, Q-N2). The in-person fallback is the same command (rule 2), so a request never depends on delivery.

### 3.4 Targets

A target is resolved **at each step**, never frozen at raise (G1-11a). Resolution returns **recipients**: people (`staff_id`) and devices (`device_id`), each tagged `answerer`, `informed` or `recipient` (non-request alerts), and, for people with no route, `for_staff_id` on their lead's devices (§3.4.3).

| Target kind | Shape | Resolves to | Available |
|---|---|---|---|
| `person` | `{ kind: 'person', staff_id }` | that person | now |
| `permission` | `{ kind: 'permission', permission, range_of? }` | every directory person whose `resolve(permission)` is `allowed`, filtered by scope against `range_of` (a staff id) like §3.3 rule 6 | now |
| `team` | `{ kind: 'team', lead_staff_id, depth: 'direct' \| 'all' }` | the lead's reports (`teamOf`, plus `no_pin_staff` by `lead_staff_id`, G1-17), direct or the whole subtree | now |
| `answerers` | `{ kind: 'answerers' }` (requests only) | people who pass §3.3 rules 5–6 **now** (in range, requester excluded) | now |
| `branch_scope` | `{ kind: 'branch_scope' }` (requests only) | answerers whose range is `branch` | now |
| `holders_informed` | `{ kind: 'holders_informed' }` (requests only) | people holding the right but out of range (read-only, G1-9b) | now |
| `managers` | `{ kind: 'managers' }` | branch-scope holders of `force-release-table-lock` (G1-11d; Q1 answered) | now |
| `always_on` | `{ kind: 'always_on' }` | devices of type `cashier_kiosk` and `kds`, plus point-bound tablets | kiosk, KDS now; point tablets **stubbed until 01a points** |
| `point` | `{ kind: 'point', point_id }` | tablets bound to the point (G1-12) | **stubbed until 01a points + 00 `point_id`** |
| `table_team` | `{ kind: 'table_team', table_id }` | `tableOwner(table_id)` + direct reports (G1-11a); fallbacks §3.4.2 | **stubbed until 02** registers `tableOwner` |
| `device` | `{ kind: 'device', device_id }` | that device | now (used by `test_alert`) |

Resolvers for `table_team` and `point` are registered by later modules (§4.2 `registerTargetResolver`) and are **batch-shaped**: one call per tick (or per raise) with every target of that kind, one SQL statement per call (§3.5 "Reads per tick"). Raising with an unregistered target kind throws `DomainError('VALIDATION_FAILED', { issue: 'target_unavailable', target_kind })` from `raise`, which the calling command surfaces (only the module that registers the resolver raises such targets, so this is a build-time error in practice).

#### 3.4.1 Presence filter (G1-20)

When a "Present today" list exists for the open business day (§3.11), team and table-team resolution skip people marked absent. **Safety rule:** if no one has been ticked today, everyone counts as present; a person signed in anywhere counts as present. Person targets (`person`) are never filtered.

#### 3.4.2 Fallbacks (table's team, G1-11d)

Owner has no reports → owner only. Owner not signed in anywhere and has no route (§3.4.3) → the zone's assigned order taker (**stubbed until 01a zones + 01b zone assignment + 02 `zoneOf`**); none → `managers`.

#### 3.4.3 Routes of a person (G1-18)

For each person recipient the hub collects, at send time:

1. **Screen:** every staff-session WS socket of that person.
2. **Alert connection:** every device whose **binding** is that person (§3.7), connected in alert mode or not.
3. **Registered routes** (§3.8): e.g. 01e's pager route, if it reports a route for the person. Asked **once per registered route per tick (or raise)** with every person recipient of that tick: `routesFor(tx, staffIds[])` (§3.8).

A person with **none** of these → the alert goes to their **lead's** routes, tagged `for_staff_id` ("for Ali"), grouped per person on the lead's screen (G1-18a). Lead has none → the table-team fallback (§3.4.2) or `managers`. A person bound to several devices gets the alert on all of them (G1-13d).

**"For" rows (G2 #18):** the recipient row is the **lead**: `{ staff_id: <lead>, for_staff_id: <Ali>, set }`. The `alert_inbox` row is the lead's; the lead's `MarkAlertsSeen` is accepted for it, and the lead's seen counts for the "for Ali" card (it stops the urgent repeat on the lead's devices, §8.3). Ali has no inbox row for it until a later step reaches Ali directly.

### 3.5 Kinds, steps and the tick

A **kind** (`defineAlertKind`, §4.2):

```typescript
defineAlertKind({
  kind: 'test_alert',                       // lower_snake, unique
  family: 'info',                           // 'urgent' | 'action' | 'info' (G0-2)
  subject: 'hub',                           // stream_type of the subject
  steps: [                                  // ordered; step 0 is sent at raise
    { at: { ms: 0 }, to: [{ target: 'raised_target', set: 'recipient' }] },
  ],
  closes_on: { after_ms: 600_000 },         // 'owner' | 'seen' | { after_ms }
  labels: { card: 'alert.test_alert.card', lock: 'alert.test_alert.lock' },
  request: null,                            // or the request part below
});
```

Request part:

```typescript
request: {
  answers: ['approve', 'reject'],           // or ['accept', 'decline']
  right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' }, // or { mode: 'named' }
  needs_pin: 'always',                      // 'always' (money kinds) | 'never' (accept kinds, pilot)
  apply(ctx, answer): EventDraft[],         // effect; throws DomainError to refuse
  onWithdraw?(ctx): EventDraft[],
}
```

**Step `at`:** `{ ms }` (fixed; pilot values come from `ALERT_CONSTANTS`, A14), or `{ value: 'window_ms', times: n }` (n × a raiser value, e.g. Ready to serve's walk-to window). **Step `to`:** a non-empty list of `{ target, set }`, where `target` is `raised_target` (the target given at raise) or one of the target kinds `answerers`, `branch_scope`, `holders_informed`, `always_on`, `managers`, and `set ∈ answerer, informed, recipient` (`answerer` / `informed` only on request kinds). A person reached by two entries of one step is listed once, with the stronger set (`answerer` > `informed` > `recipient`). A step has `escalation: true` to be written as `EscalationStepped` instead of `AttemptSent` (one fact per event, §6.6).

**Approval tier (every money kind uses it, G1-9f):**

| Step | At | To | Sound |
|---|---|---|---|
| 0 | raise | `[{ answerers, answerer }]` (in range, requester excluded); if none signed in anywhere → `[{ branch_scope, answerer }]` (requester excluded) (G1-9d shortcut, Q3); if that is empty too → the step is written with no answerers; the request stays pending (§3.3 rule 5) | urgent |
| 1 | `approval_repeat_ms` (45 000) | `[{ answerers, answerer }, { always_on, recipient }]` | urgent (repeat continues on the client, §8.3) |
| 2 (escalation) | `approval_branch_ms` (120 000) | `[{ branch_scope, answerer }, { holders_informed, informed }]` | urgent, volume step-up once (G1-14c); requester shows "Waiting 2 min — ask in person" |

**The tick (A8, G1-16).** Every 500 ms, on `branchNow` (foundation §4.7). 01d owns the hub tick loop; 03a's fire scheduler registers on it (`registerTick`, §4.2; "To 03a"). **One clock, separate transactions (v0.3 #2):** each pass reads `now = branchNow()` once and gives the same `now` to every registered tick; each registered tick runs in **its own** `writer.run`, opened only when its `due` is true. 01d's alert tick is itself registered this way (name `alerts`), first in the list. The loop starts after boot step 7 (foundation §5.8: the server is open, projections are current).

```
loop every 500 ms:
  now = clock.branchNow()
  for each registered tick t (registration order):
    try:
      if not t.due(db, state, now): continue                  -- read-only, outside the lock
      writer.run(tx ⇒ tx.append(t.intents(tx, state, now)))   -- BEGIN IMMEDIATE; t re-selects inside
    catch error: log { tick: t.name, error }                  -- no rethrow; the other ticks still run

alerts.due(db, now):                                           -- ONE statement, indexes alerts_due + alert_flags PK
  SELECT EXISTS (SELECT 1 FROM alerts WHERE state = 'open' AND next_due_at IS NOT NULL AND next_due_at <= ?)
      OR EXISTS (SELECT 1 FROM alert_flags WHERE dirty = 1)

alerts.intents(tx, state, now):                                -- inside writer.run (race rule below)
    due     = SELECT … FROM alerts WHERE state = 'open' AND next_due_at <= ? ORDER BY next_due_at LIMIT 200   -- alerts_due
    flags   = SELECT name FROM alert_flags WHERE dirty = 1                                                     -- §3.9
    if due and flags are both empty → return []                -- the hint was stale; the transaction ends empty (rare)
    reads   = batchReads(tx, due)                                -- fixed statement count, below
    for each alert in due:
      if alert.expire_due: AlertClosed { reason: 'expired' }; continue                 -- day close, below
      if closes_on after_ms reached: AlertClosed { reason: 'expired' }; continue
      steps_due = kind.steps with at(alert) <= now and index > alert.step
      latest = last of steps_due
      for each earlier step in steps_due: StepSkipped { alert_id, step, reason: 'superseded' }
      recipients = resolve(latest.to, alert, reads)              -- §3.4, in memory from reads + directory
      AttemptSent | EscalationStepped { alert_id, step: latest.index, recipients, routes }
    if flags contains 'no_approver': evaluate §3.9 from reads; raise / close no_approver alerts; clear the flag
    return the drafts
  after commit (writer.addAfterCommit): send alert frames (§6 batch 3) and registered route sends (§3.8) for each AttemptSent / EscalationStepped
```

- **Race rule (v0.2 #4, kept in v0.3):** the select inside `writer.run`, after `BEGIN IMMEDIATE`, is **authoritative**; the pre-check outside it decides only whether to open the transaction. The hub has one synchronous connection and `writer.run` has no `await`, so a command and the tick never interleave inside a transaction. A pre-check that says "due" for an alert answered meanwhile finds it closed inside and writes no step; a pre-check that says "nothing" just before an alert becomes due delays its step to the next tick (≤ 500 ms, within G1-16). So once `RequestAnswered` (or any close) commits, no later tick writes a step for that alert.
- **Idle cost:** a pass with nothing due runs one indexed `SELECT` per registered tick and opens **no** transaction, so no state swap and no after-commit hooks.
- **Isolation (v0.3 #2):** a bug in one registered tick rolls back only that tick's transaction and is logged; 03a's fire intents (D44: all fire-scheduler intents of one tick in one transaction) are never rolled back by 01d, and the reverse.
- **Reads per tick (v0.2 #5, completed in v0.3):** 1 pre-check, then inside the transaction a **fixed** set of statements whatever the number of due alerts: (1) due alerts, (2) dirty flags, (3) active staff sessions with their device ids (`staff_sessions WHERE ended_at IS NULL AND kind = 'staff'`), (4) `device_bindings` (whole table; one row per device), (5) `devices` not revoked (type; `point_id` once points land), (6) `presence_today` (§3.11), (7) the previous step's `alert_recipients` for the due alerts (`WHERE alert_id IN (…)`, for `moved_to`, G1-11c), (8) one call per registered resolver kind that the due alerts use, with all their targets (e.g. one `tableOwner` statement for every table) — R statements, (9) one `routesFor` call per registered route with every person recipient of the tick (§3.8) — T statements. Directory lookups (`resolve`, `teamOf`, `no_pin_staff`) are in memory. So a tick costs ≤ 1 + 7 + R + T reads, plus its writes. `raise` uses the same `batchReads` for its one alert: ≤ 5 + R + T (sessions, bindings, devices, presence, previous recipients — none at raise, so 4 — plus the dedupe read, §6.1).
- **"Signed in anywhere" lags idle expiry by up to 15 s:** read (3) counts a session until the 00 sweeper ends it (every 15 s; `last_activity_at` in the table is also up to 15 s stale, 00 §3.4). The G1-9d shortcut and the §3.9 warning may react up to 15 s late. Accepted.
- **Restart / tick lag:** the same rule covers both: the latest due step is sent once; the rest are `StepSkipped` (G1-16, b). `branchNow` is monotonic in-process (D48), so a jump only appears across a restart.
- **Failed send** (socket closed, device offline): not retried within the step; the missing receipt shows it; the next step follows on schedule (G1-16c).
- **Step 0 is written at raise,** in the raising command's transaction (no 500 ms delay).
- **Day close (Q4 → tick):** the `alerts` projection, on `BusinessDayClosed`, sets `expire_due = 1` and `next_due_at = recorded_at` on every open **non-request** alert (a projection write, no event). The next tick (≤ 500 ms) writes `AlertClosed { reason: 'expired' }` for each. Requests stay open (no expiry).
- **`closes_on: 'seen'`:** closed `done` in the transaction that records the first `seen` by its (single) recipient (`request_result`).

### 3.6 Receipts

| Receipt | Where | When written | Dedupe |
|---|---|---|---|
| sent | not an event: the `AttemptSent` / `EscalationStepped` recipients and routes | at the step | — |
| `AlertDelivered` | `audit` / alert_id | device reports the frame shown (WS `receipt`, §6 batch 3) | first per (alert, person, device); repeats dropped (A11) |
| `AlertSeen` | `audit` / alert_id | the signed-in person opened it (`MarkAlertsSeen`, §6.4) | first per (alert, person, device) |
| `RequestSeen` | **subject stream** | first seen per person on a **request** (`MarkAlertsSeen`), unbatched, in the command's transaction | first per (alert, person) |
| answered | `RequestAnswered` | §3.3 | — |

- **Batching (A11):** `AlertDelivered` and `AlertSeen` go into an in-memory buffer; a flush runs every 1 000 ms or at 100 buffered receipts, whichever comes first, as **one** `writer.run` appending all of them. **An empty buffer opens no transaction.** A hub crash may lose the last batch; **this is accepted for these two events only** (G1-8c).
- **Dedupe before buffering:** a receipt is buffered only if its key `(alert_id, staff_id, device_id, kind)` is neither in the in-memory "recorded" set (filled at flush and at boot from `alert_receipts` of open alerts) nor already in the buffer. So repeats never become events, and a socket can only produce receipts for alerts it was sent (§6 batch 3); no rate limit is needed (v0.3 #12).
- **Seen from a command is buffered on commit:** `MarkAlertsSeen` queues its `AlertSeen` receipts with `tx.onCommit` (`writer.ts`), so a rolled-back command buffers nothing.
- **`alert_seen` frame (G1-14a, v0.3 #8):** when `RequestSeen` is written for a person, after commit the hub sends `{ type: 'alert_seen', alert_id }` to every staff-session socket of that person and every alert-mode socket of a device bound to them (§3.7), so the 10 s urgent repeat stops on **all** of their devices at once (§8.3). For a "for Ali" card the person is the lead (§3.4.3).
- **Payload** carries `alert_id` and the subject (`subject_stream_type`, `subject_stream_id`) so the cloud and the owner view can join back (G1-8a).
- **Pager route:** sent only; no receipts (01e, G1-8d).
- **Why `RequestSeen` is on the subject stream (G1-21.1):** the urgent repeat stops once seen (§8.3, G1-14). 01d's open-alert state is a persisted projection (§5.2), so it survives a restart without replay; putting the first seen of a request on the subject stream also keeps a projection **reset** correct when 03a replays only the subject streams (G1-8e). Requests are few per day.

### 3.7 Alert connection and device binding (G1-13)

- **Alert mode:** a WS opened with `{ type: 'auth', device_token }` and **no** `session_token` (§4.5 C-00, M12). Device types `tablet`, `cashier_kiosk`, `kds`, `phone`. It receives only `alerts_open`, `alert`, `alert_seen` and `alert_closed` frames for that device; it sends only `receipt` frames; no commands, no events, no catch-up. Alert-mode sockets are held in a **separate list** from session sockets: they never pass through 00's `deliver()`, audiences or catch-up, so 00's socket context is unchanged (H-1, H-7).
- **Binding** (projection `device_bindings`, §5.2), derived from session events, no new event. `SessionEnded` carries no `device_id` (00 §4.2), so the binding row keeps the **`session_id`** that set it and ends by that id:

| Device | Bound person |
|---|---|
| `phone` | its `owner_staff_id` (00 M38), from `DevicePaired`; `session_id` null; ends on `DeviceRevoked` |
| `tablet`, `cashier_kiosk` | the **last signed-in person**: `SessionStarted` (kind `staff`, `device_id` in its payload) upserts `(device_id, staff_id, session_id)`; `SessionEnded` with reason `logout`, `forced`, `staff_removed`, `credentials_changed`, `device_revoked`, `hub_restored` deletes `WHERE session_id = ?` (a no-op when a later session already replaced the row); `BusinessDayClosed` deletes every tablet / kiosk row; **kept** on `idle_timeout` and `replaced` (the row stays; for `replaced` the new `SessionStarted` overwrites it with the new `session_id`); `taken_over` → the new session's `SessionStarted` overwrites it |
| `kds` | none (device targets only) |

Rebuild is exact: `reset` empties the table and replay of `DevicePaired`, `SessionStarted`, `SessionEnded`, `DeviceRevoked` and `BusinessDayClosed` gives the same rows, with no read of `staff_sessions`. After a cloud-only restore (00 M40 step 4b) the `hub_restored` ends match their sessions by `session_id`, so no stale binding survives.

- The tablet header always shows **"Alerts: <name>"** (or "Alerts: none") (G1-13c).
- **Lock-screen and session-less text:** table, kind, point, requester only (`T12 · Void request · Hamza`, `T12 Ready — Pass`); never amounts, items or reasons (G1-13e). The `alert` frame sent to an alert-mode socket carries only the `lock` text fields (§6 batch 3); details need a sign-in.
- **Revoke / rotation:** `DeviceRevoked` closes alert-mode sockets `4403`, `DeviceTokenRotated` `4401`, as for session sockets (00 M39, M40, M60). Because alert-mode sockets get no event frames, the close is done by the alert-mode list's own after-commit check on those two events (no frame sent first), not by 00's `closeFor` (`apps/hub/src/ws/server.ts`, which runs only after an event is sent).
- **Reconnect:** on auth, an alert-mode socket gets `alerts_open` (open alerts whose last step's recipients include this device or its bound person), so a reconnect does not miss a step.

### 3.8 Route interface (for 01e)

```typescript
registerRoute({
  route: 'pager',                                        // unique
  format: 'short_code',                                  // 'text' | 'short_code'
  ack: false,                                            // can the device acknowledge? (pager: no)
  receipts: [],                                          // which receipts it reports: subset of ['delivered', 'seen']
  routesFor(tx, staffIds: string[]): Map<string, Array<{ route_ref: string }>>,
                                                         // batch-shaped: ONE SQL statement per call, whatever staffIds.length;
                                                         // e.g. Map { 'ali' → [{ route_ref: 'pager:5' }] }; a missing key = no such route today
  send(alert: AlertView, step, route_ref): void,         // after commit; must not throw; failures are the route's to log
});
```

- `routesFor` is called **once per registered route per tick (or per raise)** inside the step transaction, with every person recipient of that tick (§3.5 read 9), so `AttemptSent.routes` lists `pager:5`; `send` runs after commit. A route that issues more than one statement per call fails test 35.
- A route with `receipts: ['delivered']` reports through `alerts.recordReceipt(…)` (same buffer, A11).
- A person whose only route is a registered one is **not** "no route" (§3.4.3).
- `short_code` text comes from the kind's optional `short` label (§3.12, Latin only); a kind without one is not sent on short-code routes.

### 3.9 "No one can approve" warning (pilot form of Q-N5, G1-9e)

For each permission that some role grants with `requires_approval` at this branch: while the business day is open and **no person who could answer it branch-wide** (holds an approver role and, for a permission with a registered `range_permission`, branch scope on it) is signed in anywhere, an alert kind `no_approver` is open (subject `hub` / branch_id, `dedupe_key = 'no_approver:' + permission`, family `info`, target `always_on` + `managers`; text "No one can approve voids right now"). **Per permission only** in the pilot: a per-request "no one can answer this request" warning (the narrow case where the only branch-scope approver signed in is the requester) is deferred (§12.4, v0.3 #9); that requester sees "ask in person" (§8.1). **Evaluated by the tick** (Q4): the projections of `SessionStarted`, `SessionEnded`, `StaffDirectoryApplied`, `BusinessDayOpened` and `BusinessDayClosed` set the persisted flag `alert_flags('no_approver').dirty = 1`; the next tick evaluates from its batched reads (sessions + directory in memory; no read of open requests), raises or closes `no_approver` alerts, and clears the flag in the same transaction (≤ 500 ms after the cause, plus the ≤ 15 s idle lag of §3.5; survives a restart because the flag is persisted). Closed `done` when an eligible approver signs in; `expired` at day close.

### 3.10 Kinds 01d ships

| Kind | Family | Subject | Steps | Closes on | Use |
|---|---|---|---|---|---|
| `test_alert` | `info` | `hub` / branch_id | step 0 to the raised target | `after_ms` 600 000 | A manager (`manage-devices`) sends a test to a person, a team, a device or a point (point stubbed) and watches receipts. Installation tool for tablets now and watches / bridge in 01e (G1-21.7). |
| `request_result` | `info` | the request's subject | step 0 to the requester | `seen` | Decision and answerer (or closer and reason) to the requester, raised in the answer / close transaction (G1-21.2). |
| `no_approver` | `info` | `hub` / branch_id | step 0 to `always_on` + `managers` | owner (01d) | §3.9. |

### 3.11 "Present today" (G1-20; kept, owner answer 2026-11-01)

- Command `SetPresence { staff_ids: [...], present: boolean }` (permission `manage-staff`, Q2), event `PresenceSet { business_day_id, staff_ids, present, set_by }` on `staff` / branch_id. Projection `presence_today`, cleared on `BusinessDayClosed`.
- Used only by §3.4.1. The no-route hint and the shift-start screen that shows it are 01e's (pager assignment screen, G1-18b).

### 3.12 Labels and i18n (G1-21.6)

Each kind registers label keys in the client string tables (`EN` and `UR`, 00 M83): `card` (full text, signed in), `lock` (session-less text, §3.7), optional `short` (Latin only, ≤ the route's length, 01e). `display` on the alert carries the parameters (`table_code`, `point_code`, `requester_name`, `kind_label`), never amounts or reasons in `lock`.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 00 | `defineCommand`, `defineQuery`, `writer.run`, `writer.addAfterCommit` (post-commit frames and route sends), `tx.onCommit` (receipt buffering), `registerProjection`, `registerCatchUp` (with the socket context, H-7), `StaffDirectory`, `clock.branchNow`, `ids.next`, PIN check (`checkPin`, §3.5 steps 2–9, through the new `pinCheck` hook, §4.5 C-00 H-3), WS server (alert mode, new frames, §4.5 C-00), sessions table, devices table, `setMaintenanceHour` / retention hour (M66) |
| 01b | `resolve` (grant, `approver_role_ids`, scope), `leadOf`, `teamOf`; v1.4: `no_pin_staff`, `teamOf` including no-PIN people (§4.5 C-01b) |
| 01a | `BusinessDayOpened`, `BusinessDayClosed` |
| Later modules | Registered kinds, target resolvers (`table_team`, `point`, `zoneOf`), routes (01e) — through §4.2 only |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src/alerts/`):**

| Export | Shape | Used by |
|---|---|---|
| `defineAlertKind(def)` | §3.5. Registered at startup; duplicate `kind` → startup error | 02, 03a, 03b, 04, 05, 01e |
| `alerts.raise(ctx, input)` | `input = { kind, subject: { stream_type, stream_id }, target, values?, display, dedupe_key, requester_staff_id?, request?: { approver_role_ids?, receiver_staff_id? } }` → `{ alert_id, events: EventDraft[], deduped: boolean }`. Pure on the transaction: the caller appends `events` with its own. A second raise with the same `dedupe_key` while one is open → `{ alert_id: <open one>, events: [], deduped: true }`. **Within one transaction** `raise` also remembers the keys it has returned drafts for (a per-transaction map keyed by `tx`), so a second raise with the same key in the same handler, before the caller appends, returns the first `alert_id` with `deduped: true` instead of tripping `alerts_open_dedupe`. Step 0 is included. | owning modules' command handlers and ticks |
| `alerts.close(ctx, alert_id, reason, note?)` | `reason ∈ done, obsolete, overridden, undone` → `EventDraft[]` (`AlertClosed`, plus `request_result` for a request closed `obsolete` / `overridden`). Closed already → `[]` | owning modules |
| `alerts.byDedupeKey(db, key)` | open alert id or null | owning modules (e.g. 03b undo) |
| `registerTargetResolver(kind, fn)` | batch-shaped: `fn(tx, targets[]) → Map<target_key, { staff_ids, device_ids }>`, **one SQL statement per call** (§3.5 reads per tick); kinds `table_team` (02), `point` (01a/00 with points), `zone_order_taker` (02 + 01a zones) | 02, 01a |
| `registerRoute(def)` | §3.8; `routesFor(tx, staffIds[]) → Map`, one statement per call | 01e |
| `alerts.recordReceipt({ alert_id, staff_id, device_id, kind })` | into the receipt buffer (A11), deduped before buffering (§3.6) | 01e routes that report receipts |
| `registerTick({ name, due(db, state, now) → boolean, intents(tx, state, now) → EventDraft[] })` | One loop, one `now` per pass (§3.5). `due` is read-only, runs outside any transaction, and must be cheap (one indexed statement, or pure over the in-memory state). When it returns true the loop opens **this tick's own** `writer.run`, in which `intents` re-selects authoritatively and its drafts are appended (D44 holds per registered tick: all of one tick's intents in one transaction). A throw in `due` or `intents` rolls back that tick only and is logged `{ tick: name, error }`; the other ticks of the pass still run. Registration order is the run order; 01d's `alerts` tick is first. | 03a fire scheduler |

**Events introduced (all `schema_version: 1`, `@pos/events/src/events/<stream>/…`; files under `events/alert/` re-exported for every subject stream):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to |
|---|---|---|---|
| `AlertRaised` | subject | `{ alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id \| null, target, values, display, request: { answers, right_mode, base_permission \| null, range_permission \| null, approver_role_ids, receiver_staff_id \| null, needs_pin } \| null }` | — (frames, §6.3) |
| `AttemptSent` | subject | `{ alert_id, step, recipients: Array<{ staff_id \| null, device_id \| null, for_staff_id \| null, set: 'answerer' \| 'informed' \| 'recipient' }>, routes: Array<{ staff_id \| null, route: 'screen' \| 'alert_connection' \| string, ref: string }> }` | — |
| `EscalationStepped` | subject | as `AttemptSent` | — |
| `StepSkipped` | subject | `{ alert_id, step, reason: 'superseded' }` | — |
| `RequestAnswered` | subject | `{ alert_id, decision: 'approve' \| 'reject' \| 'accept' \| 'decline', answerer_staff_id, method: 'pin' \| 'session' \| 'in_person', device_id }` | — (frames: `alert_closed`, §6 batch 3; v0.3 #12) |
| `RequestWithdrawn` | subject | `{ alert_id, by_staff_id }` | — (frames) |
| `RequestSeen` | subject | `{ alert_id, staff_id, device_id }` | — (frame `alert_seen` to the person's devices, §3.6) |
| `AlertClosed` | subject | `{ alert_id, reason: 'done' \| 'obsolete' \| 'overridden' \| 'undone' \| 'expired', by_staff_id \| null, note \| null }` | — (frames) |
| `AlertDelivered` | `audit` / alert_id | `{ alert_id, subject_stream_type, subject_stream_id, staff_id \| null, device_id, route }` | — |
| `AlertSeen` | `audit` / alert_id | as `AlertDelivered` | — |
| `PresenceSet` (§3.11) | `staff` / branch_id | `{ business_day_id, staff_ids, present, set_by }` | — |

Actor: commands set `actor_id` = session staff (00 §3.7); tick-written events have `actor_id = null`, `device_id = 'hub'`.

**Client (`packages/events/src/ws.ts`, `packages/domain`):** frame shapes (§6 batch 3), `ALERT_FAMILIES`, close reasons, request decisions, label key convention.

### 4.3 Requirements carried to other modules

**To 01e Device gateway (pilot, mandatory)** — G0 D3, D4, D5, G1–G7, G0-10; the pager route through §3.8 (`routesFor` batch-shaped, one statement per call); **the 01b bump for `pager_ids`** (G1-17: directory map `pager_ids: { staff_id → pager_id }`, cloud column on `staff_branches`, staff form field, hub cache table; moved out of 01d's 01b bump in v0.3 #11, with its directory statement and sync-bound row); pager assignment by shift with the `pager_ids` default (G1-17a, b, c), on the `staff` stream; watch kinds and patterns (N8, G0-2); device-offline alerts (G0 G7) and "a point with no bound device online → the manager is told" (G1-12d, needs 01a points); the no-route hint on the shift-start screen (G1-18b); `test_alert` to a watch as the installation check.

**To 03a** — size snapshots and replay against ≈ 75k events/day (≈ 45k on replayed streams, ≈ 30k `audit`) instead of R6's 40k; replay reads only the stream types its reducers use, with an index serving `(branch_id, stream_type, seq)`; foundation §5.8 step 3 text through the v1.8 bump (R34) (G1-8e). **One tick:** register the fire scheduler with `registerTick({ name: 'fires', due, intents })` instead of starting a timer (G1-16a): `due` is pure over the engine state (e.g. "`getTickIntents(state, now)` is non-empty", or the earliest pending due time ≤ now), so an idle kitchen opens no transaction; `intents` writes all fire intents of the pass in its **own** transaction (D44), separate from 01d's (§3.5). Register the Ready-to-serve kind (`action`, attempts by `window_ms`, last-attempt escalation to the point and `managers`, G0-1) and the slip-warning kind (to the table's order taker, N9).

**To 02** — register `tableOwner` (`table_team` resolver) and `zoneOf`; register the table-handover accept kind (`named`, 60 s remind / 2 min sender's lead, G0-1) and its `apply`; Call waiter and the Served card kinds.

**To 04** — register the void approval kind (`approval`, `base_permission: 'void-item'`, `range_permission: 'approve-void'`, `needs_pin: 'always'`); `apply` for approve / reject; `onWithdraw` (confirm "as if it never happened"); OVERRIDDEN through `alerts.close(…, 'overridden')`; the rejected-void notice to the table's order taker (N9).

**To 05 (and 02 for comps)** — discount and comp approval kinds (`approval`, no `range_permission` in the pilot, G1-23); every request records requester, approver, amount, reason, time (G0 N7) — amount and reason live in the owning module's events, not in 01d's `lock` text.

**To 01a** — points and the `point` resolver; zones and `zone_order_taker`.

**To 01b** — scoped `approve-discount` / `approve-comp` are post-pilot (§12.4).

### 4.4 Stubbed until another module lands

| Target / kind | Stubbed until |
|---|---|
| `table_team` (G1-11) | 02 `tableOwner` |
| Zone order-taker fallback (G1-11d) | 01a zones + 01b zone assignment + 02 `zoneOf` |
| `point`, point tablets in `always_on` (G1-12) | 01a points + 00 `point_id` column (lands with the points) |
| "Point with no bound device online → manager told" (G1-12d) | 01a points; delivered with 01e device health (G0 G7) |
| Pager route | 01e |
| Void approval | 04 |
| Discount / comp approval | 05 (discount), 02 / 05 (comp) |
| Table handover accept | 02 |
| Zone-stock transfer | 01a zone stock + 02 |
| Ready to serve, Handover close, Call, Served card | 03a / 03b, 02 |
| Slip warning | 03a |

**Live at 01d ship:** `test_alert`, `request_result`, `no_approver`; request rules proven with a **test kind** in the test suite (§10), not in production.

### 4.5 Changes to other specs (R26) — all *Proposed — needs approval*

Applied by version bump at approval, each with a changelog entry and "Changed by 01d v1.0" markers. Not applied by this draft.

**C-README**

| # | Change |
|---|---|
| R-1 | Module map: row 01d **"Notifications and requests"** (G1-22); new row **01e "Device gateway"** (pilot, mandatory; stories G0 D3–D5, G1–G7; depends on 00, 01d; blocked by the hardware spike, G0 §9). |
| R-2 | R21 / R27 build order and milestone A module list: hardware spike now ∥ 01d spec → 01d build → 01e spec → 01e build → 03a → 02 → 04 → 03b → 05 (G1-6). |
| R-3 | R22: routes add the pager route (01e); "a thin Android app (Capacitor shell over the hub's pages plus a background service)" → "the bundled Capacitor tablet app, updated from the hub, with a background service"; personal-phone alert app after the pilot (G1-15, G1-19). |
| R-4 | **R33 Device policy:** restaurant-owned Android tablets in lock-task mode as device owner (G0 D1); hub-hosted silent update (G1-15); personal phones possible, not required, browser-only in the pilot (G0 D6, G1-19); iPhones as R22 (G0 D7). |
| R-5 | **R34 The foundation may change through a version bump** with a changelog and "Changed by" markers, approved by the owner, like any module spec (R26). First use: 01d. (G1-2) |
| R-6 | "Requirements carried to other modules": add rows To 01e, To 03a, To 02, To 04, To 05 (§4.3 text). On the row "01d — Notification targets (person, permission, team); … a warning when a target has no locked-phone route", append "**Closed by 01d v1.0** (targets §3.4, routes §3.4.3 / §3.7, requests §3.3; the thin Android app is the bundled tablet app, §8.2; the no-route warning is deferred, 01d §12.4)". On the row "01d — Cross-team requests", append "**Deferred by 01d v1.0** (§12.4)". On the row "01d, 06 — Directory changes stay additive", append "01d v1.0 adds `no_pin_staff` additively (01b v1.4 B-1)". |
| R-7 | R14 narrowed (G0 D6, G1-19). |

**C-CLAUDE.md** (same change as R-5) — "The foundation is frozen (D64): later issues go into module specs or unit tests, not foundation edits. The one allowed foundation edit is appending a new error code that a module spec defines (§6.2)." → "The foundation changes only through a version bump approved by the owner, with a changelog and 'Changed by' markers (README R34). Appending an error code that a module spec defines (§6.2) needs no bump."

**C-F Foundation v1.7 → v1.8** (needs R-5 and C-CLAUDE.md first)

| # | Section | Change |
|---|---|---|
| F-1 | §4.5 | Void states mapped to 01d requests (§3.3 table); "sends urgent push to all `approve-void` holders" → "raises a void approval request (01d): in-range approvers first, then escalation (01d §3.5)"; REJECTED "waiter notified" → "the table's order taker is notified". OVERRIDDEN closes the request (04). The diagram label "timeout override" stays as written; whether OVERRIDDEN needs a minimum waiting time is 04's rule (01d requests never expire, §3.3). |
| F-2 | §2 Objective | "Warn waiters before an order slips past its promise" → "Warn the table's order taker before an order slips past its promise" (G0 N9). The engine text (§4.7 `SlipWarned`, D3 boost row) is unchanged; who receives the warning is 03a's kind (§4.3). |
| F-3 | §1 Stack | Android row: "React + Capacitor (bundled assets + local SQLite command queue); restaurant tablets in lock-task mode as device owner, updated from the hub (README R33)". |
| F-4 | §6.2 | Append codes `ALERT_NOT_FOUND` (404), `REQUEST_NOT_PENDING` (409), `REQUEST_PIN_REQUIRED` (422) (§9). *This row needs no bump (§6.2 rule) and lands with the 01d build if R-5 is not yet approved.* |
| F-5 | §6.3 route table, `GET /ws` row | Auth column "device token + session" → "device token + session, or device token only (**alert mode**: alert frames only, 00 M12 / §6.21)". |
| F-6 | §5.4 | Below the diagram, add: "A second, session-less connection (**alert mode**, 00 M12) authenticates with the device token alone and carries only alert frames (`alerts_open`, `alert`, `alert_seen`, `alert_closed`) and device → hub `receipt` frames; no catch-up, no event push (01d §3.7)." |
| F-7 | §6.5 | After the hub → device list, add: "**Alert frames** (01d): `alerts_open`, `alert`, `alert_seen`, `alert_closed`. They are sent after commit, are not events and are outside the `seq` stream (no gap logic); \"only committed events are pushed, in strictly ascending `seq`\" applies to `event` frames." After the device → hub list, add: "`{ \"type\": \"receipt\", \"alert_id\": \"…\", \"kind\": \"delivered\" }` (01d) records a delivery fact; it is not a command (§6.3 rule 7 unchanged)." |
| F-8 | §5.2 diagram | Box "Fire scheduler (setInterval 500ms)" → "Hub tick (500 ms, 01d `registerTick`): fire scheduler (03a) and alert steps (01d), each in its own transaction". |

**C-00 Hub Platform & Access v1.5 → v1.6**

| # | Section | Change |
|---|---|---|
| H-1 | M12, §6.21 | `auth` frame: `session_token` optional. Without it → **alert mode** (device types `tablet`, `cashier_kiosk`, `kds`, `phone`; device valid, not revoked): sends `alerts_open`, then only `alert` / `alert_seen` / `alert_closed` frames; accepts only `receipt` frames (any other frame → close `4401`); no catch-up, no event frames; closed `4403` / `4401` on `DeviceRevoked` / `DeviceTokenRotated` by an after-commit check on those two events (no frame sent first). **Alert-mode sockets are kept in a separate list**, never passed to `deliver()`, `registerEventAudience` audiences or `registerCatchUp` parts, so the §4.2 socket context `{ deviceId, deviceType, sessionId, kind, staffId, stationId, asOfSeq }` is unchanged. Keepalive as today. Session sockets (staff and station) additionally accept `receipt` frames after auth (today only `ack` is read, `apps/hub/src/ws/server.ts`). |
| H-2 | §6.21 and `packages/events/src/ws.ts` (foundation §6.5 text: C-F F-7) | `WsServerMessage` adds `alerts_open`, `alert`, `alert_seen`, `alert_closed`; `WsClientMessage` adds `receipt`, and the `auth` variant's `session_token` becomes optional (§6 batch 3). Staff-session sockets also get `alert` / `alert_seen` / `alert_closed` (G1-21.5); station sockets get device-target alerts (01d §6 batch 3). |
| H-3 | §4.2 `defineCommand`, §3.7 | **`'checked-in-handler'` marker.** §4.2 text "`permission` may be `null` only when `stationScoped` and the command is never allowed to staff" **stays**; add: "A staff command whose right depends on the payload declares `permission: 'checked-in-handler'`. The registry accepts that marker **only** for the commands in `HANDLER_CHECKED_COMMANDS = ['AnswerRequest', 'WithdrawRequest', 'MarkAlertsSeen']`; any other command declaring it → startup error. Such a command needs a staff session (station → `403 PERMISSION_DENIED { session_kind: 'station' }`); `ctx.permission = null`; the handler runs its own right check before writing, and a test per listed command proves an unauthorised call writes nothing (01d test 33)." New optional **`pinCheck(payload, ctx) → { staff_id, pin } \| null`**: §3.7 gains a step **after** "idempotency fast path" and "payload Zod": when `pinCheck` returns a value, the pipeline calls the existing `checkPin(…, { staffId, pin, subject: device, eventDeviceId }, onMatch)` (`apps/hub/src/auth/pin.ts`) with `onMatch` = the `writer.run` body (idempotency re-check, M39 re-check, permission, `handle`, append, `processed_commands`). Same counters, events and errors as §3.5 steps 2–9, including `404 STAFF_NOT_FOUND` (not counted) and `503 SERVICE_UNAVAILABLE`. |
| H-4 | §4.2 | New export `ws.sendToDevices(device_ids, frame)` and `ws.sendToStaff(staff_ids, frame)` (after commit only; `sendToDevices` reaches every socket of the device — staff, station and alert mode), used by 01d. |
| H-5 | §8.1, new §6.36–§6.38 | **Tablet app update, pilot minimum (G1-15).** §8.1 adds: "Background service holding the alert connection (01d §8.2); silent update from the hub (§6.36–§6.38)." New endpoints: **§6.36 `GET /app/android/latest`** — device token (guards §3.9), device type `tablet` or `cashier_kiosk`, else `403 DEVICE_TYPE_NOT_ALLOWED`; `200 { data: { version_name, version_code, sha256, staged_device_id \| null } }` = the newest release **this device may install**: the newest release if its `staged_device_id` is null (marked good) or equals the calling device; otherwise the newest release with `staged_device_id` null. No such release → `404 ROUTE_NOT_FOUND`. 1 statement on `app_releases`. The app installs when `version_code` > its own (01d §8.4 windows). **§6.37 `GET /app/android/<version_code>.apk`** — same auth; streams the file (`application/vnd.android.package-archive`); unknown version → `404 ROUTE_NOT_FOUND`. **§6.38 hub CLI** `pnpm --filter hub app-release add <apk> --version-code N --version-name X --stage <device_id>` (copies the APK into `<data_dir>/apk/`, writes `sha256`, keeps the newest 2 good versions plus the staged one, deletes older files) and `app-release mark-good <version_code>` (sets `staged_device_id = null`, releasing it to every tablet). State: hub table `app_releases (version_code INTEGER PRIMARY KEY, version_name TEXT NOT NULL, sha256 TEXT NOT NULL, staged_device_id TEXT, added_at INTEGER NOT NULL)` in 01d's migration `0006` (no event: an installation action, logged by the CLI). Nothing else in the pilot (no rollout percentage, no per-device history). (00, Q5.) |
| H-6 | M38 / R14 | Personal phones browser-only for alerts in the pilot (text only; no code change). |
| H-7 | §4.2 `registerCatchUp` | "`{ part, appliesTo(socketCtx), build(db, state) }`" → "`{ part, appliesTo(socketCtx), build(db, state, socketCtx) }`; the third argument is the same socket context given to `appliesTo` (additive: existing parts ignore it)". `apps/hub/src/ws/catch-up.ts` passes `socket` to `build`. Used by 01d's `alerts` part (open alerts for this person and device). |
| H-8 | §7.3 Timers; M66 | Timers table adds: "Hub tick — 500 ms — registered ticks (`registerTick`, 01d §3.5), each in its own transaction, opened only when `due`" and "Receipt flush — 1 000 ms or 100 receipts — 01d §3.6; skipped when the buffer is empty". Session sweeper row adds: "each run (sweep, then retention) is wrapped in try/catch; an error is logged `{ timer: 'sweeper', error }` and the next run continues" (`apps/hub/src/auth/session-sweeper.ts` `startSweeper`). |

Not in this bump: `point_id` on devices (with 01a points), `pager_bridge`, compact protocol, headless pairing (01e → 00 v1.7).

**C-01b Staff and Roles v1.3 → v1.4**

| # | Section | Change |
|---|---|---|
| B-1 | §4.3.1 directory shape, §5.2 hub tables, B3 | Directory v2 gains additive **`no_pin_staff: [{ staff_id, display_name, lead_staff_id }]`**: every active staff member at the branch without a PIN; no roles, no permissions; never on rosters (G1-17, G1-17d). A `staff_id` is in exactly one of `staff` / `no_pin_staff`; setting a PIN moves the person in the same directory version. Older hubs ignore it (B18 a). Hub cache table `no_pin_staff` (01d §5.1), replaced whole by `applyStaffDirectory`; `StaffDirectory.load` 9 → 10 statements. B3 text "A person with no PIN is left out of the hub directory until a PIN is set" → "… is left out of the hub directory's `staff` list (no sign-in, no approval, no phone) until a PIN is set; they are listed in `no_pin_staff` for targeting only (01d)". |
| B-2 | — | *(v0.3: moved to 01e's 01b bump — `pager_ids`, §4.3 To 01e.)* |
| B-3 | §4.2 | `StaffDirectory.teamOf(staffId, { includeNoPin: true })` and `noPinStaff()`. |
| B-4 | §3.3 | Note: the answer right for `requires_approval` kinds is 01d §3.3 rule 6 (G1-23). |
| B-5 | §4.4 row 6 (as carried by 01c v1.1 §4.5 B4), README R32 c | **Sync bound raised for `no_pin_staff`:** cloud `loadDirectory` gains **one** statement (active staff at the branch with `pin_hash IS NULL`, with their `lead_staff_id`). `GET /v1/sync/config` `200` with the directory: ≤ 26 → **≤ 27**; directory-only ≤ 17 unchanged (measured 10 → 11); config-only ≤ 22 and `304` unchanged. Raised here, in a spec, as R32 c requires. |
| B-6 | B18 (b) | Add: "A `lead_staff_id` (of a `staff` or `no_pin_staff` entry) naming a person in `no_pin_staff` is **kept** (that person is present in the directory); only a lead naming someone in neither list is skipped." |

Not in this bump: `tap-for-station`, `mark-served`, zone assignment, `manage-zone-stock` (carried to 01b by 02 / 03a / 03b); `pager_ids` (01e).

**C-01a:** none (v0.2 #3: pilot values are constants, A14).

---

## §5. Data model and migrations

### 5.1 Hub migration `0006_alerts.sql`

01d's hub state is **projections** (rebuildable from events, `registerProjection` with `reset`), plus the directory caches of C-01b.

```sql
CREATE TABLE alerts (
  alert_id            TEXT    PRIMARY KEY,
  kind                TEXT    NOT NULL,
  family              TEXT    NOT NULL CHECK (family IN ('urgent','action','info')),
  subject_stream_type TEXT    NOT NULL,
  subject_stream_id   TEXT    NOT NULL,
  dedupe_key          TEXT    NOT NULL,
  requester_staff_id  TEXT,
  target_json         TEXT    NOT NULL,
  values_json         TEXT    NOT NULL,
  display_json        TEXT    NOT NULL,
  request_json        TEXT,                 -- null = not a request
  step                INTEGER NOT NULL DEFAULT -1,
  next_due_at         INTEGER,              -- null = nothing pending
  expire_due          INTEGER NOT NULL DEFAULT 0 CHECK (expire_due IN (0,1)),  -- set by BusinessDayClosed (§3.5)
  state               TEXT    NOT NULL CHECK (state IN ('open','closed')),
  close_reason        TEXT    CHECK (close_reason IN ('answered','withdrawn','done','obsolete','overridden','undone','expired')),
  decision            TEXT,
  closed_by_staff_id  TEXT,
  raised_at           INTEGER NOT NULL,
  closed_at           INTEGER,
  CHECK ((state = 'closed') = (close_reason IS NOT NULL))
);
-- raise dedupe (A12): one open alert per key
CREATE UNIQUE INDEX alerts_open_dedupe ON alerts (dedupe_key) WHERE state = 'open';
-- tick: due steps (§3.5)
CREATE INDEX alerts_due ON alerts (next_due_at) WHERE state = 'open' AND next_due_at IS NOT NULL;
-- "my pending requests" (§6.8) and the no-approver check
CREATE INDEX alerts_requester ON alerts (requester_staff_id, state) WHERE request_json IS NOT NULL;

CREATE TABLE alert_recipients (               -- latest step's recipients, replaced per step
  alert_id      TEXT NOT NULL REFERENCES alerts(alert_id) ON DELETE CASCADE,
  staff_id      TEXT,
  device_id     TEXT,
  for_staff_id  TEXT,
  recipient_set TEXT NOT NULL CHECK (recipient_set IN ('answerer','informed','recipient')),
  step          INTEGER NOT NULL,
  CHECK ((staff_id IS NULL) <> (device_id IS NULL))
);
-- inbox and "requests I may answer" by person (§6.7, §6.9); alerts_open by device (§6 batch 3)
CREATE INDEX alert_recipients_staff  ON alert_recipients (staff_id, alert_id)  WHERE staff_id IS NOT NULL;
CREATE INDEX alert_recipients_device ON alert_recipients (device_id, alert_id) WHERE device_id IS NOT NULL;
CREATE INDEX alert_recipients_alert  ON alert_recipients (alert_id);

CREATE TABLE alert_inbox (                    -- every person ever a recipient today (inbox keeps past steps' people)
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
  at         INTEGER NOT NULL,
  PRIMARY KEY (alert_id, staff_id, device_id, kind)
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

-- §8.4, C-00 H-5 (installation state, written only by the hub CLI; not a projection)
CREATE TABLE app_releases (
  version_code     INTEGER PRIMARY KEY,
  version_name     TEXT    NOT NULL,
  sha256           TEXT    NOT NULL,
  staged_device_id TEXT,                      -- null = marked good, released to every tablet
  added_at         INTEGER NOT NULL
);
```

`alert_receipts` and `request_seen` have no foreign key (receipts can arrive for an alert the projection rebuilds later); they are deleted by `alert_id` in the same retention batch as their alert.

**Retention (Q6, v0.3 #7)** in the 00 M66 maintenance hour, in batches of 500, one `writer.run` per batch (events stay):
1. `alert_inbox`, `alert_receipts`, `request_seen` rows of alerts closed before the previous business day.
2. Closed `alerts` rows older than 7 days, oldest first; each batch first deletes `alert_receipts` and `request_seen` of those `alert_id`s, then the `alerts` rows, whose `alert_recipients` and any remaining `alert_inbox` rows go with them (`ON DELETE CASCADE`; `foreign_keys = ON`, `apps/hub/src/db/connection.ts`).
An error in a batch rolls that batch back and is caught and logged by the sweeper timer (C-00 H-8); retention continues next hour.

### 5.2 Projections (`registerProjection`, with `reset`)

| Projection | Events | Writes |
|---|---|---|
| `alerts` | `AlertRaised`, `AttemptSent`, `EscalationStepped`, `StepSkipped`, `RequestAnswered`, `RequestWithdrawn`, `AlertClosed`, `RequestSeen`, `BusinessDayClosed` | `alerts`, `alert_recipients`, `alert_inbox`, `request_seen`; `next_due_at` = time of the next undue step (§3.5); on `BusinessDayClosed`: `expire_due` (§3.5) |
| `alert_flags` | `SessionStarted`, `SessionEnded`, `StaffDirectoryApplied`, `BusinessDayOpened`, `BusinessDayClosed` | `no_approver` dirty = 1 (§3.9); `reset` re-inserts `('no_approver', 1)` |
| `alert_receipts` | `AlertDelivered`, `AlertSeen` | `alert_receipts` (INSERT OR IGNORE) |
| `device_bindings` | `SessionStarted`, `SessionEnded`, `DeviceRevoked`, `BusinessDayClosed`, `DevicePaired` (phones) | `device_bindings` by `session_id` (§3.7 rules); rebuild exact |
| `presence_today` | `PresenceSet`, `BusinessDayClosed` | `presence_today` |

**No hook writes events outside its cause's transaction.** `raise`, `close` and `request_result` commit with their cause inside the owning command; everything else that writes 01d events from another module's event (day-close expiry, `no_approver`) is written by the tick from a persisted projection flag (§3.5, §3.9). 00 gains no writer hook (v0.1's `writer.onAppended` dropped, v0.2 #2; it used the number H-7, which v0.3 gives to the catch-up change).

### 5.3 Cloud

No 01d table and no cloud schema change (v0.3: `pager_ids` moved to 01e). Cloud receives 01d events through sync (D52) like every other event; the owner remote view reads them (G0-8, later). `no_pin_staff` is read from existing columns (C-01b B-1, B-5).

### 5.4 Wire shapes (`packages/events/src/alerts.ts`)

`AlertTargetSchema` (discriminated union, §3.4), `AlertDisplaySchema` (`{ table_code?, point_code?, requester_name?, kind_label_key }`), `AlertViewSchema` (§6.3 frame body), `ALERT_CONSTANTS` (A14, `@pos/domain`), command payloads (§6.2–6.6).

---

## §6. Endpoints, commands and frames

All hub routes follow foundation §6.3 and 00 §3.7. `actor_id` = the session's staff. Query counts are fixed.

### Batch 1 — internal API (no route)

#### 6.1 `alerts.raise`, `alerts.close` (§4.2)

| | |
|---|---|
| Called from | an owning module's command `handle`, a tick intent, or 01d's own hooks |
| Processing (`raise`) | (1) kind registered, else startup-time `Error`. (2) `dedupe_key` open (`alerts_open_dedupe`), or already returned by an earlier `raise` in this transaction (§4.2)? → return `{ alert_id: <that one>, deduped: true, events: [] }`. (3) `alert_id = ids.next()`. (4) Request part: `approval` → copy `ctx.permission.approver_role_ids` (00 M10, the approvable command's grant) into the payload for the record; `named` → `receiver_staff_id` required. (5) Resolve step 0 (§3.4; for approvals, apply the G1-9d shortcut). (6) Return `[AlertRaised, AttemptSent(step 0)]` drafts. Post-commit sends happen through 01d's after-commit hook on `AttemptSent`. |
| Processing (`close`) | read the alert; closed → `[]`; else `[AlertClosed]` (+ `request_result` raise for a request closed `obsolete` / `overridden`) |
| Queries | raise: 1 dedupe read + `batchReads` for step 0 (sessions, bindings, devices, presence: 1 statement each; R resolvers; T routes) = ≤ 5 + R + T; directory in memory |
| Errors | `VALIDATION_FAILED { issue: 'target_unavailable' }` (unregistered resolver) |

### Batch 2 — commands and queries

#### 6.2 `POST /commands/answer-request` — `AnswerRequest`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); staff session required; right check = §3.3 rules 5–6 |
| Payload | `{ alert_id: ulid, decision: 'approve' \| 'reject' \| 'accept' \| 'decline', method: 'session' \| 'pin' \| 'in_person', answerer_staff_id?: ulid (required iff in_person), pin?: string(4–8 digits) (required iff pin / in_person) }` |
| `pinCheck` | `method ∈ pin, in_person` → `{ staff_id: in_person ? answerer_staff_id : session staff, pin }` (00 §3.5 via H-3); runs after the idempotency fast path and payload validation, before `writer.run` (§3.3 rule 4) |
| Processing | inside `writer.run`: (1) alert row → `404 ALERT_NOT_FOUND`; no request part → `404 ALERT_NOT_FOUND`. (2) state open → else `409 REQUEST_NOT_PENDING`. (3) decision ∈ the kind's `answers` → else `400 VALIDATION_FAILED`. (4) PIN rule (§3.3 rule 3) → `422 REQUEST_PIN_REQUIRED`. (5) Self, right, range (§3.3 rules 5–6) → `403 PERMISSION_DENIED { reason }`. (6) Append `RequestAnswered`. (7) `kind.apply(ctx, answer)` → its events (DomainError → rollback, error to the answerer, A4). (8) `request_result` alert to the requester (`raise`). (9) Commit; post-commit `alert_closed` to every recipient and the requester's sockets. |
| Result | `{ alert_id, decision, answered_at }` |
| Idempotency | `command_id` (00 M19); a retry after success replays the stored 200 |
| Race | two answers: both commands serialise in `BEGIN IMMEDIATE`; the second sees state closed → `409 REQUEST_NOT_PENDING { answered_by_name }` (test 6). Answer vs. `alerts.close`: same. |
| Errors | `400 VALIDATION_FAILED` (payload; decision not in the kind's `answers`), `401 PIN_INVALID`, `403 PERMISSION_DENIED { reason }` (incl. station session), `404 ALERT_NOT_FOUND`, `404 STAFF_NOT_FOUND` (in person, unknown answerer; from `checkPin`), `409 REQUEST_NOT_PENDING`, `422 REQUEST_PIN_REQUIRED`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` (argon2 semaphore), plus the kind's `apply` errors |
| Queries | 1 alert read, 1 `resolve` (memory), team walk in memory, writes; the `request_result` raise adds its `batchReads` (≤ 5 + R + T) |

#### 6.3 `POST /commands/withdraw-request` — `WithdrawRequest`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); right check = requester only |
| Payload | `{ alert_id }` |
| Processing | alert → 404; open → else 409; session staff = requester → else `403 { reason: 'not_requester' }`; append `RequestWithdrawn` + `kind.onWithdraw` events; post-commit `alert_closed` |
| Result | `{ alert_id }` |
| Idempotency | `command_id` (00 M19) |
| Errors | `400`, `403 PERMISSION_DENIED { reason: 'not_requester' }` (or station session), `404 ALERT_NOT_FOUND`, `409 REQUEST_NOT_PENDING`, plus the kind's `onWithdraw` errors |
| Queries | 1 alert read, writes |

#### 6.4 `POST /commands/mark-alerts-seen` — `MarkAlertsSeen`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); right check = only ids in the person's own inbox are acted on |
| Payload | `{ alert_ids: ulid[1..50] }` |
| Processing | one statement reading `alert_inbox` joined to `alerts` and `request_seen` for (session staff, ids); ids not in the person's inbox are ignored (no error, no leak). For each open request alert not yet in `request_seen` for this person → append `RequestSeen` (same transaction); post-commit `alert_seen` frame to the person's devices (§3.6). For each open `closes_on: 'seen'` alert → `AlertClosed 'done'`. Queue `AlertSeen` for every id with `tx.onCommit` (buffer, A11; nothing is buffered if the command rolls back). |
| Result | `{ seen: ulid[] }` (the ids acted on) |
| Idempotency | `command_id` (00 M19); a repeat with a new `command_id` writes no second `RequestSeen` (PK) and buffers no duplicate receipt (§3.6) |
| Errors | `400` (payload), `403` (station session) |
| Queries | 1 read, writes |
| Note | Counts as session activity (00 M59). |

#### 6.5 `POST /commands/send-test-alert` — `SendTestAlert`

| | |
|---|---|
| Permission | `manage-devices` |
| Payload | `{ target: { kind: 'person', staff_id } \| { kind: 'team', lead_staff_id, depth?: 'direct' \| 'all' (default 'direct') } \| { kind: 'device', device_id } \| { kind: 'point', point_id } }` |
| Processing | point without a registered resolver → `422 CONFIG_REFERENCE_INVALID { field: 'target.point_id', reason: 'points_not_available' }`; unknown staff / device (or revoked device) → `404 STAFF_NOT_FOUND` / `DEVICE_NOT_FOUND`; `raise('test_alert', subject hub / branch_id, dedupe_key = 'test:' + command_id)` (the alert id is made inside `raise`, so the key uses the command's id) |
| Result | `{ alert_id }` |
| Idempotency | `command_id` (00 M19); the dedupe key also makes a retried raise a no-op |
| Errors | `400`, `403 PERMISSION_DENIED`, `404 STAFF_NOT_FOUND` / `DEVICE_NOT_FOUND`, `422 CONFIG_REFERENCE_INVALID` |
| Queries | 1 existence read (staff in memory; device 1 statement) + raise |

#### 6.6 `POST /commands/set-presence` — `SetPresence` (§3.11)

| | |
|---|---|
| Permission | `manage-staff` (§12.3 Q2) |
| Payload | `{ staff_ids: ulid[1..100], present: boolean }` |
| Processing | business day open → else `409 BUSINESS_DAY_NOT_OPEN`; ids in neither `staff` nor `no_pin_staff` → `404 STAFF_NOT_FOUND { staff_ids }`; append `PresenceSet` |
| Result | `{ business_day_id, staff_ids, present }` |
| Idempotency | `command_id` (00 M19); setting the same value again is harmless (projection upsert) |
| Errors | `400`, `403 PERMISSION_DENIED`, `404 STAFF_NOT_FOUND`, `409 BUSINESS_DAY_NOT_OPEN` |
| Queries | 1 (open business day), directory in memory, writes |

#### 6.7 `GET /queries/alerts-inbox`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Input | `?cursor&limit` (default 50, max 200) |
| Returns | today's alerts where the person is in `alert_inbox` (and those "for" their reports), **open action alerts first**, then by `raised_at` desc: `AlertViewSchema` + `seen_by_me`, `moved_to_name`, `for_staff_name`. |
| Queries | 2 (page of ids by index, then a join for views) |

#### 6.8 `GET /queries/my-requests`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Input | none (bounded: my open requests plus today's closed ones) |
| Returns | pending requests where `requester_staff_id` = me, plus today's answered / closed ones; each with decision, answerer name, waiting time and `ask_in_person: true` after `approval_branch_ms` |
| Queries | 1 (`alerts_requester`) |

#### 6.9 `GET /queries/requests-to-answer`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Returns | open requests where I am in the **latest** step's recipients as `answerer` or `informed`; `can_answer` recomputed now with §3.3 rules 5–6 (so a right removed after the step shows read-only) |
| Queries | 2 + memory |

#### 6.10 `GET /queries/alert-receipts?alert_id=`

| | |
|---|---|
| Session | staff; the handler requires `manage-devices` (`403 PERMISSION_DENIED`); unknown alert → `404 ALERT_NOT_FOUND` |
| Returns | per step: `AttemptSent` / `EscalationStepped` recipients and routes, read from `events` by the alert's subject stream (`stream_type`, `stream_id` from the alert row, `event_type IN ('AttemptSent','EscalationStepped')`, filtered to this `alert_id`; the 00 stream index serves it); delivered / seen times per person and device from `alert_receipts`. For `test_alert` and support. |
| Queries | 3 (alert row, step events, receipts) |

### Batch 3 — WS frames (H-1, H-2)

Server → device:

```json
{ "type": "alerts_open", "alerts": [ { "alert_id": "01JD…", "kind": "test_alert", "family": "info", "step": 0, "lock": { "kind_label_key": "alert.test_alert.lock", "table_code": null, "point_code": null, "requester_name": "Imran" }, "raised_at": 1761900000000 } ] }
{ "type": "alert", "alert": { "alert_id": "01JD…", "kind": "void_approval", "family": "urgent", "step": 1, "escalation": false, "set": "answerer", "for_staff_id": null, "lock": { "kind_label_key": "alert.void_approval.lock", "table_code": "12", "point_code": null, "requester_name": "Hamza" }, "card": { … } , "raised_at": 1761900000000 } }
{ "type": "alert_seen", "alert_id": "01JD…" }
{ "type": "alert_closed", "alert_id": "01JD…", "reason": "answered", "decision": "approve", "by_name": "Imran" }
```

- `card` (full display, label params for the signed-in text) is included **only** for **person** recipients, on that person's own staff-session sockets. Everything else gets `lock` only (G1-13e): alert-mode sockets, and every socket of a **device-target** recipient (`always_on`, `point`, `device`), whatever its session kind — a KDS's station socket, a signed-in kiosk's cashier socket, or an alert-mode socket. A KDS therefore needs no second socket.
- `alert_seen` (§3.6) goes to the person's staff-session sockets and the alert-mode sockets of devices bound to them; the client stops the urgent repeat for that alert (§8.3).
- Sent after commit, once per step per socket; not part of the `seq` stream (no gap logic). A missed frame is covered by `alerts_open` on reconnect (alert mode) or the `alerts` catch-up part (staff and station sessions, `registerCatchUp` part `alerts` with the socket context, H-7: open alerts for this person and device, each with `seen_by_me`, 1 query).
- Post-commit sends for closes (`alert_closed`) read the recipients of **all** alerts closed in the transaction in one statement (`alert_recipients WHERE alert_id IN (…)`), so a tick that expires 200 alerts at day close issues one read, not 200.

Device → server:

```json
{ "type": "receipt", "alert_id": "01JD…", "kind": "delivered" }
```

- Accepted on every socket kind; only `delivered` (seen needs `MarkAlertsSeen`, §6.4). The hub records `staff_id` = the session staff, or the device's binding in alert mode, or `''` for a device-target alert. Unknown alert, or an alert this device was not sent → ignored. Repeats are dropped before buffering (§3.6), so no rate limit is kept (v0.3 #12).

### 6.11 Endpoint count

5 commands, 4 queries, 5 frame types (`alerts_open`, `alert`, `alert_seen`, `alert_closed`, `receipt`), 1 catch-up part, 8 hub exports (`defineAlertKind`, `alerts.raise`, `alerts.close`, `alerts.byDedupeKey`, `registerTargetResolver`, `registerRoute`, `alerts.recordReceipt`, `registerTick`); plus the 00 APK endpoints and CLI of H-5 (§8.4).

---

## §7. Cross-cutting (this module only)

| Item | Rule | Prevents |
|---|---|---|
| Tick | 500 ms; one read-only `due` statement per registered tick; `writer.run` only when it is true; each registered tick in its own transaction, errors logged per tick; `LIMIT 200` per pass, the rest next pass | A write transaction (state swap, every after-commit hook) every 500 ms with nothing to do; one rush tick blocking commands; a 01d bug rolling back kitchen fires |
| Receipt buffer | 1 000 ms or 100 receipts; one `writer.run`; empty buffer → no transaction; deduped before buffering; dropped on crash (A11) | fsync per receipt; duplicate receipt events |
| Timers' errors | the hub tick, the receipt flush and the 00 sweeper (H-8) catch, log and continue | an uncaught timer error crashing the hub process |
| Logging | alert ids, kinds, step numbers; never PINs, never `card` text (amounts and reasons) | Leaking money and reasons into logs |
| Performance | raise ≤ 5 ms in-transaction at 10 sockets; tick with 200 due ≤ 50 ms | A rush of Ready-to-serve alerts slowing commands |
| Folder | `apps/hub/src/alerts/` (`kinds.ts`, `raise.ts`, `targets.ts`, `routes.ts`, `tick.ts`, `receipts.ts`, `bindings.ts`, `alert-sockets.ts`, `commands/*.ts`, `queries/*.ts`, `ws-frames.ts`); `apps/hub/src/app-update/` (H-5 routes and CLI); `packages/events/src/alerts.ts`, `events/alert/*.v1.ts`; `packages/domain/src/alert-constants.ts`; client `apps/client/src/alerts/` | — |

---

## §8. Client contract

### 8.1 All clients (tablet app, kiosk, KDS, phone browser)

- On sign-in: open the staff-session WS as today; render `alert` frames as a banner + sound (family, §8.3) and add to the inbox; tapping opens the detail and calls `MarkAlertsSeen`.
- Requests: detail shows Approve / Reject (or Accept / Decline) when `can_answer`; read-only with "Find <approver> or a manager" when `set = 'informed'` (G1-9b). Money kinds always show the PIN pad; accept kinds are one tap (pilot).
- In-person fallback: on the requester's own device, "Approve here" → pick the approver's name (roster) → PIN → `AnswerRequest { method: 'in_person' }`.
- Requester: the waiting card from `my-requests`; after `approval_branch_ms` "Waiting 2 min — ask in person"; never a repeating sound (G1-14f); `request_result` → rising chime approved, falling tone rejected (G0-2).
- Errors: `REQUEST_NOT_PENDING` → "Already approved by <name>" (close the card); `PERMISSION_DENIED { reason: 'out_of_range' }` → "Not your team — a manager can approve"; `REQUEST_PIN_REQUIRED` → show the PIN pad.
- Header **"Alerts: <name>"** on tablets (G1-13c).

### 8.2 Tablet app (Capacitor, bundled)

- **Background service** keeps the **alert-mode** WS (device token only) whenever the app has a device token, signed in or not; on an `alert` frame raises an Android notification with the `lock` text and the family's sound / vibration; sends `receipt delivered`. Reconnect with backoff (max 5 s, §5.4); `alerts_open` on reconnect.
- Device owner (lock-task): the app whitelists itself from battery optimisation (device-owner policy) — no per-brand steps on restaurant tablets.
- Token storage as 00 §8.1 (Keystore-backed). The service never holds the session token.

### 8.3 Sounds (G0-2, G1-14) — client behaviour, no events

| Family | On a step | Repeat |
|---|---|---|
| urgent | two-tone rising, vibration long-long | every 10 s on the person's devices **until seen** by that person (any device): the `alert_seen` frame (§3.6) stops it on every other device at once; after a reconnect, `seen_by_me` in the `alerts` catch-up / `alerts_open` gives the same state. After seen, one reminder every 2 min until closed. Not seen by the escalation step → drops to the 2-min reminder with one volume step-up (G1-14c). |
| action | bright double ding, once | none (re-sent only by the next step) |
| info | single soft chime, once | none |

Always-on screens (kiosk, KDS, point tablets): one sound per step, then a badge only (G1-14d). No snooze (G1-14e). At most five sounds in total.

### 8.4 App update (G1-15)

- **Pilot minimum (C-00 H-5):** `GET /app/android/latest` → `{ version_name, version_code, sha256, staged_device_id | null }` (the newest release this device may install) and `GET /app/android/<version_code>.apk`; the app checks `latest` after each reconnect and once an hour, downloads when `version_code` is higher than its own, and verifies `sha256` before installing.
- The app installs silently (device owner, `PackageInstaller`) only when no session is signed in on it, or the business day is closed, or in the M66 maintenance hour; bound alert devices prefer the last two windows (the install drops the alert connection, G1-15b note). `426 CLIENT_UPGRADE_REQUIRED` stays the hard trigger.
- Staged (G1-15c): the developer adds a release with `app-release add … --stage <device_id>`; only that tablet sees it in `latest`. After checking it, the developer runs `app-release mark-good <version_code>`, which releases it to every tablet. No other rollout state in the pilot.
- Rollback = rebuild with a higher `versionCode` (Android forbids downgrades; an uninstall would wipe the command queue). The hub keeps the newest 2 good versions plus a staged one.
- One release key, backed up in two places (installation runbook).

---

## §9. Error catalogue additions

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `ALERT_NOT_FOUND` | 404 | `{ alert_id }` | `AnswerRequest`, `WithdrawRequest` on an unknown alert, or an alert with no request part |
| `REQUEST_NOT_PENDING` | 409 | `{ alert_id, state: 'closed', close_reason, decision \| null, answered_by_staff_id \| null, answered_by_name \| null }` | answer or withdraw after the request was answered, withdrawn or closed |
| `REQUEST_PIN_REQUIRED` | 422 | `{ alert_id, kind }` | `method: 'session'` on a kind that needs a PIN |

Reused: `PERMISSION_DENIED` (`details.reason ∈ self, not_approver, out_of_range, not_receiver, not_requester`), `PIN_INVALID`, `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `SERVICE_UNAVAILABLE` (argon2 semaphore, 00 §3.5 step 5), `CONFIG_REFERENCE_INVALID`, `STAFF_NOT_FOUND`, `DEVICE_NOT_FOUND`, `DEVICE_TYPE_NOT_ALLOWED` (H-5), `ROUTE_NOT_FOUND` (H-5), `BUSINESS_DAY_NOT_OPEN`, `VALIDATION_FAILED`. Appended to foundation §6.2 and `@pos/domain/src/errors.ts` (C-F F-4).

---

## §10. Tests

Test files under `apps/hub/test/alerts/`; a **test kind** `t_approval` (approval mode, `range_permission` set, `apply` that can be told to throw) and `t_accept` (named mode) are registered only in tests.

### 10.1 Pure

1. `resolveTarget` for `person`, `permission` with `my_team` range, `team` direct and all (with `no_pin_staff`), `answerers` / `branch_scope` / `holders_informed` split.
2. Team walk: depth bound, loop-safe, `my_team` covers a grand-report.
3. Routes of a person (§3.4.3): screen + binding + registered route; no route → lead with `for_staff_id`; lead none → `managers`.
4. Step selection: several steps due → latest sent, earlier `StepSkipped`; `{ value: 'window_ms', times: 2 }`.
5. Presence filter incl. the safety rule (nobody ticked → all present; signed-in → present).

### 10.2 Commands

6. Two `AnswerRequest` at once on one request → one 200, one `409 REQUEST_NOT_PENDING { answered_by_name }`; one `RequestAnswered`.
7. `apply` throws → 200 not returned, no `RequestAnswered`, request still pending, error code passed through.
8. Right removed between step and answer (directory apply) → `403 not_approver`.
9. `my_team` answerer for a requester outside the team → `403 out_of_range`; branch-scope answerer → 200.
10. Self answer → `403 self` (every method, incl. in person naming the requester); requester who is the only in-range approver signed in → step 0 goes to other branch-scope approvers; none → step 0 written with no answerers, request pending, `my-requests` shows `ask_in_person` after `approval_branch_ms`; no per-request warning is raised (§12.4).
11. Money kind with `method: 'session'` → `422 REQUEST_PIN_REQUIRED`; accept kind with `method: 'session'` → 200 without PIN.
12. In person: wrong PIN → `401 PIN_INVALID` counted on the answerer and this device; lockout → 429; right PIN → `RequestAnswered { method: 'in_person', device_id }`.
13. Withdraw by requester → closed `withdrawn`, `onWithdraw` events; by someone else → 403; after answer → 409.
14. `alerts.close(…, 'obsolete')` on a request → `AlertClosed` + `request_result` to the requester; close after answer → no events.
15. `raise` twice with one `dedupe_key` → second `deduped: true`, no events; after close, raise again → new alert.
16. `MarkAlertsSeen`: first seen of a request → `RequestSeen` once; second call → none; ids not in my inbox ignored; `request_result` closes `done`.
17. `SendTestAlert` to person / team (default `depth: 'direct'`) / device; point → 422 `points_not_available`; without `manage-devices` → 403; same `command_id` replayed → one alert (`dedupe_key = 'test:' + command_id`).
18. Answer idempotency: same `command_id` replays 200.

### 10.3 Tick, restart, receipts

19. Approval tier timing: step 0 at raise, step 1 at 45 s (+ always-on), escalation at 120 s with branch-scope answerers and informed holders.
20. G1-9d shortcut: no in-range answerer signed in → step 0 goes to branch scope.
21. Restart with the hub down 4 min after a raise → one `EscalationStepped`, `StepSkipped` for step 1, no step 0 resend.
22. **Idle tick:** nothing due and no dirty flag → exactly one `SELECT` per registered tick, `writer.run` is never called (writer spy), and no `afterCommit` hook runs.
23. Receipts: 150 distinct `receipt` frames → 2 flushes; repeats dropped before buffering (no duplicate `AlertDelivered` event); an empty buffer opens no transaction; crash before flush loses only that batch (simulated); `AlertDelivered` on `audit` with subject fields; a `MarkAlertsSeen` that rolls back buffers no `AlertSeen`.
24. Day close: requests stay open; tablet / kiosk bindings cleared; phone bindings kept (expiry of non-request alerts: test 36).
25. Table's team target via a registered fake `tableOwner`; owner changes between steps → step 2 goes to the new team; old team's inbox shows `moved_to`.

### 10.4 WS and bindings

26. Alert-mode auth with device token only → `alerts_open`, then `alert` frames with `lock` only; any non-`receipt` frame → close 4401; revoke → 4403; rotation → 4401.
27. Binding: sign-in sets it (with `session_id`); idle timeout keeps it; logout ends it; a `SessionEnded` of an older session on the same device after a newer sign-in does not end the newer binding; takeover moves it; phone → owner; **rebuild:** `reset` + replay gives identical rows, and after a simulated cloud-only restore (sessions ended `hub_restored`) no binding is left.
28. A session-less tablet bound to Ali receives Ali's alert; signed-in Bilal on another tablet does not.
29. Staff-session socket gets `card`; alert-mode socket never gets `card` (no amounts or reasons in frames).
30. Receipt for an alert this device was not sent, or an unknown alert → ignored; `receipt` on a station socket of a KDS that got a device-target alert → recorded with `staff_id = ''`.

### 10.5 Directory and warning

31. `no_pin_staff` applied: in `teamOf({ includeNoPin })`, not in the roster; PIN set → moves lists in one version; older hub (no field) applies.
32. `no_approver`: day open, last branch-scope approver logs out → alert open on kiosk + managers within one tick; approver signs in → closed `done`; flag survives a restart.

### 10.6 Added in v0.2

33. **Handler-checked commands:** the registry rejects `permission: 'checked-in-handler'` on a command not in `HANDLER_CHECKED_COMMANDS` (startup error); for each listed command, a call by a person without the right (answer: not an approver; withdraw: not the requester; seen: ids not in the inbox) writes nothing and returns `403` (or, for seen, acts on no id); a station session → `403`.
34. **Answer vs. tick (single synchronous connection, v0.3):** alert A with step 1 due. (a) The `alerts.due` pre-check returns true for A → `AnswerRequest` for A commits → the tick's `writer.run` body runs → no `AttemptSent` / `EscalationStepped` for A, and the transaction appends nothing. (b) Reverse: the tick pass for A commits its step → `AnswerRequest` commits → the next pass's pre-check is false for A (closed) and no `writer.run` opens. In both orders no step event for A has a `seq` after its `RequestAnswered`. (There is no two-connection case: the hub has one connection and `writer.run` has no `await`.)
35. **Fixed reads per tick:** with 1 and with 150 due alerts (mixed person, team, table-team targets via a fake batched resolver, and a fake pager-like route whose `routesFor` is batch-shaped), the tick runs the same number of SELECT statements, ≤ 1 + 7 + R + T (counted with a statement spy on the connection); `raise` likewise is independent of team size (≤ 5 + R + T); a route that runs one statement per person fails the test.
36. Day close → open info alerts closed `expired` by the next tick, not in the day-close transaction.

### 10.7 Added in v0.3

37. **Tick isolation:** two registered ticks (`alerts` and a fake `fires`); `fires.intents` throws → its transaction rolls back and the error is logged `{ tick: 'fires' }`; the `alerts` step of the same pass is committed; and the reverse (a throwing `alerts` tick does not stop a `fires` intent). Both get the same `now`. A tick whose `due` is false opens no transaction.
38. **Retention with foreign keys on:** closed alerts older than 7 days with recipients, inbox, receipts and seen rows → deleted in batches of 500 with no foreign-key error; `alert_recipients` rows go with their alert; a batch error is caught and logged by the sweeper and the next run continues.
39. **`alert_seen`:** Ali bound to tablets A and B (one alert mode, one signed in) with an urgent request; `MarkAlertsSeen` on A → after commit B gets `{ type: 'alert_seen', alert_id }` and A's other sockets get it too; a second `MarkAlertsSeen` sends no frame; after reconnect `alerts_open` / catch-up shows `seen_by_me: true`.
40. **APK update:** no release → `latest` `404`; `add` staged to tablet T1 → T1's `latest` returns it, T2's returns the previous good release (or `404` if none); `mark-good` → T2 gets it; `GET …/<version_code>.apk` streams the file with the stored `sha256`; KDS device → `403 DEVICE_TYPE_NOT_ALLOWED`; `add` keeps the newest 2 good versions plus the staged one.
41. **`my-requests`:** pending first with `ask_in_person` false before and true after `approval_branch_ms`; today's answered one with decision and answerer name; yesterday's closed one absent; 1 statement.
42. **`alerts-inbox`:** open action alerts first, then by `raised_at` desc; "for Ali" cards on the lead; `moved_to_name` on the old team; cursor paging at `limit` 2 over 5 alerts; 2 statements whatever the count.
43. **`alerts` catch-up part:** a staff socket and a KDS station socket get their open alerts (person and device targets) through `build(db, state, socketCtx)`; 1 statement; an alert-mode socket is not in the catch-up path (`alerts_open` instead).
44. **Answer payload:** decision outside the kind's `answers` (`accept` on an approval kind) → `400 VALIDATION_FAILED`; `in_person` with an unknown `answerer_staff_id` → `404 STAFF_NOT_FOUND`, not counted as a PIN failure; a retried answered `command_id` replays `200` without a PIN check (argon2 spy not called).
45. **`SetPresence`:** sets and clears presence for PIN and no-PIN people; business day closed → `409 BUSINESS_DAY_NOT_OPEN`; unknown id → `404`; without `manage-staff` → `403`; projection cleared on `BusinessDayClosed`.
46. **`alert-receipts`:** a `test_alert` to a team over two steps (a fake two-step test kind) → per-step recipients and routes read from the step events, delivered / seen per device; 3 statements; without `manage-devices` → `403`.
47. **Same key twice in one transaction:** a handler calls `raise` twice with one `dedupe_key` before appending → second returns the first `alert_id` with `deduped: true`; one `AlertRaised`; no constraint error.
48. **Directory bound:** `GET /v1/sync/config` `200` with the directory and `no_pin_staff` runs ≤ 27 statements (B-5); a PIN-holder whose lead is in `no_pin_staff` keeps the lead on the hub (B-6).

### 10.8 Acceptance table

| Story AC | Covered by | Tests |
|---|---|---|
| E-NOTIF AC1 targets | §3.4 | 1, 2, 25 |
| E-NOTIF AC2 R1 / R2 (tablets) / R3 | §3.4.3, §3.7, §3.5 | 3, 19, 26, 28, 39 |
| E-NOTIF AC3 no internet | LAN only (§2) | 26 |
| E-NOTIF AC4 iPhones | unchanged by design (R22) | — (no test) |
| E-NOTIF AC5 (approvals only) | §3.9 | 32 |
| E-NOTIF AC6 audit | §3.6, events | 16, 23 |
| E-REQ AC1 pending | §3.2–3.3 | 19 |
| E-REQ AC2 own PIN | §3.3 rules 2–4 | 11, 12 |
| E-REQ AC3 answer shown | §6.2 step 8, `request_result` | 14, 16 |
| E-REQ AC4 in-person fallback | §3.3 rule 2 | 12 |
| E-REQ AC5 right checked on arrival | §3.3 rule 6 | 8, 9 |
| E-REQ AC6 first answer wins | §6.2 race | 6 |
| E-REQ AC7 no auto-cancel | §3.3 | 24 |

---

## §11. Build order

1. `packages/domain`: error codes (§9), `ALERT_CONSTANTS` (A14), families, close reasons. Tests 1–5 scaffolding.
2. `packages/events`: alert events (§4.2), `alerts.ts` wire shapes, WS frames (H-2). Fixture tests.
3. 00 hooks (H-1, H-3, H-4, H-7, H-8): `pinCheck` after the fast path, `'checked-in-handler'` with `HANDLER_CHECKED_COMMANDS`, alert-mode WS in its own socket list, `receipt` on session sockets, `sendToDevices` / `sendToStaff`, `registerCatchUp` `build(db, state, socketCtx)`, sweeper try/catch. 00 tests updated; tests 33, 44.
4. Migration `0006_alerts.sql` (§5.1, incl. `ON DELETE CASCADE`, `device_bindings.session_id`, `app_releases`); projections (§5.2); retention (§5.1) — test 38.
5. `alerts/kinds.ts`, `targets.ts` (§3.4), `routes.ts` (§3.4.3, §3.8) — tests 1–5.
6. `alerts/raise.ts`, `close` (§6.1) — tests 14, 15, 47.
7. Commands `AnswerRequest`, `WithdrawRequest`, `MarkAlertsSeen` with test kinds (§6.2–6.4) — tests 6–13, 16, 18.
8. `alerts/tick.ts` (§3.5: one loop, `due` pre-check outside the lock, each registered tick in its own `writer.run`, authoritative selection inside, `batchReads`, errors logged per tick) and `registerTick` — tests 19–22, 24, 25, 34–37.
9. `alerts/receipts.ts` buffer (dedupe before buffering, empty flush skipped, `tx.onCommit`), WS `receipt` and `alert_seen` (§3.6) — tests 23, 30, 39.
10. `alerts/bindings.ts` (by `session_id`) and alert-mode delivery (§3.7) — tests 26–29.
11. Kinds `test_alert`, `request_result`, `no_approver` (§3.10, §3.9); `SendTestAlert` — tests 17, 32.
12. 01b v1.4 directory fields (C-01b B-1, B-3, B-5, B-6) — tests 31, 48.
13. Queries (§6.7–6.10), `alerts` catch-up part — tests 41–43, 46.
14. App update endpoints and CLI (C-00 H-5, §8.4) — test 40.
15. `SetPresence` and the presence filter (§3.11) — tests 5, 45.
16. Client: banner, inbox, request detail, in-person flow, sounds and `alert_seen` (§8.1, §8.3); tablet background service and lock text (§8.2); app update client (§8.4).

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

- Every test in §10 passes; `pnpm -w typecheck` (incl. tests, R31) and lint pass.
- A `test_alert` sent from a manager's tablet reaches a session-less, screen-off pilot tablet as an Android notification, and the receipt view shows delivered and seen.
- The §4.5 bumps are approved and applied (README, CLAUDE.md + R34, foundation v1.8 incl. F-5–F-8, 00 v1.6 incl. H-5, H-7, H-8, 01b v1.4 incl. B-5, B-6) before the build merges.
- An idle hub opens no 01d transaction (test 22); an APK release reaches the staged tablet first and the rest only after `mark-good` (test 40).
- No 01d code reads a role name (R5); every pilot value is in `ALERT_CONSTANTS` (A14), none inline.

### 12.2 Checklist

| # | Item | Kind | Section | Tests |
|---|---|---|---|---|
| 1 | `alerts.raise` / `close` | internal | 6.1 | 14, 15 |
| 2 | `AnswerRequest` | command | 6.2 | 6–12, 18, 33, 44 |
| 3 | `WithdrawRequest` | command | 6.3 | 13, 33 |
| 4 | `MarkAlertsSeen` | command | 6.4 | 16, 33, 39 |
| 5 | `SendTestAlert` | command | 6.5 | 17 |
| 6 | `SetPresence` | command | 6.6 | 5, 45 |
| 7 | `alerts-inbox` | query | 6.7 | 25, 42 |
| 8 | `my-requests` | query | 6.8 | 41 |
| 9 | `requests-to-answer` | query | 6.9 | 8 |
| 10 | `alert-receipts` | query | 6.10 | 46 |
| 11 | WS alert mode + frames (`alerts_open`, `alert`, `alert_seen`, `alert_closed`, `receipt`) | ws | 6 batch 3 | 26–30, 39 |
| 12 | `alerts` catch-up part | ws | 6 batch 3, H-7 | 43 |
| 13 | Tick (`registerTick`, `due`, own transactions) | job | 3.5 | 19–22, 24, 34–37 |
| 14 | Receipt buffer | job | 3.6 | 23 |
| 15 | Retention | job | 5.1 | 38 |
| 16 | `GET /app/android/latest`, `GET /app/android/<version_code>.apk`, CLI `app-release add` / `mark-good` | 00 endpoints + CLI | H-5, 8.4 | 40 |

### 12.3 Open questions — answered (developer, 2026-11-01)

| # | Question | Answer |
|---|---|---|
| Q1 | "Manager" for non-approval fallbacks (G1-11d) | Branch-scope holder of `force-release-table-lock` (§3.4). |
| Q2 | Who sets "Present today" | `manage-staff` (§3.11). G1-20 **kept** (developer as the owner's proxy, 2026-11-01). |
| Q3 | Self-answer | Never, for everyone. Requester the only in-range approver signed in → step 0 to the other branch-scope approvers; none → step 0 with no answerers, request stays pending, "ask in person" (§3.3 rule 5, §3.5); per-request warning deferred (§12.4). **Confirmed** by the developer as the owner's proxy, 2026-11-01. |
| Q4 | Day-close expiry and `no_approver`: writer hook or tick | Tick; the v0.1 writer hook dropped (§3.5, §3.9, §5.2). (v0.3's H-7 is the catch-up change, a different row.) |
| Q5 | APK hosting | 00 (H-5). |
| Q6 | Retention of projection rows | Receipts: previous business day; closed alerts: 7 days; events forever (§5.1). |
| Q7 | Pager id format | Text until the spike (G0-10); now in 01e's 01b bump (§4.3 To 01e). |
| Q8 | `approver_role_ids` empty at answer time | `403 not_approver`; owning modules close stale requests `obsolete` (§3.3 rule 6). |
| Q9 | 01a setting or constants | Constants (A14); settings post-pilot (§12.4). |

Open for the owner: none (Q3 confirmed, G1-20 kept, 2026-11-01).

### 12.4 Deferred until needed

- Personal-phone alert app (APK on staff-owned phones) — post-pilot product item (G1-19).
- General "no route reaches this person" warning (Q-N5 beyond approvals).
- Free-text and cross-team task messages beyond zone-stock transfers (README "cross-team requests").
- Customer table call buttons.
- Inbox history beyond the current day.
- Reports and dashboards over receipts and attempts (07, P2).
- Main / secondary roles and capacity fields (R25, 01b B1).
- iPhone locked-screen alerts (R22).
- Shift system / clock-in (§3.11 is presence only).
- Pager delivery receipts (01e).
- Scoped `approve-discount` / `approve-comp` (range for discount and comp; 01b, post-pilot; G1-23).
- **Branch settings for 01d values** (R18, added when an owner asks): configurable approval timings, and "a branch may add a PIN to accept kinds" (G1-10e). Pilot: `ALERT_CONSTANTS` (A14).
- **Per-request "no one can answer this request" warning** (v0.3 #9): the case where the only branch-scope approver signed in is the requester; the pilot keeps the per-permission warning (§3.9) and the requester's "ask in person" line.
- **APK rollout beyond the pilot minimum** (percentages, per-device history, owner-page release controls); pilot: §8.4, H-5.
- `pager_ids` directory map and its sync bound — 01e's 01b bump (§4.3).
- Snooze — decided **no** (G1-14e), listed so it is not re-asked.

### 12.5 Self-check (author, v0.3, after G2)

- **Races:** answer vs. answer, answer vs. close, raise vs. raise (dedupe index, and the in-transaction key map, test 47), tick vs. answer (§3.5: authoritative selection inside `writer.run`, pre-check is a hint; single synchronous connection; test 34).
- **Idempotency:** commands by `command_id`; raise by `dedupe_key`; receipts deduped before buffering and by PK; `RequestSeen` by `request_seen` PK; `pinCheck` after the fast path (test 44).
- **N+1:** queries fixed (§6.7–6.10); tick ≤ 1 + 7 + R + T and raise ≤ 5 + R + T statements, resolvers and routes batch-shaped (§3.5; test 35); close frames read recipients in one statement.
- **Write contention:** idle passes open no transaction (test 22); receipt flush skips an empty buffer; each registered tick in its own transaction (test 37).
- **Restart:** persisted projections and flags; latest due step sent once, earlier ones skipped (test 21); bindings rebuilt exactly by `session_id` (test 27); receipts may lose the last batch (accepted, A11).
- **Contradictions found and handled:** foundation §4.5 "push to all holders" vs. G1-9 (F-1); foundation §6.3 / §5.4 / §6.5 WS text (F-5–F-7); 00 M12 session-only WS (H-1); 00 `defineCommand` permission rule (H-3, listed marker; station `null` kept); 00 `registerCatchUp.build` without a socket (H-7); `SessionEnded` without `device_id` (§3.7, `session_id`); retention vs. foreign keys (§5.1, H-8); sync bound at 26 (B-5); `RequestSeen` placement vs. persisted projections (§3.6 note).
- **Over-engineering check:** route interface has one known user (01e, mandatory for the pilot); no cloud tables or cloud schema change; `pager_ids` moved to 01e; no settings pipeline (A14); no writer hook; no outbox (post-commit frames are best-effort by design, receipts show gaps); receipt rate limit dropped; per-request warning deferred; APK update cut to two endpoints and two CLI verbs.
