# Prompt for Claude Code — build module 02a (Tables) in the Pulse design

Copy everything below the line into Claude Code. Run it from the root of the POS repo, with this folder (`pos-02a-handoff/`) placed at the repo root.

---

You are building the UI of **module 02a · Tables** (staff app) in the **Pulse** design: sign-in, the table map, table tiles, the table sheet and its actions, the handover / call-waiter cards, the lock banners and the offline rules.

- Follow spec `docs/specs/02a_Tables_Spec_v1.1.4.md` and the 02a status-board rulings for every API name, field, limit and error code. **Do not change server code or API shapes.**
- **This hand-off is the core set (60 frames).** States without a frame follow the shared patterns below and `brief/02a-brief.md`. Ask before inventing behaviour.
- The orders part of the table view, the order screen, the queue and the queue log are **02b** (its own hand-off). Build 02a first; leave the 02b slots as the frames show them (`ORD` placeholder blocks).

**Look: Pulse Chatkhara staff app with Puck+ tiles in a zone grid** (owner decisions, 2026-11-11):
- No floor plan (no table positions in the setup). Tiles are grouped by zone.
- **Pulse table palette** (`--s-free/seated/ordered/eating/bill/clean`). The spec text will be updated to match.
- No unslop restyle.

## Read first (in this order)
1. `CHANGES.md`: the owner decisions, the UX review, answers to brief §7 (Q1–Q22) and the new string keys.
2. `MAPPING.md` (and `mapping.json`): every screen ID → its frames → components.
3. `brief/02a-brief.md` and `brief/02-brief-review.md`: behaviour, copy and error codes. If a frame and the brief disagree on **behaviour or copy**, follow the brief. If they disagree on **layout or look**, follow the frame.
4. `design/*.dc.html` + `design/screens/*.png`: the frames. Each is static HTML at device size.
5. Styles, in this order: `design/pulse.css`, `design/v-brand.css`, `design/pulse-01d.css` (01d patterns, already in the app), then **`design/pulse-02.css`** (new; shared with 02b). Fonts: `design/ds/pos/fonts/`.

## Steps
1. **Design system.** Use the Pulse tokens and the 5 bundled fonts. Load **no** CDN fonts (the frames load Google Fonts only for preview; the hub has no internet). Status colours never change. Brand colours come only from `--brand-primary` / `--brand-secondary`.
2. **Add `pulse-02.css`** after the 01d stylesheet. Its 02a patterns:
   - map layout `.map` (+ `--bar`, `--one`), zone card `.zones` (+ `.stale`), `.zone__h` with `.zw`;
   - tile `.tt` (`s-*` + `c-*`, `.urgent`, `.pressed`, `.dim`, `.arch`) with `__top`, `__puck`, `__av`/`.tav` (`--me`, `--as`), `__n` (`.j` joined), `__s`, `__f`, padlock `.lk` (`--me`), flag `.fl` (`--q`);
   - side column `.side2`, `.needs` + `.ny`, legend `.lgd`;
   - table view panel `.scrim--side` + `.tv` (`__h`, `__hd`, `__t`, `__m`, `__main`, `__acts`, `__b`, `__sec`, `__f`), action tile `.btn--act` (`.off`, `.hub`), confirm-in-place `.confirm`, waiting card `.wcard`;
   - forms `.fld`/`.inp`/`.chips`/`.chip`, big chips `.bchips`/`.bchip`, candidate rows `.cand`, mini table pickers `.mts`/`.mt` (`.party`, `.own`), checklist `.ckr` + `.chk`, step dots `.stepn`/`.sdot`, summary `.sumline`, `.btn--danger`, `.dlg--w`;
   - banner variant `.abn--stack`; phone helpers `.chipsx`, `.phbar`; kiosk `.pu.k`, portrait `.pu.pt`.
   - The class names avoid the 01d/kit ones that clash (`.me`, `.who`, `.on`, `.eta.late`): keep them as they are.
