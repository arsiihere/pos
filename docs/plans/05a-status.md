# 05a Device Access + Screens — build board

> ## ⛔ STOPPED — 2026-11-23, waiting for the owner
>
> **1. The merge into `module-05a` is blocked by permissions.** `module-05a` is cut locally from the stab tip `44112286` and is not pushed. The next step, `git merge spec/05a-device-access` (brings the 05a spec, plan and board onto `module-05a`), was refused three times by the Claude Code auto-mode classifier ("Undermining Oversight"). Every batch also needs `git merge fix/stab-tablet-pairing`, so nothing on `module-05a` can go ahead. I did not work around it (no cherry-pick, no file copy). **To unblock:** add a Bash permission rule for `git merge` in this project (settings), or run the merge yourself: `! git -C ~/pos-05a merge --no-ff spec/05a-device-access`.
>
> **2. Pushing `module-05a` needs a decision.** The GitHub ruleset "module branches (03b onward)" covers `module-*`. It requires a PR and the `gate` check for every update, including creating the branch, and you said not to open a PR. Options: (a) push the work to a branch outside the ruleset, e.g. `build/05a`, and treat `module-05a` as local only until the PR; (b) allow PRs into `module-05a`; (c) exclude `module-05a` from the ruleset, as `module-02b` is. **Rec: (a).**
>
> **3. Gap G-b needs a ruling** (`05a-gaps.md`): two approved specs disagree on names in the audit detail of `device_profile_set`. **Rec (a):** store `staff_ids`, join names at read, as 04 does everywhere.
>
> **Done without a merge** (on `spec/05a-device-access`): the gate text (D-7) in the plan and this board, P0.1 (table below), the P0.2 gap sweep (`05a-gaps.md`: cites re-checked at `44112286`, G-a ruled, G-c clean, G-d fixable under D-2). **Next once unblocked:** merge as above, the 05a v1.0.1 spec patch (R-1 + G-b), then P0.4–P0.8 and batch B1.

Plan: `05a-plan.md`. Hand checks: `05a-manual-checks.md`. Gaps: `05a-gaps.md` (written in P0.2). Spec: `05a_Device_Access_Screens_Spec_v1.0.md` (APPROVED 2026-11-23 03:24 PKT). Integration branch: `module-05a`, **cut from `fix/stab-tablet-pairing`; the 05a PR comes after the stab PR** (owner D-7, 2026-11-23 03:44–03:45 PKT). Stab work comes in only by `git merge fix/stab-tablet-pairing`, before each batch, then the gate. Only the integrator edits this file.

> **Status (owner summary, newest first):**
> - 2026-11-23 (after 03:45 PKT): Owner D-7: don't wait for the stab merge. `module-05a` cut locally from the stab tip `44112286`; P0.1 and the P0.2 sweep done; **stopped**: the merge is blocked by permissions, plus a push decision and G-b (see the top).
> - 2026-11-23 03:35 PKT: Owner confirmed the plan readings PL-1 – PL-4 and ruled the no-profile device rule (R-1, below). **The build still waits for the `fix/stab-tablet-pairing` merge** (G0.1).
> - 2026-11-23: Plan ready for the owner's review. **The build starts after `fix/stab-tablet-pairing` is merged to `main`** (G0.1). Nothing has started yet.

## Gates

| Check | State |
|---|---|
| G0.1 (D-7) `module-05a` cut from the stab tip + `spec/05a-device-access` merged in | **half met**: cut locally from `44112286`; the merge is **blocked** (top) |
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
| G0.1 | 0 | cut from stab tip + merge the 05a docs (D-7) | — | | **blocked** (merge permission) |
| P0.1 | 0 | version numbers | NORMAL | — (on `spec/05a-device-access`) | **done** |
| P0.2 | 0 | gap sweep (G-b, G-c + moved cites; G-a ruled as R-1) + **05a v1.0.1** patch (R-1 notes) | NORMAL | — | **sweep done** (`05a-gaps.md`); patch waits for G-b |
| P0.3 | 0 | cut `module-05a`, labels, cleanup file | NORMAL | | cut locally; push waits for decision 2 |
| P0.4 | 0 | 00 bump (H-1 – H-7) | NORMAL | | |
| P0.5 | 0 | 01d bump (D-1 – D-4) | NORMAL | | |
| P0.6 | 0 | 03b bump (K-1, K-2) | NORMAL | | |
| P0.7 | 0 | 04 bump (A-1) | NORMAL | | |
| P0.8 | 0 | F §6.2 append, README | NORMAL | | |
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
| R-1 | **Staff device with no profile: split rule** (was gap G-a). (1) **Permissions:** treat it as `access = 'everyone'` (masked, fail-closed). (2) **Sign-in:** today's rule, **not** `everyone`. A `phone` accepts only its `owner_staff_id`; a `tablet` / `cashier_kiosk` accepts any directory staff. Never let a phone without a profile accept any PIN but its owner's. Goes in as a §3.3a / §3.5 note in **05a v1.0.1** (owner-approved now; written by P0.2's spec patch), tested in task 9 (mask) and task 17 (sign-in check) | 2026-11-23 03:35 PKT | plan D-6, Review Focus 1, P0.2, tasks 9, 17 |

## Owner rulings during the build

| # | Ruling | When | Where it landed |
|---|---|---|---|
| — | | | |

## STOPs / needs-ruling

| # | Task | Question | State |
|---|---|---|---|
| S-1 | G0.1 | `git merge` into `module-05a` refused by the auto-mode classifier | open: owner allows `git merge` or runs it |
| S-2 | P0.3 | Push target for `module-05a` under the `module-*` ruleset with no PRs: (a) `build/05a`, (b) PRs allowed, (c) ruleset exclusion | open, Rec (a) |
| S-3 | P0.2 | G-b: names in the `device_profile_set` audit detail (05a §4.2 vs 04 "names joined at read") | open, Rec (a) |

Scan for P0.1: every local and remote branch and both open PRs (#121, #126) were checked for 00 > v1.12.2, 01d > v1.3.4, 03b > v1.0.14, 04 > v1.0.7, Foundation > v1.15 and hub migrations ≥ `0027`. Nothing is claimed. The bumps are patch steps, like the other cross-module rows (e.g. 00 v1.12.1 → v1.12.2 for STAB-1).
