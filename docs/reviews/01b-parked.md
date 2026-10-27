# 01b parked questions (autobuild)

Questions only the human can answer. Fill in `ANSWER:` and set the task back to TODO in docs/plans/01b-status.md.

## P-1 (task T0) Foundation §6.2 edit is forbidden to autobuild (RESOLVED)
**Problem:** Task 0 appends the nine 01b §9 error codes to `docs/specs/00_Foundation_Spec_v1.7.md` §6.2 and points `.cursor/rules/pos.mdc` at the 01b plan and spec. CLAUDE.md allows this one foundation edit (D64), but the autobuild hard rules say "Never edit docs/specs/00_Foundation_Spec_v1.7.md".
**Why it can't be auto-decided:** two standing instructions conflict on a frozen document; only the human can waive one.
**Options:**
- A: Human makes the edit (or does Task 0 in an interactive session). Autobuild carries on; code is unaffected.
- B: Human authorises autobuild to do Task 0 (answer "B"); autobuild then does it as a normal task.
- C: Skip the foundation part; only update `.cursor/rules/pos.mdc`. Foundation §6.2 stays behind `errors.ts` (drift).
**Recommendation:** A or B. No code task depends on it: Task 5 adds the codes to `packages/domain/src/errors.ts` from 01b §9.
ANSWER: A — done by human

## P-2 (task T61) Release drill needs the hub hardware
**Problem:** Task 61 is the §7.4 release drill on the pilot mini PC / three branch hubs.
**Why it can't be auto-decided:** physical hardware; cannot run unattended.
**Options:**
- A: Human runs the drill after T58–T60 and records the result in `docs/reviews/build-log.md`.
- B: Defer the drill to the next release window; module stays "pending release drill" in docs/specs/README.md.
**Recommendation:** A.
ANSWER:
