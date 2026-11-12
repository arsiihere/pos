# 03b manual checks (03b §11 task 41)

Hand checks for 03b KDS + Pass (spec `docs/specs/03b_KDS_Pass_Spec_v1.0.5.md` §3.3–§3.7, §12.1). The owner runs them on the pilot hardware with a real KDS screen and a real Pass tablet. They never run in the cloud or in CI. Nothing here is run or ticked by the build.

How to fill it in: tick `[x]` when the step behaves as written. When it does not, leave `[ ]` and write what you saw in **Notes**. Fill in the **Done by / date** line under each check.

How to report it: `tools/local/checks-report.sh <PR> docs/plans/03b-manual-checks.md` posts the filled-in list as a comment on PR `<PR>` (use the `module-03b` → `main` PR).

---

## 0. Before you start

### 0.1 What can run today

The hub half of 03b is built and green (acceptance map in `docs/plans/03b-status.md`). The screens are client lanes that are **not built yet**:

| Needs | Client lane | Checks that wait for it |
|---|---|---|
| KDS station screen (`apps/client/src/features/kds/`) | BU1 | 1, 2, 3, 4 (the lane buttons), 6 |
| Pass tablet screen (`apps/client/src/features/pass/`) | BU2 | 1 (takeover section), 5 |
| Order-taker screen that sends orders (02b client) | 02b client | every check that needs lines in Now |

A KDS paired today shows only the "paired" page. It opens no socket, so the hub always sees the station as not connected. Until BU1 ships, a station with a paired KDS goes dark as soon as it has lines in Now. Every step that needs one of the screens above is marked **BLOCKED (BU1)**, **BLOCKED (BU2)** or **BLOCKED (orders)**. Run every other step now. The blocked steps are written out in full, so they can run without rework later.

### 0.2 Build and deploy

1. On the dev box, at the head of `main` after the `module-03b` merge: `pnpm install && pnpm test` (this also builds `apps/client/dist/`).
2. On the mini PC: `sudo systemctl stop hub`, check out the same commit in `/opt/pos-hub`, ship the client (`apps/hub/deploy/ship-client.sh <ssh-target>`), then `sudo systemctl start hub`.
3. `<hub>` below means `<hub-ip>:<http_port>` (`http_port` in `/etc/pos-hub/config.json`). The LAN is plain http / ws.
4. Check that `http://<hub>/health` answers.

### 0.3 Devices and people

| Name here | Hardware | Paired as | Role (03b) |
|---|---|---|---|
| **KDS-T** | the Tandoor wall screen, on **Ethernet** (so check 1 can pull the cable) | KDS, station **Tandoor** | lane label `Left` (check 4) |
| **KDS-T2** | a second screen or a laptop browser profile | KDS, station **Tandoor** | lane label `Right` (check 4) |
| **PASS** | the pilot Pass tablet | Tablet | bound to the point of Tandoor (`SetDeviceRole`) |
| **MGR** | a manager's tablet with `/staff/` open, Manager **M1** signed in | Tablet | gets `kds_offline` (managers) |
| **W-PH** | waiter **W**'s phone with `/staff/` open | Phone, owner W | gets Ready to serve / Served card |
| **LAPTOP** | dev laptop on the restaurant LAN | — | `http://<hub>/admin` and its DevTools console |

People: **M1** Manager (has `manage-devices` and `run-pass`), **CK** Cook (has `run-pass` by default, B-1), **W** Waiter on the table team of the test table, **OT** order taker.

### 0.4 The admin console helpers

Open `http://<hub>/admin` on LAPTOP, sign in as M1, open DevTools → Console and paste:

```js
q = async (name) => (await call('/admin/queries/' + name, { headers: headers() })).body;
c = (path, type, payload) => command(path, type, payload);
```

- `await q('stations')` lists station ids. `await q('devices')` lists device ids.
- `await q('kds-config')` shows each station's screens (`connected` / `signed_out` / `offline`), `dark`, lanes and warnings (03b §6.12).
- Bind PASS to a point: `await c('set-device-role', 'SetDeviceRole', { device_id: '<PASS id>', point_id: '<point id>' })`.
- Lane labels: `await c('set-device-role', 'SetDeviceRole', { device_id: '<KDS-T id>', lane_label: 'Left' })` (and `Right` for KDS-T2).
- Open the day: `await c('open-business-day', 'OpenBusinessDay', {})`.

Read-only database look on the mini PC (install `sqlite3` once if needed):

