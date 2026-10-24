# Module 00 — manual test runbook

Hand test of spec 00 (Hub Platform & Access) on one Ubuntu laptop and one phone on the same Wi-Fi. It changes no code. The cloud and the hub run from the repo with `tsx`; all hub data lives under `~/pos-manual`, never `/opt` or `/etc`.

You need three terminals:

| Terminal | Runs |
|---|---|
| **T1** | cloud |
| **T2** | hub |
| **T3** | CLIs, `curl` and checks |

> **What 00 can and cannot show on the phone.** 00 serves four pages (`/setup`, `/admin/bootstrap`, `/admin/approve`, `/pair`), styled with the UI kit from `/ui/*` (spec v1.2, M81 and M82). All their text comes from the English table in `apps/hub/src/lib/strings.ts`; the quotes below are copied from it. There is no login screen yet: after pairing, the screen says **"This screen is paired"** / "You can log in here next." and stops there. So the PIN tests (step 5) and the revoke check (step 6) run with `curl` as a second, simulated kiosk on the laptop. Step 6 explains why a revoked phone does **not** visibly get kicked in 00.

---

## 1. Prerequisites, install, build

```sh
node -v            # must be v22.x (package.json engines: >=22 <23)
corepack enable    # gives the pinned pnpm 12.15.0
pnpm -v
sudo apt install -y jq curl
docker --version
```

Start Postgres 16 on port 5433 and create a **separate** database for manual testing. The cloud test suite runs `TRUNCATE` on `pos_test`, so don't keep manual data there.

```sh
cd ~/pos
docker compose up -d postgres
docker compose exec postgres pg_isready -U pos          # "accepting connections"
docker compose exec postgres createdb -U pos pos_manual
```

Install and check:

```sh
cd ~/pos
pnpm install
pnpm typecheck
```

