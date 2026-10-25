# Module 00 design hand-off: start here

## 1. Put the folder in the repo
Unzip it so you get this path in the POS repo:

```
docs/design/handoff/00/
  START-HERE.md
  CLAUDE-TASK-00.md
  00-design.md
  00-open-questions.md
  frames/      (open frames/INDEX.html in a browser to see every screen)
  kit/
```

## 2. Paste this into Claude Code (from the repo root)

```
Read docs/design/handoff/00/CLAUDE-TASK-00.md and follow it exactly.
Source of truth: docs/design/handoff/00/00-design.md and the frames in docs/design/handoff/00/frames/.
First copy 00-open-questions.md to docs/design/open-questions/00-hub-platform.md, then write PLAN.md and show it to me before Phase 1.
Work one phase at a time: after each phase run the checks, commit "feat(00): <phase>", give me a short report and wait for my "go".
Build with the recommended answers in the open-questions file unless a question's status is "blocked".
Do not touch other modules beyond what the task file allows.
```

## 3. Answering the open questions later
Open `docs/design/open-questions/00-hub-platform.md`. For each question:
- edit the **Decision** line;
- set **Status** to `answered`.

Then tell Claude Code: `Apply the answered decisions in docs/design/open-questions/00-hub-platform.md`.

Only Q5 (waiter tablets) is **blocked**. It needs your yes before it is built.

## 4. When module 00 is done
Send the next inventory file (`docs/design/inventory/<module>.md`) to the designer chat, together with links to:
- the "00 Screens" canvas;
- the "Module 01a Screens" canvas.
