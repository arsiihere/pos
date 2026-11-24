# 05c — Payments Integration (Paymob SoftPOS; Raast later) — Module Spec v0.2 (DRAFT)

**Owner review (2026-11-24; still DRAFT):** ⚠️ Changed by v0.2 hostile run 2: hostile run 2 (`docs/reviews/05c_v0.2_hostile_run2.md`) is fixed in place, version kept; a targeted re-review of the port, the state machine and §6.3 / §6.4 is owed. ⚠️ Changed by v0.2 owner review (OR-3): **Raast is out of the pilot.** The pilot part is the Paymob SoftPOS card on the 05b tablet (Q-B, Q-C, Q-D, Q-E accepted as recommended); everything Raast (the Bank Alfalah dynamic QR, the PRA code question Q-A, the customer-display Raast QR) is in **§13 Later**. The counter card machine with a typed reference stays the fallback. ⚠️ Changed by v0.2 owner review (OR-4): `payment_unapplied` also reaches the Owner role when no manager is present.

**v0.2 — DRAFT (2026-11-24) — fixes hostile run 1** (`docs/reviews/05c_v0.1_hostile_run1.md`: 3 BLOCKER, 9 MAJOR, 15 MINOR). Pending a re-review in a fresh session and the owner. v0.1 (`05c_Payments_Integration_Spec_v0.1.md`) is kept as history.

This spec was asked for by the 02b-TK hand-off, gap **G-12** (`docs/design/handoff/02b-tk/GAPS.md`; frames `PayNfcTablet`, `PayRaast`, `CustomerDisplayRaast`, `PayError`, `PayCard` in `docs/design/handoff/02b-tk/design/`), and by the 02b-TK owner rulings (`docs/plans/02b-tk-rulings.md`, "Part B … new 05c"). It lifts part of 05 §1.3's out-of-scope line ("Card-terminal or wallet integration and reconciliation (R7, P2) … Raast payment QR (G1-11)") for **two providers only**. Reconciliation stays out. Decision rows are **P1 …**.

**What is known and what is guessed (M-9).** No provider document is in the repo on 2026-11-24. Every provider field is marked **(pending docs)**. The **shape of the port** (§3.4) and of the event payloads (§5.1) is itself a guess: it is the smallest shape that the hub-side rules need. It is **frozen only at STOP-0** (§11), when the first provider document arrives and §3.4 / §5 get a re-review. Nothing whose shape depends on a provider is merged before STOP-0. Events are append-only and migrations are never edited, so a wrong freeze would cost an upcaster.

---

## Changelog

| Version | Date | Change |
|---|---|---|
| v0.1 | 2026-11-24 | First draft |
| **v0.2** | 2026-11-24 | Fixes hostile run 1, mapped below. **Owner decisions** Q-A … Q-E are in §12.3, marked **BLOCKER-for-approval**, each with the recommended default. ⚠️ Changed by v0.2 hostile run 2: hostile run 2 (0 BLOCKER, 7 MAJOR, 17 MINOR) fixed in place, mapped below; version kept |

### Hostile run 1 → resolution

| Finding | Resolution in v0.2 |
|---|---|
| **B-1** "not paid" decided by the device and the clock | **P7 rewritten. Only the provider's server status ends an intent as `failed` ("not charged").** A device result (approved / declined / cancelled / error) only stores a hint and moves the intent to the new open state **`confirming`**. The bill stays held, the worker asks the provider, and the intent ends only on the server's answer. If the server does not answer within the confirm window, the intent ends `expired` with **`outcome: 'unknown'`** and is still watched (P9a). For `device_sdk` intents, `expires_at` is a deadline **for the tap only**; once a tap is reported or the provider says `pending`, the clock never expires the intent (P9). The client never shows "Nothing was charged" except after `PaymentIntentFailed` (§8.5). `ReportPaymentIntentResult` checks that the caller is the intent's device (`403 DEVICE_ACCESS_DENIED`) and runs `billAccess` (§6.3). A late apply ignores the staff hold of P11 (P8). Tests 10a–10e, 15a–15c |
| **B-2** nobody watches an ended intent; a second payment is logged as a duplicate | **P9a watch window.** Every intent that ended without a server-final "not paid" (`cancelled`, `expired`) keeps **`watch_until`** = end + `late_window_ms` (a provider value, pending docs; default 30 min for the Raast QR, which cannot be withdrawn; 10 min for a card). The worker polls it every 15 s until then. **Relay cursor (P14):** the cursor never moves past a `paid` notification whose confirmation is not complete. It stops there, retries next tick, and raises `payment_relay_unhealthy` after 10 min. **Second payment (P6):** a confirmed payment with a **different** `provider_txn_ref` on an intent that already succeeded is recorded as a new provider payment, unapplied with reason `second_payment`, plus an alert. Only an equal ref is a `duplicate`. **New start while the last one is watched:** `409 PAYMENT_INTENT_PENDING { reason: 'previous_watched' }`, which a manager can override (§6.1). Tests 16a–16d, 18a, 21a |
| **B-3** Raast cannot be configured on a PRA branch | **P16 rewritten against the real rule.** On a branch whose adapter is not `none` and where any order type is fiscalized, the billing settings PUT refuses **every active mode without an authority code for that adapter** (`packages/events/src/admin/billing.ts:377-384`). Modes have no order-type field. **So on the `PK-PB` pilot branch, Raast can exist only once PRA gives a `PaymentMode` code (A13).** This applies to a manual Raast mode too. **Raast is now an optional phase (05c-R)** behind STOP-R (§11), decided by owner Q-A. The v0.1 option "(a) Raast on non-fiscalized types only" is removed. Test 6 rewritten |
| M-1 bill scope | `billAccess(…, ['take-payment'])` is the last step of §6.1, §6.2, §6.3 (0 statements: the orders read gives `placed_by`). P5 says why the apply may skip it. Test 9a |
| M-2 hold list incomplete | **P11 rewritten.** 05c registers **one 02b line guard** (covers `RemoveItems`, `CompLine` / `applyComp`, `SetLineWeight`, 04 `VoidItems`, void-preview, 05 `RemoveComp`), **one 02a merge guard** (`MergeTables`, `SplitSeating`), **one 01a day-close guard**, and checks in the **`apply` of the kinds** `discount`, `remove_service_charge`, `reopen_bill` (05) and the 04 void kind. On top come 05's own commands (`AddPayment` / `CloseSplit` on the intent's **split**, `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `ReopenBill` on the bill). v0.1 OQ-4 is deleted. Rows Q-1, T-1, A-2, V-1, B-2, B-3. Tests 24a–24h |
| M-3 provider payment removable | 05 §6.10 rule (row B-6): a payment whose reference has `source = 'provider'` is refused by `RemovePayment` with `409 PAYMENT_PROVIDER_FINAL { payment_id }` (new code). The way back is a portal refund plus a manual `AddPayment { direction: 'out' }`. Test 11a |
| M-4 cloud dedupe / routing keys | The dedupe key is `(tenant_id, provider_key, provider_event_id, outcome)`, never the transaction id alone. A notification carries `intent_id` **or** `provider_intent_ref` (both nullable, a CHECK that one is present). The hub resolves the ref through `payment_intent_provider` (index added). Endpoints and secrets are per **(tenant, provider account)**, the pull is filtered by tenant, and each hub ignores intents it does not own (§5.3, §6.10). Owner Q-D. The verifier signature is `verify({ headers, query, rawBody }, secret)`. Tests 27a–27c |
| M-5 webhook route vs D54 / M55 | New cloud guard scope **`webhook-endpoint`** in `tenant-scope.ts`, with a lookup by `endpoint_id` in `credential-lookup.ts` and then `setTenant`. HPA row H-1 names the pre-tenant index as an M55 (a)-style override. **Foundation rows F-2 / F-3** (§6.4 auth groups: a fifth group `/v1/payments/webhooks/*`; D54 credential types) need a foundation version bump. Foundation v1.18 DRAFT has another writer and is **not edited here**: the rows are written for that writer or for v1.19 (§4.5). Tests 28a, 29a |
| M-6 dead relay / wrong secret invisible | Health per provider = probe **and**, for a provider confirmed only by webhook, a successful relay pull ≤ 30 s ago. The probe runs every 30 s and its result is trusted ≤ 60 s. The cloud counts `401`s per endpoint; 3 in 10 min sets `endpoint_unhealthy`, which the pull returns and the hub turns into the alert `payment_relay_unhealthy`. An Expired panel offers "Customer says paid" (keep watching); a new start is a manager override (B-2). Tests 19a–19c |
| M-7 unapplied money: alert, day close, resolution | The exact 01d declaration is in row D-1 (family `action`, target `managers`, `closes_on: 'owner'`, `expires_at_day_close: true`, raised again at each day open while unresolved). Coordinated with the 01d v1.3.7 writer. New command **`ResolveUnappliedPayment`** → event **`ProviderPaymentResolved`**, which closes the alert and lets 07 subtract. Unapplied money is a **provider payment** row (one intent can have two). The list reads 05c's own `resolved` flag, with a cursor. v0.1 OQ-6 is now Q-E. Tests 16e, 16f |
| M-8 SoftPOS PCI / host app; the page set the amount | Rows T-1, T-2 rewritten. The page passes **`intent_id` only**. Native fetches amount, currency and SDK parameters itself from the device-token query `payment-intent-device` (§6.6b), which answers only the intent's own device. Strict result whitelist `{ outcome, device_txn_ref, error_code }`: no PAN, masked PAN, expiry, name or EMV tag crosses the bridge, is logged or is stored (Gradle test). **X-6 host-app eligibility** (sideloaded, device owner, lock task, WebView, LAN cleartext) must be confirmed **in writing** by Paymob, as STOP-C. Owner Q-B. T-2: Gradle / Maven dependency, repository credentials as a `tablet.yml` CI secret, licence file |
| M-9 the port is fixed before docs | Minimal port (§3.4). STOP-0 freeze with a re-review. 05c-1 keeps only provider-neutral work (§11) |
| m-1 README row | Row M-1 in §4.5 (README not edited here) |
| m-2 stale depends / migration numbers | Depends updated (05 v1.0.35 DRAFT, 01a v2.11 DRAFT, F v1.17 + v1.18 DRAFT, HPA v1.12.4 + v1.13 DRAFT, 01d v1.3.6 + v1.3.7 DRAFT). Migrations are now hub `0030` / `0031` and cloud `0022`, to renumber at build (OQ-7) |
| m-3 counts | §1 and §11 counts fixed |
| m-4 mutation without event; non-rebuildable column | `device_txn_ref` and the hint outcome are declared **hub state** next to `payment_references` (§2). `resolved_alert_id` dropped; `resolved` is folded from `ProviderPaymentResolved` |
| m-5 audit actor; 05 importing 05c | 05 audit map row B-7: `actor_staff_id = taken_by_staff_id` when `actor_id` is null. 05c runs **its own** wiring check (row B-5 deleted) |
| m-6 missing reasons; unique violation aborts | Reasons `day_closed`, `second_payment`, `duplicate_txn` added. The ref is pre-read inside the apply tx (+1 statement); the unique index is the backstop only. Test 26 rewritten |
| m-7 create budget; re-create after a crash | `create` timeout 5 s, budget 20 s. `create` is retried with the same `intent_id`; provider idempotency is listed in X-1 / X-2. Restart test 13a |
| m-8 413; replay; unknown endpoint | A body over 16 KB → `413` is mapped to `400 VALIDATION_FAILED`. When the provider signs a timestamp, a tolerance of ±5 min applies (pending docs). An unknown `endpoint_id` costs one indexed read (accepted; cache deferred) |
| m-9 customer display keeps a payable QR | The panel posts `clear` on leaving the panel or the screen and on `pagehide`; the display clears by itself at `expires_at` |
| m-10 one intent blocks every split | `AddPayment` / `CloseSplit` are held only on the intent's split; `SetSplits`, discount and charge are held bill-wide (P11) |
| m-11 secrets in backups | Stated (P13): USB backups carry `payment_credentials`, as `fiscal_credentials` today (05 B22) |
| m-12 YAGNI | `currencies` removed (the adapter checks the tenant currency itself; one currency per tenant). `environment` lives inside each provider's settings blob, not in the core. `device_types` removed (`device_sdk` ⇒ a tablet with `PosNative`). `fake` exists only in the test harness; client work uses client-side mocks. The pull runs at **one** speed |
| m-13 fiscal gate re-run at apply | The gate result is frozen at start (`PaymentIntentCreated.fiscal_checked`); the apply does not re-run it |
| m-14 missing tests | Added (§10) |
| m-15 unapplied list | Reads 05c's own table, cursor pagination (F §6.3) |
| YAGNI list | `currencies` cut; per-mode `environment` cut from the core; one-speed pull (every 5 s while a webhook provider is configured) |

### Hostile run 2 → resolution

⚠️ Changed by v0.2 hostile run 2, 2026-11-24 (`docs/reviews/05c_v0.2_hostile_run2.md`). Each changed place carries "⚠️ Changed by v0.2 hostile run 2 (<id>)". **OWNER (default written)** marks a recommended default written into the text, pending the owner.

| Finding | Resolution in v0.2 (run 2) |
|---|---|
| **R2-M-1** `pending` ambiguous | Port answer split: `pending` = no attempt known, **`in_progress`** = an authorisation attempt exists (§3.4). Only a device hint or `in_progress` moves `ready` → `confirming`; `pending` in `ready` is a no-op until the tap deadline. `PaymentIntentConfirming.trigger: 'device_hint' \| 'provider_in_progress'`. Relay `in_progress` row added. P9, §3.2, §5.1, §5.3, §6.4; tests 15d, 27a |
| **R2-M-2** server `failed` not order-final; no late payment on `failed` | §3.4 port contract: `failed` / `expired` mean the provider guarantees the intent can no longer be paid; a per-transaction decline maps to `in_progress` / `pending` (X-2 question). A relayed `failed` / `expired` on a `has_status` provider triggers a status call and never ends the intent by itself. `after_state` gains `'failed'`; a late `paid` on a failed intent goes through the normal apply. P9's "the watch covers it" replaced by "a `device_sdk` intent that never reached `ready` cannot be paid". P7, P9, §3.2, §3.4, §3.7, §5.1, §6.4, §7.3; tests 16g, 16h |
| **R2-M-3** late device report dropped | §6.3: a report on a **watched** intent stores the hint and `device_txn_ref` (hub state, no event) and wakes the worker for an immediate status; answer stays `{ state }`. Only `succeeded` and unwatched ended intents are no-write. Test 10f |
| **R2-M-4** relay "not ours" drops a lost intent's money | `branch_id` (nullable = tenant-wide account) on `payment_webhook_endpoints`, copied onto `payment_notifications`; the pull returns the key's branch rows plus null-branch rows. A `paid` row of this branch whose intent is unknown is recorded in hub state `payment_relay_unknown` and raises `payment_relay_unhealthy { reason: 'unknown_intent' }`; never skipped. Only another branch's rows are skipped; on a tenant-wide account an unknown intent cannot be told from another branch's and is skipped and logged (residual, accepted by Q-D's per-branch default). P14, §4.5 D-2, §5.2, §5.3, §6.4, §6.11; tests 18, 18b, 27c |
| **R2-M-5** card machine / cash charge again while unknown | **OWNER (default written):** 05 `AddPayment { direction: 'in' }` on **any mode** on the intent's split is held while an intent is open (as before) **or watched** → `409 PAYMENT_INTENT_PENDING { reason: 'previous_watched' }`; a holder of `close-shift-for-others` may override with `override_watched: true`, recorded in the payment (`PaymentAdded.overrides_intent_id`, 05 row B-2). P9a, P11, §4.5 B-2, §7.1, §8.5; tests 24e, 9b |
| **R2-M-6** build before the condition that decides card-on-tablet | **OWNER (default written):** STOP-0 = the Paymob document (X-2) **and** Paymob's written host-app eligibility (X-6) **and** a proven server confirmation path (inquiry or callback, Q-C). Before STOP-0 only provider-neutral pure rules (task 3) and client mocks (task 4) are built. Moved behind STOP-0 because a "no" would leave them dead: the §9 codes in `errors.ts`, permission `manage-payment-providers`, alert kinds `payment_unapplied` / `payment_relay_unhealthy`, hub migration `0030` (row B-4), 05 rows B-6 / B-7. §1, §4.4, §4.5 B-4, §5.2, §7.3, §11 |
| **R2-M-7** F v1.18 / HPA v1.13 carry 05c rows as normative | §4.5 heading: rows F-1 – F-3 and H-1 – H-3 are **carried when 05c is approved**. F v1.18 (F-10, F-11, the F-12(b) 05c codes) and 00 HPA v1.13 (H-13 – H-15) must mark them "**carried when 05c is approved**" (the 05 v1.0.35 form) and re-letter the new M55 item **(g)**; those specs are not edited here (other writers) |
| R2-m-1 | Raast / QR words reworded for card (§1 Tier, P6, §6.4 `creating`, §12.6, OQ-5); README row without STOP-R; one tap deadline source: port `timings.tap_window_ms` (was `display_ttl_ms`), P9 `expires_at = ready_at + tap_window_ms` |
| R2-m-2 | `display` dropped from the port, `display_kind` from `PaymentIntentCreated`, `payment_intents` and §6.1's result; "a `device_sdk` intent" = every pilot intent (§3.4); §13 adds them back |
| R2-m-3 | Separate-app branch deleted (§3.7, N-1): a separate app = Q-B "no" = no 05c-C |
| R2-m-4 | §12.3 heading "answered"; STOP-C wording; §1 Depends v1.19 clause dropped |
| R2-m-5 | `Confirming` fold sets `expires_at = event time + confirm_window_ms`; one rule "open + `expires_at ≤ now`" |
| R2-m-6 | New event `PaymentIntentWatchEnded { intent_id, outcome: 'not_paid' \| 'no_answer' }` clears `watch_until` (server-final not paid, or the last status call at `watch_until`). P9a, §5.1, §6.4; test 16i |
| R2-m-7 | Cancel from `creating` → `watch_until: null` (§6.2); test 9 |
| R2-m-8 | §8.4: on `Cancelled` / `Expired` / `Failed` of its own intent the tablet page calls `cancelCardPayment` |
| R2-m-9 | Health row: pull failing > 2 min → `payment_relay_unhealthy { pull_failing }`; test 19d |
| R2-m-10 | D-1 gains `dedupe_key = 'payment_unapplied:' + provider_payment_id` and no `link` (as 01d v1.3.7); §8 item 7 no longer says the alert taps into the list |
| R2-m-11 | `applied_to_bill`: same `bill_id`, equal amount, `payment_id` not used by another resolution (`provider_payments.resolved_payment_id`, unique partial index); test 16e |
| R2-m-12 | "Ten events (nine on the bill stream, one hub)" (count includes R2-m-6's event) in §1, §4.3, §12.6 |
| R2-m-13 | DoD: relay tests only "when the relay ships"; test 30b (Paymob status fixtures → port outcomes) |
| R2-m-14 | §7.1: LAN cleartext residual stated as accepted (O-14 form); X-2 question: the charged amount comes from the provider's server-side order, the device amount is display only |
| R2-m-15 | R-1: the Owner default holds `manage-payment-providers` and `close-shift-for-others`; §8 item 7: a recipient without `close-shift-for-others` sees the card only |
| R2-m-16 | Two lists `?state=unresolved \| resolved`, each on its own index, cursor `(recorded_at, provider_payment_id)` |
| R2-m-17 | P16: the owner gives the bound card mode the PRA code `2` (05 Appendix P mapping), not a seeded mode |

### Integration pass (02b-TK cross-spec rows)

⚠️ Changed by v0.2 (integration, 02b-TK), 2026-11-24; still DRAFT (v0.1 kept). The rows other drafts carry for 05c, and what 05c copies back:

| Source / target row | Change here | Where |
|---|---|---|
| 01d v1.3.7 To 05c deviations 1, 2 (owner decision **Q-37e**) | `payment_unapplied`: the lock shows the **kind label only** (`display: { kind_label_key }`, 01d §3.12: no amount on a lock); amount, provider and reference last 4 go into 01d's existing detail fields: `details_schema = AlertDetailsBase.pick({ identifier: true, amount: true, problem: true })` with `identifier` = the token (or the bill), `amount` = the paid amount, `problem` = provider + reference last 4 (≤ 40). The extra `details` fields `ref_last4` and `token` are dropped (`AlertRaised` v5's frozen base would strip them) | §4.5 D-1 |
| 01d v1.3.7 D-1, D-2 | Step target written `{ target: { kind: 'managers' }, set: 'recipient' }` (01d's `AlertTargetSchema` form, as 01d v1.3.7 To 05c and 03c G-14; was the bare string `'managers'`) in D-1 and D-2. Checked: both kinds there as declared here (family `action`, `managers`, `closes_on: 'owner'`, `expires_at_day_close: true`, re-raised after each `BusinessDayOpened`, closed by 05c; same `values_schema`; `payment_relay_unhealthy` reasons `signature_failures` / `confirm_stuck` / `pull_failing`; `details_schema: null`) | §4.5 D-1, D-2 |
| Foundation v1.18 F-10, F-11 | Rows F-2, F-3 are folded into F v1.18 (not v1.19); F-1: the §9 codes are appended to F v1.18 §6.2 | Depends on, §4.5 F-1 – F-3 |
| 00 HPA v1.13 H-13 – H-15 | Rows H-1 – H-3 are folded into 00 HPA v1.13 | §4.5 H-1 – H-3 |
| 05 v1.0.35 §4.5 rows 05c-B-1 … 05c-B-7 | Rows B-1 – B-4, B-6, B-7 are listed in 05 as **carried when 05c is approved** (no 05c behaviour in 05 v1.0.35) | §4.5 B-1 – B-7 |
| README module map row M-1 | Row `05c Payments integration` added (v0.2 DRAFT); v0.1 kept | §4.5 M-1 |
| Migration numbers (README "Migration numbers") | Every number in §5 is provisional: hub and cloud files take the **next free number at merge** (02b-TK's `NNNN_orders_takeaway`, 00 HPA's `00NN_display_sessions` and 08's drafts are unnumbered until then) | §5 intro, §4.5 B-4, OQ-7 |

### Owner review of the 02b-TK Part B package (24 Nov 2026)

⚠️ Changed by v0.2 owner review, 2026-11-24; still DRAFT (hostile run 2 owed).

| Row | Owner answer | Change here | Where |
|---|---|---|---|
| OR-3 (Q-A; frames `PayRaast`, `CustomerDisplayRaast`) | **Raast is OUT of the pilot.** Keep the Paymob SoftPOS card part; move everything Raast (Alfalah dynamic QR, PRA code Q-A, the customer-display Raast QR) to a "Later" section; the card machine with a manual reference stays the fallback | The pilot has one provider, `paymob_softpos` (`display: 'device_sdk'`). Moved to **§13 Later**: the `alfalah_raast` adapter (old §3.6), the `qr` display path (P9 QR deadline, P10 QR display, §6.4 QR deadline, §6.6 `display`), the Raast and customer-display panels (old §8.2, §8.3), P16's Raast rule, X-1, X-4, Q-A, phase 05c-R, tests 31, 36 and the Raast halves of tests 6, 10d, 15a | header, §1, §3.1 P2, P9, P9a, P10, P16, P17, §3.2, §3.4, §3.6, §5.1, §5.2, §6.1, §6.3, §6.4, §6.6, §7.3, §8, §10, §11, §12, §13 |
| Q-B, Q-C, Q-D | **Accepted** as recommended (Paymob only if it confirms the 05b host in writing; a device result is never proof; one merchant account per branch, relay keyed per tenant account) | §12.3 marked | §12.3 |
| OR-4 (Q-E, 01d Q-37f) | Q-E **accepted** (managers resolve; `ResolveUnappliedPayment` in the pilot) **and** `payment_unapplied` with no manager present also goes to the **Owner role** | Row D-1: step 0 adds the 01d `when_none` entry to `manage-payment-providers` holders (Owner only by default, row R-1) | §4.5 D-1, §12.3 Q-E |


---

## §1. Header

| Field | Value |
|---|---|
| Module | 05c Payments integration: a **payment provider port**; a **PaymentIntent** lifecycle on the hub whose server-confirmed success appends 05's `PaymentAdded` by itself, with the provider reference; a **watch window** for late money; **unapplied-payment** handling; a **cloud webhook relay** that the hub pulls; hub-side polling of the provider. Adapters: `fake` (tests), `paymob_softpos` (card by NFC on the 05b tablet). ~~`alfalah_raast` (Raast P2M dynamic QR, optional phase)~~ ⚠️ Changed by v0.2 owner review (OR-3): Raast is §13 Later |
| Version | **v0.2 — DRAFT** (2026-11-24), fixes hostile run 1 |
| Depends on | Foundation **v1.17** (§6 Shared Standards) and **v1.18 DRAFT** (another writer; ⚠️ Changed by v0.2 (integration, 02b-TK): rows F-2, F-3 folded into F v1.18 as its rows F-10, F-11; ⚠️ Changed by v0.2 hostile run 2 (R2-m-4, R2-M-7): no v1.19 clause; carried when 05c is approved, §4.5). 00 HPA **v1.12.4** (§3.7 pipeline, synchronous `handle`, after-commit hooks; D54, M55 credential types) and **v1.13 DRAFT**. 01a **v2.11 DRAFT** (billing settings document, `billingSettingsReferenceIssue`, `registerDayCloseGuard`). 01b **v1.11**. 01d **v1.3.6** and **v1.3.7 DRAFT** (`defineAlertKind`, row D-1). 02a **v1.1.11** (`registerMergeGuard`). 02b **v1.0.25 DRAFT** (`registerLineGuard`, §3.4 / §4.2). 04 **v1.0.8** (void kind, line guard order). **05 v1.0.35 DRAFT** (§3.5 dues, §3.7, §6.9, §6.10, B10, B11, B22, B30, §3.15 worker pattern, Appendix P P.2 / P.6 A13, row A-1 (3)). **05b v1.0.1** (`PosNative`, §3.6 guards, M-14, M-17, H-3, O-14) |
| Inherits | **Shared Standards from Foundation v1.17 §6**, unchanged except the cloud auth group of rows F-2 / F-3 |
| Changes other specs | 05 (B-1 … B-7), 02b (Q-1), 02a (T-1), 01a (A-1, A-2), 04 (V-1), 01b (R-1), 01d (D-1, D-2), 00 HPA (H-1 … H-3), 05b → v1.1 (N-1, N-2), Foundation (F-1 append; F-2, F-3 bump), README (M-1). Full list §4.5 |
| Tier | **T2 Production** (CLAUDE.md). Real races: a webhook and a poll confirming the same payment; a bill changing while the customer taps (⚠️ Changed by v0.2 hostile run 2 (R2-m-1)); a cancel crossing a late success; a card authorisation whose result the device does not know. Money is taken by a third party, so every success lands **exactly once** and a "not paid" is never assumed |
| Milestone | A (pilot, 2027-02-28) **only for the parts whose STOPs clear in time** (§11: STOP-0, STOP-C card). **Fallback:** card stays a manual mode with a typed reference, as 05 v1.0.35 today (`PayCard` frame, counter card machine). ⚠️ Changed by v0.2 owner review (OR-3): **no Raast at the pilot** (§13; on `PK-PB` it also needs a PRA code first, B-3) |
| Build split | **05c-1** provider-neutral pure rules and client mocks, buildable now (⚠️ Changed by v0.2 hostile run 2 (R2-M-6): no code, permission, alert kind, migration or 05 change before STOP-0). **05c-2** core (codes, permission, alert kinds, `source` column, port, intents, worker, guards, queries, resolution) after STOP-0 (⚠️ Changed by v0.2 hostile run 2 (R2-M-6): STOP-0 = X-2 + X-6 + a server confirmation path). **05c-C** card (`paymob_softpos` + 05b plugin) after STOP-C. ~~**05c-R** Raast (`alfalah_raast` + customer display), optional, after STOP-R~~ (⚠️ Changed by v0.2 owner review (OR-3): §13 Later). The **cloud relay** ships with Paymob if it confirms by webhook (pending docs) |

### Stories covered

| Source | Item | How |
|---|---|---|
| G-12 | Card by NFC on the tablet (Paymob): "Tap the card on the back of this tablet … waiting for card" (`PayNfcTablet`) | P3, P7, §3.7, §6.1, §6.3, §8.4, rows N-1 / N-2 |
| G-12 | Dynamic Raast QR that "closes by itself when paid", "Also on the customer screen" (`PayRaast`, `CustomerDisplayRaast`) | ⚠️ Changed by v0.2 owner review (OR-3): **Later** (§13) |
| G-12 | Failure: "Payment didn't go through. Nothing was charged. Try again or choose another way", with the provider code (`PayError`) | §8.5: only after a **server** failure (B-1) |
| G-12 | Automatic `AddPayment` with the provider reference | P5, row B-1 |
| G-13 | Cash while the hub is offline | **Not changed** (P12) |
| G-14 | The counter-facing customer display shows the Raast QR state | ⚠️ Changed by v0.2 owner review (OR-3): **Later** (§13) |

### In scope
- Hub: provider port + registry; adapters `fake`, `paymob_softpos` (⚠️ Changed by v0.2 owner review (OR-3): `alfalah_raast` is §13). **Four device commands** (`StartPaymentIntent`, `CancelPaymentIntent`, `ReportPaymentIntentResult`, `ResolveUnappliedPayment`) and **one admin command** (`SetPaymentCredential`). **Four queries** (`payment-intents`, `payment-intent`, `payment-intent-device`, `unapplied-payments`) and **one admin query** (`payment-credentials`). A **payments worker** (create, poll, expire, watch, apply, relay pull, health). **Ten events** (nine on the bill stream, one hub; ⚠️ Changed by v0.2 hostile run 2 (R2-m-12, R2-m-6)). Guards (P11).
- Cloud: a public webhook route (new guard scope), a pull route on the branch API key, owner routes to set and list webhook endpoints.
- Tablet (05b): card-payment methods on `PosNative`, `native_api` 1 → 2.
- Client: the Card (tablet) panel (⚠️ Changed by v0.2 owner review (OR-3): the Raast QR panel and the customer-display QR are §13), the failure / unknown panels, the manager's unapplied list and resolve sheet, the hub admin credentials form, owner-app provider fields.

### Out of scope
- **Reconciliation** with provider settlement reports, chargebacks, fees (R7 P2).
- **Refunds through a provider** (`direction: 'out'` stays manual) → §12.4.
- Providers other than Paymob (⚠️ Changed by v0.2 owner review (OR-3): Bank Alfalah Raast is §13 Later); external card terminals (ECR link); JazzCash / EasyPaisa direct.
- Cash or any payment while the hub is unreachable (G-13).
- Payment links for phone orders; a customer-facing payment page.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Commands: `POST /commands/<name>`, `defineCommand`, one writer transaction, `handle` **synchronous**, async work only before the writer or after commit; `command_id` idempotency; money commands **never queueable** | F §6.3; 00 §3.7; 05 §6 header (G0-1) |
| "The hub has no remote dependency on its request path" | F §6.2 status map (503 row) |
| `PaymentAdded { payment_id, bill_id, split_no, mode_id, payment_class, direction, amount_minor, tendered_minor, change_minor, has_reference, taken_by_staff_id, shift_id }`. The reference text lives only in hub table `payment_references`, never in an event (B10, B30) | 05 §6.9; `apps/hub/src/billing/commands/payments.ts:45-60` |
| Every `in` ≤ its due field (`card_due` for a digital mode); money shift per B11; bill scope last (`billAccess`, C8) | 05 §3.7, §6.9; `payments.ts:150` |
| Fiscal gate at `AddPayment` (`422 PAYMENT_MODE_NOT_FISCAL`) | 05 §6.9; `payments.ts:108-114` |
| **Settings rule:** on a branch whose adapter is not `none` and with any order type fiscalized, every **active** mode needs an authority code for that adapter, else the PUT answers `422 CONFIG_REFERENCE_INVALID { field: 'payment_modes.N.authority_codes' }`. Modes have no order-type field | 05 row A-1 (3); `packages/events/src/admin/billing.ts:377-384` |
| Payment modes are owner data: `{ mode_id, name, kind ∈ cash\|card\|wallet\|online\|other, payment_class, reference_required, is_active, sort_order, authority_codes[{ adapter_key, code }] }`; the seed has cash only | `billing.ts:59-68`; 01a §5.2b |
| Ordered guard lists: 02b `registerLineGuard` (04 first, then 05, by registration order; asked once per line-changing command), 02a `registerMergeGuard`, 01a `registerDayCloseGuard` | `apps/hub/src/orders/line-guard.ts`, `tables/merge-guard.ts`, `commands/close-business-day.ts` |
| Remote calls go through a worker: the fiscal outbox worker posts outside any request and appends its answer as a system event (`actor_id null`, `device_id 'hub'`) | 05 §3.15; `billing/fiscal/worker.ts` |
| Hub secrets: write-only admin command, hub-only table, never synced / logged / returned / in an event; carried by the USB backup | 05 B22, §6.28a |
| **Hub state that is not an event** (accepted, like `payment_references` and the fiscal outbox's worker columns): provider data of an intent (`payment_intent_provider`: display data, provider refs, the device's hint and its outcome, attempts), the relay cursor and relay-pending rows, ⚠️ Changed by v0.2 hostile run 2 (R2-M-4): the unknown-intent relay rows (`payment_relay_unknown`), credentials | 05 B30 precedent; review m-4 |
| Cloud tenant scope: guard scopes `jwt \| branch-key \| registration-code \| none`; credential lookups only in `db/credential-lookup.ts`, importable only by the guard plugins (M55 (b)); allowlist `TENANT_SCOPE_ALLOWLIST` | 00 D54, M55; `apps/cloud/src/plugins/tenant-scope.ts:9-17` |
| The hub is LAN-only (no inbound internet) and calls out | 00 §3.1; 05 K-16 |
| Hub tests never reach a cloud host | `apps/hub/test/no-cloud-network.int.test.ts` |
| Tablet native code = `PosNative` + `AlertService`; per-method guards; `native_api` = 1; LAN cleartext (H-3); device owner + lock task (M-17); LAN script injection accepted (O-14) | 05b §3.6, §4.2 |
| Hub module folders follow `apps/hub/src/<module>/` (`billing/`, `voids/`): 05c is `apps/hub/src/payments/` | F §6.9 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| P1 | **Minimal provider port** (§3.4), registered at startup by key. The `fake` adapter is registered **only** by the test harness, never by `server.ts`; client work uses client-side mocks. The core never branches on a provider key. **The port shape is a guess, frozen at STOP-0** | Provider differences in one place; tests with no network | — |
| P2 | **Mode → provider binding is owner data.** `PaymentMode` gains optional `provider: { provider_key, settings } \| null` (default `null` = manual mode, as today). Allowed only on `payment_class = 'digital'` and a kind the provider accepts (`paymob_softpos`: `card`; ⚠️ Changed by v0.2 owner review (OR-3): `alfalah_raast` (`online` / `wallet`) is §13). `settings` follows the provider's `settingsSchema` (never a secret; holds the provider's environment and account ids). At most one bound mode per provider per branch. Checked by the cloud PUT (row A-1) and again by the hub at use | Modes are data (05 B10, K-7) | 01a row A-1 |
| P3 | **A PaymentIntent** is the hub's record of "this split waits for this much money from this provider". **Open** states: `creating`, `ready`, `confirming`. **Ended** states: `succeeded`, `failed` (server-final, not paid), `expired`, `cancelled`. At most one open intent per bill (`409 PAYMENT_INTENT_PENDING`). Stream `bill`, `stream_id` = `bill_id` | One customer pays at a time; the bill stream carries the money facts | — |
| P4 | **Amount bound at start.** `amount_minor` is optional; absent = the split's `card_due_minor` now (05 §3.5 (7)). Present: 1 … `card_due_minor`; `card_due = 0` or above it → `422 PAYMENT_EXCEEDS_BALANCE { balance_minor }`. Frozen on the intent, sent to the provider, never changed. A partial amount (rest in cash) is allowed | One fixed amount the customer sees and pays | — |
| P5 | **Success = 05's own payment, appended by the worker.** In one writer transaction the worker re-reads the intent and calls 05's `providerPaymentDrafts(tx, …)` (row B-1). It runs `AddPayment`'s money checks (split open, mode still active, `in` ≤ `card_due`). It does **not** re-run session, permission, scope (checked at start, M-1), shift resolution (frozen at start), the fiscal gate (frozen at start, m-13) or P11's staff hold. It returns `PaymentAdded` with `taken_by_staff_id` = `started_by_staff_id`, `shift_id` = the frozen shift, `has_reference: true`; the provider's transaction ref goes to `payment_references` with `source = 'provider'` (row B-4). Envelope `actor_id null`, `device_id 'hub'`; 05's audit shows `taken_by` as the actor (row B-7) | The starter took the payment (B11); one code path for the money rules | 05 §6.9 (B-1) |
| P6 | **Exactly once, and a second payment is never lost.** Every confirmed provider payment is a **provider payment** (`provider_payments` row, §5.2) keyed by `provider_txn_ref`. Inside the apply tx the worker pre-reads the ref (1 statement): **same ref already recorded → `duplicate`, no-op** (logged). A **different** ref on an intent that already has an applied payment → a new provider payment, unapplied `second_payment`, plus an alert. A ref already recorded on **another** intent → unapplied `duplicate_txn`, plus an alert. The unique index on the ref is the backstop only. The cloud dedupes on `(tenant_id, provider_key, provider_event_id, outcome)`. Provider-side `create` uses `intent_id` as merchant reference / idempotency key (pending docs, X-1 / X-2) | Webhooks and polls both arrive; a card order may hold two transactions (⚠️ Changed by v0.2 hostile run 2 (R2-m-1)) | — |
| P7 | **Proof, both ways.** *Paid* = the provider's **server** status `paid` for this intent, or a relayed notification whose signature the cloud checked **plus**, where the provider has a status query, a confirming status call. ***Not paid* = only the provider's server** (status `failed` or `expired`, or `create` `rejected`). ⚠️ Changed by v0.2 hostile run 2 (R2-M-2): `failed` / `expired` mean **the provider guarantees this intent can no longer be paid** (§3.4); a relayed `failed` / `expired` on a provider with `has_status` triggers a status call and never ends the intent by itself. **A device result is never proof of either.** `approved` / `declined` / `cancelled` / `error` from the tablet store a hint, move the intent to `confirming` (still open, bill still held) and wake the worker. Amount or currency ≠ the intent's → unapplied `amount_mismatch` | A forged result must not create money; an SDK `error` after a card read may still be an authorised charge | — |
| P8 | **Late or unapplicable success.** A confirmed payment that cannot be applied is still recorded: `PaymentIntentSucceeded { applied: false, provider_payment_id, unapplied_reason }`, plus the 01d alert **`payment_unapplied`** (row D-1). Reasons: `split_closed`, `bill_not_open`, `exceeds_due`, `shift_closed`, `mode_inactive`, `day_closed`, `amount_mismatch`, `second_payment`, `duplicate_txn`. Nothing is added to any bill. A late success **is** applied when the split is open and the amount fits, **even while a newer intent holds the bill** (P11 is a staff hold, not a money rule). A manager resolves an unapplied payment with `ResolveUnappliedPayment` (§6.7): `applied_to_bill` (the money was entered by hand with that reference), `refunded` (portal refund done) or `kept` (note required) → `ProviderPaymentResolved`, which closes the alert | Paid money is never silently lost; 05's balance rule is never broken | — |
| P9 | **Deadlines.** `creating`: the provider must accept within **20 s** (5 s timeout per call, backoff 1 s / 2 s / 4 s), else `PaymentIntentFailed { reason: 'provider_unreachable' }` (not paid: ~~If the provider created it after all, the watch of P9a covers it~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-2): a `device_sdk` intent that never reached `ready` cannot be paid, because no device ever received SDK parameters). ~~`qr` intents: …~~ (⚠️ Changed by v0.2 owner review (OR-3): the QR deadline is §13). `device_sdk` intents: `expires_at = ready_at + tap_window_ms` (default 120 s; ⚠️ Changed by v0.2 hostile run 2 (R2-m-1): the port's `timings.tap_window_ms` is the one source, was `display_ttl_ms`) is a deadline **for the tap**. At the tap deadline with no tap reported: one final status call — server `expired` / `failed` → `PaymentIntentExpired { outcome: 'not_paid' }`; `pending` / no answer → `PaymentIntentExpired { outcome: 'unknown' }` (⚠️ Changed by v0.2 owner review (OR-3): stated here, was by reference to the QR rule). Once the device reports a result or the provider reports `in_progress` (⚠️ Changed by v0.2 hostile run 2 (R2-M-1): was `pending`; a `pending` in `ready` changes nothing until the tap deadline), the clock no longer ends the intent: it stays `confirming` until the server answers, or until a **confirm window** of 90 s (pending docs) ends it `expired { outcome: 'unknown' }` (`expires_at` = the `Confirming` time + `confirm_window_ms`, ⚠️ Changed by v0.2 hostile run 2 (R2-m-5)) | The counter must not wait for ever, but "unknown" is never shown as "not paid" | — |
| P9a | **Watch window.** An intent that ended as `cancelled` or `expired` with `outcome ≠ 'not_paid'` (a cancel after `creating` never knows; ⚠️ Changed by v0.2 hostile run 2 (R2-m-7): a cancel in `creating` is not watched) keeps `watch_until = ended_at + late_window_ms` (provider value, pending docs; default 10 min `paymob_softpos`; ⚠️ Changed by v0.2 owner review (OR-3): the 30 min Raast default is §13). The worker polls it every 15 s until then, then makes a last status call. ⚠️ Changed by v0.2 hostile run 2 (R2-m-6): the watch ends with `PaymentIntentWatchEnded { intent_id, outcome }` (clears `watch_until`): `not_paid` as soon as the server says `failed` / `expired`, `no_answer` after the last status call at `watch_until`. A new `StartPaymentIntent` on that bill while a previous intent is watched → `409 PAYMENT_INTENT_PENDING { intent_id, reason: 'previous_watched' }`. A holder of **`close-shift-for-others`** may override with `override_watched: true`, recorded as `PaymentIntentCreated.overrides_intent_id`. ⚠️ Changed by v0.2 hostile run 2 (R2-M-5) — **OWNER (default written):** the same hold covers a manual payment: 05 `AddPayment { direction: 'in' }` on **any mode** (card machine, cash, …) on the intent's split while it is watched → `409 PAYMENT_INTENT_PENDING { intent_id, reason: 'previous_watched' }`; a holder of `close-shift-for-others` may override with `AddPayment.override_watched: true`, recorded in the payment (`PaymentAdded.overrides_intent_id`, row B-2). The alternative (accept the double charge and refund it) is not taken | A customer who scanned before the cancel may still pay; a manager decides to charge again | — |
| P10 | **Display.** `ready` makes the SDK parameters readable **only** by the intent's own device through `payment-intent-device` (§6.6b, device token, read by native). Display data lives only in `payment_intent_provider`. ⚠️ Changed by v0.2 owner review (OR-3): the QR display (payload + SVG through `payment-intent`, the customer display over `BroadcastChannel`, G-14) is §13 | SDK parameters may be bearer tokens (pending docs) | — |
| P11 | **Staff hold while an intent is open** (`creating`, `ready`, `confirming`): `409 PAYMENT_INTENT_PENDING { intent_id }` from **(a)** one 02b **line guard**, which blocks every line change on the bill's orders (`RemoveItems`, `CompLine` / `applyComp`, `SetLineWeight`, 04 `VoidItems`, void-preview, 05 `RemoveComp`), row Q-1; **(b)** one 02a **merge guard** (`MergeTables`, `SplitSeating` touching the bill's seating or orders), row T-1; **(c)** one 01a **day-close guard** (any open intent), row A-2; **(d)** the `apply` of the approval kinds `discount`, `remove_service_charge`, `reopen_bill` (05, row B-3) and the 04 void kind (row V-1): an approval answered while the bill is held is **refused** with the same code (the request stays pending; the approver retries); **(e)** 05 commands: `AddPayment` and `CloseSplit` on the **intent's split**; `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `ReopenBill` on the bill (row B-2); `CountShift` / `CloseShift` of the intent's frozen shift (row B-2). New items (`SubmitOrder` adding to the bill), `RemovePayment` of a staff payment and `RemoveDiscount` are not held. A watched (ended) intent holds only a new start and a manual `in` payment on its split (P9a; ⚠️ Changed by v0.2 hostile run 2 (R2-M-5)) | The customer pays a fixed amount; the bill must not move under it. The guard lists already exist (review M-2) | 02b, 02a, 01a, 04, 05 rows |
| P12 | **Online only.** Every 05c command needs the hub (not queueable). A start is refused when the provider is unhealthy **as last recorded** (`409 PAYMENT_PROVIDER_UNAVAILABLE { reason: 'failing' }`, from the worker's health record, §6.5; no remote call on the request path). No intent and no cash while the hub is unreachable (G-13) | F §6.2; G-13 | — |
| P13 | **Credentials.** Provider API secrets are hub secrets: `SetPaymentCredential` (admin session, new permission **`manage-payment-providers`**, Owner only by default, row R-1), write-only, table `payment_credentials`, never synced, logged, returned or in an event (audit event `PaymentCredentialSet` holds `provider_key`, `name`). **USB backups carry this table**, as they carry `fiscal_credentials` (05 B22; F D53 note in row F-2). The webhook signing secret lives only in the cloud (`payment_webhook_endpoints`, owner route, write-only) | As fiscal tokens | — |
| P14 | **Cloud relay, pulled by the hub.** Providers post to `POST /v1/payments/webhooks/:endpoint_id` (cloud). The endpoint maps to **(tenant, provider_key, account label)** (Q-D). The cloud checks the signature, extracts only the §5.3 fields, stores one row and answers 200. The hub pulls `GET /v1/sync/payment-notifications?after=` on its branch API key, **every 5 s while any bound mode's provider has `webhook`**. ~~It gets its **tenant's** rows and ignores the intents it does not own.~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-4): it gets the rows of **its branch** and of tenant-wide accounts (`branch_id` null). A row of another branch is skipped. A `paid` row of its branch whose intent it does not find (a hub restored from backup, a ref before its Ready tx) is **never skipped**: it is kept in hub state `payment_relay_unknown` and raises `payment_relay_unhealthy { reason: 'unknown_intent' }`. On a tenant-wide account an unknown intent cannot be told from another branch's: skipped and logged (residual; the pilot default is per-branch accounts, Q-D). **The cursor never moves past a `paid` row whose confirmation (P7) is not complete**: the pull stops there and retries next tick; after 10 min stuck → alert `payment_relay_unhealthy { reason: 'confirm_stuck' }`. No cloud → hub push channel | The hub is LAN-only; 06 is not built; a lost notification is lost money | — |
| P15 | **Hub polling.** The worker calls `status` (if the provider has it) every 3 s for open intents and every 15 s for watched intents, and at once after a relay row or a device hint. A provider with neither a status query nor a webhook cannot be registered (startup error) | Works when the relay is down | — |
| P16 | **PRA / A13.** ⚠️ Changed by v0.2 owner review (OR-3): the pilot's only provider mode is the Paymob **card** mode, ~~which carries the seeded PRA card code `2`~~ ⚠️ Changed by v0.2 hostile run 2 (R2-m-17): the owner gives the bound card mode `authority_codes [{ adapter_key: 'PRA', code: '2' }]` on `PK-PB` (code `2` is 05 Appendix P's PRA card mapping, not a seeded mode; required by the settings rule of §2). `StartPaymentIntent` still runs the fiscal gate (defence in depth for a code removed later, test 6). **05c never invents or reuses a code.** Raast's PRA problem (no `PaymentMode` code for Raast / QR, A13) is §13 | A wrong `PaymentMode` code is a fiscal misreport; R37 keeps PRA live | — |
| P17 | **Words.** Core text says provider, intent, provider payment, provider reference. "Paymob", "SoftPOS" appear only in §3.7, the adapter files and the settings (⚠️ Changed by v0.2 owner review (OR-3): "Alfalah", "Raast", "P2M" only in §13) | As 05 B32 | — |

### 3.2 State machine

```
StartPaymentIntent ─► creating ──(provider create ok)──► ready ──(device hint, or provider 'in_progress' (R2-M-1))──► confirming
                         │                                 │                                                        │
       create rejected / │ no answer in 20 s               │ server paid ─► SUCCEEDED (applied | unapplied)        │ server paid ─► SUCCEEDED
                         ▼                                 │ server failed ─► FAILED (not paid)                    │ server failed / expired ─► FAILED / EXPIRED{not_paid}
                       FAILED                              │ (qr deadline: §13 Later, OR-3)
                                                           │ sdk: tap deadline, no tap ─► EXPIRED{not_paid|unknown}│ confirm window over ─► EXPIRED{unknown}
                                                           │ CancelPaymentIntent ─► CANCELLED                       │ (no cancel by staff while confirming)
   ended, outcome ≠ not_paid ─► watched until watch_until ─► late server paid ─► SUCCEEDED (applied if P8 allows)
   SUCCEEDED ─► a different provider ref confirmed ─► second provider payment (unapplied 'second_payment')
   watched ─► server failed / expired, or last status at watch_until ─► WatchEnded{not_paid|no_answer} (R2-m-6)
   FAILED ─► a late server-confirmed paid (relay) ─► SUCCEEDED (after_state 'failed'; R2-M-2)
```

- `CancelPaymentIntent` is allowed in `creating` and `ready`, never in `confirming` (a card was read; only the server decides).
- `failed` is the only state the client may call "not charged".
- ⚠️ Changed by v0.2 hostile run 2 (R2-M-1): a provider `pending` in `ready` keeps `ready` (Cancel still allowed) until the tap deadline; only a device hint or `in_progress` moves it to `confirming`.

### 3.3 Command processing order

payload Zod (`400`) → session + permission (pipeline, `403`) → ensure bill / intent read (`404`) → device check where stated (`403 DEVICE_ACCESS_DENIED`) → state rules (`409`) → mode / provider (`404` / `422` / `409`) → fiscal gate (`422`) → shift (`409`) → money (`422`) → scope last (`billAccess`, `403`, C8) → append (one writer tx; projections fold live) → result → after commit: wake the worker. A retransmit by `command_id` returns the stored result.

### 3.4 Port contract — **a guess, frozen at STOP-0** (`apps/hub/src/payments/port.ts`)

```ts
export interface PaymentProvider {
  key: string;                                   // 'fake' | 'paymob_softpos' (OR-3: 'alfalah_raast' is §13 Later)
  // R2-m-2: no `display` field in the pilot; every pilot provider is a tablet SDK (PosNative, native_api ≥ 2); §13 adds it
  has_status: boolean; has_webhook: boolean;     // at least one true (startup check)
  timings: { tap_window_ms: number; confirm_window_ms: number; late_window_ms: number };   // P9, P9a (pending docs); R2-m-1: was display_ttl_ms
  accepts_kinds: 'card'[];                       // OR-3: 'wallet' | 'online' with §13 Later
  settingsSchema: ZodType;                       // opaque: environment, account ids, base URL; never a secret
  credentialNames: string[];
  create(req: Req): Promise<{ outcome: 'ok'; provider_intent_ref: string | null; display: unknown } | { outcome: 'retry' | 'rejected'; error_code: string }>;
  status(req: Req & { provider_intent_ref: string | null; device_txn_ref: string | null }):
    Promise<{ outcome: 'paid'; provider_txn_ref: string; amount_minor: number; currency_code: string }
          | { outcome: 'pending' } | { outcome: 'in_progress' }   // R2-M-1: pending = no attempt known; in_progress = an authorisation attempt exists
          | { outcome: 'failed' | 'expired'; error_code: string | null }   // R2-M-2: order-final only (below)
          | { outcome: 'retry'; error_code: string }>;
  cancel(req: Req & { provider_intent_ref: string | null }): Promise<'ok' | 'not_supported' | 'retry'>;   // never "not paid" by itself
  health(): Promise<'ok' | 'failing'>;
}
type Req = { intent_id: string; amount_minor: number; currency_code: string; currency_exponent: number;
             settings: unknown; credentials: Record<string, string> };
```

⚠️ Changed by v0.2 hostile run 2 (R2-M-1, R2-M-2) — **status contract:** `pending` = the provider knows no attempt on this intent; `in_progress` = an authorisation attempt exists and its result is not final; `failed` / `expired` = **the provider guarantees that this intent can no longer be paid** (a declined attempt after which the same order can still be paid maps to `in_progress` or `pending`, never to `failed`); the adapter owns this mapping (test 30b, an X-2 question). ⚠️ Changed by v0.2 hostile run 2 (R2-m-2): "a `device_sdk` intent" in this spec means every intent of the pilot. `display` (in `create`'s answer) is opaque to the core: the adapter returns it and `payment-intent-device` passes it on (`device_sdk`: the SDK parameters; ⚠️ Changed by v0.2 owner review (OR-3): `qr` is §13). The adapter refuses a tenant currency it cannot take (`create` → `rejected`, `currency`). Transport: Node 22 `fetch`, `AbortSignal.timeout(5_000)` on `create`, 10 000 on the others. `error_code` ≤ 20 printable characters, never a provider text. **Cloud side** (`apps/cloud/src/modules/payments/providers/<key>.ts`): `verify({ headers, query, rawBody }, secret) → boolean` and `extract(...) → Notification | null` (§5.3), both pending docs.

### 3.5 `fake` adapter (tests only)

`apps/hub/test/payments/fake-provider.ts`: capabilities set per test; controls `answerCreate`, `settle(intent_id, answer)` (incl. two different `paid` refs), `failHealth`. A `fakeRelay` stands in for the pull client. No network.

### 3.6 ~~`alfalah_raast`~~ — ⚠️ Changed by v0.2 owner review (OR-3): moved to §13 Later (out of the pilot)

### 3.7 `paymob_softpos` (Paymob SoftPOS, card by NFC on the tablet) — phase 05c-C; every row **pending docs**

| Item | Draft |
|---|---|
| Integration | An SDK inside the 05b app (rows N-1 / N-2). ~~or a separate Paymob app called by Android intent~~ ⚠️ Changed by v0.2 hostile run 2 (R2-m-3): a separate app is Q-B's "no": the counter card machine stays and 05c-C is not built |
| Host-app eligibility (X-6) | The 05b app is sideloaded and self-updated from the hub, device owner, lock task, WebView bridge, LAN cleartext. Whether SoftPOS (MPoC / CPoC) attestation accepts that host must be **confirmed in writing** (STOP-C, Q-B) |
| `create` | Server-created order / token, or none (pending docs). If the SDK parameters are a bearer token, they are classed **secret**: never logged and served only to the intent's device (§6.6b) |
| Device step | Page → `PosNative.startCardPayment({ intent_id })` → native fetches amount / currency / parameters from `payment-intent-device` → SDK → result whitelist → page → `ReportPaymentIntentResult` (a hint, P7) |
| `status` | Transaction inquiry by our reference or the SDK's transaction id (pending docs). **If there is no server confirmation at all, card stays manual** (Q-C; ⚠️ Changed by v0.2 hostile run 2 (R2-M-6): part of STOP-0). ⚠️ Changed by v0.2 hostile run 2 (R2-M-2): if Paymob reports failure per transaction, the adapter answers `failed` only when the order itself can no longer be paid |
| Webhook | Paymob callback and its HMAC scheme (pending docs) |
| `cancel` | Only a pending order, if supported; a void is a refund → out of scope |
| Card data | **No card data reaches our code**: PAN, masked PAN, expiry, cardholder name and EMV tags never cross the bridge, are never logged and never stored |
| Mode | `kind: 'card'`, `payment_class: 'digital'`, `authority_codes [{ adapter_key: 'PRA', code: '2' }]` on `PK-PB` |

### 3.8 Validation rules

| Rule | Error |
|---|---|
| `amount_minor` 1 … min(10¹², `MAX_SAFE_INTEGER`); `split_no` 1 … 20; ids 1 … 40; `note` ≤ 200 | `400` |
| Mode not active | `404 PAYMENT_MODE_NOT_FOUND { mode_id }` |
| Mode has no provider binding | `422 PAYMENT_MODE_NO_PROVIDER { mode_id }` |
| Provider not registered or credentials incomplete | `409 PAYMENT_PROVIDER_UNAVAILABLE { provider_key, reason: 'not_configured' }` |
| Health `failing`, or older than 60 s | `409 PAYMENT_PROVIDER_UNAVAILABLE { provider_key, reason: 'failing' }` |
| `device_sdk` provider and the caller's device is not a tablet | `422 PAYMENT_PROVIDER_DEVICE_UNSUPPORTED { provider_key, device_type }` |
| Fiscal gate | `422 PAYMENT_MODE_NOT_FISCAL { mode_id, adapter_key }` |
| No money shift | `409 SHIFT_NOT_OPEN { reason: 'no_shift' }` |
| Another open intent on the bill | `409 PAYMENT_INTENT_PENDING { intent_id, reason: 'open' }` |
| A watched intent on the bill and no permitted override | `409 PAYMENT_INTENT_PENDING { intent_id, reason: 'previous_watched' }`; `override_watched` without `close-shift-for-others` → `403 PERMISSION_DENIED` |
| Split / bill not open | `409 BILL_NOT_OPEN { bill_id, state }` |
| `card_due = 0` or `amount_minor > card_due` | `422 PAYMENT_EXCEEDS_BALANCE { balance_minor }` |
| Bill out of the caller's scope | `403 PERMISSION_DENIED` (05's `billAccess`) |
| Intent / provider payment unknown | `404 PAYMENT_INTENT_NOT_FOUND { intent_id }` / `404 PROVIDER_PAYMENT_NOT_FOUND { provider_payment_id }` |
| Cancel / report on an intent that is not in an allowed state | `409 PAYMENT_INTENT_FINAL { intent_id, state }` |
| Report from a device other than the intent's | `403 DEVICE_ACCESS_DENIED` |
| Resolve an applied or already resolved provider payment | `409 PROVIDER_PAYMENT_RESOLVED { provider_payment_id }` |
| `RemovePayment` of a provider-settled payment (05, row B-6) | `409 PAYMENT_PROVIDER_FINAL { payment_id }` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 05 (row B-1) | `providerPaymentDrafts(tx, { bill_id, split_no, mode_id, amount_minor, taken_by_staff_id, shift_id, reference }) → { applied: true, drafts, payment_id } \| { applied: false, reason }` (statements ≤ 6); `splitDues`, `fiscalGate`, `moneyShiftOf`, `billAccess` (exported unchanged) |
| 05 | `billAudience`, `registerAuditAction`; the kinds `discount`, `remove_service_charge`, `reopen_bill` call `openIntentOf` in their `apply` (row B-3) |
| 02b (row Q-1) | `registerLineGuard` with the code `PAYMENT_INTENT_PENDING` |
| 02a (row T-1) | `registerMergeGuard` |
| 01a (row A-2) | `registerDayCloseGuard`; `branchConfig()` → billing settings (row A-1 `provider`) |
| 04 (row V-1) | the void kind's `apply` calls `openIntentOf` |
| 00 | registries, writer, after-commit hook, branch API key HTTP client (`sync/config-client.ts` transport), session device type, device-token query auth |
| 01d (row D-1) | `defineAlertKind` for `payment_unapplied`, `payment_relay_unhealthy`; `openAlert`, `closeAlert` |
| 05b (rows N-1, N-2) | `PosNative.cardPaymentInfo / startCardPayment / cancelCardPayment` (client) |

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| Events (bill stream) `PaymentIntentCreated`, `PaymentIntentReady`, `PaymentIntentConfirming`, `PaymentIntentSucceeded`, `PaymentIntentFailed`, `PaymentIntentExpired`, `PaymentIntentCancelled`, `PaymentIntentWatchEnded` (⚠️ Changed by v0.2 hostile run 2 (R2-m-6)), `ProviderPaymentResolved`; (hub stream) `PaymentCredentialSet`. All v1, **frozen at STOP-0** | `@pos/events/src/events/{bill,hub}/` | 06, 07, 04 audit view |
| `openIntentOf(db, { bill_id } \| { order_id } \| { seating_ids, order_ids }) → { intent_id, split_no, shift_id } \| null`; `openIntentsOfShift(db, shift_id)`; `anyOpenIntent(db)` (1 statement each) | `apps/hub/src/payments/exports.ts` | guards (P11), 05 rows B-2 / B-3, 04 row V-1 |

### 4.3 Requirements carried to other modules

| To | Requirement |
|---|---|
| 06 | Sync carries the ten events (⚠️ Changed by v0.2 hostile run 2 (R2-m-12)). `payment_intent_provider`, `payment_credentials`, `payment_relay_cursor`, `payment_relay_pending`, `payment_relay_unknown` (R2-M-4) are hub state, **never synced**. After a restore, the worker resumes from the projections; intents past their deadlines follow P9 / P9a at the first tick |
| 07 | Payments by provider = `PaymentAdded` joined to `PaymentIntentSucceeded { applied: true }.payment_id`. Unapplied = `applied: false` minus `ProviderPaymentResolved` (`applied_to_bill` is then counted once, through its manual `PaymentAdded`) |

### 4.4 Story → build part

05c-1: pure rules, client mocks (⚠️ Changed by v0.2 hostile run 2 (R2-M-6): the M-3 rule, `source` column, codes, alert kinds and permission move to 05c-2, after STOP-0). 05c-2: those, then P1–P15 (incl. P13 credentials), §6.1–§6.9 on `fake`. 05c-C: §3.7, rows N-1 / N-2. ~~05c-R: §3.6, §8.2 – 8.3~~ (⚠️ Changed by v0.2 owner review (OR-3): §13). The relay (§6.10 – §6.12) ships with Paymob if Paymob has `has_webhook`.

### 4.5 Changes to other specs (R26) — *proposed, applied when 05c is approved*, each target bumped with a changelog and "⚠️ Changed by 05c (row X)" markers

⚠️ Changed by v0.2 hostile run 2 (R2-M-7): **every row below is carried when 05c is approved**, and nothing of it is built before (the 05 v1.0.35 form, 05 §4.5 rows 05c-B-1 … 05c-B-7). Foundation v1.18 (rows F-10, F-11, and the 05c codes of F-12(b) / §6.2) and 00 HPA v1.13 (rows H-13 – H-15: M55, §5.2, §6.2) today carry rows F-1 – F-3 and H-1 – H-3 as normative text. **Those two specs must mark them "carried when 05c is approved"** (or state that the 05c text is inert until 05c is approved and is not built before then), and HPA v1.13 must re-letter the new M55 webhook item **(g)** (M55 (f) is already the query guard write). Their writers own them; this spec does not edit them. Until then 05c rows F-1 – F-3 and H-1 – H-3 apply only through 05c's approval.

| Row | Target → section | Change | Why |
|---|---|---|---|
| B-1 | **05** §6.9, §4.2 | Export `providerPaymentDrafts` (AddPayment's money checks; no session, permission, scope, shift resolution, fiscal gate or P11 hold; taker and shift given; reference written with `source 'provider'`; statements ≤ 6), and export unchanged `splitDues`, `fiscalGate`, `moneyShiftOf`, `billAccess`. **§6.9 reference source:** a payment reference is either typed by staff (`source 'staff'`) or the provider's transaction ref (`source 'provider'`); both only in `payment_references` | P5 |
| B-2 | **05** §6.5, §6.6, §6.8, §6.9, §6.12, §6.13, §6.17, §6.18 | `409 PAYMENT_INTENT_PENDING { intent_id }` while `openIntentOf` is not null: `AddPayment` and `CloseSplit` when the intent's `split_no` is theirs; `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `ReopenBill` on the bill; `CountShift` / `CloseShift` of the intent's shift. +1 statement each. ⚠️ Changed by v0.2 hostile run 2 (R2-M-5) — **OWNER (default written):** `AddPayment { direction: 'in' }` (any mode) on the split of a **watched** intent (`watch_until` not null) → `409 PAYMENT_INTENT_PENDING { intent_id, reason: 'previous_watched' }` (the same read, `payment_intents_watched`); `AddPayment` gains `override_watched?: true`, allowed only to a holder of `close-shift-for-others` (else `403 PERMISSION_DENIED`), recorded in the payment as `PaymentAdded.overrides_intent_id: string \| null` (`PaymentAdded` v2; the v1 → v2 upcaster gives `null`) | P11 (e), P9a |
| B-3 | **05** §3.14 kinds | The `apply` of `discount`, `remove_service_charge`, `reopen_bill` refuses with `409 PAYMENT_INTENT_PENDING` while the bill has an open intent (request stays pending) | P11 (d) |
| B-4 | **05** §5 | `payment_references.source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','provider'))` (05c's hub migration `0030`; ~~the only 05c migration merged before STOP-0~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-6): merged after STOP-0, with 05c-2; ⚠️ Changed by v0.2 (integration, 02b-TK): `0030` is provisional, the number is the next free one at merge) | P5 |
| B-6 | **05** §6.10 | `RemovePayment` of a payment whose reference has `source = 'provider'` → `409 PAYMENT_PROVIDER_FINAL { payment_id }` (the payment read joins `payment_references`, 0 extra statements). Money back = portal refund + manual `AddPayment { direction: 'out' }` | review M-3 |
| B-7 | **05** audit map (`billing/audit-map.ts`) | `payment_added`: `actor_staff_id = taken_by_staff_id` when the envelope's `actor_id` is null | review m-5 |
| ~~B-5~~ | — | Deleted (v0.2, m-5): 05c runs its own wiring check at registration (its event list: audience + audit map, `PaymentIntentReady` and `PaymentIntentConfirming` with no audit action); 05 does not import 05c | — |
| Q-1 | **02b** §3.4, §4.2; `orders/line-guard.ts` | `LineGuardResult.code` union gains `'PAYMENT_INTENT_PENDING'`; 05c's guard is registered **after** 04's and 05's (04 stays first). It answers `{ intent_id }` for any touched line of an order whose bill has an open intent (1 statement) | P11 (a) |
| T-1 | **02a** §4.1 merge-guard list | 05c's merge guard (after 04's and 05's): `MergeTables` / `SplitSeating` touching a seating or order whose bill has an open intent → `409 PAYMENT_INTENT_PENDING` (1 statement) | P11 (b) |
| A-1 | **01a** billing settings document, `packages/events/src/admin/billing.ts`, owner page | `PaymentMode.provider?: { provider_key, settings } \| null` (additive, default `null`); PUT checks of P2; owner form "Take this payment through: none / Paymob SoftPOS" (⚠️ Changed by v0.2 owner review (OR-3): no Raast choice in the pilot) + settings; the webhook endpoint form (§6.12). The existing authority-code rule (`billing.ts:377-384`) is **unchanged** | P2, P16 |
| A-2 | **01a** §6.18b day-close guard list | 05c's guard: any open intent → `409 PAYMENT_INTENT_PENDING { intent_id }` (1 statement) | P11 (c) |
| V-1 | **04** void kind `apply` | Refuse with `409 PAYMENT_INTENT_PENDING` while the void's order's bill has an open intent (request stays pending) | P11 (d) |
| R-1 | **01b** §4.2, `permissions.ts` | `manage-payment-providers`: group `bills`, scope `branch`, Owner only by default. ⚠️ Changed by v0.2 hostile run 2 (R2-m-15): the Owner default role holds both `manage-payment-providers` and `close-shift-for-others`, so the D-1 `when_none` recipient can open the list and resolve | P13 |
| D-1 | **01d v1.3.7** (in progress by another writer, who was told to add `payment_unapplied`) | Exact declaration needed: `defineAlertKind({ kind: 'payment_unapplied', family: 'action', subject: 'bill', steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }, { target: { kind: 'permission', permission: 'manage-payment-providers' }, set: 'recipient', when_none: true }] }] (⚠️ Changed by v0.2 owner review (OR-4): no manager present → the Owner role, 01d v1.3.7 §3.5 `when_none`), closes_on: 'owner', expires_at_day_close: true, silent: false, lead_fallback: false, skip_requester: false, values_schema: z.object({ provider_payment_id: z.string().min(1), bill_id: z.string().min(1), amount_minor: z.number().int(), provider_key: z.string().min(1), reason: z.string().min(1) }), details_schema: ~~<AlertDetailsBase + { ref_last4: string \| null, token: string \| null }>~~ ⚠️ Changed by v0.2 (integration, 02b-TK) (01d v1.3.7 Q-37e): `AlertDetailsBase.pick({ identifier: true, amount: true, problem: true })` (`identifier` = the token, else the bill; `amount` = the paid amount; `problem` = provider + reference last 4, ≤ 40; no extra fields), labels: { card: 'alert.payment_unapplied.card', lock: 'alert.payment_unapplied.lock' }, request: null })`, ⚠️ Changed by v0.2 hostile run 2 (R2-m-10): `dedupe_key = 'payment_unapplied:' + provider_payment_id`, no `link` (as 01d v1.3.7 l. 1330). ~~The lock `display` shows only amount and provider; `ref_last4` is in `details` (signed-in only, 01d §3.12).~~ ⚠️ Changed by v0.2 (integration, 02b-TK): the lock shows the **kind label only** (`display: { kind_label_key }`); amount, provider and reference last 4 are card-only, in the base detail fields (signed-in only, 01d §3.12). Carried in 01d v1.3.7 §4.3 To 05c. **Closed by 05c** on `ProviderPaymentResolved`. **Expiry:** it expires at day close (forced by `closes_on: 'owner'`) and **05c raises it again after each `BusinessDayOpened`** while the provider payment is unresolved (as 05 raises `fiscal_outbox_stuck` again while stuck) | P8, review M-7 |
| D-2 | **01d v1.3.7** | `defineAlertKind({ kind: 'payment_relay_unhealthy', family: 'action', subject: 'hub', steps: [{ at: { ms: 0 }, to: [{ target: { kind: 'managers' }, set: 'recipient' }] }], closes_on: 'owner', expires_at_day_close: true, lead_fallback: false, values_schema: z.object({ provider_key: z.string().min(1), reason: z.enum(['signature_failures', 'confirm_stuck', 'pull_failing', 'unknown_intent']) }), details_schema: null, request: null, … })`; closed by 05c when healthy again; raised again after each day open while unhealthy. ⚠️ Changed by v0.2 hostile run 2 (R2-M-4): reason **`unknown_intent`** (a `paid` relay row of this branch for an intent the hub does not find) is raised once per row's day and expires at day close; it is not re-raised (the row stays in `payment_relay_unknown`; reconciliation is R7). `dedupe_key = 'payment_relay_unhealthy:' + provider_key + ':' + reason` (as 01d v1.3.7) | P14, review M-6, R2-M-4 |
| H-1 | **00 HPA** §5.2, M55, `plugins/tenant-scope.ts`, `db/credential-lookup.ts` | New guard scope **`webhook-endpoint`**: lookup by `endpoint_id` in `credential-lookup.ts` (`paymentWebhookEndpointById`), then `setTenant`; the route has a `TenantContext`. Index `payment_webhook_endpoints_endpoint (endpoint_id)` named as an **M55 (a)-style pre-tenant override**. Route inventory and cross-tenant tests | review M-5 |
| H-2 | **00 HPA** §5.2 | `GET /v1/sync/payment-notifications` on the branch API key | P14 |
| H-3 | **00 HPA** §6.2 query auth | Query `payment-intent-device` takes the **device token only** (no staff session), answers only the intent's own device (05b native) | P10, review M-8 |
| F-1 | Foundation §6.2 status map | §9 codes appended (no bump, R34). ⚠️ Changed by v0.2 (integration, 02b-TK): appended in F v1.18 §6.2 (hub codes and the two cloud codes, with this §9's statuses) | §9 |
| F-2 | **Foundation, next version** (v1.18 DRAFT is another writer's: fold in there if accepted, else v1.19; ⚠️ Changed by v0.2 (integration, 02b-TK): folded in F v1.18 row F-10) §6.4 "Auth groups" | Replace with: "`/v1/sync/*` uses the branch API key; `/v1/owner/*` and `/v1/admin/*` use the JWT; `/v1/auth/*` and `/v1/health` are the tenant-scope allowlist (D54); ⚠️ Changed by 05c (F-2): **`/v1/payments/webhooks/:endpoint_id` uses a webhook endpoint credential** (the guard resolves the tenant from `endpoint_id`; the request is authenticated by the provider's signature, checked in the handler before any write), and needs no `Idempotency-Key` (idempotent by the provider's event id and outcome)". Also F D53 note: "hub backups carry `fiscal_credentials` and `payment_credentials`" | review M-5, m-11 |
| F-3 | **Foundation, next version** D54 (⚠️ Changed by v0.2 (integration, 02b-TK): folded in F v1.18 row F-11) | The list of tenant-scope credential types gains `webhook-endpoint` (as 00 row H-1) | review M-5 |
| N-1 | **05b → v1.1** §4.2, §3.6 | `PosNative` gains `cardPaymentInfo() → { available, reason? }`, `startCardPayment({ intent_id }) → { outcome: 'approved' \| 'declined' \| 'cancelled' \| 'error', device_txn_ref?, error_code? }` (native fetches amount / currency / parameters from `payment-intent-device` with its device token; the page never passes an amount), `cancelCardPayment({ intent_id })`. Allowed from the hub origin, path `/staff/` only. **Result whitelist**: only those three fields leave native; everything else from the SDK is dropped and never logged. **`native_api` = 2**; the page keeps `MIN_NATIVE_API` 1 and feature-checks the methods (M-14). ~~If Paymob's product is a separate app (§3.7), N-1 is rewritten at STOP-C~~ ⚠️ Changed by v0.2 hostile run 2 (R2-m-3): a separate app = Q-B "no", no N-1 | P7, P10, review M-8 |
| N-2 | **05b → v1.1** §10, `tablet.yml` | Paymob SDK as a Gradle / Maven dependency (exact version), its private repository credentials as a CI secret in `tablet.yml`, the licence file in `apps/tablet`; NFC permission; Gradle tests: guard (`/staff/` only), result whitelist, amount taken from the hub answer; manual NFC check per pilot model | review M-8 |
| M-1 | **README** module map | Row `05c Payments integration | v0.2 | DRAFT | G-12 | 05, 05b, 01a, 01d | STOP-0 / STOP-C (§11)` (⚠️ Changed by v0.2 hostile run 2 (R2-m-1): no STOP-R, §13) | review m-1 |
| — | 03a, 03c | No change | — |

---

## §5. Data model and migrations

Numbers assume hub `0028` (08d, 02b-TK `0028_orders_takeaway`) and `0029` (HPA v1.13 `0029_display_sessions`), and cloud `0019` (taken) – `0021` (08's renumbered drafts) land first. Renumber at build (OQ-7). ⚠️ Changed by v0.2 (integration, 02b-TK): every number below is **provisional**; each file takes the **next free number at merge** (README "Migration numbers"), as 02b v1.0.25 (`NNNN_orders_takeaway`) and 00 HPA v1.13 (`00NN_display_sessions`) do.

### 5.1 Events (`@pos/events`, `schema_version` 1, `.strict()`) — **payloads frozen at STOP-0**

| Event (stream) | Payload | Audit action | WS audience |
|---|---|---|---|
| `PaymentIntentCreated` (bill) | `{ intent_id, bill_id, split_no, order_ids: string[1..40], mode_id, provider_key, amount_minor, currency_code, shift_id, started_by_staff_id, device_id, ~~display_kind~~ (⚠️ Changed by v0.2 hostile run 2 (R2-m-2): dropped; §13 adds it), fiscal_checked: boolean, overrides_intent_id: string \| null }` | `payment_intent_started` | `billAudience` |
| `PaymentIntentReady` (bill) | `{ intent_id, expires_at }` | none | `billAudience` |
| `PaymentIntentConfirming` (bill) | `{ intent_id, trigger: 'device_hint' \| 'provider_in_progress' }` (⚠️ Changed by v0.2 hostile run 2 (R2-M-1): was `'provider_pending'`) | none | `billAudience` |
| `PaymentIntentSucceeded` (bill) | `{ intent_id, provider_payment_id, payment_no: int ≥ 1, applied: boolean, payment_id: string \| null, amount_minor, unapplied_reason: null \| 'split_closed' \| 'bill_not_open' \| 'exceeds_due' \| 'shift_closed' \| 'mode_inactive' \| 'day_closed' \| 'amount_mismatch' \| 'second_payment' \| 'duplicate_txn', after_state: null \| 'expired' \| 'cancelled' \| 'failed', source: 'status' \| 'webhook' }` (⚠️ Changed by v0.2 hostile run 2 (R2-M-2): `'failed'` added) | `payment_intent_succeeded` | `billAudience` |
| `PaymentIntentFailed` (bill) | `{ intent_id, reason: 'provider_refused' \| 'provider_unreachable' \| 'declined', error_code: string (≤ 20) \| null }` — **server-final only** (or nothing created) | `payment_intent_failed` | `billAudience` |
| `PaymentIntentExpired` (bill) | `{ intent_id, outcome: 'not_paid' \| 'unknown', watch_until: number \| null }` (`watch_until` null only for `not_paid`) | `payment_intent_expired` | `billAudience` |
| `PaymentIntentCancelled` (bill) | `{ intent_id, cancelled_by_staff_id, watch_until: number \| null }` (⚠️ Changed by v0.2 hostile run 2 (R2-m-7): null for a cancel in `creating`) | `payment_intent_cancelled` | `billAudience` |
| `PaymentIntentWatchEnded` (bill) (⚠️ Changed by v0.2 hostile run 2 (R2-m-6)) | `{ intent_id, outcome: 'not_paid' \| 'no_answer' }` — `not_paid`: the server said `failed` / `expired` during the watch; `no_answer`: the last status call at `watch_until` found nothing | `payment_intent_watch_ended` | `billAudience` |
| `ProviderPaymentResolved` (bill) | `{ provider_payment_id, intent_id, resolution: 'applied_to_bill' \| 'refunded' \| 'kept', payment_id: string \| null, has_note }` | `provider_payment_resolved` | `billAudience` |
| `PaymentCredentialSet` (hub) | `{ provider_key, name }` | `payment_credential_changed` | admin only |

No event carries a provider ref, QR payload, SDK parameter, secret, card or payer detail (B30). Worker events: `actor_id null`, `device_id 'hub'`. The device hint itself is hub state (§2); `PaymentIntentConfirming` is the fact the bill needs (it stays held).

### 5.2 Hub — `0030_payment_reference_source.sql` and `0031_payment_intents.sql` (05c-2, after STOP-0; ⚠️ Changed by v0.2 hostile run 2 (R2-M-6): `0030` was 05c-1)

```sql
-- 0030 (05c-2, row B-4; R2-M-6: after STOP-0, a "no" from Paymob would leave it dead)
ALTER TABLE payment_references ADD COLUMN source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','provider'));
```

```sql
-- 0031 (05c-2). payment_intents, payment_intent_orders, provider_payments are projections of the bill-stream events
-- (rebuildable); payment_intent_provider, payment_relay_* are hub state (§2).
CREATE TABLE payment_intents (
  intent_id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL, split_no INTEGER NOT NULL, mode_id TEXT NOT NULL, provider_key TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), currency_code TEXT NOT NULL,
  shift_id TEXT NOT NULL, started_by_staff_id TEXT NOT NULL, device_id TEXT NOT NULL,
  -- R2-m-2: no display_kind column in the pilot (§13 adds it, without a CHECK)
  state TEXT NOT NULL CHECK (state IN ('creating','ready','confirming','succeeded','failed','expired','cancelled')),
  outcome TEXT CHECK (outcome IN ('not_paid','unknown')),
  created_at INTEGER NOT NULL, expires_at INTEGER, ended_at INTEGER, watch_until INTEGER);
-- P3 backstop; openIntentOf({ bill_id }) — 05 guards, StartPaymentIntent, kinds' apply
CREATE UNIQUE INDEX payment_intents_open_bill ON payment_intents (bill_id) WHERE state IN ('creating','ready','confirming');
-- worker: open intents by deadline
CREATE INDEX payment_intents_open_due ON payment_intents (expires_at) WHERE state IN ('creating','ready','confirming');
-- worker: watched intents (P9a); StartPaymentIntent 'previous_watched' check uses (bill_id, watch_until)
CREATE INDEX payment_intents_watched ON payment_intents (bill_id, watch_until) WHERE watch_until IS NOT NULL;
-- openIntentsOfShift (CountShift / CloseShift)
CREATE INDEX payment_intents_open_shift ON payment_intents (shift_id) WHERE state IN ('creating','ready','confirming');

CREATE TABLE payment_intent_orders (       -- from PaymentIntentCreated.order_ids; line / merge guards by order
  intent_id TEXT NOT NULL REFERENCES payment_intents, order_id TEXT NOT NULL, PRIMARY KEY (intent_id, order_id));
-- openIntentOf({ order_id }) (line guard, 04 void apply) and ({ order_ids }) (merge guard)
CREATE INDEX payment_intent_orders_order ON payment_intent_orders (order_id);

CREATE TABLE provider_payments (           -- one per confirmed provider payment (P6, P8)
  provider_payment_id TEXT PRIMARY KEY, intent_id TEXT NOT NULL REFERENCES payment_intents, payment_no INTEGER NOT NULL,
  applied INTEGER NOT NULL CHECK (applied IN (0,1)), payment_id TEXT, amount_minor INTEGER NOT NULL,
  unapplied_reason TEXT, recorded_at INTEGER NOT NULL,
  resolution TEXT CHECK (resolution IN ('applied_to_bill','refunded','kept')), resolved_at INTEGER,
  resolved_payment_id TEXT,                -- R2-m-11: the manual PaymentAdded an 'applied_to_bill' resolution names
  UNIQUE (intent_id, payment_no));
-- R2-m-16: unapplied-payments, one list per state, each with its own index; cursor (recorded_at, provider_payment_id) desc
CREATE INDEX provider_payments_unresolved ON provider_payments (recorded_at, provider_payment_id) WHERE applied = 0 AND resolution IS NULL;
CREATE INDEX provider_payments_resolved ON provider_payments (recorded_at, provider_payment_id) WHERE applied = 0 AND resolution IS NOT NULL;
-- R2-m-11: one manual payment resolves at most one provider payment
CREATE UNIQUE INDEX provider_payments_resolved_payment ON provider_payments (resolved_payment_id) WHERE resolved_payment_id IS NOT NULL;

CREATE TABLE payment_intent_provider (     -- worker-owned provider data (P10); never synced, logged or in an event
  intent_id TEXT PRIMARY KEY REFERENCES payment_intents,
  provider_intent_ref TEXT, display_json TEXT,
  device_hint TEXT CHECK (device_hint IN ('approved','declined','cancelled','error')), device_txn_ref TEXT, last_error_code TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, next_check_at INTEGER);
-- relay rows that carry only the provider's own ref (M-4)
CREATE UNIQUE INDEX payment_intent_provider_ref ON payment_intent_provider (provider_intent_ref) WHERE provider_intent_ref IS NOT NULL;

CREATE TABLE provider_payment_refs (       -- hub state: the provider txn ref per provider payment (P6 pre-read + backstop)
  provider_payment_id TEXT PRIMARY KEY, provider_key TEXT NOT NULL, provider_txn_ref TEXT NOT NULL,
  UNIQUE (provider_key, provider_txn_ref));

CREATE TABLE payment_credentials (         -- P13: written only by SetPaymentCredential; never returned
  provider_key TEXT NOT NULL, name TEXT NOT NULL, secret TEXT NOT NULL,
  set_at INTEGER NOT NULL, set_by_staff_id TEXT NOT NULL,
  PRIMARY KEY (provider_key, name));

CREATE TABLE payment_relay_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), after_seq INTEGER NOT NULL DEFAULT 0, stuck_since INTEGER);
INSERT INTO payment_relay_cursor (id, after_seq) VALUES (1, 0);

CREATE TABLE payment_relay_unknown (       -- R2-M-4, hub state: a paid relay row of this branch whose intent the hub does not find
  seq INTEGER PRIMARY KEY,                 -- the cloud row's seq
  provider_key TEXT NOT NULL, intent_id TEXT, provider_intent_ref TEXT, provider_txn_ref TEXT,
  amount_minor INTEGER, currency_code TEXT, received_at INTEGER NOT NULL);
```

Folds: `Created` inserts the intent and its orders; `Ready` sets `state`, `expires_at`; `Confirming` sets `state` and `expires_at = event time + confirm_window_ms` (⚠️ Changed by v0.2 hostile run 2 (R2-m-5): the worker's one rule is "open and `expires_at ≤ now`"); `Failed` / `Expired` / `Cancelled` set `state`, `ended_at`, `outcome`, `watch_until`; `Succeeded` inserts a `provider_payments` row and sets `state = 'succeeded'`, `watch_until = NULL` (a later different ref is a new row); `ProviderPaymentResolved` sets `resolution`, `resolved_at`, `resolved_payment_id` (R2-m-11); `WatchEnded` sets `watch_until = NULL`, and `outcome = 'not_paid'` when its outcome is `not_paid` (⚠️ Changed by v0.2 hostile run 2 (R2-m-6)). Registered with `registerHubProjections`, checkpointed.

### 5.3 Cloud — `0022_payment_relay.sql` (with the first webhook provider)

```sql
CREATE TABLE payment_webhook_endpoints (    -- P14: one per tenant per provider account (Q-D)
  tenant_id TEXT NOT NULL, provider_key TEXT NOT NULL, account_label TEXT NOT NULL,  -- e.g. 'main', or a branch name
  branch_id TEXT,                           -- R2-M-4: the account's branch; NULL = a tenant-wide account
  endpoint_id TEXT NOT NULL,                -- 32 hex random, the URL segment; not a secret by itself
  secret TEXT NOT NULL,                     -- webhook signing secret; write-only, never returned or logged
  failures_window_start BIGINT, failures_count INT NOT NULL DEFAULT 0,   -- M-6: 401 counter
  set_at BIGINT NOT NULL, set_by_user_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, provider_key, account_label));
-- row H-1: the webhook guard resolves the tenant from the URL (M55 (a)-style pre-tenant override)
CREATE UNIQUE INDEX payment_webhook_endpoints_endpoint ON payment_webhook_endpoints (endpoint_id);

CREATE TABLE payment_notifications (        -- extractor fields only; no raw body, no payer data
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL, provider_key TEXT NOT NULL, account_label TEXT NOT NULL,
  branch_id TEXT,                           -- R2-M-4: copied from the endpoint
  provider_event_id TEXT NOT NULL,          -- the provider's notification id, or its txn id when it has none (pending docs)
  intent_id TEXT, provider_intent_ref TEXT, -- M-4: one of the two
  outcome TEXT NOT NULL CHECK (outcome IN ('paid','failed','expired','pending','in_progress')),   -- R2-M-1: in_progress added
  amount_minor BIGINT, currency_code CHAR(3), provider_txn_ref TEXT, error_code TEXT, received_at BIGINT NOT NULL,
  CHECK (intent_id IS NOT NULL OR provider_intent_ref IS NOT NULL),
  UNIQUE (tenant_id, provider_key, provider_event_id, outcome));          -- M-4 (1): pending then paid both kept
-- hub pull (R2-M-4): WHERE tenant_id = $1 AND (branch_id = $2 OR branch_id IS NULL) AND seq > $3 ORDER BY seq LIMIT n
CREATE INDEX payment_notifications_pull ON payment_notifications (tenant_id, seq);
```

Retention: none in v0.2 (≈ 200 rows per branch per day, no payer data) → §12.4.

---

## §6. Commands, queries and routes

Hub commands: `sessionKind: 'device'` unless stated, **not queueable**, idempotent by `command_id`. Statement counts are the handler's, without 00's envelope and the folds. Shared failures not repeated: `400 VALIDATION_FAILED`, `401`, `403 PERMISSION_DENIED`, `403 DEVICE_ACCESS_DENIED` (05a), `409 BUSINESS_DAY_NOT_OPEN`.

### Batch 1 — intents (05c-2) — STOP for owner review after this batch

#### 6.1 `StartPaymentIntent` — `{ bill_ref, split_no, mode_id, amount_minor?, override_watched?: true }` (`take-payment`)

| | |
|---|---|
| Script | Zod → ensure bill (05, 1) → open or watched intent of the bill (`payment_intents_open_bill` / `_watched`, 1): open → `409 { reason: 'open' }`; watched and no `override_watched` → `409 { reason: 'previous_watched' }`; `override_watched` and the caller lacks `close-shift-for-others` → `403` → split open (1) → mode active (`404`) → provider binding (`422`) → registered + credential names present (1) + health ≤ 60 s `ok` (`409`) → `device_sdk` ⇒ caller's device is a tablet (`422`) → `fiscalGate` (`422`) → `moneyShiftOf` (1) → `409 SHIFT_NOT_OPEN` → orders, lines, pending voids, payments of the split (3) → `card_due` → P4 (`422`) → **`billAccess(… ['take-payment'])`** (0, C8, M-1) → append `PaymentIntentCreated` (`order_ids` from the orders read, `fiscal_checked: true`, `overrides_intent_id`) → after commit: wake the worker |
| Result | `{ intent_id, state: 'creating', amount_minor }` (⚠️ Changed by v0.2 hostile run 2 (R2-m-2): no `display_kind`) |
| Statements | ≤ 8 |

| Edge | Answer |
|---|---|
| Token 57, Rs 3,650 due, card mode on a tablet, `PK-PB` (card PRA code 2) | intent 365 000, `creating` |
| Same from the cashier kiosk | `422 PAYMENT_PROVIDER_DEVICE_UNSUPPORTED` |
| A previous card intent cancelled 2 min ago (watched; ⚠️ Changed by v0.2 owner review (OR-3): was "QR") | `409 { reason: 'previous_watched' }`; a manager retries with `override_watched` |
| Waiter scoped to own tables, another waiter's bill | `403 PERMISSION_DENIED` |
| Retransmit | stored result; one intent |

#### 6.2 `CancelPaymentIntent` — `{ intent_id }` (`take-payment`)

Intent read (1) → `404` → state `creating` or `ready`, else `409 PAYMENT_INTENT_FINAL { state }` (`confirming` included: a card was read) → `billAccess` (bill head + placers read, 1) → append `PaymentIntentCancelled { watch_until: now + late_window_ms }` from `ready`; from `creating` `watch_until: null` (⚠️ Changed by v0.2 hostile run 2 (R2-m-7): no device ever got SDK parameters, so it cannot be paid) → after commit: best-effort provider `cancel`. Result `{ intent_id, state: 'cancelled', watch_until }`. Statements 2. A later confirmed payment is P8's case; the client never says "not charged" (§8.5).

#### 6.3 `ReportPaymentIntentResult` — `{ intent_id, outcome: 'approved' | 'declined' | 'cancelled' | 'error', device_txn_ref?: 1–64, error_code?: 1–20 }` (`take-payment`)

Intent read (1) → `404` → caller's device = `payment_intents.device_id`, else `403 DEVICE_ACCESS_DENIED` → state `ready` or `confirming`, else: ~~`succeeded` / ended → result `{ state }` (no error, no write)~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-3): a **watched** ended intent (`watch_until > now`) → `billAccess` (1) → store the hint, `device_txn_ref`, `error_code` on `payment_intent_provider` (1, hub state, no event) → wake the worker for an immediate `status` (it may need that ref) → result `{ state }`; `succeeded` or an unwatched ended intent → result `{ state }` (no error, no write); `creating` → `409 PAYMENT_INTENT_FINAL { state }` → `billAccess` (1) → store hint, `device_txn_ref`, `error_code` on `payment_intent_provider` (1) → if `ready`: append `PaymentIntentConfirming { trigger: 'device_hint' }` → wake the worker for an immediate `status`. **Every outcome, `declined` included, leads to `confirming`; only the server ends it** (B-1). `hashOmit: ['device_txn_ref']`. Statements ≤ 3. Result `{ intent_id, state }`.

#### 6.4 Payments worker (`apps/hub/src/payments/worker.ts`, no route)

Loop every 1 s, woken by after-commit hooks. Each tick reads, with a fixed number of statements: open and due intents (1), watched and due intents (1), their provider rows (1). A provider call never runs inside a writer tx; every write re-reads the intent first.

| Step | Action |
|---|---|
| `creating` | `create` (5 s timeout; the same `intent_id` on every retry; backoff 1 / 2 / 4 s; budget 20 s). `ok` → tx: still `creating` → provider row + `PaymentIntentReady { expires_at }`. `rejected` → `Failed { provider_refused }`. Budget over → `Failed { provider_unreachable }`: nothing was shown to the customer or sent to a device, so nothing can be paid (a create the provider took after all has no SDK parameters on any device and no SDK call, ⚠️ Changed by v0.2 hostile run 2 (R2-m-1); a relay row for it would still be recorded as a late success, unapplied if needed) |
| `ready` / `confirming` | `status` every 3 s (immediately after a hint or a relay row). `paid` → **apply**. `failed` → `Failed { declined, error_code }`. `expired` → `Expired { not_paid }`. ~~`pending` on a `device_sdk` intent in `ready` → `Confirming { provider_pending }`~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-1): `in_progress` in `ready` → `Confirming { provider_in_progress }`; `pending` → no change (a `ready` intent waits for its tap deadline). `retry` → next check |
| Deadlines | `device_sdk` in `ready` at `expires_at` (no tap) → final status → `paid` apply / `failed`·`expired` → `Expired { not_paid }` / else `Expired { unknown, watch_until }` + best-effort cancel (⚠️ Changed by v0.2 owner review (OR-3): the `qr` deadline is §13). `confirming` at `expires_at` (= the `Confirming` time + `confirm_window_ms`, ⚠️ Changed by v0.2 hostile run 2 (R2-m-5)) → `Expired { unknown, watch_until }`. **The clock never writes `not_paid`** |
| Watched | every 15 s `status` (by `provider_intent_ref` and the stored `device_txn_ref`, R2-M-3); `paid` → apply (late); ⚠️ Changed by v0.2 hostile run 2 (R2-m-6): `failed` / `expired` → `WatchEnded { not_paid }`; at `watch_until` one last status, then `WatchEnded { no_answer }` (unless `paid`), and the intent leaves the list |
| Relay pull (P14) | every 5 s: `GET …?after=<cursor>`; for each row in order: intent by `intent_id` or `provider_intent_ref` (1); ~~not ours → skip~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-4): the pull returns only this branch's and tenant-wide rows; intent not found → a `paid` row of this branch → insert into `payment_relay_unknown` (1) + `payment_relay_unhealthy { unknown_intent }` (never skipped silently); a tenant-wide row or a non-`paid` row → skip, logged; `paid` → confirm by `status` when `has_status` (P7) — confirmed → apply (a `failed` intent included, `after_state 'failed'`, R2-M-2); `status` `retry` / no answer → **stop here** (cursor stays before this row; `stuck_since` set; > 10 min → `payment_relay_unhealthy { confirm_stuck }`); `failed` / `expired` on an open or watched intent → ⚠️ Changed by v0.2 hostile run 2 (R2-M-2): when `has_status`, a status call, and only its answer counts (never ends the intent by itself); without `has_status`, as a status answer; `in_progress` → `Confirming` if `ready` (R2-M-1); `pending` → no change. Cursor update per row passed (1). Response flag `endpoint_unhealthy` → `payment_relay_unhealthy { signature_failures }` |
| **Apply** | tx: re-read intent (1) → pre-read the ref in `provider_payment_refs` (1): same intent → `duplicate` (no-op, logged); another intent → unapplied `duplicate_txn` → amount / currency ≠ intent → `amount_mismatch` → intent already has an applied provider payment → `second_payment` → day of the intent closed → `day_closed` → frozen shift closed → `shift_closed` → else `providerPaymentDrafts` (05, ≤ 6): applied → `PaymentAdded` + `payment_references (source 'provider')` + ref row + `PaymentIntentSucceeded { applied: true, payment_no, after_state }`; not applied → `PaymentIntentSucceeded { applied: false, unapplied_reason }` + ref row + 01d `payment_unapplied`. ≤ 11 statements |
| Re-raise | after a `BusinessDayOpened`: unresolved provider payments → raise `payment_unapplied` again (1 read); relay still unhealthy → `payment_relay_unhealthy` again  ⚠️ Changed by v0.2 hostile run 2 (integration, 01d v1.3.7 R2-m-4): 01d's open-alert unique index refuses a raise while the expiring alert is still open, so the re-raise is attempted on **every worker pass** after `BusinessDayOpened` until it lands (dedupe makes the extra attempts no-ops), not once per day |
| Health | every 30 s per bound provider: `health()` and, for a provider with `has_webhook` and not `has_status`, last successful pull ≤ 30 s → in-memory `{ at, result }` read by §6.1. ⚠️ Changed by v0.2 hostile run 2 (R2-m-9): a pull failing (network, `401`, `5xx`) for > 2 min → `payment_relay_unhealthy { pull_failing }`; closed by the next successful pull |

Logs: intent id, provider key, outcome, short code only.

#### 6.5 `ResolveUnappliedPayment` — `{ provider_payment_id, resolution: 'applied_to_bill' | 'refunded' | 'kept', payment_id?, note? }` (`close-shift-for-others`)

Row read (1) → `404 PROVIDER_PAYMENT_NOT_FOUND` → `applied = 0` and unresolved, else `409 PROVIDER_PAYMENT_RESOLVED` → `applied_to_bill` needs `payment_id` of a live `PaymentAdded` with a `staff` reference (1) (⚠️ Changed by v0.2 hostile run 2 (R2-m-11): on the same `bill_id`, `direction 'in'`, amount equal to the provider payment's, and not named by another resolution (`provider_payments_resolved_payment`, read in the same statement)) (else `400`); `kept` needs a note → note to 05's `bill_texts` (1, when given) → append `ProviderPaymentResolved` → close the alert (01d). Statements ≤ 4. `hashOmit: ['note']`.

### Batch 2 — reads and admin

#### 6.6 `GET /queries/payment-intent?intent_id=` (`take-payment`, bill scope)

`{ intent_id, bill_id, split_no, state, outcome, amount_minor, currency_code, expires_at, watch_until, error_code, payments: [{ provider_payment_id, applied, unapplied_reason }] }`. ⚠️ Changed by v0.2 owner review (OR-3): no `display` field in the pilot (§13 adds the QR). **SDK parameters are never in this query.** 2 statements (intent + provider row; payments).

#### 6.6b `GET /queries/payment-intent-device?intent_id=` (**device token only**, row H-3; called by native)

Answers only when the token's device = `payment_intents.device_id` and the state is `ready` (else `404 PAYMENT_INTENT_NOT_FOUND`): `{ intent_id, amount_minor, currency_code, sdk_params }`. Never logged. 1 statement.

#### 6.7 `GET /queries/payment-intents?bill_id=` (`take-payment`, bill scope)

The bill's intents, newest first, at most 20 (a bill is bounded), with state, outcome, amount, provider, `error_code`, watch. 1 statement.

#### 6.8 `GET /queries/unapplied-payments?state=unresolved|resolved&cursor&limit` (`close-shift-for-others`)

⚠️ Changed by v0.2 hostile run 2 (R2-m-16): ~~unresolved first, then by `recorded_at` desc~~ one list per `state` (default `unresolved`), each on its own index (`provider_payments_unresolved` / `_resolved`), ordered by `(recorded_at, provider_payment_id)` desc, cursor = that pair (F §6.3, default 50, max 200): bill / token, amount, provider, reason, last 4 of the ref, resolution. Reads only 05c's tables. 1 statement.

#### 6.9 `SetPaymentCredential` (admin, `manage-payment-providers`) and `GET /admin/queries/payment-credentials`

`{ provider_key, name, secret: 1–1024 printable }`: provider registered and `name ∈ credentialNames`, else `400 VALIDATION_FAILED { path: 'payload.name' }` → upsert (1) → `PaymentCredentialSet`. `hashOmit: ['secret']`. The query lists provider × name → `set_at | null`, never the secret (1).

### Batch 3 — cloud relay (with the first webhook provider)

#### 6.10 `POST /v1/payments/webhooks/:endpoint_id` (cloud, guard scope `webhook-endpoint`, rows H-1, F-2)

Guard: `endpoint_id` → endpoint (1, `credential-lookup.ts`) → unknown → `404 PAYMENT_WEBHOOK_NOT_FOUND` → `setTenant`. Handler: body ≤ 16 KB raw (Fastify `413` mapped to `400 VALIDATION_FAILED`) → `verify({ headers, query, rawBody }, secret)`; a signed timestamp outside ±5 min fails (pending docs) → false → failure counter update (1) → `401 PAYMENT_WEBHOOK_SIGNATURE_INVALID` → `extract` → null (ignored type) → `200` → `INSERT … ON CONFLICT (tenant_id, provider_key, provider_event_id, outcome) DO NOTHING` (1) → `200 { data: { received: true } }`. ≤ 3 statements. The success / failure HTTP status the provider expects is pending docs.

#### 6.11 `GET /v1/sync/payment-notifications?after=<seq>&limit=` (cloud, branch API key, row H-2)

The key's **branch** rows plus the tenant's null-branch rows (⚠️ Changed by v0.2 hostile run 2 (R2-M-4); `payment_notifications_pull`), `limit` default 50 / max 200: `{ items: [...], next_after, endpoint_unhealthy: [{ provider_key, account_label }] }` (endpoints with ≥ 3 `401`s in the last 10 min). 2 statements.

#### 6.12 `PUT /v1/admin/payment-webhooks/:provider_key/:account_label` — `{ secret }`, and `GET /v1/admin/payment-webhooks` (cloud, JWT owner)

PUT: upsert (a new `endpoint_id` only on first set) (1) + config audit row `payment_webhook` (1) → `{ provider_key, account_label, endpoint_url, set_at }`, never the secret. GET: list without secrets (1).

---

## §7. Cross-cutting

### 7.1 Items

| Item | Decision (failure it prevents) |
|---|---|
| Logging | ids, provider key, outcome, short code only; never secrets, QR payloads, SDK parameters, provider refs, card or payer data |
| Privacy / PCI | No card data in our code or storage (§3.7); the cloud keeps no raw body and no payer data; ref last 4 to managers only, in `details` |
| Unknown outcome | Never shown as "not paid"; watched (P9a); a new charge on the intent's split needs a manager (P9a): a new tablet start, and (⚠️ Changed by v0.2 hostile run 2 (R2-M-5), **OWNER (default written)**) a manual `AddPayment` `in` on any mode, card machine and cash included (row B-2) |
| Webhook abuse | Guard read + body limit + signature before any write; timestamp tolerance when signed; failure counter (M-6). No extra limiter → §12.4 |
| Clock | All deadlines from `branchNow`; `steppingClock` in tests |
| Hub internet down | Start refused once health `failing` (≤ 60 s old); open intents become `unknown` and watched; late money via status or relay when the link returns |
| Cloud down | Providers with a status query still confirm; webhook-only providers are `failing` after 30 s without a pull |
| Restart mid-intent | Projections survive; the worker resumes; `create` retried with the same `intent_id` |
| Backups | USB backups carry `payment_credentials` (as `fiscal_credentials`, 05 B22) |
| LAN cleartext (⚠️ Changed by v0.2 hostile run 2 (R2-m-14)) | Native fetches the amount and `sdk_params` over LAN cleartext HTTP (05b H-3): a LAN attacker could read a bearer `sdk_params` or change the displayed amount. **Accepted residual risk** (05b O-14 form). The money taken is bounded by the provider's server-side order made by `create` with the intent's amount, so the device amount is display only, if Paymob confirms it (X-2 question); a mismatch is caught by P7's `amount_mismatch` |
| Performance | ≤ 1 open intent per bill; the worker reads 3 statements per tick; pull every 5 s per hub (≈ 17 000 small requests per hub per day) |

### 7.2 Middleware

Cloud webhook route: guard scope `webhook-endpoint` (tenant from the URL), then a raw-body parser for that route only (the signature is over the exact bytes), before the JSON parser.

### 7.3 Outside dependencies and STOPs

| # | Dependency | Blocks | State (2026-11-24) |
|---|---|---|---|
| ~~X-1~~ | ⚠️ Changed by v0.2 owner review (OR-3): Bank Alfalah Raast API — §13 | — | — |
| X-2 | **Paymob SoftPOS**: merchant onboarding (MID / terminal), SDK licence + Gradle artefact and repository credentials, SDK-vs-separate-app, server inquiry / callback, idempotent create. ⚠️ Changed by v0.2 hostile run 2 (R2-M-2, R2-m-14): whether a declined attempt ends the order or can be followed by an approved one on the same order (order-final `failed`, §3.4); the status values and their meaning (fixtures for test 30b); whether the charged amount comes from the server-side order only | **STOP-0** (⚠️ Changed by v0.2 owner review (OR-3): the only provider), STOP-C | Not started |
| X-3 | Paymob sandbox credentials (⚠️ Changed by v0.2 owner review (OR-3): was "for both"), a sandbox webhook pointed at the staging cloud | manual checks | Not started |
| ~~X-4~~ | ⚠️ Changed by v0.2 owner review (OR-3): PRA's code for Raast / QR (A13) — §13 | — | — |
| X-5 | Pilot tablet models certified by Paymob (NFC, Android version) | STOP-C | To check against 05b's models |
| X-6 | **Paymob's written confirmation that the 05b host app is eligible** (sideloaded, self-updated from the hub, device owner, lock task, WebView, LAN cleartext) | **STOP-0** (⚠️ Changed by v0.2 hostile run 2 (R2-M-6): was STOP-C) | Not asked |

---

## §8. Client contract

1. **Take-payment sheet** (`apps/client/src/features/billing/`): a provider-bound mode opens its panel instead of the amount pad's "Add". The amount shown is `card_due`, editable down (P4).
2. ~~Raast QR panel~~ and 3. ~~Customer display~~ — ⚠️ Changed by v0.2 owner review (OR-3): §13 Later.
4. **Card on tablet** (`PayNfcTablet`, phase 05c-C): shown only when `cardPaymentInfo().available` (native_api ≥ 2). Start → on `Ready`: `startCardPayment({ intent_id })` → "Tap the card on the back of this tablet — Rs 3,650 · waiting for card…" → any SDK result → `ReportPaymentIntentResult` → **"Checking with the bank… do not charge again"** until the server's answer (`Succeeded` → "Paid"; `Failed` → §8.5). Cancel is offered only before a tap (`ready`). ⚠️ Changed by v0.2 hostile run 2 (R2-m-8): on `PaymentIntentCancelled`, `PaymentIntentExpired` or `PaymentIntentFailed` for its own intent, the tablet page calls `cancelCardPayment({ intent_id })`, so the SDK stops waiting for a tap.
5. **Outcome panels** (`PayError`):
   - `PaymentIntentFailed` (server-final): "Payment didn't go through. Nothing was charged. Try again or choose another way." + short code (e.g. "card declined (05)"), "Try again" / "Pay later".
   - `Expired { outcome: 'unknown' }`, `Cancelled`, or a watched intent: "**We could not confirm this payment.** If the customer was charged, it will appear here by itself. Do not charge again." With "Customer says paid — keep waiting" (stays on the panel until `watch_until`) and "Charge again (manager)" (`override_watched`, needs `close-shift-for-others`; ⚠️ Changed by v0.2 hostile run 2 (R2-M-5): the same override is needed for the card machine or cash on that split, `AddPayment.override_watched`). **Never "Nothing was charged".**
   - `Expired { outcome: 'not_paid' }`: "No payment arrived. Try again or choose another way."
6. **Errors:** `PAYMENT_INTENT_PENDING` → "Another payment is in progress on this bill" (`open`) / "The last payment may still arrive" (`previous_watched`); `PAYMENT_PROVIDER_UNAVAILABLE` → "Card is not available right now — use the card machine, take cash or pay later" (⚠️ Changed by v0.2 owner review (OR-3)); `PAYMENT_MODE_NOT_FISCAL` → "This payment type can't be used on a tax invoice yet"; `PAYMENT_PROVIDER_FINAL` → "Card payments taken on the tablet can't be removed; refund in the provider portal" (⚠️ Changed by v0.2 owner review (OR-3)).
7. **Manager:** "Unapplied payments" (§6.8) with a resolve sheet (§6.5). ~~the `payment_unapplied` alert taps into it~~ ⚠️ Changed by v0.2 hostile run 2 (R2-m-10, R2-m-15): the alert has no `link` (01d v1.3.7), so its tap is today's tap; a recipient without `close-shift-for-others` (a custom role reached through `when_none`) sees the alert card only.
8. **Hub admin** `/admin/payments/`: credentials (set / replaced on date). **Owner app:** provider per mode + settings (A-1); webhook endpoints with the URL to copy (§6.12).
9. Urdu strings to the urdu-todo list; 05c prints nothing.

---

## §9. Error catalogue additions

| Code | Status | `details` | Condition |
|---|---|---|---|
| `PAYMENT_INTENT_NOT_FOUND` | 404 | `{ intent_id }` | §6.2, §6.3, §6.6, §6.6b |
| `PROVIDER_PAYMENT_NOT_FOUND` | 404 | `{ provider_payment_id }` | §6.5 |
| `PAYMENT_INTENT_PENDING` | 409 | `{ intent_id, reason?: 'open' \| 'previous_watched' }` | P3, P9a, P11 (rows B-2, B-3, Q-1, T-1, A-2, V-1) |
| `PAYMENT_INTENT_FINAL` | 409 | `{ intent_id, state }` | §6.2, §6.3 |
| `PROVIDER_PAYMENT_RESOLVED` | 409 | `{ provider_payment_id }` | §6.5 |
| `PAYMENT_PROVIDER_FINAL` | 409 | `{ payment_id }` | 05 §6.10 (row B-6) |
| `PAYMENT_PROVIDER_UNAVAILABLE` | 409 | `{ provider_key, reason: 'not_configured' \| 'failing' }` | §3.8 |
| `PAYMENT_MODE_NO_PROVIDER` | 422 | `{ mode_id }` | §3.8 |
| `PAYMENT_PROVIDER_DEVICE_UNSUPPORTED` | 422 | `{ provider_key, device_type }` | §3.8 |
| `PAYMENT_WEBHOOK_NOT_FOUND` | 404 | `{}` (cloud) | §6.10 |
| `PAYMENT_WEBHOOK_SIGNATURE_INVALID` | 401 | `{}` (cloud) | §6.10 |

Reused unchanged: `PAYMENT_MODE_NOT_FOUND`, `PAYMENT_MODE_NOT_FISCAL`, `PAYMENT_EXCEEDS_BALANCE`, `SHIFT_NOT_OPEN`, `BILL_NOT_OPEN`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `DEVICE_ACCESS_DENIED`, `BRANCH_API_KEY_INVALID`, `CONFIG_REFERENCE_INVALID`. Appended to F §6.2 and `errors.ts` at build (row F-1).

---

## §10. Tests

Hub tests on `fake` and `fakeRelay`, no network; `steppingClock`. Each numbered test has one matching test (F §6.7).

### 10.1 Pure (`packages/domain/src/payments/*.test.ts`, `packages/events`)

| # | Case |
|---|---|
| 1 | State machine: every allowed transition; `failed` only from a server answer or `create`; the clock never yields `not_paid` without a server `expired` / `failed`; `confirming` refuses cancel |
| 2 | Apply decision: each unapplied reason (incl. `day_closed`, `second_payment`, `duplicate_txn`); late success applied while a newer intent holds the bill |
| 3 | Event schemas parse fixtures; no field holds a ref, payload, secret or card data |
| 4 | Settings: `provider` only on digital modes, allowed kinds, one bound mode per provider, settings schema (row A-1) |

### 10.2 Hub commands (`apps/hub/test/payments/*.int.test.ts`)

| # | Case |
|---|---|
| 5 | `StartPaymentIntent` happy path; amount = `card_due`; `order_ids`; statements ≤ 8 |
| 6 | **PRA** (⚠️ Changed by v0.2 owner review (OR-3): was the Raast case, now §13): `PK-PB`, takeaway fiscalized, the Paymob card mode with `PRA` code `2` → Start passes the gate; the code removed in a later snapshot while the hub still has a stale mode → Start `422 PAYMENT_MODE_NOT_FISCAL`; a bound card mode without a `PRA` code → the settings PUT `422 CONFIG_REFERENCE_INVALID { field: 'payment_modes.N.authority_codes' }` |
| 7 | One test per §3.8 error of §6.1 (`PAYMENT_MODE_NOT_FOUND`, `PAYMENT_MODE_NO_PROVIDER`, `PAYMENT_PROVIDER_UNAVAILABLE` ×2, `PAYMENT_PROVIDER_DEVICE_UNSUPPORTED`, `SHIFT_NOT_OPEN`, `PAYMENT_INTENT_PENDING` ×2, `BILL_NOT_OPEN`, `PAYMENT_EXCEEDS_BALANCE`); partial amount |
| 8 | Retransmit → one intent; the command is not queueable |
| 9 | `CancelPaymentIntent`: `ready` → cancelled with `watch_until`; `creating` → cancelled with `watch_until: null`, not watched (⚠️ Changed by v0.2 hostile run 2 (R2-m-7)); `confirming` → `409 PAYMENT_INTENT_FINAL`; unknown → `404 PAYMENT_INTENT_NOT_FOUND` |
| 9a | Scope (M-1): a waiter scoped to own tables → `403` on Start, Cancel, Report for another's bill |
| 9b | `override_watched` without `close-shift-for-others` → `403`; with it → new intent with `overrides_intent_id`; ⚠️ Changed by v0.2 hostile run 2 (R2-M-5): the same for 05 `AddPayment.override_watched` → `PaymentAdded.overrides_intent_id` |
| 10a | Report `declined` → `confirming` (not cancelled, not failed); the bill stays held |
| 10b | Report `error`, then provider `paid` → one `PaymentAdded`; the client text was never "Nothing was charged" |
| 10c | Report from another device → `403 DEVICE_ACCESS_DENIED` |
| 10d | Report after success → `{ state: 'succeeded' }`, no write; unknown → `404` (⚠️ Changed by v0.2 owner review (OR-3): the `qr` half is §13) |
| 10e | Report `approved` stores `device_txn_ref` (hub state, not in any event); status called at once |
| 10f | ⚠️ Changed by v0.2 hostile run 2 (R2-M-3): cancel from the kiosk, then an `approved` report with a txn ref from the tablet → `{ state: 'cancelled' }`, ref stored, no event; status by that ref → late success applied (`after_state 'cancelled'`); a report on an unwatched ended intent → no write |
| 11 | `SetPaymentCredential` write-only (never in result, log, event, `processed_commands`); bad name → `400`; the query never selects the secret |
| 11a | **M-3:** `RemovePayment` of a provider-settled payment → `409 PAYMENT_PROVIDER_FINAL`; a staff-typed payment on the same mode is still removable |
| 12 | Permissions: `take-payment` (6.1–6.3, 6.6–6.7), `close-shift-for-others` (6.5, 6.8, override), `manage-payment-providers` (6.9) |

### 10.3 Worker (`apps/hub/test/payments/worker.int.test.ts`)

| # | Case |
|---|---|
| 13 | `creating` → `ready`; `rejected` → `provider_refused`; no answer for 20 s → `provider_unreachable` |
| 13a | Crash after the provider's `create ok`, before the Ready tx → restart → `create` again with the same `intent_id` → one Ready |
| 14 | `paid` → `PaymentAdded` (taken_by = starter, shift = frozen shift, `has_reference`), `source 'provider'`, `Succeeded { applied: true, payment_no: 1 }` in one tx |
| 15a | Card, no tap by `expires_at` (⚠️ Changed by v0.2 owner review (OR-3): was QR): final `pending` → `Expired { unknown }` + watched; final `expired` → `Expired { not_paid }`, not watched |
| 15b | Card tapped at `expires_at − 5 s` (hint) → no `Expired` while the provider says `pending`; after `confirm_window_ms` without an answer → `Expired { unknown }` |
| 15c | Provider `failed` → `Failed { declined }` — the only path to "not charged" for a card |
| 15d | ⚠️ Changed by v0.2 hostile run 2 (R2-M-1): `pending` polls in `ready` keep `ready` and Cancel is still allowed; `in_progress` → `Confirming { provider_in_progress }` |
| 16a | Paid 30 s after a cancel, status-only provider (no webhook) → found by the watch poll → applied (`after_state 'cancelled'`) |
| 16b | Paid after the split closed → unapplied `split_closed` + `payment_unapplied` |
| 16c | Paid after the day closed → unapplied `day_closed` |
| 16d | A second, different ref on a succeeded intent → `payment_no 2`, unapplied `second_payment` + alert |
| 16e | `ResolveUnappliedPayment` `applied_to_bill` / `refunded` / `kept` (note) → `ProviderPaymentResolved`, alert closed; ⚠️ Changed by v0.2 hostile run 2 (R2-m-11): `applied_to_bill` with a payment of another bill, another amount, or one already used by another resolution → `400`; second resolve → `409 PROVIDER_PAYMENT_RESOLVED`; unknown → `404 PROVIDER_PAYMENT_NOT_FOUND` |
| 16f | An unresolved `payment_unapplied` expires at day close and is raised again after the next `BusinessDayOpened` |
| 16g | ⚠️ Changed by v0.2 hostile run 2 (R2-M-2): relay `failed` then `paid` on the same intent (`has_status`) → the `failed` row only triggers a status call; one success; the client never showed "Nothing was charged" before the status answer |
| 16h | ⚠️ Changed by v0.2 hostile run 2 (R2-M-2): a late server-confirmed `paid` on a `failed` intent → `Succeeded { after_state: 'failed' }` (applied per P8) |
| 16i | ⚠️ Changed by v0.2 hostile run 2 (R2-m-6): watched + server `expired` → `WatchEnded { not_paid }`, `previous_watched` no longer answered; watch runs out → `WatchEnded { no_answer }` |
| 17 | Amount mismatch → unapplied `amount_mismatch` |
| 18 | Relay: a row for another branch's intent is not pulled (⚠️ Changed by v0.2 hostile run 2 (R2-M-4): branch filter); cursor advances; a row with only `provider_intent_ref` resolves its intent |
| 18b | ⚠️ Changed by v0.2 hostile run 2 (R2-M-4): a hub restored from a backup pulls a `paid` row of its branch for an intent it does not have → a `payment_relay_unknown` row + `payment_relay_unhealthy { unknown_intent }`; never skipped silently |
| 18a | Relay `paid` whose confirming status answers `retry` → the cursor stays; retried next tick; stuck 10 min → `payment_relay_unhealthy { confirm_stuck }` |
| 19a | Health `failing` → Start refused; recovered → accepted; a record older than 60 s → refused |
| 19b | Webhook-only provider with no successful pull for 30 s → `failing` |
| 19c | Pull answers `endpoint_unhealthy` → `payment_relay_unhealthy { signature_failures }` |
| 19d | ⚠️ Changed by v0.2 hostile run 2 (R2-m-9): pull failing for > 2 min → `payment_relay_unhealthy { pull_failing }`; closed by the next successful pull |
| 20 | Restart: an open intent past its deadline at boot is handled by the first tick |

### 10.4 Races and guards (`apps/hub/test/payments/races.int.test.ts`)

| # | Case |
|---|---|
| 21 | Relay and poll confirm the same ref in one tick → one `PaymentAdded`, the second is `duplicate` |
| 21a | Same ref seen on two intents → the second is unapplied `duplicate_txn` (pre-read; no unique violation) |
| 22 | Two devices start on one bill → one intent, the other `409 { reason: 'open' }` |
| 23 | Cancel commits while the worker holds a `paid` answer → the apply re-reads and records a late success (applied per P8) |
| 24a | Line guard: `RemoveItems`, `CompLine`, `SetLineWeight`, 04 `VoidItems`, void-preview, 05 `RemoveComp` on the bill's orders → `409 PAYMENT_INTENT_PENDING`; 04's guard still answers first when it applies |
| 24b | Merge guard: `MergeTables`, `SplitSeating` with the bill's seating → `409` |
| 24c | Day close with an open intent → `409`; with a watched one only → allowed |
| 24d | Approval `apply` of `discount`, `remove_service_charge`, `reopen_bill`, 04 void while open → refused, request still pending; accepted after the intent ends |
| 24e | 05: `AddPayment` / `CloseSplit` on the intent's split → `409`; on another split → allowed (m-10); ⚠️ Changed by v0.2 hostile run 2 (R2-M-5): `AddPayment` `in` on any mode (card machine, cash) on a **watched** intent's split → `409 { reason: 'previous_watched' }`; after `WatchEnded` → allowed |
| 24f | 05: `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `ReopenBill` → `409` |
| 24g | `CountShift` / `CloseShift` of the frozen shift → `409` |
| 24h | `SubmitOrder` adding to the bill, `RemoveDiscount` → allowed while open |
| 25 | A guard path left out would be visible: with every guard on, no test path lowers `card_due` while open |
| 26 | Unique backstop: a forced duplicate ref insert aborts the tx and the worker retries through the pre-read path |

### 10.5 Cloud (`apps/cloud/test/payments/*.int.test.ts`)

| # | Case |
|---|---|
| 27 | Webhook: good signature → row; bad → `401` + counter; unknown endpoint → `404`; > 16 KB → `400`; ignored type → `200`, no row; no payer field stored |
| 27a | `pending` then `paid` for the same provider txn → both rows kept (dedupe includes `outcome`); the same `paid` twice → one row, both `200` |
| 27b | A row with only `provider_intent_ref` is stored; neither ref → `400` (extractor refuses) |
| 27c | ~~One endpoint per tenant account: rows of branch B's intents reach both hubs' pulls; hub A ignores them~~ ⚠️ Changed by v0.2 hostile run 2 (R2-M-4): a per-branch endpoint's rows reach only that branch's pull; a tenant-wide endpoint's rows reach both pulls and the hub that does not find the intent skips and logs them |
| 28 | Pull: tenant filter, cursor, limit cap, `endpoint_unhealthy` after 3 `401`s in 10 min |
| 28a | Cross-tenant: an endpoint of tenant A never writes a row for tenant B; route inventory includes the `webhook-endpoint` scope |
| 29 | Endpoint PUT write-only; `endpoint_id` stable across secret changes |
| 29a | `credential-lookup.ts` is the only importer of the endpoint lookup (M55 (b) lint) |
| 30 | Verifier fixtures per provider (from the provider document, after its STOP) |
| 30b | ⚠️ Changed by v0.2 hostile run 2 (R2-m-13): Paymob status fixtures map to `pending` / `in_progress` / `paid` / `failed` (order-final only) / `expired` / `retry` |

### 10.6 Client and native

| # | Case |
|---|---|
| ~~31~~ | ⚠️ Changed by v0.2 owner review (OR-3): Raast panel test — §13 |
| 32 | Card panel: hidden below `native_api` 2; any SDK result shows "Checking with the bank… do not charge again" until the event |
| 33 | Outcome panels: "Nothing was charged" only on `Failed`; unknown / cancelled / watched texts; manager override button |
| 34 | (Gradle) plugin guard `/staff/` only; result whitelist drops any other field; amount comes from `payment-intent-device`, never from the page |
| 35 | (Manual, sandbox, per pilot tablet) NFC tap with a test card → server-confirmed; Wi-Fi off mid-tap → "Checking with the bank…", then the real outcome after reconnect |
| ~~36~~ | ⚠️ Changed by v0.2 owner review (OR-3): Raast manual sandbox check — §13 |

### 10.7 Acceptance

| Source | Check | Test |
|---|---|---|
| G-12 card by NFC | Start → SDK → server-confirmed `PaymentAdded` with the provider ref | 14, 32, 35 |
| G-12 automatic AddPayment with reference | `source 'provider'`, `has_reference`, no ref in any event; not removable | 3, 11a, 14 |
| G-12 failure states (PayError) | "Nothing was charged" only after a server failure | 10a, 10b, 15c, 33 |
| No double charge | device / clock never decide "not paid"; watch; manager override | 10a, 15a, 15b, 16a, 9b |
| Exactly once / no lost money | duplicate, second payment, relay stuck | 16d, 18a, 21, 21a, 27a |
| Bill changed meanwhile | every guard path | 24a–24h |
| PRA A13 | the card mode passes the fiscal gate with code `2`; a removed code refuses Start (⚠️ Changed by v0.2 owner review (OR-3)) | 6 |
| G-13 | not queueable; no intent offline | 8, 19a |

---

## §11. Build order

**05c-1 — provider-neutral, now** (each task: tests first). ⚠️ Changed by v0.2 hostile run 2 (R2-M-6) — **OWNER (default written):** only pure rules and client mocks; tasks 1–2 move behind STOP-0 because a "no" from Paymob would leave them dead (codes, a permission in the roles editor, two alert kinds nothing raises, a migration, a 05 behaviour change).
1. ~~§9 codes in `errors.ts` (row F-1); permission `manage-payment-providers` (R-1); alert kinds `payment_unapplied`, `payment_relay_unhealthy` (D-1, D-2, with 01d v1.3.7).~~ → after STOP-0 (task 4a).
2. ~~Hub `0030_payment_reference_source.sql`; 05 rows B-4, B-6, B-7 — test 11a; 05 tests re-run.~~ → after STOP-0 (task 4b).
3. Pure state machine and apply decision (`packages/domain/src/payments/`) — tests 1, 2 (code, not a contract: changeable until STOP-0).
4. Client panels and outcome texts on client-side mocks — test 33 (part).

**STOP-0 — the Paymob document (X-2) is in hand** (⚠️ Changed by v0.2 owner review (OR-3): was "X-1 or X-2"); ⚠️ Changed by v0.2 hostile run 2 (R2-M-6) — **OWNER (default written):** **and** Paymob's written host-app eligibility (X-6, Q-B) **and** a proven server confirmation path (inquiry or callback, Q-C). Re-review §3.4, §5.1, §5.2 against it in a fresh session; then freeze the event payloads and the port. Nothing below is merged before. If any of the three is "no", card stays manual (Q-B / Q-C) and nothing of 05c beyond tasks 3–4 exists.

**05c-2 — core (on `fake`):**
4a. §9 codes in `errors.ts` (row F-1); permission `manage-payment-providers` (R-1); alert kinds `payment_unapplied`, `payment_relay_unhealthy` (D-1, D-2, with 01d v1.3.7) (⚠️ Changed by v0.2 hostile run 2 (R2-M-6): was task 1).
4b. Hub `0030_payment_reference_source.sql`; 05 rows B-4, B-6, B-7 — test 11a; 05 tests re-run (⚠️ Changed by v0.2 hostile run 2 (R2-M-6): was task 2).
5. Event schemas + fixtures — test 3.
6. Billing settings `provider` field + PUT checks + owner form (A-1) — tests 4, 6.
7. Hub `0031_payment_intents.sql` + projections.
8. 05 row B-1 exports.
9. Port, registry, `fake`; 05c's own wiring check; `SetPaymentCredential` + admin query (P13) — test 11.
10. `StartPaymentIntent`, `CancelPaymentIntent`, `ReportPaymentIntentResult` — tests 5, 7–10e, 12, 22.
11. Worker: create, poll, deadlines, watch, apply, health — tests 13–17, 19a, 20, 21, 21a, 23, 26.
12. Guards: rows Q-1, T-1, A-2, B-2 (with the R2-M-5 `AddPayment` watched hold), B-3, V-1 — tests 24a–24h, 25.
13. `ResolveUnappliedPayment`, queries §6.6–§6.8, re-raise — tests 16e, 16f.

**Relay (with Paymob, if it confirms by webhook):**
14. Cloud `0022_payment_relay.sql`, guard scope `webhook-endpoint` (H-1, F-2, F-3), §6.10–§6.12 (H-2) — tests 27–29a.
15. Hub relay pull, cursor-stop rule, unknown-intent rows (R2-M-4), health — tests 18, 18a, 18b, 19b, 19c, 19d.

**05c-C — card. STOP-C: X-3 (sandbox) and X-5 (certified pilot tablet models)** (⚠️ Changed by v0.2 hostile run 2 (R2-m-4, R2-M-6): X-2, X-6 and the server confirmation are STOP-0; Q-B / Q-C are answered):
16. 05b rows N-1, N-2 (plugin, `native_api` 2, whitelist, Gradle, CI secret) — test 34. 17. `paymob_softpos` adapter + verifier — tests 30, 30b. 18. Card panel, `payment-intent-device` (H-3) — test 32. 19. Manual NFC check — test 35.

~~**05c-R — Raast, optional.**~~ ⚠️ Changed by v0.2 owner review (OR-3): tasks 20–22 moved to §13 Later.

19 tasks (⚠️ Changed by v0.2 owner review (OR-3): was 22; ⚠️ Changed by v0.2 hostile run 2 (R2-M-6): tasks 1–2 renumbered 4a–4b, same count). 4 device commands + 1 admin command + 4 queries + 1 admin query + 4 cloud routes (webhook, pull, endpoint PUT, endpoint GET) = **14** endpoints: above the ~10 of v0.1, within the README size budget (~30).

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–30b and 32–34 green in the gate (`tablet.yml` for 34); ⚠️ Changed by v0.2 hostile run 2 (R2-m-13): the relay tests (18, 18a, 18b, 19b – 19d, 27 – 29a, the verifier part of 30) only when the relay ships (Paymob `has_webhook`); 35 done on sandbox and the pilot tablets (⚠️ Changed by v0.2 owner review (OR-3): 31 and 36 are §13).
- 05, 02b, 02a, 01a, 04, 01b, 01d, 00 HPA, 05b v1.1, Foundation (F-2, F-3), README carry the §4.5 rows.
- A counter dry run on sandbox: 10 card payments, including one Wi-Fi drop mid-tap and one card intent cancelled before a tap (⚠️ Changed by v0.2 owner review (OR-3)). Each has exactly one `PaymentAdded` or one unapplied provider payment resolved by a manager, and the Z by mode matches the provider's sandbox list.

### 12.2 Endpoint checklist

| § | Command / query / route | Codes |
|---|---|---|
| 6.1 | StartPaymentIntent | 200, 400, 403, 404, 409, 422 |
| 6.2 | CancelPaymentIntent | 200, 400, 403, 404, 409 |
| 6.3 | ReportPaymentIntentResult | 200, 400, 403, 404, 409 |
| 6.5 | ResolveUnappliedPayment | 200, 400, 403, 404, 409 |
| 6.6 | payment-intent | 200, 400, 403, 404 |
| 6.6b | payment-intent-device (device token) | 200, 400, 401, 404 |
| 6.7 | payment-intents | 200, 400, 403 |
| 6.8 | unapplied-payments | 200, 400, 403 |
| 6.9 | SetPaymentCredential / payment-credentials (admin) | 200, 400, 401, 403 |
| 6.10 | cloud webhook | 200, 400, 401, 404 |
| 6.11 | cloud pull | 200, 400, 401 |
| 6.12 | cloud endpoint PUT / GET | 200, 400, 401 |

### 12.3 Owner decisions — answered (⚠️ Changed by v0.2 hostile run 2 (R2-m-4): was "BLOCKER-for-approval"; every question is answered, owner 2026-11-24; the run 2 OWNER defaults R2-M-5, R2-M-6 are written into P9a, row B-2 and §11, pending the owner)

| # | Decision | Recommended default |
|---|---|---|
| ~~**Q-A**~~ | ⚠️ Changed by v0.2 owner review (OR-3): **answered by the owner — no Raast at the pilot**; the PRA code question moves to §13 Later | — |
| **Q-B** ✅ **ACCEPTED (owner 2026-11-24)** | **Paymob SoftPOS inside the 05b app.** If Paymob needs Play distribution, a separate app, or no device-owner / lock task / cleartext, is card-on-tablet still wanted? | **Only if Paymob confirms the 05b host in writing (X-6)**; otherwise the counter card machine stays (`PayCard`, manual mode with reference) for the pilot |
| **Q-C** ✅ **ACCEPTED (owner 2026-11-24)** | **Device result as proof.** | **Never** proof of *paid* and never proof of *not paid*. Without a Paymob server confirmation (inquiry or callback), card stays manual |
| **Q-D** ✅ **ACCEPTED (owner 2026-11-24)** | **One merchant account per tenant or per branch** (Paymob; ⚠️ Changed by v0.2 owner review (OR-3)) | **Per branch** at the provider (cleanest money trail per branch), but the relay is keyed per **(tenant, provider account)** and the hubs filter by intent, so one tenant-wide account also works if the providers require it |
| **Q-E** ✅ **ACCEPTED (owner 2026-11-24)**, ⚠️ Changed by v0.2 owner review (OR-4): plus the Owner role when no manager is present (row D-1) | **Who resolves unapplied money, and is `ResolveUnappliedPayment` in the pilot** | **Managers (`close-shift-for-others`); the command is in the pilot (05c-2)**; resolutions are `applied_to_bill`, `refunded`, `kept` with a note |

### 12.4 Open questions (not blocking)

| # | Question | Default |
|---|---|---|
| OQ-2 | Card-by-NFC at the table by waiters, or at the counter only? (B11 lands it in the waiter's own shift) | Any tablet whose person has `take-payment` and an open shift |
| OQ-5 | Manual `AddPayment` on a provider-bound mode (the card machine, without the tablet; ⚠️ Changed by v0.2 hostile run 2 (R2-m-1)) | Allowed, as today; reference per the mode's `reference_required`; ⚠️ Changed by v0.2 hostile run 2 (R2-M-5): held while an intent of that split is open or watched (manager override) |
| OQ-7 | Migration numbers hub `0030` / `0031`, cloud `0022` | Renumber at build |
| OQ-8 | `tap_window_ms` (⚠️ Changed by v0.2 hostile run 2 (R2-m-1): was `display_ttl_ms`), `confirm_window_ms`, `late_window_ms` (defaults 120 s / 90 s / 10 min card; ⚠️ Changed by v0.2 owner review (OR-3): the Raast defaults are §13) | Paymob's values once known |
| OQ-9 | New permission `manage-payment-providers` or reuse `manage-fiscal-settings` | New key |
| OQ-10 | Approval `apply` refused while an intent is open (P11 (d)): refuse (approver retries), or hold the answer until the intent ends? | Refuse |

### 12.5 Deferred until needed

| Item | Why not now |
|---|---|
| Provider refunds / `out` through a provider | R7 P2; portal refund + manual `AddPayment out` |
| Settlement reconciliation, fees, chargebacks | R7 P2 |
| Cloud notification retention job | ≈ 200 small rows per branch per day |
| Webhook rate limiter / unknown-endpoint cache | Guard read + body limit + signature before any write |
| Cash or intents while the hub is unreachable | G-13 |
| Other providers, ECR terminals | Not asked |
| Cloud → hub push channel | A 5 s pull is enough at 3 branches; 06 not built |

### 12.6 Hostile self-review (v0.2)

| Check | Result |
|---|---|
| "Not paid" decided by anything but the provider's server | No: device hints → `confirming`; the clock → `unknown` + watch (B-1) |
| Late money after the end | Watch window + polling + relay cursor stop (B-2) |
| Second payment | New provider payment, unapplied + alert (B-2) |
| Raast on PRA | ⚠️ Changed by v0.2 owner review (OR-3): out of the pilot (§13) |
| Scope | `billAccess` on every staff command (M-1) |
| Bill moves under the customer | Line, merge, day-close guards; kinds' apply; 05 commands (M-2) |
| Provider payment removed | Refused (M-3) |
| Cloud routing / dedupe | Per tenant account; outcome in the key; ref-or-intent (M-4) |
| D54 / M55 | New guard scope; Foundation rows for the other writer (M-5) |
| Silent relay failure | Health includes the relay; 401 counter; alert (M-6) |
| Unapplied lifecycle | Kind declared, re-raised, resolved by a command (M-7) |
| PCI / page-chosen amount | Native fetches the amount; whitelist; X-6 STOP (M-8) |
| Invented provider shape | Minimal port; STOP-0 freeze; 05c-1 provider-neutral (M-9) |
| Remote call on the request path | None (health is a cached record) |
| N+1 | Every query ≤ 2 statements; the worker reads 3 per tick |
| Over-engineering | `currencies`, per-mode core `environment`, `device_types`, two-speed pull cut; no outbox, no push channel, no new stream type |
| Event count | ⚠️ Changed by v0.2 hostile run 2 (R2-m-12, R2-m-6): **Ten** (nine on the bill stream, one hub): the asked five + `Ready` (the SDK parameters exist only after `create`), `Confirming` (a held bill waiting for the server, B-1), `WatchEnded` (the watch's outcome, R2-m-6), `ProviderPaymentResolved` (M-7), `PaymentCredentialSet` (audit) |

---

## §13. Later — Raast (out of the pilot) ⚠️ Changed by v0.2 owner review (OR-3)

The owner took Raast out of the pilot on 2026-11-24. Nothing below is built for the pilot; it is kept so a later bump can restore it. The counter card machine with a typed reference is the fallback for card, and cash for everything else. When Raast comes back, this section goes through its own re-review and owner approval, and adds: ~~the `qr` value of the port's `display`, of `PaymentIntentCreated.display_kind` (a new enum value) and of `payment_intents.display_kind` (a table-rebuild migration, the 05a `0027` pattern)~~ ⚠️ Changed by v0.2 hostile run 2 (R2-m-2): the port's `display` field, `display_kind` on `PaymentIntentCreated` (a new event version) and a `payment_intents.display_kind` column without a CHECK (the pilot has none); the QR deadline (v0.2 P9: `expires_at = ready_at + display ttl`, default 300 s, a final status call, `not_paid` / `unknown`); the 30 min watch window default (P9a); the QR display of P10 and §6.6 (`display: { kind: 'qr', qr_payload, qr_svg } | null`, the hub's `qrcode` 1.5.4); `ReportPaymentIntentResult` refusing a `qr` intent (`400`); kinds `online` / `wallet` in P2; the owner form choice "Bank Alfalah Raast" (row A-1).

### 13.1 `alfalah_raast` (was §3.6)

| Item | Draft |
|---|---|
| Integration | Bank Alfalah merchant API for Raast P2M **dynamic** QR (amount + reference in the QR). Access asked by email 2026-11-23 |
| `create` | Ask the bank for a QR with amount and reference; or build it locally if the bank allows it (pending docs) |
| Reference | Whether a 26-char ULID fits the QR's reference field (EMVCo additional data is often ≤ 25 chars); if not, the bank's QR id is the key (`provider_intent_ref`) (pending docs) |
| `status` | Whether a status API exists, and by which key (pending docs) |
| Webhook | Whether one exists, and its signature scheme (header HMAC, query signature, mTLS, IP list) (pending docs). The extractor stores only §5.3 fields; **payer name, account / IBAN, CNIC and phone are never stored** |
| Withdraw | Assumed **not** possible → `cancel: 'not_supported'`, `late_window_ms` 30 min until the bank says otherwise |
| Paid twice | Whether a dynamic QR can be paid more than once (P6 handles it either way) |
| Mode | `kind: 'online'` (or `wallet`), `payment_class: 'digital'`; on `PK-PB` only with a PRA code (P16) |

### 13.2 Raast QR panel and customer display (was §8.2, §8.3)

2. **Raast QR panel** (`PayRaast`, phase 05c-R): Start → "Preparing QR…" → on `Ready` fetch §6.6 → QR, amount, countdown, "Waiting for payment… closes by itself when paid". On the kiosk it posts `{ intent_id, qr_svg, amount_minor, expires_at, state }` on `BroadcastChannel('pos-customer-display')`, and a `clear` when leaving the panel or the screen and on `pagehide` (m-9). `Succeeded { applied: true }` → "Paid". "Pay later" / "Cash instead" → hide the QR on both screens **first**, then `CancelPaymentIntent`; the panel then says "Cancelled. If the customer already paid, it will appear here by itself." (watched).
3. **Customer display** (`CustomerDisplayRaast`): the QR while `ready`; "Paid ✓" on success; clears on any end event, on `clear`, and by itself at `expires_at`.

### 13.3 PRA (was P16, Q-A, X-4)

On `PK-PB` with any order type fiscalized, the settings PUT refuses an active Raast mode without a `PRA` authority code (§2), manual or through 05c, until PRA gives a `PaymentMode` code for Raast / QR (A13). v0.2's Q-A, kept for the record:

| # | Decision | Recommended default |
|---|---|---|
| **Q-A** ⛔ | **PRA code for Raast on the pilot branch.** On a PRA branch Raast is impossible, manual or through 05c, until PRA gives a `PaymentMode` code (B-3). Options: (1) ask PRA in writing now and ship 05c-R only if the code arrives by a set date; (2) no Raast at the pilot; (3) start the pilot branch on jurisdiction `PK` (breaks R37: not recommended) | **(1) with a cut-off of 2027-01-31; if no code by then, (2): Raast is not accepted at the pilot**, 05c-R waits. Card (code 2) is not affected |

### 13.4 Dependencies, STOP-R, tasks and tests (were X-1, X-4, §11 tasks 20–22, tests 31, 36)

| # | Item |
|---|---|
| X-1 | **Bank Alfalah** Raast P2M merchant API: document, sandbox, QR rule and reference length, status API, webhook + signature, QR validity, withdraw, pay-twice, idempotent create (email sent 2026-11-23; no answer) |
| X-4 | **PRA's `PaymentMode` code for Raast / QR (A13)**, in writing |
| STOP-R | X-1, a Raast sandbox, and X-4 |
| Tasks | 20. `alfalah_raast` adapter + verifier — test 30. 21. Raast panel + customer display — test 31. 22. Manual sandbox check — test 36 |
| Test 31 | Raast panel: QR after Ready; closes on Succeeded; hides the QR before Cancel; `clear` on leaving and on `pagehide`; customer display clears at `expires_at` |
| Test 36 | (Manual, sandbox) QR paid from a bank sandbox app → kiosk and customer display close; QR paid after Cancel → late success |
| Test 6 (Raast half) | a Raast mode without a `PRA` code → the settings PUT `422 CONFIG_REFERENCE_INVALID` |
| Test 10d (QR half) | Report on a `qr` intent → `400` |
