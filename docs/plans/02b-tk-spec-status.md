# 02b-TK spec status (integration pass, 2026-11-24)

Part B of `docs/plans/02b-tk-rulings.md` (owner rulings R1–R9). Every spec below is a **DRAFT** that had hostile run 1 in a fresh session and a fix pass, then the integration pass (marker "⚠️ Changed by … (integration, 02b-TK)", changelog "Integration pass (02b-TK cross-spec rows)"). None is approved; no code is built against them. The approved version of each stays current in `docs/specs/README.md` until the owner approves the package. Every verdict was **FIX THEN RE-REVIEW**; a re-review in a fresh session is still owed for each.

| Spec (file) | From → to | Review | Verdict (B / M / m) | Fix commit | Open owner decisions |
|---|---|---|---|---|---|
| `docs/specs/02b_Ordering_Spec_v1.0.25.md` | v1.0.24 → v1.0.25 | `docs/reviews/02b_v1.0.25_hostile_run1.md` | 1 / 5 / 14 | yes (`6419003a`) | **TK-Q2** end of business day = 01a `business_day_end_local_ms`; **TK-Q12** only the counter's `MarkServed` hands a takeaway over; **TK-Q13** kiosk search from the catch-up, masked rows; **TK-Q17** `order_id` must be a ULID (= 00 OD-10); confirmations TK-Q1, Q3–Q5, Q7, Q9–Q11, Q14, Q16 |
| `docs/specs/03a_Timing_Engine_Spec_v1.2.11.md` | v1.2.10 → v1.2.11 | `docs/reviews/03a_v1.2.11_hostile_run1.md` | 3 / 7 / 14 | yes (`f874cbd5`) | **Q-PK-1** early customer = Boost; **Q-PK-4** a held immediate group slips; **Q-PK-6** stock reserved at submit; **Q-PK-7** earlier, never late; confirmations Q-PK-2, Q-PK-3, Q-PK-5, Q-PK-8 |
| `docs/specs/03b_KDS_Pass_Spec_v1.0.16.md` | v1.0.15 → v1.0.16 | `docs/reviews/03b_v1.0.16_hostile_run1.md` | 1 / 7 / 11 | yes (`121ddf4a`, with `eef76368`) | **OQ-6** – **OQ-14** counter targeting, parking, lock text, "collected", Due, one alert per bag, extend restarts, 2× ringing, counter = profile screens |
| `docs/specs/01d_Notifications_Requests_Spec_v1.3.7.md` | v1.3.6 → v1.3.7 | `docs/reviews/01d_v1.3.7_hostile_run1.md` | 3 / 6 / 12 | yes (`eef76368`) | **Q-37a** – **Q-37g** counter card overrides AD-75, "kiosks" = profile screens, close `4413`, point + counter → card, 05c lock-safe display, absent managers, `needs_review` profiles |
| `docs/specs/00_Hub_Platform_Access_Spec_v1.13.md` | v1.12.4 → v1.13 | `docs/reviews/00_v1.13_hostile_run1.md` (shared with F v1.18, 05a v1.0.7) | 1 / 6 / 16 | yes (`1876c27d`) | **OD-1** – **OD-10** readiness rule, kiosk-only boards, separate public port, accepted leaks, router check, new folders, voice clips, `DEVICE_ACCESS_DENIED` reason, link lifetime, ULID `order_id` |
| `docs/specs/00_Foundation_Spec_v1.18.md` | v1.17 → v1.18 | `docs/reviews/00_v1.13_hostile_run1.md` (shared) | 1 / 6 / 16 (shared) | yes (`1876c27d`) | none of its own: approved with 00 HPA v1.13 OD-1 – OD-10, 03a Q-PK-5 (rows F-R4-n), 05c Q-A – Q-E (rows F-10, F-11) |
| `docs/specs/05a_Device_Access_Screens_Spec_v1.0.7.md` | v1.0.6 → v1.0.7 | `docs/reviews/00_v1.13_hostile_run1.md` (shared) | 1 / 6 / 16 (shared) | yes (`1876c27d`) | **OQ-B3** voice clips (= 00 OD-7), **OQ-B7** tablet board deferred (= OD-2), **OQ-B8** keep `DEVICE_ACCESS_DENIED` + reason (= OD-8), **OD-1 (00)** readiness; confirmations OQ-B1, B2, B4 – B6, B9 |
| `docs/specs/03c_Printing_Spec_v1.0.16.md` | v1.0.15 → v1.0.16 | `docs/reviews/03c_v1.0.16_hostile_run1.md` (shared with 05 v1.0.35) | 2 / 6 / 13 | yes (`d197fd2d`) | **D-1** – **D-7** trigger on `SubmitOrder`, pickup Ready line, who may print, no audit event, partly paid prints, setting default + `document` job, check bill on a sent cart; confirmation D-8 wording |
| `docs/specs/05_Billing_Spec_v1.0.35.md` | v1.0.34 → v1.0.35 | `docs/reviews/03c_v1.0.16_hostile_run1.md` (shared) | 2 / 6 / 13 (shared) | yes (`d197fd2d`) | **D-7** "Print check bill on the cart" (same row as 03c D-7) |
| `docs/specs/01_Restaurant_Setup_Spec_v2.11.md` | v2.10 → v2.11 | `docs/reviews/01a_v2.11_hostile_run1.md` | 1 / 6 / 17 | yes (`81370462`) | **OD-6** `rush_open_orders` no Off; **OD-7** companion vs linked option; **OD-8** cloud migration numbers at merge; **OD-10** business-day end (= 02b TK-Q2); confirmations OD-1 – OD-5, OD-9 |
| `docs/specs/01c_Menu_Variants_Spec_v1.5.md` | v1.4 → v1.5 | `docs/reviews/01c_v1.5_01b_v1.12_hostile_run1.md` | 1 / 3 / 16 (shared with 01b) | yes (`badf4e80`) | none of its own: depends on 01a OD-1 – OD-5, OD-7 |
| `docs/specs/01b_Staff_Roles_Spec_v1.12.md` | v1.11 → v1.12 | `docs/reviews/01c_v1.5_01b_v1.12_hostile_run1.md` | 1 / 3 / 16 (shared with 01c) | yes (`badf4e80`) | none of its own: depends on 01a OD-6, OD-9, OD-10 |
| `docs/specs/05c_Payments_Integration_Spec_v0.2.md` | new (v0.1 kept) → v0.2 | `docs/reviews/05c_v0.1_hostile_run1.md` | 3 / 9 / 15 | yes (`e168cc58`) | **Q-A** – **Q-E** PRA code for Raast, Paymob inside 05b, device result never proof, account per branch, who resolves unapplied money |

