# Module 00 design hand-off: build plan

Source of truth for the look: `00-design.md` + `frames/`. Source of truth for behaviour: `docs/specs/00_Hub_Platform_Access_Spec_v1.3.md` (CLAUDE.md: the spec wins; behaviour changes go spec-first).

## A. Read this first: where the hand-off and the repo disagree

The hand-off assumes some things the repo doesn't have yet. Each one needs a decision before the phase that depends on it.

| # | Hand-off says | Repo / spec says | Proposed handling | Blocks |
|---|---|---|---|---|
| A1 | "Append `kit-00-block.css` to the kit-additions file the repo uses"; "fix `.pos-list__name span` in the existing kit additions"; check: "01a stock chips show tone colour" | No kit-additions file is in the repo. `packages/ui-kit/components/bundle.css` (125 lines) is the base kit only. `.pos-page`, `.pos-appbar`, `.pos-shell`, `.pos-sidenav`, `.pos-list`, `.pos-chip`, `.pos-seg`, `.pos-tiles` and `.pos-checklist` don't exist yet. The 01a redesign was never merged, and `/admin/stock` uses base classes only, so it has no chips to fix. | Append the **whole** `kit/kit-additions.css` (01a additions with the `> span` fix, plus the 00 block) to `bundle.css`. Every 00 frame needs the 01a classes. The 01a check becomes "the stock page still renders unchanged". | Phase 1 |
| A2 | Fonts come from the kit | ~~Mono and Urdu woff2 missing~~ **Wrong. All 6 fonts are already in `packages/ui-kit/fonts/`** (found in Phase 1). | Nothing to do. | — |
| A3 | Every page gets `lang`/`dir` from the device language and works in Urdu RTL | Spec M82 + test #136: pages set `lang="en" dir="ltr"`, EN table only, "Urdu (UR) is added later (D12)". The hub doesn't store a device language. | **Spec change needed (00 v1.3).** Add a `UR` table to `strings.ts`. Pick the language from `navigator.language` (`ur*` → ur), with a `?lang=` override. Set `lang`/`dir` on the client, and change test #136. | Phase 3 |
| A4 | Q3: new `GET /admin/queries/lockouts` | Not in the spec. It runs through the generic query route (§6.2), so §6.33 doesn't count it as a new endpoint, but it is a new contract. | **Spec change (00 v1.3):** add it as §6.18a. The fallback the hand-off allows is to ship People only, from `login-roster`. | Phase 4/5 |
| A5 | Q9: devices query adds `revoked_reason`, `revoked_by_name` | §6.17 response has neither. | **Spec change (00 v1.3):** add both fields to §6.17. | Phase 4 |
| A6 | Q1: new page `/admin` (00-S20, S16–S19) | Not in the spec. Static pages aren't counted in §6.33, but the page list there, §3.9 route guards and §8.2 all name only 4 pages. | **Spec change (00 v1.3):** add the `/admin` page in group `admin-bootstrap` (same guard as `/admin/approve`), plus its client rules (§8.2). | Phase 5 |
| A7 | Q2: `/setup` after provisioning returns 404 with a styled page | Spec: plain 404. | **Spec change (00 v1.3), small:** same status, HTML body. | Phase 3 |
| A8 | 00-S08 station **tiles** from branch config, with "what it cooks" | The approve page loads with no credentials. `GET /queries/branch-config` needs a **device** session, and a bootstrap admin (installer laptop) has none. No admin query returns stations. | **Spec change (00 v1.3):** pick one of (a) a new admin query `GET /admin/queries/stations` (`access-hub-admin`) returning `[{station_id, name, categories[≤3]}]`, or (b) have `GET /admin/approve` render the station list into the page. Recommend (a). | Phase 3 |
| A9 | Phase 4: build `RevokeDevice`, `GenerateDevicePairingToken`, `ForceLogoutSession`, `ClearPinLockout`, devices and sessions queries | All six already exist (`apps/hub/src/commands/*.ts`, `queries/devices.ts`, `queries/sessions.ts`), at the spec paths. | Phase 4 shrinks to A4, A5, A8 + the Q8 heartbeat check + tests for anything missing. Nothing gets rebuilt. | — |
| A10 | Inventory path `docs/design/inventory/00-hub-platform.md` | The file is `docs/design/inventory/00-hub-access.md`. | Use the real file. Fix the path in `00-design.md` during Phase 6. | — |
| A11 | Spec M82: "element ids `screen`, `setup`, `login`, `roster` and class `display-code` stay" | The frames don't use them. | Keep those ids/classes on the restyled markup (test #136). | Phase 3 |

