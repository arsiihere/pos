# End-to-end manual test: a restaurant day (modules 00, 01a, 01b)

A hand test of everything built so far, on one Ubuntu laptop and one phone on the same Wi-Fi. It plays out a restaurant day at **Arif Chatkhara**: set up the cloud, register the Gulberg hub, check the owner screens, put a new waiter on a phone, then try the bad things that happen in real life (a wrong PIN, a person who leaves, a power cut).

This runbook doesn't repeat the module runbooks. For more detail on a step, see:

- `docs/manual-test-00.md`: hub setup, pairing, PIN lockout, revoke, restart (00);
- `docs/manual-test-01a.md`: menu, stock page, business day, restore drill (01a);
- `docs/runbooks/owner-password-reset.md`: the support path for a locked-out owner.

Nothing here changes product code. Everything runs from the repo with `tsx`. Hub data lives under `~/pos-manual`, never `/opt` or `/etc`.

| Terminal | Runs |
|---|---|
| **T1** | cloud (`pnpm dev`) |
| **T2** | hub (`pnpm dev`) |
| **T3** | CLIs, `curl`, checks |

Demo logins created by step 2:

| Who | Login |
|---|---|
| Owner (web) | `owner@arifchatkhara.pk` / `chatkhara-demo-1` |
| Owner PIN (hub) | Arif `1234` |
| Staff PINs | Hamza (Manager) `2222`, Usman (Cashier) `3333`, Ali (Order taker) `4444`, Zain (Waiter, reports to Ali) `5555`, Faisal (Cook) `6666`: all at Gulberg. Kashif (Manager) `7777` and Nadeem (Waiter, **no PIN**) at Johar Town. Imran (Manager) `8888` at DHA |

---

## 1. Prerequisites

```sh
node -v                 # v22.x (root package.json engines: >=22.22.2 <23)
pnpm -v                 # 12.15.0 (corepack enable, if missing)
docker ps --filter name=pos-pg-test --format '{{.Names}} {{.Status}} {{.Ports}}'
```

**You should see:** Node 22, pnpm 12.15.0, and `pos-pg-test Up … 0.0.0.0:5433->5432/tcp`.

Postgres is the existing **`pos-pg-test`** container on port 5433 (user `pos`, password `pos`). Manual data goes in its own database, **`pos_manual`**: the test suite runs `TRUNCATE` on `pos_test`, so keep manual data out of it.

```sh
docker start pos-pg-test                                  # only if it is not Up
docker exec pos-pg-test createdb -U pos pos_manual
cd ~/pos && pnpm install
```

**If not:** `database "pos_manual" already exists` → fine, or wipe it (step 8). Port 5433 is taken by another container → `docker ps`, stop that one, then `docker start pos-pg-test`.

### Shell helpers

Run this once. Then run `source ~/pos-manual/env.sh` in **every** terminal.

```sh
mkdir -p ~/pos-manual/hub/data ~/pos-manual/hub/backup
cat > ~/pos-manual/env.sh <<'EOF'
export POS=$HOME/pos
export M=$HOME/pos-manual
export HUB=http://127.0.0.1:3000
export POS_HUB_CONFIG=$M/hub/config.json
export LAN_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')

# Cloud env is passed per command, never exported: a DATABASE_URL left in the shell
# would make `pnpm test` truncate pos_manual.
cloud() {
  (cd "$POS/apps/cloud" && \
   DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_manual \
   JWT_SECRET=manual-test-jwt-secret-0123456789abcdef \
   REFRESH_TOKEN_SECRET=manual-test-refresh-secret-0123456789ab \
   PORT=4000 HUB_MIN_VERSION=0.0.0 "$@")
}
pg() { docker exec -i pos-pg-test psql -U pos -d pos_manual "$@"; }
ids() {
  export TENANT=$(jq -r .provisioned.tenant_id "$POS_HUB_CONFIG")
  export BRANCH=$(jq -r .provisioned.branch_id "$POS_HUB_CONFIG")
}
hubsql() {
  (cd "$POS/apps/hub" && node -e '
    const D = require("better-sqlite3");
    const db = new D(process.argv[1], { readonly: true });
    console.table(db.prepare(process.argv[2]).all());
  ' "$M/hub/data/hub.sqlite" "$1")
}
EOF
source ~/pos-manual/env.sh; echo "$LAN_IP"
```