```sh
hubsql() { sudo sqlite3 -readonly -header -column "$(jq -r .data_dir /etc/pos-hub/config.json)/hub.sqlite" "$1"; }
```

### 0.5 Settings

The defaults are fine: KDS offline **30 s**, Ready window **60 s** (owner page "Kitchen screens and the pass", 01a v2.4.3). The hub notices a dead socket only after up to 30 s (`PONG_MS`), so a pulled cable shows up as dark after **30–60 s**.

---

## Check 1. Pull a KDS cable mid-rush → Pass takeover + alert (03b §3.6, tests #40, #44)

**BLOCKED (BU1, BU2, orders)** until the KDS and Pass screens and the order-taker screen ship.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Day open. OT sends 4–6 dine-in and takeaway orders with Tandoor items until KDS-T shows lines in **Now** and **Next**. CK is signed in on PASS. | KDS-T shows Now / Next. PASS shows the order cards of its point. `q('kds-config')`: Tandoor `dark: false`, KDS-T `connected`. | |
| [ ] | Note the time and pull KDS-T's Ethernet cable. | For the first 30 s nothing changes: no alert, no section on PASS. | |
| [ ] | Wait (30–60 s after the pull, §0.5). | **One** `kds_offline` alert on MGR ("Tandoor screen offline", station name shown). No second alert while it stays dark. | time from pull to alert: |
| [ ] | Look at PASS. | A section **"Tandoor screen offline"** appears with Tandoor's Now / Next, the same rows the KDS showed. | |
| [ ] | On PASS, tap **Start** on a waiting Tandoor line, then **Done** on a cooking one, then **Give me more**. | Each tap works under CK's `run-pass`. The rows change on PASS at once. | |
| [ ] | OT sends one more Tandoor order. | Its line appears in the PASS takeover section (line events reach the takeover set, §6.17). | |
| [ ] | `await q('kds-config')` on LAPTOP. | Tandoor `dark: true`; a warning `{ station_id: <Tandoor>, kind: 'dark' }`; KDS-T `offline`. | |
| [ ] | If Tandoor has a fallback printer (03c), also see `03c-manual-checks.md` check 7. | Paper prints as well (03c §3.4); the takeover still shows. | |

Done by / date:

## Check 2. Reconnect → takeover ends, alert closes after 60 s; blips give one alert (03b §3.6 step 3, test #41)

**BLOCKED (BU1, BU2, orders)**. Run it right after check 1.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Plug KDS-T's cable back in. | The KDS reconnects by itself and re-renders Now / Next. The PASS takeover section goes **at once** (within a second or two of the KDS reconnecting). | |
| [ ] | Watch MGR for 60 s. | The `kds_offline` alert stays open for 60 s after the reconnect, then closes (`done`). | time from reconnect to close: |
| [ ] | Blip test: pull the cable for 10 s, plug it in, wait 10 s, pull it for 10 s again, plug it in. | No new alert and no takeover: each blip is shorter than KDS offline. | |
| [ ] | Pull the cable again until dark (alert + takeover), plug it in for 20 s, pull it again until dark. | The alert of this outage is still open (not 60 s connected), so there is **still one alert**, not two. | |

Done by / date:

## Check 3. A dark station whose last screen is revoked; a screenless station (03b §3.6 steps 4–5, test #42)

**BLOCKED (BU1, orders)** for the dark part. The screenless part needs only orders.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Make Tandoor dark (pull KDS-T, unpair KDS-T2 first). Then on `http://<hub>/admin` → Devices, revoke KDS-T. | Within one tick the PASS takeover section goes. The `kds_offline` alert closes as **obsolete**. `q('kds-config')`: Tandoor has no screens and no `dark` warning. | |
| [ ] | A station with **no** paired KDS (e.g. Cold) gets orders and keeps lines in Now for 10 min. | No `kds_offline` alert and no takeover. Its lines are on PASS as ordinary lines with Start / Done (screenless, §3.4). | |
| [ ] | Re-pair KDS-T for the next checks (`http://<hub>/pair`, approve as KDS for Tandoor). | KDS-T `connected` in `q('kds-config')`. | |

Done by / date:

## Check 4. Lanes, and all lanes back on at day open (03b §3.7, tests #11–#13)

