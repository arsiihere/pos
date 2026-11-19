# Prompt for Claude Design — module 05 Billing staff screens

**For the owner.** Open a new **Claude Design** chat. Attach these files, then paste everything below the line:

1. `docs/design/inventory/05-billing-design-brief.md` (the brief, the only source of behaviour and copy).
2. The Pulse styles, all from `docs/design/handoff/04/design/css/`: `pulse.css`, `v-brand.css`, `pulse-01d.css`, `pulse-02.css`, `pulse-04.css`, `tokens.css`, `bundle.css`, `fonts.css`.
3. The bundled fonts from `docs/design/handoff/04/design/ds/pos/fonts/` (Figtree, Bricolage Grotesque, Geist Mono, Noto Nastaliq Urdu 400 / 700).
4. Optional, for look only: a few 01d / 02 / 04 frames as reference (`docs/design/handoff/04/design/Main.dc.html`, `VoidPending.dc.html`, `DayCloseBlocked.dc.html`; `docs/design/handoff/02b/design/OpenOrdersKiosk.dc.html`; `docs/design/handoff/01d/design/Answer.dc.html`, `Cards.dc.html`).

When the canvas is done, give the canvas artifact slug or link to the integrator (see "Hand back" at the end).

---

You are designing the **staff screens of module 05 · Billing** for a restaurant POS (Arif Chatkhara, Lahore). The attached **brief** (`05-billing-design-brief.md`) holds every screen, state, data field, error and string. Read it end to end before you draw.

## The canvas
- Make one **Claude Design** canvas named **"05 Billing Screens"** in the **Pulse, Arif Chatkhara** direction: the same look as the 01d alerts, 02 tables / ordering and 04 voids hand-offs (maroon chrome, cream ground, white cards, saffron primary; Bricolage Grotesque for numbers and amounts, Figtree for text, Geist Mono for invoice numbers and references, Noto Nastaliq Urdu for Urdu).
- **Reuse the attached CSS unchanged:** `pulse.css`, `v-brand.css`, `pulse-01d.css`, `pulse-02.css`, `pulse-04.css`, `tokens.css`, `bundle.css` (and `fonts.css`). Every new style goes in **one new file, `pulse-05.css`**, with **no new tokens** (use the existing colour, space, radius and type tokens). Status colours are fixed; only the brand tokens change per restaurant.
- **Fonts:** the bundled fonts only. Load nothing from a CDN or Google Fonts; the hub has no internet.
- Reuse the existing components instead of redrawing them (brief §0.5, §2.2): 01d alert card, banner, inbox, answer sheet, PIN step, `.msg`, `.toast`, `.sk`, `.empty`, bottom sheet; 02 top bar, table sheet, tiles, hub-offline bar; 02b COMP tag; 04 PENDING VOID tag, Needs-approval tag, sheet `.dlg--v`, banner list with "and N more".

## Frames
- **One frame per state in the brief.** The full list is the brief's **§2.1 table, 94 frames**: kiosk 1920×1080 **60**, tablet 1280×800 **26**, tablet portrait 800×1280 **2**, phone 390×844 **6**. Use the frame names exactly as listed (`<ScreenName><State>`, e.g. `Bill`, `BillCloseBlocked`, `ShiftClose`, `ShiftCountResult`, `DayCloseShifts`, `AnswerVariance`, `BillUrdu`), each at its device size.
- Group the canvas by screen ID with a note per group, as the 04 canvas did: 05-S01 Cashier screen · 05-S02 Bill + pad · 05-D01 Splits · 05-D02 … D07 Bill sheets · 05-C02 Print status · 05-S03 / S04 Shift · 05-D08 / D09 Petty cash and drawer · 05-S05 Day close · 05-S06 Reports · 05-N01 … N09 Alert cards · 05-X01 / X02 Table delta · Urdu.
- **Urdu frames** (7, marked `…Urdu` in §2.1): RTL with Latin digits; amounts, invoice numbers, times, identifiers and counts are LTR islands.
- **Sample data:** the brief's §0.6 only (Table 7, Rs 5,710.00 net: cash due Rs 6,624.00, card due Rs 5,996.00; Gulberg branch, lunch rush). The repo is public: no real phone numbers, ID numbers, tokens, emails or file paths. The buyer ID appears only as the fake `00000-0000000-0` inside the buyer sheet's field.
- **Pixel rules** (as 01d): the page never scrolls on tablet or kiosk; only list regions scroll; no horizontal scroll on the phone. One primary button per screen layer. Touch targets 56 px; kiosk keypad keys 64 px (brief §7 Q-6).

## Rules (from the brief §0.3, the "design only" rule)
- Every behaviour, limit, error, number and printed text is decided by the spec and written in the brief. **You choose look and layout only.** Do not add buttons, steps, confirmations, settings, filters, sort / search controls or data that the brief does not list. Where the brief says "spec silent → designer choice", choose the look; the behaviour stays as written. If something seems wrong or missing, put a **note on the frame**; do not design around it.
- **All text comes from the brief's §6 copy list.** You may improve the English wording; the meaning never changes. Never show a permission key, kind key, error code, ULID or raw enum value. Status is always icon + word + colour, never colour alone. Times are 12-hour ("1:32 PM").
- **Money is never computed on the screen** in the design's logic: show the server's totals, dues, rounding line and change as the brief gives them. The "Rounding adjustment" line sits apart from the tax rows. Cash and card dues sit side by side. The tendered field is never pre-filled. The shift close shows card / online totals first, then the **blind count before any expected figure**.
- The **Print to** picker reads `GET /queries/bill-printers` — mark it on the frame "05 v1.0.5 (G-28)".
- The PIN step of the approval cards is 01d's, unchanged.

## What to give back
1. The canvas with all 94 frames, named as §2.1.
2. A short **changes note** in the canvas (or as a text file in it): your design decisions; your answer to each brief §7 question that is still open (Q-2 … Q-12, Q-18); every string you changed, as `key: new English` (keys from §6); any copy that differs from the brief; open items.
3. `pulse-05.css` as its own file.

## Hand back
When done, give the **canvas artifact slug or link**. The integrator imports it into `docs/design/handoff/05/` with the same files as the 04 hand-off:
- `README.md` — source (slug, date), sha256 check of every copied file, byte-identical CSS noted, a public-repo check (no email, phone, token, ID number, machine path);
- `CHANGES.md` — decisions, i18n keys (en + ur), copy mismatches with the brief / spec, open items;
- `MAPPING.md` + `mapping.json` — screen ID → frames → components and CSS classes → API fields;
- `INDEX.html` — every frame by canvas group;
- `design/*.dc.html`, `design/css/` (the CSS above + `pulse-05.css`), `design/ds/pos/` (tokens and fonts), and `design/screens/<frame>__WxH__<lang>.png` (one PNG per frame at its canvas size);
- `urdu-todo.md` — every string with no Urdu frame.
