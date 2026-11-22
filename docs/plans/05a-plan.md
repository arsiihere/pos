# 05a Device Access + Screens — Implementation Plan (spec v1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to run this plan task by task. Every task is TDD: write the failing test first, record its failing line, then implement. One task = one branch = one PR into `module-05a` = one commit after review. Process, tiers, reviewer rules and branch recipes: `docs/plans/integrator-handbook.md`. Board: `docs/plans/05a-status.md`. Hand checks: `docs/plans/05a-manual-checks.md`.

> **`module-05a` IS CUT FROM `fix/stab-tablet-pairing`; THE 05a PR COMES AFTER THE STAB PR** (owner, 2026-11-23 03:44–03:45 PKT, D-7; was "build starts after the stab merge"). The stab branch carries 00 v1.12.2 (STAB-1 **Add a tablet**, M86), 03b v1.0.14, 05 v1.0.34 and hub migration `0026`. Later stab work comes into `module-05a` **only by `git merge fix/stab-tablet-pairing`**, never a rebase: merge the latest stab tip before each batch, then run the gate. STAB must not bump 00, 01d, 03b or 04 any more; a new version of any of them at the stab tip → **STOP**. The stab PR merges to `main` first. Then `main` is merged into `module-05a`, and the 05a PR follows.

**Goal:** build 05a v1.0. It covers:
- pairing by request for every device type, with the token routes removed;
- the device profile: name, screens, access (`everyone` / `listed`) and point;
- the sign-in check and the listed-only / money mask in `resolve()`;
- the 01d money-request rules and `device_waiting`;
- profile-driven bindings and the 03b Pass readers;
- the upgrade boot step and the admin recovery link;
- the client screens: approve form, device list, shell tabs, deep-link fallback and answer sheet.

It also covers every §4.5 row in the other specs.

**Architecture:**
- A new event, `DeviceProfileSet`, folds into two projections (`device_profiles`, `device_people`) and an in-memory `deviceProfile` map.
- A session-bound view, `directory.forSession(session)`, applies the mask at one point. Every check inherits it: pipeline, queries, admin guard, PIN hooks and `mayAnswer`.
- Handlers do not change. A downgraded grant takes each command's existing request path, and 01d chooses `named` or `holders` at raise.

**Tech stack:** TypeScript, Fastify 5, better-sqlite3 (WAL, `synchronous=FULL`), Zod (`fastify-type-provider-zod`), `@pos/domain`, `@pos/events`, React client, Vitest (root `test.projects`).

**Spec:** `docs/specs/05a_Device_Access_Screens_Spec_v1.0.md` (APPROVED 2026-11-23 03:24 PKT, with every §4.5 row). Reviews: `docs/reviews/05a_v0.3_hostile_review.md`, `05a_v0.4_targeted_check.md` (§3 is the STAB-1 conflict table) and `05a_v0.5_final_check.md`. Deferred, so do **not** build: spec §1 "Out of scope" and §12.4.

**What is different from the 04 and 05 plans (and why):**

| 04 / 05 did | 05a does | Why |
|---|---|---|
| Phase 0 took fixed version numbers | **P0.1 takes every target's version number when phase 0 runs**, against `main` at that time | `fix/stab-tablet-pairing` moves 00, 03b and 05 before 05a starts; the spec says re-check then (v1.0 changelog) |
| Parallel lanes, up to 4–6 agents | **Batches of ~5 tasks in §11 build order**, sequential batches, tasks inside a batch in parallel only where the "Needs" column allows | 05a is one chain: profile → view → pairing → sign-in → 01d. Few tasks can run side by side |
| Spike gate | **No spike.** The STAB-1 ordering rule (task 15) is the one hard ordering constraint | No new money path, no outbox; the risk is lockout, which tests 11, 15, 16 and 16a cover |
| Client blocked on a design handoff (04) or built on existing patterns (05 D-3) | **Client batch B8 uses existing page patterns** (PL-1, owner 2026-11-23 03:35 PKT) | The device list and forms are admin pages like 05's settings pages |

---

## 0. Decision log

| # | When | Who | Decision | Where it landed |
|---|---|---|---|---|
| D-1 | 2026-11-23 03:24 PKT | owner | Spec 05a v1.0 approved with every §4.5 row | spec, README row 05a |
| D-2 | 2026-11-23 | owner (task brief) | Phase 0 applies every §4.5 row as version bumps of 00, 01d, 03b and 04, plus the F §6.2 append, with "⚠️ Changed by 05a" markers. Version numbers are taken when phase 0 runs | P0.1, P0.4–P0.8 |
| D-3 | 2026-11-23 | owner (task brief) | Build order = spec §11. In step 4, the request-based fixture comes first, and the **Add a tablet** removal lands in the same commit that lets `ApprovePairingRequest` accept `tablet` and `phone` | tasks 13, 15 |
| D-4 | 2026-11-23 | owner (task brief) | ~~Build starts after `fix/stab-tablet-pairing` is merged to `main`~~ (superseded by D-7) | G0.1 |
| D-5 | 2026-11-23 03:35 PKT | owner | PL-1 – PL-4 confirmed as written (PL-1: no 05a handoff; Pulse mapping later for all modules in one pass) | below |
| D-7 | 2026-11-23 03:44–03:45 PKT | owner | **Do not wait for the stab merge.** Cut `module-05a` from `fix/stab-tablet-pairing` now; P0.1 reads the stab tip; stab work only by merge, before each batch, then the gate; STAB never bumps 00 / 01d / 03b / 04 again (else STOP); the stab PR first, then `main` merged into `module-05a`, then the 05a PR. Work only in `~/pos-05a`; no PR opened by the build session | header, G0.1, P0.1, P0.3, Z3 |
| D-6 | 2026-11-23 03:35 PKT | owner | **Staff device with no profile, split rule (was G-a).** (1) **Permissions:** treat it as `access = 'everyone'` (masked, fail-closed). (2) **Sign-in:** today's rule, **not** `everyone`. A `phone` accepts only its `owner_staff_id`; a `tablet` / `cashier_kiosk` accepts any directory staff. A phone without a profile never accepts any other PIN. Lands as a §3.3a / §3.5 note in **05a v1.0.1** (owner-approved now; written in P0.2's spec patch) | Review Focus 1, P0.2, tasks 9, 17 |

