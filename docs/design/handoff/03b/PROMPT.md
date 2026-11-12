# Prompt for Claude Code — build 03b (KDS + Pass) and 03c (Printing)

Copy everything below the line into Claude Code. Run it from the root of the POS repo with this folder (`pos-03b-handoff/`) at the repo root. Build 01d (alerts) and 02a/02b first: the Pass uses 01d's staff entry and alert cards.

---

You are building the UI of **module 03b · Kitchen screens and the Pass** and **03c · Printing**:
- the KDS station screen (1920×1080 and 1280×800 wall tablets, dark);
- the Pass on a point-bound tablet (light);
- four new 01d alert cards;
- the hub admin pages "Kitchen screens" and "Printers";
- the on-screen paper preview.

- Follow specs 03b and 03c and their status-board rulings for every API name, field, limit and error code. **Do not change server code or API shapes.**
- The **paper text is fixed by 03c §3.3 / §3.5** (`renderText`). Only build the on-screen preview look; never change ticket text.
- **This is the core set (71 frames).** States without a frame follow the shared patterns below and `brief/03b-03c-brief.md`. Ask before you invent behaviour.

**Two design stacks. Never mix them in one screen.**
- **Staff screens (KDS, Pass, alert cards, phones):** Pulse Chatkhara.
  - CSS, in this order: `design/pulse.css`, `design/v-brand.css`, `design/pulse-01d.css`, `design/pulse-02.css`, **`design/pulse-03.css`**.
  - KDS root: `.pu.v-brand.kds` (dark tokens).
- **Hub admin pages (Kitchen screens, Printers, AdminHome tiles, paper preview):** the 00 admin shell (owner kit).
  - CSS, in this order: `design/ds/pos/tokens.css`, `design/ds/pos/components/bundle.css`, `design/kit-additions.css`, **`design/admin-03.css`**.
- Fonts: `design/ds/pos/fonts/`. Load **no** CDN fonts.

## Read first (in this order)
1. `CHANGES.md`: owner decisions, the UX review, answers to brief §7 (Q-1 to Q-20), new string keys, open items.
2. `MAPPING.md` (and `mapping.json`): screen ID → frames.
3. `brief/03b-03c-brief.md`: behaviour, copy and error codes.
   - If a frame and the brief disagree on **behaviour or copy**, follow the brief.
   - If they disagree on **layout or look**, follow the frame.
4. `design/*.dc.html` and `design/screens/*.png`: the frames (static HTML at device size).

## Steps
1. **KDS (03b-S01):**
   - Header `.kbar`: station name, lane control, and a Live / Reconnecting chip. No clock.
   - Lane control (Q-3): Lane Off is **hidden** when lane_count = 1 or only 1 lane is on. Lane On is off when all lanes are on. "Custom capacity": Lane Off sets lane_count − 1, Lane On sets all on. The Pass station strip uses the same rule.
   - Coming-up strip `.kcu` under the header: max 6 chips, computed on the screen.
   - **Now** is a card grid in append order: 3 columns at 1920, 2 at 1280 (`.kl--c` compact). It scrolls inside; the header and the Next column never move.
   - **One card per line, never merged.**
   - Each card shows one action:
     - Start, then Done, then Undo m:ss (30 s);
     - B01 is an inline confirm in warn;
     - B02 "Tap Start first" lights Start;
     - B04 is a warn cue band.
   - Marks:
     - RETURN, BOOST, EXPEDITE and MOVED are danger;
     - PULLED is soft info.
   - "Printed" tag and the optional "Ready-made" tag.
   - **Reprint** on a card only when the station's `has_printer` is true. Otherwise there is no Reprint at all (never greyed).
   - **Next** is the right column with "in m:ss", then a Later count, then **Give me more**.
   - Batch stations: no grouping. Highlight the changed rows (`.s-hl`) and show one info line.
   - States: Reconnecting (every button off), Archived banner, Day not started, First load, Empty, "Tap to turn on sound" (once).
2. **Sounds:** the enter-Now chime and the strong RETURN / boost / expedite sound use the station's volume. There is no mute and no volume control on the KDS.
3. **Pass (03b-S02):**
   - Nav segment **Pass · Inbox · Requests**; Pass is the default.
   - Station strip: lanes, "Screen offline" (dark), "No screen".
   - Cards are oldest first. Lines are grouped by station and each shows a stage chip.
   - Footer buttons:
     - **Ready to serve** is green. It is the only green action.
     - **Hand over** uses the info tone and is hidden until a done line exists.
     - Both are 72 px.
   - After Ready: the band "Ready · 1:21 PM · Asif", a count-up and Undo m:ss. HOLD AT PASS is an amber pill.
   - Takeover section `.tko` above the cards. It uses the same rows as the KDS, and its words stay English.
   - When the takeover ends: toast "{Station} screen is back".
   - Hand over sheet: 96 px receiver tiles, the table team first, no line picker. A tap hands over every done line, max 40, with an "N left" result.
   - States: offline, read-only, archived point, empty, loading, portrait (one column), Urdu RTL.
