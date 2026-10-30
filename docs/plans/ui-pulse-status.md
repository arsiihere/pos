# UI Pulse status

Branch `ui-pulse` (from `module-01c`). Plan: `docs/plans/ui-pulse-plan.md`.

## Summary

_(filled in at the end of the run)_

## Groups

| Group | State | Commit | Gate | Notes |
|---|---|---|---|---|
| Shared kit | in progress | | | |

## Decisions (frame vs spec/contract, and choices made during the run)

- D1. The branch `ui-pulse` did not exist. I created it from `module-01c` at the start of the run. The uncommitted 01c design-doc edits from the previous session stay uncommitted and are not part of any `ui(pulse)` commit.
- D2. Design system in one place: `packages/ui-kit` (tokens, `components/bundle.css` = hand-off bundle + 01c `kit-additions.css`, fonts). 01c's `kit-additions.css` is a superset of the 00/01a/01b files: same rules, plus a one-line comment shift.
- D3. Frames draw page layout with inline `style`. The client forbids the `style` prop (01a S35 d, lint test #79). So frame-only layout becomes named, token-only classes in `bundle.css`, never inline styles.
- D4. Hub test `apps/hub/test/ui-assets.int.test.ts` now probes `Figtree-var.woff2` and `OFL-NotoNastaliqUrdu.txt` instead of the removed Atkinson files. Same assertions.

## Open decisions for the owner

- O1. 01c CHANGES §1 folds 01b's Staff · Roles · Teams · Stock counting into one **People** nav entry. The hand-off says this "needs the owner's OK".
- O2. The hand-off has no licence texts for the new fonts: Figtree, Bricolage Grotesque, Geist Mono (all OFL per CHANGES). Add the OFL texts to `packages/ui-kit/fonts/` before release.

## Blocked

_(none yet)_

## Gate log
