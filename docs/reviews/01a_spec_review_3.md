CHANGES NEEDED

# 01a spec review 3 — `01_Restaurant_Setup_Spec_v1.1.md` (DRAFT)

Reviewer stance: hostile, did not write the spec. Scope: what v1.1 changed over v1.0.2 (`git diff -M HEAD -- docs/specs/`): S49–S56, §8.1–§8.3, test 77, tests 159–168, the §12 rows touched. Read: the diff; `docs/design/handoff/01a/PLAN.md` §A, `01a-design.md`, `docs/design/open-questions/01a-setup.md`; spec 00 v1.4 M83, M86, M89 (and M42, M46, M59 they lean on); foundation §6; 01a S7, S33, S35 j, §6.2–§6.21; code `apps/client/src/**`, `apps/cloud/src/lib/idempotency.ts`, `apps/cloud/src/modules/owner-auth/routes.ts:55–75`, `apps/hub/src/admin/page.ts:795–850`, `apps/hub/src/lib/page.ts:118–145`, `apps/hub/src/auth/signin-client.ts:60–80`, `packages/domain/src/ids.ts`, `packages/ui-kit/tokens.css`.

Summary: 3 Blockers, 7 Should-fix, 10 Nits. The "no API, contract, error code or migration change" claim holds for the server: every endpoint, field and error the new decisions use exists (checked below). It does not hold for the **client-side storage contract with the 00 `/admin` page**, which v1.1 makes a first-class neighbour (B2). The other two blockers are in the new behaviour itself: a failed owner save leaves Save disabled with nothing that can clear the banner (B1), and a restored stock draft can overwrite newer counts (B3).

---

## Blockers

### B1. After a failed save, nothing can clear the cloud-down banner, so Save stays disabled (S53, test 165)

**What the spec says.** S53: a network failure shows the banner; "save buttons are disabled while it shows"; "a failed read is retried after 0.5 s, doubling to at most 5 s; a failed save is never re-sent by itself. The first successful call clears the banner." PLAN A14: "Retry the call that failed (a GET re-reads the view; a failed save is **not** auto-resent)".

