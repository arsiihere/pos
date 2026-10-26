# Task: implement the module 01a redesign (Restaurant Setup)

You are working in the restaurant POS monorepo, Arif Chatkhara pilot. This folder is the design hand-off for **module 01a** only. The 01a screens already work; this task **redesigns them and adds missing states**. Keep the logic, the APIs and the tests.

Work phase by phase. After each phase: run its checks, commit `feat(01a): <phase>`, give a short report, and **wait for "go"**.

**Module 00 first.** If the 00 hand-off (`docs/design/handoff/00/`) is not done yet, do its Phase 1 (kit) before starting here. Both modules share one `kit-additions.css`.

## 0. Files

| File | What it is |
|---|---|
| `01a-design.md` | **Source of truth**. Per screen ID: frames, component tree, field → API, actions, states, new string keys, shared component changes, coverage. |
| `01a-open-questions.md` | 8 questions with recommended answers. Copy it to `docs/design/open-questions/01a-setup.md`. |
| `frames/*.dc.html` | All 01a frames, plus three module-02 parking previews. **Ignore `Parking*` here.** Open `frames/INDEX.html` to view them. |
| `frames/INDEX.md` | Frame → screen ID → title. |
| `kit/kit-additions.css` | Full shared kit additions (01a + 00). |

## 1. Ground rules
1. **Read first.** Read these:
   - `docs/specs/01_Restaurant_Setup_Spec_v1.0.2.md` §8
   - `docs/design/inventory/01a-setup.md`
   - `docs/design/ui-brief-01a.md`
   - `apps/client/src/features/owner/**`
   - `apps/client/src/features/admin/stock/**`
   - `apps/client/src/components/**`
   - `packages/ui-kit/`

   Then write `docs/design/handoff/01a/PLAN.md` mapping each screen ID → files. Show the plan before Phase 1.
2. Kit classes and tokens only. Use logical CSS properties. No new CSS unless it is truly needed; if you add any, make it token-only, put it in the kit, and report it.
3. Every visible text goes through string keys (`01a-design.md` §2), in English and Urdu. Urdu text is in `OwnerMenuUrdu` and `StockUrdu`. Keys without Urdu go to `docs/design/handoff/01a/urdu-todo.md`. Never show error codes or server messages.
4. UX rules:
   - one primary button per screen;
   - touch targets ≥ 56 px;
   - status is shown as an icon + a word;
   - no hover-only actions;
   - prices, quantities, times, IDs and table names are LTR;
   - no fixed heights on text;
   - respect `prefers-reduced-motion`.
5. **Do not change API contracts.** No new endpoints are needed for 01a. Bulk add and confirm-all are client-side loops or batches over the existing commands.
6. Open questions: build with the **recommended** answers. Skip anything marked `blocked` and list it in your report. Note behaviour changes at the top of PLAN.md.
7. Keep existing tests green. Add tests for:
   - the error code → UI text mapping;
   - the bulk-add loop (idempotency key per table; stop on the first error);
   - the dirty-form guard;
   - the Q4 count restore (same staff + date only; cleared on save, discard or a new day);
   - "All N are still right".

## 2. Phases

### Phase 1: Shared components (from kit classes)
Build these as client components (`apps/client/src/components`) so that 01b, 01c and 02 reuse them. See `01a-design.md` §4.

| Component | Kit classes |
|---|---|
| AppBar | `.pos-appbar` |
| SideNav (owner) | `.pos-shell` / `.pos-sidenav`; phone: bottom tab bar |
| ListRow / List | `.pos-list` with column presets |
| Switch | `.pos-switch`, `role="switch"` |
| Segmented | `.pos-seg`, `aria-pressed` |
| Chip | `.pos-chip--*` |
| ActionBar | `.pos-actionbar` |
| EmptyState | `.pos-empty` |
| Skeleton | `.pos-skeleton` |
| SavedChip / UndoChip | 3 s / 8 s |
| ConfirmDialog | focus trap, Escape, focus returns to the trigger |

