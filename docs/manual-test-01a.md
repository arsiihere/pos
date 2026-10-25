# Module 01a — manual test runbook

Hand test of spec 01a (Restaurant Setup, `docs/specs/01_Restaurant_Setup_Spec_v1.0.2.md`) on the dev box, from plan task 71. It changes no code. It reuses the setup of `docs/manual-test-00.md` §1–§3: database **`pos_manual`** (never `pos_test`), the cloud on **port 4000** through the `cloud` wrapper, the hub on **port 3000**. Part A runs on the dev box; Part B, the on-site release drill (§7.8), is for later, on the pilot mini PC.

Terminals, as in 00: **T1** cloud, **T2** hub, **T3** CLIs and checks. Run `source ~/pos-manual/env.sh` in each.

Write down for each step: pass / fail, and anything that differs from "You should see".

---

# Part A — dev box

## A0. Build, start, provision

Start from a fresh `pos_manual` (00 runbook §9) unless you want to reuse a provisioned hub.

```sh
cd ~/pos
pnpm install
pnpm --filter @pos/client build        # apps/client/dist/owner/ and dist/admin-stock/
ls apps/client/dist/owner/index.html apps/client/dist/admin-stock/index.html
```

Then do 00 runbook §2 (cloud in T1, hub config, hub in T2) and §3a–§3d (seed the tenant, issue a code, provision at `http://localhost:3000/setup`, restart the hub, first admin in the browser at the `LAN_IP` origin). Keep the PIN.

Add two helpers to `~/pos-manual/env.sh` and source it again:

```sh
cat >> ~/pos-manual/env.sh <<'EOF'

# psql on pos_manual
pg() { docker compose -f "$POS/docker-compose.yml" exec -T postgres psql -U pos -d pos_manual "$@"; }

# Read-only SQL on the hub database
hubsql() {
  (cd "$POS/apps/hub" && node -e '
    const D = require("better-sqlite3");
    const db = new D(process.argv[1], { readonly: true });
    console.table(db.prepare(process.argv[2]).all());
  ' "$M/hub/data/hub.sqlite" "$1")
}
EOF
source ~/pos-manual/env.sh
ids; echo "$TENANT $BRANCH"
pg -c "select name from schema_migrations order by version"
pg -c "select name, config_version, day_stale_after_hours, day_min_gap_hours from branches"
pg -c "select r.name, rp.permission from role_permissions rp join roles r using (tenant_id, role_id) where rp.permission = 'manage-stock'"
```

**You should see:**
- both `index.html` files exist;
- `schema_migrations` lists `0001_platform.sql`, `0002_restaurant_setup.sql`, `0003_manage_stock_backfill.sql`;
- one branch "Main" with `config_version` 1 (or a little higher), `16` and `4`;
- `manage-stock` on **Manager** and **Owner** (S18; on a database seeded before 01a, migration `0003` adds these rows and raises `tenants.directory_version` by 1).

**Most likely failure:** `GET /owner/` later answers `404` → the client build is missing or was made after the cloud started; build, then restart T1.

## A1. Owner pages (§8.1)

On the laptop, open `http://localhost:4000/owner/`.

1. **Sign in** with `owner@example.com` and the password from `seed-tenant`. A wrong password shows "Email or password is wrong. Check them and try again."
2. **Choose a branch**: the picker shows branch **IDs** (Q3, branch names come with 01b). Pick `$BRANCH`.
3. **Floors and tables**: add floor "Ground", add tables "T1" (4 seats) and "T2". Rename "T2" to "T1" → red banner "That name is already used. Choose another name." and the field goes back to "T2". Set the floor's Sort number to 2 → it saves on leaving the field.
4. **Stations**:
   - add "Karahi", type **Cooks each order (slot)**, capacity 4;
   - add "Fryer", type **Cooks in batches (batch)**, capacity 8, freshness window 2;
   - under Fryer, add program "Fry 180", cook time 6.

   The freshness field and the programs list appear only on the batch station.
5. **Menu**:
   - tax class: none (leave "No tax");
   - category **"Mains"**: always available;
   - category **"Breakfast"**: Available hours 07:00 → 11:00;
   - items:

| Item | Category | Route | Units | Stock fields |
|---|---|---|---|---|
| Seekh kebab | Mains | Karahi | Stock unit Pieces, Sold by Pieces | Time from pre-cooked stock 2 min (cook 10) |
| Biryani | Mains | Karahi | Stock unit Grams (kg), Sold by Pieces, Grams per piece 350 | stock time 1 min (cook 15); Low stock alert at 2 (kg) |
| Gulab jamun | Mains | Karahi | Pieces / Pieces | stock time 0 (cook 5); **Keeps overnight** |
| Fries | Mains | Fryer, program Fry 180, stock program Fry 180 | Pieces / Pieces | — |
| Halwa puri | Breakfast | Karahi | Pieces / Pieces | none (not stock-tracked) |

6. **Search**: type "kebab" in Search items → after a short pause only Seekh kebab is listed. Switch Show to Archived → empty list.

**You should see:** every save closes without a banner; each list shows the new rows. No image field exists anywhere (#75).

## A2. Menu reaches the hub within 60 s (§3.4, S4)

The stock page needs a paired **Cashier screen** token in the browser's IndexedDB for the `http://<LAN_IP>:3000` origin (a Kitchen screen is refused with "This kind of screen cannot do that."). If the laptop browser is not paired yet: open `http://<LAN_IP>:3000/pair` in a **new tab**, approve its code as **Cashier screen** from the `/admin/approve` tab (00 §4), and wait for "This screen is paired".

Then, in that tab, open `http://<LAN_IP>:3000/admin/stock/`.

1. The sign-in screen says **"Sign in to manage stock"** with a name tile **Test Owner**. Tap it, type the PIN, Enter.
2. Wait up to 60 s (the hub polls the cloud every 60 s).

```sh
hubsql "select branch_id, config_version, applied_at from branch_config"
```

**You should see:**
- in T2, a JSON line `"msg":"config poll"` with `"outcome":"applied"` within 60 s of the last owner save;
- the status line **"Menu version N · checked just now"**, where N matches `pg -c "select config_version from branches"`;
- all five items as rows; Seekh kebab, Biryani, Gulab jamun and Fries have an On hand field with Reserved and Available, while **Halwa puri has only the Available / Off switch** (it is not stock-tracked);
- `hubsql` shows the same `config_version`;
- the Category filter lists category **ids**, not names (known spec gap, see `docs/reviews/01a-auto/whole-module-check.md`).

**Most likely failures:** "No menu yet" after 2 minutes → T2 shows `config poll refused by the cloud` (key problem) or `offline` (cloud down). "No one on the staff list can open this page." → the owner's role lacks `access-hub-admin` / `manage-stock`; check A0's query.

## A3. Pair a KDS to a station

Get the station ids:

```sh
pg -c "select station_id, name, station_type from stations order by name"
```

1. On the **phone** (or a laptop Incognito tab at `http://<LAN_IP>:3000/pair`), get a display code.
2. In the `/admin/approve` tab (00 §3d), type the code, Screen type **Kitchen screen**, Station = the **Karahi** `station_id`, Approve.
3. Try once with a made-up station id first.

**You should see:** the made-up id gives "That station does not exist. Check the station name." (`STATION_NOT_FOUND`); the real one gives "Screen approved", and the phone shows **"This screen is paired"**. Reload the phone page: it stays paired (it calls `/auth/station`, which now succeeds because Karahi is in the applied config).

```sh
curl -s $HUB/admin/queries/devices -H "x-admin-session: $ADMIN" | jq '.data.devices[] | {device_name, device_type, station_id}'
```

shows the kds row with Karahi's id. In 00 this step always failed; it passes only because 01a delivered the stations.

## A4. Stock with the internet unplugged (§6.17–§6.18, S18, S44, S45)

On `/admin/stock/`:

1. No day is open yet: a large **Start day** button sits above the rows with "No business day is open. Start the day, then enter the counts." Type a count first, then tap **Start day** once → no confirmation; the day line shows **"Day open: <date> since <time> (0 h)"**, and the typed count is still there.
2. Count: Seekh kebab 20, Biryani **4.5** (kg), Gulab jamun 30, Fries 10 → **Save counts** → "Counts saved." Biryani shows On hand **4.5 kg**. Typing `4.5kg` or `4,5` is refused with "Check the number: whole pieces, or kg and L with up to 3 decimals."
3. **Add** 5 to Seekh kebab → On hand 25.
4. Set Biryani to 1.5 → saved; the alert bar shows **"Low: Biryani 1.5 kg"**. Set Fries to 0 → **"Out: Fries"** after the low list.
5. **Unplug the internet:** stop the cloud (Ctrl+C in T1), or pull the uplink cable / turn off the router's WAN. Keep the LAN up.
6. Set Seekh kebab to 18 → saved. Switch **Halwa puri** to **Off** → saved; the row shows Off.
7. Wait up to 60 s.

```sh
events 12
```

**You should see:** every save works with the cloud down (stock is hub-owned, D50). The status line gains **" · offline"** within 60 s, and no danger banner appears (offline is not a problem). `events` lists `BusinessDayOpened`, `StockSet` ×n, `StockAdded`, `ItemMadeUnavailable`.

8. Start the cloud again (T1). Within 60 s " · offline" disappears.

**Most likely failure:** a save shows "The hub cannot be reached…" → you cut the LAN too, or the laptop moved networks.

## A5. Business day open → close (§6.18a, §6.18b, S33, S41)

1. **Close day** too early: tap Close day → the confirmation "Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started" → confirm. Within 4 h of the open you get **"This day was started only a short time ago; nothing changed."** For the drill, lower the guard:

```sh
cloud node --import tsx src/cli/set-branch-settings.ts --branch $BRANCH --day-min-gap-hours 0 --day-stale-after-hours 1
```

   Wait ≤ 60 s for the hub to apply it (config poll line in T2).
2. Close day again → confirm. **You should see:** "Day closed at <time>"; Available **0** for Seekh kebab, Biryani and Fries; **Gulab jamun keeps 30** (Keeps overnight); Save counts is replaced by the Start day action; a save now gets "The business day is not open, so this was not saved. Start the day to save it." with a Start day button next to it. Tap it → the day opens and the same save is re-sent and succeeds.
3. Rows of non-carrying items show **"Not counted today"** until counted.
4. **Stale prompt:** leave the day open for more than 1 h (the setting from step 1). **You should see:** "Yesterday's day is still open since <time>. Close it and start a new day?" with **Close and start new day** and **Keep this day open**. Keep hides it; Close and start new day closes and opens a new day (two events).
5. Put the settings back:

```sh
cloud node --import tsx src/cli/set-branch-settings.ts --branch $BRANCH --day-min-gap-hours 4 --day-stale-after-hours 16
```

### A5b. Unit change mid-day (S44)

On the owner page, change Seekh kebab's Stock unit to Grams (kg) and Sold by Pieces, Grams per piece 100; the form warns "Takes effect when the next business day starts…". Save. After the hub applies it (≤ 60 s): the stock page still counts Seekh kebab in **pieces** for the open day. Close day and Start day: Seekh kebab is now in kg and shows "Not counted today". Change it back afterwards the same way.

## A6. Restore-bump drill (§6.7a, S42)

Prepare one extra staff member who can sign in to the stock page (01b has no staff UI, so SQL; it reuses the owner's PIN hash):

```sh
pg <<SQL
INSERT INTO staff (tenant_id, staff_id, display_name, pin_hash, created_at, updated_at)
  SELECT tenant_id, 'MANUAL-COOK', 'Cook Test', pin_hash, created_at, created_at FROM staff WHERE staff_id = '$STAFF';
INSERT INTO staff_branches (tenant_id, staff_id, branch_id) VALUES ('$TENANT', 'MANUAL-COOK', '$BRANCH');
INSERT INTO staff_roles (tenant_id, staff_id, role_id)
  SELECT tenant_id, 'MANUAL-COOK', role_id FROM roles WHERE tenant_id = '$TENANT' AND name = 'Manager';
UPDATE tenants SET directory_version = directory_version + 1 WHERE tenant_id = '$TENANT';
SQL
```

Within 60 s, sign out of `/admin/stock/` (reload the tab) → the roster shows **Cook Test** next to Test Owner.

1. **Back up:** `docker compose -f $POS/docker-compose.yml exec -T postgres pg_dump -U pos -Fc pos_manual > $M/pos_manual.dump`
2. **After the backup:** on the owner page rename "Fries" to "Chips" and change Seekh kebab's price. Remove Cook Test:
   ```sh
   pg -c "UPDATE staff SET is_active = false WHERE staff_id = 'MANUAL-COOK'" \
      -c "UPDATE tenants SET directory_version = directory_version + 1 WHERE tenant_id = '$TENANT'"
   ```
   Within 60 s the hub shows "Chips" and the roster no longer has Cook Test.
3. **Restore:** stop the cloud (T1), then
   ```sh
   docker compose -f $POS/docker-compose.yml exec -T postgres dropdb -U pos pos_manual
   docker compose -f $POS/docker-compose.yml exec -T postgres createdb -U pos pos_manual
   docker compose -f $POS/docker-compose.yml exec -T postgres pg_restore -U pos -d pos_manual < $M/pos_manual.dump
   ```
   Start the cloud (T1). Wait 2 minutes.
4. **You should see:** the hub **keeps the newer menu** ("Chips") and the roster stays without Cook Test: the restored versions are lower than the hub's, so it applies nothing (M51 / §3.4 step 4). The T2 log shows `config poll` lines but no `applied`.
5. **Bump:**
   ```sh
   cloud node --import tsx src/cli/restore-bump.ts --tenant $TENANT
   ```
   It prints `branch <id>: <before> → <after>` and `directory: <before> → <after>`, each after-value above what the hub holds.
6. **You should see,** within 60 s: the hub applies the **older** menu ("Fries" is back, old price) and the older directory (**Cook Test is back** on the roster). That is the documented behaviour: changes made after the backup are re-applied by hand (Q4).
7. Clean up: `pg -c "UPDATE staff SET is_active = false WHERE staff_id = 'MANUAL-COOK'" -c "UPDATE tenants SET directory_version = directory_version + 1 WHERE tenant_id = '$TENANT'"`, and redo the rename and price change if you want them.

**Most likely failure:** `restore-bump` prints `usage: restore-bump --tenant <tenant_id>` → `$TENANT` is empty; run `ids`.

## A7. Large menu (S48, §7.5)

Seed 5 000 items routed to Karahi, then raise the branch's config version so the hub refetches:

```sh
pg <<SQL
WITH s AS (SELECT station_id FROM stations WHERE tenant_id = '$TENANT' AND name = 'Karahi'),
     c AS (SELECT category_id FROM categories WHERE tenant_id = '$TENANT' AND name = 'Mains'),
     ts AS (SELECT (extract(epoch FROM clock_timestamp()) * 1000)::bigint AS t),
     ins AS (
       INSERT INTO menu_items (tenant_id, item_id, category_id, name, price_minor, serve_mode, cook_time_ms,
                               stock_time_ms, created_at, updated_at)
       SELECT '$TENANT', 'BULK' || lpad(g::text, 5, '0'), c.category_id, 'Bulk item ' || g, 10000 + g,
              'immediate', 600000, CASE WHEN g % 10 = 0 THEN 60000 END, ts.t, ts.t
         FROM generate_series(1, 5000) g, c, ts
       RETURNING item_id)
INSERT INTO item_routes (tenant_id, branch_id, item_id, station_id, updated_at)
  SELECT '$TENANT', '$BRANCH', ins.item_id, s.station_id, ts.t FROM ins, s, ts;
UPDATE branches SET config_version = config_version + 1 WHERE tenant_id = '$TENANT' AND branch_id = '$BRANCH';
SQL
```

**You should see:**
- **Owner page:** Menu lists 50 items with **Load more**; each press adds 50 and no item repeats. Search "Bulk item 4999" finds one row after a short pause.
- **Hub,** within 60 s: T2 logs `"msg":"config snapshot above the off-thread trigger (§12.4)"` at `warn` with `"items":5005` (or so), then `config poll` `applied`. Note the time between the poll line and the applied line: target ≤ 1.5 s (§7.5).
- `/admin/stock/` lists about 500 more stock-tracked rows (every tenth bulk item) and stays usable; search narrows them.

Remove them afterwards if you like: `pg -c "DELETE FROM item_routes WHERE item_id LIKE 'BULK%'" -c "DELETE FROM menu_items WHERE item_id LIKE 'BULK%'" -c "UPDATE branches SET config_version = config_version + 1 WHERE branch_id = '$BRANCH'"`.

### A7b. Timing (§7.5, S40 N10; record the numbers, they are not pass/fail on the dev box)

```sh
KEY=$(jq -r .provisioned.branch_api_key "$POS_HUB_CONFIG")
CV=$(pg -At -c "select config_version from branches where branch_id = '$BRANCH'")
DV=$(pg -At -c "select directory_version from tenants where tenant_id = '$TENANT'")
p95() { sort -n | awk '{a[NR]=$1} END {print "p95 " a[int(NR*0.95+0.5)] " s"}'; }
for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -H "authorization: Bearer $KEY" \
  "http://127.0.0.1:4000/v1/sync/config?config_version=$CV&directory_version=$DV"; done | tee /dev/stderr | awk '{print $2}' | p95
for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code} %{time_total}\n' -H "authorization: Bearer $KEY" \
  "http://127.0.0.1:4000/v1/sync/config?config_version=0&directory_version=$DV"; done | awk '{print $2}' | p95
```

**You should see:** the first loop prints `304` twenty times, p95 ≤ 0.020 s; the second prints `200`, p95 ≤ 2 s with the 5 000-item menu.

## A8. Page parts of tests 75, 102, 103, 132, 133, 137, 139, 146 (S40 N11)

| # | Do | You should see |
|---|---|---|
| 75 | Add `<div dangerouslySetInnerHTML={{ __html: '' }} />` to any file under `apps/client/src/features/owner/`, run `pnpm lint`, then `git checkout` the file | lint fails on that line |
| 102 | A forced hash mismatch needs a doctored cloud reply; there is no supported way to make one by hand on the dev box. Record "covered by the component test `[01a §10 #102 page part]`" | — |
| 103 | Halwa puri was switched Off in A4, before the day close; after the new Start day in A5 | its row shows **"Off since <day>"**; switch it back to Available afterwards |
| 132 | A4 step 4 | the alert bar lists low then out items |
| 133 | A4 step 1 and A5 step 2 | one-tap Start day; Close day asks first |
| 137 | Set the laptop clock 3 h wrong (`sudo timedatectl set-ntp false; sudo date -s '+3 hours'`), reload `/admin/stock/`, then put it back (`sudo timedatectl set-ntp true`) | with Halwa puri Available: its **Hours …** badge (07:00–11:00) appears or not by the **hub's** time, not the laptop's; switch it Off and the badge goes (Off wins) |
| 139 | Restrict the owner to one branch while the tenant has two (issue a second registration code with `--branch-name "Second"`, then `pg -c "UPDATE owner_users SET allowed_branch_ids = ARRAY['$BRANCH']"`), sign in again | the Menu shows "Read only: tax classes, categories and items are shared by every branch…" and no save buttons |
| 146 | A5 step 4 | the stale prompt and its two buttons |

---

# Part B — on-site release drill (§7.8), later, needs hardware

Run on the restaurant LAN, outside service hours, on the pilot mini PC (`<ssh-target>`, `<hub-ip>`). This replaces nothing in Part A and is not run on the dev box (D4: no ssh from the auto loop).

1. On the developer machine, at the release tag, with a clean tree: `pnpm install --frozen-lockfile && pnpm test`. **You should see:** all tests pass and `apps/client/dist/admin-stock/index.html` exists.
2. **One refusal first:** with the hub still running, run `apps/hub/deploy/ship-client.sh <ssh-target>`. **You should see:** it refuses because `systemctl is-active hub` prints `active` (D6: it ships only for `inactive` or `failed`; `activating`, `deactivating` and `reloading` also refuse). Exit code not 0, nothing copied.
3. **Stop:** `ssh <ssh-target> sudo systemctl stop hub`; `ssh <ssh-target> systemctl is-active hub` → `inactive`.
4. **Checkout:** `git push <ssh-target>:/opt/pos-hub refs/tags/<tag>`, then `ssh <ssh-target> git -C /opt/pos-hub checkout <tag>`.
5. **Install:** `ssh <ssh-target> 'cd /opt/pos-hub && pnpm install --frozen-lockfile --prod'`.
6. **Ship:** `apps/hub/deploy/ship-client.sh <ssh-target>`. **You should see:** exit code 0; on the hub, `/opt/pos-hub/apps/client/dist/admin-stock/` exists and `admin-stock.new` / `admin-stock.old` do not.
7. **Start:** `ssh <ssh-target> sudo systemctl start hub`, then
   ```sh
   curl -s -D - -o /dev/null http://<hub-ip>:3000/admin/stock/ | grep -iE '^HTTP|content-security-policy'
   ssh <ssh-target> journalctl -u hub -b | grep -i 'client' | head
   ```
   **You should see:** `HTTP/1.1 200` and a `content-security-policy` header; no client-build error in the journal.
8. Optional: `SetPrecookedStock` with 200 entries, 20 times, p95 ≤ 50 ms on the mini PC (§7.5).
9. Also open 00 §10 #79 (5 ms no-op command p95) while on site.
