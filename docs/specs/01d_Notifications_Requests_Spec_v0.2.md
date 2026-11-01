# 01d — Notifications and requests — Module Spec v0.2 (DRAFT, G2 pending)

## §1. Header

| | |
|---|---|
| Module | 01d Notifications and requests |
| Version | **v0.2 — DRAFT** (2026-11-01, developer review of v0.1). G2 (gate check) runs in a fresh session. v0.1: first draft from G0 + G1. |
| Inherits | Shared Standards from **Foundation v1.7** §6 (envelope, error naming, hub HTTP and WS conventions, naming, tests, migrations, folders). Not redefined here. |
| Depends on | Foundation v1.7; **00 Hub Platform & Access v1.5** (command and query registry, writer, WS, sessions, PIN check, directory); **01b Staff and Roles v1.3** (effective permission with scope and approvers, `leadOf`, `teamOf`); **01a Restaurant Setup v2.0** (business day events only; 01d changes nothing in 01a) |
| Inputs | `docs/stories/01d-g0-decisions.md` (G0 register, with G1 markers), `docs/stories/01d-g1-decisions.md` (G1 record, G1-1 … G1-24), `docs/stories/01d-notifications-teams-refined.md` (2026-10-27 owner record) |
| Tier | T2 Production (CLAUDE.md). Races that matter here: two answers at once (first wins), answer vs. close, raise twice for one subject. |
| Changes other specs | §4.5 (R26). Every change there is **Proposed — needs approval** and is applied by version bump at approval, not by this draft. |

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
- "No one can approve" warning (§3.9), the `test_alert` kind (§3.10), "Present today" (§3.11, *Proposed — owner may skip*).
- Inbox and request queries (§6 batch 2), alert frames (§6 batch 3).
- Android tablet app: background service, lock-screen text, hub-hosted silent update (§8).

### Out of scope

- **01e Device gateway (pilot, mandatory, own spec after the hardware spike):** compact device protocol, `pager_bridge`, headless pairing, ESP32 station button devices, the pager route itself, pager assignment by shift, device health (G0 D3–D5, G1–G7, G1-17a). 01d only defines the route interface (§3.8).
- Kitchen and serving model, zones, zone stock, comps, lanes (G0 §4, §5, §5a): owned by 01a, 01b, 02, 03a, 03b, 05. Those modules register their kinds and resolvers here (§4.2).
- The request kinds of other modules (void 04, discount 05, comp 02/05, table handover 02, zone-stock transfer 01a/02, Ready to serve 03a/03b, slip warning 03a): each module registers its own kind and handler. 01d ships `test_alert`, `request_result` and `no_approver` only (§3.10).
- Personal-phone alert app (G1-19), general "no route" warning, everything in §12.4.

---

## §2. Existing architecture that must not change

- **Foundation §4.1:** every state change is an event; events are append-only; `stream_type` enum stays `order, table, station, stock, shift, audit, hub, staff` (no new value).
- **Foundation §6.3:** commands travel over HTTP only (`POST /commands/<name>`), one command = one transaction; queries never write. Alert frames over WS are pushes, not commands; the only device → hub WS data frame added (`receipt`) records a delivery fact, not a staff action (§6, batch 3).
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
| A8 | **Steps are sent by a 500 ms tick from persisted state; when several steps are due at once, only the latest is sent and the earlier ones are recorded skipped.** | A burst of stale steps after a restart or a slow tick. | G1-16 |
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
4. **PIN check** reuses 00 §3.5 (device and staff lockout, argon2 semaphore, counted failures) for the answerer: `401 PIN_INVALID`, `429 PIN_LOCKED_OUT`, `429 DEVICE_LOCKED_OUT` (§4.5 C-00, `pinCheck` hook).
5. **Not self, for everyone** (Q3; developer answer, owner to confirm): the answerer is not the requester → else `403 PERMISSION_DENIED { reason: 'self' }`. The requester is also left out of every answerer set (§3.4): if the requester is the only in-range approver signed in, step 0 goes to the other branch-scope approvers (§3.5); if there are none, `no_approver` shows (§3.9) and the request stays pending.
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

#### 3.4.1 Presence filter (G1-20, *Proposed — owner may skip*)

When a "Present today" list exists for the open business day (§3.11), team and table-team resolution skip people marked absent. **Safety rule:** if no one has been ticked today, everyone counts as present; a person signed in anywhere counts as present. Person targets (`person`) are never filtered.

#### 3.4.2 Fallbacks (table's team, G1-11d)

Owner has no reports → owner only. Owner not signed in anywhere and has no route (§3.4.3) → the zone's assigned order taker (**stubbed until 01a zones + 01b zone assignment + 02 `zoneOf`**); none → `managers`.

#### 3.4.3 Routes of a person (G1-18)

For each person recipient the hub collects, at send time:

1. **Screen:** every staff-session WS socket of that person.
2. **Alert connection:** every device whose **binding** is that person (§3.7), connected in alert mode or not.
3. **Registered routes** (§3.8): e.g. 01e's pager route, if it reports a route for the person.

A person with **none** of these → the alert goes to their **lead's** routes, tagged `for_staff_id` ("for Ali"), grouped per person on the lead's screen (G1-18a). Lead has none → the table-team fallback (§3.4.2) or `managers`. A person bound to several devices gets the alert on all of them (G1-13d).

### 3.5 Kinds, steps and the tick

A **kind** (`defineAlertKind`, §4.2):

