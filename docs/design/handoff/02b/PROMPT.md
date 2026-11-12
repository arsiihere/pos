# Prompt for Claude Code — build module 02b (Ordering) in the Pulse design

Copy everything below the line into Claude Code. Run it from the root of the POS repo, with this folder (`pos-02b-handoff/`) placed at the repo root. **Build 02a first**: 02b sits inside its map and table view.

---

You are building the UI of **module 02b · Ordering** (staff app) in the **Pulse** design: new order (takeaway / parking), the order screen with live times, options / deal / weight / note sheets, Send and its states, the orders part of the table view, line actions (served, remove, send back, comp, weight, contact, boost), late cards, open orders, the order view, held orders, zone stock, the queue bar and queue log, the idle lock and "day not started".

- Follow spec `docs/specs/02b_Ordering_Spec_v1.0.5.md` and the 02b status-board rulings for every API name, field, limit and error code. **Do not change server code or API shapes.**
- **This hand-off is the core set (60 frames).** States without a frame follow the shared patterns below and `brief/02b-brief.md`. Ask before inventing behaviour.

**Look: Pulse Chatkhara staff app** (no unslop restyle; Pulse table palette). The order screen follows the Pulse reference (photo menu, category rail, cart with a time on every line).

## Read first (in this order)
1. `CHANGES.md`: owner decisions, the UX review, answers to brief §7 (Q1–Q23), new string keys.
2. `MAPPING.md` (and `mapping.json`): screen ID → frames → components.
3. `brief/02b-brief.md` and `brief/02-brief-review.md`: behaviour, copy and error codes. If a frame and the brief disagree on **behaviour or copy**, follow the brief. If they disagree on **layout or look**, follow the frame.
4. `design/*.dc.html` + `design/screens/*.png`: the frames (static HTML at device size).
5. Styles, in order: `design/pulse.css`, `design/v-brand.css`, `design/pulse-01d.css`, **`design/pulse-02.css`** (shared with 02a). Fonts: `design/ds/pos/fonts/`.

## Steps
1. **Design system.** Pulse tokens and the 5 bundled fonts. Load **no** CDN fonts. Status colours never change; brand colours come only from `--brand-primary` / `--brand-secondary`.
2. **`pulse-02.css` patterns for 02b:**
   - order layout `.osc`, `.menu`, `.items--h` + `.mi--h` tiles (`.zq` zone count, `.tag` chips, `.off`, `.picked`, `.qty`);
   - cart `.cart` with groups `.grp`, lines `.ln` (`.open`, `.prob` + `__prob`, `.frozen`), badges `.bd`, notes `.nt`, times `.eta` (`.moved`, `.none`), `.cart__msg`, `.day`;
   - phone `.ptabs`, `.sbar`, `.phx`;
   - sheets `.opt`/`.opt__h`/`.rule`, `.seg--opt`, `.qline`, weight pad `.wpad`, deal parts `.dsh`;
   - send `.token`, `.plate` (+ `--sm`), `.slines`/`.sl`, `.tokc`;
   - table view orders `.rnd` (`.q` queued), `.ol` (`.child`, `.struck`, `.sel` + `__ctrl`), stage pill `.stg`, badge `.bdg`, refresh line `.upd`, late card `.lc`;
   - lists `.oo` (`.ready`, `.q`, `__id` / `.p`), `.zs` (`.low`, `.out`), queue rows `.ql`, idle `.idle`.
