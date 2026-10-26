# Module 01a design hand-off: build plan

Source of truth for the look: `01a-design.md` + `frames/` (Parking* ignored). Source of truth for behaviour: `docs/specs/01_Restaurant_Setup_Spec_v1.1.md` (CLAUDE.md: the spec wins; behaviour changes go spec-first).

Module 00 Phase 1 (kit) is done (`e2d63aa`): `packages/ui-kit/components/bundle.css` already holds the whole `kit-additions.css` (01a + 00 blocks, `.pos-list__name > span` fix). `kit/kit-additions.css` here is byte-identical to the 00 copy, and every `pos-*` class used in the 01a frames exists in `bundle.css`. No kit change is planned.

## A. Read this first: where the hand-off and the repo disagree

| # | Hand-off says | Repo / spec says | Proposed handling | Blocks |
|---|---|---|---|---|
| A1 | Every text in English **and Urdu**; Urdu from `OwnerMenuUrdu`, `StockUrdu` | 01a §8.3: "English only until Urdu is added (00 M82)". `apps/client/src/i18n/` has `en.ts` only. 00 v1.3 M83 added Urdu to the hub pages only. | **Spec change (01a v1.1):** `i18n/ur.ts` with the same keys, missing keys fall back to EN (`urdu-todo.md`); language picked once on load exactly as 00 M83 (`?lang=`, `localStorage` `pos-lang`, `navigator.language`); `lang`/`dir` on `<html>`. Same origin as the hub pages, so the stock page shares the 00 choice. | Phase 1 (i18n plumbing), 2, 3 |
| A2 | Stock wording: "Left to sell", "x on orders", "Selling On/Off", "Still right", "Counted last night 23:10"; B12 "Keep it open" / "Close it and start today" | §8.2 quotes "On hand", "Reserved", "Available", "Available / Off", "Confirm", "Set at 11:05", "Close and start new day", "Keep this day open" | **Spec change (01a v1.1):** §8.2 text follows the design. No field or command changes. | Phase 3 |
| A3 | Stock filters To count / Low or out / Off / All + search | §8.2: search box **and a category filter** | Keep the category select (spec) next to the new level filter. Or drop it in v1.1 if you prefer the design. **Recommend keep both.** | Phase 3 |
| A4 | Q4: typed counts kept in `localStorage` after an idle sign-out | Not in the spec (the hand-off says "spec line needed") | **Spec change (01a v1.1):** add the hand-off's line to §8.2, with the key `stock-draft:<device>:<business_date>:<staff_id>` and the clear rules. | Phase 3 |
| A5 | Q5: "All N are still right" | §8.2: Save counts sends rows the user touched or confirmed one by one | **Spec change (01a v1.1):** one tap marks every carried-over row not yet typed as confirmed, then one `SetPrecookedStock`. No new command. | Phase 3 |
| A6 | Q1: bulk add tables "T1 to T12" | §6.7 / §12.4: "Bulk table create is not built" (meant an endpoint) | Client loop over `POST …/tables` only, no endpoint. **Spec change (01a v1.1):** one line in §8.1 so §12.4 isn't read as forbidding it. Key per table = derived from one ULID per form open + table name (needs a deterministic derivation; see B). | Phase 2 |
| A7 | Q7: Menu opens without a branch; Q8: branch in `sessionStorage`, auto-pick one branch | §8.1 `#/` is the branch picker; `App.tsx` requires a branch for `#/menu` and keeps it in memory | **Spec change (01a v1.1)**, small: §8.1 table rows. | Phase 2 |
| A8 | D01 "Archive Breakfast? Its 9 items stop showing too" (`OwnerArchiveCategory`) | §6.13: archiving a category **with active items → `409 CONFIG_IN_USE`**. It can't be archived with items. | Treat category like station: confirm dialog only when it has no active items; with items, the blocked dialog ("{name} can't be archived yet · Move or archive these items first") listing names. **The `OwnerArchiveCategory` frame text is not built.** New string keys `archive.category_blocked*`. | Phase 2 |
| A9 | Item phone: "On sale at both branches" switch (`OwnerItemPhone`) | No item-level "on sale" field. The nearest is the per-branch route (`PUT …/routes/:b {station_id:null}`), which also drops the station and recipe. Availability On/Off is the hub's `SetItemAvailability`, not the cloud. | Show it as a read-only status line ("On sale at 2 of 2 branches") with the Kitchen row's Edit. **No switch.** | Phase 2 |
| A10 | Counts the API doesn't return: branch picker "2 floors · 3 stations"; tab "Items 42"; category/tax "item count"; archive "Its 9 items"; station-blocked item **names** (`CONFIG_IN_USE` gives ids only) | §6.11 menu is paged (50), no total; no per-branch summary until 01b | Branch picker: show the ID tail only (counts come with 01b). Items tab: count only once `next_cursor` is null, else no number. Category/tax item counts: not shown. Names for `used_by.ids`: one `GET /v1/admin/menu?limit=200` (pilot menu is < 200 items) and show names that resolve, plus "and N more". "Open these items" → Menu tab (no station filter in §6.11). | Phase 2 |
| A11 | Side nav brand "Arif Chatkhara" + owner **email** in the foot | Login returns `user_id, display_name, tenant_id, allowed_branch_ids`; no tenant name, no email | Brand shows "Restaurant setup" only; foot shows `display_name`. | Phase 2 |
| A12 | Owner Sign out calls `POST /v1/auth/logout` | Endpoint exists (cloud `owner-auth/routes.ts`); `cloud-admin.ts logout()` only clears storage | Make `logout()` send the existing call (best effort), then clear. Not a contract change. | Phase 2 |
| A13 | S10 roster "filtered to `manage-stock`"; `StockPinNobody` "No one here can count stock" | `/admin/login-roster` lists every hub admin with `role_names`, `locked_until`; no permissions. Filtering needs a contract change. | Show the roster as-is. "Nobody" = empty roster. A signed-in admin without `manage-stock` gets the existing `PERMISSION_DENIED` text. | Phase 3 |
| A14 | B04 "retry with backoff ≤ 5 s; Save disabled until a request succeeds" | No cloud health route for the owner app | Retry the call that failed (a GET re-reads the view; a failed save is **not** auto-resent), backoff 0.5 → 5 s like 00 `reconnectDelayMs`. Save is disabled while the banner shows; values kept. | Phase 2 |
| A15 | Mount `/admin/stock` inside the 00-S20 shell | 00-S20 exists (`apps/hub/src/admin/page.ts`, server-rendered vanilla JS). The stock page is React in `apps/client`. Same origin; same `sessionStorage` keys (`admin_session_token`, `admin_staff_id`). | Recommend: the stock page draws the same `.pos-shell` / `.pos-sidenav` in React (items link to `/admin#devices` etc., Stock current), shown from tablet width; phone keeps the stand-alone app bar. Branch name: from `config-status`'s `branch_id` tail (no name in the stock answers). | Phase 3 |
| A16 | Q4 key `stock-draft:<device>:…` | The stock page doesn't know a device id (the device token is opaque) | Use the provisioned `branch_id` from `config-status` in its place (one hub per branch, so "this device" = this browser + this branch). | Phase 3 |

