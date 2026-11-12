# 03b + 03c · Kitchen screens, Pass and Printing: changes and decisions

71 frames: 50 staff frames in **Pulse Chatkhara** and 21 hub admin and paper frames in the **owner kit** (the 00 admin look). The two stacks never mix in one frame.

## 1. Owner decisions (asked)

| Question | Answer |
|---|---|
| Unslop A / B? | **Pulse as-is.** No restyle. KDS uses the dark Pulse tokens (`.pu.v-brand.kds`). Pass, alerts and phones use light Pulse. Hub admin pages use the 00 admin shell (owner kit). |
| Brief | Full file supplied: `brief/03b-03c-brief.md`. |

Everything else was decided by design and is listed below.

## 2. UX review (clutter report) → what changed from the brief

| # | Brief / spec said | Problem | Design |
|---|---|---|---|
| 1 | "Line row" on the KDS | A row list at 1920 leaves half the screen empty, and the Start/Done targets end up far from the item name. | **One card per line** in a grid, in append order (3 columns at 1920, 2 at 1280). **Never merged**, as P12 says. "new lines join at the end" sits above the grid so a cook knows where to look. |
| 2 | Next and Later as sections | Next pushed Now below the fold during a rush. | **Next is a fixed right column** (rows with "in m:ss", a mark when moved). Later is one count. **Give me more** sits at the bottom of that column. |
| 3 | Coming-up strip "here or under the header" (Q-4) | — | Full-width strip under the header, max 6 chips, largest first. |
| 4 | Start and Done both visible | Two equal buttons cause wrong taps when hands are wet. | A card shows **one** action at a time: **Start** (saffron tint) → **Done** (neutral) → **Undo m:ss**. On a two-tap station, B02 "Tap Start first" lights Start (`.hot`). |
| 5 | A cooking line | A loud saffron edge on every cooking card was noise. | Cooking = soft accent edge (38%). Late = danger edge plus the "+2 min late" ring. RETURN / BOOST / EXPEDITE / MOVED = danger mark, PULLED = soft info mark. |
| 6 | Pass primary | A saffron primary would compete with green Ready. | **Ready to serve = green** (`btn--ready`). Green is used only for Ready. Hand over = info tone. **Hand over is hidden** until the card has at least one done line. |
| 7 | Pass card body | — | Lines grouped by station (KARAHI / TANDOOR / COLD · NO SCREEN). Each line has a stage chip (icon + word + colour) and a "Printed" tag when printed. A 12-line card folds to "+5 more lines". |
| 8 | Header clock on KDS (Q-1) | — | **No clock.** Row timers are enough. |
| 9 | Hub admin page per brief | — | Station cards (screens, lane labels, volume) plus a Pass tablets section. Printers: printer cards → Station outputs table → Print queue, on one page. |

## 3. Components and CSS

- `design/pulse-03.css` (staff, on top of `pulse.css`, `v-brand.css`, `pulse-01d.css`, `pulse-02.css`):
  - **KDS:** `.kbar`, `.kcu`, `.kgrid`, `.kcards`, line card `.kl` (+ `__top`, `__id`, `__it`, `__opts`, `__note`, `__acts`, `__msg`, `__band`), states `.s-cook`, `.s-late`, `.s-mark`, `.s-cue`, `.s-done`, `.s-hl`, `.s-off`, `.s-ph`, compact `.kl--c`, timer `.ktm`, marks `.kmk`, `.ptag`, `.rmd`, buttons `.btn--start`, `.btn--done`, `.btn--confirm`. Next column `.knx`, `.knr`, `.klater`, `.kmore`. Banners `.kbn`, full states `.kfull`.
  - **Pass:** `.pass`, `.pstrip` / `.pst`, `.pcards`, card `.pc` (`.ready`, `.hold`, `.sent`), line `.pl`, `.rd`, `.btn--ready`, `.btn--hand`, takeover `.tko`, receivers `.rcvs` / `.rcv`.
- `design/admin-03.css` (owner kit, on top of `ds/pos` + `kit-additions.css`): `.ks` station card, `.scr` screen row, `.vol` volume, `.pr` printer card, `.pos-list--out` / `--q`, `.tres` test result, `.modes` / `.mode`, `.ad-scrim`, `.ad-toast`, `.ad-empty`, paper preview `.paper` (`.w48`, `.w32`, `.x2`, `.b`, `.lost`, `.cut`).

## 4. Answers to brief §7