**You should see:** your Wi-Fi IPv4 address, e.g. `192.168.1.23`. The phone uses it.

---

## 2. Cloud: migrations and demo data

### 2a. Start the cloud (T1)

```sh
source ~/pos-manual/env.sh
cloud pnpm dev
```

`pnpm dev` is `tsx watch src/main.ts`. It runs the migrations, then listens on `0.0.0.0:4000` and logs JSON lines. It restarts by itself when you edit a source file.

```sh
curl -s localhost:4000/v1/health      # T3
```

**You should see:** a `{"data":{…}}` body.
**If not:** `JWT_SECRET must be at least 32 bytes` → you ran it without the `cloud` wrapper. `ECONNREFUSED 127.0.0.1:5433` → Postgres is down.

### 2b. Seed Arif Chatkhara (T3)

```sh
cloud pnpm -s seed-demo | tee $M/seed.txt
```

`seed-demo` (`apps/cloud/src/cli/seed-demo.ts`) writes the tenant and its **6 default roles** the same way `seed-tenant` does, and creates the branches **Gulberg, Johar Town and DHA** with `issue-registration-code`. Everything else goes through the owner API of the running cloud:

- floors and tables per branch (Gulberg: Ground G1–G5, Family Hall F1–F3, Rooftop R1–R2);
- stations (BBQ Grill and Karahi as slot stations; Tandoor with programs Naan and Roghni naan; Fryer with Fries 180; Drinks);
- a tax class "Sales tax 16%";
- 7 categories, Breakfast only 07:00–11:00;
- 13 items with routes per branch, several of them stock-tracked: Chicken biryani counted in kg, Raita and Soft drink kept overnight, DHA prices 10% higher;
- 8 staff (see the table above), with a Reports-to line from Zain to Ali.

**You should see:** `tenant_id …`, the owner login, three `branch … registration code XXXX…` lines, and the staff PINs. Codes are valid for 24 h.

```sh
pg -c "select version, name from schema_migrations order by version"
pg -c "select name, status from branches order by name"
pg -c "select name, default_key from roles order by name"
```

**You should see:** migrations `0001`–`0005`; three branches, all `pending_hub`; six roles (Cashier, Cook, Manager, Order taker, Owner, Waiter).
**If not:** `email already exists` → the database is already seeded; wipe it (step 8). `login failed … is the cloud running` → start T1 first.

---

## 3. Client builds

```sh
cd ~/pos && pnpm --filter @pos/client build
ls apps/client/dist/owner/index.html apps/client/dist/admin-stock/index.html
```

| Build | Served by | URL |
|---|---|---|
| `dist/owner/` | cloud (`apps/cloud/src/lib/client-dist.ts`) | `http://localhost:4000/owner/` |
| `dist/admin-stock/` | hub (`apps/hub/src/lib/client-dist.ts`) | `http://<LAN_IP>:3000/admin/stock/` |

Both servers read the files **once at start**, so **restart T1** after a build: press Ctrl+C, then `cloud pnpm dev`. (`tsx watch` does not watch `dist/`.) The hub isn't running yet.

---

## 4. Hub: register Gulberg and create the first admin

### 4a. Config and start (T2)

`pin_lockout_ms` is lowered to 2 minutes so step 7 doesn't take 15. The customer Wi-Fi range is a dummy that must **not** contain your Wi-Fi subnet.

```sh
source ~/pos-manual/env.sh
cat > "$POS_HUB_CONFIG" <<EOF
{
  "cloud_base_url": "http://127.0.0.1:4000",
  "http_port": 3000,
  "data_dir": "$M/hub/data",
  "backup_dir": "$M/hub/backup",
  "min_client_version": "0.0.0",
  "auth": { "pin_lockout_ms": 120000 }
}
EOF
chmod 600 "$POS_HUB_CONFIG"
cd "$POS/apps/hub" && pnpm dev
```

