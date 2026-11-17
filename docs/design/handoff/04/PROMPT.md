# Prompt for Claude Code — build the module 04 UI (VU1 Void, VU2 Audit log) in the Pulse design

Copy everything below the line into Claude Code. Run it from the root of the POS repo. This folder is `docs/design/handoff/04/`.

---

You are building the UI of **module 04 · Voids and Audit** (plan rows **VU1** and **VU2**) in the **Pulse** design.

- Follow spec `docs/specs/04_Voids_Audit_Spec_v1.0.3.md` **§8** (client contract) and **§9** (error copy) for every API name, field, limit, permission and visible text. §6.3 void-preview, §6.4 pending-voids, §6.5 audit-log and §6.5b audit-staff are the only reads; VoidItems, VoidAll (RemoveItems + VoidItems), WithdrawRequest and 01d AnswerRequest are the only writes.
- **No server or API changes.** No new endpoints, fields, error codes or migrations. If a frame needs data the API does not give, stop and ask (see CHANGES.md O4, O11).
- Build VU1 into `apps/client/src/features/voids/` and VU2 into `apps/client/src/features/audit/`. Touch the 02b order code (`features/staff/orders/`) only where the Void entry point and the pending state attach to it.
- If a frame and the spec disagree on copy or behaviour, **the spec wins**. If they disagree on layout or look, follow the frame. CHANGES.md §3 lists every known copy difference.

**This hand-off has 40 frames**: the main state of every §8 screen, the key errors, tablet portrait, kiosk, phone and Urdu frames. States without a frame follow the shared 01d / 02b patterns (`.msg`, `.toast`, `.sk`, `.empty`, bottom sheet). Ask before inventing anything those patterns don't cover (MAPPING.md "Gaps").

**Look: Pulse Chatkhara staff app** — the same direction as 01d, 02 and 02b.

- Use the existing client ui-kit styles. Do not copy the frame CSS wholesale: `css/pulse.css`, `css/v-brand.css`, `css/pulse-01d.css`, `css/pulse-02.css`, `css/tokens.css` and `css/bundle.css` are byte-identical to files already in the repo (README).
- New for 04: `css/pulse-04.css` (staff screens) and `css/pulse-04-admin.css` (hub admin Stock page). They add **no new tokens**.
- Fonts: the bundled fonts only (`design/ds/pos/fonts/`, already in the ui-kit). Load nothing from a CDN; the hub has no internet.
- White-label: only the brand tokens change. Status colours (danger red for void, amber for blocked, saffron primary for "Ask for approval") stay fixed.

## Read first (in this order)
1. `CHANGES.md` — design decisions 1–26, every string with its proposed i18n key (en, and ur where an Urdu frame shows it), copy mismatches C1–C11, Urdu notes U1–U6, open items O1–O12.
2. `MAPPING.md` (and `mapping.json`) — every screen ID → frames → components and classes → API fields; "Gaps" lists the states with no frame.
3. Spec 04 v1.0.3 §3.5 (details shape), §4.5 row A-1 (day close), §8, §9; `docs/plans/04-plan.md` rows VU1 / VU2.
4. `design/*.dc.html` and `design/screens/*.png` (`<frame>__WxH__<lang>.png`). `INDEX.html` shows them all.
   - Sizes: tablet 1280×800, tablet portrait 800×1280, cashier kiosk 1920×1080, phone 390×844, office laptop 1440×900.

## Before you start
- `module-04` does not yet contain `main`'s 02 / 02b staff client (`apps/client/src/features/staff/orders/`, `packages/ui-kit/components/pulse-02.css`, `app/ui-kit-staff.ts`). VU1 needs it. If it is missing on your branch, stop and ask for `main` to be merged in (O6). Do not copy it over by hand.

## Steps
1. **Styles.**
   - Add `pulse-04.css` as `packages/ui-kit/components/pulse-04.css` and load it from `apps/client/src/app/ui-kit-staff.ts` after `pulse-02.css`, scoped the same way the staff layer is (`:where(.pu)`), as 02 and 03 did.
   - Add `pulse-04-admin.css` to the kit used by the 01a hub admin (only `.pos-banner__list` and its fade / "more" line).
   - Patterns in `pulse-04.css`: Needs-approval tag `.ntag`; sheet `.dlg--v` (+ `.vcol`, `.vbody`, `.vfoot`), outcome chips `.vout`, suggested mark `.pre`, disabled row reason `.why`, amount box; pending line + tag `.ptag`, total note `.xp`; requester card `.wcard` (+ `--blocked`); cancel order `.dlg--all`, per-line select `.dsel` (+ `.is-set`); audit filters `.flt` (+ `.is-set`, `.is-open`), rows, method tag, popovers, export bar.
