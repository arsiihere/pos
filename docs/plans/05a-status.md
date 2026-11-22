# 05a Device Access + Screens — build board

Plan: `05a-plan.md`. Hand checks: `05a-manual-checks.md`. Gaps: `05a-gaps.md`. Spec: `05a_Device_Access_Screens_Spec_v1.0.1.md` (APPROVED; v1.0 2026-11-23 03:24 PKT, v1.0.1 rulings 03:35 / 03:53 PKT). Integration branch: `module-05a`, **cut from `fix/stab-tablet-pairing`; the 05a PR comes after the stab PR** (owner D-7). Stab work comes in only by `git merge fix/stab-tablet-pairing`, before each batch, then the gate. Pushed to **`build/05a`** after every task (owner 03:53, no PRs). Only the integrator edits this file.

> ## ⚠️ NEEDS RULING — three 01d questions (B6 waits; B1–B5 continue)
>
> The 01d v1.3.5 bump (rows D-1 – D-4) is written. Three places have no rule in 05a. Only the 01d rows wait (P0.5 commit, batch B6); B1–B5 do not touch them and go on. Each question has a Rec.
>
> - **Q-1** 05a §3.9 rule 3 says "the 'no one can approve' check counts an approver as reachable only through a listed-device route". 01d §3.9's `no_approver` warning counts "signed in anywhere". **(a, Rec)** For a money kind, a session on an `everyone` device no longer counts in that warning, as the 05a text reads. (b) Leave the warning as it is; only routing and the G1-9d shortcut change.
> - **Q-2** The new link `{ type: 'devices' }` (`device_waiting`) has no §3.13.3 "open" check. **(a, Rec)** Always open, no read: the device list always exists, and the notice itself closes when no request is pending (§3.10). (b) Open only while a pair request is pending (1 read).
> - **Q-3** The G1-9d shortcut (01d §3.5:637) applies to kinds whose `right.mode` is `'approval'`. A downgraded raise stores `named` or `holders` on an approval kind. **(a, Rec)** Key on the **stored** right: a downgraded request gets no shortcut, like other `named` / `holders` requests today; it still escalates by its steps. (b) Key on the kind's right: the shortcut also runs for a downgraded `holders` request.

> **Status (owner summary, newest first):**
> - 2026-11-23 ~04:35 PKT: Phase 0 bumps: **00 v1.12.3** (`0ddb82cb`), **03b v1.0.15** (`f45df89a`), **04 v1.0.8** (`f1cc15bc`), **01d v1.3.5** (committed with **Q-1 – Q-3 marked open**), F §6.2 append (`855e87eb`). Each was checked by a fresh reviewer, and the findings are fixed. Stab tip `943e1cb6` merged (no spec change); gate running before batch B1.
> - 2026-11-23 (after 03:53 PKT): Owner rulings 03:53: `git merge` allowed, push target **`build/05a`**, G-b (a). `spec/05a-device-access` merged into `module-05a` (`866f74c3`; README conflict resolved: 05 row from stab, 05a row from the spec branch); pushed as `build/05a`. **05a v1.0.1** written (R-1, G-b). F §6.2 append done (`855e87eb`). The 00 / 01d / 03b / 04 bumps are being written; baseline gate running.
> - 2026-11-23 (after 03:45 PKT): Owner D-7: don't wait for the stab merge. `module-05a` cut locally from the stab tip `44112286`; P0.1 and the P0.2 sweep done; **stopped**: the merge is blocked by permissions, plus a push decision and G-b (see the top).
> - 2026-11-23 03:35 PKT: Owner confirmed the plan readings PL-1 – PL-4 and ruled the no-profile device rule (R-1, below). **The build still waits for the `fix/stab-tablet-pairing` merge** (G0.1).
> - 2026-11-23: Plan ready for the owner's review. **The build starts after `fix/stab-tablet-pairing` is merged to `main`** (G0.1). Nothing has started yet.

## Gates

| Check | State |
|---|---|
| G0.1 (D-7) `module-05a` cut from the stab tip + `spec/05a-device-access` merged in | **met**: cut from `44112286`, merged `866f74c3`, pushed as `build/05a` |
| No new 00 / 01d / 03b / 04 version at the stab tip | **met** at `44112286` (00 v1.12.2, 01d v1.3.4, 03b v1.0.14, 04 v1.0.7) |
| Plan readings PL-1 – PL-4 confirmed by the owner | **met** — 2026-11-23 03:35 PKT (rulings below) |

## Version numbers (P0.1, read at the stab tip `44112286`, 2026-11-23)