**Failure scenario.** The owner opens Naan on a phone (the view's GET succeeds), types 35, taps **Save price**. Mobile data drops for two seconds; the `PATCH` fails with a network error. The banner shows and Save is disabled. No read failed, so no read is retried; the save is not retried by rule. No call is ever made again, so "the first successful call" never happens: the banner stays and Save stays disabled until the owner leaves the form, which the dirty guard (S50 c) turns into "Discard your changes to Naan?", i.e. the typed value is lost, the opposite of "typed values stay". Same on `#/login` (`OwnerLoginCloudDown`): the login `POST` fails, nothing retries, the banner never clears. Test 165 tests the two halves separately ("network failure on save → … Save disabled, the save not re-sent"; "a failed read retried …"), so it passes against the deadlock.

**Fix.** S53: "After a failed **write**, the page probes with a read (the current view's own `GET`, e.g. §6.2, §6.8 or §6.11 with `limit=1`) on the same backoff; the probe's answer never replaces values in an open form. The first successful call clears the banner and re-enables Save; the user re-taps Save, which re-sends with the form's same `Idempotency-Key` (S35 j)." For `#/login` (no JWT, so no read is possible), do not disable **Sign in**: show the banner and let the user retry. Test 165: "save fails → banner, Save disabled → (fake timers) probe `GET` at 0.5 s fails, at 1 s succeeds → banner gone, Save enabled, typed price still 35, exactly one `PATCH` sent so far".

### B2. The stock page and the 00 `/admin` page share one admin session but not its keys (S54 e, S54 f, S55; 00 M86, M89)

**What the spec says.** S54 e: header "Signed in as {name}" and **Sign out** "sends the existing `POST /admin/auth/logout`, then shows the roster". S54 f: from tablet width the page draws the 00-S20 side menu with links to `/admin#…`. S55: the draft key ends with `<staff_id>`. Nothing says which `sessionStorage` keys either page reads or writes.

**What the code does.** `/admin` (`apps/hub/src/admin/page.ts:816–830`) writes and clears **five** keys: `admin_session_token`, `admin_staff_id`, `admin_name`, `admin_permissions` (M89), `admin_bootstrap`; it skips its own sign-in when `admin_session_token` is present (`:846`). The stock page (`apps/client/src/api/hub-admin.ts:22–23, 100–103, 174–176`) writes and clears only the first two.

**Failure scenario.** Shared tablet. Imran (manager, `manage-devices`) signs in on `/admin`, then taps Stock in the side menu (M86). Later he taps **Sign out** on the stock page: the token and staff id go, `admin_name = "Imran"` and `admin_permissions = {manage-devices: true, …}` stay. Bilal (cook, `manage-stock` only) signs in on the stock page, then taps Devices in the S54 f side menu. `/admin` finds a token, skips sign-in, and shows **"Imran"** in the side menu foot with Imran's buttons (M89 hides by `admin_permissions`). The server still refuses Bilal's actions (`403`), but the screen says the wrong person is signed in on a shared device, which is the failure Q3 ("must not save counts under Imran's name") exists to prevent. The other way round: Bilal signs in on `/admin` and opens `/admin/stock`; the stock page never saw a login response, so "Signed in as {name}" has no source. The idle sign-out path (`clearSession()` on `ADMIN_SESSION_REQUIRED`) leaves the same two stale keys.

**Fix.** S54: "The stock page uses 00's admin session keys: on login it writes `admin_session_token`, `admin_staff_id`, `admin_name` (`display_name`) and `admin_permissions` (M89) as `/admin` does; it reads the header name from `admin_name`; Sign out, and any `signed_out` answer, remove all five keys (`admin_bootstrap` included)." S55 takes `staff_id` from `admin_staff_id` read when the edit is made. This is a client contract with 00, not an API change, so v1.1's claim survives once it is written down. Test 168 (or a new one): "after a stock-page Sign out, `sessionStorage` has none of the five keys; a session started by `/admin` shows its `admin_name` on the stock page".

### B3. A restored draft can be older than the stock it overwrites (S55, with S33)

**What the spec says.** S55: drafts are keyed `stock-draft:<branch_id>:<business_date>:<staff_id>` and restored "while the **same** business day is open"; restored rows "come back as touched", so **Save counts** sends them as `SetPrecookedStock` (§6.17, one `StockSet` per entry, which replaces `on_hand`). The only staleness check is the unit. S33: "`business_date` is only a **label** … never a key."

**Failure scenario 1 (same day, hours later).** 09:31 Imran types Paye 40 and is signed out for being idle before saving. 12:30 Bilal (another tablet) records a lunch top-up, Paye +20 (`StockAdded`, §6.17a), and a re-count to 55. 14:00 Imran signs in: "Your 7 unsaved counts from 09:31 are back". He adds one new count and taps Save. Paye is sent as `on_hand: 40` and replaces 55: 15 plates of real stock disappear from `availableStock`, and the restored values look exactly like fresh entries.

**Failure scenario 2 (two days, one label).** The day is closed at 11:00 after a power cut and a new day is opened at 15:05 (past the 4 h `day_min_gap_hours`) on the same hub date. Both days carry `business_date = 2026-10-26`. A draft from the morning day is restored into the afternoon day, against the count S33 says must be redone at a day open.

**Fix.** (a) Key the draft by the open day's `opened_at`, not `business_date` (`stock-draft:<branch_id>:<opened_at>:<staff_id>`; delete every other `opened_at` for this branch on load). (b) Store each entry's base: `{ item_id, on_hand, unit, base_set_at }` (the row's `set_at` when the value was typed). On restore, an entry whose current `set_at` differs from `base_set_at` (someone saved or added since) is **not** restored as touched; list those as "Changed since: Paye (now 55)" so the user decides. (c) Optionally expire a draft after a fixed age (e.g. 2 h). Test 166 gains: "a `StockAdded` after the draft was written → that row is not restored as touched"; "same `business_date`, different `opened_at` → nothing restored, draft deleted".

---

## Should-fix

### S-1. Bulk add has no way forward after a name clash, and its key can be reused with a different body (S51, test 163)

**Says.** S51: the loop "stops at the first error and names it; tables already added stay, and **Add** again resumes from the failed one"; keys are form key + *i*; "changing the range or seats renews the form key". S7: only successful responses are stored, so a failed request's key is free again (`idempotency.ts`, key row rolled back).

**Failure.** T5 already exists. Adding T1 … T12: T1–T4 are created, T5 → `409 CONFIG_NAME_TAKEN`. **Add** again re-sends T5 with the same key; the 409 is not stored, so the request runs again and fails again, forever. The only way out is to change the range, which renews the key and restarts at index 0, so T1 → `409` too. The owner must work out "T6 … T12" by hand and still has no T5 (test 163 asserts "**Add** again sends 5 … 12", which a real server cannot give for this error). Second case: the `POST` for T5 succeeds but the answer is lost (phone network); the user switches the floor (or the branch, S52 app bar) and taps Add. The key for index 4 is reused with a different `floor_id` / path → `422 IDEMPOTENCY_KEY_MISMATCH`, shown as a generic error.

**Fix.** S51: (a) before the first `POST`, check the range against the floor list already loaded (§6.2, every floor of the branch) and refuse names that exist, naming them; (b) the form key renews when **any** input that goes into a request changes (range, seats, floor, branch); (c) after a range change, names already present in the loaded list are skipped, not re-sent. Test 163: replace the "same 409 then success" step with "T5 exists in the loaded floors → nothing is sent, T5 is named"; add "lost answer on T5, floor changed → new keys, no `422`".

### S-2. "All N are still right" can exceed `SetPrecookedStock`'s 200 entries (S56, §6.17)

**Says.** §6.17: 1–200 entries. S56: one Save with "every touched row" plus every untouched carried-over row. The current save (`StockApp.tsx:129–145`) sends all touched rows in one command, no split.

**Failure.** A branch with 230 stock-tracked items that carry over (or 150 carried-over plus 60 typed, or a large S55 restore plus the tap): one command with > 200 entries → `400 VALIDATION_FAILED`, nothing saved, and the page shows a generic error. The pilot menu is small (S50 b assumes < 200 items), but the limit is not stated anywhere in v1.1 and §7.5's design size is 5 000 items.

**Fix.** S56 (and §8.2 Save counts): "A save with more than 200 rows is sent as consecutive commands of ≤ 200 rows in config order, each with its own `command_id` kept for its retry (D32); the loop stops at the first failure and keeps the unsent rows touched." Or state the 200-row limit as a pilot assumption in §12.7 and disable the callout above 200 with a text. Test 167 gains a 201-row case.

### S-3. A restored draft can block the whole save, and its life is unclear outside an open day (S55)

**Says.** S55 drops an entry only when its `unit` differs.

**Failure.** Between the idle sign-out and the next sign-in, a config apply removes an item or makes it not stock-tracked. The restored entry is sent; §6.17 rejects the **whole** command with `404 MENU_ITEM_NOT_FOUND` or `422 STOCK_NOT_TRACKED`, so none of the other restored counts save, and the error names an item the user cannot see. Also unstated: what key a draft gets while no day is open (edits before **Start day**, §8.2); whether a **Still right** tap or S56's confirm-all is written to the draft; what an explicit **Sign out** with unsaved counts does (the draft survives; nobody is asked).

**Fix.** S55: drop entries whose item is not in `items_meta` or not `is_stock_tracked`; write no draft while no day is open (or keep it in memory only); Still right and confirm-all are edits; explicit Sign out with touched rows asks "Save, keep on this tablet, or discard?". Add the drop case to test 166.

### S-4. Urdu headings will render in the Latin font (S49)

**Says.** S49 sets `lang` and `dir` on `<html>` and nothing else.

**Failure.** The kit's Urdu rules are `[lang="ur"] .pos-…` selectors, which work, but its type classes do not: `.title` (`tokens.css:15`) has no `[lang="ur"]` rule; the Urdu face is a separate class `.ur-title` (`:22`). 00 handles this by rewriting `display/title/heading/body-lg/body/caption` to `ur-*` (`apps/hub/src/lib/page.ts:136–144`). `apps/client` uses `className="title"` nine times today, and the hand-off adds more. Every Urdu page title would show Nastaliq text in Atkinson's fallback, at Latin line height, which clips Nastaliq.

**Fix.** S49: "as 00 M83, Latin type classes (`display`, `title`, `heading`, `body-lg`, `body`, `caption`) map to the kit's `ur-*` classes in Urdu", through one helper in `src/i18n/`. Test 159 gains: "with `ur`, a `title` heading has class `ur-title`".

### S-5. Owner Sign out after a token refresh revokes nothing (S50 a)

**Says.** S50 a: Sign out "sends the existing `POST /v1/auth/logout` with the refresh token (best effort)".

**Failure.** `/v1/auth/logout` verifies the access JWT (`owner-auth/routes.ts:62–63`) and revokes by the hash of the body's refresh token. The access token has expired, so the call gets `401 JWT_INVALID`; the client's `call()` refreshes once (§8.1), which **rotates** the refresh token (00 M49), then repeats the logout with the body built before the refresh, i.e. the old token. The cloud answers `revoked: false`; the new refresh token stays valid for its full life while the page reports the owner signed out. On a shared or borrowed phone that is the session S50 a exists to end.

**Fix.** S50 a: "the logout body is built after any refresh (the refresh token current when the request is sent)", or "logout does not refresh: on `401` it is skipped and storage is cleared". Test 164 gains the expired-access case: one refresh, then a logout carrying the **new** refresh token.

### S-6. The dirty guard and the bulk loop ignore the new branch select and Sign out (S50 c, S51, S52)

**Says.** S50 c guards Cancel, Back and a side-menu item. S52 adds a branch select to the Floors and Stations app bars; S50 a adds Sign out.

**Failure.** The owner edits a station name, then picks the other branch in the app bar: the form is replaced with no "Discard your changes?" (or, worse, stays open and saves into the new branch's path). During a 12-table bulk loop, a branch switch mid-loop sends the rest of the range to the other branch's path with the same keys (S-1).

**Fix.** S50 c lists the branch select and Sign out as leaving actions; S51 disables the branch select while the loop runs. Test 162 gains the branch-select case.

### S-7. Tests 159–168 do not each map to one decision, and several decisions have none (§10.5g, §11)

- **Two decisions in one test:** 164 covers S52 **and** S50 a (Sign out); 168 covers S54 and §8.2's existing "a poll during an edit keeps the typed value". Split 164; move the poll case out of 168 (it is v1.0 behaviour; test 77 or a new number).
- **Not concrete:** 160 "every foundation code the owner app can receive" is not a list. Name it (the §9 codes plus the shared ones §6 lists for owner routes: `VALIDATION_FAILED`, `JWT_INVALID`, `BRANCH_NOT_FOUND`, `IDEMPOTENCY_KEY_MISMATCH`, `PERMISSION_DENIED`, and the login codes) or assert against the error union type.
- **Parts without names:** plan task 77 cites "component parts of #161", but test 161 names no parts, so §11's "each part cited once" rule cannot be checked.
- **Decisions with no test:** S50 d (Saved chip 3 s), S50 f (no item total until `next_cursor` is null; no counts on the picker), S50 g (phone layout, read-only "On sale at {n} of {m}"), S52 (app-bar branch select; Kitchen section lists every allowed branch; ID tails), S53 (banner and disabled Save on **every** view, not only the item form), S51 (> 100 tables refused), S54 c (add sheet chips +5 … +50 in the display unit), S54 d (`PIN_INVALID` with `attempts_remaining` ≤ 2; **Retry now**; `PERMISSION_DENIED` text), S54 e (menu chip, Close day in the header), S54 f (side menu from tablet width, Stock `aria-current`, links to `/admin#…`). The DoD row "follow the design hand-off … 159–168" is therefore not checkable as written.

---

## Nits

1. **S51:** "80-bit random part increased by *i*" has no overflow rule. Say "modulo 2^80" (the time part never changes, so the key stays a valid ULID for `ULID_RE`); test with a random part of all `Z`.
2. **S54 d:** "Locked · {n} min rounded up from `locked_until`" needs a clock. The roster screen has no `hub_time` (no session yet), and v1.0 says clients never use the device clock. 00 uses `Date.now()` here (`signin-client.ts:62`); say "device clock, display only" explicitly. The design also asks for minutes from `retry_after_ms` on `PIN_LOCKED_OUT` / `DEVICE_LOCKED_OUT` (`01a-design.md:318`), which S54 d omits.
3. **§8.2 Save counts:** still "every row whose **On hand** the user touched"; S54 renamed the field **Count**.
4. **S50 b:** the blocked dialog says "can't be archived", but §6.9 also answers `409 CONFIG_IN_USE` to a **station type change**; that needs its own text. An Undo (`archived: false`) can get `409 CONFIG_NAME_TAKEN` ("Restoring checks name uniqueness", §6.4); say what the chip then shows.
5. **S50 b, S53:** Undo is a save; while the cloud-down banner shows, it is disabled and the 8 s chip can expire. Say the chip stays until the banner clears, or Undo is exempt.
6. **S50 b:** "pilot menu is < 200 items" (PLAN A10) is an assumption the decision depends on; record it in §12.7 with S-2's.
7. **S54 f:** PLAN A15 shows the branch in the stock shell as the `config-status` `branch_id` tail; S54 f does not say what the shell shows for the branch.
8. **Hand-off items v1.1 is silent on:** B16 "{n} counts waiting" (`StockOffline`), the action-bar line "30 counts saved at 09:41" (`StockFeedback`), and B03 "Save {branch} again" (`OwnerItemPartial`, `01a-design.md:292`). Say whether each is built (and under which decision) or listed as not built.
9. **Plan header:** cites 00 spec `v1.2.1`, but S49 and S54 rely on 00 v1.3+ (M83, M86) and v1.4 (M89). Cite `00_Hub_Platform_Access_Spec_v1.4.md`.
10. **Version row:** "§8.1, §8.2, §8.3 edited" leaves out §6.7 and §12.4, which v1.1 also edits.

---

## Checks asked for

| Check | Result |
|---|---|
| No API, contract, error code or migration change | **Holds for the server.** `POST /v1/auth/logout` (`owner-auth/routes.ts:55`) and `POST /admin/auth/logout` exist; roster `locked_until`, `role_names` (00 M92), `PIN_INVALID { attempts_remaining }`, `errors.UNKNOWN`, `GET /v1/admin/menu?limit=200` (§6.11 allows 1 … 200) all exist; no new code or event. **Fails for the client contract with 00's `/admin` page** (B2). |
| S51 keys are valid ULIDs, also when the range changes | Valid: time part untouched, random part + *i* ≤ 99 stays 16 Crockford characters (`ULID_RE`), except on overflow (nit 1). A range change renews the key, so no stored key meets a new body; but floor or branch changes do not (S-1, S-6), and recovery after a name clash does not work (S-1). |
| S55 drafts can't leak between staff or days, handle unit changes | Between staff: no, once B2 fixes the `staff_id` source. Between days: **yes, they can** (B3: `business_date` is a label). Unit change: handled; item removed or no longer tracked: not handled (S-3). Staleness within a day: not handled (B3). |
| S56 with the 200-entry limit | **Not handled** (S-2). |
| S54 sign-out and shell with the 00 `/admin` session keys | **Broken** (B2). |
| S53 can't re-send a save | Holds: a failed save is never re-sent by itself, and a user re-tap reuses the form's `Idempotency-Key` (creating `POST`) or is a no-op `PATCH` (S26). But the save path can't recover at all (B1). |
| Every test concrete and mapped to one decision | **No** (S-7). |
| Hand-off asks the spec contradicts or drops | A8 (category with items is refused, so its archive frame is not built) and A9 (no "on sale" switch) are correctly recorded in S50 b and g. Silent on B16, the save line and B03 (nit 8). |