**Readings confirmed by the owner** (2026-11-23 03:35 PKT, D-5):

| # | Reading | Rec |
|---|---|---|
| PL-1 | Client batch B8 is built on existing page patterns (as 05 D-3), with no 05a design handoff | **Yes** (Pulse mapping later, all modules in one pass) |
| PL-2 | Rows **B-1** (05: "no rule change") and **C-1** (client shell) are not version bumps of 05 or another spec. B-1 is recorded in the README row only. C-1 is built in task 34 from 05a §8. If P0.2 finds approved text in 05, 02b or 00 §8 that contradicts either row, that text needs a bump outside the four named targets, which means **STOP** for the owner | Yes |
| PL-3 | Integration branch `module-05a`, cut from `main` after G0.1. Task branches `lane-05a<L>/05a-<task>` | Yes |
| PL-4 | Tiers as 05 W-7: HIGH = one fresh Opus reviewer with mutation checks, plus a short re-check after a MAJOR fix. NORMAL = one Sonnet reviewer | Yes |

---

## Global Constraints

Values copied from the spec. Every task's requirements include this section.

- `devices.device_type` keeps `'tablet' | 'cashier_kiosk' | 'kds' | 'phone'`; it never changes on a row and means hardware only (§2).
- `hardware_hint ∈ {'tablet','cashier_kiosk','kds','phone'}`, a form default only. The pair page sends `phone` when the UA matches `/iPhone|Android.*Mobile/`; otherwise it sends nothing (§6.1).
- `device_name` 1–40 chars. `listed` ⇒ `staff_ids` 1–20 unique; `everyone` ⇒ `staff_ids` absent. `screens` 1–6 unique, offered for the hardware. `pass` ⇔ `point_id` set (§3.6, §6.3).
- `SCREEN_KEYS = ['dine_in','takeaway','parking','cashier','pass','manager']`. `cashier` is offered on `cashier_kiosk` and `tablet` only. `kds` has no screens (§3.6).
- `LISTED_ONLY_PERMISSIONS = ['access-hub-admin','manage-devices','manage-staff','manage-roles','manage-fiscal-settings','approve-void','view-audit-log']`. `MONEY_PERMISSIONS = ['void-item','apply-discount','apply-comp','apply-refund','reopen-bill']` (§3.3).
- New error codes: `DEVICE_ACCESS_DENIED` 403 `{ device_id }`, `DEVICE_ACCESS_SELF` 422 `{ device_id }`. New `PERMISSION_DENIED` reasons: `listed_device_only`, `in_person_removed`, `recovery_not_needed`. `DEVICE_NOT_OWNED` stays defined and is no longer returned (§9, §3.5).
- Only `authorize`, the §3.5 checks and `AnswerRequest` add `reason: 'listed_device_only'`. The seven handler-owned `403` sites keep their details as they are (§3.3a N-6).
- Every `DeviceProfileSet` carries `profile_version` = the previous one + 1 (1 for the first), whatever its cause (§4.2 N-4).
- The `DeviceProfileSet` fold is the **only** writer of `devices.point_id`. The `device_roles` fold writes `lane_label` only (K-1, §5.1).
- Hub migration `0027_device_profiles.sql`. Its first line is `-- migrate:foreign-keys-off`. Merged migrations are never edited (§5.1).
- Recovery link: single-use, 30 minutes (M72). "Live" = `consumed_at IS NULL AND expires_at > branchNow` on `admin_bootstrap_tokens` (§6.11 R-1).
- No new timer, cache, job or dependency. Every check reads `deviceProfile` and the directory in memory, with no statement (§7).
- Layout: bottom tabs ≤ 760 px, top bar wider (`PHONE_QUERY`). What is shown never depends on `device_type` or width (C-1).
- Exact copy (§3.8, §6.11, §8, §3.9, M-8):
  - "Ask someone with hub access to approve this screen"
  - "Confirm on your phone"
  - "Approve on a listed device"
  - "Waiting — find a manager" (`request.find_approver`)
  - "This device is not set up for you"
  - "Do this on your own phone"
  - "You would lose access on this device"
  - "Open this on a device with <screen>"
  - "Only one device can manage devices — add a backup"
  - "No device can manage devices"
  - "Recover admin access"
  - "A recovery link was already made — it works until <time>"
  - "Alerts: none"

## Review Focus

These five are inputs the spec implies but no §10 test exercises. Each has a test in its owning task.

1. **A staff device with no profile** (a bug, a race, or a row the old `pairDevice` helper inserts). The spec never leaves a non-kds device without a profile, so task 15 and task 28 assert that invariant. The fallback is ruled (D-6, 05a v1.0.1). **Permissions** are masked as on an `everyone` device (fail-closed). **Sign-in** keeps today's rule: a phone accepts only its `owner_staff_id`, and a tablet or kiosk accepts any directory staff. Tests: `[05a RF-1]` in task 9 (mask), task 17 (sign-in) and task 28 (invariant).
2. **A revoked device stays in memory.** After `DeviceRevoked`, `deviceProfile(id)` is `undefined`, the M-8 count drops it, and its token gets `DEVICE_REVOKED` as today. Test `[05a RF-2]` in task 7.
3. **A double approve of one request** (two admins, or a retry on `/commands` and `/admin/commands`). The second gets the D32 replay or `404 PAIRING_REQUEST_NOT_FOUND`, and there is exactly one `devices` row and one `DeviceProfileSet`. Test `[05a RF-3]` in task 15.
4. **An edit that removes `cashier` from a kiosk with an open drawer shift.** The shift stays open and payable from another `cashier` device. Screens are a view boundary only (M-4), and the drawer is decided by hardware (§3.6). Test `[05a RF-4]` in task 19.
5. **A device offline during an edit.** On reconnect, `GET /queries/session` returns the current `device.screens`, so the tabs redraw without the missed `device_profile` push. Test `[05a RF-5]` in task 12 (hub) and task 34 (client).