Also:
- `StaffTiles` renders the locked note ("Locked · 14 min", rounded up, from `locked_until` / `retry_after_ms`).
- `BusyButton` keeps its 3 s slow banner.

**Check:** unit tests for each component (keyboard, ARIA, RTL), and a quick story/demo page if the repo has one.

### Phase 2: Owner app (01a-S01 … S07, C01, B01–B04, D01, D02)
Match the `Owner*` frames.
- Side nav shell; sign out (`POST /v1/auth/logout`).
- Branch picker S02:
  - auto-pick when there is one branch;
  - choice kept in `sessionStorage`;
  - ID tails until 01b names branches;
  - **Menu works without a branch** (Q7).
- Floors S03:
  - floor sections with table tiles; the table dialog includes a floor move;
  - bulk add (Q1) and the first-run form;
  - Saved chip instead of a silent save on blur;
  - Show archived, Restore;
  - every error state in the design doc.
- Stations S04: the add/edit station and recipe dialogs; the type change is disabled while items use the station; archive blocked with the item list.
- Menu S05:
  - Items / Categories / Tax rates tabs;
  - search 300 ms; category filter; Active/Archived; Load more;
  - read-only B01; no-match; loading; first-run checklist.
- Category S06 as a dialog with C01.
- Item S07:
  - grouped sections + the "How staff will see it" aside;
  - top fix-list banner linking to the fields;
  - every `CONFIG_REFERENCE_INVALID` reason text;
  - B02, B03 (retry only the failed branch route), B04;
  - phone price-first layout.
- D01 / D02 per Q2.

**Check:** run the owner app locally and walk flows 1 (first-time setup) and 6 (price change on a phone, ≤ 5 taps). If Playwright is available, screenshot each screen at 1440×900 and 390×844, in English and in Urdu, into `docs/design/handoff/01a/screens/`, and compare them by eye with the frames.

### Phase 3: Hub stock page (01a-S10, S11, B10–B18, D10)
Match the `Main` and `Stock*` frames.
- PIN sign-in states:
  - nobody can count stock;
  - wrong PIN / locked;
  - hub unreachable with **Retry now**.
- Header: day chip (B11), menu status chip (B10), signed-in name + Sign out (Q3), Close day.
- Filters (To count / Low or out / Off / All with counts) and search.
- Rows:
  - Count with "Still right";
  - "Left to sell" + "on orders". Rename every UI use of "Available": the number is "Left to sell", the switch is "Selling On/Off";
  - Add (inline on tablet, bottom sheet with +5/+10/+20/+50 on phone);
  - Selling switch;
  - badges (B15).
- Cards: B12 stale, B13 start day and retry (same command_id), B18, B14 chips (tap scrolls to the row), B16 reconnect (values kept), B17 results.
- Q5: "All N are still right" callout. Q4: counts kept on the device after an idle sign-out (localStorage key `stock-draft:<device>:<business_date>:<staff_id>`).
- The 15 s poll never overwrites a row being edited.
- If the 00 hub admin shell (00-S20) exists, mount the stock page inside it; otherwise keep the stand-alone header.

**Check:** walk flows 2 (morning count with the stale prompt), 3 (lunch top-up) and 5 (night close) on a tablet (1280×800) and a phone (390×844). Screenshots as in Phase 2.

### Phase 4: Docs and report
- Update `docs/design/ui-brief-01a.md` "Design status" to point to `01a-design.md`.
- Copy `01a-design.md` to `docs/design/handoff/01a/` and correct anything that differs from what you built.
- Make sure `docs/design/open-questions/01a-setup.md` exists, and add any new questions at the bottom.
- Report:
  - what was built, per phase;
  - tests;
  - blocked questions (Q6.5, Q6.10, Q6.13);
  - the recommended answers used and where each lives in the code;
  - anything not done.

## 3. Out of scope
- **Image upload, 2-D floor plan, days of the week in hours:** not in the spec.
- **Branch names and branch settings:** module 01b.
- **Variants, modifiers, deals:** 01c.
- **Parking frames in this canvas:** module 02 previews.
