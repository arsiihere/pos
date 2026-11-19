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

Counts: Blocker 5, Major 12, Minor 10 (27 rows).

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

## Owner questions (all settled 2026-11-19)

Q-1 (G-13) -> R-6 (a). Q-2 (G-23) -> R-10 (b), rest R-14. Settled with no question: G-1 (spec 3.1), G-14 (code), G-15 (CLAUDE.md error-code rule), G-16 (F D46), G-12 (1 s loop), G-22 (01d tick), all others by code.
