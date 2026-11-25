# Client e2e baseline (Playwright, `apps/client/e2e`)

Owner rulings 2026-11-24 **#3** (seed every paired device with the 05a profile its spec expects; full re-run on all
five projects; triage each failure as app bug or stale test) and **#5** (find and fix the state that leaks into the flaky
Undo test; the takeaway specs green 5 times in full-suite order). Branch `claude/e2e-seed-baseline`, from
`claude/gracious-hawking-9670fy` at `e66c15fc`.

Runs: `TMPDIR=/dev/shm PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm --filter @pos/client exec playwright test --trace off`
after `pnpm --filter @pos/client build`, one worker, all five projects, 370 tests. Skips are the specs' own
`test.skip` project gates (unchanged: 134 before and after). Nothing was skipped, deleted or weakened to get green.

## Before → after

| Project | Before (pass/fail/skip) | After (pass/fail/skip) |
|---|---|---|
| tablet-landscape | 22/38/14 | 60/0/14 |
| tablet-portrait | 14/25/35 | 39/0/35 |
| kiosk | 38/23/13 | 61/0/13 |
| phone-390 | 12/29/33 | 41/0/33 |
| phone-360 | 13/22/39 | 35/0/39 |
| **Total** | 99/137/134 | 236/0/134 |

Failures per spec and project (before → after; "–" = the spec does not run there; last two columns pass/fail/skip):

| Spec | tablet-landscape | tablet-portrait | kiosk | phone-390 | phone-360 | Before total | After total |
|---|---|---|---|---|---|---|---|
| 02a-busy.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02a-call.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02a-handover.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02a-map.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02a-offline.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02a-tables.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02b-bill.spec.ts | 0 | 0 | 0 | 0 | 0 | 10/0/0 | 10/0/0 |
| 02b-comp.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02b-idle.spec.ts | 0 | 0 | 0 | 0 | 0 | 10/0/0 | 10/0/0 |
| 02b-open-orders.spec.ts | 2 → 0 | 2 → 0 | 0 | 2 → 0 | 2 → 0 | 2/8/0 | 10/0/0 |
| 02b-order.spec.ts | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 2 → 0 | 0/10/0 | 10/0/0 |
| 02b-parking.spec.ts | – | – | – | 2 → 0 | 2 → 0 | 0/4/6 | 4/0/6 |
| 02b-queue.spec.ts | 0 | 0 | 0 | 0 | 0 | 20/0/0 | 20/0/0 |
| 02b-takeaway.spec.ts | – | – | 0 | – | – | 2/0/8 | 2/0/8 |
| 02b-tk-flows.spec.ts | – | – | 0 | – | – | 8/0/32 | 8/0/32 |
| 02b-tk-handover.spec.ts | 1 → 0 | – | 0 | – | – | 15/1/24 | 16/0/24 |
| 02b-zone.spec.ts | 0 | 0 | 0 | 1 → 0 | 0 | 19/1/0 | 20/0/0 |
| 03b-admin.spec.ts | 4 → 0 | – | – | 4 → 0 | – | 0/8/12 | 8/0/12 |
| 03b-kds.spec.ts | 2 → 0 | – | 2 → 0 | – | – | 0/4/6 | 4/0/6 |
| 03b-pass-takeover.spec.ts | 2 → 0 | 2 → 0 | – | – | – | 0/4/6 | 4/0/6 |
| 03b-pass.spec.ts | 2 → 0 | 2 → 0 | – | – | – | 0/4/6 | 4/0/6 |
| 03b-takeover.spec.ts | 2 → 0 | – | 2 → 0 | – | – | 0/4/6 | 4/0/6 |
| dl-deeplinks.spec.ts | 7 → 0 | 3 → 0 | 3 → 0 | 4 → 0 | 2 → 0 | 8/19/28 | 27/0/28 |
| smoke.spec.ts | 0 | 0 | 0 | 0 | 0 | 5/0/0 | 5/0/0 |

Intermediate run after the seed commit only: 212 passed, 24 failed, 134 skipped (triaged below).

## Step 1 — the seed (`6891935e`)

The global setup paired devices with `pairDevice(...)` and no profile, so the hub sent `device: { screens: [], access:
'everyone' }`: the shell landed on `#/inbox`, 05a R-1 masked every session as `everyone` (no `/admin/auth`, no
`manage-devices`, no money answers). Each device now gets a `DeviceProfileSet` through the writer (test-hub
`appendDeviceProfile`, the event `SetDeviceProfile` appends; the projection and the in-memory `deviceProfile` map see it;
the seed writes its other state as events the same way). Screens are the 05a §5.3 sets of the hardware.

| Device | Access | People | Screens | Why (its specs) |
|---|---|---|---|---|
| Tablet e2e | `listed` | Ali, Owner, Manager | dine_in, takeaway, parking, cashier, manager | Ali's floor flows; the Owner's takeaway counter (02b-TK); the Manager's hub admin (03b admin, `/admin/auth` needs a listed device) |
| Tablet e2e 2 | `listed` | Manager, Ali, Sara, Bilal | as above | the Manager approves (02a busy, 02b comp / order, dl): money answers need a listed device (05a §3.9) |
| Tablet e2e 3 | `everyone` | – | as above | Bilal / Sara set-up (dl), no approvals: a shared floor tablet |
| Kiosk e2e | `listed` | Ali, Owner, Manager | takeaway, parking, dine_in, cashier, manager | the counter flows; dl t1 has the Manager answer a void from the kiosk |
| Ali phone | `listed` | Ali | dine_in, takeaway, parking, manager | §5.3 (phone → its owner) |
| Kitchen e2e | `everyone` | – | tablet set | 02b-TK set-up (Owner reads, Cook runs the Pass / kitchen commands) |
| Pass tablets (`pass:<key>`) | `everyone` | – | pass, with the run's point | 03b Pass flows (`pass` ⇔ `point_id`, M-6) |