```typescript
defineAlertKind({
  kind: 'test_alert',                       // lower_snake, unique
  family: 'info',                           // 'urgent' | 'action' | 'info' (G0-2)
  subject: 'hub',                           // stream_type of the subject
  steps: [                                  // ordered; step 0 is sent at raise
    { at: { ms: 0 }, to: 'raised_target' },
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

**Step `at`:** `{ ms }` (fixed; pilot values come from `ALERT_CONSTANTS`, A14), or `{ value: 'window_ms', times: n }` (n × a raiser value, e.g. Ready to serve's walk-to window). **Step `to`:** `raised_target` (the target given at raise) or one of the request target kinds (`answerers`, `branch_scope`, `holders_informed`, `always_on`, `managers`). A step has `escalation: true` to be written as `EscalationStepped` instead of `AttemptSent` (one fact per event, §6.6).

**Approval tier (every money kind uses it, G1-9f):**

| Step | At | To | Sound |
|---|---|---|---|
| 0 | raise | `answerers` (in range, requester excluded); if none signed in anywhere → `branch_scope` (requester excluded) (G1-9d shortcut, Q3); if that is empty too → the step is written with no answerers and `no_approver` covers it (§3.9) | urgent |
| 1 | `approval_repeat_ms` (45 000) | `answerers` again + `always_on` | urgent (repeat continues on the client, §8.3) |
| 2 (escalation) | `approval_branch_ms` (120 000) | `branch_scope` as answerers; `holders_informed` read-only | urgent, volume step-up once (G1-14c); requester shows "Waiting 2 min — ask in person" |

**The tick (A8, G1-16).** Every 500 ms, on `branchNow` (foundation §4.7). 01d owns the hub tick loop; 03a's fire scheduler registers on it (`registerTick`, §4.2; "To 03a"):

```
tick(now):
  writer.run(tx ⇒                                               -- BEGIN IMMEDIATE first (race rule below)
    due     = SELECT … FROM alerts WHERE state = 'open' AND next_due_at <= ? ORDER BY next_due_at LIMIT 200   -- alerts_due
    flags   = SELECT name FROM alert_flags WHERE dirty = 1                                                     -- §3.9
    if due, flags and registered intents are all empty → return without writing (the transaction ends empty)
    reads   = batchReads(tx, due)                                -- fixed statement count, below
    for each alert in due:
      if alert.expire_due: append AlertClosed { reason: 'expired' }; continue        -- day close, below
      if closes_on after_ms reached: append AlertClosed { reason: 'expired' }; continue
      steps_due = kind.steps with at(alert) <= now and index > alert.step
      latest = last of steps_due
      for each earlier step in steps_due: append StepSkipped { alert_id, step, reason: 'superseded' }
      recipients = resolve(latest.to, alert, reads)              -- §3.4, in memory from reads + directory
      append AttemptSent | EscalationStepped { alert_id, step: latest.index, recipients, routes }
    if flags contains 'no_approver': evaluate §3.9 from reads; raise / close no_approver alerts; clear the flag
    + registered ticks' intents (03a)                           -- same transaction, D44
  )
  after commit: send alert frames (§6 batch 3) and registered route sends (§3.8) for each AttemptSent / EscalationStepped
```

- **Race rule (v0.2 #4):** the tick selects due alerts **inside** `writer.run`, after `BEGIN IMMEDIATE`, never before it. A command that answers, withdraws or closes an alert and the tick are serialised by the write lock, so the tick only ever sees committed state: once `RequestAnswered` (or any close) commits, no later tick writes a step for that alert. An empty tick still takes the write lock briefly; at 500 ms this is acceptable on the hub (00 §7.8), and it is the price of the rule.
- **Reads per tick (v0.2 #5):** `batchReads` runs a **fixed** set of statements, whatever the number of due alerts: (1) active staff sessions with their device ids (`staff_sessions WHERE ended_at IS NULL AND kind = 'staff'`), (2) `device_bindings` (whole table; one row per device), (3) `devices` not revoked (type; `point_id` once points land), (4) `presence_today` (proposed, §3.11), (5) one call per registered resolver kind that the due alerts use, with all their targets (e.g. one `tableOwner` statement for every table). Directory lookups (`resolve`, `teamOf`, `no_pin_staff`) are in memory. So a tick costs ≤ 2 + 4 + R statements (R = registered resolver kinds in use), plus its writes. `raise` uses the same `batchReads` for its one alert (≤ 4 + R).
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

- **Batching (A11):** `AlertDelivered` and `AlertSeen` go into an in-memory buffer; a flush runs every 1 000 ms or at 100 buffered receipts, whichever comes first, as **one** `writer.run` appending all of them. A hub crash may lose the last batch; **this is accepted for these two events only** (G1-8c).
- **Payload** carries `alert_id` and the subject (`subject_stream_type`, `subject_stream_id`) so the cloud and the owner view can join back (G1-8a).
- **Pager route:** sent only; no receipts (01e, G1-8d).
- **Why `RequestSeen` is on the subject stream (G1-21.1):** the urgent repeat stops once seen (§8.3, G1-14). 01d's open-alert state is a persisted projection (§5.2), so it survives a restart without replay; putting the first seen of a request on the subject stream also keeps a projection **reset** correct when 03a replays only the subject streams (G1-8e). Requests are few per day.

### 3.7 Alert connection and device binding (G1-13)

- **Alert mode:** a WS opened with `{ type: 'auth', device_token }` and **no** `session_token` (§4.5 C-00, M12). Device types `tablet`, `cashier_kiosk`, `kds`, `phone`. It receives only `alerts_open`, `alert` and `alert_closed` frames for that device; it sends only `receipt` frames; no commands, no events, no catch-up.
- **Binding** (projection `device_bindings`, §5.2), derived from session events, no new event:

| Device | Bound person |
|---|---|
| `phone` | its `owner_staff_id` (00 M38) |
| `tablet`, `cashier_kiosk` | the **last signed-in person**: set by `SessionStarted` (kind `staff`) on the device; **ends** on `SessionEnded` reason `logout`, `forced`, `staff_removed`, `credentials_changed`, `device_revoked`, `hub_restored`, and on `BusinessDayClosed`; **kept** on `idle_timeout` and `replaced`; `taken_over` → the new session's `SessionStarted` moves it |
| `kds` | none (device targets only) |

- The tablet header always shows **"Alerts: <name>"** (or "Alerts: none") (G1-13c).
- **Lock-screen and session-less text:** table, kind, point, requester only (`T12 · Void request · Hamza`, `T12 Ready — Pass`); never amounts, items or reasons (G1-13e). The `alert` frame sent to an alert-mode socket carries only the `lock` text fields (§6 batch 3); details need a sign-in.
- **Revoke / rotation:** `DeviceRevoked` closes alert-mode sockets `4403`, `DeviceTokenRotated` `4401`, as for session sockets (00 M39, M40, M60).
- **Reconnect:** on auth, an alert-mode socket gets `alerts_open` (open alerts whose last step's recipients include this device or its bound person), so a reconnect does not miss a step.

### 3.8 Route interface (for 01e)

```typescript
registerRoute({
  route: 'pager',                                        // unique
  format: 'short_code',                                  // 'text' | 'short_code'
  ack: false,                                            // can the device acknowledge? (pager: no)
  receipts: [],                                          // which receipts it reports: subset of ['delivered', 'seen']
  routesFor(staffId): Array<{ route_ref: string }>,      // e.g. [{ route_ref: 'pager:5' }]; [] = no such route today
  send(alert: AlertView, step, route_ref): void,         // after commit; must not throw; failures are the route's to log
});
```

- `routesFor` is read inside the step transaction (§3.5) so `AttemptSent.routes` lists `pager:5`; `send` runs after commit.
- A route with `receipts: ['delivered']` reports through `alerts.recordReceipt(…)` (same buffer, A11).
- A person whose only route is a registered one is **not** "no route" (§3.4.3).
- `short_code` text comes from the kind's optional `short` label (§3.12, Latin only); a kind without one is not sent on short-code routes.

### 3.9 "No one can approve" warning (pilot form of Q-N5, G1-9e)

For each permission that some role grants with `requires_approval` at this branch: while the business day is open and **no person who could answer it branch-wide** (holds an approver role and, for a permission with a registered `range_permission`, branch scope on it) is signed in anywhere, an alert kind `no_approver` is open (subject `hub` / branch_id, `dedupe_key = 'no_approver:' + permission`, family `info`, target `always_on` + `managers`; text "No one can approve voids right now"). Also open, per request, while an open request has **no eligible answerer signed in** (requester excluded, Q3). **Evaluated by the tick** (Q4): the projections of `SessionStarted`, `SessionEnded`, `StaffDirectoryApplied`, `BusinessDayOpened`, `BusinessDayClosed`, `AlertRaised` (requests) and `RequestAnswered` / `RequestWithdrawn` / `AlertClosed` (requests) set the persisted flag `alert_flags('no_approver').dirty = 1`; the next tick evaluates from its batched reads, raises or closes `no_approver` alerts, and clears the flag in the same transaction (≤ 500 ms after the cause; survives a restart because the flag is persisted). Closed `done` when an eligible approver signs in; `expired` at day close.

### 3.10 Kinds 01d ships

| Kind | Family | Subject | Steps | Closes on | Use |
|---|---|---|---|---|---|
| `test_alert` | `info` | `hub` / branch_id | step 0 to the raised target | `after_ms` 600 000 | A manager (`manage-devices`) sends a test to a person, a team, a device or a point (point stubbed) and watches receipts. Installation tool for tablets now and watches / bridge in 01e (G1-21.7). |
| `request_result` | `info` | the request's subject | step 0 to the requester | `seen` | Decision and answerer (or closer and reason) to the requester, raised in the answer / close transaction (G1-21.2). |
| `no_approver` | `info` | `hub` / branch_id | step 0 to `always_on` + `managers` | owner (01d) | §3.9. |

### 3.11 "Present today" (G1-20) — *Proposed — owner may skip*

- Command `SetPresence { staff_ids: [...], present: boolean }` (permission `manage-staff`, Q2), event `PresenceSet { business_day_id, staff_ids, present, set_by }` on `staff` / branch_id. Projection `presence_today`, cleared on `BusinessDayClosed`.
- Used only by §3.4.1. The no-route hint and the shift-start screen that shows it are 01e's (pager assignment screen, G1-18b).
- **If the owner skips G1-20:** delete this section, §3.4.1, `SetPresence` and its test; nothing else depends on it.

### 3.12 Labels and i18n (G1-21.6)

Each kind registers label keys in the client string tables (`EN` and `UR`, 00 M83): `card` (full text, signed in), `lock` (session-less text, §3.7), optional `short` (Latin only, ≤ the route's length, 01e). `display` on the alert carries the parameters (`table_code`, `point_code`, `requester_name`, `kind_label`), never amounts or reasons in `lock`.

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 00 | `defineCommand`, `defineQuery`, `writer.run`, `registerProjection`, `registerEventAudience`, `registerCatchUp`, `StaffDirectory`, `clock.branchNow`, `ids.next`, PIN check (§3.5 steps 2–9, through the new `pinCheck` hook, §4.5 C-00), WS server (alert mode, new frames, §4.5 C-00), sessions table, devices table |
| 01b | `resolve` (grant, `approver_role_ids`, scope), `leadOf`, `teamOf`; v1.4: `no_pin_staff`, `teamOf` including no-PIN people (§4.5 C-01b) |
| 01a | `BusinessDayOpened`, `BusinessDayClosed` |
| Later modules | Registered kinds, target resolvers (`table_team`, `point`, `zoneOf`), routes (01e) — through §4.2 only |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src/alerts/`):**