3. **Top bar (02a-C10).** 80 px maroon. Start: brand block + 01d B05 alerts line (tablets only). Middle: floor segmented control with counts. End: Live, clock, **Requests** (shield, approvers only), **Inbox** (tray), person chip. Portrait: the floors move to their own row. Phone: phone top bar + tab bar **Tables · Orders · Inbox · Me**.
4. **Table map (02-S03).** Zones in setup order, then "No zone", then the client-labelled "Archived tables" group. Tiles sit in a 5-column grid (kiosk 6, portrait 4, phone 2; **always LTR**, even in Urdu). Side column: All / Mine, Needs you, legend counts, Open orders / Held, one **New order** (02b). Refetch `table-map` on any table/order frame and every 30 s while visible. Tiles change in place, with no flicker.
5. **Tile (02a-C01).** Exactly as in `Tiles.dc.html`: the puck ring fills over 60 min open; a solid puck and the `.urgent` style for Bill / late / void; holder avatar (maroon = me); a hollow assignee avatar only when the holder is someone else; one footer item (padlock name, or one flag); dashed free tile with seats.
6. **Table sheet (02-S06)** as a side panel (600 px; kiosk 720; portrait = bottom sheet; phone = full screen). One block primary, then the 4-tile action grid; Move / Join / Split / Release my lock sit under **More**. Every button is shown only by permission (R5; variants `TableSheet*`). A shown button that can't act now is turned off, with the reason on tap. Offline: wifi-off mark + "Needs the hub" toast; Ask for bill and Clean queue.
7. **Dialogs and sheets**: build each from its frame (`TakeOver`, `HandOver`, `ForceMove`, `Move`, `MoveOtherOwner`, `Join`, `Split`, `CallWaiter`, `AskBill`, `Clean*`, `ForceRelease`, `TableBusy*`). Centred on T/K, bottom sheets on portrait/phone. Every command sends the shown `seating_id`. `409 TABLE_SEATING_CHANGED` → toast "This table changed — refreshed".
8. **Cards and banners**: handover request on the 01d Requests list + action banner; the 01d answer sheet with Decline / Accept and **no PIN**; the **new phone answer sheet**; waiting card + Withdraw on the sender's sheet and in Needs you; result banners; call-waiter card. Lock banners (02a-B10) on the order screen: sticky, **Keep as draft**, with Send turned off unless `take-order-anywhere`.
   - **Holder changed, follow-up 2026-11-12:** staff with `take-order-anywhere` get `LockHolderChangedSend`: Send stays on, and the submit never takes the lock (spec §8). Everyone else gets `LockHolderChanged` (Send off).
9. **Strings**: add the keys in CHANGES §4. Put any Urdu you can't place in `docs/design/handoff/02a/urdu-todo.md`.

## Pixel-perfect and layout behaviour (must match the frames)
- **Pixel-perfect.** Match each frame exactly: spacing, sizes, radii, font sizes and weights, colours, shadows, icon size and alignment. Measure from the frame HTML, not by eye. Use only the tokens; add no new hard-coded values.
- **Laptop / desktop / tablet / kiosk (1280 and up): fit to screen.** The page itself never scrolls. The shell (top bar, offline bar, side column, bottom actions) is exactly the viewport: `height: 100dvh; overflow: hidden`. **Only inner regions scroll** (`overflow-y: auto; min-height: 0`): the zone card, the Needs-you list, the table-view body (`.tv__b`), dialog bodies (`.dlg__b`), candidate and checklist lists. Dialogs: `max-height: calc(100dvh - 32px)`, the body scrolls, the buttons always stay visible.
- **Tablet portrait (800 wide):** the portrait frames — floors row, Needs-you strip, a 4-column grid, a bottom dock; sheets come up from the bottom.
- **Phone (390 wide, works 360–430): exactly the phone frames.** Phone top bar, chip rows, a 2-column grid, sticky bar above the tab bar, full-screen table view, bottom sheets. **Never shrink the tablet layout; no horizontal page scroll** (chip rows scroll inside themselves).
- Wider than the frame: same layout; content stretches or centres as drawn; nothing scales up.
- Test at exactly 1280×800, 800×1280, 1920×1080, 390×844 and 360×740 and compare with `design/screens/*.png`.

## Rules on every screen
- One primary (saffron) button per layer. A dialog over the table view is its own layer.
- Tap targets ≥ 56 px (dialog buttons 72; phone tabs 60).
- State = icon + word + colour, never colour alone.
- Table names, amounts, times, durations, PINs, plates and codes stay LTR with Latin digits. Urdu: `lang="ur" dir="rtl"`, logical CSS, only chevrons/back arrows mirror; the tile grid stays LTR.
- Little text. No error codes or server text on screen.

## Check your work
Screenshot each 02a state at frame size, compare with `design/screens/*.png`, test the keyboard (Tab / Enter / Escape) on tiles, sheets and dialogs, and report: screen ID → done / differs (why), open questions, strings you couldn't place.