4. **Alert cards (03b-N01–N03, 03c-N01):**
   - Use 01d's card, lock line and banner in every state shown in `AlertCards` and `AlertLock*`.
   - `ticket_not_built` printer card: managers see **Dismiss**, and after the tap the card closes as "Dismissed · {name}". Everyone else sees no button and "Stays until day close". No other alert kind has Dismiss.
   - The notice detail adds "Open Printers" / "Open Kitchen screens" on admin-capable devices.
5. **Hub admin "Kitchen screens" (03b-S04):**
   - New sidenav item and a home tile with a status line.
   - Station cards: screens with a lane label and a state chip, plus a volume slider 0–100 with "Play on this device" (local only).
   - Pass tablets section with "Use a tablet as Pass tablet" (D03 picker fed by 00 devices).
   - Lane label dialog, warnings (B16), empty state.
6. **Hub admin "Printers" (03c-S01/S02/S03):**
   - Printer cards: connection · address · paper, status chip, facts, Test print / Edit / ⋯. A USB printer shows the info note.
   - **Station outputs** table: archived rows are read-only with **no printer** (released on archive). Their pending jobs stay in the queue until a manager cancels them.
   - **Print queue**: time, kind, station · printer, state, Cancel.
   - Dialogs: Add / edit (field errors), Test print results, Archive (409 in use), Output editor (4 modes and 2 toggles), Cancel job.
   - Warnings: Urdu letters print as "?", screen unused, ticket not built.
7. **Paper preview (03c-C04):**
   - Monospace at 48 or 32 columns.
   - `x2` lines: the leading spaces keep normal width and the letters are double size.
   - Bold lines, a dashed cut, and lost letters marked "?".
   - Never Urdu, never prices.
8. **Strings:** brief §6 plus CHANGES §5. Put Urdu you can't place in `docs/design/handoff/03b/urdu-todo.md`.

## Pixel-perfect and layout behaviour (must match the frames)
- **Pixel-perfect.** Match each frame exactly: spacing, sizes, radii, font sizes and weights, colours, shadows, icon size and alignment. Measure from the frame HTML, not by eye. Use tokens only.
- **KDS (1920×1080, 1280×800): fit to screen.**
  - The page never scrolls: the root is `100dvh` with `overflow: hidden`.
  - Only the Now grid and the Next list scroll inside (`overflow-y: auto; min-height: 0`).
  - The header, the coming-up strip and Give me more are always visible.
- **Pass tablet (1280×800 landscape, 800×1280 portrait): fit to screen.**
  - The top bar and the station strip are fixed; only the card area scrolls.
  - Sheets: `max-height: calc(100dvh - 32px)`, and their buttons stay visible.
- **Hub admin (laptop 1440, works 1280+):** the sidenav and appbar are fixed and `.pos-content` scrolls. The frames are drawn tall to show the full content; build them as a scrolling page.
- **Phone (390, works 360–430): exactly the phone frames.** Cards stack, problems come first, and the bottom sheets match. Never shrink the laptop layout. No horizontal page scroll; wide tables become stacked rows.
- Wider than the frame: same layout, nothing scales up.
- Test at 1920×1080, 1280×800, 800×1280, 1440×900, 390×844 and 360×740 against `design/screens/*.png`.

## Rules on every screen
- One primary button per layer:
  - KDS: the card's one action;
  - Pass: Ready to serve per card;
  - Admin: the appbar action;
  - each dialog is its own layer.
- Tap targets ≥ 56 px. On the KDS and the main Pass actions, 72 px.
- Every status is icon + word + colour: stages, marks, printer state, screen state, test results.
- Numbers, times, identifiers, plates, IPs, device paths and paper sizes stay LTR with Latin digits. Urdu screens are RTL with logical CSS. The KDS is English only.
- Keep text short. Never show error codes or server text on screen.

## Check your work
Screenshot each state at frame size and compare it with `design/screens/*.png`. Test the keyboard on the admin pages and dialogs. Report:
- screen ID → done / differs (why);
- open questions;
- strings you couldn't place.
