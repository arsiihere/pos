# UI Pulse status

Branch `ui-pulse` (from `module-01c`). Plan: `docs/plans/ui-pulse-plan.md`. Run: 2026-10-30. A network outage (about 22:37) stopped the five agents running then; all five were resumed and finished.

## Summary

| Module | State | Notes |
|---|---|---|
| Shared design system | **Done** | Pulse tokens, components and kit additions in one copy (`packages/ui-kit`); Figtree, Bricolage Grotesque and Geist Mono bundled. |
| 00 Hub platform | **Done** (3/3 groups) | Hub setup; pair, phone pairing, first admin and approve; hub admin (devices, add a phone, sessions, lockouts, home, dialogs, hub-down and busy states). |
| 01a Restaurant setup | **Done** (4/4) | Owner shell and phone drawer; floors and stations; menu, category and item form; hub stock page (including the 01c-B02 stock-item rows and the 404 banner). |
| 01b Staff and roles | **Done** (3/3) | Staff list and form; roles and role editor; teams, stock counting, branches, branch settings, password, lock notice. |
| 01c Menu variants | **Done** (4/4, built new) | Size groups, stock items, the item form's 01c sections (size group, stock, the create-stock mini-form with test #124, weighed when served), choice groups (with the Applies-to dialog), deals (with the choice picker). Tests #115 and #124, deferred to this UI module, are in. |

Every group had:
1. a fresh implementer;
2. a fresh reviewer, checking spec compliance and quality;
3. a fix round, wherever the review found a Critical or Important issue;
4. a scoped re-review.

Every group ended with no Critical or Important finding open; Minor findings were parked (list below). Final gate at e234780: typecheck, lint and tests green (250 files, 1318 tests).

**Decisions for you (details below):**
- O1: the People nav merge.
- O2: the font licence texts.
- O3: the 01b-B03 "keep the draft" proposal.
- O4: Show archived as a More item plus a chip.
- O5: Ready-made stock on the item form.
- O6: Urdu review.
- O7: frame details that no API provides, left out.

**Blockers:** none.

## Groups

