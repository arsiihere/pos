# 05c — Payments Integration (Paymob SoftPOS, Bank Alfalah Raast) — Module Spec v0.1 (DRAFT)

**v0.1 — DRAFT (2026-11-24), pending hostile review in a fresh session + owner.** New module spec asked for by the 02b-TK hand-off, gap **G-12** (`docs/design/handoff/02b-tk/GAPS.md`; frames `PayNfcTablet`, `PayRaast`, `CustomerDisplayRaast`, `PayError` in `docs/design/handoff/02b-tk/design/`) and by the 02b-TK owner rulings (`docs/plans/02b-tk-rulings.md`, "Part B … new 05c"). It lifts part of 05 §1.3's out-of-scope line "Card-terminal or wallet integration and reconciliation (R7, P2) … Raast payment QR (G1-11)" for **two providers only**; reconciliation stays out. Decision rows are **P1 …**. Every provider-specific field below is marked **(to confirm with provider docs)**: no provider document is in the repo on 2026-11-24, and this spec does not invent provider API details.

---

## §1. Header

| Field | Value |
|---|---|
| Module | 05c Payments integration: a **payment provider port** with three adapters (`fake` for tests, `paymob_softpos` card by NFC on the Android tablet, `alfalah_raast` Raast P2M dynamic QR); a **PaymentIntent** lifecycle on the hub whose success appends 05's `PaymentAdded` by itself, carrying the provider reference; a **cloud webhook relay** the hub pulls, plus hub-side polling of the provider |
| Version | **v0.1 — DRAFT** (2026-11-24) |
| Depends on | Foundation **v1.17** (§6 Shared Standards; §6.2 status map; §6.3 "the hub has no remote dependency on its request path"); 00 Hub Platform & Access **v1.12.4** (command pipeline §3.7, synchronous `handle`, after-commit hooks; route guards; branch API key; cloud allowlist D54); 01a Restaurant Setup v2.10 (billing settings document, snapshot `billing.settings.payment_modes`); 01b Staff & Roles v1.11 (permission catalogue); 01d Notifications v1.3.6 (alert kinds); **05 Billing v1.0.34** (§3.5 dues, §3.7, §6.9 `AddPayment`, B10, B11, B12, B30, §3.15 fiscal port pattern, Appendix P P.2 / P.6 A13); **05b Staff Tablet App v1.0.1** (`PosNative`, §3.6 guards, M-14 `native_api`) |
| Inherits | **Shared Standards from Foundation v1.17 §6**, unchanged (envelope, error naming, status map, naming, tests, migrations) |
| Changes other specs | 05 → next patch (rows B-1 … B-5); 05b → v1.1 (T-1, T-2); 01a → next (A-1); 01b → next (R-1); 01d (D-1); 00 HPA (H-1, H-2); Foundation §6.2 append (F-1, no bump). Full list §4.5 |
| Tier | **T2 Production** (CLAUDE.md). Real races: a webhook and a poll confirming the same payment; a bill changing while a QR is shown; a cancel crossing a late success. Money is taken by a third party, so every success must land **exactly once** |
| Milestone | A (pilot, 2027-02-28) **only if** the outside dependencies of §7.3 are met in time. **Fallback:** card and Raast stay manual `AddPayment` modes with a typed reference, exactly as 05 v1.0.34 today; nothing else in the pilot depends on 05c |
| Build split | **05c-1** port + `fake` + intents + 05 guards + hub queries (no provider, fully testable). **05c-2** `alfalah_raast` + cloud relay + customer display. **05c-3** `paymob_softpos` + 05b plugin. 05c-2 and 05c-3 start only when their provider's sandbox credentials and API documents are in hand (§11 STOP) |

### Stories covered

| Source | Item | How |
|---|---|---|
| G-12 | Card by NFC on the tablet (Paymob), "Tap the card on the back of this tablet … waiting for card" (`PayNfcTablet`) | P3, P9, §6.1, §8, 05b rows T-1/T-2 |
| G-12 | Dynamic Raast QR that "closes by itself when paid", "Also on the customer screen" (`PayRaast`, `CustomerDisplayRaast`) | P3, P10, §6.1, §6.6, §8 |
| G-12 | Failure "Payment didn't go through. Nothing was charged. Try again or choose another way", provider code shown (`PayError`) | P6, `PaymentIntentFailed.error_code`, §8 |
| G-12 | Automatic `AddPayment` with the provider reference | P5, row B-1 |
| G-13 | Cash while the hub is offline | **Not changed** (P12): stays out; no intent offline either |
| G-14 | Counter-facing customer display shows the Raast QR state | Client only, from §6.6 (P10) |

### In scope
- Hub: provider port + registry; adapters `fake`, `paymob_softpos`, `alfalah_raast`; three commands (`StartPaymentIntent`, `CancelPaymentIntent`, `ReportPaymentIntentResult`), one admin command (`SetPaymentCredential`), three queries; a **payments worker** (create at provider, poll, expire, apply relayed notifications); seven events; guards in five 05 commands and two 05 day / shift paths (rows B-2, B-3).
- Cloud: a public webhook route per provider (signature checked, deduped), a pull route for the hub on the branch API key, an owner route that sets the webhook secret.
- Tablet (05b): card-payment methods on `PosNative`, `native_api` 1 → 2.
- Client: the Card (tablet) and Raast QR panels of the take-payment sheet, the customer-display QR, the failure panel, the manager's "unapplied payments" list, the hub admin credentials form, owner-app provider fields.

### Out of scope
- **Reconciliation** with provider settlement reports, chargebacks, provider fees (R7 P2 stays).
- **Refunds through a provider** (`direction: 'out'` stays manual: a provider-portal refund + a manual `AddPayment { direction: 'out' }`, as today) → §12.4.
- Any provider other than the two named; external card terminals (ECR link); wallets other than Raast QR (JazzCash / EasyPaisa direct).
- Cash or any payment while the hub is unreachable (G-13, P12).
- Payment links / pay-online for phone orders.
- A customer-facing payment page served by the hub.

---

## §2. Existing architecture that must not change

| Item | Source |
|---|---|
| Commands: `POST /commands/<name>`, `defineCommand`, one writer transaction, `handle` **synchronous**, async work only before the writer or after commit; `command_id` idempotency; money commands **never queueable** | F §6.3; 00 §3.7; 05 §6 header (G0-1) |
| "The hub has no remote dependency on its request path" (503 is cloud-only) | F §6.2 status map |
| `PaymentAdded { payment_id, bill_id, split_no, mode_id, payment_class, direction, amount_minor, tendered_minor, change_minor, has_reference, taken_by_staff_id, shift_id }`; reference text only in hub table `payment_references`, never in an event (B10, B30) | 05 §6.9, `apps/hub/src/billing/commands/payments.ts:45-60` |
| Every `in` ≤ its due field (`card_due` for a digital mode), `PAYMENT_EXCEEDS_BALANCE` otherwise; money shift resolved per B11; `SHIFT_NOT_OPEN` without one | 05 §3.7, §6.9 |
| On a branch whose adapter ≠ `none`, a **fiscalized** order type takes only a mode with an `authority_codes` entry for that adapter, else `422 PAYMENT_MODE_NOT_FISCAL` | 05 §6.9 (H7-4, H8-3, J-5); `payments.ts:108-114` |
| Payment modes are owner data in the branch billing settings document: `{ mode_id, name, kind ∈ cash\|card\|wallet\|online\|other, payment_class cash\|digital, reference_required, is_active, sort_order, authority_codes[{ adapter_key, code }] }`; seed has cash only | `packages/events/src/admin/billing.ts:59-68`; 01a §5.2b |
| `checkBillingWiring` refuses startup if any 05 event lacks a WS audience or (outside `NO_AUDIT_ACTION`) an audit map | `apps/hub/src/billing/index.ts:206-218` |
| Worker pattern for remote calls: the fiscal outbox worker posts outside any request, appends its answer as a system event (`actor_id null`, `device_id 'hub'`), retries with backoff | 05 §3.15, `apps/hub/src/billing/fiscal/worker.ts` |
| Hub secrets: write-only admin command, hub-only table, never synced / logged / returned / in an event (`SetFiscalToken`, `fiscal_credentials`) | 05 B22, §6.28a |
| Hub is LAN-only (no inbound internet); it calls out (cloud config poll with the branch API key; fiscal posts over HTTPS) | 00 §3.1, F §6.3, 05 K-16 |
| Hub tests never reach a cloud host (`apps/hub/test/no-cloud-network.int.test.ts`) | 01c AD-29 |
| Tablet native code = `PosNative` + `AlertService`; methods guarded per origin / path; `native_api` = 1 | 05b §3.6, §4.2, M-14 |

---

## §3. Domain rules

### 3.1 Module decisions