| Target | Rows | Version on `main` | Claimed elsewhere | 05a version |
|---|---|---|---|---|
| 00 | H-1 – H-7, K-2 (§8.2) | v1.12.2 | none | **v1.12.3** |
| 01d | D-1 – D-4 (+ G-d) | v1.3.4 | none | **v1.3.5** |
| 03b | K-1, K-2 | v1.0.14 | none | **v1.0.15** |
| 04 | A-1 | v1.0.7 | none | **v1.0.8** |
| F §6.2 | F-1 (append, no bump) | v1.15 | none | — (append in v1.15) |
| 05 | B-1 (no bump, PL-2) | v1.0.34 | none | — |
| Hub migration | `0027_device_profiles.sql` | last: `0026_order_line_part_of.sql` | none (every local and remote branch scanned) | **`0027`** (free) |

## Tasks

| # | Batch | Task | Tier | PR | State |
|---|---|---|---|---|---|
| G0.1 | 0 | cut from stab tip + merge the 05a docs (D-7) | — | `866f74c3` | **done** |
| P0.1 | 0 | version numbers | NORMAL | — (on `spec/05a-device-access`) | **done** |
| P0.2 | 0 | gap sweep (G-b, G-c + moved cites; G-a ruled as R-1) + **05a v1.0.1** patch (R-1 notes) | NORMAL | `def937e8` | **done** (sweep + v1.0.1) |
| P0.3 | 0 | cut `module-05a`, cleanup file (no labels: no PRs) | NORMAL | | cut; `build/05a` pushed; cleanup file with P0.8 |
| P0.4 | 0 | 00 bump (H-1 – H-7) | NORMAL | `0ddb82cb` | **done** (review: 1 MAJOR table fix + MINORs, fixed) |
| P0.5 | 0 | 01d bump (D-1 – D-4) | NORMAL | see log | **done except Q-1 – Q-3** (review: 2 MAJOR + 6 MINOR, fixed) |
| P0.6 | 0 | 03b bump (K-1, K-2) | NORMAL | `f45df89a` | **done** (review APPROVE) |
| P0.7 | 0 | 04 bump (A-1) | NORMAL | `f1cc15bc` | **done** (review APPROVE; G-b read path via `audit-staff`) |
| P0.8 | 0 | F §6.2 append, README | NORMAL | `855e87eb` (F) | F done; README rows after the bumps |
| 1 | B1 | permission lists + screens | NORMAL | | |
| 2 | B1 | error codes | NORMAL | | |
| 3 | B1 | audit action | NORMAL | | |
| 4 | B1 | events | NORMAL | | |
| 5 | B2 | migration 0027 | HIGH | | |
| 6 | B2 | profile projections | HIGH | | |
| 7 | B2 | `deviceProfile` map + M-8 count | HIGH | | |
| 8 | B2 | profile test fixture | NORMAL | | |
| 9 | B3 | `forSession` view | HIGH | | |
| 10 | B3 | pipeline / query / PIN call sites | HIGH | | |
| 11 | B3 | admin guard + print route | HIGH | | |
| 12 | B3 | `/queries/session` | NORMAL | | |
| 13 | B4 | request-based pairing fixture | NORMAL | | |
| 14 | B4 | pair request hint + poll screens | NORMAL | | |
| 15 | B4 | approve v2 **+ STAB-1 removal (one commit)** | HIGH | | |
| 16 | B4 | pair page text + hint | NORMAL | | |
| 17 | B5 | sign-in checks | HIGH | | |
| 18 | B5 | staff / login roster | NORMAL | | |
| 19 | B5 | `SetDeviceProfile` | HIGH | | |
| 20 | B5 | revoke both + device list | NORMAL | | |
| 21 | B5 | directory apply | HIGH | | |
| 22 | B6 | D-1 bindings | HIGH | | |
| 23 | B6 | D-2 answers | HIGH | | |
| 24 | B6 | D-2 downgraded raise | HIGH | | |
| 25 | B6 | D-2 routing | HIGH | | |
| 26 | B6 | D-3 `device_waiting` | HIGH | | |
| 27 | B7 | K-1 + D-4 Pass readers | HIGH | | |
| 28 | B7 | upgrade boot step | HIGH | | |
| 29 | B7 | recovery link | HIGH | | |
| 30 | B7 | counter check (fresh implementer) | HIGH | | |
| 31 | B8 | device list page | NORMAL | | |
| 32 | B8 | approve + edit forms | NORMAL | | |
| 33 | B8 | hub admin pages, recovery, K-2 | NORMAL | | |
| 34 | B8 | shell tabs (C-1) | NORMAL | | |
| 35 | B8 | deep links, answer sheet, Pass parse | NORMAL | | |
| 36 | B8 | audit screen names for `device_profile_set` (G-b) | NORMAL | | |
| Z1 | Z | acceptance map | — | | |
| Z2 | Z | manual checks (owner) | — | | |
| Z3 | Z | `module-05a` → `main` | — | | |

