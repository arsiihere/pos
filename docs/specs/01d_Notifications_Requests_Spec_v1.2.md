# 01d — Notifications and requests — Module Spec v1.2 (APPROVED — v1.1.1 as built + 02a Tables v1.0 rows D-1–D-3, not yet built)

## §1. Header

| | |
|---|---|
| Module | 01d Notifications and requests |
| Version | **v1.2 APPROVED (developer as the owner's proxy, 2026-11-07, with 02a Tables v1.0)** — 02a §4.5 rows D-1 (the `table_team` resolver is the full recipient set, keyed by depth), D-2 (Served card → 03b), D-3 (kind flag `skip_requester`), "⚠️ Changed by 02a v1.0 (D-n)" markers; **not yet built** (the 02a build changes `alerts/targets.ts` and `alerts/kinds.ts` with their tests). **v1.1.1 APPROVED (developer as the owner's proxy, 2026-11-03) — editorial patch from 03a Timing Engine v1.0** (03a §4.5 "01d v1.1 → v1.1.1", rows N-1, N-2; "⚠️ Changed by 03a v1.0 (N-n)" markers): no rule, code, contract or test change; v1.1 kept as history. **v1.1 APPROVED (developer, 2026-11-02) — as built; v1.0 kept as history.** All folded rows (ruled, proposed and unattended) were approved by the developer on 2026-11-02. v1.1 folds in what the `module-01d` branch built: BF-1–BF-8 (§12.6) as built, the developer's planning decisions AD-1–AD-9, and the build rows AD-10–AD-168 plus the batch 9a rows of `docs/reviews/01d-auto-decisions.md`. Each folded row is marked **ruled** (a developer decision or ruling), **proposed** (an implementer or controller reading, not yet ruled), or **unattended — developer to confirm** (the batch 9a rows); these markers are kept as history. Rows not folded, and why, are in `docs/reviews/01d_v1.1_asbuilt_draft_notes.md`. The contract changes other modules read are listed below; they were approved on 2026-11-02 and applied as 00 v1.6.1, 01a v2.0.1 and 01b v1.4.1. **v1.1 supersedes v1.0**, which is kept as history; the README module map row 01d is v1.1, Implemented. **v1.0 — APPROVED** (developer, 2026-11-01). v1.0 = v0.5 + G4 hostile review run 3 (the last, `docs/reviews/01d_v0.5_hostile_run3.md`: 0 BLOCKER, 2 MAJOR, 16 MINOR, FIX THEN APPROVE, no run 4): R1 and R2 fixed, MINORs m3, m4, m5, m7, m11, m13, m15, m16 fixed, the other eight MINORs listed as build-time fixes BF-1–BF-8 (§12.6). The §4.5 changes are applied by version bump (R26): README, CLAUDE.md, foundation v1.8, 00 v1.6, 01b v1.4. v0.5: G4 hostile review run 2 applied (`docs/reviews/01d_v0.4_hostile_run2.md`, 0 BLOCKER, 6 MAJOR, 12 MINOR). v0.4: G4 hostile review run 1 applied. v0.3: G2 completeness check applied. v0.2: developer review of v0.1. v0.1: first draft from G0 + G1. |
| Inherits | Shared Standards from **Foundation v1.8** §6 (envelope, error naming, hub HTTP and WS conventions, naming, tests, migrations, folders). Not redefined here. Written against v1.7; v1.8 is the bump this spec makes (§4.5 C-F). |
| Depends on | Foundation v1.8; **00 Hub Platform & Access v1.6** (command and query registry, writer, WS, sessions, PIN check, directory; v1.6 = v1.5 + this spec's C-00 rows); **01b Staff and Roles v1.4** (effective permission with scope and approvers, `leadOf`, `teamOf`; v1.4 = v1.3 + this spec's C-01b rows); **01a Restaurant Setup v2.0** (business day events only; v1.0 changed nothing in 01a. *As built (AD-123, ruled):* the build adds `stuck_alerts` to 01a §6.21 `config-status`, see "Contract changes" below; applied as **01a v2.0.1**). *v1.1:* the as-built 00 and 01b rows are applied as **00 v1.6.1** and **01b v1.4.1** (approved 2026-11-02) |
| Inputs | `docs/stories/01d-g0-decisions.md` (G0 register, with G1 markers), `docs/stories/01d-g1-decisions.md` (G1 record, G1-1 … G1-24), `docs/stories/01d-notifications-teams-refined.md` (2026-10-27 owner record). v1.1 also: `docs/reviews/01d-auto-decisions.md`, `docs/plans/01d-plan.md`, `docs/plans/01d-status.md`, the final review `.superpowers/sdd/01d-plan/final-review-report.md` |
| Tier | T2 Production (CLAUDE.md). Races that matter here: two answers at once (first wins), answer vs. close, raise twice for one subject. |
| Changes other specs | §4.5 (R26), **approved with this spec (developer, 2026-11-01) and applied by version bump**: README (R-1–R-9, R34), CLAUDE.md, foundation v1.7 → v1.8 (C-F), 00 v1.5 → v1.6 (C-00), 01b v1.3 → v1.4 (C-01b). Each target carries "Changed by 01d v1.0" markers; the old version files stay as history. **v1.1 (approved 2026-11-02):** the as-built changes to 00, 01a, 01b and `packages/events` are listed in "Contract changes other modules read" below and applied as patch-level as-built bumps: 00 v1.6 → v1.6.1, 01a v2.0 → v2.0.1, 01b v1.4 → v1.4.1 (so 00 v1.7 stays free for 01e and 01a v2.1 for 03a), each with a changelog line and "Changed by 01d v1.1" markers; the old files stay as history. The `packages/events` changes are listed here only. |

### Changes in v1.2 (02a Tables v1.0, developer as the owner's proxy, 2026-11-07)

Source: `docs/specs/02a_Tables_Spec_v1.0.md` §4.5. Rule and code changes in `alerts/targets.ts` and `alerts/kinds.ts`, built with 02a.