---

## 1. Global rules (every task)

- **Branches:** integration branch `module-05a` (PL-3). Task branch `lane-05a<L>/05a-<task>`. Base = `origin/module-05a`, or the previous unmerged task of the same batch (stacked; the PR body says `Stacked on #<n>`). Rebase only your own task branches.
- **PR (REST, `gh api`):** title `05a-<task>: <title> [05a §x]`. The body lists:
  - spec sections;
  - the tests added, each with its failing-first output line;
  - the statement counts asserted;
  - Readings, and `Needs: #…`;
  - the tier, and the review verdict.

  The body ends with "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Labels `lane:05a-<L>`, `tier:HIGH` / `tier:NORMAL`. Rebase-merge by the integrator, with CI green.
- **Commit:** one per task after review.
  - Code: `feat(05a): <title> [05a §x; §11 step N]`.
  - Code under a row: `feat(<module>): <title> [05a §4.5 <row>]`.
  - Spec bumps: `docs(<module>): v<x> — 05a rows <…> [05a §4.5]`.

  Author `Arslan Ahmed Arif <arsiiahmi@gmail.com>`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **TDD recipe (every task, the 5 steps):**
  1. Write the tests named in the row, with the spec's values.
  2. Run `TMPDIR=/dev/shm pnpm vitest run <files>` and record the failing line.
  3. Implement the signature in the row.
  4. Rerun the tests until they pass, plus the typecheck of the package touched.
  5. Run the full gate once before the PR: `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`. Then commit.

  Tasks 5, 15, 21, 27 and 28 also run the full hub suite during the task: they rebuild `devices`, refold projections or remove a route that many tests use.
- **Test names cite the spec:** `it('[05a #12] …')`, row tests `it('[05a row D-1] …')`, Review Focus `it('[05a RF-3] …')`. Use real tables and real events, never a mock of another task's code. Fixtures are `apps/hub/test/helpers/device-access.ts` (task 8) and `apps/hub/test/helpers/pair-by-request.ts` (task 13). Count statements with `statementCounter(db)` wherever the spec states a count. No timing asserts (03a AD-32).
- **Files:** only the files in your task row. A test that only pins a value an approved row changes may be edited by that row; list it under Readings. Anything else is a **STOP**: a contract change, a spec–code mismatch, a line number that moved and changed meaning, or two specs disagreeing. Put a STOP block in the PR body, add the label `needs-ruling`, and the owner answers.
- **Privacy:** never put a display code, token, PIN or name in a log, event, alert or audit detail beyond what the spec lists. `device_waiting` never carries the code (§3.10).
- **Never in the cloud or CI:** `pnpm test:perf`, hardware checks and power-loss checks (CLAUDE.md). The §12.1 hand checks are in `05a-manual-checks.md`.

| Marker | Meaning |
|---|---|
| **HIGH** | migration, projection, the mask, sign-in, sessions ended, pairing, 01d raise / answer / routing, boot step, recovery. Opus implementer + one fresh Opus reviewer (PL-4) |
| **NORMAL** | constants, texts, fixtures, queries without a rule, client pages. Sonnet + one Sonnet reviewer |
| **Cross** | code in another module's files (00 auth / commands, 01d alerts, 03b kds, 04 audit). Only the task that names the row |
| **Shared** | `packages/domain`, `packages/events` |

---

## 2. Phase 0 — gate, version numbers, spec bumps (integrator, one session, sequential)