The labels and `kds-config` part can run now. The lane buttons are **BLOCKED (BU1)**.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Label KDS-T `Left` and KDS-T2 `Right` (§0.4). Try a lane label on PASS (a tablet). | `q('kds-config')`: Tandoor `lanes: { lanes_on: 2, lane_count: 2 }`. The label on PASS → `400 VALIDATION_FAILED` (field `lane_label`). | |
| [ ] | **BLOCKED (BU1)**: on KDS-T2 tap **Lane Off**. | `lanes_on: 1`. The Tandoor capacity drops (owner page / engine numbers). `hubsql "select event_type from events order by seq desc limit 2"` shows `LanesSet` above `StationCapacitySet` (same commit, that order). | |
| [ ] | **BLOCKED (BU1)**: tap **Lane On**. | `lanes_on: 2`; the capacity override is cleared. | |
| [ ] | **BLOCKED (BU1)**: Lane Off again and leave it off at closing. Next morning, open the day (`c('open-business-day', …)`). | After `BusinessDayOpened`, `q('kds-config')` shows `lanes_on: 2` again (all on). The KDS shows both lanes on. | |
| [ ] | Before opening the day (or right after day close), look at KDS-T. | "Day not started", no buttons (00 Q10). **BLOCKED (BU1)** | |

Done by / date:

## Check 5. Pass: Ready to serve, Undo, Handover, Served card on a real tablet (03b §3.5, tests #20–#27)

**BLOCKED (BU2, orders)**. W must be signed in on W-PH; CK on PASS.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | Dine-in order on table T4 (W's table team); Tandoor and Grill lines. Cook them all Done on the KDS. | The PASS card for "T4" turns **Ready** (green). While one line was done and another still cooking, it showed the HOLD hint (amber); Ready was still allowed (K4). | |
| [ ] | On PASS tap **Ready to serve**. | W-PH rings with a Ready-to-serve card for **T4** (the table team). Tap Ready again → nothing new (already). | |
| [ ] | Within 30 s tap **Undo** on PASS. | The card on W-PH closes (undone). After 30 s the Undo button is gone or refused (`PASS_UNDO_WINDOW_CLOSED`). | |
| [ ] | Ready again, then **Hand over** → receiver tile **W**. | W-PH gets a **Served card** for T4. The PASS card drops the handed lines. The Ready card closes (`done`) when nothing is left un-handed. | |
| [ ] | The receiver tiles. | Only staff who are signed in and may mark this order served are offered (W yes; a waiter of another floor with `my_floors` no). | |
| [ ] | W marks the order served on W-PH. | The Served card closes. | |
| [ ] | Takeaway order (token). Ready to serve on PASS. | The card goes to the order taker who placed it and shows the token, e.g. **"#12"**. | |
| [ ] | Move T4's seating to T9 while a Ready is open (table move on the order-taker screen). | The old card closes; a new card for **T9** rings the T9 team. | |
| [ ] | Turn the served estimate on (owner page, e.g. 3 min). Hand over and do **not** mark served. | After the estimate, the lines are served by the estimate (`ItemServed { source: 'estimated' }`) and the card closes. | |

Done by / date:

## Check 6. "Tap Done" cue after Undo at an `auto_done` station (03b v1.0.5 §3.3, B2-3; 03a v1.2.2)

**BLOCKED (BU1, orders)**. The cue's text comes with BU1; the hub flag is there now.

| ☐ | Step | Expected | Notes |
|---|---|---|---|
| [ ] | In the owner app, set a station (e.g. Fryer, with a KDS) to completion mode **auto_done**. Send an order with a Fryer line. | The line starts at fire and is marked Done by itself at its planned end. It leaves Now. | |
| [ ] | Within 30 s of that Done, tap **Undo** on the Fryer KDS. | The row comes back in Now as cooking, with a clear **"tap Done"** cue. | |
| [ ] | Wait past the line's planned end, and a few more minutes. | The line is **never** marked Done again by itself. It holds the station (the next lines wait) until someone taps Done. | |
| [ ] | In KDS DevTools → Network → WS, find the `kds_station` catch-up after a page reload. | That line's Now row has `done_undone: true`; other rows `false`. | |
| [ ] | Tap **Done**. | The line is done and leaves Now; the station moves on. | |

Done by / date:

---

## Summary

| Check | Result | Blocked by |
|---|---|---|
| 1 Pull a KDS cable → takeover + alert | | BU1, BU2, orders |
| 2 Reconnect, 60 s close, blips | | BU1, BU2, orders |
| 3 Revoked last screen; screenless | | BU1, orders |
| 4 Lanes, day open | | BU1 (buttons) |
| 5 Pass Ready / Handover / Served card | | BU2, orders |
| 6 "Tap Done" cue at `auto_done` | | BU1, orders |