There is **no build step**: both apps run TypeScript directly through `tsx` (that's how `apps/hub/deploy/hub.service` runs it too). `pnpm typecheck` is the closest thing to a build.

Set up the shell helpers. Put this in `~/pos-manual/env.sh` and run `source ~/pos-manual/env.sh` in **every** terminal:

```sh
mkdir -p ~/pos-manual/hub/data ~/pos-manual/hub/backup
cat > ~/pos-manual/env.sh <<'EOF'
export POS=$HOME/pos
export M=$HOME/pos-manual
export HUB=http://127.0.0.1:3000
export POS_HUB_CONFIG=$M/hub/config.json
export LAN_IP=$(ip -4 route get 1.1.1.1 | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')

# Cloud env is passed per command, NOT exported: a DATABASE_URL left in the
# shell would make `pnpm test` truncate pos_manual.
cloud() {
  (cd "$POS/apps/cloud" && \
   DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_manual \
   JWT_SECRET=manual-test-jwt-secret-0123456789abcdef \
   REFRESH_TOKEN_SECRET=manual-test-refresh-secret-0123456789ab \
   PORT=4000 HUB_MIN_VERSION=0.0.0 "$@")
}

# Read the provisioned ids from the hub config.
ids() {
  export TENANT=$(jq -r .provisioned.tenant_id "$POS_HUB_CONFIG")
  export BRANCH=$(jq -r .provisioned.branch_id "$POS_HUB_CONFIG")
}

# admin_cmd <CommandType> '<payload json>'  (needs $ADMIN, $STAFF, ids)
admin_cmd() {
  local path; path=$(echo "$1" | sed -E 's/([a-z0-9])([A-Z])/\1-\2/g' | tr A-Z a-z)
  curl -s -X POST "$HUB/admin/commands/$path" \
    -H 'content-type: application/json' -H "x-admin-session: $ADMIN" \
    -d "$(jq -nc --arg t "$1" --argjson p "$2" --arg tid "$TENANT" --arg bid "$BRANCH" \
          --arg a "$STAFF" --arg id "$(cat /proc/sys/kernel/random/uuid)" --argjson now "$(date +%s%3N)" \
          '{command_id:$id, tenant_id:$tid, branch_id:$bid, command_type:$t, payload:$p,
            occurred_at:$now, actor_id:$a, device_id:"hub-admin"}')" | jq
}

# Last N hub events (default 15), read-only.
events() {
  (cd "$POS/apps/hub" && node -e '
    const D = require("better-sqlite3");
    const db = new D(process.argv[1], { readonly: true });
    const n = Number(process.argv[2] || 15);
    console.table(db.prepare("SELECT seq, event_type, recorded_at FROM events ORDER BY seq DESC LIMIT ?").all(n).reverse());
  ' "$M/hub/data/hub.sqlite" "$1")
}
EOF
source ~/pos-manual/env.sh
echo "$LAN_IP"     # e.g. 192.168.0.107: the address the phone will use
```

**You should see:** `typecheck` passes for all packages; `echo $LAN_IP` prints your Wi-Fi IPv4 address.

**Most likely failure:** `createdb: database "pos_manual" already exists` → fine, carry on (or wipe it, step 9). `pg_isready` says "no response" → port 5433 is taken by another container: `docker ps`, stop it, then `docker compose up -d postgres` again.

---

## 2. Start the cloud, then the hub

### 2a. Cloud (T1)

```sh
source ~/pos-manual/env.sh
cloud node --import tsx src/main.ts
```

It runs the migrations, then listens on `0.0.0.0:4000`. Check from T3:

```sh
curl -s http://127.0.0.1:4000/v1/health | jq
```

**You should see:** a `{ "data": … }` health body.
**Most likely failure:** the process exits with `JWT_SECRET must be at least 32 bytes` or `ECONNREFUSED 127.0.0.1:5433` → you ran `node` without the `cloud` wrapper, or Postgres is down (`docker compose up -d postgres`).

### 2b. Hub config (T3)

The hub needs a config file before its first boot. `pin_lockout_ms` is lowered to 2 minutes so step 5 doesn't take 15 (the default is 900 000).

```sh
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
```

### 2c. Hub (T2)

```sh
source ~/pos-manual/env.sh
cd "$POS/apps/hub" && node --import tsx src/main.ts
```

An unprovisioned hub prints nothing (its setup mode has no logger). Check from T3:

```sh
curl -s $HUB/health | jq .data.status          # "setup"
```

### 2d. The hub URL from the phone

The phone uses `http://<LAN_IP>:3000`, e.g. `http://192.168.0.107:3000`. Before provisioning, the hub only accepts its own IPs in the `Host` header; after provisioning it accepts `localhost`, `127.0.0.1` and the `advertised_host` you set in step 3.

```sh
echo "http://$LAN_IP:3000/health"
sudo ufw status            # if "active": sudo ufw allow 3000/tcp
```

Open that `/health` URL in the phone browser.

**You should see:** `{"data":{"status":"setup",…}}` on the phone.
**Most likely failure:** the phone times out → the firewall is blocking 3000 (`sudo ufw allow 3000/tcp`), or the Wi-Fi has client/AP isolation (common on guest and office networks; use a phone hotspot with the laptop connected to it instead, and re-run `source ~/pos-manual/env.sh` to pick up the new `LAN_IP`). `HOST_NOT_ALLOWED` → you typed a hostname instead of the IP.

---

## 3. Provisioning and admin bootstrap

### 3a. Seed a tenant and issue a registration code (T3)

`seed-tenant` asks for the owner's password (8–200 chars) and PIN (4–6 digits), each twice, with no echo. **Remember the PIN**: it's the admin PIN for the rest of this run.

```sh
cloud node --import tsx src/cli/seed-tenant.ts \
  --name "Manual Test" --currency PKR \
  --owner-email owner@example.com --owner-name "Test Owner"
```

**You should see:** three lines, `tenant_id …`, `user_id …`, `staff_id …`. Save them:

```sh
export STAFF=<staff_id from above>
cloud node --import tsx src/cli/issue-registration-code.ts --tenant-id <tenant_id> --branch-name "Main"
```

**You should see:** one 12-character code (Crockford, e.g. `7K3QZ…`), valid for 24 h.
**Most likely failure:** `email already exists` → this database was seeded before; use another email or wipe (step 9). `pin must be 4 to 6 digits` → re-run.

### 3b. Provision the hub

On the **laptop** browser, open `http://localhost:3000/setup` and fill in:

| Field (label on the page) | Value |
|---|---|
| Registration code | the code from 3a (dashes and spaces are OK) |
| Hub address on this network | the value of `$LAN_IP` |
| Guest Wi-Fi networks | `10.255.255.0/24`: a dummy subnet. At least one CIDR is required, and it must **not** contain your Wi-Fi subnet, or the phone is treated as a guest and refused |

Press **Set up hub**.

**You should see:** the button shows a spinner. If the cloud is slow, a banner says "Still talking to the cloud. This can take up to 10 seconds." after 3 s. Then the form is replaced by a check mark, **"Hub is set up"**, "The hub is restarting. Scan the code to create the first admin.", a QR code, the link `http://<LAN_IP>:3000/admin/bootstrap#t=…` and "This link works for 30 min." The hub in T2 **exits by itself**: that's by design, and in production systemd restarts it. Don't close the tab: you need the link.

On an error, a red banner appears above the button and the faulty field turns red. To see the raw error code, run the same request from T3:

```sh
curl -s -X POST localhost:3000/setup/provision -H 'content-type: application/json' \
  -d "{\"registration_code\":\"<code>\",\"advertised_host\":\"$LAN_IP\",\"guest_network_cidrs\":[\"10.255.255.0/24\"]}" | jq
```

**Most likely failures:**
- "The hub is busy or cannot reach the cloud. Try again in a few seconds." (`SERVICE_UNAVAILABLE`) → the cloud (T1) isn't running.
- "Check the highlighted field." with **Hub address on this network** in red, saying "This is not an address of this hub. Use its IP on this network." (`VALIDATION_FAILED` on `advertised_host`) → wrong or stale `$LAN_IP`.
- "This code does not work. It may be used or expired. Ask for a new code." (`REGISTRATION_CODE_INVALID`) → typo, expired or already used. Issue a fresh code for the same branch: `cloud node --import tsx src/cli/issue-registration-code.ts --tenant-id <tenant_id> --branch-id <branch_id>`.

### 3c. Restart the hub as provisioned (T2)

```sh
node --import tsx src/main.ts
```

The hub now logs JSON lines. From T3:

```sh
curl -s $HUB/health | jq '.data | {status, provisioned, confirmed, branch_id, max_seq}'
ids; echo "$TENANT $BRANCH"
```

**You should see:** `status: "ready"`, `provisioned: true`, `confirmed: true` (the hub confirms itself with the cloud right at boot), and a small positive `max_seq`.
**Most likely failure:** `confirmed: false` and T2 logs `hub confirm failed` → the cloud is down; start T1, and the hub retries every 60 s.

### 3d. First admin, in the browser

On the **laptop**, click the `first_admin_url` link from 3b (it uses the `LAN_IP` host; keep using that host, not `localhost`, because the admin session lives in that origin's `sessionStorage`).

**You should see:** **"Sign in as the first admin"**, "Tap your name, then enter your PIN.", a name tile **Test Owner** under "Your name", a PIN field and a **Sign in** button. The `#t=…` disappears from the address bar.

Tap **Test Owner** (the tile gets a saffron underline), type your PIN (it shows as dots), then **Sign in**. Signing in without a tile gives "Tap your name first."; a wrong PIN gives a red banner "Wrong PIN. Try again." and clears the field.

**You should see:** a check mark, **"Signed in as Test Owner"**, "Approve the screens next. Stay in this tab: your sign-in works here only." and an **Approve a screen** button. Press it: it opens `/admin/approve` in the same tab.

**You should see:** **"Approve a screen"**, "Type the code shown on the new screen." and a form with **Code on the screen**, **Screen type** (Cashier screen / Kitchen screen), **Station** and **Approve**. Leave this tab open for step 4.
**Most likely failures:** the page shows a clock icon and **"This link has expired"** / "Ask the installer for a new sign-in link." → the token expired (30 min), was already used, or was replaced by a newer one; issue a new one with the CLI (3e) and open that URL. The approve page shows a lock icon and **"Use an admin screen"** / "Open this page on a paired admin screen and type the code there." → you opened it in a new tab or on another host, so `sessionStorage` is empty; sign in through a fresh bootstrap URL in this tab.

### 3e. Admin bootstrap CLI, plus a `curl` admin session (T3)

`issue-admin-bootstrap` is the recovery path when no admin can log in (§3, M42). Each run **expires any unused bootstrap token**, so run it only after 3d's sign-in is done.

```sh
cd "$POS/apps/hub" && pnpm issue-admin-bootstrap
```

**You should see:** the URL `http://<LAN_IP>:3000/admin/bootstrap#t=…`, its expiry as an ISO time, and a QR code in the terminal.

Now use a fresh token to get an admin session for `curl` (steps 5–6 need it):

```sh
read -rsp 'PIN: ' PIN; echo
BOOT=$(cd "$POS/apps/hub" && node --import tsx src/setup/issue-admin-bootstrap.ts | head -1 | sed 's/.*#t=//')
export ADMIN=$(curl -s -X POST $HUB/admin/auth/bootstrap -H 'content-type: application/json' \
  -d "{\"bootstrap_token\":\"$BOOT\",\"staff_id\":\"$STAFF\",\"pin\":\"$PIN\"}" | jq -r .data.admin_session_token)
echo "$ADMIN"
curl -s $HUB/admin/queries/devices -H "x-admin-session: $ADMIN" | jq
```

**You should see:** a 64-character hex token, then `{"data":{"devices":[]}}`.
**Most likely failures:** `run setup instead` → `POS_HUB_CONFIG` isn't set (re-source `env.sh`) or the hub isn't provisioned. `refusing to run as uid 0` → you used `sudo`; run it as yourself (the data dir is yours). `ADMIN` is `null` → wrong PIN or `STAFF`; print the body without `jq -r` to see the error code.

### 3f. UI kit route, from the phone (M81)

On the **phone**, open `http://<LAN_IP>:3000/ui/tokens.css`.

**You should see:** **200**: plain CSS starting with `/* POS — generated from tokens.json */` and `@font-face { font-family: "Atkinson Hyperlegible"; …`.

Then open `http://<LAN_IP>:3000/ui/../package.json` on the phone.

**You should see:** **404** with `{"error":{"code":"ROUTE_NOT_FOUND",…}}`. A browser collapses `/ui/../` before sending, so what the phone actually requests is `/package.json`. To send the literal traversal path, and to check the cache header, run this from T3:

```sh
curl -s -o /dev/null -w '%{http_code}\n' --path-as-is "http://$LAN_IP:3000/ui/../package.json"    # 404
curl -s -o /dev/null -w '%{http_code}\n' "http://$LAN_IP:3000/ui/README.md"                         # 404 (only .css and .woff2 are served)
curl -sI "http://$LAN_IP:3000/ui/fonts/AtkinsonHyperlegible-400.woff2" | grep -i 'content-type\|cache-control'
# content-type: font/woff2
# cache-control: public, max-age=31536000, immutable
```

**Most likely failure:** `tokens.css` is 404 → the hub runs from a checkout without `packages/ui-kit/` (it was added with spec v1.2); `git pull` and restart the hub. The pages then look unstyled (plain browser forms) for the same reason.

---

## 4. Pair the phone by display code

On the **phone**, open `http://<LAN_IP>:3000/pair`.

**You should see:** a dark screen with **"Ask a manager to pair this screen"** and "Getting a code from the hub." briefly, then a QR code on a white tile, the **6-character display code** in large letters with a saffron underline, "The manager types this code, or scans the QR code with their phone." and "This code works for 10 min." The page polls the hub every 2 s.

On the **laptop**, in the `/admin/approve` tab from 3d: type the display code into **Code on the screen**, keep **Screen type** on **Cashier screen**, leave **Station** empty, then **Approve**.

**You should see:** the laptop shows a check mark, **"Screen approved"**, "The screen opens by itself in a few seconds." and an **Approve another screen** button. Within about 2 s the phone shows a check mark and **"This screen is paired"** / "You can log in here next." (the device token is now in the phone's IndexedDB). In T3:

```sh
curl -s $HUB/admin/queries/devices -H "x-admin-session: $ADMIN" | jq '.data.devices[] | {device_id, device_name, device_type}'
export PHONE_ID=<device_id of the "screen" row>
```

Don't choose **Kitchen screen** (`kds`): it needs a station, and stations arrive with module 01, so in 00 it always fails with `STATION_NOT_FOUND`.

**Most likely failures:**
- The approve form shows a red banner "No screen is waiting with this code. Check the code on the screen." (`PAIRING_REQUEST_NOT_FOUND`) and stays filled in → code typo, the request expired (10 min), or two pending requests share the code. Fix the code or reload the phone page for a new one.
- The phone stays on "Getting a code from the hub." (it waits once, silently, until the oldest request expires), then shows "Too many tries from this device. Wait, then try again." and a **Get a new code** button (`IP_LOCKED_OUT`) → each phone IP may hold only **2 pending** requests, and every reload of `/pair` makes a new one. Approve one, or wait 10 minutes. An expired code shows "The code expired. Get a new one." with the same button.
- To approve again, press **Approve another screen** (the session survives in the same tab).

---

## 5. PIN login, wrong PIN, lockout, reset

The phone has no login screen in 00, so pair a **simulated kiosk** from T3 the same way the phone page does, then use its token:

```sh
REQ=$(curl -s -X POST $HUB/pair/requests -H 'content-type: application/json' -d '{"device_name":"curl-kiosk"}')
echo "$REQ" | jq '.data | {display_code, request_id}'
```

Approve that display code in the `/admin/approve` tab (reload it first), Type `cashier_kiosk`. Then collect the device token:

```sh
export DEV=$(curl -s $HUB/pair/requests/$(echo "$REQ" | jq -r .data.request_id) \
  -H "X-Poll-Secret: $(echo "$REQ" | jq -r .data.poll_secret)" | jq -r .data.device_token)
echo "$DEV"
pin() { curl -s -X POST $HUB/auth/pin -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d "{\"staff_id\":\"$STAFF\",\"pin\":\"$1\"}" | jq -c; }
```

**Good PIN:**

```sh
pin "$PIN"
```

You should see `{"data":{"session_token":"…","session_id":"…","staff_id":"…","display_name":"Test Owner","idle_ttl_ms":3600000,…}}`.

**Wrong PIN, five times** (use a PIN that isn't yours):

```sh
for i in 1 2 3 4 5; do pin 0000; done
```

You should see five `PIN_INVALID` errors (HTTP 401) with `"attempts_remaining"` going **4, 3, 2, 1, 0**. The fifth locks the staff member.

**Locked:**

```sh
pin "$PIN"
curl -s $HUB/queries/staff-roster -H "authorization: Bearer $DEV" | jq '.data.staff'
```

You should see `PIN_LOCKED_OUT` (HTTP 429) with `retry_after_ms` up to 120000, **even with the right PIN**, and the roster shows a `locked_until` for the owner. The lock is on the staff member, not the device: another device would be refused too.

**Reset, two ways:**
1. Wait it out: after `pin_lockout_ms` (2 min in this config) `pin "$PIN"` works again and the counter restarts.
2. Manager clear, now:

```sh
admin_cmd ClearPinLockout "{\"subject_type\":\"staff\",\"subject_id\":\"$STAFF\"}"
pin "$PIN"
```

You should see `"result":{"subject_type":"staff",…,"cleared":true}` and then a 200 login. Running the clear again gives `cleared: false` (nothing locked).

**Device lockout (optional):** the device has its own counter, 10 failures within 5 min → `DEVICE_LOCKED_OUT`. Five wrong PINs above already counted, so five more trip it. Clear it with `admin_cmd ClearPinLockout "{\"subject_type\":\"device\",\"subject_id\":\"<curl-kiosk device_id>\"}"`.

**Most likely failures:** `DEVICE_TOKEN_INVALID` → `DEV` is `null` because you polled before approving; poll again (it works until the request expires). `ADMIN_SESSION_REQUIRED` from `admin_cmd` → the admin session idled out (1 h for Owner) or `ADMIN` is unset in this shell; redo 3e. Note that 3e needs the PIN, so clear a lockout **before** your admin session expires, or wait out the 2 minutes.

---

## 6. Revoke a device

Get a session on the simulated kiosk, then revoke it:

```sh
export SES=$(curl -s -X POST $HUB/auth/pin -H "authorization: Bearer $DEV" -H 'content-type: application/json' \
  -d "{\"staff_id\":\"$STAFF\",\"pin\":\"$PIN\",\"takeover\":true}" | jq -r .data.session_token)
KIOSK_ID=$(curl -s $HUB/admin/queries/devices -H "x-admin-session: $ADMIN" | jq -r '.data.devices[] | select(.device_name=="curl-kiosk") | .device_id')
admin_cmd RevokeDevice "{\"device_id\":\"$KIOSK_ID\",\"reason\":\"manual test\"}"
pin "$PIN"
curl -s $HUB/queries/session -H "authorization: Bearer $DEV" -H "x-session-token: $SES" | jq -c
```

**You should see:** `"already_revoked":false`, then **`403 DEVICE_REVOKED`** for both the login and the session query: the revoke ended the device's session in the same transaction. Revoking again returns `already_revoked: true`. `events 5` shows `SessionEnded` and `DeviceRevoked`.

Now revoke the phone:

```sh
admin_cmd RevokeDevice "{\"device_id\":\"$PHONE_ID\"}"
curl -s "$HUB/admin/queries/devices?include_revoked=true" -H "x-admin-session: $ADMIN" | jq '.data.devices[] | {device_name, revoked_at}'
```

**You should see:** both devices have a `revoked_at`.

**On the phone: nothing changes, and that's expected in 00.** Spec 00 §8.2 says that on reload a kiosk page with a stored token "goes to login" without calling the hub; only KDS calls `/auth/station`, which wipes the token on `401/403` and starts a new pairing request. The 00 page has no login screen, so a revoked kiosk keeps showing "This screen is paired" until it makes an authenticated call. The "This device must be paired again" behaviour (§8.4) lives in the login and command UI of the later client modules. KDS can't be paired in 00 (no stations), so the only proof in 00 is the `403 DEVICE_REVOKED` above. To make the phone pair again, clear its site data (Chrome on Android: ⋮ → Settings → Site settings → All sites → `<LAN_IP>` → Delete data) or use an Incognito tab.

**Most likely failure:** `DEVICE_NOT_FOUND` → wrong device id; list the devices with `include_revoked=true`.

---

## 7. Kill the hub mid-session, and the page recovers (S2)

This is build review 3 item S2: the pair page must retry when the hub is unreachable, not die.

1. On the phone, open a **new Incognito tab** at `http://<LAN_IP>:3000/pair`. You should see a fresh display code. Don't approve it yet.
2. In T2, press **Ctrl+C** to stop the hub (no graceful shutdown, like a power cut).
3. Watch the phone. **You should see:** within about 2 s, a banner appears at the top with a spinning sync icon: **"Cannot reach the hub. Retrying."** / "Keep this screen open. It reconnects by itself." The code stays on screen. The page keeps retrying with backoff (0.5, 1, 2, 4, then every 5 s).
4. Restart the hub in T2: `node --import tsx src/main.ts`.
5. **You should see:** within about 5 s the banner disappears and the code stays; the request survived the restart because it lives in SQLite.
6. Reload the laptop `/admin/approve` tab (the admin session survived the restart too), approve the phone's code as **Cashier screen**, and the phone shows **"This screen is paired"**.

**Most likely failures:** the phone shows a browser error page → you reloaded the page while the hub was down; the page itself is served by the hub, so only an **already-open** page can retry. Start again at 1. Approve shows "You were signed out. Sign in again." (`ADMIN_SESSION_REQUIRED`) → the admin session idled out; get a new bootstrap URL (3e) and sign in again in that tab.

---

## 8. Hub restart: events survive, `seq` keeps going

```sh
curl -s $HUB/health | jq .data.max_seq     # note it, e.g. 31
events 10
```

Stop the hub (Ctrl+C in T2), restart it, then:

```sh
curl -s $HUB/health | jq '.data | {status, max_seq}'
events 10
curl -s "$HUB/admin/queries/devices?include_revoked=true" -H "x-admin-session: $ADMIN" | jq '.data.devices | length'
```

**You should see:**
- `max_seq` is the old value **+ 1**: the new boot appended exactly one `HubStarted`. The table shows `seq` running on with no gap and no restart from 1, and every earlier event (`DevicePaired`, `DeviceRevoked`, `StaffPinLockedOut`, …) is still there.
- The device count is unchanged; revoked devices are still revoked (their tokens still get `403 DEVICE_REVOKED`).
- The `curl` admin session still works: sessions are rows in SQLite, not memory.

**Most likely failures:** `max_seq` went up by more than 1 → something wrote while you were checking (a device poll can't write, but a pairing request or login can); compare with `events` instead. `SQLITE_BUSY` from `events` → rare while the hub writes; run it again.

---

## 9. Wipe everything and start fresh

```sh
# T1 and T2: Ctrl+C to stop the cloud and the hub. Then in T3:
rm -rf ~/pos-manual/hub
docker compose -f ~/pos/docker-compose.yml exec postgres dropdb -U pos --if-exists pos_manual
docker compose -f ~/pos/docker-compose.yml exec postgres createdb -U pos pos_manual
mkdir -p ~/pos-manual/hub/data ~/pos-manual/hub/backup
unset ADMIN DEV SES STAFF TENANT BRANCH PHONE_ID BOOT PIN
```

Then redo step 2b (the config file) and carry on from 2c. Keep `~/pos-manual/env.sh`.

On the phone, clear the site data for `<LAN_IP>` (step 6) and close any Incognito tabs, or the old device token in IndexedDB comes back.

To also reset Postgres completely, including `pos_test`: `docker compose -f ~/pos/docker-compose.yml down -v && docker compose -f ~/pos/docker-compose.yml up -d postgres`, then `createdb` as above.

**Most likely failure:** `dropdb: database "pos_manual" is being accessed by other users` → the cloud is still running; stop T1 first.