| # | Task | Spec | Files | Done when |
|---|---|---|---|---|
| G0.1 | **Gate (D-7):** `module-05a` is cut from the `fix/stab-tablet-pairing` tip, and the 05a spec / plan branch (`spec/05a-device-access`) is merged into it | D-7 | — | `git merge-base --is-ancestor fix/stab-tablet-pairing module-05a` and `git merge-base --is-ancestor spec/05a-device-access module-05a` succeed; the stab sha is recorded on the board |
| P0.1 | **Take the version numbers first.** For each target, read `docs/specs/README.md` and the newest file **at the stab tip** (D-7), then scan every open `module-*`, `spec-*` and `fix/*` branch and open PR that claims a newer number. Each target's 05a version = next free after all of them. Targets: **00** (expected ≥ v1.12.2), **01d** (≥ v1.3.4), **03b** (≥ v1.0.14), **04** (≥ v1.0.7); Foundation stays at its number (F-1 is an append, no bump); **05 is not bumped** (PL-2). Also check that hub migration **`0027`** is the next free number (`main` will carry `0026` from STAB). If `0027` is taken → STOP (the spec fixes the name). Write the table on the board (§ "Version numbers") | v1.0 changelog; §4.5 | `docs/plans/05a-status.md` | board table filled; no number guessed |
| P0.2 | **Gap sweep.** The spec's file:line cites were taken against `spec/05a-device-access` and `fix/stab-tablet-pairing`. Re-check every cite in §2–§11 against `main` @ G0.1: STAB-1 pieces (`admin/page.ts` `#add-tablet`, `generate-device-pairing-token.ts`, `pair-page.ts` `d`), `approve-pairing-request.ts:15-20`, `apply-directory.ts:426`, `alerts/bindings.ts:97-99`, `alerts/routes.ts:115-119`, `alerts/targets.ts:443,516`, `kds/device-roles.ts:36,64-82`, `print/routes.ts:111`, `auth/guards.ts:196-250`, `bootstrap-tokens.ts:9-44`, `commands/route.ts:144-146,353-373`, `queries/registry.ts:19,31,106,119`, `socket.ts:90-94`, `StaffApp.tsx:500-510`, `shell/layout.ts:4`, `AnswerSheet.tsx:412-415`, `BindDialog.tsx:45`, `PassScreen.tsx:130`. Moved lines are patched in this plan. A changed meaning becomes a G-row with options + Rec in `docs/plans/05a-gaps.md`. **Known G-rows to write:** **G-a** is **ruled** (D-6): P0.2's spec patch writes **05a v1.0.1** (owner-approved 2026-11-23 03:35 PKT) with a §3.3a note (no profile → masked as `everyone`) and a §3.5 note (no profile → today's sign-in rule: phone = `owner_staff_id` only, tablet / kiosk = any directory staff), each marked "⚠️ Changed by v1.0.1 (D-6)". **G-b**: the audit detail `people: display names` versus 04's events-only `audit` projection (Rec: the detail stores `staff_ids`, and `audit-log` maps names from `staff_names` at read, as 04 a3 does). **G-c**: is PL-2 contradicted by any approved text? The owner rules once; the plan is patched (`docs(05a): plan patch from gap sweep`) | all | `docs/plans/05a-gaps.md`, this plan | every G-row ruled |
| P0.3 | Cut `module-05a` from the stab tip (G0.1, D-7). Ruleset as 04 W-1 (PR required, check `gate`, rebase merge, no force push). Labels `needs-ruling`, `tier:HIGH`, `tier:NORMAL`, `lane:05a-P0`, `lane:05a-B1` … `lane:05a-B8`, `lane:05a-Z`. Board header filled. `docs/plans/05a-cleanup.md` (empty, header as `05-cleanup.md`) | — | `docs/plans/05a-status.md`, `docs/plans/05a-cleanup.md` | branch + ruleset exist |
| P0.4 | **00 bump** at P0.1's number: rows **H-1 – H-7**, plus K-2's 00 §8.2 half, with a changelog row and "⚠️ Changed by 05a (<row>)" markers on every changed line. H-1 lists what is removed, including the STAB-1 M86 flow and 00 tests 167 / 168 (replaced by 05a test 1). H-7 adds `AdminBootstrapTokenIssued` v2 and the `deviceId` parameter. Re-read every 00 version between v1.12.2 and P0.1's number first; any conflict → STOP | §4.5 H-1–H-7, K-2 | `docs/specs/00_Hub_Platform_Access_Spec_v<n>.md`, README row 00 | one PR, NORMAL review |
| P0.5 | **01d bump**: rows **D-1 – D-4** (bindings table + 3 code points, `in_person` removed, §3.9 rules 1–4, `device_waiting` kind + link type `devices` + route `#/devices`, `always_on` reader) | §4.5 D-1–D-4 | `docs/specs/01d_Notifications_Requests_Spec_v<n>.md`, README row 01d | one PR |
| P0.6 | **03b bump**: rows **K-1** (`SetDeviceRole.point_id` removed, `device_roles` fold lane-only, "Pass tablet" = non-kds device with `point_id` in every reader) and **K-2** (Kitchen screens page link → device edit form) | §4.5 K-1, K-2 | `docs/specs/03b_KDS_Pass_Spec_v<n>.md`, README row 03b | one PR |
| P0.7 | **04 bump**: row **A-1** (audit action `device_profile_set`, detail per §4.2 as ruled in G-b) | §4.5 A-1 | `docs/specs/04_Voids_Audit_Spec_v<n>.md`, README row 04 | one PR |
| P0.8 | **F §6.2 append** (row F-1, R34, no bump): `DEVICE_ACCESS_DENIED` 403, `DEVICE_ACCESS_SELF` 422. README rows 05a (bumps landed; B-1 note per PL-2) and the carried-rows column | §4.5 F-1, B-1; §9 | Foundation spec file on `main`, `docs/specs/README.md` | one PR |

P0.4–P0.8 merge in that order, each as its own PR into `main` (W-3 docs-PR rule). `module-05a` is then synced linearly (handbook §7.2). **Phase 0 is done** when G0.1–P0.8 are merged and CI on `module-05a` is green.

---

## 3. Build batches (spec §11 order)

"Needs" = tasks whose PR must be merged first; phase 0 is assumed. Each batch is ~5 tasks. Batch N+1 opens when batch N is merged, except where a row needs only earlier batches.

### B1 — shared contracts (§11 step 1)

| # | Task | Spec | Files | Interfaces (produces) | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 1 | Permission lists + screens | §3.3, §3.6 | `packages/domain/src/permissions.ts` (2 lists), `packages/domain/src/screens.ts` (new), `packages/domain/src/index.ts` (1 line) | `LISTED_ONLY_PERMISSIONS: readonly Permission[]`, `MONEY_PERMISSIONS: readonly Permission[]`, `SCREEN_KEYS`, `type ScreenKey`, `screensOffered(t: DeviceType): readonly ScreenKey[]`, `type Masked = 'listed_only' \| 'downgraded'` | lists exact (Global Constraints); `screensOffered('phone')` has no `cashier`; `screensOffered('kds')` = `[]`; the lists are disjoint | — | NORMAL, Shared |
| 2 | Error codes | §9, F-1 | `packages/domain/src/errors.ts` | `DEVICE_ACCESS_DENIED` (403), `DEVICE_ACCESS_SELF` (422); `PermissionDeniedReason` adds the 3 reasons | codes + HTTP status; `DEVICE_NOT_OWNED` still defined | — | NORMAL, Shared |
| 3 | Audit action `device_profile_set` | §4.2, A-1 | `packages/domain/src/audit.ts` | `toAuditEntry` maps `DeviceProfileSet` → action `device_profile_set`, detail per G-b, actor = event `actor_id` | the mapping, actor null for `upgrade` / `directory`; existing `device_paired` / `device_revoked` / `pairing_token_generated` unchanged | 4 | NORMAL, Shared, Cross |
| 4 | Events | §4.2, H-7 | `packages/events/src/events/hub/DeviceProfileSet.v1.ts` (new), `AdminBootstrapTokenIssued.v2.ts` (new, identity upcaster from v1), `packages/events/src/index.ts` | `DeviceProfileSet` v1 payload exactly as §4.2 (`.strict()`); `AdminBootstrapTokenIssued` v2 `issued_by: 'setup' \| 'cli' \| 'restore' \| 'recovery'` | parse fixtures; a v1 event upcasts to an equal v2 | 1 | NORMAL, Shared |

### B2 — data model and memory (§11 step 2)

| # | Task | Spec | Files | Interfaces | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 5 | Migration `0027_device_profiles.sql` (FK-off header; `devices` rebuild dropping the phone/owner CHECK, keeping every `0002` + `0008` column in order and the kds/station CHECK; `device_profiles`, `device_people`, index `device_people_staff`; `pair_requests.hardware_hint`) | §5.1, H-5 | `apps/hub/src/db/migrations/0027_device_profiles.sql`; the migration-list test (Reading) | — | schema test: columns in order, both CHECKs on `device_profiles`, kds CHECK kept, phone CHECK gone, FKs pass `foreign_key_check`, rows survive with the same values, a phone row with null owner inserts; **full hub suite** | B1 | HIGH, Cross |
| 6 | Projections `device_profiles` / `device_people` (fold = upsert whole profile, `reset` = DELETE both) + forward-only `UPDATE devices SET device_name, point_id`; registered in `registerHubProjections` | §5.1, §5.2 | `apps/hub/src/projections/device-profiles.ts` (new), `apps/hub/src/lib/boot.ts` (1 line) | `deviceProfilesProjection(): Projection` | **#14**; §5.2 invariants; reset + replay equals the folded rows; `devices.point_id` = last event's | 5 | HIGH |
| 7 | `deviceProfile` memory map + M-8 count | §4.2, M-8 | `apps/hub/src/auth/device-profile.ts` (new); loaded at boot and refreshed post-commit after `DeviceProfileSet`, `DevicePaired`, `DeviceRevoked` | `type DeviceProfile = { access: 'everyone'\|'listed'; staff_ids: ReadonlySet<string>; screens: readonly ScreenKey[]; point_id: string\|null; needs_review: boolean }`; `deviceProfile(device_id: string): DeviceProfile \| undefined`; `listedAdminDeviceCount(dir: StaffDirectory): number` (unrevoked `listed` devices listing someone whose unmasked `manage-devices` is `allowed`) | load from projection at boot; refresh after each of the 3 events; **RF-2**; count 0 / 1 / 2; no statement on read | 6 | HIGH |
| 8 | Test fixture: profiles | §10 | `apps/hub/test/helpers/device-access.ts` (new); `pairDevice` in `test/helpers/test-hub.ts` gains `profile?: { access; staff_ids?; screens; point_id? }` (appends `DeviceProfileSet` through the writer) | `withProfile(h, deviceId, p)`, `signInOn(h, deviceId, staffId)`, `directoryWith(roles)` (Manager, Cashier, Waiter, Floor manager; Ali, Bilal) | fixture self-test | 7 | NORMAL |

### B3 — the session view (§11 step 3)

| # | Task | Spec | Files | Interfaces | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 9 | `forSession` view | §3.3a, H-3 | `apps/hub/src/auth/staff-directory.ts` | `Resolution` gains optional `masked?: Masked`. `StaffDirectory.forSession(s: { staff_id: string \| null; device_id: string \| null }, profileOf: (id: string) => DeviceProfile \| undefined): SessionDirectory`. `SessionDirectory` has the same read methods as `StaffDirectory`, and `resolve` applies the §3.3a table only when `staff_id === s.staff_id` and the device's access is `everyone` | **#4** (every row of the table; listed device and bootstrap session unmasked; other staff ids unmasked); **RF-1** mask half (D-6): a staff session on a `tablet`, `cashier_kiosk` or `phone` with no profile gets the `everyone` table (every `LISTED_ONLY_PERMISSIONS` entry `not_granted / listed_only`, every `MONEY_PERMISSIONS` entry `downgraded`) | 7 | HIGH |
| 10 | Call sites: commands `ctx.directory`, queries `ctx.directory`, PIN hooks, `authorize` (adds `reason: 'listed_device_only'` when `masked === 'listed_only'`); queued commands resolve at execution | §3.3a, H-3 | `apps/hub/src/commands/{registry,route}.ts`, `apps/hub/src/queries/registry.ts`, PIN hook wiring | ctx.directory: `SessionDirectory` | **#4a**, **#4b** (fiscal half, details unchanged, no `reason`), **#4c**, **#20** | 9 | HIGH, Cross |
| 11 | Admin guard + direct routes: `requireAdmin` → view's `hasAdmin`; `adminPermissions`, `permissionsOf` via view; `print/routes.ts` `requireManageDevices` → view | §3.3a | `apps/hub/src/auth/guards.ts`, `apps/hub/src/print/routes.ts` | — | **#4b** (printer half); **#4d** (`403` half: an admin session on an `everyone` device → `403`) | 9 | HIGH, Cross |
| 12 | `GET /queries/session`: `device: { device_id, screens, access, point_id }`; `permissions[p]` from the view with `masked` | §6.7 | `apps/hub/src/queries/session.ts` | response type in `@pos/domain` if the client imports it | **#4g**; query count 0; **RF-5** (hub) | 10 | NORMAL |

### B4 — pairing (§11 step 4; the STAB-1 rule)

| # | Task | Spec | Files | Interfaces | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 13 | **Request-based pairing fixture first.** Move every hub int test that pairs through tokens onto it: `test/commands/generate-pairing-token.int.test.ts` (keep only what survives task 15, else delete in 15), `test/auth/pairing.int.test.ts`, `test/admin/admin-page.int.test.ts`, and the token use in `log-redaction`, `cors`, `guards`, `provision`, `restore` int tests. No production change | §11 step 4; check §3 | `apps/hub/test/helpers/pair-by-request.ts` (new), the listed tests | `pairByRequest(h, { device_type, hardware_hint?, profile? }): Promise<{ deviceId; token }>` (POST `/pair/requests` → approve → poll) | the moved suites stay green; `git grep -n "pairing_token\|/devices/pair" apps/hub/test` lists only files task 15 deletes | 8 | NORMAL |
| 14 | `POST /pair/requests` takes `hardware_hint?` (column); `GET /pair/requests/:id` `approved` adds `screens` | §6.1, §6.2 | `apps/hub/src/auth/pair-requests.ts` | — | **#25**; hint stored; poll returns `screens`; query count unchanged (1) | 5 | NORMAL, Cross |
| 15 | **One commit:** `ApprovePairingRequest` v2 (`sessionKind: 'both'`, payload §6.3, accepts `tablet` and `phone`, staff-device validation, INSERT with no owner, `DevicePaired` + `DeviceProfileSet { cause: 'approved', profile_version: 1 }`, refresh `deviceProfile`) **and in the same commit** remove: `GenerateDevicePairingToken`, `POST /devices/pair` and their registrations (`pairing_token` stays in `SECRET_FIELDS`), the pair page `t` / `d` branch, the hub admin **Add a phone** and **Add a tablet** (STAB-1) views, and 00 tests 167 / 168 | §6.3, H-1, M-3 | `apps/hub/src/commands/approve-pairing-request.ts`, `commands/generate-device-pairing-token.ts` (delete), `auth/pairing.ts` (delete), `auth/pair-page.ts`, `admin/page.ts`, `server.ts`, tests listed in task 13 | result `{ device_id, device_type, station_id, screens, access }` | **#1**, **#2**, **#13** (approve half), **#24**; statements per §6.3; **RF-3**; every non-kds device approved has a profile (RF-1 invariant); a `tablet` is pairable before and after this commit (CI on the parent commit already green); **full hub suite** | 10, 13, 14 | HIGH, Cross |
| 16 | Pair page text + hint: one flow for every device, "Ask someone with hub access to approve this screen", sends `hardware_hint: 'phone'` on `/iPhone\|Android.*Mobile/`, iOS "Add to Home Screen" first | §8, §6.1 | `apps/hub/src/auth/pair-page.ts` | — | the page text; UA → hint table (iPhone, Android Mobile, iPad desktop UA, Android tablet → none) | 15 | NORMAL |

### B5 — sign-in, profile edit, device list, directory (§11 steps 5–6)

| # | Task | Spec | Files | Interfaces | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 17 | §3.5 checks in `/auth/pin` and `/admin/auth`: before 00 §3.5 step 2, not counted, no argon2; `DEVICE_ACCESS_DENIED` replaces `DEVICE_NOT_OWNED`; `/auth/pin` response adds `device`; takeover only within the list or on `everyone` | §3.5, §6.5, H-2 | `apps/hub/src/auth/{staff-session,pin,admin-session}.ts` | — | **#3** (PIN half: argon2 spy not called, counters unchanged), **#4e**, **#26**; **RF-1** sign-in half (D-6), on devices inserted with no profile: a `phone` with `owner_staff_id` = Ali accepts Ali and refuses Bilal's correct PIN with `403 DEVICE_ACCESS_DENIED` (no argon2, nothing counted); a `phone` with no profile and a null `owner_staff_id` refuses **every** PIN; a `tablet` and a `cashier_kiosk` with no profile accept any directory staff; `/admin/auth` on any no-profile device → `403 listed_device_only` (mask half) | 15 | HIGH, Cross |
| 18 | `staff-roster` (listed → its people); `/admin/login-roster` (`everyone` → `403 listed_device_only`; listed → its people with `access-hub-admin` `allowed`; adds `recovery_available` = `listedAdminDeviceCount(dir) === 0`) | §6.6, §6.11 signal, H-2 | `apps/hub/src/queries/staff-roster.ts`, `apps/hub/src/auth/admin-session.ts` | — | **#3** (roster half); **#16** (`recovery_available` half); query count unchanged (2) | 17 | NORMAL, Cross |
| 19 | `SetDeviceProfile` (`sessionKind: 'both'`): steps 1–6 of §6.4, incl. the self-guard, `profile_version + 1`, post-commit ends of staff **and** admin sessions of anyone no longer allowed (`'forced'`, sockets `4401`), admin sessions ended on a switch to `everyone`, WS push `device_profile { screens, access, point_id }`; audit row via task 3 | §6.4, M-6, N-1 | `apps/hub/src/commands/set-device-profile.ts` (new), its registration | WS frame `device_profile` | **#9**, **#10**, **#11**, **#4d** (end half), **#13** (edit half), **#27**; statements per §6.4; **RF-4** | 17 | HIGH |
| 20 | `RevokeDevice` → `sessionKind: 'both'`; H-6 queries may be `'both'`; the `devices` query (§6.8): rows add `access`, `people`, `screens`, `point_id`, `profile_version`, `needs_review`; `pairing_source` dropped; `pending_requests` (never the code); `admin_warning` | §6.8, H-4, H-6, M-8 | `apps/hub/src/commands/revoke-device.ts`, `apps/hub/src/queries/{registry,devices}.ts` | `QueryDef.sessionKind: 'device' \| 'admin' \| 'both'` | **#16** (`admin_warning` 0 / 1 / null); query count = today's + 2; revoke on `/commands` from a listed device | 18 | NORMAL, Cross |
| 21 | Directory apply (§6.9, H-4): `owner_staff_id` readers → `staff_ids`; `phone_count` → `device_count`; one `device_people` read; per device: non-empty → `directory` event; emptied phone → revoke `owner_removed`; other emptied → `everyone` + `needs_review` | §6.9, M-5, H-4 | `apps/hub/src/auth/apply-directory.ts`, `apps/hub/src/queries/staff.ts` (device_count) | — | **#12** (every clause); 1 statement for the read; **full hub suite** | 19 | HIGH, Cross |

### B6 — 01d rows (§11 step 7, first half)

| # | Task | Spec | Files | Interfaces | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 22 | **D-1 bindings**: the projection consumes `DeviceProfileSet` and keeps its own `device_id → latest profile` map; permanent row for one-person `listed` on any hardware; `bindings.ts:97-99` stops skipping phones; `routes.ts` keys permanent rows on `session_id IS NULL`; `binding_route_until` null for every permanent row | §3.8, D-1 | `apps/hub/src/alerts/{bindings,routes}.ts` | — | **#14a**, **#14b** (replay half: bound to `DevicePaired.owner_staff_id` until a profile) | 21 | HIGH, Cross |
| 23 | **D-2 answers**: `in_person` → `403 in_person_removed` in `preRead`, before argon2; a money-kind answer (`needs_pin: 'always'`) from an `everyone` device → `403 listed_device_only` after rule 3, re-checked in `prepare`; rule 5 skipped only for a `named` request whose receiver is its requester | §3.9 rule 2, D-2 | `apps/hub/src/alerts/commands/answer-request.ts`, `alerts/targets.ts` (`mayAnswer`) | — | **#8**, **#4f**, **#5**, **#6**, **#28** | 21 | HIGH, Cross |
| 24 | **D-2 downgraded raise**: `raise` reads `ctx.permission.masked === 'downgraded'`; (a) the requester has an unrevoked listed device connected now (`ws.connectedSessions()` / `alertSockets()`) → `right_mode: 'named'`, receiver = requester; (b) else `holders` of the kind's `range_permission`, else `base_permission`; chosen once at raise | §3.9 rule 1, A-2 | `apps/hub/src/alerts/raise.ts` | — | **#17**, **#17a**, **#18**, **#19** (discount, comp, reopen); no statement added | 23 | HIGH, Cross |
| 25 | **D-2 routing**: for a money kind, drop person routes to `everyone` devices at resolve; `requests-to-answer` on an `everyone` device omits money requests; reachability counts listed-device routes only | §3.9 rule 3, M-5 | `apps/hub/src/alerts/targets.ts`, `alerts/queries/requests-to-answer.ts` | — | **#7**, **#7a**, **#7b** | 24 | HIGH, Cross |
| 26 | **D-3 `device_waiting`**: kind (family `info`, subject hub / branch_id, dedupe `device_waiting`, `lead_fallback: false`); link type `{ type: 'devices' }`; raise in the `POST /pair/requests` transaction when none is open; close `done` in approve when no other request is pending; close `obsolete` in the session sweeper's existing write | §3.10, D-3 | `apps/hub/src/alerts/kinds.ts`, `packages/events/src/alerts.ts` (link type), `apps/hub/src/auth/{pair-requests,session-sweeper}.ts`, `commands/approve-pairing-request.ts` | — | **#21**; §6.1 statement count (+1 read, + the raise) | 25, 15 | HIGH, Cross |

### B7 — 03b rows, upgrade, recovery, counter (§11 steps 7 second half, 8)

| # | Task | Spec | Files | Interfaces | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|---|
| 27 | **K-1 + D-4**: `SetDeviceRole` loses `point_id` (events keep v1 with the current point); the `device_roles` fold writes `lane_label` only; "Pass tablet" = non-kds device with `point_id` in `device-roles.ts:36` (map, also refreshed after `DeviceProfileSet`) and `:78-82` (resolver), `kds-config.pass_tablets`, `alerts/targets.ts:443` (`always_on`) | §4.5 K-1, D-4 | `apps/hub/src/kds/{device-roles,commands/device-role}.ts`, `apps/hub/src/queries/kds-config.ts`, `apps/hub/src/alerts/targets.ts` | — | **#22**, **#29**; **full hub suite** | 22 | HIGH, Cross |
| 28 | Upgrade boot step: after `catchUp`, before listen; 1 read (`devices` ⟕ `device_profiles`, unrevoked, non-kds, no profile); one `writer.run` appending one `DeviceProfileSet { cause: 'upgrade', needs_review: true, profile_version: 1 }` per device per the §5.3 table; carries `point_id`, `pass` first when set; `actor_id` null, `device_id 'hub'` | §5.3, §6.10 | `apps/hub/src/auth/device-upgrade.ts` (new), `registerBootStep` in `lib/boot.ts` | — | **#15** (hub half: tables, `pass` first, refusals of Test alert / printer / Kitchen screens setup on an upgraded kiosk and tablet, the same from a listed device works, second boot appends nothing); **#14b** (upgrade half); **RF-1** (no unrevoked non-kds device without a profile after boot); **full hub suite** | 27 | HIGH |
| 29 | Recovery: `issueAdminBootstrap(tx, issuedBy, deps, deviceId = 'hub')` (event v2); `POST /admin/recovery-link` in group `admin-device-public` (device token of a paired non-kds device, no session): count ≠ 0 → `403 recovery_not_needed`; any live token → `200 { already_issued_until }`, nothing written; else issue with the caller's device id → `{ first_admin_url, expires_at }` | §6.11, H-7 | `apps/hub/src/auth/{bootstrap-tokens,admin-session}.ts` (route; or a new `auth/recovery-link.ts` if the group wiring needs it) | as H-7 | **#16a**; setup / CLI / restore still write `device_id 'hub'`; statements = 1 read + the transaction | 18 | HIGH, Cross |
| 30 | **Counter check** (fresh implementer who did not write tasks 9–11 or 23–25): the counter matrix on an `everyone` kiosk | §3.3 counter check | `apps/hub/test/device-access/counter.int.test.ts` (new) | — | **#7c** (shift close + count of another cashier, remove another cashier's payment, drawer, petty cash, Z report, day close all succeed); every `MONEY_PERMISSIONS` command by a manager returns the request path, and every `LISTED_ONLY_PERMISSIONS` command `403` | 25, 28 | HIGH |

### B8 — client (§11 step 9; existing page patterns, PL-1)

| # | Task | Spec | Files | Tests first | Needs | Tier |
|---|---|---|---|---|---|---|
| 31 | Staff `#/devices` device list: groups (Waiting, Kitchen, Personal, Counter, Floor, Pass, Back office; first match wins), hardware icon only, **needs review** chip, the M-8 warnings, opened from the `device_waiting` link | §6.8, §8, M-8 | `apps/client/src/features/devices/{DeviceList,api}.tsx` (new), staff route `#/devices` | grouping table test; chip; warning texts at 0 / 1; link `{ type: 'devices' }` opens `#/devices` (client half of #21) | 20, 26 | NORMAL |
| 32 | Approve form + edit form: the display code is always typed, never prefilled (`r` fills the request); form defaults by hint (§6.3); screens offered per hardware; `pass` ⇔ point; `409 CONFIG_STALE` → "Changed elsewhere" + Reload; `DEVICE_ACCESS_SELF` text | §6.3, §6.4, §8 | `apps/client/src/features/devices/{ApproveForm,EditForm}.tsx` (new) | defaults per hint; the code field is empty with `r`; stale and self errors | 31 | NORMAL |
| 33 | Hub admin `/admin#devices` and `/admin/approve` on the new query and payload; **Recover admin access** button + QR when `recovery_available`; **K-2**: Kitchen screens page "Use as Pass tablet" and `BindDialog.tsx:45` → link to the edit form on every non-kds row | §8, §6.11, K-2 | `apps/hub/src/admin/page.ts`, `apps/client/src/features/admin/kitchen-screens/BindDialog.tsx` | recovery button only at 0; second press shows "A recovery link was already made — it works until <time>"; K-2 link on every non-kds row | 29, 32 | NORMAL, Cross |
| 34 | **C-1 shell**: tabs from `screens` in list order, last tab remembered; home = first screen; `kiosk_home` retired (its content is the `takeaway` screen, A-7); `device_profile` push redraws (a removed tab under the user → first remaining tab + toast); screens hidden with none of their permissions (§3.6 O-16); masked actions hidden, downgraded shown as "Confirm on your phone"; width gates `StaffApp.tsx:500-510` removed, width picks the layout only | §3.6, §8, C-1 | `apps/client/src/features/staff/{StaffApp.tsx,shell/*}` | tabs per profile; kiosk opens on `takeaway`; push redraw; **RF-5** (client); a 700 px kiosk shows the same items as a 1280 px one | 12, 17 | NORMAL |
| 35 | Deep-link fallback (inbox + `focus=alert:<id>` + toast "Open this on a device with <screen>"); answer sheet: "Approve here" and `InPerson.tsx` removed, money card on `everyone` → "Approve on a listed device", no button; requester text `request.find_approver`; error texts (§8 Errors); `PassScreen.tsx:130` parses with the device's own type | §8, §3.9 rule 4, D-2, K-1 | `apps/client/src/features/alerts/{AnswerSheet.tsx,InPerson.tsx (delete),deeplink-*.ts}`, `apps/client/src/features/pass/PassScreen.tsx`, i18n | **#23**; answer sheet per device access; texts exact | 34 | NORMAL, Cross |

**05a: 9 phase-0 rows + 35 tasks.**

---

## 4. §10 test → task map

Every §10 test has an owner. A test split in halves names its half in the test title.

| Test | Task | Test | Task | Test | Task |
|---|---|---|---|---|---|
| 1 | 15 | 7a | 25 | 15 | 28 (hub), Z2 (hand) |
| 2 | 15 | 7b | 25 | 16 | 18 (`recovery_available`), 20 (`admin_warning`) |
| 3 | 17 (PIN), 18 (roster) | 7c | 30 | 16a | 29 |
| 4 | 9 | 8 | 23 | 17 | 24 |
| 4a | 10 | 9 | 19 | 17a | 24 |
| 4b | 10 (fiscal), 11 (printer) | 10 | 19 | 18 | 24 |
| 4c | 10 | 11 | 19 | 19 | 24 |
| 4d | 11 (`403`), 19 (ended) | 12 | 21 | 20 | 10 |
| 4e | 17 | 13 | 15 (approve), 19 (edit) | 21 | 26 (hub), 31 (link) |
| 4f | 23 | 14 | 6 | 22 | 27 |
| 4g | 12 | 14a | 22 | 23 | 35 |
| 5 | 23 | 14b | 22 (replay), 28 (upgrade) | 24 | 15 |
| 6 | 23 | — | — | 25 | 14 |
| 7 | 25 | — | — | 26 | 17 |
| — | — | — | — | 27 | 19 |
| — | — | — | — | 28 | 23 |
| — | — | — | — | 29 | 27 |

## 5. Close (integrator)

| # | Task | Needs |
|---|---|---|
| Z1 | Acceptance map on the board: every §10 test → green test name, every §4.5 row → landed spec version + code task, RF-1 – RF-5 → test names, §12.4 listed as "not built" | all tasks |
| Z2 | The owner runs `docs/plans/05a-manual-checks.md` (§12.1) on the pilot devices; results posted with `tools/local/checks-report.sh <PR> docs/plans/05a-manual-checks.md` | Z1, B8 |
| Z3 | After the stab PR is on `main`: merge `main` into `module-05a`, run the gate, then the PR `module-05a` → `main` (the owner opens or asks for it, and merges; handbook §7) | Z1, the stab PR merged (Z2 may follow) |

## 6. Self-review (done when the plan was written)

- **Spec coverage:**
  - §3.1–§3.10 → tasks 1, 7, 9–11, 17, 19, 21–26.
  - §4.2 → 3, 4, 7, 9.
  - §4.5: H-1 → 15; H-2 → 17, 18; H-3 → 9–11; H-4 → 20, 21; H-5 → 5; H-6 → 20; H-7 → 4, 29; D-1 → 22; D-2 → 23–25, 35; D-3 → 26; D-4 → 27; K-1 → 27, 35; K-2 → 33; A-1 → 3; B-1 → P0.8 (PL-2), 24, 30; F-1 → 2, P0.8; C-1 → 34.
  - §5 → 5, 6, 28. §6.1–§6.11 → 14, 15, 19, 17, 18, 12, 20, 21, 28, 29. §8 → 16, 31–35. §9 → 2.
  - §12.1 → Z2.
- **Ordering:**
  - Task 15 holds both the tablet / phone approval and the STAB-1 removal.
  - Task 13 (fixture) precedes it.
  - Task 26 needs 15, because it edits approve's transaction.
  - Task 22 precedes 27, because the bindings map refresh is shared.
- **Names used across tasks:**
  - `DeviceProfile`, `deviceProfile()` and `listedAdminDeviceCount()` (7);
  - `SessionDirectory` and `forSession()` (9);
  - `Masked`, `ScreenKey` and `screensOffered()` (1);
  - `pairByRequest()` (13);
  - `issueAdminBootstrap(tx, issuedBy, deps, deviceId)` (29).
