# 05a Device Access + Screens — build board

Plan: `05a-plan.md`. Hand checks: `05a-manual-checks.md`. Gaps: `05a-gaps.md` (written in P0.2). Spec: `05a_Device_Access_Screens_Spec_v1.0.md` (APPROVED 2026-11-23 03:24 PKT). Integration branch: `module-05a` (cut in P0.3). Only the integrator edits this file.

> **Status (owner summary, newest first):**
> - 2026-11-23: Plan ready for the owner's review. **The build starts after `fix/stab-tablet-pairing` is merged to `main`** (G0.1). Nothing has started yet.

## Gates

| Check | State |
|---|---|
| G0.1 `fix/stab-tablet-pairing` on `main` | **not met** (2026-11-23: not merged) |
| Plan readings PL-1 – PL-4 confirmed by the owner | **proposed** |

## Version numbers (filled in P0.1, against `main` @ G0.1)

| Target | Rows | Version on `main` | Claimed elsewhere | 05a version |
|---|---|---|---|---|
| 00 | H-1 – H-7, K-2 (§8.2) | | | |
| 01d | D-1 – D-4 | | | |
| 03b | K-1, K-2 | | | |
| 04 | A-1 | | | |
| F §6.2 | F-1 (append, no bump) | | | — |
| 05 | B-1 (no bump, PL-2) | | | — |
| Hub migration | `0027_device_profiles.sql` | last: | | `0027` (STOP if taken) |

## Tasks

| # | Batch | Task | Tier | PR | State |
|---|---|---|---|---|---|
| G0.1 | 0 | stab branch on `main` | — | | waiting |
| P0.1 | 0 | version numbers | NORMAL | | |
| P0.2 | 0 | gap sweep (G-a, G-b, G-c + moved cites) | NORMAL | | |
| P0.3 | 0 | cut `module-05a`, labels, cleanup file | NORMAL | | |
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

## Owner rulings during the build

| # | Ruling | When | Where it landed |
|---|---|---|---|
| — | | | |

## STOPs / needs-ruling

| # | Task | Question | State |
|---|---|---|---|
| — | | | |
