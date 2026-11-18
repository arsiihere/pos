# DL Notification deep links — build board

Plan: `dl-plan.md`. Manual checks: `dl-manual-checks.md`. Spec: `01d_Notifications_Requests_Spec_v1.3.md` §3.13 (APPROVED, owner 2026-11-18 10:05 PKT) with 02a v1.1.7, 02b v1.0.15, 03a v1.2.5, 03b v1.0.9, 04 v1.0.6. Review: `docs/reviews/dl-deeplinks-hostile-review.md`. Integration branch: `module-deeplinks` (cut from `main` `049f6ce`; spec set merged `af8fddd5`). Only the integrator edits this file.

> **Status (owner summary, Hinglish, newest first):**
> - 2026-11-18: plan ready (PR into `module-deeplinks`). 24 build tasks: H 4, C 19 (Cs 12 + Cp 7), T 1; plus Z1–Z3. Sab pending. 4 gaps (G-1–G-4), har ek ka Rec plan mein; owner se sirf G-1 / G-2 ka "haan" chahiye.
> - 2026-11-18 10:05: owner "Theak ha jaise tm kaho" → DL Q-3 (a), Back chip, seen on every tap; spec set APPROVED (#237 `af8fddd5`).
> - 2026-11-18 09:18: DL Q-1 (a), DL Q-2 (a).
> - 2026-11-18 08:45: new feature asked ("notification par click karo to os jaga le jae aur wo highlight ho"); DL Q-0a (a), DL Q-0b (a).

## Owner rulings on how the build runs

Same as 04 (W-1–W-6, `04-status.md`), for `module-deeplinks`:

| # | Ruling |
|---|---|
| W-1 | `module-deeplinks`: PR required, check `gate` required, rebase merge only, no force push. |
| W-2 | The integrator merges green, reviewed PRs into `module-deeplinks`. Stacked: top PR merged, the lower ones closed with a comment. |
| W-3 | The integrator merges green docs PRs. `module-deeplinks` → `main` is the owner's (merge commit); the integrator opens the PR (Z3). |
| W-4 | Lanes are background agents from the integrator session, **at most 4 at once** (H, Cs, Cp, then T). |
| W-5 | Repo public: never commit a secret. |
| W-6 | HIGH tasks get two fresh reviewers (lock safety, command flow, permissions, locks / drafts, statement counts). Fix rounds > 2 → STOP. |

## Owner rulings on the spec (DL)

| # | Ruling | When | Where it landed |
|---|---|---|---|
| DL Q-0a | (a) Kinds with no staff-app screen (`station_overload`, `kds_offline`, `printer_problem`, `no_approver`) keep today's tap, no deep link | 2026-11-18 | 01d v1.3 §3.13.1, §12.8; h2 (no `link`), cs6 #78 |
| DL Q-0b | (a) Existing notifications only; "food ready" to waiters is a later feature (DL-F1) | 2026-11-18 | 01d v1.3 §3.13, §12.4, §12.8; plan "Do not build" |
| DL Q-1 | (a) A request the viewer can answer: open the place, glow it, then `AnswerSheet` on top; only "the request is closed" stops the sheet (B2); a dine-in slip answers in its LateCard | 2026-11-18 09:18 PKT | 01d v1.3 §3.13.2 rule 4, §12.8; cs8, cs10 |
| DL Q-2 | (a) Only `ready_to_serve` treats a fully served order as not open; elsewhere served lines and rounds stay reachable, unfold and glow | 2026-11-18 09:18 PKT | 01d v1.3 §3.13.1, §3.13.3, §12.8; cs4, cp4 |
| DL Q-3 | (a) A notice tap (all six notice kinds) glows the place, then `NoticeSheet` on top with all its facts; not open or uncheckable → the card over the current screen, no toast ("Theak ha jaise tm kaho") | 2026-11-18 10:05 PKT | 01d v1.3 §3.13.2 rule 5, §12.8; cs9 |
| DL-K1 | Kiosk "Back" chip after a deep-link navigation: accepted (one level, `alerts.back`) | 2026-11-18 10:05 PKT | 01d v1.3 §3.13.2 rule 6, §12.8; cs11 |
| DL-S1 | Seen on every tap, also a "no longer open" tap (integrator ruling, confirmed by the owner) | 2026-11-18 (confirmed 10:05 PKT) | 01d v1.3 §3.13.2 rule 3, §12.8; cs6, cs7 |

## Gaps (plan "Gaps found") — owner to confirm the Rec

| # | Gap | Rec | State |
|---|---|---|---|
| G-1 | No "opened set" exists; a repeated tap after the 250 ms flush re-sends `MarkAlertsSeen` today | cs7 adds a per-session `seenSent` set; wording fix at the next 01d text bump | pending |
| G-2 | 9b (Android notification tap) is not built | cs12 builds the page half; native intent → 01d-tablet-plan | pending |
| G-3 | `orderView` `{ kind: 'missing' }` not named by §3.13.3 | read as "cannot check" | pending (no ruling needed) |
| G-4 | Archived primary tile: 01d "skip tile glow" vs 02a "header glows" | build 02a's (header glows) | pending (no ruling needed) |

## Lane H — hub

| Task | Title | Needs | Marker | PR | State |
|---|---|---|---|---|---|
| h1 | `target` on every view + `safeLink`; copy kinds' `values.link` schema | cs1 | HIGH | — | pending |
| h2 | `link` per owning kind (rows 1–13) | h1 | Cross | — | pending |
| h3 | Copy kinds carry the request's place (`AnswerRequest`, `pinFailed`, `closeMany`) | h1, h2 | HIGH | — | pending |
| h4 | 02b `order-view` `order_type` + current `seating_id` | — | HIGH, Cross | — | pending |

## Lane C — client

| Track | Task | Title | Needs | Marker | PR | State |
|---|---|---|---|---|---|---|
| Cs | cs1 | `AlertLinkTargetSchema` + view `target` (optional, unknown → null) | — | Shared | — | pending |
| Cs | cs2 | Texts EN / UR + `urdu-todo.md` | — | — | — | pending |
| Cs | cs3 | Router `focus` params + phone tabs | — | — | — | pending |
| Cs | cs4 | Open check: orders, zones, request state | h4, cs1 | — | — | pending |
| Cs | cs5 | Open check: `table` (M1 merge) + slip first open order (m5) | cs4 | — | — | pending |
| Cs | cs6 | Per-kind tap handler on Inbox, banner, `CallCard`, Requests | cs3, cs5, cp2 | HIGH | — | pending |
| Cs | cs7 | Seen once per alert (DL-S1, G-1) | cs6 | HIGH | — | pending |
| Cs | cs8 | `AnswerSheet` on top (DL Q-1) + B2 | cs6 | HIGH | — | pending |
| Cs | cs9 | `NoticeSheet` on top (DL Q-3) | cs8 | HIGH | — | pending |
| Cs | cs10 | Slip: dine-in LateCard, takeaway `AnswerSheet` (M3) | cs8, cp4, cp6 | HIGH | — | pending |
| Cs | cs11 | Unfinished work + kiosk Back chip (M5, DL-K1) | cs6, cs2 | HIGH | — | pending |
| Cs | cs12 | 9b focus kept through sign-in (page half, G-2) | cp7 | — | — | pending |
| Cp | cp1 | Glow tokens, keyframe, reduced motion | — | Shared | — | pending |
| Cp | cp2 | Scroll / glow helper + live region | cp1 | — | — | pending |
| Cp | cp3 | Data attributes + `Round.forceOpen` | — | Cross | — | pending |
| Cp | cp4 | Table-sheet places + auto-unfold | cp2, cp3, cs3 | — | — | pending |
| Cp | cp5 | Map places per device (floor, tile beside panel, header) | cp2, cp3, cs3, cs8, cp7 | — | — | pending |
| Cp | cp6 | `OrderView` / zone places; reads per tap | cp3, cs6 | — | — | pending |
| Cp | cp7 | Pass and Inbox places | cp2, cs3, cs8 | Cross | — | pending |

## Lane T — tests

| Task | Title | Needs | PR | State |
|---|---|---|---|---|
| t1 | E2E smoke `apps/client/e2e/dl-deeplinks.spec.ts` (not in the gate) | all H and C | — | pending |

## Close

| # | What | Needs | State |
|---|---|---|---|
| Z1 | Acceptance map (below) filled with green test names | all build tasks | pending |
| Z2 | Owner manual checks `dl-manual-checks.md` 1–16 (tablet landscape + portrait, phone, kiosk, Pass) | Z1 | pending (owner) |
| Z3 | PR `module-deeplinks` → `main`, **owner merges (merge commit)** | Z1 | pending (owner) |

## AD rows (as-built decisions)

| # | Decision | Task | Approved |
|---|---|---|---|
| — | none yet | — | — |

## Acceptance map (Z1 skeleton)

| Story AC (`docs/stories/deeplinks-refined.md`) | Tests | State |
|---|---|---|
| 1. Tap opens the place, scrolls, 2 s glow (static ring with reduced motion) | 74, 76, 77, 79, 82, 84, 85, 97 | pending |
| 2. Not open → "This item is no longer open.", screen unchanged; requests and notices still open their sheet | 75, 80, 81, 83, 87, 88, 89 | pending |
| 3. `station_overload`, `kds_offline`, `printer_problem`, `no_approver`, `test_alert` as today | 69, 78 | pending |
| 4. Every tap marks the alert seen | 74, 75, 78, 90 | pending |
| 5. Tablet (landscape, portrait), phone, kiosk; never the KDS | 79, 86, 91, 92, 95; Z2 | pending |
| Wire / hub (no AC; §3.13.1) | 69, 70, 71, 72, 73, 96, 02b #52 | pending |
| Routes / texts (§3.13.5, §3.13.6) | 93, 94 | pending |
