# 05 Billing Screens — design hand-off

- **Source:** generated for PR #316 (`docs/design/inventory/05-billing-design-brief.md`, `docs/design/handoff/05/DESIGN-PROMPT.md`), updated 2026-11-20 to 05 v1.0.6 / 02a v1.1.9 (PR #321). The canvas is "05 Billing Screens" (Claude Design); the link is given in the hand-off message.
- **Frames:** 95, named as brief §2.1 — kiosk 1920×1080 **60**, tablet 1280×800 **26**, portrait 800×1280 **2**, phone 390×844 **7**; Urdu **7** (inside the count). One PNG per frame: `design/screens/<frame>__WxH__<lang>.png`.
- **CSS:** `design/css/pulse.css`, `v-brand.css`, `pulse-01d.css`, `pulse-02.css`, `pulse-04.css`, `tokens.css`, `bundle.css` are **byte-identical** to `docs/design/handoff/04/design/css/` (see `sha256.txt`). New styles only in `design/css/pulse-05.css` (prefix `b5-`, **no new tokens**). `fonts.css` is the local variant pointing at `../ds/pos/fonts/` (the 5 bundled fonts; nothing from a CDN).
- **Files:** `CHANGES.md` (decisions, §7 answers, copy, mismatches, open items) · `MAPPING.md` + `mapping.json` (screen → frames → classes → API) · `INDEX.html` (every frame by group) · `urdu-todo.md` · `sha256.txt`.
- **Public-repo check:** no email, phone number, token, ID number or machine path in any frame. The only buyer ID is the fake `00000-0000000-0` inside the buyer sheet's field. QR / reference values are not drawn.
