# Tablet soak tools (05b §10.4) — hub bring-up and commands

Ported from the lock-alerts spike (`spike/lock-alerts/scripts`). Node 22, no npm dependencies, outside the product gate
(`/* eslint-disable */` headers). `devices/` and `logs/` hold device tokens and logs. They are git-ignored, so never
commit them. Results go into `docs/plans/05b-manual-checks.md` (S1–S7).

| Script | Does |
|---|---|
| `mint-tablet-token.mjs` | Admin session → `GenerateDevicePairingToken { device_type: 'tablet' }` → `POST /devices/pair` → `devices/<label>.json` (for the sender and the control socket; the tablet under test pairs itself) |
| `fire.mjs` | Signs a `manage-devices` person in on the **sender** device (`POST /auth/pin`) and loops `SendTestAlert { target: { kind: 'device' } }` → `logs/fire-<label>.jsonl` |
| `control-socket.mjs` | A laptop alert-mode socket that behaves like `AlertService` (receipts, dedupe, backoff, 10 s first-frame timeout) and writes the device-log JSONL format |
| `analyse.mjs` | Fire log + device log → the results row, a missed list and a late list. Optionally checks `alert-receipts` on the hub |
| `skew.mjs` | Hub clock (`pos-hub-now-ms` on `GET /staff/`) minus device clock (`adb shell date +%s%3N`) |
| `log-receiver.mjs` | Receives a log POSTed over the LAN and prints the skew at upload. The 05b app has no upload (M-19: read with adb); kept for a debug build that posts its log |

