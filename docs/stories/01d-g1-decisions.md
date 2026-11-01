# 01d G1: brainstorming decisions (running record)

| | |
|---|---|
| Status | **Working record of the G1 session (2026-11-01).** Rows are developer answers unless marked. Rows marked *Proposed — needs approval* change README, CLAUDE.md or an approved spec and are approved at the gate. |
| Inputs | `01d-g0-decisions.md` (G0 register), `01d-notifications-teams-refined.md`, README, foundation v1.7, 00 v1.5, 01b v1.3 |

## 1. Scope, order and README rows

| ID | Decision |
|---|---|
| G1-1 | **README row numbers.** R28–R32 are taken. New rows: **R33** device policy (G0 D1–D7), **R34** foundation may change by version bump. G0 file fixed (commit 8aa6b2c). |
| G1-2 | **R34** *Proposed — needs approval* (developer approves at the gate). A decision of its own: README R34 and the CLAUDE.md line "The foundation is frozen (D64)…" are edited **in the same change**, before 01d's spec bumps the foundation. |
| G1-3 | **`no_pin_staff` (G0 P1) is tablet path**, not hardware path: the handover tile (K5) and per-person pickup metrics (K12) need waiter names on the hub, and 01b B3 keeps people without a PIN out of the directory. Stays in 01d's scope as a carried 01b bump (v1.3 → v1.4). |
| G1-4 | **The pilot branch runs with the hardware** (pager watches, pager bridge, ESP32 station button devices). H0 is a product rule for customers without hardware: the tablet path must work alone, but the pilot ships both. |
| G1-5 | **Spec split.** **01d (pilot):** notifications, requests, targets, attempts and escalation, receipts, tablet routes, and a **route interface** (text or short code; acknowledgeable or not; which receipts it can report: sent / delivered / seen) that hardware routes plug into without changing 01d. **01e Device gateway (pilot, mandatory):** compact device protocol, `pager_bridge` type, headless pairing, ESP32 station button devices, pager route, device health. 01e rests on the hardware spike (G0 §9), not on guesses. |
| G1-6 | **Order** *Proposed — needs approval* (README R21 / R27 build order and milestone A module list): hardware spike runs now, in parallel with 01d's spec → build 01d → spec 01e from the spike results → build 01e against test producers (send `12 P` to a watch, take button presses), firmware in parallel → 03a → 02 → 04 → 03b (Start / Done and Ready to serve connect the real flow to the devices) → 05. |

## 1a. Requests

| ID | Decision |
|---|---|
| G1-7 | **01d owns the request record and its answer rules; owning modules plug in a handler for the effect** (model A). One request record per kind (void, discount, comp, table handover, zone stock transfer); request events go on the **subject's stream** (order, table, stock), `stream_type` unchanged. On an accepted answer 01d calls the kind's handler **in the same SQLite transaction**; the handler writes the domain event. |
| G1-7a | **Handler failure:** the handler throws (e.g. the void is no longer possible) → the whole transaction rolls back, the request stays pending, the answerer gets the error. No partial answers. |
| G1-7b | **Obsolete:** the owning module closes a pending request as obsolete with a reason (bill closed, item already removed, table moved) through a 01d call; attempts stop; requester and targets are told. |
| G1-7c | **Right check in 01d:** each kind declares the permission it needs and a **range resolver** from the subject to its range (team, zone, branch). 01d checks the answerer's right and range when the answer arrives (G0 N6, G0-7), so range rules live in one place. The handler only applies the effect. |
| G1-7d | **In-person fallback is the same answer path**, sent from the requester's device with the answerer's PIN; no separate flow. The answer records the device it came from. |
| G1-7e | **Withdrawn** by the requester is allowed while pending. |
| G1-7f | **Foundation §4.5 mapping** (proposal, see below). |

**Request states (01d):** `pending` → `approved` \| `rejected` (answered) \| `withdrawn` (requester) \| `closed` (owning module; reason `obsolete` or `overridden`). Accept / Decline kinds use `approved` / `rejected` with the kind's labels.