**Phase 0 status (2026-10-26):** draft spec `01_Restaurant_Setup_Spec_v1.1.md` written. A1 → S49; A8, A9, A10, A11, A12 → S50; A6 → S51; A7 → S52; A14 → S53; A2, A3 (keep both filters), A13, A15 → S54; A4, A16 → S55; A5 → S56. Tests 159–172; plan tasks 77–80 in `docs/plans/01a-plan.md`. Hostile review 3 (`docs/reviews/01a_spec_review_3.md`) applied the same day; changes that affect the build: the stock page writes and clears 00's five admin session keys (S54 g); drafts keyed by `opened_at` with a per-row `base_set_at` (S55, replaces A16's `business_date`); saves over 200 rows split (S56); bulk add checks names before sending (S51); B03 partial save, B16 and B17 lines named (S50 h, S54 h). **Approved by the owner 2026-10-26.**

**Proposal:** a **Phase 0: spec 01a v1.0.2 → v1.1** (A1, A2, A3 if you pick "drop", A4–A8, A15 as numbered decisions; §8.1, §8.2, §8.3 edits; new tests). Same path as 00 v1.3: shown to you for approval, no hostile review unless you want one. **Phase 1 needs only A1's i18n plumbing**, so it can start before v1.1 is approved if you're fine with that.

## B. Places where a recommended answer changes behaviour

| Q | Change | Where it will live |
|---|---|---|
| Q1 | Bulk add tables: one POST per table, stop on first error, "Adding 4 of 12…". Key per table: `newUlid()` per form open + table name, hashed into a ULID-shaped key so a retry of the same form gives the same key. | `features/owner/floors/bulk-add.ts` (new, pure loop + key), used by `FloorsView.tsx`, `FloorsFirstRun.tsx` |
| Q2 | Confirm before archiving item / category / station / tax rate / floor; tables and recipes archive at once with an 8 s Undo chip; Discard? on a dirty form | `components/ConfirmDialog.tsx`, `components/UndoChip.tsx`, `features/owner/dirty-guard.ts` (new) |
| Q3 | Stock page "Signed in as … · Sign out" → `POST /admin/auth/logout` | `features/admin/stock/StockApp.tsx`, `api/hub-admin.ts` (call exists on the hub; add the client method) |
| Q4 | Unsaved counts survive an idle sign-out (same staff + business date + this hub); cleared on save, discard, new day | `features/admin/stock/draft.ts` (new) |
| Q5 | "All N are still right" callout | `features/admin/stock/CarryOver.tsx` (new) |
| Q6.3, 6.12 | Already built (field "When it runs out"; hours badge) | — |
| Q7 | `#/menu` works with no branch picked | `features/owner/App.tsx` |
| Q8 | Branch kept in `sessionStorage` `owner_branch_id`; one branch → auto-pick | `features/owner/App.tsx`, `BranchPicker.tsx` |
| Q6.5, 6.10, 6.13 | **Blocked**, not built | — |