```sh
curl -s $HUB/health | jq .data.status       # T3: "setup"
```

### 4b. Register (laptop browser)

Open `http://localhost:3000/setup` and fill in:

| Field | Value |
|---|---|
| Registration code | Gulberg's code from `$M/seed.txt` |
| Hub address on this network | `$LAN_IP` |
| Customer Wi-Fi ranges (blocked) | `10.255.255.0/24` |

Press **Set up hub**.

**You should see:** "**Hub is set up**", a QR code and a link `http://<LAN_IP>:3000/admin/bootstrap#t=…` ("This link works for 30 min."). In T2 the hub **exits**, as designed (systemd restarts it in production). `tsx watch` does **not** start it again by itself: in T2 press **Ctrl+C**, then run `pnpm dev` (only that line: running the `cat > "$POS_HUB_CONFIG"` block again would erase the registration). Keep the setup tab open.

```sh
curl -s $HUB/health | jq '.data | {status, provisioned, confirmed}'      # ready, true, true
ids; echo "$TENANT $BRANCH"
pg -c "select name, status from branches order by name"                  # Gulberg active
```

For failures on this page, see 00 runbook §3b.

### 4c. First admin

Click the bootstrap link from 4b. It uses the `LAN_IP` host. **Keep using that host** in this tab: the admin session lives in its `sessionStorage`.

**You should see:** "**Sign in as the first admin**" with name tiles for everyone at Gulberg who has hub admin access: **Arif** and **Hamza** (Manager). Nobody else.
Tap **Arif**, enter `1234`, **Sign in** → "**Signed in as Arif**" and **Approve a screen**. Press it, then leave this tab on **Approve a screen**.

If the link has expired: `cd $POS/apps/hub && pnpm issue-admin-bootstrap` prints a new one.

### 4d. Pair the laptop browser as a cashier screen (for the stock page)

The stock page needs a paired **Cashier screen** in the same origin. In a **second tab** open `http://<LAN_IP>:3000/pair`, note the 6-character code, approve it in the first tab as **Cashier screen** with no station → "This screen is paired". Then open `http://<LAN_IP>:3000/admin/stock/` in that second tab and sign in as **Arif / 1234**.

**You should see:** within 60 s (the hub polls the cloud every 60 s), "Menu version N · checked just now" and the stock-tracked Gulberg items: Chicken tikka, Seekh kebab, Chicken biryani (kg), Fries, Raita, Soft drink 1.5 L. Rows without stock tracking show only the Available / Off switch. A **Start day** button sits on top. Tap **Start day** once.

---

## 5. Owner app on the laptop (English, then Urdu)

Open `http://localhost:4000/owner/` and sign in with `owner@arifchatkhara.pk` / `chatkhara-demo-1`. A wrong password shows "Email or password is wrong. Check them and try again."

Go through the screens. For each one, note anything that looks wrong (step "Findings" below).

