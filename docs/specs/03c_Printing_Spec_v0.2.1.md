# 03c Printing — Module Spec

| | |
|---|---|
| Doc | Module spec, **v0.2.1 — DRAFT, ready for owner approval (developer, 2026-11-11)**: v0.2 + the re-check's wording fixes (`docs/reviews/03b_v0.4_03c_v0.2_recheck.md`; §12.6). Split out of 03b by the owner's ruling R-2: screens are 03b's, **the printer is an optional accessory** (R-1). v0.1 carried 03b v0.2's printing rules with run 2's printing findings fixed (§12.4); v0.2 closes the targeted check `docs/reviews/03b_v0.3_03c_v0.1_targeted_check.md` (§12.5). Re-check done (M-3 partly → fixed in v0.2.1). |
| Depends on | **03b KDS + Pass v0.4.1** (`stationPresence`, `buildLineDetails`, `pointOfLine`, `devicePoint`, client slots), Foundation **v1.11**, 00 **v1.8**, 01a **v2.3**, 01b **v1.7** (+ 03b's B-1), 01d **v1.2.1** (+ 03b's D-2), 02a **v1.1.4**, 02b **v1.0.3** (+ `module-02b` after merge), 03a **v1.2**. Target versions: one bump per target, applied by 03b's task 0d, with 03b v0.4.1 §4.5's fallback if 03c is approved separately. |
| Read by | 05 (print API), 07. |
| Inherits | Shared Standards from Foundation v1.11 §6. |
| Inputs | `03b-g0.md` (§6 Q1, Q2, Q3, Q4, Q9, Q10, Q13), `03b-g1-decisions.md` (G1-1–G1-5, G1-14, G1-15, R-1, R-2, R-5, R-6), OQ-1 answer; run 1 and run 2 reviews; 02b v1.0.2 §4.3 To 03b, O16; Foundation §5.8, D24, R8. |
| Rigor | T2 (CLAUDE.md). |

### Changelog

| Version | Date | Change |
|---|---|---|
| **v0.2.1** | 2026-11-11 | Re-check fixes (§12.6): one suspect rule (Ack line points to §3.5), `COALESCE(last_clean_at, 0)` (N-1); a clean read clears only jobs acked a buffer-drain earlier (N-8); `no_screen` warning (N-3); bumps follow 03b v0.4.1's note. |
| v0.2 | 2026-11-11 | **Targeted check closure (§12.5):** every job acked since the printer's last clean status turns suspect on a bad read (M-3, R-5); recovery re-queues the same kind, one job per ticket (n-9); skips recorded at any station with a printer, alerted when it matters (m-9); Cook can reprint (03b B-1) and `order-tickets` returns `has_printer` (m-6); bumps shared with 03b, Q-1 → 02b v1.0.4 (m-5); no timing asserts (m-7); client additions through 03b's slots (m-10); H-11 narrowed to the post-listen start (n-4); hard write timer (n-5); lost lines and tests restored (n-6). |
| v0.1 | 2026-11-11 | Split from 03b v0.2 §3.6–§3.10, §3.14–§3.15 and their tables, commands, kinds and tests (R-2). Run 2 fixes: write timeout and USB isolation (M-1), suspect jobs reprinted when the printer recovers (M-2, R-5), `printer_problem` details via 03b's D-2 (M-3), "clean or unknown" close (m-1), cancelled kitchen jobs and skipped folds (m-2), admin paths (m-9), Reprint on the Pass card (m-12, R-6), FIFO advances at ack (m-13), 02b v1.0.3 row (m-14), slip units at send + registration order (m-15), n-4, n-7, n-8, n-12. Closure §12.4. |

---

## §1. Header

### 1.1 Stories covered

- **E3 "Ticket printing"** (P1): AC1 (per-station output), AC2 (screen offline → paper, where a printer is attached), AC3 (58 / 80 mm, LAN / USB), edges (printer down never blocks, Done cancels an unsent print, reprint after restart).
- E0 Orders AC4 (reprint, from the KDS and the Pass card); E0 Hardware printers; E5 power (print queue survives restart, D24); E0 Templates AC2 kitchen ticket (fixed layout, G1-14).
- README carried rows :200, :211, :240 #5; 02b §4.3 To 03b ticket rows (token + date, parking, notes verbatim, no zone-served, no COMP, CANCELLED delta, RETURN); 01a :398 on paper; F §5.8 step 5; OQ14.

### 1.2 In scope

Printer and station-output configuration (hub admin); the hub print queue; kitchen tickets per order per station per fire; CANCELLED / FIRST / REPRINT / COMING UP slips; suspect-ticket recovery; paper fallback for dark screens; manual reprint (KDS, Pass card); ESC/POS renderer, LAN and USB transports; `printer_problem` alert; the `printed` tag on screens; the print API for 05; the hub admin "Printers" page.

### 1.3 Out of scope

Screens and presence (03b); receipt / bill / Z content and template (05); Urdu-script raster printing; configurable kitchen ticket template; training-mode printing (E13); reprint on 02b's screens (02b follow-up, R-6).

### 1.4 Decisions log