## C. Phases → screens → files

All paths under `apps/client/src/`. Existing tests stay green; tests listed per phase are new.

### Phase 1: Shared components
| Component | File (new unless noted) | Kit classes | Tests |
|---|---|---|---|
| AppBar | `components/AppBar.tsx` | `.pos-appbar`, `--phone` | renders title/start/end slots |
| SideNav (+ phone tab bar) | `components/SideNav.tsx` | `.pos-shell`, `.pos-sidenav`, `.pos-actionbar` | `aria-current`, keyboard, RTL |
| List / ListRow | `components/List.tsx` | `.pos-list`, `--menu`, `--stock`, `--stack` | column preset class |
| Switch | `components/Switch.tsx` | `.pos-switch` | `role="switch"`, `aria-checked`, Space/Enter |
| Segmented | `components/Segmented.tsx` | `.pos-seg` | `aria-pressed`, arrow keys, RTL order |
| Chip | `components/Chip.tsx` | `.pos-chip--*` | icon + word always |
| ActionBar | `components/ActionBar.tsx` | `.pos-actionbar` | — |
| EmptyState | `components/EmptyState.tsx` | `.pos-empty` | — |
| Skeleton | `components/Skeleton.tsx` | `.pos-skeleton` | `aria-busy` |
| SavedChip / UndoChip | `components/FlashChip.tsx` | `.pos-chip--ok` | 3 s / 8 s with fake timers; Undo calls back |
| ConfirmDialog (+ form dialog) | `components/Dialog.tsx` | `.pos-dialog`, `--form` | focus trap, Escape, focus returns to trigger |
| StaffTiles (changed) | `components/StaffTiles.tsx` | `.pos-staff__tile.is-locked` | "Locked · 14 min" rounded up from `locked_until` |
| BusyButton (kept) | `components/BusyButton.tsx` | — | existing test |
| Icons | `components/Icon.tsx` | `.pos-icon` | paths copied from the frames / `apps/hub/src/lib/page.ts` `ICONS` |
| i18n plumbing (A1) | `i18n/index.ts` (changed), `i18n/ur.ts` (new, empty until Phase 2), `i18n/lang.ts` (new) | — | pick order as 00 M83; fallback to EN; `{name}` params |

Check: unit tests per component (keyboard, ARIA, RTL), lint (`style` prop still banned), `pnpm test`. The repo has no story/demo page, so none is added.

### Phase 2: Owner app
| IDs | File(s) | Frames |
|---|---|---|
| Shell, S02, Q7, Q8 | `features/owner/App.tsx`, `BranchPicker.tsx`, `Shell.tsx` (new: SideNav + phone tab bar, branch select, Sign out) | OwnerBranchPicker, nav in every Owner frame |
| S01, B04 | `features/owner/login/LoginView.tsx`; `features/owner/CloudDown.tsx` (new B04 banner + retry) | OwnerLogin, OwnerLoginCloudDown |
| S03, D01 floor, Q1 | `features/owner/floors/FloorsView.tsx`, `TableDialog.tsx`, `FloorsFirstRun.tsx`, `bulk-add.ts` (new) | OwnerFloors*, OwnerTableDialog, OwnerArchiveFloor |
| S04, D01 station | `features/owner/stations/StationsView.tsx`, `StationDialog.tsx`, `RecipeDialog.tsx` (new, split from the view) | OwnerStations, OwnerAddStation, OwnerAddRecipe, OwnerArchiveStation |
| S05, B01, tax | `features/owner/menu/MenuView.tsx` (tabs), `ItemsTab.tsx`, `CategoriesTab.tsx`, `TaxTab.tsx`, `TaxDialog.tsx`, `FirstRun.tsx` | OwnerMenu*, OwnerTaxDialog |
| S06, C01 | `features/owner/menu/CategoryForm.tsx` → dialog; `WindowsField.tsx` restyled (`.pos-hours-row`, wrap/same/format/overlap messages) | OwnerCategoryDialog, OwnerItemErrors |
| S07, B02, B03 | `features/owner/menu/ItemForm.tsx` (sections + aside + fix list), `ItemPhone.tsx` (new, price-first), `reasons.ts` (new: `CONFIG_REFERENCE_INVALID` reason → text) | OwnerItem, OwnerItemNew, OwnerItemErrors, OwnerItemPartial, OwnerItemCloudDown, OwnerItemPhone |
| D01, D02 | `components/Dialog.tsx`, `features/owner/dirty-guard.ts` (new) | OwnerArchive*, OwnerDiscard |
| Errors | `features/owner/form.ts` `errorText` → per-code + per-reason mapping; `errors.*` keys | — |
| Strings | `i18n/en.ts` (§2 keys + A8 keys), `i18n/ur.ts` from OwnerMenuUrdu, `docs/design/handoff/01a/urdu-todo.md` | OwnerMenuUrdu |