| # | Screen | Do | You should see |
|---|---|---|---|
| 5.1 | Branch picker | open it | Gulberg, Johar Town, DHA **by name** |
| 5.2 | **Menu** (Gulberg) | browse; search "naan"; open Chicken biryani | 13 items in 7 categories; the search finds Naan and Roghni naan; biryani is in kg with 350 g per piece; Breakfast shows 07:00–11:00 |
| 5.3 | Menu (DHA) | switch branch, open Chicken tikka | DHA's price is 715 (650 + 10%) |
| 5.4 | **Floors and tables** | add table **G6**, 4 seats, on Ground; rename it to "G1" | G6 is added; renaming to G1 gives "That name is already used…" |
| 5.5 | **Stations** | open Tandoor | programs Naan 3 min and Roghni naan 4 min; a freshness window. BBQ Grill (slot) has neither field |
| 5.6 | **Branches** → Gulberg | read; open **Settings** | "Hub checked in … ago" and "Up to date … ago" for Gulberg; Johar Town and DHA show no hub yet. Settings: tax switch, stale-day hours 16, min gap 4 |
| 5.7 | **Staff** | filter Gulberg; switch Working here / Left | 6 people at Gulberg (Arif, Hamza, Usman, Ali, Zain, Faisal); filter Johar Town → Nadeem shows a **No PIN** chip |
| 5.8 | Staff → **Add** | name **Bilal**, role **Waiter**, branch **Gulberg**, Reports to **Ali**, save | Bilal appears in the list with "No PIN" |
| 5.9 | Bilal → **Set PIN** | enter `9999` twice | the chip goes; a mismatch is refused |
| 5.10 | **Roles** | open Waiter, then Cashier | six default roles with staff counts; Cashier: apply-discount "Needs approval" by Manager; Waiter idle 5 min |
| 5.11 | Roles → **New role** | name **Stock counter**, idle 15 min; grants: **Access hub admin** = Allowed (Branch), **Manage stock** = Allowed, Where = **My stations**. Save | the role is listed with 0 staff |
| 5.12 | Bilal → roles | add **Stock counter** next to Waiter, save | Bilal has two roles |
| 5.13 | **Stock counting** (Gulberg) | BBQ Grill: add person **Bilal**; save | the row keeps Bilal after a reload |
| 5.14 | **Teams** (Gulberg) | read | Ali with Zain and Bilal under him |
| 5.15 | **Change password** | wrong current password once; then change it to `chatkhara-demo-2`, sign out, sign in with it | wrong current → field error; success, then the new password works. **Put it back** to `chatkhara-demo-1` the same way (the seed output assumes it) |
| 5.16 | Urdu | open `http://localhost:4000/owner/?lang=ur`, revisit 5.2, 5.7, 5.10, 5.14 | right-to-left layout, Urdu labels; names and numbers stay readable. `?lang=en` switches back (the choice is remembered) |

---

## 6. The phone (same Wi-Fi)

### 6a. Reach the hub

On the phone, open `http://<LAN_IP>:3000/health`.

