# 03b + 03c — build board

Plans: `03b-plan.md`, `03c-plan.md`. Prompts: `03b-03c-prompts.md`. Gaps: `03b-03c-gaps.md`. Integration branch: `module-03b`. Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-11: gap sweep done, 14 G-rows ruled (a); spec v1.0.1. Next: phase 0.
> - 2026-11-11: specs 03b v1.0 + 03c v1.0 APPROVED; plans, CI gate and cloud setup ready. Waiting: 02b merge → gap sweep.

## Owner rulings on how the build runs (2026-11-11, 14:16 PKT: "Sab haan")

| # | Ruling |
|---|---|
| W-1 | The author chat (claude.ai, this build's integrator) creates the GitHub ruleset for `module-03b` via the API: PR required, check `gate` required, rebase merge only, no force push. **`module-02b` is excluded** (its own integrator pushes directly). |
| W-2 | The integrator merges green PRs into `module-03b` itself. |
| W-3 | The integrator opens `spec-03b` → `main` and merges it when `gate` is green. The final `module-03b` → `main` merge stays the owner's. |
| W-4 | Lanes run as remote agents launched from the integrator chat, at most 5 at once. |
| W-5 | Repo visibility: **public** (owner, 2026-11-11), so GitHub Actions minutes are free. Never commit a secret. |

## Phase 0

| Task | PR | State |
|---|---|---|
| P0.1 – P0.14 | — | not started |

## Lanes

| Lane | Task | PR | Needs | State |
|---|---|---|---|---|
| B1 | b5, b6, b7, b10 | — | — | not started |
| B2 | b8, b9a | — | — | not started |
| B3 | b11, b18 | — | — | not started |
| B4 | b13, b14, b15, b9b | — | b11, P0.14 (b15) | not started |
| B5 | b16, b17, 0e | — | b13–b15 | not started |
| B6 | b20, b21, b22, b23 | — | b6, b11, b18 | not started |
| C1 | c4, c5, c7, c8, c9 | — | — | not started |
| C2 | c11, c10 | — | b11 | not started |
| C3 | c12, c13, c14, c15, c16 | — | c10, c11, c7 | not started |
| C4 | c17–c22 | — | b20, c7, c14 | not started |

## Readings and rulings (AD rows)

| # | Task | Reading | State |
|---|---|---|---|

## Gate times (CI, for the record)

| Date | Branch / PR | Wall | Tests |
|---|---|---|---|