Tests: error code → UI text (every code + every `reason`); bulk add (key per table stable across a retry; stops on first error, names it; progress text); dirty guard (Cancel / Back / nav on a dirty form → D02, clean → none); sessionStorage branch + single-branch auto-pick; menu without branch. Existing `App`, `FloorsView`, `StationsView`, `MenuView`, `ItemForm` tests updated for the new markup only, assertions kept.

Check: owner app locally (cloud + Postgres from `docker-compose.yml`), walk flow 1 (first setup) and flow 6 (Naan 30 → 35 on a phone, ≤ 5 taps). Playwright via `@vitest/browser-playwright` if its browsers are installed, else ask: 1440×900 and 390×844, en + ur, into `docs/design/handoff/01a/screens/`.

### Phase 3: Hub stock page
| IDs | File(s) | Frames |
|---|---|---|
| S10 | `features/admin/stock/AdminLogin.tsx` (roster states: loading skeleton, nobody, wrong PIN with `attempts_remaining`, locked minutes, hub unreachable + Retry now) | StockPin, StockPinError, StockPinNobody, StockPinOffline |
| Shell, B11, Q3, A15 | `StockApp.tsx`, `StockShell.tsx` (new: appbar with day chip, menu chip, name, Sign out, Close day; side nav on tablet) | every Stock frame |
| B10 | `ConfigStatus.tsx` → chip + danger banner | Main, StockMenuProblem |
| B12, B13, B18, D10 | `StalePrompt.tsx`, `StartDay.tsx`, `BusinessDayBar.tsx` → cards and dialog | StockStale, StockNoDay, StockNotSaved, StockOpenedRecently, StockCloseDay |
| B14, filters | `AlertBar.tsx` → chips (tap scrolls to the row); `StockFilters.tsx` (new: level seg + category + search) | Main |
| S11 rows, B15, B17 | `StockTable.tsx` → `.pos-list--stock` rows; `AddSheet.tsx` (new, phone +5/+10/+20/+50); `badges.ts` | Main, StockPhone, StockAddSheet, StockFeedback, StockNoMatch |
| B16 | reconnect banner + "N counts waiting" in `StockApp.tsx` | StockOffline |
| Q4, Q5 | `draft.ts`, `CarryOver.tsx` (new) | StockCountsKept, StockConfirmAll |
| Strings | `i18n/en.ts` `stock.*`, `i18n/ur.ts` from StockUrdu | StockUrdu |

Tests: Q4 restore (same staff + date only; cleared on save, discard, new day; other staff doesn't see it); Q5 (one `SetPrecookedStock` with the carried-over rows' shown values; rows typed first keep the typed value); poll never overwrites a row being edited; retry after `BUSINESS_DAY_NOT_OPEN` keeps the `command_id`; locked minutes rounded up. Existing `StockTable`, `BusinessDay`, `AdminLogin` tests updated for markup and wording only.

Check: local hub, walk flows 2 (morning count with the stale prompt), 3 (lunch top-up), 5 (night close) at 1280×800 and 390×844; screenshots as Phase 2.

### Phase 4: Docs and report
- `docs/design/ui-brief-01a.md` "Design status" → `01a-design.md`.
- `01a-design.md` here corrected to what was built (A8–A16).
- `docs/design/open-questions/01a-setup.md` exists (copied 2026-10-26); new questions appended (A3, A9, A10, A13, A15 if you leave them to me).
- Report: per phase, tests, blocked Q6.5 / 6.10 / 6.13, where each recommended answer lives, what's not done.

## D. Blocked / out of scope
- Blocked: Q6.5 (same prices everywhere; nothing in 01a changes either way), Q6.10 (owner data), Q6.13 (kg rounding; 02/05).
- Out of scope: image upload, 2-D floor plan, days of the week, branch names and settings (01b), variants/modifiers/deals (01c), Parking* frames (02).
