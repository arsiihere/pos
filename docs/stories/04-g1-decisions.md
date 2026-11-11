# 04 Voids + Audit — G1 decisions (working record)

| | |
|---|---|
| Status | **Working record of the G1 session (developer, 2026-11-11).** §1 holds the owner's rulings on G0 §3 (K-1–K-8, 2026-11-11 18:31 PKT). §2 holds the decisions that follow from them. **Open:** K-8 follow-up (§3) and G0 §6 Q2–Q12, Q14–Q16 (Q1 answered through K-7, Q13 through K-8). No spec until these are answered and the owner says "go spec". |
| Base | `spec-04` from `origin/main` @ `45828a7`; G0 = `docs/stories/04-g0.md` (`ad374fc`). |

## 1. Owner rulings on G0 §3 (2026-11-11 18:31 PKT)

| # | Owner said | Ruling |
|---|---|---|
| K-1 | "alert id honi chahiye, isko flexible nahi karna" | **01d's `checkAlertIds` stays as it is.** Every draft a void `apply` returns carries the request's `alert_id` — the cascade too (§2 G1-1). G0 option (b). |
| K-2 | "jab alert id hogi to ye solve ho jayega na?" | Partly: `alert_id` links an approved void to its request (requester, approver, method via `AlertRaised` / `RequestAnswered`), but a **direct** void (grant `allowed`) has no request, and disposition is not in the request at all. **Developer call (owner to confirm):** `ItemVoided` also carries `reason_code`, `note`, `disposition`, `requester_staff_id`, `approver_staff_id` (02b `LineComped` precedent), §2 G1-2. |
| K-3 | "your call" | **Developer:** disposition `moved` = `ItemMovedToStock` then `ItemVoided { disposition: 'moved' }` in one transaction, in that order; no 02b / 03a code change to the folds; engine test pins the order (§2 G1-3). |
| K-4 | "wo bump 04 module ke andar daal do aur mention kar do, unko change na karo" | **04 does not change 03b / 03c's claims.** 04 §4.5 records them as taken and the conflict (03c Q-1 / 03b P0.13 name 02b v1.0.4, already APPROVED on main; 02b v1.0.5 too) as a note for 03b's task 0d. 04 takes the next free number after **all** of them, leaving 02b v1.0.6 for 03b's 0d (§2 G1-4). |
| K-5 | "your call" | **Developer:** `order_item_id` everywhere; 01d To 04 text fixed in 01d v1.2.3 (`line_id` → `order_item_id`). |
| K-6 | "your call, ya iski testing high karni hai, zyada test" | **Developer:** 04 uses 02b's `planVoid` (02b v1.0.7 row adds it to §4.2 Exposes as built). **Test bar raised** (§2 G1-6): property tests, deal / child / comp fixtures, an "every refund ≤ billed" invariant over random sequences, rebuild equality. |
| K-7 | "haan, ye ek permission bano aur testing mein isko attach karo; real life mein kisi ko dein kisi ko na dein; system pura permission based" | **`void-item` stays one permission, any role may get it at any grant.** Defaults: Cashier and Order taker `void-item` **requires approval by Manager**; Owner, Manager `allowed` (01b v1.9 row, re-seed R29). **Every grant state is tested** (§2 G1-7). = G0 Q1 (a). |
| K-8 | "nahi bro, ye pilot mein rakhna hai" | **The audit log reaches the cloud in the pilot** (owner can see it away from the restaurant). How → §3 (needs one more answer). |

## 2. Decisions that follow