| # | Decision | Source |
|---|---|---|
| P1 | One kitchen ticket per **order per station per fire**. | Q1 B |
| P2 | Tickets print at **fire**. | Q2 A |
| P3 | Station output `screen` (default: no paper unless the screen is dark and a printer is attached), `both`, `printer` (a station with no screen); hub admin only. **Printers are optional** — nothing in 03b needs one. | Q3, R-1 |
| P4 | Paper fallback when 03b marks a station **dark** and it has a printer: Now as tickets + one COMING UP; every new fire prints until the screen is back. | Q4 A, R-3 |
| P9 | Extra slips: CANCELLED on removal / void of a **printed**, not-done line; FIRST on boost / expedite of a printed, not-done line at a `printer` station (a pull fires an unfired, never-printed line, so it never needs a FIRST slip); no slip for Done. | Q9 |
| P10 | Paper is ASCII-mapped text in PC437. | Q10 A |
| P13 | Reprint: the KDS reprints its own station's tickets without PIN; the Pass card reprints by order where the station has a printer (`reprint-ticket`). | Q13 A, R-6 |
| P14 | Generic thermal ESC/POS printers, USB or LAN; LAN preferred (status support); status and code page learned per printer. | OQ-1 |
| D1 | Tickets are a forward-only projection; **`print_jobs` only in `live` mode**; the fold is **total**; a skipped fire at a printer station is recorded and alerted. | G1-1; runs 1–2 |
| D2 | Jobs store references; bytes rendered at send. | G1-2 |
| D3 | An async print worker outside every writer transaction and every tick; **USB I/O in a child process per printer**, never on the hub's thread pool. | G1-3, G1-4; run 2 M-1 |
| D4 | **Ack = whole document written and flushed within the write timeout.** When a status read shows an error, **every job of that printer acked since its last clean status** is suspect; suspects are re-queued (same kind, REPRINT header) when the printer next reports clean (a duplicate is acceptable, a missing ticket is not, D24). | R-5; run 2 M-2; check M-3 |
| D8 | `printer_problem` is an `action` kind (a manager must fix paper, power or cable). | run 1 M-1 |
| D12 | 03c's screen additions (`printed` tag, Reprint) go through 03b's client slots (03b D12); 03c never edits 03b's folders. | check m-10 |

---

## §2. Existing architecture that must not change