| # | Decision | Reason | Overrides / changes |
|---|---|---|---|
| P1 | **Provider port** (`apps/hub/src/payments/port.ts`), shaped like 05's fiscal port: `PaymentProvider { key, capabilities: { display: 'qr' \| 'device_sdk', status_query: boolean, webhook: boolean, cancel: boolean, currencies: string[], ttl_ms: number, device_types: DeviceType[] \| null }, settingsSchema, credentialNames, create(req), status(req), cancel(req), health() }` (§3.4). Registered at startup by key; `fake` is registered **only by the test harness** (never by `server.ts`). The core never branches on a provider key | One place for provider differences; tests run on `fake` with no network | — |
| P2 | **Mode → provider binding is owner data**: `PaymentMode` gains optional `provider: { provider_key, settings } \| null` (default `null` = manual mode as today). Allowed only when `payment_class = 'digital'` and the provider accepts the mode's `kind` (`paymob_softpos`: `card`; `alfalah_raast`: `online` or `wallet`); `settings` validated by the provider's `settingsSchema` (never a secret) — checked by the cloud PUT (row A-1) and again by the hub at use. One provider-bound mode per provider per branch | Modes are data (05 B10, K-7); the owner turns a provider on per branch without code | 01a billing document (row A-1) |
| P3 | **A PaymentIntent** is the hub's record of "this split is waiting for this much money from this provider". States: `creating → ready → succeeded \| failed \| expired \| cancelled`; also `creating → failed \| cancelled`. **At most one open intent (`creating` or `ready`) per bill** (`409 PAYMENT_INTENT_PENDING`). Stream `bill`, `stream_id` = `bill_id` (no new stream type) | One customer pays at a time; a second terminal on the same bill is a mistake; the bill stream already carries the money facts | — |
| P4 | **Amount bound at start.** `StartPaymentIntent.amount_minor` is optional; absent = the split's **`card_due_minor`** now (§3.5 (7) of 05, digital class). Present: 1 … `card_due_minor`; `card_due = 0` or above it → `422 PAYMENT_EXCEEDS_BALANCE { balance_minor: <card_due> }` — the same rule `AddPayment` applies. The amount is frozen on the intent and sent to the provider; it **never** changes. A partial amount (rest in cash) is allowed | The customer sees and pays one fixed amount (dynamic QR); 05's cap stays the cap | — |
| P5 | **Success = 05's own payment, appended by the worker.** In one writer transaction the worker re-reads the intent, then calls 05's exposed `providerPaymentDrafts(tx, …)` (row B-1), which runs `AddPayment`'s checks (split open, mode still active, fiscal gate, `in` ≤ `card_due`) **without** session, permission or shift resolution, and returns `PaymentAdded` with `taken_by_staff_id` = the intent's **`started_by_staff_id`** and `shift_id` = the intent's **frozen `shift_id`**, `has_reference: true`; the provider's transaction reference goes to `payment_references` with `source = 'provider'` (row B-4). Then `PaymentIntentSucceeded { payment_id, applied: true }`. Envelope `actor_id null`, `device_id 'hub'` (as `FiscalNumberAssigned`) | The person who started it took the payment (B11 taken-by); the shift is the one whose drawer / person started it; one code path for payment rules | 05 §6.9 (row B-1) |
| P6 | **Exactly once.** A success is applied only from state `ready` (or late, P8) and only if the intent has no `payment_id`; the provider transaction reference is unique on the hub (`payment_intent_provider_txn`, §5.2); the cloud dedupes notifications by `(tenant_id, provider_key, provider_event_id)`. A second confirmation of the same intent (webhook after poll, two polls, a relay replay) finds `state = succeeded` and is a no-op (logged as `duplicate`). Provider-side create uses `intent_id` as the merchant reference / idempotency key **(to confirm with provider docs)** | Webhooks and polls both arrive; at-least-once delivery from the provider | — |
| P7 | **Proof of payment.** The worker marks a payment paid only on (a) the provider's **server** status answer `paid` for this intent, or (b) a relayed notification whose signature the cloud verified **and**, when the provider has `status_query`, a confirming status call. A device result (SoftPOS SDK on the tablet) is **never** proof: it only wakes the worker (§6.3). Amount and currency must equal the intent's; otherwise the money is recorded **unapplied** (`amount_mismatch`, P8) | A page script or a forged webhook must not create money | — |
| P8 | **Late or unapplicable success.** A confirmed payment that arrives after `cancelled`, `expired` or `failed`, or that cannot be applied (split closed, bill not open, `amount > card_due` now, the frozen shift closed, amount mismatch), is still recorded: `PaymentIntentSucceeded { applied: false, payment_id: null, unapplied_reason, after_state }` and a 01d alert **`payment_unapplied`** to holders of `close-shift-for-others` (row D-1). Nothing is added to any bill. The manager resolves it by hand (refund in the provider portal, or a manual `AddPayment` with the reference on the right bill) and closes the alert. When the split is still open and the amount fits, a late success **is** applied (`applied: true, after_state: 'expired'`) | Money the customer paid is never silently lost; 05's balance rule is never broken | — |
| P9 | **Expiry.** `expires_at = created_at + capabilities.ttl_ms` (`paymob_softpos` 120 000, `alfalah_raast` 300 000 — defaults, **to confirm with provider docs**: Raast QR validity is set by the bank). At `expires_at` the worker makes one final status call; `paid` → success; otherwise `PaymentIntentExpired { last_check }` and a best-effort provider cancel. A `creating` intent the provider has not accepted within 15 s → `PaymentIntentFailed { reason: 'provider_unreachable' }` | The counter must not wait for ever; a late payment is P8's case | — |
| P10 | **Display.** `ready` makes the intent's display data readable through `GET /queries/payment-intent` (§6.6): for `qr`, the **QR payload** and an SVG the hub renders with its existing `qrcode` 1.5.4 dependency (no new client dependency); for `device_sdk`, the SDK parameters for the tablet plugin. The kiosk's customer display gets it from the order screen over `BroadcastChannel` (G-14, client only). Display data lives only in the hub table `payment_intent_provider`, never in an event | QR payloads are provider data, not facts; the second screen needs no hub change | — |
| P11 | **The 05 bill is held while an intent is open.** On the intent's bill: `AddPayment` (any split), `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `CloseSplit` → `409 PAYMENT_INTENT_PENDING { intent_id }` (row B-2); `CountShift` / `CloseShift` of the intent's shift and 01a `CloseBusinessDay` → the same code (row B-3). Commands that **raise** the due (`RemovePayment`, `RemoveDiscount`, `ApplyServiceCharge`, new items) are not held. Line-level reductions in 02b / 04 (`RemoveItems`, `VoidItems`, `CompLine`) are **not** guarded (OQ-4): if one lowers `card_due` below the amount, a success is unapplied (P8) | The window is ≤ 5 min; 05's own commands are where a cashier would change the split under the customer; keeping 02b / 04 untouched avoids three more spec bumps | — |
| P12 | **Online only, both ways.** Every 05c command needs the hub (not queueable, F §6.3). The hub refuses a start when the provider cannot be reached **as last known** (`409 PAYMENT_PROVIDER_UNAVAILABLE { reason: 'failing' }`, from the worker's health record, no remote call in the request path). No intent while the hub is unreachable from the device; no cash offline (G-13 unchanged) | F §6.2: no remote dependency on the request path; G-13 ruling | — |
| P13 | **Credentials.** Provider API secrets (`credentialNames`) are hub secrets: `SetPaymentCredential` (admin session, new permission `manage-payment-providers`, Owner only by default, row R-1), write-only, table `payment_credentials`, never synced, logged, returned or in an event (audit event `PaymentCredentialSet` carries `provider_key`, `name`, time). The **webhook signing secret** is needed by the cloud and lives only in the cloud table `payment_webhook_endpoints` (owner route, write-only). No secret in the repo, the spec, the snapshot or the config file | Same rules as fiscal tokens (B22) | — |
| P14 | **Cloud relay, pulled by the hub.** Providers post webhooks to the cloud (`POST /v1/payments/webhooks/:provider_key/:endpoint_id`); the cloud checks the signature with the branch's secret, extracts only the fields of §5.3, stores one row, answers 200. The hub pulls `GET /v1/sync/payment-notifications?after=` on its branch API key every **3 s while any intent is open or ended in the last 15 min**, else every 60 s. No cloud → hub push channel is added | The hub is LAN-only (no inbound); 06 sync is not built; the config poll already proves the outbound path | — |
| P15 | **Hub polling.** For a `ready` intent of a provider with `status_query`, the worker calls `status` every 3 s (and at once after a relayed notification or a `ReportPaymentIntentResult`). A provider with neither `status_query` nor `webhook` cannot be registered (startup error) | Works when the webhook path is down; a webhook-only provider still works through the relay | — |
| P16 | **PRA gate (A13) is explicit, not new.** `StartPaymentIntent` runs 05's fiscal gate (`PAYMENT_MODE_NOT_FISCAL`) **before** contacting the provider, so a Raast mode on a `PK-PB` branch is refused on every fiscalized order type until the mode has a `PRA` `authority_codes` entry (05 Appendix P.6 A13). A Paymob card mode carries the seeded PRA card code `2` and passes. **05c never invents an authority code.** Pilot options: owner question OQ-1 | A wrong `PaymentMode` code is a fiscal misreport; the money must not be taken first and refused at the bill | — |
| P17 | **Words.** Core text says provider, intent, provider reference; "Paymob", "SoftPOS", "Alfalah", "Raast", "P2M" appear only in §3.6 / §3.7, the adapter files and the settings | As 05 B32 | — |

### 3.2 State machine

```
                 StartPaymentIntent (command)
                          │
                          ▼
                     ┌─────────┐  worker: create refused / no answer in 15 s ──► FAILED
                     │creating │  CancelPaymentIntent ─────────────────────────► CANCELLED
                     └────┬────┘
           worker: create ok (PaymentIntentReady)
                          ▼
                     ┌─────────┐  status/notification paid + checks ok ──────► SUCCEEDED (applied)
                     │  ready  │  status/notification paid, cannot apply ────► SUCCEEDED (unapplied, alert)
                     └────┬────┘  provider final failure (declined) ─────────► FAILED
                          │       CancelPaymentIntent / Report(declined) ────► CANCELLED
                          │       expires_at + final check not paid ────────► EXPIRED
  FAILED / CANCELLED / EXPIRED ── later confirmed payment ──► SUCCEEDED (after_state set; applied if P8 allows)
```

`succeeded` is terminal. Open = `creating` or `ready`.

### 3.3 Command processing order

payload Zod (`400`) → session + permission (pipeline, `403`) → ensure bill / intent read (`404`) → state rules (`409`) → mode / provider / device rules (`404` / `422` / `409`) → fiscal gate (`422`) → shift (`409`) → money (`422`) → append (one writer transaction; the `payment_intents` projection folds live) → result → after-commit: wake the worker. Retransmit by `command_id` returns the stored result (00 §3.7).

### 3.4 Port contract (`apps/hub/src/payments/port.ts`)

```ts
export interface PaymentProvider {
  key: string;                                   // 'fake' | 'paymob_softpos' | 'alfalah_raast'
  capabilities: {
    display: 'qr' | 'device_sdk';
    status_query: boolean; webhook: boolean; cancel: boolean;
    currencies: string[];                        // ISO 4217; a branch whose tenant currency is not listed cannot bind the mode
    ttl_ms: number;                              // P9
    device_types: ('tablet' | 'phone' | 'cashier_kiosk')[] | null;   // null = any staff device; paymob_softpos: ['tablet']
  };
  settingsSchema: ZodType;                       // opaque per-mode settings (e.g. merchant / terminal ids); never a secret field
  credentialNames: string[];                     // read from payment_credentials at each call, never logged
  create(req: ProviderRequest): Promise<CreateAnswer>;
  status(req: ProviderRequest & { provider_intent_ref: string | null; device_txn_ref: string | null }): Promise<StatusAnswer>;
  cancel(req: ProviderRequest & { provider_intent_ref: string | null }): Promise<'ok' | 'not_supported' | 'already_final' | 'retry'>;
  health(): Promise<'ok' | 'failing'>;
}
export type ProviderRequest = {
  intent_id: string;                             // merchant reference / idempotency key at the provider (P6)
  amount_minor: number; currency_code: string; currency_exponent: number; expires_at: number;
  settings: unknown; credentials: Record<string, string>; environment: 'sandbox' | 'production';
};
export type CreateAnswer =
  | { outcome: 'ok'; provider_intent_ref: string | null;
      display: { kind: 'qr'; qr_payload: string } | { kind: 'device_sdk'; sdk_params: Record<string, string> } }
  | { outcome: 'retry'; error_code: string }     // short codes only ('timeout', 'http_503')
  | { outcome: 'rejected'; error_code: string };
export type StatusAnswer =
  | { outcome: 'paid'; provider_txn_ref: string; amount_minor: number; currency_code: string }
  | { outcome: 'pending' }
  | { outcome: 'failed'; error_code: string }    // final at the provider (declined, cancelled by payer)
  | { outcome: 'expired' }
  | { outcome: 'retry'; error_code: string };
```

Transport for real adapters: Node 22 `fetch`, `AbortSignal.timeout(10_000)`, base URLs from the mode's settings or the adapter's defaults per `environment` (as PRA P.2). `error_code` ≤ 20 printable chars, never a provider message text.

### 3.5 `fake` adapter (tests only)

`apps/hub/test/payments/fake-provider.ts`. Capabilities configurable per test (`display`, `status_query`, `webhook`, `cancel`, `ttl_ms`). Test controls: `fake.answerCreate(intent_id, CreateAnswer)`, `fake.settle(intent_id, StatusAnswer)`, `fake.failHealth()`. A `fakeRelay` stands in for the cloud pull client. No network.

### 3.6 `alfalah_raast` adapter (Bank Alfalah, Raast P2M dynamic QR) — every field **to confirm with provider docs**

| Item | Draft (to confirm) |
|---|---|
| Kind of integration | Merchant API of Bank Alfalah for Raast P2M **dynamic** QR (amount + reference inside the QR). API access requested by email on 2026-11-23; no document yet |
| `create` | Ask the bank for a dynamic QR for `amount_minor` with reference `intent_id`; answer: the QR payload string (EMVCo-style per SBP Raast QR spec, **to confirm**) and the bank's QR / transaction id → `provider_intent_ref`. If the bank lets the merchant build the QR locally, `create` builds it and `provider_intent_ref = null` (**to confirm**) |
| `status` | Query by `provider_intent_ref` or `intent_id` (**to confirm whether a status API exists**) |
| Webhook | Payment notification to the cloud URL; signature scheme (HMAC header, mutual TLS, IP allow list…) **to confirm**. The extractor keeps only §5.3 fields; payer name, account / IBAN, CNIC or phone are **never** stored |
| `cancel` | **To confirm** whether a dynamic QR can be withdrawn; else `not_supported` and expiry covers it |
| `ttl_ms` | 300 000 default; the bank's QR validity wins (**to confirm**) |
| Settings | `{ merchant_id, till_or_store_id?, base_url? }` (names **to confirm**) |
| Credentials | `credentialNames` from the bank's auth scheme (e.g. client id + secret) (**to confirm**) |
| Mode | `kind: 'online'` (or `wallet`), `payment_class: 'digital'` (PRA digital rate when allowed, 05 P.4) |

### 3.7 `paymob_softpos` adapter (Paymob SoftPOS, card by NFC on the tablet) — every field **to confirm with provider docs**

| Item | Draft (to confirm) |
|---|---|
| Kind of integration | Paymob's SoftPOS Android SDK inside the 05b app reads the card by NFC; Paymob's servers authorise. Needs merchant onboarding for SoftPOS, an SDK licence and device certification / attestation (**to confirm**: supported models, Android version, whether device-owner lock task conflicts with the SDK's attestation) |
| `create` | If the SDK needs a server-created order / token: create it with reference `intent_id` and return `sdk_params`; else build `sdk_params` locally `{ merchant_reference: intent_id, amount, currency }` with no call (**to confirm**) |
| Device step | The page calls `PosNative.startCardPayment` (row T-1); the SDK result comes back to the page, which sends `ReportPaymentIntentResult` (§6.3) — a **hint**, never proof (P7) |
| `status` | Paymob transaction inquiry by merchant reference or the SDK's transaction id (`device_txn_ref`) (**to confirm**) |
| Webhook | Paymob transaction callback; HMAC verification scheme **to confirm** (field order, hash) |
| `cancel` | Void of an unsettled transaction is a refund case → out of scope; `cancel` only stops a pending order if Paymob supports it, else `not_supported` |
| `ttl_ms` | 120 000 |
| Settings | `{ terminal_id?, integration_id?, base_url? }` (names **to confirm**) |
| Mode | `kind: 'card'`, `payment_class: 'digital'`, `authority_codes` `[{ adapter_key: 'PRA', code: '2' }]` on a `PK-PB` branch (05 P.2) |
| Live gate | **Not live without server-side confirmation** (P7). If Paymob offers neither status inquiry nor callback for SoftPOS, STOP to the owner (OQ-3) |

### 3.8 Validation rules

| Rule | Error |
|---|---|
| `amount_minor` 1 … min(10¹², `MAX_SAFE_INTEGER`); `split_no` 1 … 20; `mode_id` 1 … 40 | `400` |
| Mode not active in settings | `404 PAYMENT_MODE_NOT_FOUND { mode_id }` |
| Mode has no provider binding | `422 PAYMENT_MODE_NO_PROVIDER { mode_id }` |
| Provider key not registered on this hub, its credentials not all set, or tenant currency not in `currencies` | `409 PAYMENT_PROVIDER_UNAVAILABLE { provider_key, reason: 'not_configured' }` |
| Last health check `failing` (and not older than 120 s) | `409 PAYMENT_PROVIDER_UNAVAILABLE { provider_key, reason: 'failing' }` |
| Caller's device type not in `device_types` | `422 PAYMENT_PROVIDER_DEVICE_UNSUPPORTED { provider_key, device_type }` |
| Fiscal gate (05 §6.9) | `422 PAYMENT_MODE_NOT_FISCAL { mode_id, adapter_key }` |
| No money shift (B11) | `409 SHIFT_NOT_OPEN { reason: 'no_shift' }` |
| Another open intent on the bill | `409 PAYMENT_INTENT_PENDING { intent_id }` |
| Split closed / bill closed or absorbed | `409 BILL_NOT_OPEN { bill_id, state }` |
| `card_due = 0` or `amount_minor > card_due` | `422 PAYMENT_EXCEEDS_BALANCE { balance_minor }` |
| Intent unknown | `404 PAYMENT_INTENT_NOT_FOUND { intent_id }` |
| Cancel / report on an intent that is not open | `409 PAYMENT_INTENT_FINAL { intent_id, state }` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 05 (row B-1) | `providerPaymentDrafts(tx, { bill_id, split_no, mode_id, amount_minor, taken_by_staff_id, shift_id, reference }) → { applied: true, drafts, payment_id } \| { applied: false, reason }`; `splitDues(tx, bill_ref, split_no) → { head, card_due_minor, … }` (the bill-view reading `AddPayment` uses); `fiscalGate(config, order_type, mode, now)` (the `payments.ts:108-114` predicate, exported unchanged); `moneyShiftOf(tx, device_id, staff_id)` (B11) |
| 05 | `billAudience` (WS), `registerAuditAction`, 05's day-close guard list (row B-3) |
| 01a | `branchConfig()` → billing settings, payment modes (with row A-1's `provider`), tenant currency |
| 00 | command / query registries, writer, after-commit hook, branch API key client (`sync/config-client.ts` transport), device type of the session |
| 01d | `registerAlertKind('payment_unapplied', …)`, `openAlert` (row D-1) |
| 05b (rows T-1, T-2) | `PosNative.cardPaymentInfo / startCardPayment / cancelCardPayment` (client only) |

### 4.2 Exposes

| Export | Shape | Used by |
|---|---|---|
| Events (bill stream) `PaymentIntentCreated`, `PaymentIntentReady`, `PaymentIntentSucceeded`, `PaymentIntentFailed`, `PaymentIntentExpired`, `PaymentIntentCancelled`; (hub stream) `PaymentCredentialSet` — all v1 (§5.4) | `@pos/events/src/events/{bill,hub}/` | 06 (sync), 07 (payments by provider), 04 audit view |
| `openIntentOf(db, bill_id) → { intent_id, shift_id } \| null`, `openIntentsOfShift(db, shift_id) → count` (1 statement each) | `apps/hub/src/payments/exports.ts` | 05 guards (rows B-2, B-3) |
| `PAYMENTS_EVENT_TYPES` | list | 05's wiring check (row B-5) |

### 4.3 Story → build part

05c-1: P1–P9, P11–P13, P16, §6.1–§6.4, §6.6–§6.8 on `fake`. 05c-2: §3.6, P10, P14, §6.9–§6.11, customer display. 05c-3: §3.7, rows T-1/T-2, the Card panel.

### 4.4 Requirements carried to other modules

| To | Requirement |
|---|---|
| 06 | Sync carries the seven events; `payment_intent_provider`, `payment_credentials`, `payment_relay_cursor` are hub state, **never synced** (like `payment_references`). A hub restore with an intent open: the worker resumes from the projection; open intents past `expires_at` follow P9 at the first tick |
| 07 | Payments by provider from `PaymentAdded` joined with `PaymentIntentSucceeded.payment_id`; unapplied payments from `applied: false` |

### 4.5 Changes to other specs (R26) — *proposed, applied when 05c is approved*, each target bumped with a changelog and "⚠️ Changed by 05c (row X)" markers

| Row | Target → section | Change | Why |
|---|---|---|---|
| B-1 | **05** §6.9, §4.2 | Expose `providerPaymentDrafts` (AddPayment's checks minus session / permission / shift resolution; taker and shift given; reference with `source 'provider'`; statements ≤ 6), `splitDues`, `fiscalGate`, `moneyShiftOf`. `AddPayment` itself unchanged except row B-2. **§6.9 reference source:** a payment reference is either typed by staff (`source 'staff'`) or the provider's transaction reference (`source 'provider'`); both only in `payment_references` | P5 |
| B-2 | **05** §6.5, §6.6, §6.8, §6.9, §6.12 | `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `AddPayment`, `CloseSplit` refuse with `409 PAYMENT_INTENT_PENDING { intent_id }` while `openIntentOf(bill)` is not null (+1 statement each) | P11 |
| B-3 | **05** §6.17, §6.18, §6.25 | `CountShift` / `CloseShift` refuse while `openIntentsOfShift > 0`; 05's `CloseBusinessDay` guard list gains "open payment intents" (`409 PAYMENT_INTENT_PENDING`) | P11 |
| B-4 | **05** §5 | `payment_references.source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','provider'))` (ALTER in 05c's hub migration, §5.2) | P5 |
| B-5 | **05** §6.30 | `checkBillingWiring` also checks `PAYMENTS_EVENT_TYPES` (audience + audit map; `PaymentIntentReady` in `NO_AUDIT_ACTION`) and that every provider key bound in the current settings is registered (warning at boot, `not_configured` at start) | the wiring rule |
| A-1 | **01a** billing settings document, `packages/events/src/admin/billing.ts`, owner page | `PaymentMode.provider?: { provider_key, settings } \| null` (additive, default `null`); PUT checks P2 (digital only, kind allowed, one bound mode per provider, settings schema, currency); owner form "Take this payment through: none / Paymob SoftPOS / Bank Alfalah Raast" + settings fields; webhook secret form (§6.11) | P2 |
| R-1 | **01b** §4.2, `packages/domain/src/permissions.ts` | `manage-payment-providers`: group `bills`, scope `branch`, Owner only by default | P13 |
| D-1 | **01d** alert kinds | Kind `payment_unapplied` (registered by 05c, as 05's `fiscal_outbox_stuck`): audience `close-shift-for-others`, family money, closes on "Resolved" by a holder; body shows token / bill, amount, provider, last 4 of the provider reference | P8 |
| H-1 | **00 HPA** §5.2 / cloud allowlist (D54) | Public route `POST /v1/payments/webhooks/:provider_key/:endpoint_id` on the tenant-scope allowlist (resolved by `endpoint_id`, like the registration-code routes); body limit 16 KB; in the route inventory test | P14 |
| H-2 | **00 HPA** §5.2 cloud | `GET /v1/sync/payment-notifications` on the branch API key | P14 |
| T-1 | **05b → v1.1** §4.2, §3.6 | `PosNative` gains `cardPaymentInfo() → { available, reason? }`, `startCardPayment({ intent_id, amount_minor, currency_code, sdk_params }) → { outcome: 'approved' \| 'declined' \| 'cancelled' \| 'error', device_txn_ref?, error_code? }`, `cancelCardPayment({ intent_id })`; allowed from the hub origin, path `/staff/` only; **`native_api` = 2**; the page's `MIN_NATIVE_API` stays 1 and feature-checks these methods (M-14) | P7, §3.7 |
| T-2 | **05b → v1.1** §10, `tablet.yml` | Paymob SDK dependency pinned in `apps/tablet` (own lockfile), NFC permission, Gradle unit tests for the plugin's guard and result mapping, manual NFC check per pilot model (§10.6) | §3.7 |
| F-1 | Foundation §6.2 status map | §9 codes appended (no bump, R34) | §9 |
| — | 02b, 04, 03a, 03c | **No change** (OQ-4) | P11 |

---

## §5. Data model and migrations

Numbers assume nothing else merges first (hub `0028` is 08d's, cloud `0019`/`0020` are 08b/08d's); renumber at build (OQ-7).

### 5.1 Events (`@pos/events`, `schema_version` 1, `.strict()`)

| Event (stream) | Payload | Audit action | WS audience |
|---|---|---|---|
| `PaymentIntentCreated` (bill) | `{ intent_id, bill_id, split_no, mode_id, provider_key, payment_class: 'digital', amount_minor, currency_code, shift_id, started_by_staff_id, device_id, expires_at }` | `payment_intent_started` | `billAudience` |
| `PaymentIntentReady` (bill) | `{ intent_id, display_kind: 'qr' \| 'device_sdk', has_provider_ref }` | none (`NO_AUDIT_ACTION`, like `FiscalNumberAssigned`) | `billAudience` |
| `PaymentIntentSucceeded` (bill) | `{ intent_id, applied: boolean, payment_id: string \| null, amount_minor, unapplied_reason: null \| 'split_closed' \| 'bill_not_open' \| 'exceeds_due' \| 'shift_closed' \| 'mode_inactive' \| 'not_fiscal' \| 'amount_mismatch', after_state: null \| 'failed' \| 'expired' \| 'cancelled', source: 'status' \| 'webhook' }` | `payment_intent_succeeded` | `billAudience` |
| `PaymentIntentFailed` (bill) | `{ intent_id, reason: 'provider_refused' \| 'provider_unreachable' \| 'declined', error_code: string (≤ 20) \| null }` | `payment_intent_failed` | `billAudience` |
| `PaymentIntentExpired` (bill) | `{ intent_id, last_check: 'pending' \| 'unreachable' }` | `payment_intent_expired` | `billAudience` |
| `PaymentIntentCancelled` (bill) | `{ intent_id, reason: 'staff' \| 'device_declined' \| 'device_cancelled' \| 'device_error', cancelled_by_staff_id: string \| null }` | `payment_intent_cancelled` | `billAudience` |
| `PaymentCredentialSet` (hub) | `{ provider_key, name }` | `payment_credential_changed` | admin only (no socket) |

No event carries a provider reference, QR payload, SDK parameter, secret or payer detail (B30). The worker's events: `actor_id null`, `device_id 'hub'`; `PaymentIntentCancelled` with `reason 'staff'` and `PaymentIntentCreated` carry the caller's envelope.

### 5.2 Hub — `apps/hub/src/db/migrations/0029_payment_intents.sql`

```sql
-- 05c §5.2. payment_intents is a projection of the PaymentIntent* events (rebuildable); the other tables are hub state,
-- never synced, logged or put in an event.
CREATE TABLE payment_intents (
  intent_id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL, split_no INTEGER NOT NULL, mode_id TEXT NOT NULL, provider_key TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0), currency_code TEXT NOT NULL,
  shift_id TEXT NOT NULL, started_by_staff_id TEXT NOT NULL, device_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('creating','ready','succeeded','failed','expired','cancelled')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ended_at INTEGER,
  payment_id TEXT, applied INTEGER CHECK (applied IN (0,1)), unapplied_reason TEXT, resolved_alert_id TEXT
);
-- P3 backstop + openIntentOf(bill) (05 guards, StartPaymentIntent)
CREATE UNIQUE INDEX payment_intents_open_bill ON payment_intents (bill_id) WHERE state IN ('creating','ready');
-- worker scan of open intents by deadline
CREATE INDEX payment_intents_open_due ON payment_intents (expires_at) WHERE state IN ('creating','ready');
-- openIntentsOfShift (CountShift / CloseShift guard)
CREATE INDEX payment_intents_open_shift ON payment_intents (shift_id) WHERE state IN ('creating','ready');
-- manager's unapplied list
CREATE INDEX payment_intents_unapplied ON payment_intents (created_at) WHERE applied = 0;
-- late-success window (P14 fast pull while an intent ended < 15 min ago)
CREATE INDEX payment_intents_ended ON payment_intents (ended_at) WHERE ended_at IS NOT NULL;

CREATE TABLE payment_intent_provider (     -- worker-owned provider data (P10)
  intent_id TEXT PRIMARY KEY REFERENCES payment_intents,
  provider_intent_ref TEXT, display_json TEXT,               -- QR payload or SDK params
  device_txn_ref TEXT,                                       -- ReportPaymentIntentResult hint (P7)
  provider_txn_ref TEXT,                                     -- set once at confirmed payment
  attempts INTEGER NOT NULL DEFAULT 0, next_check_at INTEGER, last_error_code TEXT
);
-- P6: one provider transaction applies once
CREATE UNIQUE INDEX payment_intent_provider_txn ON payment_intent_provider (provider_txn_ref) WHERE provider_txn_ref IS NOT NULL;

CREATE TABLE payment_credentials (         -- P13: written only by SetPaymentCredential; never returned
  provider_key TEXT NOT NULL, name TEXT NOT NULL, secret TEXT NOT NULL,
  set_at INTEGER NOT NULL, set_by_staff_id TEXT NOT NULL,
  PRIMARY KEY (provider_key, name)
);

CREATE TABLE payment_relay_cursor (        -- P14: last cloud notification seq applied
  id INTEGER PRIMARY KEY CHECK (id = 1), after_seq INTEGER NOT NULL DEFAULT 0
);
INSERT INTO payment_relay_cursor (id, after_seq) VALUES (1, 0);

-- row B-4
ALTER TABLE payment_references ADD COLUMN source TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','provider'));
```

Fold: `PaymentIntentCreated` inserts; `Ready` sets `state`; the four end events set `state`, `ended_at`; `Succeeded` sets `payment_id`, `applied`, `unapplied_reason` (and `state = 'succeeded'` from any state, P8). Projection registered with `registerHubProjections`, checkpointed.

### 5.3 Cloud — `apps/cloud/src/db/migrations/0021_payment_relay.sql` (expand)

```sql
CREATE TABLE payment_webhook_endpoints (    -- P13, P14: one per branch per provider
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, provider_key TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,                -- 32 hex random, the URL path segment; not a secret by itself
  secret TEXT NOT NULL,                     -- webhook signing secret; write-only, never returned or logged
  set_at BIGINT NOT NULL, set_by_user_id TEXT NOT NULL,
  PRIMARY KEY (tenant_id, branch_id, provider_key));
-- the webhook route resolves its tenant from the URL (pre-tenant lookup, row H-1)
CREATE UNIQUE INDEX payment_webhook_endpoints_endpoint ON payment_webhook_endpoints (endpoint_id);

CREATE TABLE payment_notifications (        -- §3.6 / §3.7 extractors' fields only; no raw body, no payer data
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id TEXT NOT NULL, branch_id TEXT NOT NULL, provider_key TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,          -- the provider's own notification / transaction id (to confirm)
  intent_id TEXT NOT NULL,                  -- the merchant reference the provider echoes
  outcome TEXT NOT NULL CHECK (outcome IN ('paid','failed','expired')),
  amount_minor BIGINT, currency_code CHAR(3), provider_txn_ref TEXT, error_code TEXT,
  received_at BIGINT NOT NULL,
  UNIQUE (tenant_id, provider_key, provider_event_id));    -- P6 dedupe
-- hub pull: WHERE tenant_id = $1 AND branch_id = $2 AND seq > $3 ORDER BY seq LIMIT 50
CREATE INDEX payment_notifications_pull ON payment_notifications (tenant_id, branch_id, seq);
```

Retention: none in v0.1 (≈ 200 rows / branch / day, no payer data) → §12.4.

---

## §6. Commands, queries and routes

Hub commands: `sessionKind: 'device'` unless stated, **not queueable**, idempotent by `command_id`; statement counts are the handler's, excluding 00's envelope and the projection fold. Shared failures not repeated: `400 VALIDATION_FAILED`, `401`, `403 PERMISSION_DENIED`, `403 DEVICE_ACCESS_DENIED`, `409 BUSINESS_DAY_NOT_OPEN`.

### Batch 1 — intents (05c-1) — STOP for owner review after this batch

#### 6.1 `StartPaymentIntent` — `{ bill_ref, split_no, mode_id, amount_minor? }` (permission `take-payment`)

| | |
|---|---|
| Script | Zod → ensure bill (05, 1) → `openIntentOf(bill)` (1) → `409 PAYMENT_INTENT_PENDING` → split open (`SPLITS_OF_BILL`, 1) → `409 BILL_NOT_OPEN` → mode active (`404`) → provider binding (`422 PAYMENT_MODE_NO_PROVIDER`) → provider registered, credentials present (`payment_credentials` names, 1), currency, health (`409 PAYMENT_PROVIDER_UNAVAILABLE`) → device type (`422 PAYMENT_PROVIDER_DEVICE_UNSUPPORTED`) → `fiscalGate` (`422 PAYMENT_MODE_NOT_FISCAL`, P16) → `moneyShiftOf` (1) → `409 SHIFT_NOT_OPEN` → orders, lines, pending voids, payments of the split (05's reading, 3) → `card_due` → P4 (`422 PAYMENT_EXCEEDS_BALANCE`) → append `PaymentIntentCreated` (`intent_id` = new ULID, `expires_at` = now + `ttl_ms`) → after commit: wake the worker |
| Result | `{ intent_id, state: 'creating', amount_minor, expires_at, display_kind }` |
| Statements | ≤ 8 (+ 05's ensure-bill appends when the bill is created here) |

| Edge | Answer |
|---|---|
| Token 57, Rs 3,650 due, Raast mode, `PK` branch | intent Rs 3,650 (365 000), `creating`; QR within ~1 s via `Ready` |
| Same, `PK-PB` branch, takeaway fiscalized, Raast mode with no `PRA` code | `422 PAYMENT_MODE_NOT_FISCAL { mode_id, adapter_key: 'PRA' }` — nothing sent to the bank |
| Card (SoftPOS) mode from the cashier kiosk | `422 PAYMENT_PROVIDER_DEVICE_UNSUPPORTED { device_type: 'cashier_kiosk' }` |
| Rs 1,000 cash already paid, `amount_minor` absent | amount = remaining `card_due` |
| A second Start on the same bill (another device) | `409 PAYMENT_INTENT_PENDING { intent_id }` |
| Bank credentials not entered on the hub | `409 PAYMENT_PROVIDER_UNAVAILABLE { reason: 'not_configured' }` |
| Hub internet down (last health `failing`) | `409 … { reason: 'failing' }`; the sheet offers Cash |
| Retransmit | stored result; one intent |

#### 6.2 `CancelPaymentIntent` — `{ intent_id }` (permission `take-payment`, bill scope as 05 §6.1)

Script: intent read (1) → `404 PAYMENT_INTENT_NOT_FOUND` → state open, else `409 PAYMENT_INTENT_FINAL { state }` → scope (05's `billAccess`, 1) → append `PaymentIntentCancelled { reason: 'staff', cancelled_by_staff_id }` → after commit: worker sends a best-effort provider `cancel`. Result `{ intent_id, state: 'cancelled' }`. Statements 2. The client hides the QR / stops the SDK **before** sending (§8). A payment confirmed later is P8's case.

#### 6.3 `ReportPaymentIntentResult` — `{ intent_id, outcome: 'approved' | 'declined' | 'cancelled' | 'error', device_txn_ref?: string 1–64, error_code?: string 1–20 }` (permission `take-payment`)

Only for `display_kind = 'device_sdk'` (else `400 VALIDATION_FAILED { path: 'payload.intent_id' }`). Script: intent read (1) → open, else `409 PAYMENT_INTENT_FINAL` (a report after success is answered with the stored state, not an error: `{ state: 'succeeded' }`) → `approved`: store `device_txn_ref` on `payment_intent_provider` (1), **no event**, wake the worker for an immediate `status` (P7) → `declined` / `cancelled` / `error`: append `PaymentIntentCancelled { reason: 'device_declined' | 'device_cancelled' | 'device_error' }` and keep `error_code` on `payment_intent_provider.last_error_code` (shown by §6.6). `hashOmit: ['device_txn_ref']`. Statements ≤ 2. Why a command: the SDK's transaction id may be the only key the provider's inquiry accepts (§3.7, to confirm); without it the hub waits for the webhook.

#### 6.4 Payments worker (`apps/hub/src/payments/worker.ts`, no route)

Loop every 1 s (as `FISCAL_LOOP_MS`), woken by after-commit hooks. Per tick, with a fixed number of reads: open intents due for work (`payment_intents_open_due`, 1), their provider rows (1).

| Step | Action | Writes |
|---|---|---|
| `creating` | `create` (outside any transaction). `ok` → tx: re-read (state still `creating`) → `payment_intent_provider` upsert + `PaymentIntentReady`. `rejected` → `PaymentIntentFailed { provider_refused }`. `retry` → backoff 1 s, 2 s, 4 s until 15 s after `created_at`, then `PaymentIntentFailed { provider_unreachable }` | 1 tx, ≤ 3 statements |
| `ready`, check due | `status` (if `status_query`) every 3 s; `paid` → **apply** (below); `failed` → `PaymentIntentFailed { declined, error_code }`; `expired` → `PaymentIntentExpired { pending }`; `pending` / `retry` → next check | — |
| `ready`, `now ≥ expires_at` | final `status`; `paid` → apply; else `PaymentIntentExpired { last_check }` → best-effort `cancel` | 1 tx |
| Relay pull (P14) | `GET /v1/sync/payment-notifications?after=<cursor>` → per item: unknown `intent_id` or other branch → skip (counted); `paid` → if `status_query`, confirm by `status` first (P7), then apply; `failed` / `expired` on an open intent → as above; then cursor update (1) | per item 1 tx |
| **Apply** | tx: re-read intent + provider row (1) → `state = 'succeeded'` → no-op (`duplicate`) → amount / currency ≠ intent → unapplied `amount_mismatch` → `providerPaymentDrafts` (05, ≤ 6) → `applied` → `PaymentAdded` + `payment_references (source 'provider')` + `provider_txn_ref` set (unique) + `PaymentIntentSucceeded { applied: true, after_state }`; not applied → `PaymentIntentSucceeded { applied: false, unapplied_reason, after_state }` + 01d `payment_unapplied` alert | ≤ 10 statements |
| Health | every 60 s per provider bound in the settings: `health()` → in-memory record `{ at, result }` read by §6.1 | — |

A provider call never runs inside the writer transaction; every write re-reads the intent first (a cancel or a second confirmation may have committed meanwhile). Logs: intent id, provider key, outcome, short code; never a reference, payload or secret.

### Batch 2 — reads and admin (05c-1)

#### 6.5 `GET /queries/payment-intents?bill_id=` (`take-payment`) and `?unapplied=1` (`close-shift-for-others`)

`bill_id`: the bill's intents, newest first (≤ 20) with state, amount, provider, `error_code` for failed / cancelled. `unapplied=1`: every `applied = 0` intent of the last 30 days (≤ 200) with bill / token, amount, provider, last 4 of `provider_txn_ref`, alert state. **1 statement** each (join on `payment_intent_provider`).

#### 6.6 `GET /queries/payment-intent?intent_id=` (`take-payment`, bill scope)

`{ intent_id, bill_id, split_no, state, amount_minor, currency_code, expires_at, display: { kind: 'qr', qr_payload, qr_svg } | { kind: 'device_sdk', sdk_params } | null, error_code, applied, unapplied_reason }`. `display` only while `ready`. `qr_svg` rendered per call by `qrcode` (hub dependency, no cache: ≤ a few calls per intent). **1 statement.** The page refetches on `PaymentIntentReady` and on any end event.

#### 6.7 `SetPaymentCredential` — `POST /admin/commands/set-payment-credential`, `{ provider_key, name, secret: 1–1024 printable }` (admin session, `manage-payment-providers`)

Provider registered and `name ∈ credentialNames`, else `400 VALIDATION_FAILED { path: 'payload.name' }` → upsert `payment_credentials` (1) → `PaymentCredentialSet`. `hashOmit: ['secret']`; never echoed. Statements 1. Result `{ provider_key, name, set_at }`.

#### 6.8 `GET /admin/queries/payment-credentials` (`manage-payment-providers`)

Per registered provider × `credentialNames`: `set_at | null`. Never selects `secret`. 1 statement.

### Batch 3 — cloud relay (05c-2)

#### 6.9 `POST /v1/payments/webhooks/:provider_key/:endpoint_id` (cloud, public, allowlisted, row H-1)

Script: body ≤ 16 KB raw, else `400 VALIDATION_FAILED` (kept as bytes for the signature) → endpoint by `endpoint_id` and `provider_key` (1) → unknown → `404 PAYMENT_WEBHOOK_NOT_FOUND` → provider verifier `verify(headers, rawBody, secret)` → false → `401 PAYMENT_WEBHOOK_SIGNATURE_INVALID` (logged with endpoint id only) → `extract(body) → { provider_event_id, intent_id, outcome, amount_minor, currency_code, provider_txn_ref, error_code } | null` (null = an event type we ignore → `200`) → `INSERT … ON CONFLICT (tenant_id, provider_key, provider_event_id) DO NOTHING` (1) → `200 { data: { received: true } }` (also on a duplicate, so the provider stops retrying). **2 statements.** No `Idempotency-Key` (idempotent by `provider_event_id`, as F §6.4 for `/sync/events`). Verifiers in `apps/cloud/src/modules/payments/providers/{paymob,alfalah}.ts`; the HTTP status the provider expects on success / failure is **to confirm**.

#### 6.10 `GET /v1/sync/payment-notifications?after=<seq>&limit=` (cloud, branch API key, row H-2)

`limit` default 50, max 200; returns `{ items: [{ seq, provider_key, intent_id, outcome, amount_minor, currency_code, provider_txn_ref, error_code, received_at }], next_after }` for the key's tenant and branch only. **1 statement** (`payment_notifications_pull`).

#### 6.11 `PUT /v1/admin/branches/:branch_id/payment-webhooks/:provider_key` — `{ secret }` and `GET /v1/admin/branches/:branch_id/payment-webhooks` (cloud, JWT owner, as the billing-settings routes)

PUT: branch is the owner's (C2) → upsert (new `endpoint_id` only on first set; a new secret keeps the URL) (1) → audit row `payment_webhook` (1, cloud config audit) → `{ provider_key, endpoint_url, set_at }`; the secret is never returned. GET: `[{ provider_key, endpoint_url, set_at }]` (1). The owner pastes `endpoint_url` into the provider's merchant portal. `Idempotency-Key` required on PUT? No (F §6.4 asks it for creating POSTs; PUT is idempotent).

---

## §7. Cross-cutting

### 7.1 Items

| Item | Decision (failure it prevents) |
|---|---|
| Logging | ids, provider key, outcome, short code only; never secrets, QR payloads, SDK params, provider references, payer data (B30) |
| Privacy | The cloud keeps no raw webhook body and no payer data (§3.6); the hub shows the last 4 of a provider reference to managers only |
| Rate limit | Webhook route: body limit 16 KB + signature check before any write; no extra limiter in v0.1 (one Fastify instance, cheap rejection) → §12.4 |
| Clock | `expires_at`, health age and backoff from `branchNow`; tests use `steppingClock` (F §6.7) |
| Failure: hub internet down | Start refused once health is `failing`; an open intent waits, then expires (P9); a payment made meanwhile is picked up by the relay pull when the link returns (P8) |
| Failure: cloud down | Polling (P15) still confirms providers with `status_query`; a webhook-only provider's success waits for the cloud |
| Failure: hub restart mid-intent | The projection survives; the worker resumes at boot (open intents due now) |
| Performance | ≤ 1 open intent per bill; ~10 devices; worker reads 2 statements per tick; no new hot path |
| Env / config | None new on the hub; provider `environment` (`sandbox` / `production`) is a mode setting |

### 7.2 Middleware

Cloud webhook route: raw-body parser for that route only (signature over the exact bytes), registered before the JSON parser; tenant resolved inside the handler from `endpoint_id`.

### 7.3 Outside dependencies (each blocks only its build part)

| # | Dependency | Blocks | State (2026-11-24) |
|---|---|---|---|
| X-1 | **Bank Alfalah** Raast P2M merchant API access: API document, sandbox credentials, QR generation rule, status API or not, webhook signature scheme, QR validity | 05c-2 build (§11 STOP) | Email sent 2026-11-23; no answer |
| X-2 | **Paymob SoftPOS** merchant onboarding for the restaurant (MID / terminal), **SDK licence** and Android SDK package, supported device list + attestation rules, server inquiry / callback for SoftPOS transactions | 05c-3 build | Not started |
| X-3 | Sandbox credentials for both, and a sandbox webhook pointing at the staging cloud | 05c-2 / 05c-3 manual checks | Not started |
| X-4 | **PRA answer to A13** (`PaymentMode` code for QR / Raast) — or the owner's OQ-1 choice | Raast on fiscalized order types of a `PK-PB` branch | Open (05 P.6) |
| X-5 | Tablet models certified by Paymob for SoftPOS (NFC, Android version) | 05c-3 on the pilot hardware | To check against 05b's pilot models |

---

## §8. Client contract

1. **Take-payment sheet** (`apps/client/src/features/billing/`): mode buttons come from the settings; a provider-bound mode opens its panel instead of the amount pad's "Add". The amount shown is `card_due`, editable down (P4).
2. **Raast QR panel** (`PayRaast`): `StartPaymentIntent` → "Preparing QR…" until `PaymentIntentReady` → fetch §6.6 → show `qr_svg`, amount, countdown to `expires_at`, "Waiting for payment… closes by itself when paid"; on the kiosk, post `{ intent_id, qr_svg, amount_minor, state }` on `BroadcastChannel('pos-customer-display')`. `PaymentIntentSucceeded { applied: true }` for this intent → "Paid", the bill refreshes. "Pay later" / "Cash instead" → `CancelPaymentIntent` first (the QR is hidden on both screens **before** the command is sent).
3. **Customer display** (`CustomerDisplayRaast`, G-14, client only): shows the QR while `state = ready`, "Paid ✓" on success, clears on any end event.
4. **Card on tablet panel** (`PayNfcTablet`): shown only when `PosNative.cardPaymentInfo().available` and the device is a tablet; `StartPaymentIntent` → on `Ready` fetch `sdk_params` → `startCardPayment` → "Tap the card on the back of this tablet — Rs 3,650 · waiting for card…" → SDK result → `ReportPaymentIntentResult` → `approved` shows "Confirming…" until `PaymentIntentSucceeded`; the panel never shows "Paid" from the SDK result alone (P7). Back / cancel → `cancelCardPayment` then `CancelPaymentIntent`.
5. **Failure panel** (`PayError`): on `PaymentIntentFailed`, `Expired` or a device decline: "Payment didn't go through. Nothing was charged. Try again or choose another way." + the short code (e.g. "card declined (05)") + "Try again" (a new `StartPaymentIntent`) / "Pay later". "Nothing was charged" is shown only for `Failed` / device decline; on `Expired` the text is "No payment arrived. Try again or choose another way." (a late payment is the manager's, P8).
6. **Errors:** `PAYMENT_INTENT_PENDING` → "Another payment is in progress on this bill" with "Open it"; `PAYMENT_PROVIDER_UNAVAILABLE` → "Card / QR is not available right now — take cash or pay later"; `PAYMENT_MODE_NOT_FISCAL` → "This payment type can't be used on a tax invoice yet" (P16).
7. **Manager:** "Unapplied payments" list (§6.5) on the money screen with the `payment_unapplied` alert's tap target.
8. **Hub admin** `/admin/payments/`: credentials per provider (set / replaced on date, never shown). **Owner app:** provider per mode + settings (row A-1), webhook secret and the URL to copy (§6.11).
9. Urdu strings go to the urdu-todo list; no Urdu on prints (02b-TK R6; 05c prints nothing).

---

## §9. Error catalogue additions

| Code | Status | `details` | Condition |
|---|---|---|---|
| `PAYMENT_INTENT_NOT_FOUND` | 404 | `{ intent_id }` | §6.2, §6.3, §6.6 |
| `PAYMENT_INTENT_PENDING` | 409 | `{ intent_id }` | P3, P11 (05 rows B-2, B-3) |
| `PAYMENT_INTENT_FINAL` | 409 | `{ intent_id, state }` | §6.2, §6.3 |
| `PAYMENT_PROVIDER_UNAVAILABLE` | 409 | `{ provider_key, reason: 'not_configured' \| 'failing' }` | §3.8 |
| `PAYMENT_MODE_NO_PROVIDER` | 422 | `{ mode_id }` | §3.8 |
| `PAYMENT_PROVIDER_DEVICE_UNSUPPORTED` | 422 | `{ provider_key, device_type }` | §3.8 |
| `PAYMENT_WEBHOOK_NOT_FOUND` | 404 | `{}` (cloud) | §6.9 |
| `PAYMENT_WEBHOOK_SIGNATURE_INVALID` | 401 | `{}` (cloud) | §6.9 |

Reused unchanged: `PAYMENT_MODE_NOT_FOUND`, `PAYMENT_MODE_NOT_FISCAL`, `PAYMENT_EXCEEDS_BALANCE`, `SHIFT_NOT_OPEN`, `BILL_NOT_OPEN`, `VALIDATION_FAILED`, `PERMISSION_DENIED`, `BRANCH_API_KEY_INVALID`. Appended to F §6.2 and `@pos/domain/src/errors.ts` at build (row F-1; no bump, R34).

---

## §10. Tests

All hub tests on the `fake` provider and `fakeRelay`; no network (the no-cloud-network helper stays green). Clock: `steppingClock`.

### 10.1 Pure (`packages/domain/src/payments/*.test.ts`, `packages/events`)

| # | Case |
|---|---|
| 1 | Intent state machine: every allowed transition; `succeeded` terminal; late success from `failed` / `expired` / `cancelled` sets `after_state` |
| 2 | Apply decision (pure part of P8): split closed, bill not open, `exceeds_due`, `shift_closed`, `amount_mismatch` → unapplied reasons; else applied |
| 3 | Event schemas parse their fixtures; no schema has a reference / payload / secret field |
| 4 | Billing settings: `provider` only on digital modes, allowed kinds, one bound mode per provider, settings schema, currency (row A-1) |

### 10.2 Hub commands (`apps/hub/test/payments/*.int.test.ts`)

| # | Case |
|---|---|
| 5 | `StartPaymentIntent` happy path: event, projection row, result; amount = `card_due`; statements ≤ 8 |
| 6 | Each error of §3.8 (one test per code), incl. `PAYMENT_MODE_NOT_FISCAL` on a `PK-PB` fiscalized takeaway with a Raast mode without a `PRA` code, and the same mode **accepted** on a non-fiscalized order type and once a `PRA` code is in the settings (P16) |
| 7 | Partial amount (cash paid first); `amount_minor > card_due` → `422`; `card_due = 0` → `422 { balance_minor: 0 }` |
| 8 | Retransmit → one intent, identical response |
| 9 | `CancelPaymentIntent`: open → cancelled; final → `409 PAYMENT_INTENT_FINAL`; scope refused for another person's bill without the right (05 C8) |
| 10 | `ReportPaymentIntentResult`: approved stores `device_txn_ref`, no event, worker woken; declined → cancelled with code; on a `qr` intent → `400`; after success → `{ state: 'succeeded' }` |
| 11 | `SetPaymentCredential` write-only (never in result, log, event, `processed_commands`); unknown name → `400`; query lists names and dates only |
| 12 | Permissions: `take-payment` for 6.1–6.3; `manage-payment-providers` for 6.7–6.8; `close-shift-for-others` for the unapplied list |

### 10.3 Worker (`apps/hub/test/payments/worker.int.test.ts`)

| # | Case |
|---|---|
| 13 | `creating` → `ready` on `ok`; `rejected` → failed `provider_refused`; retries until 15 s → failed `provider_unreachable` |
| 14 | `ready` + status `paid` → `PaymentAdded` (taken_by = starter, shift = frozen shift, `has_reference`) + `payment_references.source = 'provider'` + `Succeeded { applied: true }` in one transaction; bill balance updated |
| 15 | Expiry: final check `pending` → `Expired`, cancel sent; final check `paid` → success |
| 16 | Late success after `cancelled` with the split still open and amount ≤ due → applied, `after_state 'cancelled'`; after the split closed → unapplied + `payment_unapplied` alert to managers |
| 17 | Amount mismatch → unapplied `amount_mismatch` + alert |
| 18 | Relay pull: notification for an unknown intent skipped; cursor advances; `paid` with `status_query` → status confirmed before apply; webhook-only provider → applied from the notification |
| 19 | Health `failing` → start refused `failing`; recovered → accepted |
| 20 | Restart: an open intent past `expires_at` at boot is finalised by the first tick |

### 10.4 Races (`apps/hub/test/payments/races.int.test.ts`)

| # | Case |
|---|---|
| 21 | Webhook relay and poll confirm the same intent in the same tick → exactly one `PaymentAdded`, the second is `duplicate` |
| 22 | Two devices `StartPaymentIntent` on one bill → one intent, the other `409 PAYMENT_INTENT_PENDING` |
| 23 | `CancelPaymentIntent` commits while the worker holds a `paid` answer → the apply re-reads, records a late success (applied per P8), never two terminal events of the same kind |
| 24 | 05 guards (row B-2/B-3): `AddPayment`, `SetSplits`, `ApplyDiscount`, `RemoveServiceCharge`, `CloseSplit`, `CountShift`, `CloseShift`, `CloseBusinessDay` → `409 PAYMENT_INTENT_PENDING` while open; allowed after it ends |
| 25 | A 04 void lowers `card_due` below the open intent's amount, then `paid` → unapplied `exceeds_due` (OQ-4 default) |
| 26 | The same `provider_txn_ref` reported for two intents → the second is refused by the unique index and recorded unapplied |

### 10.5 Cloud (`apps/cloud/test/payments/*.int.test.ts`)

| # | Case |
|---|---|
| 27 | Webhook: good signature → row; bad → `401`; unknown endpoint → `404`; > 16 KB → `400 VALIDATION_FAILED`; duplicate `provider_event_id` → `200`, one row; ignored event type → `200`, no row; no payer field stored |
| 28 | Pull: branch key sees only its tenant + branch; cursor; limit cap; cross-tenant test (D54) |
| 29 | Webhook secret PUT write-only (never in GET); `endpoint_id` stable across secret changes; route inventory includes the allowlisted route |
| 30 | Verifier fixtures per provider (recorded from provider docs at build, §11 STOP) |

### 10.6 Client and native

| # | Case |
|---|---|
| 31 | Raast panel: QR after `Ready`, closes on `Succeeded`, cancel hides QR before the command, BroadcastChannel message to the customer display |
| 32 | Card panel: hidden without `cardPaymentInfo().available` or below `native_api` 2; SDK `approved` shows "Confirming…", never "Paid", until the event |
| 33 | Failure panel texts per end event (Failed vs Expired) |
| 34 | (Gradle, `tablet.yml`) plugin guard: refused outside `/staff/`; result mapping approved / declined / cancelled / error |
| 35 | (Manual, per pilot tablet model, sandbox) NFC tap with a Paymob test card → hub confirms by inquiry / callback; airplane mode mid-tap → expiry text |
| 36 | (Manual, sandbox) Raast QR paid from a bank sandbox app → kiosk and customer display close by themselves |

### 10.7 Acceptance

| Source | Check | Test |
|---|---|---|
| G-12 card by NFC | Start → SDK → server-confirmed `PaymentAdded` with provider reference | 14, 32, 35 |
| G-12 Raast closes by itself | Ready → paid → Succeeded → panel and customer display close | 14, 18, 31, 36 |
| G-12 automatic AddPayment, reference | `source 'provider'`, `has_reference`, no reference in any event | 3, 14 |
| G-12 timeout / failed states (PayError) | Failed / Expired / device decline texts | 13, 15, 33 |
| Exactly once | duplicate webhook / poll | 21, 26, 27 |
| Bill changed meanwhile | guards + unapplied path | 24, 25 |
| PRA A13 gate | refused before the provider is contacted | 6 |
| G-13 | no intent offline; not queueable | 8 (not queueable flag), 19 |

---

## §11. Build order

**05c-1** (no outside dependency):
1. §9 codes in `errors.ts` (row F-1); permission `manage-payment-providers` (row R-1); alert kind `payment_unapplied` (row D-1) — tests 11–12 (part).
2. Event schemas + fixtures (`packages/events/src/events/bill/PaymentIntent*.v1.ts`, `hub/PaymentCredentialSet.v1.ts`) — test 3.
3. Billing settings `provider` field + cloud PUT checks + owner form (row A-1) — test 4.
4. Hub `0029_payment_intents.sql` + projection `payment-intents` — test 20 (part).
5. 05 rows B-1, B-4 (exports, `payment_references.source`) — 05 tests re-run.
6. Port, registry, `fake` adapter (§3.4, §3.5); wiring check row B-5.
7. `StartPaymentIntent`, `CancelPaymentIntent`, `ReportPaymentIntentResult` — tests 5–10, 22.
8. Worker (create, poll, expire, apply, health) — tests 13–17, 19–21, 23, 26.
9. 05 guards rows B-2, B-3 — tests 24, 25.
10. Queries §6.5, §6.6, admin §6.7, §6.8 — tests 11, 12.
11. Client: sheet panels on `fake` (dev-only registration behind the test harness), failure panel, unapplied list, admin credentials page — tests 31 (part), 33.

**05c-2** — **STOP until X-1 and X-3** (Alfalah document + sandbox): 12. Cloud `0021_payment_relay.sql`, §6.9–§6.11, rows H-1, H-2 — tests 27–29. 13. Hub relay pull in the worker — test 18. 14. `alfalah_raast` adapter + cloud verifier from the bank's document; every "to confirm" field settled or STOP to the owner — test 30. 15. Customer display — test 31. 16. Manual sandbox check — test 36.

**05c-3** — **STOP until X-2, X-3, X-5** (Paymob onboarding, SDK licence, devices): 17. 05b rows T-1, T-2 (plugin, `native_api` 2, Gradle tests) — test 34. 18. `paymob_softpos` adapter + cloud verifier — test 30. 19. Card panel — test 32. 20. Manual NFC check per model — test 35.

20 tasks; 3 hub commands + 1 admin command + 3 queries + 3 cloud routes (10) — inside the size budget.

---

## §12. Definition of Done, checklist, open questions, deferred

### 12.1 Definition of Done
- Tests 1–34 green in the gate (`tablet.yml` for 34); 35–36 done on sandbox and the pilot tablets.
- 05, 05b v1.1, 01a, 01b, 01d, 00 HPA carry the §4.5 rows; `checkBillingWiring` covers `PAYMENTS_EVENT_TYPES`.
- A dry run at the pilot counter: 10 Raast and 10 card payments on sandbox, each with exactly one `PaymentAdded`, Z by mode matching the provider's sandbox list.

### 12.2 Endpoint checklist

| § | Command / query / route | Codes |
|---|---|---|
| 6.1 | StartPaymentIntent | 200, 400, 403, 404, 409, 422 |
| 6.2 | CancelPaymentIntent | 200, 400, 403, 404, 409 |
| 6.3 | ReportPaymentIntentResult | 200, 400, 403, 404, 409 |
| 6.5 | payment-intents | 200, 400, 403 |
| 6.6 | payment-intent | 200, 400, 403, 404 |
| 6.7 | SetPaymentCredential (admin) | 200, 400, 401, 403 |
| 6.8 | payment-credentials (admin) | 200, 401, 403 |
| 6.9 | cloud webhook | 200, 400, 401, 404 |
| 6.10 | cloud pull | 200, 400, 401 |
| 6.11 | cloud webhook secret PUT / GET | 200, 400, 401, 404 |

### 12.3 Open questions (owner)

| # | Question | Default if not answered |
|---|---|---|
| OQ-1 | **Raast on a `PK-PB` (PRA) branch before PRA answers A13.** (a) Raast refused on every fiscalized order type (takeaway and dine-in), allowed only where `fiscalize_by_order_type` is off; (b) start the pilot branch on jurisdiction `PK` (no authority) until PRA is live and A13 answered, then switch (05 P.1 allows it, but R37 asks PRA live from day 1); (c) the owner asks PRA in writing and enters the code PRA gives. **Never:** reuse the card code `2` or "mixed" `5` for Raast | **(a)**: the pilot uses Raast only on a `PK` branch or non-fiscalized types; card (code 2) works on `PK-PB` |
| OQ-2 | Which order types and devices get card-by-NFC: tablets of order takers at the counter only, or also floor waiters at the table? (A waiter-held card reader moves money off the counter; B11 lands it in the waiter's own shift) | Any tablet whose person has `take-payment` and an open shift |
| OQ-3 | If Paymob offers **no server confirmation** for SoftPOS (only the SDK result on the device): accept the device result as proof (a forged-script risk on the LAN, as 05b O-14 accepted for the token) or keep card manual? | Keep card manual (P7) |
| OQ-4 | Guard 02b `RemoveItems` / `CompLine` and 04 `VoidItems` while an intent is open (three more spec bumps), or accept "unapplied" for that rare case? | No guard; unapplied + alert (P11) |
| OQ-5 | Manual `AddPayment` on a provider-bound mode (e.g. the bank app was used without the QR): allowed as today, or refused so every Raast payment goes through an intent? | Allowed, reference required by the mode's own `reference_required` |
| OQ-6 | Who may resolve an unapplied payment, and does resolution need a command (`ApplyUnappliedPayment` to a chosen bill) or is "manual `AddPayment` + close the alert" enough for the pilot? | Manual, managers (`close-shift-for-others`) |
| OQ-7 | Migration numbers hub `0029`, cloud `0021` assume 08b / 08d / other 02b-TK bumps land first; renumber at build | Renumber at build |
| OQ-8 | QR validity and SoftPOS timeout (P9 defaults 300 s / 120 s) | Provider's values once known |
| OQ-9 | New permission `manage-payment-providers` (01b bump) or reuse `manage-fiscal-settings`? | New key |

### 12.4 Deferred until needed

| Item | Why not now |
|---|---|
| Provider refunds / `out` through the provider | R7 P2; manual portal refund + manual `AddPayment out` covers the pilot |
| Settlement reconciliation, fees, chargebacks | R7 P2 |
| `ApplyUnappliedPayment` command | OQ-6; expected to be rare |
| Cloud notification retention job | ≈ 200 small rows / branch / day |
| Webhook rate limiter beyond the body limit | One public route, signature checked before any write |
| Cash or intents while the hub is unreachable | G-13 ruling |
| Other providers (JazzCash, EasyPaisa, ECR terminals) | Not asked |
| Cloud → hub push channel | Pull every 3 s is enough at ~10 devices; 06 not built |

### 12.5 Hostile self-review (v0.1)

| Check | Finding → fix in this draft |
|---|---|
| Remote call on the request path (F §6.2) | Start never calls the provider; the worker does; health is a cached record (P12) |
| Double payment | Unique `provider_txn_ref`, re-read inside the apply tx, cloud dedupe (P6); test 21, 26 |
| Forged success | Device result is a hint only; webhook signature + status confirm (P7) |
| Bill changed under the QR | 05 guards (P11) + unapplied path; 02b / 04 left as OQ-4 |
| Shift closed before the money lands | Shift close guarded while open; late success → unapplied `shift_closed` |
| PRA misreport | Fiscal gate before the provider (P16); no invented codes |
| Secrets | Hub `payment_credentials`, cloud `payment_webhook_endpoints.secret`; never returned / logged / in events |
| N+1 | Every query 1 statement; the worker 2 reads per tick; the pull 1 statement |
| Over-engineering | No outbox table (the projection is the work list), no push channel, no retention job, no new stream type, no client QR library, `fake` not in production |
| Event count | Seven events (the asked five + `Ready`, needed because the QR exists only after the provider answers, + the credential audit event) |
