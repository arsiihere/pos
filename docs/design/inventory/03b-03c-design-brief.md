# 03b KDS + Pass and 03c Printing — design brief

For the designer. This one file is everything you need to design every screen, state, alert card and printed layout of modules **03b (KDS + Pass)** and **03c (Printing)**. All behaviour is already decided by the approved specs. Your job is the look and the layout only.

**Sources, in order of authority:** `docs/specs/03b_KDS_Pass_Spec_v1.0.5.md` (cited "03b §n") and `docs/specs/03c_Printing_Spec_v1.0.5.md` (cited "03c §n"), both APPROVED 2026-11-12. Then the build board `docs/plans/03b-status.md` (owner rulings AD-n), the plans `03b-plan.md` (client rows BU1–BU3) and `03c-plan.md` (CU1–CU2), the stories (`docs/stories/stories-refined.md` E3, `03b-g0.md`, `03b-g1-decisions.md` Q1–Q13 and R-1–R-6, `01d-g0-decisions.md` K1–K13), and what is already built in the hub (`apps/hub/src/kds/`, `apps/hub/src/print/`, `apps/hub/src/queries/`) and the client (`apps/client/src/features/kds/slots.ts`, `features/owner/branches/KitchenTiming.tsx`, `features/alerts/*`). Where the hub code is the only source of a fact (for example a test-print error word), it is cited as "hub: <file>".

**This file replaces nothing.** `docs/design/inventory/03b-kds-printing.md` is the pre-spec inventory (2026-10-26). Many of its screens and questions are now outdated (no expo screen, no strikethrough reprint, no slip warning here, no KDS settings sheet). Where it disagrees with this file, this file wins, because this file follows the approved specs. A mapping of old IDs to new IDs is in §2.3.

---

## 0. How to use this brief

### 0.1 Scope

You design:

1. **KDS station screen** (kitchen wall screen) — the cook's view of one station. 03b §3.3, §8.
2. **Pass screen** (assembler view on a tablet bound to a point) — every order with lines at this point, Ready to serve, Hand over, Start / Done for stations with no screen, lanes, and the takeover of a dark station. 03b §3.4–§3.7, §8.
3. **Four new alert cards** that 01d's alert system shows: Ready to serve, Served card, Kitchen screen offline, Printer problem. They reuse 01d's card, banner, inbox and lock-text components (`docs/design/handoff/01d/`). You design their content in every state, not new components. 03b §6.21, 03c §6.10.
4. **Hub admin "Kitchen screens" page** — stations, their screens, lanes, sound volume, Pass tablets, device roles, warnings. 03b §3.8, §6.12.
5. **Hub admin "Printers" page** — printers (add, edit, archive, test print), station outputs, print queue (cancel, suspects), warnings. 03c §3.2, §6.2–§6.7, §8.
6. **The `printed` tag and the Reprint action** on KDS rows and Pass cards. 03c §3.5, §3.8, §8.
7. **On-screen previews of the printed layouts** (kitchen ticket, CANCELLED, FIRST, COMING UP, REPRINT header, test print) at 58 mm and 80 mm. The text of each layout is fixed by 03c §3.3 and §3.5 (see §5). You draw how the preview looks on screen, and you may not change what prints.
8. **The owner-app group "Kitchen screens and the pass"** is already built (`KitchenTiming.tsx`). Restyle it only as part of the owner-app pattern. Nothing new is needed (§3.7).

### 0.2 Not to be designed here

| Thing | Why / where it lives |
|---|---|
| The engine's order of lines, times and plans (Now / Next / Later, `fire_ms`, late) | 03a. 03b only shows it (03b §3.3). |
| Mark Served, boost, release, return to kitchen, removal, void buttons | 02b / 04 screens (03b §1.3). The KDS and Pass only show their effect. |
| Slip warnings ("T7 Karahi is running 6 minutes late") | 03a's `slip_warning` kind on 01d cards (stories E3-KDS AC6: "the slip warning is 03a's"). |
| Pairing a screen, "Pair again", "This screen is open in another window" (`kds.replaced`), ending a KDS session | Already designed in 00 (`docs/design/handoff/00/`: `PairWaiting`, `GlobalRepairKds`, `SessionsEndKdsDialog`, ui-brief §1.4 / `kds.replaced`). Reuse as is. |
| Staff sign-in on the Pass tablet, the tablet alerts header (B05), the inbox, banners, lock text, "No one can approve" on the KDS | Already designed in 01d (`docs/design/handoff/01d/`: `SignIn`, `CardsDark`, `NoApproverKds`, `Banner*`, `Inbox*`). Reuse. |
| Bill, receipt, Z report content and template | 05 (03c §1.3, §4.3). 03c only gives 05 the print API. |
| Button devices, headless point devices, pagers, lane claims | 01e (03b §1.3). |
| Audio callouts ("Table 5 karahi ready"), Urdu-script printing, a configurable kitchen ticket template, training mode | Deferred (03b §1.3, 03c §1.3). |
| Strikethrough reprint after Done on a printed ticket | Not in 03c; owner deferred it until after the pilot (03b-status G5). Do not draw it. |
| "Each tap logged under the logged-in cook" on the KDS | Superseded: the KDS is a station session with no person (03b §3.2 last line, 03b-status G6). No cook picker on the KDS. |
| An "expo" or "all stations" KDS screen | Replaced by the Pass screen per point (stories E3-KDS AC1 change S-1, 01d K6). |
| A KDS settings sheet (volume, view) on the kitchen screen | Volume is set only on the hub admin page (03b P7, stories AC5 change). No settings on the KDS. |

### 0.3 The "design only" rule

"Sari information ho, aur design mein bas design hi bana ho." Every behaviour, rule, limit, error code, number and printed text below is decided. Do not add, remove or change behaviour: no new buttons, confirmations, steps, settings, filters or data. Where the spec is silent, this file says **"spec silent → designer choice"** (you choose the look, the behaviour is unchanged) or lists it in §7 as an open design question with a recommendation. If you think a behaviour is wrong, write it as a note on the frame. Do not design around it.

Copy is **intent plus a proposed English text** (§6). You may improve the wording. You may not change the meaning. Error texts never show the server's message or a code (00-index "Error by code").

### 0.4 Deliverable the owner expects

Same format as the 01d hand-off (`docs/design/handoff/01d/`): static `*.dc.html` frames at device size, a `MAPPING.md` (screen ID → frames → components → data), a `CHANGES.md` (your decisions, answers to §7, new string keys), PNG screenshots, and any CSS additions as a separate file (like `pulse-01d.css`). Put it in `docs/design/handoff/03b/` (the build lanes wait for that folder: `03b-03c-prompts.md` §6, `03b-status.md` lanes table).