## Owner rulings

| # | Ruling | When | Where it landed |
|---|---|---|---|
| PL-1 | Yes: the client screens are built on existing page patterns, with no 05a design handoff. Pulse mapping happens later, for all modules in one pass | 2026-11-23 03:35 PKT | plan D-5, batch B8 |
| PL-2 | Yes: B-1 and C-1 are not version bumps. If the gap sweep finds approved text that contradicts them → **STOP** and ask | 2026-11-23 03:35 PKT | plan D-5, P0.2 (G-c), P0.8 |
| PL-3 | Yes: integration branch `module-05a`, cut from `main` after `fix/stab-tablet-pairing` merges | 2026-11-23 03:35 PKT | plan D-5, P0.3 |
| PL-4 | Yes: a fresh **Opus** reviewer for the migration, the permission mask, sign-in, approvals and the recovery link; **Sonnet** for the rest | 2026-11-23 03:35 PKT | plan D-5, §1 tiers |
| D-7 | Don't wait for the stab merge: cut `module-05a` from the stab tip; stab work only by `git merge`, before each batch, then the gate; STAB never bumps 00 / 01d / 03b / 04 again (else STOP); the 05a PR after the stab PR | 2026-11-23 03:44–03:45 PKT | plan D-7, G0.1, Z3 |
| W-1 | `git merge` allowed (via /permissions); push `module-05a` to **`build/05a`** after every task; no PRs | 2026-11-23 03:53 PKT | §1 rules, board header |
| G-b | Store `staff_ids` in the `device_profile_set` audit detail; names looked up when the log is read, as 04 does; in 05a v1.0.1 with R-1 | 2026-11-23 03:53 PKT | 05a v1.0.1 §4.2, 04 v1.0.8 (P0.7), task 3 |
| R-1 | **Staff device with no profile: split rule** (was gap G-a). (1) **Permissions:** treat it as `access = 'everyone'` (masked, fail-closed). (2) **Sign-in:** today's rule, **not** `everyone`. A `phone` accepts only its `owner_staff_id`; a `tablet` / `cashier_kiosk` accepts any directory staff. Never let a phone without a profile accept any PIN but its owner's. Goes in as a §3.3a / §3.5 note in **05a v1.0.1** (owner-approved now; written by P0.2's spec patch), tested in task 9 (mask) and task 17 (sign-in check) | 2026-11-23 03:35 PKT | plan D-6, Review Focus 1, P0.2, tasks 9, 17 |

## Owner rulings during the build

| # | Ruling | When | Where it landed |
|---|---|---|---|
| — | | | |

## STOPs / needs-ruling

| # | Task | Question | State |
|---|---|---|---|
| S-1 | G0.1 | `git merge` into `module-05a` refused by the auto-mode classifier | **closed** 03:53: owner allowed it; merged |
| S-2 | P0.3 | Push target for `module-05a` under the `module-*` ruleset with no PRs | **closed** 03:53: (a) `build/05a` |
| S-3 | P0.2 | G-b: names in the `device_profile_set` audit detail | **closed** 03:53: (a), in 05a v1.0.1 §4.2; 04 v1.0.8 §8 maps the ids through `audit-staff` (no query change) |
| S-4 | P0.5 | 01d Q-1 – Q-3 (top of this file) | **open**, Recs (a) |

Scan for P0.1: every local and remote branch and both open PRs (#121, #126) were checked for 00 > v1.12.2, 01d > v1.3.4, 03b > v1.0.14, 04 > v1.0.7, Foundation > v1.15 and hub migrations ≥ `0027`. Nothing is claimed. The bumps are patch steps, like the other cross-module rows (e.g. 00 v1.12.1 → v1.12.2 for STAB-1).

## Stab merges

| When | Stab sha | Spec change in 00 / 01d / 03b / 04? | Gate after |
|---|---|---|---|
| cut | `44112286` | — (baseline: 00 v1.12.2, 01d v1.3.4, 03b v1.0.14, 04 v1.0.7) | — |
| before B1 | `943e1cb6` (merge `ad0864ad`) | none | running |
