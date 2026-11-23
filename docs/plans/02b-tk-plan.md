# 02b-TK Takeaway — plan, Part A (no spec bump)

Source: owner rulings `docs/plans/02b-tk-rulings.md` (R1–R9), the 02b-TK backend audit (24 Nov 2026), the hand-off `docs/design/handoff/02b-tk/` (frames `design/*.dc.html`, `CHANGES.md`, `MAPPING.md`, `strings-table.md`). Specs as they stand: 02b v1.0.24, 03a v1.2.10, 03b v1.0.15, 05 v1.0.34, 05a v1.0.6, 01b v1.11. Part B (spec bumps) is listed at the end and is **not** built from this plan.

## Global constraints (every task)

- CLAUDE.md: TDD (failing test first), one task per commit, the commit cites the spec, e.g. `feat(client): token view hand over [02b v1.0.24 §6.4, §8; 02b-tk R2]`.
- **No hub, event, migration, error-code or API change** in Part A, except task A1 (cloud only). If a task needs one, STOP and list it for Part B.
- Client stack rules of `docs/plans/02-client-plan.md` "Global constraints" (one `apps/client` Vite app, `packages/ui-kit` styling, i18n keys in `apps/client/src/i18n/en.ts` + `ur.ts`, strings from `docs/design/handoff/02b-tk/strings-table.md`).
- Follow the frames; where the audit corrected the design, follow the audit (rulings file, "Audit corrections").
- Gate before every push: `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"`.

## A1 · Cashier default `mark-served` + backfill · HIGH (permissions, data migration)

01b v1.11 §6.15 (v1.8.1, Q-23, Q-34); plan row H10 of `docs/plans/02-hub-gaps-plan.md`. Cherry-pick of `origin/lane-HD/h10` 456a85ce with the migration renumbered **0015 → 0019** (0015–0018 are taken on `main`). Files: `apps/cloud/src/modules/staff-roles/default-roles.ts`, `apps/cloud/src/db/migrations/0019_cashier_mark_served.sql`, tests `apps/cloud/test/default-roles.test.ts`, `apps/cloud/test/cli/seed-tenant.int.test.ts`, `apps/cloud/test/db/cashier-mark-served-migration.int.test.ts` (scratch DB at 18, then the real folder).

## A2 · Client bundle (built hub features only)

Batches of about five tasks, one commit each, in order.

### Batch C1 — cart and Send (frames HomeKiosk, CartTimeDelta, PhoneInvalid, SentToast, SentQueued, ItemSheet, ItemSheetEdit, DealSheet, LeaveGuard)

| Task | What | Spec / ruling |
|---|---|---|
| C1-1 | **Day not open from eta-preview:** keep the error code in `preview.ts`; a `409 BUSINESS_DAY_NOT_OPEN` gives a `day_not_open` state; the cart shows the DayNotStarted reason ("Times show after Start day") and blocks Send before the first item, not `cart.times_later`. | 02b §6.14, §8; audit #1 |
| C1-2 | **Takeaway name / phone inline in the cart** (kiosk skips no longer): optional (R1), +92 mask with numeric pad; a typed phone must be valid (10–13 digits after stripping spaces, dashes and a leading `+`, as the hub does), else inline error; sent as `SubmitOrder.takeaway`. | 02b §3.1, §6.1; R1 |
| C1-3 | **Send in the background:** no dialog; fresh cart at once; toast with the token from the result (print again); offline → "Not sent yet — token comes when the hub is back" and a dashed "Waiting to send" row. | 02b §6.1, §3.12; audit #7, #27 |
| C1-4 | **Add-on quantity steppers** in the item and deal sheets up to option `max_quantity` and group `max_choices` (quantity counts toward `max_choices`); editing a cart line says "Save changes" with Remove on the left. | 01c §4.4; 02b §3.2; audit #22 |
| C1-5 | **Leave guard + auto-hold:** leaving with an unsent cart (tab, Back, sign out) asks Hold it / Throw away / Stay here; sign out and idle lock hold the cart automatically. | 02b §8 Held, Device idle lock |

### Batch C2 — queue and token (frames HomeKiosk, ReadyTiles, QueueTablet, PhoneQueue, TokenDue, TokenReady, TokenPartial, TokenLate, TokenAddItems, TokenRemove, HandoverUndo, HeldDrawer)