**Phase 0 status (2026-10-26):** draft spec `00_Hub_Platform_Access_Spec_v1.3.md` written. A3 → M83, A7 → M84, Q7 → M85, A6 → M86, A5 → M87, A4 + A8 → M88 (`stations` query, option a), plus two found while drafting: M89 (`/admin` needs the admin's permissions; `GET /queries/session` needs a device session) and a `staff` query in M88 (Add a phone needs every staff member; `login-roster` lists admins only). M90 keeps the endpoint budget. The approve page code stays in `commands/approve-pairing-request.ts` (no folder change). **Approved by the owner 2026-10-26.** Plan tasks 77–81 in `docs/plans/00-plan.md`. The `stations` query and sign-in `permissions` move into phase 3 (the approve page needs them).

**Proposal (original):** add a **Phase 0: spec 00 v1.2.1 → v1.3** (A3–A8 as decisions M83–M88, test changes #136 + new tests, §6.2/§6.17/§8.2 edits). Show it to you for approval, then build. Per CLAUDE.md the hostile review (pipeline step 4) would apply to a minor version too. Tell me if you want that, or if an approval by you is enough for a UI-driven bump. Phase 1 (kit only, no behaviour) and Phase 2 (client helper for codes the spec already defines) can go ahead before v1.3 is approved.

## B. Places where a recommended answer changes behaviour

| Q | Change | Where it will live |
|---|---|---|
| Q1 | New hub admin home + shell at `/admin` | `apps/hub/src/admin/page.ts` (new), route in `admin/routes.ts` (new), registered in `server.ts` |
| Q2 | `/setup` after provisioning: styled 404 page instead of a bare 404 | `apps/hub/src/setup/provision.ts` (`GET /setup`), `setup/page.ts` (`setupAlreadyPage()`) |
| Q3 | New query `lockouts`: staff + device + ip lockouts | `apps/hub/src/queries/lockouts.ts` (new), `queries/registry.ts` |
| Q5 | **Blocked**: 00-S08 keeps two types (Cashier / Kitchen) | — |
| Q6 | F03 shows `details.staff_wifi_name` when present, else `global.wifi_body_unknown`. The config field itself is 01b's and isn't built here. | `apps/hub/src/lib/global-state.ts` (client helper) |
| Q7 | `/setup` host field becomes a pick-list of this machine's IPv4 addresses + "Other address" | `setup/page.ts` (server renders the list from `os.networkInterfaces()` through `lib/net.ts`) |
| Q8 | "Not seen" warn after 2 min; check that KDS activity refreshes `last_seen_at` ≤ 30 s | `admin/page.ts` (client), check `auth/session-store.ts` activity + `auth/session-sweeper.ts` |
| Q9 | Devices query returns `revoked_reason`, `revoked_by_name` | `queries/devices.ts` |
| Q4, Q10 | Out of scope (06 / 03b) | — |

## C. Phases → screens → files

### Phase 1: Kit
- `packages/ui-kit/components/bundle.css`: append `kit/kit-additions.css` (A1), already containing `.pos-list__name > span`.
- `apps/hub/src/lib/page.ts` `ICONS` + `packages/ui-kit/README.md` icon table: `unlock tablet plus grid box printer gauge qr logout search reload download camera link` (+ any the frames use that are missing, e.g. `x`, `flame`, `back`), with paths copied from the frames.
- `PAGE_CSS` in `lib/page.ts` defines its own `.pos-page`. It stays until Phase 3. Only side effect: the kit's `.pos-page *` border-box shrinks the status-icon circle on `/admin/bootstrap` and `/admin/approve` a little.
- Check: hub + client tests green; `/admin/stock` and the 4 existing pages render the same as before (screenshot before/after).

### Phase 2: Global-state helper (00-F01…F08)
- `apps/hub/src/lib/global-state.ts` (new). Pure `globalStateFor(signal, ctx)` → `{ id: 'F01'…'F08', mode: 'banner'|'screen'|'retry', … } | null` and `reconnectDelayMs(attempt)` (0.5 → 5 s), embedded in page scripts with `toString()` like `encodeCrockford128`. Plus `globalStateClient()`, a page-script string with `renderGlobalState(state, actions)` and `startReconnect(probe, onUp)`. Pages opt in with `${globalStateClient()}` after `clientPrelude()`. It isn't in the prelude itself, which avoids an import cycle with `page.ts` and keeps pages that don't need it smaller. Follows spec §8.4: `4403` before auth → F03, `4401` with reason `replaced` → not global (03b).
- Later modules: the React client gets the same mapping as `apps/client/src/api/global-state.ts` when 01a/02 adopt it. Not in this hand-off.
- Tests: `apps/hub/src/lib/global-state.test.ts`, one per code / close code (1012, fetch fail, DEVICE_TOKEN_INVALID, DEVICE_REVOKED, 4403, GUEST_NETWORK_FORBIDDEN ± wifi name, CLIENT_UPGRADE_REQUIRED, 4426, SERVICE_UNAVAILABLE first/second, HUB_NOT_PROVISIONED, HOST_NOT_ALLOWED, 4401-after-rotate).

### Phase 3: Restyle existing pages (needs A3, A7, A8 approved)
| IDs | File(s) | Frames |
|---|---|---|
| S01, S02 | `setup/page.ts`, `setup/provision.ts` (Q2, Q7), `lib/net.ts` (interface list) | Main, Setup* |
| S03–S05 | `auth/admin-bootstrap.ts` | Boot* |
| S06–S09 | `commands/approve-pairing-request.ts` (page part; move it to `auth/approve-page.ts` only if you agree, since it's a folder-structure change) + stations source (A8) | Approve* |
| S10–S11 | `auth/pair-page.ts` (screen branch), `auth/pairing.ts` | Pair* |
| S12–S15 | `auth/pair-page.ts` (phone branch) | Phone* |
| all | `lib/strings.ts` (EN changes from §2 + `UR` from `*Urdu` frames), `lib/page.ts` (lang/dir), `urdu-todo.md` | *Urdu |
- Error code → UI-state mapping tests per page (`apps/hub/src/**/page-states.test.ts`); `test/ui-pages.int.test.ts` updated for #136.
- Check: walk F1 and F3 on a local hub; Playwright screenshots in en/ur at the frame sizes into `screens/`.

### Phase 4: Backend (needs A4, A5, A8 approved)
- `queries/devices.ts`: `revoked_reason`, `revoked_by_name` (Q9).
- `queries/lockouts.ts` (Q3), plus `queries/stations.ts` if A8(a).
- Q8: confirm the KDS keeps `last_seen_at` fresh (≤ 30 s). Change it only if it doesn't.
- Existing 4 commands: add only the missing tests (permission denied, happy path, idempotent result, audit row).

### Phase 5: New admin pages (needs A6 approved)
| IDs | File(s) | Frames |
|---|---|---|
| S20 shell + home | `apps/hub/src/admin/page.ts`, `admin/routes.ts` (new) | AdminHome |
| S16 + D01 | same page, view `devices` | Devices*, DevicesRemove* |
| S17 | view `add-phone` (QR SVG from `lib/qr.ts` via the command result) | AddPhone* |
| S18 + D02 | view `sessions` | Sessions* |
| S19 + D03 | view `lockouts` | Lockouts* |
- One page with hash views (`#devices`, …), same sign-in as S07, `sessionStorage` session, permissions from `GET /queries/session`. "Other jobs" shows only Stock (`/admin/stock`); 03a/03b/06 routes don't exist yet, so those items are hidden.
- Check: walk F2 and F4, screenshots.

### Phase 6: Docs and report
- `docs/design/ui-brief.md` §1 → points to `00-design.md`; `00-design.md` updated (paths, A1–A11); new questions appended to `docs/design/open-questions/00-hub-platform.md`; final report.

## D. Blocked / out of scope
- Q5 waiter tablets: blocked, two types only.
- Q4 (06), Q10 (03b): not built.