| Export | Shape | Used by |
|---|---|---|
| `defineAlertKind(def)` | §3.5. Registered at startup; duplicate `kind` → startup error | 02, 03a, 03b, 04, 05, 01e |
| `alerts.raise(ctx, input)` | `input = { kind, subject: { stream_type, stream_id }, target, values?, display, dedupe_key, requester_staff_id?, request?: { approver_role_ids?, receiver_staff_id? } }` → `{ alert_id, events: EventDraft[], deduped: boolean }`. Pure on the transaction: the caller appends `events` with its own. A second raise with the same `dedupe_key` while one is open → `{ alert_id: <open one>, events: [], deduped: true }`. Step 0 is included. | owning modules' command handlers and ticks |
| `alerts.close(ctx, alert_id, reason, note?)` | `reason ∈ done, obsolete, overridden, undone` → `EventDraft[]` (`AlertClosed`, plus `request_result` for a request closed `obsolete` / `overridden`). Closed already → `[]` | owning modules |
| `alerts.byDedupeKey(db, key)` | open alert id or null | owning modules (e.g. 03b undo) |
| `registerTargetResolver(kind, fn)` | batch-shaped: `fn(tx, targets[]) → Map<target_key, { staff_ids, device_ids }>`, **one SQL statement per call** (§3.5 reads per tick); kinds `table_team` (02), `point` (01a/00 with points), `zone_order_taker` (02 + 01a zones) | 02, 01a |
| `registerRoute(def)` | §3.8 | 01e |
| `alerts.recordReceipt({ alert_id, staff_id, device_id, kind })` | into the receipt buffer (A11) | 01e routes that report receipts |
| `registerTick({ name, intents(tx, state, now) → EventDraft[] })` | intents are appended in the same tick transaction (D44) | 03a fire scheduler |

**Events introduced (all `schema_version: 1`, `@pos/events/src/events/<stream>/…`; files under `events/alert/` re-exported for every subject stream):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to |
|---|---|---|---|
| `AlertRaised` | subject | `{ alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id \| null, target, values, display, request: { answers, right_mode, base_permission \| null, range_permission \| null, approver_role_ids, receiver_staff_id \| null, needs_pin } \| null }` | — (frames, §6.3) |
| `AttemptSent` | subject | `{ alert_id, step, recipients: Array<{ staff_id \| null, device_id \| null, for_staff_id \| null, set: 'answerer' \| 'informed' \| 'recipient' }>, routes: Array<{ staff_id \| null, route: 'screen' \| 'alert_connection' \| string, ref: string }> }` | — |
| `EscalationStepped` | subject | as `AttemptSent` | — |
| `StepSkipped` | subject | `{ alert_id, step, reason: 'superseded' }` | — |
| `RequestAnswered` | subject | `{ alert_id, decision: 'approve' \| 'reject' \| 'accept' \| 'decline', answerer_staff_id, method: 'pin' \| 'session' \| 'in_person', device_id }` | requester's and recipients' sockets (event frame) |
| `RequestWithdrawn` | subject | `{ alert_id, by_staff_id }` | as above |
| `RequestSeen` | subject | `{ alert_id, staff_id, device_id }` | — |
| `AlertClosed` | subject | `{ alert_id, reason: 'done' \| 'obsolete' \| 'overridden' \| 'undone' \| 'expired', by_staff_id \| null, note \| null }` | — (frames) |
| `AlertDelivered` | `audit` / alert_id | `{ alert_id, subject_stream_type, subject_stream_id, staff_id \| null, device_id, route }` | — |
| `AlertSeen` | `audit` / alert_id | as `AlertDelivered` | — |
| `PresenceSet` (§3.11, proposed) | `staff` / branch_id | `{ business_day_id, staff_ids, present, set_by }` | — |