## Owner decisions blocking approval

Copied from each spec's §12; the recommended default is already written into each spec's text.

### 02b v1.0.25 (§12.3)
- **TK-Q2** — End of the business day: new 01a setting `business_day_end_local_ms` (default 04:00 hub local); latest = its first occurrence ≥ `opened_at + day_min_gap_hours`; `no_time_left` when earliest > latest.
- **TK-Q12** — A Pass `Handover` or the estimate tick never counts as handed to the customer for a takeaway; only the counter's `MarkServed` does.
- **TK-Q13** — Keep R3's client-side kiosk search; result rows mask name / digits for a person without `view-customer-contact`; data on the device accepted.
- **TK-Q17** (= 00 HPA OD-10) — `SubmitOrder.order_id` must match `ULID_RE`: yes; until it lands `statusLink` returns `null` for such ids.

### 03a v1.2.11 (§12.3)
- **Q-PK-1** — Early pickup customer: Boost clears `EngineOrder.pickup_at_ms`, then boosts as an order without pickup (no new event).
- **Q-PK-4** — A held immediate group slips (warns) like a sync group under the order's key.
- **Q-PK-6** — Stock for a pickup order reserved at submit (first submit wins, no new writer).
- **Q-PK-7** — Two held items that cannot both fit "ready early": one earlier, never late while the kitchen can make the pickup.

### 03b v1.0.16 (§12.3)
- **OQ-6** — Counter targeted by 01d v1.3.7 D-7 `screen_devices` gated by `values.counter_screen`, one kind for every order type.
- **OQ-7** — Parking treated like takeaway (counter audience and alert for devices with the `parking` screen).
- **OQ-8** — Counter lock shows the token ("#12") for takeaway and "PARKING" without the car number.
- **OQ-9** — For takeaway / parking "collected" = served to the customer; a Pass→staff `Handover` keeps the Ready open.
- **OQ-10** — On the Pass "Due" is information only; Hand over stays enabled.
- **OQ-11** — One counter alert per complete bag; earlier points' Readies go to the placer only.
- **OQ-12** — An item added to a complete bag restarts the counter clock and rings again.
- **OQ-13** — At 2× the counter keeps ringing with the point and the managers.
- **OQ-14** — Any device whose profile shows the `takeaway` / `parking` screen is part of the counter, a phone included.

