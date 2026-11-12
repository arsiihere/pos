# 03c manual checks (03c §11 task 28)

Hand checks for 03c Printing (spec `docs/specs/03c_Printing_Spec_v1.0.5.md` §3.2–§3.7, §12.1). The owner runs them on his own machine and the mini PC, **with the pilot's own printers** (OQ-C1: the pilot attaches kitchen printers). They never run in the cloud or in CI. Nothing here is run or ticked by the build.

How to fill it in: tick `[x]` when the step behaves as written. When it does not, leave `[ ]` and write what you saw in **Notes**. Fill in the **Done by / date** line under each check.

How to report it: `tools/local/checks-report.sh <PR> docs/plans/03c-manual-checks.md` posts the filled-in list as a comment on PR `<PR>` (use the `module-03b` → `main` PR).

---

## 0. Before you start

### 0.1 What can run today

The hub half of 03c is built and green (acceptance map in `docs/plans/03b-status.md`). These are client lanes that are **not built yet**:

| Needs | Client lane | Checks that wait for it |
|---|---|---|
| Order-taker screen that sends orders (02b client) | 02b client | 3 (busy part), 5, 6, 7, 8 |
| KDS station screen (03b) | BU1 | 7 |
| Hub admin Printers page | CU1 | none: §0.4 uses the admin console instead |

Checks 1, 2, 3 (status part), 4 and 9 run now. Every blocked step is marked **BLOCKED (orders)** or **BLOCKED (BU1)** and written out in full, so it runs without rework later.

### 0.2 Build and deploy

As `03b-manual-checks.md` §0.2: deploy the head of `main` after the `module-03b` merge to `/opt/pos-hub`, `sudo systemctl start hub`, and check that `http://<hub>/health` answers.

### 0.3 Printers

| Name here | Hardware | Connection | Paper |
|---|---|---|---|
| **LAN-P** | the pilot's network kitchen printer (one that answers status, DLE EOT) | `lan`, e.g. `192.168.1.50:9100` (private IPv4; port 9100 by default) | 80 mm |
| **USB-P** | the pilot's USB kitchen printer | `usb`, first `/dev/usb/lp0`, then the udev symlink (check 2) | 58 or 80 mm |
| **USB-P2** | a second USB printer, if the pilot has one (check 2 swap test) | `usb` | any |

Keep spare paper rolls next to you (check 6).

### 0.4 The admin console helpers

Open `http://<hub>/admin` on the laptop, sign in as a Manager (`manage-devices`), open DevTools → Console and paste:

```js
q = async (name) => (await call('/admin/queries/' + name, { headers: headers() })).body;
c = (path, type, payload) => command(path, type, payload);
testPrint = async (printer_id) => (await call('/admin/print/test', { method: 'POST', headers: headers(), body: JSON.stringify({ printer_id }) })).body;
```

- Save a printer: `await c('save-printer', 'SavePrinter', { name: 'Tandoor', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80 })`. The answer's `result.printer.printer_id` is the id. Edit by passing `printer_id`.
- Station output: `await c('set-station-output', 'SetStationOutput', { station_id: '<id>', mode: 'printer', printer_id: '<id>' })` (`screen` | `both` | `printer`; `screen` + a printer = paper fallback). Station ids: `await q('stations')`.
- Test print (03c §6.4): `await testPrint('<printer id>')` → `{ printed, status, error }`, at most 8 s.
- Queue and printers: `await q('print-queue')` (status, waiting, suspect, head error, last ack, pending jobs). Config and warnings: `await q('print-config')`.

Read-only database look on the mini PC (install `sqlite3` once if needed):

```sh
hubsql() { sudo sqlite3 -readonly -header -column "$(jq -r .data_dir /etc/pos-hub/config.json)/hub.sqlite" "$1"; }
```

Example: `hubsql "select job_id, kind, sent_at, acked_at, cancelled_at, suspect_at, is_reprint, attempts, last_error from print_jobs order by created_at desc limit 20"`.

---

## Check 1. LAN printer: save, test print, cut, status (03c §3.2, §3.6, §3.7, §6.4)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Save LAN-P (§0.4). Then try `address: '8.8.8.8:9100'`. | First save → `PrinterSaved`; the printer is in `q('print-config').printers`. The public address → `400 VALIDATION_FAILED` (field `address`). | |
| [ ] | `await testPrint('<LAN-P id>')`. | Answer `{ printed: true, status: 'clean' }` within 8 s. The slip shows **TEST PRINT** (large), the printer name, the time (12-hour), a rule, `LAN  80 mm`, and the paper is **cut**. | |
| [ ] | `await q('print-queue')`. | LAN-P status `clean`. | |
| [ ] | Switch LAN-P off, test print again. | `{ printed: false, … }` with an error, within 8 s; the hub stays responsive. Switch it back on. | |

Done by / date:

## Check 2. USB printer, `lp` group and the udev symlink (03c §3.2, §3.7; review m-9)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | On the mini PC: `ls -l /dev/usb/lp*`, `id poshub`. If `poshub` is not in `lp`: `sudo usermod -aG lp poshub && sudo systemctl restart hub`. | The device is group `lp`; `poshub` is in `lp`. | |
| [ ] | Save USB-P with `connection: 'usb', address: '/dev/usb/lp0'` and the right paper width. `await testPrint('<USB-P id>')`. | The test slip prints and is cut (`USB  58 mm` or `80 mm`). | answer: |
| [ ] | Find the serial: `udevadm info -a -n /dev/usb/lp0 \| grep -m1 'ATTRS{serial}'`. Write `/etc/udev/rules.d/90-pos-printers.rules`: `SUBSYSTEM=="usbmisc", KERNEL=="lp*", ATTRS{serial}=="<serial>", SYMLINK+="pos-printer-tandoor", GROUP="lp", MODE="0660"`. Then `sudo udevadm control --reload && sudo udevadm trigger`. | `ls -l /dev/pos-printer-tandoor` points at the right `usb/lpN`. | |
| [ ] | Re-save USB-P with `address: '/dev/pos-printer-tandoor'` (pass its `printer_id`). Try `address: '/dev/sda'`. | Saved. `/dev/sda` → `400 VALIDATION_FAILED` (only `/dev/usb/lp[0-9]` or `/dev/pos-printer-…`). | |
| [ ] | If USB-P2 exists: add a second rule (`pos-printer-grill`), plug both in, reboot the mini PC, then swap their USB ports and reboot again. Test print each. | Each test prints on **its own** printer after both reboots (the symlink follows the serial, not `lp0` / `lp1`). | |

Done by / date:

## Check 3. USB test print proves status; `busy` during a job (03c §3.7, §6.4, C3-1)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Idle queue. `await testPrint('<USB-P id>')`. | `printed: true` and `status` either `clean` (the printer answered: status is proven and status reads are used for this printer from now on) or `unknown` (no answer: it never makes suspects, §3.5). Write down which. | status: |
| [ ] | Open the cover or take the paper out, test print again. | A printer that proved status answers with a bad status (`paper_end` or similar) and `printer_problem` opens for managers. An `unknown` printer: `printed` may still be `true`; no alert. | |
| [ ] | **BLOCKED (orders)**: set a station to `printer` on USB-P, send a large order (many lines) and run `await testPrint('<USB-P id>')` while the ticket is printing. | `{ printed: false, status: 'unknown', error: 'busy' }`: the test never opens the device while the worker's job uses it. The ticket prints completely. | |
| [ ] | **BLOCKED (orders)**: while a USB job is stuck (unplug USB-P in the middle of a job), sign in with a PIN on a tablet. | The login answers at normal speed (the USB write runs in a child process, 03c #22; latency is checked here by hand, not in the gate). After 10 s the job fails, retries 2 s, 5 s, then every 10 s; `printer_problem` after 30 s. Plug back in → it prints with **REPRINT** if a part had gone out. | login felt: |

Done by / date:

## Check 4. PC437 mapping; Urdu prints as '?' (03c §3.6, §3.2 `lossy_name`)

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Rename LAN-P to `Café Tandoor ½ — ×2` and test print. | The name prints as `Café Tandoor ½ - x2`: é and ½ come out right (PC437), `—` → `-`, `×` → `x`. | |
| [ ] | Rename LAN-P to `تندور` and test print. | It prints `?????` (one `?` per character), no garbage bytes, no crash. Rename it back. | |
| [ ] | In the owner app, give a menu item routed to a printer station an Urdu name; wait for the config apply. `await q('print-config')`. | A `lossy_name` warning names that item. Put the name back → the warning goes. | |

Done by / date:

## Check 5. Tickets, cancel slips and plain options on paper (03c §3.3, §3.5; C1-2, B3-2)

**BLOCKED (orders)**. Station Tandoor on `printer` with LAN-P.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Dine-in T7: **3 x Naan**, and a Chicken Karahi with the plain option **No onion** and a kitchen note. Send it. | At fire, one ticket per order: station name and time, the table big, `DINE-IN` + taker + order id, `3 x Naan`, `1 x Chicken Karahi`, under it `    + No onion` and `    NOTE: …`. No prices, no COMP. | |
| [ ] | After it printed, remove **1** Naan. | Slip `CANCELLED  T7  - 1 x Naan  2 left`. | |
| [ ] | Remove the other **2** Naan (no units left). | Slip in the whole form `CANCELLED  T7  2 x Naan` (no "0 left", C1-2). New order with 3 Naan, remove all 3 at once → `CANCELLED  T7  3 x Naan`. | |
| [ ] | A line that is already Done on the KDS is removed. | No slip. | |
| [ ] | Boost a printed order. | Slip `FIRST  T7  …` with its not-done lines. | |
| [ ] | Reprint the ticket (Pass card or KDS when built; meanwhile the order-taker screen if it has it). | The ticket prints again with the **REPRINT** header and the current table. | |
| [ ] | `both` station: send an order, tap Done on the KDS before the ticket prints (printer off). Switch the printer on. | That ticket is not printed (empty render → cancelled). | |

Done by / date:

## Check 6. Paper out mid-rush → suspect reprint, including the FIRST slip (03c §3.5, §3.7; C3-2)

**BLOCKED (orders)**. Use LAN-P (status proven in check 1). Station on `printer`.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Send 3 orders; boost one of them so a **FIRST** slip prints. Let all print. | 3 tickets + 1 FIRST slip, all acked (`q('print-queue')`, `hubsql` §0.4). | |
| [ ] | Open the cover / take the paper out **while** the next 2 orders print. | Within about 10 s (one status read per 10 s) `printer_problem` for LAN-P on the managers' tablets. `q('print-queue')`: `suspect` > 0. The jobs acked since the last clean read minus 10 s are marked suspect. The queue keeps the new jobs waiting; other printers keep printing. | |
| [ ] | Put the paper back and close the cover. | Status turns clean. For each ticket with a suspect job and a live, not-done line: **one** ticket with the **REPRINT** header. For the boosted ticket also its **FIRST** slip again (C3-2). A ticket whose lines are all done is not reprinted. Then the waiting jobs print in order. The alert closes. | which reprinted: |
| [ ] | `hubsql "select job_id, kind, suspect_at, suspect_resolved_at from print_jobs where suspect_at is not null"`. | Every suspect has `suspect_resolved_at`; recovery job ids end in `:recover:<n>` and `:recover:first:<n>`. | |

Done by / date:

## Check 7. Pull a KDS cable → paper fallback; one COMING UP per 5 min (03c §3.4; C4-1)

**BLOCKED (BU1, orders)**. Station Tandoor: mode `screen` with LAN-P as its fallback printer; KDS-T on Ethernet (see `03b-manual-checks.md` check 1).

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Lines in Now and Next on KDS-T. Pull its cable. | Nothing prints for the first 30–60 s. When Tandoor goes dark: one ticket for each order with a line in Now, plus **one COMING UP** slip (the plan). | time to first print: |
| [ ] | Send a new Tandoor order while dark. | It prints at fire. | |
| [ ] | Plug the cable back in. | Printing stops at once; nothing printed is cancelled. Lines whose ticket printed show the **printed** tag on KDS-T. | |
| [ ] | Within 5 min of that COMING UP, pull the cable again until dark. | Tickets print for Now lines that have no ticket yet, but **no** second COMING UP. | |
| [ ] | More than 5 min after the last COMING UP, pull again until dark. | A new COMING UP prints. | |
| [ ] | `q('print-config')` for a `screen` station that has a printer but no paired KDS. | Warning `no_screen` ("this station is screenless and never falls back to paper"). | |

Done by / date:

## Check 8. Restart mid-print → REPRINT header, nothing lost (03c §3.7 restart, F §5.8 step 5, D24)

**BLOCKED (orders)**.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Send 5 orders to a `printer` station quickly. While the second ticket is printing, run `sudo systemctl restart hub` on the mini PC. | The hub is back within 90 s (D24). | restart took: |
| [ ] | Watch the printer. | The job that was sent but not acked is printed again **once** with the **REPRINT** header; the rest print in order. No ticket is missing (a duplicate is fine, a missing one is not). | |
| [ ] | Pull the mini PC's power instead of `restart` (UPS off), power on. | Same result after boot. | |

Done by / date:

## Check 9. Test-DB reset on the owner's `pos-pg-test` container

Needed once after this merge if the laptop's test database applied an older `0012_kds_settings.sql` (P0.F edited it): the gate then fails with `MigrationChecksumError: 0012_kds_settings.sql`. The container keeps running; never stop, restart or `compose down` it.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | `docker exec pos-pg-test psql -U pos -d postgres -c 'DROP DATABASE IF EXISTS pos_test WITH (FORCE)' -c 'CREATE DATABASE pos_test OWNER pos'` | `DROP DATABASE`, `CREATE DATABASE`. | |
| [ ] | `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` | Green; no `MigrationChecksumError`. | |
| [ ] | `docker exec pos-pg-test psql -U pos -d pos_test -c 'show fsync' -c 'show synchronous_commit' -c 'show full_page_writes'` | `off`, `off`, `off` (the test-only settings are kept across the reset). | |

Done by / date:

---

## Summary

| Check | Result | Blocked by |
|---|---|---|
| 1 LAN save, test print, cut, status | | — |
| 2 USB, `lp` group, udev symlink | | — |
| 3 USB status proof; `busy`; login while blocked | | orders (busy / blocked parts) |
| 4 PC437, Urdu → `?`, `lossy_name` | | — |
| 5 Tickets, CANCELLED forms, plain options | | orders |
| 6 Paper out → suspect REPRINT + FIRST | | orders |
| 7 KDS cable → paper fallback, COMING UP rule | | BU1, orders |
| 8 Restart mid-print → REPRINT | | orders |
| 9 `pos-pg-test` DB reset | | — |
