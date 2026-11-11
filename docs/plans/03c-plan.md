# 03c Printing — Implementation Plan (spec v1.0)

> Same rules, branch, CI, board and prompts as `docs/plans/03b-plan.md` (read its "Global rules", "Hub API names" and "Markers" first). Exact names: `docs/plans/03b-03c-gaps.md` §1. 03c shares **phase 0** with 03b (P0.2 D-3, P0.6 codes, P0.7 `Doc`, P0.8 events / `printed_lines`, P0.9 migration `0015_print.sql`, P0.10 `printer_problem` with `{ target: { kind: 'managers' } }` (G-14), P0.11 `print/contracts.ts`, `print/lanes/C1–C4.ts`, `registerPrint` in `server.ts`, `registerPrintProjections` after 03b's, `print/boot.ts` `registerPrintBootSteps()` called from `main.ts` (boot step 5), the worker start / stop next to `startTickLoop` in `lib/boot.ts`, the retention call in `auth/session-sweeper.ts` `purge()` (G-7, G-8), P0.12 print fixtures, P0.13 bumps). Commits `feat(03c): … [03c §x]`.

**Goal:** 03c v1.0.2 on the hub: printer config, kitchen tickets (forward-only, live-only jobs, total fold), slips, suspect recovery, paper fallback for dark screens, reprint, ESC/POS + LAN + USB child process, the print worker, `printer_problem`, `printed` tag data, print API for 05. Clients after the design handoff.

**Spec:** `docs/specs/03c_Printing_Spec_v1.0.2.md` (APPROVED 2026-11-11; v1.0.1 = v1.0 + the gap-sweep wording G-7, G-8, G-14, owner 2026-11-11; v1.0.2 = v1.0.1 + wording only, AD-15; "§x", tests "#n"). The pilot attaches kitchen printers (OQ-C1), so 03c is needed before go-live; manual checks run on the pilot's printers.

## 03c lanes

| Lane | Task | What | Spec | Files (own) | Tests first | Needs | Marker |
|---|---|---|---|---|---|---|---|
| **C1** config & tickets | c4 | Projection `print_config` (`projections.register`, `reset`) | §3.2, §5 | `print/config-projection.ts`, `print/lanes/C1.ts` | rebuild = live; rebuild keeps `printer_runtime` (#29 half) | — | — |
| | c5 | `SavePrinter`, `SetStationOutput` (admin) | §3.2, §6.2–6.3 | `print/commands/printer.ts`, `print/commands/station-output.ts` | #50, #51 | c4 | — |
| | c7 | Projection `kitchen_tickets` (`projections.register`, no `reset`; jobs only when `mode === 'live'`, never in `'catchup'`): tickets, **live-only** at-fire jobs, total fold, `print_fold_skips` | §3.3 | `print/tickets-projection.ts` | #2, #7, #8, #10 | c4 | HIGH |
| | c8 | Slips (cancel with `units ?? null`, first), kitchen re-create ids (`:kitchen:n`) | §3.3, §3.5 | same file (lane-owned) | #3, #4, #5, #6 | c7 | HIGH |
| | c9 | `ReprintTicket` (`stationScoped`, `reprint-ticket`) + `order-tickets` query (`has_printer`; `reprint-ticket` checked inside `handle`) | §3.5, §6.1, §6.8 | `print/commands/reprint.ts`, `queries/order-tickets.ts` | #9 | c7 | — |
| **C2** render | c11 | ESC/POS encoder + character mapping | §3.6 | `print/escpos.ts`, `print/lanes/C2.ts` | #30 (bytes), mapping table | — | — |
| | c10 | `Doc`, `renderText`, ticket / slip / coming-up builders (uses 03b `buildLineDetails`) | §3.3, §3.6 | `print/render/` | #1 (golden bytes 32 / 48) | c11, b11 | — |
| **C3** transport & worker | c12 | LAN transport: connect 3 s, hard write timer 10 s, injected clock | §3.7 | `print/transport/lan.ts`, `print/lanes/C3.ts` | #21 (stall, 1 byte / s) | — | HIGH |
| | c13 | USB child process transport (`fork`, IPC, kill at timeout, respawn) | §3.7 | `print/transport/usb.ts`, `print/transport/usb-child.ts` | #22 (login resolves while blocked) | — | HIGH |
| | c14 | Worker: FIFO per printer, synchronous render + `sent_at` + `sent_printer_id`, ack, retry, stale / empty cancel, document jobs | §3.5, §3.7 | `print/worker.ts` | #9b, #20, #23, #24, #28, #29 | c10, c12, c13, c7 | HIGH |
| | c15 | Status reads, suspect marking (`COALESCE`, `now − 10 s` clear), recovery (same kind, one per ticket), `printer_problem` raise / close (inside `deps.writer.run` with `alerts.tickCtx(tx, now)`; `closeMany(ctx, [{ alert_id, reason }])`), skip alerts | §3.5, §3.7 | `print/status.ts` | #25, #26, #27 | c14 | HIGH |
| | c16 | `resumePrintQueue` (boot step 5, inside P0.11's `registerPrintBootSteps()`), worker start / stop after listen (fills the P0.11 no-op hooks; no edit of `main.ts` or `lib/boot.ts`) | §3.7 | `print/boot.ts` | #24 restart path end to end | c14 | HIGH |
| **C4** fallback & API | c17 | Paper fallback over 03b `stationPresence()` | §3.4 | `print/fallback.ts`, `print/lanes/C4.ts` | #40, #41, #42 | b20, c7, c14 | HIGH |
| | c18 | `printDocument` | §3.9 | `print/api.ts` | #53 | c14 | — |
| | c19 | Admin routes `/admin/print/test` (FIFO bypass), job cancel (`config: { group: 'admin' }`; `manage-devices` checked in the handler) | §6.4–6.5 | `print/routes.ts` | #27 (test half), #52 | c14, c15 | — |
| | c20 | Queries `print-config` (warnings incl. `no_screen`, `lossy_name`), `print-queue` (`manage-devices` checked inside `handle`) | §6.6–6.7 | `queries/print-config.ts`, `queries/print-queue.ts` | warnings per kind; statement counts | c5, c15, b6 | — |
| | c21 | Catch-up `kds_printed` (`registerCatchUp`) + frame `printed_lines` | §3.8 | `ws/print-catch-up.ts` | after ack the KDS / Pass socket gets the ids | c14 | — |
| | c22 | Retention (7 days, maintenance hour; called from `session-sweeper.ts` `purge()` by P0.11's line, G-8) | §5 | `print/retention.ts` | old acked / cancelled rows deleted, live rows kept | c7 | — |

**03c hub: 18 lane tasks** (+ phase 0 shared with 03b).

## 03c client — BLOCKED on the design handoff

| Lane | Tasks | Files | Spec |
|---|---|---|---|
| CU1 | Hub admin "Printers": printers + test, outputs, queue + suspects + cancel, warnings | `apps/client/src/features/admin/printers/` | §8 |
| CU2 | `printed` tag and Reprint action through 03b's slots (KDS, Pass card) | `apps/client/src/features/print/` | §3.5, §3.8, D12 (needs BU1 slots) |

## Close

`docs/plans/03c-manual-checks.md` (03c task 28: LAN + USB, cut, PC437, udev symlink, paper out mid-rush → suspect reprint, pull a KDS cable → paper fallback, restart mid-print) — **on the owner's machine with the pilot's printers**, never in the cloud. Acceptance map in the board with 03b's Z1.

## Self-review (writer, 2026-11-11)

- **Coverage:** 03c §11 tasks 1–3, 6, 0a, 0b → phase 0; 4–5, 7–22 → C1–C4; 23–27 → CU1–CU2; 28 → close. Every §10 test 1–54 named in a row.
- **Cross-module needs are explicit:** b11 (render), b20 (fallback), b6 (screen map for `no_screen`).
- **Gap sweep (2026-11-11):** rulings G-7, G-8, G-14 patched into the phase 0 note and c7, c9, c15, c16, c19–c22; names per `03b-03c-gaps.md` §1.