3. **Order screen (02-S05).** Back + identity chip in the top bar. Category rail 200 px. Menu grid: 2 columns (kiosk 3). Cart 400 px (kiosk 520). Re-run `eta-preview` 250 ms after the last change, and on menu / stock / station frames. Lines are sorted by time and grouped by promise ("Food together · 8:27 PM"); counter lines group under "From the counter · Now". A moved time is highlighted (`.eta.moved`). Problems mark the line and turn Send off ("Fix n item first"). Re-check time windows every minute.
4. **Phone (02-S10):** Menu / Cart tabs + sticky Send bar. Portrait: full-width menu + summary bar (cart opens as a sheet).
5. **Sheets:** options (variant, groups with rule pills, defaults preselected, a linked option turned off with its reason), weighed item (Enter weight now / Weigh later), deal (parts, choices, extra prices), kitchen / order note (counter, `dir="auto"`).
6. **Send (02-D07):** freeze the cart, queue first, then submit. States: Sending, Sent (final times + "Time updated"), the big **token** for takeaway, the **plate** for parking, Queued ("Token after sending"), the queued-takeaway-sent card, and "Already sent" (409 own pending → show as Sent).
7. **Table view orders part (02-S06):** rounds with promise and stage words (`Stages.dc.html`). Tapping a line opens its allowed actions under it. Kitchen progress is not pushed, so show the "updated · Refresh" line. Offline: queued round dashed, Mark served queues.
8. **Line actions and cards:** as in `MarkServed`, `Remove`, `SendBack*`, `Comp`, `CompWaiting`, `CompRequests`/`CompAnswer` (01d sheet + PIN), `EnterWeight`, `Contact`, `Boost`, `TableViewLate`/`ReleaseSheet`.
8a. **Follow-up 2026-11-12 (CHANGES §6):** the automatic “Comp it?” (`CompItCart` → `CompItPrompt` → `CompItYes` / `CompItNo`), the zone-empty line in the Sent result (`SentZoneEmpty`), and zone Undo on the table view (`ZoneUndo`, `ZoneUndoLate`).
9. **Lists:** Open orders (kiosk home, tablet, phone; Abandoned tab for managers), the order view (Served / Not served until the hub adds stages), Held, Zone stock + Refill/Count, the zone alert.
10. **Queue:** one offline bar shared with 02a; queue log rows with Send again as {name} / Copy to a new order / Discard; the idle lock sends the queue first.
11. **Strings:** the keys in CHANGES §4. Put any Urdu you can't place in `docs/design/handoff/02b/urdu-todo.md`.

## Pixel-perfect and layout behaviour (must match the frames)
- **Pixel-perfect.** Match each frame exactly: spacing, sizes, radii, font sizes and weights, colours, shadows, icon size and alignment. Measure from the frame HTML, not by eye. Tokens only.
- **Laptop / desktop / tablet / kiosk (1280 and up): fit to screen.** The page never scrolls: the shell (top bar, offline bar, category rail, cart head and foot, panel header) is exactly `100dvh` with `overflow: hidden`. **Only inner regions scroll** (`overflow-y: auto; min-height: 0`): the menu grid, the cart lines (`.lines`), the table-view body, dialog bodies (`.dlg__b`), list cards (`.lcard__b`). Send and the cart total are always visible. Dialogs: `max-height: calc(100dvh - 32px)`, the buttons stay visible.
- **Tablet portrait (800):** as `OrderPortrait`: menu full width, summary bar with Cart + Send; sheets from the bottom.
- **Phone (390, works 360–430): exactly the phone frames.** Menu / Cart tabs, sticky Send bar, bottom sheets, the full-screen table view. **Never shrink the tablet layout; no horizontal page scroll** (category chips scroll inside their row).
- Wider than the frame: same layout, nothing scales up.
- Test at 1280×800, 800×1280, 1920×1080, 390×844 and 360×740 against `design/screens/*.png`.

## Rules on every screen
- One primary button per layer (Send on the order screen; the header main action on the table view; each dialog its own layer).
- Tap targets ≥ 56 px (steppers 56, dialog buttons 72, phone tabs 60).
- Availability, stages and queue states are icon + word + colour.
- Prices, quantities, weights, times, the token, plates, phone numbers and table names stay LTR with Latin digits. Promises are always a clock time ("8:27 PM"), never "in 12 min". Urdu: RTL layout (rail on the right), logical CSS.
- Little text; no error codes or server text on screen.

## Check your work
Screenshot each 02b state at frame size, compare with `design/screens/*.png`, test the keyboard on the menu, cart, sheets and number pads, and report: screen ID → done / differs (why), open questions, strings you couldn't place.
