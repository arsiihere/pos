# Prompt for Claude Code — build module 01d (notifications and requests) in the Pulse design

Copy everything below the line into Claude Code. Run it from the root of the POS repo, with this folder (`pos-01d-handoff/`) placed at the repo root.

---

You are building the UI of **module 01d · Notifications and requests** in the **Pulse** design.

- The staff entry `/staff/` already exists from batch 9a. It works, but it was never designed. Re-skin it and complete it from these frames.
- Follow spec `docs/specs/01d_Notifications_Requests_Spec_v1.0.md` and the rulings in `docs/plans/01d-status.md` for every API name, field, limit and error code.
- Do not change server code or API shapes.

**This hand-off is the core set** (59 frames): the main state of every screen, the key errors and offline states, tablet portrait, kiosk, phone, KDS dark, and Urdu frames for the components, banner, inbox and answer sheet.

States without a frame follow the shared patterns described below and in the brief. Ask before inventing anything those patterns don't cover.

**Look: Pulse Chatkhara staff app with Puck+ tables** (the direction chosen for the staff screens).

- Styles: `design/pulse.css` (structure), `design/v-brand.css` (Chatkhara tokens) and `design/pulse-01d.css` (01d patterns).
- Fonts: use the bundled fonts in `design/ds/pos/fonts/`. The frames load Google Fonts only for preview; the hub has no internet.
- White-label: only the brand tokens change (maroon chrome and saffron primary). Status colours stay fixed.

## Read first (in this order)
1. `pos-01d-handoff/CHANGES.md` — the design decisions: the UX review, DQ1–DQ6, the sound recipes and the new string keys.
2. `pos-01d-handoff/MAPPING.md` (and `mapping.json`) — every screen ID → its frames → components → data.
3. `pos-01d-handoff/brief/01d-brief.md` — every screen, state, copy and error code. If a frame and the brief disagree on behaviour or copy, follow the brief. If they disagree on layout or look, follow the frame.
4. `pos-01d-handoff/design/` — the frames and `design/screens/*.png`.
   - The frames are `*.dc.html` files: static HTML at device size.
   - Device sizes: tablet 1280×800, tablet portrait 800×1280, cashier kiosk 1920×1080, KDS 1920×1080 dark, phone 390×844.
5. `pos-01d-handoff/design/pulse.css`, `design/v-brand.css`, `design/pulse-01d.css` — the staff-app styles; `design/ds/pos/` — fonts and tokens; `design/kit-additions.css` — only for the hub admin frame (00).

## Steps
1. **Design system.** Use the Pulse tokens, components and the 5 bundled fonts. Load no fonts from a CDN; the hub has no internet. Status colours stay fixed. Brand colours come only from `--brand-primary` / `--brand-secondary`.
2. **Add `pulse-01d.css`** after `pulse.css` and `v-brand.css`. Its patterns:
   - Family pill: `.fam--urgent|action|info|silent`; small tags: `.atag`.
   - Table chip: `.tcode`.
   - List card: `.lcard` (+ `__h`, `__b`).
   - Open card: `.ac` (+ `__lead` with the waiting ring, `__body`, `__top`, `__title`, `__who`, `__det`, `__end`, `__amt`), with `is-new` and `is-ro`.
   - Row: `.ar` (+ `__ic`, `__t`, `__s`, `__e`, `__res`), with `is-new` and `is-closed`.
   - Lead groups: `.forg`.
   - Banner: `.abns` + `.abn` + `.abn__more`.
   - Tablet alerts header (B05): `.bind`.
   - Dialog / sheet: `.scrim`, `.dlg`, `.dlg__h`, `.facts` / `.fact`, `.acts`, `.here`, `.ro`, `.msg`.
   - PIN step: `.pin` (+ `__dots`, `__keys`, `__err`).
   - Staff tiles: `.who`; lock text (F01): `.lockp`; no-approver warning (B06): `.warnbar`.
   - Test alert: `.pick` + `.radio` + `.on`; receipts: `.rt`.
   - Feedback and states: `.done`, `.toast`, `.empty`, `.sk`.
3. **Staff entry shell (T, K).**
   - Maroon 80 px top bar. On the start side, the brand block: mark, "Arif Chatkhara", "Gulberg · Tablet 3".
   - On **tablets**, the brand block's third line is B05 ("Alerts: Ali — pauses at 2:05 PM" / "Alerts paused" / "Alerts: none"), shown whether or not anyone is signed in.
   - Then the segmented nav: **Inbox (red count) · Requests (red count, approvers only) · Test alert (manage-devices only)**.
   - On the end side: Live, clock, and the person chip (sign out).
   - Portrait: the nav moves to its own full-width row under the top bar.
   - The kiosk has no browser back. The segmented nav is its way back.
   - **Phone**: a bottom tab bar with Inbox · Sign out. The phone has no Requests screen (brief §3: T K only).
