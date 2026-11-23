# Prompt for Claude Code — build module 02b-TK (Takeaway) in the Pulse design

Copy everything below the line into Claude Code. Run it from the root of the POS repo, with this folder at `docs/design/handoff/02b-tk/`.

---

You are rebuilding the **Takeaway** experience of the staff app in the **Pulse** design: the Takeaway tab becomes the order screen with a live token queue. It adds pay inside the screen, a token drawer, hand-over, held orders per counter, the leave guard, a keyboard mode, rush mode, the pickup board, the packer filter on the Pass, the customer status page, the token slip and the customer display. The shell top bar is **proposed** here (only what takeaway needs).

- Follow the specs (02b, 03a, 03b, 05, 05a, 01d — latest versions in `docs/specs/`). **Do not change server code or API shapes in the UI tasks.** Every row of `GAPS.md` is spec-first, per CLAUDE.md: bump the spec, then the plan, then the code, with its own tests. Ask the owner before inventing behaviour.
- `GAPS.md` lists what is *client-only* (no hub change): G-6, G-14, G-16, and the UI parts of everything else. Build those first.

## Read first (in this order)
1. `CHANGES.md` — owner answers, IA, rules, per screen, hostile review, string keys, open questions.
2. `MAPPING.md` / `mapping.json` — screen ID → frames → components → data.
3. `GAPS.md` and `TAPS.md`.
4. `design/*.dc.html` + `design/screens/*.png`. If a frame and CHANGES disagree on **behaviour or copy**, CHANGES wins. If they disagree on **layout**, the frame wins.
5. Styles: `design/ds/pos/tokens.css`, then `design/pulse-tk.css` (all classes prefixed `tk-`, `bd-`, `cs-`, `pk-`, `cd-`, `slip`, so nothing collides with `pulse-02.css`).

## Steps (one task per commit, cite the spec section)
1. **Shell (proposed):** context slot, tab selected state (`aria-current` + `.is-sel`), Live / Offline / Rush pill, person **menu** (no one-tap sign out), day / shift banners before the first item.
2. **Takeaway tab = order screen** (`TK-S01`): queue rail + menu + cart on the kiosk; ready strip + queue drawer on the tablet; Menu / Cart / Queue tabs on the phone. Drafts as today, plus the **leave guard** (`TK-D08`) on every exit and an auto-hold on sign out / idle lock.
3. **Cart:** inline name / +92 phone / pickup chips (`TK-D01`, `TK-D02`), groups and line times from `eta-preview`, the Ready by block with the reason line, the note shown, steppers and ×2–×8 chips, the "give paye now?" question in place of the serve switch.
4. **Menu:** wait chip on every tile (`stations-live`), Half / Full on the tile, off tiles with a reason chip (no strike-through) and a toast, keyboard mode (`/`, `4n` Enter, F2 / F4 / F8 / F9 / Esc), rush mode (≥ 15 open, dense tiles, top items).
5. **Sheets:** item sheet with add-on steppers (`Option.quantity`, `max_quantity`), Save changes when editing, kg pad; deal sheet.
6. **Send without a dialog** (`TK-D05`) + **pay panel** (`TK-D06`) over the cart through 05 `bill?order_id`, `AddPayment`, `CloseSplit`.
7. **Token drawer** (`TK-S03`), ready tiles with Hand over (MarkServed after a 5 s undo window), Add items (`adds_to_order_id`), Remove / cancel.
8. Then the GAPS rows in owner order: G-1 → G-7 → G-2/G-3 → G-8/G-9 → G-11 → G-4 → G-5 → G-10 → G-12.
9. **Strings:** the keys in CHANGES §5, en + ur. Anything uncertain goes into `urdu-todo.md`.
10. **E2E:** the eight orders in `TAPS.md` must reach the "after" tap counts on the kiosk.
