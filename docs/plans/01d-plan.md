# 01d Notifications and requests — Implementation Plan (spec v1.0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build module 01d: the alert and request record, kinds, targets, routes, the 500 ms hub tick, receipts, the alert-mode WS connection and device bindings, the request answer rules with the PIN check reused from 00, the five commands, four queries and the `alerts` catch-up part, the six kinds 01d ships, the 00 v1.6 and 01b v1.4 changes they build on, and the client parts of §8.

**Architecture:** 00's pipeline gains `preRead`, `pinCheck` and a `checkPin` with `prepare` / `onMatch` / `onMismatch` / `onPrepareFailed`, so every PIN-bearing answer is decided in one counting transaction (R1). 01d's state is projections over its own events (`0006_alerts.sql`); events that need a delay (steps, expiry, `no_approver`) are written by registered ticks, each in its own `writer.run`, opened only after a one-statement `due` pre-check. Frames go out after commit through `ws-frames.ts`; alert-mode sockets live in their own list outside 00's `deliver()`.

**Tech Stack:** the existing stack (CLAUDE.md): Node 22, Fastify 5, better-sqlite3 (hub), PostgreSQL 16 (cloud, B-5 only), React (client), Zod, Vitest. No new dependency until the developer answers gap G1 (Capacitor).

**Spec:** `docs/specs/01d_Notifications_Requests_Spec_v1.0.md` (cited "§x", tests "#n", build-time fixes "BF-n"), with the bumps it made: foundation `docs/specs/00_Foundation_Spec_v1.8.md` ("F §x"), `docs/specs/00_Hub_Platform_Access_Spec_v1.6.md` ("00 §x", rows H-1–H-14), `docs/specs/01b_Staff_Roles_Spec_v1.4.md` ("01b §x", rows B-1–B-6). **Read the cited section before each task**; the plan does not repeat the spec's tables, SQL or rule text.

**Starting point:** 00, 01a, 01b, 01c built and merged. The §4.5 spec bumps (README, CLAUDE.md, F v1.8, 00 v1.6, 01b v1.4) are applied (commits `55e2634`, `fa3561d`, `924e68a`, `05b5f24`); F §6.2 already lists the three new codes (F-4), `@pos/domain/src/errors.ts` does not yet. Reuse, do not recreate: `checkPin` (`apps/hub/src/auth/pin.ts`), the command pipeline (`apps/hub/src/commands/route.ts`, `IdempotentReplay`, `decide`, `recheckAuth`), `defineCommand` / `createCommandRegistry` (`commands/registry.ts`), `defineQuery` (`queries/registry.ts`), `writer.run` / `addAfterCommit` / `tx.onCommit` (`engine-host/writer.ts`), `registerProjection` (`projections/registry.ts`), `registerCatchUp` (`ws/catch-up.ts`), `armKeepalive`, `authenticate`, `findDevice` (`ws/server.ts`), `activity` (`auth/session-store.ts`), `StaffDirectory` (`auth/staff-directory.ts`), `applyStaffDirectory` (`auth/apply-directory.ts`), `retentionOnce` / `purge` (`auth/session-sweeper.ts`), `payloadHash` (`lib/hash.ts`), `REDACT_PATHS` (`server.ts`); hub test helpers `createTestHub`, `pairDevice`, `openSession`, `endSessionNow` (`test/helpers/test-hub.ts`), `statementCounter`, `log-capture.ts`, `ws-client.ts`, `fixtures.ts` (`PIN`, `pinHash`); `@pos/events/testing` builders; client `api/hub-admin.ts` (device token from IndexedDB), `i18n/{en,ur}.ts`, the admin-stock `AdminLogin` flow.

## Markers

| Marker | Meaning |
|---|---|
| **RISK: HIGH** | Full per-task review by a fresh **opus** reviewer subagent against the cited spec sections, the task's tests and this plan's Global Constraints, before the next task starts. The reviewer must read the diff and run the task's own test files. |
| **RISK: NORMAL** | Paired review: two NORMAL tasks of one batch reviewed together by one fresh opus reviewer at the end of the pair (or the batch, when the batch has one NORMAL task). |
| **Shared** | Touches `packages/domain`, `packages/events` or `packages/engine`. Land in order; never two Shared tasks in parallel. |
| **00** / **01b** | Implements a C-00 / C-01b row (spec §4.5). Changes another module's code: only the rows named. |
| **UI** | Client only; the implementer may be sonnet, the reviewer is opus. |
| **needs Docker Postgres** | The task's own command needs the cloud test database (port 5433). |
| **BLOCKED-G1** | Waits for the developer's answer to gap G1 (Capacitor tablet app, staff client). |
| **Manual** | Needs a person and pilot hardware. |

## Global Constraints

Every task implicitly includes these. Values copied from the spec.