Actor: commands set `actor_id` = session staff (00 §3.7); tick-written events have `actor_id = null`, `device_id = 'hub'`.

**Client (`packages/events/src/ws.ts`, `packages/domain`):** frame shapes (§6 batch 3), `ALERT_FAMILIES`, close reasons, request decisions, label key convention.

### 4.3 Requirements carried to other modules

**To 01e Device gateway (pilot, mandatory)** — G0 D3, D4, D5, G1–G7, G0-10; the pager route through §3.8; pager assignment by shift with the `pager_ids` default (G1-17a, b, c), on the `staff` stream; watch kinds and patterns (N8, G0-2); device-offline alerts (G0 G7, G1-12d); the no-route hint on the shift-start screen (G1-18b); `test_alert` to a watch as the installation check.

**To 03a** — size snapshots and replay against ≈ 75k events/day (≈ 45k on replayed streams, ≈ 30k `audit`) instead of R6's 40k; replay reads only the stream types its reducers use, with an index serving `(branch_id, stream_type, seq)`; foundation §5.8 step 3 text through the v1.8 bump (R34) (G1-8e). **One tick:** register the fire scheduler with `registerTick` instead of starting a timer (G1-16a). Register the Ready-to-serve kind (`action`, attempts by `window_ms`, last-attempt escalation to the point and `managers`, G0-1) and the slip-warning kind (to the table's order taker, N9).

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
| R-6 | Carried rows: To 01e, To 03a, To 02, To 04, To 05 (§4.3); the "To 01d" rows marked closed by 01d v1.0, except cross-team task requests and the general no-route warning (deferred, §12.4). |
| R-7 | R14 narrowed (G0 D6, G1-19). |

**C-CLAUDE.md** (same change as R-5) — "The foundation is frozen (D64): later issues go into module specs or unit tests, not foundation edits. The one allowed foundation edit is appending a new error code that a module spec defines (§6.2)." → "The foundation changes only through a version bump approved by the owner, with a changelog and 'Changed by' markers (README R34). Appending an error code that a module spec defines (§6.2) needs no bump."

**C-F Foundation v1.7 → v1.8** (needs R-5 and C-CLAUDE.md first)

| # | Section | Change |
|---|---|---|
| F-1 | §4.5 | Void states mapped to 01d requests (§3.3 table); "sends urgent push to all `approve-void` holders" → "raises a void approval request (01d): in-range approvers first, then escalation (01d §3.5)"; REJECTED "waiter notified" → "the table's order taker is notified". OVERRIDDEN closes the request (04). |
| F-2 | D3 / §4.7 | Slip warning goes to the table's order taker (G0 N9). |
| F-3 | §1 Stack | Android row: "React + Capacitor (bundled assets + local SQLite command queue); restaurant tablets in lock-task mode as device owner, updated from the hub (README R33)". |
| F-4 | §6.2 | Append codes `ALERT_NOT_FOUND` (404), `REQUEST_NOT_PENDING` (409), `REQUEST_PIN_REQUIRED` (422) (§9). *This row needs no bump (§6.2 rule) and lands with the 01d build if R-5 is not yet approved.* |

**C-00 Hub Platform & Access v1.5 → v1.6**

| # | Section | Change |
|---|---|---|
| H-1 | M12, §6.21 | `auth` frame: `session_token` optional. Without it → **alert mode** (device types `tablet`, `cashier_kiosk`, `kds`, `phone`; device valid, not revoked): sends `alerts_open`, then only `alert` / `alert_closed` frames; accepts only `receipt` frames (any other frame → close `4401`); no catch-up, no event frames; closed `4403` / `4401` on `DeviceRevoked` / `DeviceTokenRotated`. Keepalive as today. |
| H-2 | §6.5 (`@pos/events/src/ws.ts`) | `WsServerMessage` adds `alerts_open`, `alert`, `alert_closed`; `WsClientMessage` adds `receipt` (§6 batch 3). Staff-session sockets also get `alert` / `alert_closed` (G1-21.5). |
| H-3 | §4.2 `defineCommand`, §3.7 | **No `permission: null`.** A command whose right depends on the payload declares `permission: 'checked-in-handler'`. The registry accepts that marker **only** for the commands in a fixed list in 00 (`HANDLER_CHECKED_COMMANDS = ['AnswerRequest', 'WithdrawRequest', 'MarkAlertsSeen']`); any other command declaring it → startup error. Such a command still needs a staff session (station sessions → `403`). Each listed handler must call its right check before writing; a test per listed command proves an unauthorised call is refused (01d test 33), so a silent bypass is impossible. New optional **`pinCheck(payload, ctx) → { staff_id, pin } \| null`**: when it returns a value, the pipeline runs §3.5 steps 2–6 for that staff member on this device before `writer.run`, and steps 7–9 inside the transaction before `handle` (same counters, events and errors). |
| H-4 | §4.2 | New export `ws.sendToDevices(device_ids, frame)` and `ws.sendToStaff(staff_ids, frame)` (after commit only), used by 01d. |
| H-5 | §8.1 | Tablet app: background service holding the alert connection; hub-hosted APK and update endpoints (§8.4) (00, Q5). |
| H-6 | M38 / R14 | Personal phones browser-only for alerts in the pilot (text only; no code change). |

Not in this bump: `point_id` on devices (with 01a points), `pager_bridge`, compact protocol, headless pairing (01e → 00 v1.7).

**C-01b Staff and Roles v1.3 → v1.4**