**You should see:** `{"data":{"status":"ready",…}}`.
**If not:** a timeout means the firewall is blocking port 3000. `sudo ufw status`; if it says active, run `sudo ufw allow 3000/tcp` (that's a system change: do it yourself if you agree). It can also mean the Wi-Fi isolates clients: use a phone hotspot, then re-source `env.sh` and redo 4a–4b with the new `LAN_IP`.

### 6b. Pair the phone

1. Phone: open `http://<LAN_IP>:3000/pair` → a 6-character code and a QR code.
2. Laptop: in the **Approve a screen** tab (4c), type the code, **Cashier screen**, no station, **Approve**.
3. Phone: within ~2 s, "**This screen is paired**".

### 6c. PIN login as Bilal, counting his station

On the phone, open `http://<LAN_IP>:3000/admin/stock/`.

**You should see:** the roster shows who can sign in to the stock page: Arif, Hamza and **Bilal** (Bilal has access through **Stock counter**; Zain and Usman don't). Bilal shows "Counts stock". If Bilal is missing, wait up to 60 s for the directory poll and reload.

Tap **Bilal**, enter `9999` on the PIN pad.

**You should see:**
- only **BBQ Grill** items: Chicken tikka and Seekh kebab (scope `my_stations`);
- **no** Start day, Close day or stale-day prompt (a counter can't run the day);
- a count works: Chicken tikka **20** → **Save counts** → "Counts saved." Back on the laptop's stock tab, the same 20 appears within 15 s.

Plain waiters have no screen of their own yet (ordering is module 02). To show that a PIN login works for one anyway:

```sh
# T3: Zain has no admin access, so the stock roster leaves him out; the device PIN login still accepts him.
REQ=$(curl -s -X POST $HUB/pair/requests -H 'content-type: application/json' -d '{"device_name":"curl-kiosk"}')
echo "$REQ" | jq -r .data.display_code     # approve it in the laptop tab as Cashier screen BEFORE running the next line
DEV=$(curl -s $HUB/pair/requests/$(echo "$REQ" | jq -r .data.request_id) -H "X-Poll-Secret: $(echo "$REQ" | jq -r .data.poll_secret)" | jq -r .data.device_token)
ZAIN=$(pg -At -c "select staff_id from staff where display_name='Zain'")
curl -s -X POST $HUB/auth/pin -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d "{\"staff_id\":\"$ZAIN\",\"pin\":\"5555\"}" | jq '.data | {display_name, idle_ttl_ms}'
```

**You should see:** `"display_name": "Zain"`, `"idle_ttl_ms": 300000` (the Waiter role's 5 minutes).

---

## 7. Real-world checks

### 7a. Wrong PIN, then lockout

On the phone, go back to the roster: reload `/admin/stock/`, or wait for the idle sign-out. Tap **Bilal** and enter **0000** five times.

**You should see:** "Wrong PIN" on each of the first four tries; the fifth locks Bilal ("locked", with a wait). The right PIN `9999` is now refused too. After **2 minutes** (`pin_lockout_ms` in 4a) `9999` works again.

The faster way out: on the laptop stock tab, signed in as Arif, use the manager clear if the page offers it, or see 00 runbook §5 for `ClearPinLockout`.

### 7b. Bilal leaves: his phone is signed out within about a minute

1. Phone: signed in as Bilal on `/admin/stock/`.
2. Laptop owner app: **Staff → Bilal → Left** (mark as left), save. Note the time.
3. Watch the phone.

**You should see:** within **≤ 75 s** (the hub's 60 s config poll, plus the page's 15 s refresh) the phone goes back to the roster with a signed-out message, and **Bilal is no longer listed**. In T2, a `config poll` line with `applied`. In the owner app, Bilal moves to **Left**; Stock counting no longer lists him on BBQ Grill (leaving removes his entries).

```sh
hubsql "select display_name, is_active from staff order by display_name"     # Bilal gone or inactive
```

### 7c. Power cut: kill the hub, restart, data survives

```sh
curl -s $HUB/health | jq .data.max_seq            # note it
```

In T2, press **Ctrl+C** (no graceful shutdown). On the open phone stock tab you should see the hub-unreachable state. Start the hub again (`pnpm dev`), then:

```sh
curl -s $HUB/health | jq '.data | {status, max_seq}'     # max_seq = old + 1 (HubStarted)
hubsql "select event_type, count(*) n from events group by event_type order by n desc"
```

**You should see:** the phone recovers by itself. Chicken tikka is still **20**, the business day is still open, and both paired devices still work without pairing again.

### 7d. Owner app at phone width (390 px)

Two ways, do both:

- Laptop Chrome: open DevTools (F12), turn on the device toolbar (Ctrl+Shift+M) and set **390 × 844**. Reload `http://localhost:4000/owner/`.
- Real phone: open `http://<LAN_IP>:4000/owner/` (the cloud listens on all interfaces) and sign in.

**You should see:** a menu button instead of the side nav; short labels ("Floors", "Stations"); no sideways scrolling on Menu, Staff, the role editor and Branches; the **Set PIN** dialog uses the PIN pad. Repeat once with `?lang=ur`.

---

## 8. Stop, wipe, start fresh

**Stop:** press Ctrl+C in T2 (hub), then T1 (cloud). Postgres keeps running; `docker stop pos-pg-test` stops it too, but other projects' tests may use it.

**Wipe:**

```sh
rm -rf ~/pos-manual/hub ~/pos-manual/seed.txt
docker exec pos-pg-test dropdb -U pos --if-exists pos_manual
docker exec pos-pg-test createdb -U pos pos_manual
mkdir -p ~/pos-manual/hub/data ~/pos-manual/hub/backup
```

On the phone, clear the site data for `<LAN_IP>` (Chrome: ⋮ → Settings → Site settings → All sites → `<LAN_IP>` → Delete data), or its old device token comes back. Then start again at **2a**. Keep `~/pos-manual/env.sh`.

**If not:** `database "pos_manual" is being accessed by other users` → the cloud is still running; stop T1.

---

## Findings

Anything that looks broken goes in `docs/reviews/manual-test-findings.md` as **screen, what I did, what I saw, what I expected**. Findings are not fixed during the test run.