- **Agents:** every implementer and reviewer subagent runs on **opus**; implementers of **UI** tasks may run on sonnet. No subagent spawns subagents.
- **Gate:** `pnpm -w typecheck && pnpm -w lint && pnpm -w test` (test files are type-checked: each package's `typecheck:tests`, R31). **Only the controller runs the gate, one run at a time, never while a subagent is testing.** Implementers run only their task's test files (`pnpm vitest run <file> …`) and `pnpm --filter <pkg> typecheck typecheck:tests`. No `pgrep` / `sleep` wait loops; a subagent that needs the gate asks the controller.
- **TDD:** each task writes its failing tests first, runs them and records the failure, then implements. Test names: `it('[01d #N] …')` for a §10 test (each N in exactly one task, Coverage table; a test split across hub and client is tagged `[01d #N hub]` / `[01d #N client]`); supporting tests cite a section: `it('[01d §3.3 rule 4] …')`, `it('[01d BF-3] …')`, `it('[00 H-3] …')`, `it('[01b B-1] …')`.
- **Commit:** one task per commit, only the task's files: `<type>(01d): task N <title> [spec §x; tests #a, #b]` (00 rows: `feat(00): task N … [00 v1.6 H-n; 01d §4.5]`; 01b rows: `feat(01b): task N … [01b v1.4 B-n; 01d §4.5]`).
- **Batch checkpoint:** after a batch's last task and its reviews, the controller runs the gate, appends a summary (tasks, commits, tests closed, AD-n rows, open items) to `docs/plans/01d-status.md`, commits it alone (`docs(01d): checkpoint batch N`) and runs `git push origin module-01d` (backup; task 0 allows it). Never push `main`.
- **Spec-first:** if code and spec disagree, stop and ask (CLAUDE.md). A deviation found while building is written as a **proposed** `AD-n` row in `docs/reviews/01d-auto-decisions.md` (`AD-n | task | problem | options | choice | why | files`) and in the checkpoint; it is folded into the spec only at the as-built review (task 45). No silent change of an API shape, error code, event payload or migration.
- **Migrations:** merged migrations `0001`–`0005` are never edited. 01d adds exactly one hub migration, `0006_alerts.sql` (task 9). If a later task needs a schema change, `0006` may change only while it is unmerged and the change is an AD row; after merge, a new `0007`.
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()` in hub or package `src/`; `clock.branchNow()`, `ids.next()`. Timers use the injected clock in tests (`vi.useFakeTimers` + the test clock).
- **Errors (§9, F §6.2):** only catalogue codes through `DomainError`. New: `ALERT_NOT_FOUND` 404, `REQUEST_NOT_PENDING` 409, `REQUEST_PIN_REQUIRED` 422. `PERMISSION_DENIED.details.reason ∈ self, not_approver, out_of_range, not_receiver, not_requester, in_person_elsewhere`. `VALIDATION_FAILED.details.issue ∈ target_unavailable, values_invalid, details_invalid` from `raise`.
- **Constants (A14):** every pilot value comes from `ALERT_CONSTANTS` (`packages/domain/src/alert-constants.ts`): `approval_repeat_ms` 45 000, `approval_branch_ms` 120 000, `binding_route_idle_ms` 7 200 000, money kinds `needs_pin: 'always'`, accept kinds `'never'`. Also fixed by the spec, as named constants in the owning file: tick 500 ms, tick `LIMIT 200`, receipt flush 1 000 ms or 100, `test_alert` `after_ms` 600 000, retention batch 500, closed alerts kept 7 days, `MarkAlertsSeen` 1–50 ids, `SetPresence` 1–100 ids, inbox `limit` default 50 max 200, alert-mode auth / keepalive as 00. No role name is read anywhere (R5).
- **Statement bounds (fixed, no N+1):** `alerts.due` 1; tick ≤ 1 + 8 + R + T; `raise` ≤ 6 + R + T (fixed reads cached per transaction); `raiseMany` / `closeMany` same as one; projection ≤ 2 reads per 01d step / close event; `preRead` 1 + the kind's `apply` reads; `WithdrawRequest` 1; `MarkAlertsSeen` 1; `SendTestAlert` 1 + raise; `SetPresence` 1; `alerts-inbox` 2; `my-requests` 1; `requests-to-answer` 2; `alert-receipts` 4; `alerts` catch-up 2; `alerts_open` ≤ 3; `listOpen` 1; `byDedupeKey` 1; `alert_closed` recipients 1 per transaction; `StaffDirectory.load` 10; `GET /v1/sync/config` with directory ≤ 27. Asserted with `statementCounter`.
- **Secrets (§7):** a PIN is never in `payload_hash`, `processed_commands`, an event payload, a log line or a client queue; `card` / `details` (items, amounts, reasons) never in logs, `lock` text, alert-mode frames, device-target frames or `alerts_open`.
- **Read-only `apply` (§3.5):** `apply` / `onWithdraw` run on `readOnlyTx(tx)` in `preRead` and `prepare`; every draft they return has `payload.alert_id === alert.alert_id` (else `Error`, 500).
- **Stubs (§4.4):** `table_team`, `zone_order_taker`, `point` resolvers, the pager route and every other module's kind exist **only as test fakes** under `apps/hub/test/alerts/fakes.ts`. Nothing of 02, 03a, 04, 05, 01e is built here. `SendTestAlert` to a point → `422 CONFIG_REFERENCE_INVALID { reason: 'points_not_available' }`.
- **Hub tests:** `apps/hub/test/alerts/*.int.test.ts` (one file per task unless named); pure units next to the source (`*.test.ts`); 00 / 01b changes extend the existing test files they touch. Client tests `apps/client/src/**/*.test.ts(x)`.
- **Wiring:** each task registers what it builds (commands, queries, projections, catch-up parts, ticks, timers) through `apps/hub/src/alerts/index.ts` `registerAlerts(app, deps)`, called once from `buildHubServer` (`apps/hub/src/server.ts`); timers start in boot after step 7 (F §5.8) and stop on close.

## Plan decisions

| # | Decision | Where |
|---|---|---|
| P-1 | **Order (rule 6).** §11 is followed except: (a) the 01b rows (§11 step 12) and the 00 app-update rows (H-5, §11 step 14) move up, before any 01d module code, because targets need `noPinStaff` / `teamOf({ includeNoPin })` (test 1) and 00 / 01b changes come first; (b) the migration (step 4) lands before the 01b hub cache that lives in it; (c) the `request_result` kind (step 11) lands with `alerts.close` (task 19), which raises it (test 14); `pin_use_failed`, `approval_receipt`, `answered_on_requester_device` land with the answer tasks that raise them (23, 24); (d) `ws-frames.ts` (frames to session and alert-mode sockets, §6 batch 3) lands before the commands (task 20), `alerts_open` and the binding header after the tick (task 32) | Task list |
| P-2 | **Test placement (01c P-3).** A §10 test goes in the first task where every hub part can run; a test with a client part is split `[01d #N hub]` / `[01d #N client]` (#56, #57, #59, #61). Code can be test-driven earlier by section-cited tests. Presence for tests before task 37 is seeded with `PresenceSet` events (builder), not the command | Coverage table |
| P-3 | **Where the 01d code lives** (§7 folder, plus three files the list does not name): `apps/hub/src/alerts/{kinds,raise,targets,routes,tick,receipts,bindings,alert-sockets,ws-frames,retention,index}.ts`, `alerts/commands/*.ts`, `alerts/queries/*.ts`; the `alerts`, `alert_flags`, `alert_receipts`, `presence_today` projections in `apps/hub/src/projections/alerts.ts` (00's projections folder); `batchReads` and `mayAnswer` in `targets.ts`; `readOnlyTx` in `apps/hub/src/engine-host/read-only-tx.ts` (00, H-3) | all |
| P-4 | **`ALERT_CONSTANTS` shape:** `{ approval_repeat_ms: 45_000, approval_branch_ms: 120_000, binding_route_idle_ms: 7_200_000, needs_pin: { money: 'always', accept: 'never' } } as const` | task 1 |
| P-5 | **WsHub access for 01d.** `registerWs` returns a `WsHub` extended with `sendToDevices`, `sendToStaff`, `connectedSessions` (H-4) and the alert-mode surface (`alertSockets()`, `sendToAlertMode(deviceIds, frame)`, `onReceipt(fn)`, `setAlertsOpen(fn)`, `onAlertSocketOpen(fn)`); 01d gets it through `wsHubFor(app)` (same pattern as `publisherFor`) | tasks 7, 8 |
| P-6 | **BF-5 frame (gap G4):** `alerts_open` gains `binding_route_until: number \| null`; a new server frame `{ type: 'binding_route', until: number \| null }` is sent to the device's alert-mode and session sockets when the value changes. Proposed AD row (it extends H-2's frame list) | tasks 3, 32, 42 |
| P-7 | **BF-7 flag (gap G3):** `alert_flags` keeps only `'no_approver'` (§5.1 CHECK); `StaffDirectoryApplied` already sets it, and the tick's flag pass also closes `obsolete` the open personal notices of people no longer in `staff`. No schema change. Proposed AD row | task 31 |
| P-8 | **Unknown kind on replay (Review Focus 3):** the `alerts` projection keeps an `AlertRaised` of a kind not registered in this build with `next_due_at = NULL` and logs `{ alert_id, kind, error: 'unknown_kind' }`; boot continues; the tick never selects it; `listOpen` still returns it. Proposed AD row | task 14 |
| P-9 | **Client home (gap G1, until answered):** the alert UI is a new hub-served entry `apps/client/staff/` (vite mode `staff`, same pattern as `admin-stock`), reusing `AdminLogin`'s staff PIN sign-in; the kiosk and phone pages are this entry. The Capacitor tablet shell and its native background service are task 43 and wait for G1 | tasks 39–43 |

## Changes to today's code (read before the named task)

| Code today | Change | Task |
|---|---|---|
| `payloadHash(payload)` (`lib/hash.ts:5`) hashes the whole payload; `route.ts` calls it in `decide` and the `processed_commands` insert | `payloadHash(payload, omit?: string)`; the pipeline passes the command's `pinCheck` field name (H-9) in both places | 4 |
| `CommandDef.permission: Permission \| null` (`registry.ts:35`); `authorize` (`route.ts:247`) throws on `null` for staff | `Permission \| null \| 'checked-in-handler'`; registry `register` throws at startup for the marker outside `HANDLER_CHECKED_COMMANDS`; `authorize` returns `null` for it on a staff session, `403 { session_kind: 'station' }` on a station | 4 |
| `checkPin(deps, o, onMatch)` (`pin.ts:28`) verifies, then one `writer.run` with the match / mismatch branch; on a throw after the reset it opens a **second** transaction (`pin.ts:113`) | optional `hooks { prepare, onMismatch, onPrepareFailed }`, `onMatch(tx, prepared)`; `prepare` on `readOnlyTx(tx)` before the branch; `onPrepareFailed` counts one failure for both PINs in the same transaction; BF-2: if that transaction throws, log and rethrow the **original** `prepare` error; the second-transaction reset stays only for a throw inside `onMatch`; `testHooks.betweenVerifyAndWriter` between `verify` and `writer.run` (`pin.ts:70–75`) | 5 |
| `runCommand` (`route.ts:62`) does payload Zod, then `writer.run` with the handler | after payload Zod: `preRead` (read-only view of `deps.db`), then, when `pinCheck` returns a value, `checkPin` owns the transaction (`prepare` = idempotency re-check, M39 re-check, authorize, `handle`; `onMatch` = append + `processed_commands`); `IdempotentReplay` thrown in `prepare` returns the stored response and counts nothing | 6 |
| `CatchUpPart.build(db, state)` (`catch-up.ts:17`) | `build(db, state, socket)`; `buildCatchUpState` passes `socket` (H-7) | 7 |
| `startSweeper` (`session-sweeper.ts:57`) runs sweep and retention unguarded | each run in try/catch, logged `{ timer: 'sweeper', error }` (H-8); `purge` gains the 01d batches (task 38) | 7, 38 |
| `WsClientMessage.auth.session_token: z.string()` (`ws.ts:7`); `authenticate` requires a session; after auth only `ack` is read (`server.ts:156`) | optional `session_token`; without it → alert mode (H-1); session sockets also accept `receipt` | 3, 8 |
| `StaffDirectory.load` 9 statements; `teamOf(staffId)` direct reports with PIN only | 10 statements (`no_pin_staff`); `teamOf(staffId, { includeNoPin?: boolean })`, `noPinStaff()` (B-1, B-3) | 10 |

## Review Focus

Inputs the spec implies but no §10 test exercises. Each has a test in the named task.

1. **Day close with more than `LIMIT 200` open info alerts** (250 `t_info` alerts open at `BusinessDayClosed`): two tick passes close all 250 `expired`, each exactly once, no `AlertClosed` twice for one id, and the second pass's pre-check is false afterwards → task 29.
2. **`AnswerRequest` payload "iff" rules and PIN echo**: `answerer_staff_id` with `method: 'pin'` or `'session'`, `pin` with `method: 'session'`, `in_person` without `answerer_staff_id` → `400 VALIDATION_FAILED` from payload Zod, argon2 spy not called, nothing counted, and the 400 body never contains the PIN digits → task 23.
3. **`AlertRaised` of a kind this build does not register** (a kind removed after a rollback, replayed at boot): boot completes, the row is open with `next_due_at NULL`, the tick never selects it, `listOpen` lists it, one log line `unknown_kind` (P-8) → task 14.
4. **Hostile `receipt` frames on a staff-session socket**: invalid JSON, `step: -5`, `step: 1e9`, a 5 000-char `alert_id`, `kind: 'seen'` → ignored, no event, the session socket stays open; the same on an alert-mode socket → ignored (a valid-shaped `receipt` never closes it; only non-`receipt` frames close `4401`) → task 21.
5. **`SendTestAlert` to a team whose lead has no reports, or to a paired device that is offline**: `200`, `AttemptSent` with empty `recipients` (team) or the device listed with no route; `alert-receipts` shows "no recipients" / the device with no delivery; no error, no fallback → task 33.

---

## Interfaces (later tasks rely on these exact names)

**Domain — `packages/domain` (task 1):** `ALERT_CONSTANTS` (P-4); `ALERT_FAMILIES = ['urgent','action','info'] as const`, `type AlertFamily`; `ALERT_CLOSE_REASONS = ['answered','withdrawn','done','obsolete','overridden','undone','expired'] as const`; `OWNER_CLOSE_REASONS = ['done','obsolete','overridden','undone'] as const`; `REQUEST_DECISIONS = ['approve','reject','accept','decline'] as const`; `ANSWER_METHODS = ['session','pin','in_person'] as const`; `RECIPIENT_SETS = ['answerer','informed','recipient'] as const`; error codes in `errors.ts`.

**Events — `packages/events` (tasks 2–3):**
- `src/events/alert/*.v1.ts`: `AlertRaised`, `AttemptSent`, `EscalationStepped`, `StepSkipped`, `RequestAnswered`, `RequestWithdrawn`, `RequestSeen`, `AlertClosed`, `AlertDelivered`, `AlertSeen`, `RequestPinFailed` (payloads exactly §4.2); `src/events/staff/PresenceSet.v1.ts`. Payload types `AlertRaisedPayload`, … `PresenceSetPayload`.
- `src/alerts.ts` (§5.4): `AlertTargetSchema` (discriminated on `kind`: `person`, `permission`, `team`, `answerers`, `holders_informed`, `managers`, `requester_lead`, `always_on`, `point`, `table_team`, `zone_order_taker`, `device`), `AlertStepTargetSchema` (`'raised_target'` \| the step kinds \| `{ kind: 'point' \| 'zone_order_taker', from_value }` \| `{ kind: 'table_team', from_value, depth? }`), `AlertDisplaySchema`, `AlertDetailsBase`, `AlertLockSchema`, `AlertCardSchema`, `AlertViewSchema`, payloads `AnswerRequestPayload` (`pin: /^\d{4,6}$/`, the iff refines), `WithdrawRequestPayload`, `MarkAlertsSeenPayload`, `SendTestAlertPayload`, `SetPresencePayload`; results and query responses `AlertsInboxResponse`, `MyRequestsResponse`, `RequestsToAnswerResponse`, `AlertReceiptsResponse`.
- `src/ws.ts` (H-2, P-6): client `auth { device_token, session_token? }`, `receipt { alert_id, kind: 'delivered', step }`; server `alerts_open { alerts, binding_route_until }`, `alert { alert }`, `alert_seen { alert_id }`, `alert_closed { alert_id, reason, decision, by_name }`, `binding_route { until }`.
- Testing (`@pos/events/testing`): `anAlertRaised(o?)`, `anAttemptSent(o?)`, `aRequestAnswered(o?)`, `anAlertClosed(o?)`, `aPresenceSet(o?)`.

**Hub 00 (tasks 4–8):**

```ts
// commands/registry.ts
export const HANDLER_CHECKED_COMMANDS = ['AnswerRequest', 'WithdrawRequest', 'MarkAlertsSeen'] as const;
interface PreReadCtx { db: Database.Database /* readOnlyDb */; state: Readonly<EngineState>; clock: Clock; actor: CommandCtx['actor']; directory: StaffDirectory; branch: CommandCtx['branch']; config: HubConfig; authChanged: boolean }
interface CommandDef<P> { …; permission: Permission | null | 'checked-in-handler';
  preRead?(ctx: PreReadCtx, payload: z.infer<P>): void;
  pinCheck?(payload: z.infer<P>, ctx: PreReadCtx): { staff_id: string; pin: string; field: string } | null;
  pinHooks?: { onMismatch(tx: WriterTx, payload: z.infer<P>, ctx: CommandCtx): EventDraft[];
               onPrepareFailed(tx: WriterTx, error: unknown, matched: boolean, payload: z.infer<P>, ctx: CommandCtx): EventDraft[] } }
// engine-host/read-only-tx.ts
export function readOnlyTx(tx: WriterTx): WriterTx      // append/onCommit throw; db.prepare(sql) throws unless Statement.readonly
export function readOnlyDb(db: Database.Database): Database.Database
// lib/hash.ts
export function payloadHash(payload: unknown, omit?: string): string
// auth/pin.ts
export async function checkPin<T, P = undefined>(deps, o, onMatch: (tx: WriterTx, prepared: P) => T,
  hooks?: { prepare?(tx: WriterTx): P; onMismatch?(tx: WriterTx): EventDraft[]; onPrepareFailed?(tx: WriterTx, error: unknown, matched: boolean): EventDraft[] }): Promise<T>
// deps.testHooks?.betweenVerifyAndWriter?: () => Promise<void>   (HubDeps.testHooks gains it)
// ws/server.ts — WsHub
sendToDevices(deviceIds: string[], frame: WsServerMessage): void   // every socket of the device: staff, station, alert mode
sendToStaff(staffIds: string[], frame: WsServerMessage): void      // staff-session sockets only
connectedSessions(): Array<{ staffId: string | null; deviceId: string; sessionId: string; kind: 'staff' | 'station' }>
alertSockets(): Array<{ deviceId: string; deviceType: DeviceType }>
sendToAlertMode(deviceIds: string[], frame: WsServerMessage): void
onReceipt(fn: (from: { deviceId: string; sessionId: string | null; staffId: string | null; mode: 'session' | 'alert' }, msg: WsReceipt) => void): void
setAlertsOpen(fn: (deviceId: string) => WsAlertsOpen): void        // default: { alerts: [], binding_route_until: null }
export function wsHubFor(app: FastifyInstance): WsHub
// ws/catch-up.ts
interface CatchUpPart { part: string; appliesTo(socket: SocketCtx): boolean; build(db, state, socket: SocketCtx): unknown }
```

**Hub 01b (task 10):** `StaffDirectory.teamOf(staffId, o?: { includeNoPin?: boolean }): string[]`, `noPinStaff(): Array<{ staff_id; display_name; lead_staff_id: string | null }>`, `isNoPin(staffId): boolean`.

**Hub 01d — `apps/hub/src/alerts/` (tasks 13–38):**

```ts
// kinds.ts
defineAlertKind<V, D>(def: AlertKindDef<V, D>): AlertKind<V, D>   // §3.5 fields; startup checks §3.5 / §4.2
kindOf(kind: string): AlertKind | undefined
export const APPROVAL_TIER_STEPS: StepDef[]                        // §3.5 table, from ALERT_CONSTANTS
type AlertRecord<V, D>, AnswerFacts                                // exactly §3.5
// targets.ts
interface BatchReads { sessions; bindings; devices; presence; activity; prevRecipients: Map<string, RecipientRow[]>; resolved: Map<string, { staff_ids; device_ids }> }
batchReads(tx: WriterTx, alerts: AlertRow[], o: { previousStep: boolean }): BatchReads  // fixed reads cached per tx (WeakMap); BF-6
registerTargetResolver(kind: 'table_team' | 'point' | 'zone_order_taker', fn: (tx, targets) => Map<string, { staff_ids: string[]; device_ids: string[] }>): void
resolveStep(step: StepDef, alert: AlertRow, reads: BatchReads, directory: StaffDirectory, ws: WsHub): Recipient[]
walkTeam(directory, leadId: string, depth: 'direct' | 'all', o: { includeNoPin: boolean }): string[]
mayAnswer(directory, request: AlertRequestPart, requesterId: string | null, staffId: string): { ok: true } | { ok: false; reason: 'self' | 'not_approver' | 'out_of_range' | 'not_receiver' }
isPresent(reads: BatchReads, staffId: string): boolean            // BF-8
// routes.ts
registerRoute(def: RouteDef): void                                 // §3.8
routeRecipients(recipients: Recipient[], kind: AlertKind, reads: BatchReads, directory, ws, now): { recipients: RecipientRow[]; routes: RouteRow[] }
bindingIsRoute(binding, reads, ws, now): { route: boolean; until: number | null }
// raise.ts
alerts.raise(ctx: AlertCtx, input: RaiseInput): RaiseResult       // §4.2
alerts.raiseMany(ctx, inputs: RaiseInput[]): RaiseResult[]
alerts.close(ctx, alertId: string, reason: OwnerCloseReason, note?: string): EventDraft[]
alerts.closeMany(ctx, items: Array<{ alert_id; reason; note? }>): EventDraft[]
alerts.listOpen(db, o: { kind?: string; subject?: { stream_type; stream_id } }): AlertRecord[]
alerts.byDedupeKey(db, kind: string, key: string): string | null
alerts.tickCtx(tx: WriterTx, now: number): AlertCtx
alerts.recordReceipt(r: { alert_id; staff_id: string | null; device_id; kind: 'delivered' | 'seen'; step?: number }): void
// tick.ts
registerTick(t: { name: string; due(db, state, now): boolean; intents(tx: WriterTx, state, now): EventDraft[] }): void
startTickLoop(deps): () => void                                    // 500 ms; testHooks.betweenDueAndRun?(name)
// ws-frames.ts
sendStepFrames(appended: PosEvent[]): void; sendCloseFrames(alertIds: string[]): void; sendSeenFrames(staffId: string, alertId: string): void
```

Test fakes (`apps/hub/test/alerts/fakes.ts`, task 13 and on): kinds `t_approval` (approval, `base_permission: 'void-item'`, `range_permission: 'approve-void'`, `needs_pin: ALERT_CONSTANTS.needs_pin.money`, `steps: APPROVAL_TIER_STEPS`, `values_schema { order_id }`, `details_schema` with `item, quantity, amount, reason`, `apply` controlled by `fakeApply.mode: 'ok' | 'throw' | 'append' | 'onCommit' | 'write' | 'no_alert_id' | 'other_alert_id'`), `t_accept` (named, `needs_pin: 'never'`), `t_action`, `t_info`, `t_two_step`, `t_point_like` (values `{ point_id, table_id }`), `t_handover_like` (`requester_lead` at step 1); resolvers `fakeTableOwner`, `fakePoint` (one statement each); route `fakePager` (`routesFor` one statement); tick `fakeFires`.

---

## Coverage table (§10 → task)

66 tests; each number in exactly one task (hub), plus the client halves of #56, #57, #59, #61 and the hardware run of #58.

| Task | 01d tests |
|---|---|
| 10 | 31 |
| 11 | 48 |
| 12 | 40 |
| 15 | 27 |
| 16 | 1, 2, 5 |
| 17 | 3 |
| 18 | 15, 20, 47 |
| 19 | 14 |
| 20 | 29, 49 |
| 21 | 23, 30 |
| 22 | 6, 7, 8, 9, 18 |
| 23 | 11, 44, 54, 56 hub, 60, 66 |
| 24 | 12 |
| 25 | 13 |
| 26 | 16, 33 |
| 27 | 22, 37 |
| 28 | 4, 19, 21, 25, 34, 50 |
| 29 | 24, 36, 51 |
| 30 | 35, 58 (skipped off the pilot hardware; run in task 44) |
| 31 | 32, 59 hub |
| 32 | 26, 28, 64, 65 |
| 33 | 17, 52 |
| 34 | 39, 42, 43, 55 |
| 35 | 10, 41, 53, 61 hub |
| 36 | 46, 57 hub, 62 |
| 37 | 45 |
| 38 | 38 |
| 39 | 59 client (m6), 61 client (BF-4) |
| 40 | 56 client |
| 42 | 57 client (vi) |
| 43 | 63 |

**Moved from §11's step (P-1, P-2):** 31, 48 (step 12 → tasks 10–11); 40 (step 14 → task 12); 14 (step 6, needs `request_result` → task 19); 20 (step 8 → task 18: the shortcut is a raise decision); 50 (step 5 → task 28, needs `registerTick`); 24 (step 8 → task 29); 51 (step 6 → task 29, needs the tick and the answer); 52, 17 (step 8 / 11 → task 33, with `SendTestAlert`); 39 (step 9 → task 34, needs `alerts_open` and catch-up); 55 (step 7 → task 34, needs inbox and catch-up); 10 (step 7 → task 35, needs `my-requests`); 53 (step 8 → task 35, needs `requests-to-answer`); 57, 62 (step 5 → task 36, need `alert-receipts`); 65 (step 5 → task 32); 5 (presence via `PresenceSet` events, P-2); 32, 59 (step 11 → task 31).

## BF-1–BF-8 placement

| BF | Task | Test |
|---|---|---|
| BF-1 no `pin_use_failed` for `pin` + `409` | 23 | extends #60 |
| BF-2 counting transaction fails → original error | 5 (pin.ts), 23 (AnswerRequest) | `[01d BF-2]` |
| BF-3 no binding row for kiosk / KDS | 15 | `[01d BF-3]`, extends #65 (task 32) |
| BF-4 older requests listed without re-notify | 35 (field), 39 (client) | extends #61 |
| BF-5 `binding_route_until` | 3 (frame), 32 (hub), 42 (client) | extends #57 (vi) |
| BF-6 per-tx cache dropped on session / presence events | 18 | `[01d BF-6]` |
| BF-7 personal notices of removed people closed `obsolete` | 31 | `[01d BF-7]` |
| BF-8 absent = `present = 0` only | 16 | extends #5 |

---

## Task list

| Batch | Task | Title | RISK | Markers |
|---|---|---|---|---|
| 0 | 0 | Autobuild rules and settings for v1.8 / R34 | NORMAL | — |
| 1 | 1 | Domain codes and constants | NORMAL | Shared |
| 1 | 2 | Alert events and wire shapes | NORMAL | Shared |
| 1 | 3 | WS frames (H-2, BF-5 frame) | NORMAL | Shared, 00 |
| 1 | 4 | `payload_hash` without the PIN; `'checked-in-handler'` | HIGH | 00 |
| 1 | 5 | `checkPin` hooks, read-only view, BF-2 | HIGH | 00 |
| 2 | 6 | Pipeline `preRead` / `pinCheck` | HIGH | 00 |
| 2 | 7 | WS exports, catch-up socket context, sweeper guard | NORMAL | 00 |
| 2 | 8 | Alert-mode WS | HIGH | 00 |
| 2 | 9 | Migration `0006_alerts.sql` | HIGH | 00 (H-12, H-14) |
| 2 | 10 | Hub directory `no_pin_staff` | HIGH | 01b |
| 3 | 11 | Cloud directory `no_pin_staff`, sync bound | HIGH | 01b, needs Docker Postgres |
| 3 | 12 | Tablet app update endpoints and CLI | NORMAL | 00 |
| 3 | 13 | `defineAlertKind`, `APPROVAL_TIER_STEPS`, test fakes | NORMAL | — |
| 3 | 14 | Projections `alerts`, `alert_flags`, `alert_receipts`, `presence_today` | NORMAL | — |
| 3 | 15 | `device_bindings` projection (BF-3) | HIGH | — |
| 4 | 16 | Targets, team walk, presence, `mayAnswer` (BF-8) | HIGH | — |
| 4 | 17 | Routes of a person, `registerRoute` | HIGH | — |
| 4 | 18 | `raise`, `raiseMany`, `batchReads`, shortcut (BF-6) | NORMAL | — |
| 4 | 19 | `close`, `closeMany`, `listOpen`, `byDedupeKey`, `tickCtx`, `request_result` | NORMAL | — |
| 4 | 20 | `ws-frames.ts`: step, close, seen frames, hiding | HIGH | — |
| 5 | 21 | Receipt buffer and `receipt` frames | NORMAL | — |
| 5 | 22 | `AnswerRequest` — rules, session method, first answer wins | HIGH | — |
| 5 | 23 | `AnswerRequest` — PIN, in person, counted failures (BF-1, BF-2) | HIGH | — |
| 5 | 24 | Personal notices and `hidden_from` | HIGH | — |
| 5 | 25 | `WithdrawRequest` | NORMAL | — |
| 6 | 26 | `MarkAlertsSeen` | HIGH | — |
| 6 | 27 | Tick loop and `registerTick` | HIGH | — |
| 6 | 28 | Alerts tick: steps, skips, restart, race | HIGH | — |
| 6 | 29 | Alerts tick: expiry and day close | HIGH | — |
| 6 | 30 | Statement bounds and timed tick | HIGH | — |
| 7 | 31 | `no_approver` and BF-7 | HIGH | — |
| 7 | 32 | Alert-mode delivery, `alerts_open`, binding header (BF-5) | HIGH | — |
| 7 | 33 | `test_alert` and `SendTestAlert` | NORMAL | — |
| 7 | 34 | `alerts-inbox` and the `alerts` catch-up part | HIGH | — |
| 7 | 35 | `my-requests` and `requests-to-answer` (BF-4 field) | NORMAL | — |
| 8 | 36 | `alert-receipts` | NORMAL | — |
| 8 | 37 | `SetPresence` | NORMAL | — |
| 8 | 38 | Retention | HIGH | — |
| 9 | 39 | Client alert store, re-notify, sounds, labels | NORMAL | UI, BLOCKED-G1 |
| 9 | 40 | Client alert transport, online-only PIN commands | NORMAL | UI, BLOCKED-G1 |
| 9 | 41 | Client alert pages | NORMAL | UI, BLOCKED-G1 |
| 9 | 42 | Tablet header | NORMAL | UI, BLOCKED-G1 |
| 9 | 43 | Tablet app shell, background service, app update client | NORMAL | UI, BLOCKED-G1 |
| 10 | 44 | Full gate, coverage, manual checks | — | Manual |
| 10 | 45 | Final review and as-built spec | — | — |

46 tasks (0–45). HIGH: 4, 5, 6, 8, 9, 10, 11, 15, 16, 17, 20, 22, 23, 24, 26, 27, 28, 29, 30, 31, 32, 34, 38 (23 tasks).

---

## Batch 0 — Setup

### Task 0: Autobuild rules and settings — RISK: NORMAL

**Spec:** README R34, CLAUDE.md "Source of truth".

**Files:** Modify `tools/autobuild/prompts/_rules.md`, `.claude/settings.json`.

- [ ] **Step 1:** `_rules.md` "Sources of truth" item 1 → `docs/specs/00_Foundation_Spec_v1.8.md §6 (Shared Standards) — changes only by an approved version bump (README R34)`. Hard rule "Never edit docs/specs/00_Foundation_Spec_v1.7.md. Never edit approved specs of OTHER modules." → "The foundation and every approved spec change only through a version bump approved by the owner, with a changelog and 'Changed by' markers (README R34); never edit them in a build step. Appending an error code that a module spec defines (F §6.2) needs no bump." Hard rule "Never `git push`" → "Never `git push`, except the controller's `git push origin module-<MOD>` at a batch checkpoint; never push `main`".
- [ ] **Step 2:** `.claude/settings.json` deny: replace the two `docs/specs/00_Foundation_Spec_v1.7.md` entries with `Edit(…)` and `Write(…)` for each of `docs/specs/00_Foundation_Spec_v1.8.md`, `docs/specs/00_Hub_Platform_Access_Spec_v1.6.md`, `docs/specs/01_Restaurant_Setup_Spec_v2.0.md`, `docs/specs/01b_Staff_Roles_Spec_v1.4.md`, `docs/specs/01c_Menu_Variants_Spec_v1.1.md`, `docs/specs/01d_Notifications_Requests_Spec_v1.0.md`. Replace deny `Bash(git push:*)` with deny `Bash(git push origin main:*)`, `Bash(git push --force:*)`, `Bash(git push -f:*)`, `Bash(git push --delete:*)`; add allow `Bash(git push origin module-*)`. (Claude Code applies deny before allow, so the blanket deny must go for the allow to work.)
- [ ] **Step 3:** `node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"` → no error; `grep -c "v1.7" tools/autobuild/prompts/_rules.md` → 0.
- **Done when:** both files changed as above; the gate is not needed (no code).
- [ ] **Commit:** `chore(01d): task 0 autobuild rules and settings for foundation v1.8, R34 [README R34]`

---

## Batch 1 — Shared packages, pipeline hooks (§11 steps 1–3)

### Task 1: Domain codes and constants — RISK: NORMAL — Shared

**Spec:** §9, A14, §3.2, F-4.

**Files:** Modify `packages/domain/src/errors.ts`, `errors.test.ts`, `index.ts`; Create `packages/domain/src/alert-constants.ts`, `alert-constants.test.ts`.

**Interfaces — Produces:** Interfaces block "Domain".

- [ ] **Step 1: Tests:** `[01d §9]` `ALERT_NOT_FOUND` 404, `REQUEST_NOT_PENDING` 409, `REQUEST_PIN_REQUIRED` 422 in the catalogue and `httpStatus`; `[01d A14]` `ALERT_CONSTANTS` equals P-4 exactly (`toStrictEqual`), frozen; the enum arrays equal the Interfaces values.
- [ ] **Step 2:** `pnpm vitest run packages/domain/src/errors.test.ts packages/domain/src/alert-constants.test.ts` → FAIL.
- [ ] **Step 3:** Add the codes (after `ROLE_NOT_FOUND` / the 409 / 422 groups as the file orders them); write `alert-constants.ts`; export from `index.ts`.
- [ ] **Step 4:** PASS; `pnpm --filter @pos/domain typecheck typecheck:tests`.
- [ ] **Commit:** `feat(01d): task 1 error codes and ALERT_CONSTANTS [spec §9, A14]`

### Task 2: Alert events and wire shapes — RISK: NORMAL — Shared

**Spec:** §4.2 events table, §5.4, §6.2–6.10 payloads and results, §3.12, F §6.7.

**Files:** Create `packages/events/src/events/alert/{AlertRaised,AttemptSent,EscalationStepped,StepSkipped,RequestAnswered,RequestWithdrawn,RequestSeen,AlertClosed,AlertDelivered,AlertSeen,RequestPinFailed}.v1.ts`, `packages/events/src/events/staff/PresenceSet.v1.ts`, `packages/events/src/alerts.ts`, `alerts.test.ts`; Modify `packages/events/src/index.ts`, the testing entry, `fixtures.test.ts` (fixture count + 12).

- [ ] **Step 1: Tests:** `[01d §4.2]` a fixture per event parses; `RequestPinFailed` has no `pin` key and refuses one (`.strict()` on that payload only); `AlertRaised.request.approver_role_ids` is an array; `[01d §6.2]` `AnswerRequestPayload`: `pin '1234567'` / `'12a4'` → fail; `in_person` without `answerer_staff_id` → fail; `answerer_staff_id` with `pin` / `session` → fail; `pin` with `session` → fail; `pin` / `in_person` without `pin` → fail; `[01d §3.12]` `AlertDetailsBase` `quantity 0` / `reason` 201 chars → fail; `AlertLockSchema` has no `details` key; `[01d §6.4]` `MarkAlertsSeenPayload` 0 and 51 ids → fail; `[01d §6.6]` `SetPresencePayload` 101 ids → fail.
- [ ] **Step 2:** `pnpm vitest run packages/events/src/alerts.test.ts packages/events/src/fixtures.test.ts` → FAIL.
- [ ] **Step 3:** Write the event files (stream types as §4.2: subject events typed with the subject's `stream_type`; `AlertDelivered`, `AlertSeen`, `RequestPinFailed` on `audit`; `PresenceSet` on `staff`), `alerts.ts`, builders.
- [ ] **Step 4:** PASS; `pnpm --filter @pos/events typecheck typecheck:tests`.
- [ ] **Commit:** `feat(01d): task 2 alert events and wire shapes [spec §4.2, §5.4, §6]`

### Task 3: WS frames — RISK: NORMAL — Shared, 00 (H-2)

**Spec:** §6 batch 3, 00 v1.6 H-2, BF-5 / P-6.

**Files:** Modify `packages/events/src/ws.ts`, `ws.test.ts`.

- [ ] **Step 1: Tests:** `[00 H-2]` `auth` without `session_token` parses; `receipt` with `kind: 'seen'` fails, `step` not an int ≥ 0 fails; the four alert frames of §6 batch 3 parse with the spec's example JSON; `alerts_open` rows refuse a `card` key; `[01d BF-5]` `binding_route { until: null }` and `alerts_open.binding_route_until` parse.
- [ ] **Step 2:** FAIL → **Step 3:** extend the unions → **Step 4:** PASS.
- **Note:** `binding_route` is a proposed AD row (P-6); record it in the checkpoint.
- [ ] **Commit:** `feat(00): task 3 alert frames and optional session token [00 v1.6 H-2; 01d §6 batch 3, BF-5]`

### Task 4: `payload_hash` without the PIN; `'checked-in-handler'` — RISK: HIGH — 00 (H-9, H-3 part)

**Spec:** 00 v1.6 H-9, H-3 (marker), §3.3 rule 4 "PIN never stored", 01d test 33 (registry half).

**Files:** Modify `apps/hub/src/lib/hash.ts`, `hash.test.ts`, `apps/hub/src/commands/registry.ts`, `route.ts`; Test `apps/hub/test/commands/route.int.test.ts`, `idempotency.int.test.ts`.

**Interfaces — Produces:** `payloadHash(payload, omit?)`, `HANDLER_CHECKED_COMMANDS`, `CommandDef.permission` widened, `CommandDef.pinCheck` / `preRead` / `pinHooks` **types only** (behaviour in tasks 5–6).

- [ ] **Step 1: Tests:** `[00 H-9]` `payloadHash({ a: 1, pin: '4711' }, 'pin') === payloadHash({ a: 1 })` and `!== payloadHash({ a: 1, pin: '4711' })`; without `omit` unchanged (existing vectors); `[00 H-3]` registering `{ commandType: 'TestNoop2', permission: 'checked-in-handler' }` throws `/HANDLER_CHECKED_COMMANDS/` at `register`; a fake def named `MarkAlertsSeen` with the marker registers in a fresh registry (test-only; the real command is task 26); a station session calling a handler-checked command → `403 { session_kind: 'station' }`; a staff session gets `ctx.permission === null`.
- [ ] **Step 2:** `pnpm vitest run apps/hub/src/lib/hash.test.ts apps/hub/test/commands/route.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement; in `route.ts` the hash in `decide` and in the insert uses `payloadHash(command.payload, pinField)` where `pinField = commandDef.pinCheck?.(payload, preCtx)?.field` — until task 6, `pinField` is `undefined` for every existing command.
- [ ] **Step 4:** PASS; existing `idempotency.int.test.ts` green unchanged.
- [ ] **Commit:** `feat(00): task 4 payload_hash without the PIN field, checked-in-handler marker [00 v1.6 H-9, H-3]`

### Task 5: `checkPin` hooks, read-only view, BF-2 — RISK: HIGH — 00 (H-3)

**Spec:** 00 v1.6 H-3 (`prepare`, `onMatch(tx, P)`, `onMismatch`, `onPrepareFailed`, `betweenVerifyAndWriter`), §3.3 rule 4 (d), §3.5 "Read-only contract", BF-2.

**Files:** Create `apps/hub/src/engine-host/read-only-tx.ts`, `apps/hub/test/engine-host/read-only-tx.int.test.ts`; Modify `apps/hub/src/auth/pin.ts`, `apps/hub/src/server.ts` (`HubDeps.testHooks`), `apps/hub/test/auth/pin.int.test.ts` (or the existing checkPin test file — grep `checkPin` under `apps/hub/test/auth/`).

**Interfaces — Produces:** `readOnlyTx`, `readOnlyDb`, the new `checkPin` signature (Interfaces block).

- [ ] **Step 1: Tests:** `[00 H-3]` `readOnlyTx(tx).append([...])` throws, `.onCommit(fn)` throws, `.db.prepare('UPDATE …')` throws, `.db.prepare('SELECT 1')` works; `readOnlyDb` same. `checkPin` with hooks, driven by a fake `prepare` (spy writer counting `run` calls, argon2 `verify` spy):
  - prepare ok + match → `onMatch(tx, P)` gets the prepared value, staff counter reset, **1** `writer.run`;
  - prepare ok + mismatch → `onMismatch` drafts appended, staff and device counters +1, `401 PIN_INVALID`, 1 `writer.run`;
  - prepare throws `DomainError('REQUEST_NOT_PENDING')` + match and + mismatch → both: counters +1 each, `onPrepareFailed(tx, err, matched)` called with `true` / `false`, its drafts appended, the same `409` returned, exactly 1 `writer.run`, staff counter **not** reset;
  - 5th counted failure → `StaffPinLockedOut` in that transaction; next call → `429 PIN_LOCKED_OUT` before `verify` (spy 0);
  - `prepare` tries `tx.append` → its own error is the `prepare` error (counted);
  - `[01d BF-2]` `onPrepareFailed` throws → the caller still gets the original `prepare` error for both PINs, one error log line `{ error, phase: 'onPrepareFailed' }`;
  - `onMatch` throws after the reset → the original error, counter reset kept, logged;
  - `testHooks.betweenVerifyAndWriter` runs after `verify` and before `writer.run` (order spy);
  - no hooks (sign-in) → today's behaviour: existing sign-in tests unchanged.
- [ ] **Step 2:** FAIL → **Step 3:** implement. Inside the existing `writer.run`: lock checks → `let prepared; try { prepared = hooks.prepare?.(readOnlyTx(tx)) } catch (e) { if (e is IdempotentReplay) rethrow uncounted; count failure (staff + subject, as the mismatch branch); tx.append(hooks.onPrepareFailed?.(tx, e, matched) ?? []); return { kind: 'prepare_failed', error: e } }` → match / mismatch branch. After commit, `prepare_failed` rethrows `error`. `IdempotentReplay` is imported from a new export in `route.ts` moved to `apps/hub/src/commands/replay.ts` (so `pin.ts` does not import `route.ts`).
- [ ] **Step 4:** PASS; existing auth tests green.
- [ ] **Commit:** `feat(00): task 5 checkPin prepare and counted prepare failures, read-only tx view [00 v1.6 H-3; 01d §3.3 rule 4, BF-2]`

---

## Batch 2 — Pipeline, WS, migration, hub directory (§11 steps 3, 4, 12)

### Task 6: Pipeline `preRead` / `pinCheck` — RISK: HIGH — 00 (H-3)

**Spec:** 00 v1.6 H-3 (pipeline split), 00 §3.7, §3.3 rule 4 (a)–(d).

**Files:** Modify `apps/hub/src/commands/route.ts` (`registerTestCommands` gains `TestPinChecked`, test-only), `apps/hub/test/commands/route.int.test.ts`; Create `apps/hub/test/commands/pin-checked.int.test.ts`.

`TestPinChecked`: payload `{ staff_id, pin, refuse?: 'pre' | 'prepare' }`, `permission: 'reprint-ticket'`, `preRead` throws `DomainError('STAFF_NOT_FOUND')` when `refuse = 'pre'`, `handle` throws `DomainError('REQUEST_NOT_PENDING')` when `refuse = 'prepare'`, `pinCheck` → `{ staff_id, pin, field: 'pin' }`, `pinHooks` append one `TestNooped`.

- [ ] **Step 1: Tests** (`pin-checked.int.test.ts`): `[00 H-3]` order: replay of a stored `command_id` → stored `200`, `verify` spy 0 (fast path, (a)); payload Zod fail → `400`, spy 0; `refuse: 'pre'` → `404` for right and wrong PIN, spy 0, counters 0 ((b)); success → one `writer.run`, `processed_commands.payload_hash` = hash without `pin`, the row's `response_json` has no PIN; `refuse: 'prepare'` → `409` for both PINs, counters +1 each, one `writer.run` each; M39: session ended in `betweenVerifyAndWriter` → `SESSION_EXPIRED` for both PINs, counted; a replay racing in `betweenVerifyAndWriter` (the same `command_id` committed by a parallel call) → stored `200`, counters unchanged (`IdempotentReplay` in `prepare`); a replay with a different PIN → stored `200` (H-9).
- [ ] **Step 2:** FAIL → **Step 3:** implement the split: after payload Zod, build `preCtx` (`readOnlyDb(deps.db)`, `authChanged = authGeneration changed`), call `def.preRead?.(preCtx, payload)`; `const pin = def.pinCheck?.(payload, preCtx)`; no `pin` → today's path; else `checkPin(deps, { staffId: pin.staff_id, pin: pin.pin, subject: { type: 'device', id: deviceId }, eventDeviceId: deviceId }, (tx, prepared) => append + insert, { prepare: (tx) => body up to the drafts, onMismatch, onPrepareFailed })`. `activity.touch` after success only, as today.
- [ ] **Step 4:** PASS; all `apps/hub/test/commands/*` green.
- [ ] **Commit:** `feat(00): task 6 pipeline preRead and pinCheck through checkPin [00 v1.6 H-3; 01d §3.3 rule 4]`

### Task 7: WS exports, catch-up socket context, sweeper guard — RISK: NORMAL — 00 (H-4, H-7, H-8)

**Spec:** 00 v1.6 H-4, H-7, H-8.

**Files:** Modify `apps/hub/src/ws/server.ts`, `catch-up.ts`, `restaurant-catch-up.ts` (signature only), `apps/hub/src/auth/session-sweeper.ts`; Test `apps/hub/test/ws/ws-publish.int.test.ts`, `apps/hub/test/auth/` sweeper test file.

- [ ] **Step 1: Tests:** `[00 H-4]` two staff sockets and one station socket open → `connectedSessions()` lists the three with `kind`, statement counter 0; `sendToStaff([s1])` reaches only s1's staff sockets; `sendToDevices([d])` reaches every socket of `d`; a closed socket leaves the list; `[00 H-7]` a part's `build` receives the same `SocketCtx` as `appliesTo`; `[00 H-8]` `retentionOnce` made to throw → `startSweeper`'s run logs `{ timer: 'sweeper', error }` and the next interval runs.
- [ ] **Step 2:** FAIL → **Step 3:** implement; `wsHubFor(app)` (P-5) → **Step 4:** PASS.
- [ ] **Commit:** `feat(00): task 7 ws.sendToDevices, sendToStaff, connectedSessions; catch-up socket context; sweeper guard [00 v1.6 H-4, H-7, H-8]`

### Task 8: Alert-mode WS — RISK: HIGH — 00 (H-1, H-13)

**Spec:** 00 v1.6 H-1, H-13, §3.7 (alert mode, revoke / rotation), F-5–F-7.

**Files:** Modify `apps/hub/src/ws/server.ts`; Create `apps/hub/test/ws/alert-mode.int.test.ts`.

- [ ] **Step 1: Tests:** `[00 H-1]` auth with a valid device token and no `session_token` (device types `tablet`, `cashier_kiosk`, `kds`, `phone`) → first frame is `alerts_open` (default builder: `{ alerts: [], binding_route_until: null }`), no `catch_up`, then no `event` frame when events are published; a revoked device → close `4403`; unknown token → `4401`; after auth a non-`receipt` frame (e.g. `ack`) → close `4401`; a `receipt` frame → `onReceipt` called with `mode: 'alert'`, `sessionId: null`; a second alert-mode auth for the same device closes the first with `4409` and logs `{ device_id, old_remote_address, new_remote_address }`; `DeviceRevoked` committed → that device's alert socket closes `4403` with no frame first; `DeviceTokenRotated` → `4401`; the alert socket is never in `connectedSessions()` nor in `deliver()` (publish spy); `[00 H-13]` a pong on an alert-mode socket calls `activity.deviceSeen`; `[00 H-1]` a staff-session socket's `receipt` frame → `onReceipt` with `mode: 'session'` and its `staffId`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (a second list `alertOpen: Map<deviceId, AlertSocket>`; an `addAfterCommit` hook on `DeviceRevoked` / `DeviceTokenRotated`) → **Step 4:** PASS; `ws-auth.int.test.ts` green.
- [ ] **Commit:** `feat(00): task 8 alert-mode WS connection [00 v1.6 H-1, H-13; F v1.8 F-5–F-7]`

### Task 9: Migration `0006_alerts.sql` — RISK: HIGH — 00 (H-12, H-14)

**Spec:** §5.1 (SQL verbatim), 00 v1.6 H-5 (table), H-12, H-14.

**Files:** Create `apps/hub/src/db/migrations/0006_alerts.sql`, `apps/hub/test/db/alerts-migration.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d §5.1]` migrate a `0005` database (existing fixture with sessions and staff) to latest: every §5.1 table and index exists with the §5.1 name (`sqlite_master`), the partial-index `WHERE` texts match; `alert_flags` = `[('no_approver', 1)]`; `alerts` CHECK `(state = 'closed') = (close_reason IS NOT NULL)` refuses an open row with a reason; `alert_recipients` CHECK refuses both ids null; with `foreign_keys = ON`, deleting an `alerts` row cascades its `alert_recipients` and `alert_inbox` rows; `alerts_open_dedupe` refuses a second open `(kind, dedupe_key)` and allows it once the first is closed; `EXPLAIN QUERY PLAN` of the §3.4.3 (c) activity read uses `staff_sessions_staff_activity`; `0001`–`0005` file hashes unchanged (the migrator's checksum test).
- [ ] **Step 2:** FAIL → **Step 3:** write the file from §5.1 → **Step 4:** PASS; `apps/hub/test/db/*` green.
- [ ] **Commit:** `feat(01d): task 9 hub migration 0006_alerts [spec §5.1; 00 v1.6 H-5, H-12, H-14]`

### Task 10: Hub directory `no_pin_staff` — RISK: HIGH — 01b (B-1, B-3, B-6)

**Spec:** 01b v1.4 §4.3.1, §4.2, B18 (b) as changed (B-1, B-3, B-6); 01d §3.4 `team`.

**Files:** Modify `packages/events/src/directory.ts` (additive `no_pin_staff`, optional for older clouds), `apps/hub/src/auth/apply-directory.ts`, `apps/hub/src/auth/staff-directory.ts`, `staff-directory.test.ts`; Test `apps/hub/test/auth/apply-directory.int.test.ts` (existing).

- [ ] **Step 1: Tests:** `[01d #31]` a directory with Ali (PIN) leading Sana (`no_pin_staff`) → `teamOf(ali)` excludes Sana, `teamOf(ali, { includeNoPin: true })` includes her, roster (`list()`) excludes her, `noPinStaff()` lists her; a new version moving Sana to `staff` (PIN set) → she is in `staff` and not in `no_pin_staff` in one `StaffDirectoryApplied`; a directory without the field (older cloud) applies and `noPinStaff()` is `[]`. `[01b B-1]` `StaffDirectory.load` issues 10 statements (`statementCounter`); the cache table is replaced whole. `[01b B-6]` a PIN-holder whose `lead_staff_id` names Sana keeps the lead (`leadOf` = Sana); a lead naming someone in neither list is skipped.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01b): task 10 hub directory no_pin_staff, teamOf includeNoPin [01b v1.4 B-1, B-3, B-6; 01d §4.5; tests #31]`

---

## Batch 3 — Cloud directory, app update, kinds, projections (§11 steps 4, 5, 12, 14)

### Task 11: Cloud directory `no_pin_staff`, sync bound — RISK: HIGH — 01b (B-5) — needs Docker Postgres

**Spec:** 01b v1.4 B-5, §4.4 row 6; README R32 c.

**Files:** Modify `apps/cloud/src/modules/config-sync/service.ts` (and the directory repository it calls; grep `loadDirectory`), the existing sync statement-bound test under `apps/cloud/test/` (grep `≤ 26` / `26`).

- [ ] **Step 1: Tests:** `[01d #48]` `GET /v1/sync/config` `200` with the directory and two no-PIN staff (one leading a PIN holder) → `no_pin_staff` lists both with `lead_staff_id`, runs ≤ 27 statements (`pgCounter`); directory-only measured 11 (≤ 17); config-only ≤ 22 and `304` unchanged; then the hub applies it and keeps the PIN holder's lead (B-6, through `applyStaffDirectory` in the same test via the hub test helper, or as a second `it` in the hub file tagged `[01b B-6]` if the cloud suite cannot start a hub — the number #48 stays here).
- [ ] **Step 2:** FAIL → **Step 3:** one statement: active staff at the branch with `pin_hash IS NULL`, with `lead_staff_id` → **Step 4:** PASS.
- [ ] **Commit:** `feat(01b): task 11 cloud directory no_pin_staff, sync bound 27 [01b v1.4 B-5; README R32 c; tests #48]`

### Task 12: Tablet app update endpoints and CLI — RISK: NORMAL — 00 (H-5)

**Spec:** 00 v1.6 §6.36–§6.38 (H-5), H-11, §8.4.

**Files:** Create `apps/hub/src/app-update/{routes.ts,cli.ts}`, `apps/hub/test/app-update/app-update.int.test.ts`; Modify `apps/hub/src/server.ts` (register routes), `apps/hub/package.json` (script `app-release` → `node dist/app-update/cli.js`; no new dependency).

- [ ] **Step 1: Tests:** `[01d #40]` exactly the §10 #40 cases (no release → `404 ROUTE_NOT_FOUND`; `add --stage T1` → T1's `latest` returns it, T2's the previous good one or `404`; `mark-good` → T2 gets it; `.apk` streams the file with `application/vnd.android.package-archive` and its bytes hash to the stored `sha256`; KDS → `403 DEVICE_TYPE_NOT_ALLOWED`; `add` keeps the newest 2 good plus the staged one and deletes older files from `<data_dir>/apk/`); `[00 §6.36]` `latest` is 1 statement; unknown `version_code` `.apk` → `404`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(00): task 12 tablet app update endpoints and app-release CLI [00 v1.6 §6.36–§6.38, H-5; 01d §8.4; tests #40]`

### Task 13: `defineAlertKind`, `APPROVAL_TIER_STEPS`, test fakes — RISK: NORMAL

**Spec:** §3.5 (kind, request part, step `at` / `to`, startup errors), §4.2 `defineAlertKind`, `APPROVAL_TIER_STEPS`, §3.12 labels.

**Files:** Create `apps/hub/src/alerts/kinds.ts`, `kinds.test.ts`, `apps/hub/src/alerts/index.ts`, `apps/hub/test/alerts/fakes.ts`.

- [ ] **Step 1: Tests (`kinds.test.ts`):** `[01d §3.5]` each startup error throws: duplicate `kind`; `urgent` without request; `from_value` not in `values_schema`; `answerer` / `informed` set on a non-request kind; `lead_fallback: true` on a request kind; `expires_at_day_close: false` without `closes_on: 'seen'`; `silent: true` on `action` and on a request kind; approval kind with no `escalation: true` step; `APPROVAL_TIER_STEPS` deep-equals §3.5 table (step 0 `answerers`, step 1 at 45 000 + `always_on`, step 2 `escalation: true` at 120 000 with `holders_informed` and `always_on`); `stepAt(step, alert)` for `{ ms }` and `{ value: 'window_ms', times: 2 }`.
- [ ] **Step 2:** FAIL → **Step 3:** implement; `fakes.ts` defines the fakes of the Interfaces block (registered per test file through `registerFakes()` / `resetFakes()`; never imported by `src/`) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 13 defineAlertKind, APPROVAL_TIER_STEPS [spec §3.5, §4.2]`

### Task 14: Projections `alerts`, `alert_flags`, `alert_receipts`, `presence_today` — RISK: NORMAL

**Spec:** §5.2 (rows 1–3, 5), §3.2 fields, §3.5 `next_due_at`, day close, cumulative recipients, §3.10 `hidden_from`, P-8.

**Files:** Create `apps/hub/src/projections/alerts.ts`, `apps/hub/test/alerts/projections.int.test.ts`; Modify `apps/hub/src/alerts/index.ts`.

- [ ] **Step 1: Tests:** `[01d §5.2]` `AlertRaised` → `alerts` row with `raised_device_id` / `raised_seq` from the envelope, `hidden_session_id` / `hidden_device_id` from `hidden_from`, `step -1`, `next_due_at` = step 0 time; `AttemptSent` step 0 → `alert_recipients` rows (a no-route person included), `alert_inbox` upserts, `next_due_at` = next step or `raised_at + after_ms`, whichever is earlier, null when neither; a later step dropping a person sets `moved_to`; `RequestAnswered` / `RequestWithdrawn` / `AlertClosed` → closed with reason, `decision`, `closed_by_staff_id`; `RequestSeen` → `request_seen` + the seer's inbox row; `BusinessDayClosed` → `expire_due = 1`, `next_due_at = recorded_at` on open non-request alerts of `expires_at_day_close` kinds only, and `hidden_device_id = NULL` on every open alert (1 statement); `alert_flags` dirty on each of the five events, `reset` re-inserts `('no_approver', 1)`; `AlertDelivered` twice → one `alert_receipts` row; `PresenceSet` upserts, `BusinessDayClosed` clears `presence_today`; projection reads ≤ 2 per step / close event (`statementCounter` scoped to `apply`); `reset` + replay gives identical tables. **Review Focus 3** (P-8): an `AlertRaised` of an unregistered kind replayed at boot → boot completes, row open with `next_due_at NULL`, one `unknown_kind` log line.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 14 alerts, alert_flags, alert_receipts, presence_today projections [spec §5.2, §3.5]`

### Task 15: `device_bindings` projection — RISK: HIGH

**Spec:** §3.7 binding table and rebuild, §5.2 row 4, BF-3.

**Files:** Create `apps/hub/src/alerts/bindings.ts`, `apps/hub/test/alerts/bindings.int.test.ts`; Modify `alerts/index.ts`.

- [ ] **Step 1: Tests:** `[01d #27]` exactly §10 #27, with the m2 phone case (a `SessionStarted` and a logout on the phone leave the owner row). `[01d BF-3]` a cashier signs in on a kiosk and a station session opens on a KDS → **no** `device_bindings` row for either (device type from `DevicePaired`, kept in the projection's own map, rebuilt on replay); `[01d §3.7]` `BusinessDayClosed` deletes every row with a `session_id` and keeps phone rows; `SessionEnded` reasons `idle_timeout` / `replaced` keep the row, the other six delete `WHERE session_id = ?`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (the device-type map is a projection read of `devices` by id when the type is unknown — 1 statement per `SessionStarted`, inside the projection's 2-read budget) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 15 device_bindings projection, no kiosk or KDS rows [spec §3.7, §5.2, BF-3; tests #27]`

---

## Batch 4 — Targets, routes, raise, close, frames (§11 steps 5, 6)

### Task 16: Targets, team walk, presence, `mayAnswer` — RISK: HIGH

**Spec:** §3.4 table and step targets, §3.4.1, §3.4.2, §3.3 rules 5–6 (for `answerers` / `holders_informed` and `mayAnswer`), BF-8.

**Files:** Create `apps/hub/src/alerts/targets.ts`, `targets.test.ts` (pure, fake directory), `apps/hub/test/alerts/targets.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #1]`, `[01d #2]`, `[01d #5]` exactly as §10, #5 extended by BF-8 (`presence_today` has Ali `present = 0` and Bilal `1`; X not ticked → X present; nobody ticked → all present; a signed-in absent person → present). `[01d §3.3 rule 6]` `mayAnswer`: requester → `self`; empty `approver_role_ids` read now → `not_approver`; `range_permission` with scope `my_team` and requester outside the subtree → `out_of_range`, a grand-report → ok; no `range_permission` → branch-wide ok; `named` and not the receiver → `not_receiver`; a `no_pin_staff` person → never ok. `[01d §3.4]` `requester_lead` with no lead → empty, other entries still go; `managers` = branch-scope `force-release-table-lock` holders; `always_on` = kiosk + KDS devices; an unregistered `table_team` → `DomainError('VALIDATION_FAILED', { issue: 'target_unavailable', target_kind })`; a registered fake resolver is called once with every target of its kind.
- [ ] **Step 2:** FAIL → **Step 3:** implement `resolveStep`, `walkTeam` (depth ≤ active staff count, visited set), `mayAnswer`, `isPresent`, `registerTargetResolver`; `batchReads` signature only (body in task 18) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 16 targets, team walk, presence filter, answer right [spec §3.4, §3.3 rules 5–6, BF-8; tests #1, #2, #5]`

### Task 17: Routes of a person, `registerRoute` — RISK: HIGH

**Spec:** §3.4.3 (screen, alert connection (a)(b)(c), registered routes, no route, "for" rows), §3.8.

**Files:** Create `apps/hub/src/alerts/routes.ts`, `routes.test.ts`.

- [ ] **Step 1: Tests:** `[01d #3]` exactly §10 #3; `[01d §3.4.3]` a tablet binding is a route only when its device is connected (alert-mode or session socket), the person is not absent, and their last activity (max of `staff_sessions.last_activity_at` and the in-memory `activity` value) is within `binding_route_idle_ms`; a kiosk row never routes; a phone owner binding is exempt from (c); `bindingIsRoute` returns `until = lastActivity + 7 200 000` for a tablet, `null` otherwise; a "for" fallback reaching a person already in the step adds nothing; `fakePager.routesFor` called once with every person recipient; a person whose only route is the pager is not "no route".
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 17 routes of a person, binding route rule, registerRoute [spec §3.4.3, §3.8; tests #3]`

### Task 18: `raise`, `raiseMany`, `batchReads`, shortcut — RISK: NORMAL

**Spec:** §6.1 raise, §4.2 `raise` / `raiseMany`, §3.5 "Several raises", G1-9d shortcut, §3.12 `details`, BF-6.

**Files:** Create `apps/hub/src/alerts/raise.ts`, `apps/hub/test/alerts/raise.int.test.ts`; Modify `targets.ts` (`batchReads` body).

- [ ] **Step 1: Tests:** `[01d #15]`, `[01d #20]`, `[01d #47]` exactly as §10; `[01d §6.1]` `values` / `details` failing the kind's schema → `values_invalid` / `details_invalid`; approval kind without `approver_role_ids` → `Error`; named kind without `receiver_staff_id` → `Error`; `raise` never reads `ctx.permission` (ctx with a throwing getter); dedupe across kinds gives two alerts and a deduped raise returns the open one's `requester_staff_id`; statements ≤ 6 + R + T; `[01d BF-6]` a transaction that appends `SessionStarted` for Imran on tablet T, then raises → Imran's new session is a route (cache dropped on `SessionStarted`, `SessionEnded`, `DeviceRevoked`, `PresenceSet` appended in that `tx`).
- [ ] **Step 2:** FAIL → **Step 3:** implement (per-tx `WeakMap<WriterTx, Cache>` holding the fixed reads and the returned dedupe keys; invalidation by wrapping `tx.append` once per tx) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 18 raise, raiseMany, batched reads, G1-9d shortcut [spec §6.1, §4.2, §3.5, BF-6; tests #15, #20, #47]`

### Task 19: `close`, `closeMany`, `listOpen`, `byDedupeKey`, `tickCtx`, `request_result` — RISK: NORMAL

**Spec:** §6.1 close, §4.2 rows, §3.3 "Close by the owning module", §3.10 `request_result`.

**Files:** Modify `apps/hub/src/alerts/raise.ts`, `kinds.ts` (kind `request_result`: `info`, subject = the request's, step 0 `{ person: requester }`, `closes_on: 'seen'`, `lead_fallback: false`, labels); Test `apps/hub/test/alerts/close.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #14]` exactly §10 #14 (the "after answer" case appends `RequestAnswered` through the builder); `[01d §4.2]` `closeMany` of 10 requests → one alert read and one `raiseMany`; `listOpen({ kind })` oldest first, 1 statement; `byDedupeKey` 1 statement; `tickCtx(tx, now)` = `{ tx, now, actor_id: null, device_id: 'hub', session: null, permission: null }` and a raise through it has `raised_device_id = 'hub'`; closing `undone` / `done` raises no `request_result`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 19 close, closeMany, listOpen, tickCtx, request_result [spec §6.1, §4.2, §3.3, §3.10; tests #14]`

### Task 20: `ws-frames.ts`: step, close, seen frames, hiding — RISK: HIGH

**Spec:** §6 batch 3 (card vs. lock, device targets, hidden from the answering seat, cumulative `alert_closed`, may-answer sockets), §3.6 `alert_seen`, §3.12, §7 logging.

**Files:** Create `apps/hub/src/alerts/ws-frames.ts`, `apps/hub/test/alerts/frames.int.test.ts`; Modify `alerts/index.ts` (`writer.addAfterCommit` hook).

- [ ] **Step 1: Tests:** `[01d #29]`, `[01d #49]` exactly as §10 (#49's alert-mode case uses an alert-mode socket of a bound tablet routed by task 17); `[01d §6 batch 3]` an `alert` frame per step per socket, `set` and `for_staff_id` per recipient; device-target recipients (kiosk cashier socket, KDS station socket) get `lock` only; an alert with `hidden_session_id = s1` / `hidden_device_id = T` sends nothing to s1 or to any socket of T, and does reach the same person on another device; `alert_closed` for 3 alerts closed in one transaction → one recipients read, frames to every device in any step, every inbox person and devices bound to them, plus (requests) every connected staff socket whose person `mayAnswer`s it now; `alert_seen` reaches the person's staff sockets and the alert-mode sockets of devices bound to them; the log capture never contains a `details` value.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 20 alert frames, card only on own staff sockets, answering-seat hiding [spec §6 batch 3, §3.6, §3.12; tests #29, #49]`

---

## Batch 5 — Receipts and the request commands (§11 steps 7, 9)

### Task 21: Receipt buffer and `receipt` frames — RISK: NORMAL

**Spec:** §3.6, A11, §6 batch 3 device → server, §4.2 `recordReceipt`.

**Files:** Create `apps/hub/src/alerts/receipts.ts`, `apps/hub/test/alerts/receipts.int.test.ts`; Modify `alerts/index.ts` (flush timer, boot seed before WS accepts sockets, `ws.onReceipt`).

- [ ] **Step 1: Tests:** `[01d #23]`, `[01d #30]` exactly as §10. **Review Focus 4:** on a staff socket, invalid JSON, `step: -5`, `step: 1e9`, a 5 000-char `alert_id`, `kind: 'seen'` → ignored, no event, the socket stays open; the same valid-shaped garbage on an alert-mode socket → ignored, socket open. `[01d §3.6]` a `receipt` with `step` above the alert's current step → ignored; "sent" includes a device that got it only through `alerts_open` / catch-up (a `sentVia` set filled by tasks 32 / 34; until then by `recordSent(deviceId, alertId)`).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 21 receipt buffer and receipt frames [spec §3.6, A11, §6 batch 3; tests #23, #30]`

### Task 22: `AnswerRequest` — rules, session method, first answer wins — RISK: HIGH

**Spec:** §6.2 (Processing (0)–(10), Race), §3.3 rules 1, 3, 5, 6, 7, A4, A5, §3.5 read-only contract and `alert_id` check.

**Files:** Create `apps/hub/src/alerts/commands/answer-request.ts`, `apps/hub/test/alerts/answer-request.int.test.ts`; Modify `alerts/index.ts`.

**Interfaces — Consumes:** tasks 4–6 (`'checked-in-handler'`, `preRead`), 16 (`mayAnswer`), 18–20.

- [ ] **Step 1: Tests:** `[01d #6]`, `[01d #7]`, `[01d #8]`, `[01d #9]`, `[01d #18]` exactly as §10 (#6 uses `betweenGuardAndWriter` to run two calls into the writer; the loser's `409` carries `answered_by_name`); `[01d §6.2]` `preRead` order on `t_accept` with `method: 'session'`: unknown id → `404`, closed → `409`, `approve` on an accept kind → `400`, self → `403 self`, out of range → `403 out_of_range` (1 statement, `statementCounter`); success → `RequestAnswered { on_requester_device: false }` (answered from another device), `request_result` raised to the requester, the alert closed `answered`, `alert_closed` frames to every recipient of every step (task 20); `apply` drafts without `payload.alert_id` → `500`, nothing written; `method: 'pin'` already goes through `checkPin` (a wrong PIN → `401`, counted), so no PIN-free path exists between tasks 22 and 23.
- [ ] **Step 2:** FAIL → **Step 3:** implement: `permission: 'checked-in-handler'`, `preRead` (rules in the §3.3 rule 4 (b) order, then `apply` on `readOnlyTx` of the read-only db wrapped as a tx; drafts discarded), `handle` (authoritative re-checks, drafts, `alert_id` check), `pinCheck` returning the session staff's PIN for `method: 'pin'` with empty `pinHooks` (task 23 fills them and adds `in_person`; until then `preRead` refuses `in_person` with `400 VALIDATION_FAILED { issues: [{ path: 'method' }] }`, a temporary guard that task 23 removes, named in the checkpoint) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 22 AnswerRequest rules and session answers, first answer wins [spec §6.2, §3.3 rules 1–7, A4, A5; tests #6, #7, #8, #9, #18]`

### Task 23: `AnswerRequest` — PIN, in person, counted failures — RISK: HIGH

**Spec:** §6.2 `pinCheck` row, §3.3 rules 2–4 (all of (a)–(d), "What a guesser learns", "PIN never stored"), §3.10 `pin_use_failed`, §4.2 `RequestPinFailed`, BF-1, BF-2, 00 H-9, H-10.

**Files:** Modify `apps/hub/src/alerts/commands/answer-request.ts`, `kinds.ts` (kind `pin_use_failed`: personal, `lead_fallback: false`, `expires_at_day_close: false`, `closes_on: 'seen'`, step 0 `{ person: PIN owner }`, `dedupe_key = 'pin_use_failed:' + alert_id + ':' + command_id`, `hidden_from` = the sending session and device); Test `apps/hub/test/alerts/answer-pin.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #11]`, `[01d #44]`, `[01d #54]`, `[01d #56 hub]`, `[01d #60]`, `[01d #66]` exactly as §10; #60 extended by **BF-1** (two managers approve one `t_approval` at once with `method: 'pin'`, the loser gets `409`, one counted failure, one `RequestPinFailed { outcome: 'answer_failed', error_code: 'REQUEST_NOT_PENDING' }`, **no** `pin_use_failed`; with `in_person` the same race raises `pin_use_failed` on a match); `[01d BF-2]` `onPrepareFailed` forced to throw → both PINs get the `prepare` error, never `500`. **Review Focus 2:** the iff payload cases → `400` from payload Zod, argon2 spy 0, nothing counted, the response body does not contain the sent PIN string; `[01d §3.3 rule 2]` `in_person` from a device other than `raised_device_id` → `403 in_person_elsewhere` from `preRead`, spy 0 (also in #55, task 34); `[01d §6.2]` the device lockout subject for `in_person` is this (= the raising) device.
- [ ] **Step 2:** FAIL → **Step 3:** implement `pinCheck`, `pinHooks.onMismatch`, `pinHooks.onPrepareFailed` (BF-1: no `pin_use_failed` when `method === 'pin'` and the error is `REQUEST_NOT_PENDING`) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 23 AnswerRequest with PIN and in person, counted failures, pin_use_failed [spec §6.2, §3.3 rules 2–4, §3.10, BF-1, BF-2; tests #11, #44, #54, #56, #60, #66]`

### Task 24: Personal notices and `hidden_from` — RISK: HIGH

**Spec:** §3.3 rule 7 and "Cheating … detected", §3.10 rows `approval_receipt`, `answered_on_requester_device`, "Personal notices", "Hidden from the answering seat", §6.2 (8a), (9).

**Files:** Modify `apps/hub/src/alerts/kinds.ts` (two kinds as §3.10: `approval_receipt` `silent: true`, `details` copied from the request; `answered_on_requester_device` audible; both personal, `dedupe_key` per §3.10), `commands/answer-request.ts`; Test `apps/hub/test/alerts/personal-notices.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #12]` exactly §10; `[01d §3.10]` a money answer by `session` is impossible (`422`), by `pin` from Imran's own tablet → `approval_receipt` only, `on_requester_device: false`, `hidden_from = { session_id, device_id }` of that session; an answer on the raising device (any method) → `RequestAnswered.on_requester_device = true` and `answered_on_requester_device` too; an accept kind answered on the raising device → the notice, no receipt; the three raises in one `AnswerRequest` reuse the fixed reads (statement count = one raise + 2 × (R + T)); no "for Imran" row when Imran has no route; both notices stay open after `BusinessDayClosed` and their `hidden_device_id` is cleared.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 24 approval_receipt, answered_on_requester_device, hidden from the answering seat [spec §3.3 rule 7, §3.10; tests #12]`

### Task 25: `WithdrawRequest` — RISK: NORMAL

**Spec:** §6.3, §3.3 "Withdraw".

**Files:** Create `apps/hub/src/alerts/commands/withdraw-request.ts`, `apps/hub/test/alerts/withdraw-request.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #13]` exactly §10; `[01d §6.3]` 1 statement; `onWithdraw` on the read-only view and its drafts' `alert_id` checked; `alert_closed` to every recipient of every step; a deduped raiser who is not the requester → `403 not_requester`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 25 WithdrawRequest [spec §6.3; tests #13]`

---

## Batch 6 — Seen and the tick (§11 steps 7, 8)

### Task 26: `MarkAlertsSeen` — RISK: HIGH

**Spec:** §6.4, §3.5 `closes_on: 'seen'` and the answering-seat exception, §3.6 `RequestSeen`, `alert_seen`, "Seen is a full command", §3.4.3 "for" rows.

**Files:** Create `apps/hub/src/alerts/commands/mark-alerts-seen.ts`, `apps/hub/test/alerts/mark-alerts-seen.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #16]` exactly §10; `[01d #33]` exactly §10 (all three listed commands now exist); `[01d §6.4]` 1 read statement for 50 ids; an open request I may answer now but have no inbox row for → `RequestSeen` + inbox row; a `seen` from `hidden_session_id`, or from another session on `hidden_device_id` the same day → `AlertSeen` buffered, notice not closed, the id still in `seen`; after `BusinessDayClosed`, a new session on that device closes it; the original session never does; a lead's seen of a "for Ali" card is accepted and closes nothing for Ali; a rolled-back call buffers no `AlertSeen` (`tx.onCommit`); `alert_seen` frame sent after commit only for a first `RequestSeen`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 26 MarkAlertsSeen, RequestSeen, answering-seat rule [spec §6.4, §3.5, §3.6; tests #16, #33]`

### Task 27: Tick loop and `registerTick` — RISK: HIGH

**Spec:** §3.5 "The tick" loop, "Idle cost", "Isolation", §4.2 `registerTick`, A8, 00 H-8 timers row.

**Files:** Create `apps/hub/src/alerts/tick.ts` (loop and registry; the `alerts` tick registered first, its `due` = the §3.5 statement, `intents` = a stub returning `[]` until task 28), `apps/hub/test/alerts/tick-loop.int.test.ts`; Modify `alerts/index.ts`, `apps/hub/src/lib/boot.ts` (start after step 7, stop on close).

- [ ] **Step 1: Tests:** `[01d #22]`, `[01d #37]` exactly §10; `[01d §3.5]` one `now = branchNow()` per pass given to every tick; `testHooks.betweenDueAndRun(name)` called between `due` and `writer.run`; a throwing `due` is logged `{ tick, error }` and the next tick still runs; the loop does not start before boot step 7 (boot test asserts order).
- [ ] **Step 2:** FAIL → **Step 3:** implement (`setInterval` 500 ms, `unref`) → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 27 hub tick loop and registerTick [spec §3.5, §4.2, A8; tests #22, #37]`

### Task 28: Alerts tick: steps, skips, restart, race — RISK: HIGH

**Spec:** §3.5 `alerts.intents` (inside-lock select, `LIMIT 200`, latest step, `StepSkipped 'superseded'`), "Race rule", "Restart / tick lag", "Failed send", §3.4 step targets, §4.3 To 03a (`raiseMany(tickCtx)`).

**Files:** Modify `apps/hub/src/alerts/tick.ts`; Test `apps/hub/test/alerts/tick-steps.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #4]`, `[01d #19]`, `[01d #21]`, `[01d #25]`, `[01d #34]`, `[01d #50]` exactly §10 (#4 runs through the tick with a test clock: steps 1 and 2 both due → step 2 sent, `StepSkipped { step: 1, reason: 'superseded' }`; `{ value: 'window_ms', times: 2 }`); `[01d §3.5]` the select runs inside `writer.run` (a spy proves `due` and `intents` read on both sides of `BEGIN IMMEDIATE`); a stale hint (alert closed between `due` and `run`) → the transaction appends nothing; after commit `sendStepFrames` and registered route `send` run once per step event.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 28 alerts tick steps, superseded skips, restart and answer race [spec §3.5, §3.4; tests #4, #19, #21, #25, #34, #50]`

### Task 29: Alerts tick: expiry and day close — RISK: HIGH

**Spec:** §3.5 `after_ms` expiry, "Day close", `expire_due`, §3.3 "No expiry for requests", "Requests no one can answer".

**Files:** Modify `apps/hub/src/alerts/tick.ts`; Test `apps/hub/test/alerts/tick-expiry.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #24]`, `[01d #36]`, `[01d #51]` exactly §10. **Review Focus 1:** 250 open `t_info` alerts at `BusinessDayClosed` → pass 1 closes 200 `expired`, pass 2 the other 50, no id closed twice, the next pre-check is false. `[01d §3.5]` a kind with `after_ms` and a step after the expiry time → closed, never stepped.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 29 alerts tick expiry and day close [spec §3.5, §3.3; tests #24, #36, #51]`

### Task 30: Statement bounds and timed tick — RISK: HIGH

**Spec:** §3.5 "Reads per tick", "Projection reads", "Several raises", §7 Performance, 00 #79 style.

**Files:** Create `apps/hub/test/alerts/bounds.int.test.ts`, `apps/hub/test/alerts/timed-tick.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #35]` exactly §10 (a)–(d), with the activity read (9) included and the fake pager route / fake `tableOwner`; a variant of `fakePager` doing one statement per person fails (a) (asserted as an expected failure of the bound helper). `[01d #58]` timed: 200 due alerts, 10 sockets → tick `writer.run` ≤ 50 ms; one raise ≤ 5 ms (median of 20); `it.skipIf(process.env.POS_PILOT_HW !== '1')`, as 00 #79.
- [ ] **Step 2:** run → fix any bound that fails in the code of tasks 14–29 (each fix is part of this commit and named in the checkpoint) → **Step 3:** PASS (58 skipped here).
- [ ] **Commit:** `test(01d): task 30 statement bounds and timed tick [spec §3.5, §7; tests #35, #58]`

---

## Batch 7 — Warnings, alert mode, test alert, queries (§11 steps 10, 11, 13)

### Task 31: `no_approver` and BF-7 — RISK: HIGH

**Spec:** §3.9, §3.10 `no_approver` row, §3.5 flag pass and m1, §5.2 `alert_flags`, BF-7 / P-7.

**Files:** Modify `apps/hub/src/alerts/kinds.ts` (`no_approver`), `tick.ts` (flag pass); Test `apps/hub/test/alerts/no-approver.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #32]` exactly §10; `[01d #59 hub]` the hub parts of §10 #59: m1 (one `AlertClosed 'expired'`, no `'done'`), m2 (re-run of the phone case on the full stack), m4 (4409 log on the full stack), v0.5 #5 and m15 startup errors, m8 dedupe across kinds; `[01d BF-7]` Ali removed from `staff` with an open `approval_receipt` → the next tick closes it `obsolete`; a person moved to `no_pin_staff` likewise; `[01d §3.9]` for `approve-void` (range permission) only branch-scope holders count; the requester alone being the only approver does not count as "no approver" (deferred per-request warning, §12.4).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 31 no_approver warning, personal notices of removed staff [spec §3.9, §3.10, BF-7; tests #32, #59]`

### Task 32: Alert-mode delivery, `alerts_open`, binding header — RISK: HIGH

**Spec:** §3.7 "Reconnect", "Revoke / rotation", header, §3.4.3 (a)–(c), §6 batch 3 `alerts_open`, BF-5 / P-6.

**Files:** Create `apps/hub/src/alerts/alert-sockets.ts`, `apps/hub/test/alerts/alert-mode-delivery.int.test.ts`; Modify `alerts/index.ts` (`ws.setAlertsOpen`).

- [ ] **Step 1: Tests:** `[01d #26]`, `[01d #28]`, `[01d #64]`, `[01d #65]` exactly §10, #65 extended by BF-3 (a signed-out kiosk's receipt has `staff_id = ''`); `[01d §3.7]` `alerts_open` ≤ 3 statements, never `card` / `details`, never a hidden alert; `[01d BF-5]` `alerts_open.binding_route_until` = Ali's last activity + 2 h for a bound tablet, `null` for a kiosk; a sign-in elsewhere that moves the deadline sends `{ type: 'binding_route', until }` to T on the next tick that routes to T, and only when it changed.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 32 alert-mode delivery, alerts_open, binding_route_until [spec §3.7, §6 batch 3, BF-5; tests #26, #28, #64, #65]`

### Task 33: `test_alert` and `SendTestAlert` — RISK: NORMAL

**Spec:** §6.5, §3.10 `test_alert`, §3.5 `after_ms`.

**Files:** Modify `kinds.ts` (`test_alert`); Create `apps/hub/src/alerts/commands/send-test-alert.ts`, `apps/hub/test/alerts/send-test-alert.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #17]`, `[01d #52]` exactly §10. **Review Focus 5:** a team whose lead has no reports → `200`, `AttemptSent.recipients = []`; a paired device that is offline → `200`, the device in `recipients`, no route; a revoked device → `404 DEVICE_NOT_FOUND`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 33 test_alert and SendTestAlert [spec §6.5, §3.10; tests #17, #52]`

### Task 34: `alerts-inbox` and the `alerts` catch-up part — RISK: HIGH

**Spec:** §6.7, §6 batch 3 catch-up part, §3.10 hiding, §6.9 (may-answer rows in catch-up), H-7.

**Files:** Create `apps/hub/src/alerts/queries/alerts-inbox.ts`, `apps/hub/src/alerts/catch-up.ts` (part `alerts`), `apps/hub/test/alerts/inbox-catch-up.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #39]`, `[01d #42]`, `[01d #43]`, `[01d #55]` exactly §10 (#55 in full: in person on the raising tablet, in person from tablet B → `403`, sign-in as Imran on the kiosk + `pin`, sign-in as Imran on Hamza's tablet + `pin` with no frame / catch-up / inbox row there and a seen that closes nothing, day close ends the device hiding but not the session's, Imran's own tablet sees and closes both, Imran off with no route → no "for" copy; the client sound part of #55 is task 39's `silent` test); `[01d §6.7]` open personal notices of earlier days listed; hidden rows absent for that session and device; 2 statements.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 34 alerts-inbox and alerts catch-up part [spec §6.7, §6 batch 3, §3.10; tests #39, #42, #43, #55]`

### Task 35: `my-requests` and `requests-to-answer` — RISK: NORMAL

**Spec:** §6.8, §6.9, §6 batch 3 `alert_closed` to may-answer sockets, BF-4 (field).

**Files:** Create `apps/hub/src/alerts/queries/{my-requests,requests-to-answer}.ts`, `apps/hub/test/alerts/request-queries.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #10]`, `[01d #41]`, `[01d #53]`, `[01d #61 hub]` exactly §10 (hub parts of #61: list, catch-up row, `RequestSeen` + inbox row, `alert_closed` to the manager); `[01d BF-4]` each catch-up and `requests-to-answer` row carries `raised_at` and `from_business_day: string | null` (the business date when raised before the current day's `opened_at`, else `null`), so the client can skip re-notify (task 39); `[01d §6.9]` 2 statements; `[01d §6.8]` 1 statement, `ask_in_person` true at `step ≥ 2`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- **Note:** `from_business_day` is an additive response field → proposed AD row with BF-4.
- [ ] **Commit:** `feat(01d): task 35 my-requests and requests-to-answer [spec §6.8, §6.9, BF-4; tests #10, #41, #53, #61]`

---

## Batch 8 — Receipt view, presence, retention (§11 steps 4, 13, 15)

### Task 36: `alert-receipts` — RISK: NORMAL

**Spec:** §6.10, §3.4.3 residual (bound-not-signed-in text), §3.4.3 "Owner: no route".

**Files:** Create `apps/hub/src/alerts/queries/alert-receipts.ts`, `apps/hub/test/alerts/alert-receipts.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #46]`, `[01d #57 hub]` (all of §10 #57 except (vi)), `[01d #62]` exactly §10; 4 statements; step events read from `raised_seq` only.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 36 alert-receipts [spec §6.10, §3.4.3; tests #46, #57, #62]`

### Task 37: `SetPresence` — RISK: NORMAL

**Spec:** §6.6, §3.11.

**Files:** Create `apps/hub/src/alerts/commands/set-presence.ts`, `apps/hub/test/alerts/set-presence.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #45]` exactly §10; 1 statement; `PresenceSet` makes the routing of the next raise treat the person absent (end-to-end with task 17).
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 37 SetPresence [spec §6.6, §3.11; tests #45]`

### Task 38: Retention — RISK: HIGH

**Spec:** §5.1 Retention, 00 M66, H-8.

**Files:** Create `apps/hub/src/alerts/retention.ts`; Modify `apps/hub/src/auth/session-sweeper.ts` (`purge` runs the 01d batches after 00's); Test `apps/hub/test/alerts/retention.int.test.ts`.

- [ ] **Step 1: Tests:** `[01d #38]` exactly §10, with 1 200 closed alerts (3 batches); step 1 deletes inbox / receipts / seen rows of alerts closed before the previous business day only; open alerts and their rows untouched; a personal notice open for 10 days is kept; one `writer.run` per batch; no event written.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Commit:** `feat(01d): task 38 alert retention [spec §5.1; tests #38]`

---

## Batch 9 — Client (§11 step 16) — BLOCKED-G1 until the developer answers gap G1

Tasks 39–42 can start once G1 confirms (or replaces) P-9; task 43 needs G1's Capacitor answer. All **UI**: implementer may be sonnet; reviewer opus.

### Task 39: Client alert store, re-notify, sounds, labels — RISK: NORMAL — UI

**Spec:** §8.1 (silent kind, re-notify once, BF-4), §8.3, §3.12, §9 client messages.

**Files:** Create `apps/client/src/features/alerts/{store.ts,sounds.ts,labels.ts}` and tests; Modify `apps/client/src/i18n/{en,ur}.ts` (keys `alert.<kind>.card|lock` for the six kinds, the §8.1 error texts, header texts).

- [ ] **Step 1: Tests:** `[01d #59 client]` (m6) a lost `alert` frame then a reconnect row not in the shown set and not `seen_by_me` → re-notified once; `[01d #61 client]` (BF-4) a row with `from_business_day` → listed, no sound, label "from <date>"; `[01d §8.3]` urgent: repeat every 10 s until `alert_seen`, then one reminder per 2 min; not seen by the escalation step → 2-min reminder with one volume step-up; always-on screens one sound per step; at most five sounds; `[01d §8.1]` `approval_receipt` (silent) → no sound, no banner, badge only, never re-notified; every key exists in EN and UR (existing i18n test).
- [ ] **Step 2–4:** FAIL → implement (pure; timers injected) → PASS.
- [ ] **Commit:** `feat(01d): task 39 client alert store, sounds, labels [spec §8.1, §8.3, §3.12; tests #59, #61]`

### Task 40: Client alert transport, online-only PIN commands — RISK: NORMAL — UI

**Spec:** §8.1 (alert mode on kiosk / phone pages, never on the tablet page), H-10, §3.7.

**Files:** Create `apps/client/src/features/alerts/{socket.ts,answer.ts}` and tests.

- [ ] **Step 1: Tests:** `[01d #56 client]` with the socket down the PIN pad is disabled and `answer()` writes nothing to IndexedDB / `localStorage` and sends no request; on a network error the PIN is dropped from memory; `[01d §8.1]` device type `tablet` never sends an alert-mode `auth`; `cashier_kiosk` / `phone` open alert mode with no session and close it on sign-in; `receipt delivered` sent once per `(alert_id, step)` shown.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Commit:** `feat(01d): task 40 client alert transport, online-only PIN answers [spec §8.1, H-10; tests #56]`

### Task 41: Client alert pages — RISK: NORMAL — UI

**Spec:** §8.1 (banner, inbox, request detail, informed read-only, in-person only on the raising device, requester waiting card, errors), §3.12 `card` with `details`, §6.5 / §6.10 (manager's test alert and receipt view, DoD).

**Files:** Create the entry `apps/client/staff/index.html` (vite mode `staff`, P-9) and `apps/client/src/features/alerts/{Banner,Inbox,RequestDetail,InPerson,MyRequests,TestAlert,Receipts}.tsx` and tests; Modify `apps/client/vite.config.ts`, `package.json` `build` script (add `--mode staff`), `apps/client/test/build-output.test.ts`.

- [ ] **Step 1: Tests:** Approve / Reject with PIN pad on a money kind, one tap on accept; informed → read-only "Find <approver> or a manager"; "Approve here" shown only when this device is `raised_device_id`; each §8.1 error maps to its text; "Waiting 2 min — ask in person" when `ask_in_person`, "No approver reachable — ask in person" after the shortcut; `TestAlert` sends person / team / device and opens the receipt view; build output contains `staff/index.html`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Commit:** `feat(01d): task 41 client alert pages [spec §8.1, §3.12, §6.5, §6.10]`

### Task 42: Tablet header — RISK: NORMAL — UI

**Spec:** §3.7 header, §8.1 header line, BF-5.

**Files:** Create `apps/client/src/features/alerts/BindingHeader.tsx` and test.

- [ ] **Step 1: Tests:** `[01d #57 client]` (vi) "Alerts: Ali — pauses at 14:05" from `binding_route_until`, then "Alerts paused" with one `info` chime when it passes, "Alerts: none" with no binding; a `binding_route` frame with a later `until` moves the time (BF-5); a sign-in refreshes it.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Commit:** `feat(01d): task 42 tablet alert header [spec §3.7, BF-5; tests #57]`

### Task 43: Tablet app shell, background service, app update client — RISK: NORMAL — UI

**Spec:** §8.2, §8.4, F-3, README R33.

**Files (per G1's answer; proposed):** Create `apps/tablet/` (Capacitor Android project over the bundled `staff` entry), a native plugin `AlertService` (Android foreground service holding the alert-mode WS, notifications with `lock` text, `receipt delivered`, backoff ≤ 5 s), `apps/client/src/features/alerts/service-bridge.ts` (page ↔ service `(alert_id, step)` handshake, 1 s hold) and its test, `apps/client/src/features/alerts/app-update.ts` and test.

- [ ] **Step 1: Tests:** `[01d #63]` exactly §10, on `service-bridge.ts` with a fake plugin; `[01d §8.4]` `latest` checked after reconnect and hourly, install only when no session / day closed / maintenance hour, `sha256` checked before install, never when `version_code` ≤ own.
- [ ] **Step 2–4:** FAIL → implement → PASS. The native service is built with Gradle outside the gate; the controller records the build command and APK hash in the checkpoint.
- [ ] **Commit:** `feat(01d): task 43 tablet app shell, alert service, app update client [spec §8.2, §8.4; tests #63]`

---

## Batch 10 — Gate, manual checks, review, as-built (§12)

### Task 44: Full gate, coverage, manual checks — Manual

**Spec:** §12.1, §12.2, §10.10.

- [ ] **Step 1:** Controller: the gate on a clean checkout of `module-01d` (fresh `pnpm install`, Postgres up), recorded in `01d-status.md` (files, tests, wall time).
- [ ] **Step 2:** Coverage script: every `[01d #N]` for N in 1–66 appears in exactly one `it()` (#56, #57, #59, #61 as `hub` + `client`), none missing; every §12.2 checklist row's tests present and green; `grep -rn "Date.now\|Math.random" apps/hub/src/alerts` empty; no role name in `apps/hub/src/alerts` (R5).
- [ ] **Step 3:** Write `docs/plans/01d-manual-checks.md` and run it with the developer on pilot hardware (results recorded there; the task is not done until they are in):
  1. **Tablet alert with the screen off:** a session-less tablet bound to Ali, screen off → a `test_alert` to Ali from a manager's tablet gives an Android notification with the `lock` text and sound; `alert-receipts` shows delivered, then seen after Ali opens it (DoD §12.1).
  2. **Alert mode after the session idles out:** Waiter signed in on a tablet, idle past 5 min (session ends `idle_timeout`) → an `action` alert to the waiter still rings on that tablet; 2 h after the last activity it goes "for" the lead and the header says "Alerts paused".
  3. **`test_alert` to a person, a team and a device:** each reaches the expected devices; receipts list per person and device; an offline device shows no delivery.
  4. **PIN lockout on answers:** five wrong in-person PINs for one approver on a `t_approval` request (test build) → `429 PIN_LOCKED_OUT`; ten wrong from one device in 5 min → `429 DEVICE_LOCKED_OUT`; the lockout shows in the hub admin lockouts page; a correct PIN whose answer races (another manager approves first) leaves a `pin_use_failed` card for the PIN owner on another device.
  5. **#58 timed tick** on the pilot mini PC: `POS_PILOT_HW=1 pnpm vitest run apps/hub/test/alerts/timed-tick.int.test.ts` → pass (≤ 50 ms tick, ≤ 5 ms raise).
  6. **APK staged update:** `app-release add --stage T1`, T1 installs, T2 does not; `mark-good`, T2 installs in a window of §8.4.
- [ ] **Commit:** `docs(01d): task 44 gate, coverage and manual checks [spec §12.1, §12.2]`

### Task 45: Final review and as-built spec

**Spec:** §12.1 DoD, §12.6, CLAUDE.md pipeline step 8.

- [ ] **Step 1:** Fresh opus reviewer on the whole branch (`main..module-01d`) against the spec, this plan, the C-00 / C-01b rows and every AD-n: checks the §12.2 checklist, each BF-1–BF-8 with its test, each HIGH task's invariants (R1 counter delta and transaction count, R2 hiding, inside-lock select, statement bounds). Findings fixed one commit each, each with implementer + fresh reviewer.
- [ ] **Step 2:** As-built spec `docs/specs/01d_Notifications_Requests_Spec_v1.1.md`: AD rows for BF-1–BF-8 (as built), P-6, P-7, P-8, BF-4's `from_business_day`, every other AD-n; README module map row 01d → v1.1 "Implemented"; reviewed by a fresh opus reviewer. Any AD that changes a contract another module reads needs the developer's approval before the bump.
- [ ] **Step 3:** Stop for the developer: merge `module-01d` to `main` only after the developer approves the as-built spec and the manual checks of task 44 are recorded.
- [ ] **Commit:** `docs(01d): v1.0 → v1.1 as built, AD rows, BF-1–BF-8 [spec §12.6]`

---

## Spec gaps found while planning

| # | Gap | Plan's choice (to confirm before the named task) |
|---|---|---|
| G1 | **No staff client, kiosk page or Capacitor tablet app exists in the repo** (`apps/client` has only the `owner` and `admin-stock` entries; no WS client; no `@capacitor/*` dependency, no Android project). §8.1–§8.4 and §11 step 16 assume "the bundled Capacitor tablet app" with a native background service; adding it is new dependencies and native Android code outside the Vitest gate | P-9: a hub-served `staff` entry for pages (tasks 39–42); Capacitor + a native `AlertService` plugin in `apps/tablet/` (task 43). Batch 9 waits for the developer's go-ahead on dependencies and on where the staff pages live |
| G2 | **No device command queue exists yet** (Android SQLite / IndexedDB queue is E5, 02). H-10 "never queued" has nothing to guard today | The answer sender is online-only by construction; #56 client asserts no storage write and no request while offline. 02 must keep it when it builds the queue (carried note in the checkpoint) |
| G3 | **BF-7 needs a trigger, `alert_flags` allows only `'no_approver'`** (§5.1 CHECK) | P-7: reuse the `no_approver` flag (already set by `StaffDirectoryApplied`); no schema change; proposed AD |
| G4 | **BF-5 names no frame** ("a small frame") | P-6: `alerts_open.binding_route_until` + `{ type: 'binding_route', until }`; proposed AD (extends H-2) |
| G5 | **BF-4 needs a "raised in an earlier business day" fact the rows do not carry** | Task 35: additive `from_business_day` on catch-up and `requests-to-answer` rows; proposed AD |
| G6 | **Unknown kind on replay** (a kind removed after a rollback) is not covered | P-8: keep the row, `next_due_at NULL`, log, boot continues; proposed AD |
| G7 | **No UI for `SetPresence`** is specified (§3.11: the shift-start screen is 01e's) | Command and projection only in 01d; no page |
| G8 | **§11 order vs. "00 / 01b first"**: §11 puts 01b (step 12) and H-5 (step 14) after 01d code, but targets need `noPinStaff` (test 1) | P-1: moved to batches 2–3 |
| G9 | **Test 58 needs the pilot mini PC** (as 00 #79, still open) | Skipped off hardware; run in task 44 |

## Self-review notes

- Spec coverage: every §6 endpoint, frame, export (§6.11: 5 commands, 4 queries, 5 frames, 1 catch-up part, 13 exports) and §12.2 row maps to a task; C-00 H-1–H-5, H-7–H-9, H-12–H-14 to tasks 3–9, 12 (H-6, H-10, H-11 are text-only / client: H-10 in task 40); C-01b B-1, B-3, B-5, B-6 to tasks 10–11 (B-2 moved to 01e, B-4 text only).
- Every §10 test 1–66 is in the Coverage table once; BF-1–BF-8 each have a task and a test.