| Foundation §4.5 void state | 01d request state | Owner |
|---|---|---|
| PENDING | `pending` | 01d (record, attempts, escalation); 04 (bill effect: excluded from total, blocks close) |
| APPROVED | `approved` | 01d accepts the answer; 04's handler removes the item from the bill |
| REJECTED | `rejected` | 01d accepts the answer; 04's handler reinstates the item; 01d tells the table's order taker (G0 N9) |
| OVERRIDDEN | `closed`, reason `overridden` | **04.** It is not an answer from an approver: 04 owns the rule (must be ON, default OFF), the manager's permission and the reason, writes its own override event, then closes the 01d request through the same call as G1-7b. 01d only stops attempts and tells the requester and targets. |
| — (not in §4.5) | `withdrawn` | 01d; **04 must define** what a withdrawn void means for the item (proposed: the void never happened, item stays at full price) |

G1-7f confirmed by the developer as written; 04 to confirm the withdrawn-void meaning.

| ID | Decision |
|---|---|
| G1-9 | **Escalation widens only who is told, never who may answer.** |
| G1-9a | The grant's scope (`my_team`, `my_zones`, `branch`) is a permission rule; no timer loosens it. |
| G1-9b | Out-of-range people who receive an escalation see the request **read-only** with "Find <approver> or a manager"; the requester's "ask in person" line stays. |
| G1-9c | Branch-scope holders (normally the manager) are in range for every request, so they are the real escalation target. |
| G1-9d | **Shortcut:** if no in-range approver is signed in anywhere when the request is raised, skip the waiting steps and go to branch-scope holders at once. |
| G1-9e | **No approver warning (pilot form of Q-N5, approvals only):** while the business day is open and no branch-scope approver for a permission is signed in anywhere, the always-on screens and the manager / owner views show "No one can approve voids right now". The general "no route reaches this person" warning stays deferred. |
| G1-9f | **G0-1 wording, approval requests, as amended:** t0 in-range approvers (G0-7); 45 s repeat sound on their tablets and show on the always-on screens (assembler, cashier); **2 min branch-scope approvers; other holders told read-only**; requester's screen says "Waiting 2 min — ask in person". |