2. **VU1 · Line actions (04-A01).** On the selected line of the 02 table view: past stage 1 → **Void** (with the "Needs approval" tag when the grant is `requires_approval`; R5, permission-derived, never a role check); stage 1 → keep 02b **Remove**. A pending comp or void → no Void (§8). Replace the `line.void` placeholder and drop `line.void_later`.
3. **VU1 · Void sheet (04-D02, 04-C02, 04-C03).**
   - Open with one `void-preview` call; build "What happens" from `lines` / `line_dispositions`, "Where it goes" from `dispositions` (enabled rows + disabled rows with their reason, §8 text).
   - Pre-select `moved` when enabled ("Suggested"), else `wastage`. Units stepper "of N"; weighed line ×1, Rs 0 (V18); deal = "Deal portions".
   - Reasons = the five V12 codes; Other needs a note (≤ 200) and Other disposition needs its own note.
   - Primary button names the missing step (Pick a reason → Write why first → Comp waiting) and ends as **Void** (allowed) or **Ask for approval** (requires_approval). Online only: voids are **not queueable** (V15); when the hub socket is down, show the offline text and send nothing.
   - Layouts: centred two-column dialog on tablet and kiosk; one-column bottom sheet on portrait; phone puts Reason first and pins amount + buttons.
4. **VU1 · Pending (04-B01).** From `pending-voids`: strike the line (and its children), red **PENDING VOID** tag, take it out of the total with the `.xp` note. Requester: card + **Withdraw** (WithdrawRequest). Anyone else: "Asked by … · waiting for a manager", no actions. Blocked (served meanwhile): amber card, §8 text, Withdraw stays.
5. **VU1 · Errors (04-B02).** Inline `.msg` in the sheet, text from §8 / §9 keyed by `code`, never the server message.
6. **VU1 · Cancel order (04-D08).** One void-preview over all lines → Remove group (stage 1) and Void group (per-line select, group **Waste all**), one reason. Send RemoveItems, then VoidItems. Handle the two drawn failures exactly as in `CancelOrderRemoveFailed` / `CancelOrderRetry`.
7. **VU1 · Approver card (04-D06).** Extend the 01d answer card for kind `void_approval` with **Where it goes** and **Lines and stage** (from §3.5 `details`). Served meanwhile: Approve off, Reject stays. Reuse 01d's PIN step unchanged.
8. **VU1 · Day close blocked (04-B03).** On the 01a Stock page, DAY_CLOSE_BLOCKED shows the §4.5 A-1 sentence and one line per open request, with "and N more" past the list limit.
9. **VU1 · Toasts (04-T01).** 01d `.toast`: Void asked, Voided, Request withdrawn, Order cancelled.
10. **VU2 · Audit log (04-S03).** New staff-nav tab **Audit log**, shown only with `view-audit-log` (R5). Filters Date / Staff / Actions + Export CSV; laptop 8 columns, tablet two-line rows with day headers; infinite scroll on `audit-log` with its cursor; loading, empty and hub-down states as drawn.
11. **VU2 · Popovers (04-C04–C06).** Staff from `audit-staff` (Everyone first, "left" for `in_directory: false`); Actions grouped with group All; Date presets + calendar, whole days on the hub clock, up to 31 days.
12. **VU2 · Export (04-D09).** CSV built in the browser (V17) by paging `audit-log` with the current filters; inline progress + Stop; file name `audit-<branch>-<from>-to-<to>.csv`.

## Rules
- **i18n keys only**, in `apps/client/src/i18n/en.ts` and `ur.ts`; no literal text in components. Use the keys in CHANGES.md §2; reuse the existing keys it marks. Strings with no Urdu frame go to `urdu-todo.md` as 02b did.
- **Latin digits** everywhere, Urdu included. Times, amounts, table codes and identifiers are LTR islands inside RTL.
- **Pixel-perfect** to the frames at the five sizes above; check each against its `design/screens/*.png`.
- No new dependencies. TDD: failing test first, one task per commit, commit messages cite the spec, e.g. `feat(client): void sheet [04 §8]`.
- Never show a permission key, staff id or ULID except where the frames do (O1; unknown actor in the audit log).
- Accessibility: disabled buttons stay focusable with `aria-disabled` and a reason; the sheet traps focus; Escape closes; popovers return focus to their filter.

## Done when
- Every screen in MAPPING.md matches its frames at every drawn size and in Urdu.
- Every §8 state and every §9 code has a test; the normal gate is green.
- The open items you hit are answered by the owner, not guessed.
