# 01b Staff and Roles — Implementation Plan (spec v1.0)

**Spec v1.0 APPROVED (2026-10-27). Build in task order.**

> **For the implementer (Cursor, no plugins):** follow `.cursor/rules/pos.mdc`. Do **one task per request**, in order. Each task: write the listed tests first, run them and see them fail for the stated reason, implement, run the task command and then `pnpm test`, check **Done when**, commit. Steps use checkboxes (`- [ ]`); do **not** tick them in this file (it is read-only for you). Tasks marked **Claude only** edit `docs/`, `.cursor/` or the foundation, or need a Claude plugin: **skip them and tell the user**. A task's **Done when** list is the gate for its commit.

**Goal:** Build module 01b: cloud staff, role, PIN, team and stock-counting admin with admin guards and optimistic concurrency; owner change password, support reset and link CLIs, and a JWT guard that reads the owner row; the staff directory v2 (additive) and its hub side (scopes, approver lists, leads, floors, responsibilities); the `my_stations` scope on the 01a stock page; branch rename and settings; the owner app views.

**Architecture:** Every staff, role and responsibility write runs the **directory write script** (01b §6): tenant row `FOR NO KEY UPDATE` first, the owner-row coverage check, target rows `FOR UPDATE`, `expected_version` against one shared version builder, admin guards before and after, `config_audit`, `directory_version + 1`. The directory travels in 01a's config poll in an additive v2 shape that v1.4 hubs still parse. Owner tokens carry `cv` (credential version); the JWT guard reads the owner row on every request; login, refresh, change-password and reset lock the owner row `FOR NO KEY UPDATE` first.

**Tech stack:** the existing 00 / 01a stack; no new dependency anywhere (Global Constraints).

**Spec:** `docs/specs/01b_Staff_Roles_Spec_v1.0.md` (cited "§x", "Bn", "D-n", "J-n", tests "#n"); changes to 00 and 01a land through 01b §4.3 / §4.4 rows, already applied to `docs/specs/00_Hub_Platform_Access_Spec_v1.5.md` ("00 §x") and `docs/specs/01_Restaurant_Setup_Spec_v1.3.md` ("01a §x"); foundation `docs/specs/00_Foundation_Spec_v1.7.md` ("F §x"). **Read the cited spec section before each task**; the plan does not repeat the spec's tables or SQL.

**Starting point:** modules 00 and 01a are built (`docs/plans/00-plan.md`, `docs/plans/01a-plan.md` finished). Reuse, do not recreate: cloud `withIdempotency`, `inTransaction` (`lib/idempotency.ts`), `writeConfigAudit` (`lib/config-audit.ts`), `bumpConfigVersion`, `coversEveryBranch` (`lib/config-version.ts`), `TenantScopedRepository`, `TenantLevelRepository`, `registerTenantScope`, `loadDirectory` (`modules/hub-registration/repository.ts`), `SystemContext`, `seedTenant`, `issueRegistrationCode`, `migrate`; cloud test helpers `createTestCloud`, `truncateAll`, `restaurantFixture`, `owner`, `pgCounter`, `ROUTE_CASES` (`test/cross-tenant.int.test.ts`); hub `applyStaffDirectory`, `StaffDirectory`, `defineCommand`, `defineQuery`, `writer.run`; hub test helpers `createTestHub`, `seedDirectory`, `aDirectory`, `pairDevice`, `openSession`, `statementCounter`, `stub-config-cloud.ts`; client `api/cloud-admin.ts`, `app/router.ts`, `app/ui-kit.ts`, `app/ulid.ts`, `i18n/{en,ur}.ts`, `components/`.

**WIP to compare against:** `git stash list` → `01b-step1-wip` holds a draft of tasks 1–3's test file (`apps/cloud/test/db/staff-roles-migration.int.test.ts`, written before this plan; never run). The executor of tasks 1–3 may read it (`git stash show -p --include-untracked stash^{/01b-step1-wip}`) but writes tasks 1–3 to this plan.

## Progress

| Task | Commit |
|---|---|
| — | — |

## Markers

| Marker | Meaning |
|---|---|
| **Claude only** | Edits `docs/`, `.cursor/` or the foundation, or needs a Claude plugin (Playwright via `webapp-testing`). Cursor skips it and tells the user. |
| **needs Docker Postgres** | The task's own command needs Postgres. Every `pnpm test` runs the cloud suite, so keep `docker compose up -d postgres` running for **every** task. |
| **needs hardware** | Needs the pilot mini PC or the three branch hubs. Only task 61. |
| **STOP** | Do not start the next task until the user confirms. |

## Global Constraints

Every task implicitly includes these. Values copied from spec v1.0.