| Task | What | Spec / ruling |
|---|---|---|
| C2-1 | **Takeaway home queue rail + client search** by token / name / last 4 phone digits from the kiosk's catch-up contact and `OrderContactSet` frames; no contact fields requested from the hub. | 02b §6.16, §6.18a, O17; R3 |
| C2-2 | **Token view drawer:** stages per item, bill facts from `bill?order_id` (the token's **newest** order), Give ready items now (`MarkServed` subset), Hand over all; **Hand over greyed on a Due order** with a manager override in the client (holders of `apply-discount`-level manager role per effective permissions; no hub guard); 5 s Undo (the client delays `MarkServed`, sends on `visibilitychange`/unload). | 02b §6.4, §3.7; 05 §6.1, B16; R2; audit #11, #26 |
| C2-3 | **Add items to a sent token:** `SubmitOrder { adds_to_order_id }`, banner "Adding to token 53", primary "Add to token 53"; after the root bill closed, the addition shows as a new bill on the same token. | 02b §3.2; 05 #44a–#44i |
| C2-4 | **Remove / cancel from a token:** `RemoveItems` before start, `VoidItems` with approval after (04), refund through `ReopenBill` + `AddPayment out`; map every error code of the audit row #15. | 02b §6.2; 04 §6.1; 05 §3.10, §6.9 |
| C2-5 | **Held per device with masking:** every person signed in on this device sees its held drafts (held by, held at); name and phone masked for anyone without `view-customer-contact`. | 02b §8 Held; R3 |

### Batch C3 — pay, print, menu, Pass (frames PayCash, PayCashShort, PayCard, PayDone, PayError, TileStates, HomeEmpty, PackerPass)

| Task | What | Spec / ruling |
|---|---|---|
| C3-1 | **Send & pay / pay later:** pay panel over the cart (Exact / 4,000 / 5,000 / 10,000, change shown, "Short by"), card with reference, `AddPayment` + `CloseSplit` (receipt prints as today); errors `SHIFT_NOT_OPEN`, `PAYMENT_REFERENCE_REQUIRED`, `BILL_TOTAL_CHANGED`…; offline: Pay hidden, the order stays Due. | 05 §6.1, §6.9, §6.12, B12, B16; audit #8, #28 |
| C3-2 | **Print check bill** on the cart (sent token) and the token view, through the existing check-bill print command. | 05 §3.16, §6.x; R6 |
| C3-3 | **Tile wait estimate:** every tile shows "about N min" from `stations-live` `wait_ms` + prep + cook (+ takeaway padding) (03a To-02 #9); "Now" only for a ready item or `stock_time_ms = 0` with stock; a stock-served item shows its reheat time; **no zone "Now" on takeaway**. | 03a §6.5, To-02 #9; 02b §8; audit #2 |
| C3-4 | **Pass takeaway filter:** filter chip by order type on the Pass (`point_view` lines carry `order_type`), takeaway sorted by promise; Bag ready = `MarkReadyToServe`. | 03b §6.6, §6.15 |
| C3-5 | **Flows (Playwright):** walk-in send & pay, pay later + hand over, add items, held per device. | CLAUDE.md pipeline 9 |

## Part B (spec bumps — STOP for owner review before code)

02b v1.0.25 · 03a v1.2.11 · 03b v1.0.16 · 00 Hub Platform Access v1.13 + Foundation v1.18 + 05a v1.0.7 · 03c v1.0.16 + 05 v1.0.35 (§3.16) · 01a v2.11 · new 05c v0.1. Each through a hostile review in a fresh session (`docs/reviews/`).

## Status (2026-11-24)

| Task | State | Commit(s) |
|---|---|---|
| A1 H10 | done | `d361da25` |
| C1-1 … C1-5 | done | `git log --grep "02b-tk C1-"` |
| C2-1 … C2-5 | done (tests written with the code, not failing-first) | `git log --grep "02b-tk C2-"` |
| C3-1, C3-2 | done | `git log --grep "02b-tk C3-[12]"` |
| C3-3, C3-4 | done | `git log --grep "02b-tk C3-[34]"` |
| C3-5 | done: `apps/client/e2e/02b-tk-flows.spec.ts`, 8/8 on the kiosk project; the hand-over step is not walked (the e2e hub never marks items done) | `git log --grep "02b-tk C3-5"` |

Waiting for Part B: paid tokens kept in the queue after a reload (02b v1.0.25 open-orders), "Phone orders — later" and pickup chips (`pickup_at_ms`), the amber not-collected tile (`ready_window_ms` in the staff config, 03b v1.0.16), the token slip / "Print again" (03c v1.0.16), Raast / NFC (05c).
Known outside this work: `apps/hub/test/queries/stock.int.test.ts` "items_meta … windows" fails in a UTC container (`-0` vs `0` utc_offset_ms) on `main` too; `apps/client/e2e/02b-takeaway.spec.ts` was already stale (sign-in lands on `#/inbox`; expects the removed token dialog).