### 01d v1.3.7 (§12.9)
- **Q-37a** — `counter_card` kinds may override AD-75 / AD-162 / AD-163 (card in frames, catch-up, own inbox row), under the M-3 startup refusals.
- **Q-37b** — R8's "the kiosks too" = devices whose profile shows `takeaway` / `parking`.
- **Q-37c** — A distinct WS close code `4413 DISPLAY_DEVICE`.
- **Q-37d** — A device with both a `point` row and a counter row shows the card.
- **Q-37e** — 05c payment kinds: lock shows the kind label only; amount / provider / ref last 4 in base detail fields (05c v0.2 now copies it).
- **Q-37f** — `payment_unapplied` with every manager absent reaches nobody until the next day's re-raise: accept.
- **Q-37g** — `needs_review` profiles count for `screen_devices`.

### 00 HPA v1.13 (§12.3; Foundation v1.18 is approved with these)
- **OD-1** — Keep 02b's one line-readiness rule (engine `done` counts even at a Pass point); revisit after the pilot.
- **OD-2** — Pilot boards only on a `cashier_kiosk` PC in Chrome / Edge kiosk mode; tablet board deferred.
- **OD-3** — Status page on a separate port `public_status.port` (default `http_port + 1`).
- **OD-4** — Accept the ULID time leak and the clear-HTTP link on guest Wi-Fi; WPA3 / OWE recommended.
- **OD-5** — Each pilot router opens only the public port to guests, else `public_status.enabled` stays false.
- **OD-6** — New folders `apps/hub/src/status/` and `apps/client/board/`.
- **OD-7** — Voice clips 1–300, rendered once offline, owner checks a sample.
- **OD-8** — Keep `DEVICE_ACCESS_DENIED` + `reason: 'display_device'` (no new code).
- **OD-9** — Link lifetime `min(day close + 2 h, business day + 36 h)`.
- **OD-10** — 02b `SubmitOrder.order_id` must match `ULID_RE` (written in 02b v1.0.25 as TK-Q17).

### 05a v1.0.7 (§12.3)
- **OQ-B3** (= 00 OD-7) — Clips rendered once with an offline voice tool; a token above 300 plays the chime only.
- **OQ-B7** (= 00 OD-2) — Tablet board deferred; pilot boards are kiosk PCs (no 05b bump; 01d C-05b-37 deferred with it).
- **OQ-B8** (= 00 OD-8) — Keep `DEVICE_ACCESS_DENIED` + `reason`, clients branch on `reason` first.
- **OD-1 (00)** — Line readiness is 02b v1.0.25 §4.2's rule.

### 03c v1.0.16 (§12.3)
- **D-1** — The *Send · pay later* slip rides on `SubmitOrder` (`takeaway.print_slip`), queued in its transaction; replay window 2 min; `PrintTakeawaySlip` for a closed-unpaid Send & pay and reprints.
- **D-2** — A pickup order's Ready line prints the pickup time itself while no line lands after it.
- **D-3** — Any `take-order` holder may print / reprint any token's slip (scope not applied).
- **D-4** — No audit event; slip jobs carry the root `order_id` for 7 days.
- **D-5** — A partly paid bill is still pay-later: the slip prints.
- **D-6** — `takeaway_slip_on_send` default true; a `document` job labelled `Token slip`, not a `takeaway_slip` doc kind.
- **D-7** — An unsent cart shows its total on screen only; paper check bill (`PrintCheckBill`) on a sent token.

### 05 v1.0.35 (§12.3)
- **D-7** — Same as 03c D-7: no paper total before Send.

### 01a v2.11 (§12.6a; 01b v1.12 and 01c v1.5 are approved only with these)
- **OD-6** — `rush_open_orders` 5–100, default 15, no "Off" (`NOT NULL`, wire `number`).
- **OD-7** — A companion chip fills the linked option when one exists, else adds an item line; the item sheet shows the hint as text only.
- **OD-8** — Cloud migration numbers assigned at merge (the `0019` clash, README "Migration numbers").
- **OD-10** (= 02b TK-Q2) — `business_day_end_local_ms` 0–86 399 999 ms, default 04:00.

### 05c v0.2 (§12.3)
- **Q-A** — PRA code for Raast: ask PRA in writing now with a cut-off of 2027-01-31; if no code by then, no Raast at the pilot (05c-R waits); card is not affected.
- **Q-B** — Paymob SoftPOS in the 05b app only if Paymob confirms the 05b host in writing (X-6); else the counter card machine stays.
- **Q-C** — A device result is never proof of paid or not paid; without a Paymob server confirmation, card stays manual.
- **Q-D** — One merchant account per branch; the relay keyed per (tenant, provider account).
- **Q-E** — Managers (`close-shift-for-others`) resolve unapplied money; `ResolveUnappliedPayment` is in the pilot.