| # | Decision |
|---|---|
| G1-1 | **`alert_id` on every approval-born event** (K-1). The void `apply` stamps `alert_id` on each draft: `ItemVoided`, `ItemMovedToStock`, `StockReleased`, `StockAdded` (v2), `StockReserved` (waiting-line reserves after a move), `OrderCancelled`, `OrderFoodCleared`. Each of these schemas gains an **optional** `alert_id` (additive, no version bump of the payload, R29): stock + `ItemVoided` / `ItemMovedToStock` in **03a v1.2.2** (03a owns the files), `OrderCancelled` / `OrderFoodCleared` in **02b v1.0.7** (both are `.strict()` today, so the field must be declared). A direct void writes `alert_id: null` / absent. |
| G1-1b | **No foreign `AlertClosed` inside `apply`** (it would carry the comp request's id, not the void's). So: a void request is **refused while a comp request is open on any of its lines** (`409 COMP_PENDING { alert_id }`, 02b's code), and a comp on a line in a pending void is refused (`409 VOID_PENDING`, Q7). Then `lineChangeDrafts` inside `apply` has no stale comp to close; it is still called and its result checked empty of `AlertClosed` (assert, test). A **direct** void (no `apply`) closes stale comp requests through `lineChangeDrafts` as 02b specifies. |
| G1-2 | `ItemVoided` v1 additive fields (03a v1.2.2): `alert_id?`, `requester_staff_id?`, `approver_staff_id?`, `reason_code?`, `note?`, `disposition?: 'moved' \| 'wastage'`. 04 always fills them; old events still parse. Approver = `AnswerFacts.answerer_staff_id`, never `actor_id` (01d). |
| G1-3 | Move to stock = `ItemMovedToStock` (+ its `stockEffects`) **before** `ItemVoided` (+ its `stockEffects`), same transaction. Foundation v1.13 note on §4.2 and 03a v1.2.2 text: move-to-stock is a **disposition of a void**; `move-item-to-stock` is the right to choose it, never a way around `void-item`'s approval (owner 2026-11-07 rule). |
| G1-4 | **Version numbers 04 takes** (after every 03b / 03c claim, unchanged): Foundation **v1.13**, 00 **v1.10**, 01b **v1.9**, 01d **v1.2.3**, 02b **v1.0.7** (v1.0.6 left for 03b's 0d), 03a **v1.2.2**, 03b **v1.0.2**, 03c **v1.0.2**; 02a only if a row needs it (v1.1.5). 04 §4.5 lists 03b / 03c's claims as "taken" and the 02b v1.0.4 clash as a note. |
| G1-5 | Request values `{ order_id, lines: [{ order_item_id, units }], disposition, reason_code, note }` (K-5, G0 Q5 pending). |
| G1-6 | **Money tests (K-6):** (1) table tests for every 01c §3.4.8 case (deal part per portion, g/ml whole, option child cascade with and without `option_quantity`, comped units first-out to `comp_voided_minor`); (2) a **property test**: random sequences of comp / remove / void on random lines and deals never break `money_out ≤ refundable` and the deal-billed rule, and Σ refunds = Σ billed before − after; (3) approve recomputes from the current ledger (a comp in between changes the amount; test); (4) projection rebuild from seq 0 = live; (5) fixture events with and without the new optional fields parse (upcast-free). |
| G1-7 | **Permission matrix tests (K-7)** for `VoidItems`: `void-item` not granted → 403; `allowed` → applied at once; `requires_approval` → request raised (approver roles from the grant); owner's per-person **denied** → 403 even with a role grant; two roles (allowed + requires_approval) → allowed (D19); `move-item-to-stock` absent → `moved` refused / UI disabled; approver: `approve-void` `branch` covers all, `my_team` covers only the team tree (01d rule 6) → `out_of_range`; self → `self`; approver role removed after the raise → `not_approver`. Defaults seeded (01b v1.9) checked by a seed test. |

## 3. Still open — owner

**K-8 follow-up — how the audit log reaches the cloud in the pilot.** Today nothing leaves the hub except config pulls; hub → cloud event sync (foundation §5.5) is module 06, and milestone A has only 06's USB backup.

| Option | What | Cost / risk |
|---|---|---|
| (a) **04 builds foundation §5.5 as specified** — hub pushes **all** events (`sync_cursor`, contiguity, `SYNC_SEQ_GAP`, ≤ 500 per batch) to a cloud `events` table (insert-only, triggers), plus **one** cloud projection `audit_entries` and the owner page `GET /v1/admin/audit-log`. 06 later adds its other projections, `push_queue` and restore on the same pipe. | +3 endpoints / workers, a README decision moving the §5.5 transport from 06 to 04. Nothing thrown away. Customer phone numbers (`OrderContactSet`) reach the cloud as 02b O17 already accepts. |
| (b) 04 pushes only its own `audit_entries` rows to a 04-only cloud endpoint | Smaller now, but a second sync pipe that 06 replaces → throwaway work and two cursors. |
| (c) Pull all of 06's sync into milestone A as its own spec before 04's build | Cleanest ownership; adds a whole spec and review cycle before the pilot date. |

**Rec: (a)** — the foundation already defines the protocol, so it is built once and 06 grows on it.

**G0 §6 questions still unanswered** (Rec in G0): Q2 what can be voided, Q3 disposition / no staff meal, Q4 fixed reason codes, Q5 one request per order cancel, Q6 one pending void per order, Q7 block comp / remove / weight on pending lines (now also needed by G1-1b), Q8 nothing on KDS while pending, Q9 no override in pilot, Q10 withdraw = never happened, Q11 reject notice to requester + holder, Q12 wrong own order = void + new order, Q14 curated action list, Q15 Owner + Manager see it, Q16 approver card contents.