4. **On 02 / 05 screens (the Puck+ tables screen and others):** replace the single bell with two icon buttons, **Requests** (shield) and **Inbox** (tray), each with a red badge. B05 goes in the brand block there too. The banner layer sits above every screen (DQ1).
5. **Build each screen** from `MAPPING.md`, frame by frame:
   - **Alert card (C01).**
     - Show card text only on the person's own staff session. Everywhere else, show the lock line ("T12 · Void request · Hamza"), and never amounts, items or reasons.
     - The whole card is the tap target. Tapping it opens D01 / D04 and sends MarkAlertsSeen (batched).
     - An unseen card shows a red dot. A closed card is greyed and shows its result line.
   - **Banner (B01).**
     - Urgent stays until it is opened or seen elsewhere. Action hides after 6 s and Info after 4 s.
     - It has no Later, close or snooze.
     - At most 2 are shown, then the "{n} more new · Open inbox" bar.
     - Always-on screens show lock text only and play one sound per step.
     - After a reconnect, show an unseen urgent or action alert once more.
   - **Inbox (S01):** open items first, then newest. A lead sees "For {name}" groups (DQ5). When offline, keep the last list, show the B03 banner, and still let details open.
   - **Requests (S02):** "You can answer" (oldest first) and "For your information" (read-only rows). A row answered elsewhere shows its result line, then slides out.
   - **Answer (D01).**
     - Centred dialog on landscape tablet and kiosk; bottom sheet on portrait.
     - Money kinds: Reject / Approve, then the PIN step (D02).
     - Accept kinds: Decline / Accept in one tap, with no PIN.
     - Show "Approve here" only when `raised_device_id` is this device.
     - After success, show a short "Approved" / "Rejected", then close. Show no receipt on this seat.
   - **PIN step (D02):** the last key of the pad reads Approve or Reject. Hold the PIN in memory only, and clear it after every response, error included. While the hub socket is down, turn off the pad and buttons (B03). Never queue a PIN.
   - **Approve here (D03):** approver tiles (people without a PIN never appear) → that person's PIN, with the warning line. Send `method: 'in_person'`.
   - **Read-only (B02), offline (B03), errors (B04):** exactly as in the frames and in the brief §6 texts.
   - **Notice (D04):** facts box plus the "Not you?" line for N01 / N03. Close is the only button.
   - **Lock text (F01):** on a signed-out kiosk or phone, a dark panel with up to 3 lines and "Sign in to see details".
   - **No one can approve (B06):** a sticky warn banner on always-on screens and managers' devices. On KDS, use the dark banner.
   - **Stuck alerts (B07):** a banner on 00 `/admin` home. Hidden at 0.
   - **Test alert (S03) → Receipts (S04):** Point stays off until points exist. Receipts re-fetch every 5 s while open, with one table per step.
6. **Sounds:** Web Audio recipes in CHANGES §4. There is no mute and no snooze. Volume follows the device.
7. **Strings:** add the keys in CHANGES §5. Put any Urdu you can't place in `docs/design/handoff/01d/urdu-todo.md`.

## Pixel-perfect and layout behaviour (must match the frames)
- **Pixel-perfect.** Match each frame exactly: spacing, sizes, radii, font sizes and weights, colours, shadows, and icon size and alignment. Measure from the frame HTML, not by eye. Use only the tokens; add no new hard-coded values.
- **Tablet / kiosk / laptop (1280 and up): fit to screen.** The page itself never scrolls.
  - The shell fills exactly the viewport height: `height: 100dvh; overflow: hidden`. The shell is the top bar, the B05 strip, the nav tabs and any bottom bar.
  - Only the list region scrolls: `overflow-y: auto; min-height: 0`.
  - Example: in the Inbox, the top bar stays put while each card's list (`.lcard__b`) scrolls.
  - Dialogs are centred with `max-height: calc(100dvh - 32px)`. Their body scrolls; their buttons always stay visible.
- **Tablet portrait (800 wide):** same layout, one column. D01 / D04 become bottom sheets.
- **Phone (390 wide, and 360–430):** exactly like the phone frames.
  - Phone top bar with the screen title, and a bottom tab bar.
  - Cards fill the full width. The banner spans the width under the top bar. Sheets come up from the bottom.
  - Never shrink the tablet layout; never allow horizontal scroll.
- On screens wider than the frame, keep the same layout. Content stretches or centres as drawn; nothing scales up.
- Test at exactly 1280×800, 800×1280, 1920×1080, 390×844 and 360×740, and compare with `design/screens/*.png`.

## Rules that must hold on every screen
- One primary button per screen layer. A banner's Open and a card's Answer use the tinted `btn--tone`.
- Tap targets ≥ 56 px; 72 px on the kitchen screen.
- Status and family are always shown as icon + word + colour, never colour alone.
- Tables, amounts, times, PINs, device names and codes stay LTR (`.num` / mono), with Latin digits in Urdu. Urdu pages use `lang="ur" dir="rtl"` and logical CSS only; chevrons mirror.
- Never show a permission key or a kind key; show only the plain label (`alert.<kind>.card` / `.lock`).
- Queries never keep a session alive. Only tapping an alert does.

## Check your work
- Screenshot each 01d screen state at the frame's size and compare it with `design/screens/*.png`.
- Keyboard: cards, banner Open, the nav tabs, the PIN pad, the For groups and both sheets all work with Tab / Enter / Escape.
- Report back: screen ID → done / differs (and why), open questions, and strings you could not place.
