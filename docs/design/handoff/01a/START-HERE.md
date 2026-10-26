# Module 01a design hand-off: start here

## 1. Put the folder in the repo
Unzip it so you get `docs/design/handoff/01a/`. Inside:

| Item | What it is |
|---|---|
| START-HERE.md | This file |
| CLAUDE-TASK-01a.md | The task for Claude Code |
| 01a-design.md | The design spec |
| 01a-open-questions.md | Questions for you, with recommended answers |
| frames/ | All screens. Open `frames/INDEX.html` in a browser to see them. |
| kit/ | Shared kit CSS |

Do module 00 first, or at least its Phase 1 (kit). Both modules share the kit.

## 2. Paste this into Claude Code (from the repo root)

```
Read docs/design/handoff/01a/CLAUDE-TASK-01a.md and follow it exactly.
Source of truth: docs/design/handoff/01a/01a-design.md and the frames in docs/design/handoff/01a/frames/ (ignore Parking* frames).
First copy 01a-open-questions.md to docs/design/open-questions/01a-setup.md, then write PLAN.md and show it to me before Phase 1.
Work one phase at a time: after each phase run the checks, commit "feat(01a): <phase>", give me a short report and wait for my "go".
Build with the recommended answers unless a question's status is "blocked".
Do not change API contracts or touch other modules beyond what the task file allows.
```

## 3. Answer the open questions later
1. Open `docs/design/open-questions/01a-setup.md`.
2. Edit the **Decision** line and set **Status** to `answered`.
3. Tell Claude Code: `Apply the answered decisions in docs/design/open-questions/01a-setup.md`.

All owner questions are answered now (Q6.5 per-branch price, Q6.10 per item, Q6.13 rounding). Q6.5 needs one small spec addendum; Claude Code writes it in Phase 2b and waits for your "go".