- **Dependencies:** none new in any `package.json` (01b §7, 01a S35 g closed list). Version hashes use `sha256hex` / `canonicalJson` from `@pos/domain/hash`; the support number uses Vite's built-in `import.meta.env` (J-13). Playwright is used only by the Claude-only tasks 59–60 through its plugin, never added to the repo.
- **Spec-first:** if code and spec disagree, stop and report; never diverge silently (CLAUDE.md).
- **Determinism (F §6.7):** no `Date.now()`, `Math.random()`, `ulid()`, `crypto.randomUUID()` in hub, cloud or package `src/`; use the injected `Clock`, `IdGen`, `SecretGen`. Browser code (`apps/client/src/**`) may read the clock, never `crypto.randomUUID`.
- **Envelope and errors (F §6.1, §6.2):** `{ data }` / `{ error: { code, message, details, request_id } }`; only catalogue codes, `throw new DomainError(code, details)`. 01b's new codes (§9): `ROLE_NOT_FOUND 404`, `STAFF_NAME_TAKEN 409`, `LAST_ADMIN_REQUIRED 409`, `OWN_ADMIN_ACCESS 409`, `STAFF_LINKED_TO_OWNER 409`, `CONFIG_STALE 409`, `PASSWORD_INVALID 401`, `PASSWORD_UNCHANGED 422`, `PASSWORD_CHANGE_REQUIRED 403`. `CONFIG_REFERENCE_INVALID` reasons: `archived`, `not_found`, `role_archived`, `wrong_branch`, `not_at_branch`, `loop`, `one_lead_per_branch`, `scope_not_allowed`. `PERMISSION_DENIED` reasons: `tenant_wide_write`, `outside_scope`. A failed JWT guard read is `503 SERVICE_UNAVAILABLE`, never `401` (J-1).
- **No role names in code (R5, §3.8):** never compare a role's name; look up by `role_id`, or by `default_key` in seeds and migrations. Only `default-roles.ts`, `0003_manage_stock_backfill.sql` and `0005_staff_roles.sql` contain default role names (test 55).
- **Owner (B8):** one owner per tenant; every 01b write checks `coversEveryBranch` at write time → `403 PERMISSION_DENIED { reason: 'tenant_wide_write' }`; no `can_edit`, no `can_edit_roles`, no `staff_outside_branches`.
- **Directory write script (§6):** Zod → `BEGIN` → [creating `POST`: idempotency key, 01a S7] → `SELECT … FROM tenants WHERE tenant_id = $1 FOR NO KEY UPDATE` → owner row (`allowed_branch_ids`, `staff_id`) + B8 → targets `FOR UPDATE` in id order (`404` if absent) → [`PATCH`/`PUT`: `expected_version` vs stored → `409 CONFIG_STALE`] → guards before → rules on the **merged** row, references read unlocked → write → guards after → `writeConfigAudit` (wire without `pin_hash`, `version`, `staff_count`) → `UPDATE tenants SET directory_version = directory_version + 1` → [store response on key] → `COMMIT`. A no-op writes nothing and answers `200`; the version check runs first. Every response carries the target's new `version` and `changed_versions` (§6, J-5).
- **Versions (B23, §5.3):** built only in `apps/cloud/src/modules/staff-roles/versions.ts`; exact input keys per entity; arrays sorted by JS `<`; every key present, nullable `null`, empty `[]`; `INT`/`BIGINT` through `Number()` in the repository; `version = sha256hex(canonicalJson(input))`.
- **Owner auth (B5, §6.13):** owner row locked `FOR NO KEY UPDATE` before any token row by login, refresh, change-password and reset; `credential_version` + 1 on every change and reset; JWT claim `cv` (missing = 0); refresh-token row `credential_version`; equality checks only; no `iat_ms`, no `pwc`.
- **Fixed values:** PIN `/^\d{4,6}$/` (ASCII), duplicates allowed (00 M27); argon2id `m=19456, t=2, p=1` (00 M8); staff and role names 1–40, branch names 1–60, trimmed, unique case-insensitive (staff: among active staff per branch, B12; roles: among active roles; branches: per tenant); idle 1–240 minutes, stored `session_idle_ttl_ms`, whole minutes; day settings `day_stale_after_hours` 1–48, `day_min_gap_hours` 0–12, stale > gap; new password 10–200, ≠ current; account lock 10 failures in 900 000 ms for 900 000 ms; per-IP 30 failures / 900 000 ms; temporary password 4 groups of 4 Crockford base32 chars, valid 86 400 000 ms; access token 1 h; refresh 30 d, grace 30 000 ms (M49); scopes `branch | own_tables | my_floors | my_team | my_stations` with `PERMISSION_SCOPES` as §3.3; `default_key ∈ owner | manager | cashier | order_taker | waiter | cook`; default roles and idles §6.15 (Owner 60, Manager 60, Cashier 15, Order taker 15, Waiter 5, Cook 5); `CONFIG_POLL_INTERVAL_MS = 60_000`, `hub_stale_after_ms = 3 × CONFIG_POLL_INTERVAL_MS`; cloud `loadDirectory` 8 statements; hub `StaffDirectory.load` 9 statements; staff list 6, roles list 4, team tree 3, responsibilities GET 1, settings GET 1, `GET /v1/admin/branches` 1 statement (guard read not counted).
- **Locks (B11):** directory writes and `issue-registration-code` / `link-owner-staff` take the tenant row `FOR NO KEY UPDATE` first; never an explicit lock on `branches` in a directory write.
- **Cloud SQL (D54):** owner routes query through `TenantScopedRepository` / `TenantLevelRepository`; CLIs through `SystemContext`; `db/credential-lookup.ts` only from `plugins/tenant-scope.ts` and `plugins/owner-credentials.ts` (M55 b).
- **Hub SQL:** `writer.run` only; no `await` inside it; queries never write.
- **Redaction (§7.2):** request body fields `pin`, `current_password`, `new_password` are redacted; `pin_hash` never in a response or audit row.
- **Tests:** names `it('[01b #N] …')`, each N in exactly one test (Coverage table); other tests cite a section `it('[01b §6.4] …')`. Cloud integration `apps/cloud/test/**/*.int.test.ts` (01b routes under `apps/cloud/test/staff-roles/`, auth under `apps/cloud/test/owner-auth/`); hub integration `apps/hub/test/**/*.int.test.ts`; unit `*.test.ts` next to source; client `apps/client/src/**/*.test.tsx`.
- **Cross-tenant and route inventory (D54):** every task that adds a cloud route adds its case to `ROUTE_CASES` in `apps/cloud/test/cross-tenant.int.test.ts` (tenant B's ids, otherwise valid body).
- **Commit:** `feat(01b): task N <title> [spec §x; tests #a, #b]`, only the task's files: `git add <files> && git commit -m "…"`.

## Plan decisions

Choices the spec leaves to the plan. Each is the reading closest to the spec text.

| # | Decision | Where |
|---|---|---|
| P-1 | A numbered test goes in the first task where every part of it can run; the code it covers may be test-driven earlier by section-cited tests (`[01b §6.4] …`). Moved this way: #6 (task 12, not 7), #14 (task 22, not 5), #66 (task 2, CLI part included), #71 (task 56), #79 (task 24), #2 (task 14), #5 (task 25), #82 (task 26), #80, #102, #104 (task 30). Where the user asked for a split, a test's lettered cases may sit in different tasks; the case letter is part of the test name (`[01b #74 a]`): #74 a, b → task 42; c, d, e → task 43 | Coverage table |
| P-2 | Test #24 runs at the schema boundary: the v1.4 `SyncConfigEnvelopeSchema` and `DirectorySchema` are copied verbatim into a test fixture before task 6 changes them, and the cloud-built v2 envelope must parse with them, with each `requires_approval` grant's `approver_role_id` set and the leaver absent. A v1.4 hub's apply code is unchanged 00 code, already covered by 00's tests | task 7 |
| P-3 | A test that spans cloud and hub is two files in one task, because cloud tests cannot import hub code: the cloud half (`apps/cloud/test/…`) carries the number `[01b #N]`, the hub half (`apps/hub/test/…`) is named `[01b #N hub half] …` and feeds the hub the directory shape the cloud half asserts (through `seedDirectory` or `stub-config-cloud.ts`). Applies to #3, #9, #62, #92. #13 and #18 have their hub halves in task 9 (`resolve` union; `ttlFor` of Waiter 5 + Manager 60 = 3 600 000): #13's number sits on the hub half, #18's on the cloud half (task 23) | tasks 9, 13, 17, 23, 33, 49 |
| P-4 | Pages #49–#54 are Playwright flows (pipeline step 9) and need the `webapp-testing` plugin: Claude-only tasks after the build, three flows each | tasks 59, 60 |
| P-5 | The test database has no volume; task 1 starts from a fresh one (`docker compose down && docker compose up -d postgres`) so leftover rows from earlier runs cannot fail `0005` | task 1 |
| P-6 | Task size: at most 4 numbered tests per task, and every race or barrier test in a task of its own or with at most one sibling the user grouped with it (#88 with #47; #43 with #90; #95 with #99). Tests that may pass at once because an earlier task's code already covers them (tasks 3, 18, 20, 40) say how to watch them fail first | all tasks |

## Review Focus

Inputs the spec implies but no numbered test covers. Each has a test in the named task.

1. **Names with spaces or another case at one branch** (`"Ali "` vs `"ali"`): stored trimmed; the second is `409 STAFF_NAME_TAKEN` → task 12.
2. **PINs from an Urdu keyboard** (`"١٢٣٤"`, Arabic-Indic digits) or with spaces: `400 VALIDATION_FAILED`, never stored; `"0123"` is kept with its leading zero and verifies on the hub → task 13.
3. **Urdu names at the limit:** a 40-character Urdu display name passes Zod and the `char_length` CHECK; 41 fails at Zod with `400`, never at the database → task 12.
4. **Owner app open in two tabs, one changes the password:** the other tab's next request gets `401 JWT_INVALID`, its refresh `401 REFRESH_TOKEN_INVALID`, and it lands on sign-in once, with no refresh loop → task 37 (cloud), task 55 (client).
5. **A lead and one of their reports marked as left in two concurrent requests:** the tenant lock serialises them; no one ends up reporting to a person who has left → task 18.

---

## Interfaces (later tasks rely on these exact names)

**Domain (`packages/domain/src/permissions.ts`, task 5):**
```ts
export type Scope = 'branch' | 'own_tables' | 'my_floors' | 'my_team' | 'my_stations';
export const SCOPES: readonly Scope[];
export const PERMISSION_SCOPES: Record<Permission, readonly Scope[]>;            // §3.3 table; others ['branch']
export const PERMISSION_CATALOGUE: readonly { key: Permission; group: 'orders' | 'kitchen' | 'bills' | 'menu_stock' | 'people' | 'reports'; scopes: readonly Scope[] }[];
export const DEFAULT_KEYS: readonly ['owner', 'manager', 'cashier', 'order_taker', 'waiter', 'cook'];
export type DefaultKey = (typeof DEFAULT_KEYS)[number];
```

**Events (task 6):** `packages/events/src/directory.ts` `DirectorySchema` v2 (§4.3.1, additive: grant `{ permission, grant_type, approver_role_id: string | null, approver_role_ids: string[], scope: Scope }`; staff add `lead_staff_id: string | null`, `floor_ids: string[]`; top-level `responsibilities: { responsibility: 'count_stock'; station_id; staff_ids: string[]; role_ids: string[] }[]`); `type DirectoryInput` unchanged name. `StaffDirectoryApplied.v2.ts` with `upcastFromPrevious` = identity; `skipped.kind` adds `'lead' | 'responsibility'`. `packages/events/src/admin/staff.ts`: `StaffWire`, `RoleWire`, `ResponsibilityWire`, `BranchWire`, `TeamNode` (§5.3), `ChangedVersions = { staff: { staff_id; version }[]; roles: { role_id; version }[]; responsibilities: { branch_id; version }[] }`, request schemas `StaffCreateBody`, `StaffPatchBody`, `PinBody`, `RoleCreateBody`, `RolePatchBody`, `ResponsibilitiesPutBody`, `BranchRenameBody`, `BranchSettingsPatchBody`, `ChangePasswordBody`. `packages/events/src/config.ts` (task 33): `export const CONFIG_POLL_INTERVAL_MS = 60_000`.

**Cloud versions (`apps/cloud/src/modules/staff-roles/versions.ts`, task 11):**
```ts
export function toStaffWire(row: StaffRow): Omit<StaffWire, 'version'>;           // sorted arrays, numbers, nulls (§5.3)
export function toRoleWire(row: RoleRow): Omit<RoleWire, 'version'>;
export function toResponsibilitySet(branchId: string, rows: ResponsibilityRow[]): ResponsibilityWire[]; // active stations only
export function staffVersion(wire: Omit<StaffWire, 'version'>): string;           // §5.3 input keys only
export function roleVersion(wire: Omit<RoleWire, 'version'>): string;
export function responsibilitySetVersion(branchId: string, set: ResponsibilityWire[]): string;
export function withVersion<T>(wire: T, version: string): T & { version: string };
```
`StaffRow`, `RoleRow`, `ResponsibilityRow` are the repository's row types in `apps/cloud/src/modules/staff-roles/repository.ts` (task 12), with every `INT`/`BIGINT` already a `number`.

**Cloud directory write (`apps/cloud/src/modules/staff-roles/write.ts`, task 12):**
```ts
export interface DirectoryWriteCtx { client: pg.PoolClient; repo: TenantLevelRepository; tenant: TenantContext; ownerUserId: string; ownerStaffId: string | null; deps: StaffRolesDeps; changed: ChangedVersionsCollector }
export async function directoryWrite<T>(deps: StaffRolesDeps, req: OwnerRequest, o: { idempotent: boolean }, fn: (ctx: DirectoryWriteCtx) => Promise<T>): Promise<T>;  // tenant lock, B8, bump, idempotency
export interface StaffRolesDeps { pool: pg.Pool; clock: Clock; ids: IdGen; log: FastifyBaseLogger; testHooks?: CloudTestHooks }
```
`ChangedVersionsCollector` has `staff(staffId)`, `role(roleId)`, `responsibilities(branchId)` (mark) and `resolve(ctx): Promise<ChangedVersions>` (builds the versions at the end, excluding the target).

**Cloud guards (`apps/cloud/src/modules/staff-roles/guards.ts`, task 19):**
```ts
export async function qualifyingAdmins(db: TenantSql, staffIds?: string[]): Promise<Map<string /*branch_id*/, Set<string /*staff_id*/>>>; // one statement, §3.4
export function runAdminGuards(before: Map<string, Set<string>>, after: Map<string, Set<string>>, ownerStaffId: string | null): void; // throws OWN_ADMIN_ACCESS / LAST_ADMIN_REQUIRED
```

**Cloud owner auth (task 35 onward; `lockOwnerRow` from task 36):** `AccessClaims` gains `cv: number` (`plugins/jwt.ts`; `verify` returns `cv` = claim or 0); `owner_refresh_tokens.credential_version`; `apps/cloud/src/modules/owner-auth/repository.ts` gains `lockOwnerRow(client, tenantId, userId, o?: { passwordHash?: string }): Promise<OwnerAuthRow | null>` (`FOR NO KEY UPDATE`), `OwnerAuthRow = { password_hash; must_change_password; temp_password_expires_at: number | null; credential_version: number; lock_notice_at: number | null; allowed_branch_ids; display_name }`; `db/credential-lookup.ts` gains `ownerGuardRow(pool, tenantId, userId): Promise<{ must_change_password: boolean; credential_version: number } | null>`.

**Cloud test hooks (`apps/cloud/src/server.ts` `CloudTestHooks`, all optional, test-only):** `onVersionCompare?(entity: 'staff' | 'role' | 'responsibility', id: string, version: string): void` (task 30); `afterTenantLock?(): Promise<void>` (task 21: called by `directoryWrite` right after the tenant lock); `guardRead?(): Promise<void>` (task 35: a rejection makes the guard read fail); `afterOwnerRowLock?(path: 'login' | 'refresh' | 'change' | 'reset'): Promise<void>` (task 42). CLIs export their core for tests: `resetOwnerPassword(sys, input, deps, hooks?)` (task 41), `linkOwnerStaff(sys, input: { ownerUserId; staffId; confirmName? }, deps, hooks?: { afterTenantLock?(): Promise<void> })` (task 45).

**Cloud scratch databases (`apps/cloud/test/helpers/scratch-db.ts`, task 1; reused by tasks 2–4):** `scratchDatabaseAt(lastVersion: number): Promise<{ url: string; pool: pg.Pool }>` (creates `pos_test_0005_<pid>_<n>`, migrates `0001`…`lastVersion`), `dropScratchDatabases(): Promise<void>`.

**Hub (`apps/hub/src/auth/staff-directory.ts`, tasks 8–9):** `Resolution` adds `scope?: Scope` and `approver_role_ids` for `requires_approval`; new methods `floorsOf(staffId): string[]`, `leadOf(staffId): string | null`, `teamOf(staffId): string[]`, `stationsOf(staffId, responsibility: 'count_stock'): string[]`, `responsibilityHolders(stationId, responsibility: 'count_stock'): string[]`, `responsibilitiesOf(staffId): string[]` (for the roster).

**Client (`apps/client/src/api/cloud-admin.ts`, task 50):** `listStaff`, `createStaff`, `patchStaff`, `setPin`, `listRoles`, `createRole`, `patchRole`, `getResponsibilities`, `putResponsibilities`, `renameBranch`, `getBranchSettings`, `patchBranchSettings`, `getTeamTree`, `changePassword`, each returning the §6 response `data`; `applyChangedVersions(store, changed: ChangedVersions)` in `apps/client/src/features/owner/versions.ts`.

---

## Coverage table (§10 → task)

| Tests | Task | | Tests | Task |
|---|---|---|---|---|
| 70, 77 | 1 | | 68 | 29 |
| 66 | 2 | | 80, 102, 104 | 30 |
| 89, 106 | 3 | | 47, 88 | 31 |
| 105 | 4 | | 45, 46, 48, 59 | 32 |
| 64 | 6 | | 67, 92 | 33 |
| 21, 24, 83 | 7 | | 86, 93, 94 | 34 |
| 22, 23, 84 | 8 | | 65, 73, 91, 107 | 35 |
| 12, 13, 31, 33 | 9 | | 4 | 36 |
| 19, 36 | 10 | | 42, 81 | 37 |
| 6, 7, 56 | 12 | | 37, 40, 44 | 38 |
| 3, 25, 58 | 13 | | 38, 39 | 39 |
| 2, 8, 87 | 14 | | 43, 90 | 40 |
| 26, 27, 57 | 15 | | 41, 75 | 41 |
| 10, 28, 29, 30 | 16 | | 74 a, 74 b | 42 |
| 9, 101 | 17 | | 74 c, 74 d, 74 e | 43 |
| 69 | 19 | | 98 | 44 |
| 11 | 20 | | 72, 97, 100 | 45 |
| 85 | 21 | | 95, 99 | 46 |
| 14, 15, 60 | 22 | | 20 | 48 |
| 17, 18 | 23 | | 61, 62 | 49 |
| 79 | 24 | | 78 | 54 |
| 1, 5, 16 | 25 | | 71 | 56 |
| 63, 76, 82 | 26 | | 55, 96 | 57 |
| 32, 35, 103 | 27 | | 49, 50, 51 | 59 |
| 34 | 28 | | 52, 53, 54 | 60 |

Every number 1–107 appears exactly once; #74 appears as its lettered cases a–e, each once. Tasks with section-cited tests only, or none: 0, 5, 11, 18, 47, 50, 51, 52, 53, 55, 58, 61.

## Task list (→ spec v1.0 §11 step)

| Task | Title | §11 step | Marker |
|---|---|---|---|
| 0 | Foundation §6.2 codes and implementer rules | — | Claude only |
| 1 | Cloud migration `0005_staff_roles.sql`: schema and backfill | 1 | Docker |
| 2 | Cloud day-setting clamp and `set-branch-settings` ranges | 1 | Docker |
| 3 | Cloud migration aborts loudly | 1 | Docker |
| 4 | Cloud migrations runner refuses a database ahead of the build | 1 | Docker |
| 5 | Domain: scopes, catalogue, default keys, error codes | 2 |  |
| 6 | Events: directory v2, `StaffDirectoryApplied` v2, admin wire schemas | 3 |  |
| 7 | Cloud `loadDirectory` v2 | 4 | Docker |
| 8 | Hub migration `0005_directory_v2.sql`, `applyStaffDirectory` v2 | 5 |  |
| 9 | Hub `StaffDirectory` v2: `resolve` scope and lookups | 5 |  |
| 10 | Hub session and roster queries | 5 |  |
| 11 | Cloud version builder | 6 |  |
| 12 | Cloud directory write script, staff list and create | 6 | Docker |
| 13 | Cloud PIN set | 6 | Docker |
| 14 | Cloud staff PATCH: fields, branches diff, merged row | 6 | Docker |
| 15 | Cloud reports-to rules | 6 | Docker |
| 16 | Cloud leaving, returning and team moves | 6 | Docker |
| 17 | Leaver reaches the hub; linked row cannot leave | 6 | Docker |
| 18 | Concurrent leavers (race) | 6 | Docker |
| 19 | Cloud admin guards on staff writes | 6 | Docker |
| 20 | Concurrent last-admin removal (race) | 6 | Docker |
| 21 | Lock modes: directory write vs menu write (barrier) | 6 | Docker |
| 22 | Cloud roles list and create | 7 | Docker |
| 23 | Cloud roles: owner coverage and idle limits | 7 | Docker |
| 24 | Cloud role PATCH: name, idle, grants, dual write | 7 | Docker |
| 25 | Cloud role archive and restore | 7 | Docker |
| 26 | Cloud admin guards on roles; returning with no role | 7 | Docker |
| 27 | Cloud responsibilities GET / PUT | 8 | Docker |
| 28 | Hub stock scope `my_stations` | 8 |  |
| 29 | Hub day open / close need `branch`; `manage_stock_scope` | 8 |  |
| 30 | Cloud `changed_versions` and versions end to end | 8 | Docker |
| 31 | Cloud branch rename | 9 | Docker |
| 32 | Cloud branch settings | 9 | Docker |
| 33 | Cloud poll times, `CONFIG_POLL_INTERVAL_MS`, `hub_stale_after_ms` | 9 | Docker |
| 34 | Cloud CLI `issue-registration-code` | 9 | Docker |
| 35 | Cloud credential version and JWT guard | 10 | Docker |
| 36 | Cloud login changes | 10 | Docker |
| 37 | Cloud refresh changes | 10 | Docker |
| 38 | Change password: happy path and validation | 10 | Docker |
| 39 | Change password: failures and the account lock | 10 | Docker |
| 40 | Change password: concurrency | 10 | Docker |
| 41 | Cloud CLI `reset-owner-password` | 10 | Docker |
| 42 | Owner-row races: refresh vs change | 10 | Docker |
| 43 | Owner-row races: reset and login | 10 | Docker |
| 44 | No owner-row deadlocks | 10 | Docker |
| 45 | Cloud CLI `link-owner-staff`: first link and checks | 10 | Docker |
| 46 | `link-owner-staff`: re-link and the tenant lock | 10 | Docker |
| 47 | Support runbook | 10 | Claude only |
| 48 | Cloud `seed-tenant` defaults with `default_key` | 11 | Docker |
| 49 | Cloud team tree | 12 | Docker |
| 50 | Client API, i18n strings, owner nav | 13 |  |
| 51 | Client staff views and PIN dialog | 13 |  |
| 52 | Client roles views | 13 |  |
| 53 | Client teams and stock-counting views | 13 |  |
| 54 | Client branches and settings views | 13 |  |
| 55 | Client change password, lockout banner, support number | 13 |  |
| 56 | Client stock page under `my_stations` | 13 |  |
| 57 | Repository-wide checks | 14 |  |
| 58 | Build log and spec progress | — | Claude only, **STOP** |
| 59 | Page flows 1–3 (Playwright) | pipeline 9 | Claude only, Docker |
| 60 | Page flows 4–6 (Playwright) | pipeline 9 | Claude only, Docker |
| 61 | Release drill on the hubs | §7.4 | needs hardware |

---

### Task 0: Foundation §6.2 codes and implementer rules — Claude only

**Files:** Modify `docs/specs/00_Foundation_Spec_v1.7.md` (append 01b §9 codes to §6.2, the one allowed foundation edit, D64), `.cursor/rules/pos.mdc` (current plan `docs/plans/01b-plan.md`, spec `docs/specs/01b_Staff_Roles_Spec_v1.0.md`; 01a's plan finished; commit prefix `feat(01b)`).

- [ ] **Step 1:** Make the change listed under **Files**.
- **Done when:** F §6.2 lists `ROLE_NOT_FOUND`, `STAFF_NAME_TAKEN`, `LAST_ADMIN_REQUIRED`, `OWN_ADMIN_ACCESS`, `STAFF_LINKED_TO_OWNER`, `CONFIG_STALE`, `PASSWORD_INVALID`, `PASSWORD_UNCHANGED`, `PASSWORD_CHANGE_REQUIRED` with status and details exactly as 01b §9; `.cursor/rules/pos.mdc` names this plan and spec v1.0; no file outside these two changed.
- [ ] **Commit:** `docs(01b): task 0 foundation §6.2 codes, implementer rules [spec §9]`

### Task 1: Cloud migration `0005_staff_roles.sql`: schema and backfill — needs Docker Postgres

**Files:** Create `apps/cloud/src/db/migrations/0005_staff_roles.sql` (01b §5.1 verbatim, with the `password_changed_at` comment reading "audit and display", B5), `apps/cloud/test/helpers/scratch-db.ts`, `apps/cloud/test/db/staff-roles-migration.int.test.ts`; Modify `apps/cloud/test/hub-registration.int.test.ts` (its inactive staff row `'Gone'` sets `left_at`: the new `staff_left` CHECK requires it).

Constraint names verified against the database on 2026-10-27 (D-5): `branches_day_stale_after_hours_check`, `branches_day_min_gap_hours_check`, `config_audit_entity_check`, `config_audit_action_check`, `role_permissions_check`.

**Test harness (`scratch-db.ts`):** `scratchDatabaseAt(lastVersion)` creates `pos_test_0005_<pid>_<n>` (the `pos` role has `CREATEDB`), migrates it with a temp folder holding only `0001`…`lastVersion`; tests seed it with the current (v1.4) `seedTenant`, then run `migrate()` with the real folder; `dropScratchDatabases()` drops them `WITH (FORCE)` in `afterAll`.

**Interfaces — Produces:** the Cloud scratch databases block.

- [ ] **Step 0:** `docker compose down && docker compose up -d postgres` (P-5).
- [ ] **Step 1: Tests (write first):** `[01b #70]` v1.4-seeded tenant + branch named 60 chars + staff name 40 + a custom role named 40 chars + day settings 72/24 → commits; `pg_constraint` lists `branches_day_gap, branches_day_settings, branches_day_stale, branches_name_len, owner_users_temp_password, role_permissions_check, roles_idle, roles_name_len, staff_left, staff_name_len`, all `convalidated`; `pg_indexes` lists `branches_name, owner_users_staff_once, roles_active_name, roles_default_key`; a `requires_approval` grant without approver → `23514 role_permissions_check`; `role_permission_approvers` holds Cashier's `apply-discount` → Manager; `[01b #77]` keys `owner, manager, cashier, order_taker`; a later second "Manager" (role_id `ZZZZZZZZZZZZZZZZZZZZZZZZZZ`) stays null; role count unchanged; `role_permissions` rows identical before and after; a second `owner` key in one tenant → `23505 roles_default_key`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/db/staff-roles-migration.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **If** another existing test fails because its fixture violates a new CHECK (beyond `hub-registration`), stop and report its path.
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/db/staff-roles-migration.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the shared test database shows `schema_migrations` 1–5; no file under `apps/cloud/src/` other than the new SQL file changed.
- [ ] **Commit:** `feat(01b): task 1 cloud migration 0005_staff_roles [spec §5.1, B17, B22; tests #70, #77]`

### Task 2: Cloud day-setting clamp and `set-branch-settings` ranges — needs Docker Postgres

**Files:** Modify `apps/cloud/src/cli/set-branch-settings.ts` (ranges 1–48, 0–12), `apps/cloud/test/cli/set-branch-settings.int.test.ts`, `apps/cloud/test/db/staff-roles-migration.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #66]` scratch database at `0004`: branches 72/24 → 48/12 and 30/20 → 30/12 after `0005`; then `UPDATE … day_stale_after_hours = 49` fails on `branches_day_stale`, `… day_min_gap_hours = 13` on `branches_day_gap`; `set-branch-settings --day-stale-after-hours 49` and `--day-min-gap-hours 13` exit 1 with nothing written; 48 and 12 succeed.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/db/staff-roles-migration.int.test.ts apps/cloud/test/cli/set-branch-settings.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/db/staff-roles-migration.int.test.ts apps/cloud/test/cli/set-branch-settings.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the CLI's usage text shows 1…48 and 0…12.
- [ ] **Commit:** `feat(01b): task 2 day-setting clamp and CLI ranges [spec B16, 01a §6.7; test #66]`

### Task 3: Cloud migration aborts loudly — needs Docker Postgres

**Files:** Modify `apps/cloud/test/db/staff-roles-migration.int.test.ts` (tests only; the SQL from task 1 already aborts).

- [ ] **Step 1: Tests (write first):** `[01b #89]` five cases, each a fresh scratch database: staff name 41 → error contains `staff_name_len`; role name 41 → `roles_name_len`; branch name 61 → `branches_name_len`; branches `"A"` and `"a"` in one tenant → `branches_name`; role idle 90 000 → `roles_idle`; after each, `schema_migrations` is `[1,2,3,4]` and `staff.left_at` does not exist; `[01b #106]` "Manager" renamed "Incharge" → error contains `default_key backfill incomplete (tenant: missing key): <tenant_id>: manager`, nothing applied; a database with no tenant → commits.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/db/staff-roles-migration.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Expected first run:** these tests may PASS at once (they test task 1's SQL). Watch each fail by temporarily changing its setup to a valid value, then restore it.
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/db/staff-roles-migration.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `0005_staff_roles.sql` unchanged (if a case does not abort, stop: the SQL differs from §5.1).
- [ ] **Commit:** `feat(01b): task 3 migration abort cases [spec B22, §5.1 N6; tests #89, #106]`

### Task 4: Cloud migrations runner refuses a database ahead of the build — needs Docker Postgres

**Files:** Modify `apps/cloud/src/db/migrate.ts`; Create `apps/cloud/test/db/migrate-ahead.int.test.ts` (uses `scratchDatabaseAt(4)`).

**Interfaces — Produces:** `export class MigrationUnknownVersionError extends Error` (`name = 'MigrationUnknownVersionError'`), thrown before any file is applied when a `schema_migrations.version` has no file: message `database has migration NNNN (<name>) that this build does not have: this build is older than the database; deploy the current build` (00 §5.2, 01b §4.3 row 20).

- [ ] **Step 1: Tests (write first):** `[01b #105]` scratch database at `0004` plus a row `(6, '0006_future.sql')`: `migrate()` rejects with `name === 'MigrationUnknownVersionError'`, message contains `0006_future.sql`, `schema_migrations` still `[1,2,3,4,6]`, `staff.left_at` absent; after deleting row 6, `migrate()` applies `0005`. Second case: spawn `node_modules/.bin/tsx src/main.ts` (cwd `apps/cloud`) with `DATABASE_URL` = that database and the env of `createTestCloud` → exit status 1, stderr contains `0006_future.sql`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/db/migrate-ahead.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/db/migrate-ahead.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the existing checksum test in `apps/cloud/test/schema.int.test.ts` still passes.
- [ ] **Commit:** `feat(01b): task 4 migrations runner refuses a newer database [spec B22, 00 §5.2; test #105]`

### Task 5: Domain: scopes, catalogue, default keys, error codes

**Files:** Modify `packages/domain/src/permissions.ts`, `packages/domain/src/permissions.test.ts`, `packages/domain/src/errors.ts`, `packages/domain/src/errors.test.ts`, `packages/domain/src/index.ts`.

**Interfaces — Produces:** the Domain block; the nine 01b codes.

- [ ] **Step 1: Tests (write first):** `[01b §3.3] PERMISSION_SCOPES`: `take-order-anywhere`, `force-release-table-lock` → `[branch, my_floors]`; `approve-void` → `[branch, my_team]`; `manage-stock` → `[branch, my_stations]`; every other permission → `[branch]`; `own_tables` on none; `[01b §4.2] PERMISSION_CATALOGUE` has one row per permission, each `group` one of the six; `[01b §9] 01b codes have their statuses` (the nine codes); `[01b B17] DEFAULT_KEYS` is the six keys in order.
- [ ] **Step 2:** `pnpm vitest run packages/domain` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run packages/domain` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; no `node:*` import added under `packages/domain/src` (lint).
- [ ] **Commit:** `feat(01b): task 5 domain scopes, catalogue, default keys, codes [spec §3.3, §4.2, §9, B17]`

### Task 6: Events: directory v2, `StaffDirectoryApplied` v2, admin wire schemas

**Files:** Create `packages/events/test/fixtures/v1-schemas.ts` (verbatim copies of today's `DirectorySchema` and `SyncConfigEnvelopeSchema` as `DirectorySchemaV1`, `SyncConfigEnvelopeSchemaV1`, made **before** editing the originals), `packages/events/src/events/hub/StaffDirectoryApplied.v2.ts`, `packages/events/src/admin/staff.ts`; Modify `packages/events/src/directory.ts`, `packages/events/src/directory.test.ts`, `packages/events/src/fixtures.test.ts`, `packages/events/src/index.ts`.

**Interfaces — Produces:** the Events block.

- [ ] **Step 1: Tests (write first):** `[01b #64]` a stored v1 `StaffDirectoryApplied` payload upcasts to an equal v2 payload; `[01b §4.3.1] DirectorySchema` parses the §4.3.1 example; `[01b B18 a]` the §4.3.1 example also parses with `DirectorySchemaV1`, keeping `approver_role_id`; `[01b §5.3]` `StaffWire`, `RoleWire` and the responsibilities response reject a missing `version`.
- [ ] **Step 2:** `pnpm vitest run packages/events` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run packages/events` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; hub code still compiles (`pnpm typecheck`): `approver_role_id` is still in the schema.
- [ ] **Commit:** `feat(01b): task 6 directory v2 and admin wire schemas [spec §4.3.1, §5.3, B18; test #64]`

### Task 7: Cloud `loadDirectory` v2 — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/hub-registration/repository.ts`; Create `apps/cloud/test/staff-roles/load-directory.int.test.ts`.

8 statements (§7.3): header, staff (`pin_hash IS NOT NULL`, active), roles (holders + approver roles from `role_permission_approvers`, m3), grants with approvers aggregated, links (roles, denials), leads, floors (active floors), responsibilities (active stations). `approver_role_id` from the dual-written column.

- [ ] **Step 1: Tests (write first):** `[01b #21]` §4.3.1 shape, 8 statements with 3 and with 30 staff (`pgCounter`); `[01b #24]` (P-2) the cloud-built `GET /v1/sync/config` body parses with `SyncConfigEnvelopeSchemaV1`; each `requires_approval` grant has `approver_role_id` = first sorted approver; a staff row with `is_active = false` is absent; `[01b #83]` branch with cashiers and no manager: the roles list contains the Manager role.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/load-directory.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/load-directory.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; 8 statements regardless of staff count; the existing `hub-registration.int.test.ts` passes.
- [ ] **Commit:** `feat(01b): task 7 cloud loadDirectory v2 [spec §4.3.1, §7.3, B18; tests #21, #24, #83]`

### Task 8: Hub migration `0005_directory_v2.sql`, `applyStaffDirectory` v2

**Files:** Create `apps/hub/src/db/migrations/0005_directory_v2.sql` (01b §5.2 verbatim; first line `-- migrate:foreign-keys-off`); Modify `apps/hub/src/auth/apply-directory.ts`, `apps/hub/src/auth/staff-directory.ts` (`load` reads 9 statements; storage only), `apps/hub/test/auth/apply-directory.int.test.ts`, `apps/hub/test/helpers/fixtures.ts` (`aDirectory` emits v2).

Skips (B18 b, c): lead or responsibility naming an absent person → kind `lead` / `responsibility`; unknown approver id dropped (kind `approver`); `requires_approval` with no approver left → grant skipped (kind `approver`). `StaffDirectoryApplied` `schema_version: 2`.

- [ ] **Step 1: Tests (write first):** `[01b #22]` apply a directory with `approver_role_ids` and `scope`, restart (`StaffDirectory.load`), same data; a hub database at `0004` with a grant migrates and keeps it; `[01b #23]`; `[01b #84]`.
- [ ] **Step 2:** `pnpm vitest run apps/hub/test/auth/apply-directory.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/hub/test/auth/apply-directory.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `StaffDirectory.load` runs exactly 9 statements (`statementCounter`); every 00 and 01a hub test passes with the v2 `aDirectory`.
- [ ] **Commit:** `feat(01b): task 8 hub directory v2 storage and apply [spec §5.2, B18; tests #22, #23, #84]`

### Task 9: Hub `StaffDirectory` v2: `resolve` scope and lookups

**Files:** Modify `apps/hub/src/auth/staff-directory.ts`, `apps/hub/src/auth/staff-directory.test.ts`; Create `apps/hub/test/auth/staff-directory-v2.int.test.ts` (also holds `[01b #18 hub half]`).

`resolve` per §3.3: widest scope among roles granting the winning type; union of approvers, sorted.

**Interfaces — Produces:** the Hub block.

- [ ] **Step 1: Tests (write first):** `[01b #12]`; `[01b #13]` (hub half: union sorted and de-duplicated, P-3); `[01b #31]`; `[01b #33]`; `[01b #18 hub half]` `ttlFor` = 3 600 000 for Waiter 5 + Manager 60.
- [ ] **Step 2:** `pnpm vitest run apps/hub/src/auth apps/hub/test/auth/staff-directory-v2.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/hub/src/auth apps/hub/test/auth/staff-directory-v2.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `resolve` results for 00's existing fixtures are unchanged apart from the added `scope`.
- [ ] **Commit:** `feat(01b): task 9 hub resolve scope and team lookups [spec §3.3, §3.5, §3.6; tests #12, #13, #31, #33]`

### Task 10: Hub session and roster queries

**Files:** Modify `apps/hub/src/queries/session.ts`, `apps/hub/src/queries/staff-roster.ts`, `apps/hub/test/queries/access-queries.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #19]` `permissions[p] = { grant, approver_role_ids?, scope? }`; `scope` absent for `denied` / `not_granted`; `[01b #36]` roster row `responsibilities: ['count_stock']`.
- [ ] **Step 2:** `pnpm vitest run apps/hub/test/queries/access-queries.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/hub/test/queries/access-queries.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; both queries' statement counts unchanged (`statementCounter`).
- [ ] **Commit:** `feat(01b): task 10 hub session scope and roster responsibilities [spec §4.3 rows 9, 10; tests #19, #36]`

### Task 11: Cloud version builder

**Files:** Create `apps/cloud/src/modules/staff-roles/versions.ts`, `apps/cloud/src/modules/staff-roles/versions.test.ts`.

**Interfaces — Produces:** the Cloud versions block.

- [ ] **Step 1: Tests (write first):** `[01b §5.3]` `staffVersion` hashes exactly `staff_id, display_name, role_ids, branch_ids, denied_permissions, reports_to, floors, is_active` (changing `pin_set_at` or `left_at` keeps the version); `[01b §5.3]` arrays in reverse order and `BIGINT` strings give the same version; `[01b §5.3]` an `undefined` value throws; `[01b §5.3]` `roleVersion` ignores `staff_count` and `is_default`; `archived` is a boolean; `[01b §5.3]` `responsibilitySetVersion` sorts by `station_id`, then `responsibility`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/src/modules/staff-roles` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/src/modules/staff-roles` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `versions.ts` imports only `@pos/domain/hash` and `@pos/events` types.
- [ ] **Commit:** `feat(01b): task 11 version builder [spec B23, §5.3]`

### Task 12: Cloud directory write script, staff list and create — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/staff-roles/{routes,service,repository,write,schemas}.ts`, `apps/cloud/test/staff-roles/staff-create.int.test.ts`; Modify `apps/cloud/src/server.ts` (register routes), `apps/cloud/test/cross-tenant.int.test.ts` (`GET`, `POST /v1/admin/staff`).

**Interfaces — Produces:** the Cloud directory write block; `StaffRow`, `RoleRow`, `ResponsibilityRow` in `repository.ts`.

- [ ] **Step 1: Tests (write first):** `[01b §6.2]` create bumps `directory_version` by exactly 1; `[01b #6]`; `[01b #7]`; `[01b #56]`; `[01b §6.1]` 6 statements for 3 and 30 staff; `?branch_id` filters; Review Focus 1 `[01b B12]` `"Ali "` then `"ali"` at one branch → `409 STAFF_NAME_TAKEN`; Review Focus 3 `[01b §6.2]` a 40-character Urdu name is saved; 41 → `400`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/staff-create.int.test.ts apps/cloud/test/cross-tenant.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/staff-create.int.test.ts apps/cloud/test/cross-tenant.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `GET /v1/admin/staff` runs 6 statements (guard read excluded); both routes are in `ROUTE_CASES`.
- [ ] **Commit:** `feat(01b): task 12 directory write script, staff list and create [spec §6, §6.1, §6.2, B11, B12; tests #6, #7, #56]`

### Task 13: Cloud PIN set — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/pin.int.test.ts`, `apps/hub/test/auth/pin-from-cloud.int.test.ts`.

`PUT /v1/admin/staff/:staff_id/pin` (§6.3): hash outside the transaction.

- [ ] **Step 1: Tests (write first):** `[01b #3]` (P-3: cloud half asserts the stored hash has `m=19456,t=2,p=1` and appears in `loadDirectory`; `[01b #3 hub half]` in `pin-from-cloud.int.test.ts` applies it: not skipped; a second hash for the same person ends their sessions `credentials_changed`); `[01b #25]`; `[01b #58]`; Review Focus 2 `[01b §6.3]` `"١٢٣٤"` and `"12 34"` → `400`; `"0123"` stored and verifies with `@node-rs/argon2`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/pin.int.test.ts apps/hub/test/auth/pin-from-cloud.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/pin.int.test.ts apps/hub/test/auth/pin-from-cloud.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the response is `{ staff: StaffWire, changed_versions }`; no log line contains the PIN.
- [ ] **Commit:** `feat(01b): task 13 PIN set [spec §6.3, B9; tests #3, #25, #58]`

### Task 14: Cloud staff PATCH: fields, branches diff, merged row — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service,repository}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/staff-patch.int.test.ts`.

§6.4 without leaving / returning / guards (tasks 16–19): `expected_version` required; `display_name`, `role_ids`, `branch_ids` (diff, §5.1 notes), `denied_permissions`, `floors`.

- [ ] **Step 1: Tests (write first):** `[01b #2]`; `[01b #8]`; `[01b #87]`; `[01b B23]` stale `expected_version` → `409 CONFIG_STALE { entity: 'staff', id }`, nothing written; `[01b §3.2 rule 1]` a merged row with no active role → `422 CONFIG_REFERENCE_INVALID { field: 'role_ids', reason: 'role_archived' }` (role archived by SQL; the end-to-end case is #82, task 26).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/staff-patch.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/staff-patch.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; a no-op PATCH bumps nothing and writes no audit row.
- [ ] **Commit:** `feat(01b): task 14 staff PATCH fields and branch diff [spec §6.4, §3.2, B23; tests #2, #8, #87]`

### Task 15: Cloud reports-to rules — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{service,repository}.ts`; Create `apps/cloud/test/staff-roles/reports-to.int.test.ts`.

§3.2 rule 5, §3.5: one lead per branch, lead active at that branch, loop walk ≤ active staff count, `wrong_branch` when the branch is not the person's.

- [ ] **Step 1: Tests (write first):** `[01b #26]`; `[01b #27]`; `[01b #57]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/reports-to.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/reports-to.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the loop walk issues one statement per hop at most and stops at the active staff count.
- [ ] **Commit:** `feat(01b): task 15 reports-to rules [spec §3.2 rule 5, §3.5; tests #26, #27, #57]`

### Task 16: Cloud leaving, returning and team moves — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{service,repository}.ts`; Create `apps/cloud/test/staff-roles/leaving.int.test.ts`.

§6.4 `is_active` both ways; B15 re-parent at every branch and on a removed branch; staff responsibilities deleted.

- [ ] **Step 1: Tests (write first):** `[01b #10]`; `[01b #28]`; `[01b #29]`; `[01b #30]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/leaving.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/leaving.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; each B15 move writes exactly one `staff` / `reports_to_reassigned` audit row.
- [ ] **Commit:** `feat(01b): task 16 leaving, returning and team moves [spec §6.4, B15, §3.5; tests #10, #28, #29, #30]`

### Task 17: Leaver reaches the hub; linked row cannot leave — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/service.ts`, `apps/cloud/test/staff-roles/leaving.int.test.ts`; Create `apps/hub/test/sync/poller-leaver.int.test.ts` (P-3).

- [ ] **Step 1: Tests (write first):** `[01b #9]` (P-3: cloud half in `leaving.int.test.ts`; `[01b #9 hub half]` in `poller-leaver.int.test.ts` through `stub-config-cloud.ts`: sessions end `staff_removed`, phone revoked `owner_removed`); `[01b #101]` (set `owner_users.staff_id` by SQL).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/leaving.int.test.ts apps/hub/test/sync/poller-leaver.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/leaving.int.test.ts apps/hub/test/sync/poller-leaver.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `STAFF_LINKED_TO_OWNER` is checked before the admin guards (the error is the same with or without a second admin).
- [ ] **Commit:** `feat(01b): task 17 leaver on the hub, linked row cannot leave [spec §6.4, 00 M38, review 2 N3; tests #9, #101]`

### Task 18: Concurrent leavers (race) — needs Docker Postgres

**Files:** Create `apps/cloud/test/staff-roles/leaving-race.int.test.ts`; Modify `apps/cloud/src/modules/staff-roles/service.ts` only if the test fails.

- [ ] **Step 1: Tests (write first):** Review Focus 5 `[01b B15]` a lead and their report marked as left in two concurrent PATCHes (both sent before either answers, 20 runs): after both, no `staff_leads` row points at a person who has left.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/leaving-race.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Expected first run:** this may PASS at once (the tenant lock from task 12 serialises the writes). If so, check it fails with the `tenants … FOR NO KEY UPDATE` line temporarily removed, then restore it.
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/leaving-race.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; 20 runs without a failure.
- [ ] **Commit:** `feat(01b): task 18 concurrent leavers [spec B11, B15]`

### Task 19: Cloud admin guards on staff writes — needs Docker Postgres

**Files:** Create `apps/cloud/src/modules/staff-roles/guards.ts`, `apps/cloud/test/staff-roles/guards.int.test.ts`; Modify `apps/cloud/src/modules/staff-roles/{service,write}.ts`.

Qualifying admin = active, PIN, assigned, effective `access-hub-admin` **and** `manage-devices` `allowed` (B7, §3.4), one statement.

**Interfaces — Produces:** the Cloud guards block.

- [ ] **Step 1: Tests (write first):** `[01b #69]`; `[01b §3.4]` own-admin guard runs before last-admin; `[01b §3.4]` a stock counter with `access-hub-admin` only is not a qualifying admin; `[01b §3.4]` removing a qualifying admin's branch, denying `manage-devices`, or marking them as left are each refused when they are the last at a branch.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/guards.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/guards.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `qualifyingAdmins` is one statement (`pgCounter`).
- [ ] **Commit:** `feat(01b): task 19 admin guards [spec B7, §3.4; test #69]`

### Task 20: Concurrent last-admin removal (race) — needs Docker Postgres

**Files:** Create `apps/cloud/test/staff-roles/guards-race.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #11]` two PATCHes, each removing one of the last two qualifying admins at a branch, sent together (20 runs): one `200`, one `409 LAST_ADMIN_REQUIRED`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/guards-race.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Expected first run:** may PASS at once; check it fails with the tenant lock line temporarily removed, then restore it.
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/guards-race.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; 20 runs without a failure; no `src/` file changed.
- [ ] **Commit:** `feat(01b): task 20 concurrent last-admin removal [spec B7, B11; test #11]`

### Task 21: Lock modes: directory write vs menu write (barrier) — needs Docker Postgres

**Files:** Modify `apps/cloud/src/server.ts` (`CloudTestHooks.afterTenantLock?(): Promise<void>`, called by `directoryWrite` right after the tenant lock), `apps/cloud/src/modules/staff-roles/write.ts`; Create `apps/cloud/test/staff-roles/lock-modes.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #85]` a staff POST paused in `afterTenantLock`; meanwhile `POST /v1/admin/menu-items` commits within 1 s; then the staff POST is released and commits.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/lock-modes.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/lock-modes.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; with the tenant lock changed to `FOR UPDATE` the test fails (check once, then restore).
- [ ] **Commit:** `feat(01b): task 21 tenant lock mode [spec B11, 01a S8; test #85]`

### Task 22: Cloud roles list and create — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service,repository}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/roles.int.test.ts`.

§6.5 (4 statements), §6.6; grants write `approver_role_id` = first sorted approver and the `role_permission_approvers` rows.

- [ ] **Step 1: Tests (write first):** `[01b #13 cloud half]` `allowed` grant with approvers → `422`; `[01b #14]`; `[01b #15]`; `[01b #60]`; `[01b §6.5]` 4 statements.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/roles.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/roles.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; a created `requires_approval` grant has `approver_role_id` = first sorted approver and one `role_permission_approvers` row per approver.
- [ ] **Commit:** `feat(01b): task 22 roles list and create [spec §6.5, §6.6, B10; tests #14, #15, #60]`

### Task 23: Cloud roles: owner coverage and idle limits — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{schemas,service}.ts`, `apps/cloud/test/staff-roles/roles.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #17]`; `[01b #18]` (cloud half: idle 0 or 241 → `400`; hub half in task 9).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/roles.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/roles.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green.
- [ ] **Commit:** `feat(01b): task 23 role owner check and idle limits [spec B8, B13; tests #17, #18]`

### Task 24: Cloud role PATCH: name, idle, grants, dual write — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service,repository}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/role-patch.int.test.ts`.

§6.7 without archive (task 25): `expected_version`; grants replace; `default_key` never changed.

- [ ] **Step 1: Tests (write first):** `[01b #79]`; `[01b §6.7]` renaming a default role keeps `default_key`; `[01b §6.7]` stale `expected_version` → `409 CONFIG_STALE { entity: 'role', id }`; `[01b §6.7]` grant edits write one `role` / `update` audit row with grants in `before` / `after`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/role-patch.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/role-patch.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green.
- [ ] **Commit:** `feat(01b): task 24 role PATCH and dual-written approver [spec §6.7, B22; test #79]`

### Task 25: Cloud role archive and restore — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{service,repository}.ts`; Create `apps/cloud/test/staff-roles/role-archive.int.test.ts`.

B14: refuse when an active person would have no role or the role is an approver of another active role's grant (`409 CONFIG_IN_USE`); delete `staff_roles` and role responsibilities.

- [ ] **Step 1: Tests (write first):** `[01b #1]`; `[01b #5]` (P-1: every role write kind exists from this task); `[01b #16]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/role-archive.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/role-archive.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; a rolled-back archive leaves no audit row.
- [ ] **Commit:** `feat(01b): task 25 role archive and restore [spec B14, §6.7; tests #1, #5, #16]`

### Task 26: Cloud admin guards on roles; returning with no role — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/service.ts`; Create `apps/cloud/test/staff-roles/role-guards.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #63]`; `[01b #76]`; `[01b #82]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/role-guards.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/role-guards.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green.
- [ ] **Commit:** `feat(01b): task 26 guards on role writes [spec B7, §3.2, B14; tests #63, #76, #82]`

### Task 27: Cloud responsibilities GET / PUT — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service,repository}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/responsibilities.int.test.ts`.

§6.8: GET and PUT compare and replace **active-station** rows only; PUT response `{ responsibilities, version, changed_versions }`.

- [ ] **Step 1: Tests (write first):** `[01b #32]`; `[01b #35]`; `[01b #103]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/responsibilities.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/responsibilities.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; GET is 1 statement; archived-station rows are never deleted by a PUT.
- [ ] **Commit:** `feat(01b): task 27 responsibilities [spec §6.8, §3.6; tests #32, #35, #103]`

### Task 28: Hub stock scope `my_stations`

**Files:** Modify `apps/hub/src/commands/{set-precooked-stock,add-precooked-stock,set-item-availability}.ts`, `apps/hub/src/queries/stock.ts`; Create `apps/hub/test/commands/stock-scope.int.test.ts`.

01a §6.17–§6.19 as changed by 01b §4.4 rows 9–11: item routed at this branch to one of `stationsOf(staff, 'count_stock')`, else `403 PERMISSION_DENIED { permission: 'manage-stock', reason: 'outside_scope', item_ids }`, nothing appended.

- [ ] **Step 1: Tests (write first):** `[01b #34]`.
- [ ] **Step 2:** `pnpm vitest run apps/hub/test/commands apps/hub/test/queries/stock.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/hub/test/commands apps/hub/test/queries/stock.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the existing 01a stock tests pass unchanged; the stock query's statement count is unchanged.
- [ ] **Commit:** `feat(01b): task 28 my_stations scope on stock [spec B20, 01a §6.17–§6.19; test #34]`

### Task 29: Hub day open / close need `branch`; `manage_stock_scope`

**Files:** Modify `apps/hub/src/commands/{open-business-day,close-business-day}.ts`, `apps/hub/src/queries/stock.ts`, `apps/hub/test/commands/stock-scope.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #68]`; `[01b §4.4 row 13]` `GET /admin/queries/stock` returns `manage_stock_scope` `branch` or `my_stations` (server part of #71, P-1).
- [ ] **Step 2:** `pnpm vitest run apps/hub/test/commands/stock-scope.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/hub/test/commands/stock-scope.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the existing business-day tests pass unchanged.
- [ ] **Commit:** `feat(01b): task 29 day actions need branch scope [spec B20, D-6; test #68]`

### Task 30: Cloud `changed_versions` and versions end to end — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{write,service}.ts`, `apps/cloud/src/server.ts` (`CloudTestHooks.onVersionCompare?`); Create `apps/cloud/test/staff-roles/versions.int.test.ts`.

Every directory write response returns `changed_versions` (§6 script, J-5); cascades marked in the collector: B15 moves, role archive holders and branches, responsibility deletions.

- [ ] **Step 1: Tests (write first):** `[01b #80]`; `[01b #102]`; `[01b #104]` (in-transaction version captured with `onVersionCompare`).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/versions.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/versions.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; a source check finds `sha256hex(canonicalJson(` for these entities only in `versions.ts`.
- [ ] **Commit:** `feat(01b): task 30 changed_versions and one version builder [spec B23, §5.3, §6; tests #80, #102, #104]`

### Task 31: Cloud branch rename — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/branch-rename.int.test.ts`.

§6.9 own script: no bump; `23505` on `branches_name` → `409 CONFIG_NAME_TAKEN { entity: 'branch', name }`.

- [ ] **Step 1: Tests (write first):** `[01b #47]` (the new name in `GET /v1/admin/branches`; `hub_last_seen_at` is task 33's); `[01b #88]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/branch-rename.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/branch-rename.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; a rename bumps neither `config_version` nor `directory_version`.
- [ ] **Commit:** `feat(01b): task 31 branch rename [spec §6.9; tests #47, #88]`

### Task 32: Cloud branch settings — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/branch-settings.int.test.ts`.

§6.10 via 01a's common write script plus B8.

- [ ] **Step 1: Tests (write first):** `[01b #45]`; `[01b #46]`; `[01b #48]`; `[01b #59]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/branch-settings.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/branch-settings.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; GET is 1 statement; PATCH bumps only that branch's `config_version`.
- [ ] **Commit:** `feat(01b): task 32 branch settings [spec §6.10, B16; tests #45, #46, #48, #59]`

### Task 33: Cloud poll times, `CONFIG_POLL_INTERVAL_MS`, `hub_stale_after_ms` — needs Docker Postgres

**Files:** Modify `packages/events/src/config.ts` (export the constant), `apps/hub/src/sync/config-poller.ts` (import it; delete `POLL_INTERVAL_MS`), `apps/cloud/src/modules/config-sync/service.ts`, `apps/cloud/src/modules/restaurant/{service,repository}.ts` (`GET /v1/admin/branches` adds `hub_synced_at`, `hub_stale_after_ms`), `packages/events/src/admin/restaurant.ts`; Create `apps/cloud/test/config-sync/hub-times.int.test.ts`, `apps/hub/test/sync/poll-interval.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #67]`; `[01b #92]` (P-3: cloud half in `hub-times`; `[01b #92 hub half]` in `poll-interval`).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/config-sync/hub-times.int.test.ts apps/hub/test/sync/poll-interval.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/config-sync/hub-times.int.test.ts apps/hub/test/sync/poll-interval.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; poll query counts 2 (`304`) and ≤ 17 (`200`); `GET /v1/admin/branches` still 1 statement.
- [ ] **Commit:** `feat(01b): task 33 hub check-in and up-to-date times [spec B19, D-11, 01a §3.4, §6.1, §6.7b; tests #67, #92]`

### Task 34: Cloud CLI `issue-registration-code` — needs Docker Postgres

**Files:** Modify `apps/cloud/src/cli/issue-registration-code.ts`, `apps/cloud/test/cli/issue-code.int.test.ts`.

00 §6.27 as changed by 01b §4.3 row 19: tenant lock first; qualifying admins only (`qualifyingAdmins` without the branch filter); duplicate names (`lower(trim(display_name))`) → exit 1 listing each name with its staff ids, nothing written; `directory_version + 1`; branch name taken → exit 1.

- [ ] **Step 1: Tests (write first):** `[01b #86]`; `[01b #93]`; `[01b #94]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/cli/issue-code.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/cli/issue-code.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the reissue (`--branch-id`) tests pass unchanged.
- [ ] **Commit:** `feat(01b): task 34 new branch gets qualifying admins only [spec 00 §6.27, D-14; tests #86, #93, #94]`

### Task 35: Cloud credential version and JWT guard — needs Docker Postgres

**Files:** Modify `apps/cloud/src/plugins/jwt.ts` (`cv`), `apps/cloud/src/plugins/tenant-scope.ts` (owner-row read after verify; `503` on a failed read; `PASSWORD_CHANGE_REQUIRED` on `/v1/admin/*`), `apps/cloud/src/db/credential-lookup.ts` (`ownerGuardRow`), `apps/cloud/src/server.ts` (`CloudTestHooks.guardRead?`), `apps/cloud/src/modules/owner-auth/{service,repository}.ts` (login and refresh write `cv` and `credential_version` on the token row; no other login change yet); Create `apps/cloud/test/owner-auth/guard.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #65]` (`must_change_password` set by SQL; every `/v1/admin/*` route from the route inventory); `[01b #73]` (tokens "before a change" made by bumping `credential_version` by SQL until tasks 38 and 41); `[01b #91]`; `[01b #107]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/guard.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/guard.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green (00 and 01a tests pass unchanged: their tokens carry `cv: 0` against the default 0); the guard adds exactly one statement per request.
- [ ] **Commit:** `feat(01b): task 35 credential version and JWT guard [spec B5, §6.13, 00 §6.24a; tests #65, #73, #91, #107]`

### Task 36: Cloud login changes — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/owner-auth/{service,repository}.ts`, `packages/events/src/admin/owner-auth.ts` (`user.must_change_password`, `lockout_notice`); Create `apps/cloud/test/owner-auth/login-notice.int.test.ts`.

§6.13 login: success transaction starts with `lockOwnerRow(…, { passwordHash })` (`FOR NO KEY UPDATE`); expired temporary password → failure path; lock sets `lock_notice_at`; success reads and clears it.

**Interfaces — Produces:** `lockOwnerRow`, `OwnerAuthRow` (Cloud owner auth block).

- [ ] **Step 1: Tests (write first):** `[01b #4]`; `[01b §6.13]` a matching password whose hash changed after the verify → `401 LOGIN_INVALID`, nothing counted; `[01b §6.13]` an expired temporary password set by SQL → `401 LOGIN_INVALID`, counted.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/login-notice.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/login-notice.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the existing `login.int.test.ts` passes unchanged.
- [ ] **Commit:** `feat(01b): task 36 login notice and owner-row lock [spec §6.13, M73; test #4]`

### Task 37: Cloud refresh changes — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/owner-auth/{service,repository}.ts`, `apps/cloud/src/plugins/owner-credentials.ts` (unlocked lookup); Create `apps/cloud/test/owner-auth/refresh-v2.int.test.ts`.

§6.13 refresh order: token unlocked → owner `FOR NO KEY UPDATE` → token `FOR UPDATE` → `credential_version` equality; rotating path returns and clears `lockout_notice`; grace path `null`.

- [ ] **Step 1: Tests (write first):** `[01b #42]`; `[01b #81]`; Review Focus 4 (cloud) `[01b §6.13]` after `credential_version` + 1, the old access token → `401 JWT_INVALID` and its refresh token → `401 REFRESH_TOKEN_INVALID`, nothing revoked.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/refresh-v2.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/refresh-v2.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the existing `refresh.int.test.ts` (M49 grace) passes unchanged.
- [ ] **Commit:** `feat(01b): task 37 refresh lock order and credential check [spec §6.13, 00 §6.23; tests #42, #81]`

### Task 38: Change password: happy path and validation — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/owner-auth/{routes,service,repository}.ts`, `apps/cloud/src/server.ts` (logger redact `body.current_password`, `body.new_password`), `apps/cloud/test/route-inventory.int.test.ts`; Create `apps/cloud/test/owner-auth/change-password.int.test.ts`.

§6.11 steps (0)–(2) and (5): shares login's per-IP limiter instance; step 5 `lockOwnerRow(…, { passwordHash: verified })`, `UPDATE … credential_version + 1 …`, revoke, new pair, audit.

- [ ] **Step 1: Tests (write first):** `[01b #37]`; `[01b #40]`; `[01b #44]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/change-password.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/change-password.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the route is in the route inventory with `tenantScope: 'jwt'`.
- [ ] **Commit:** `feat(01b): task 38 change password [spec §6.11, §7.2; tests #37, #40, #44]`

### Task 39: Change password: failures and the account lock — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/owner-auth/service.ts`, `apps/cloud/test/owner-auth/change-password.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #38]`; `[01b #39]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/change-password.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/change-password.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the per-IP counter is the login limiter's (30 failures across login and change-password give `429`).
- [ ] **Commit:** `feat(01b): task 39 change password failures and lock [spec §6.11 steps 3–4, M73; tests #38, #39]`

### Task 40: Change password: concurrency — needs Docker Postgres

**Files:** Modify `apps/cloud/test/owner-auth/change-password.int.test.ts`; `apps/cloud/src/modules/owner-auth/service.ts` only if a test fails.

- [ ] **Step 1: Tests (write first):** `[01b #43]`; `[01b #90]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/change-password.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Expected first run:** may PASS at once (the compare-and-set from task 38); check it fails with `AND password_hash = $verified` temporarily removed, then restore it.
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/change-password.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; 20 runs of each without a failure.
- [ ] **Commit:** `feat(01b): task 40 change password concurrency [spec §6.11 step 5, m11; tests #43, #90]`

### Task 41: Cloud CLI `reset-owner-password` — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/reset-owner-password.ts`, `apps/cloud/test/cli/reset-owner-password.int.test.ts`; Modify `apps/cloud/package.json` (script `"reset-owner-password": "tsx src/cli/reset-owner-password.ts"`).

§6.14: `SystemContext`; `SELECT … FOR NO KEY UPDATE` first; temporary password from `SecretGen` (4×4 Crockford); `credential_version + 1`, `temp_password_expires_at = now + 86 400 000`, `must_change_password`, counters and lock cleared; prints the password and its expiry once.

**Interfaces — Produces:** `resetOwnerPassword(sys, input: { email: string }, deps, hooks?)`.

- [ ] **Step 1: Tests (write first):** `[01b #41]`; `[01b #75]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/cli/reset-owner-password.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/cli/reset-owner-password.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; the temporary password never appears in captured logs.
- [ ] **Commit:** `feat(01b): task 41 reset-owner-password CLI [spec §6.14, B5; tests #41, #75]`

### Task 42: Owner-row races: refresh vs change — needs Docker Postgres

**Files:** Modify `apps/cloud/src/server.ts` (`CloudTestHooks.afterOwnerRowLock?(path)`), `apps/cloud/src/modules/owner-auth/service.ts` (call it right after each owner-row lock); Create `apps/cloud/test/owner-auth/races.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #74 a]` refresh paused after its owner-row lock, change-password waits; after both commit the refresh's **access** token → `401 JWT_INVALID`, its successor → `401 REFRESH_TOKEN_INVALID`; `[01b #74 b]` change-password paused after its lock, a refresh waits → `401 REFRESH_TOKEN_INVALID`, no token issued.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/races.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/races.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; each case fails if the refresh's owner-row lock is removed (check once, then restore).
- [ ] **Commit:** `feat(01b): task 42 refresh and change races [spec §6.13, review 2 N1; test #74 a, b]`

### Task 43: Owner-row races: reset and login — needs Docker Postgres

**Files:** Modify `apps/cloud/src/cli/reset-owner-password.ts` (pass `hooks.afterOwnerRowLock`), `apps/cloud/test/owner-auth/races.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #74 c]` cases a and b with `reset-owner-password`, also with the CLI clock 5 minutes ahead and 5 minutes behind; `[01b #74 d]` login holding the owner row while a reset waits: its access token → `401 JWT_INVALID`, its refresh token → `401 REFRESH_TOKEN_INVALID`; a login waiting behind the reset → `401 LOGIN_INVALID`, no token row, counter unchanged; `[01b #74 e]` 50 interleaved runs of refresh against change-password, no `40P01`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/races.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/races.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green.
- [ ] **Commit:** `feat(01b): task 43 reset and login races [spec §6.13, §6.14, review 2 N1; test #74 c, d, e]`

### Task 44: No owner-row deadlocks — needs Docker Postgres

**Files:** Create `apps/cloud/test/owner-auth/deadlocks.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #98]` 50 runs each: login ‖ login, refresh ‖ refresh (two tokens) with `lock_notice_at` set (exactly one returns the notice), login ‖ refresh; no error with code `40P01`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/owner-auth/deadlocks.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/owner-auth/deadlocks.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; no `src/` file changed (if a run deadlocks, stop and report: the lock mode in tasks 36–37 is wrong).
- [ ] **Commit:** `feat(01b): task 44 no owner-row deadlocks [spec §6.13, review 2 N2; test #98]`

### Task 45: Cloud CLI `link-owner-staff`: first link and checks — needs Docker Postgres

**Files:** Create `apps/cloud/src/cli/link-owner-staff.ts`, `apps/cloud/test/cli/link-owner-staff.int.test.ts`; Modify `apps/cloud/package.json` (script `"link-owner-staff": "tsx src/cli/link-owner-staff.ts"`).

§6.15a steps 1–11 in order (tenant lock, owner row, print the target, `--confirm-name` exact, at least one branch, qualifying admin at every branch of the tenant, audit `{ staff_id }` old → new).

**Interfaces — Produces:** `linkOwnerStaff(sys, input: { ownerUserId; staffId; confirmName?: string }, deps, hooks?: { afterTenantLock?(): Promise<void> })`.

- [ ] **Step 1: Tests (write first):** `[01b #72]`; `[01b #97]`; `[01b #100]`.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/cli/link-owner-staff.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/cli/link-owner-staff.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; every exit 1 path writes nothing and no audit row.
- [ ] **Commit:** `feat(01b): task 45 link-owner-staff first link [spec §6.15a, B7, review 2 N3; tests #72, #97, #100]`

### Task 46: `link-owner-staff`: re-link and the tenant lock — needs Docker Postgres

**Files:** Modify `apps/cloud/src/cli/link-owner-staff.ts`, `apps/cloud/test/cli/link-owner-staff.int.test.ts`.

- [ ] **Step 1: Tests (write first):** `[01b #95]`; `[01b #99]` (barrier through `hooks.afterTenantLock`).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/cli/link-owner-staff.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/cli/link-owner-staff.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; #99 (a) fails if the CLI's tenant lock is removed (check once, then restore).
- [ ] **Commit:** `feat(01b): task 46 link-owner-staff re-link and lock [spec §6.15a, B11; tests #95, #99]`

### Task 47: Support runbook — Claude only

**Files:** Create `docs/runbooks/owner-password-reset.md` with the four sections of 01b §7.5 (reset in a shell with no session logging; owner login not linked; own admin access, no override; correcting a wrong owner link).

- [ ] **Step 1:** Make the change listed under **Files**.
- **Done when:** the file has the four sections; every CLI flag it names exists in tasks 41, 45, 46.
- [ ] **Commit:** `docs(01b): task 47 support runbook [spec §7.5]`

### Task 48: Cloud `seed-tenant` defaults with `default_key` — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/default-roles.ts` (six roles, `default_key`, idles §6.15, approver by key), `apps/cloud/src/cli/seed-tenant.ts` (lookups by `default_key`; `owner_users.staff_id`), `apps/cloud/test/cli/seed-tenant.int.test.ts`, `apps/cloud/test/default-roles.test.ts` (by `default_key`, not name).

- [ ] **Step 1: Tests (write first):** `[01b #20]`; `[01b §6.15]` `seed-tenant.ts` contains no default role name (source check).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/cli/seed-tenant.int.test.ts apps/cloud/test/default-roles.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/cli/seed-tenant.int.test.ts apps/cloud/test/default-roles.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; dev data re-seeded with the command in `docs/manual-test-00.md`.
- [ ] **Commit:** `feat(01b): task 48 seed-tenant default roles by key [spec §6.15, B17; test #20]`

### Task 49: Cloud team tree — needs Docker Postgres

**Files:** Modify `apps/cloud/src/modules/staff-roles/{routes,service,repository}.ts`, `apps/cloud/test/cross-tenant.int.test.ts`; Create `apps/cloud/test/staff-roles/team-tree.int.test.ts`, `apps/hub/test/auth/no-pin-staff.int.test.ts`.

§6.12: 3 statements, tree built in memory, ordered `lower(display_name)`.

- [ ] **Step 1: Tests (write first):** `[01b #61]`; `[01b #62]` (P-3: cloud half saves a Cook with no PIN and a lead and sees them in the tree; `[01b #62 hub half]`: absent from `GET /queries/staff-roster`, `POST /auth/pin` → `404 STAFF_NOT_FOUND`, not counted).
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/staff-roles/team-tree.int.test.ts apps/hub/test/auth/no-pin-staff.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/staff-roles/team-tree.int.test.ts apps/hub/test/auth/no-pin-staff.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; 3 statements whatever the staff count.
- [ ] **Commit:** `feat(01b): task 49 team tree [spec §6.12, B17; tests #61, #62]`

### Task 50: Client API, i18n strings, owner nav

**Files:** Modify `apps/client/src/api/cloud-admin.ts`, `apps/client/src/api/cloud-admin.test.ts`, `apps/client/src/i18n/{en,ur}.ts`, `apps/client/src/i18n/i18n.test.ts`, `apps/client/src/app/router.ts` (hash routes of 01b §8), the owner shell's menu component under `apps/client/src/components/`; Create `apps/client/src/features/owner/versions.ts`, `apps/client/src/features/owner/versions.test.ts`.

**Interfaces — Produces:** the Client block.

- [ ] **Step 1: Tests (write first):** `[01b §8]` each api call sends the §6 body and returns `data`; `[01b §8]` `applyChangedVersions` replaces held versions; `[01b §8]` `en` and `ur` define every `staff.*`, `roles.*`, `teams.*`, `perm.<key>`, `errors.<01b code>` key; `[01b §8]` the router knows `#/staff`, `#/roles`, `#/teams`, `#/stock-counting`, `#/branches`, `#/account/password`.
- [ ] **Step 2:** `pnpm vitest run apps/client` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; missing Urdu strings are listed in the task report (Claude writes `docs/design/handoff/01b/urdu-todo.md`).
- [ ] **Commit:** `feat(01b): task 50 owner client API and strings [spec §8]`

### Task 51: Client staff views and PIN dialog

**Files:** Create `apps/client/src/features/owner/staff/{StaffList,StaffForm,PinDialog}.tsx` and their `.test.tsx`.

- [ ] **Step 1: Tests (write first):** `[01b §8]` staff form sends `expected_version` and shows the reload message on `CONFIG_STALE`; `[01b §8]` PIN dialog clears the PIN after the request; `[01b §8]` floors field hidden without a `my_floors` grant; `[01b §8]` `STAFF_LINKED_TO_OWNER` shows its message on the Left switch.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/owner/staff` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/features/owner/staff` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; no `style` prop, CSS only through `app/ui-kit.ts` (lint).
- [ ] **Commit:** `feat(01b): task 51 staff views [spec §8]`

### Task 52: Client roles views

**Files:** Create `apps/client/src/features/owner/roles/{RoleList,RoleEditor}.tsx` and their `.test.tsx`.

- [ ] **Step 1: Tests (write first):** `[01b §8]` "Approved by" is a multi-select of role chips; "Where" offers only `PERMISSION_SCOPES[permission]`; `[01b §8]` inline idle edit sends `{ expected_version, idle_minutes }`; `[01b §8]` `OWN_ADMIN_ACCESS` shows "You can't remove your own admin access. Call support.".
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/owner/roles` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/features/owner/roles` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green.
- [ ] **Commit:** `feat(01b): task 52 roles views [spec §8]`

### Task 53: Client teams and stock-counting views

**Files:** Create `apps/client/src/features/owner/teams/TeamsView.tsx`, `apps/client/src/features/owner/stock-counting/StockCountingView.tsx` and their `.test.tsx`.

- [ ] **Step 1: Tests (write first):** `[01b §8]` team tree indents members and shows "No PIN" when `has_pin` is false; `[01b §8]` stock-counting PUT sends the whole active set with `expected_version`.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/owner/teams apps/client/src/features/owner/stock-counting` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/features/owner/teams apps/client/src/features/owner/stock-counting` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green.
- [ ] **Commit:** `feat(01b): task 53 teams and stock-counting views [spec §8, §6.8, §6.12]`

### Task 54: Client branches and settings views

**Files:** Create `apps/client/src/features/owner/branches/{BranchesView,BranchSettings}.tsx` and their `.test.tsx`.

- [ ] **Step 1: Tests (write first):** `[01b #78]` (page test, English and Urdu; threshold from the response's `hub_stale_after_ms`); `[01b §8]` settings form keeps stale > gap before sending.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/owner/branches` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/features/owner/branches` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; no threshold constant in the client (`grep -r 180000 apps/client/src` finds nothing).
- [ ] **Commit:** `feat(01b): task 54 branches and settings views [spec §8, B19; test #78]`

### Task 55: Client change password, lockout banner, support number

**Files:** Create `apps/client/src/features/owner/account/{ChangePassword,LockoutBanner}.tsx` and their `.test.tsx`, `apps/client/src/app/support.ts` (`supportPhone(): string | null` from `import.meta.env.VITE_SUPPORT_PHONE`); Modify `apps/client/src/app/router.ts` (forced `#/account/password` while `must_change_password`).

- [ ] **Step 1: Tests (write first):** `[01b §8, Q3]` caption "Forgot your password? Call support." with no number when `VITE_SUPPORT_PHONE` is unset; "… Call support on {phone}." when set; `[01b §8]` every view redirects to `#/account/password` while `must_change_password`; `[01b §8]` lockout banner shows `{n}` = `failed_count`; `[01b §8]` `SERVICE_UNAVAILABLE` shows the cloud-unreachable state, not sign-in; Review Focus 4 (client) `[01b §8]` `401 JWT_INVALID` then `401 REFRESH_TOKEN_INVALID` lands on sign-in once.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/owner/account apps/client/src/app` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/features/owner/account apps/client/src/app` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `pnpm --filter @pos/client build` succeeds with and without `VITE_SUPPORT_PHONE`.
- [ ] **Commit:** `feat(01b): task 55 change password view and support number [spec §8, Q3, J-13]`

### Task 56: Client stock page under `my_stations`

**Files:** Modify `apps/client/src/features/admin/stock/*` (the files that render Start day, Close day and the stale-day prompt) and their tests.

- [ ] **Step 1: Tests (write first):** `[01b #71]` (server part through the stub from task 29's `manage_stock_scope`; page part: with `my_stations` the page hides **Start day**, **Close day** and the stale-day prompt, and `409 BUSINESS_DAY_NOT_OPEN` shows "The day hasn't been started. Ask someone who can start the day.").
- [ ] **Step 2:** `pnpm vitest run apps/client/src/features/admin/stock` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/features/admin/stock` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; with `branch` scope the page renders exactly as before (existing tests unchanged).
- [ ] **Commit:** `feat(01b): task 56 stock page day actions under my_stations [spec §4.4 rows 11, 13; test #71]`

### Task 57: Repository-wide checks

**Files:** Create `apps/cloud/test/role-names.test.ts`, `apps/hub/test/auth/renamed-roles.int.test.ts`; Modify `apps/cloud/test/route-inventory.int.test.ts` (14 new routes listed).

- [ ] **Step 1: Tests (write first):** `[01b #55]` (exact scope of §10.9a); `[01b #96]`; route inventory and cross-tenant cases cover all 14 routes.
- [ ] **Step 2:** `pnpm vitest run apps/cloud/test/role-names.test.ts apps/hub/test/auth/renamed-roles.int.test.ts apps/cloud/test/route-inventory.int.test.ts` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `pnpm vitest run apps/cloud/test/role-names.test.ts apps/hub/test/auth/renamed-roles.int.test.ts apps/cloud/test/route-inventory.int.test.ts` → PASS; then `pnpm test`.
- **Done when:** all listed tests pass; `pnpm test` green; `pnpm lint` and `pnpm typecheck` clean; if #55 passes on its first run, the grep scope is wrong: stop.
- [ ] **Commit:** `feat(01b): task 57 role-name and route checks [spec §3.8, R5, D54; tests #55, #96]`

### Task 58: Build log and spec progress — Claude only, **STOP**

**Files:** Modify `docs/reviews/build-log.md`, `docs/specs/README.md` (01b "Implemented, pending page flows and release drill"), this plan's Progress table.

- [ ] **Step 1:** Make the change listed under **Files**.
- **Done when:** the build log lists tasks 1–57 with commits; README status updated; `pnpm test` green on the branch head.
- [ ] **Commit:** `docs(01b): task 58 build log [spec v1.0]`

### Task 59: Page flows 1–3 (Playwright) — Claude only, needs Docker Postgres

**Files:** Create `docs/reviews/01b-e2e.md` (results). Run with the `webapp-testing` plugin against a local cloud and hub (P-4); Playwright is not added to the repo.

- [ ] **Step 1: Tests (write first):** `[01b #49]`; `[01b #50]`; `[01b #51]`.
- [ ] **Step 2:** `webapp-testing plugin, 1440×900 and 390×844, English and Urdu` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `webapp-testing plugin, 1440×900 and 390×844, English and Urdu` → PASS; then `pnpm test`.
- **Done when:** the three flows pass at both sizes in both languages; screenshots referenced in `docs/reviews/01b-e2e.md`.
- [ ] **Commit:** `docs(01b): task 59 page flows 1–3 [spec §10.9; tests #49, #50, #51]`

### Task 60: Page flows 4–6 (Playwright) — Claude only, needs Docker Postgres

**Files:** Modify `docs/reviews/01b-e2e.md`.

- [ ] **Step 1: Tests (write first):** `[01b #52]`; `[01b #53]`; `[01b #54]`.
- [ ] **Step 2:** `webapp-testing plugin, 1440×900 and 390×844, English and Urdu` → FAIL for the stated reason (missing behaviour, not a typo).
- [ ] **Step 3:** Implement the minimum to pass.
- [ ] **Step 4:** `webapp-testing plugin, 1440×900 and 390×844, English and Urdu` → PASS; then `pnpm test`.
- **Done when:** the three flows pass at both sizes in both languages; results recorded.
- [ ] **Commit:** `docs(01b): task 60 page flows 4–6 [spec §10.9; tests #52, #53, #54]`

### Task 61: Release drill on the hubs — needs hardware

**Files:** None in the repo; Claude records the result in `docs/reviews/build-log.md`.

- [ ] **Step 1:** Make the change listed under **Files**.
- **Done when:** cloud released first with `0005` applied; each hub upgraded one at a time; after each, the branches page shows "Up to date" for that branch within `hub_stale_after_ms`; the 01a §7.8 step "never redeploy a cloud build older than 01b" read out and ticked.
- [ ] **Commit:** `— (no code; Claude commits the build-log entry)`