| G1-10 | **Each request kind declares whether its answer needs a PIN.** |
| G1-10a | Money kinds (void, discount, comp): PIN on every answer, on any device. |
| G1-10b | Accept kinds (table handover, zone-stock transfer): one tap on the answerer's own signed-in session. |
| G1-10c | In-person fallback (answer from someone else's device): always PIN. |
| G1-10d | The answer event records the method `pin` \| `session` \| `in_person`, plus the device id. |
| G1-10e | These are defaults; the PIN requirement per kind is a branch setting (data, R18). A branch may **add** a PIN to accept kinds; it may **not** remove the PIN from money kinds (fixed in the spec). |
| G1-10f | No PIN-free window after a PIN answer; each money answer needs its own PIN. |

## 1c. Targets

| ID | Decision |
|---|---|
| G1-11 | **Alerts follow the table's current owner.** |
| G1-11a | Table's team = current owner (from 02, **read at send time**, i.e. per attempt) + direct reports (`teamOf` for PIN holders, `no_pin_staff` by `lead_staff_id` for the rest). |
| G1-11b | Zone assignment (Z2) only sets the default owner when a table opens (02's rule). |
| G1-11c | Pending pickups at handover: the next attempt goes to the new team; the item leaves the old team's inboxes and shows "Moved to Bilal" there. |
| G1-11d | Fallbacks: owner has no reports → owner only. Owner not signed in anywhere → the zone's assigned order taker; none signed in → branch-scope holders (manager). *Open for the spec: which permission defines "manager" for non-approval fallbacks (proposed: a branch-scope holder of `force-release-table-lock`).* |
| G1-11e | Zone stock stays with the zone, not the owner: a moved table still draws from the zone it sits in (Z4, Z6 unchanged). |

| G1-12 | **The point's assembler is a device target, not a person.** |
| G1-12a | A tablet can be bound to a point: nullable `point_id` on the device row (new forward migration, 00 bump; points from 01a). Several tablets may be bound to one point; all receive the point's alerts. |
| G1-12b | 01d delivers to the bound devices whoever is signed in. Alerts show even with no one signed in; Ready to serve, Handover and state taps need a signed-in staff session and record that person. *Note: G0 P3 `tap-for-station` covers Start / Done; the spec must name the permission for Ready to serve and Handover (proposed: the same `tap-for-station` on the point's stations, or a new one, 01b bump).* |
| G1-12c | The same device target covers escalation to always-on screens (cashier kiosk, KDS, point tablets). |
| G1-12d | A point with no bound device online → the manager is told (same rule as 01e device health, G0 G7). |
| G1-12e | G1-11d's open point stays for the spec; candidate: branch-scope holder of `force-release-table-lock`. |

## 1d. Alert connection

| ID | Decision |
|---|---|
| G1-13 | **Alerts go over a device-level connection that outlives the staff session.** Reason: 00 M12 opens `/ws` only with `{ device_token, session_token }`, tablet session tokens live in memory (00 §8.1), and Waiter / Order taker sessions idle out after 5 / 15 min, so without this a pocketed phone goes silent minutes after the last tap. |
| G1-13a | **Second WS auth mode, `device_token` only:** receives only 01d alert frames for that device (no events, no catch-up), sends only delivered / seen receipts, no commands. Acting needs a sign-in (G1-10). 00 bump: M12 gains the mode; the WS contract changes. |
| G1-13b | **Person bound to a session-less device:** a phone's owner (00 M38); a tablet's **last signed-in person** until someone else signs in there, the person signs out explicitly, or the business day closes. Idle timeout and takeover do **not** end the binding; an explicit sign-out does. *Spec note: the binding is derived from session events (`SessionStarted`, `SessionEnded` with its cause) and the day close, so it needs no new event if `SessionEnded`'s cause tells sign-out from idle; to verify in 00.* |
| G1-13c | The tablet always shows **"Alerts: <name>"** in its header (signed in or not), so a wrong binding is visible. |
| G1-13d | A person bound to several devices gets alerts on all of them. |
| G1-13e | **Lock screen / session-less display:** table, kind, point and requester only ("T12 · Void request · Hamza", "T12 Ready — Pass"); never amounts, items or reasons. Details after sign-in. |
| G1-13f | Device revoke or token rotation closes the alert connection at once, as for session connections today (00 M39 `authGeneration`, M40, M60). |
| G1-13g | Point-bound and always-on devices get their device-target alerts as usual (G1-12). |

*G1-13b checked against 00 §3.4:* `SessionEnded.reason` already separates `'logout'` from `'idle_timeout'`, so **no 00 bump is needed for this**. Binding rule by reason: **ends** on `logout`, `forced`, `staff_removed`, `credentials_changed`, `device_revoked`, `hub_restored`; **kept** on `idle_timeout`, `replaced` (same person); `taken_over` moves the binding to the new person (they sign in there).

## 1e. Sounds

| ID | Decision |
|---|---|
| G1-14 | **Urgent repeat stops once the person has seen the request.** |
| G1-14a | The 10 s urgent repeat stops for a person once they have seen the request (opened it while signed in on any of their devices; session-less devices cannot open details, G1-13e, so "seen" is always that person). |
| G1-14b | After seen: one reminder every 2 minutes until answered or closed. |
| G1-14c | Not seen: 10 s repeat until the branch-scope step (2 min, G1-9), then everyone drops to the 2-minute reminder. The G0-2 volume step-up happens once, at the branch-scope step. |
| G1-14d | Always-on screens (cashier, KDS, point tablets) get one sound per escalation step, then a visual badge only; no repeating sound. |
| G1-14e | No snooze. |
| G1-14f | The requester's device never repeats a sound; it shows the waiting state and the "ask in person" line (G1-9b). |

## 1f. Android app form (closes G0 D8 / Q-A2)

| ID | Decision |
|---|---|
| G1-15 | **Bundled assets with a hub-hosted silent APK update.** The foundation stack (bundled assets + local SQLite command queue) stays: hub-loaded pages would leave a tablet that restarts during a Wi-Fi or hub outage with a blank screen and no offline ordering. **D8 and Q-A2 closed.** README R22's "Capacitor shell over the hub's pages" is corrected to "bundled Capacitor app updated from the hub" — *Proposed — needs approval.* |
| G1-15a | **Signing key:** one release key for all builds, backed up in two places (installation runbook). Losing it means reinstalling every tablet. |
| G1-15b | **Update timing:** install only when the tablet has no signed-in session, or the business day is closed, or in the 00 M66 maintenance hour; never mid-service. `426 CLIENT_UPGRADE_REQUIRED` / `min_client_version` stay the hard trigger. *Spec note: the install restarts the app, so the device's alert connection (G1-13) drops for its duration; a "no signed-in session" tablet can still be a bound alert device, so the spec states the gap or prefers the day-closed / maintenance-hour windows for bound devices.* |
| G1-15c | **Staged:** a new APK goes to one chosen tablet first; the rest follow after the owner / developer marks it good. |
| G1-15d | **Rollback:** Android forbids downgrades (without an uninstall, which would wipe the local command queue), so a rollback is a rebuild of the previous code with a higher `versionCode`. The hub keeps the previous APK and serves the last N (≥ 2) app versions it supports. |
| G1-15e | **Ownership:** APK hosting and update endpoints are a 00 bump, or 01e if it fits better (decided in the spec); silent install relies on device-owner mode (D1). |

## 1g. Attempt timers

| ID | Decision |
|---|---|
| G1-16 | **01d's attempt and escalation timers run on a D44-style tick from events.** Each kind declares its steps (delay, targets resolved at send time, sound family); the raiser passes per-alert values (e.g. the walk-to window for Ready to serve). The tick reads 01d's projection of open alerts and requests and writes `AttemptSent` / `EscalationStepped` events for what is due, in one transaction; sends go out after commit; replay never re-sends. Open alerts and requests are rebuilt at boot from the subject streams (order, table, stock), so 03a's `audit`-skipping replay (G1-8e) loses nothing 01d needs. **After a restart, only the latest step that came due while the hub was down is sent, once; skipped steps are recorded as skipped.** |
| G1-16a | **One clock:** 01d's due check runs on the same tick and `branchNow` as the fire scheduler (D44), not a second timer. If 03a's scheduler is not built when 01d ships, 01d owns the tick and 03a joins it (see "To 03a"). |
| G1-16b | **Clock jumps** follow the restart rule. *Note: `branchNow` is monotonic within a process (foundation §4.7 branch clock, D48), so a jump can only appear across a restart (boot `ClockAlarm`, or a forward-set OS clock at boot); the restart rule already covers it.* |
| G1-16c | **A failed send** (device offline, socket closed) is not retried within the step; the missing receipt shows it, and the next attempt or escalation follows on schedule. Device-offline handling is 01e / G0 G7. |
| G1-16d | **Size:** attempt events (≈ 2 per order) were already in the G1-8e estimate; escalation and skipped-step events are rare (≈ 0.1–0.3 per order). The ≈ 75k / day estimate stands; attempts sit on replayed (subject) streams and are counted in the ≈ 45k. |

## 1h. People without a PIN and pagers (01b v1.3 → v1.4)

| ID | Decision |
|---|---|
| G1-17 | **`no_pin_staff` lists every active staff member at the branch without a PIN** (no flag): `{ staff_id, display_name, lead_staff_id }`. **Pager ids are a separate additive map `pager_ids: { staff_id → pager_id }` covering everyone** (PIN holders can wear a watch too). Spec rules: a `staff_id` is in exactly one of `staff` / `no_pin_staff`; setting a PIN moves the person in the same directory version; older hubs ignore both fields (01b B18 a); these people are never on sign-in rosters; `teamOf` gains a variant that includes no-PIN people. Corrects G0 P1 / P2. |
| G1-17a | **Watches move between people by shift.** The directory's `pager_ids` is only the **default**. A manager or the point's assembler can change "who wears pager 5" on the hub at shift start (same screen as lane names, G0-3); the hub assignment overrides the default until changed or the business day closes, then the default returns. The hub assignment is an event (who set it, when). *Spec note: proposed on the `staff` stream; the assignment screen and pager route are 01e, 01d only reads "the person's routes".* |
| G1-17b | **One pager, one person at a time:** assigning a pager already in use takes it from the previous person (shown on screen). |
| G1-17c | A pager with no person assigned receives nothing. |
| G1-17d | `no_pin_staff` carries **no roles or permissions** (these people cannot act); targeting them is only through teams and pager assignment. |

## 1i. Routes (replaces G0 D2)

| ID | Decision |
|---|---|
| G1-18 | **G0 D2 dropped as a setting; routes come from what each person has:** pager worn today (G1-17a), devices bound to them (G1-13b), signed-in sessions. Every route at once (N2). **No route at all** → alerts show on their **lead's devices** ("for Ali"); lead has none → G1-11d fallback (zone order taker, then manager). No per-branch or per-person route setting in 01d. |
| G1-18a | On the lead's device, alerts "for" others are **grouped per person**, not one card each. |
| G1-18b | The shift-start pager screen (G1-17a) shows people with no route at all ("Ali: no pager, no device"), so it is fixed before service. A hint, not a block. *Spec note: there is no "on shift" record for waiters (only the cashier shift, D21); the hint lists the active branch staff in the assigner's team tree, or all active branch staff for a manager, unless 01b / 02 adds a shift.* |
| G1-18c | **G0 D2 / H0 wording, as amended:** the product works without hardware because a person with no pager and no bound device is covered by their lead's tablet; pagers and button devices only add speed. |

| G1-19 | **The personal-phone alert app waits until after the pilot (§12.4).** Personal phones stay browser-only (00 M38), covered by the G1-13 device binding while the page is open; no APK for personal phones; R14 narrowed as G0 D6. Reason: a sideloaded app is not device owner, so no silent update (G1-15), per-brand battery steps, and maker-killed background services, for no pilot flow. **Post-pilot product item:** customers without hardware may want it. |
| G1-20 | *Proposed — owner may prefer to skip it.* **"Present today" presence record** instead of a shift system. The shift-start screen (pager and lane assignment, G1-17a / G0-3) has a tick list; ticking writes an event on the `staff` stream (who, set by whom, when); it clears when the business day closes. Used for: the no-route hint (present people only, G1-18b), skipping absent people in fallbacks and team targeting, and the load denominator in K12. Not a clock-in (payroll clock-in stays its own story). *Safety rule added: if no one has ticked the list today, everyone counts as present, and a person signed in anywhere counts as present; otherwise a forgotten list would make every team "absent" and send alerts nowhere.* |

## 1j. Model and interfaces (G1-21)

| ID | Decision |
|---|---|
| G1-21 | **Model.** One record, the **alert**: kind, subject (`stream_type` + `stream_id`), target, raiser values (e.g. walk-to window), open / closed. A **request** is an alert with an answer part (requester, permission, range, decision). **Subject stream** (order, table, stock): `AlertRaised`, `AttemptSent` (step, resolved people and devices, routes), `EscalationStepped`, `StepSkipped`, `RequestAnswered` (decision, answerer, method, device), `RequestWithdrawn`, `AlertClosed` (reason), `RequestSeen` (below). **`audit`** (batched): `AlertDelivered`, `AlertSeen`. **`staff`**: pager assignment (G1-17a), presence (G1-20). Device binding derived from session events (G1-13b). `stream_type` enum unchanged. **Interfaces:** `registerKind({ kind, family, steps, labels, request?: { rightOf, rangeOf(subject), needsPin, answerLabels, apply(tx, answer) } })`; `raise(tx, { kind, subject, target, values, dedupeKey })`; `close(tx, alertId, reason)`, both in the caller's transaction; client commands `AnswerRequest`, `WithdrawRequest`; receipts over WS. **Target kinds:** person, permission + range, team of a person, table's team, point devices, always-on screens. **Route interface:** `{ format: 'text' \| 'short_code', ack: boolean, receipts: ('delivered' \| 'seen')[], send }`; 01e plugs the pager route in. |
| G1-21.1 | **Seen survives boot.** The **first seen per person on a request** is written **on the subject stream** as `RequestSeen`, unbatched, so the open-request projection rebuilds it at boot and G1-14's repeat stays stopped. Chosen over reading `audit` at boot: requests are few per day (void, discount, comp, handover, zone transfer), so the subject-stream cost is negligible, and it needs no payload index on `audit` and no boot read outside the replayed streams. `AlertSeen` on `audit` stays for every other alert (none of them repeats on seen: Action is re-sent only by attempts, Info never repeats). |
| G1-21.2 | **Request result alert:** kind `request_result`, Info family, to the requester's routes, carrying decision and answerer (or closer and reason), raised **in the same transaction** as `RequestAnswered` or `AlertClosed` (`overridden`, `obsolete`). |
| G1-21.3 | The record keeps **two target sets**: **answerers** (right + range) and **informed** (read-only, from escalation, G1-9b). |
| G1-21.4 | **Idempotent raise:** `dedupeKey` = kind + subject + discriminator (e.g. point); a second raise while an alert with that key is open is a no-op (returns the open alert's id). New close reason **`undone`** (e.g. Ready to serve tapped by mistake and reverted by 03b). Close reasons: `done`, `answered`, `withdrawn`, `obsolete`, `overridden`, `undone`. |
| G1-21.5 | **Client queries and frames:** inbox for the signed-in person (today, open pickups first, N4); "my pending requests"; "requests I may answer"; alert frames also on the **normal staff-session WebSocket**, not only the alert-only mode (G1-13). |
| G1-21.6 | **i18n:** each kind registers label keys (English / Urdu) for card text and for the session-less lock text (G1-13e). Pager text is Latin only (01e). |
| G1-21.7 | **Real producer at ship: kind `test_alert`.** A manager sends a test alert to a person, a team or a point and sees the receipts. Proves the whole path at the pilot; the installation tool for watches and the bridge (01e). *Spec note: proposed right `manage-devices` (no new permission).* |
| G1-21.8 | **Raise-side permission** is the owning module's: it checks the requester's base permission (e.g. `void-item` with `requires_approval`) before calling `raise`. 01d checks only the answer side. |
| G1-21.9 | **Subject-less alerts** (device offline, "no approver signed in" G1-9e, zone threshold with no table) live on the `hub` or `stock` stream as fits. |
| G1-21.10 | **Resolvers for later modules** (02, 01a, 01b) are registered interfaces; targets that cannot run until another module lands are listed in §4 "Stubbed until". |
| G1-21.11 | **Finding for the spec — what "the right to answer" is.** 01b models approval as the **requester's** grant: `requires_approval` + `approver_role_ids` (01b §3.3; e.g. Cashier `apply-discount` approved by Manager). Only voids also have an answerer permission, `approve-void` (scopes `branch`, `my_team`), and foundation §4.5 uses it. So `rightOf` for money kinds is: **the answerer holds a role in the requester's resolved `approver_role_ids`, read at answer time**; range comes from `approve-void`'s scope for voids and is `branch` for discount and comp (no scope exists for them). The spec must state how `approver_role_ids` and `approve-void` combine for voids (both required, or either), with 04. |

## 1b. Receipts

| ID | Decision |
|---|---|
| G1-8 | **Delivery receipts are synced events**: **delivered** and **seen** only. "Sent" is taken from the attempt event (it lists targets and routes); "answered" is the request's answer event. |
| G1-8a | **Stream:** receipt events go on the existing **`audit`** stream_type, not the subject's stream: ~5,000 receipts per rush would load the order stream 03a replays (R6, 90 s boot budget), and the engine never needs them. They still sync to the cloud and show on the owner's remote view. Payload carries the notification id and the subject (`stream_type` + `stream_id`) to join back. |
| G1-8b | Only the **first** delivered and the **first** seen per person per device per notification are recorded; repeats are dropped on the hub. |
| G1-8c | **Batched writes:** receipts are appended in batches (flush every 1–2 s or N receipts, whichever first), one transaction per batch, since each commit is an fsync under `synchronous=FULL`. A hub crash may lose the last batch; **acceptable for receipts only** (no other 01d write is batched). |
| G1-8d | **Pager route:** sent only (from the attempt event); no receipts (01e). |
| G1-8e | **Sizing re-check** (below). |

**Sizing re-check (R6).** R6 assumes 2,000 orders/day ≈ 40,000 events/day (≈ 20 per order). 01d adds per order, at design size: Ready to serve per point (~1.5 points) × ~1.3 attempts ≈ 2 attempt events; receipts ≈ 2 attempts × ~3 people × 1 device × 2 (delivered, seen) ≈ 12; plus Served card, slip and request traffic ≈ 2–4. So **≈ 16–18 extra events per order, ≈ 32–36k per day: total ≈ 75k events/day, of which ≈ 45k are on replayed streams** (order, table, station, stock) and ≈ 30k on `audit`.

Finding: foundation §5.8 step 3 replays `SELECT * FROM events WHERE branch_id = ? AND seq > snapshot.last_seq`, **all stream types**. Putting receipts on `audit` keeps them out of the replay **only if 03a filters replay by `stream_type`** (with an index that serves it). Without that, G1-8a saves nothing at boot.

## 2. Carried rows

### To 03a

| Row | Item |
|---|---|
| G1-8e | Size snapshots and replay against **≈ 75k events/day** (≈ 45k on replayed streams, ≈ 30k `audit`) instead of R6's 40k. Engine replay reads only the stream types its reducers use (skip `audit`), with an index serving `(branch_id, stream_type, seq)` or equivalent; this changes the foundation §5.8 step 3 query text, so it lands through the foundation v1.8 bump (R34). Cloud sync volume roughly doubles; note for 06 sizing. |
| G1-16a | **One tick:** 01d's due check shares the fire-scheduler tick and `branchNow` (D44). 01d ships first, so 01d owns the hub tick loop as built; 03a's fire scheduler joins it (registers its intents query) rather than starting a second timer. |

### To 01e (pilot, mandatory)

| G0 row | Item |
|---|---|
| D3 | Pager watch via ESP32 pager bridge (433 MHz), watch text format |
| D4 | Station button device (paired as `kds`, lanes) |
| D5 | `pager_bridge` device type: CHECK widening migration, `DevicePaired` v2 + upcaster, approval payload, 00 bump |
| G1 | Compact device protocol frames |
| G2 | `ref` names the item; stale stage → fresh lines |
| G3 | Press time = hub receive time; `source: 'button'` |
| G4 | No queue on device; `OFFLINE`; tablet and auto-print fallback |
| G5 | No snapshot to headless devices |
| G6 | Headless pairing (button display code; bridge setup-mode AP) |
| G7 | Device health / keepalive shown to point assembler and manager |
| N2 (pager part), N5 (pager receipt = sent only), N8 watch kinds, G0-2 watch patterns | The pager route, plugged into the 01d route interface |
| G0-10 | Watch model and code format (after the spike) |

## 3. Fold into the G0 file

| G0 row | Result |
|---|---|
| S1 | Confirmed, narrowed: device gateway and pager route move to **01e** (G1-5). |
| S3 | **Amended:** order per G1-6 (spike now ∥ 01d spec → 01d build → 01e spec → 01e build → 03a → 02 → 04 → 03b → 05). |
| H0 | **Amended** (G1-4, G1-18c): product rule, not a pilot cut; the pilot ships hardware; without hardware a person with no route is covered by their lead's tablet. |
| D1 | Confirmed; plus hub-hosted silent APK update relying on device owner (G1-15). |
| D2 | **Reversed:** no route setting; routes derived per person (G1-18). |
| D3–D5 | Moved to 01e (§2). |
| D6 | Confirmed; personal-phone alert app after the pilot (G1-19). |
| D7 | Confirmed. |
| D8 | **Closed:** bundled assets (G1-15). |
| G1–G7 | Moved to 01e (§2). |
| N1 | Confirmed; table's team = current owner + reports (G1-11); point = device target (G1-12); target kinds G1-21. |
| N2 | Confirmed; device-level alert connection (G1-13); pager route via 01e. |
| N3 | Confirmed (set in G0-2, G1-14). |
| N4 | Confirmed; queries in G1-21.5. |
| N5 | **Amended:** delivered / seen only, sent from attempts (G1-8); request seen on subject stream (G1-21.1). |
| N6 | **Amended:** 01d owns the request (G1-7); PIN per kind (G1-10); right per G1-21.11. |
| N7 | Confirmed; kinds registered by owners; 01d ships `test_alert` and `request_result` (G1-21.2, .7). |
| N8 | Confirmed; watch part to 01e. |
| N9 | Confirmed; "table's order taker" = current owner (G1-11). |
| N10 | Confirmed (02's rule; 01d supplies the accept request). |
| P1, P2 | **Amended:** `no_pin_staff` for every PIN-less active person; `pager_ids` separate map with hub shift override (G1-17). |
| G0-1 | **Amended:** approval tier wording (G1-9f); timers on the D44 tick (G1-16). |
| G0-2 | **Amended:** repeat stops once seen (G1-14). |
| G0-7 | **Amended:** escalation widens who is told, never who may answer (G1-9). |
| §8 R30 / R28 | Renumbered **R34 / R33** (G1-1). |
| New | Presence record (G1-20, proposed). |

## 4. 01d §12.4 deferred list

- Personal-phone alert app (APK on staff-owned phones) — post-pilot product item (G1-19).
- General "no route reaches this person" warning (Q-N5 beyond approvals, G1-9e).
- Free-text and cross-team task messages beyond zone-stock transfers (README "cross-team requests").
- Customer table call buttons.
- Inbox history beyond the current day.
- Reports and dashboards over receipts and attempts (07, P2); 01d captures the events.
- Main / secondary roles and capacity fields (R25, 01b B1).
- iPhone locked-screen alerts (R22).
- Shift system / clock-in (G1-20 is presence only).
- Pager delivery receipts (watch is receive-only; 01e).

**Stubbed until another module lands (deferred integration, built against registered resolvers and test producers):**

| Target / kind | Stubbed until |
|---|---|
| Table's team (G1-11) | 02: `tableOwner(table)` |
| Zone order-taker fallback (G1-11d) | 01a zones (Z1) + 01b zone assignment (P5) + 02 `zoneOf(table)` |
| Point devices (G1-12) | 01a points (K1) + the 00 `point_id` device column, which lands with them |
| Pager route | 01e |
| Void approval | 04 |
| Discount / comp approval | 05 (discount), 02 / 05 (comp, C2, C3) |
| Table handover accept | 02 |
| Zone-stock transfer | 01a zone stock + 02 (Z6) |
| Ready to serve / Call / Served card | 03a / 03b (Ready to serve, Handover), 02 (Call, Served) |
| Slip warning | 03a |

Live at 01d ship: `test_alert`, `request_result`, "no approver signed in" (G1-9e).

## 5. Spec version bumps 01d carries

| Target | Change (01d only) | Needs first |
|---|---|---|
| **README** | Module map: 01d renamed **Notifications, requests and devices** → narrowed to "Notifications and requests" with **01e Device gateway** as a new row (G1-5); R21 / R27 build order and milestone A list (G1-6); **R22** routes add the pager route, "Capacitor shell over the hub's pages" → bundled app updated from the hub (G1-15), personal-phone app after pilot (G1-19); **R33** device policy (D1, D6, D7, G1-15, G1-19); **R34** foundation by version bump (G1-2); carried rows To 01e, To 03a (G1-8e, G1-16a), To 02, To 04, To 05 from §2 / §4. All *Proposed — needs approval.* | — |
| **CLAUDE.md** | "The foundation is frozen (D64)…" line edited to match R34, same change as R34. | developer approval at the gate |
| **Foundation v1.7 → v1.8** | §4.5: void states mapped to 01d requests (OVERRIDDEN by 04 through close; withdrawn = never happened, 04 to confirm); "urgent push to all approve-void holders" → in-range approvers, then escalation (G1-9); REJECTED "waiter notified" → table's order taker (N9). D3 / §4.7 slip warning to the table's order taker (N9). Stack table: Android tablets in kiosk mode (device owner), bundled app updated from the hub (G1-15). | R34 + CLAUDE.md |
| **00 v1.5 → v1.6** | M12: `device_token`-only alert WS mode, alert frames, receipts in (G1-13a); alert frames on staff-session WS (G1-21.5); revoke / rotation closes alert sockets (G1-13f); APK hosting and update endpoints (G1-15e, unless the spec places them in 01e); R14 / M38 narrowed text (G1-19). *Not in this bump:* `point_id` (with 01a points), `pager_bridge` and headless pairing (01e → 00 v1.7). | — |
| **01b v1.3 → v1.4** | `no_pin_staff` directory array, `pager_ids` map, `teamOf` variant including no-PIN people (G1-17); answer-right rule for `requires_approval` kinds stated against §3.3 (G1-21.11, with 04). *Not in this bump:* `tap-for-station`, `mark-served`, zone assignment, `manage-zone-stock` (carried to 01b by 02 / 03a / 03b). | — |
| **01a** | None from 01d. | — |

Bumps 01d does **not** carry (listed for the order): 01a v2.1 (points, zones, walk times, short names, pager codes; first needed by 01e / 03a), 00 v1.7 (`pager_bridge`, compact protocol, headless pairing, `point_id`; by 01e), foundation §4.2 / §4.4 / §4.7 / §5.8 step 3 (Ready to serve, Handover, lanes, replay filter; by 03a under R34).