| # | Change |
|---|---|
| B-1 | Directory v2 gains additive **`no_pin_staff: [{ staff_id, display_name, lead_staff_id }]`**: every active staff member at the branch without a PIN; no roles, no permissions; never on rosters (G1-17, G1-17d). A `staff_id` is in exactly one of `staff` / `no_pin_staff`; setting a PIN moves the person in the same directory version. Older hubs ignore it (B18 a). Hub cache table `no_pin_staff` (§5.1), replaced whole by `applyStaffDirectory`. |
| B-2 | Directory gains additive **`pager_ids: { [staff_id]: pager_id }`** (default watch per person, PIN holders included); cloud column on `staff_branches` and the staff form field; `pager_id` is **text** (1–16 characters) until the spike fixes the format (Q7, G0-10). Hub cache table `pager_defaults`. |
| B-3 | `StaffDirectory.teamOf(staffId, { includeNoPin: true })` and `noPinStaff()`. |
| B-4 | §3.3 note: the answer right for `requires_approval` kinds is 01d §3.3 rule 6 (G1-23). |

Not in this bump: `tap-for-station`, `mark-served`, zone assignment, `manage-zone-stock` (carried to 01b by 02 / 03a / 03b).

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
  alert_id      TEXT NOT NULL REFERENCES alerts(alert_id),
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
  alert_id   TEXT    NOT NULL REFERENCES alerts(alert_id),
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
  device_id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, since INTEGER NOT NULL
);
CREATE INDEX device_bindings_staff ON device_bindings (staff_id);

CREATE TABLE alert_flags (                  -- persisted dirty flags read by the tick (§3.9)
  name TEXT PRIMARY KEY CHECK (name IN ('no_approver')), dirty INTEGER NOT NULL CHECK (dirty IN (0,1))
);
INSERT INTO alert_flags (name, dirty) VALUES ('no_approver', 1);

-- C-01b caches, replaced whole by applyStaffDirectory
CREATE TABLE no_pin_staff (
  staff_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, lead_staff_id TEXT
);
CREATE INDEX no_pin_staff_lead ON no_pin_staff (lead_staff_id);
CREATE TABLE pager_defaults (
  staff_id TEXT PRIMARY KEY, pager_id TEXT NOT NULL UNIQUE
);

