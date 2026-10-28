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

## P-2 (task T61) Release drill needs the hub hardware (ANSWERED — T61 stays PARKED until the human logs the drill)
**Problem:** Task 61 is the §7.4 release drill on the pilot mini PC / three branch hubs.
**Why it can't be auto-decided:** physical hardware; cannot run unattended.
**Options:**
- A: Human runs the drill after T58–T60 and records the result in `docs/reviews/build-log.md`.
- B: Defer the drill to the next release window; module stays "pending release drill" in docs/specs/README.md.
**Recommendation:** A.
ANSWER: A — I will run the drill on hardware after T58–T60. Keep T61 PARKED until I log the result.

## P-4 (task T50b) Phone owner shell: design Menu button vs 01a S50 a bottom tab bar
**Problem:** The 01b design hand-off (`StaffPhoneList.html`) shows a Menu button in the phone app bar that opens the side nav over the page, and no tab bar. 01a v1.3 S50 a (APPROVED) says the owner shell has, at phone width (≤ 760 px), a bottom tab bar. T50b (AD-31) built the design; review R-2 found that this changes another module's approved spec. The bottom tab bar is restored until this is answered (fix R-2); the laptop side-nav changes (groups, counts, foot) stay.
**Why it can't be auto-decided:** it needs 01a's approved spec to change (Class C); the phone shell also carries the 01a views (Menu, Floors, Stations).
**Options:**
- A: Keep the S50 a tab bar (now 8 items at 390 px; Change password and Sign out stay off the phone shell as before T50b). No spec change; the design frame is not matched.
- B: Menu button + overlay nav (the design), with 01a S50 a amended by the human. The overlay must then be built on the kit `Dialog` (Escape, focus trap, focus return, `role="dialog"`; review R-3).
- C: A tab bar with 4 items plus "More", which opens the rest (needs a spec line in 01a S50 a or 01b §8).
**Recommendation:** B — eight items do not fit a tab bar at 390 px, and B puts Change password and Sign out on the phone; amend S50 a first.
ANSWER:
