# 05 Billing: P0.G gap sweep

Scope: every name, signature, export, table, column, helper and statement count used by the 0b and later 05 tasks (P0.2-P0.18, 5-7, P0.F, P0.Sb, the 05-1/05-2 command lanes, the client lanes), checked against this branch including the merged 0a code. Extra weight on spec section 12.7 (f).
Base commit: 600b0b22 (origin/module-05), spec 05 v1.0.1. Date: 2026-11-19.
Method: read-only. Each plan row was compared with the spec and with the code on this branch (file:line). Nothing was edited, committed or pushed during the sweep. The plan was patched after the owner ruled (see `05-plan.md`, "Gap sweep patches (P0.G …)").

## Ruled before P0.G (owner, 2026-11-19; board R-1 … R-4)

Binding for the 05 v1.0.2 and P0.2c writers.

- R-1 (Q-A a): an unresolved service-charge tax profile blocks close with `BILL_CLOSE_BLOCKED { reason: 'tax_unresolved' }`, `order_item_ids` holding the literal `'service_charge'` while the split's charge > 0; never billed untaxed. Code #284 (`compute.ts` `SERVICE_CHARGE_ID`); one sentence in 05 v1.0.2 §3.3 3a / §3.4.
- R-2 (Q-B a): the frozen discount is re-spread over the open `bill_discount_lines` on every read; a ±1 minor-unit move after a sibling close is accepted for v1.0. Note in 05 v1.0.2 §3.5 (2).
- R-3 (S-1 a): A-1 (3) wire names `discount_reasons`, `petty_categories`, `receipt` (container) + `show` (toggles), `rate_overrides` (code #276). Text in 01a v2.6 (P0.2c).
- R-4 (S-2 a): kind 'cash' ⇒ class 'cash' only (A-2 as written). 05 v1.0.2 corrects the §4.4 comment ("⇔").

## Summary

| G | Severity | Tasks | Spec change? |
|---|----------|-------|--------------|
| G-1 | Major | 5, 10, 17, 29a/b, 4a | 05 v1.0.2 (section 6.12 step 7 wording) |
| G-2 | Minor | 4a, 29b, 31 | 05 v1.0.2 (one sentence in 3.16/B21) |
| G-3 | Major | 5, 4a, P0.9b | 05 v1.0.2 (null mapping) |
| G-4 | Major | 29a/b, 30 | 05 v1.0.2 (section 3.15) |
| G-5 | Minor | 29b, 30 | 05 v1.0.2 (one sentence) |
| G-6 | Major | 29b | 05 v1.0.2 (section 5 comment) |
| G-7 | Minor | 29a/b | No |
| G-8 | Major | 17, compute | No (J-2 already says it) |
| G-9 | Minor | 4a | 05 v1.0.2 (P0.1b: Z `report` embeds `mode_name` / `category_name`) |
| G-10 | Major | P0.Sb | No |
| G-11 | Major | 17 | 05 v1.0.2 (P0.1b: R-13 config rule) |
| G-12 | Minor | 31 | No |
| G-13 | Blocker | P0.8, P0.9b | No (owner question Q-1) |
| G-14 | Blocker | 10, 17, 4a, P0.2g, P0.12 | P0.2x text |
| G-15 | Blocker | 10 and every command task | P0.2x (new row U0) |
| G-16 | Blocker | P0.7 | No (settled by F D46) |
| G-17 | Major | P0.5 | No |
| G-18 | Minor | P0.6, P0.11, P0.14 | No |
| G-19 | Major | P0.15 | No |
| G-20 | Major | 7, P0.15, P0.7 | No |
| G-21 | Blocker | P0.18 | No |
| G-22 | Minor | 31 | 05 v1.0.2 (tweak "the worker re-raises") |
| G-23 | Major | P0.9b, P0.10 | 05 v1.0.2 (A-1 defaults, R-10 / R-14) |
| G-24 | Minor | 4a | No |
| G-25 | Minor | 4a, compute | No |
| G-26 | Major | P0.13, client lanes | No |
| G-27 | Minor | various | No |
| G-28 | Major | 27, 38 | 05 v1.0.5 (§6.23a `GET /queries/bill-printers`, owner ruling R-27) |
| G-29 | Major | 10, 35, 36 | 05 v1.0.6 (§6.1 `added_after_close`, pinned `blocks`, `reopen_count`; owner ruling R-29) |
| G-30 | Minor | P0.11d, 7, 11, 19, 33 | 05 v1.0.6 row T-4 + 02a v1.1.9 (owner ruling R-30 (b)) |
| G-31 | Major | P0.9b, P0.10 | 05 v1.0.6 row A-1 (1) + 01a v2.7 (owner rulings R-31, R-32) |
| G-32 | Major | P0.14, 24 | 05 v1.0.6 row Q-3 + 02b v1.0.17 (owner ruling R-33) |
| G-33 | Minor | P0.13 | 05 v1.0.6 row Q-6 + 02b v1.0.17 (owner ruling R-34) |
| G-34 | Minor | P0.17, 10, 38 | 05 v1.0.6 row P-2 + 03c v1.0.13 (owner ruling R-35) |
| G-35 | Major | P0.5, P0.6 | 00 v1.12.1 M89 + 01a v2.7.1 (owner ruling R-37) |
| G-36 | Minor | P0.16 | 05 v1.0.6 row P-1 + 03c v1.0.14 (owner ruling R-38) |
| G-37 | Major | 5, 7, 19 | 05 v1.0.7 (`BillReopened.mode`, §3.10, §5, §6.13, §6.29, #37i; owner ruling R-40) |
| G-38 | Major | 5, 7, 17, 33 | 05 v1.0.7 (`DiscountFrozen`, §5, §6.12, §6.29, #16d; owner ruling R-41) |
| G-39 | Major | 5, 8, 16, 21 | 05 v1.0.7 (`ShiftCounted.variance_alert_id`, §5, §6.17, §6.29, #50d; owner ruling R-42; `PaymentRemoved` money fields, #47b, owner ruling R-44 — resolved) |
| G-40 | Major | P0.11d, 19 | 02a v1.1.11 + 05 v1.0.7 row T-4 (`TableMarksChanged.alert_id`, #6c, 02a #68; owner ruling R-43) |
| G-41 | Minor | P0.10 | 01a v2.7.2 §8.1 ("Needs a category" only while the branch jurisdiction has profile rows; owner ruling R-45) |
| G-42 | Major | P0.Sb, 17 | 05 v1.0.8 §6.12 step 6, H8-3 (`fiscal.required` false under adapter `none`; owner ruling R-46) |
| G-43 | Minor | 9, 19 | 05 v1.0.9 §6.13 (`reopen_bill` values `reason_code`; R-47) |
| G-44 | Minor | 9, 22 | 05 v1.0.9 H4-4 (`petty_cash` values, no `note_id`; R-48) |
| G-45 | Minor | 9 | 05 v1.0.9 §3.14 (request kinds family `urgent`; R-49) |
| G-46 | Minor | 29b, 31 | 05 v1.0.9 §3.15 (`last_error` `config_missing`, `invoice_missing`; R-50) |
| G-47 | Minor | 15 | 05 v1.0.10 §6.16 (`payments_count`; R-51) |
| G-48 | Minor | 12 | 05 v1.0.10 §3.8 (equal re-spreads a later round; R-52) |
| G-49 | Minor | 12 | 05 v1.0.10 §3.8 (paid split keeps its number only; R-53) |
| G-50 | Minor | 11 | 05 v1.0.10 §6.4 (`BillRequested` fold ≤ 10; R-54) |
| G-51 | Minor | 4b | 05 v1.0.10 §3.16 (bad QR payload skipped; R-55) |
| G-52 | Major | 0024 (new row), 15, 21, 26a | 05 v1.0.11 §5 (`bill_payments_shift` index, migration 0024; R-56) |
| G-53 | Minor | 15 | 05 v1.0.11 §6.15 (drawer kick on the device's own route only; R-57) |
| G-54 | Minor | 14 | 05 v1.0.12 §9 (`SERVICE_CHARGE_NOT_APPLIED`; R-58) |
| G-55 | Minor | 14 | 05 v1.0.12 §6.8 (second remove returns the open request; R-59) |
| G-56 | Minor | 14 | 05 v1.0.12 §6.8 (no totals in the result; R-60) |
| G-57 | Minor | 14 | 05 v1.0.13 §6.8 (rate 0 = no charge applied; R-61) |
| G-58 | Minor | 20 | 05 v1.0.14 §6.14 (deal part alone refused; R-62) |
| G-59 | Major | 31a | 05 v1.0.14 §6.28b (admin read for the fiscal page; R-63) |
| G-60 | Minor | 17, 24, 3b | 05 v1.0.14 B15 / §10 (unit sum holds for item splits; R-64) |
| G-61 | Minor | 32a | 05 v1.0.15 V-3 / §6.30 / §10 (raised row carries no kind; R-65) |
| G-62 | Major | 19 | 05 v1.0.15 §6.13 (`reopen_bill` values carry `credit_invoice_ids`; R-66) |
| G-63 | Minor | 18 | 05 v1.0.16 §6.11 (`WaiveBuyerId` ≤ 6 statements; R-67) |
| G-64 | Minor | 18 | 05 v1.0.16 §6.11 / §3.14 (approval on an already-waived bill writes a second `BuyerIdWaived`; R-68) |
| G-65 | Minor | 32a | 05 v1.0.16 V-3 / §6.30 / §6.28a (`fiscal_token_changed` subject `hub`; R-69) |
| G-66 | Minor | 27 | 05 v1.0.16 §6.23 (`RetargetBillPrint` ≤ 3 statements; R-70) |
| G-67 | Minor | 31a | 05 v1.0.16 §6.28a (`SetFiscalToken` ≤ 2 statements; new `command_id` per Save; R-71) |
| G-68 | Minor | 32a | 04 (later bump): 04 §5's audit subject list gains `hub` (05 V-3, R-69); 04's code already uses `item` and `zone`, also not on the list — add them in the same bump. Not in 05 v1.0.16; 04's spec is not edited here |
| G-69 | Minor | 19 | 05 v1.0.17 row Q-7 / §3.10 (05's order-cancelled hook statements count on top of 02b's and 04's cancel / void counts; 02b and 04 tests +1; R-72) |
| G-70 | Minor | 16, 19 | 05 v1.0.17 §6.9 (`AddPayment` ≤ 8 on the empty-close path only, else ≤ 7; R-73) |
| G-71 | Minor | 19 | 05 v1.0.17 §6.13 / §3.14 (stale `reopen_bill` approve → `BILL_NOT_OPEN { bill_id, state }`, no new code; R-74) |
| G-72 | Minor | 19 | 02b and 04 (later bumps): their cancel / void statement counts gain "plus the registered hooks' statements" (05 row Q-7, R-72). Not in 05 v1.0.17; 02b's and 04's specs are not edited here |
| G-73 | Minor | 23 | 05 v1.0.18 §3.16, §5, §6.21 (`OpenCashDrawer` writes no `bill_print_jobs` row; result `{ shift_id, printed }`; ≤ 4 statements; CHECK keeps unused `no_sale`; R-75) |
| G-74 | Minor | 21, 25 | 05 v1.0.18 §6.25, §3.13, §3.14 (day close refused while a `shift_variance` request is pending, `DAY_CLOSE_BLOCKED { reason: 'variance_pending' }`, no new code; day-close bound ≤ 11; `apply`'s `BUSINESS_DAY_NOT_OPEN` guard unreachable; tests #50b, #50c, #62, #62b; R-76) |
| G-75 | Minor | 22 | 05 v1.0.18 §3.12 (`SettlePettyAdvance` takes `entry_id`, not `advance_id`; R-77) |
| G-76 | Minor | 21 | 05 v1.0.18 §6.17–§6.19 (`closed_requests`, `open_advances` named; no `{ pending }`; `HandoverCount` ≤ 2; requester = the counter; R-78) |
| G-77 | Minor | 25 | 01a (later bump) and client: row A-5's day-close listing names `shift_open` / `unbilled_orders` only; it gains `variance_pending` (05 R-76), with EN + UR `DAY_CLOSE_BLOCKED_variance_pending` keys on `/admin/stock` and the staff app. Not in 05 v1.0.18; 01a's spec is not edited here |

Counts: Blocker 5, Major 12, Minor 10 (27 rows). G-28 (Major) added 2026-11-19 after the sweep: Blocker 5, Major 13, Minor 10 (28 rows). G-29, G-31 (Major) and G-30 (Minor) added 2026-11-19 from the 05 design brief (PR #316): Blocker 5, Major 15, Minor 11 (31 rows). G-32 (Major) and G-33 (Minor) added 2026-11-19: Blocker 5, Major 16, Minor 12 (33 rows). G-34 (Minor) added 2026-11-20: Blocker 5, Major 16, Minor 13 (34 rows). G-35 (Major) added 2026-11-20: Blocker 5, Major 17, Minor 13 (35 rows). G-36 (Minor) added 2026-11-20: Blocker 5, Major 17, Minor 14 (36 rows). G-37 (Major) added 2026-11-20: Blocker 5, Major 18, Minor 14 (37 rows). G-38, G-39, G-40 (Major) added 2026-11-20 from the task 5 review: Blocker 5, Major 21, Minor 14 (40 rows).

## G-1 When a snapshot counts as fiscalized
Severity: Major. Tasks: 5, 10, 17, 29a/b, 4a.
What the task says: section 3.1 defines "Fiscalized" as `fiscalize:true` and adapter not `none`; section 6.12 step 7 says "when `required`".
What the code has: `required` alone in `fiscal-snapshot.ts:35-36` and `docs.ts:184`; `outbox.ts:67` uses `required && adapter_key !== 'none'`.
Options: (a) leave the three tests different; (b) one shared `isFiscalized(snapshot)`.
Rec: (b) in `@pos/domain`, used by outbox.ts and docs.ts; a task-5 Zod refine forbidding `required && adapter_key==='none'`; section 6.12 step 7 wording "when fiscalized (3.15)".

## G-2 Rejected invoice reprints
Severity: Minor. Tasks: 4a, 29b, 31.
Says: B21 prints the fiscal number. Code: a rejected invoice never gets one, so the builder prints "FISCAL NUMBER PENDING" forever.
Rec: builder takes a fiscal state (pending, acked, rejected) and prints "FISCAL NUMBER NOT ISSUED" when rejected; one sentence in 3.16/B21 (v1.0.2); a 4a follow-up patch.

## G-3 `receipt_fiscal` shape mismatch
Severity: Major. Tasks: 5, 4a, P0.9b.
Code: `jurisdiction-seeds.ts:40-41` has `receipt_fiscal` nullable, `fiscal_number_label: string`, `ReadonlyArray`. `fiscal-snapshot.ts:45` has `receipt` non-null, `fiscal_number_label: string|null`, mutable array. The spec does not define the null mapping.
Options: (a) null seed maps to `receipt` with null label and empty lists; (b) make the snapshot field nullable.
Rec: (a), written into the spec (v1.0.2).

## G-4 `authority_code` nullable vs port string
Severity: Major. Tasks: 29a/b, 30.
Code: `fiscal-snapshot.ts:47` is `string|null`; `port.ts:33` is `string`. Section 3.15 says an adapter receiving none rejects with `mode_unmapped`. `worker.ts:257-271` has no reject-without-send from `loadSubmission` (the row stays pending and the pos_id stays held).
Options: (a) nullable port field and the adapter rejects; (b) a core reject result from `loadSubmission` (amend 3.15).
Rec: (a), the smaller change; the adapter owns the mapping.

## G-5 `tax_minor` source
Severity: Minor. Tasks: 29b, 30. `port.ts:31` has no source field on InvoiceIssued. It must be the sum of the invoice tax rows including service-charge taxes. Rec: say so in the spec.

## G-6 Payments per submission
Severity: Major. Task: 29b.
`port.ts:33` needs payment class, direction and amount per payment; the invoice carries only `payment_ids` (`fiscal-snapshot.ts:110`). 29b must join PaymentAdded / `bill_payments` by payment_id regardless of `removed_at`. The section 5 `invoices.doc_json` comment "payments as in the event" is wrong. `bill_payments.invoice_id` is cleared on reopen, so join by id, not by invoice_id.

## G-7 `pos_id` empty string
Severity: Minor. Tasks: 29a/b. `worker.ts:281` sends `row.pos_id ?? ''` against a `string` field (`port.ts:20`). Latent for credits and credential-less adapters; `credentialsFor` returns `{}` with no credentialNames even when pos_id is null. Rec: make the port field `string|null` or fail loudly.

## G-8 Per-line tax spread
Severity: Major. Tasks: 17, compute.
Section 6.12 step 6 and J-2 require per-line tax; `computeSplit` returns invoice tax rows only. Unresolved: weights in inclusive mode, whether the service charge participates, the compound base, and service-charge taxes not separable from the combined (profile, tax) row in `compute.ts` `exactAt`.
Rec: a pure `spreadLineTaxes` helper in compute.ts as a 0b follow-up code task, using `apportionMinor` by line net; pin with a non-even fixture and a discount.

## G-9 4a doc inputs
Severity: Minor. Task: 4a.
`CheckBillDocInput` has `digital_total_minor`, which computeBill cannot produce (see G-25). `ReceiptDocInput` needs `DocPayment[]` with a joined `mode_name`. `ReportDocInput` matches 6.26; `mode_name` and `category_name` must be embedded in the Z event, and `tax_profile_id` prints raw. Per R-1/R-2 the types stay docs-local.

## G-10 Atomic invoice and outbox
Severity: Major. Task: P0.Sb. spike-0a (c) proves only outbox rollback. P0.Sb must prove invoice and outbox row commit or roll back together in the real fold.

## G-11 Fiscalized sale with null pos_id
Severity: Major. Task: 17. `outbox.ts:68-69` throws in `outboxRowFor`. The command must refuse before it reaches the fold.

## G-12 RetryFiscalNow
Severity: Minor. Task: 31. Must not await `runOnce`. Waking is settled by the 1 s loop: setting `next_try_at = now` is enough, no wake API.

## G-13 Cloud migration numbering
Severity: Blocker. Tasks: P0.8, P0.9b.
The cloud runner is sequential (`cloud/db/migrate.ts:97`) and main ends at 0013. 05's 0016/0017 would fail until 0014/0015 exist. PRs #121 and #126 target `module-02-hub-gaps`, which is 0 ahead and 278 behind main and has no 0014/0015, so the claims are phantom.
Options: (a) renumber 05's to 0014/0015; (b) keep 0016/0017 and require #126 first. Rec: (a). Owner question Q-1.

## G-14 No source for `unit_price_minor`
Severity: Blocker. Tasks: 10, 17, 4a, P0.2g, P0.12.
`order_lines` and `LineView` have no unit price. `ItemAdded.price_minor`, `extra_price_minor` and `allocated_price_minor` exist but are not folded. Compute lines, invoice lines, the port and receipts need it. Rec: 02b Q-1 / 0021 also adds `order_lines.unit_price_minor` and `LineView` (P0.2g text, P0.12 code).

## G-15 05 error codes not in errors.ts
Severity: Blocker. Tasks: 10 and all command tasks.
Section 9 codes are not in `packages/domain/src/errors.ts`; no task owns the append (F-5 is text only; 0a forbids editing errors.ts). Rec: a small U0 row after P0.2a and before task 10, following CLAUDE.md (module spec, then foundation 6.2, then errors.ts).

## G-16 AlertRaised `holders`
Severity: Blocker. Task: P0.7.
`AlertRaised.v1` `request.right_mode` is `z.enum(['approval','named'])`. D-1 adds `holders`. Per F D46 a shape change needs a new version with an upcaster: AlertRaised v5 with an identity upcaster (v4 exists), plus `AlertRequestPart`, `mayAnswer` and `raise.ts`. The P0.7 file list omits `packages/events/src/events/alert/*`. Settled by F D46, no question.

## G-17 P0.5 admin nav fails open
Severity: Major. Task: P0.5.
`adminPermissions()` (`staff-directory.ts:421`) returns only manage-devices and manage-staff, and the page's `can()` returns true for an unknown key. `MODULE_PAGES` is hard-coded to `manage-devices`. Missing from the file list: `client-dist.ts` constant, `server.ts` registerClientDist, vite.config entry, `package.json` build, `admin-fiscal/index.html`, and the client-dist, ship-client and build-output tests.

## G-18 Guard signature changes touch unlisted 04 files
Severity: Minor. Tasks: P0.6, P0.11, P0.14.
Changing guards touches `voids/contracts.ts` (`VoidLineGuard`, `voidMergeGuard`), `voids/guards.ts`, `voids/lanes/V2.ts`, 04 tests, and the `MergeGuard` shape (`tables/contracts.ts:58`). The line guard today is `(db, order_id, touched_ids)`. `registerDayCloseGuard` replaces rather than appends; `resetDayCloseGuard` is singular in code and `resetDayCloseGuards` in the plan.

## G-19 P0.15 audit
Severity: Major. Task: P0.15.
`registerAuditAction` and the seal exist; `registerRequestAction` does not (REQUEST_ACTIONS is a private const). `AUDIT_ACTIONS` is a closed const; the client `ACTION_META: Record<AuditAction,...>`, en/ur `audit.action.*` labels and hub audit query validation need the new actions. The file list omits the client labels and i18n.

## G-20 Startup registration order
Severity: Major. Tasks: 7, P0.15, P0.7.
The audit seal happens in `registerHubProjections` (`boot.ts:306-315`), run in createDeps before server.ts's `registerBilling`. Audit actions and alert kinds must be registered at module load via a static import. Projections must be added in `registerHubProjections` (also used by test-hub and big-fixture). Task 7 and P0.18 both touch boot.ts.

## G-21 P0.18 ordering
Severity: Blocker. Task: P0.18.
A worker started before task 6 (table missing) and 29b (real seams) fails every pass. Rec: move P0.18 after task 7 via `startBillingWorkers(deps, log)` created in task 7, or gate it.

## G-22 Stuck alert
Severity: Minor. Task: 31. The worker has no alert hook (`FiscalWorkerDeps` has no stuck hook; `startFiscalWorker` returns only a stop function). Use a 01d tick (`registerTick`, the `kds/ticks.ts` pattern) in task 31's status.ts; tweak "the worker re-raises" to "the tick".

## G-23 Built-in defaults gap
Severity: Major. Tasks: P0.9b, P0.10.
`builtInBillingDefaults` (`defaults.ts`) returns jurisdiction, payment_modes, service_charge_bp, variance and petty limits only. It lacks discount_reasons, petty_categories, open_bill_flag_minutes, max_discount_pct, receipt template, invoice_prefix, the fiscal block and stuck_after_ms. The seeds hold none and PK only, no effective_from. Owner question Q-2. The P0.9b mapper must also synthesize `none` rate rows for the right integration_status with a min effective_from and rename `tax_class_id` to `tax_profile_id`.

## G-24 Inclusive-mode docs
Severity: Minor. Task: 4a. `totalBlocks` ignores `prices_include_tax`, so inclusive lines do not visibly add up. Rec: a memo tax block, with service-charge taxes from the spread helper (G-8). Not an issue for the exclusive pilot.

## G-25 Check-bill digital total
Severity: Minor. Tasks: 4a, compute. `ComputeBillResult.totals_default` is cash class only. Rec: add `totals_default_digital` (small compute follow-up).

## G-26 Event audiences and frame lists
Severity: Major. Tasks: P0.13, client lanes.
`OrdersUnbilled`, `LineCompRemoved` and `OrdersCarriedOver` need audiences and frame-list entries. There are three client `ORDER_FRAMES` lists (`OpenOrders.tsx:24`, `table-view/refetch.ts:13`, `map/map-store.ts:26`); the plan names two. `LineComped` has a special per-server audience registration.

## G-27 Small points
Severity: Minor.
- `switched_at` is `string|null` on the wire against an epoch-ms `issued_at`.
- `invoices.payment_class` may be `'mixed'`; compute returns cash or digital only.
- `InvoiceIssued.service_charge` null vs the spec listing none.
- The B-2 backfill must be idempotent (`apply-discount` already exists on Cashier).
- `renderText` moves to domain; client and test imports change.
- PRA is not registered before task 30.

Checked and found consistent: `Message.items` (StockApp.tsx:42), the audit seal API, `defineAlertKind` options, hub migrations ending at 0020, `changeDrafts` as sole `OrderCancelled` emitter (`line-change.ts:94-95`), `ReportDocInput` vs 6.26, `PRINT_JOB_NOT_PENDING`, `'shift'` stream type, `hubTime(clock)` utc_offset, `StreamTypeSchema` reuse.

## G-28 No staff read for the Print to picker
Severity: Major. Tasks: 27 (hub), 38 (client). Found after the sweep (2026-11-19).
The staff Print to picker (05 §8 Print status, B18, `RetargetBillPrint` §6.23) has to list active printers, but no staff-session read gives that list: 03c's `GET /admin/queries/print-config` and `GET /admin/queries/print-queue` are admin only, and 05 §6.1 `prints[]` carries only `printer_name`. Fix (owner ruling R-27): one staff read in 05, `GET /queries/bill-printers` (05 v1.0.5 §6.23a): `take-order` (any grant; same as `RetargetBillPrint`, R-27 amended), staff session, the branch's active (not archived) printers `{ printers: [{ printer_id, name }] }` ordered by name, 1 statement, no new error code; test #60b. Built with task 27; task 38's picker uses it.

## G-29 Bill-view fields the design brief needs (Q-4, Q-5, Q-18)
Severity: Major. Tasks: 10 (hub), 35, 36 (client). Found by the 05 design brief (`docs/design/inventory/05-billing-design-brief.md` §7, PR #316).
(Q-4) 05 §8 shows a "new" mark on lines that joined the open remainder after a split closed, but §6.1 `lines[]` has no flag for it. (Q-5) §6.1 `blocks` "lists every §3.3 rule that would refuse a close now", but only `void_pending`, `weight_pending`, `tax_unresolved` (§9) and `shares_sum` were named, and the `ids` field did not fit rules 4, 6, 8. (Q-18) The "Reopened" chip has no field; `bills.reopen_count` exists (§5, §3.10) but §6.1 does not return it. Fix (owner ruling R-29): 05 v1.0.6 §6.1 — `lines[].added_after_close` (true when the bill has a closed split and the line is not in `bill_discount_lines`, the lines on the bill at the first close of the cycle), `blocks: [{ reason, split_no, details }]` with one pinned reason per §3.3 rule (`bill_not_open`, `void_pending`, `weight_pending`, `tax_unresolved`, `discount_pending`, `buyer_id_required`, `balance_due`, `shares_sum`; rules 5, 7, 9 never block) and `details` = the §9 error's, `reopen_count`. Statements unchanged (≤ 9). Tests #4b, #4c, #4d.

## G-30 Table-tile marks (reopened, check bill printed)
Severity: Minor. Tasks: the 02a table-map query (`apps/hub/src/tables/queries.ts`, `MapTile`) and the 02a client map. Found by the 05 design brief (§5 05-X01, §7 Q-11).
The tile has no "reopened" or "check bill printed" mark; both facts are 05's (`bills.reopen_count`, `bills.check_printed_at`), and 02a must not read 05's tables. Owner ruling R-30 adds both marks. The fold seam (02a's `tables` projection folding 05 events, as `BillClosed` / `BillClosedEmpty` under row T-3) was a STOP: it needed new `seatings` columns (a hub migration number; 0021–0023 are taken) and `seating_id` on `CheckBillPrinted` / `BillReopened`. **Resolved by R-30 (b)** (hook, the `registerMergeGuard` pattern of row T-1; no migration): 02a v1.1.9 `registerTileMarks(fn)` and `MapTile.reopened` / `check_printed_at` (`table-map` 3 + 1 → 4 + 1 with a reader), ids-only event `TableMarksChanged { seating_id }` for the live refresh (no fold effect); 05 v1.0.6 row T-4 and §6.4a: the reader `billTileMarks` (1 statement over `bills` and 02a `seatings`; task 7), `TableMarksChanged` appended with `CheckBillPrinted` (task 11) and with a dine-in `BillReopened` that writes no `SeatingReopened` (task 19; a `SeatingReopened` is already a map frame, so no second event), registration in task 33. Code in plan row P0.11d. Tests 05 #6b, 02a #65, #66.

## G-31 `fiscal_category` has no home
Severity: Major. Task: P0.9b. Found while writing 05 v1.0.6.
05 rows A-1 (1) / A-2 and 01a §4.3, §5.2b, §6.25 name the tax class's `fiscal_category` (the snapshot field and the `profile_missing` check), but no cloud column, route field or wire field holds it. Fix (owner ruling R-31): cloud `tax_classes.fiscal_category TEXT NULL` in `0014_billing_settings.sql` (P0.9b, not merged); `POST` / `PATCH /v1/admin/tax-classes` accept it and every tax-class answer and the menu read return it; the snapshot's `tax_classes[]` carries it (optional on the wire, R29); `profile_missing` reads it. 05 v1.0.6 row A-1 (1); 01a v2.7; 01a test #200. Owner ruling R-32: the owner sets it per tax class on the owner **Billing** page (P0.10), not in the menu tax-class form; the snapshot field is `.nullable().optional()` in schema 4 and the cloud always sends it; the builder is 23 fixed statements (was 22), +1 on 01b's sync bound (34 → 35; the bound is 01b's, R32 b, so 01b records it in its next bump).

## G-32 A deal part touched alone hides the deal's money change
Severity: Major. Tasks: P0.14 (02b / 04 callers), 24 (05's guard). Found during P0.14.
Removing or voiding a `deal_part` on its own (a part is never comped alone, so comp is out of scope) changes the parent deal line's `billed_minor` (02b §3.4: the deal total minus its parts' money out), but the line guard list held only the part, whose own billed amount is 0; 05's guard could not see a money change on a deal with closed units. Fix (owner ruling R-33): the caller also adds the parent deal's entry (`units_after` unchanged, `base_after_minor` recomputed from its parts, `money_changes: true`); ids may repeat in one list (e.g. `void-preview` judging a deal and its part) and every entry is judged. 05 v1.0.6 row Q-3; 02b v1.0.17 §3.4, §4.2; 02b tests 53, 54.

## G-33 Takeaway addition contact
Severity: Minor. Task: P0.13. Found during P0.13.
02b §3.1 (row Q-6) said a takeaway addition "copies the customer fields" from its root, which would write the root's contact into a second `OrderContactSet` (O17 privacy: contact only where needed). Fix (owner ruling R-34): an addition carries only its own payload's customer fields; nothing is copied from the root, the root keeps the contact, and the bill groups by the root's `bill_key`. 05 v1.0.6 row Q-6; 02b v1.0.17 §3.1; 02b test 55.

## G-34 Printer name for the print status
Severity: Minor. Tasks: P0.17 (03c), 10 (bill view), 38 (client print status). Found 2026-11-20.
05 §6.1 `prints[]` and the §8 print status show the printer's name, but 03c's `documentJobsStatus` (row P-2) returned only `printer_id`, so the bill view had no source for `printer_name` without an extra read. Fix (owner ruling R-35): `documentJobsStatus` also returns `printer_name`, joined from `printers` in the same statement (still 1). 05 v1.0.6 row P-2; 03c v1.0.13 §3.7, §4.2.

## G-35 Admin sign-in permissions for the fiscal entry and Close day
Severity: Major. Tasks: P0.5 (hub admin nav), P0.6 (Stock page). Found 2026-11-20.
Row H-2 shows the `/admin/fiscal/` side-nav item and home tile by `manage-fiscal-settings`, and row A-5 shows **Close day** on `/admin/stock` by `close-business-day`, but the hub admin pages learn the admin's rights only from the sign-in `permissions` (00 M89), which held `manage-devices` and `manage-staff` only (`adminPermissions()`, `apps/hub/src/auth/staff-directory.ts:421`; `AdminAuthResponse`, `packages/events/src/admin/hub.ts:24`). Neither page had a source for its key without an extra read. Fix (owner ruling R-37): the `permissions` object gains two additive boolean keys, `manage-fiscal-settings` and `close-business-day` (effective, like the other two), in `/admin/auth` and `/admin/auth/bootstrap`. 00 v1.12.1 M89, §6.6, §6.29, §8.2, test #147; 01a v2.7.1 §6.18b, §6.19, §8.2.

## G-36 Zone and floor names for the bill routes
Severity: Minor. Task: P0.16 (hub admin Printers page, "Bill printers" section). Found 2026-11-20.
03c's `print-config` (row P-1) lists the routes as `{ scope, ref_id, printer_id }` and nothing else, so the page cannot show a zone or floor name beside its route or offer the ids to add one; the hub holds zones and floors only in the branch config in memory. 03c §6.13 `SetBillRoute` is also silent on two points the integrator built and the owner accepted (readings): `ref_id` is `''` for `report` / `default` and non-empty for zone / floor / device, else `400 VALIDATION_FAILED`; an archived zone or a revoked device still counts as existing, so its route can be removed. Fix (owner ruling R-38): `print-config` also returns `zones: [{ zone_id, floor_id, name, archived }]` and `floors: [{ floor_id, name, archived }]` from the branch config (0 extra statements, still 5); the two readings are written into §6.13 as "(R-38 note)". 05 v1.0.6 row P-1; 03c v1.0.14 §6.6, §6.13, tests 55, 56. Note: 05 v1.0.6 row P-1 still names 03c v1.0.11 for this field; row targets are carried by a new 05 version, not edited in place (as R-22, R-26, R-35 left them), so the next 05 version names 03c v1.0.14.

## G-37 `BillReopened` carries no mode
Severity: Major. Tasks: 5 (events), 7 (billing fold), 19 (`ReopenBill`). Found 2026-11-20 at task 5.
05 §6.13 decides the reopen mode (§3.10) inside the transaction and returns it, and §5 keys `bills.reopen_mode` and the `bills_live_seating` / `bills_live_key` indexes on it, but the `BillReopened` payload had no `mode`, so the billing fold could not set `reopen_mode` from events alone (a rebuild would have had to re-read seating / key state, which may have moved since). Task 5 also met event shapes the text left open (`BillSplitsSet.splits[]`, `DiscountApplied.replaces`, `DiscountRemoved`, `ShiftCountSkipped`, `CheckBillPrinted.source`, `InvoiceIssued.payment_class` `'mixed'`, `InvoiceCredited`, petty `advance_staff_id`, `ZReportIssued.report`); the integrator accepted the built shapes. Fix (owner ruling R-40): `BillReopened` gains `mode: 'full' | 'corrections'`, written by §6.13 (and by `apply`) as decided; the fold sets `reopen_mode` from it; the task-5 shapes are pinned in 05 v1.0.7 §6.29. 05 v1.0.7 §3.10, §5, §6.13, §6.29, test #37i, §11 tasks 5, 7, 19. One reading pinned with them (§6.13): an `InvoiceCredited`'s `closed_by` is the reopen's requester (`BillReopened.requester_staff_id`), not the original's closer; §6.13 copies only the original's amounts, jurisdiction, currency, price mode, lines, tax rows and `fiscal` snapshot. Test #91c.

## G-38 The frozen discount amount has no event of its own
Severity: Major. Tasks: 5 (events), 7 (billing fold), 17 (`CloseSplit`), 33 (audience). Found 2026-11-20 at the task 5 review.
B7 and §3.5 (2) freeze the whole bill's discount at the close that takes the bill from no closed split to one, and §5 keeps it in `bills.discount_json.frozen_minor`, but no event carried the frozen amount: `InvoiceIssued` carries the split's `discount_minor` and the `discount_line_ids`, not the bill's frozen total, so the fold would have had to recompute it (rates, caps, lines at that moment) to rebuild the column. Also, §5's `billing` event list did not name 02b `OrdersBilled`, though `bill_orders` is filled from it. Fix (owner ruling R-41): new event `DiscountFrozen { bill_id, frozen_minor, line_ids }` (stream `bill`), appended in that `CloseSplit` transaction right after `InvoiceIssued`; `frozen_minor` = the whole bill's discount frozen then (0 with no discount), `line_ids` = the set in `bill_discount_lines`; it is the only source of `discount_json.frozen_minor`; a `BillReopened` clears the freeze and the next first close appends it again. `InvoiceIssued.discount_line_ids` is kept unchanged (it still fills `bill_discount_lines`; `DiscountFrozen.line_ids` carries the same set, so no contradiction). Text clarification (b): the `billing` fold's list names 02b `OrdersBilled`, the source of `bill_orders`. 05 v1.0.7 §5, §6.12 step 6, §6.29, tests #16d, #88b, §11 tasks 5, 7, 17, 33.

## G-39 The variance sign-off state depends on the threshold at fold time
Severity: Major. Tasks: 5 (events), 8 (`shifts` fold), 21 (`CountShift`). Found 2026-11-20 at the task 5 review.
§6.17 said "`|variance| > variance_threshold_minor` → the fold sets `variance_state = 'pending'`", so the `shifts` fold had to read the threshold, which is a setting: a rebuild after a threshold change would move old shifts, and `ShiftCounted` did not say which request was raised. Fix (owner ruling R-42): `ShiftCounted` gains `variance_alert_id: string | null`, the `shift_variance` request raised in the same transaction, `null` when |variance| ≤ threshold; the fold sets `variance_state` / `variance_alert_id` from the event alone and never reads the threshold. `HandoverCounted` is unchanged: a handover raises no sign-off (§3.11, §6.19, §3.14). 05 v1.0.7 §5, §6.17, §6.19, §6.29, test #50d, §11 tasks 5, 8, 21.
**Not applied — STOP (text clarification (a) of the same rulings):** "the `shifts` projection may read billing's `bill_payments` / `billing_day` and folds after `billing`, for `shift_takings`, `expected_cash_minor` and `shift_signoffs.business_date`". It clashes with 05 §5 ("Two projections, both **events-only** (they read only their own tables and the event; never 02b's or 02a's tables in a fold)") and §2 ("a rebuild from seq 0 equals live (02a T19, 04 V16)", test #88). 00's `catchUp` (`apps/hub/src/projections/registry.ts`) replays one projection **to the head** before the next, so on any rebuild or catch-up the `shifts` fold would read `billing_day` at its latest value, not the day of the event: every rebuilt `shift_signoffs.business_date` would become the current day. The `bill_payments` columns `shifts` needs (shift, mode, taker, amount, tendered) never change after `PaymentAdded`, so that half alone would rebuild equal; the `billing_day` half would not. Owner to rule: allow it with a rule that keeps rebuild = live (e.g. `shifts` folds `BusinessDayOpened` into its own day key, or `ShiftVarianceSignedOff` carries `business_date`), or restate §5 / §2.
**Resolved by owner ruling R-44 (2026-11-20), with two integrator-accepted corrections of the brief's wording:** clarification (a) dropped; §5's events-only rule stays; the events carry the data. `PaymentRemoved` gains `shift_id`, `mode_id`, `payment_class`, `direction`, `amount_minor`, `change_minor` and `taken_by_staff_id`, copied from the removed payment (ids and amounts only; `shift_takings` is keyed by taker, so the taker is needed). `ShiftVarianceSignedOff` gains `business_date` = the **open business day in the answer transaction** (the `shift_variance` `apply`, approve or reject), which matches §5 `shift_signoffs` ("variance sign-offs" of the report's day, any shift date), H8-1 and test #50c (a day-1 variance answered on day 2 is on day 2's Z). Checked every `shifts` input: `expected_cash_minor` from `ShiftOpened`, `PaymentAdded` / `PaymentRemoved` and the four petty-cash events (`PettyCashSettled.shift_id` + `returned_minor`, the advance amount from `shifts`' own `petty_cash` row); `shift_takings` from `PaymentAdded` / `PaymentRemoved`; `shift_signoffs.business_date` from `ShiftVarianceSignedOff`; `InvoiceIssued` not needed. Nothing missing. 05 v1.0.7 §3.14, §5, §6.10, §6.17, §6.29, test #47b, §11 tasks 5, 8, 16, 21.

## G-40 `TableMarksChanged` cannot carry an approval's `alert_id`
Severity: Major. Tasks: P0.11d (02a schema), 19 (`ReopenBill` + `apply`). Found 2026-11-20 at the task 5 review.
05 §6.13 / §6.4a make the `reopen_bill` `apply` append 02a `TableMarksChanged { seating_id }` for a dine-in reopen on a not-`CLOSED` seating with no `SeatingReopened`; 01d `checkAlertIds` requires every `apply` draft to carry the request's `alert_id`, and 02a v1.1.9 / v1.1.10 define the payload as `{ seating_id }` `.strict()`, so the approve would be refused. Fix (owner ruling R-43): 02a v1.1.11 — `TableMarksChanged` gains `alert_id` (optional, never null, like `SeatingReopened`), set only by an approval `apply`. 02a v1.1.11 §6.19, test 68; 05 v1.0.7 row T-4 (5), §6.4a, §6.13, §6.29, test #6c, §11 tasks P0.11, 19.

## Owner rulings on P0.G (2026-11-19, every Rec; board R-6 … R-12)

| Board | Row | Ruling | Lands in |
|---|---|---|---|
| R-6 | G-13 | **(a)** 05's cloud migrations take **0014 / 0015** (were 0016 / 0017). #121 / #126 (`module-02-hub-gaps`, stale since 2026-11-12) renumber when they land. | 05 v1.0.2 (§4.5, §11, §12.7 (d)); plan rows P0.8, P0.9b |
| R-7 | G-14 | **(a)** new column `order_lines.unit_price_minor` + `LineView.unit_price_minor`, folded from `ItemAdded` (price, extra price, allocated price per line kind as 02b defines), in hub migration 0021 with the other 02b rows. Upstream contract change, approved. | 02b v1.0.16 (P0.2g, new row text under Q-1); P0.12 code |
| R-8 | G-1 | **(b)** one shared `isFiscalized(snapshot)` in `@pos/domain` (`required && adapter_key !== 'none'`), used by `outbox.ts` and `docs.ts`; task 5's `InvoiceIssued` schema refuses `required: true` with adapter `none`; §6.12 step 7 says "when fiscalized (§3.15)". | 05 v1.0.2; a 0b follow-up code row (domain + outbox + docs) |
| R-9 | G-4 | **(a)** port `FiscalSubmission.invoice.payments[].authority_code: string \| null`; the adapter answers `rejected` (`mode_unmapped`) on null. | 05 v1.0.2 §3.15 port block; 28a follow-up (port type), 30 / 30a |
| R-10 | G-23 | **(b)** built-in defaults include a minimal `discount_reasons` and `petty_categories` list from the §4.4 examples. | 05 v1.0.2 (A-1 (5) defaults); P0.9b |
| R-11 | G-2 | A `rejected` invoice's receipt / reprint prints "FISCAL NUMBER NOT ISSUED"; the doc builder takes the fiscal state (pending / acked / rejected). | 05 v1.0.2 §3.16 / B21; 4a follow-up (4b) |
| R-12 | G-3, G-5, G-6, G-7, G-8, G-22 and every other row | The Rec of each row (owner: "sab Rec"); owner may veto later. G-15, G-16, G-21 and the file-list rows are plan fixes (no ruling needed). | 05 v1.0.2 where the row says "spec change"; plan patch |
| R-13 | G-11 | When the adapter is not `none`, the fiscal settings refuse to save without `default_pos_id` (A-2 / §6.28a config rule, `422 CONFIG_REFERENCE_INVALID { field: 'fiscal.default_pos_id' }`), so a fiscalized split always resolves a `pos_id` (device mapping, else default). No new §9 code. Task 17 keeps `outboxRowFor`'s throw as a defensive invariant; no command refusal code. | 05 v1.0.2 (P0.1b, spec text); P0.9b (the config check + test); task 17 |
| R-14 | G-23 (rest) | Built-in `invoice_prefix` = empty; receipt `header_lines` / `footer_lines` = empty; every other built-in default takes its A-1 (3) value: `max_discount_pct` 100, `open_bill_flag_minutes` 240, `stuck_after_ms` 1 800 000, `variance_threshold_minor` 100 major units, `petty_cash_limit_minor` 5 000 major units, receipt show toggles per K-12 (`tax_reg_no`, `address`, `phone`, `cashier`, `order_no`, `bill_no`). | 05 v1.0.2 (A-1 defaults sentence, P0.1b); P0.9b |

Note: R-5 is a board ruling about the integrator rebasing stopped lanes; it is not a P0.G ruling.

## Owner rulings after P0.G

R-15…R-22: see 05-status.md (not listed on the board at the `module-05` tip; their text landed in the 05 v1.0.2–v1.0.4 and 03c v1.0.12 changelogs).

| Board | Row | Ruling | Lands in |
|---|---|---|---|
| R-23 | — (P0.7) | (2026-11-19) The eleven `perm.*` English labels for the bills permissions are the integrator's draft; Urdu goes to 01b `urdu-todo.md`. | P0.7 (client i18n, `apps/client/src/i18n/en.ts`); 01b `urdu-todo.md` |
| R-24 | — (build process) | (2026-11-19) CI's gate on the PR counts as the full gate; lanes run targeted tests + typecheck + lint and no local full gate. | every lane; plan §1 global rules (process, no spec text) |
| R-25 | — (P0.4) | (2026-11-19) An H-1 retransmit across routes follows the per-route M47 replay rule as written: admin-first then device → replays; device-first then admin → `400`; nothing ever runs twice. A clarifying sentence goes into the next 00 bump. | P0.4 (tests); next 00 bump (text) → 00 v1.12.1 §3.7 (2026-11-20) |
| R-26 | — (P0.17, row P-3) | (2026-11-19) QR block: default module size **6 on 80 mm** paper (48 columns) and **4 on 58 mm** (32 columns), by the **printer's** paper width, not `doc.width_cols`; a block's own `size` (3–8) wins; the 400 limit counts characters (code points); `pL pH` = the payload's UTF-8 bytes + 3. Where a bad QR block is refused is not decided. | 03c v1.0.13 §3.6; 05 v1.0.6 row P-3, §12.7 A3; P0.17 |
| R-27 | G-28 | (2026-11-19 19:40 PKT) Add one staff read to 05, **`GET /queries/bill-printers`**: permission `take-order` (amended 2026-11-19: permission take-order, same as RetargetBillPrint; was `take-payment`), staff session; the branch's active (not archived) printers as `{ printers: [{ printer_id, name }] }`, ordered by name; 1 statement, no N+1; no new error code beyond the foundation's auth / permission errors. Built with task 27 (hub); client task 38 uses it. | 05 v1.0.5 §6.23a (§8, #60b, §11, §12.2); plan tasks 27, 38 |
| R-28 | — (P0.15) | (2026-11-19) The 05 audit action labels are the implementer's English draft (32 actions), in two new groups "Bills and payments" and "Shifts and cash"; Urdu goes to 04 `urdu-todo.md`; the `walk_out` reason is labelled "Walked out without paying". | P0.15 (client audit labels, i18n); 04 `urdu-todo.md` |
| R-29 | G-29 | (2026-11-19) Design brief Q-4, Q-5, Q-18: add to the §6.1 bill view a per-line boolean `added_after_close` (defined from the data 05 already keeps, same statements, no N+1), one exact `blocks` `reason` per §3.3 rule 1–9 reusing the existing names, with the `details` each block carries, and `reopen_count` (int ≥ 0). | 05 v1.0.6 §6.1 (§3.3, §3.8 pointers, §8, #4b–#4d, §10 Acceptance, §11 task 10 and client 35 / 36, §12.2); plan tasks 10, 35, 36 |
| R-30 | G-30 | (2026-11-19) The 02a table-map tile gains a **reopened** mark and a **check bill printed** mark; 02a gets both from 05 without reading 05's tables. The fold option needed a migration number (STOP); the owner then ruled **option (b)**: an ordered hook list `registerTileMarks(fn)` (like `registerMergeGuard`), `fn(db, seating_ids) → Map<seating_id, { reopened, check_printed_at }>`, asked once by `table-map` (3 + 1 → 4 + 1 with a registration), `MapTile` fields `false` / `null` with none; live refresh by an ids-only `TableMarksChanged { seating_id }` (table audiences, not KDS; client map frame list; no 02a row change) that 05 appends with `CheckBillPrinted` and `BillReopened` on a dine-in seating; 05 registers a 1-statement reader of its `bills`. Design decision under R-30 (05 §6.4a): a `BillReopened` whose transaction already appends `SeatingReopened` (a map frame, row T-3) appends no `TableMarksChanged`. | 05 v1.0.6 row T-4, §4.1, §6.3, §6.4a, §6.13, §6.29, §6.30, #6b, §11 tasks 7, 11, 19, 33, §12.2; 02a v1.1.9 (§4.2, §4.3, §5, §6.17, §6.19, §8, #65, #66, §11 step 21, §12.2); plan row P0.11d |
| R-31 | G-31 | (2026-11-19) Cloud `tax_classes` gains `fiscal_category TEXT NULL` in `0014_billing_settings.sql` (P0.9b, not merged); the tax-class routes accept and return it; the snapshot's `tax_classes[]` carries it; PK-PB's `profile_missing` check reads it. | 05 v1.0.6 row A-1 (1), §11 P0.9; 01a v2.7 (§4.3, §5.2, §5.2b, §6.11, §6.12, §6.25, #200); plan row P0.9b |
| R-32 | G-31 | (2026-11-19) The owner sets `fiscal_category` per tax class on the owner **Billing** page (plan task P0.10), not in the menu tax-class form. From P0.9b's build: the config builder is **23** fixed statements (was 22) and the sync poll bound 34 → **35**; the snapshot `tax_classes[].fiscal_category` is `.nullable().optional()` within schema 4 (R29 additive) and the cloud always sends it. | 01a v2.7 (§4.3, §6.1, §8.1, changes table); 05 v1.0.6 row A-1 (1); plan rows P0.9b, P0.10 |
| R-33 | G-32 | (2026-11-19) When a `deal_part` is touched on its own (removed or voided without its deal; a part is never comped alone, 02b §3.4, so R-33 covers remove and void only), the line guard list also gets the parent deal's entry: `units_after` unchanged, `base_after_minor` recomputed from its parts, `money_changes: true`. Ids may repeat in one list (void-preview judging a deal and its part); every entry is judged. | 05 v1.0.6 row Q-3; 02b v1.0.17 §3.4, §4.2, tests 53, 54; plan row P0.14 |
| R-34 | G-33 | (2026-11-19) A takeaway addition (`adds_to_order_id`) carries only its own payload's customer fields; nothing is copied from the root; the root keeps the contact; the bill groups by the root's `bill_key`. | 05 v1.0.6 row Q-6; 02b v1.0.17 §3.1, test 55; plan row P0.13 |
| R-35 | G-34 | (2026-11-20) `documentJobsStatus` also returns `printer_name`, joined from `printers`, and stays 1 statement; it gives 05 §6.1 `prints[]` and the §8 print status the printer's name. | 03c v1.0.13 §3.7, §4.2 (row P-2); 05 v1.0.6 row P-2, §6.1; plan row P0.17 |
| R-36 | — (P0.9b, row A-2) | (2026-11-20) A billing settings `PUT` is refused with `422 CONFIG_REFERENCE_INVALID { field: 'fiscal.integration_status' }` when the chosen jurisdiction has profile rows but its catalog has no rate rows for that `integration_status` (e.g. `not_integrated` under `PK-PB`, which seeds `integrated` rows only); `none` and `PK` (no profile rows) are not affected, their single `rate_bp` tax covers both statuses (G-23). Checked after the R-13 `default_pos_id` / J-5 `authority_codes` checks and before the receipt `tax_registrations`, service-charge, override references and `profile_missing`. Ruled deviation from P0.9b: the currency-exponent `rounding_step_minor` bound is checked after the branch 404 and the row lock, because the tenant currency is read inside the transaction. | 01a v2.7.1 §6.25 (row A-2; R-36 note); 05 unchanged (§4.5 row A-2 lists no check order); plan row P0.9b |
| R-37 | G-35 | (2026-11-20) The hub admin sign-in `permissions` object (`/admin/auth`, `/admin/auth/bootstrap`; `AdminAuthResponse`) gains two additive boolean keys, `manage-fiscal-settings` and `close-business-day`, next to `manage-devices` and `manage-staff`. `/admin/fiscal/` (row H-2) is shown by `manage-fiscal-settings`; the Stock page's **Close day** (row A-5) by `close-business-day`. | 00 v1.12.1 M89, §6.6, §6.29, §8.2, #147; 01a v2.7.1 §6.18b, §6.19, §8.2; plan rows P0.5, P0.6 |
| R-38 | G-36 | (2026-11-20) `print-config` also returns `zones: [{ zone_id, floor_id, name, archived }]` and `floors: [{ floor_id, name, archived }]`, read from the branch config in memory (0 extra statements, still 5), so the Printers page can label and add zone and floor bill routes. Readings accepted for `SetBillRoute`: `ref_id` is `''` for `report` / `default` and non-empty for zone / floor / device, else `400 VALIDATION_FAILED`; an archived zone or a revoked device still counts as existing, so its route can be removed. | 03c v1.0.14 §6.6, §6.13 (row P-1); 05 v1.0.6 row P-1; plan row P0.16 |
| R-39 | — (P0.11, row T-3 (4)) | (2026-11-20) `RemoveItems` on a `CLOSED` seating (a corrections-only reopen) skips only the **lock**, not the **authorisation**: `requireLock` still applies the holder rule (the seating's holder, or `take-order-anywhere` covering the floor, plus scope). It gains an authorise-only mode ("authorise only, no lock", `requireLockHolder`): no lock drafts, no lock-taking write, no `table_locks` read. Anyone else gets the same 403 as on an open seating (`PERMISSION_DENIED`, e.g. `not_holder`). 02b states no statement number for that case ("no lock statement; the authorisation read as 02a v1.1.10 §4.2"). Same bump, 02b text: `readOrder` names `seating_state`. | 02a v1.1.10 §4.2, test 67; 02b v1.0.18 §4.2, §6.2; 05 v1.0.7 row T-3 (4) (restated in the v1.0.7 bump); plan row P0.11 |
| R-40 | G-37 | (2026-11-20) `BillReopened` gains **`mode: 'full' \| 'corrections'`**: `ReopenBill` (§6.13) writes the mode it decided (the `reopen_bill` `apply` the mode it decides at answer time); the billing fold sets `bills.reopen_mode` from the event, so the `bills_live_*` indexes and the audit `bill_reopened` (with the mode) read it. Same bump: the task-5 event shapes the integrator accepted are pinned in §6.29. | 05 v1.0.7 §3.10, §5, §6.13, §6.29, #37i, §11 tasks 5, 7, 19; plan rows 5, 7, 19 |
| R-41 | G-38 | (2026-11-20) New event `DiscountFrozen { bill_id, frozen_minor, line_ids }`, stream `bill`: `frozen_minor` = the whole bill's discount frozen at the close that takes the bill from no closed split to one (B7, §3.5 (2)); `line_ids` = the set in `bill_discount_lines`. Appended in that `CloseSplit` transaction right after `InvoiceIssued`; the source of `bills.discount_json.frozen_minor`; a `BillReopened` clears the freeze, so the next first close appends it again. `InvoiceIssued.discount_line_ids` kept unchanged (no contradiction: it still fills `bill_discount_lines`, `line_ids` is the same set). Text clarification (b): the `billing` fold's list includes 02b `OrdersBilled`, the source of `bill_orders`. | 05 v1.0.7 §5, §6.12 step 6, §6.29, #16d, #88b; plan rows 5, 7, 17, 33 |
| R-42 | G-39 | (2026-11-20) `ShiftCounted` gains `variance_alert_id: string \| null`: the `shift_variance` alert raised in the same transaction, or null when \|variance\| ≤ threshold. The `shifts` fold sets `variance_state` / `variance_alert_id` from the event alone and never reads the threshold. `HandoverCounted` unchanged (a handover raises no sign-off, §3.11). Text clarification (a) of the same day (the `shifts` fold reading `bill_payments` / `billing_day`, folding after `billing`) is **not applied**: STOP, see G-39; superseded by R-44. | 05 v1.0.7 §5, §6.17, §6.19, §6.29, #50d; plan rows 5, 8, 21 |
| R-43 | G-40 | (2026-11-20) 02a v1.1.11: `TableMarksChanged` gains `alert_id` (optional, never null, like `SeatingReopened`), present when an approval `apply` writes it (05's `reopen_bill` approve), so that `apply`'s drafts pass 01d `checkAlertIds`; absent on the direct paths. | 02a v1.1.11 §6.19, test 68; 05 v1.0.7 row T-4 (5), §6.4a, §6.13, §6.29, #6c; plan rows P0.11d, 19 |
| R-44 | G-39 | (2026-11-20, on the G-39 STOP) Clarification (a) dropped: projections stay events-only and the events carry the data. `PaymentRemoved` gains `shift_id`, `mode_id`, `payment_class`, `direction`, `amount_minor`, `change_minor`, copied from the removed payment (ids and amounts only, no reference text). `ShiftVarianceSignedOff` gains `business_date`: the **open business day in the answer transaction** (note: "the day of the counted shift" in the brief was the integrator's wording, corrected to the answer day so it matches §5 `shift_signoffs`, H8-1 and test #50c). Every other `shifts` input comes from shift-stream events plus `PaymentAdded` / `PaymentRemoved`: checked; the one gap found, the taker, is closed by adding `taken_by_staff_id` to `PaymentRemoved` (integrator-accepted, an id). G-39 resolved. | 05 v1.0.7 §3.14, §5, §6.10, §6.17, §6.29, #47b; plan rows 5, 8, 16, 21 |
| R-45 | G-41 | (2026-11-20, on the P0.10 STOP) The Billing page flags "Needs a category" only while the branch jurisdiction has profile rows (the `profile_missing` case), not whenever it is not `none`: `PK` has no profile rows, so the flag could never be cleared. | 01a v2.7.2 §8.1; plan row P0.10 |
| R-46 | G-42 | (2026-11-20, on the P0.Sb reading R-S1) H8-3 derived `fiscal.required` from the order type's `fiscalize` and `switched_at` only, so the PK defaults (dine-in `fiscalize: true`, adapter `none`) gave `required: true`, which the `InvoiceIssued` schema refuses (R-8 / G-1). Ruled: `required` also needs the adapter not to be `none` — the complement of §3.15 "Not fiscalized". Text only, no code change (the spike already does this; task 17 follows). | 05 v1.0.8 §6.12 step 6, H8-3; plan rows 17, P0.Sb |
| R-47 | G-43 | (2026-11-20, task 9 Reading) `reopen_bill` values add `reason_code`: `apply` must write `BillReopened.reason_code` and has no other source. | 05 v1.0.9 §6.13; plan rows 9, 19 |
| R-48 | G-44 | (2026-11-20, task 9 Reading) `petty_cash` values carry `entry_id` / `has_note`, no `note_id` (texts keyed by `entry_id`; petty events carry none). | 05 v1.0.9 H4-4; plan rows 9, 22 |
| R-49 | G-45 | (2026-11-20, task 9 Reading) the seven 05 request kinds are family `urgent`. | 05 v1.0.9 §3.14; plan row 9 |
| R-50 | G-46 | (2026-11-20, task 29b Reading) outbox `last_error` adds `config_missing` and `invoice_missing` (internal, not §9); the row stays `pending`. | 05 v1.0.9 §3.15; plan rows 29b, 31 |
| R-51 | G-47 | (2026-11-20, task 15 STOP) §6.16 says the blind cash line shows the count of cash payments but the shape had no field: every takings row and `by[]` entry gets `payments_count`; amounts `null` before the count. | 05 v1.0.10 §6.16; plan row 15 |
| R-52 | G-48 | (2026-11-20, task 12 STOP 1) an equal plan spreads a later round over its n splits (the plan holds `{ n, k }` only; the money core already does this). | 05 v1.0.10 §3.8; plan row 12 |
| R-53 | G-49 | (2026-11-20, task 12 STOP 2) a paid split keeps its number only (§3.8 aligned with §6.5 / test #9). | 05 v1.0.10 §3.8; plan row 12 |
| R-54 | G-50 | (2026-11-20, task 11 STOP) the `BillRequested` fold may use ≤ 10 statements (03c printing is 5), as `PrintCheckBill`. | 05 v1.0.10 §6.4; plan row 11 |
| R-55 | G-51 | (2026-11-20, task 4b STOP) a QR payload the printer cannot encode is skipped; the fiscal number line and the slip still print, nothing errors. | 05 v1.0.10 §3.16; plan row 4b |
| R-56 | G-52 | (2026-11-20, task 15 review) the takings subqueries scan `bill_payments` (no `shift_id` index; ~110 ms at a year of payments on a dev machine vs 0.02 ms indexed): add `bill_payments_shift (shift_id, mode_id, taken_by_staff_id)` in a new hub migration 0024. | 05 v1.0.11 §5; new plan row 0024 |
| R-57 | G-53 | (2026-11-20, task 15 review) the OpenShift drawer kick uses only the device's own route (a kiosk without one must not open another counter's drawer). | 05 v1.0.11 §6.15; plan row 15 |
| R-58 | G-54 | (2026-11-20, task 14 STOP S-1) the `remove_service_charge` re-check had no §9 code: new `SERVICE_CHARGE_NOT_APPLIED` 409 `{ bill_id }` (Foundation §6.2 + `errors.ts`). | 05 v1.0.12 §3.14, §6.8, §9; plan row 14 |
| R-59 | G-55 | (2026-11-20, task 14 STOP S-2) a second `RemoveServiceCharge` while a request is open answers `200 { pending: { alert_id } }`. | 05 v1.0.12 §6.8; plan row 14 |
| R-60 | G-56 | (2026-11-20, task 14 reading) the service-charge results carry no totals (§6.8 ≤ 3 statements wins over §6's general rule). | 05 v1.0.12 §6.8; plan row 14 |
| R-61 | G-57 | (2026-11-20, task 14 review) a bill opened at service-charge rate 0 has no charge: Remove / Apply answer `changed: false` and write nothing; a re-add at today's rate 0 likewise (integrator reading under the ruling); the approval re-check uses the same rule. | 05 v1.0.13 §6.8; plan row 14 |
| R-62 | G-58 | (2026-11-20, task 20 reading) `RemoveComp` on a `deal_part` named alone → 400 `VALIDATION_FAILED` (issue at `order_item_id`); command and re-check. | 05 v1.0.14 §6.14; plan row 20 |
| R-63 | G-59 | (2026-11-20, task 31a STOP) the `/admin/fiscal/` page had no read: new `GET /admin/queries/fiscal-credentials` (admin, `manage-fiscal-settings`, never the token, 2 statements). | 05 v1.0.14 §6.28b; plan row 31a |
| R-64 | G-60 | (2026-11-20, task 17 review) B15's unit sum contradicted §5 / H1-27 for amount / equal splits: the sum holds for item splits; any closed row freezes the whole line otherwise. Text only. | 05 v1.0.14 B15, §10; plan rows 17, 24, 3b |
| R-65 | G-61 | (2026-11-20, task 32a build) the `money_request_raised` row is written by 04's built-in `AlertRaised` map (P0.15), which writes no kind and which 05 cannot override: the raised row's detail carries no kind (join `audit_requests` on `alert_id`); `money_request_answered` keeps it. Text only. | 05 v1.0.15 V-3, §6.30, §10 #87; plan row 32a |
| R-66 | G-62 | (2026-11-20, task 19 build) 01d AD-91: `apply` mints no ids, so `reopen_bill` values gain `credit_invoice_ids` (ULIDs minted at raise, one per `invoice_ids` entry, same order); approve uses `credit_invoice_ids[i]` for `invoice_ids[i]`; the direct path mints its own; a mismatch is refused by the existing re-check, never re-pairs an id. | 05 v1.0.15 §6.13, §3.14, §10 #37j; plan row 19 |
| R-67 | G-63 | (2026-11-20, task 18, owner ruling) `WaiveBuyerId` ≤ 4 → **≤ 6**: the net-vs-threshold check needs the whole-bill reads (`openBillOf`, `SPLITS_OF_BILL`, orders, `orderLines`, `pendingVoids`) = 5, the note write 6; `apply` 1, reject 0. Same pattern as R-54, R-60. Text only. | 05 v1.0.16 §6.11; plan row 18 |
| R-68 | G-64 | (2026-11-20, task 18, integrator reading, review-confirmed) the `close_without_buyer_id` `apply` re-checks only OPEN / PARTLY_PAID, so approving on a bill already waived directly writes a second `BuyerIdWaived`; the fold is idempotent, the audit shows two rows. Text only. | 05 v1.0.16 §6.11, §3.14; plan row 18 |
| R-69 | G-65, G-68 | (2026-11-20, task 32a, integrator) `fiscal_token_changed` uses subject `hub`, 05's own subject (a fiscal `pos_id` is not a device or a day; 04 §5's list has no fitting entry). 04's spec not edited; G-68 carries the 04 follow-up. Text only. | 05 v1.0.16 V-3, §6.30, §6.28a; plan row 32a |
| R-70 | G-66 | (2026-11-20, task 27, integrator reading) `RetargetBillPrint` 3 → **≤ 3** statements (happy path 2, a refusal 3). Text only. | 05 v1.0.16 §6.23; plan row 27 |
| R-71 | G-67 | (2026-11-20, task 31a, integrator reading, review-confirmed) `SetFiscalToken` 2 → **≤ 2** statements (bad `pos_id` 0, branch adapter's name 1, bad name 1, pending adapter's name 2); the token is hash-omitted (H-4), so a same-`command_id` retransmit with a different token replays the old answer — clients mint a new `command_id` per Save. Text only. | 05 v1.0.16 §6.28a; plan row 31a |
| R-72 | G-69, G-72 | (2026-11-20, task 19, owner ruling) 05's order-cancelled hook (02b `registerOrderCancelledHook`, row Q-7, `BillClosedEmpty`) reads at least `openBillOf` (1) on every `OrderCancelled`; neither 02b nor 04 budgets for it. In 05's text 02b's and 04's cancel / void statement counts are "plus the registered hooks' statements"; the hook adds 1 with no bill, more when the bill empties. The 02b and 04 tests pinning those counts move +1, with comments. 02b's and 04's specs not edited; G-72 carries the follow-up. Same pattern as R-54, R-60. Text only. | 05 v1.0.17 row Q-7, §3.10; plan row 19 |
| R-73 | G-70 | (2026-11-20, task 19, owner ruling) `AddPayment` ≤ 7 → **≤ 8 on the empty-close path only**: the `out` that leaves an all-cancelled bill at balance 0 appends `BillClosedEmpty` through `emptyCloseDrafts` (H7-3, §3.10) = 8; every other path stays ≤ 7. Text only. | 05 v1.0.17 §6.9; plan rows 16, 19 |
| R-74 | G-71 | (2026-11-20, task 19 reading, integrator-confirmed) a stale `reopen_bill` request (its invoices changed between raise and approve) is refused by `apply` with `BILL_NOT_OPEN { bill_id, state }`; §9 gets no new code. §6.13 (H2-17, H8-9) / R-66 already said the answer is refused, without a code. Text only. | 05 v1.0.17 §6.13, §3.14; plan row 19 |
| R-75 | G-73 | (2026-11-20, task 23, owner ruling) `OpenCashDrawer` writes **no** `bill_print_jobs` row: it has no bill or seating, so no bill view would show it, and `RetargetBillPrint` could move a drawer kick to another counter (against R-57). §3.16 "every job id" → "every **bill-document** job id", no-sale excluded; the §5 CHECK keeps `no_sale`, unused, no migration; §6.21 statements **≤ 4** (4 with a note, 3 without, 1 with no own route or off-drawer); result **`{ shift_id, printed }`**, `printed` = a kick job was queued. Text only. | 05 v1.0.18 §3.16, §5, §6.21, #55; plan row 23 |
| R-76 | G-74, G-77 | (2026-11-20, task 21, owner ruling) `CloseBusinessDay` is refused while any `shift_variance` request is pending — `409 DAY_CLOSE_BLOCKED { reason: 'variance_pending', shifts: [{ shift_id, staff_name, closed_at, alert_id }], count }` (≤ 40), after `shift_open`, before `unbilled_orders`; the existing code and list, no new code; reverses v0.6 Q-2's "never blocks". Why: §3.14 / H7-5 (a reject always succeeds) and R-44 (`business_date` = the open day) hold only if a day is open whenever a variance is answered. The `apply`'s `BUSINESS_DAY_NOT_OPEN` guard (task 21) stays as defence, unreachable. Day-close bound ≤ 10 → ≤ 11. 01a's row A-5 listing follow-up in G-77. Text only. | 05 v1.0.18 §6.25, §3.13, §3.14, §6.17, §9, #50b, #50c, #62, #62b; plan rows 21, 25 |
| R-77 | G-75 | (2026-11-20, task 22 review, integrator) §3.12 `SettlePettyAdvance { advance_id, … }` → `entry_id`, as §6.20 and the contract. Text only. | 05 v1.0.18 §3.12; plan row 22 |
| R-78 | G-76 | (2026-11-20, task 21 review, integrator) result fields named: `closed_requests: string[]` (`CountShift`, `CloseShift`), `open_advances` (`CloseShift`); §6.18's `\| { pending }` removed (a skip close raises no request, Q-2); `HandoverCount` 2 → **≤ 2** (actual 1); the `shift_variance` requester is the counter, so any other holder of `close-shift-for-others` answers — a Manager counting his own shift needs another holder (Owner). Text only. | 05 v1.0.18 §6.17–§6.19, §3.14; plan row 21 |

## Owner questions (all settled 2026-11-19)

Q-1 (G-13) -> R-6 (a). Q-2 (G-23) -> R-10 (b), rest R-14. Settled with no question: G-1 (spec 3.1), G-14 (code), G-15 (CLAUDE.md error-code rule), G-16 (F D46), G-12 (1 s loop), G-22 (01d tick), all others by code.