| Rule | Detail |
|---|---|
| One frame per state | Every state in §3 that changes what the screen shows gets a frame. Small inline states (one line of text) may share a frame with a note. |
| Sizes | KDS **1920×1080** and **1280×800** (tablet on the wall), dark. Pass tablet **1280×800** landscape and **800×1280** portrait. Staff phone **390×844** (alert cards only). Cashier kiosk **1920×1080** (alert cards, hub admin). Hub admin on a laptop **1440×900** and phone **390×844** (00's admin pages have phone layouts). Owner app 1440 and 390. |
| Themes | KDS: dark only. Pass tablet: the light Pulse staff theme, plus the takeover section (§3.2.6) in light. Alert cards: light (staff app) and dark (only where a KDS shows a lock line, 01d `CardsDark`). Hub admin: light (00 `ds/pos` + kit). |
| Urdu RTL | Required for the Pass screen (main state, card states, hand-over sheet, takeover section), the four alert cards (card and lock text), and both hub admin pages (main state). The KDS station screen is **English only in P1** (story E3-KDS: "In scope (P1): web-based KDS, English labels"), so no Urdu KDS frames; but item names are menu data and may contain Urdu script, so draw one KDS frame with a mixed-script item name. Printed paper is never Urdu (§5.1). |
| Sample data | Use §0.6. |
| Pixel rules | As 01d PROMPT "Pixel-perfect and layout behaviour": the page never scrolls on tablet / kiosk / KDS; only list regions scroll; no horizontal scroll on the phone. |

### 0.5 Design language to follow

- **Pulse, Arif Chatkhara theme** (01d hand-off): maroon chrome `#6E140E`, cream ground `#F8F1E7`, white cards, saffron primary `#F4A321`, Bricolage Grotesque (display, numbers) + Figtree (text) + Geist Mono (codes, IPs) + Noto Nastaliq Urdu. Files: `docs/design/handoff/01d/design/pulse.css`, `v-brand.css`, `ds/pos/tokens.css`, fonts in `ds/pos/fonts/` (bundled; the hub has no internet).
- **KDS dark:** `.pu.v-brand.kds` in `v-brand.css` (warm near-black `#120A08`, surface `#1C1210`, ink `#FFF3E8`, saffron accent, dark status colours ok `#42D392`, warn `#FF9A3C`, danger `#FF5A55`, info `#6AAEFF`) and `[data-theme="dark"]` in `tokens.css`. `pulse.css` already has early KDS patterns: top bar `.kbar` (96 px), queue `.kq`, ticket `.kt` with states `s-late` / `s-fire` / `s-first` / `s-new`, flag `.kflag`, note `.kt__note`, parking plate `.kt__n.plate`, done bar `.kdone`. They were drawn before the spec. Reuse their look, but follow this brief where they differ: for example done lines stay in their row (§3.1.2), and rows show no clock times (03b P6).
- **White-label:** only `--brand-primary` / `--brand-secondary` change per restaurant. Status colours are fixed.
- **Hub admin pages:** the 00 admin look (`docs/design/handoff/00/00-design.md`: `.pos-shell`, `.pos-sidenav`, `.pos-card`, `.pos-banner`, `.pos-chip`, `.pos-switch`, list rows; phone layout under 760 px).
- **Global rules** (00-index, 01d PROMPT): one primary button per screen layer; status is always icon + word + colour, never colour alone; tables, times, counts, quantities, IPs, device names and codes are LTR (`.pos-ltr` / mono) with Latin digits in Urdu; 12-hour times everywhere ("1:22 PM", 03b §8, 01d AD-167); never show a permission key, kind key, error code or raw enum value.

### 0.6 Sample data (Arif Chatkhara, Gulberg branch, lunch rush, 1:20 PM)

| What | Sample |
|---|---|
| Point | **Pass** (one shared point). Stations on it: **Karahi** (KDS, `two_tap`), **Tandoor** (2 KDS lane screens "Left" and "Right", `single_tap`), **Fryer** (KDS, `auto_done`), **Cold** (no screen: Raita, Salad). A second point **Degh** (Paye, batch station) for the batch scenario. |
| Dine-in, merged tables | **T4 + T5**: 2 × Chicken Karahi Full with "No onion", "2 x Extra butter", kitchen note "less spicy"; 6 × Naan; 2 × Raita. Order note "birthday, bring together". Order taker Hamza. |
| Named table | **Family 2** (a table whose name is not all digits gets no "T", 03b §3.1, 01d P-1). |
| Takeaway from an earlier business day | **#12 10 Nov**: 4 × Naan. Today's token: **#12**. |
| Parking | **PARKING LEB 1234 SEDAN**: 1 × Chicken Karahi Half with "2 x Extra butter". |
| Remake | Return of T7's Chicken Karahi Half, mode remake, "No onion" copied (03b v1.0.4 B3-4). |
| People | Imran (manager), Arif (owner), Asif (cook, on the Pass tablet, has `run-pass`), Bilal and Ali (waiters), Hamza (order taker), Sana (cashier). |
| Devices | "Tandoor Left", "Tandoor Right", "Karahi screen", "Fryer screen" (KDS); "Pass tablet" (tablet bound to point Pass); manager tablet "Tablet 3". |
| Printers | "Tandoor printer" LAN `192.168.1.50:9100` 80 mm; "Cold printer" USB `/dev/pos-printer-cold` 58 mm; "Counter" LAN `192.168.1.51:9100` 80 mm. |

---

## 1. Devices and contexts

| Code | Device | Size | Who | Conditions | Touch target |
|---|---|---|---|---|---|
| **W** | KDS wall screen, hub-served browser, station session (no person, no PIN) | 1920×1080 landscape; also a 1280 tablet on the wall | Cooks at one station | Read at **1–3 m**; heat, steam, glare, noise; **wet or greasy hands**; no hover; **no modal dialogs**, only inline second taps (03b §3.2 DoneItem step 4, §8) | **72 px** minimum (`--touch-kitchen`) |
| **W-L** | Lane KDS: a W device with a `lane_label` ("Left", "Right") | as W | One cook of a big station | As W; shows the same station view plus the lane control (03b §3.7, §8) | 72 px |
| **T-P** | Pass tablet: Android tablet (Capacitor) bound to a point (`devices.point_id`), `/staff/` entry, staff signed in with PIN | 1280×800 landscape; 800×1280 portrait | The assembler (Cook Asif by default, Manager, Owner: `run-pass`) | Standing at the pass, busy, one hand, food in the other; hands often wet | 56 px (Pulse staff rule); the Ready / Hand over / receiver tiles at 72 px recommended (§7 Q-11) |
| **P / T** | Staff phone (browser) or waiter tablet | 390×844 / 1280×800 | Waiters, order takers: Ready to serve card, Served card | Walking the floor | 56 px |
| **T / K** | Manager tablet or kiosk | 1280 / 1920 | Manager: Kitchen screen offline card, Printer problem card | Rush | 56 px |
| **L / K / P** | Hub admin (admin session, `manage-devices`) in a browser on the hub LAN | 1440 laptop, 1920 kiosk, 390 phone | Manager or owner at setup and on install day | Calm; sometimes during a rush (paper out at 1:30 PM) | 48–56 px |
| **L / OP** | Owner app (cloud) | 1440 / 390 | Owner | Office | as owner app |
| **Paper** | Thermal ESC/POS printer, 58 mm (32 columns) or 80 mm (48 columns), USB or LAN | — | Cooks | Grease, heat | — |

**Sound.** Only the KDS station screen makes 03b sounds: a **chime when a line enters Now**, a **stronger sound for a RETURN, boost or expedite line**, **no sound for late** (03b P7). Volume = the station's `sound_volume` 0–100 (default **70**, 0 = silent), set only on the hub admin page (03b §3.8). There is no mute and no volume control on the KDS. The four alert kinds use 01d's family sounds on staff devices (01d CHANGES §4: Action double ding; Info soft chime). The KDS is also an always-on 01d screen: one sound per step, lock text only (01d brief §4). The tones are Web Audio like 01d's (`features/alerts/sounds.ts`); the two KDS tones are §7 Q-5.

**Reading distance.** On the KDS the identifier ("T4 + T5"), the quantity and the item name must be readable at 3 m. The Pulse `.kt` pattern uses a 44 px identifier, 32 px item lines and a 26 px timer at 1920. Keep these sizes or larger. Never put important text in small grey type.

**Network.** Everything is hub LAN. While the hub socket is down, KDS and Pass taps are **disabled** with a "Reconnecting…" banner. 03b commands are never queued (03b P5, §3.2 last line, §8).

---

## 2. Screen inventory

### 2.1 Table

Kinds: **S** screen, **C** component, **B** banner or inline state, **D** dialog or sheet, **F** full-screen state, **N** alert card (01d component, new kind), **P** printed layout. Devices as §1.

| ID | Name | Kind | Device | Who | Spec | Stories |
|---|---|---|---|---|---|---|
| **03b-S01** | KDS station view (Now / Next / Later) | S | W, W-L | cooks | 03b §3.3, §6.14, §6.16, §8 | E3-KDS AC1–AC4, AC7, AC8, AC9 |
| 03b-C01 | KDS line row (every stage, mark and cue) | C | W, T-P (takeover) | cooks, assembler | 03b §3.3, §4.4 | E3-KDS AC3, AC4, AC6, AC7 |
| 03b-C02 | Identifier block (table, token, parking) | C | W, T-P, cards | all | 03b §3.1, §4.4 | E3-KDS AC3 |
| 03b-C03 | Line timer (waiting / cooking / late / in) | C | W, T-P | cooks | 03b §3.3 | E3-KDS AC3, AC6 |
| 03b-C04 | Mark tag (RETURN, Boost, Expedite, Pulled, Moved) | C | W, T-P | cooks | 03b §3.3; 03a §3.3 `mark` | E3-KDS AC7 |
| 03b-C05 | Placeholder row (details not yet arrived) | C | W, T-P | cooks | 03b §3.3 Details | — |
| 03b-C06 | Coming-up strip | C | W | cooks | 03b §3.3, P12 | — |
| 03b-C07 | Give me more button | C | W, T-P (takeover) | cooks, assembler | 03b §3.2 GiveMeMore | — |
| 03b-C08 | Lane control (lane KDS and Pass) | C | W-L, T-P | cook, assembler | 03b §3.7 | (01d K8) |
| 03b-C09 | KDS header bar (station, lanes, connection) | C | W | cooks | 03b §3.3, §8 | — |
| 03b-B01 | Done early? inline confirm | B | W, T-P | cooks | 03b §3.2 DoneItem step 4, §9 | E3-KDS AC4 |
| 03b-B02 | "Tap Start first" inline | B | W, T-P | cooks | 03b §3.2 DoneItem step 3 | E3-KDS edge |
| 03b-B03 | Undo Done window (30 s countdown) | B | W, T-P | cooks | 03b §3.2 UndoDone, §3.3 | E3-KDS edge "undo" |
| 03b-B04 | "Tap Done" cue (undone auto-done line) | B | W, T-P | cooks | 03b §3.3 (v1.0.5 B2-3), §6.14 | E3-KDS AC9 |
| 03b-B05 | Inline row error (other codes) | B | W, T-P | cooks | 03b §3.2, §9 | — |
| 03b-B06 | Reconnecting banner, taps disabled | B | W | cooks | 03b P5, §8 | — |
| 03b-B07 | Station archived banner | B | W, T-P | cooks | 03b §3.3, §3.10 | E1-FLR AC6 |
| 03b-B08 | Nothing to pull (Give me more found nothing) | B | W, T-P | cooks | 03b §3.2 GiveMeMore | — |
| 03b-F01 | Day not started | F | W | cooks | 03b §3.3, 00 Q10 | — |
| 03b-F02 | KDS first load | F | W | — | 03b §6.14 | — |
| **03b-S02** | Pass screen (assembler view) | S | T-P | assembler | 03b §3.4, §6.15, §8 | E3-KDS AC1, AC10; 01d K2–K6 |
| 03b-C10 | Pass order card | C | T-P | assembler | 03b §3.4, §3.5 | AC10 |
| 03b-C11 | Pass line row | C | T-P | assembler | 03b §3.4 | — |
| 03b-C12 | Readiness mark (Ready / HOLD AT PASS) | C | T-P | assembler | 03b §3.4, K4 | AC10 |
| 03b-C13 | Station strip on the Pass (stations of the point, lanes, screen offline) | C | T-P | assembler | 03b §6.15 `stations[]` | — |
| 03b-D01 | Hand over sheet (receiver tiles) | D | T-P | assembler | 03b §3.5 Handover, §6.11 | K5, K13 |
| 03b-B10 | Ready state on the card with Undo ready (30 s) | B | T-P | assembler | 03b §3.5 UndoReadyToServe | — |
| 03b-B11 | Hand-over result, incl. "N left" after 40 | B | T-P | assembler | 03b §3.5 step 3 (v1.0.3 B4-2), §6.8 | — |
| 03b-B12 | Pass offline banner, taps disabled | B | T-P | assembler | 03b P5, §8 | — |
| 03b-B13 | Pass error lines (per code) | B | T-P | assembler | 03b §6.6–§6.8, §9 | — |
| 03b-B14 | Read-only Pass (signed-in person has no `run-pass`) | B | T-P | waiter on the Pass tablet | 03b §3.9; 00-index "Permission" | — |
| 03b-B15 | Pass point archived | B | T-P | assembler | 03b §3.5 step 1, §4.5 D-6 | — |
| **03b-S03** | Takeover section "<Station> screen offline" | S (section of S02) | T-P | assembler | 03b §3.6, §6.15 `takeovers`, §6.16 `station_takeover` | E5 power |
| **03b-N01** | Ready to serve (alert card + lock line) | N | P, T, K; Pass tablet and managers at escalation | waiters / order taker | 03b §3.5, §6.21 | 01d K2–K5 |
| **03b-N02** | Served card (alert card + lock line) | N | P, T | the receiver | 03b §3.5 step 6, §6.21 | 01d K5 |
| **03b-N03** | Kitchen screen offline (alert card + lock line) | N | T, K, P (managers) | managers | 03b §3.6, §6.21 | E5 power |
| **03c-N01** | Printer problem (alert card + lock line) | N | T, K, P (managers) | managers | 03c §3.7, §6.10 | E3-PRT edge |
| **03b-S04** | Hub admin "Kitchen screens" | S | L, K, P | manager (`manage-devices`) | 03b §3.8, §6.12 | E3-KDS AC5 |
| 03b-C14 | Station row (screens, lanes, volume, dark) | C | L, K, P | manager | 03b §6.12 | AC5 |
| 03b-D02 | Sound volume control | D / inline | L, K, P | manager | 03b §3.8 SetStationScreen, §6.9 | AC5 |
| 03b-D03 | Device role: Pass tablet's point / lane label | D | L, K, P | manager | 03b §3.8 SetDeviceRole, §6.10 | — |
| 03b-B16 | Kitchen screens warnings (archived station with open lines, screen offline) | B | L, K, P | manager | 03b §6.12 `warnings` | E1-FLR AC6 |
| 03b-F03 | Kitchen screens: loading, error, no permission | F | L, K, P | manager | 03b §6.12; 00 global states | — |
| **03b-S05** | Owner app group "Kitchen screens and the pass" (built) | S (group) | L, OP | owner | 03b §4.5 A-1, A-2 | — |
| **03c-S01** | Hub admin "Printers": printers list + status | S | L, K, P | manager | 03c §3.2, §6.6, §6.7, §8 | E3-PRT AC1, AC3; E0-HW |
| 03c-D01 | Add / edit printer | D | L, K, P | manager | 03c §3.2 SavePrinter, §6.2 | E0-HW AC1 |
| 03c-D02 | Archive printer confirm (+ in use) | D | L, K, P | manager | 03c §3.2, §6.2 | — |
| 03c-D03 | Test print and its result | D / inline | L, K, P | manager | 03c §6.4 | E0-HW |
| 03c-S02 | Station outputs (section of the Printers page) | S | L, K, P | manager | 03c §3.2 SetStationOutput, §6.3, §6.6 | E3-PRT AC1 |
| 03c-D04 | Station output editor | D | L, K, P | manager | 03c §3.2, §6.3 | E3-PRT AC1 |
| 03c-S03 | Print queue (pending jobs, suspects, no printer) | S | L, K, P | manager | 03c §6.7, §6.5 | E3-PRT AC3, edges |
| 03c-D05 | Cancel a print job confirm | D | L, K, P | manager | 03c §6.5 | — |
| 03c-B01 | Printers page warnings (lossy name, fold skipped, suspect waiting, screen unused, no screen) | B | L, K, P | manager | 03c §3.2, §6.6 | — |
| 03c-F01 | Printers page: loading, error, no permission | F | L, K, P | manager | 03c §6.6–§6.7 | — |
| 03c-C01 | `printed` tag (KDS row, Pass line) | C | W, T-P | cooks, assembler | 03c §3.8 | E3-PRT AC2 |
| 03c-C02 | Reprint action on the Pass card + result | C | T-P | assembler (`reprint-ticket`) | 03c §3.5, §6.1, §6.8 | E3-PRT AC4, E0-ORD AC4 |
| 03c-C03 | Reprint on the KDS (own station's tickets) | C | W | cooks | 03c §3.5, P13 | E3-PRT AC4 |
| 03c-C04 | Paper preview (on-screen view of a printed layout) | C | L, K | manager | 03c §3.3, §3.9 `renderText` | E0-TPL AC2 |
| **03c-P01** | Kitchen ticket, 80 mm (48 columns) | P | paper | cooks | 03c §3.3 | E3-PRT AC1, E0-TPL AC2 |
| 03c-P02 | Kitchen ticket, 58 mm (32 columns) | P | paper | cooks | 03c §3.3 | same |
| 03c-P03 | REPRINT header (any job) | P | paper | cooks | 03c §3.5 | E5-PWR AC7, E3-PRT AC3 |
| 03c-P04 | CANCELLED slip (partial and whole form) | P | paper | cooks | 03c §3.5 (v1.0.4 C1-2) | 02b ticket rows |
| 03c-P05 | FIRST slip | P | paper | cooks | 03c §3.5, P9 | — |
| 03c-P06 | COMING UP slip | P | paper | cooks | 03c §3.4 (v1.0.5 C4-1) | E3-PRT AC2 |
| 03c-P07 | Test print | P | paper | manager | 03c §6.4; hub: `print/routes.ts` | E0-HW |
| 03c-P08 | Document (05's bill / receipt) — REPRINT header only | P | paper | cashier | 03c §3.5, §3.9 | E3-RCPT (content 05) |

**Count: 66 items** (03b: 43, 03c: 23): 8 screens or sections (03b-S03 is a section of S02, 03b-S05 a settings group), 18 components, 16 banners / inline states, 8 dialogs or sheets, 4 full-screen states, 4 alert cards, 8 printed layouts.

### 2.2 Reused, not redesigned (draw only if a frame needs it for context)

| Reused | From | Where it shows up here |
|---|---|---|
| Pair this screen, Paired, Pair again (KDS dark) | 00 `PairWaiting`, `PairApproved`, `GlobalRepairKds` | before 03b-S01 |
| "This screen is open in another window" + Use this window (`kds.replaced`) | 00 ui-brief §1.4 | over 03b-S01 |
| End kitchen-screen session | 00 `SessionsEndKdsDialog` | hub admin Sessions |
| Staff sign-in, tablet alerts header B05 | 01d `SignIn`, B05 | before 03b-S02 |
| Alert card, banner, inbox, lock text, KDS dark lock banner, "No one can approve" | 01d C01, B01, S01, F01, B06, `CardsDark`, `NoApproverKds` | 03b-N01–N03, 03c-N01; over 03b-S01 / S02 |
| Hub admin shell, side nav, banners, switch, list rows | 00 `AdminHome`, `Devices` | 03b-S04, 03c-S01 |

### 2.3 Old inventory IDs (03b-kds-printing.md) → this brief

| Old | Now |
|---|---|
| 03b-S01 station queue | 03b-S01 |
| 03b-S02 batch station | 03b-S01 at a batch station (no separate screen; §3.1.10, §7 Q-2) |
| 03b-S03 all stations / expo | **03b-S02 Pass screen** |
| 03b-C01 ticket card | 03b-C01 line row (one row per line, never merged, P12) |
| 03b-B01–B05 new / late / boosted / hold / fire now | C01 states, C03 timer, C04 mark, C12 readiness (no "FIRE NOW" word in the spec: a fired line shows "waiting m:ss") |
| 03b-B06 archived | 03b-B07 |
| 03b-B07 screen offline → printing | 03b-S03 takeover + 03b-N03 + 03c paper fallback |
| 03b-D01 Done before Start | 03b-B02 |
| 03b-S04 another window | reused 00 |
| 03b-S05 KDS settings sheet | **dropped** (volume on hub admin only) |
| 03b-S06 printers and queue | 03c-S01, 03c-S03 |
| 03b-S07 station output config | 03c-S02, 03c-D04 |
| 03b-D02 reprint dialog | 03c-C02, 03c-C03 (no printer picker: a reprint goes to the station's current printer, 03c §3.2) |
| 03b-N01, N02 slip warning | **not here** (03a's kind) |
| 03b-N03 printer alert | 03c-N01 |
| 03b-P01–P04 | 03c-P01–P04 (P04 is now the CANCELLED slip; the strikethrough reprint is deferred) |
| 03b-P05–P07 bill, receipt, template preview | 05; 03c-C04 is only the kitchen-layout preview |

---

## 3. Per item

Field-by-field data uses the wire names so the builder can map them. Do not show the wire names to users.

### 3.1 KDS (03b-S01 and its parts)

#### 3.1.1 03b-S01 KDS station view

**Purpose.** One station's work, in the order the engine decided: what to cook now, what fires next, how many come later. Cooks tap Start and Done. (03b §3.3; stories E3-KDS AC1–AC4.)

**Entry.** A paired KDS opens its station session by itself (00) and shows this view. It has no exit, no navigation and no sign-out. Before the day opens it shows 03b-F01.

**Layout (spec silent on the arrangement → designer choice, within these rules):**
- **Header (03b-C09):** station name ("Tandoor"); lanes ("2 of 2 lanes on") when the station has lane screens; connection state; the coming-up strip (03b-C06) here or under the header (§7 Q-4).
- **Now** section: the lines to work on now (C01 rows). New lines **append at the bottom**; Done lines leave after their undo window; **nothing visible reorders** (03a contract, 03b §3.3). Exception: `mark` and `return` lines show **on top, in red, with their reason**. A `moved` line **keeps its row**, with a red tag and its new time.
- **Next** section: lines whose fire is frozen (`station_plan` lines with `frozen: true`), each with "in m:ss" to its fire time.
- **Later: N** — only a count of the unfrozen plan lines ("Later: 14"). No rows.
- **Give me more** (03b-C07) and, on a lane KDS, the lane control (03b-C08).
- No clock times on rows and no promise times (03b P6). A header clock: §7 Q-1.

**Data (catch-up part `kds_station`, 03b §6.14):**

| Field | Shown as | Example |
|---|---|---|
| `station_id` → config `stations[].name` | header title | "Tandoor" |
| `day_open` | false → 03b-F01 | — |
| `sound_volume` | not shown; sets the chime level | 70 |
| `lanes.lanes_on`, `lanes.lane_count` | header and lane control; `lanes_on: null` = custom | "2 of 2 lanes on" / "Custom capacity" |
| `now[]` | Now rows (LineDetail + `stage`, `fired_at`, `started_at`, `mark`, `done_undone`) | see C01 |
| `details[]` | details for Next rows (by `order_item_id`) | see C01 |
| `station_plan` (03a frame/catch-up) | Next rows (`frozen: true`, `fire_ms`, `mark`) and the Later count (`frozen: false`) | "in 2:10", "Later: 14" |

**What changes live (frames, 03b §6.16–§6.17):**
- `kds_lines` brings details for new ids, and again when a line's live units change (partial removal or void, weight set; v1.0.4 B3-3). Quantities and scaled options ("2 x Extra butter" → "1 x Extra butter") update in place, with no reorder.
- Line events: `ItemStarted` (row → cooking), `ItemDone` (row → done, undo window starts), `ItemDoneUndone` (row back to cooking), `FireDispatched` (a Next line moves to Now, **chime**), `ItemRemoved` / `ItemVoided` (units drop, or the row goes), `ItemServed`, `OrderBoosted` / `ItemsReleased` (marks, **strong sound**), `StationCapacitySet` / `LanesSet` (lanes).
- `station_plan` (03a) updates Next and Later.
- `station_notice { kind: 'archived', open_lines }` → 03b-B07.
- `BranchConfigApplied` → the screen refetches config (station name, completion mode) with no visible reload (03b §3.10).
- 03c `printed_lines` → 03c-C01 tag on those rows.

**States:**

| State | What shows |
|---|---|
| First load | 03b-F02 |
| Normal | Now 3–6 rows, Next 2–4, Later count |
| **Rush** | Tandoor at 1:20 PM: Now 12 rows, Next 8, Later: 40. Now scrolls inside its own region. The header, Next / Later and Give me more stay visible. Draw it at 1920 and 1280. Draw how a long Now overflows (spec silent → designer choice: scroll, or columns that fill left to right in append order; the order rule above must still hold). |
| Empty | Day open, nothing in Now or Next: an idle message (spec silent → designer copy, e.g. "Nothing to cook right now"), and Give me more stays available. |
| Reconnecting | 03b-B06 over the view. Rows stay; every button is disabled. |
| Day not started | 03b-F01 |
| Archived station | 03b-B07 on top; open rows still render and work |
| Clock alarm | 03a's danger banner on every KDS (00-index "Clock alarm"); reuse 03a's design |
| Another window | 00 `kds.replaced` full screen |
| Lock lines from 01d | 01d dark lock banner (escalations, "No one can approve") at the top, one sound per step (01d `NoApproverKds`) |
| Lane KDS | Same view, plus 03b-C08 |
| Batch station (Degh, Paye) | Same view; see 03b-C01 batch notes and §7 Q-2 |

**Actions:** every tap is on a row (C01), on Give me more (C07) or on the lane control (C08). There are no other actions.

**Urdu.** English only in P1 (§0.4). Item names may be Urdu script (menu data): draw one row "2 x چکن کڑاہی" (RTL inside an LTR row) to show the mixed-script layout.

#### 3.1.2 03b-C01 KDS line row

One row per engine line. **Lines are never merged** (03b P12): "6 x Naan" for T4 + T5 and "4 x Naan" for #12 are two rows.

**Fields (LineDetail, 03b §4.4; spec order of importance P6: identifier big, item × units, options, notes, mark reason):**

| Field | Shown as | Example | Notes |
|---|---|---|---|
| `identifier` | 03b-C02, the biggest text on the row | "T4 + T5" · "#12" · "#12 10 Nov" · plate "LEB 1234" + "Sedan" | LTR |
| `units` × `item_name` | quantity then name | "6 x Naan", "2 x Chicken Karahi Full" | quantity LTR, accent colour (Pulse `.kt__items .q`) |
| `line_kind`, `for_parent`, `deal_name` | a second line under the item | option child at another station: "for Chicken Karahi Full"; deal part: "(Family Deal)" | same meaning as the paper ticket: "3 x Naan - for Chicken Karahi Full", "1 x Raita (Family Deal)" |
| `options[]` | one line each under the item | "No onion", "2 x Extra butter" | "q x name" only when the quantity is more than 1 (03b §4.4 B3-2). Order: option children first, then plain options. |
| `kitchen_note` | highlighted note (Pulse `.kt__note`) | "less spicy" | verbatim, never cut; wrap |
| `order_note` | quieter note under the item, or one per order | "birthday, bring together" | verbatim (spec silent on the look → designer) |
| `return_of` | red tag on top: RETURN, mode, the old item and table | "RETURN · Remake · was T7 Chicken Karahi Half" | mode `fix` / `remake`. The return line carries the old line's plain options, e.g. "No onion" (v1.0.4 B3-4). |
| `mark` | 03b-C04 tag | Boost · Expedite · Pulled · Moved (Return uses `return_of`) | |
| `stage` + times | 03b-C03 timer | "waiting 1:10" · "cooking 4:32" · "late +3 min" | Next rows: "in 2:10" |
| `done_undone` | 03b-B04 cue | "Tap Done" | |
| 03c tag slot | 03c-C01 `printed` tag | "Printed" | only when 03c sends it |
| `placed_by_name` | **not shown** on the KDS (it is for the paper ticket toggle, 03b §4.4; P6 does not list it) | — | |
| `cook_ms`, `prep_ms`, `from_stock` | not shown as numbers. `from_stock` changes the buttons (below) | — | spec silent on a "from stock" badge → designer may add a small "Ready-made" tag; no behaviour |

**Buttons by completion mode and stage (03b §3.2, §3.3; stories AC9):**

| Station mode | Line | Buttons on the row | What a tap does |
|---|---|---|---|
| `two_tap` | fired, not started (`added`) | **Start** | `StartItem` → row turns "cooking 0:00" |
| `two_tap` | cooking | **Done** | `DoneItem` → done, undo window (B03) |
| `two_tap` | from stock, fired | **Done** only (no Start) | `DoneItem` succeeds from `added` (03b §3.2 step 3) |
| `single_tap` | fired | **Done** (the line is already cooking: the fire sets cooking, AC9 edge) | `DoneItem` |
| `auto_done` | fired | **Done** (optional early tap; the hub marks Done by itself at the planned end) | `DoneItem` from `added` or cooking is allowed |
| `auto_done` | undone after an inferred Done (`done_undone: true`) | **Done** with the B04 cue | It never auto-completes again and **holds the station** until tapped (v1.0.5 B2-3) |
| any | done, inside 30 s | **Undo** with countdown (B03) | `UndoDone` |
| any | Next row (not fired) | none | — |

Start and Done are one tap each, never a dialog (AC4). Their size: 72 px minimum, the main thing on the row.

**Row states (draw each):** waiting (fired, not started); cooking; late (red, word "late +3 min", never colour alone); done in the undo window (greyed, Undo + "0:24"); RETURN on top (red); Boost / Expedite on top (red, strong sound); Moved (keeps its place, red tag "Moved" and its new time); Pulled (tag "Pulled", it came early by Give me more); "Tap Done" cue; printed tag; busy (a tap sent, waiting for the hub: spec silent → designer: a pressed / spinner state on that button only, other rows still work); placeholder (C05); disabled (reconnecting); row error line (B01, B02, B05); long content (4 options, a 120-character kitchen note, a 40-character item name, a deal part, an option child "for …").

**Batch station.** A tap on one line of a load acts on the **whole load**: Start starts every fired line of the load; Done marks every line of the load that may be done; Undo undoes every done line of the load inside the window (03b §3.2 StartItem step 4, DoneItem step 5 v1.0.3 B2-1, UndoDone step 4). So after one tap, several rows change together. Design for that (no surprise jumps; each changed row shows its new state). Grouping rows by load on screen: §7 Q-2.

**Timers and colours (03b §3.3):**
- Now, started: "cooking m:ss" since `started_at`.
- Now, not started: "waiting m:ss" since `fired_at`.
- **Late** when now > planned done. Planned done = `started_at + cook_ms`, or if not started `fired_at + prep_ms + cook_ms`. Late shows **red "late +N min"**. No sound (P7).
- Next: "in m:ss" to `fire_ms`.
- The clock is the hub's time (corrected by `hub_time`), so every screen agrees.
- Colour meaning (fixed): red = late, RETURN, boost, expedite, moved; neutral = waiting; a cooking accent (designer choice, not red, not green); green only for Ready on the Pass. Never colour alone: always a word or icon too.

**Live changes:** units can drop (partial removal: "6 x Naan" → "4 x Naan") without the row moving. A fully removed or voided line leaves Now (spec silent on an animation → designer; keep it calm). A served line leaves.

#### 3.1.3 03b-C02 Identifier block

From `Identifier` (03b §3.1, §4.4), the same on the KDS, the Pass card and alert cards:

| Kind | Text | Example | Rule |
|---|---|---|---|
| `table` | `label` | "T4 + T5", "T12", "Family 2" | The current tables, primary first; "T" only before an all-digit name (01d P-1). A table move or merge changes it live. |
| `token` | "#" + `token`, plus `date` when from an earlier business day | "#12", "#12 10 Nov" | date shown as "10 Nov" |
| `parking` | `car_number` + `car_type` | "LEB 1234" + "Sedan" (paper: "PARKING LEB 1234 SEDAN") | Spec fixes the content; the Pulse plate style `.kt__n.plate` may be used. LTR. car_type is `sedan` / `mini` / `large` → "Sedan" / "Mini" / "Large" |

#### 3.1.4 03b-C03 Line timer, 03b-C04 Mark tag, 03b-C05 Placeholder

- **C03:** the four forms above. "m:ss" under 1 hour; spec silent above 1 hour → designer (e.g. "1:05:10"). The Degh's 240-minute Paye load needs the hour form. LTR.
- **C04 Mark tags:** `return` → "RETURN" (+ Fix / Remake); `boost` → "Boost"; `expedite` → "Expedite"; `pulled` → "Pulled"; `moved` → "Moved" + its new time ("in 3:40" or the new wait). Wording of the words: §6. Never "VIP" (old inventory rule; keep it).
- **C05 Placeholder:** a line id with no details yet shows a placeholder row **in place** (03b §3.3). It keeps its place and fills in when `kds_lines` arrives. Draw a skeleton row with no buttons (a line whose details have not arrived cannot be tapped: spec silent → recommended).

#### 3.1.5 03b-C06 Coming-up strip

Live units by item name over **Now + Next**, largest first, **max 6** (03b §3.3, P12). It is computed on the screen. Example: "Naan 22 · Roghni Naan 8 · Kulcha 4". It only counts and never merges rows. Empty when Now + Next are empty. Placement: §7 Q-4.

#### 3.1.6 03b-C07 Give me more

`GiveMeMore { station_id, n }`, n default 1 (03b §3.2). It pulls the next line(s) forward early. Results: a line moves from Next into Now (`FireDispatched { reason: 'pulled' }`, tag "Pulled"; at a `single_tap` station it also starts) → no message needed; or `pulled: null` → 03b-B08 "Nothing to pull right now". One button, 72 px, secondary (not the row's primary). A choice of n (1–10) is allowed by the spec, but the screen uses 1 (spec silent → keep one button; no number picker).

#### 3.1.7 03b-C08 Lane control

Only when the station has **2 or more lane screens** (`lane_count` = the KDS devices of the station with a lane label; 1 otherwise, 03b §3.7).
- Shows "Lanes: 2 of 2 on". `lanes_on: null` → "Custom capacity" (a manager changed capacity in 03a; spec has no exact count then).
- **Lane Off** → `SetLaneState { lanes_on: current − 1 }`; **Lane On** → `+ 1` (owner's manual check 4: "on KDS-T2 tap Lane Off → lanes_on 1"). Off is unavailable at 1 of N (the minimum is 1, `VALIDATION_FAILED` otherwise). On is unavailable at N of N. Same value → no change.
- Effect: the station's capacity drops, the engine re-plans (Next / Later times change) and late orders may raise slip warnings on waiters' devices (03a). Show no confirm (no modals on the KDS). Show the new "1 of 2 on" at once after the reply.
- Every lane goes back on at day open (03b §3.7: `BusinessDayOpened` resets). Nothing to show for that.
- In the custom state: §7 Q-3.

#### 3.1.8 03b-C09 KDS header bar

Station name (36 px, Pulse `.kbar__st`); lanes (C08 summary); a connection chip (Live / Reconnecting; reuse 01d's "Live" chip `.kbar .live`); 01d lock lines (if any). No staff name (station session). Clock: §7 Q-1.

#### 3.1.9 KDS inline states

| ID | When | What the cook sees | Copy intent |
|---|---|---|---|
| **03b-B01 Done early?** | `DoneItem` returns `422 ITEM_DONE_CONFIRM_REQUIRED { elapsed_ms, cook_ms }`: the line started less than half its cook time ago (every completion mode; only when it was started) | On the same row, the Done button changes into an inline confirm: "Done already? 1:40 of 6:00 — tap again". A **second tap** sends `DoneItem { confirm: true }`. No modal. Spec silent on a timeout → designer: it goes back after a few seconds (recommend 5 s). Nothing was written yet. | "This was started only {elapsed} ago (cook time {cook}). Tap Done again if it is really ready." |
| **03b-B02 Tap Start first** | `DoneItem` on an `added` line at a `two_tap` station, not from stock → `409 ITEM_WRONG_STAGE { stage: 'added' }` | Inline line on the row, the Start button highlighted | "Tap Start first" (03b §3.2) |
| **03b-B03 Undo window** | after Done | Row greyed in its place, **Undo** with a countdown from 0:30 (`UNDO_DONE_MS` 30 000, from the line's `done_at`). After 30 s the row leaves Now. An inferred Done (auto_done) is undoable only within 30 s of its `done_at`. | "Undo 0:24" |
| Undo too late | `409 ITEM_UNDO_WINDOW_CLOSED` | row leaves; a short line | "Too late to undo" |
| Undo after hand-over | `409 ITEM_WRONG_STAGE { stage: 'handed_over' }` | row leaves; a short line | "Already handed over — can't undo" |
| **03b-B04 Tap Done cue** | `done_undone: true` (an `auto_done` line whose Done was undone) | A clear cue on the row: it will not finish by itself and it holds the station. Strong but not red-alarm. (v1.0.5 B2-3: "client text later" → yours) | "Tap Done when ready — it won't finish by itself" |
| **03b-B05 row errors** | see table below | One line on the row, gone after a few seconds (designer timing) | |
| **03b-B08 Nothing to pull** | Give me more → `{ pulled: null }` | short line near the button | "Nothing to pull right now" |

**Error codes on KDS taps (03b §3.2, §6.1–§6.5, §9):**

| Code | When | What shows |
|---|---|---|
| `409 ITEM_WRONG_STAGE { stage: 'done' }` right after this screen's own Done | two taps on Done | **nothing** (03b §3.2 step 6, test 72) |
| `409 ITEM_WRONG_STAGE { stage: 'cooking' }` on Start | another screen (the other lane, or the Pass) already started it | nothing; the row already shows cooking from the event (silent update) |
| `409 ITEM_WRONG_STAGE { stage: 'out_of_engine' }` or `404 ORDER_NOT_FOUND` | the order left the kitchen (cancelled, closed) | row leaves; short line "This order is no longer in the kitchen" |
| `409 ITEM_WRONG_STAGE` other stages (served, removed, voided, returned) | the line changed elsewhere | row updates or leaves; short line "Already {served / removed}" |
| `403 PERMISSION_DENIED` | a line of another station (should not happen on screen) | "Not this station's line" |
| `404 STATION_NOT_FOUND` (Give me more, lanes) | station archived meanwhile | B07 shows |
| `400 VALIDATION_FAILED` (lanes) | lanes out of range | the button is already unavailable; fallback "Can't change lanes now" |
| network error / socket down | — | 03b-B06 |

#### 3.1.10 03b-B06 Reconnecting, 03b-B07 Archived, 03b-F01 Day not started, 03b-F02 First load

- **B06:** "Reconnecting…" banner (03b §8). Every button disabled (not hidden), rows stay as they were, timers keep counting (designer may dim them). It comes back by itself; the screen catches up from `kds_station` with no reload. There is no queue: a tap during the outage is lost and must be made again.
- **B07:** "Station archived — finish open tickets" + open line count ("3 open"), from `station_notice` (03b §3.3, §3.10). Rows still work. It goes when the lines are gone. Warn colour, dark theme.
- **F01:** "Day not started", no buttons at all (03b §3.3, 00 Q10). Full screen, dark. It ends by itself at `BusinessDayOpened`. Also shown in the takeover section if its `view.day_open` is false.
- **F02:** first load: skeleton header and 3 skeleton rows; it never shows a blank screen.

### 3.2 Pass (03b-S02 and its parts)

#### 3.2.1 03b-S02 Pass screen

**Purpose.** At the assembly point ("Pass"), see every order that has lines here, from every station of the point. Assemble the food, tap **Ready to serve**, then **Hand over** to the waiter who takes it. Tap Start / Done for stations with no screen (Cold: Raita). Turn lanes off and on. Take over a station whose screen died. (03b §3.4–§3.7; 01d K2–K6.)

**Entry.** The 01d staff entry `/staff/` on a tablet bound to a point (`devices.point_id`). The person signs in with their PIN (01d S00, with the B05 alerts header). How the Pass sits in the staff-entry nav: §7 Q-6. A tablet with no point never shows this screen.

**Layout (spec silent → designer choice):** the station strip (C13) at the top; one card per order (C10), **oldest first**, identifier big; takeover sections (S03), one per dark station, placed so they cannot be missed (recommend above the cards). Tablet landscape: a grid of cards. Portrait: one column.

**Data (catch-up part `point_view`, 03b §6.15):**

| Field | Shown as | Example |
|---|---|---|
| `point_id` → config `points[].name` | screen title | "Pass" |
| `stations[] { station_id, name, lanes, dark }` | C13 strip | "Karahi · Tandoor 2 of 2 lanes · Fryer · Cold (no screen)" |
| `orders[] { order_id, identifier, placed_at, lines[], ready }` | C10 cards, oldest `placed_at` first | "T4 + T5", placed 1:12 PM |
| `orders[].lines[]` = LineDetail + `stage`, `handed_over` | C11 rows | "Tandoor · 6 x Naan · done" |
| `orders[].ready { at, by }` or null | B10 | "Ready 1:21 PM · Asif" |
| `takeovers[]` | S03 sections | "Tandoor screen offline" |

Who is a line's station: `station_id` → `stations[].name`. A line cooked at an alternate station on another point still shows on its **home** point (03b §3.1, test 29).

**What changes live:** `point_lines` (details for new lines and for unit changes); line events of this point's stations (start, done, undo, removed, voided, served, boosted, released, fired); `ReadyToServe`, `ReadyToServeUndone`, `Handover`, `ReadyRetargeted` for this point; `station_takeover { active }` (S03 appears / goes); `station_notice` (B07 on the Pass for an archived station); `printed_lines` (03c tag); `BranchConfigApplied` (refetch).

**States:**

| State | What shows |
|---|---|
| Loading | skeleton cards |
| Empty | no open orders here: spec silent → designer copy, e.g. "No orders at the Pass" |
| Normal | 4–8 cards |
| Rush | 20+ cards; the card list scrolls; the strip and takeover headers stay. Draw a card with 12 lines. |
| Offline | 03b-B12 |
| Signed in without `run-pass` | 03b-B14 |
| Point archived | 03b-B15 |
| Takeover active | S03 sections present |
| Signed out (idle) | 01d S00 sign-in. While no one is signed in, the Pass shows no cards (the `point_view` part goes to staff sessions only); the `kds_offline` alert is then the only signal (03b §3.6). |
| Archived station with open lines | 03b-B07 (same text as the KDS, light theme) |

**Urdu:** draw S02 main state, a Ready card, D01 and S03 in Urdu RTL. Identifiers, quantities, times stay LTR.

#### 3.2.2 03b-C10 Pass order card

**Fields:** identifier (C02, big); placed time (spec silent on showing it → designer; recommended small, "1:12 PM"); readiness mark (C12); lines (C11), grouped by station or in line order (spec silent → designer); Ready state (B10); actions.

**Actions (03b §3.4, §3.5; all need `run-pass`):**

| Button | When available | Tap → result |
|---|---|---|
| **Ready to serve** (primary) | the order has a line here that is not served and not handed over, and no open Ready | `MarkReadyToServe` → the card shows Ready (B10), a Ready-to-serve alert rings the table team (dine-in) or the person who placed it (takeaway / parking). `{ already: true }` → same view, no error. Ready is **allowed before every line is done**: HOLD AT PASS is a hint, never a block (K4). |
| **Undo** | 30 s after Ready, and only if nothing was handed over since | `UndoReadyToServe` → the Ready goes, the waiter's card closes |
| **Hand over** | at least one **done** line here is not handed over | opens D01 |
| Start / Done / Undo on a line | only for lines of **screenless** stations (Cold) | as KDS C01 (same errors, same inline confirm B01, B02, B03) |
| Reprint (03c slot) | where the station has a printer, `reprint-ticket` | 03c-C02 |

**Card life:** served, removed, voided and returned lines drop off the card; the card drops off when no line is left or the order leaves the kitchen (03b §3.4). A card with only handed-over lines stays until they are served (by the waiter's tap in 02b, or by the served estimate when it is on, §3.2.5).

**States to draw:** not ready (lines cooking); HOLD AT PASS (amber: one line done, waiting for a sibling); Ready-able (green "Ready"); Ready sent (B10 with Undo 0:24); Ready sent, Undo gone; partly handed over (some lines "handed over", others done); everything handed over, waiting for Served; busy (a tap in flight); error line (B13); a table move while Ready (identifier changes "T4 + T5" → "T9"; the alert moves too, nothing to tap); a 12-line card (scroll inside the card, or a "+5 more" fold: designer choice); takeaway "#12 10 Nov"; parking plate.

#### 3.2.3 03b-C11 Pass line row and 03b-C12 Readiness

- **C11 fields:** station name ("Tandoor"); `units` × `item_name` ("6 x Naan"); options and notes (same as KDS, smaller); **stage word**: waiting (`added`), cooking, done, handed over (`handed_over: true`) (03b §3.4); the 03c `printed` tag; Start / Done only for screenless stations.
- **C12 readiness** (`groupReadiness` filtered to this point, 03b §3.4, K4): **Ready** (green) when no sync line here is waiting or cooking; **HOLD AT PASS** (amber) when a done line waits for a sibling, as a hint only; immediate lines go green on their own (test 74). With a word or icon, never colour alone.

#### 3.2.4 03b-D01 Hand over sheet

**Purpose.** The assembler taps the tile of the waiter who takes the food. No waiter PIN, no waiter device needed (K5). The tap time is the hand-over time (K13), so the tiles must be instant.

**Data:** `GET /queries/pass-receivers?order_id` → `{ receivers: [{ staff_id, name, table_team }] }`: people **signed in now** whose `mark-served` right covers this order, **table team first** (03b §6.11, §3.5 step 2, v1.0.3 B4-3).

**Layout:** a sheet (centred dialog on landscape, bottom sheet on portrait, like 01d D01) with the identifier and the lines about to be handed over ("T4 + T5 · 6 x Naan, 2 x Chicken Karahi Full"), then name tiles (reuse 01d / 00 staff tiles). Table-team people first, marked (e.g. "T4 team"). One tap on a tile = hand over at once; no extra confirm (spec silent → recommended, K13).

**What is handed over:** with no list, **every done line at this point not yet handed over**, in line order, **at most 40** per tap (03b §3.5 step 3, v1.0.3 B4-2). There is no line picker in the pilot (spec allows a list, client contract names only tiles → §7 Q-8).

**Results:**

| Result | What shows |
|---|---|
| `{ handover_id, served_card_alert_id, remaining: 0 }` | sheet closes; the lines show "handed over"; short confirmation "Handed to Ali" (B11); Ali's device gets the Served card |
| `remaining > 0` (more than 40 done lines) | sheet stays or a line on the card: "40 handed to Ali · 5 left — tap Hand over again" (B11). A second tap takes the rest. |
| Partial (some lines not done yet) | the Ready stays open for the rest; the card keeps the waiting lines |
| Empty list (nobody signed in can take this) | "Nobody signed in can take this order. Ask a waiter to sign in." (spec silent copy; the rule is 03b §6.11) |
| `422 PASS_RECEIVER_INVALID` (signed out, lost the right, or not covering the order since the list loaded) | the list reloads; line "Ali can't take this order now — pick someone else" |
| `409 ITEM_WRONG_STAGE` (nothing done to hand over) | "Nothing is done yet to hand over" |
| `409 ORDER_NOT_IN_ENGINE` | sheet closes, card goes: "This order is no longer in the kitchen" |
| `404 POINT_NOT_FOUND` | 03b-B15 |
| `403 PERMISSION_DENIED` | 03b-B14 |
| loading the list | skeleton tiles |
| offline | B12; tiles disabled |

A Hand over with no Ready first also records Ready itself (03b §3.5 step 5). The screen shows no difference.

#### 3.2.5 03b-B10 Ready state, 03b-B11 hand-over result, served estimate

- **B10:** after Ready: "Ready · 1:21 PM · Asif" (`ready.at`, `ready.by`), plus **Undo** with a 30 s countdown from `ready.at` (`UNDO_DONE_MS`). After 30 s, or after any hand-over of this order at this point, Undo goes (`409 PASS_UNDO_WINDOW_CLOSED` if tapped late: "Too late to undo"). Showing the time since Ready: §7 Q-7.
- **Ready window (fact for the designer):** the waiter's Ready card repeats after `ready_window_ms` (default 60 s) and escalates after 2 × the window to **the Pass tablet(s) of the point and the managers** (03b §6.21). So the Pass tablet itself can receive the escalated Ready card through 01d's banner (draw it over S02).
- **B11:** "Handed to Ali" (with the name from the tile tapped); with `remaining`, "40 handed to Ali · 5 left".
- **Served estimate (fact):** when the owner's served estimate is on (default 3 min on the pilot, range 1–30 min, or Off; 03b §4.5 A-1), handed-over lines not tapped Served within that time count as served by themselves (02b `ItemServed { source: 'estimated' }`). They then drop off the Pass card and the Served card closes. Nothing to tap on the Pass. Whether to show the estimate anywhere: §7 Q-9.

#### 3.2.6 03b-S03 Takeover section

**When:** a **screen station** (it has a paired KDS) has had **no connected screen** for `kds_offline_ms` (default 30 s; detection of a pulled cable can take up to 30 s more, so 30–60 s in total) **while it has lines in Now or Next** → it is **dark** (03b §3.1, §3.6). The Pass tablets of its point get `station_takeover { active: true, view }`.

**What shows:** a section titled **"Tandoor screen offline"** (03b §3.6 text, with the station name) holding that station's **Now and Next, the same rows as the KDS** (C01, light theme on the tablet), with **Start / Done / Undo / Give me more** under `run-pass` (03b §3.6). The same inline states (B01–B05, B08), timers, marks and the "Tap Done" cue. New fires for that station appear in it live.

**Ends:**
- The screen reconnects → the section goes **at once** (`station_takeover { active: false }`). Feedback: §7 Q-10.
- Every Now / Next line is done → the section goes (nothing to show), but the manager alert stays until the screen is back for 60 s (03b §3.6 step 4).
- The station's last KDS is revoked → the section goes; the alert closes as obsolete (step 5).

**Never:** a station with **no** paired screen (Cold) is never dark, has no section and raises no alert; its lines are already on the cards (03b D11). A station idle (nothing in Now / Next) never goes dark.

**Also:** if a printer is attached to the station (mode `screen` + a printer), paper prints at the same time (03c paper fallback, §4.3). The Pass shows nothing about the paper except the `printed` tag on rows.

**States:** one dark station; two dark stations (two sections); a dark station with 10 Now rows (the section scrolls or caps: designer); a dark station whose rows all finish (section gone); `view.day_open` false (F01 text inside the section); offline (B12, disabled).

#### 3.2.7 03b-C13 Station strip

Each station of the point: name; lanes ("2 of 2 lanes", "Custom") with the lane control (C08) for stations with lanes, under `run-pass`; **"Screen offline"** when `dark` (danger, word + icon); "No screen" for screenless stations (spec silent on showing it → recommended, so the assembler knows those lines need their taps). Lane control behaviour as §3.1.7 (`SetLaneState` from a staff session with `run-pass`).

#### 3.2.8 Pass banners and errors

| ID | When | What shows | Copy intent |
|---|---|---|---|
| **03b-B12** | socket down | banner across the top; every button disabled; cards stay | "No connection to the hub — reconnecting…" (01d B03 style) |
| **03b-B13** | errors not covered above | one line on the card | `MarkReadyToServe`: `409 ITEM_WRONG_STAGE { stage: 'served' }` → "Nothing left to serve on this order"; `409 ORDER_NOT_IN_ENGINE` → "This order is no longer in the kitchen" (card goes); `404 POINT_NOT_FOUND` → B15; Start on a screenless line not fired yet → `409 ITEM_WRONG_STAGE { stage: 'added' }` → "Not due yet" (§7 Q-12) |
| **03b-B14** | the signed-in person has no `run-pass` | cards visible, **actions hidden**, one info line (00-index: hide the action, never a disabled button with no reason) | "You can see the Pass but not run it. Ask a manager." |
| **03b-B15** | the tablet's point was archived | danger banner; actions hidden. The tablet also stops getting always-on alerts (v1.0.5 P18-1) | "This Pass point is archived. Ask a manager to set up this tablet again." |

### 3.3 Alert cards (01d components, new kinds)

All four use 01d's card (C01), banner (B01), inbox row and lock text (F01) as designed in the 01d hand-off. You design their **text and detail line** in each state, in English and Urdu, light and (for lock lines on the KDS) dark.

**01d's two-level rule applies (01d §3.12):** the **card** (signed-in person, own session) shows `display` fields and `details`; the **lock line** (signed-out pages, kiosk, KDS, Pass tablets as always-on devices) shows only the kind label, table and point, never `details`. So the token "#12", the station name and the printer name appear on the card only.

**String keys:** `alert.<kind>.card`, `alert.<kind>.lock` (§6.4).

#### 3.3.1 03b-N01 Ready to serve

| | |
|---|---|
| Kind / family | `ready_to_serve`, **Action** (01d: blue outlined pill with a hand; double ding, once) |
| Raised by | the Pass, Ready to serve (or a Hand over with no Ready) |
| Goes to | dine-in → the table team of the current primary table (`table_team`, direct); takeaway / parking → the person who placed the order |
| Steps | at 0: recipients; at `window_ms` (default 60 s): again ("Reminder"); at 2 × `window_ms`: **escalated** to the point's tablets **and** the managers (03b §6.21) |
| Card shows | kind label "Ready to serve", table chip (only for an all-digit primary table name: "T4"; P-1), point ("Pass"), and detail `identifier` ("T4 + T5", "#12", "#12 10 Nov", "PARKING LEB 1234 SEDAN") |
| Lock shows | "Ready to serve · T4 · Pass" (no token, no identifier detail) |
| Closes | `done` when every line of this Ready is settled (served by anyone, removed, voided, returned, order cancelled) or the order left the kitchen; `undone` on Undo ready; `obsolete` when the table moved (a new card rings the new table's team, "T9"); expires at day close |
| Card states | new, reminder, escalated (on a manager / the Pass tablet), closed done, closed undone ("Pass took it back"), closed obsolete ("Moved to T9"), takeaway, parking, named table "Family 2" (no chip) |
| Action on the card | none in 03b. The waiter goes to the Pass. Tapping opens 01d's notice detail (D04). §7 Q-13. |

#### 3.3.2 03b-N02 Served card

| | |
|---|---|
| Kind / family | `served_card`, **Info** (soft chime) |
| Raised by | Hand over, to the receiver (`person`) |
| Card shows | "Food handed to you · T4 + T5" style: kind label, table chip, detail `identifier` (stories 03b-g0: "T7 food handed to Bilal — tap Served") |
| Lock shows | "Served card · T4" |
| Closes | `done` when every handed-over line of it is settled (the waiter tapped Served in 02b, or the served estimate counted it); expires at day close (the estimate still runs, 03b §3.5) |
| Card states | new, closed done, takeaway / parking |
| Action | none on the card; Served is tapped on 02b's table screen. §7 Q-13. |

#### 3.3.3 03b-N03 Kitchen screen offline

| | |
|---|---|
| Kind / family | `kds_offline`, **Action**; to managers (lead fallback on) |
| Raised | once per outage when a screen station goes dark (§3.2.6) |
| Card shows | "Tandoor screen offline" (detail `station_name`), the time; help line (spec silent → copy): "Its tickets are on the Pass tablet. Check the screen's cable and power." |
| Lock shows | "Kitchen screen offline" (no station name: it is a detail) |
| Closes | `done` after the screen has been **connected for 60 s** (one alert per outage, blips do not re-raise); `obsolete` when the station's last KDS is revoked; expires at day close. It stays open when the station's lines all finish but the screen is still off. |
| States | new, closed done ("Screen back"), closed obsolete ("Screen removed"), two stations dark (two cards) |

#### 3.3.4 03c-N01 Printer problem

| | |
|---|---|
| Kind / family | `printer_problem`, **Action**; to managers (lead fallback on) |
| `problem` values (hub: `print/status.ts`) | `paper_out` "out of paper"; `offline` "offline"; `not_printing` (the head job failed for ≥ 30 s) "not printing"; `ticket_not_built` (a ticket could not be built for a station that needs paper) |
| Card shows | "Tandoor printer · Out of paper" (details `printer_name`, `problem`), "6 waiting" (`values.waiting`), the time; help per problem (copy §6.4) |
| Lock shows | "Printer problem" |
| Closes | paper_out / offline / not_printing: `done` at the next printed job with a clean or unknown status; `obsolete` on printer archive, or nothing pending and status clean or unknown. **`ticket_not_built` never closes by itself**, is always its own card (one per skipped fire), and its closing never closes the others (v1.0.5 C3-3). It expires at day close. See §7 Q-14: no close command exists yet. |
| States | each problem; closed done ("Printing again"); closed obsolete; a `ticket_not_built` beside an open paper_out for the same printer (two cards) |

### 3.4 Hub admin "Kitchen screens" (03b-S04)

**Purpose.** At setup and on install day: see each station's screens and whether they are on, set lanes' labels, set each station's sound volume, bind a tablet to a point (make it a Pass tablet), and see warnings. (03b §3.8, §6.12.)

**Entry.** Hub admin (admin session, `manage-devices`), a new admin page `apps/client/src/features/admin/kitchen-screens/`. Its entry on the admin home: §7 Q-15.

**Data (`GET /admin/queries/kds-config`, 03b §6.12):**

| Field | Shown as | Example |
|---|---|---|
| `stations[] { station_id, name, point_id, sound_volume, lanes { lanes_on, lane_count }, screens[], dark }` | one row / card per active station (C14) | "Tandoor · point Pass · volume 70 · 2 of 2 lanes on" |
| `screens[] { device_id, name, lane_label, state }` | device chips under the station | "Tandoor Left · Left · Connected", "Tandoor Right · Right · Offline" |
| `state` | `connected` "Connected" (ok) · `signed_out` "Signed out" (warn: the device is on but nobody / no station session) · `offline` "Offline" (danger) | — |
| `dark` | "Screen offline — tickets on the Pass" (danger) | — |
| `pass_tablets[] { device_id, name, point_id, state }` | a Pass tablets section | "Pass tablet · point Pass · Signed out" (a Pass tablet with nobody signed in still gets alerts: "Signed out" is normal) |
| `warnings[] { station_id, kind }` | B16 at the top | `archived_open_lines`: "Cold is archived but still has open tickets"; `dark`: "Tandoor screen is offline" |

Station with no screen: "No screen — its lines show on the Pass" (03b D11). Config names come from `branchConfig()` (point names `points[].name`). Archived stations are not listed as rows; they appear only in warnings.

**Actions:**

| Action | Command | Result / errors |
|---|---|---|
| Set sound volume (D02) | `SetStationScreen { station_id, sound_volume 0–100 }` (`/admin/commands/`) | saved → the KDS uses it at once (it applies on the next sound); `404 STATION_NOT_FOUND` ("This station is no longer there — reload"); `400 VALIDATION_FAILED` (out of range; the control cannot produce it) |
| Set a KDS's lane label (D03) | `SetDeviceRole { device_id, lane_label: "Left" or null }` (1–20 characters, AD-12) | the lane count changes: 2 labelled screens = 2 lanes. `400 VALIDATION_FAILED` on a non-kitchen device or a kitchen screen with no station ("Lane labels are only for kitchen screens"); `404 DEVICE_NOT_FOUND` ("This device was removed — reload") |
| Bind / unbind a tablet to a point (D03) | `SetDeviceRole { device_id, point_id: <point> or null }` | the tablet becomes / stops being a Pass tablet; `404 POINT_NOT_FOUND` ("That point no longer exists"); `404 DEVICE_NOT_FOUND` |

How to pick a tablet that is **not yet** bound (the query lists only bound ones): §7 Q-16. A sound test button: §7 Q-17.

**States:** loading; normal (4 stations, 5 screens, 1 Pass tablet); a dark station; an archived station warning; no stations yet ("Add stations in the owner app first"); a station with no screen; a station with custom lanes ("Custom capacity"); offline / hub unreachable (00 global state); no permission (00 hub admin `PERMISSION_DENIED` pattern); a Pass tablet bound to an **archived point** (spec silent on a flag; the point name is missing from the active list → show "Point archived — bind to another point", recommended); saving (busy button); saved (ok toast).

**Sizes:** laptop 1440, kiosk 1920, phone 390. **Urdu:** main state.

### 3.5 Hub admin "Printers" (03c-S01, S02, S03)

**Purpose.** Add and test kitchen printers, choose each station's output, watch the print queue during service, and see warnings. Printers are **optional**: a restaurant can run with none (03b P3, P16; R-1). (03c §3.2, §8.)

**Entry.** Hub admin, `manage-devices`, `apps/client/src/features/admin/printers/`. Sections: Printers, Station outputs, Print queue, Warnings (spec silent on sections or tabs → designer).

#### 3.5.1 03c-S01 Printers list

**Data (`GET /admin/queries/print-config` → `printers`, and `print-queue` → `printers`, 03c §6.6–§6.7):**

| Field | Shown as | Example |
|---|---|---|
| `name` | title | "Tandoor printer" |
| `connection`, `address` | "LAN · 192.168.1.50:9100" / "USB · /dev/pos-printer-cold" (mono, LTR) | — |
| `paper_width_mm` | "80 mm" / "58 mm" | — |
| `status` (`last_status`) | `clean` "Ready" (ok) · `paper_out` "Out of paper" (danger) · `offline` "Offline" (danger) · `unknown` "Status unknown" (neutral) | — |
| `supports_status` | 1: status works; 0: "This printer does not report status" (it printed a test but answered nothing); null: not known yet (no test yet) | — |
| `last_status_at`, `last_ack_at` | "checked 1:20 PM", "last printed 1:19 PM" | — |
| `waiting` | "6 waiting" | — |
| `suspect` | "3 may not have printed — they reprint by themselves when the printer is ready" | — |
| `head_error`, `last_error` | the first job's error in words: `connect_failed` / `connect_timeout` "Can't reach the printer"; `write_timeout` "The printer stopped taking paper"; `write_failed` "Sending failed"; `busy` (USB test only) "In use — try again in a moment"; `manager` (a cancelled job) — | — |
| `archived_at` | archived printers at the end, greyed, "Archived" | — |

Stations using the printer (from `station_outputs`): "Used by Tandoor (screen + paper fallback)".

**Actions:** Add printer (D01); Edit (D01); Archive (D02); Test print (D03).

**States:** no printers ("No printers. Every station works on its screen. Add a printer only if you want paper.", R-1); a USB printer with unknown status and the LAN recommendation ("USB printers can't tell the hub when they run out of paper. A ticket lost in a power cut is not caught. LAN printers with status are recommended.", 03c §3.5); a printer with suspects; an archived printer with pending jobs (still listed, 03c §6.7); loading; offline; no permission.

#### 3.5.2 03c-D01 Add / edit printer

Fields (03c §3.2): **Name** 1–40, unique among active printers; **Connection** LAN / USB (segmented); **Address**: LAN `host:port`, private IPv4 only (10.x, 172.16–31.x, 192.168.x), port default **9100**; USB `/dev/usb/lp0`–`lp9` or `/dev/pos-printer-<name>` (help line: "Use the udev name from the install guide"); **Paper** 58 mm / 80 mm.

| Result | What shows |
|---|---|
| saved | sheet closes, row updates; suggest a test print (spec silent → designer) |
| `409 CONFIG_NAME_TAKEN` | field error "Another printer has this name" |
| `400 VALIDATION_FAILED` (address, name, paper) | field error on the named field: "Use a private network address like 192.168.1.50:9100" / "Use /dev/usb/lp0 or /dev/pos-printer-…" |
| offline | 00 banner; values kept |

#### 3.5.3 03c-D02 Archive printer

Confirm: "Archive Tandoor printer? It stops printing." → `SavePrinter { archived: true }`. `409 CONFIG_IN_USE { used_by: stations }` → "Tandoor and Cold still use this printer. Change their output first." (list the stations). An archived station's output row also holds a printer (shown in S02 under "Archived stations"); see §7 Q-18. Un-archive = edit with archived off.

#### 3.5.4 03c-D03 Test print

`POST /admin/print/test { printer_id }` → `{ printed, status, error }`, takes **up to 8 s**, outside the queue (a stuck queue never blocks it) (03c §6.4; hub: `print/routes.ts`).

| Result | What shows |
|---|---|
| busy (≤ 8 s) | button busy "Printing a test…" |
| `printed: true, status: 'clean'` | ok: "Printed. Status works." (status **proved**; for USB this proves status support, so the hub reads its status from now on, 03c §3.7) |
| `printed: true, status: 'unknown'` | ok + note: "Printed. This printer doesn't report status." (`supports_status` becomes 0) |
| `printed: true, status: 'paper_out' / 'offline'` | warn: "Printed, but the printer reports out of paper / offline" |
| `printed: false, error: 'busy'` (USB in use by the queue) | warn: "The printer is busy printing tickets. Try again in a moment." |
| `printed: false, error: connect_* / write_*` | danger: "Couldn't print: {error in words}" |
| `404 PRINTER_NOT_FOUND` | "This printer was removed or archived — reload" |
| side effect | a clean or unknown test that printed **reprints any suspect tickets** (03c §3.5, §6.4). Show "3 tickets that may not have printed are being reprinted." when the printer had suspects (recommended copy). |

Paper: 03c-P07.

#### 3.5.5 03c-S02 Station outputs and 03c-D04 editor

**Data:** `print-config.station_outputs[] { station_id, name, mode, printer_id, show_taker, show_order_id, screen_paired, archived }`.

| Mode | Label (intent) | Meaning (03c P3, §3.4) |
|---|---|---|
| `screen`, no printer | "Screen only" (default; no row = this) | no paper ever |
| `screen` + printer | "Screen, paper if the screen is off" | paper only while the station is dark: Now as tickets + one COMING UP, every new fire prints until the screen is back |
| `both` | "Screen and paper" | every fire prints and shows on the screen |
| `printer` | "Paper only" | for a station with no screen; prints at fire; FIRST slips on boost / expedite |

Toggles (paper ticket only): **Show order taker** (default on), **Show order number** (default on) (03c §3.2, G1-14).

`SetStationOutput { station_id, mode, printer_id, show_taker?, show_order_id? }`: `both` / `printer` without a printer → `400 VALIDATION_FAILED { field: 'printer_id' }` ("Pick a printer for paper"); `404 STATION_NOT_FOUND` (archived station: "This station is archived"); `404 PRINTER_NOT_FOUND` (archived printer). Changing a station's printer moves its waiting jobs to the new printer (03c §3.2).

Rows with `archived: true` (an archived or unknown station's output that still holds a printer): listed under "Archived stations", read-only, with the printer name (§7 Q-18).

#### 3.5.6 03c-S03 Print queue and 03c-D05 Cancel

**Data (`print-queue`):** per printer (as S01) plus `jobs[]` (newest 100 pending): `kind` (`kitchen` "Ticket", `reprint` "Reprint", `cancel` "Cancelled slip", `first` "First slip", `coming_up` "Coming up", `document` "Bill / receipt", `test` never listed), station name, `order_id` → identifier if known (spec silent; the query gives ids only → show station + kind + time; §7 Q-19), `created_at` "1:22 PM", `sent_at` (sending), `attempts` ("tried 4 times"), `last_error` (words as S01), `is_reprint` ("REPRINT"), `suspect_at` ("may not have printed"), **`no_printer: true`** ("No printer: this station has no printer now. This job will never print. Cancel it or give the station a printer."), and the total `no_printer` count as a warning line.

**Rules to show:** one queue per printer, in order; a waiting job is retried 2 s, 5 s, then every 10 s with no limit (03c §3.7), so "waiting" is normal during an outage; paper jobs never block the till or the kitchen screens (R8).

**Cancel (D05):** "Cancel this ticket? It will not print." → `POST /admin/print/jobs/:job_id/cancel`. `404 PRINT_JOB_NOT_FOUND` / `409 PRINT_JOB_NOT_PENDING { state: 'acked' }` → "Already printed" / `{ state: 'cancelled' }` → "Already cancelled"; the list reloads.

**States:** empty ("Nothing waiting"); during paper out (6 waiting, head error, suspects); refresh (spec silent on live update → recommend re-fetch every 5 s while open, like 01d receipts); loading; offline.

#### 3.5.7 03c-B01 Printers warnings (`print-config.warnings`)

| `kind` | Text intent |
|---|---|
| `lossy_name` (`station_id` or `item_id`) | "'{name}' has letters the printer can't print. They print as '?'. Use English letters for names that print." (03c P10, G1-15) |
| `fold_skipped` | "A ticket for {station} could not be built. Check that order on the screen." (lists every skip, 03c §3.3) |
| `suspect_waiting` | "{station}: tickets that may not have printed are waiting for the printer to be ready" |
| `screen_unused` | "{station} prints only, but a kitchen screen is paired to it. The screen shows nothing useful." |
| `no_screen` | "{station} has a fallback printer but no kitchen screen. It never falls back to paper. Set it to 'Paper only' to print every ticket." (03c §3.2) |

### 3.6 `printed` tag and Reprint (03c-C01, C02, C03)

- **03c-C01 printed tag:** on KDS rows and Pass lines whose ticket printed (an uncancelled kitchen or reprint job was sent and acked). Sources: catch-up `kds_printed` and frame `printed_lines` (03c §3.8). Label "Printed" (data slot `{ key, label }`, `features/kds/slots.ts`). Small, neutral, with a printer icon. It never changes buttons.
- **03c-C02 Reprint on the Pass card:** shown when `GET /queries/order-tickets?order_id` reports a ticket with `has_printer` and the person has `reprint-ticket` (Cook has it by default). Tap → `ReprintTicket { order_id }` → `{ ticket_ids, skipped }` → "Reprinting 2 tickets" / `skipped` "Nothing to reprint" / `404 ORDER_NOT_FOUND` "This order has no tickets" / `403 PERMISSION_DENIED` (hide the action). It prints on the station's printer, with a REPRINT header, the current table, every live line. It is queued if the printer is down ("It prints when the printer is back"). No PIN.
- **03c-C03 Reprint on the KDS:** a station `both`'s KDS reprints its own station's tickets, no PIN, logged by device (03c §3.5, P13). Where the button sits and how the KDS knows its station prints: §7 Q-20.

### 3.7 03b-S05 Owner app "Kitchen screens and the pass" (built)

Already built in `apps/client/src/features/owner/branches/KitchenTiming.tsx`, inside the branch settings page's "Kitchen timing" group. Strings exist in EN and UR (`branches.timing.kds*`).

| Box | Unit | Range | Default | Help (existing copy) |
|---|---|---|---|---|
| "Call more people for a ready dish after" (`ready_window_ms`) | whole **seconds** | 15–300 | 60 | group help "The first two in whole seconds; the served time in minutes." |
| "Treat a kitchen screen as off after" (`kds_offline_ms`) | whole **seconds** | 10–300 | 30 | — |
| "Count handed-over food as served after" (`served_estimate_ms`) | minutes, plus an On / Off switch | 1–30 min, or Off | 3 min (pilot) | "Off: food counts as served only when someone taps Served." |

Errors: "Use {min} to {max} seconds." / "Use {min} to {max} minutes." (existing). Design: nothing new; follow the owner-app redesign when it comes.

---

## 4. Scenario walkthroughs

Each is a sequence of frames the owner can click through. Times are 12-hour hub time.

### 4.1 Rush-hour order, end to end

1. 1:12 PM Hamza sends T4 + T5: 2 × Chicken Karahi Full ("No onion", "2 x Extra butter", "less spicy"), 6 × Naan, 2 × Raita.
2. **Karahi KDS:** the karahi line is in **Next** "in 2:10". At its fire it moves to **Now** at the bottom with a **chime**: "waiting 0:05".
3. Cook taps **Start** → "cooking 0:00". At 1:16 PM (only 2 of 6 minutes), Done → **B01** "Done already? 2:00 of 6:00 — tap again". The cook waits. At 1:21 PM, Done → done, greyed, **Undo 0:30**; after 30 s the row leaves Now. Next lines keep their places.
4. **Tandoor KDS** (`single_tap`): "6 x Naan" fires as cooking; Done at 1:19 PM.
5. **Pass:** card "T4 + T5", oldest first. Lines: Karahi cooking, Tandoor done, Cold Raita waiting (no screen). Readiness: **HOLD AT PASS** (amber). Asif taps **Start** then **Done** on the Raita on the card.
6. All done → **Ready** (green). Asif taps **Ready to serve** → B10 "Ready · 1:21 PM · Asif, Undo 0:30". Bilal's phone (T4 team) rings: **N01** "Ready to serve · T4 · Pass" (card detail "T4 + T5").
7. Bilal arrives. Asif taps **Hand over** → **D01** tiles: Bilal (T4 team), Ali, Imran. Tap Bilal → "Handed to Bilal"; lines "handed over"; Ready card on Bilal's phone closes; **N02** Served card on Bilal's phone.
8. Bilal taps Served on 02b's table screen → lines served → they drop off the Pass card; the card leaves; N02 closes.
9. Unhappy branches: Bilal never taps Ready's card → reminder at 1:22 PM, escalation at 1:23 PM to the Pass tablet and Imran. Bilal never taps Served → after 3 min the estimate counts it served (card leaves, N02 closes).

### 4.2 Batch tandoor / degh load

1. Degh station (batch): Paye program, a load of 8 lines from several orders, fires 5:00 AM.
2. Now shows the 8 rows. The cook taps **Start** on any one → **all 8** turn cooking at once (03b §3.2 StartItem step 4).
3. Done on one → every line of the load that may be done turns done; Undo on one undoes every done line of the load inside 30 s.
4. Lines that left the load (removed, voided) are skipped and simply leave.
5. Frames: before Start, after Start (8 rows changed), after Done, after Undo. Grouping: §7 Q-2.

### 4.3 Undo Done at an `auto_done` station

1. Fryer (`auto_done`): a fries line fires and the hub marks it Done by itself at its planned end; it shows done with **Undo 0:30**.
2. The cook taps **Undo** at 0:12 → the row is back, cooking, with the **"Tap Done"** cue (B04).
3. The planned end passes: it does **not** finish by itself again, and it **holds the station** (the next lines wait; Next times slip).
4. The cook taps **Done** → done; the station moves on.

### 4.4 KDS cable pulled → takeover, paper fallback, COMING UP

1. 1:30 PM Tandoor KDS (mode `screen` + fallback printer "Tandoor printer") loses its cable. Its Now has 6 lines, Next 4.
2. 0–30 s: nothing changes anywhere (the KDS itself shows B06 if it is still on).
3. After 30–60 s Tandoor is **dark**:
   - Imran's tablet: **N03** "Tandoor screen offline".
   - Pass tablet: section **"Tandoor screen offline"** with Tandoor's Now / Next rows (S03). Asif taps Start, Done and **Give me more** there.
   - Paper (03c §3.4): every ticket with a line in Tandoor's Now prints (03c-P01) and **one COMING UP** slip (03c-P06) prints, unless a COMING UP printed for Tandoor in the last 5 min (v1.0.5 C4-1). Every new Tandoor fire prints until the screen is back.
   - The rows on the Pass show the **Printed** tag as tickets come out.
4. A new order adds Tandoor lines: they appear in the Pass section live and print.
5. Hub admin Kitchen screens: Tandoor "Screen offline" warning, "Tandoor Left · Offline".

### 4.5 Reconnect

1. The cable goes back. The KDS reconnects by itself and re-renders Now / Next (no reload); B06 goes.
2. The Pass section goes **at once** (§7 Q-10 for feedback). Paper stops; nothing printed is cancelled; tags stay.
3. The N03 alert stays for **60 s** of connected time, then closes ("Screen back"). A 10 s blip never raises a second alert.

### 4.6 Table moved or merged while Ready

1. T4 + T5 is Ready; Bilal's card rings "T4".
2. The party moves to T9 (02a). Within a tick: Bilal's card closes ("Moved to T9"); a **new** Ready card rings the T9 team. The Pass card identifier changes to "T9" live. Nothing to tap.
3. Merge of 3 tables with open Readies: same, each re-raised once.

### 4.7 Partial removal or void → CANCELLED slip and KDS update

1. Tandoor (mode `both`) printed "6 x Naan" for T4 + T5 at 1:22 PM.
2. Hamza removes 2 Naan (02b) → KDS row changes in place to "4 x Naan" (units live; options re-scaled). Pass line too.
3. Paper: CANCELLED slip **"CANCELLED  T4 + T5  - 2 x Naan  4 left"** (03c-P04 partial form).
4. The rest are removed → slip **"CANCELLED  T4 + T5  4 x Naan"** (whole form, no "0 left"; v1.0.4 C1-2); the row leaves.
5. If the ticket had **not printed** yet: no slip; the ticket prints without those units.
6. A done line: no slip.

### 4.8 Remake with options

1. T7's Chicken Karahi Half (with "No onion") is returned, mode remake (02b).
2. Karahi KDS: a new line **on top, red**: "RETURN · Remake · was T7 Chicken Karahi Half", "1 x Chicken Karahi Half", option "No onion" (copied, v1.0.4 B3-4); **strong sound**.
3. Paper (if printing): ticket with "** RETURN - REMAKE - was T7 Chicken Karahi Half **" and "+ No onion".

### 4.9 Printer paper out → suspect reprint

1. 1:30 PM Tandoor printer (LAN, status works) runs out of paper after printing 3 tickets that never came out (they were acked into the buffer).
2. The next status read says paper out → those 3 jobs (acked since the last clean read) become **suspect**; new jobs wait. Imran gets **03c-N01** "Tandoor printer · Out of paper · 4 waiting".
3. Printers page: status "Out of paper", "4 waiting", "3 may not have printed".
4. Paper replaced → status clean → **one REPRINT per ticket** with a live line (03c-P03 header), plus its FIRST slip again if that slip was suspect; a ticket whose suspects were only slips gets its latest slip again (v1.0.5 C3-2); then the waiting jobs print in order. The alert closes "Printing again".
5. A USB printer with unknown status cannot detect this; the cook uses Reprint (Pass card / KDS).

### 4.10 Hub restart mid-print → REPRINT

1. Power cut while a ticket is being sent. The hub restarts.
2. Every job sent but not confirmed is re-sent once, **with the REPRINT header**, in order (03c §3.7, F §5.8 step 5). A duplicate is acceptable; a missing ticket is not (D24).
3. KDS and Pass reconnect and catch up (B06 / B12 then normal).

### 4.11 Owner and manager set up printers, outputs, test print, timing

1. Owner app: "Kitchen screens and the pass" — Ready window 60 s, KDS offline 30 s, Served estimate On, 3 min (03b-S05).
2. Hub admin → Kitchen screens: bind "Pass tablet" to point Pass (D03); label "Tandoor Left" / "Tandoor Right" (Tandoor now 2 lanes); Tandoor volume 80 (D02).
3. Hub admin → Printers: Add "Tandoor printer" LAN 192.168.1.50:9100 80 mm (D01) → **Test print** (D03) → "Printed. Status works." (03c-P07 on paper).
4. Station outputs: Tandoor "Screen, paper if the screen is off"; Cold "Paper only" with "Cold printer" (USB, test shows "Printed. This printer doesn't report status." + LAN recommendation).
5. Warnings: "Cold prints only, but a kitchen screen is paired to it" if one is; a menu item in Urdu script → `lossy_name`.

### 4.12 Manager deals with printer alerts

1. Imran gets N01 "Tandoor printer · Out of paper". Opens the Printers page from the card (spec silent on a link → §7 Q-13); puts paper in; status clean → the card closes by itself.
2. A `ticket_not_built` card stays open after the printer recovers (it never closes by itself, v1.0.5 C3-3). The Printers page lists the skip under warnings. Imran checks the order on the screen. Closing the card by hand: §7 Q-14.
3. A job stuck because the station lost its printer (`no_printer`): Imran cancels it (D05) or gives the station a printer (D04).

### 4.13 Day open: lanes and day state

1. Before day open: every KDS shows **Day not started** (F01), no buttons.
2. Yesterday Tandoor ran 1 of 2 lanes. At day open every lane is back on ("2 of 2 lanes on"), with nothing to tap.
3. The day opens → F01 goes; the view fills as fires come.

---

## 5. Printed layouts (03c)

### 5.1 What is fixed and what you may do

- **Fixed by spec (do not change):** every line of text, its order, the separators, bold / double size, the 32 / 48 column widths and wrapping (03c §3.3, §3.5, §3.6; G1-14 "kitchen ticket layout fixed", only two toggles). The renderer is built and pinned by golden-byte tests (03c test 1).
- **Character set:** PC437 only. Mapping first: `—` `–` `−` → `-`; `×` → `x`; `·` → space; curly quotes → straight; anything else not in PC437 prints **`?`**. **Urdu script prints as `?`** (03c P10, §3.6); the Printers page warns (`lossy_name`).
- **Widths:** 58 mm = **32 columns**, 80 mm = **48 columns**. Double-size text takes 2 columns per character (so a double-size line holds 16 / 24 characters and wraps).
- **Times:** 12-hour, hub time, "1:22 PM" (fire time on tickets; the time of sending on slips).
- **Never on paper:** prices, COMP, zone-served lines (03c §3.3).
- **You supply:** the on-screen **preview** look (03c-C04): a paper-like strip in a monospace font (Geist Mono), at both widths, marking double-size and bold lines, with "?" visibly marked where a character will be lost. Previews are for the Printers page (test print, station output editor) and for frames; 05 reuses `renderText` for its own previews.

The samples below are the built text preview (`renderText`, hub: `print/render/jobs.ts`, `render/text.ts`) of the sample data. The markers on the right are not printed: `[x2]` marks a double-size line and `[b]` bold. A double-size line is shown here with single-width letters; its leading spaces are already computed for double width (each letter takes 2 columns), so in your preview draw those letters twice as wide from that offset.

### 5.2 03c-P01 / P02 Kitchen ticket

Structure (03c §3.3): [REPRINT header] · station name (upper case) and fire time on one line [b] · `=` × width · identifier [x2, centred, b] · order type, order taker (toggle `show_taker`), "#" + last 6 characters of the order id (toggle `show_order_id`) · RETURN line(s) [b] · FIRST line [b] · `-` rule · each line: "units x name" [b], "- for <parent>", " (<deal>)"; each option "    + name" or "    + q x name"; "    NOTE: <kitchen note>" · `-` rule + "ORDER NOTE: …" when there is one · cut.

**A. Dine-in, merged tables, options and notes — 80 mm (48):**
```
KARAHI                                   1:22 PM     [b]
================================================
                 T4 + T5                         [x2]
DINE-IN  Hamza  #7F3K2Q
------------------------------------------------
2 x Chicken Karahi Full                              [b]
    + No onion
    + 2 x Extra butter
    NOTE: less spicy
------------------------------------------------
ORDER NOTE: birthday, bring together
```
**Same — 58 mm (32):**
```
KARAHI                   1:22 PM     [b]
================================
         T4 + T5                     [x2]
DINE-IN  Hamza  #7F3K2Q
--------------------------------
2 x Chicken Karahi Full              [b]
    + No onion
    + 2 x Extra butter
    NOTE: less spicy
--------------------------------
ORDER NOTE: birthday, bring
together
```
**B. Takeaway from an earlier day, boosted, option child — 80 mm:**
```
TANDOOR                                  1:24 PM
================================================
              #12 10 Nov                         [x2]
TAKEAWAY  Sana  #9QK41M
** FIRST - #12 10 Nov is eating **                   [b]
------------------------------------------------
4 x Naan
3 x Naan - for Chicken Karahi Full
```
**58 mm:**
```
TANDOOR                  1:24 PM
================================
      #12 10 Nov                     [x2]
TAKEAWAY  Sana  #9QK41M
** FIRST - #12 10 Nov is eating
**
--------------------------------
4 x Naan
3 x Naan - for Chicken Karahi
Full
```
**C. Parking, remake, deal part, reprinted — 80 mm:**
```
                 ** REPRINT **                       [b]
KARAHI                                   1:31 PM
================================================
  PARKING LEB 1234 SEDAN                         [x2]
PARKING  Hamza  #2B7XRA
** RETURN - REMAKE - was T7 Chicken Karahi Half
**
------------------------------------------------
1 x Chicken Karahi Half
    + No onion
1 x Raita (Family Deal)
```
**58 mm:**
```
         ** REPRINT **
KARAHI                   1:31 PM
================================
PARKING LEB 1234                     [x2]
           SEDAN                     [x2]
PARKING  Hamza  #2B7XRA
** RETURN - REMAKE - was T7
Chicken Karahi Half **
--------------------------------
1 x Chicken Karahi Half
    + No onion
1 x Raita (Family Deal)
```
Notes: with both toggles off, the meta line is only "DINE-IN". A reprint prints **every live line** and the **current** table. Done lines drop out of a kitchen ticket printed at fire; a kitchen ticket with nothing left is never sent.

### 5.3 03c-P03 REPRINT header

`** REPRINT **`, centred, bold, as the first line of any job that is a manual reprint, a restart re-send, a retry after a partly written job, or a suspect recovery (03c §3.5). Also on `document` jobs (05's bills) when they are re-sent (hub: `print/worker.ts`). See example C.

### 5.4 03c-P04 CANCELLED slip

Structure: [REPRINT] · station + send time · one bold line per cancel · cut. Printed only for a line of a **printed** ticket that is **not done** (03c §3.3, P9).

Partial (units left): `CANCELLED  <identifier>  - <n> x <item>  <k> left`. Whole (whole line, or a cancel that leaves 0): `CANCELLED  <identifier>  <n> x <item>` (v1.0.4 C1-2: never "0 left").

80 mm:
```
TANDOOR                                  1:26 PM
CANCELLED  T4 + T5  - 2 x Naan  4 left               [b]
```
```
TANDOOR                                  1:27 PM
CANCELLED  T4 + T5  6 x Naan                         [b]
```
58 mm:
```
TANDOOR                  1:26 PM
CANCELLED  T4 + T5  - 2 x Naan       [b]
4 left                               [b]
```
```
TANDOOR                  1:27 PM
CANCELLED  T4 + T5  6 x Naan         [b]
```
A cancel whose line is done, served or gone by the time it is sent is not printed (stale).

### 5.5 03c-P05 FIRST slip

Only at a **`printer` (paper only)** station, on boost or expedite of a printed, not-done line (03c §3.3, P9). One line per affected line: `FIRST  <identifier>  <live units> x <item> (boost|expedite)`.

80 mm:
```
TANDOOR                                  1:28 PM
FIRST  T12  2 x Roghni Naan (boost)                  [b]
FIRST  T12  4 x Naan (boost)                         [b]
```
58 mm:
```
TANDOOR                  1:28 PM
FIRST  T12  2 x Roghni Naan          [b]
(boost)                              [b]
FIRST  T12  4 x Naan (boost)         [b]
```

### 5.6 03c-P06 COMING UP slip

Printed once at the start of a paper fallback outage, at most once per station per 5 minutes (v1.0.5 C4-1), from the station's plan at send; a COMING UP older than 10 min when it is sent is not printed (03c §3.4, §3.5). One line per planned line: `<fire time>  <identifier>  <units> x <item>`.

80 mm:
```
               COMING UP                         [x2, b]
TANDOOR                                  1:40 PM
================================================
1:42 PM  T4 + T5  6 x Naan
1:44 PM  #12 10 Nov  4 x Naan
1:45 PM  PARKING LEB 1234 SEDAN  2 x Roghni Naan
```
58 mm:
```
       COMING UP                     [x2, b]
TANDOOR                  1:40 PM
================================
1:42 PM  T4 + T5  6 x Naan
1:44 PM  #12 10 Nov  4 x Naan
1:45 PM  PARKING LEB 1234 SEDAN
2 x Roghni Naan
```
Nothing planned: `Nothing coming up` under the `=` line.

### 5.7 03c-P07 Test print (hub: `print/routes.ts`)

```
              TEST PRINT                         [x2, b]
                Tandoor printer
                    1:05 PM
------------------------------------------------
LAN  80 mm
```

### 5.8 03c-P08 Document

05's bills, receipts and Z reports print through `printDocument` with 05's own template (03c §3.9). 03c adds only the REPRINT header on a re-send. Not designed here.

---

## 6. Copy list

Proposed English. Keys follow the client's existing pattern (`apps/client/src/i18n/en.ts`, `ur.ts`). **[UR]** = Urdu needed (Pass, alert cards, hub admin, owner page). **[EN]** = English only in P1 (KDS, story E3 scope; add Urdu later). Missing Urdu goes to `docs/design/handoff/03b/urdu-todo.md`. Placeholders in `{}` stay LTR.

### 6.1 KDS (03b-S01) [EN]

| Key | English | Intent |
|---|---|---|
| `kds.now` / `kds.next` / `kds.later` | Now / Next / Later: {n} | section heads |
| `kds.start` / `kds.done` / `kds.undo` | Start / Done / Undo {m:ss} | row buttons |
| `kds.waiting` / `kds.cooking` / `kds.late` / `kds.in` | waiting {m:ss} / cooking {m:ss} / late +{n} min / in {m:ss} | timers |
| `kds.done_early` | Done already? {elapsed} of {cook} — tap again | B01 |
| `kds.start_first` | Tap Start first | B02 |
| `kds.tap_done` | Tap Done when ready — it won't finish by itself | B04 |
| `kds.undo_closed` | Too late to undo | `ITEM_UNDO_WINDOW_CLOSED` |
| `kds.handed_over` | Already handed over — can't undo | `ITEM_WRONG_STAGE handed_over` |
| `kds.gone` | This order is no longer in the kitchen | out_of_engine, ORDER_NOT_FOUND |
| `kds.changed` | Already {served / removed} | other stages |
| `kds.not_this_station` | Not this station's line | PERMISSION_DENIED |
| `kds.give_more` / `kds.nothing_to_pull` | Give me more / Nothing to pull right now | C07, B08 |
| `kds.lanes` / `kds.lanes_custom` / `kds.lane_off` / `kds.lane_on` | Lanes: {on} of {count} on / Custom capacity / Lane Off / Lane On | C08 |
| `kds.reconnecting` | Reconnecting… | B06 |
| `kds.archived` | Station archived — finish open tickets · {n} open | B07 |
| `kds.day_not_started` | Day not started | F01 |
| `kds.empty` | Nothing to cook right now | empty |
| `kds.coming_up` | Coming up | C06 label |
| `kds.mark.return` / `.fix` / `.remake` / `.was` | RETURN / Fix / Remake / was {identifier} {item} | C04 |
| `kds.mark.boost` / `.expedite` / `.pulled` / `.moved` | Boost / Expedite / Pulled / Moved | C04 |
| `kds.for_parent` / `kds.deal` | for {item} / ({deal}) | sub-line |
| `kds.car.sedan` / `.mini` / `.large` | Sedan / Mini / Large | parking (also [UR] on the Pass) |
| `kds.loading` | Loading… | F02 |

### 6.2 Pass (03b-S02, S03, D01) [UR]

| Key | English | Intent |
|---|---|---|
| `pass.title` | {point} | screen title, e.g. "Pass" |
| `pass.ready` / `pass.hold` | Ready / HOLD AT PASS | C12 |
| `pass.stage.waiting` / `.cooking` / `.done` / `.handed_over` | waiting / cooking / done / handed over | C11 |
| `pass.mark_ready` | Ready to serve | primary |
| `pass.ready_at` | Ready · {time} · {name} | B10 |
| `pass.undo_ready` / `pass.undo_closed` | Undo {m:ss} / Too late to undo | B10 |
| `pass.hand_over` | Hand over | button |
| `pass.who_takes` | Who is taking it? | D01 title |
| `pass.table_team` | {table} team | tile tag |
| `pass.handed` / `pass.handed_left` | Handed to {name} / {n} handed to {name} · {k} left — tap Hand over again | B11 |
| `pass.no_receivers` | Nobody signed in can take this order. Ask a waiter to sign in. | empty tiles |
| `pass.receiver_invalid` | {name} can't take this order now — pick someone else | PASS_RECEIVER_INVALID |
| `pass.nothing_done` | Nothing is done yet to hand over | ITEM_WRONG_STAGE on Handover |
| `pass.nothing_left` | Nothing left to serve on this order | ITEM_WRONG_STAGE served |
| `pass.gone` | This order is no longer in the kitchen | ORDER_NOT_IN_ENGINE |
| `pass.not_due` | Not due yet | Start on an unfired line (§7 Q-12) |
| `pass.takeover` | {station} screen offline | S03 title (03b §3.6) |
| `pass.no_screen` / `pass.screen_offline` | No screen / Screen offline | C13 |
| `pass.offline` | No connection to the hub — reconnecting… | B12 |
| `pass.read_only` | You can see the Pass but not run it. Ask a manager. | B14 |
| `pass.point_archived` | This Pass point is archived. Ask a manager to set up this tablet again. | B15 |
| `pass.empty` | No orders at the Pass | empty |
| `nav.pass` | Pass | staff-entry nav (§7 Q-6) |

### 6.3 Printed tag and reprint [UR on the Pass, EN on the KDS]

| Key | English |
|---|---|
| `print.tag.printed` | Printed |
| `print.reprint` | Reprint |
| `print.reprinting` | Reprinting {n} tickets |
| `print.reprint_queued` | It prints when the printer is back |
| `print.nothing_to_reprint` | Nothing to reprint |
| `print.no_tickets` | This order has no tickets |

### 6.4 Alert kinds [UR]

| Key | English (card) | English (lock) |
|---|---|---|
| `alert.ready_to_serve.card` / `.lock` | Ready to serve · {identifier} · {point} | Ready to serve · {table} · {point} |
| `alert.served_card.card` / `.lock` | Food handed to you · {identifier} — tap Served when it's on the table | Food handed over · {table} |
| `alert.kds_offline.card` / `.lock` | {station} screen offline | Kitchen screen offline |
| `alert.kds_offline.help` | Its tickets are on the Pass tablet. Check the screen's cable and power. | — |
| `alert.printer_problem.card` / `.lock` | {printer} · {problem} · {waiting} waiting | Printer problem |
| `alert.printer_problem.problem.paper_out` / `.offline` / `.not_printing` / `.ticket_not_built` | Out of paper / Offline / Not printing / A ticket couldn't be built | — |
| `alert.printer_problem.help.paper_out` | Put in a new roll. Waiting tickets print by themselves. | — |
| `alert.printer_problem.help.offline` | Check the printer's power and cable. | — |
| `alert.printer_problem.help.not_printing` | Tickets are not going out. Check the printer, then try a test print. | — |
| `alert.printer_problem.help.ticket_not_built` | Check that order on the kitchen screen. It may not be on paper. | — |
| `alerts.closed.undone` / `.moved` / `.screen_back` / `.screen_removed` / `.printing_again` | Pass took it back / Moved to {table} / Screen back / Screen removed / Printing again | closed result lines |

(The 01d labels code fills `{table}`, `{point}`, `{requester}`, `{device}` today; `{identifier}`, `{station}`, `{printer}`, `{problem}`, `{waiting}` are new parameters for the builder.)

### 6.5 Hub admin Kitchen screens [UR]

| Key | English |
|---|---|
| `kitchen_screens.title` | Kitchen screens |
| `kitchen_screens.point` | Point: {point} |
| `kitchen_screens.volume` / `.volume_help` | Sound volume / How loud the kitchen screen chimes. 0 is silent. |
| `kitchen_screens.lanes` / `.lanes_custom` | {on} of {count} lanes on / Custom capacity |
| `kitchen_screens.state.connected` / `.signed_out` / `.offline` | Connected / Signed out / Offline |
| `kitchen_screens.no_screen` | No screen — its lines show on the Pass |
| `kitchen_screens.dark` | Screen offline — its tickets are on the Pass |
| `kitchen_screens.lane_label` / `.lane_label_help` | Lane label / Give each screen of a big station its own name, like Left or Right. |
| `kitchen_screens.pass_tablets` / `.bind` / `.unbind` | Pass tablets / Use as Pass tablet for… / Stop using as Pass tablet |
| `kitchen_screens.warn.archived_open_lines` | {station} is archived but still has open tickets |
| `kitchen_screens.warn.dark` | {station} screen is offline |
| `kitchen_screens.point_archived` | Point archived — bind to another point |
| `kitchen_screens.no_stations` | Add stations in the owner app first |
| `errors.STATION_NOT_FOUND` / `errors.DEVICE_NOT_FOUND` / `errors.POINT_NOT_FOUND` | This station is no longer there — reload / This device was removed — reload / That point no longer exists |

### 6.6 Hub admin Printers [UR]

| Key | English |
|---|---|
| `printers.title` / `.add` / `.edit` / `.archive` / `.test` | Printers / Add printer / Edit / Archive / Test print |
| `printers.none` | No printers. Every station works on its screen. Add a printer only if you want paper. |
| `printers.name` / `.connection` / `.lan` / `.usb` / `.address` / `.paper` | Name / Connection / Network (LAN) / USB / Address / Paper |
| `printers.address_help_lan` / `_usb` | Like 192.168.1.50:9100 / /dev/usb/lp0 or /dev/pos-printer-… from the install guide |
| `printers.status.clean` / `.paper_out` / `.offline` / `.unknown` | Ready / Out of paper / Offline / Status unknown |
| `printers.no_status` | This printer doesn't report status |
| `printers.usb_note` | USB printers can't tell the hub when they run out of paper. LAN printers with status are recommended. |
| `printers.waiting` / `.suspect` | {n} waiting / {n} may not have printed — they reprint by themselves when the printer is ready |
| `printers.last_printed` / `.checked` | last printed {time} / checked {time} |
| `printers.error.connect` / `.write_timeout` / `.write_failed` / `.busy` | Can't reach the printer / The printer stopped taking paper / Sending failed / In use — try again in a moment |
| `printers.test_busy` | Printing a test… |
| `printers.test_ok` / `.test_no_status` / `.test_bad_status` / `.test_failed` | Printed. Status works. / Printed. This printer doesn't report status. / Printed, but the printer reports {status} / Couldn't print: {error} |
| `printers.test_recovered` | {n} tickets that may not have printed are being reprinted |
| `printers.archive_confirm` / `.in_use` | Archive {name}? It stops printing. / {stations} still use this printer. Change their output first. |
| `printers.used_by` | Used by {stations} |
| `outputs.title` | Station outputs |
| `outputs.mode.screen` / `.fallback` / `.both` / `.printer` | Screen only / Screen, paper if the screen is off / Screen and paper / Paper only |
| `outputs.show_taker` / `.show_order_id` | Show order taker on the ticket / Show order number on the ticket |
| `outputs.need_printer` | Pick a printer for paper |
| `outputs.archived` | Archived stations |
| `queue.title` / `.empty` | Print queue / Nothing waiting |
| `queue.kind.kitchen` / `.reprint` / `.cancel` / `.first` / `.coming_up` / `.document` | Ticket / Reprint / Cancelled slip / First slip / Coming up / Bill / receipt |
| `queue.tried` / `.no_printer` / `.no_printer_total` | tried {n} times / No printer: this station has no printer now. This job will never print. Cancel it or give the station a printer. / {n} jobs have no printer |
| `queue.cancel_confirm` / `.already_printed` / `.already_cancelled` | Cancel this ticket? It will not print. / Already printed / Already cancelled |
| `printers.warn.lossy_name` / `.fold_skipped` / `.suspect_waiting` / `.screen_unused` / `.no_screen` | as §3.5.7 |
| `errors.PRINTER_NOT_FOUND` / `errors.PRINT_JOB_NOT_FOUND` / `errors.PRINT_JOB_NOT_PENDING` | This printer was removed or archived — reload / This job is no longer there / Already printed or cancelled |
| existing: `errors.CONFIG_NAME_TAKEN`, `errors.CONFIG_IN_USE`, `errors.VALIDATION_FAILED`, `errors.PERMISSION_DENIED` | reuse; field-specific text as §3.5 |

### 6.7 New error keys for 03b codes [UR on Pass, EN on KDS]

`errors.ITEM_UNDO_WINDOW_CLOSED` "Too late to undo" · `errors.PASS_UNDO_WINDOW_CLOSED` "Too late to undo" · `errors.ITEM_DONE_CONFIRM_REQUIRED` → B01 (no toast) · `errors.PASS_RECEIVER_INVALID` → `pass.receiver_invalid` · `errors.ITEM_WRONG_STAGE` → by stage, as §3.1.9 / §3.2.8 · `errors.ORDER_NOT_IN_ENGINE` → `pass.gone`.

### 6.8 Existing strings (do not rewrite)

`perm.run-pass` "Run the Pass: mark orders ready and hand them over"; `perm.reprint-ticket` "Reprint a kitchen ticket"; `alerts.device.kds` "Kitchen screen"; `branches.timing.kds`, `.kds_help`, `.ready_window_ms`, `.kds_offline_ms`, `.served_estimate_ms`, `.served_estimate_switch`, `.served_estimate_help`, `branches.timing_seconds_range`, `branches.timing.unit_sec` (EN + UR).

---

## 7. Open design questions

Only what the specs leave to design. Everything else is decided.

| # | Question | Recommendation |
|---|---|---|
| Q-1 | Header clock on the KDS? 03b P6 says rows show "no clock or promise times"; a clock in the header is not addressed. | **No clock** on the KDS, to follow P6 literally; timers on rows are enough. If the owner wants one, a small header clock only. |
| Q-2 | Batch loads: the client receives no load id (`kds_station` / `station_plan` carry none), yet one tap acts on the whole load. How to show a load? | Show rows as usual. After a tap, every row of the load changes together; draw a short highlight on the changed rows. No grouping box (it would need data the screen does not get). |
| Q-3 | Lane control when lanes are `custom` (a manager override). | Show "Custom capacity" with Lane Off / On still shown; a tap sets an exact count from the lane screens' count (`SetLaneState` stores it exactly). Builder to confirm the starting count (recommend: lane_count − 1 for Off). |
| Q-4 | Where the coming-up strip sits. | A full-width strip under the header bar, 6 chips max, largest first. |
| Q-5 | The two KDS sounds (enter-Now chime, strong RETURN / boost / expedite sound). Browser autoplay may block sound until a tap. | Recipes in the 01d style: the chime = 01d Info-like single tone; the strong sound = a 3-note rising pattern, louder. If audio is blocked, a dark bar "Tap to turn on sound" once after load (no setting, no mute). |
| Q-6 | Where the Pass sits in the 01d staff-entry nav on a point-bound tablet. | First tab "Pass", the default after sign-in; Inbox and Requests stay as in 01d. |
| Q-7 | Show time since Ready on the card? (`ready.at` is known; the window setting is not in `point_view`.) | Show "Ready 0:45" counting up, neutral colour; no colour change at the window. |
| Q-8 | A line picker in the Hand over sheet (the command accepts a list). | No picker in the pilot: one tap hands over every done line (K13). |
| Q-9 | Show the served estimate (e.g. "counts as served at 1:27 PM") on the Pass card or Served card? | No; it is a background rule. The Served card text already says "tap Served". |
| Q-10 | Feedback when a takeover ends (screen back). | A short ok toast on the Pass: "Tandoor screen is back". |
| Q-11 | Pass target size: 56 px (staff rule) or 72 px (kitchen)? | 72 px for Ready to serve, Hand over, Start / Done and the receiver tiles; 56 px elsewhere. |
| Q-12 | Start on a screenless station's line that is not fired yet (the Pass does not know fired / unfired; the hub answers `ITEM_WRONG_STAGE added`). | Show Start on every waiting line; on that error show "Not due yet". |
| Q-13 | What tapping a Ready-to-serve / Served / Kitchen-offline / Printer-problem card opens. | 01d's notice detail (D04) with the facts. For printer and kitchen-screen cards on an admin-capable device, add a link "Open Printers" / "Open Kitchen screens" (pages exist). |
| Q-14 | 03c C3-3 says only a manager closes a `ticket_not_built` alert, but no close command exists (01d has none; it expires at day close). | **Owner / spec question, not design.** Until a command exists, draw no Close button on that card; show "Stays until day close" on it. |
| Q-15 | Where "Kitchen screens" and "Printers" appear on the hub admin home (00 `AdminHome` tiles; no admin menu spec, 00-index). | Two tiles beside Devices: "Kitchen screens" and "Printers", each with a status line ("1 screen offline", "Out of paper"). |
| Q-16 | Binding a tablet that is not yet a Pass tablet: `kds-config` lists only bound tablets. | A "Use as Pass tablet" action on the 00 Devices page rows of type tablet (opens D03), plus a picker on Kitchen screens fed by 00's devices query. |
| Q-17 | A sound test on the Kitchen screens page. | A "Play on this device" button next to the volume, playing the chime at that volume locally; it does not ring the KDS (no such command). |
| Q-18 | An archived station's output row still holds a printer, so that printer can't be archived (`CONFIG_IN_USE`) and `SetStationOutput` refuses archived stations. | **Owner / spec question.** Design: list it read-only under "Archived stations" with "Holds {printer}". |
| Q-19 | The print queue gives order ids, not identifiers. | Show station + kind + time + "REPRINT" / tries; identifier only if the builder can map it from data it already has. |
| Q-20 | Reprint on the KDS: the slot API has a Pass-card action but no KDS-row action, and the KDS (station session) cannot read `order-tickets` to know its station prints. | **Spec gap for the builder / owner.** Design a small "Reprint" action on a row (or in a row's overflow) for `both` stations; the visibility rule waits for the answer. |

---

*Written 2026-11-12 from main @ `79e907b` (03b v1.0.5, 03c v1.0.5). Nothing in this file changes a spec.*