- Everything in 03b v0.3 §2, plus: Foundation §5.8 boot steps (step 5 resumes the print queue; F §3 "Print queue … (none)": never synced); D24; R8; 00's `apps/hub/src/lib/boot.ts` boot sequence (listen at `:208`); 00 route groups (`/admin/...` with `config: { group: 'admin' }`).
- 03b v0.3: `stationPresence()`, `buildLineDetails`, `pointOfLine`, `devicePoint`, `LineDetail`, `Identifier`; the KDS and Pass clients; projection registration order (02b `orders` → 03b → 03c).
- 01d: `printer_alert_ms` joins `ALERT_CONSTANTS` (row D-3); `AlertDetailsBase.printer_name` / `problem` (03b's row D-2).

---

## §3. Domain rules

### 3.1 Words

- **Ticket** = lines of one order fired at one station by one `FireDispatched`. `ticket_id = fire_event_id + ':' + order_id`.
- **Job** kinds: `kitchen`, `reprint`, `cancel`, `first`, `coming_up`, `document`, `test`.
- **Has a live kitchen job** = an uncancelled `kitchen` job exists for the ticket (fallback test). **Printed** = an uncancelled `kitchen` or `reprint` job with `sent_at` set (slip test, `printed` tag).
- **Suspect** job = acked after the printer's **last clean status** (`printer_runtime.last_clean_at`) and before a status read that shows offline / paper-end / cover-open / error. Paper running out between two reads is therefore caught at the next read.

### 3.2 Station output and printers (P3, admin session)

- **Printer** (`SavePrinter`): name 1–40 (unique among active); `lan` (`host:port`, IPv4 in 10/8, 172.16/12, 192.168/16; port default 9100) or `usb` (`/dev/usb/lp[0-9]` or a udev symlink `/dev/pos-printer-[a-z0-9-]{1,30}`; install doc: udev rule by USB serial, service user in group `lp`); `paper_width_mm` 58 | 80. Archive refused while a station output uses it (`409 CONFIG_IN_USE`).
- **Station output** (`SetStationOutput`): `mode` `screen` | `both` | `printer`, `printer_id` (used by `both`, `printer`, and by `screen` for paper fallback), toggles `show_taker`, `show_order_id`. `both` / `printer` without a printer → `400 VALIDATION_FAILED { field: 'printer_id' }`. No row = `screen`, no printer.
- Hub admin warnings (`print-config`): `printer` station that also has a screen paired ("screen unused"); **`screen` station with a fallback printer but no paired screen** ("no screen paired — this station is screenless and never falls back to paper; set mode `printer` to print at fire", `no_screen`); a name that loses characters in PC437, skipped fires (§3.3), suspect tickets waiting.
- Config is hub-local: events on `hub` / `branch_id`, projection `print_config` (reset); worker facts in `printer_runtime` (outside the projection, so a `print_config` rebuild keeps them).
- **Station output / printer change:** pending jobs of a station follow its **current** printer at send (`print_jobs.station_id`); `document` and `test` jobs keep their own `printer_id`.

### 3.3 Kitchen tickets (P1, P2, D1)

Projection **`kitchen_tickets`** (forward-only), registered **after** 02b's `orders` and 03b's projections (boot assertion). Folds write `tickets` / `ticket_lines` in both modes (`INSERT OR IGNORE`); `print_jobs` **only when `mode === 'live'`**. **Total**: any unexpected shape → skip, log `print.fold_skipped`, and in `live` mode, when the station has **any** printer (`both`, `printer`, or `screen` with a fallback printer), insert a `print_fold_skips` row (`event_id`, `station_id`, `order_ids`, `reason`). The worker raises `printer_problem { problem: 'ticket_not_built' }` at once for a station that prints at fire, and for a `screen` station when it is (or becomes) dark; the print-config page lists every skip. A skip is never silent where paper could be needed.

*02b T19 exception (recorded):* the fold reads `order_lines.order_id` (immutable after `ItemAdded`) for the fired ids; 02b's projection applies first in both modes (registration order, `projections/registry.ts:47-50, :89-111`).

- **`FireDispatched { station_id, order_item_ids }`** → group by order (1 read); one `tickets` row per order, one `ticket_lines` row per id (multi-row inserts). Live and output `both` / `printer` (1 read) → `kitchen` job per ticket, `job_id = ticket_id + ':kitchen'`.
- **`ItemDone`** / **`ItemServed`** → `ticket_lines.done_at`; **`ItemDoneUndone`** → `NULL`.
- **`ItemRemoved { order_item_id, units? }`** / **`ItemVoided { order_item_id, units }`** on a not-done line of a **printed** ticket (1 read) → `cancel` job `{ ticket_id, order_item_id, units: p.units ?? null }` (`null` = whole line). Units left are rendered **at send** from `order_lines` (D2), so fold order never changes the numbers. Not printed → nothing.
- **`OrderBoosted`** / **`ItemsReleased { expedite }`** → `first` job per printed ticket with a not-done affected line, **at a `printer` station** only.
- **`TicketReprinted { ticket_ids }`** → `reprint` job per ticket.
- Slip / reprint job ids: `event_id + ':' + kind + ':' + n`. Cost: ≤ 3 reads + multi-row inserts per event.
- **Re-creating a kitchen job:** the unique index counts only uncancelled kitchen jobs; a new one after a cancel takes `ticket_id + ':kitchen:' + n` (n = count of earlier kitchen jobs + 1). So `UndoDone` after an empty-render cancel, or a manager-cancelled stuck job, can be printed again by fallback.

**Ticket layout (fixed; 32 / 48 columns; ASCII-mapped):**

```
TANDOOR                        1:22 PM
================================
           T4 + T5
DINE-IN  Bilal  #7F3K2Q
** RETURN - REMAKE - was T7 Chicken Karahi **
** FIRST - T12 is eating **
--------------------------------
4 x Naan
3 x Naan - for Chicken Karahi Full
1 x Chicken Karahi (Family Deal)
    + Extra butter
    NOTE: less spicy
--------------------------------
ORDER NOTE: birthday, bring together
```

Content from 03b's `buildLineDetails` (identifier, names, notes, return, order taker). No prices, no COMP, no zone-served lines; live units at render; fire time, 12-hour.

### 3.4 Paper fallback (P4)

Print worker, every 1 s (started after listen):

1. Stations with mode `screen` and a printer, and `stationPresence().get(station).dark === true` (03b §3.6: a screen station with no connected screen for `kds_offline_ms` and lines in Now / Next; screenless stations are never dark — they use mode `printer`).
2. While dark, each loop (1 statement per dark station): every ticket of the station holding a line in `stationView(state, station_id, now).now` with **no live kitchen job** → insert a kitchen job (`INSERT OR IGNORE`); on the first loop of an outage also one `coming_up` job (`station_id + ':coming_up:' + offline_since`) rendered at send from `stationPlan`.
3. Screen back (`dark` false) → stop; nothing printed is cancelled; 03c's `printed` frame tags the lines.
4. `both` / `printer` stations print at fire anyway. A `screen` station without a printer relies on 03b's Pass takeover and alert.

### 3.5 Slips, suspect recovery, reprint (P9, P13, D4)

- **CANCELLED:** "CANCELLED  T7  - 1 x Naan  3 left" (units left at send) or "CANCELLED  T7  4 x Naan".
- **FIRST:** "FIRST  T12  2 x Roghni (boost)".
- **REPRINT header** on `reprint` jobs, on restart re-sends, on retries after a partially written job (`is_reprint = 1`), and on suspect re-queues.
- **Stale:** `cancel` / `first` render empty (→ cancelled `stale`) when their line is done / served / gone; `coming_up` older than 10 min at send → cancelled `stale`; `reprint` with no live line → empty.
- **Suspect marking (R-5, D4) — the only suspect rule:** on a status read with an error bit, `UPDATE print_jobs SET suspect_at = now WHERE sent_printer_id = p AND acked_at > COALESCE(last_clean_at, 0) AND suspect_at IS NULL` (1 statement; `sent_printer_id` is stored at send). A new printer, or a hub whose first read after a restart is already bad, therefore marks every acked job of that printer not yet cleared. **A clean read clears only jobs acked a buffer-drain earlier:** it sets `last_clean_at = now − 10 000` (the write timeout; a ticket acked in the last 10 s may still be in the printer's buffer), never moving it backwards.
- **Suspect recovery:** when the status turns clean after a bad reading (or a test print prints), for each ticket with suspect jobs and a live, not-done line the worker inserts **one** recovery job of the **same kind** as the ticket's latest suspect (`kitchen` / `reprint` → `reprint`; `cancel` → `cancel`, so a lost CANCELLED slip comes back as a CANCELLED slip), id `ticket_id + ':recover:' + last_clean_at`, `INSERT OR IGNORE`, REPRINT header; then marks the suspects `suspect_resolved_at`. A printer whose status is **unknown** (no DLE EOT answer, USB without proven status) cannot produce suspects: a ticket lost in a power-cycled buffer there is not detected — the print-config page recommends LAN printers with status, and the Pass / KDS reprint covers it by hand.
- **`ReprintTicket { ticket_id? , order_id? }`** (exactly one): station session → own station's tickets (by `order_id`, only its station's tickets of that order); staff → `reprint-ticket` (Cook has it by default, 03b B-1). Writes `TicketReprinted { order_id, station_id | null, ticket_ids }` → `reprint` jobs (live). Nothing live → `result.skipped`.
- **Where the button is:** KDS (`both` stations, own tickets); **Pass card** — registered through 03b's `registerPassCardAction` slot from 03c's own folder, shown when `order-tickets` reports a ticket with `has_printer`, by order (`reprint-ticket`). Reprint on 02b's screens: 02b follow-up (R-6).

### 3.6 Rendering and ESC/POS

- `Doc = { width_cols?: 32 | 48, blocks: Array<{ text, size?, bold?, align? } | { rule } | { feed } | { cut } | { drawer }> }`; wrap to 32 / 48; long words break.
- Mapping: `—` `–` `−` → `-`; `×` → `x`; `·` → space; curly quotes → straight; then PC437; else `?`.
- Encoder (no library): `ESC @`, `ESC a n`, `ESC E n`, `GS ! n`, `GS V 66 0`, `ESC p 0 25 250`, `DLE EOT 1` / `DLE EOT 4` (Epson ESC/POS reference, checked 2026-11-11).
- Render at send: `buildLineDetails` (2 statements), ticket lines + `order_lines` units (1); an order no longer in the engine falls back to `order_lines` and config names. Empty `kitchen` / `first` / `cancel` → cancelled, not sent; `reprint` prints every live line.

### 3.7 Print worker and failure rules (R8, D3, D4)

- **Never blocks service:** no command waits; folds only insert, live only, never throw; network and USB I/O never run on the main thread's libuv pool.
- **One FIFO per printer**, advancing **at ack** (never waits for a status read). `test` jobs bypass the FIFO.
- **Send:** render and set `sent_at` in one synchronous step, then:
  - **LAN:** `net.Socket`, connect timeout 3 s, **hard write timer 10 s** from the first byte to `drain` (a `setTimeout` that is not reset by progress — `socket.setTimeout` is an idle timer and a slowly reading printer would never trip it); on expiry `destroy()` → failure path. Timeouts are injected (tests use a fake clock).
  - **USB:** one **child process per USB printer** (`apps/hub/src/print/transport/usb-child.ts`, `child_process.fork`) does the blocking device writes; the parent sends bytes over IPC and waits ≤ 10 s; on timeout it kills the child (`SIGKILL`) and respawns it → failure path. The hub process never opens the device.
- **Ack:** whole document flushed within the timeout → `acked_at`. Suspect marking: §3.5 only.
- **Status reads:** LAN only by default (USB only if its test print proved status), at most once per 10 s per printer, plus right after a failure and while the printer has an open `printer_problem`. Status timeout 2 s, never blocking the FIFO.
- **Failure before a full write:** `attempts + 1`, `last_error`, `is_reprint = 1` if any byte went out, `sent_at = NULL`; retry 2 s, 5 s, then every 10 s, no limit. (A removal folded while `sent_at` was set already queued a CANCELLED slip; the retry then prints the ticket without those units plus the slip — harmless.) Kitchen and slip jobs drain as their lines finish; `document` jobs wait or are cancelled by a manager.
- **`printer_problem`:** raised (dedupe `printer_problem:<printer_id>`) when the head job has failed for ≥ `printer_alert_ms` (30 000), a status error bit appears, or a `print_fold_skips` row names the printer's station; details `{ printer_name, problem }` (03b's D-2). Closed `done` at the next ack with clean **or unknown** status; `obsolete` on archive or when nothing is pending and the status is clean or unknown.
- **Restart (F §5.8 step 5):** 03c registers `registerBootStep('5', resumePrintQueue)` (existing 00 hook, `lib/boot.ts:58-68`, no 00 code change): `sent_at` set and `acked_at` null → `is_reprint = 1, sent_at = NULL`. Row **H-11** covers only the one 00 code change: start the print worker **after listen** (`lib/boot.ts` after `:208`). The worker drains in `created_at` order.
- **Writes outside transactions:** `print_jobs`, `printer_runtime`, `print_fold_skips` updates by the worker are plain statements between transactions; never events, never synced.
- **Cost:** idle loop ≤ 2 statements + 1 per dark station.

