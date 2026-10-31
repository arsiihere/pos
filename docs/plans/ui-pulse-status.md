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

Every group ended with no Critical or Important finding open; Minor findings were parked (list below). Final gate at 7840fd9 (after the owner-decision round): typecheck, lint and tests green (250 files, 1351 tests).

**Decisions for you:** the seven raised at the end of the run (O1–O7) were answered by the owner on 2026-10-30 and are applied; see "Owner decisions". Pending: 01c P2 (API change), and the Urdu native review.

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
| R2-A People nav | owner decision 1 | bbb7993 | clean |
| R2-B 01b keep the draft | owner decision 3 (01b P1) | f032499, de3850b | 1 Important fixed (+ Restore resend) |
| R2-C Stock fold + error keys | owner decision 5, 01c P1 | e5f912b, d8e1e52 | 2 Important fixed |
| R2-D Font licences | owner decision 2 | 9a43761 | clean |
| Hand-off docs in git | owner instruction | 5ff7f82 | — |

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
- D9. 01b-B03 stale form: the look comes from the frame ("Changed elsewhere" + Reload). At first the draft behaviour followed the approved 01b v1.2 text (Reload keeps nothing). After the owner approved proposal P1 (O3), the 01b forms keep the draft too.
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

## Owner decisions (2026-10-30, after the run) — applied

- O1 People nav: **done** (bbb7993). One "People" entry with tabs Staff · Roles · Teams · Stock counting on the four list pages; routes unchanged; forms keep their back link.
- O2 Font licences: **done** (9a43761). OFL texts for Figtree, Bricolage Grotesque and Geist Mono next to the fonts; every copyright line read from the font's own name table.
- O3 01b keep the draft on 409 CONFIG_STALE: **done** (f032499, de3850b). Staff form (incl. Mark as left), role editor, roles list (idle minutes, Archive, Restore) and stock counting keep what was typed under the shared "Changed elsewhere" banner. Reload discards the draft and loads the current version. No auto-retry, no resend with the old version. Teams, branch settings and password send no version and have no stale path. 01b proposal P1 is approved by the owner; the spec text is applied later in the as-built pass (spec files not edited here).
- O4 "Show archived" in the ⋯ More menu (with an "Archived shown ✕" chip) on menu, floors, stations and the 01c lists: **accepted by the owner** as built.
- O5 Ready-made stock: **done** (e5f912b, d8e1e52). Folded into the collapsed "Branches and kitchen, Ready-made stock, Hours" row. Its one-line summary shows the stock draw ("Karahi pot · 0.5 kg per sale", "{stock} · the amount sold" when the units match) or "Not counted" (01c A2). The row opens on an error inside, and fix links open it first. The title adds "Ready-made stock" to the frame's text (key `item.fold_title`).
- O6 Urdu: left as drafts, list below for a native review.
- O7 Frame details with no API data behind them: accepted as done.
- 01c P1 (approved): owner error texts use `errors.reference.<reason>`; `unit_mismatch` on field `stock_unit` uses `errors.reference.unit_mismatch_stock`, on `stock_draws.0.stock_item_id` the plain `unit_mismatch`. **Done** (e5f912b): one shared mapping for 01a, 01b and 01c, tested.

## Pending follow-ups

- **01c P2** (approved, API change not landed yet): archived deal parts will carry `quantity` and `choices`. Until the API returns them, the deal form's "Removed" row keeps its fallback text ("A removed part" + Restore), and a restored part comes back empty, with its id. When the API lands, the row reads e.g. "4 × Naan or Roghni naan" and Restore brings the choices back.
- 01b and 01c spec texts for P1/P2 are applied by the owner in the as-built pass.

## Urdu for native review (owner decision 6: drafts stay)

Owner app (`apps/client/src/i18n/ur.ts`, missing keys fall back to English):
- 1275 English keys, 352 with Urdu.
- **186 Urdu drafts** sit under `// … Urdu draft — needs native review` comments:
  - item 24, staff 21, deal 17, owner 16, deals 11, size_groups 10, admin_stock 9;
  - choice_groups 8, menu 7, choice_group 7, stations 5;
  - stock_item, roles, cando, role_editor, floors 4 each;
  - stale, teams, deal_picker, branches, applies 3 each;
  - smaller groups for the rest.
- **923 keys have no Urdu yet:**
  - owner 146, admin_stock 125, item 82, staff 72, choice_group 64;
  - errors 54 (incl. every `errors.reference.*` 01c reason and `unit_mismatch_stock`);
  - deal 41, roles 38, stock_item 33, floors 33, size_group 32, menu 27, choice_groups 23;
  - branches 18, account 17, stock_items 16, archive 16, counting 15;
  - smaller groups for the rest.
- The 01c Urdu was promised with the designer's next frame set.

Hub pages (`apps/hub/src/lib/strings.ts`):
- 343 keys, 103 with Urdu; drafts sit under the three "Urdu draft — needs native review (Pulse 00 CHANGES §3)" blocks.
- **240 keys have no Urdu:** errors 35, devices 27, pairing 24, sessions 24, setup 21, global 20, lockouts 19, approve 18, addphone 15, admin 14, bootstrap 11, pin 11.

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
- d8e1e52 (round 2: owner decisions): typecheck:tests failed, with 6 nullable-element type errors in `ItemSections.test.tsx`; fixed in 7840fd9, no casts.
- **7840fd9 (final, round 2 included; clean worktree): typecheck, lint, test green — 250 files, 1351 tests.**