| Q | Decision |
|---|---|
| Q-1 | No clock on the KDS. |
| Q-2 | No grouping box. After one tap, every row of the load changes and gets a short highlight (`.s-hl`), plus one info line "One tap started the whole load (8 lines)" (`KdsBatchStarted`, `KdsBatchDone`). |
| Q-3 | **Decided 2026-11-12.** "Custom capacity" chip with Lane Off and Lane On: Lane Off sets lane_count − 1, Lane On sets all lanes on (lane_count). **Lane Off is hidden** (not greyed) when lane_count = 1 or only 1 lane is on (minimum 1). Lane On is off when all lanes are on. Same rule on the KDS header and the Pass station strip (`KdsLaneStates`, `KdsLaneCustom`, `KdsLaneOff`). |
| Q-4 | Strip under the header (see §2 #3). |
| Q-5 | Sounds: 01d-style recipes (chime = single Info tone; strong = 3 rising notes, louder). If autoplay is blocked: a dark bar "Tap to turn on sound", shown once (`KdsLockSound`). |
| Q-6 | Nav segment **Pass · Inbox · Requests**; Pass is the default after sign-in. |
| Q-7 | "Ready · 1:21 PM · Asif" band with a neutral count-up and Undo m:ss. No colour change. |
| Q-8 | No line picker. One tap on a receiver tile = hand over every done line (max 40). |
| Q-9 | Served estimate is not shown. |
| Q-10 | Ok toast "Tandoor screen is back" (`PassScreenBack`). |
| Q-11 | 72 px for Ready to serve, Hand over, Start / Done on the Pass and receiver tiles (96 px tiles). 56 px elsewhere. KDS card buttons 72 px. |
| Q-12 | Start on every waiting screenless line; error → "Not due yet" on the line (`PassCards`). |
| Q-13 | Notice detail (01d D04) with facts. "Open Printers" / "Open Kitchen screens" link on admin-capable devices (`NoticePrinter`). |
| Q-14 | **Decided 2026-11-12.** Only on `printer_problem` cards of kind `ticket_not_built`, and only for managers: a **Dismiss** button (56 px). After the tap the card closes as "Dismissed · {name}" (it records who dismissed it). Everyone else: no button, the card shows "Stays until day close". No Dismiss on any other alert kind (`AlertCards`, `AlertCardsUrdu`). |
| Q-15 | Two tiles on AdminHome: Kitchen screens ("1 screen offline") and Printers ("Out of paper"). Two sidenav items under "Other jobs". |
| Q-16 | "Use a tablet as Pass tablet" on Kitchen screens opens D03 with a picker fed by 00's devices query (`KitchenScreensBind`). Also add the same action on 00 Devices rows of type tablet. |
| Q-17 | "Play on this device" next to each volume slider. It plays locally only. |
| Q-18 | **Decided 2026-11-12.** Archiving or removing a station releases its printer in the same config apply. Archived-station rows stay read-only under "Archived stations" with **no printer** ("No printer — released when archived"). There is no "printer still assigned" blocked state for this case: archiving that printer afterwards just works. The 409 "still use this printer" dialog stays only for **active** stations (`PrinterArchive`). The station's pending print jobs are **not** cancelled; they stay in the Print queue until a manager cancels them (Grill's "No printer" job in `PrintersPaperOut`). |
| Q-19 | Queue rows show time, kind (REPRINT tag), station · printer, state. Identifier only if mappable. |
| Q-20 | **Decided 2026-11-12.** The KDS gets `has_printer` for its station. **Reprint** shows on the card's action row only when `has_printer` is true (`KdsReprint`). When it is false, Reprint is simply absent: no disabled or greyed state. |

## 5. New string keys (copy not in brief §6)

| Key | English |
|---|---|
| `kds.append_hint` | new lines join at the end |
| `kds.batch_started` | One tap started the whole load ({n} lines) |
| `kds.batch_done` | One tap finished the whole load — Undo on any line undoes all |
| `kds.ready_made` | Ready-made |
| `pass.more_lines` | +{n} more lines |
| `admin.ks.empty` | No stations yet |
| `admin.ks.empty_hint` | Add stations in the owner app first |
| `admin.ks.signed_out_normal` | “Signed out” is normal: a Pass tablet with nobody signed in still gets alerts. |
| `admin.ks.volume_saved` | Saved. {station} screens use it on the next sound. |
| `admin.pr.none_hint` | Every station works on its screen. Add a printer only if you want paper. |
| `admin.pr.queue_empty` | Nothing waiting |
| `admin.pr.output_released` | No printer — released when archived |
| `alert.dismiss` / `alert.dismissed` | Dismiss / Dismissed · {name} |

Urdu for these goes to `docs/design/handoff/03b/urdu-todo.md` if it isn't supplied. The KDS stays English (P1).

## 6. Owner decisions 2026-11-12 (spec 03b/03c v1.0.6)

Q-3, Q-14, Q-18 and Q-20 are decided; see §4. Changed or new frames: `KdsLaneStates` (new), `KdsLaneCustom` (new), `KdsLaneOff`, `KdsReprint`, `AlertCards`, `AlertCardsUrdu`, and every Printers frame that shows Station outputs (`Printers`, `PrintersPaperOut`, `PrintersUrdu`, `PrinterAdd`, `PrinterTest`, `PrinterArchive`, `OutputEditor`, `QueueCancel`).

No open owner questions left for this module.