Kitchen screens (`kds`) keep no profile (05a M-3).

## Step 2 — the 24 failures left after the seed

None was an app bug. All were test-side: stale against a later approved spec, or a test race / leaked hub state.

| # | Spec · projects | Cause | Class | Fix |
|---|---|---|---|---|
| 1 | 03b-kds, 03b-takeover · landscape, kiosk (8) | `ApprovePairingRequest` → `400 VALIDATION_FAILED`: 05a v1.0 §6.3 made `device_name` (1–40) required; each failed approval left a code on `/pair`, so the later runs hit "Too many new codes from this screen" | **Stale test** (05a v1.0 §6.3, approved 2026-11-23) | `38930201`: `pairKdsScreen` sends a device name |
| 2 | 02a-busy, 02b-order · portrait, kiosk, phone-390 (11) | The Manager's tap on the aria-disabled "Take order — Ali is ordering" was a forced click at the button's point; 01d v1.3.3 §3.13.6a K-1 puts alert banners above route sheets, so the click landed on a banner (the seeded kitchen screens' `kds_offline` alerts, raised for managers once a live-clock flow such as dl #5 has run; before the seed the Manager's session was masked and got none). Confirmed with `elementFromPoint` at the click point | **Stale test** (01d v1.3.3 §3.13.6a K-1, approved 2026-11-18) | `884ea14d`: a dispatched click; it still checks that the drawn-off button answers a tap with TableBusy |
| 3 | 02b-queue "queue log: a reloaded entry" · landscape (2); 02b-zone "zone refill" · phone-390 (1) | Test race: since 05a C-1 the shell lands on the last tab / first screen when the session read answers, after the PIN pad has gone; `signInOn` returned at the pad, so a hash set at once (`#/queue`, `#/zones`) was sometimes sent back by the landing (log "element detached", row not found). Passed alone, failed in the full run | **Stale helper** (05a v1.0.6 §8 C-1 landing) | `0874964c`: `signInOn` and the dl sign-in wait for the inbox read the shell sends right after that navigation (`landing()` in 02a-support) |
| 4 | dl "zone banner → #/zones" · phone-390 (1) | Expected the phone's Orders tab marked on `#/zones` (01d m1, fixed phone tabs). 05a C-1: tabs are the profile's screens; `#/zones` is no screen's route, so the tab the person was on stays marked (Dine in) | **Stale test** (05a v1.0 §4.5 C-1, §8, approved 2026-11-23) | `6b7d4856`: asserts Dine in (`#/tables`) |
| 5 | 02b-tk-handover "Hand over, Undo within 5 s" · landscape, en (1) | The flake, below | **Test isolation** (leaked hub state + helper race) | `3d0018d5` |

Real app bugs found: **none**. No hub or spec change needed.

## Step 3 — the flaky Undo test (ruling #5)

- **Symptom:** `payCash` waits for "Next customer" until the 90 s timeout. The failure snapshot shows the pay panel
  still open with "Payment didn't go through · Open your shift to take money" (`SHIFT_NOT_OPEN`), the token still Due
  — the panel never reached Paid; it did not close by itself.
- **Leaked state:** the hub's **open shift**. Only the first test of a run that pays on a device opens the Owner's shift
  there; every later test finds it open. In the full suite that is this test on tablet-landscape (02b-tk-flows runs on
  the kiosk only), which is why it was the one that flaked, and why it failed only as the first test on a fresh hub.
- **Race:** `shiftOpen` checked "Open your shift" once, as soon as `<main>` existed. While the shift screen was still
  reading the shift, the check was false, so no shift was opened and the payment was refused. Tracing (and any page
  listener) slowed the page enough to hide it.
- **Other suspects checked:** the 5 s undo timer and the pagehide flush (no MarkServed from an earlier test reached the
  failing one; the request log shows none), drafts (IndexedDB is per browser context, fresh per test), token numbers
  and open orders (shared, but every spec finds its own token by number), ports (one hub, one worker).
- **Fix:** `shiftOpen` waits for the shift screen's answer (the open form, or the open shift's state chip) before it
  decides.
- **Evidence:** fresh-hub runs of the test alone: before 1 of 6 failed (and 1–2 of 12 with `--repeat-each 6`), after
  0 of 6 and 12 of 12. The takeaway specs (02b-queue, 02b-takeaway, 02b-tk-flows, 02b-tk-handover) in full-suite order
  on all five projects, 5 consecutive runs: **46 passed, 0 failed, 64 skipped each time**.

## Known limits (not failures)

- The shared hub keeps run-wide state by design (one hub per run, 02 W0.7): open shifts, tokens, `kds_offline` alerts
  after a live-clock flow, open orders. Specs take their own tables / stations / tokens; the fixes above make the
  helpers wait for what they read instead of assuming a clean hub.
- `pnpm test:perf`, printer and hardware checks are out of scope here (CLAUDE.md).