| Group | Screens | Commits | Review |
|---|---|---|---|
| Shared kit | tokens, components, fonts | 23a630a, e234780 | — |
| 00-A Setup | 00-S01, S02, F06, F07 | f455639 | clean |
| 00-B Pair + approve | 00-S03–S15, F02–F04, F08 | 83b1e7a, 7a105cd | 1 Important fixed |
| 00-C Hub admin | 00-S16–S20, D01–D03, F01, F05 | f65f0b2, 0369870 | 1 Important fixed (busy: one retry first, §8.4) |
| 01a-A Owner shell | 01a-S01, S02, B04 | 7fff6b2, 7db5613 | 3 Important fixed |
| 01a-B Floors + stations | 01a-S03, S04, D01, D02 | b775c6b (+ CSS in 83b1e7a) | clean |
| 01a-C Menu + item form | 01a-S05, S06, S07, B01–B03, C01 | ad599f2 | clean |
| 01a-D Hub stock page | 01a-S10, S11, B10–B18, D10, 01c-B02 | f6b01f3, ef1f93c | 2 Important fixed (status chip per S54 e and test #172) |
| 01b-A Staff | 01b-S01, S02, C01–C04, D01, D02, B03, B04 | 2b22736, c541f05, d59602d | 2 Important fixed |
| 01b-B Roles | 01b-S03, S03a, S04, S08, D03 | 12e47c3, 38b3f11 | 1 Important fixed |
| 01b-C Teams, stock counting, branches, password | 01b-S05–S07, S09, S10, D04, B01, B02, B05 | 7dc9c42, 85347a7 | 2 Important fixed |
| 01c-B Size groups + stock items | 01c-S06–S09, D04, B01, B03, B06 | 80c2f80, 71a702b | 1 Important fixed |
| 01c-C Item form sections | 01c-S01, 01a-S05 nesting | 8fa504d, b7d4dea | 1 Important fixed |
| 01c-D Choice groups | 01c-S02, S03, S10, D02, B04, B05 | 1171e01, 572eb9a | 2 Important fixed |
| 01c-E Deals | 01c-S04, S05, S11, D03, B04 | 3b7a699, 9f85408 | 3 Important fixed |

Per-group reports, reviews and screenshots: the working folder `.superpowers/sdd/ui-pulse-plan/` (git-ignored) and the scratchpad `shots/out/`.

## Decisions (frame vs spec/contract, and choices made during the run)

The spec wins for behaviour and the frame wins for looks. Each implementer's report lists its own cases; these are the main ones.

### Process

- D1. The branch `ui-pulse` did not exist. I created it from `module-01c`. The uncommitted 01c design-doc edits from the previous session (01b/01c specs, 01c inventory, 01c open questions, `updated-designs/`) stay uncommitted.
- D2. The design system lives in one place, `packages/ui-kit`. 01c's `kit-additions.css` is a superset of the 00/01a/01b files.
- D3. Frames draw layout with inline `style`. The client forbids `style` (01a S35 d, lint test #79), so frame layout became named, token-only classes in `bundle.css`, one section per group.
- D4. The hub test `ui-assets.int.test.ts` probes the new font file names, with the same assertions.
- D5. Implementers ran on up to four tracks in parallel, on separate folders, to fit the time. The shared files (`bundle.css`, `en.ts`, `ur.ts`) were staged per hunk. Because of this, two commits carry another group's CSS section: 83b1e7a carries 01a-B's, and 12e47c3 carries 01b-C's. A duplicated 01b-A section was removed in e234780.

### Spec kept over the frame

- D6. 01a menu row: the branch price chip stays (S57 e, test #179). The frame drops it.
- D7. 01a categories and tax rates: no item counts (S50 f).
- D8. 01a stock page:
  - the menu status chip shows in the app bar in every state (S54 e, test #172);
  - the hub admin side nav stays at tablet width (#172);
  - not-counted rows show 0 (S41);
  - the "counts kept" banner keeps Discard.
- D9. 01b-B03 stale form: the look comes from the frame ("Changed elsewhere" + Reload). The draft behaviour is the approved 01b v1.2 one: Reload keeps nothing. The keep-draft change is only a proposal (see O3).
- D10. 00-F05: admin commands retry once after `retry_after_ms` with the same `command_id` before showing "Hub busy" (spec 00 §8.4).
- D11. Owner sign-in returns no restaurant name or email, so the nav brand shows the owner's display name.
- D12. 01c quantities show in kg/L ("0.5 kg") per 01a S44, where the frames draw "500 g".
- D13. Removed rows:
  - 01c removed deal parts restore empty, with their id. The owner picks the choices again, until the Q14 spec change.
  - Restored choice options need their price again, because the wire sends only the id and name.

### Built behaviour that was missing or broken

- D14. 01a category Edit/New used to blank the page (MenuView returned null). It now opens the dialog, with a test.
- D15. Back links on phone forms now go through the unsaved-changes guard. This covers the staff form, role editor, branch settings and every 01c form.
- D16. On phone, a page with a back link shows back alone, as the phone frames draw; other pages keep Menu (test 180 unchanged).
- D17. New size groups, stock items, choice groups and deals open their edit page after Create, so sizes and branch rows can be added there.
- D18. Failed menu-page loads on the choice-group and deal pages show an error with Retry, never an endless "Checking branches…".

## Open decisions for the owner

- O1. 01c CHANGES §1 folds 01b's Staff · Roles · Teams · Stock counting into one **People** nav entry ("needs the owner's OK"). Not done: the entries stay separate, and the side nav scrolls inside itself at 800 px high.
- O2. No licence texts for Figtree, Bricolage Grotesque and Geist Mono (OFL) came in the hand-off. Add them to `packages/ui-kit/fonts/` before release.
- O3. 01b-B03 "keep the draft" (designer Q8) is drafted as "Proposed — needs approval" in the 01b spec. Until approved, 01b forms reload without the draft. The 01c forms keep the draft, per 01c §8.
- O4. "Show archived" moved from a segmented control into the app-bar More menu, plus a chip, on menu, floors and stations. The spec wording says "Active / Archived switch", so please confirm.
- O5. The item form keeps the existing "Ready-made stock" section next to the new 01c "Stock" section. The frames' collapsed "Branches and kitchen, Hours" disclosure was not built. Should Ready-made stock fold into it?
- O6. Urdu: many new strings are English-only or drafts marked for review, and need a native review. The 01c Urdu was promised with the next frame set.
- O7. Details the frames show but no API gives, left out:
  - station item sub-lines on stock counting;
  - item counts on categories;
  - paired details for read-only admins (hidden, as the frame draws).

## Parked minor findings (not fixed)

- Hard-coded px values in some bundle sections where no token matches.
- The 00 kitchen-screen "pair again" wording is not wired: the page can't know it is a kitchen screen before pairing.
- The 00 phone pairing retry shows "Pairing…".
- 01a error-banner fix-links are under 56 px, as the frame draws.
- 01b:
  - the phone C02 card is taller than the frame;
  - stale banners scroll with the content rather than sitting in a fixed strip;
  - the PIN tooltip can't be reached by keyboard.
- 01c:
  - the 360 px app bar wraps "New" under the title;
  - an archived deal shows "…" for an archived item's part;
  - the deal form's price field shows "3200" without digit grouping;
  - "Show archived" isn't on the phone lists (no ⋯ there).
- The info-hint tooltips need hover or focus; on touch, only the "on orders" tip opens on tap.

## Blocked

None.

## Gate log

- 23a630a (shared kit): typecheck, lint, test green — 242 files, 1157 tests.
- 7fff6b2 (00-A + 01a-A, clean worktree): typecheck and lint green. Tests 1168/1169. The 1 failure is a 5 s timeout in cloud `login.int` #109 under load from the parallel agents; no cloud file changed on this branch. Re-run alone: 3/3 pass.
- 0369870 (all of 00 + 01a shell, floors and stations): typecheck, lint, test green — 243 files, 1181 tests.
- 85347a7 (00 + 01a + 01b, 01c size groups and stock items): typecheck and lint green. Tests 1254/1258. The 4 failures are 5 s cloud timeouts (#75, #53, #109, #11) while five agents ran; re-run alone: 7/7 pass.
- **e234780 (final, all four modules; clean worktree): typecheck, lint, test green — 250 files, 1318 tests.**