| Row (02a) | Change | Where |
|---|---|---|
| D-1 | **`table_team` resolver = 02a `tableTeam`, the full recipient set.** (a) A missing `depth` is normalised to `direct` before keying; `targetKey` includes the depth (`table_team:<table_id>:<depth>`), so `owner` and `direct` targets for one table in one batch get separate lists. (b) `resolveTarget` uses the resolver's `staff_ids` as the full set for both depths and **no longer adds `teamOf(owners)`** for this kind (AD-51 reversed for `table_team`), still applying the presence filter. (c) The absent-owner marker and the zone-order-taker fallback use the resolver's `owner_staff_id` (the holder), not every returned id. (d) `ResolvedTarget` and the §4.2 resolver type gain an optional `owner_staff_id`. (e) Resolvers read the directory through `alertDirectoryOf(tx)`. 02a's rule: `owner` → `[holder]`; `direct` → the assigned order taker's working reports (else the holder's working reports, else none) **plus the holder**. | §3.4.2 table, AD-51 note, §4.2 `registerTargetResolver`, §4.3 To 02, §4.4 stub table, test 25 |
| D-2 | The "Served card" kind is 03b's (it fires at Handover). | §4.4 |
| D-3 | New optional kind flag **`skip_requester: boolean`** (default `false`; the one optional flag besides `onWithdraw`): when true, the requester is left out of every set of every step (today only `answerer` entries skip him). Startup error: `skip_requester` on a request kind (requests already skip). 02a's `call_waiter` sets it. | §3.5 kind block and startup errors, `targets.ts:357` |


### Changes in v1.1.1 (editorial, from 03a Timing Engine v1.0, developer as the owner's proxy, 2026-11-03)

Source: `docs/specs/03a_Timing_Engine_Spec_v1.0.md` §4.5. No rule change.

| Row (03a) | Change | Where |
|---|---|---|
| N-1 | "no pilot request kind is tick-raised" → 03a's `slip_warning` is tick-raised (`named`, `needs_pin: 'never'`): no in-person answer, no requester, no withdraw, no `request_result` (AD-72); 03a closes it. `station_overload` is a plain `info` kind; the table dedupe key works under `(kind, dedupe_key)` as written | §3.3 rule 2 |
| N-2 | The Ready-to-serve kind is 03b's (03a-g0 §3 #6); the slip target is `{ kind: 'person', staff_id: <receiver> }` with `receiver_staff_id` from 02's `tableOwners`, raised by 03a's `fires_alerts` tick, not `{ kind: 'table_team', depth: 'owner' }` | §4.3 To 03a, §4.4 |

### Changes in v1.1 (as built, APPROVED by the developer, 2026-11-02)

v1.1 makes the spec match the code on branch `module-01d` (final review I-1). **All folded rows (ruled, proposed and unattended) were approved by the developer on 2026-11-02.** The per-row status markers below and in the body are kept as history of how each row was reached. Status of each row (history): **ruled** = a developer decision or ruling; **proposed** = an implementer's or controller's reading, not yet ruled; **unattended** = a batch 9a row, developer to confirm. In the body each fold carries a marker `> As built (AD-n, ruled|proposed|unattended): …` (inside tables: *As built (AD-n, …):*). Nothing here adds an error code; one index is added to the unmerged migration `0006` (AD-161).

| # | Change | AD rows (status) | Sections |
|---|---|---|---|
| 1 | **BF-1–BF-8 done as built**, each with its test (§12.6 gains a status column). BF-3's wording replaces the kiosk binding row; BF-4's fact is `from_business_day`; BF-5's frame is `binding_route`; BF-7 reuses the `no_approver` flag. | BF-1–BF-8 (fixes approved with v1.0); AD-46, AD-4, AD-5, AD-3 (ruled); AD-20, AD-70, AD-150 (proposed) | §3.3, §3.4.1, §3.5, §3.7, §3.10, §5.2, §6, §8.1, §12.6 |
| 2 | **Planning decisions:** batch 9 split into 9a (hub-served `staff` entry in `apps/client`, built) and 9b (tablet app, `docs/plans/01d-tablet-plan.md`, blocked on the tablet model, required before the pilot); answers online-only by construction; `SetPresence` screen is 01e's; 01b rows and H-5 built early; #58 skipped off the pilot hardware. | AD-1–AD-9 (ruled) | §3.11, §5.2, §8, §10 #58, §11, §12 |
| 3 | **Six frames, not five:** `binding_route { until }` and `alerts_open.binding_route_until` (BF-5). Sent after any committed step event that routes to the device (raise or tick), the first value counts as a change, and reconnect applies the full binding rule. | AD-4 (ruled); AD-126, AD-127, AD-128 (proposed) | §3.7, §6 batch 3, §6.11, §4.5 H-2 |
| 4 | **Additive view fields.** Inbox rows: `state`, `close_reason`. Signed-in view (card frames, inbox, catch-up, requests-to-answer): `answers`, `needs_pin`, `silent`, `raised_device_id` (requests). Every view of a `request_result`, lock frames included: `outcome`. `seen_by_me` on `alerts_open` and catch-up; `from_business_day` on catch-up and `requests-to-answer` rows; receipts: `no_route`, `for_staff_name`. | AD-22, AD-23, AD-82, AD-165, AD-5 (ruled); AD-138, AD-141, AD-145, AD-146, AD-150, AD-153 (proposed) | §5.4, §6.7–§6.10, §6 batch 3 |
| 5 | **One card rule everywhere** (frames, catch-up, inbox, requests-to-answer): the card goes only to a viewer who is a person recipient or may answer now, on their own staff session; a viewer who is only a device target gets lock only. | AD-162, AD-163 (ruled); AD-R-d-1–4, AD-M1 (unattended) | §3.12, §6 batch 3, §6.7, §6.9 |
| 6 | **Startup errors added:** a step `at: { value }` key not in `values_schema`, or not a required `z.number()`; a `from_value` key not a required `z.string().min(1)`; `closes_on.after_ms` on a request kind. | AD-36, AD-117 (proposed); AD-124 (ruled) | §3.5, §4.2 |
| 7 | **Poisoned alerts:** a step whose time or targets cannot be computed sets `next_due_at = NULL` (logged once); the tick skips such an alert per alert; the alert stays answerable and closable; "Stuck alerts: N" on 01a `config-status`. | AD-123 (ruled); AD-116 (proposed) | §3.5, §5.2, §4.3 To 01a |
| 8 | **Prepared-statement cache** on 01d's hot paths only. | AD-125 (ruled) | §7 |
| 9 | **Tick bound on a dirty-flag pass** is a fixed extra (pinned at 9 statements, 11 when it raises); read (7) is kept but unused. | AD-131 (ruled); AD-119 (proposed) | §3.5 |
| 10 | **`business_day_id`** = the `event_id` of the open day's `BusinessDayOpened`; `SetPresence` semantics. | AD-156 (ruled); AD-157 (proposed) | §3.11, §6.6, §4.2 |
| 11 | **Receipts:** first receipt wins, so the route shown is the first delivered route for that device and step; receipts for closed alerts are accepted; the route is read from the receipt's own event. | AD-166, AD-88 (ruled); AD-83–AD-87, AD-153–AD-155, AD-160 (proposed); AD-M2 (unattended) | §3.6, §6.10 |
| 12 | **Test wording:** #27 "no active binding is left"; #55 personal notices never go on short-code routes; #58 skipped off the pilot hardware, measured on the dev laptop. | AD-49, AD-164, AD-9, AD-125 (ruled); AD-122 (proposed) | §10 |
| 13 | **BF-3 wording** in §3.7 and §5.2: kiosks and KDS devices get no `device_bindings` row. | AD-46 (ruled); AD-47 (proposed) | §3.7, §5.2 |
| 14 | **12-hour times** on staff screens ("2:02 PM"); the spec's example times are written the same way. | AD-167 (ruled) | §3.3, §3.7, §3.10, §4.3, §8.1, §10 #57 |
| 15 | **Carried row to 02 and 04:** the Requests (n) / Inbox (n) top-bar buttons. | AD-168 (ruled) | §4.3 |
| 16 | **Index `alert_inbox_alert`** in §5.1 (and in the unmerged `0006`); retention cutoff and batch unit. | AD-161 (ruled); AD-158, AD-159 (proposed) | §5.1 |
| 17 | **Targets, fallbacks, routes:** resolver shape, presence-filter scope, fallback order and stop rule, absent-owner marker, "for" rows, route row `ref`. | AD-51–AD-54, AD-59, AD-61–AD-65, AD-106 (proposed) | §3.3, §3.4, §3.8, §4.2 |
| 18 | **Answer pipeline:** replay peek for PIN commands, hooks ctx, shared argon2 pool, `pinHooks` gain `cmd`, `preRead` M39 reads only when the auth generation moved, the `pin_use_failed` raise is guarded, `pinFailed` with no alert row, one `raiseMany` per answer, no `preRead` for withdraw. | AD-24–AD-27, AD-89, AD-91, AD-93, AD-94, AD-99, AD-100, AD-103, AD-105 (proposed) | §3.3, §4.5 H-3, §6.2, §6.3 |
| 19 | **Raise and close:** dedupe freed by an appended close, `details` to a kind with no schema, `request_result` and notice values, `hidden_from` on raise input, unknown-id close, `MarkAlertsSeen` writes its own `AlertClosed`, tick-written expiries. | AD-68, AD-69, AD-72, AD-73, AD-95, AD-98, AD-101, AD-102, AD-104, AD-108, AD-120, AD-121 (proposed) | §3.5, §3.10, §4.2, §6.1, §6.4 |
| 20 | **Frames and sockets:** `alerts_open` row shape, `alert_closed` nullable fields, `4409` and `1011` as local constants, builder and listener guards, `sendToSessions`, one frame per (socket, "for" person), close / seen frames to bound devices, hiding of `alert_closed`, every request close to the requester, safe error logging, strict lock frame. | AD-17, AD-18, AD-30, AD-31, AD-74, AD-76–AD-81, AD-148 (proposed) | §3.7, §6 batch 3, §7, §4.5 H-4 |
| 21 | **Queries:** response containers, "today", action-first ordering, one inbox row per alert, late answerer's `set`, `my-requests` fields. | AD-13, AD-139, AD-140, AD-143, AD-144, AD-149, AD-151, AD-152 (proposed) | §6.7–§6.9 |
| 22 | **Wire schemas:** ids as non-empty strings, nullable display fields, step-target kinds, free `route` / `error_code` strings, the `PresenceSet` bound, `RequestPinFailed.requester_staff_id`, `INTERNAL_ERROR` code. | AD-11, AD-12, AD-14, AD-15, AD-16, AD-96, AD-97 (proposed) | §4.2, §5.4, §6 |
| 23 | **Projections:** unknown kind on replay, registration in boot `createDeps`, `moved_to` value, `StepSkipped`, time source. | AD-6 (ruled); AD-40, AD-42–AD-44 (proposed) | §5.2 |
| 24 | **00 and 01b as built:** `preRead(db, payload, ctx)`, `err` log key, read-only view blocks `exec` / `pragma` / `transaction`, `startSweeper(deps, log)`, `/app/*` route group, `app-release` through `tsx`, `rawDbOf`, `client-dist` `indexMeta`; duplicate `no_pin_staff` entry skipped, a no-PIN entry's lead. | AD-10, AD-20, AD-21, AD-28, AD-29, AD-34, AD-35, AD-67, AD-32, AD-33 (proposed); AD-T41-1 (unattended) | §4.5 |
| 25 | **`no_approver` and `SendTestAlert`:** approvers derived from `resolve()`; a warning that ends otherwise closes `done`; branch scope on every range; a no-PIN person counts as known; `test_alert` display. | AD-130, AD-132, AD-133, AD-135, AD-136 (proposed) | §3.9, §3.10, §6.5 |
| 26 | **Batch 9a client decisions** (staff entry, socket, store, sounds, labels, answer sheet, tablet header): folded in §3.7, §3.12, §7 and §8. | Batch 9a rows (unattended) | §3.7, §3.12, §7, §8 |
| 27 | **Open items before the pilot** listed: 9b with #63, #58 on the pilot mini PC, the manual checks (with the blocked ones), the batch 9a data gaps. | AD-1, AD-9 (ruled); AD-T42-2 (unattended) | §12.1, §12.7 |

### Contract changes other modules read: approved 2026-11-02, applied as 00 v1.6.1, 01a v2.0.1, 01b v1.4.1

Taken from the final review (`.superpowers/sdd/01d-plan/final-review-report.md`, "Contract-changing ADs that need developer approval"). Every change is additive except where noted. **Approved by the developer on 2026-11-02** and applied as patch-level as-built bumps (R26, R34), each with a changelog line and "Changed by 01d v1.1" markers, the old files kept: **00 v1.6 → v1.6.1** (the 00 rows), **01a v2.0 → v2.0.1** (AD-123), **01b v1.4 → v1.4.1** (the 01b rows). The `packages/events` changes stay listed here. The README row 01d is "v1.1 APPROVED, Implemented".

**`packages/events` (shared wire schemas)**
- AD-4: the `binding_route` frame and `alerts_open.binding_route_until`.
- AD-17: the `alerts_open` row shape (the view minus `card` and the signed-in fields; `escalation`, `set`, `for_staff_id` optional; `.strict()`).
- AD-18: `alert_closed.decision` and `by_name` nullable (null unless `reason = 'answered'`).
- AD-22: inbox `state` / `close_reason`.
- AD-23, AD-146: `answers` / `needs_pin` / `silent` on the signed-in view and on card frames.
- AD-82, AD-145: `outcome`.
- AD-138: `seen_by_me` on `alerts_open`.
- AD-141: the `alerts` catch-up part shape.
- AD-153: receipts `no_route` / `for_staff_name`.
- AD-165: `raised_device_id` on the signed-in view.
- AD-5 / AD-150: `from_business_day`.
- AD-11, AD-12, AD-13, AD-14, AD-16, AD-149: ids, nullability, query response names, step-target kinds, the `PresenceSet` bound, `MyRequestRow` fields.
- AD-30: `4409` is not in `WS_CLOSE` (a local constant; 9b adds `WS_CLOSE.REPLACED`).

**00 platform**
- AD-10: the `preRead(db, payload, ctx)` form.
- AD-24: the early replay peek for `pinCheck` commands (a replay with no valid token gets `401`, not the stored `200`).
- AD-25: `authGen` captured before the session check.
- AD-26: the hooks ctx built with `permission: null`.
- AD-27: PIN commands share the `/auth/pin` argon2 semaphore.
- AD-94: both `pinHooks` gain a trailing `cmd: PosCommand` argument.
- AD-20, AD-28: the `err` log key (pino's error serializer).
- AD-29: `startSweeper(deps, log)` (signature change, one caller).
- AD-31: the receipt listener and builder guards, close `1011`.
- AD-34: `/app/*` uses the `admin-device-public` route group.
- AD-67: the `rawDbOf` export of `engine-host/read-only-tx.ts` (map key only; where it may be imported is for this review).
- AD-74: `WsHub.sendToSessions`.
- AD-111: `due` runs on a read-only view.
- AD-T41-1 (unattended): `client-dist.ts` `indexMeta` (tenant and branch ids, branch name and the hub clock as `<meta>` in `/staff/index.html`).

**01a**
- AD-123: `stuck_alerts` in `ConfigStatusResponse` and the `config-status` query (01a §6.21: 2 → 3 statements), and the client stock admin. **Not strictly additive:** `stuck_alerts` is a required field (final review m-2); safe only while the hub and its served client ship together (`ship-client.sh`). The developer approves it as is, or with `.default(0)`. **Approved as built (required), 2026-11-02.**

**01b**
- AD-32: a `no_pin_staff` entry whose id is already in `staff`, or repeated, is skipped (`{ kind: 'staff', reason: 'duplicate staff' }`).
- AD-33: `leadOf` covers `staff` entries; a no-PIN entry's lead is read through `noPinStaff()`.
- The B-5 bound (≤ 27, measured) is per v1.0.

**Schema and migration**
- AD-161: the `alert_inbox_alert` index in `0006_alerts.sql` (unmerged, never released) and in §5.1.

**Spec-visible behaviour restated here (approve with the bump)**
- AD-36, AD-117, AD-124: the startup checks. AD-108: `MarkAlertsSeen` writes `AlertClosed` itself. AD-131: the tick bound. AD-156: `business_day_id`. AD-162, AD-163: the card rule. AD-166: first receipt wins. AD-M1, AD-M2. AD-T42-2: the tablet page approximates the BF-5 deadline until 9b (final review I-2). **Approved as approximate** (2026-11-02); the exact header source is carried to 01e and 9b (§4.3).

### Changes in v1.0 (G4 hostile review run 3, approval, 2026-11-01)

Finding numbers are the review's (`docs/reviews/01d_v0.5_hostile_run3.md` §3). No run 4: the developer checked R1 and R2 against the review and approved (2026-11-01). MINORs not fixed here are build-time fixes BF-1–BF-8 (§12.6), done during the build and folded in as AD rows at the as-built review. The G1-9f annotation (m15) is in `docs/stories/01d-g1-decisions.md` in the same commit.

| # | Change | Finding | Sections |
|---|---|---|---|
| 1 | **A failed `prepare` counts, for any PIN.** The read-only part of `prepare` (the rules, the M39 session re-check and the kind's `apply`) runs in `preRead` **before** argon2, so a refusal decided by state verifies no PIN. When `prepare` still fails after argon2 (a real race), `checkPin` runs **one** write transaction whatever the PIN: one failure on the staff and the device counters (00 lockouts, as a mismatch), `RequestPinFailed { outcome: 'answer_failed', error_code }`, and, only when the PIN matched, the `pin_use_failed` raise to the PIN owner in the same transaction; the response is the `prepare` error. Same status, same counter delta, same number of transactions for both PINs; guessing is bounded by 00's lockouts again. `IdempotentReplay` is not a `prepare` failure. C-00 H-3: `onMatchRefused` (second transaction) → `onPrepareFailed(tx, error, matched)` in the counting transaction. The claim "nor the timing" is replaced by an honest bound (§3.3 rule 4 (d)). Tests 60 (b′)–(e′). | R1 | §3.3 rule 4, §3.10, §4.2, §4.5 H-3, §6.2, §10 tests 54, 60 |
| 2 | **In person only on the raising device; a silent receipt for every money answer; the answering session never sees or closes it.** `method: 'in_person'` with `device_id ≠ raised_device_id` → `403 PERMISSION_DENIED { reason: 'in_person_elsewhere' }` from `preRead` (G1-7d). Every answer of a `needs_pin: 'always'` kind, any method, raises the new personal kind **`approval_receipt`** (`silent: true`: no sound, no banner, inbox only; own routes only, never "for X"). `answered_on_requester_device` keeps its sound. The personal notices raised by an answer are **not shown to, and cannot be closed from,** the answering session or any session on the answering device in the same business day (`AlertSeen` is still recorded). 05's money section shows each personal notice's state and who saw it on which device (§4.3 To 05, carried row). Test 55 extended. | R2 | §3.3, §3.5, §3.10, §4.2, §4.3 To 05, §6.2, §6.4, §6.7, §6 batch 3, §8.1, §9, §10 test 55 |
| 3 | **Read-only `apply` contract, enforced and stated to every user:** inside `prepare` and `preRead`, `apply` / `onWithdraw` get a read-only transaction view (`append` / `onCommit` throw; a non-`readonly` statement throws); every returned draft's `payload.alert_id` equals the alert's (checked). To 02 / To 04 / To 05 state it; with `in_person` the effect events carry `actor_id` = the requester (00 §3.7), so 04 / 05 take the approver from `AnswerFacts.answerer_staff_id` / `RequestAnswered`, never from `actor_id`. Test 66. | m3 | §3.5, §4.2, §4.3 |
| 4 | **Shortcut contract for owning kinds:** the G1-9d shortcut applies to kinds with `right.mode = 'approval'`; it jumps to the kind's first `escalation: true` step and writes `StepSkipped 'shortcut'` for every earlier step; `APPROVAL_TIER_STEPS` is exported for 02 / 04 / 05. §6.1 (7) returns `AttemptSent(0)` or the shortcut drafts. | m4 | §3.5, §4.2, §6.1 |
| 5 | **`alerts.tickCtx(tx, now)`** gives a registered tick (03a's fires) the `ctx` that `raise` / `raiseMany` take. | m5 | §4.2, §4.3 To 03a, §10 test 50 |
| 6 | **C-00 H-4 adds `ws.connectedSessions()`** (memory, no statement), the read behind route 1, binding rule (a), the shortcut's route test and `alert_closed` to late approvers. | m7 | §3.4.3, §4.5 H-4 |
| 7 | **MINOR wording and contracts:** m11 test 43 counts 2 statements and includes an open request; m13 `raiseMany` / `closeMany` are required when the number of raises depends on data, a fixed small number of `raise` calls is allowed; m16 `pin` is `/^\d{4,6}$/` (01b §3 rule 4, 00 §6.8 / §6.9, code), outside it → `400` from payload Zod, nothing counted. | m11, m13, m16 | §4.2, §6.2, §10 test 43 |
| 8 | **Build-time fixes BF-1–BF-8** (m1, m2, m6, m8, m9, m10, m12, m14), each with the review's fix (§12.6). | m1, m2, m6, m8, m9, m10, m12, m14 | §12.6 |
| 9 | **Approved** (developer, 2026-11-01); §4.5 applied by version bump with "Changed by 01d v1.0" markers; H-11 (00 endpoint budget rule) decided at approval. | — | §1, §4.5, §12.1 |

### Changes in v0.5 (G4 hostile review run 2, 2026-11-01)

Finding numbers are the review's (`docs/reviews/01d_v0.4_hostile_run2.md` §3). Applied in the review's order (N1, N2 first). Rulings by the developer where the review left a choice, 2026-11-01. The G0 §12 preamble (m1) is fixed in `docs/stories/01d-g0-decisions.md` in the same commit.

| # | Change | Finding | Sections |
|---|---|---|---|
| 1 | **No PIN oracle after a match.** `preRead` also checks the decision against the kind's `answers` (`400`) and, for in person, that the named answerer is in the directory (`404 STAFF_NOT_FOUND`, m2). Inside `checkPin`'s transaction the whole PIN-independent body (`prepare`: the rules again, the M39 re-check, `apply` and the raises; read-only, it returns the drafts) runs **before** the match / mismatch branch. When it throws, the response is its error for any PIN, and nothing is counted, reset or recorded (no `attempts_remaining` side channel). When the PIN had matched, a second transaction raises `pin_use_failed` to the PIN owner. A mismatch after a successful `prepare` is counted and recorded as before. C-00 H-3: `precheck` → `prepare` + `onMatchRefused`; hook `betweenVerifyAndWriter` (m10). | N1, m2, m10 | §3.3 rule 4, §3.10, §4.5 H-3, §6.2, §10 tests 44, 54, 60 |
| 2 | **Notice when a request is answered on the device it was raised on**, whatever the method (`pin`, `session` or `in_person`): kind `in_person_answer` → **`answered_on_requester_device`**; `RequestAnswered.on_requester_device`; alert field `raised_device_id`. The two owner notices (`answered_on_requester_device`, `pin_use_failed`) are **personal**: only the person's own routes and inbox, never a "for X" copy, not expired at day close, closed only by that person's own `seen`; the next sign-in shows them (catch-up, inbox). Not adopted (ruling: own routes and inbox only): the review's copy to `managers` and the "answerer not on shift" flag. | N2 | §3.2, §3.3, §3.5, §3.10, §4.2, §4.3 To 05, §5.1, §6.7, §12.4, §10 test 55 |
| 3 | **Requests to answer are computed, not stored:** `requests-to-answer` and the staff `alerts` catch-up list every open request the caller may answer **now** (§3.3 rules 5–6 at query time), plus inbox rows; `MarkAlertsSeen` accepts those requests; `alert_closed` for a request also goes to connected staff sockets of people who may answer it. Index `alerts_open_requests`. | N3 | §3.3, §5.1, §5.2, §6.4, §6.9, §6 batch 3, §10 test 61 |
| 4 | **Approval tier:** step 0 = `answerers` (branch scope included, G1-9c); the `branch_scope` entry is removed from step 2 (and the target kind, now unused), which adds informed holders and the volume step-up only. **G1-9d shortcut** tests "any in-range approver has a route" (staff session, connected bound tablet, registered route), not "signed in"; when none has, the raise writes the escalation step at once (`StepSkipped 'shortcut'` for steps 0–1). Rule 5 and Q3 rewritten. | N4 | §3.3 rule 5, §3.4, §3.5, §4.2, §6.8, §12.3 Q3, §10 tests 1, 10, 19, 20 |
| 5 | **The "no route → lead" fallback (`for X`) applies only to action and info alerts** (kind field `lead_fallback`), never to requests or answer notices (`request_result`, `answered_on_requester_device`, `pin_use_failed`) or `no_approver`. A person with no route is written in the step with no route and keeps an inbox row; the presence filter also applies to permission-derived sets; a fallback that would reach the same person again stops. | N5 | §3.1 A10, §3.4.1, §3.4.3, §3.5, §3.10, §6.10, §10 tests 3, 62 |
| 6 | **Bound tablet stops being a route 2 h after its person's last session activity** (§3.4.3 (c), the review's rule): `staff_sessions.last_activity_at`, phone owner bindings exempt, index `staff_sessions_staff_activity` (C-00 H-14), tick ≤ 1 + 8 + R + T, raise ≤ 6 + R + T. Tablet header: "Alerts: <name> — pauses at HH:MM", then "Alerts paused"; a sign-in refreshes it. | N6 | §3.4.3, §3.5, §3.7, §4.5 H-14, §5.1, §6.1, §8.1, §10 tests 35, 57 |
| 7 | **05 data:** events written by a kind's `apply` / `onWithdraw` carry `alert_id` (contract); `RequestAnswered.on_requester_device`; `RequestPinFailed` is read by 05's live view (failed PIN attempts on requests). | m4, N2 | §3.5, §4.2, §4.3 |
| 8 | **Many raises or closes in one transaction:** the fixed reads are cached per transaction; new exports `alerts.raiseMany` / `alerts.closeMany` batch resolvers and routes. | m5 | §3.5, §4.2, §4.3, §6.1, §6.11, §10 test 35 |
| 9 | **MINORs:** m3 `recordReceipt` takes `step`; m6 one notification on a signed-in tablet, the tablet page never opens alert mode; m7 `alerts_open` applies the binding rule; m8 a kiosk binds no person and H-5 is tablet-only; m9 `table_team` `depth: 'owner'`; m11 H-11 exact text and C-README R-9; m12 `alert-receipts` reads recipients from `alert_recipients` and step events from the alert's `raised_seq`. | m3, m6–m9, m11, m12 | §3.4, §3.7, §4.2, §4.5, §5.1, §6.10, §8.1, §8.2, §10 tests 23, 46, 63–65 |

### Changes in v0.4 (G4 hostile review run 1, 2026-11-01)

Finding numbers are the review's (`docs/reviews/01d_v0.3_hostile_run1.md` §2). Applied in the review's order (§4.2 contracts first). Rulings by the developer where the review left a choice, 2026-11-01. Not applied here: the G0 §12 preamble marker of M11 (`01d-g0-decisions.md`, fixed by the developer outside this spec).

| # | Change | Finding | Sections |
|---|---|---|---|
| 1 | **Approver context (`details`).** `defineAlertKind` gains `details_schema`; `raise` takes owner-supplied `details` (`item`, `quantity`, `amount`, `reason`), validated by it. Shown only in the signed-in `card` on the person recipient's own staff-session sockets; never in `lock` text, alert-mode frames, device-target frames or logs. | M5 | §3.5, §3.7, §3.12, §4.2, §5.1, §5.4, §6 batch 3, §7, §10 test 49 |
| 2 | **Step targets from the alert:** `point` (`from_value`), `requester_lead`, `table_team` (`from_value`) are step targets; `point` and `table_team` still go through registered resolvers (stubbed until 01a / 02). `zone_order_taker` added to the §3.4 table. | M6 | §3.4, §3.5, §4.4, §10 test 50 |
| 3 | **Typed request contract:** `apply(ctx & { alert }, answer)` and `onWithdraw(ctx & { alert })`; `AlertRecord` (kind, subject, `values` typed by the kind's new `values_schema`, `details`, requester, receiver). | M7 | §3.5, §4.2 |
| 4 | **01d does not auto-close unanswerable requests.** New export `alerts.listOpen(db, { kind?, subject? })` (1 statement) so owning modules (e.g. 05 at day close) find open requests and close them `obsolete`. Requests survive day close (no expiry). | M8 | §3.3, §4.2, §4.3 To 05, §6.11, §12.3 Q8, §10 test 51 |
| 5 | **`closes_on.after_ms` fires:** `next_due_at = min(next undue step, raised_at + after_ms)`; the tick tells expiry from a step. | M1 | §3.2, §3.5, §5.2, §10 test 52 |
| 6 | **Escalation widens:** approval step 2 = answerers + branch scope + informed holders + always-on. Recipients are **cumulative**: `alert_recipients` keeps every step's rows; `alert_closed`, `alerts_open`, catch-up, the receipt "was sent" check and `requests-to-answer` use all steps (plus `alert_inbox`). | M2, m3 | §3.5, §3.7, §5.1, §5.2, §6.9, §6 batch 3, §10 tests 19, 53 |
| 7 | **Statement bounds restated honestly:** the tick's reads are fixed per tick; the projection's reads are fixed per event (≤ 2), not per open alert. Test 35 asserts both separately. | M10 | §3.5, §5.2, §10 test 35 |
| 8 | **In-person cheating — detect.** Checks run in the order alert exists and pending → PIN rule, self, right and range → PIN, on a read-only pre-read before argon2, re-checked inside the transaction; a correct PIN on a missing or closed alert is never confirmable (response independent of the PIN, also in the race window, via `checkPin`'s new `precheck`); every PIN failure counts toward 00's lockouts and is recorded (`RequestPinFailed`). Every `in_person` answer raises an `in_person_answer` info alert to the answerer on all their routes; in-person answers appear in the manager's live view money section with method `in_person` (§4.3). | M3 | §3.3, §3.10, §4.2, §4.3, §4.5 H-3, §6.2, §10 tests 12, 54, 55 |
| 9 | **PIN never stored:** never in `payload_hash`, `processed_commands`, events, logs or the device command queue. `payload_hash` covers the payload with the PIN field removed (C-00 H-9). PIN-bearing commands are online-only, never queued (§8.1, C-00 H-10). | M4 | §3.3, §6.2, §7, §8.1, §4.5 H-9, H-10, §10 test 56 |
| 10 | **Stale binding:** a binding is a route only while the device is connected now (alert mode or a session socket) **and** the person is not marked absent today. Receipts name the device and its bound person. | M9 | §3.4.3, §3.7, §6.10, §10 test 57 |
| 11 | **Missing §4.5 rows:** F-9 (foundation §5.8 step 3), R-8 (README R6 40k → 75k), H-11 (00 §6.33 count), H-12 (00 §5.1 `app_releases`), H-13 (00 §6.17 last seen with alert-mode pongs), H-9 (`payload_hash`). | M11 | §4.5 |
| 12 | **MINORs:** m1 no double close in one pass; m2 phone rows untouched by sessions; m3 (with #6); m4 one alert-mode socket per device (`4409`); m5 `step` in the delivered key; m6 client re-notifies on reconnect; m7 `approver_role_ids` from the raise input; m8 dedupe namespace `(kind, dedupe_key)`; m9 timed test on the mini PC; m10 test 23 restart clause; m11 `testHooks.betweenDueAndRun`; m12 cloud volume; m13 presence kept (used by #10), kiosk / phone alert-mode rule; m14 `MarkAlertsSeen` cost stated; m15 `urgent` needs a request part. | m1–m15 | §3.4–§3.12, §4.2, §5.1, §5.3, §6, §7, §8, §10 |

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
- "No one can approve" warning per permission (§3.9), the `test_alert`, `answered_on_requester_device`, `approval_receipt` and `pin_use_failed` kinds (§3.10), "Present today" (§3.11; G1-20 kept, owner answer 2026-11-01; also used by the binding route rule, §3.4.3).
- Inbox and request queries (§6 batch 2), alert frames (§6 batch 3).
- Android tablet app: background service, lock-screen text, hub-hosted silent update with the pilot-minimum endpoints (§8, §4.5 H-5).

> As built (AD-1, ruled): the client part is split. **9a** (built in 01d): a hub-served `staff` entry in `apps/client` (`/staff/`, ui-kit only, no new dependency, shipped by `ship-client.sh`) with only 01d's screens — inbox, requests to answer, answer sheet (PIN, in person), sounds per family, the tablet header, the WS client (session sockets and alert mode), the manager's `test_alert` sender with its receipts view; it runs in the browser on kiosk, tablet and phone. **9b** (`docs/plans/01d-tablet-plan.md`, not built): the Capacitor shell, the native background service, lock-task / device-owner provisioning and the silent update client (§8.2, §8.4, H-5 client side, test #63); blocked on the tablet model (OQ2), **required before the pilot**. 01d merges after 9a. The requester's waiting card (§8.1) is built by 02 / 04 with their first request kind.

### Out of scope

- **01e Device gateway (pilot, mandatory, own spec after the hardware spike):** compact device protocol, `pager_bridge`, headless pairing, ESP32 station button devices, the pager route itself, pager assignment by shift, device health (G0 D3–D5, G1–G7, G1-17a). 01d only defines the route interface (§3.8).
- Kitchen and serving model, zones, zone stock, comps, lanes (G0 §4, §5, §5a): owned by 01a, 01b, 02, 03a, 03b, 05. Those modules register their kinds and resolvers here (§4.2).
- The request kinds of other modules (void 04, discount 05, comp 02/05, table handover 02, zone-stock transfer 01a/02, Ready to serve 03a/03b, slip warning 03a): each module registers its own kind and handler. 01d ships `test_alert`, `request_result`, `no_approver`, `answered_on_requester_device`, `approval_receipt` and `pin_use_failed` only (§3.10).
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
| A10 | **Routes are derived per person, not set.** A person with no route has their **action and info** alerts shown on their lead's devices; requests and answer notices stay with the person (inbox, next sign-in; v0.5 #5, N5). | A route setting that disagrees with what the person actually carries today. | G1-18 |
| A11 | **Receipts: first delivered per person per device per step, first seen per person per device per alert, batched (≤ 1 s or 100), lossy on crash** (v0.4 #12, m5). | One fsync per receipt under `synchronous=FULL`. | G1-8b, c |
| A12 | **Raise is idempotent by `dedupe_key`** while an alert with that key is open. | Two Ready-to-serve alerts for one order and point from a double tap or retry. | G1-21.4 |
| A13 | **Raise-side permission belongs to the owning module**; 01d checks only the answer side. | Two modules disagreeing on who may ask. | G1-21.8 |
| A14 | **Pilot values are constants** in one module, `ALERT_CONSTANTS` (`packages/domain/src/alert-constants.ts`): approval timings (`approval_repeat_ms` 45 000, `approval_branch_ms` 120 000), the bound-tablet route window (`binding_route_idle_ms` 7 200 000, §3.4.3 (c), v0.5 #6) and the PIN-per-kind map (money kinds `always`, accept kinds `never`). Kinds of later modules add their constants there (handover 60 s / 2 min, zone transfer 60 s, Ready to serve attempts 2). Making them branch settings waits until an owner asks (R18; §12.4). | Scattered magic numbers; a settings pipeline (cloud column, snapshot field, CLI) nobody asked for yet. | G0-1, G1-10, v0.2 #3 |

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

Fields (projection `alerts`, §5.2): `alert_id` (ULID), `kind`, `family` (`urgent` | `action` | `info`), `subject_stream_type`, `subject_stream_id`, `dedupe_key`, `requester_staff_id` (null for system alerts), `raised_device_id` (the `AlertRaised` envelope `device_id`; `'hub'` for tick-raised alerts; v0.5 #2, N2), `hidden_from` (`{ session_id, device_id }` of the answering session for the personal notices an answer raises, else null; the device part is cleared at the next `BusinessDayClosed`; §3.10, v1.0 #2, R2), `target` (§3.4, as raised), `values` (kind-specific JSON validated by the kind's `values_schema`, e.g. `{ "window_ms": 20000, "point_id": "…" }`), `display` (lock-safe label params, §3.12), `details` (signed-in-only approver context, validated by the kind's `details_schema`, §3.12; null when the kind has none), `request` (null, or `{ answers, right, needs_pin, approver_role_ids, receiver_staff_id }`), `step` (last step sent, −1 before the first), `next_due_at` (the earlier of the next undue step's time and `raised_at + closes_on.after_ms`; null when neither is pending; v0.4 #5, M1), `state`, `close_reason`, `closed_by_staff_id`, `raised_at`, `closed_at`.

> As built (AD-123, ruled): `next_due_at` is also null when the next step's time or targets cannot be computed (a "stuck" alert, §3.5); when the kind has `after_ms`, the expiry time is kept instead, so the alert still expires.

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
2. **Who answers:** `method = 'session'` (the signed-in person, no PIN), `'pin'` (the signed-in person with their PIN), or `'in_person'` (another person, named by `answerer_staff_id`, with **their** PIN, **only on the device the request was raised on**: `device_id` ≠ the alert's `raised_device_id` → `403 PERMISSION_DENIED { reason: 'in_person_elsewhere' }`; G1-7d "sent from the requester's device"; v1.0 #2, R2). A request raised by a tick (`raised_device_id = 'hub'`) has no in-person answer. *⚠️ Changed by 03a v1.0 (N-1): was "no pilot request kind is tick-raised".* 03a's `slip_warning` is tick-raised (`named`, `needs_pin: 'never'`): no in-person answer, no requester, no withdraw, no `request_result` (AD-72); 03a closes it. `station_overload` is a plain `info` kind; its table dedupe key works under `(kind, dedupe_key)` as written. No rule change. In person always needs a PIN (G1-10c).
3. **PIN needed:** money kinds (`needs_pin: 'always'`) → method must be `pin` or `in_person`, else `422 REQUEST_PIN_REQUIRED`. Accept kinds (`needs_pin: 'never'` in the pilot, from `ALERT_CONSTANTS`) accept `session`. In person always takes a PIN (rule 2). The money rule is fixed in the spec; a branch setting to add a PIN to accept kinds is post-pilot (G1-10e, §12.4). No PIN-free window after a PIN answer (G1-10f).
4. **PIN check, and the order of checks (v0.4 #8, M3; v0.5 #1, N1; v1.0 #1, R1).** The PIN check reuses 00 §3.5 (device and staff lockout, argon2 semaphore, counted failures) for the answerer, through the built `checkPin(…, onMatch)` with `onMatch` = the pipeline's transaction body (§4.5 C-00 H-3, `pinCheck` hook): `401 PIN_INVALID`, `429 PIN_LOCKED_OUT`, `429 DEVICE_LOCKED_OUT`, `404 STAFF_NOT_FOUND` (unknown `answerer_staff_id`, not counted; returned by the pre-read, m2), `503 SERVICE_UNAVAILABLE` (argon2 semaphore wait > 2 s). **Order:**
   - (a) The idempotency fast path (a retry of an answered request replays the stored `200` without argon2).
     > As built (AD-24, proposed): for a `pinCheck` command with a stored row, the fast path peeks the session (no ended / idle check) and parses the payload without throwing, then calls `pinCheck` to get the PIN field and compares the hash without it. If the peek or the parse fails, the full path gives the error. So a replay with no valid token for the device gets `401`, not the stored `200` (never a `200` the full path would refuse). PIN commands share the `/auth/pin` argon2 semaphore (AD-27, proposed).
   - (b) A **read-only pre-read** (`preRead`, 1 statement on `alerts`, directory and session state in memory), outside the lock and **before** argon2, runs in this order: rule 1 — the alert exists, has a request part and is pending (`404` / `409`); the decision is in the kind's `answers` (`400 VALIDATION_FAILED`, v0.5 #1); rule 3 — the PIN rule (`422`); for `in_person`, the named answerer is in the hub directory with a PIN (`404 STAFF_NOT_FOUND`, v0.5 m2) and the command comes from the raising device (`403 in_person_elsewhere`, rule 2, v1.0 #2); rule 5 — not self (`403 self`); rule 6 — right and range (`403 not_approver` / `out_of_range` / `not_receiver`); then **the read-only part of `prepare` (v1.0 #1, R1):** the M39 session re-check (00 §3.7) and the kind's `apply({ ...ctx, alert }, answer)` on a read-only view of `db` (§3.5 "Read-only contract"; its drafts are discarded). Any failure returns at once and **no PIN is verified**, so the response is the same whatever PIN was sent, with the same (argon2-free) timing, and nothing is counted (no PIN was checked). A refusal decided by state — a void on an order billed meanwhile, whose `apply` refuses every answer — is therefore answered here and is never an endpoint for PIN guesses (R1 path (c)).
     > As built (AD-89, proposed): `preRead` adds the M39 reads (`devices`, `staff_sessions`) only when the auth generation moved since the session check; `prepare` repeats the check authoritatively. A non-`DomainError` from `apply` is a `500` with nothing written (AD-93, proposed).
   - (c) Only then the PIN (argon2, in `checkPin`).
   - (d) **Everything that does not need the PIN runs before the PIN branch, and a failure there is counted (v0.5 #1, N1; v1.0 #1, R1).** Inside `checkPin`'s transaction, after the lock checks and **before** the match / mismatch branch, `prepare(tx)` (C-00 H-3) runs the whole PIN-independent body again, **authoritatively** (§6.2, because the request can change while argon2 runs): the idempotency and M39 re-checks, the checks of (b), and the handler up to its drafts (`RequestAnswered`, `kind.apply`, the `request_result`, `approval_receipt` and notice raises). It writes nothing and returns the drafts. Then exactly one of three outcomes, each **one** write transaction:
     - **`prepare` succeeds, PIN matches:** the staff counter is reset and the drafts are appended (`onMatch`); `200`.
     - **`prepare` succeeds, PIN mismatches:** one failure is counted on the staff and the device counters (00 §3.5, as today) and `RequestPinFailed { outcome: 'pin_invalid', error_code: 'PIN_INVALID' }` is appended (`onMismatch`); `401 PIN_INVALID`.
     - **`prepare` throws** (a real race: the request was answered, withdrawn or closed while argon2 ran, the right was removed, the requester's session ended, `apply` refuses on state changed meanwhile): **whatever the PIN**, `onPrepareFailed(tx, error, matched)` counts **one** failure on the staff and the device counters exactly as a mismatch (including `StaffPinLockedOut` / `DevicePinLockedOut` at the threshold) and appends `RequestPinFailed { outcome: 'answer_failed', error_code: <the prepare error's code> }`; **only when the PIN matched**, the same transaction also raises `pin_use_failed` to the PIN owner (§3.10), so a correct PIN never goes unseen by its owner. The response is the `prepare` error. Exception: `IdempotentReplay` (a retry of a command already answered) is not a `prepare` failure: the stored response is returned and nothing is counted (the replayed `200` does not depend on the PIN, H-9).
       > As built (BF-1): for `method: 'pin'`, a `409 REQUEST_NOT_PENDING` from `prepare` raises **no** `pin_use_failed` (the failure is still counted and recorded); `pin_use_failed` stays for `in_person`, and for `pin` with any other error.
       > As built (AD-99, proposed): the `pin_use_failed` raise is wrapped in try/catch and logged `{ err: { name, code }, alert_id, command, phase }`; the count and `RequestPinFailed` stay, only the notice is lost. A throwing raise must not roll back the counting transaction, since that would undo the count for a matched PIN only (a bypass and an oracle).
       > As built (AD-100, proposed): when `pinFailed` finds no alert row (retention deleted it mid-race), no `RequestPinFailed` and no `pin_use_failed` are written; the count still lands. Unreachable in practice; it departs from "a correct PIN never goes unseen".
       > As built (final review m-3, not ruled): a throw from `pinFailed` or from the `tx.append` of the hook drafts rolls back the count for **both** PINs. It is symmetric (no oracle) but is a skipped count on a bug path; see "Unresolved" in the draft notes.
     - **What a guesser learns:** for both PINs the same status, the same counter delta and one write transaction; `RequestPinFailed` does not say whether the PIN matched. **No path skips the count:** a PIN is verified only after `preRead` passed, and every verified PIN ends in an answer (recorded, with the approver's receipt or notice, rule 7) or in a counted failure. **Timing, stated honestly:** a match on the `prepare`-failed path does a few more reads in that transaction (the `pin_use_failed` raise, ≤ 6 + R + T statements, no extra fsync); since every such attempt is counted, guessing through it is bounded by 00's lockouts (5 failures per person, 10 per device per 5 min), so the difference cannot be measured over many tries. An honest approver who loses a race pays one counted failure, which their next correct PIN resets.
     - > As built (BF-2; log key AD-20, proposed): if `onPrepareFailed` throws, the error is logged `{ err, phase: 'onPrepareFailed' }` and the **original `prepare` error** is returned, never a `500` that differs by PIN; a failure inside `onMatch` resets the counter in its own try/catch and returns the original error.
   - **A PIN failure is counted and recorded** (both outcomes above): toward 00's staff lockout (the answerer: 5 failures → `StaffPinLockedOut`) and device lockout (this device; for in person, the requester's device), with `RequestPinFailed` (payload §4.2; never the PIN, never whether it matched) on `audit` / alert_id. 05's live view reads it: failed PIN attempts on requests (§4.3 To 05, v0.5 #7, m4).
   - **The PIN is never stored** (v0.4 #9, M4): not in `processed_commands.payload_hash` (hashed with the PIN field removed, C-00 H-9), not in `processed_commands.response_json`, not in any event payload, not in logs (00 §7.2 redacts `pin`), and not in the device command queue (PIN-bearing commands are online-only, §8.1, C-00 H-10). It lives in hub memory only until `checkPin` returns.
5. **Not self, for everyone** (Q3; confirmed by the developer as the owner's proxy, 2026-11-01): the answerer is not the requester → else `403 PERMISSION_DENIED { reason: 'self' }`. The requester is also left out of every answerer set (§3.4). If `answerers` minus the requester is empty, step 0 has no answerers; the G1-9d shortcut (§3.5) then writes the escalation step at once, the request stays pending, and the requester's card says "ask in person" at once (§6.8) (v0.5 #4, N4). A per-request "no one can answer" warning is deferred (§12.4); the per-permission warning (§3.9) still shows while no branch-scope approver is signed in.
6. **Right and range, at answer time** (G1-23), by the kind's `right`:
   - `{ mode: 'approval', base_permission, range_permission? }`. The answerer holds a role in `resolve(requester, base_permission).approver_role_ids` **read now** (empty — the requester's grant is no longer `requires_approval`, or the requester left the directory — → `403 PERMISSION_DENIED { reason: 'not_approver' }`). 01d never closes such a request itself; the owning module finds it with `alerts.listOpen` and closes it `obsolete` (Q8, v0.4 #4, M8). If `range_permission` is set (voids: `approve-void`), the answerer's `resolve(answerer, range_permission)` must be `allowed` (else `403 { reason: 'not_approver' }`) and its scope must cover the request: `branch` covers all; `my_team` covers a requester **anywhere below the answerer in the team tree** (walk `teamOf` down, depth ≤ active staff at the branch; 01b §3.5 leaves the walk to 01d). Not covered → `403 { reason: 'out_of_range' }`. Without `range_permission` (discount, comp in the pilot): branch-wide.
   - `{ mode: 'named' }`: the answerer is the `receiver_staff_id` given at raise (handover receiver, sibling zone's order taker), else `403 { reason: 'not_receiver' }`.
   - The answerer must be in the hub directory with a PIN (people in `no_pin_staff` can never answer).
   - > As built (AD-52, AD-53, proposed): an answerer not in the directory or with no PIN is refused `not_approver` (approval) or `not_receiver` (named); a range scope other than `branch` / `my_team` does not cover (fails closed, `out_of_range`).
7. In the same transaction: append `RequestAnswered`; call `kind.apply({ ...ctx, alert }, answer)` (§3.5, typed) and append its events; append the `request_result` alert to the requester (§3.10); for a **money kind** (`needs_pin: 'always'`), **any method**, raise `approval_receipt` to the answerer (§3.10, silent, v1.0 #2, R2); when the answer comes from the device the request was raised on (`device_id` = the alert's `raised_device_id`, **any method**; every `in_person` answer, rule 2), set `RequestAnswered.on_requester_device = true` and raise `answered_on_requester_device` to the answerer (§3.10, v0.5 #2, N2); the receipt and the notice carry `hidden_from = { session_id, device_id }` of the answering session (§3.10); post-commit: `alert_closed` frames to every recipient of **every** step (cumulative, §6 batch 3).
   > As built (AD-103, proposed): the three raises go through one `raiseMany` (7 statements, within the bound of 9; three single raises would cost 11).

**Cheating with a known PIN is detected, not prevented (v0.4 #8, M3; v0.5 #2, N2; v1.0 #2, R2).** PINs get shared, so a waiter who knows a manager's PIN can name the manager and answer in person, or sign in **as** the manager (on the waiter's tablet, a spare tablet or the kiosk) and answer with `method: 'pin'`; rule 5 blocks only naming yourself. The controls:
1. **In person only on the raising device** (rule 2): every in-person answer is an answer on the requester's device, and is notified as one.
2. **A silent receipt for every money answer** (`approval_receipt`, §3.10): every answer of a `needs_pin: 'always'` kind, any method, on any device, puts "You approved the void on T12 · Rs 4 800 · Tablet 5 · 9:03 PM" in the approver's own inbox (no sound, no banner; the approver's own record). So a sign-in as the manager on another device is no longer an ordinary, unrecorded approval.
3. **An audible notice for an answer on the requester's device** (`answered_on_requester_device`, any method): "You approved the void on T12 at Hamza's tablet" (`card`) / "You approved a request at another tablet" (`lock`); `RequestAnswered.on_requester_device = true`.
4. **A correct PIN whose answer then failed** raises `pin_use_failed` to its owner (rule 4 (d)).
5. **Personal, and hidden from the answerer's seat:** the three are personal notices (§3.10): only the person's own routes and inbox, never a "for X" copy, not expired at day close, closed only by that person's own `seen` while signed in. The receipt and the notice are **never shown to, and cannot be closed from, the session that gave the answer, nor any session on the answering device until the business day closes** (`hidden_from`, §3.10); a `seen` from there is recorded (`AlertSeen`) but closes nothing. So a cheater signed in as the manager on the raising tablet or the kiosk neither sees the card nor dismisses it, and a manager who is off today sees it at the next sign-in elsewhere.
6. **A third party sees it:** 05's live view money section flags answers made on the requester's device, lists failed PIN attempts on requests, and shows each personal notice with its state and **who saw it on which device and when** ("seen by Imran on Tablet 3 at 9:12 AM", §4.3 To 05). A dismissal by someone holding the PIN therefore shows to whoever reviews the day, even when the PIN owner is the person being impersonated.
7. Wrong guesses, and answers that fail after a verified PIN, are counted and recorded (rule 4).

**Residual, accepted:** a person who holds the PIN can still sign in as its owner on a third device and close the receipt there; 05's view then shows it seen on that device minutes after the answer, which the day's reviewer can question.

**Withdraw (`WithdrawRequest`):** only the requester (`403 { reason: 'not_requester' }`), only while pending (`409 REQUEST_NOT_PENDING`). The kind's optional `onWithdraw({ ...ctx, alert })` runs in the transaction (04's void effect). Every recipient of every step gets `alert_closed`.

**Close by the owning module (`alerts.close`):** reasons `done`, `obsolete` (with `note`), `overridden`, `undone`. A request closed `obsolete` or `overridden` also gets a `request_result` alert to the requester (G1-21.2). Closing a closed alert is a no-op returning no events (the owner may race an answer: whichever commits first wins; the second sees the alert closed).

> As built (AD-73, proposed): `close` of an unknown alert id also returns `[]`; a second close of one alert in the same transaction is blocked by a per-transaction set.

**No expiry for requests** (G0-1, Q-N2). Requests survive day close. The in-person fallback is the same command (rule 2), so a request never depends on delivery.

**Requests no one can answer (v0.4 #4, M8).** 01d does **not** auto-close a request whose requester left the directory, whose grant stopped needing approval, or that was raised before the current business day. The owning module decides: it lists them with `alerts.listOpen(db, { kind?, subject? })` (§4.2, 1 statement) and closes them with `alerts.close(…, 'obsolete', note)` — e.g. 05 at day close lists open void / discount / comp requests before the Z report (§4.3 To 05).

### 3.4 Targets

A target is resolved **at each step**, never frozen at raise (G1-11a). Resolution returns **recipients**: people (`staff_id`) and devices (`device_id`), each tagged `answerer`, `informed` or `recipient` (non-request alerts), and, for people with no route, `for_staff_id` on their lead's devices (§3.4.3).

| Target kind | Shape | Resolves to | Available |
|---|---|---|---|
| `person` | `{ kind: 'person', staff_id }` | that person | now |
| `permission` | `{ kind: 'permission', permission, range_of? }` | every directory person whose `resolve(permission)` is `allowed`, filtered by scope against `range_of` (a staff id) like §3.3 rule 6 | now |
| `team` | `{ kind: 'team', lead_staff_id, depth: 'direct' \| 'all' }` | the lead's reports (`teamOf`, plus `no_pin_staff` by `lead_staff_id`, G1-17), direct or the whole subtree | now |
| `answerers` | `{ kind: 'answerers' }` (requests only) | people who pass §3.3 rules 5–6 **now** (in range, requester excluded). Branch-scope holders are in range for every request (G1-9c), so they are always in it; v0.5 #4 (N4) removed the separate `branch_scope` target, which added nobody | now |
| `holders_informed` | `{ kind: 'holders_informed' }` (requests only) | people holding the right but out of range (read-only, G1-9b) | now |
| `managers` | `{ kind: 'managers' }` | branch-scope holders of `force-release-table-lock` (G1-11d; Q1 answered) | now |
| `requester_lead` | `{ kind: 'requester_lead' }` (step target, v0.4 #2) | `leadOf(alert.requester_staff_id)`; none (no requester, or no lead) → empty, and the step's other entries still go | now |
| `always_on` | `{ kind: 'always_on' }` | devices of type `cashier_kiosk` and `kds`, plus point-bound tablets | kiosk, KDS now; point tablets **stubbed until 01a points** |
| `point` | `{ kind: 'point', point_id }` | tablets bound to the point (G1-12) | **stubbed until 01a points + 00 `point_id`** |
| `table_team` | `{ kind: 'table_team', table_id, depth?: 'owner' \| 'direct' }` | 02a's `tableTeam` resolver gives the **whole** set: `depth: 'owner'` → the seating's holder; `depth: 'direct'` (default) → the assigned order taker's direct reports with a live session (else the holder's, else none) **plus the holder** (02a §3.5). ⚠️ Changed by 02a v1.0 (D-1): was "`tableOwner(table_id)`, plus direct reports when `depth = 'direct'` …" |
| `zone_order_taker` | `{ kind: 'zone_order_taker', table_id }` | the order taker assigned to the table's zone (§3.4.2 fallback; also a step or raised target) | **stubbed until 01a zones + 01b zone assignment + 02 `zoneOf`** |
| `device` | `{ kind: 'device', device_id }` | that device | now (used by `test_alert`) |

> ⚠️ Changed by 02a v1.0 (D-1): was "As built (AD-51, proposed): the registered `table_team` resolver returns the **owner only**; 01d adds the direct reports itself." Now: for `table_team` the resolver's `staff_ids` are the full recipient set for both depths (01d adds no reports; the presence filter still applies); a missing depth is normalised to `direct`; results are keyed by `targetKey(target)` including the depth (`table_team:<table_id>:<depth>`); the absent-owner marker and the zone-order-taker fallback use the resolver's `owner_staff_id` (§4.2).

**Targets built from the alert (step targets, v0.4 #2, M6).** A step entry may name a target whose id comes from the alert's `values` (typed by the kind's `values_schema`, §3.5): `{ kind: 'point', from_value: 'point_id' }`, `{ kind: 'table_team', from_value: 'table_id', depth? }`, `{ kind: 'zone_order_taker', from_value: 'table_id' }`; or `requester_lead`, built from the alert's requester. So 03a's Ready to serve can say "last attempt → point `values.point_id` + `managers`" and 02's handover "2 min → sender's lead" with no 01d bump. `from_value` naming a key the kind's `values_schema` does not declare → startup error. `point`, `table_team` and `zone_order_taker` built this way still resolve through their registered resolvers (stubbed until 01a / 02).

Resolvers for `table_team`, `zone_order_taker` and `point` are registered by later modules (§4.2 `registerTargetResolver`) and are **batch-shaped**: one call per tick (or per raise) with every target of that kind, one SQL statement per call (§3.5 "Reads per tick"). Raising with an unregistered target kind throws `DomainError('VALIDATION_FAILED', { issue: 'target_unavailable', target_kind })` from `raise`, which the calling command surfaces (only the module that registers the resolver raises such targets, so this is a build-time error in practice).

#### 3.4.1 Presence filter (G1-20)

When a "Present today" list exists for the open business day (§3.11), team and table-team resolution skip people marked absent, and so do the permission-derived sets `answerers`, `holders_informed`, `managers` and `permission` (v0.5 #5, N5: they come from the directory, not from who is working). **Safety rule:** if no one has been ticked today, everyone counts as present; a person signed in anywhere counts as present. Person targets (`person`) are never filtered.

> As built (BF-8): **absent** = a `presence_today` row with `present = 0`, nothing else; a person not ticked is present.
> As built (AD-54, proposed): the filter applies only to `team`, `table_team`, `answerers`, `holders_informed`, `managers` and `permission`. `requester_lead`, `zone_order_taker`, `point` and `person` are never filtered, so the zone order taker, itself a fallback, can be someone absent.

#### 3.4.2 Fallbacks (table's team, G1-11d)

Owner has no reports → owner only. Owner not signed in anywhere and has no route (§3.4.3) → the zone's assigned order taker (**stubbed until 01a zones + 01b zone assignment + 02 `zoneOf`**); none → `managers`.

> As built (AD-62, AD-63, AD-64, proposed): this fallback runs only for kinds with `lead_fallback: true`. For a table owner with no route the order is lead → zone order taker → managers (§3.4.3, read literally). An owner filtered out as **absent** (§3.4.1) comes out of resolution as a marker (an all-null recipient carrying the `table_team` target), never a recipient: answer sets, rows and `AttemptSent` use only the routed output. For an absent owner the lead is also tried first, and the owner's own registered routes are not asked.

#### 3.4.3 Routes of a person (G1-18)

For each person recipient the hub collects, at send time:

1. **Screen:** every staff-session WS socket of that person, read from 00's in-memory socket list through `ws.connectedSessions()` (C-00 H-4, v1.0 #6, m7; no statement). The same export serves binding rule (a) below, the G1-9d shortcut's route test (§3.5) and `alert_closed` to people who may answer a request (§6 batch 3).
2. **Alert connection:** every **tablet or phone** whose **binding** is that person (§3.7; a kiosk binds no one, v0.5 m8), **only while** (a) the device is connected now (an alert-mode socket or a session socket of that device in the hub's in-memory socket lists, read at send time, no statement) **and** (b) the person is not marked absent in today's presence list (§3.11; the presence safety rule of §3.4.1 applies: nobody ticked → everyone present) **and**, for a tablet, (c) the person was active recently (below). A binding that fails (a), (b) or (c) is not a route (v0.4 #10, M9; v0.5 #6, N6): a bound tablet that is switched off or out of Wi-Fi, a person marked absent, or a tablet left on the shelf for more than 2 h no longer swallows the person's alerts, so the no-route rule below applies.
   - **(c) Recent activity (tablets only, v0.5 #6, N6).** A **tablet** binding is a route only if, in addition to (a) and (b), the bound person's **last session activity** at this branch is within `ALERT_CONSTANTS.binding_route_idle_ms` = 7 200 000 (2 h) of `now`. Last session activity = the greatest `last_activity_at` over that person's `kind = 'staff'` sessions in `staff_sessions`, active or ended; for an active session the in-memory activity value is used when it is newer. Phone owner bindings are exempt (rule (a) covers them: a phone has alert mode only while its page is open). Read: one statement per tick and per raise (§3.5 read 9), `SELECT staff_id, MAX(last_activity_at) FROM staff_sessions WHERE branch_id = ? AND kind = 'staff' AND staff_id IN (<bound staff>) GROUP BY staff_id`, served by the index `staff_sessions_staff_activity (staff_id, last_activity_at)` (migration `0006`, C-00 H-14). The tablet shows the deadline in its header (§3.7).
   - **Residual case, accepted:** a bound tablet left connected on the shelf by a present person stays a route for at most 2 h after that person's last activity; the receipt view then shows "delivered to device <name>, bound to Ali (not signed in)" (§6.10), and requests still escalate (§3.5).
3. **Registered routes** (§3.8): e.g. 01e's pager route, if it reports a route for the person. Asked **once per registered route per tick (or raise)** with every person recipient of that tick: `routesFor(tx, staffIds[])` (§3.8).

A person with **none** of these (v0.5 #5, N5):
- **Action and info alerts** (kinds with `lead_fallback: true`, §3.5): the alert goes to their **lead's** routes, tagged `for_staff_id` ("for Ali"), grouped per person on the lead's screen (G1-18a). Lead has none → the table-team fallback (§3.4.2) or `managers`. A fallback that would reach the same person again, or a person already in this step, stops there (no loop, no second copy).
  > As built (AD-61, proposed): each fallback level keeps only people with a route; a level that would reach the subject, or anyone already in the step, stops the whole chain.
- **Requests and answer notices** (request kinds, `request_result`, `answered_on_requester_device`, `pin_use_failed`; also `no_approver`; all `lead_fallback: false`): **no fallback.** The person is written in the step's recipients with **no route** (the receipt view shows "Owner: no route", §6.10) and keeps their `alert_inbox` row, so they see it at their next sign-in (catch-up, inbox; for requests also `requests-to-answer`, §6.9). So an off-duty owner or a manager on leave never puts "for Owner" urgent cards on the duty manager's tablet.

Every person in a step's recipients has an `alert_inbox` row, with or without a route. A person bound to several devices gets the alert on all of them (G1-13d).

**"For" rows (G2 #18):** the recipient row is the **lead**: `{ staff_id: <lead>, for_staff_id: <Ali>, set }`. The `alert_inbox` row is the lead's; the lead's `MarkAlertsSeen` is accepted for it, and the lead's seen counts for the "for Ali" card (it stops the urgent repeat on the lead's devices, §8.3). Ali has no inbox row for it until a later step reaches Ali directly.

> As built (AD-106, proposed): in a "for" step the only row is the lead's `{ staff_id: lead, for_staff_id: Ali }`. When the fallback chain finds nobody, Ali is written with no route and keeps the inbox row.

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
  values_schema: z.object({}),              // Zod; types alert.values (M7) and the from_value keys (§3.4)
  details_schema: null,                     // or a Zod object over AlertDetailsBase (§3.12, M5)
  lead_fallback: true,                      // "no route → lead" (§3.4.3); must be false for request kinds and answer notices (N5)
  expires_at_day_close: true,               // false only for the personal notices (§3.10, N2); needs closes_on: 'seen'
  silent: false,                            // true: no sound, no banner, inbox only (approval_receipt, §3.10, v1.0 #2); family 'info' only
  skip_requester: false,                    // ⚠️ 02a v1.0 (D-3): optional, default false; true leaves the requester out of every step (not allowed on request kinds)
  labels: { card: 'alert.test_alert.card', lock: 'alert.test_alert.lock' },
  request: null,                            // or the request part below
});
```

> As built (AD-37, AD-39, proposed): `values_schema` is a Zod object (its keys are checked). Every field is required except `onWithdraw`; each kind states its flags explicitly. The subject of `request_result` and the personal notices is the request's subject, so the kind type accepts `subject: 'request'` (AD-72, proposed).

Startup errors (`defineAlertKind`): duplicate `kind`; `skip_requester: true` on a request kind (⚠️ 02a v1.0, D-3); `family: 'urgent'` without a request part (the `alert_seen` frame is sent only on `RequestSeen`, §3.6; v0.4 #12, m15); a `from_value` key not in `values_schema`; `answerer` / `informed` sets on a non-request kind; `lead_fallback: true` on a request kind; `expires_at_day_close: false` without `closes_on: 'seen'` (v0.5 #2, #5); `silent: true` on a family other than `info` or on a request kind (v1.0 #2); a step `at: { value }` key that is not a **required `z.number()`** in `values_schema`; a `from_value` key that is not a **required `z.string().min(1)`**; `closes_on.after_ms` on a request kind.

> As built (AD-36, AD-117, proposed; AD-124, ruled): the last three startup errors are new. A typo in an `at.value` key, or a value that cannot give a time or an id, would otherwise throw on every tick pass (§3.5 Isolation). A request kind with `after_ms` would never close (requests never expire), keep the tick's pre-check true and fill `LIMIT 200`.
> Not built (AD-107, proposed for the developer): a startup error for `closes_on: 'seen'` together with `lead_fallback: true`, which the `closes_on: 'seen'` rule below assumes never exists. Every shipped `closes_on: 'seen'` kind has `lead_fallback: false`.

Request part:

```typescript
request: {
  answers: ['approve', 'reject'],           // or ['accept', 'decline']
  right: { mode: 'approval', base_permission: 'void-item', range_permission: 'approve-void' }, // or { mode: 'named' }
  needs_pin: 'always',                      // 'always' (money kinds) | 'never' (accept kinds, pilot)
  apply(ctx: CommandCtx & { alert: AlertRecord<V, D> }, answer: AnswerFacts): EventDraft[], // effect; throws DomainError to refuse
  onWithdraw?(ctx: CommandCtx & { alert: AlertRecord<V, D> }): EventDraft[],
}

type AnswerFacts = {
  decision: 'approve' | 'reject' | 'accept' | 'decline',
  answerer_staff_id: string, method: 'session' | 'pin' | 'in_person',
  device_id: string, answered_at: number,     // answered_at = the transaction's branchNow
};
type AlertRecord<V, D> = {                    // the §3.2 fields, read inside the answer transaction
  alert_id: string, kind: string, family: 'urgent' | 'action' | 'info',
  subject: { stream_type: string, stream_id: string }, dedupe_key: string,
  requester_staff_id: string | null, receiver_staff_id: string | null,
  raised_device_id: string,                   // AlertRaised envelope device_id; 'hub' when tick-raised (v0.5 #2)
  values: V,                                  // z.infer of the kind's values_schema (e.g. 04: { order_id, line_id })
  display: AlertDisplay, details: D | null,   // D = z.infer of details_schema
  step: number, raised_at: number,
};
```

`ctx` is the command's context (00 §4.2); for these handler-checked commands `ctx.permission` is `null` (H-3), so `apply` must not read it. The alert record is the one the answer transaction read (§6.2 step 1), so 04's void `apply` reads `alert.values.order_id` / `line_id` and 02's handover `apply` reads `alert.values.table_id` and `alert.receiver_staff_id` without a second read (v0.4 #3, M7).

**Read-only contract (v0.5 #1, #7; enforced in v1.0 #3, m3).** `apply` and `onWithdraw` **only read and return drafts; they never write.** 01d runs them in `preRead` (on `db`, before argon2) and in `prepare` (inside the transaction, before the PIN branch), so a write there would land before the PIN outcome is known. Enforced, not trusted: in `preRead` and `prepare` they get a **read-only view** of the transaction — `tx.append` and `tx.onCommit` throw, and `tx.db.prepare(sql)` throws when the statement is not `readonly` (better-sqlite3 `Statement.readonly`). After `apply` / `onWithdraw` return, 01d checks that **every draft carries `payload.alert_id` equal to the alert's** (v0.5 #7, m4), so 05 joins a money effect (04's void, 05's discount) to the approval that caused it; a draft without it → `Error` (a bug in the owning module, `500`), caught by the owning module's tests through test 66. **Actor of the effect events:** commands set `actor_id` = the session's staff (00 §3.7); with `method: 'in_person'` that is the **requester**, so 04 / 05 take the approver from `AnswerFacts.answerer_staff_id` (or `RequestAnswered.answerer_staff_id`), never from `actor_id` (§4.3).

> As built (AD-21, proposed): the read-only view also blocks `exec`, `pragma`, `transaction` and the other write methods, and `prepare` requires `readonly && reader` (so `COMMIT`, `ROLLBACK`, `BEGIN`, `SAVEPOINT`, `RELEASE`, `ATTACH`, `DETACH` are refused). Residual (final review deferred #1): `Statement.database` on a prepared statement still gives the raw connection; only a deliberate bypass reaches it.
> As built (AD-91, proposed): in `preRead`, `apply` runs with empty `ids` and `secrets` (`NO_IDS` / `NO_SECRETS`); an owning module's `apply` must not use them, and doing so throws `500`.

**Step `at`:** `{ ms }` (fixed; pilot values come from `ALERT_CONSTANTS`, A14), or `{ value: 'window_ms', times: n }` (n × a raiser value, e.g. Ready to serve's walk-to window). **Step `to`:** a non-empty list of `{ target, set }`, where `target` is `raised_target` (the target given at raise), one of the target kinds `answerers`, `holders_informed`, `always_on`, `managers`, `requester_lead`, or a target built from the alert's values: `{ kind: 'point', from_value }`, `{ kind: 'table_team', from_value, depth? }`, `{ kind: 'zone_order_taker', from_value }` (§3.4, v0.4 #2), and `set ∈ answerer, informed, recipient` (`answerer` / `informed` only on request kinds). A person reached by two entries of one step is listed once, with the stronger set (`answerer` > `informed` > `recipient`). A step has `escalation: true` to be written as `EscalationStepped` instead of `AttemptSent` (one fact per event, §6.6).

**The G1-9d shortcut, for every approval kind (v0.5 #4, N4; contract v1.0 #4, m4).** It applies to kinds whose request `right.mode` is `'approval'` (never `named`, never non-request kinds). At raise, when **no** person in the step-0 `answerers` has a route (a staff session, a bound tablet that is a route under §3.4.3, or a registered route) — including when `answerers` is empty — `raise` writes `StepSkipped { step: i, reason: 'shortcut' }` for every step before the kind's **first `escalation: true` step** and that step's `EscalationStepped` at once, with its list. An approval kind with no `escalation: true` step → startup error. Kinds owned by 02 / 04 / 05 build their steps from **`APPROVAL_TIER_STEPS`** (§4.2, built from `ALERT_CONSTANTS`), so their timings and the escalation step stay the table below.

**Approval tier (every money kind uses it, G1-9f; exported as `APPROVAL_TIER_STEPS`, v1.0 #4):**

| Step | At | To | Sound |
|---|---|---|---|
| 0 | raise | `[{ answerers, answerer }]` (in range — branch scope included, G1-9c — requester excluded). **G1-9d shortcut (above):** when no answerer has a route at raise, the raise writes `StepSkipped { step: 0, reason: 'shortcut' }`, `StepSkipped { step: 1, reason: 'shortcut' }` and `EscalationStepped { step: 2 }` with step 2's list, at once. The request stays pending in every case (§3.3 rule 5) | urgent (step 2's volume step-up when the shortcut fires) |
| 1 | `approval_repeat_ms` (45 000) | `[{ answerers, answerer }, { always_on, recipient }]` | urgent (repeat continues on the client, §8.3) |
| 2 (escalation) | `approval_branch_ms` (120 000) | `[{ answerers, answerer }, { holders_informed, informed }, { always_on, recipient }]` — **widens** (A6, G1-9): every answerer and the always-on screens of step 1 stay; the informed holders are added (v0.4 #6, M2). Branch-scope holders are answerers from step 0 (G1-9c), so step 2 adds only the informed holders and the volume step-up (v0.5 #4, N4) | urgent, volume step-up once (G1-14c); requester shows "Waiting 2 min — ask in person" |

**Recipients are cumulative (v0.4 #6, M2).** A step's recipients are stored per step (`alert_recipients` keeps every step's rows, §5.1). Who was ever told — every person in `alert_inbox` plus every device in any step — gets `alert_closed`, appears in `alerts_open` / the `alerts` catch-up, and is "sent" for the receipt check (§6 batch 3). A person dropped by a later step keeps the card with `moved_to` (G1-11c) and still gets `alert_closed`.

**The tick (A8, G1-16).** Every 500 ms, on `branchNow` (foundation §4.7). 01d owns the hub tick loop; 03a's fire scheduler registers on it (`registerTick`, §4.2; "To 03a"). **One clock, separate transactions (v0.3 #2):** each pass reads `now = branchNow()` once and gives the same `now` to every registered tick; each registered tick runs in **its own** `writer.run`, opened only when its `due` is true. 01d's alert tick is itself registered this way (name `alerts`), first in the list. The loop starts after boot step 7 (foundation §5.8: the server is open, projections are current).

> As built (AD-112, AD-113, proposed): the `alerts` tick registers when `tick.ts` loads; it is always first and cannot be unregistered. The loop starts next to the 00 sweeper, after `HubStarted`, and stops in `beat.stop`, before the receipt flush and before the database closes. `startTickLoop(deps, log)` takes a logger (AD-110).

```
loop every 500 ms:
  now = clock.branchNow()
  for each registered tick t (registration order):
    try:
      if not t.due(db, state, now): continue                  -- read-only, outside the lock
      await testHooks?.betweenDueAndRun?.(t.name)              -- tests only (m11), like route.ts betweenGuardAndWriter
      writer.run(tx ⇒ tx.append(t.intents(tx, state, now)))   -- BEGIN IMMEDIATE; t re-selects inside
    catch err: log { tick: t.name, err }                      -- no rethrow; the other ticks still run (AD-109: pino key `err`)

alerts.due(db, now):                                           -- ONE statement, indexes alerts_due + alert_flags PK
  SELECT EXISTS (SELECT 1 FROM alerts WHERE state = 'open' AND next_due_at IS NOT NULL AND next_due_at <= ?)
      OR EXISTS (SELECT 1 FROM alert_flags WHERE dirty = 1)

alerts.intents(tx, state, now):                                -- inside writer.run (race rule below)
    due     = SELECT … FROM alerts WHERE state = 'open' AND next_due_at <= ? ORDER BY next_due_at LIMIT 200   -- alerts_due
    flags   = SELECT name FROM alert_flags WHERE dirty = 1                                                     -- §3.9
    if due and flags are both empty → return []                -- the hint was stale; the transaction ends empty (rare)
    reads   = batchReads(tx, due)                                -- fixed statement count, below
    closed  = {}                                                 -- alert ids closed in this pass (m1)
    for each alert in due:
      if alert.expire_due: AlertClosed { reason: 'expired' }; closed += id; continue   -- day close, below
      if kind.closes_on.after_ms and now >= alert.raised_at + after_ms:                 -- expiry, not a step (M1)
        AlertClosed { reason: 'expired' }; closed += id; continue
      try:                                                       -- AD-116: per-alert guard
        steps_due = kind.steps with at(alert) <= now and index > alert.step   -- scan stops at the first step not yet due
      catch err: log { tick: 'alerts', alert_id, kind, err: { name, code } }; continue   -- no values; alert not closed
      if steps_due is empty: continue                            -- next_due_at was the expiry time; not reached (clock rounding)
      latest = last of steps_due
      for each earlier step in steps_due: StepSkipped { alert_id, step, reason: 'superseded' }
      recipients = resolve(latest.to, alert, reads)              -- §3.4, in memory from reads + directory
      AttemptSent | EscalationStepped { alert_id, step: latest.index, recipients, routes }
    if flags contains 'no_approver': evaluate §3.9 from reads, skipping alerts in `closed`; raise / close no_approver alerts; clear the flag   -- m1
    return the drafts
  after commit (writer.addAfterCommit): send alert frames (§6 batch 3) and registered route sends (§3.8) for each AttemptSent / EscalationStepped
```

> As built (AD-120, AD-121, proposed): the tick writes `AlertClosed { reason: 'expired', by_staff_id: null }` itself (`closeMany` takes owner reasons only); these closes are excluded from the flag pass of the same pass. `expires()` runs before the step plan and reads plain columns only (`expire_due`, `raised_at`, `after_ms`), so expiry wins over a due step and a stuck alert still expires. A request never expires. Tick events carry `actor_id` null, `device_id` `'hub'`, `occurred_at = now`, on the alert's subject (AD-115, proposed).
> As built (AD-123, ruled; AD-116, proposed): **a poisoned alert** — one whose stored values make a step's time or targets impossible to compute — no longer stops escalation for the branch. The tick skips it per alert (above) and the `alerts` projection sets its `next_due_at = NULL` (logged once, error level, `alert_id` and `kind`, no details, on live applies only, never on replay), so it leaves the due set. It stays answerable and closable, because answers do not depend on steps. A **stuck alert** = open, `next_due_at` NULL, and `step` below its kind's last step. Their count is `stuck_alerts` on 01a §6.21 `config-status`, shown as "Stuck alerts: N" in the `/admin/stock` More menu while N > 0 (§4.3 To 01a). The startup errors above (AD-36, AD-117) remove most ways an alert can become poisoned.

- **Race rule (v0.2 #4, kept in v0.3):** the select inside `writer.run`, after `BEGIN IMMEDIATE`, is **authoritative**; the pre-check outside it decides only whether to open the transaction. The hub has one synchronous connection and `writer.run` has no `await`, so a command and the tick never interleave inside a transaction. A pre-check that says "due" for an alert answered meanwhile finds it closed inside and writes no step; a pre-check that says "nothing" just before an alert becomes due delays its step to the next tick (≤ 500 ms, within G1-16). So once `RequestAnswered` (or any close) commits, no later tick writes a step for that alert.
- **Idle cost:** a pass with nothing due runs one indexed `SELECT` per registered tick and opens **no** transaction, so no state swap and no after-commit hooks.
- **Isolation (v0.3 #2):** a bug in one registered tick rolls back only that tick's transaction and is logged; 03a's fire intents (D44: all fire-scheduler intents of one tick in one transaction) are never rolled back by 01d, and the reverse. Within the `alerts` tick, one alert whose step cannot be computed is skipped, not the whole pass (AD-116, above).
- **Reads per tick (v0.2 #5, completed in v0.3):** 1 pre-check, then inside the transaction a **fixed** set of statements whatever the number of due alerts: (1) due alerts, (2) dirty flags, (3) active staff sessions with their device ids (`staff_sessions WHERE ended_at IS NULL AND kind = 'staff'`), (4) `device_bindings` (whole table; one row per device), (5) `devices` not revoked (type; `point_id` once points land), (6) `presence_today` (§3.11), (7) the previous step's `alert_recipients` for the due alerts (`WHERE alert_id IN (…)`, for `moved_to`, G1-11c), (8) one call per registered resolver kind that the due alerts use, with all their targets (e.g. one `tableOwner` statement for every table) — R statements, (9) the last session activity of the bound staff (§3.4.3 (c), v0.5 #6, N6), (10) one `routesFor` call per registered route with every person recipient of the tick (§3.8) — T statements. Directory lookups (`resolve`, `teamOf`, `no_pin_staff`, `leadOf`) and the socket lists (§3.4.3 binding rule) are in memory. So the tick's own reads (pre-check, `intents` and `batchReads`) are ≤ 1 + 8 + R + T **per tick**, whatever the number of due alerts, **plus a fixed extra on a pass whose `no_approver` flag is dirty**: + 1 open-alert read and + 1 flag write, and, when the pass raises `no_approver` alerts, + 1 dedupe read + T. Measured: 9 statements on a dirty pass that raises nothing, 11 on one that raises (T = 1); neither grows with staff or alerts. `raise` uses the same `batchReads` for its one alert: ≤ 6 + R + T (sessions, bindings, devices, presence, activity — 5; no previous recipients at raise — plus the dedupe read, §6.1).
  > As built (AD-131, ruled): the dirty-flag extra above is new in v1.1; the bound stays fixed. (AD-119, proposed:) read (7) is still issued, as listed, but its result is not used: the projection reads the previous step's recipients itself (§5.2). One of the two may be dropped at a later bump.
- **Several raises or closes in one transaction (v0.5 #8, m5).** The fixed reads of `batchReads` (sessions, bindings, devices, presence, activity) are cached in the per-transaction map keyed by `tx` (the one `raise` already keeps for dedupe keys), so a second `raise` or `close` in the same transaction re-reads none of them. Resolvers and routes are per call, so a caller whose **number of raises or closes depends on data** (a loop) uses **`alerts.raiseMany` / `alerts.closeMany`** (§4.2); a fixed small number of `raise` calls in one handler is allowed (`AnswerRequest` raises up to three: `request_result`, `approval_receipt`, the notice; each later call reuses the cached fixed reads, + R + T; v1.0 #7, m13). `raiseMany` / `closeMany` issue one dedupe statement (or one alert read for `closeMany`), the cached fixed reads, and one call per resolver kind and per route over all the alerts — the same count as one alert. 03a's fires tick raising Ready to serve for 20 items, or 05's day close closing 10 stale requests, therefore stays at a fixed statement count (test 35 (d)).
  > As built (BF-6; AD-70, proposed): the cached fixed reads for a `tx` are dropped when that transaction appends `SessionStarted`, `SessionEnded`, `DeviceRevoked`, `PresenceSet`, `DevicePaired` or `BusinessDayClosed` (the last two by a controller ruling: they change read (5) and the bindings), so a raise after such an append in the same transaction sees the new state.
- **Projection reads are a separate bound, per event (v0.4 #7, M10).** The appended events then go through `appendEvents` (1 statement per append, 00) and every projection's apply, **per event** (`writer.ts`). The `alerts` projection reads **at most 2 statements per 01d event** (the alert row by `alert_id` — kind, `values`, `raised_at`, `step` — to compute `next_due_at`; and, for `AttemptSent` / `EscalationStepped`, the previous step's `alert_recipients` rows of that alert for `moved_to`); its other work is writes by key. So projection reads grow with the number of **events written** (one step event per due alert), never with the number of open alerts or recipients. Stated bounds: tick ≤ 1 + 8 + R + T (plus the dirty-flag extra above); projections ≤ 2 per 01d step / close event; test 35 asserts each separately.
- **"Signed in anywhere" lags idle expiry by up to 15 s:** read (3) counts a session until the 00 sweeper ends it (every 15 s; `last_activity_at` in the table is also up to 15 s stale, 00 §3.4). The screen route, the G1-9d shortcut's route test and the §3.9 warning may react up to 15 s late; the 2 h binding rule (§3.4.3 (c)) by the same 15 s. Accepted.
- **Restart / tick lag:** the same rule covers both: the latest due step is sent once; the rest are `StepSkipped` (G1-16, b). `branchNow` is monotonic in-process (D48), so a jump only appears across a restart.
- **Failed send** (socket closed, device offline): not retried within the step; the missing receipt shows it; the next step follows on schedule (G1-16c).
- **Step 0 is written at raise,** in the raising command's transaction (no 500 ms delay).
- **Day close (Q4 → tick):** the `alerts` projection, on `BusinessDayClosed`, sets `expire_due = 1` and `next_due_at = recorded_at` on every open **non-request** alert whose kind has `expires_at_day_close: true` (a projection write, no event). The next tick (≤ 500 ms) writes `AlertClosed { reason: 'expired' }` for each. Requests stay open (no expiry), and so do the personal notices (§3.10, v0.5 #2).
- **`closes_on: 'seen'`:** closed `done` in the transaction that records the first `seen` by its (single) person recipient, from that person's own session (`request_result`, the personal notices; never by a lead's seen of a "for" card — these kinds have no "for" rows). **Except from the answering seat (v1.0 #2, R2):** for an alert with `hidden_from`, a `seen` from `hidden_from.session_id`, or from any session on `hidden_from.device_id` before the next `BusinessDayClosed`, is recorded (`AlertSeen`) but does not close it (§6.4).

### 3.6 Receipts

| Receipt | Where | When written | Dedupe |
|---|---|---|---|
| sent | not an event: the `AttemptSent` / `EscalationStepped` recipients and routes | at the step | — |
| `AlertDelivered` | `audit` / alert_id | device reports the frame shown (WS `receipt`, §6 batch 3) | first per (alert, person, device, **step**); repeats dropped (A11; step added in v0.4 #12, m5, so §6.10 shows whether each step, e.g. the escalation, reached each device) |
| `AlertSeen` | `audit` / alert_id | the signed-in person opened it (`MarkAlertsSeen`, §6.4) | first per (alert, person, device) |
| `RequestSeen` | **subject stream** | first seen per person on a **request** (`MarkAlertsSeen`), unbatched, in the command's transaction | first per (alert, person) |
| answered | `RequestAnswered` | §3.3 | — |

- **Batching (A11):** `AlertDelivered` and `AlertSeen` go into an in-memory buffer; a flush runs every 1 000 ms or at 100 buffered receipts, whichever comes first, as **one** `writer.run` appending all of them. **An empty buffer opens no transaction.** A hub crash may lose the last batch; **this is accepted for these two events only** (G1-8c).
  > As built (AD-87, proposed): the buffer is flushed on a graceful close, before the database closes. When the 100th entry arrives inside an `onCommit`, the flush is deferred to a microtask. Receipt events are written by the hub with `actor_id` null and `device_id` `'hub'` (AD-86, proposed).
- **Dedupe before buffering:** a receipt is buffered only if its key `(alert_id, staff_id, device_id, kind, step)` (`step = -1` for `seen`) is neither in the in-memory "recorded" set (filled at flush and at boot from `alert_receipts` of open alerts) nor already in the buffer. So repeats never become events, and a socket can only produce receipts for alerts it was sent (§6 batch 3; "sent" = the device or its bound person is in any step's recipients, cumulative, §3.5); no rate limit is needed (v0.3 #12). **After a restart** the recorded set is seeded from `alert_receipts` of open alerts before the WS server accepts sockets, so a receipt re-sent after the restart for one recorded before it becomes no second event (test 23).
  > As built (AD-84, proposed): each valid `receipt` frame costs one indexed read (the alert's step and the "sent" check) before the dedupe; a repeated frame never writes. (AD-88, ruled:) receipts for a **closed** alert are accepted; a duplicate `AlertDelivered` after a restart is harmless because `alert_receipts` is `INSERT OR IGNORE`. (AD-160, proposed:) the recorded set is a map per `alert_id`; its keys are dropped on the commit of each retention batch (§5.1), so memory has the shape of a fresh boot's seed.
- **Seen is a full command (v0.4 #12, m14):** each `MarkAlertsSeen` tap is a normal command transaction with its `processed_commands` insert and fsync, even for non-request alerts that write no event. A11's "no fsync per receipt" holds for `delivered` only. The load is ≈ 0.2 taps / s at rush, which is fine; do not "optimise" it into the buffer (it would lose the command idempotency).
- **Seen from a command is buffered on commit:** `MarkAlertsSeen` queues its `AlertSeen` receipts with `tx.onCommit` (`writer.ts`), so a rolled-back command buffers nothing.
- **`alert_seen` frame (G1-14a, v0.3 #8):** when `RequestSeen` is written for a person, after commit the hub sends `{ type: 'alert_seen', alert_id }` to every staff-session socket of that person and every alert-mode socket of a device bound to them (§3.7), so the 10 s urgent repeat stops on **all** of their devices at once (§8.3). For a "for Ali" card the person is the lead (§3.4.3).
  > As built (AD-77, proposed): to a bound device, `alert_seen` and `alert_closed` go only on its alert-mode socket; the bound person's own staff sockets get them as the person.
- **Payload** carries `alert_id` and the subject (`subject_stream_type`, `subject_stream_id`) so the cloud and the owner view can join back (G1-8a).
- **Pager route:** sent only; no receipts (01e, G1-8d).
- **Why `RequestSeen` is on the subject stream (G1-21.1):** the urgent repeat stops once seen (§8.3, G1-14). 01d's open-alert state is a persisted projection (§5.2), so it survives a restart without replay; putting the first seen of a request on the subject stream also keeps a projection **reset** correct when 03a replays only the subject streams (G1-8e). Requests are few per day.

### 3.7 Alert connection and device binding (G1-13)

- **Alert mode:** a WS opened with `{ type: 'auth', device_token }` and **no** `session_token` (§4.5 C-00, M12). Device types `tablet`, `cashier_kiosk`, `kds`, `phone`. **Who opens it (v0.4 #12, m13):** the tablet app's background service always (§8.2); **the tablet's page never** (only the service; otherwise the page and the service close each other with `4409` in a loop; v0.5 m6); the hub-served kiosk and phone pages whenever the page is open with a device token and no session is signed in (foreground only: a browser page cannot run in the background, R22 / G1-19); the KDS page never (its station socket gets device-target alerts, §6 batch 3). **One alert-mode socket per device (m4):** a new alert-mode auth for a device closes that device's existing alert-mode socket with `4409`, logged `{ device_id, old_remote_address, new_remote_address }`, so a cloned device token shows up as a flapping socket and a log line instead of a silent second listener. It receives only `alerts_open`, `alert`, `alert_seen`, `alert_closed` and `binding_route` frames for that device; it sends only `receipt` frames; no commands, no events, no catch-up. Alert-mode sockets are held in a **separate list** from session sockets: they never pass through 00's `deliver()`, audiences or catch-up, so 00's socket context is unchanged (H-1, H-7).
  > As built (AD-30, proposed): `4409` is a local constant `ALERT_REPLACED` in `ws/server.ts`, not in `WS_CLOSE`; 9b adds `WS_CLOSE.REPLACED` to `packages/events`. (AD-31, proposed:) a throwing `onReceipt` listener is caught and logged `{ err, device_id, alert_id }` and the socket stays open; a throwing `alerts_open` or catch-up builder logs `{ err, device_id }` and closes that socket `1011` (a local constant) without a frame; the built `alerts_open` is checked with `WsAlertsOpen.parse` first, so a stray `card` / `details` closes `1011`; `sendToAlertMode` accepts only `alert`, `alert_seen`, `alert_closed` and `binding_route`.
- **Binding** (projection `device_bindings`, §5.2), derived from session events, no new event. `SessionEnded` carries no `device_id` (00 §4.2), so the binding row keeps the **`session_id`** that set it and ends by that id:

| Device | Bound person |
|---|---|
| `phone` | its `owner_staff_id` (00 M38), from `DevicePaired` with `device_type = 'phone'` (the device type comes from `DevicePaired.device_type`; `SessionStarted` carries none); `session_id` null; ends on `DeviceRevoked`. **`SessionStarted` / `SessionEnded` never touch a phone row** (v0.4 #12, m2): `SessionStarted` for a device whose row has `session_id IS NULL` is ignored, and `SessionEnded` deletes only `WHERE session_id = ?`, which never matches a phone row. `DevicePaired` precedes every session of its device in `seq`, so replay sees the owner row first |
| `tablet` | the **last signed-in person**: `SessionStarted` (kind `staff`, `device_id` in its payload) upserts `(device_id, staff_id, session_id)`; `SessionEnded` with reason `logout`, `forced`, `staff_removed`, `credentials_changed`, `device_revoked`, `hub_restored` deletes `WHERE session_id = ?` (a no-op when a later session already replaced the row); `BusinessDayClosed` deletes every row with a `session_id` (tablet rows); **kept** on `idle_timeout` and `replaced` (the row stays; for `replaced` the new `SessionStarted` overwrites it with the new `session_id`); `taken_over` → the new session's `SessionStarted` overwrites it |
| `cashier_kiosk` | **none — no row** (device targets only, like KDS; v0.5 m8, BF-3): a kiosk is always connected at the counter, so binding it to the last cashier would make it a permanent shelf device. The projection keeps a device-type map from `DevicePaired` and **writes no `device_bindings` row** for a kiosk session, so a kiosk is never a route, never adds a person's alerts to `alerts_open`, and its receipts, `alert_seen` and "sent" check never use a cashier. A signed-out kiosk's receipt has `staff_id = ''` |
| `kds` | none — no row (device targets only; BF-3) |

> As built (BF-3; AD-46, ruled): the v1.0 kiosk row ("the projection still writes a row for a kiosk session … never a route") is replaced by the BF-3 rule above. (AD-47, proposed:) after a restart the device type is read once per `SessionStarted` from `devices` by id (cached; `devices` rows are never deleted and a type never changes); a device of unknown type follows the tablet rule.

Rebuild is exact: `reset` empties the table and replay of `DevicePaired`, `SessionStarted`, `SessionEnded`, `DeviceRevoked` and `BusinessDayClosed` gives the same rows, with no read of `staff_sessions`. After a cloud-only restore (00 M40 step 4b) the `hub_restored` ends match their sessions by `session_id`, so no stale session binding survives; a phone owner row stays until `DeviceRevoked` (m2).

> As built (AD-49, ruled): after a restore **no active (session) binding is left**; the phone owner row staying is correct (test 27 reworded, §10).

- The tablet header always shows whose alerts it carries (G1-13c; v0.5 #6, N6): **"Alerts: <name> — pauses at h:mm AM/PM"** while the binding can be a route; after that time **"Alerts paused"**, with one `info` chime when it turns; **"Alerts: none"** with no binding. The time comes from the hub (BF-5): `alerts_open.binding_route_until` on connect and the `binding_route { until }` frame when it changed, sent after a committed step that routes to the device (§6 batch 3, AD-126), so activity elsewhere moves it at the next such step; `until` is null when the binding is not a route, and always null for a phone. A sign-in on the tablet refreshes it. Times are shown in 12-hour format ("2:02 PM").
  > As built (BF-5; AD-4, ruled; AD-126–AD-128, proposed): `binding_route` is sent after any committed step event (raise or tick) that has an `alert_connection` person route to the device, only when the value changed (1 statement, after commit). A device that never got `alerts_open` (a tablet page with only a session socket) has no baseline, so its first value counts as a change and is sent. On reconnect `alerts_open` applies the full binding rule (a)–(c), with the socket being opened counted as connected.
  > As built (AD-167, ruled): 12-hour times on every staff screen, as in 02, 03b and 04.
  > As built (AD-T42-1, AD-T42-2, AD-T42-3, unattended — developer to confirm): **the 9a tablet page only approximates this header** until 9b's background service holds the alert connection: the page opens no socket while signed out (m6). At sign-in it sets `until` = hub now + 2 h, moves it to hub now + 2 h on every accepted command from the page (`MarkAlertsSeen`, `AnswerRequest`, `SendTestAlert`; no query counts), and replaces it with any `binding_route` frame. The name is the person who last signed in on this page (memory only; "Someone" after a reload). An explicit sign-out shows "Alerts: none"; an idle expiry or `4401` keeps the deadline (test 27). **Known gap against BF-5:** when the hub's `until` becomes null (the person is absent), the page still shows a deadline until a `binding_route: null` frame arrives. Closing it needs an additive frame or field (a spec bump) or 9b (§12.7).
- **Lock-screen and session-less text:** table, kind, point, requester only (`T12 · Void request · Hamza`, `T12 Ready — Pass`); never amounts, items or reasons (G1-13e). The `alert` frame sent to an alert-mode socket carries only the `lock` text fields (§6 batch 3); details need a sign-in.
- **Revoke / rotation:** `DeviceRevoked` closes alert-mode sockets `4403`, `DeviceTokenRotated` `4401`, as for session sockets (00 M39, M40, M60). Because alert-mode sockets get no event frames, the close is done by the alert-mode list's own after-commit check on those two events (no frame sent first), not by 00's `closeFor` (`apps/hub/src/ws/server.ts`, which runs only after an event is sent).
- **A binding is a route only while connected, present and, for a tablet, recently active** (§3.4.3, v0.4 #10, v0.5 #6). The binding row itself is unchanged by presence, connection or activity; only route resolution checks them.
- **Reconnect:** on auth, an alert-mode socket gets `alerts_open` (open alerts where this device is in **any** step's recipients, plus those where its bound person is in `alert_inbox`, cumulative, §3.5), so a reconnect does not miss a step. **The bound person's part is included only while the binding passes §3.4.3 (b) and (c)** and the device is a tablet or phone (v0.5 m7): a shelf tablet past 2 h, or one bound to an absent person, does not replay that person's urgent alerts; device-target rows are unaffected. ≤ 3 statements (alerts, presence, activity). The client re-notifies what it gets there (§8.1, m6).
  > As built (AD-128, proposed): the bound person's part uses the same binding rule as routing, including (a), with this socket counted as connected; `binding_route_until` is null whenever the binding is not a route.

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

- `routesFor` is called **once per registered route per tick (or per raise)** inside the step transaction, with every person recipient of that tick (§3.5 read 10), so `AttemptSent.routes` lists `pager:5`; `send` runs after commit. A route that issues more than one statement per call fails test 35.
  > As built (AD-59, proposed): `routesFor` is asked about the recipients **and** the fallback candidates (leads, zone order taker, managers), so a lead whose only route is the pager has a route. `send` receives the lock view only; errors it throws are logged in full (AD-80).
- A route with `receipts: ['delivered']` reports through `alerts.recordReceipt({ …, step })` (same buffer, A11; `step` required for `delivered`, v0.5 m3).
  > As built (AD-83, proposed): `recordReceipt` takes an optional `route`, so the receipt event names it.
- A person whose only route is a registered one is **not** "no route" (§3.4.3).
- `short_code` text comes from the kind's optional `short` label (§3.12, Latin only); a kind without one is not sent on short-code routes.
  > As built (AD-164, ruled): so the personal notices (`answered_on_requester_device`, `pin_use_failed`, `approval_receipt`), which have no `short` label, are never sent on short-code routes (N8); test #55 is reworded (§10).

### 3.9 "No one can approve" warning (pilot form of Q-N5, G1-9e)

For each permission that some role grants with `requires_approval` at this branch: while the business day is open and **no person who could answer it branch-wide** (holds an approver role and, for a permission with a registered `range_permission`, branch scope on it) is signed in anywhere, an alert kind `no_approver` is open (subject `hub` / branch_id, `dedupe_key = 'no_approver:' + permission`, family `info`, target `always_on` + `managers`; text "No one can approve voids right now"). **Per permission only** in the pilot: a per-request "no one can answer this request" warning (the narrow case where the only branch-scope approver signed in is the requester) is deferred (§12.4, v0.3 #9); that requester sees "ask in person" (§8.1). **Evaluated by the tick** (Q4): the projections of `SessionStarted`, `SessionEnded`, `StaffDirectoryApplied`, `BusinessDayOpened` and `BusinessDayClosed` set the persisted flag `alert_flags('no_approver').dirty = 1`; the next tick evaluates from its batched reads (sessions + directory in memory; no read of open requests), raises or closes `no_approver` alerts, and clears the flag in the same transaction (≤ 500 ms after the cause, plus the ≤ 15 s idle lag of §3.5; survives a restart because the flag is persisted). Closed `done` when an eligible approver signs in; `expired` at day close.

> As built (AD-130, AD-133, proposed): "a permission some role grants with `requires_approval`" is derived from `resolve()` over the people in `staff` (the directory has no public role list; it differs only for a grant nobody holds, which nobody can request). Branch scope is required on every registered range of the permission. (AD-132, proposed:) a warning that ends for any reason other than day close closes `done`; at day close a row with `expire_due = 1` is left to expiry (`expired`), also when more than 200 alerts are due (m1). The flag pass's statement cost is in §3.5 (AD-131).
> As built (BF-7; AD-3, ruled): the same flag pass also closes `obsolete` the open personal notices (§3.10) of people no longer in `staff`; no schema change.
> As built (batch 9a, unattended — developer to confirm): the view carries no permission, so the client text is generic: "No one can approve requests right now" (card) and "No one can approve requests" (lock).

### 3.10 Kinds 01d ships

| Kind | Family | Subject | Steps | Closes on | Use |
|---|---|---|---|---|---|
| `test_alert` | `info` | `hub` / branch_id | step 0 to the raised target | `after_ms` 600 000 | A manager (`manage-devices`) sends a test to a person, a team, a device or a point (point stubbed) and watches receipts. Installation tool for tablets now and watches / bridge in 01e (G1-21.7). *As built (AD-136, proposed):* `display` = `requester_name` (the sender) and `device_name` (the target device). |
| `request_result` | `info` | the request's subject | step 0 to the requester | `seen` | Decision and answerer (or closer and reason) to the requester, raised in the answer / close transaction (G1-21.2). `lead_fallback: false` (N5). *As built (AD-72, proposed):* dedupe key `request_result:<request alert_id>`, the outcome in `values`, the closer's note in `details.reason` cut to 200 characters, `expires_at_day_close: true`; none when there is no requester. *As built (AD-82, ruled; AD-145, proposed):* every view of it carries `outcome` ∈ `approved`, `rejected`, `withdrawn`, `obsolete`, `overridden` (`accept` → `approved`, `decline` → `rejected`, unreadable values → null; nothing raises `withdrawn` today). `outcome` carries no amount, item or reason, so it also goes on lock and alert-mode frames, and the requester's rising / falling chime (§8.1) is right without a sign-in. |
| `no_approver` | `info` | `hub` / branch_id | step 0 to `always_on` + `managers` | owner (01d) | §3.9. `lead_fallback: false` (N5). |
| `answered_on_requester_device` | `info` | the request's subject | step 0 to `{ kind: 'person', staff_id: <answerer> }` (own routes only, §3.4.3) | `seen` (personal) | Raised in the answer transaction when `RequestAnswered.device_id` = the alert's `raised_device_id`, **any method** (§3.3 rule 7; every `in_person` answer, rule 2; v0.5 #2, N2). Info chime (audible). `card`: "You approved the void on T12 at Hamza's tablet" (decision, request kind label, table, device name, requester); `lock`: "You approved a request at another tablet". `hidden_from` = the answering session (v1.0 #2). `dedupe_key = 'on_requester_device:' + request alert_id`. |
| `approval_receipt` | `info`, **`silent: true`** | the request's subject | step 0 to `{ kind: 'person', staff_id: <answerer> }` (own routes only) | `seen` (personal) | **v1.0 #2, R2.** Raised in the answer transaction for **every** answer of a `needs_pin: 'always'` kind, any method, any device. No sound and no banner: an inbox row and a badge (§8.1). `card`: "You approved the void on T12 · Rs 4 800 · Tablet 5 · 9:03 PM" (decision, request kind label, table, the request's `details` copied as this alert's `details` — signed-in `card` only, §3.12 —, answering device name, time), marked "at the requester's device" when `on_requester_device`; `lock`: "You answered a request". `hidden_from` = the answering session. `dedupe_key = 'approval_receipt:' + request alert_id`. A few dozen a day; it is also the approver's own record. *As built (AD-102, proposed):* its details schema is `AlertDetailsBase`, with `{}` when the request has no details. |
| `pin_use_failed` | `info` | the request's subject | step 0 to `{ kind: 'person', staff_id: <PIN owner> }` (own routes only) | `seen` (personal) | Raised by `checkPin`'s `onPrepareFailed` when the PIN matched and `prepare` then failed (§3.3 rule 4 (d)), **in the same transaction** that counts the failure (v1.0 #1, R1; v0.5 raised it in a second transaction). Not raised for `method: 'pin'` with `409 REQUEST_NOT_PENDING` (BF-1). `card`: "Your PIN was used at Hamza's tablet for the void on T12; the answer failed: <reason label>"; `lock`: "Your PIN was used at another tablet". `hidden_from` = the session that sent the PIN. `dedupe_key = 'pin_use_failed:' + request alert_id + ':' + command_id`. *As built (AD-98, proposed):* values `{ request_alert_id, request_kind, error_code, device_id }`, no secrets; `display` is the request's lock-safe copy. |

> As built (AD-101, AD-104, AD-147, proposed): the personal notices' values are the card facts (ids, kind, decision, `device_id`, and `on_requester_device` on the receipt), no secrets; `requester_staff_id` is null on them (they are not requests). Their `display.device_name` is the answering (or PIN-sending) device, read in the answer's existing alert statement, so "at Hamza's tablet" needs no extra read.

**Personal notices** (`answered_on_requester_device`, `approval_receipt`, `pin_use_failed`; v0.5 #2, N2; v1.0 #2, R2): `lead_fallback: false` and `expires_at_day_close: false`. They go only to the person's own routes and inbox (never a "for X" copy on a lead's device, §3.4.3); with no route at raise, the inbox row waits. They are **not expired at day close** and close `done` **only** when that person sees them while signed in (§3.5 `closes_on: 'seen'`); the person's next sign-in shows them (the `alerts` catch-up; `alerts-inbox` lists open personal notices of earlier days, §6.7, §12.4). Not requests, so no answer can be faked through them; a person who did not do it tells the manager. **A person removed from the directory** has their open personal notices closed `obsolete` by the next tick (BF-7, §3.9).

**Hidden from the answering seat (`hidden_from`, v1.0 #2, R2).** The alert row keeps `hidden_from = { session_id, device_id }` of the session that sent the answer (or the PIN). Until the next `BusinessDayClosed` (when the projection clears the device part), and for that session forever: no `alert` frame, `alerts_open` row, `alerts` catch-up row or `alerts-inbox` row goes to that session or to any socket of that device (§6 batch 3, §6.7), and a `seen` from there is recorded (`AlertSeen`, so 05 sees it) but does not close the notice (§3.5, §6.4). An honest approver answering on their own tablet sees their receipt on another device or the next day; the receipt is a record, not a prompt.

> As built (AD-78, proposed): `alert_closed` of a hidden alert is hidden the same way; `alert_seen` is not hidden. (AD-95, proposed:) `hidden_from` is a `raise` input, copied verbatim into `AlertRaised`.

### 3.11 "Present today" (G1-20; kept, owner answer 2026-11-01)

- Command `SetPresence { staff_ids: [...], present: boolean }` (permission `manage-staff`, Q2), event `PresenceSet { business_day_id, staff_ids, present, set_by }` on `staff` / branch_id. Projection `presence_today`, cleared on `BusinessDayClosed`.
- **`business_day_id`** = the `event_id` of the open day's `BusinessDayOpened`, read in the one statement §6.6 allows. It is unique per day, even when a day is reopened.
- The ids are the people being set: `present: false` marks them absent, `present: true` clears that; people not listed are untouched. Absent = a row with `present = 0` (BF-8).
- Used only by §3.4.1. The no-route hint and the shift-start screen that shows it are 01e's (pager assignment screen, G1-18b).

> As built (AD-156, ruled): `business_day_id` was named in v1.0 but defined nowhere (nor in the foundation); defined above. (AD-157, proposed:) the payload meaning above. (AD-7, ruled:) 01d ships only the command and the projection; the screen comes with 01e.

### 3.12 Labels and i18n (G1-21.6)

Each kind registers label keys in the client string tables (`EN` and `UR`, 00 M83): `card` (full text, signed in), `lock` (session-less text, §3.7), optional `short` (Latin only, ≤ the route's length, 01e). `display` on the alert carries the lock-safe parameters (`table_code`, `point_code`, `requester_name`, `device_name`, `kind_label_key`), never amounts, items or reasons.

> As built (batch 9a, unattended — developer to confirm): the table chip shows `T{table_code}` ("T12"). A kind with no client texts (04's `void_approval` before 04 lands) shows "{table} · Request · {requester}" when it is urgent or has answers, else "… · Alert · …"; a kind key is never shown. A `{kind}` placeholder uses `alert.<kind>.name` when the owning module defines it, else the word "request" (`alerts.kind_fallback`). The view carries neither the request kind nor the decision of an `approval_receipt`, so its copy is neutral: "Request approved · T12" (`request_result`, one key per `outcome`) and "You answered a request · T12 · Hamza" (`approval_receipt`). 79 Urdu strings still fall back to English (`docs/design/handoff/01d/urdu-todo.md`).

**Approver context — `details` (v0.4 #1, M5).** A kind with `details_schema` takes `details` at raise: owner-supplied parameters the approver needs to decide, from the base shape `AlertDetailsBase = { item?: string, quantity?: int ≥ 1, amount?: int (minor units, D47), reason?: string ≤ 200 }`; the kind's `details_schema` picks and requires fields from it (04's void: `item`, `quantity`, `amount`, `reason`). `raise` validates `details` against it (`DomainError('VALIDATION_FAILED', { issue: 'details_invalid' })`). `details` is shown **only** in the signed-in `card` ("Void · T12 · Hamza — Mutton platter × 1 · Rs 4 800 · 'customer changed mind'"), sent **only** to a viewer who is a person recipient of the alert or may answer it now, on that person's own staff-session sockets (the card rule, §6 batch 3); **never** in `lock` text, alert-mode frames, device-target frames (KDS, kiosk, point tablets), `short` codes, `alerts_open` or logs (§7). It is stored in `AlertRaised` and `alerts.details_json` so the card survives a reconnect (catch-up part).

> As built (AD-162, AD-163, ruled): v1.0 said "the person recipient's own staff-session sockets"; the build also gives the card to a viewer who may answer the request now (catch-up, `requests-to-answer`), on their own staff session, and never to a viewer who is only a device target. One rule everywhere (§6 batch 3).

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 00 | `defineCommand`, `defineQuery`, `writer.run`, `writer.addAfterCommit` (post-commit frames and route sends), `tx.onCommit` (receipt buffering), `registerProjection`, `registerCatchUp` (with the socket context, H-7), `StaffDirectory`, `clock.branchNow`, `ids.next`, PIN check (`checkPin`, §3.5 steps 2–9, through the new `pinCheck` hook, §4.5 C-00 H-3), WS server (alert mode, new frames, §4.5 C-00), sessions table, devices table, `setMaintenanceHour` / retention hour (M66) |
| 01b | `resolve` (grant, `approver_role_ids`, scope), `leadOf`, `teamOf`; v1.4: `no_pin_staff`, `teamOf` including no-PIN people (§4.5 C-01b) |
| 01a | `BusinessDayOpened`, `BusinessDayClosed`. *As built (AD-123, ruled):* 01d also extends 01a's `config-status` query with `stuck_alerts` (§4.3 To 01a) |
| Later modules | Registered kinds, target resolvers (`table_team`, `point`, `zoneOf`), routes (01e) — through §4.2 only |

### 4.2 Exposes (later modules may rely only on these)

**Hub (`apps/hub/src/alerts/`):**

| Export | Shape | Used by |
|---|---|---|
| `defineAlertKind(def)` | §3.5 (with `values_schema`, `details_schema`, `lead_fallback`, `expires_at_day_close`, `silent`, typed `apply` / `onWithdraw`). Registered at startup; duplicate `kind`, `urgent` without a request part, unknown `from_value`, `lead_fallback: true` on a request kind, `silent: true` outside `info`, an approval kind with no `escalation: true` step, an `at.value` key that is not a required `z.number()`, a `from_value` key that is not a required `z.string().min(1)`, `closes_on.after_ms` on a request kind (AD-36, AD-117, AD-124) → startup error. **Contract for owning modules (v0.5 #7, m4; enforced v1.0 #3, m3):** `apply` / `onWithdraw` only read and return drafts — they run on a read-only transaction view (`append` / `onCommit` throw, a non-`readonly` statement throws) in `preRead` and in `prepare` — and every draft they return carries `payload.alert_id` equal to the alert's (checked after each call); with `in_person` the effect events' `actor_id` is the requester, so the approver is `AnswerFacts.answerer_staff_id` (§3.5). In `preRead` they must not use `ids` or `secrets` (AD-91) | 02, 03a, 03b, 04, 05, 01e |
| `alerts.raise(ctx, input)` | `input = { kind, subject: { stream_type, stream_id }, target, values?, display, details?, dedupe_key, requester_staff_id?, request?: { approver_role_ids?, receiver_staff_id? }, hidden_from?: { session_id, device_id } \| null }` → `{ alert_id, events: EventDraft[], deduped: boolean, requester_staff_id: string \| null }`. `values` is validated by the kind's `values_schema`, `details` by its `details_schema` (§3.12). `request.approver_role_ids` is **required** for `approval` kinds (the owning command passes its `ctx.permission.approver_role_ids`; `raise` never reads `ctx.permission`, which is `null` from a tick or a non-approvable command; v0.4 #12, m7); `receiver_staff_id` is required for `named` kinds. Pure on the transaction: the caller appends `events` with its own. **Dedupe namespace is `(kind, dedupe_key)`** (index `alerts_open_dedupe`, v0.4 #12, m8): the same key under two kinds gives two alerts. A second raise with the same kind and key while one is open → `{ alert_id: <open one>, events: [], deduped: true, requester_staff_id: <the open one's requester> }`; a deduped caller who is not that requester cannot withdraw it (`not_requester`), and the owning module shows "Already requested by <name>". **Within one transaction** `raise` also remembers the keys it has returned drafts for (a per-transaction map keyed by `tx`), so a second raise with the same key in the same handler, before the caller appends, returns the first `alert_id` with `deduped: true` instead of tripping `alerts_open_dedupe`. Step 0 is included; for an approval kind with no answerer route, the G1-9d shortcut drafts instead (§3.5, v1.0 #4). Statements: ≤ 6 + R + T; the fixed reads are cached per transaction (§3.5, v0.5 #8). *As built (AD-95, proposed):* `hidden_from` is copied into `AlertRaised`. *(AD-68, proposed):* an `AlertClosed` **appended** in the same transaction frees that alert's dedupe key; a close that is drafted but not yet appended does not. | owning modules' command handlers and ticks (through `tickCtx`) |
| `alerts.raiseMany(ctx, inputs[])` | as `raise` for each input, with **one** dedupe statement, the cached fixed reads and one call per resolver kind and per route over all inputs (v0.5 #8, m5) → `Array<{ alert_id, events, deduped, requester_staff_id }>` in input order. **Required when the number of raises depends on data** (a loop); a fixed small number of `raise` calls in one handler is allowed (v1.0 #7, m13) | 03a fires tick, any loop |
| `alerts.closeMany(ctx, items: Array<{ alert_id, reason, note? }>)` | as `close` for each, with **one** alert read and, for the `request_result` raises, one `raiseMany` (v0.5 #8, m5) → `EventDraft[]`. **Required when the number of closes depends on data** (a loop) (v1.0 #7, m13) | 05 at day close, 03b |
| `alerts.close(ctx, alert_id, reason, note?)` | `reason ∈ done, obsolete, overridden, undone` → `EventDraft[]` (`AlertClosed`, plus `request_result` for a request closed `obsolete` / `overridden`). Closed already, or an unknown id (AD-73) → `[]` | owning modules |
| `alerts.tickCtx(tx, now)` | the `ctx` a registered tick passes to `raise` / `raiseMany` / `close` / `closeMany`: `{ tx, now, actor_id: null, device_id: 'hub', session: null, permission: null }` (v1.0 #5, m5). Tick-raised alerts have `raised_device_id = 'hub'` | 03a fires tick (Ready to serve, slip warning), 01d's own tick |
| `APPROVAL_TIER_STEPS` | the approval tier of §3.5 as a step list built from `ALERT_CONSTANTS` (step 0 answerers; step 1 at `approval_repeat_ms` + always-on; step 2 `escalation: true` at `approval_branch_ms` + informed holders), for owning approval kinds' `steps` (v1.0 #4, m4). *As built (AD-38, proposed):* typed `readonly StepDef[]` and deep-frozen, since every approval kind shares it | 04 void, 05 discount, 02 / 05 comp |
| `alerts.byDedupeKey(db, kind, key)` | open alert id or null (1 statement) | owning modules (e.g. 03b undo) |
| `alerts.listOpen(db, { kind?, subject?: { stream_type, stream_id } })` | open alerts as `AlertRecord[]`, oldest first, 1 statement (`alerts_open_kind` index); for requests 01d never auto-closes (§3.3, v0.4 #4, M8) | 05 at day close, 04, 02 |
| `registerTargetResolver(kind, fn)` | batch-shaped: `fn(tx, targets[]) → Map<target_key, { staff_ids, device_ids, owner_staff_id? }>` (⚠️ Changed by 02a v1.0, D-1: `owner_staff_id` added; the directory is read through `alertDirectoryOf(tx)`), **one SQL statement per call** (§3.5 reads per tick); kinds `table_team` (02), `point` (01a/00 with points), `zone_order_taker` (02 + 01a zones); used for raised targets and for step targets built from the alert (§3.4, v0.4 #2). *As built (AD-51, proposed):* the map is keyed by `targetKey(target)`; the `table_team` resolver returns the table's **owner only** and 01d adds the reports | 02, 01a |
| `registerRoute(def)` | §3.8; `routesFor(tx, staffIds[]) → Map`, one statement per call | 01e |
| `alerts.recordReceipt({ alert_id, staff_id, device_id, kind, step, route? })` | into the receipt buffer (A11), deduped before buffering by `(alert_id, staff_id, device_id, kind, step)` (§3.6); `step` required for `delivered`, ignored (−1) for `seen` (v0.5 m3). `route` optional (AD-83) | 01e routes that report receipts |
| `registerTick({ name, due(db, state, now) → boolean, intents(tx, state, now) → EventDraft[] })` | One loop, one `now` per pass (§3.5). `due` is read-only, runs outside any transaction, and must be cheap (one indexed statement, or pure over the in-memory state). When it returns true the loop opens **this tick's own** `writer.run`, in which `intents` re-selects authoritatively and its drafts are appended (D44 holds per registered tick: all of one tick's intents in one transaction). A throw in `due` or `intents` rolls back that tick only and is logged `{ tick: name, err }`; the other ticks of the pass still run. Registration order is the run order; 01d's `alerts` tick is first. *As built (AD-111, proposed):* `due` gets a read-only `db` view, so a write in it throws | 03a fire scheduler |

**Events introduced (all `schema_version: 1`, `@pos/events/src/events/<stream>/…`; files under `events/alert/` re-exported for every subject stream):**

| Event | `stream_type` / `stream_id` | Payload | Pushed to |
|---|---|---|---|
| `AlertRaised` | subject | `{ alert_id, kind, family, subject_stream_type, subject_stream_id, dedupe_key, requester_staff_id \| null, target, values, display, details \| null, hidden_from: { session_id, device_id } \| null (v1.0 #2), request: { answers, right_mode, base_permission \| null, range_permission \| null, approver_role_ids, receiver_staff_id \| null, needs_pin } \| null }` | — (frames, §6.3) |
| `AttemptSent` | subject | `{ alert_id, step, recipients: Array<{ staff_id \| null, device_id \| null, for_staff_id \| null, set: 'answerer' \| 'informed' \| 'recipient' }>, routes: Array<{ staff_id \| null, route: 'screen' \| 'alert_connection' \| string, ref: string }> }`. *As built (AD-65, proposed):* `ref` is the `device_id` for `screen` / `alert_connection`; device recipients get route rows with `staff_id` null | — |
| `EscalationStepped` | subject | as `AttemptSent` | — |
| `StepSkipped` | subject | `{ alert_id, step, reason: 'superseded' \| 'shortcut' }` (`shortcut`: G1-9d, §3.5, v0.5 #4) | — |
| `RequestAnswered` | subject | `{ alert_id, decision: 'approve' \| 'reject' \| 'accept' \| 'decline', answerer_staff_id, method: 'pin' \| 'session' \| 'in_person', device_id, on_requester_device: boolean }` (`on_requester_device` = `device_id` equals the alert's `raised_device_id`; v0.5 #2, #7, N2, m4) | — (frames: `alert_closed`, §6 batch 3; v0.3 #12) |
| `RequestWithdrawn` | subject | `{ alert_id, by_staff_id }` | — (frames) |
| `RequestSeen` | subject | `{ alert_id, staff_id, device_id }` | — (frame `alert_seen` to the person's devices, §3.6) |
| `AlertClosed` | subject | `{ alert_id, reason: 'done' \| 'obsolete' \| 'overridden' \| 'undone' \| 'expired', by_staff_id \| null, note \| null }` | — (frames) |
| `AlertDelivered` | `audit` / alert_id | `{ alert_id, subject_stream_type, subject_stream_id, staff_id \| null, device_id, route, step }` (`staff_id` = the device's bound person for an alert-mode receipt). *As built (AD-15, proposed):* `route` is a free string; (AD-85) `staff_id` is the person the alert was sent to (the session staff, or the bound person in alert mode), else `''` | — |
| `AlertSeen` | `audit` / alert_id | as `AlertDelivered`, without `step` | — |
| `RequestPinFailed` (§3.3 rule 4, v0.4 #8) | `audit` / alert_id | `{ alert_id, subject_stream_type, subject_stream_id, answerer_staff_id, method: 'pin' \| 'in_person', device_id, requester_staff_id, outcome: 'pin_invalid' \| 'answer_failed', error_code }` (`outcome` and `error_code`: v1.0 #1, R1; `error_code` = `PIN_INVALID` or the `prepare` error's code) — never the PIN, never whether it matched. **Read by** 05's live view, money section: failed PIN attempts on requests (§4.3 To 05, v0.5 #7, m4). *As built (AD-15, AD-96, AD-97, proposed):* `error_code` is a free string, `INTERNAL_ERROR` for a non-`DomainError` (its message is never used); `requester_staff_id` is `''` when the request has none | — |
| `PresenceSet` (§3.11) | `staff` / branch_id | `{ business_day_id, staff_ids, present, set_by }` (`business_day_id`: §3.11, AD-156). *As built (AD-16, proposed):* `staff_ids` has no bound on the event (bounded 1..100 on the command), so replays stay robust | — |

Actor: commands set `actor_id` = session staff (00 §3.7) — for an `in_person` answer that is the requester, not the approver (v1.0 #3); tick-written events have `actor_id = null`, `device_id = 'hub'`; so do receipt events, which the hub writes (AD-86).

**Client (`packages/events/src/ws.ts`, `packages/domain`):** frame shapes (§6 batch 3, six frames incl. `binding_route`, AD-4), `ALERT_FAMILIES`, close reasons, request decisions, label key convention.

### 4.3 Requirements carried to other modules

**To 01e Device gateway (pilot, mandatory)** — G0 D3, D4, D5, G1–G7, G0-10; the pager route through §3.8 (`routesFor` batch-shaped, one statement per call); **the 01b bump for `pager_ids`** (G1-17: directory map `pager_ids: { staff_id → pager_id }`, cloud column on `staff_branches`, staff form field, hub cache table; moved out of 01d's 01b bump in v0.3 #11, with its directory statement and sync-bound row); pager assignment by shift with the `pager_ids` default (G1-17a, b, c), on the `staff` stream; watch kinds and patterns (N8, G0-2); device-offline alerts (G0 G7) and "a point with no bound device online → the manager is told" (G1-12d, needs 01a points); the no-route hint on the shift-start screen (G1-18b); `test_alert` to a watch as the installation check. *As built (AD-7, ruled):* the `SetPresence` screen (§3.11) is 01e's shift-start screen.

**To 03a** — size snapshots and replay against ≈ 75k events/day (≈ 45k on replayed streams, ≈ 30k `audit`) instead of R6's 40k; replay reads only the stream types its reducers use, with an index serving `(branch_id, stream_type, seq)`; foundation §5.8 step 3 text through the v1.8 bump (C-F F-9, R34) (G1-8e). **One tick:** register the fire scheduler with `registerTick({ name: 'fires', due, intents })` instead of starting a timer (G1-16a): `due` is pure over the engine state (e.g. "`getTickIntents(state, now)` is non-empty", or the earliest pending due time ≤ now), so an idle kitchen opens no transaction; `intents` writes all fire intents of the pass in its **own** transaction (D44), separate from 01d's (§3.5). Register the slip-warning kind. *⚠️ Changed by 03a v1.0 (N-2): was "Register the Ready-to-serve kind (`action`, attempts by `window_ms`, last-attempt escalation to `{ kind: 'point', from_value: 'point_id' }` and `managers`, with `point_id` in its `values_schema`, G0-1; §3.4 step targets) and the slip-warning kind (to the table's order taker: `{ kind: 'table_team', table_id, depth: 'owner' }`, N9, v0.5 m9)".* The Ready-to-serve kind is **03b's** (03a-g0 §3 #6), with the same shape. The slip target is `{ kind: 'person', staff_id: <receiver> }`, with `receiver_staff_id` from 02's `tableOwners`, raised by 03a's `fires_alerts` tick (03a v1.0 §3.8). A fires pass raises through `alerts.raiseMany(alerts.tickCtx(tx, now), …)` (the tick gets only `tx`; `tickCtx` gives it the `ctx`, v1.0 #5, m5; v0.5 #8). Register no catch-all audience on the `order` stream: `AlertRaised` (with `details`) and `pin_use_failed` live there and are delivered only as alert frames (run 3 §4). *As built (AD-111, proposed):* `due` runs on a read-only view; a whole-tick error is logged `{ tick, err }` (AD-109; final review m-1: the raw error, see the draft notes).

**To 02** — register `tableOwners` / the `table_team` resolver (⚠️ Changed by 02a v1.0, D-1: it returns the full recipient set, 02a §4.2; was "`tableOwner` … *as built, AD-51:* it returns the owner only") and `zoneOf`; register the table-handover accept kind (`named`, 60 s remind / 2 min `requester_lead` = the sender's lead, G0-1; `values_schema` with `table_id`) and its typed `apply` (reads `alert.values.table_id`, `alert.receiver_staff_id`). **Read-only contract (v1.0 #3, m3):** `apply` and `onWithdraw` only read and return drafts (they run on a read-only view before the answer is known, §3.5), and every event they return carries `alert_id` (checked); comp approval (with 05) builds its steps from `APPROVAL_TIER_STEPS` and takes the approver from `AnswerFacts.answerer_staff_id`, never from `actor_id` (with `in_person` that is the requester). Call waiter and the Served card kinds. Register no catch-all audience on the `order` stream (run 3 §4). *As built (AD-91, proposed):* `apply` must not use `ids` or `secrets` (empty in `preRead`). *As built (AD-1, ruled):* 02 / 04 build the requester's waiting card (§8.1) with their first request kind, and 02 adds its ordering screens to the 9a `staff` entry. *As built (AD-168, ruled), carried row:* the 02 / 04 top bar shows two icon buttons in place of the single bell — **Requests (n)** with a shield and **Inbox (n)** with a tray, each with a red badge; not built in 01d. *As built (AD-2, ruled):* when 02 builds the device command queue it keeps the rule that PIN-bearing commands are never queued (H-10).

**To 04** — register the void approval kind (`approval`, `base_permission: 'void-item'`, `range_permission: 'approve-void'`, `needs_pin: 'always'`; `values_schema` `{ order_id, line_id }`; `details_schema` with `item`, `quantity`, `amount`, `reason`, passed at raise so the approver sees what they approve, §3.12); steps from `APPROVAL_TIER_STEPS` (§4.2, v1.0 #4); typed `apply` for approve / reject (reads `alert.values`; **only reads and returns drafts** — it runs on a read-only view in `preRead` and in `prepare`, before the PIN outcome is known, so a write throws — and **every event it returns carries `alert_id`**, checked; v0.5 #1, m4; v1.0 #3, m3); `apply` refuses a void whose order was billed meanwhile, which `preRead` then answers before any PIN is verified (§3.3 rule 4 (b)); the approver recorded on 04's events is `AnswerFacts.answerer_staff_id`, never the event's `actor_id` (with `in_person` that is the requester, 00 §3.7); `onWithdraw` (confirm "as if it never happened"; same contract); OVERRIDDEN through `alerts.close(…, 'overridden')`; the rejected-void notice to the table's order taker (`{ kind: 'table_team', table_id, depth: 'owner' }`, N9, v0.5 m9). *As built (AD-91, proposed):* no `ids` / `secrets` in `apply`. *As built (AD-1, AD-168, ruled):* the requester's waiting card and the Requests (n) / Inbox (n) top-bar buttons, as in To 02. *As built (batch 9a, unattended):* 04 defines `alert.void_approval.*` texts, including `alert.void_approval.name` for the `{kind}` placeholder (§3.12).

**To 05 (and 02 for comps)** — discount and comp approval kinds (`approval`, no `range_permission` in the pilot, G1-23; `details_schema` with `amount` and `reason`; steps from `APPROVAL_TIER_STEPS`); **read-only contract (v1.0 #3, m3):** their `apply` / `onWithdraw` only read and return drafts (read-only view, writes throw) and every returned event carries `alert_id` (checked); the approver is `AnswerFacts.answerer_staff_id` / `RequestAnswered.answerer_staff_id`, never `actor_id`; every request records requester, approver, amount, reason, time (G0 N7) — amount and reason live in the owning module's events and in the signed-in `details` (§3.12), never in 01d's `lock` text. **At day close** 05 lists open requests with `alerts.listOpen(db, { kind })` before the Z report and decides each one (close `obsolete` with a note, or keep; 01d never closes them, §3.3, v0.4 #4); several closes in one transaction go through `alerts.closeMany` (v0.5 #8, m5). Discount and comp `apply` events carry `alert_id` (v0.5 m4). **Manager's live view, money section (G0-8 (4))** — whichever module builds it (05 with 04) lists voids, discounts and comps with who approved them and the **method**, joined to the money effect by the `alert_id` on the effect events (v0.5 #7, m4); answers with `method: 'in_person'` are marked as such, with the device and the requester (from `RequestAnswered` and the request's subject; v0.4 #8, M3); answers with `RequestAnswered.on_requester_device = true` (any method) are flagged **"approved on the requester's device"** (v0.5 #2, N2); and **failed PIN attempts on requests** are listed per request from `RequestPinFailed` on `audit` (answerer named, device, requester, time, `outcome`; v0.5 #7, m4; v1.0 #1); and **every personal notice** (`approval_receipt`, `answered_on_requester_device`, `pin_use_failed`) is listed with its **state** (open, or closed `done` and when) and **who saw it on which device and when**, from `AlertSeen` on `audit` (`staff_id`, `device_id`, time), including seens from the answering seat that did not close it — "seen by Imran on Tablet 3 at 9:12 AM" (v1.0 #2, R2: a dismissal by someone holding the PIN shows to whoever reviews the day).

**To 01a** — points and the `point` resolver; zones and `zone_order_taker`. **As built (AD-123, ruled; approved 2026-11-02, applied as 01a v2.0.1):** 01a §6.21 `GET /admin/queries/config-status` gains `stuck_alerts: int` (the count of stuck alerts, §3.5) and goes from 2 to 3 statements; `ConfigStatusResponse` (`packages/events/src/admin/hub.ts`) gains the field, **required** (final review m-2; `.default(0)` is the alternative); the `/admin/stock` More menu shows "Stuck alerts: N" while N > 0. Applied in 01a v2.0.1 §6.21.

**To 01b** — scoped `approve-discount` / `approve-comp` are post-pilot (§12.4).

> As built (developer decisions, 2026-11-02): the four carried rows below are added with the v1.1 approval.

**To the Pulse pass** — reconcile `pulse-staff.css` with the shared kit (AD-A–C: the staff layer as its own stylesheet scoped under `:where(.pu)`; approved for now).

**To 01e and 9b** — an exact tablet header source: an additive frame on presence or session change, so the header follows the hub's `binding_route_until` without the 9a approximation (AD-T42-2, approved as approximate); needed once 01e can mark people absent.

**To 04** — the blocked manual checks of `docs/plans/01d-manual-checks.md`: 1b (urgent request on a tablet), 4 (PIN lockout on answers), the urgent / action / silent sounds (8.3–8.6) and the request screens of check 7; run with 04's first request kind (§4.4, §12.7 (c)).

**To 02 / 01e** — the batch 9a data gaps (§12.7 (e)), each an additive field or frame: test-alert lists without no-PIN staff and devices (AD-T41-7); the approver name in B02 / D03 (AD-T41-3); the sender in the receipts header and the tenant / device name in the brand block (AD-T41-13). The 79 English strings stay in `docs/design/handoff/01d/urdu-todo.md` for the Urdu review.

### 4.4 Stubbed until another module lands

| Target / kind | Stubbed until |
|---|---|
| `table_team` (G1-11) | 02a `tableTeam` (⚠️ 02a v1.0 D-1; was 02 `tableOwner`) |
| Zone order-taker fallback (G1-11d) | 01a zones + 01b zone assignment + 02 `zoneOf` |
| `point`, point tablets in `always_on` (G1-12), and the `point` step target `from_value` (§3.4) | 01a points + 00 `point_id` column (lands with the points) |
| `table_team` and `zone_order_taker` step targets `from_value` (§3.4) | 02a `tableTeam`; 01a zones (v2.2) + 02a `zoneOf` (⚠️ 02a v1.0 D-1) |
| "Point with no bound device online → manager told" (G1-12d) | 01a points; delivered with 01e device health (G0 G7) |
| Pager route | 01e |
| Void approval | 04 |
| Discount / comp approval | 05 (discount), 02 / 05 (comp) |
| Table handover accept | 02 |
| Zone-stock transfer | 01a zone stock + 02 |
| Ready to serve, Handover close, Served card | 03b (⚠️ Changed by 02a v1.0, D-2: the Served card is 03b's, it fires at Handover) |
| Call waiter, table handover | 02a (02a v1.0 §6.14, §6.15) |
| Slip warning | 03a (target `{ kind: 'person', staff_id }` from 02's `tableOwners`, N-2) |

**Live at 01d ship:** `test_alert`, `request_result`, `no_approver`, `answered_on_requester_device`, `approval_receipt`, `pin_use_failed`; request rules proven with a **test kind** in the test suite (§10), not in production.

> As built (manual checks, task 43): so no request, urgent alert or action alert can be raised on a running hub before 02 / 04 ship a request kind; every shipped kind is `info`. The manual checks that need one are blocked (§12.7).

### 4.5 Changes to other specs (R26) — approved with v1.0 and applied

**Approved** with this spec (developer, 2026-11-01) and **applied by version bump**, each with a changelog entry and "Changed by 01d v1.0" markers: README and CLAUDE.md (R-1–R-9, R34), `00_Foundation_Spec_v1.8.md`, `00_Hub_Platform_Access_Spec_v1.6.md`, `01b_Staff_Roles_Spec_v1.4.md`. The old version files stay as history. H-11 (00's endpoint budget rule) was decided at approval by the developer.

> As built (v1.1): the rows below are unchanged; the as-built notes after the C-00 and C-01b tables record how the build met them. Those notes change contracts other modules read; they were approved by the developer on 2026-11-02 (§1 "Contract changes") and applied as 00 v1.6.1, 01a v2.0.1 and 01b v1.4.1.

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
| R-8 | **R6** (v0.4 #11, M11): "2,000 orders per day per branch (≈ 40,000 events per day)" → "2,000 orders per day per branch (≈ 75,000 events per day: ≈ 45,000 on the streams the engine replays, ≈ 30,000 01d receipts on `audit`, 01d §5.3)". Carried row "03a — Size snapshots and replay for 2,000 orders/day/branch (≈ 40k events/day)" → "(≈ 75k events/day, ≈ 45k on replayed streams; replay reads only the stream types the engine uses, foundation §5.8 step 3 as changed by 01d F-9)". |
| R-9 | **Spec size budget** (v0.5 m11, with C-00 H-11): add "For 00, the ~30 applies to the cloud access part (00 §6.33)". |

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
| F-7 | §6.5 | After the hub → device list, add: "**Alert frames** (01d): `alerts_open`, `alert`, `alert_seen`, `alert_closed`. They are sent after commit, are not events and are outside the `seq` stream (no gap logic); \"only committed events are pushed, in strictly ascending `seq`\" applies to `event` frames." After the device → hub list, add: "`{ \"type\": \"receipt\", \"alert_id\": \"…\", \"kind\": \"delivered\", \"step\": 1 }` (01d) records a delivery fact; it is not a command (§6.3 rule 7 unchanged)." |
| F-8 | §5.2 diagram | Box "Fire scheduler (setInterval 500ms)" → "Hub tick (500 ms, 01d `registerTick`): fire scheduler (03a) and alert steps (01d), each in its own transaction". |
| F-9 | §5.8 step 3 (v0.4 #11, M11) | "`SELECT * FROM events WHERE branch_id = ? AND seq > snapshot.last_seq ORDER BY seq ASC`" → "`SELECT * FROM events WHERE branch_id = ? AND seq > snapshot.last_seq AND stream_type IN (<the stream types the engine reducers use>) ORDER BY seq ASC`, served by an index on `(branch_id, stream_type, seq)` (03a adds it if `events_stream` does not serve it). `audit` events (01d receipts, ≈ 30k / day) are not replayed into `EngineState`." The exact stream list and the index are 03a's (§4.3 To 03a). |

> As built (AD-4, ruled): F-6 and F-7 list four alert frames; the build adds a fifth server frame, `binding_route` (§6 batch 3). The foundation text needs the same addition at its next bump.

**C-00 Hub Platform & Access v1.5 → v1.6**

| # | Section | Change |
|---|---|---|
| H-1 | M12, §6.21 | `auth` frame: `session_token` optional. Without it → **alert mode** (device types `tablet`, `cashier_kiosk`, `kds`, `phone`; device valid, not revoked): sends `alerts_open`, then only `alert` / `alert_seen` / `alert_closed` frames; accepts only `receipt` frames (any other frame → close `4401`); no catch-up, no event frames; closed `4403` / `4401` on `DeviceRevoked` / `DeviceTokenRotated` by an after-commit check on those two events (no frame sent first). **Alert-mode sockets are kept in a separate list**, never passed to `deliver()`, `registerEventAudience` audiences or `registerCatchUp` parts, so the §4.2 socket context `{ deviceId, deviceType, sessionId, kind, staffId, stationId, asOfSeq }` is unchanged. Keepalive as today. Session sockets (staff and station) additionally accept `receipt` frames after auth (today only `ack` is read, `apps/hub/src/ws/server.ts`). **One alert-mode socket per device** (v0.4 #12, m4): a new alert-mode auth closes the device's existing alert-mode socket `4409`, logged `{ device_id, old_remote_address, new_remote_address }`. |
| H-2 | §6.21 and `packages/events/src/ws.ts` (foundation §6.5 text: C-F F-7) | `WsServerMessage` adds `alerts_open`, `alert`, `alert_seen`, `alert_closed`; `WsClientMessage` adds `receipt`, and the `auth` variant's `session_token` becomes optional (§6 batch 3). Staff-session sockets also get `alert` / `alert_seen` / `alert_closed` (G1-21.5); station sockets get device-target alerts (01d §6 batch 3). |
| H-3 | §4.2 `defineCommand`, §3.7, §3.5 | **`'checked-in-handler'` marker.** §4.2 text "`permission` may be `null` only when `stationScoped` and the command is never allowed to staff" **stays**; add: "A staff command whose right depends on the payload declares `permission: 'checked-in-handler'`. The registry accepts that marker **only** for the commands in `HANDLER_CHECKED_COMMANDS = ['AnswerRequest', 'WithdrawRequest', 'MarkAlertsSeen']`; any other command declaring it → startup error. Such a command needs a staff session (station → `403 PERMISSION_DENIED { session_kind: 'station' }`); `ctx.permission = null`; the handler runs its own right check before writing, and a test per listed command proves an unauthorised call writes nothing (01d test 33)." New optional **`pinCheck(payload, ctx) → { staff_id, pin, field } \| null`**: §3.7 gains a step **after** "idempotency fast path" and "payload Zod": when `pinCheck` returns a value, the pipeline calls the existing `checkPin(…, { staffId, pin, subject: device, eventDeviceId }, …)` (`apps/hub/src/auth/pin.ts`). Same counters, events and errors as §3.5 steps 2–9, including `404 STAFF_NOT_FOUND` (not counted) and `503 SERVICE_UNAVAILABLE`. **`preRead(db, payload, ctx)`** (optional, v0.4 #8; v1.0 #1, R1): run read-only after payload Zod and **before** `checkPin` (and before argon2); it runs the command's own checks **and the read-only part of `prepare`** (01d: the rules, the M39 session re-check and the kind's `apply` on a read-only view); a `DomainError` from it is returned at once with no PIN verified and nothing counted. **`checkPin` gains optional arguments (v0.5 #1, N1; v1.0 #1, R1):** **`prepare(tx) → P`**, run inside its transaction after the lock checks and **before** the match / mismatch branch, on a **read-only transaction view** (`append` / `onCommit` throw; a non-`readonly` statement throws); **`onMatch(tx, P)`** (match and `prepare` succeeded: reset the staff counter, append); **`onMismatch(tx) → EventDraft[]`** (mismatch and `prepare` succeeded: count as today, append the drafts — 01d: `RequestPinFailed { outcome: 'pin_invalid' }` — then `401`); **`onPrepareFailed(tx, error, matched) → EventDraft[]`** (`prepare` threw: **in the same transaction, for both PINs**, count one failure on the staff and the subject counters exactly as a mismatch, including the lockout events at the threshold, and append the drafts — 01d: `RequestPinFailed { outcome: 'answer_failed', error_code }`, plus `pin_use_failed` to the PIN owner **only when `matched`**; commit; then rethrow `error`). `IdempotentReplay` from `prepare` is not a failure: the stored response is returned, nothing counted. So both PINs give the same status, the same counter delta and one write transaction on every path, and a verified PIN always ends in a recorded answer or a counted failure. For a `pinCheck` command the pipeline splits its `writer.run` body: `prepare` = idempotency re-check, M39 re-check, permission, `handle` (01d's handlers only return drafts); `onMatch` = append and `processed_commands`. The existing catch that resets the counter after a failed `onMatch` (`pin.ts:113`) is kept only for a failure inside `onMatch` itself (append); it then logs and returns the original error (BF-2). **Test hook** `testHooks.betweenVerifyAndWriter`, between argon2 `verify` and `writer.run` (`pin.ts:70–75`), like `betweenGuardAndWriter` (`route.ts:92`) (v0.5 m10). v0.4's `precheck` and v0.5's `onMatchRefused` (second transaction) are replaced. Existing callers (sign-in) pass none of these and behave as today. |
| H-4 | §4.2 | New exports `ws.sendToDevices(device_ids, frame)` and `ws.sendToStaff(staff_ids, frame)` (after commit only; `sendToDevices` reaches every socket of the device — staff, station and alert mode), used by 01d; and **`ws.connectedSessions() → Array<{ staffId, deviceId, sessionId, kind }>`** (v1.0 #6, m7): the session sockets currently open, read from the in-memory list (`apps/hub/src/ws/server.ts`), no statement; used by 01d's screen route, binding rule (a), the G1-9d shortcut's route test, `alert_closed` to people who may answer a request, and the `hidden_from` filter (01d §3.4.3, §3.10, §6 batch 3). |
| H-5 | §8.1, new §6.36–§6.38 | **Tablet app update, pilot minimum (G1-15).** §8.1 adds: "Background service holding the alert connection (01d §8.2); silent update from the hub (§6.36–§6.38)." New endpoints: **§6.36 `GET /app/android/latest`** — device token (guards §3.9), device type `tablet` (v0.5 m8: the cashier runs Windows Chrome / Edge, foundation §1, D56), else `403 DEVICE_TYPE_NOT_ALLOWED`; `200 { data: { version_name, version_code, sha256, staged_device_id \| null } }` = the newest release **this device may install**: the newest release if its `staged_device_id` is null (marked good) or equals the calling device; otherwise the newest release with `staged_device_id` null. No such release → `404 ROUTE_NOT_FOUND`. 1 statement on `app_releases`. The app installs when `version_code` > its own (01d §8.4 windows). **§6.37 `GET /app/android/<version_code>.apk`** — same auth; streams the file (`application/vnd.android.package-archive`); unknown version → `404 ROUTE_NOT_FOUND`. **§6.38 hub CLI** `pnpm --filter hub app-release add <apk> --version-code N --version-name X --stage <device_id>` (copies the APK into `<data_dir>/apk/`, writes `sha256`, keeps the newest 2 good versions plus the staged one, deletes older files) and `app-release mark-good <version_code>` (sets `staged_device_id = null`, releasing it to every tablet). State: hub table `app_releases (version_code INTEGER PRIMARY KEY, version_name TEXT NOT NULL, sha256 TEXT NOT NULL, staged_device_id TEXT, added_at INTEGER NOT NULL)` in 01d's migration `0006` (no event: an installation action, logged by the CLI). Nothing else in the pilot (no rollout percentage, no per-device history). (00, Q5.) |
| H-6 | M38 / R14 | Personal phones browser-only for alerts in the pilot (text only; no code change). |
| H-7 | §4.2 `registerCatchUp` | "`{ part, appliesTo(socketCtx), build(db, state) }`" → "`{ part, appliesTo(socketCtx), build(db, state, socketCtx) }`; the third argument is the same socket context given to `appliesTo` (additive: existing parts ignore it)". `apps/hub/src/ws/catch-up.ts` passes `socket` to `build`. Used by 01d's `alerts` part (open alerts for this person and device). |
| H-8 | §7.3 Timers; M66 | Timers table adds: "Hub tick — 500 ms — registered ticks (`registerTick`, 01d §3.5), each in its own transaction, opened only when `due`" and "Receipt flush — 1 000 ms or 100 receipts — 01d §3.6; skipped when the buffer is empty". Session sweeper row adds: "each run (sweep, then retention) is wrapped in try/catch; an error is logged `{ timer: 'sweeper', error }` and the next run continues" (`apps/hub/src/auth/session-sweeper.ts` `startSweeper`). |

| H-9 | M47, §3.7 pipeline note, §4.1 / §5.1 `processed_commands.payload_hash` (v0.4 #9, M4) | "`payload_hash` = SHA-256 hex of the canonical JSON … of `payload`" → "… of `payload` **with the field named by the command's `pinCheck` removed** (`AnswerRequest`: `pin`; commands without `pinCheck`: the whole payload, unchanged). A PIN never enters `processed_commands`." M19 / M47 replay still matches on `command_id`, device (or admin `session_id`), command type and this hash; a replay that differs only in the PIN replays the stored response (no new effect). The SQL comment on `payload_hash` in `0001` is unchanged in the merged migration; the rule lives in `apps/hub/src/lib/hash.ts` and the pipeline. |
| H-10 | §8.1, §8.5 (v0.4 #9, M4) | §8.5 adds: "**PIN-bearing commands are online-only.** A command whose payload carries a PIN (`AnswerRequest` with `method: 'pin'` or `'in_person'`) is never written to the device command queue (Android SQLite, cashier IndexedDB, foundation §1 / D56); the client sends it only while connected, holds the PIN in memory until the response arrives, and on a network error shows \"No connection to the hub — try again\" and discards the PIN." §8.1 Token storage line adds "PINs are never persisted on the device". |
| H-11 | §6.33 Endpoint count (v0.4 #11, M11; text v0.5 m11) | The §6.33 count becomes: "Hub: 6.1–6.4, 6.6–6.21, 6.29–6.32 = 24, plus **6.36–6.37** (tablet update, added by 01d v1.0 H-5) = **26**. Cloud: 6.5, 6.22–6.25, 6.28 = 6. **32 endpoints**; plus 4 CLIs (6.26, 6.27, 6.34, 6.38). The split rule applies to the cloud part only: any further **cloud** endpoint splits the cloud access part (6.5, 6.22–6.28, cloud CLIs) into its own spec. Hub endpoints that this spec owns stay here even when another module's spec adds them; endpoints a module spec owns are counted in that spec (as 01b's change-password)." (6.37 checks the device token and type, so it is counted, unlike the static `GET /ui/*`, M81.) With C-README R-9. **Needs the owner's decision** (it changes 00's budget rule). |
| H-12 | §5.1 Hub tables (v0.4 #11, M11) | Add the 00-owned table `app_releases (version_code INTEGER PRIMARY KEY, version_name TEXT NOT NULL, sha256 TEXT NOT NULL, staged_device_id TEXT, added_at INTEGER NOT NULL)`: "created in 01d's migration `0006` (H-5); owned by 00 (§6.36–§6.38); written only by the hub CLI; not a projection". |
| H-13 | §6.17 Q8 "last seen", M40 note (v0.4 #11, M11) | "last-seen is refreshed by every device-authenticated request and by each WebSocket pong" → "… and by each WebSocket pong, **including alert-mode sockets** (01d, H-1): a tablet holding only its alert connection, with no session, counts as seen in device health". (Alert-mode sockets use the same `armKeepalive`, `apps/hub/src/ws/server.ts`.) |
| H-14 | §5.1 Hub tables, `staff_sessions` (v0.5 #6, N6) | Add the index `staff_sessions_staff_activity ON staff_sessions (staff_id, last_activity_at)`: "created in 01d's migration `0006`; serves 01d's last-activity read (01d §3.4.3 (c)); 00 owns the table, and the index changes no 00 behaviour". |

**As built against C-00 (v1.1; approved 2026-11-02, applied as 00 v1.6.1):**

> - H-1 / H-2 (AD-4, ruled): alert-mode sockets also receive `binding_route`; `WsServerMessage` has **six** alert-related server frames (`alerts_open`, `alert`, `alert_seen`, `alert_closed`, `binding_route`, plus the existing ones). (AD-30, proposed:) `4409` stays a local constant; (AD-31, proposed:) guards close a socket `1011` (local constant) when a builder throws. (AD-19, proposed, superseded:) the interim `4401` for a missing `session_token` was replaced by alert mode.
> - H-3 (AD-10, proposed): `preRead(db, payload, ctx)`, the 00 §4.2 form. (AD-24:) the early replay peek for `pinCheck` commands, §3.3 rule 4 (a). (AD-25:) `authGen` is captured before the session check (at most one extra M39 re-check). (AD-26:) the hooks ctx is built on the writable transaction with `permission: null`. (AD-27:) PIN commands share `authSemaphores(app).pin` with `/auth/pin`. (AD-94:) both `pinHooks` gain a trailing `cmd: PosCommand` argument (only `cmd.command_id` is read, for the `pin_use_failed` dedupe key); `checkPin` is unchanged. (AD-21:) the read-only view blocks `exec`, `pragma`, `transaction` and requires `readonly && reader`. (AD-67:) `engine-host/read-only-tx.ts` exports `rawDbOf(view)`, used only as a map key by `bindAlertEnv`, never handed to kind code. (AD-20:) BF-2's log line is `{ err, phase: 'onPrepareFailed' }`. All proposed.
> - H-4 (AD-74, proposed): `WsHub.sendToSessions(sessionIds, frame)` is added (alert frames are per recipient and hiding is per session).
> - H-5 (AD-34, proposed): `/app/*` uses the `admin-device-public` route group (host, provisioned, guest, device: exactly the §3.9 set), not `device`, whose client-version guard would give an outdated tablet `426` on the endpoint it needs to update; a dedicated group name can be chosen at approval. (AD-35, proposed:) the CLI runs as `tsx src/app-update/cli.ts` (`pnpm --filter @pos/hub app-release`); the hub has no build step.
> - H-8 (AD-28, AD-29, proposed): the sweeper logs `{ timer: 'sweeper', err }` (pino serializes an Error only under `err`), and `startSweeper(deps, log)` takes a logger (one call site, `lib/boot.ts`). Final review m-5: a throw in `purge` now re-runs 00's and 01d's purge every 15 s for the rest of the maintenance hour (see §5.1 and the draft notes).
> - Not in v1.0 (AD-T41-1, unattended — developer to confirm): the hub's `/staff/` serving adds `<meta>` `pos-tenant-id`, `pos-branch-id`, `pos-branch-name`, `pos-hub-now-ms`, `pos-hub-utc-offset-ms` to `index.html` on each request (`registerClientDist({ indexMeta })`): ids and the clock only, no secret, as `/admin/approve` already embeds tenant and branch ids (00 M79). `/staff/` uses route group `admin-page`, like `/admin/stock/`.

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

> As built against C-01b (v1.1; approved 2026-11-02, applied as 01b v1.4.1): (AD-32, proposed) a `no_pin_staff` entry whose `staff_id` is already in `staff`, or that appears twice, is **skipped** with skip reason `{ kind: 'staff', reason: 'duplicate staff' }`, as the existing repeated-`staff` skip (B18: one bad entry does not block the apply; no event-schema change). (AD-33, proposed:) `leadOf` is defined for `staff` entries; a no-PIN entry's lead is read through `noPinStaff()` (nothing in 01d walks upward from a no-PIN person). The B-5 bound (≤ 27) is met as measured. The cloud comment in `hub-registration/repository.ts` still says 8 statements and "staff with no PIN are not sent" (final review m-4, a stale comment).

Not in this bump: `tap-for-station`, `mark-served`, zone assignment, `manage-zone-stock` (carried to 01b by 02 / 03a / 03b); `pager_ids` (01e).

**C-01a:** none (v0.2 #3: pilot values are constants, A14). *As built (AD-123, ruled):* the build adds `stuck_alerts` to 01a §6.21 `config-status` (§4.3 To 01a); approved 2026-11-02, applied as 01a v2.0.1.

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
  next_due_at         INTEGER,              -- min(next undue step, raised_at + closes_on.after_ms); null = nothing pending (M1), or stuck (AD-123)
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
  moved_to   TEXT,                            -- "Moved to Bilal" (G1-11c), set when a later step drops this person: the first person staff_id of the new step (AD-42)
  PRIMARY KEY (staff_id, alert_id)
);
-- retention: ON DELETE CASCADE from alerts scans the child table once per parent row without it (AD-161)
CREATE INDEX alert_inbox_alert ON alert_inbox (alert_id);

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

CREATE TABLE device_bindings (                -- §3.7; no row for a kiosk or KDS (BF-3)
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
```

> As built (AD-161, ruled): `CREATE INDEX alert_inbox_alert ON alert_inbox (alert_id);` is added, in `0006_alerts.sql` itself (0006 is unmerged and never released, so no new migration). Without it SQLite scans `alert_inbox` once per deleted alert: 5.7 s per 500-alert batch at 105 000 inbox rows, about 0.5 s in steady state, 5 ms with the index. `alert_recipients (alert_id)` was already indexed for the same cascade. The SQL comments added above (`moved_to`, `next_due_at`, `device_bindings`) are spec annotations; the migration's comments may differ.

`alert_receipts` and `request_seen` have no foreign key (receipts can arrive for an alert the projection rebuilds later); they are deleted by `alert_id` in the same retention batch as their alert.

**Retention (Q6, v0.3 #7)** in the 00 M66 maintenance hour, in batches of 500, one `writer.run` per batch (events stay):
1. `alert_inbox`, `alert_receipts`, `request_seen` rows of alerts closed before the previous business day.
2. Closed `alerts` rows older than 7 days, oldest first; each batch first deletes `alert_receipts` and `request_seen` of those `alert_id`s, then the `alerts` rows, whose `alert_recipients` and any remaining `alert_inbox` rows go with them (`ON DELETE CASCADE`; `foreign_keys = ON`, `apps/hub/src/db/connection.ts`).
An error in a batch rolls that batch back and is caught and logged by the sweeper timer (C-00 H-8); retention continues next hour.

> As built (AD-158, AD-159, proposed): "before the previous business day" = before the start (`BusinessDayOpened.recorded_at`) of the latest business day that has **closed**; if no day has ever closed, step 1 deletes nothing and step 2 still caps rows at 7 days. So the day that just ended is kept until the next one closes. A batch is 500 rows per table in step 1, and 500 alerts (with their children, in the same transaction) in step 2; one `writer.run` per batch; no event. (AD-160:) each batch's commit drops those alerts' keys from the receipt recorded set (§3.6). Final review m-5 (not ruled): after a failed batch, 00's sweeper retries the purge every 15 s for the rest of the maintenance hour, not "next hour" (see the draft notes).

### 5.2 Projections (`registerProjection`, with `reset`)

| Projection | Events | Writes |
|---|---|---|
| `alerts` | `AlertRaised`, `AttemptSent`, `EscalationStepped`, `StepSkipped`, `RequestAnswered`, `RequestWithdrawn`, `AlertClosed`, `RequestSeen`, `BusinessDayClosed` | `alerts` (`raised_device_id` and `raised_seq` from the `AlertRaised` envelope; `hidden_session_id` / `hidden_device_id` from `AlertRaised.hidden_from`, v1.0 #2), `alert_recipients` (rows **inserted** per step, never replaced; a person with no route is a row too, v0.5 N5), `alert_inbox` (upsert; `moved_to` on people in the previous step but not this one; `RequestSeen` also upserts the seer's row, so a late answerer who opened the request from `requests-to-answer` gets the close, v0.5 N3), `request_seen`; `next_due_at` = min(next undue step time, `raised_at + closes_on.after_ms`), null when neither (§3.5, M1); on `BusinessDayClosed`: `expire_due` on kinds with `expires_at_day_close: true` (§3.5), and `hidden_device_id = NULL` on every open alert that has one (one statement, v1.0 #2). **Reads ≤ 2 statements per event** (alert row by id; previous step's recipients of that alert), never a scan of open alerts (§3.5, M10). *As built (AD-123, ruled):* `next_due_at` = NULL, logged once, when the next step's time or targets cannot be computed (the expiry time when the kind has `after_ms`). *(AD-6, ruled):* an `AlertRaised` of a kind not registered on replay keeps its row with `next_due_at` NULL and logs `unknown_kind`; boot continues. *(AD-42, AD-43, AD-44, proposed):* `moved_to` = the first person `staff_id` of the new step, left unset when the step has no person and reset when the person returns; `StepSkipped` advances `step` (MAX) and recomputes `next_due_at`; the time source is the event's `recorded_at` |
| `alert_flags` | `SessionStarted`, `SessionEnded`, `StaffDirectoryApplied`, `BusinessDayOpened`, `BusinessDayClosed` | `no_approver` dirty = 1 (§3.9; on `StaffDirectoryApplied` the same pass also retires leavers' personal notices, BF-7); `reset` re-inserts `('no_approver', 1)` |
| `alert_receipts` | `AlertDelivered`, `AlertSeen` | `alert_receipts` (INSERT OR IGNORE: the first receipt wins, AD-166) |
| `device_bindings` | `SessionStarted`, `SessionEnded`, `DeviceRevoked`, `BusinessDayClosed`, `DevicePaired` (phones; and the device-type map, BF-3) | `device_bindings` by `session_id` (§3.7 rules); a row with `session_id IS NULL` (phone owner, from `DevicePaired.device_type = 'phone'`) is never touched by session events (m2); **no row is written for a `cashier_kiosk` or `kds` device** (BF-3; AD-46, ruled; v1.0 said kiosk rows were written but never routes); rebuild exact. *(AD-47, proposed):* a device type missing from the map after a restart is read once from `devices` |
| `presence_today` | `PresenceSet`, `BusinessDayClosed` | `presence_today` |

> As built (AD-40, proposed): the alert projections (`alerts`, `alert_flags`, `alert_receipts`, `device_bindings`, `presence_today`) are registered in boot `createDeps` and in the test hub (`registerAlertProjections`), because boot replays projections at step 4, before `registerAlerts` runs at step 5. The P-8 `unknown_kind` line is buffered until `registerAlerts` binds the logger.

**No hook writes events outside its cause's transaction.** `raise`, `close` and `request_result` commit with their cause inside the owning command; everything else that writes 01d events from another module's event (day-close expiry, `no_approver`) is written by the tick from a persisted projection flag (§3.5, §3.9). 00 gains no writer hook (v0.1's `writer.onAppended` dropped, v0.2 #2; it used the number H-7, which v0.3 gives to the catch-up change).

### 5.3 Cloud

No 01d table and no cloud schema change (v0.3: `pager_ids` moved to 01e). Cloud receives 01d events through sync (D52) like every other event; the owner remote view reads them (G0-8, later). `no_pin_staff` is read from existing columns (C-01b B-1, B-5).

**Volume (v0.4 #12, m12), per branch, pilot assumptions (R6):** ≈ 30 000–35 000 `audit` receipt events per day (`AlertDelivered` per step since m5, `AlertSeen`), plus ≈ 5 000 step and close events on subject streams. At ≈ 400 bytes per event row with indexes, ≈ 14 MB per day, ≈ 5 GB and ≈ 12 M receipt rows per branch per year in cloud Postgres (D57 smallest tier). No pilot breakage at one branch. **Carried to 06 / 07:** retention or roll-up of `audit` receipt events in the cloud before a second branch.

### 5.4 Wire shapes (`packages/events/src/alerts.ts`)

`AlertTargetSchema` (discriminated union, §3.4), `AlertStepTargetSchema` (step targets incl. `from_value` and `requester_lead`, §3.5), `AlertDisplaySchema` (`{ table_code?, point_code?, requester_name?, device_name?, kind_label_key }`, lock-safe), `AlertDetailsBase` (`{ item?, quantity?, amount?, reason? }`, signed-in only, §3.12), `AlertViewSchema` (§6.3 frame body; `card` with `details` only under the card rule, §6 batch 3), `ALERT_CONSTANTS` (A14, `@pos/domain`), command payloads (§6.2–6.6).

> As built (v1.1): the shapes as built, all additive.
> - (AD-11, proposed) ids in payloads and views are `z.string().min(1)`, not ULID-checked, because directory staff ids are not ULIDs (e.g. `S_OWNER`); the convention of `packages/events/src/admin/staff.ts`. "`ulid`" in §6.2–§6.6 reads as this.
> - (AD-12, proposed) the display and lock fields are `nullable().optional()`, so both `table_code?` (§5.4) and `table_code: null` (§6 batch 3 example) are accepted.
> - (AD-14, proposed) `AlertStepTargetSchema` kinds are `answerers`, `holders_informed`, `always_on`, `managers`, `requester_lead` as `{ kind }` objects, plus the `from_value` targets; targets that carry an id are refused as step targets.
> - `AlertViewSchema` gains, on the **signed-in** view only (card frames, inbox, catch-up and `requests-to-answer` rows that get the card): `answers`, `needs_pin`, `silent` (AD-23, ruled; on live card frames too, AD-146, proposed), and `raised_device_id` on requests (AD-165, ruled). It gains on every view of a `request_result`, lock and alert-mode frames included: `outcome` (AD-82, ruled). Lock frames and `alerts_open` never carry `card`, `details`, `answers`, `needs_pin`, `silent` or `raised_device_id` (strict schemas; a test asserts it).
> - Query and catch-up rows: §6.7–§6.10 and §6 batch 3 (AD-13, AD-22, AD-138, AD-141, AD-150, AD-153).

---

## §6. Endpoints, commands and frames

All hub routes follow foundation §6.3 and 00 §3.7. `actor_id` = the session's staff. Query counts are fixed.

> As built (AD-11, proposed): "`ulid`" in the payloads below is validated as a non-empty string (§5.4).

### Batch 1 — internal API (no route)

#### 6.1 `alerts.raise`, `alerts.close` (§4.2)

| | |
|---|---|
| Called from | an owning module's command `handle`, a tick intent, or 01d's own hooks |
| Processing (`raise`) | (1) kind registered, else startup-time `Error`. (2) `(kind, dedupe_key)` open (`alerts_open_dedupe`), or already returned by an earlier `raise` in this transaction (§4.2)? → return `{ alert_id: <that one>, deduped: true, events: [], requester_staff_id }`. (3) `values` by `values_schema`, `details` by `details_schema` (§3.12) → else `VALIDATION_FAILED { issue: 'values_invalid' \| 'details_invalid' }`. (4) `alert_id = ids.next()`. (5) Request part: `approval` → `input.request.approver_role_ids` required (copied into the payload for the record; `ctx.permission` is never read, v0.4 m7); `named` → `receiver_staff_id` required. (6) Resolve step 0 (§3.4). (7) Return `[AlertRaised, AttemptSent(step 0)]`, or, for a kind with `right.mode = 'approval'` whose step-0 answerers have no route, the G1-9d shortcut drafts `[AlertRaised, StepSkipped 'shortcut' for each step before the first escalation step, EscalationStepped(that step)]` (§3.5, v1.0 #4, m4). Post-commit sends happen through 01d's after-commit hook on `AttemptSent`. *As built (AD-69, proposed):* `details` sent to a kind with no `details_schema` → `VALIDATION_FAILED { issue: 'details_invalid' }`; errors carry `kind` and field paths, never values. *(AD-68):* an appended `AlertClosed` frees its dedupe key in step (2). *(AD-71, superseded by AD-95):* `hidden_from` from the input, else null |
| Processing (`close`) | read the alert; closed (or unknown, AD-73) → `[]`; else `[AlertClosed]` (+ `request_result` raise for a request closed `obsolete` / `overridden`). `closeMany`: one read for all ids, one `raiseMany` for the results (v0.5 #8) |
| Queries | raise: 1 dedupe read + `batchReads` for step 0 (sessions, bindings, devices, presence, activity: 1 statement each, cached per transaction; R resolvers; T routes) = ≤ 6 + R + T; directory in memory. `raiseMany` / `closeMany`: the same count for N alerts (v0.5 #8, m5) |
| Errors | `VALIDATION_FAILED { issue: 'target_unavailable' \| 'values_invalid' \| 'details_invalid' }` (unregistered resolver; values or details not matching the kind's schemas) |

### Batch 2 — commands and queries

#### 6.2 `POST /commands/answer-request` — `AnswerRequest`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); staff session required; right check = §3.3 rules 5–6 |
| Payload | `{ alert_id: ulid, decision: 'approve' \| 'reject' \| 'accept' \| 'decline', method: 'session' \| 'pin' \| 'in_person', answerer_staff_id?: ulid (required iff in_person), pin?: string matching /^\d{4,6}$/ (required iff pin / in_person; 01b §3 rule 4, 00 §6.8 / §6.9; v1.0 #7, m16) }`. A value outside the pattern → `400 VALIDATION_FAILED` from payload Zod, before `preRead`: no PIN verified, nothing counted |
| `preRead` | read-only, after payload Zod, **before** `pinCheck` and argon2 (§3.3 rule 4 (b), H-3): 1 statement (alert row), directory and session state in memory, plus the kind's `apply` reads; in order: rule 1 (`404` / `409`), decision in the kind's `answers` (`400`, v0.5 #1), rule 3 (`422`), in-person answerer in the directory with a PIN (`404 STAFF_NOT_FOUND`, v0.5 m2), in person only on the raising device (`403 in_person_elsewhere`, v1.0 #2), rule 5 (`403 self`), rule 6 (`403`), the M39 session re-check, `kind.apply` on a read-only view (its error; drafts discarded; v1.0 #1) — no PIN verified, nothing counted. *As built (AD-89, proposed):* the M39 reads (`devices`, `staff_sessions`) are added only when the auth generation moved since the session check; (AD-92) the station, staff and M39 refusals give the same response as `authorize` |
| `pinCheck` | `method ∈ pin, in_person` → `{ staff_id: in_person ? answerer_staff_id : session staff, pin, field: 'pin' }` (00 §3.5 via H-3; `field` is removed from the payload before hashing, H-9); runs after `preRead`, before `writer.run`; with `prepare(tx)` = Processing steps (0)–(9) below (read-only view, returns the drafts), run **before** the match / mismatch branch; `onMismatch(tx)` = `[RequestPinFailed { outcome: 'pin_invalid', error_code: 'PIN_INVALID' }]`; `onPrepareFailed(tx, error, matched)` = `[RequestPinFailed { outcome: 'answer_failed', error_code: error.code }]` plus, when `matched` (and not `pin` + `REQUEST_NOT_PENDING`, BF-1), the `pin_use_failed` raise to the PIN owner (§3.10; guarded, AD-99) — in the one transaction that also counts the failure for both PINs, then the `prepare` error is returned (§3.3 rule 4 (d), v1.0 #1, R1); `IdempotentReplay` → the stored response, nothing counted |
| Processing | inside `writer.run` (authoritative; the same checks as `preRead`; for a PIN method, steps (1)–(9) are `prepare` and (10) is `onMatch`): (0) idempotency and M39 re-checks (00 §3.7). (1) alert row → `404 ALERT_NOT_FOUND`; no request part → `404 ALERT_NOT_FOUND`. (2) state open → else `409 REQUEST_NOT_PENDING`. (3) decision ∈ the kind's `answers` → else `400 VALIDATION_FAILED`. (4) PIN rule (§3.3 rule 3) → `422 REQUEST_PIN_REQUIRED`; `in_person` on a device other than `raised_device_id` → `403 PERMISSION_DENIED { reason: 'in_person_elsewhere' }`. (5) Self, right, range (§3.3 rules 5–6) → `403 PERMISSION_DENIED { reason }`. (6) `RequestAnswered` draft, with `on_requester_device` (`device_id` = the alert's `raised_device_id`). (7) `kind.apply({ ...ctx, alert }, answer)` (typed, §3.5) → its drafts (DomainError → the error to the answerer, nothing written, A4; a non-`DomainError` → `500`, nothing written, AD-93). (8) `request_result` alert to the requester (`raise`). (8a) money kind (`needs_pin: 'always'`) → `approval_receipt` to the answerer (`raise`, §3.10, any method, `hidden_from` = this session and device, v1.0 #2). (9) `on_requester_device` → `answered_on_requester_device` alert to the answerer (`raise`, §3.10, any method, `hidden_from` as (8a), v0.5 #2). (8)–(9) are one `raiseMany` (AD-103). (10) Append the drafts; commit; post-commit `alert_closed` to every recipient of every step (cumulative), the requester's sockets and the connected staff sockets of people who may answer it now (§6 batch 3, v0.5 #3). |
| Result | `{ alert_id, decision, answered_at }` |
| Idempotency | `command_id` (00 M19); a retry after success replays the stored 200 (for a replay with no valid token for the device: `401`, AD-24) |
| Race | two answers: both commands serialise in `BEGIN IMMEDIATE`; the second sees state closed → `409 REQUEST_NOT_PENDING { answered_by_name }` (test 6). Answer vs. `alerts.close`: same. |
| PIN storage | the PIN is never in `payload_hash` (H-9), `processed_commands`, events or logs; the client never queues this command when it carries a PIN (§8.1, H-10) |
| Errors | `400 VALIDATION_FAILED` (payload; decision not in the kind's `answers`), `401 PIN_INVALID`, `403 PERMISSION_DENIED { reason }` (incl. station session; `in_person_elsewhere`, v1.0 #2), `404 ALERT_NOT_FOUND`, `404 STAFF_NOT_FOUND` (in person, unknown answerer; from `preRead`, m2), `409 REQUEST_NOT_PENDING`, `422 REQUEST_PIN_REQUIRED`, `429 PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT`, `503 SERVICE_UNAVAILABLE` (argon2 semaphore), plus the kind's `apply` errors |
| Queries | `preRead` (outside the lock): 1 alert read + the kind's `apply` reads; inside: 1 alert read, 1 `resolve` (memory), team walk in memory, writes; the `request_result`, `approval_receipt` and `answered_on_requester_device` raises are one `raiseMany` (7 statements with no resolver or route, within the bound of 9; AD-103, proposed); a PIN mismatch: `checkPin`'s statements + the `prepare` reads + the `RequestPinFailed` append; a failed `prepare`: the same transaction counts and appends `RequestPinFailed`, and on a match adds the `pin_use_failed` raise (≤ 6 + R + T, no second transaction, v1.0 #1) |

#### 6.3 `POST /commands/withdraw-request` — `WithdrawRequest`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); right check = requester only |
| Payload | `{ alert_id }` |
| Processing | alert → 404; open → else 409; session staff = requester → else `403 { reason: 'not_requester' }`; append `RequestWithdrawn` + `kind.onWithdraw({ ...ctx, alert })` events; post-commit `alert_closed` to every recipient of every step. *As built (AD-105, proposed):* no `preRead`; `handle` (1 statement) is authoritative, since there is no PIN |
| Result | `{ alert_id }` |
| Idempotency | `command_id` (00 M19) |
| Errors | `400`, `403 PERMISSION_DENIED { reason: 'not_requester' }` (or station session), `404 ALERT_NOT_FOUND`, `409 REQUEST_NOT_PENDING`, plus the kind's `onWithdraw` errors |
| Queries | 1 alert read, writes |

#### 6.4 `POST /commands/mark-alerts-seen` — `MarkAlertsSeen`

| | |
|---|---|
| Permission | `'checked-in-handler'` (H-3; listed); right check = only ids in the person's own inbox, or open requests the person may answer now, are acted on |
| Payload | `{ alert_ids: ulid[1..50] }` |
| Processing | one statement reading `alerts` for the ids, left-joined to the person's `alert_inbox` and `request_seen` rows; ids that are neither in the person's inbox nor open requests the person may answer now (§3.3 rules 5–6, in memory; v0.5 #3, N3) are ignored (no error, no leak). For each open request alert not yet in `request_seen` for this person → append `RequestSeen` (same transaction); post-commit `alert_seen` frame to the person's devices (§3.6). For each open `closes_on: 'seen'` alert → `AlertClosed 'done'`, **unless** the alert's `hidden_session_id` is this session or its `hidden_device_id` is this device (the answering seat, §3.10, v1.0 #2): then nothing closes, and the id is still acted on for the receipt. Queue `AlertSeen` for every id with `tx.onCommit` (buffer, A11; nothing is buffered if the command rolls back). *As built (AD-108, proposed):* the command writes `AlertClosed { reason: 'done' }` itself, not through `alerts.closeMany`, which would add a second alert read; none of `closeMany`'s other behaviour applies to these non-request alerts, and the frames come from the event |
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
| Processing | point without a registered resolver → `422 CONFIG_REFERENCE_INVALID { field: 'target.point_id', reason: 'points_not_available' }`; unknown staff / device (or revoked device) → `404 STAFF_NOT_FOUND` / `DEVICE_NOT_FOUND`; `raise('test_alert', subject hub / branch_id, dedupe_key = 'test:' + command_id)` (the alert id is made inside `raise`, so the key uses the command's id). *As built (AD-135, proposed):* a `no_pin_staff` person counts as known (B-1; the team resolver includes no-PIN staff). *(AD-136):* `display` = sender name and target device name |
| Result | `{ alert_id }` |
| Idempotency | `command_id` (00 M19); the dedupe key also makes a retried raise a no-op |
| Errors | `400`, `403 PERMISSION_DENIED`, `404 STAFF_NOT_FOUND` / `DEVICE_NOT_FOUND`, `422 CONFIG_REFERENCE_INVALID` |
| Queries | 1 existence read (staff in memory; device 1 statement) + raise |

#### 6.6 `POST /commands/set-presence` — `SetPresence` (§3.11)

| | |
|---|---|
| Permission | `manage-staff` (§12.3 Q2) |
| Payload | `{ staff_ids: ulid[1..100], present: boolean }` |
| Processing | business day open → else `409 BUSINESS_DAY_NOT_OPEN`; ids in neither `staff` nor `no_pin_staff` → `404 STAFF_NOT_FOUND { staff_ids }`; append `PresenceSet` with `business_day_id` = the `event_id` of the open day's `BusinessDayOpened` (§3.11; AD-156, ruled). `present: false` marks the listed people absent, `present: true` clears it; others untouched (AD-157, proposed) |
| Result | `{ business_day_id, staff_ids, present }` |
| Idempotency | `command_id` (00 M19); setting the same value again is harmless (projection upsert) |
| Errors | `400`, `403 PERMISSION_DENIED`, `404 STAFF_NOT_FOUND`, `409 BUSINESS_DAY_NOT_OPEN` |
| Queries | 1 (open business day, and its `BusinessDayOpened` `event_id`), directory in memory, writes |

#### 6.7 `GET /queries/alerts-inbox`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Input | `?cursor&limit` (default 50, max 200) |
| Returns | today's alerts where the person is in `alert_inbox` (and those "for" their reports), plus the person's **open personal notices of earlier days** (§3.10, v0.5 #2), **minus** alerts hidden from this session or device (`hidden_session_id` / `hidden_device_id`, §3.10, v1.0 #2), **open action alerts first**, then by `raised_at` desc: `AlertViewSchema` + `seen_by_me`, `moved_to_name`, `for_staff_name`, **`state`, `close_reason`** (AD-22, ruled). Response: `data.alerts` with `meta.next_cursor` (AD-13). The view is the card or lock view by the card rule (§6 batch 3; AD-163, ruled: a viewer who is only a device target gets lock) |
| Queries | 2 (page of ids by index, then a join for views) |

> As built (AD-139, AD-140, AD-143, proposed): "today" = since the latest `BusinessDayOpened`; with no day ever opened, every row is listed. "Open action alerts first" reads family `action` only (open urgent requests are also in `requests-to-answer`; the owner may prefer `urgent` and `action`). One inbox row per alert: the person's own row first, otherwise the first "for" row (frames still send one card per "for" person). `seen_by_me` is derived (AD-138, §6 batch 3).

#### 6.8 `GET /queries/my-requests`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Input | none (bounded: my open requests plus today's closed ones) |
| Returns | pending requests where `requester_staff_id` = me, plus today's answered / closed ones; each with decision, answerer name, waiting time and `ask_in_person: true` once the escalation step has been sent (`step ≥ 2`: at `approval_branch_ms`, or at once after the G1-9d shortcut, §3.5; v0.5 #4). Response `data.requests`; each `MyRequestRow` also has `raised_at`, `waiting_ms`, `close_reason` and `lock` (AD-13) |
| Queries | 1 (`alerts_requester`) |

> As built (AD-149, proposed; owner to choose): `MyRequestRow` keeps both `raised_at` and `waiting_ms`; if only one stays, keep `waiting_ms`. (AD-151:) "today" = open requests plus those closed since the latest `opened_at`; with no day ever opened, every closed request is listed. (AD-152:) `ask_in_person` is `step ≥ 2` on every row; the client uses it on pending rows only.

#### 6.9 `GET /queries/requests-to-answer`

| | |
|---|---|
| Session | staff, required; `countsAsActivity: false` |
| Returns | **every open request I may answer now**, computed at query time from the open requests and §3.3 rules 5–6 (my right and range, directory in memory), **not from the inbox** (v0.5 #3, N3), with `can_answer: true`: an approver who signs in after the last step (a manager back from a break, a second manager starting the shift) sees every request they may answer, and a `my_team` lead dropped from a later step's list still sees it (M2). **Plus** the open requests where I have an inbox row but may not answer (informed, "for" rows I hold as lead, a right removed after the step), read-only with my latest `set`. Each row is the view + `can_answer` + `seen_by_me` + **`from_business_day`** (AD-13, AD-5) in `data.requests`; `can_answer` rows get the card (with `details`), read-only rows the lock view (AD-162, ruled) |
| Queries | 2 (open requests by `alerts_open_requests`; my inbox rows for open requests) + memory |

> As built (AD-5, ruled; AD-150, proposed; BF-4): `from_business_day` is required and nullable: the business date when the request was raised before the current day's `opened_at` (taken from the latest `BusinessDayOpened` at or before the raise, or the local date of the raise when none exists), otherwise null. One shared SQL fragment with the catch-up. The client lists such rows without sound and marks them "from <date>" (§8.1).
> As built (AD-144, proposed): a late answerer's inbox row (written by `RequestSeen`) has `set = 'answerer'` if `mayAnswer` passes now, else `informed`; a row with `can_answer: true` and `set: 'informed'` → `can_answer` wins. (AD-R-d-2, unattended — developer to confirm:) the device-target check applies here too: a manager on a kiosk that is a device target gets `can_answer: true` with the lock view only, so `answers` / `needs_pin` are absent and the client takes them from the kind.

#### 6.10 `GET /queries/alert-receipts?alert_id=`

| | |
|---|---|
| Session | staff; the handler requires `manage-devices` (`403 PERMISSION_DENIED`); unknown alert → `404 ALERT_NOT_FOUND` |
| Returns | per step: recipients from `alert_recipients` (kept per step, v0.4 M2; a person with no route is listed "no route", v0.5 N5), and routes from the `AttemptSent` / `EscalationStepped` events of the alert's subject stream with `seq ≥` the alert's `raised_seq` (v0.5 m12), filtered to this `alert_id`, so a `hub`-subject alert (`test_alert`, `no_approver`) never reads the stream's older history; delivered (per step) / seen times per person and device from `alert_receipts`. Every receipt names the **device** and, for an alert-connection receipt, the **person it is bound to**: "delivered to device Tablet 3, bound to Ali (not signed in)" (route `alert_connection`) vs. "delivered to Ali on Tablet 3" (route `screen`) (v0.4 #10, M9). For `test_alert` and support. Response: `steps[{ step, recipients[], routes[] }]` and `receipts[]` (AD-13); each recipient also has **`no_route`** and **`for_staff_name`** (AD-153, proposed; lock-safe). **The route shown for a receipt is the first delivered route for that device and step** (first receipt wins, AD-166, ruled) |
| Queries | 4 (alert row, recipients, step events from `raised_seq`, receipts); device names and bindings from memory (00 devices cache) or joined in the receipts statement |

> As built (AD-166, ruled): a receipt is keyed without its route (`alert_receipts` PK), so a second delivery of the same step to the same device by another route adds nothing; the view shows the first. (AD-154, proposed:) `alert_receipts` has no route column; each receipt's route (`screen` / `alert_connection`) is read from its own `AlertDelivered` / `AlertSeen` event inside the receipts statement, first event wins, like the projection's `INSERT OR IGNORE`; still 4 statements. (AD-155, proposed:) `manage-devices` is checked before the alert lookup, so an unknown id gives `403` without the permission and ids cannot be probed; only steps that were sent are listed; a receipt's `at` is the flush time (`recorded_at`, up to about 1 s late). (AD-M2, unattended — developer to confirm:) the view lists short-code routes of a step that were never used (no `short` label, §3.8) and counts them as routed; this affects `test_alert` receipts.

### Batch 3 — WS frames (H-1, H-2)

Server → device:

```json
{ "type": "alerts_open", "alerts": [ { "alert_id": "01JD…", "kind": "test_alert", "family": "info", "step": 0, "lock": { "kind_label_key": "alert.test_alert.lock", "table_code": null, "point_code": null, "requester_name": "Imran" }, "seen_by_me": false, "raised_at": 1761900000000 } ], "binding_route_until": 1761907200000 }
{ "type": "alert", "alert": { "alert_id": "01JD…", "kind": "void_approval", "family": "urgent", "step": 1, "escalation": false, "set": "answerer", "for_staff_id": null, "lock": { "kind_label_key": "alert.void_approval.lock", "table_code": "12", "point_code": null, "requester_name": "Hamza" }, "card": { … }, "answers": ["approve", "reject"], "needs_pin": "always", "silent": false, "raised_device_id": "01JD…", "raised_at": 1761900000000 } }
{ "type": "alert_seen", "alert_id": "01JD…" }
{ "type": "alert_closed", "alert_id": "01JD…", "reason": "answered", "decision": "approve", "by_name": "Imran" }
{ "type": "binding_route", "until": 1761907200000 }
```

> As built (AD-4, ruled): `alerts_open` carries `binding_route_until: number | null` and the sixth frame `binding_route { until }` exists (§3.7). (AD-17, proposed:) an `alerts_open` row is the view minus `card` and the signed-in fields, with `escalation`, `set` and `for_staff_id` optional, `.strict()`. (AD-138, proposed:) `seen_by_me` on `alerts_open` is optional in the schema; the hub always sends it. (AD-18, proposed:) `alert_closed.decision` and `by_name` are nullable, null unless `reason = 'answered'`. (AD-23, AD-165, ruled; AD-146, proposed:) the card frame also carries `answers`, `needs_pin`, `silent` and, for a request, `raised_device_id`. (AD-82, ruled:) a `request_result` frame, lock or card, carries `outcome`.

- **The card rule (one rule everywhere: frames, `alerts` catch-up, `alerts-inbox`, `requests-to-answer`; AD-162, AD-163, ruled).** `card` (full display: label params plus the kind's `details` — item, quantity, amount, reason, §3.12 — and the signed-in fields `answers`, `needs_pin`, `silent`, `raised_device_id`) goes **only** to a viewer who is a **person recipient** of that alert **or may answer it now**, on that person's own staff-session sockets. A viewer who is **only a device target** (`always_on`, `point`, `device`: a kiosk, a KDS, a point tablet) gets `lock` only, whatever its session kind — a KDS's station socket, a signed-in kiosk's cashier socket, or an alert-mode socket. Read-only rows (informed, "for", right removed) get `lock` only. `alerts_open` never carries `card` or `details`. Everything else gets `lock` only (G1-13e). A KDS therefore needs no second socket.
  > As built (AD-81, proposed): the lock frame is built from a `pick` of the allowed view fields plus `.strict()`, so `card`, `answers`, `needs_pin`, `silent` and `raised_device_id` are refused; `outcome` is allowed. (AD-75:) a kiosk cashier socket that is also the person's own staff socket gets lock only.
  > As built (AD-R-d-1, AD-R-d-3, AD-R-d-4, AD-M1, unattended — developer to confirm): (1) a lead's "for Ali" row gets lock (with `for_staff_id` / `for_staff_name`) for **every** kind, not only requests; the lead's own row of the same alert still gets the card. (3) Frames decide "device target" **per step** (a person signed in on a kiosk gets the card at step 0, where the kiosk is not yet a device target, and lock from the step that adds the kiosk; the card already shown is not recalled), while the inbox and catch-up decide it over **all** steps. Unreachable with 01d's kinds; reachable once point-bound tablets exist (AD-M1). (4) For a request, frames decide "may answer now" by `mayAnswer` at send time, which in practice equals `set = 'answerer'` and also gives the card to a request "for" row whose lead may answer.
- **Hidden from the answering seat (v1.0 #2, R2):** no `alert` frame, `alerts_open` row or `alerts` catch-up row of an alert with `hidden_session_id` / `hidden_device_id` goes to that session or to any socket of that device (checked in memory against `ws.connectedSessions()` and the alert-mode list). `alert_closed` is hidden the same way; `alert_seen` is not (AD-78, proposed).
- `alert_seen` (§3.6) goes to the person's staff-session sockets and the alert-mode sockets of devices bound to them; the client stops the urgent repeat for that alert (§8.3).
- Sent after commit, once per step per socket; not part of the `seq` stream (no gap logic). A missed frame is covered by `alerts_open` on reconnect (alert mode; the bound person's part only while the binding is a route, §3.7, v0.5 m7) or the `alerts` catch-up part (staff and station sessions, `registerCatchUp` part `alerts` with the socket context, H-7: open alerts where this person is in `alert_inbox` or this device in any step, plus, for a staff socket, **every open request the person may answer now** (as §6.9; v0.5 #3, N3), each with `seen_by_me`, `from_business_day` and, under the card rule, `card`; 2 statements). The client re-notifies from there (§8.1, m6).
  > As built (AD-76, proposed): one `alert` frame per (socket, `for_staff_id`), so a lead's screen groups per person. (AD-141, proposed:) the catch-up part is `{ alerts: (AlertView + seen_by_me + from_business_day)[] }`; lock-only rows go to device targets and stations, signed-in rows to the person's own rows and to may-answer rows, which are appended after the others. (AD-138, proposed:) `alert_inbox` has no seen column, so `seen_by_me` is derived — from either `request_seen` (requests, exact at once) or an `alert_receipts` `seen` row (buffered, up to 1 s late); false for device-target rows with no person; an open `closes_on: 'seen'` alert always shows false (a valid seen would have closed it; only the hidden seat can have seen it). (AD-5 / AD-150:) `from_business_day` as §6.9.
- Post-commit sends for closes (`alert_closed`) go to the **cumulative** recipients (every device in any step, every person in `alert_inbox`, plus devices bound to them) of **all** alerts closed in the transaction, read in one statement (`alert_recipients` ∪ `alert_inbox` `WHERE alert_id IN (…)`), so a tick that expires 200 alerts at day close issues one read, not 200, and a lead dropped by the escalation step still gets the close (M2). For a **request**, `alert_closed` also goes to every connected staff-session socket whose person may answer it now (§3.3 rules 5–6, in memory over the socket list, no statement; v0.5 #3), so a late approver who saw it only in `requests-to-answer` gets the close.
  > As built (AD-79, proposed): the requester's staff sockets get `alert_closed` for every request close reason, not only `answered` (the waiting UI needs every close; the frame carries no secret). (AD-77:) to a bound device, close and seen frames go on its alert-mode socket only. (AD-74:) per-session sends use `WsHub.sendToSessions`. (AD-80, AD-148:) a frame failure after commit is caught and logged `{ err: { name, code }, alert_id, kind?, step? }`, never the message or stack; a committed write never becomes a `500`.

Device → server:

```json
{ "type": "receipt", "alert_id": "01JD…", "kind": "delivered", "step": 1 }
```

- Accepted on every socket kind; only `delivered`, with the `step` shown (seen needs `MarkAlertsSeen`, §6.4). The hub records `staff_id` = the session staff, or the device's binding in alert mode, or `''` for a device-target alert (and for a signed-out kiosk, BF-3). Unknown alert, an alert this device was not sent, or a `step` above the alert's current step → ignored. **"Sent"** = this device is in any step's `alert_recipients`, or its session staff / bound person is in `alert_inbox`, or it got the alert in `alerts_open` / catch-up (cumulative, v0.4 #6, m3), so a step-1 receipt that arrives after step 2 is still recorded. Repeats are dropped before buffering (§3.6), so no rate limit is kept (v0.3 #12). A receipt for a **closed** alert is accepted (AD-88, ruled).

### 6.11 Endpoint count

5 commands, 4 queries, **6** frame types (`alerts_open`, `alert`, `alert_seen`, `alert_closed`, `binding_route`, `receipt`; AD-4, ruled — v1.0 had 5), 1 catch-up part, 13 hub exports (`defineAlertKind`, `alerts.raise`, `alerts.raiseMany`, `alerts.close`, `alerts.closeMany`, `alerts.tickCtx`, `APPROVAL_TIER_STEPS`, `alerts.byDedupeKey`, `alerts.listOpen`, `registerTargetResolver`, `registerRoute`, `alerts.recordReceipt`, `registerTick`); plus the 00 APK endpoints and CLI of H-5 (§8.4; counted in 00 §6.33 by H-11). The 9a `staff` page is served by the hub's static client serving (`/staff/`, AD-1), not counted as an endpoint, like `/admin/stock/`.

---

## §7. Cross-cutting (this module only)

| Item | Rule | Prevents |
|---|---|---|
| Tick | 500 ms; one read-only `due` statement per registered tick; `writer.run` only when it is true; each registered tick in its own transaction, errors logged per tick (`{ tick, err }`, AD-109); within the `alerts` tick a poisoned alert is skipped per alert and logged with name and code only (AD-116, AD-123); `LIMIT 200` per pass, the rest next pass | A write transaction (state swap, every after-commit hook) every 500 ms with nothing to do; one rush tick blocking commands; a 01d bug rolling back kitchen fires; one bad alert stopping all escalation |
| Receipt buffer | 1 000 ms or 100 receipts; one `writer.run`; empty buffer → no transaction; deduped before buffering; dropped on crash (A11); flushed on graceful close (AD-87) | fsync per receipt; duplicate receipt events |
| Timers' errors | the hub tick, the receipt flush and the 00 sweeper (H-8) catch, log and continue. Log key `err` (pino's error serializer; AD-20, AD-28, AD-109, proposed) | an uncaught timer error crashing the hub process |
| Socket errors | a throwing receipt listener is logged and the socket stays open; a throwing `alerts_open` / catch-up builder closes that one socket `1011` with no frame (AD-31, proposed) | one bad row dropping every device on the branch |
| Logging and storage of secrets | alert ids, kinds, step numbers; never `card` text or `details` (items, amounts, reasons). **PINs** never in logs (00 §7.2 redaction), events, `processed_commands` (`payload_hash` without the PIN, H-9; `response_json` has none) or the device command queue (online-only, §8.1, H-10) (v0.4 #9, M4). *As built (AD-80, AD-148, proposed):* frame, inbox, catch-up and `alerts_open` failures log only the error's `name` and `code` (`AlertViewError`; a `JSON.parse` message can echo details); `DomainError` passes through. Final review m-1 (not ruled): the whole-tick catch still logs the raw `err` (see the draft notes) | Leaking money and reasons into logs; recovering manager PINs from a backup, a pre-migration copy or a shared tablet's queue |
| Performance | raise ≤ 5 ms in-transaction at 10 sockets; tick with 200 due ≤ 50 ms. better-sqlite3 blocks the event loop for the whole tick, so HTTP and WS wait that long. **Measured** by a timed test on the pilot mini PC (test 58, in the style of 00 #79; v0.4 #12, m9). *As built (AD-125, ruled):* prepared statements are cached on 01d's hot paths only (tick, projections, raise, after-commit frames) by `cachedPrepare(db, sql)` (`apps/hub/src/alerts/statements.ts`): lazy, a `WeakMap` per database instance (no global state across instances), never used through a read-only view, dropped when `db.prepare` is replaced and cleared in `onClose` before the database closes. Queries, catch-up and `alerts_open` use plain `prepare`. Dev laptop (i7-4900MQ), 3 runs: tick `writer.run` 78–89 ms → 36.6 / 38.4 / 40.4 ms (limit 50); raise median 0.74–1.06 ms → 0.47–0.53 ms (limit 5). The mini PC run stays open (§12.7) | A rush of Ready-to-serve alerts slowing commands |
| Folder | `apps/hub/src/alerts/` (`kinds.ts`, `raise.ts`, `targets.ts`, `routes.ts`, `tick.ts`, `receipts.ts`, `bindings.ts`, `alert-sockets.ts`, `commands/*.ts`, `queries/*.ts`, `ws-frames.ts`, `statements.ts`, `catch-up.ts`); `apps/hub/src/app-update/` (H-5 routes and CLI); `packages/events/src/alerts.ts`, `events/alert/*.v1.ts`; `packages/domain/src/alert-constants.ts`; client `apps/client/src/features/alerts/` and the `staff` entry (`apps/client/src/staff/`, styles in `packages/ui-kit/components/pulse-staff.css` loaded only by that entry). *As built (batch 9a, unattended):* the client folder is `features/alerts/` (the plan and the existing client pattern), not `apps/client/src/alerts/` | — |

---

## §8. Client contract

> As built (AD-1, ruled): 9a builds this contract as a hub-served browser page (`/staff/`) for kiosk, tablet and phone; §8.2 and the app-update client of §8.4 are 9b (`docs/plans/01d-tablet-plan.md`, not built). The rows marked "batch 9a" below are **unattended — developer to confirm**.

### 8.1 All clients (tablet app, kiosk, KDS, phone browser)

- On sign-in: open the staff-session WS as today; render `alert` frames as a banner + sound (family, §8.3) and add to the inbox; tapping opens the detail and calls `MarkAlertsSeen`. A **`silent`** kind (`approval_receipt`, v1.0 #2) gives no banner, no sound and no Android notification: an inbox row and a badge only, and it is never re-notified on reconnect.
  > As built (batch 9a, unattended — developer to confirm): lock views carry no `silent` (AD-23), so the client keeps `SILENT_KINDS = { 'approval_receipt' }` by hand, equal to `kinds.ts`; a kind that later becomes silent must be added there. A lock frame that replaces a card keeps the held `silent`. No banner is shown while signed out; the F01 lock panel shows up to 3 lock lines on kiosk and phone, urgent first, then newest (AD-T41-9, AD-V-3).
- Requests: detail shows Approve / Reject (or Accept / Decline) when `can_answer`; read-only with "Find <approver> or a manager" when `set = 'informed'` (G1-9b). Money kinds always show the PIN pad; accept kinds are one tap (pilot).
  > As built (batch 9a, AD-T41-3, AD-T41-4, AD-T41-14; unattended — developer to confirm): no wire field names the approver, so `{name}` is "an approver" ("For your information. Find an approver or a manager."). Accept-kind facts show `AlertDetailsBase` fields only. The Requests tab shows when `requests-to-answer` returned any row, never on the phone (AD-T41-10, replaced row).
- In-person fallback: **only** on the device the request was raised on (v1.0 #2; other devices never show "Approve here"), "Approve here" → pick the approver's name (roster) → PIN → `AnswerRequest { method: 'in_person' }`. The answerer then gets the `answered_on_requester_device` notice on their own routes (§3.10; also for any other answer made on the requester's device, v0.5 #2) and, for a money kind, the silent `approval_receipt`; neither is shown on this device until the business day closes.
  > As built (AD-165, ruled): the client shows "Approve here" when the signed-in view's `raised_device_id` equals its own device id. (Batch 9a, AD-T41-5:) the approver tiles list every unlocked roster person (the device roster has no rights); the hub refuses a non-approver.
- **PIN-bearing commands are online-only (v0.4 #9, M4; C-00 H-10):** `AnswerRequest` with `method: 'pin'` or `'in_person'` is never written to the device command queue (Android SQLite, cashier IndexedDB). The PIN pad is disabled while the hub socket is down ("No connection to the hub"); the PIN is held in memory only until the response arrives and is then discarded, also on a network error (the person types it again). `method: 'session'` answers, withdraws and seen taps may be queued as today.
  > As built (AD-2, ruled): there is no device command queue yet, so the answer sender is online-only by construction; test #56 (client) asserts no storage write and no request while offline. (Batch 9a:) a `session` answer with the socket down is also refused (`NETWORK`); an empty or invalid PIN is refused locally (`VALIDATION_FAILED`, pad cleared) and never leaves the device; with no staff session the client returns `SESSION_INVALID` and sends nothing; a second tap while an answer is in flight returns `IN_FLIGHT` and sends nothing (a second PIN post would count twice). The PIN lives only in a module-private `WeakMap`, cleared in `finally`. The session token is held in memory only; a reload means signing in again (AD-T41-2). These client codes are local, not hub error codes.
- **Re-notify after a reconnect (v0.4 #12, m6):** an `urgent` or `action` alert in `alerts_open` or the `alerts` catch-up that the client has not shown before (its alert id and step are not in the client's in-memory shown set) and that is not `seen_by_me` is re-notified **once**: banner, Android notification on tablets, and the family's sound once (the urgent 10 s repeat then resumes, §8.3). So a step whose frame was lost to a hub crash between commit and send is heard at reconnect, not at the next step. **Only for alerts raised in the current business day (BF-4):** a row with a non-null `from_business_day` is listed without sound (not even the urgent repeat) and marked "from <date>".
  > As built (batch 9a, unattended — developer to confirm): an open row missing from a later catch-up or `alerts_open` is marked closed (no reason) and its sound and banner stop, since those are the complete open set. A `delivered` receipt is sent for every row received — an `alert` frame, an `alerts_open` row or a catch-up row — once per `(alert_id, step)`, silent kinds and earlier-day rows included. Only a later **lock frame** replaces a held card; catch-up and inbox rows keep the card (whether they should replace too is for the developer, AD-R-d-3). The latest server view wins otherwise.
- **Kiosk and phone pages** open the alert-mode socket whenever they are open with a device token and no session is signed in, and close it on sign-in (the staff socket then carries the alerts) (§3.7, m13). **The tablet's page never opens alert mode**: only the background service does (§8.2, v0.5 m6), so the shared client code checks the device type before opening it.
  > As built (batch 9a, unattended — developer to confirm): the socket counts as up at the first valid server frame, not `onopen` (nothing is sent before auth). Closes `4401`, `4403`, `4426` end the connection with no reconnect; `4409` is final too ("This page is open on another tab or screen.", with "Use it here"), since the hub sends `alerts_open` at once and two tabs would flap; `1011`, `1012` and network errors reconnect with backoff 500 ms → 1 s → 2 s → 4 s → 5 s cap, reset after auth. A KDS page opens its station session socket, never alert mode. On any session change the store is reset (no personal rows, cards or seen state survive to the next person; the shown set is kept, so no device-target sound replays); on sign-out cards, `answers`, `needs_pin` and `raised_device_id` are stripped from every row. The envelope's `tenant_id` / `branch_id` and the hub clock come from the `/staff/` page's `<meta>` tags (AD-T41-1, §4.5).
- Requester: the waiting card from `my-requests`; once `ask_in_person` is true (§6.8) "Waiting 2 min — ask in person" (after the shortcut: "No approver reachable — ask in person"); never a repeating sound (G1-14f); `request_result` → rising chime approved, falling tone rejected (G0-2).
  > As built (AD-1, ruled): the requester's waiting card is not in 9a; 02 / 04 build it with their first request kind. (AD-82, ruled:) the chime is chosen from `outcome`, also in alert mode. (Batch 9a, AD-T41-12:) the waiting ring fills over 4 minutes, and shows full with "1d" for an earlier business day.
- Errors: `REQUEST_NOT_PENDING` → "Already approved by <name>" (close the card); `PERMISSION_DENIED { reason: 'out_of_range' }` → "Not your team — a manager can approve"; `REQUEST_PIN_REQUIRED` → show the PIN pad; `PERMISSION_DENIED { reason: 'in_person_elsewhere' }` → "In person only on the requester's device" (v1.0 #2).
  > As built (batch 9a, unattended — developer to confirm): `REQUEST_NOT_PENDING` with no name, or closed for another reason → "This request is already closed." Closed rows show "Approved by Imran 2:02 PM" when the name and time are known, else "Approved" / "Rejected" (inbox rows and `alert_closed` carry no close time); `obsolete`, `done`, `overridden` and `undone` show a generic "Closed".
- Header on tablets (G1-13c, §3.7; v0.5 #6, N6): **"Alerts: <name> — pauses at h:mm AM/PM"**, after that time **"Alerts paused"** (one `info` chime), "Alerts: none" with no binding; a sign-in on the tablet refreshes it. The time is the hub's `binding_route_until` (BF-5). The 9a page approximates it (AD-T42-2, §3.7).
- **Times** on every staff screen are 12-hour ("2:02 PM") in the hub's zone (AD-167, ruled).
- **Test alert sender** (batch 9a, AD-T41-7, AD-T41-8): Person and Team list the device roster (PIN staff only; a lead with no reports gets an empty team); Device lists "This device" only (no device route lists staff without a PIN or devices). Receipts name the steps 0 "Sent", 1 "Reminder", 2+ "Escalated" (the receipts carry no escalation flag).

### 8.2 Tablet app (Capacitor, bundled)

> As built (AD-1, ruled): **not built in 01d.** 9b (`docs/plans/01d-tablet-plan.md`, tasks T1–T6) builds it, with test #63; blocked on the tablet model (OQ2); required before the pilot. TQ1: OkHttp (Gradle, 9b only); TQ2: Kotlin. The text below is unchanged and is 9b's contract.

- **Background service** keeps the **alert-mode** WS (device token only) whenever the app has a device token, signed in or not; on an `alert` frame raises an Android notification with the `lock` text and the family's sound / vibration; sends `receipt delivered`. Reconnect with backoff (max 5 s, §5.4); `alerts_open` on reconnect.
- **One notification per alert on a signed-in tablet (v0.5 m6).** While a session is signed in, the page gets the same alert on its staff socket and tells the service (Capacitor plugin call) each `(alert_id, step)` it has shown; the service holds its own notification for up to 1 s and raises **no** notification and **no** sound for an `(alert_id, step)` the page has shown, so one alert gives one banner and one sound, and the 10 s urgent repeat runs once (the page's). Signed out, or when the page reports nothing within 1 s (screen off, WebView paused), the service notifies alone. The page never opens alert mode (§3.7).
- Device owner (lock-task): the app whitelists itself from battery optimisation (device-owner policy) — no per-brand steps on restaurant tablets.
- Token storage as 00 §8.1 (Keystore-backed). The service never holds the session token.

### 8.3 Sounds (G0-2, G1-14) — client behaviour, no events

| Family | On a step | Repeat |
|---|---|---|
| urgent | two-tone rising, vibration long-long | every 10 s on the person's devices **until seen** by that person (any device): the `alert_seen` frame (§3.6) stops it on every other device at once; after a reconnect, `seen_by_me` in the `alerts` catch-up / `alerts_open` gives the same state. After seen, one reminder every 2 min until closed. Not seen by the escalation step → drops to the 2-min reminder with one volume step-up (G1-14c). |
| action | bright double ding, once | none (re-sent only by the next step) |
| info | single soft chime, once | none |

Always-on screens (kiosk, KDS, point tablets): one sound per step, then a badge only (G1-14d). No snooze (G1-14e). At most five sounds in total.

> As built (batch 9a, unattended — developer to confirm): "at most five sounds in total" = exactly five sound designs (urgent, action, info, rising, falling), not five plays per alert (which would silence the 2-min reminder). After the escalation step the volume stays 0.8 for that alert until it closes (the step-up happens once). The urgent banner shows again at the escalation step, also for an alert already seen, with sound at 0.8, and stays until opened. On always-on screens every banner hides after 6 s, leaving the badge; "always-on" is device-wide, from the device type (the frames carry no per-alert device-target flag). BF-4 rows play no sound at all.

### 8.4 App update (G1-15)

> As built: the hub side (H-5: `GET /app/android/latest`, `GET /app/android/<version_code>.apk`, the `app-release` CLI) is built and tested (test 40; route group AD-34, CLI AD-35). The app-side client below is 9b (AD-1).

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

Reused: `PERMISSION_DENIED` (`details.reason ∈ self, not_approver, out_of_range, not_receiver, not_requester, in_person_elsewhere` — the last added in v1.0 #2: `in_person` from a device other than the request's raising device), `PIN_INVALID`, `PIN_LOCKED_OUT`, `DEVICE_LOCKED_OUT`, `SERVICE_UNAVAILABLE` (argon2 semaphore, 00 §3.5 step 5), `CONFIG_REFERENCE_INVALID`, `STAFF_NOT_FOUND`, `DEVICE_NOT_FOUND`, `DEVICE_TYPE_NOT_ALLOWED` (H-5), `ROUTE_NOT_FOUND` (H-5), `BUSINESS_DAY_NOT_OPEN`, `VALIDATION_FAILED`. Appended to foundation §6.2 and `@pos/domain/src/errors.ts` (C-F F-4).

> As built (v1.1): no hub error code is added. `INTERNAL_ERROR` appears only as a `RequestPinFailed.error_code` value (AD-97). The client's `NETWORK`, `IN_FLIGHT` and `SESSION_INVALID` (§8.1) are local client results, not hub codes.

---

## §10. Tests

Test files under `apps/hub/test/alerts/`; a **test kind** `t_approval` (approval mode, `range_permission` set, `apply` that can be told to throw) and `t_accept` (named mode) are registered only in tests.

> As built (task 43): 65 of the 66 numbered tests are present (`node tools/spec-coverage/01d-coverage.mjs`); #63 belongs to 9b (AD-1). #56, #57, #59 and #61 have a hub part and a client part. #58 is written and skipped off the pilot hardware (AD-9, AD-122). The clean-checkout gate passed: 304 files and 2014 tests, 1 skipped (#58).

### 10.1 Pure

1. `resolveTarget` for `person`, `permission` with `my_team` range, `team` direct and all (with `no_pin_staff`), `answerers` (branch-scope holders included) / `holders_informed` split; `table_team` with `depth: 'direct'` and `'owner'` (v0.5 m9).
2. Team walk: depth bound, loop-safe, `my_team` covers a grand-report.
3. Routes of a person (§3.4.3): screen + binding + registered route; no route on an action / info kind → lead with `for_staff_id`; lead none → `managers`; on a request kind or an answer notice → no "for" row, the person recorded with no route (v0.5 N5).
4. Step selection: several steps due → latest sent, earlier `StepSkipped`; `{ value: 'window_ms', times: 2 }`.
5. Presence filter incl. the safety rule (nobody ticked → all present; signed-in → present); also applied to `answerers`, `holders_informed`, `managers`, `permission` (v0.5 N5). *(BF-8:)* someone ticked, X not ticked → X present.

### 10.2 Commands

6. Two `AnswerRequest` at once on one request → one 200, one `409 REQUEST_NOT_PENDING { answered_by_name }`; one `RequestAnswered`.
7. `apply` throws → 200 not returned, no `RequestAnswered`, request still pending, error code passed through.
8. Right removed between step and answer (directory apply) → `403 not_approver`.
9. `my_team` answerer for a requester outside the team → `403 out_of_range`; branch-scope answerer → 200.
10. Self answer → `403 self` (every method, incl. in person naming the requester); requester who is the only in-range approver → `answerers` empty → the shortcut writes the escalation step at the raise, the request stays pending and `my-requests` shows `ask_in_person: true` at once; no per-request warning is raised (§12.4).
11. Money kind with `method: 'session'` → `422 REQUEST_PIN_REQUIRED`; accept kind with `method: 'session'` → 200 without PIN.
12. In person (on the raising device): wrong PIN → `401 PIN_INVALID` counted on the answerer and this device, and one `RequestPinFailed { outcome: 'pin_invalid', error_code: 'PIN_INVALID' }` on `audit` (no PIN in its payload); lockout → 429; right PIN → `RequestAnswered { method: 'in_person', device_id, on_requester_device: true }`, an `answered_on_requester_device` alert and an `approval_receipt` (money test kind) to the answerer in the same transaction.
13. Withdraw by requester → closed `withdrawn`, `onWithdraw` events; by someone else → 403; after answer → 409.
14. `alerts.close(…, 'obsolete')` on a request → `AlertClosed` + `request_result` to the requester; close after answer → no events.
15. `raise` twice with one `dedupe_key` → second `deduped: true`, no events; after close, raise again → new alert.
16. `MarkAlertsSeen`: first seen of a request → `RequestSeen` once; second call → none; ids not in my inbox ignored; `request_result` closes `done`.
17. `SendTestAlert` to person / team (default `depth: 'direct'`) / device; point → 422 `points_not_available`; without `manage-devices` → 403; same `command_id` replayed → one alert (`dedupe_key = 'test:' + command_id`).
18. Answer idempotency: same `command_id` replays 200.

### 10.3 Tick, restart, receipts

19. Approval tier timing: step 0 at raise (answerers incl. branch scope), step 1 at 45 s (+ always-on), escalation at 120 s with the answerers, informed holders and always-on (widens: every step-1 recipient is still in step 2; no `branch_scope` entry, v0.5 N4).
20. **G1-9d shortcut (v0.5 N4):** lead Imran's session has idled out, his bound tablet is connected, he is present and active within 2 h → step 0 reaches the tablet, no shortcut; no answerer has a route (all signed out, no bound tablet that is a route, no registered route) → the raise transaction writes `StepSkipped 'shortcut'` for steps 0 and 1 and `EscalationStepped` step 2, so the informed holders and always-on screens are told at once; the request stays pending.
21. Restart with the hub down 4 min after a raise → one `EscalationStepped`, `StepSkipped` for step 1, no step 0 resend.
22. **Idle tick:** nothing due and no dirty flag → exactly one `SELECT` per registered tick, `writer.run` is never called (writer spy), and no `afterCommit` hook runs.
23. Receipts: 150 distinct `receipt` frames → 2 flushes; repeats dropped before buffering (no duplicate `AlertDelivered` event); an empty buffer opens no transaction; **restart:** receipts flushed, hub restarted, the recorded set is seeded from `alert_receipts` of open alerts before sockets are accepted, and the same receipt re-sent after the restart is recorded once (v0.4 m10); the same device's receipt for step 1 and for step 2 → two `AlertDelivered` (m5); `AlertDelivered` on `audit` with subject fields and `step`; a `MarkAlertsSeen` that rolls back buffers no `AlertSeen`; `alerts.recordReceipt` with `kind: 'delivered'` and no `step` → error (v0.5 m3).
24. Day close: requests stay open; tablet binding rows cleared (kiosks have none, BF-3); phone bindings kept; open personal notices stay open (expiry of non-request alerts: test 36).
25. Table's team target via a registered fake `tableOwner`; owner changes between steps → step 2 goes to the new team; old team's inbox shows `moved_to`. ⚠️ Changed by 02a v1.0 (D-1): the fake resolver returns the full set; add: one batch with `owner` + `direct` targets for one table → two lists; a missing depth = `direct`; the marker once per `owner_staff_id`.

### 10.4 WS and bindings

26. Alert-mode auth with device token only → `alerts_open`, then `alert` frames with `lock` only; any non-`receipt` frame → close 4401; revoke → 4403; rotation → 4401.
27. Binding: sign-in sets it (with `session_id`); idle timeout keeps it; logout ends it; a `SessionEnded` of an older session on the same device after a newer sign-in does not end the newer binding; takeover moves it; phone → owner, and a `SessionStarted` plus logout on the phone leave the owner row (m2); **rebuild:** `reset` + replay gives identical rows, and after a simulated cloud-only restore (sessions ended `hub_restored`) **no active binding is left** (the phone owner row stays). *(Reworded in v1.1, AD-49, ruled; v1.0 said "no binding is left".)*
28. A session-less tablet bound to Ali receives Ali's alert; signed-in Bilal on another tablet does not.
29. Staff-session socket gets `card`; alert-mode socket never gets `card` (no amounts or reasons in frames).
30. Receipt for an alert this device was not sent, or an unknown alert → ignored; `receipt` on a station socket of a KDS that got a device-target alert → recorded with `staff_id = ''`.

### 10.5 Directory and warning

31. `no_pin_staff` applied: in `teamOf({ includeNoPin })`, not in the roster; PIN set → moves lists in one version; older hub (no field) applies.
32. `no_approver`: day open, last branch-scope approver logs out → alert open on kiosk + managers within one tick; approver signs in → closed `done`; flag survives a restart.

### 10.6 Added in v0.2

33. **Handler-checked commands:** the registry rejects `permission: 'checked-in-handler'` on a command not in `HANDLER_CHECKED_COMMANDS` (startup error); for each listed command, a call by a person without the right (answer: not an approver; withdraw: not the requester; seen: ids not in the inbox) writes nothing and returns `403` (or, for seen, acts on no id); a station session → `403`.
34. **Answer vs. tick (single synchronous connection, v0.3):** alert A with step 1 due. (a) The `alerts.due` pre-check returns true for A → in `testHooks.betweenDueAndRun('alerts')` (§3.5, v0.4 m11) `AnswerRequest` for A commits → the tick's `writer.run` body runs → no `AttemptSent` / `EscalationStepped` for A, and the transaction appends nothing. (b) Reverse: the tick pass for A commits its step → `AnswerRequest` commits → the next pass's pre-check is false for A (closed) and no `writer.run` opens. In both orders no step event for A has a `seq` after its `RequestAnswered`. (There is no two-connection case: the hub has one connection and `writer.run` has no `await`.)
35. **Statement bounds, asserted separately (v0.4 #7, M10):** with 1 and with 150 due alerts (mixed person, team, table-team targets via a fake batched resolver, and a fake pager-like route whose `routesFor` is batch-shaped): (a) **tick reads** — the SELECTs issued by `due`, `intents` and `batchReads` (spy active only while those run) are the same count for 1 and 150, ≤ 1 + 8 + R + T, with the activity read (9) included (v0.5 N6); a route or resolver that runs one statement per person fails (a). (b) **projection reads** — the SELECTs issued while the `alerts` projection applies (spy scoped to its apply) are ≤ 2 per step / close event, so the total for 150 due alerts is ≤ 2 × 150, and the same count with 10 or 1 000 **other** open alerts not due (no scan of open alerts). (c) `raise` is independent of team size (≤ 6 + R + T). (d) **Many in one transaction (v0.5 m5):** 20 raises through `raiseMany`, and 10 closes of requests through `closeMany`, issue the same statement count as one; 20 single `raise` calls in one transaction read the fixed set (sessions, bindings, devices, presence, activity) once. *(AD-131, ruled:)* a dirty `no_approver` pass is pinned separately at 9 statements, 11 when it raises (`no-approver.int.test.ts`).
36. Day close → open info alerts closed `expired` by the next tick, not in the day-close transaction; personal notices (`expires_at_day_close: false`) stay open.

### 10.7 Added in v0.3

37. **Tick isolation:** two registered ticks (`alerts` and a fake `fires`); `fires.intents` throws → its transaction rolls back and the error is logged `{ tick: 'fires' }`; the `alerts` step of the same pass is committed; and the reverse (a throwing `alerts` tick does not stop a `fires` intent). Both get the same `now`. A tick whose `due` is false opens no transaction.
38. **Retention with foreign keys on:** closed alerts older than 7 days with recipients, inbox, receipts and seen rows → deleted in batches of 500 with no foreign-key error; `alert_recipients` rows go with their alert; a batch error is caught and logged by the sweeper and the next run continues. *(AD-161:)* the timing test is re-run with the `alert_inbox_alert` index.
39. **`alert_seen`:** Ali bound to tablets A and B (one alert mode, one signed in) with an urgent request; `MarkAlertsSeen` on A → after commit B gets `{ type: 'alert_seen', alert_id }` and A's other sockets get it too; a second `MarkAlertsSeen` sends no frame; after reconnect `alerts_open` / catch-up shows `seen_by_me: true`.
40. **APK update:** no release → `latest` `404`; `add` staged to tablet T1 → T1's `latest` returns it, T2's returns the previous good release (or `404` if none); `mark-good` → T2 gets it; `GET …/<version_code>.apk` streams the file with the stored `sha256`; KDS device → `403 DEVICE_TYPE_NOT_ALLOWED`; `add` keeps the newest 2 good versions plus the staged one.
41. **`my-requests`:** pending first with `ask_in_person` false before and true after `approval_branch_ms`; today's answered one with decision and answerer name; yesterday's closed one absent; 1 statement.
42. **`alerts-inbox`:** open action alerts first, then by `raised_at` desc; "for Ali" cards on the lead; `moved_to_name` on the old team; cursor paging at `limit` 2 over 5 alerts; 2 statements whatever the count.
43. **`alerts` catch-up part:** a staff socket and a KDS station socket get their open alerts (person and device targets) through `build(db, state, socketCtx)`, and the staff socket also gets an open request its person may answer but has no inbox row for (N3); **2 statements** (inbox / device rows; open requests) (v1.0 #7, m11); an alert-mode socket is not in the catch-up path (`alerts_open` instead).
44. **Answer payload:** decision outside the kind's `answers` (`accept` on an approval kind) → `400 VALIDATION_FAILED` from `preRead`; `in_person` with an unknown `answerer_staff_id` → `404 STAFF_NOT_FOUND` from `preRead` (argon2 spy not called, v0.5 m2), not counted as a PIN failure; a retried answered `command_id` replays `200` without a PIN check (argon2 spy not called).
45. **`SetPresence`:** sets and clears presence for PIN and no-PIN people; business day closed → `409 BUSINESS_DAY_NOT_OPEN`; unknown id → `404`; without `manage-staff` → `403`; projection cleared on `BusinessDayClosed`.
46. **`alert-receipts`:** a `test_alert` to a team over two steps (a fake two-step test kind) → per-step recipients from `alert_recipients` and routes from the step events read from the alert's `raised_seq` on (v0.5 m12; 50 older `hub`-stream events are not read), delivered / seen per device; a person with no route listed "no route"; 4 statements; without `manage-devices` → `403`.
47. **Same key twice in one transaction:** a handler calls `raise` twice with one `dedupe_key` before appending → second returns the first `alert_id` with `deduped: true`; one `AlertRaised`; no constraint error.
48. **Directory bound:** `GET /v1/sync/config` `200` with the directory and `no_pin_staff` runs ≤ 27 statements (B-5); a PIN-holder whose lead is in `no_pin_staff` keeps the lead on the hub (B-6).

### 10.8 Added in v0.4

49. **Details (M5):** a `t_approval` raise with `details { item, quantity, amount, reason }` → the approver's staff-session socket gets `card` with them; the same alert on an alert-mode socket, on a KDS station socket (device target) and in `alerts_open` carries no `details` field and no amount anywhere in the frame; captured logs contain no `details` value; `details` failing the kind's schema → `VALIDATION_FAILED { issue: 'details_invalid' }`.
50. **Step targets from the alert (M6):** a fake 03a-like kind with `values_schema { point_id, table_id }` and steps `[raised_target]`, then `[{ kind: 'point', from_value: 'point_id' }, managers]`; a fake batched `point` resolver → step 1 reaches the point's tablets and the managers; a fake handover-like kind with `requester_lead` at step 1 → the requester's lead gets it; requester without a lead → the step's other entries still go; `from_value` naming an undeclared key → startup error. The fake 03a-like kind is raised from a registered fake `fires` tick through `alerts.raiseMany(alerts.tickCtx(tx, now), …)` (v1.0 #5, m5): `raised_device_id = 'hub'`, `actor_id = null`.
51. **`listOpen` (M8):** open requests of kind K across two subjects → `listOpen({ kind: K })` returns both, oldest first, 1 statement; with `subject` → one; after `BusinessDayClosed` the requests are still open and still listed; 01d's tick never closes them (requester removed from the directory → still open, answers `403 not_approver`); the owner closes them `obsolete` → `request_result` to the requester.
52. **`after_ms` expiry (M1):** `SendTestAlert` → `next_due_at = raised_at + 600 000`; at 599 s the pre-check is false; at 600 s the pre-check is true and the tick writes `AlertClosed { reason: 'expired' }`, no step event; a kind with one more step after the expiry time is closed, not stepped.
53. **Cumulative recipients (M2, m3):** Hamza's void, lead Imran (`my_team`) gets step 0 and 1, kiosk step 1; after step 2, Imran's `requests-to-answer` still lists it with `can_answer: true`; the manager approves → Imran's sockets, Imran's bound tablet and the kiosk all get `alert_closed`; a step-1 `receipt` from the kiosk arriving after step 2 is recorded.
54. **Order of checks, no PIN oracle (M3):** `AnswerRequest` in person on a random ULID, on a closed request, and on a pending one the named answerer may not answer (out of range, self) → `404` / `409` / `403`, the **same response for a correct and a wrong PIN**, argon2 spy not called, no lockout counted, no event written. Race (`testHooks.betweenVerifyAndWriter`, v0.5 m10): the request is answered by someone else while argon2 runs → correct PIN and wrong PIN both get `409 REQUEST_NOT_PENDING`; **each is counted once** on the staff and the device counters and writes one `RequestPinFailed { outcome: 'answer_failed', error_code: 'REQUEST_NOT_PENDING' }` (v1.0 #1, R1: the same counter delta for both); the correct one also raises `pin_use_failed` to the PIN owner in that same transaction and resets nothing.
55. **Answer on the requester's device, receipts and the answering seat (M3, v0.5 N2, v1.0 R2):** an in-person approval naming Imran on Hamza's tablet (the raising device) → `answered_on_requester_device` reaches Imran on every own **screen and alert-connection** route (screen, bound tablet) with "You approved … at Hamza's tablet", and **never on a short-code route** (the fake pager route: the personal notices have no `short` label, §3.8, N8), `RequestAnswered { method: 'in_person', device_id: <Hamza's tablet>, on_requester_device: true }`, plus a silent `approval_receipt`; **in person from a second device** (Hamza signed in as himself on tablet B) → `403 PERMISSION_DENIED { reason: 'in_person_elsewhere' }` from `preRead`, argon2 spy not called, nothing counted; **a sign-in as Imran on the kiosk followed by a `pin` answer** on a money kind → `approval_receipt` to Imran (no frame to the kiosk session, none to any kiosk socket today), `on_requester_device: false`; **a sign-in as Imran on Hamza's tablet followed by a `pin` answer** → the notice and the receipt are raised, no `alert` frame or catch-up row reaches that session or that tablet, `alerts-inbox` from that session does not list them, and a `MarkAlertsSeen` from that session (or from a new session on that tablet the same day) writes `AlertSeen` but closes neither; after `BusinessDayClosed` the tablet's hiding ends, but the answering session's stays; Imran's next sign-in on his own tablet shows both, and his `MarkAlertsSeen` there closes them `done`. Imran answering a money kind from his own tablet → no notice, `on_requester_device: false`, an `approval_receipt` not shown on his tablet until day close. Imran off today with no route → no "for Imran" copy on any other device; the notices survive `BusinessDayClosed`. The client plays no sound and shows no banner for `approval_receipt` (client part). *(Reworded in v1.1, AD-164, ruled; v1.0 said "every own route (screen, bound tablet, fake pager route)".)*
56. **PIN never stored (M4):** after an `AnswerRequest` with PIN `4711`: `processed_commands.payload_hash` equals the hash of the payload without `pin` and differs from the hash with it; no column of `processed_commands`, no event payload and no captured log line contains `4711`; a replay with the same `command_id` and a different PIN replays the stored `200`; client test: with the socket down the PIN pad is disabled and nothing is written to the command queue.
57. **Stale binding (M9, v0.5 N6), with an `action` test kind:** Ali bound to tablet T: T disconnected → Ali's alert goes to his lead's routes with `for_staff_id = Ali`; T connected but Ali marked absent today → the same; T connected and Ali present → T gets it and the receipt view says "delivered to device T, bound to Ali (not signed in)"; nobody ticked today → T counts (safety rule). **2 h rule:** (i) Ali signs in on T at 12:00 PM and idles out at 12:05 PM; T connected, Ali present; an alert at 1:59 PM goes to T, one at 2:06 PM goes to the lead with `for_staff_id = Ali`; (ii) Ali signs in on another tablet at 1:00 PM → at 2:30 PM T is still a route (activity anywhere); (iii) a `MarkAlertsSeen` on T at 1:50 PM extends it to 3:50 PM; (iv) a phone owner binding with no session for 3 h, page open, is still a route; (v) test 35's tick count is unchanged for 1 and 150 due alerts with the activity read included; (vi) client: the header shows "Alerts: Ali — pauses at 2:05 PM", then "Alerts paused" with one chime; a sign-in refreshes it; *(BF-5:)* activity elsewhere moves the header's time (a `binding_route` frame).
58. **Timed tick (m9, pilot mini PC):** 200 due alerts with 10 sockets → the tick's `writer.run` ≤ 50 ms; one raise ≤ 5 ms in-transaction (median of 20 runs), in the style of 00 #79; skipped off the pilot hardware. *As built (AD-9, ruled; AD-122, proposed):* `it.skipIf(process.env.POS_PILOT_HW !== '1')` in `timed-tick.int.test.ts` (00 #79 is a smoke script, so "in its style" means: runs only on that hardware). Dev-laptop numbers are in §7 (AD-125). **Open until the pilot mini PC run, with 00 #79** (§12.7).
59. **MINOR rules:** (m1) at day close with `no_approver` open and its flag dirty, one pass writes one `AlertClosed 'expired'` and no `AlertClosed 'done'` for it; (m2) a phone's owner binding survives a `SessionStarted` and a logout on that phone (added to test 27); (m4) a second alert-mode auth for one device closes the first `4409` and logs both remote addresses; (m6) a lost `alert` frame plus reconnect → the client re-notifies once (client test); (v0.5 #5) `defineAlertKind` with a request part and `lead_fallback: true` → startup error; (m8) two kinds with the same `dedupe_key` give two alerts, and a deduped raise returns the open one's requester; (m15) `defineAlertKind({ family: 'urgent', request: null })` → startup error.

### 10.9 Added in v0.5

60. **No PIN oracle, and no uncounted guess (N1, v1.0 R1):** (a) `decision: 'accept'` on an approval kind → `400` before argon2 (spy not called). (b′) **Logout during argon2:** the requester's session ends (`SessionEnded`, auth generation bumped) in `testHooks.betweenVerifyAndWriter` → a correct and a wrong in-person PIN each return the M39 error, **each increases the staff counter and the device counter by 1**, each writes one `RequestPinFailed { outcome: 'answer_failed', error_code: 'SESSION_EXPIRED' }`, and each runs **exactly one** write transaction (writer spy); the correct one also raises `pin_use_failed` in that transaction. (c′) **`apply` always refuses:** a `t_approval` whose `apply` always throws → the apply error comes from `preRead`, the argon2 spy is not called, nothing is counted, no `RequestPinFailed`. (c″) **Withdraw and re-raise:** the requester sends a guess, withdraws in `betweenVerifyAndWriter` (`409` for both PINs, each counted once, `RequestPinFailed`), raises a new void and repeats; the staff counter keeps rising across the requests and (d′) **the fifth such attempt locks the named answerer out:** `StaffPinLockedOut` written in that attempt's transaction, the next attempt → `429 PIN_LOCKED_OUT` before argon2; the 10th failure in 5 min from the device → `429 DEVICE_LOCKED_OUT`. (e′) With `prepare` succeeding, a wrong PIN is counted and records `RequestPinFailed { outcome: 'pin_invalid' }` as in test 12; a right PIN resets the staff counter. (f′) A retry of an answered `command_id` racing the first (`IdempotentReplay` in `prepare`) → the stored `200`, nothing counted. (g′) `pin: '1234567'` → `400` from payload Zod, nothing counted (m16). *(BF-1:)* two managers approve at once with `pin`; the loser gets `409`, one counted failure, no `pin_use_failed`. *(BF-2:)* `onPrepareFailed` made to throw → the client still gets the `prepare` error for both PINs.
61. **Late approver (N3):** a void raised while no approver has a route (shortcut taken); the manager signs in after step 2 → `requests-to-answer` lists it with `can_answer: true` (2 statements), the `alerts` catch-up includes it and the client re-notifies once; the manager's `MarkAlertsSeen` on it writes `RequestSeen` and an inbox row; when another person answers it, the manager's socket gets `alert_closed`. A person who may not answer it and has no inbox row does not see it. *(BF-4:)* a request from yesterday appears in the catch-up with `from_business_day` set and no re-notify.
62. **No lead fallback for requests and notices (N5):** a void with the owner (remote) and a second manager (on leave) holding branch scope, both with no route → no "for" rows; the duty manager gets one card per step; the receipt view shows "Owner: no route"; an `action` kind to a person with no route still goes "for" to the lead; a fallback that reaches a person already in the step adds no second copy; `no_approver` adds no "for" row.
63. **Tablet notifications (m6, client):** signed in on the tablet, an urgent alert gives one banner and one sound (the page's) and one 10 s repeat; the service shows nothing for that `(alert_id, step)`; signed out, the service notifies; with the page silent for 1 s (WebView paused), the service notifies; the tablet page never sends an alert-mode `auth`. *As built (AD-1, ruled):* **not built; owned by 9b** (`01d-tablet-plan.md` T3), required before the pilot.
64. **`alerts_open` and the binding rule (m7):** tablet T bound to Ali with an open urgent alert for Ali; Ali marked absent (or Ali's last activity > 2 h ago) → T's reconnect `alerts_open` has no Ali alert; a device-target alert on T is still listed.
65. **Kiosk binds no one (m8):** a cashier signs in and out on a kiosk → the kiosk is never the cashier's route (a later alert to the cashier goes to the lead for an action kind); `GET /app/android/latest` from a kiosk → `403 DEVICE_TYPE_NOT_ALLOWED`. *(BF-3:)* no binding row for a kiosk; a signed-out kiosk's receipt has `staff_id = ''`.

### 10.9a Added in v1.0

66. **Read-only `apply` (v1.0 #3, m3):** a `t_approval.apply` that calls `tx.append`, one that calls `tx.onCommit`, and one that runs an `UPDATE` through `tx.db.prepare` each fail in `preRead` (and in `prepare`) with nothing written and no PIN verified; an `apply` returning a draft without `payload.alert_id`, or with another alert's id, fails the check; the startup checks refuse `silent: true` on an `urgent` kind and an approval kind with no `escalation: true` step (m4).

### 10.9b As built in v1.1 (tests that pin the AD rows; section-cited, not numbered)

- BF-6: a transaction that appends `SessionStarted` then raises resolves the new session's route (`raise.int.test.ts`). BF-7: a person removed from the directory → their open receipt closed `obsolete` by the next tick (`no-approver.int.test.ts`).
- AD-23 / AD-81: alert-mode frames and lock frames never carry `answers`, `needs_pin`, `silent` or `raised_device_id`. AD-163: the inbox gives lock to a device-target viewer. AD-123: a stuck alert has `next_due_at` NULL, is counted in `config-status`, and stays answerable. AD-124 / AD-36 / AD-117: the new startup errors. AD-161: the retention timing with the index.

### 10.10 Acceptance table

| Story AC | Covered by | Tests |
|---|---|---|
| E-NOTIF AC1 targets | §3.4 | 1, 2, 25 |
| E-NOTIF AC2 R1 / R2 (tablets) / R3 | §3.4.3, §3.7, §3.5 | 3, 19, 26, 28, 39 |
| E-NOTIF AC3 no internet | LAN only (§2) | 26 |
| E-NOTIF AC4 iPhones | unchanged by design (R22) | — (no test) |
| E-NOTIF AC5 (approvals only) | §3.9 | 32 |
| E-NOTIF AC6 audit | §3.6, events | 16, 23 |
| E-REQ AC1 pending | §3.2–3.3 | 19, 61 |
| E-REQ AC2 own PIN | §3.3 rules 2–4 | 11, 12, 54, 56, 60 |
| E-REQ AC3 answer shown | §6.2 step 8, `request_result` | 14, 16 |
| E-REQ AC4 in-person fallback | §3.3 rule 2, notice on the requester's device | 12, 55, 60 |
| E-REQ AC5 right checked on arrival | §3.3 rule 6 | 8, 9 |
| E-REQ AC6 first answer wins | §6.2 race | 6 |
| E-REQ AC7 no auto-cancel | §3.3 | 24, 51 |

---

## §11. Build order

> As built (AD-8, ruled): the 01b rows (step 12) and H-5 (step 14) were moved up to batches 2–3, so 00 and 01b came first (P-1). (AD-1, ruled:) step 16 was split: its browser parts are batch 9a (built); the tablet background service, one notification per alert, lock text on Android and the app update client are 9b (not built).

1. `packages/domain`: error codes (§9), `ALERT_CONSTANTS` (A14), families, close reasons. Tests 1–5 scaffolding.
2. `packages/events`: alert events (§4.2), `alerts.ts` wire shapes, WS frames (H-2). Fixture tests.
3. 00 hooks (H-1, H-3, H-4, H-7, H-8, H-9, H-13, H-14): `preRead` and `pinCheck` after the fast path, `checkPin` `prepare` (read-only transaction view) / `onMatch(tx, P)` / `onMismatch` / `onPrepareFailed` (one counting transaction for both PINs) and `testHooks.betweenVerifyAndWriter`, `ws.connectedSessions()`, the `staff_sessions_staff_activity` index, `payload_hash` without the PIN field, `'checked-in-handler'` with `HANDLER_CHECKED_COMMANDS`, alert-mode WS in its own socket list (one per device, `4409`; pongs mark the device seen), `receipt` on session sockets, `sendToDevices` / `sendToStaff`, `registerCatchUp` `build(db, state, socketCtx)`, sweeper try/catch. 00 tests updated; tests 33, 44, 54, 56, 60, 66.
4. Migration `0006_alerts.sql` (§5.1, incl. `ON DELETE CASCADE`, `device_bindings.session_id`, `app_releases`); projections (§5.2); retention (§5.1) — test 38.
5. `alerts/kinds.ts` (with `values_schema`, `details_schema`, startup checks), `targets.ts` (§3.4, step targets from the alert), `routes.ts` (§3.4.3 incl. the connected, present and 2 h binding rule and the `lead_fallback` rule, §3.8) — tests 1–5, 50, 57, 62, 65.
6. `alerts/raise.ts`, `raiseMany`, `close`, `closeMany`, `listOpen` (§6.1, §4.2) — tests 14, 15, 47, 51.
7. Commands `AnswerRequest` (pre-read with the read-only `apply`, in person only on the raising device, `prepare` before the PIN branch with the counted failure path, typed `apply` with the `alert_id` check, `approval_receipt`, `answered_on_requester_device`, `pin_use_failed`, `hidden_from`), `WithdrawRequest`, `MarkAlertsSeen` with test kinds (§6.2–6.4) — tests 6–13, 16, 18, 54, 55, 60, 66.
8. `alerts/tick.ts` (§3.5: one loop, `due` pre-check outside the lock, each registered tick in its own `writer.run`, authoritative selection inside, `batchReads`, errors logged per tick) and `registerTick` — tests 19–22, 24, 25, 34–37, 52, 53, 58.
9. `alerts/receipts.ts` buffer (dedupe before buffering, empty flush skipped, `tx.onCommit`), WS `receipt` and `alert_seen` (§3.6) — tests 23, 30, 39.
10. `alerts/bindings.ts` (by `session_id`) and alert-mode delivery (§3.7, `alerts_open` with the binding rule) — tests 26–29, 64.
11. Kinds `test_alert`, `request_result`, `no_approver`, `answered_on_requester_device`, `approval_receipt`, `pin_use_failed` (§3.10, §3.9); `alerts.tickCtx`, `APPROVAL_TIER_STEPS` (§4.2); `SendTestAlert` — tests 17, 32, 59.
12. 01b v1.4 directory fields (C-01b B-1, B-3, B-5, B-6) — tests 31, 48.
13. Queries (§6.7–6.10; `requests-to-answer` computed from open requests), `alerts` catch-up part — tests 41–43, 46, 61.
14. App update endpoints and CLI (C-00 H-5, §8.4) — test 40.
15. `SetPresence` and the presence filter (§3.11) — tests 5, 45.
16. Client: banner, inbox, request detail with `details`, in-person flow, online-only PIN commands, re-notify on reconnect, kiosk / phone alert mode, sounds and `alert_seen` (§8.1, §8.3); tablet header deadline (§3.7); tablet background service, one notification per alert and lock text (§8.2); app update client (§8.4) — client parts of tests 56, 57, 59, 63.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done

- Every test in §10 passes; `pnpm -w typecheck` (incl. tests, R31) and lint pass. *As built:* met on a clean checkout, except #63 (9b) and #58 (skipped off the pilot hardware).
- A `test_alert` sent from a manager's tablet reaches a session-less, screen-off pilot tablet as an Android notification, and the receipt view shows delivered and seen. *As built (AD-1, ruled):* the hub side is met; the Android notification needs 9b — **open, required before the pilot** (§12.7).
- The §4.5 bumps are approved and applied (README incl. R-8, R-9, CLAUDE.md + R34, foundation v1.8 incl. F-5–F-9, 00 v1.6 incl. H-5, H-7–H-14, 01b v1.4 incl. B-5, B-6) — **done with v1.0, 2026-11-01**; H-11 decided at approval by the developer. *v1.1:* the as-built changes to 00, 01a and 01b ("Contract changes", §1) were approved on 2026-11-02 and applied as 00 v1.6.1, 01a v2.0.1 and 01b v1.4.1.
- Every build-time fix BF-1–BF-8 (§12.6) is done, with its test, and folded in as an AD row at the as-built review. *As built:* done and tested; folded in v1.1 (§12.6 status column).
- An idle hub opens no 01d transaction (test 22); an APK release reaches the staged tablet first and the rest only after `mark-good` (test 40).
- No 01d code reads a role name (R5); every pilot value is in `ALERT_CONSTANTS` (A14), none inline.

### 12.2 Checklist

| # | Item | Kind | Section | Tests |
|---|---|---|---|---|
| 1 | `alerts.raise` / `raiseMany` / `close` / `closeMany` / `listOpen` / `tickCtx`, `APPROVAL_TIER_STEPS` | internal | 6.1, 4.2 | 14, 15, 20, 35, 47, 49, 50, 51, 66 |
| 2 | `AnswerRequest` | command | 6.2 | 6–12, 18, 33, 44, 54–56, 60, 66 |
| 3 | `WithdrawRequest` | command | 6.3 | 13, 33 |
| 4 | `MarkAlertsSeen` | command | 6.4 | 16, 33, 39, 61 |
| 5 | `SendTestAlert` | command | 6.5 | 17 |
| 6 | `SetPresence` | command | 6.6 | 5, 45 |
| 7 | `alerts-inbox` | query | 6.7 | 25, 42 |
| 8 | `my-requests` | query | 6.8 | 41 |
| 9 | `requests-to-answer` | query | 6.9 | 8, 53, 61 |
| 10 | `alert-receipts` | query | 6.10 | 46, 57, 62 |
| 11 | WS alert mode + frames (`alerts_open`, `alert`, `alert_seen`, `alert_closed`, `binding_route`, `receipt`) | ws | 6 batch 3 | 26–30, 39, 49, 53, 57, 59, 63 (9b), 64 |
| 12 | `alerts` catch-up part | ws | 6 batch 3, H-7 | 43, 55, 61 |
| 13 | Tick (`registerTick`, `due`, own transactions) | job | 3.5 | 19–22, 24, 34–37, 50, 52, 58 (pilot HW), 59 |
| 14 | Receipt buffer | job | 3.6 | 23 |
| 15 | Retention | job | 5.1 | 38 |
| 16 | `GET /app/android/latest`, `GET /app/android/<version_code>.apk`, CLI `app-release add` / `mark-good` | 00 endpoints + CLI | H-5, 8.4 | 40, 65 |

### 12.3 Open questions — answered (developer, 2026-11-01)

| # | Question | Answer |
|---|---|---|
| Q1 | "Manager" for non-approval fallbacks (G1-11d) | Branch-scope holder of `force-release-table-lock` (§3.4). |
| Q2 | Who sets "Present today" | `manage-staff` (§3.11). G1-20 **kept** (developer as the owner's proxy, 2026-11-01). |
| Q3 | Self-answer | Never, for everyone. The requester is excluded from `answerers` (which already holds every branch-scope approver, G1-9c); if `answerers` minus the requester is empty, step 0 has no answerers, the G1-9d shortcut writes the escalation step at once, the request stays pending and the requester sees "ask in person" (§3.3 rule 5, §3.5; reworded in v0.5 #4, N4); per-request warning deferred (§12.4). **Confirmed** by the developer as the owner's proxy, 2026-11-01. |
| Q4 | Day-close expiry and `no_approver`: writer hook or tick | Tick; the v0.1 writer hook dropped (§3.5, §3.9, §5.2). (v0.3's H-7 is the catch-up change, a different row.) |
| Q5 | APK hosting | 00 (H-5). |
| Q6 | Retention of projection rows | Receipts: previous business day; closed alerts: 7 days; events forever (§5.1). |
| Q7 | Pager id format | Text until the spike (G0-10); now in 01e's 01b bump (§4.3 To 01e). |
| Q8 | `approver_role_ids` empty at answer time | `403 not_approver`; 01d never auto-closes; owning modules find stale requests with `alerts.listOpen` and close them `obsolete` (§3.3 rule 6, v0.4 #4). |
| Q9 | 01a setting or constants | Constants (A14); settings post-pilot (§12.4). |

Open for the owner: none (Q3 confirmed, G1-20 kept, 2026-11-01). *v1.1:* the developer's open choices of §12.7 (d) were approved as built on 2026-11-02.

### 12.4 Deferred until needed

- Personal-phone alert app (APK on staff-owned phones) — post-pilot product item (G1-19).
- General "no route reaches this person" warning (Q-N5 beyond approvals).
- Free-text and cross-team task messages beyond zone-stock transfers (README "cross-team requests").
- Customer table call buttons.
- Inbox history beyond the current day. **Exception (v0.5 #2):** open personal notices (`answered_on_requester_device`, `pin_use_failed`, §3.10) stay listed until their person sees them.
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

### 12.5 Self-check (developer, v1.0, after G4 run 3)

- **R1 checked against the review:** every PIN that argon2 verifies ends either in a recorded answer (which gives the approver a receipt or a notice) or in a counted, recorded failure; a refusal decided by state is answered by `preRead` before argon2; both PINs give the same status, counter delta and transaction count on every path (tests 54, 60 (b′)–(g′)). The remaining timing difference (the `pin_use_failed` raise reads) is stated and bounded by the lockouts (§3.3 rule 4 (d)).
- **R2 checked against the review:** (a) in person only on the raising device (test 55); (b) a sign-in as the approver elsewhere still gives the approver a silent receipt for every money answer (test 55); (c) the answering seat neither sees nor closes the receipt or the notice for the business day (test 55); (4) 05's view shows each notice's state and who saw it where (§4.3 To 05). Residual stated: a PIN holder can close it from a third device, visible in 05's view.
- **MINORs:** m3, m4, m5, m7, m11, m13, m15, m16 fixed here (tests 43, 50, 60 (g′), 66); the other eight are BF-1–BF-8 (§12.6), none changes a contract another module relies on.

> As built (final review, v1.1): R1, R2, the inside-lock select, the read-only contract, the secrets rules and the client rules hold across the branch; no Critical finding. R1 residuals: AD-99 / AD-100 and m-3 (§3.3 rule 4 (d)). BF-5 is met by the hub; the 9a page approximates it (AD-T42-2).

### 12.5a Self-check (author, v0.5, after G4 run 2)

- **v0.5 additions:** every PIN-independent check and the effect run before the PIN branch, so no response, counter or timing tells a guesser that a PIN was right, and a correct PIN whose answer fails notifies its owner (tests 54, 60); answers on the requester's device notify the answerer whatever the method, as personal notices that survive day close and never land on someone else's device (test 55); requests to answer are computed from open requests, so a late approver sees them (test 61); branch scope is in step 0 and the shortcut fires only when no answerer has a route (tests 19, 20); the lead fallback is for action and info alerts only (test 62); a shelf tablet stops being a route 2 h after its person's last activity, with the deadline on its header (test 57); batch raise / close keep the statement count fixed (test 35 (d)). Residual risk stated: a shelf tablet stays a route for up to 2 h (§3.4.3).

### 12.5b Self-check (author, v0.4, after G4 run 1)

- **v0.4 additions:** the PIN is checked only after the alert, the PIN rule, self and the right pass on a pre-read, and inside `checkPin` a `precheck` keeps the response independent of the PIN in the race window (test 54); in-person answers are notified to the answerer and listed with their method (test 55); the PIN is in no stored hash, row, event, log or queue (test 56); recipients are cumulative (test 53); `after_ms` expires through `next_due_at` (test 52); the statement bounds are per tick and per event, asserted separately (test 35); bindings are routes only when connected and present (test 57). Residual risk stated: a connected shelf tablet of a present person (§3.4.3).

### 12.5c Self-check (author, v0.3, after G2)

- **Races:** answer vs. answer, answer vs. close, raise vs. raise (dedupe index, and the in-transaction key map, test 47), tick vs. answer (§3.5: authoritative selection inside `writer.run`, pre-check is a hint; single synchronous connection; test 34).
- **Idempotency:** commands by `command_id`; raise by `dedupe_key`; receipts deduped before buffering and by PK; `RequestSeen` by `request_seen` PK; `pinCheck` after the fast path (test 44).
- **N+1:** queries fixed (§6.7–6.10); tick ≤ 1 + 7 + R + T and raise ≤ 5 + R + T statements, resolvers and routes batch-shaped (§3.5; test 35); close frames read recipients in one statement.
- **Write contention:** idle passes open no transaction (test 22); receipt flush skips an empty buffer; each registered tick in its own transaction (test 37).
- **Restart:** persisted projections and flags; latest due step sent once, earlier ones skipped (test 21); bindings rebuilt exactly by `session_id` (test 27); receipts may lose the last batch (accepted, A11).
- **Contradictions found and handled:** foundation §4.5 "push to all holders" vs. G1-9 (F-1); foundation §6.3 / §5.4 / §6.5 WS text (F-5–F-7); 00 M12 session-only WS (H-1); 00 `defineCommand` permission rule (H-3, listed marker; station `null` kept); 00 `registerCatchUp.build` without a socket (H-7); `SessionEnded` without `device_id` (§3.7, `session_id`); retention vs. foreign keys (§5.1, H-8); sync bound at 26 (B-5); `RequestSeen` placement vs. persisted projections (§3.6 note).
- **Over-engineering check:** route interface has one known user (01e, mandatory for the pilot); no cloud tables or cloud schema change; `pager_ids` moved to 01e; no settings pipeline (A14); no writer hook; no outbox (post-commit frames are best-effort by design, receipts show gaps); receipt rate limit dropped; per-request warning deferred; APK update cut to two endpoints and two CLI verbs.

### 12.6 Build-time fixes (G4 run 3 MINORs, v1.0)

Done during the build, each with its test, and folded into the spec as AD rows at the as-built review (as 01b R27, 01c R32). The fix is the review's (`docs/reviews/01d_v0.5_hostile_run3.md` §3).

| # | Finding | Fix (the review's) | Sections | Test | As built (v1.1) |
|---|---|---|---|---|---|
| BF-1 | m1 — false `pin_use_failed` alarms on honest races and retries | `IdempotentReplay` is not a `prepare` failure (already in v1.0, §3.3 rule 4 (d)). For `method: 'pin'` (the PIN owner's own session), a `409 REQUEST_NOT_PENDING` from `prepare` raises **no** `pin_use_failed` (the failure is still counted and recorded, R1); `pin_use_failed` is kept for `in_person`, and for `pin` with any other error | §3.3 rule 4 (d), §3.10 | extend 60: two managers approve at once with `pin`, the loser gets `409`, one counted failure, no `pin_use_failed` | **Done.** `answer-request.ts` (`honestRace`); tests `answer-pin.int.test.ts`. Folded in §3.3, §3.10, §6.2 |
| BF-2 | m2 — failure of the counting transaction | With R1 the refused-match path is one transaction. If that transaction (`onPrepareFailed`) throws, or the hub crashes before it commits, catch and log the error and **always return the original `prepare` error**, never a `500` that differs by PIN; a failure inside `onMatch` (append) logs and returns the original error after the counter reset | §3.3 rule 4 (d), H-3 | `onPrepareFailed` made to throw → the client still gets the `prepare` error for both PINs | **Done.** `pin.ts` catch, log `{ err, phase: 'onPrepareFailed' }` (AD-20, proposed); tests `answer-pin.int.test.ts`, `auth/pin.int.test.ts`. Folded in §3.3 |
| BF-3 | m6 — kiosk rows still used for receipts, `alert_seen` and the "sent" check | Keep a device-type map from `DevicePaired` in the `device_bindings` projection and **write no row** for `cashier_kiosk` / `kds`; a signed-out kiosk's receipt then has `staff_id = ''` | §3.7, §5.2, §3.6, §6 batch 3 | extend 65: a signed-out kiosk's receipt has `staff_id = ''`; no binding row for a kiosk | **Done.** `bindings.ts`; tests `bindings.int.test.ts`, `alert-mode-delivery.int.test.ts`. §3.7 / §5.2 wording aligned (AD-46, ruled) |
| BF-4 | m8 — earlier days' requests ring at every sign-in | Re-notify (§8.1) only requests raised in the current business day; older open requests are listed without sound and marked "from <date>" | §6.9, §6 batch 3, §8.1 | extend 61: a request from yesterday appears in catch-up without a re-notify | **Done.** `from_business_day` (AD-5, ruled; AD-150, proposed); hub `request-queries.int.test.ts`, client `store.test.ts`, `labels.test.ts`. Folded in §6.9, §6 batch 3, §8.1 |
| BF-5 | m9 — tablet header says "Alerts paused" while the hub still routes | The hub sends `binding_route_until` in `alerts_open` and in a small frame whenever it changes (on each tick that routes to the device); the header uses it, not the tablet's own last session | §3.7, §8.1, H-2 | extend 57 (vi): activity elsewhere moves the header's time | **Done on the hub** (AD-4, ruled; on raise too, AD-126); tests `alert-mode-delivery.int.test.ts`, `BindingHeader.test.tsx`, `StaffApp.test.tsx`. **The 9a page approximates the deadline** until 9b (AD-T42-2, unattended; §3.7, §12.7) |
| BF-6 | m10 — per-transaction cache stale within one transaction | Drop the cached fixed reads for a `tx` when that transaction appends `SessionStarted`, `SessionEnded`, `DeviceRevoked` or `PresenceSet` (the projection apply sees them), and state it in §3.5 | §3.5 | a transaction that appends `SessionStarted` then raises resolves the new session's route | **Done**, also on `DevicePaired` and `BusinessDayClosed` (AD-70, proposed); `targets.ts`; tests `raise.int.test.ts`. Folded in §3.5 |
| BF-7 | m12 — personal notices never closed for a person who leaves | The `StaffDirectoryApplied` dirty flag (as `no_approver`) also makes the tick close `obsolete` the open personal notices of people no longer in `staff` | §3.10, §3.9, §5.2 | a person removed from the directory → their open receipt closed `obsolete` by the next tick | **Done** (AD-3, ruled); `tick.ts`; tests `no-approver.int.test.ts`. Folded in §3.9, §3.10, §5.2 |
| BF-8 | m14 — "absent" undefined | Absent = a `presence_today` row with `present = 0`, nothing else; a person not ticked is present | §3.4.1, §3.11 | extend 5: someone ticked, X not ticked → X present | **Done.** `alert-sockets.ts`, targets; tests `targets.int.test.ts`, `set-presence.int.test.ts`. Folded in §3.4.1, §3.11 |

### 12.7 Open items required before the pilot (v1.1, as built)

None of these blocks the 01d merge (the approvals of (d) were given on 2026-11-02; the merge is the developer's); each must be closed before the pilot.

**Open items (developer, 2026-11-02):** 9b (#63); #58 on the pilot mini PC; manual checks 5 and 7 on the pilot hardware; the carried rows of §4.3 (To the Pulse pass, To 01e and 9b, To 04, To 02 / 01e) and (f) below.

**(a) 9b — the tablet app** (`docs/plans/01d-tablet-plan.md`; AD-1, ruled). Blocked on the tablet model (OQ2: model, Android version, device-owner provisioning). Tasks T1–T6: Capacitor shell over the bundled `staff` entry with the device token in Keystore-backed storage; the native `AlertService` holding alert mode with lock-screen notifications and receipts; one notification per alert (**test #63**); lock-task / device-owner runbook; the silent update client (§8.4); manual checks on the real tablet. It also closes: §12.1 DoD bullet 2 (Android notification on a screen-off tablet), the real tablet header from `alerts_open.binding_route_until` (replacing AD-T42-2), `WS_CLOSE.REPLACED` for `4409` (AD-30), and the 2 h binding manual check.

**(b) #58 on the pilot mini PC** (AD-9, ruled; AD-122). Run `POS_PILOT_HW=1` on the pilot mini PC with 00 #79 and record the numbers in `docs/plans/01d-status.md`. Dev-laptop result after AD-125: 36.6–40.4 ms tick, 0.47–0.53 ms raise.

**(c) The manual checks** in `docs/plans/01d-manual-checks.md` (task 43): 10 checks, **all not done** (they need the developer and the devices).
- Runnable now: 1a kiosk alert mode with no session; 2a waiter's phone falls back to alert mode (with `test_alert`); 2b tablet header text; 2c an alert going "for" the lead; 3 `test_alert` to a person, a team and a device; 6 the APK endpoints by hand; 7 the visual check on the real tablet, kiosk and phone in EN and UR (the request screens are blocked); 9 "Stuck alerts: N" (only N = 0 can be shown, since every shipped kind has one step); 10 the approximate tablet header (AD-T42-2).
- **Blocked (no request kind on a running hub; every shipped kind is `info`):** 1b urgent request on a tablet (sound, banner, the 10 s repeat stopping when opened elsewhere); 4 PIN lockout on answers; 8.3 urgent repeated, 8.4 action sound, 8.5 rising / falling chime, 8.6 silent receipt; the request screens of check 7 (Answer, PIN, InPerson, Notice, Requests, the urgent and result banners, AnswerKiosk, AdminStuck). **Carried to 04** (developer, 2026-11-02): they run with 04's first request kind (§4.3 To 04).
- **Needs the pilot hardware:** 5 (#58, item (b)); 7 on the real pilot tablet, kiosk and phone (developer, 2026-11-02).
- **Moves to 9b:** the 2 h binding rule on a signed-out tablet (no socket on a signed-out 9a page).

**(d) Developer approvals — given 2026-11-02** (closes I-1 and I-2 of the final review): all approved as built; AD-T42-2 approved as approximate (the exact header source carried To 01e and 9b, §4.3); the kit rows AD-A–C approved for now (carried To the Pulse pass). The list as it stood (history): the "Contract changes other modules read" list (§1); every row marked **proposed** in this draft; every **unattended** batch 9a row; an explicit ruling on AD-T42-2 versus BF-5 (accept it as a 9b-carried gap, or approve an additive frame or field); the owner's choice on AD-149 (`raised_at` vs `waiting_ms`) and AD-140 (action-first ordering); whether catch-up rows should replace a held card like lock frames (§8.1, AD-R-d-3); the AD-107 proposal; and the "Unresolved" items of `docs/reviews/01d_v1.1_asbuilt_draft_notes.md`.

**(e) Data gaps from batch 9a** (each needs an additive field or frame; **carried to 02 / 01e**, developer 2026-11-02, §4.3; the header source to 01e and 9b):
- **The tablet header source** (AD-T42-2): the 9a page cannot see the hub's activity clock, and an absent person still shows a deadline until a `binding_route: null` frame. Also the bound person's name is not on the wire (AD-T42-1).
- No approver name for "Waiting for {name} or a manager" / "Find {name} or a manager" (AD-T41-3).
- Test-alert lists show only PIN holders and "This device" (AD-T41-7).
- No sender in the receipts header; no tenant or device name for the brand block (AD-T41-13).
- `request_result` and `approval_receipt` copy is neutral: the view has no request kind, answerer name or decision (batch 9a, task 39); `no_approver` copy names no permission.
- No close time on inbox rows and `alert_closed` (closed rows omit the time).
- 79 Urdu strings still in English (`docs/design/handoff/01d/urdu-todo.md`); the "Nothing open." string for an empty Open list (AD-V-2).

**(f) Carried rows** (not built in 01d): to 02 and 04, the requester's waiting card (AD-1) and the Requests (n) / Inbox (n) top-bar buttons (AD-168); to 01a, the `config-status` amendment (AD-123, applied as 01a v2.0.1); to 00 and 01b, the as-built notes of §4.5 (applied as 00 v1.6.1 and 01b v1.4.1); to the Pulse pass, the kit reconcile (AD-A–C); to 01e and 9b, the exact tablet header source (AD-T42-2); to 04, the blocked manual checks; to 02 / 01e, the data gaps of (e) (§4.3).

**Done at approval (2026-11-02):** the README module map row 01d moved to v1.1 APPROVED, Implemented; 00, 01a and 01b got their as-built patch bumps (v1.6.1, v2.0.1, v1.4.1). The merge is the developer's.