**Device log (M-19).** The app writes its native JSONL log (the spike's event names, `alert_received` etc.) in its
files dir, rotated at 5 MB into 2 files. A **debug** build can be read with `run-as`; a release (device-owner) build
cannot — soak with the debug APK from `tablet.yml`, or pull a bug report:

```sh
adb exec-out run-as pk.arifchatkhara.pos ls files            # find the log file name(s), e.g. the current one and the rotated one
adb exec-out run-as pk.arifchatkhara.pos cat files/<log>.jsonl > logs/tablet-a-S1.jsonl   # rotated file first, then the current one, if the run spans both
```

## A. On the owner's real hub (normal case)

You need two minted device tokens plus the paired tablet. Each one is a separate device row, because there is only one alert-mode socket per device:

| Label | Used by |
|---|---|
| `tablet-a` (and `tablet-b`) | the tablet(s) under test. They pair themselves through the app (pair by request, 05b M-16); take the `device_id` from `#/devices` and pass `fire.mjs --device <device_id>` |
| `sender` | `fire.mjs` signs a manager in on it |
| `control` | `control-socket.mjs` on the laptop, and `analyse.mjs --receipts` |

**Admin session.** Open `http://<hub>:3000/admin` on the laptop, sign in as Arif (or any hub admin), then run this in DevTools → Console:

```js
[sessionStorage.admin_session_token, sessionStorage.admin_staff_id]
```

Then, from `tools/tablet-soak`:

```sh
H=http://<hub-ip>:3000; AS=<admin_session_token>; ST=<admin_staff_id>
node mint-tablet-token.mjs --hub $H --admin-session $AS --staff $ST --sender
node mint-tablet-token.mjs --hub $H --admin-session $AS --staff $ST --label control
# no admin tab? use a bootstrap link instead: pnpm --filter @pos/hub issue-admin-bootstrap → the hex after #t=
#   node mint-tablet-token.mjs --hub $H --bootstrap <hex> --staff Arif --pin 1234 --sender
# (single use; the output prints an --admin-session … --staff … pair to reuse for the next mints)
```

**Per soak run** (example S1; skew at start and end):

```sh
node skew.mjs --hub $H                                   # tablet on USB; note skew_ms
node control-socket.mjs --device devices/control.json --quiet &      # baseline
node fire.mjs --sender devices/sender.json --device <tablet-a device_id> --staff Arif --pin 1234 \
  --label S1 --interval-s 60 --jitter-s 20 --duration-h 8 --quiet       # S2: --duration-h 4
node skew.mjs --hub $H                                   # again; use the mean, report the drift
adb exec-out run-as pk.arifchatkhara.pos cat files/<log>.jsonl > logs/tablet-a-S1.jsonl   # see "Device log" above
node analyse.mjs --fire logs/fire-S1.jsonl --device logs/tablet-a-S1.jsonl --label S1 --run R1 --skew-ms <mean> \
  [--outage <stopMs>,<readyMs>]... --receipts devices/control.json --staff Arif --pin 1234
node analyse.mjs --fire logs/fire-S1.jsonl --device logs/control.jsonl --label S1-control   # the baseline row
```

- S7 burst: `node fire.mjs … --label S7 --burst 30`.
- Outages (S3, S4): note `date +%s%3N` when you stop the hub or the router, and again when `/health` says `ready` or the Wi-Fi is back. Pass them as `--outage start,end`.

## B. Local dev hub (how this was tested, in a cloud session; no Docker)

```sh
cd ~/pos
bash tools/cloud/environment-setup.sh            # Postgres 16 on 5433 (skip if already set up)
service postgresql start
pnpm install --frozen-lockfile
PGPASSWORD=pos psql -h 127.0.0.1 -p 5433 -U pos -d postgres -c "create database pos_soak"
pnpm --filter @pos/client build                  # /staff/ (needed for skew.mjs's pos-hub-now-ms)
mkdir -p /tmp/soakhub/data /tmp/soakhub/backup

# cloud on :4000
cat > /tmp/soakhub/cloud.sh <<'EOF'
cd ~/pos/apps/cloud
export DATABASE_URL=postgres://pos:pos@127.0.0.1:5433/pos_soak JWT_SECRET=manual-test-jwt-secret-0123456789abcdef REFRESH_TOKEN_SECRET=manual-test-refresh-secret-0123456789ab PORT=4000 HUB_MIN_VERSION=0.0.0
exec "$@"
EOF
chmod +x /tmp/soakhub/cloud.sh
nohup /tmp/soakhub/cloud.sh node --import tsx src/main.ts > /tmp/soakhub/cloud.log 2>&1 &
/tmp/soakhub/cloud.sh pnpm -s seed-demo | tee /tmp/soakhub/seed.txt      # Gulberg registration code, PINs (Arif 1234)

# hub on :3000
cat > /tmp/soakhub/config.json <<'EOF'
{ "cloud_base_url": "http://127.0.0.1:4000", "http_port": 3000, "data_dir": "/tmp/soakhub/data",
  "backup_dir": "/tmp/soakhub/backup", "min_client_version": "0.0.0" }
EOF
chmod 600 /tmp/soakhub/config.json
(cd apps/hub && POS_HUB_CONFIG=/tmp/soakhub/config.json nohup node --import tsx src/main.ts > /tmp/soakhub/hub.log 2>&1 &)
IP=$(hostname -I | awk '{print $1}')
curl -s -X POST localhost:3000/setup/provision -H 'content-type: application/json' \
  -d "{\"registration_code\":\"<Gulberg code without dashes>\",\"guest_network_cidrs\":[\"10.255.255.0/24\"],\"advertised_host\":\"$IP\"}"
# the hub exits after provisioning (systemd restarts it in production): start it again with the same line, then
curl -s localhost:3000/health                    # "ready"; wait ~60 s for the first config pull (directory)
(cd apps/hub && POS_HUB_CONFIG=/tmp/soakhub/config.json pnpm -s issue-admin-bootstrap) | grep -o '#t=[0-9a-f]*'
```

Then section A with `H=http://127.0.0.1:3000 --bootstrap <hex> --staff Arif --pin 1234`.

## Reference: the spike's dry run on the dev hub (control socket as the stand-in tablet), 2026-11-23

| Run | What | Fired | Received / notified | Hub receipts | Missed | Dupes | p50 / p95 / max ms |
|---|---|---|---|---|---|---|---|
| dry2 | 10 alerts, 2 s apart | 10 | 10 / 10 | 10 | 0 | 0 | 2 / 4 / 4 |
| S3 | 25 alerts, hub SIGTERM + restart mid-run (≈9 s down) | 21 ok, 4 refused while down | 21 / 21 | 20 of 20 checked | 0 | 0 (5 `alerts_open` re-sends dropped by dedupe) | 3 / 362 / 2374; reconnect 2.5 s after hub ready |
| S7 | burst of 30 | 30 | 30 / 30 | — | 0 | 0 | 2 / 6 / 7 |

- The hub's `delivered` receipt `at` trails `raised_at` by about 1,005 ms, which is the A11 1 s batch. This is why latency comes from the device log.
- The alert-mode socket stayed up for minutes with no client traffic: Node's WebSocket answers the hub's 15 s pings.

## Where each call comes from (main @ e3cddc14)

- Admin session: `POST /admin/auth/bootstrap` (`X-Admin-Bootstrap` for `/admin/login-roster`), or `POST /admin/auth` with `Authorization: Bearer <device>`. Admin commands go to `POST /admin/commands/<kebab>` with `X-Admin-Session`, using `device_id: 'hub-admin'` for a bootstrap session (`docs/manual-test-00.md` `admin_cmd`), and `actor_id` must equal the session's staff.
- `GenerateDevicePairingToken` (`apps/hub/src/commands/generate-device-pairing-token.ts`, sessionKind admin, `manage-devices`), then `POST /devices/pair { pairing_token, pair_request_id: ULID, device_name, device_type: 'tablet' }` (`apps/hub/src/auth/pairing.ts`).
- Staff: `POST /auth/pin { staff_id, pin, takeover? }` with `Authorization: Bearer <device>`. Commands go to `POST /commands/<kebab>` with `X-Session-Token` and the F §6.3 envelope (`apps/client/src/features/alerts/answer.ts`).
- `GET /queries/alert-receipts?alert_id=` (staff session with `manage-devices`). `GET /queries/staff-roster` (device token, no session).
- Alert mode: `ws://<hub>/ws`, first frame `{ type:'auth', device_token }`, then `{ type:'receipt', alert_id, kind:'delivered', step }`.
