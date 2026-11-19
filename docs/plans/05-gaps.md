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

Counts: Blocker 5, Major 12, Minor 10 (27 rows). G-28 (Major) added 2026-11-19 after the sweep: Blocker 5, Major 13, Minor 10 (28 rows). G-29, G-31 (Major) and G-30 (Minor) added 2026-11-19 from the 05 design brief (PR #316): Blocker 5, Major 15, Minor 11 (31 rows). G-32 (Major) and G-33 (Minor) added 2026-11-19: Blocker 5, Major 16, Minor 12 (33 rows). G-34 (Minor) added 2026-11-20: Blocker 5, Major 16, Minor 13 (34 rows).

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
| R-25 | — (P0.4) | (2026-11-19) An H-1 retransmit across routes follows the per-route M47 replay rule as written: admin-first then device → replays; device-first then admin → `400`; nothing ever runs twice. A clarifying sentence goes into the next 00 bump. | P0.4 (tests); next 00 bump (text) |
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

## Owner questions (all settled 2026-11-19)

Q-1 (G-13) -> R-6 (a). Q-2 (G-23) -> R-10 (b), rest R-14. Settled with no question: G-1 (spec 3.1), G-14 (code), G-15 (CLAUDE.md error-code rule), G-16 (F D46), G-12 (1 s loop), G-22 (01d tick), all others by code.