-- §3.11 (proposed; drop if G1-20 is skipped)
CREATE TABLE presence_today (
  staff_id TEXT PRIMARY KEY, present INTEGER NOT NULL CHECK (present IN (0,1)), set_by TEXT NOT NULL, at INTEGER NOT NULL
);
```

Retention: `alert_inbox`, `alert_receipts`, `request_seen` rows of alerts closed before the previous business day are deleted in the 00 M66 maintenance hour in batches of 500 (events stay). Closed `alerts` rows older than 7 days likewise (Q6).

### 5.2 Projections (`registerProjection`, with `reset`)

| Projection | Events | Writes |
|---|---|---|
| `alerts` | `AlertRaised`, `AttemptSent`, `EscalationStepped`, `StepSkipped`, `RequestAnswered`, `RequestWithdrawn`, `AlertClosed`, `RequestSeen`, `BusinessDayClosed` | `alerts`, `alert_recipients`, `alert_inbox`, `request_seen`; `next_due_at` = time of the next undue step (§3.5); on `BusinessDayClosed`: `expire_due` (§3.5) |
| `alert_flags` | `SessionStarted`, `SessionEnded`, `StaffDirectoryApplied`, `BusinessDayOpened`, `BusinessDayClosed`, request `AlertRaised` / `RequestAnswered` / `RequestWithdrawn` / `AlertClosed` | `no_approver` dirty = 1 (§3.9) |
| `alert_receipts` | `AlertDelivered`, `AlertSeen` | `alert_receipts` (INSERT OR IGNORE) |
| `device_bindings` | `SessionStarted`, `SessionEnded`, `DeviceRevoked`, `BusinessDayClosed`, `DevicePaired` (phones) | `device_bindings` (§3.7 rules) |
| `presence_today` (proposed) | `PresenceSet`, `BusinessDayClosed` | `presence_today` |

**No hook writes events outside its cause's transaction.** `raise`, `close` and `request_result` commit with their cause inside the owning command; everything else that writes 01d events from another module's event (day-close expiry, `no_approver`) is written by the tick from a persisted projection flag (§3.5, §3.9). 00 gains no writer hook (H-7 dropped, v0.2 #2).

### 5.3 Cloud

No 01d table. Cloud receives 01d events through sync (D52) like every other event; the owner remote view reads them (G0-8, later). C-01b B-2 is the only cloud schema change, in 01b's migration.

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
| Processing (`raise`) | (1) kind registered, else startup-time `Error`. (2) `dedupe_key` open? (`alerts_open_dedupe`) → return `{ deduped: true, events: [] }`. (3) `alert_id = ids.next()`. (4) Request part: `approval` → copy `ctx.permission.approver_role_ids` (00 M10, the approvable command's grant) into the payload for the record; `named` → `receiver_staff_id` required. (5) Resolve step 0 (§3.4; for approvals, apply the G1-9d shortcut). (6) Return `[AlertRaised, AttemptSent(step 0)]` drafts. Post-commit sends happen through 01d's after-commit hook on `AttemptSent`. |
| Processing (`close`) | read the alert; closed → `[]`; else `[AlertClosed]` (+ `request_result` raise for a request closed `obsolete` / `overridden`) |
| Queries | raise: 1 dedupe read + fixed resolver reads (directory in memory; sessions, bindings, presence: 1 statement each) |
| Errors | `VALIDATION_FAILED { issue: 'target_unavailable' }` (unregistered resolver) |

### Batch 2 — commands and queries

#### 6.2 `POST /commands/answer-request` — `AnswerRequest`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); staff session required; right check = §3.3 rules 5–6 |
| Payload | `{ alert_id: ulid, decision: 'approve' \| 'reject' \| 'accept' \| 'decline', method: 'session' \| 'pin' \| 'in_person', answerer_staff_id?: ulid (required iff in_person), pin?: string(4–8 digits) (required iff pin / in_person) }` |
| `pinCheck` | `method ∈ pin, in_person` → `{ staff_id: in_person ? answerer_staff_id : session staff, pin }` (00 §3.5 via H-3) |
| Processing | inside `writer.run`: (1) alert row → `404 ALERT_NOT_FOUND`; no request part → `404 ALERT_NOT_FOUND`. (2) state open → else `409 REQUEST_NOT_PENDING`. (3) decision ∈ the kind's `answers` → else `400 VALIDATION_FAILED`. (4) PIN rule (§3.3 rule 3) → `422 REQUEST_PIN_REQUIRED`. (5) Self, right, range (§3.3 rules 5–6) → `403 PERMISSION_DENIED { reason }`. (6) Append `RequestAnswered`. (7) `kind.apply(ctx, answer)` → its events (DomainError → rollback, error to the answerer, A4). (8) `request_result` alert to the requester (`raise`). (9) Commit; post-commit `alert_closed` to every recipient and the requester's sockets. |
| Result | `{ alert_id, decision, answered_at }` |
| Idempotency | `command_id` (00 M19); a retry after success replays the stored 200 |
| Race | two answers: both commands serialise in `BEGIN IMMEDIATE`; the second sees state closed → `409 REQUEST_NOT_PENDING { answered_by_name }` (test 6). Answer vs. `alerts.close`: same. |
| Errors | `400`, `401 PIN_INVALID`, `403 PERMISSION_DENIED`, `404 ALERT_NOT_FOUND`, `409 REQUEST_NOT_PENDING`, `422 REQUEST_PIN_REQUIRED`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, plus the kind's `apply` errors |
| Queries | 1 alert read, 1 `resolve` (memory), team walk in memory, writes |

#### 6.3 `POST /commands/withdraw-request` — `WithdrawRequest`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); right check = requester only |
| Payload | `{ alert_id }` |
| Processing | alert → 404; open → else 409; session staff = requester → else `403 { reason: 'not_requester' }`; append `RequestWithdrawn` + `kind.onWithdraw` events; post-commit `alert_closed` |
| Result | `{ alert_id }` |

#### 6.4 `POST /commands/mark-alerts-seen` — `MarkAlertsSeen`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); right check = only ids in the person's own inbox are acted on |
| Payload | `{ alert_ids: ulid[1..50] }` |
| Processing | one statement reading `alert_inbox` for (session staff, ids); ids not in the person's inbox are ignored (no error, no leak). For each request alert not yet in `request_seen` for this person → append `RequestSeen` (same transaction). For each `closes_on: 'seen'` alert → `AlertClosed 'done'`. Queue `AlertSeen` for every id (buffer, A11). |
| Result | `{ seen: ulid[] }` |
| Note | Counts as session activity (00 M59). |

#### 6.5 `POST /commands/send-test-alert` — `SendTestAlert`

| | |
|---|---|
| Permission | `manage-devices` |
| Payload | `{ target: { kind: 'person', staff_id } \| { kind: 'team', lead_staff_id } \| { kind: 'device', device_id } \| { kind: 'point', point_id } }` |
| Processing | point without a registered resolver → `422 CONFIG_REFERENCE_INVALID { field: 'target.point_id', reason: 'points_not_available' }`; unknown staff / device → `404 STAFF_NOT_FOUND` / `DEVICE_NOT_FOUND`; `raise('test_alert', subject hub / branch_id, dedupe_key = 'test:' + alert_id)` |
| Result | `{ alert_id }` |

#### 6.6 `POST /commands/set-presence` — `SetPresence` (*proposed, §3.11*)

| | |
|---|---|
| Permission | `manage-staff` (§12.3 Q2) |
| Payload | `{ staff_ids: ulid[1..100], present: boolean }` |
| Processing | business day open → else `409 BUSINESS_DAY_NOT_OPEN`; unknown ids → `404 STAFF_NOT_FOUND`; append `PresenceSet` |

#### 6.7 `GET /queries/alerts-inbox`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Input | `?cursor&limit` (default 50, max 200) |
| Returns | today's alerts where the person is in `alert_inbox` (and those "for" their reports), **open action alerts first**, then by `raised_at` desc: `AlertViewSchema` + `seen_by_me`, `moved_to_name`, `for_staff_name`. |
| Queries | 2 (page of ids by index, then a join for views) |

#### 6.8 `GET /queries/my-requests`

Pending requests where `requester_staff_id` = me, plus today's answered / closed ones; each with decision, answerer name, waiting time and "ask in person" after `approval_branch_ms`. 1 query (`alerts_requester`).

#### 6.9 `GET /queries/requests-to-answer`

Open requests where I am in the **latest** step's recipients as `answerer` or `informed`; `can_answer` recomputed now with §3.3 rules 5–6 (so a right removed after the step shows read-only). 2 queries + memory.

#### 6.10 `GET /queries/alert-receipts?alert_id=`

| | |
|---|---|
| Session | staff; the handler requires `manage-devices` (`403 PERMISSION_DENIED`) |
| Returns | per recipient: sent step(s) and routes (from `alert_recipients` and the step events' projection), delivered / seen times per device. For `test_alert` and support. |
| Queries | 2 |

### Batch 3 — WS frames (H-1, H-2)

Server → device:

```json
{ "type": "alerts_open", "alerts": [ { "alert_id": "01JD…", "kind": "test_alert", "family": "info", "step": 0, "lock": { "kind_label_key": "alert.test_alert.lock", "table_code": null, "point_code": null, "requester_name": "Imran" }, "raised_at": 1761900000000 } ] }
{ "type": "alert", "alert": { "alert_id": "01JD…", "kind": "void_approval", "family": "urgent", "step": 1, "escalation": false, "set": "answerer", "for_staff_id": null, "lock": { "kind_label_key": "alert.void_approval.lock", "table_code": "12", "point_code": null, "requester_name": "Hamza" }, "card": { … } , "raised_at": 1761900000000 } }
{ "type": "alert_closed", "alert_id": "01JD…", "reason": "answered", "decision": "approve", "by_name": "Imran" }
```

- `card` (full display, label params for the signed-in text) is included **only** on staff-session sockets of the recipient person; alert-mode sockets get `lock` only (G1-13e).
- Sent after commit, once per step per socket; not part of the `seq` stream (no gap logic). A missed frame is covered by `alerts_open` on reconnect (alert mode) or the `alerts` catch-up part (staff sessions, `registerCatchUp` part `alerts`: open alerts for this person and device, 1 query).

Device → server:

```json
{ "type": "receipt", "alert_id": "01JD…", "kind": "delivered" }
```

- Accepted on both socket kinds; only `delivered` (seen needs `MarkAlertsSeen`, §6.4). The hub records `staff_id` = the session staff, or the device's binding in alert mode, or `''` for a device-target alert. Unknown alert, or an alert this device was not sent → ignored. More than 20 receipts per second per socket → ignored for the rest of that second (abuse bound).

### 6.11 Endpoint count

4 commands (+1 proposed), 4 queries, 4 frame types, 1 catch-up part, 7 hub exports.

---

## §7. Cross-cutting (this module only)

| Item | Rule | Prevents |
|---|---|---|
| Tick | 500 ms; skip the transaction when nothing is due; `LIMIT 200` per tick, the rest next tick | A write transaction every 500 ms with nothing to do; one rush tick blocking commands |
| Receipt buffer | 1 000 ms or 100 receipts; one `writer.run`; dropped on crash (A11) | fsync per receipt |
| Receipt rate bound | 20 / s / socket (§6, batch 3) | A buggy client flooding `audit` |
| Logging | alert ids, kinds, step numbers; never PINs, never `card` text (amounts and reasons) | Leaking money and reasons into logs |
| Performance | raise ≤ 5 ms in-transaction at 10 sockets; tick with 200 due ≤ 50 ms | A rush of Ready-to-serve alerts slowing commands |
| Folder | `apps/hub/src/alerts/` (`kinds.ts`, `raise.ts`, `targets.ts`, `routes.ts`, `tick.ts`, `receipts.ts`, `bindings.ts`, `commands/*.ts`, `queries/*.ts`, `ws-frames.ts`); `packages/events/src/alerts.ts`, `events/alert/*.v1.ts`; `packages/domain/src/alert-constants.ts`; client `apps/client/src/alerts/` | — |

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
| urgent | two-tone rising, vibration long-long | every 10 s on the person's devices **until seen** by that person (any device; known from `request_seen` via the `alerts` catch-up / `alert` frames' `seen_by_me`); after seen, one reminder every 2 min until closed. Not seen by the escalation step → drops to the 2-min reminder with one volume step-up (G1-14c). |
| action | bright double ding, once | none (re-sent only by the next step) |
| info | single soft chime, once | none |

Always-on screens (kiosk, KDS, point tablets): one sound per step, then a badge only (G1-14d). No snooze (G1-14e). At most five sounds in total.

### 8.4 App update (G1-15)

- The hub serves the current and previous APKs (`GET /app/android/latest` → `{ version_code, version_name, sha256, url }`, `GET /app/android/<version_code>.apk`) — H-5 (00, or 01e).
- The app installs silently (device owner, `PackageInstaller`) only when no session is signed in on it, or the business day is closed, or in the M66 maintenance hour; bound alert devices prefer the last two windows (the install drops the alert connection, G1-15b note). `426 CLIENT_UPGRADE_REQUIRED` stays the hard trigger.
- Staged: one chosen tablet first; the rest after the owner / developer marks the version good (hub CLI `app-release promote <version_code>`).
- Rollback = rebuild with a higher `versionCode` (Android forbids downgrades; an uninstall would wipe the command queue). The hub keeps ≥ 2 versions.
- One release key, backed up in two places (installation runbook).

---

## §9. Error catalogue additions

| Code | Status | `details` | Returned when |
|---|---|---|---|
| `ALERT_NOT_FOUND` | 404 | `{ alert_id }` | `AnswerRequest`, `WithdrawRequest` on an unknown alert, or an alert with no request part |
| `REQUEST_NOT_PENDING` | 409 | `{ alert_id, state: 'closed', close_reason, decision \| null, answered_by_staff_id \| null, answered_by_name \| null }` | answer or withdraw after the request was answered, withdrawn or closed |
| `REQUEST_PIN_REQUIRED` | 422 | `{ alert_id, kind }` | `method: 'session'` on a kind that needs a PIN |

Reused: `PERMISSION_DENIED` (`details.reason ∈ self, not_approver, out_of_range, not_receiver, not_requester`), `PIN_INVALID`, `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `CONFIG_REFERENCE_INVALID`, `STAFF_NOT_FOUND`, `DEVICE_NOT_FOUND`, `BUSINESS_DAY_NOT_OPEN`, `VALIDATION_FAILED`. Appended to foundation §6.2 and `@pos/domain/src/errors.ts` (C-F F-4).

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
10. Self answer → `403 self`; requester who is the only in-range approver signed in → step 0 goes to other branch-scope approvers; none → `no_approver` open, request pending.
11. Money kind with `method: 'session'` → `422 REQUEST_PIN_REQUIRED`; accept kind with `method: 'session'` → 200 without PIN.
12. In person: wrong PIN → `401 PIN_INVALID` counted on the answerer and this device; lockout → 429; right PIN → `RequestAnswered { method: 'in_person', device_id }`.
13. Withdraw by requester → closed `withdrawn`, `onWithdraw` events; by someone else → 403; after answer → 409.
14. `alerts.close(…, 'obsolete')` on a request → `AlertClosed` + `request_result` to the requester; close after answer → no events.
15. `raise` twice with one `dedupe_key` → second `deduped: true`, no events; after close, raise again → new alert.
16. `MarkAlertsSeen`: first seen of a request → `RequestSeen` once; second call → none; ids not in my inbox ignored; `request_result` closes `done`.
17. `SendTestAlert` to person / team / device; point → 422 `points_not_available`; without `manage-devices` → 403.
18. Answer idempotency: same `command_id` replays 200.

### 10.3 Tick, restart, receipts

19. Approval tier timing: step 0 at raise, step 1 at 45 s (+ always-on), escalation at 120 s with branch-scope answerers and informed holders.
20. G1-9d shortcut: no in-range answerer signed in → step 0 goes to branch scope.
21. Restart with the hub down 4 min after a raise → one `EscalationStepped`, `StepSkipped` for step 1, no step 0 resend.
22. Tick with nothing due writes nothing (no transaction).
23. Receipts: 150 `receipt` frames → 2 flushes; duplicates dropped; crash before flush loses only that batch (simulated); `AlertDelivered` on `audit` with subject fields.
24. Day close: open info alerts `expired`; requests stay open; bindings cleared.
25. Table's team target via a registered fake `tableOwner`; owner changes between steps → step 2 goes to the new team; old team's inbox shows `moved_to`.

### 10.4 WS and bindings

26. Alert-mode auth with device token only → `alerts_open`, then `alert` frames with `lock` only; any non-`receipt` frame → close 4401; revoke → 4403; rotation → 4401.
27. Binding: sign-in sets it; idle timeout keeps it; logout ends it; takeover moves it; phone → owner.
28. A session-less tablet bound to Ali receives Ali's alert; signed-in Bilal on another tablet does not.
29. Staff-session socket gets `card`; alert-mode socket never gets `card` (no amounts or reasons in frames).
30. Receipt rate bound: 25 frames in one second → 20 recorded.

### 10.5 Directory and warning

31. `no_pin_staff` applied: in `teamOf({ includeNoPin })`, not in the roster; PIN set → moves lists in one version; older hub (no field) applies.
32. `no_approver`: day open, last branch-scope approver logs out → alert open on kiosk + managers within one tick; approver signs in → closed `done`; flag survives a restart.

### 10.7 Added in v0.2

33. **Handler-checked commands:** the registry rejects `permission: 'checked-in-handler'` on a command not in `HANDLER_CHECKED_COMMANDS` (startup error); for each listed command, a call by a person without the right (answer: not an approver; withdraw: not the requester; seen: ids not in the inbox) writes nothing and returns `403` (or, for seen, acts on no id); a station session → `403`.
34. **Answer vs. tick race:** an alert with step 1 due; `AnswerRequest` and a tick start together (two connections, the tick's `writer.run` entered while the answer holds the lock, and the reverse) → in both orders no `AttemptSent` / `EscalationStepped` for the alert has a `seq` after its `RequestAnswered`.
35. **Fixed reads per tick:** with 1 and with 150 due alerts (mixed person, team, table-team targets via a fake batched resolver), the tick runs the same number of SELECT statements (counted with a statement spy on the connection); `raise` likewise is independent of team size.
36. Day close → open info alerts closed `expired` by the next tick, not in the day-close transaction.

### 10.6 Acceptance table

| Story AC | Covered by | Tests |
|---|---|---|
| E-NOTIF AC1 targets | §3.4 | 1, 2, 25 |
| E-NOTIF AC2 R1 / R2 (tablets) / R3 | §3.4.3, §3.7, §3.5 | 3, 19, 26, 28 |
| E-NOTIF AC3 no internet | LAN only (§2) | 26 |
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
3. 00 hooks (H-1, H-3, H-4): `pinCheck`, `'checked-in-handler'` with `HANDLER_CHECKED_COMMANDS`, alert-mode WS, `sendToDevices` / `sendToStaff`. 00 tests updated; test 33.
4. Migration `0006_alerts.sql` (§5.1); projections (§5.2).
5. `alerts/kinds.ts`, `targets.ts` (§3.4), `routes.ts` (§3.4.3, §3.8) — tests 1–5.
6. `alerts/raise.ts`, `close` (§6.1) — tests 14, 15.
7. Commands `AnswerRequest`, `WithdrawRequest`, `MarkAlertsSeen` with test kinds (§6.2–6.4) — tests 6–13, 16, 18.
8. `alerts/tick.ts` (§3.5: selection inside `writer.run`, `batchReads`) and `registerTick` — tests 19–22, 24, 25, 34–36.
9. `alerts/receipts.ts` buffer and WS `receipt` (§3.6) — tests 23, 30.
10. `alerts/bindings.ts` and alert-mode delivery (§3.7) — tests 26–29.
11. Kinds `test_alert`, `request_result`, `no_approver` (§3.10, §3.9); `SendTestAlert` — tests 17, 32.
12. 01b v1.4 directory fields (C-01b) — test 31.
13. Queries (§6.7–6.10), `alerts` catch-up part.
14. Client: banner, inbox, request detail, in-person flow, sounds (§8.1, §8.3); tablet background service and lock text (§8.2); app update (§8.4).
15. (Proposed) `SetPresence` and the presence filter (§3.11) — test 5 part.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

- Every test in §10 passes; `pnpm -w typecheck` (incl. tests, R31) and lint pass.
- A `test_alert` sent from a manager's tablet reaches a session-less, screen-off pilot tablet as an Android notification, and the receipt view shows delivered and seen.
- The §4.5 bumps are approved and applied (README, CLAUDE.md + R34, foundation v1.8, 00 v1.6, 01b v1.4) before the build merges.
- No 01d code reads a role name (R5); every pilot value is in `ALERT_CONSTANTS` (A14), none inline.

### 12.2 Checklist

| # | Item | Kind | Section | Tests |
|---|---|---|---|---|
| 1 | `alerts.raise` / `close` | internal | 6.1 | 14, 15 |
| 2 | `AnswerRequest` | command | 6.2 | 6–12, 18, 33 |
| 3 | `WithdrawRequest` | command | 6.3 | 13 |
| 4 | `MarkAlertsSeen` | command | 6.4 | 16 |
| 5 | `SendTestAlert` | command | 6.5 | 17 |
| 6 | `SetPresence` (proposed) | command | 6.6 | 5 |
| 7 | `alerts-inbox` | query | 6.7 | 25 |
| 8 | `my-requests` | query | 6.8 | — (G2: add) |
| 9 | `requests-to-answer` | query | 6.9 | 8 |
| 10 | `alert-receipts` | query | 6.10 | 17 |
| 11 | WS alert mode + frames | ws | 6 batch 3 | 26–30 |
| 12 | Tick | job | 3.5 | 19–22, 24, 34–36 |
| 13 | Receipt buffer | job | 3.6 | 23 |

### 12.3 Open questions — answered (developer, 2026-11-01)

| # | Question | Answer |
|---|---|---|
| Q1 | "Manager" for non-approval fallbacks (G1-11d) | Branch-scope holder of `force-release-table-lock` (§3.4). |
| Q2 | Who sets "Present today" | `manage-staff`; G1-20 stays proposed (§3.11). |
| Q3 | Self-answer | Never, for everyone. Requester the only in-range approver signed in → step 0 to the other branch-scope approvers; none → `no_approver`, request stays pending (§3.3 rule 5, §3.5, §3.9). *Developer answer, owner to confirm.* |
| Q4 | Day-close expiry and `no_approver`: writer hook or tick | Tick; H-7 dropped (§3.5, §3.9, §5.2). |
| Q5 | APK hosting | 00 (H-5). |
| Q6 | Retention of projection rows | Receipts: previous business day; closed alerts: 7 days; events forever (§5.1). |
| Q7 | Pager id format | Text until the spike (C-01b B-2, G0-10). |
| Q8 | `approver_role_ids` empty at answer time | `403 not_approver`; owning modules close stale requests `obsolete` (§3.3 rule 6). |
| Q9 | 01a setting or constants | Constants (A14); settings post-pilot (§12.4). |

Open for the owner: Q3 confirmation; G1-20 (keep or skip presence).

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
- Snooze — decided **no** (G1-14e), listed so it is not re-asked.

### 12.5 G2 self-check (author, v0.2)

- **Races:** answer vs. answer, answer vs. close, raise vs. raise (dedupe index), tick vs. answer (rule in §3.5: selection inside `writer.run`; test 34).
- **Idempotency:** commands by `command_id`; raise by `dedupe_key`; receipts by PK; `RequestSeen` by `request_seen` PK.
- **N+1:** queries fixed (§6.7–6.10); tick and raise use `batchReads` with a fixed statement count (§3.5; test 35).
- **Contradictions found and handled:** foundation §4.5 "push to all holders" vs. G1-9 (F-1); 00 M12 session-only WS (H-1); 00 `defineCommand` requires a permission (H-3, explicit listed marker); `RequestSeen` placement vs. persisted projections (§3.6 note).
- **Over-engineering check:** route interface has one known user (01e, mandatory for the pilot); presence is marked proposed; no cloud tables; no settings pipeline (A14); no writer hook (v0.2 #2); no outbox (post-commit frames are best-effort by design, receipts show gaps).