### 3.8 `printed` tag on screens

Catch-up part `kds_printed` (station sockets: its station; Pass sockets: their point's stations) `{ order_item_ids }` of printed tickets with lines in Now (1 statement), and frame `printed_lines { station_id, order_item_ids }` after each ack of a `kitchen` / `reprint` job. 03c registers the tag through 03b's `registerLineTag` slot (D12).

### 3.9 Print API for 05

`printDocument(tx, printer_id, doc, meta?: { kind_label: string })` → a `document` job in the caller's transaction; unknown / archived → `404 PRINTER_NOT_FOUND`. Drawer kick = a `Doc` with `{ drawer: true }`. Preview: `renderText(doc, width)`.

### 3.10 Permissions

| Action | Station session | Staff session | Admin session |
|---|---|---|---|
| `ReprintTicket` | own station's tickets | `reprint-ticket` (`branch`) | — |
| `GET /queries/order-tickets` | — | `reprint-ticket` | — |
| `SavePrinter`, `SetStationOutput` (`/admin/commands/`), `POST /admin/print/test`, `POST /admin/print/jobs/:job_id/cancel`, `GET /admin/queries/print-config`, `GET /admin/queries/print-queue` | — | — | `manage-devices` |

---

## §4. Contracts

### 4.1 Consumes

| From | What |
|---|---|
| 03b | `stationPresence`, `buildLineDetails`, `pointOfLine`, `devicePoint`, `LineDetail`, KDS / Pass clients, D-2 detail fields |
| 03a | `stationView`, `stationPlan`, events |
| 02b | `order_lines`, `orders`, events |
| 01d | `defineAlertKind`, `alerts.raise` / `close`, `printer_alert_ms` (D-3) |
| 01a | `branchConfig()`, `engine_settings.kds_offline_ms` (via 03b) |
| 00 | §2; `lib/boot.ts` step 5 hook (H-11) |
| 04 | `ItemVoided` |

### 4.2 Exposes

| Export | Shape | Statements | Used by |
|---|---|---|---|
| `printDocument(tx, printer_id, doc, meta?)` | `{ job_id }` | 2 | 05 |
| `renderText(doc, width_cols)` | `string` | 0 | 05 preview |
| `Doc` type | §3.6 | — | 05 |

### 4.3 Carried to other modules

| To | Requirement |
|---|---|
| 05 | Bills, receipts and Z through `printDocument` in the bill-close transaction; template and preview (R12); printer choice from 03c's list; a receipt printer outage never blocks bill close (R8). With no printer attached, 05 decides what the customer gets (screen / no paper). |
| 02b | Reprint on order-taker / cashier screens (follow-up, R-6). |
| 07 | Reprint counts from `TicketReprinted`; print history is hub state, not events. |
| 01e | A station with buttons and no screen: mode `printer`. |

### 4.4 Changes to other specs (R26) — *Proposed — needs approval*; applied with 03b's rows, one bump per target (03b §4.5 note, task 0d)

| Row | Target → version | Change | Why |
|---|---|---|---|
| F-1 | Foundation → **v1.12** §5.8 | `print_jobs` DDL replaced by §5; step 5: sent-not-acked → `is_reprint = 1`, `sent_at = NULL`, re-send in order; ack = D4 (flushed within timeout; suspect recovery). D24 kept. | D2, D4 |
| F-2 | Foundation → **v1.12** OQ14 | Answered (P14): USB via a child process and a udev symlink, LAN preferred, no library. | P14 |
| H-11 | 00 → **v1.9** (with 03b's H-9, H-10) + code (`apps/hub/src/lib/boot.ts`, R-4) | Start the print worker after listen. Resume uses the existing `registerBootStep('5')` (no change). | §3.7; check n-4 |
| D-3 | 01d → **v1.2.2** (with 03b's D-2; code in 03b task 0c) | `ALERT_CONSTANTS.printer_alert_ms = 30_000`. | §3.7 |
| Q-1 | 02b → **v1.0.4** §4.3 To 03b (text; v1.0.3 is already APPROVED, 2026-11-10) | "a CANCELLED slip for every `ItemRemoved` on a fired line" → "… on a fired line **whose ticket was printed** (03c §3.3)"; "03b" → "03c" for ticket rows. | run 2 m-14 |

---

## §5. Data model (hub SQLite)

Migration `apps/hub/src/db/migrations/NNNN_print.sql`.

```sql
-- print_config projection (reset): PrinterSaved, StationOutputSet
CREATE TABLE printers (
  printer_id TEXT PRIMARY KEY, name TEXT NOT NULL,
  connection TEXT NOT NULL CHECK (connection IN ('lan','usb')), address TEXT NOT NULL,
  paper_width_mm INTEGER NOT NULL CHECK (paper_width_mm IN (58,80)),
  archived_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX printers_name_active ON printers (name) WHERE archived_at IS NULL;        -- CONFIG_NAME_TAKEN

CREATE TABLE station_outputs (
  station_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('screen','both','printer')),
  printer_id TEXT,
  show_taker INTEGER NOT NULL DEFAULT 1 CHECK (show_taker IN (0,1)),
  show_order_id INTEGER NOT NULL DEFAULT 1 CHECK (show_order_id IN (0,1)),
  CHECK (mode = 'screen' OR printer_id IS NOT NULL)
);
CREATE INDEX station_outputs_printer ON station_outputs (printer_id);                        -- CONFIG_IN_USE

-- worker-owned (plain statements)
CREATE TABLE printer_runtime (
  printer_id TEXT PRIMARY KEY,
  supports_status INTEGER CHECK (supports_status IN (0,1)),   -- NULL unknown; learned at test print / first LAN answer
  last_status TEXT, last_status_at INTEGER, last_clean_at INTEGER, last_ack_at INTEGER, last_error TEXT,
  problem_alert_id TEXT
);
CREATE TABLE print_fold_skips (
  event_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, order_ids TEXT NOT NULL,
  reason TEXT NOT NULL, at INTEGER NOT NULL, alerted_at INTEGER
);

-- kitchen_tickets projection (forward-only; jobs only live)
CREATE TABLE tickets (
  ticket_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, order_id TEXT NOT NULL,
  fire_event_id TEXT NOT NULL, fired_at INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('scheduled','early_fill','pulled'))
);
CREATE INDEX tickets_order ON tickets (order_id);                                             -- reprint by order, slips
CREATE INDEX tickets_station_fired ON tickets (station_id, fired_at);                         -- fallback per dark station
CREATE INDEX tickets_fired ON tickets (fired_at);                                             -- retention

CREATE TABLE ticket_lines (
  order_item_id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL, station_id TEXT NOT NULL, done_at INTEGER
);
CREATE INDEX ticket_lines_ticket ON ticket_lines (ticket_id);

CREATE TABLE print_jobs (                        -- F-1; hub state, never synced
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('kitchen','reprint','cancel','first','coming_up','document','test')),
  printer_id TEXT, station_id TEXT, ticket_id TEXT, order_id TEXT,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL, sent_at INTEGER, sent_printer_id TEXT, acked_at INTEGER, cancelled_at INTEGER,
  suspect_at INTEGER, suspect_resolved_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  is_reprint INTEGER NOT NULL DEFAULT 0 CHECK (is_reprint IN (0,1)),
  CHECK (printer_id IS NOT NULL OR station_id IS NOT NULL)
);
CREATE INDEX print_jobs_pending ON print_jobs (created_at) WHERE acked_at IS NULL AND cancelled_at IS NULL;  -- FIFO heads, boot
CREATE INDEX print_jobs_ticket ON print_jobs (ticket_id) WHERE ticket_id IS NOT NULL;                       -- printed / live-job checks
CREATE UNIQUE INDEX print_jobs_one_live_kitchen ON print_jobs (ticket_id)
  WHERE kind = 'kitchen' AND cancelled_at IS NULL;                                                          -- at-fire vs fallback never double
CREATE INDEX print_jobs_suspect ON print_jobs (station_id) WHERE suspect_at IS NOT NULL AND suspect_resolved_at IS NULL; -- recovery
CREATE INDEX print_jobs_acked_by_printer ON print_jobs (sent_printer_id, acked_at) WHERE acked_at IS NOT NULL AND suspect_at IS NULL; -- suspect marking
```

Retention at 00's maintenance hour: acked / cancelled jobs, tickets, ticket lines and resolved skips older than 7 days.

---

## §6. Commands, events, queries

**Common:** D32, no PIN, not queueable. Device commands `POST /commands/:name`; admin `POST /admin/commands/:name`; admin routes in the admin group.

### 6.1 `ReprintTicket` — `{ ticket_id? , order_id? }`; station / `reprint-ticket`. Result `{ ticket_ids, skipped }`. Statements 2. Errors `ORDER_NOT_FOUND`, `PERMISSION_DENIED`, `VALIDATION_FAILED`.
### 6.2 `SavePrinter` — admin; writes `PrinterSaved`. Statements 2. Errors `CONFIG_NAME_TAKEN`, `CONFIG_IN_USE`, `VALIDATION_FAILED`.
### 6.3 `SetStationOutput` — admin; `{ station_id, mode, printer_id, show_taker?, show_order_id? }`; writes `StationOutputSet`. Statements 1. Errors `STATION_NOT_FOUND`, `PRINTER_NOT_FOUND`, `VALIDATION_FAILED`.
### 6.4 `POST /admin/print/test` — `{ printer_id }`; outside the FIFO, ≤ 8 s. `{ printed, status, error }`; updates `printer_runtime`; a clean result triggers suspect recovery. Errors `PRINTER_NOT_FOUND`.
### 6.5 `POST /admin/print/jobs/:job_id/cancel` — Errors `404 PRINT_JOB_NOT_FOUND`, `409 PRINT_JOB_NOT_PENDING`.
### 6.6 `GET /admin/queries/print-config` — `{ printers, station_outputs, warnings: [{ station_id?, item_id?, kind: 'lossy_name' | 'fold_skipped' | 'suspect_waiting' | 'screen_unused' | 'no_screen' }] }`. Statements 4 (+ 03b's screen-station map, memory).
### 6.7 `GET /admin/queries/print-queue` — `{ printers: [{ printer_id, name, status, waiting, suspect, head_error, last_ack_at }], jobs: [...pending, newest 100] }`. Statements 2.
### 6.8 `GET /queries/order-tickets?order_id` — `reprint-ticket`. `{ tickets: [{ ticket_id, station_id, station_name, fired_at, printed, has_printer }] }` (`has_printer` = the station's current output has a printer). Statements 2.
### 6.9 Catch-up `kds_printed`, frame `printed_lines` — §3.8.
### 6.10 Kind `printer_problem`

```typescript
defineAlertKind({
  kind: 'printer_problem', family: 'action', subject: 'hub',          // { stream_type: 'hub', stream_id: branch_id }
  steps: [{ at: { ms: 0 }, to: [{ target: 'managers', set: 'recipient' }] }],
  closes_on: 'owner',
  values_schema: z.object({ printer_id: z.string().min(1), waiting: z.number().int().min(0) }),
  details_schema: AlertDetailsBase.pick({ printer_name: true, problem: true }),   // 03b D-2
  lead_fallback: true, expires_at_day_close: true, silent: false,
  labels: { card: 'alert.printer_problem.card', lock: 'alert.printer_problem.lock' }, request: null,
});                                                                   // dedupe 'printer_problem:' + printer_id
```

### 6.11 Events (`schema_version` 1)

| Event | Stream / id | Payload | Written by |
|---|---|---|---|
| `TicketReprinted` | order / order_id | `{ order_id, station_id \| null, ticket_ids }` | `ReprintTicket` |
| `PrinterSaved` | hub / branch_id | `{ printer_id, name, connection, address, paper_width_mm, archived }` | `SavePrinter` |
| `StationOutputSet` | hub / branch_id | `{ station_id, mode, printer_id \| null, show_taker, show_order_id }` | `SetStationOutput` |

WS frame `printed_lines` joins `WsServerMessage`.

---

## §7. Cross-cutting

| Item | Rule | Why |
|---|---|---|
| I/O isolation | LAN sockets with timeouts; USB in killable child processes | A stuck printer never blocks the hub (R8) |
| Timeouts | connect 3 s, write 10 s, status 2 s, test 8 s | Every failure reaches the alert |
| Address validation | private IPv4; `lp` device or `/dev/pos-printer-*` | No sockets to the internet, no arbitrary files |
| Logging | `print.sent`, `print.acked`, `print.suspect`, `print.failed`, `print.fold_skipped`, `print.fallback.*` | Install day, rush |
| Retention | 7 days, maintenance hour | Hub disk |
| No env var; no npm dependency | Node `net`, `child_process` only | YAGNI |

---

## §8. Client contract

- **Hub admin "Printers"** (`apps/client/src/features/admin/printers/`, admin session): printers (add, edit, archive, test), station outputs + toggles, print queue (cancel, suspects), warnings.
- **KDS** (03b's entry): Reprint on `both` stations' own tickets and the `printed` tag, both through 03b's slots from `apps/client/src/features/print/`.
- **Pass card** (03b's Pass screen): Reprint by order where `has_printer`, and the `printed` tag, through the same slots.

---

## §9. Error catalogue additions

| Code | HTTP | Details | When |
|---|---|---|---|
| `PRINTER_NOT_FOUND` | 404 | `{ printer_id }` | unknown or archived printer |
| `PRINT_JOB_NOT_FOUND` | 404 | `{ job_id }` | cancel of an unknown job |
| `PRINT_JOB_NOT_PENDING` | 409 | `{ job_id, state }` | cancel of an acked / cancelled job |

---

## §10. Tests (`apps/hub/test/print/*.test.ts`)

Tickets and slips
1. Golden bytes 32 / 48: item, child at another station, deal part, option child, kitchen note, order note, token with date, parking, RETURN with old item and table, FIRST; no prices / COMP / zone-served; mapping of `—` `×` `−`.
2. One fire, two orders → two tickets; `both` → two kitchen jobs in the same transaction; `screen` → none.
3. Partial removal of a printed line prints "- 1 x Naan  3 left" (02b run 4 M-5), whichever projection folds first; whole → whole-line CANCELLED; unprinted → no slip, ticket renders without the units.
4. Void of a printed, not-done line → CANCELLED; done → nothing.
5. Boost on a printed ticket at a `printer` station → FIRST; `both` / `screen` → none; a pull never yields FIRST.
6. Done before send → empty render → cancelled; then `UndoDone` during fallback → a new kitchen job `…:kitchen:2` prints.
7. 500 historical fires with no checkpoint → boot → tickets folded, 0 jobs; same after a restore.
8. Corrupt `station_outputs` or a fire id missing from `order_lines` → fire still commits; `print_fold_skips` row; `printer_problem { problem: 'ticket_not_built' }` at once at a `both` station; at a `screen` station with a printer only when it goes dark.
9. `ReprintTicket` from a KDS (own station only, by order → its station's tickets) and by a **Cook** on a Pass tablet (default grant); REPRINT header; current table; exited order prints from `order_lines`; `order-tickets` reports `has_printer`.
9b. **Render vs removal race:** fake printer whose connect is delayed; a removal committed after the render sees the ticket printed and queues the CANCELLED slip.
10. Projection registration order: 02b `orders` → 03b → 03c (boot assertion).
Worker
20. LAN fake printer: written + drained → acked; FIFO advances without waiting for status.
21. **LAN printer that stops reading** (and one that reads 1 byte a second): with an injected clock, the job fails at the hard 10 s timer, retries, `printer_problem` at 30 s.
22. **USB fake device that blocks writes:** the child is killed at the injected timeout and respawned; a PIN login on the hub **resolves** while the child is blocked (no latency number in the gate; latency is a manual check, task 28).
23. Two printers: one down never delays the other.
24. Restart with sent-not-acked → resent once with REPRINT.
25. **Suspect window:** clean read → 3 jobs acked → paper-end read → all 3 suspect; **no clean read yet** (new printer) → jobs acked → paper-end read → all suspect; clean read 2 s after an ack → that job stays inside the window and turns suspect on a paper-end read 5 s later; status clean again → one REPRINT per ticket with a live line (a done line's ticket is not reprinted); a suspect CANCELLED slip comes back as a CANCELLED slip; two suspects on one ticket → one recovery job.
26. Unknown-status printer: acks on flush; never suspect; alert closes on ack.
27. Test print bypasses a stuck head; a clean test triggers suspect recovery.
28. Stale `cancel` / `first` / `coming_up` cancelled when the printer returns.
29. Station output changed → pending station jobs follow; `document` stays; a `print_config` rebuild keeps `printer_runtime`.
30. Encoder bytes; partial write → retry with REPRINT.
Fallback
40. `screen` + printer, 03b marks dark: Now tickets + COMING UP; new fires print; screen back → stop; `printed_lines` tags.
41. Slow printer (5 s per job) during 10 s dark → one kitchen job per ticket.
42. Idle loop statements ≤ 2 + 1 per dark station.
Config and API
50. `SavePrinter` validation, names, archive in use; admin route only.
51. `SetStationOutput` `both` without printer → `VALIDATION_FAILED`.
52. Cancel job → `PRINT_JOB_NOT_FOUND` / `PRINT_JOB_NOT_PENDING`.
53. `printDocument` in a caller's transaction; rolled back with it.
54. `printer_problem` registers at boot; its details survive append (D-2).

### Acceptance

| Story AC | Test |
|---|---|
| E3-PRT AC1 | 2, 51 |
| E3-PRT AC2 | 40, 41 |
| E3-PRT AC3 | 1, 20, 22, 30 |
| E3-PRT edges | 21, 22, 6, 24, 25 |
| E0-ORD AC4 | 9 |
| 02b To 03b ticket rows | 1, 3, 4 |

---

## §11. Build order (after 03b's hub tasks; one task per commit, TDD)

| # | Task | Files | Spec |
|---|---|---|---|
| — | Upstream rows: applied by 03b's tasks 0c (D-3 code) and 0d (every bump); none here. | — | §4.4 |
| 1 | Error codes | `packages/domain/src/errors.ts` | §9 |
| 2 | Events (3), `printed_lines` frame, `Doc` type | `packages/events/src/`, `packages/domain/src/print.ts` | §6.11, §3.6 |
| 3 | Migration | `apps/hub/src/db/migrations/NNNN_print.sql` | §5 |
| 4 | Projection `print_config` | `apps/hub/src/print/config-projection.ts` | §3.2 |
| 5 | `SavePrinter`, `SetStationOutput` | `apps/hub/src/print/commands/` | §6.2–6.3 |
| 6 | Kind `printer_problem` (module top level) | `apps/hub/src/print/kinds.ts` | §6.10 |
| 7 | Projection `kitchen_tickets`: tickets, live-only jobs, total fold, skips (registration line after 03b's in `lib/boot.ts`) | `apps/hub/src/print/tickets-projection.ts`, `apps/hub/src/lib/boot.ts` | §3.3 |
| 8 | Slips (cancel, first), kitchen re-create ids | same | §3.3, §3.5 |
| 9 | `ReprintTicket` | `apps/hub/src/print/commands/` | §3.5 |
| 10 | Doc, mapping, `renderText`, ticket / slip / coming-up builders | `apps/hub/src/print/render/` | §3.3, §3.6 |
| 11 | ESC/POS encoder | `apps/hub/src/print/escpos.ts` | §3.6 |
| 12 | LAN transport + fake printer | `apps/hub/src/print/transport/lan.ts` | §3.7 |
| 13 | USB child process transport + blocking fake device | `apps/hub/src/print/transport/usb-child.ts`, `usb.ts` | §3.7 |
| 14 | Worker: FIFO, synchronous render + `sent_at`, ack, timeouts, retry, stale / empty cancel | `apps/hub/src/print/worker.ts` | §3.7 |
| 15 | Status reads, suspect marking and recovery, `printer_problem` raise / close, skip alerts | `apps/hub/src/print/status.ts` | §3.5, §3.7 |
| 16 | `resumePrintQueue` via `registerBootStep('5')`; H-11 worker start after listen | `apps/hub/src/print/boot.ts`, `apps/hub/src/lib/boot.ts` | §3.7 |
| 17 | Paper fallback over `stationPresence()` | `apps/hub/src/print/fallback.ts` | §3.4 |
| 18 | `printDocument` | `apps/hub/src/print/api.ts` | §3.9 |
| 19 | Admin routes test / cancel | `apps/hub/src/print/routes.ts` | §6.4–6.5 |
| 20 | Queries print-config, print-queue, order-tickets | `apps/hub/src/queries/` | §6.6–6.8 |
| 21 | `kds_printed` catch-up + `printed_lines` frame | `apps/hub/src/ws/print-catch-up.ts` | §3.8 |
| 22 | Retention | `apps/hub/src/print/retention.ts` | §5 |
| 23–25 | Hub admin Printers page: printers + test, outputs, queue + suspects | `apps/client/src/features/admin/printers/` | §8 |
| 26 | `printed` tag through 03b's line-tag slot | `apps/client/src/features/print/` | §8 |
| 27 | Reprint action through 03b's slots (KDS, Pass card) | `apps/client/src/features/print/` | §8 |
| 28 | Manual checks on real printers: LAN + USB, cut, PC437, udev symlink, paper out mid-rush → suspect reprint, pull a KDS cable → fallback, restart mid-print | `docs/plans/03c-manual-checks.md` | §3 |

≈ 28 tasks.

---

## §12. DoD, checklist, questions, closure

### 12.1 Definition of Done

Gate green; every §10 test passes; §12.2 ticked; §4.4 bumps approved and applied; manual checks (task 28) on the pilot printers if the pilot attaches any; README 03c row → Implemented.

### 12.2 Endpoint checklist

| # | Unit | Session · permission | Statements | Test |
|---|---|---|---|---|
| 1 | `ReprintTicket` | station / `reprint-ticket` | 2 | 9 |
| 2 | `SavePrinter` | admin · `manage-devices` | 2 | 50 |
| 3 | `SetStationOutput` | admin · `manage-devices` | 1 | 51 |
| 4 | `POST /admin/print/test` | admin · `manage-devices` | 2 | 27 |
| 5 | `POST /admin/print/jobs/:id/cancel` | admin · `manage-devices` | 1 | 52 |
| 6 | `print-config` | admin | 4 | 50 |
| 7 | `print-queue` | admin | 2 | 23 |
| 8 | `order-tickets` | `reprint-ticket` | 2 | 9 |
| 9 | `kds_printed` + `printed_lines` | station / point staff | 1 | 40 |
| 10 | Kind `printer_problem` | — | — | 54 |
| 11 | Projections ×2 | — | ≤ 3 reads / event | 2–8 |
| 12 | Worker / fallback | — | ≤ 2 + 1 per dark station | 42 |

### 12.3 Open questions

| # | Question | Owner |
|---|---|---|
| OQ-C1 | Does the pilot (Arif Chatkhara) attach any kitchen printer at go-live? If none, task 28 runs on a bench printer and 03c can ship after the pilot's first weeks, before 05's receipts. | Owner |

### 12.4 Run 2 closure (printing part of `03b_v0.2_hostile_run2.md`)

| Finding | Resolution |
|---|---|
| M-1 no write timeout; USB blocks the thread pool | Fixed: 10 s write timeout, LAN `setTimeout` / `destroy`, USB in a killable child process (§3.7, D3); tests 21, 22. |
| M-2 ack into a printer in error loses tickets | Fixed: suspect jobs + automatic REPRINT on recovery (§3.5, D4, R-5); unknown-status limit stated; test 25. |
| M-3 `printer_problem` details stripped | Fixed via 03b's D-2; `pick({ printer_name, problem })`; test 54. |
| m-1 unknown status never clean | Fixed: "clean or unknown" (§3.7); test 26. |
| m-2 cancelled kitchen job blocks re-print; silent skipped fold | Fixed: unique index on uncancelled only + `:kitchen:n` ids; `print_fold_skips` + alert (§3.3); tests 6, 8. |
| m-9 admin paths, route group | Fixed: `/admin/commands`, `/admin/print/*` in the admin group, `/admin/queries` (§3.10). |
| m-11 `lib/boot.ts` not listed | Fixed: row H-11, task 16 (approved by R-4). Kind (task 6) before worker (14–15). |
| m-12 no reprint for printer stations | Fixed: Pass card reprint (§3.5, task 27; R-6). |
| m-13 FIFO waits for status | Fixed: advances at ack; status throttled (§3.7). |
| m-14 CANCELLED "every removal" | Fixed: row Q-1 (02b v1.0.3). |
| m-15 slip units source, registration order | Fixed: payload `units ?? null`, units left at send; order asserted (test 10). |
| n-4 pull and FIRST | Fixed: stated in P9. |
| n-7 partial-write slip | Stated (§3.7). |
| n-8 fallback step 4 | Fixed: one query per loop (§3.4). |
| n-12 retention / per-station cost | Fixed: `tickets_fired` index; cost stated (§3.7). |
| Run 1 printing rows left "partly" (M-3 total fold, M-6) | Closed by m-2 and M-1 / M-2 above. |

### 12.5 Targeted check closure (`03b_v0.3_03c_v0.1_targeted_check.md`, verdict FIX) — 03c part

| Finding | Resolution |
|---|---|
| M-3 suspect window misses paper-out between reads | Fixed: `last_clean_at`, every job acked since it turns suspect on a bad read (§3.1, §3.5, D4); test 25. |
| m-5 version collisions | Fixed: Q-1 → 02b v1.0.4; D-3 and H-11 ride 03b's 01d v1.2.2 / 00 v1.9 bumps (one bump per target, 03b task 0d); 03c tasks 0a, 0b dropped. |
| m-6 Pass reprint for the Cook; printer flag | Fixed: Cook default via 03b B-1; `order-tickets.has_printer` (§6.8); test 9. |
| m-7 timing asserts | Fixed: injected clock and timeouts; test 22 asserts the login resolves, latency is a manual check. |
| m-9 skip at a `screen` station with a printer | Fixed: skips recorded at any station with a printer; alerted when it prints at fire or when the station is dark (§3.3); test 8. |
| m-10 editing 03b's client folders | Fixed: 03b's slots (D12, §8, tasks 26–27 in `features/print/`). |
| n-4 H-11 overstated | Fixed: resume via `registerBootStep('5')`; H-11 = worker after listen only. |
| n-5 idle vs hard timer | Fixed: hard timer from first byte (§3.7); test 21 slow reader. |
| n-6 lost tests / lines | 03c part fixed: render vs removal race (test 9b), `print_config` rebuild keeps runtime (test 29), D8, pending jobs follow the printer (§3.2), To 07 row (§4.3), station session reprint by order (§3.5). |
| n-9 suspect recovery kind / duplicates | Fixed: same kind, one recovery job per ticket (§3.5); test 25. |
| M-1, M-2, m-1–m-4, m-8, m-11, m-12, n-2, n-3, n-7, n-8, n-10 | 03b v0.4 §12.7. |

### 12.6 Re-check closure (`03b_v0.4_03c_v0.2_recheck.md`) — 03c part

| Finding | Resolution |
|---|---|
| M-3 partly (two suspect rules; NULL window) | Fixed as N-1. |
| N-1 Ack line + NULL `last_clean_at` | Fixed: Ack points to §3.5; `COALESCE(last_clean_at, 0)` (§3.5, §3.7); test 25. |
| N-3 screen mode, printer, no KDS | Fixed: `no_screen` warning (§3.2, §6.6). |
| N-8 clean read during buffer drain | Fixed: clean read sets `last_clean_at = now − 10 s`, never backwards (§3.5); test 25. |
| N-2, N-4–N-7 | 03b v0.4.1 §12.8. |

