# Review 2 — 00 Hub Platform & Access Spec v0.6

| Field | Value |
|---|---|
| Spec under review | `docs/specs/00_Hub_Platform_Access_Spec_v0.6.md` (Draft; Review 1 applied) |
| Checked against | `docs/reviews/00_review_1.md`, `docs/specs/00_Foundation_Spec_v1.7.md`, `docs/specs/README.md` (incl. R16 and the new 05 requirement) |
| Scope | (1) Check that every Review 1 finding is fixed or covered by a recorded decision. (2) Find **new blockers only**: security, data loss, races. Style and minor issues are not raised again. |
| Date | 2026-10-23 |
| **Verdict** | **REJECT: 2 new blockers (N1, N2).** All 38 Review 1 findings are fixed or covered by a recorded decision. |

---

## Part 1 — Review 1 findings

Status: **Fixed** = the spec now states the rule and a test covers it. **Decision** = covered by a recorded decision or README requirement instead of a code change.

| R1 # | Topic | v0.6 answer | Status |
|---|---|---|---|
| 1 | Auth re-check inside the transaction | M39 `authGeneration`, permission always resolved in the transaction; tests 85, 86 | Fixed |
| 2 | Restore brings back revoked devices / sessions | M40 forward `access_reconcile` projection + `hub_restored`; tests 87, 88 | Fixed (see note A) |
| 3 | Provisioning stuck after 1 h | M41 `pending_hub` until `/v1/hubs/confirm`; M22 reissue while unconfirmed; tests 89, 90 | Fixed. M41 also blocks reissue once the hub confirms, which creates **N1** |
| 4 | `/admin/auth` open to the LAN | M42 paired device required (phone: owner only), separate admin semaphore; tests 91, 93 | Fixed |
| 5 | Admin session left in a paired browser | M43 logout + clear before navigating; M44 screens no longer pair from an admin tab; test 94 | Fixed |
| 6 | DNS rebinding | M45 Host guard on every route incl. `/health`, `/ws`; test 97 | Fixed |
| 7 | Idle-expired session revived | M46 idle check in the guard and the login transaction; test 98 | Fixed (see note B) |
| 8 | Replay ignores type; body `device_id` | M47 `command_type` + `payload_hash` + `session_id`; device from the token; test 99 | Fixed |
| 9 | Boot cost grows with history | M48 max-seq row, all checkpoints advance, 4b gated; test 100 on 1 M events | Fixed |
| 10 | Refresh reuse logs the owner out | M49 HMAC successor, 30 s grace; test 54 | Fixed |
| 11 | PIN reset keeps sessions | M50 `credentials_changed`; test 101 | Fixed |
| 12 | Directory version not checked | M51; test 102 | Fixed |
| 13 | Weak-hash behaviour | M52 skip per row; tests 19, 103 | Fixed (see note C) |
| 14 | Two KDS tabs loop | M53 close reason `replaced`, client stops; test 104 | Fixed |
| 15 | BYOD threat model | M54 + README R16 (phone SSID with client isolation), MQ11 owner sign-off | Decision (sign-off still pending, MQ11; installation item, not a spec blocker) |
| 16 | Unrecorded overrides, reused codes | M55 (a)–(e); `IP_LOCKED_OUT`, `STATION_LOGOUT_NOT_ALLOWED` | Fixed |
| 17 | CLI database path | M56 `SystemContext` in `apps/cloud/src/cli/`; test 113 | Fixed |
| 18 | `is_admin_role`; owner can't see new branch | M57; test 57 | Fixed |
| 19 | Two writers of guest CIDRs / host | M58 setup-only, min 1 CIDR, own address; test 105 | Fixed |
| 20 | Untested codes and rules | tests 114–126, 118–120; acceptance table corrected | Fixed |
| 21 | Impossible race tests; publish duplicate | test 60 outcome-only, test 51 reworded, publish filter + test 112 | Fixed |
| 22 | Polling defeats idle logout | M59 `countsAsActivity` default false; test 13 | Fixed |
| 23 | Rotation not audited | M60 `DeviceTokenRotated`; test 30 | Fixed |
| 24 | Admin access checked only at login | M61; test 106 | Fixed |
| 25 | Counter after lock expiry | M62; test 107 | Fixed |
| 26 | `/health` on the guest network | M63 reduced body; test 108 | Fixed |
| 27 | Owner login lock / enumeration | M64; test 109 | Fixed, but the new rule creates **N2** |
| 28 | Admin replay match | M47 `session_id` | Fixed |
| 29 | Unused `client_ip` | M65 dropped | Fixed |
| 30 | Retention at midnight | M66 maintenance hour, batches; test 121; README installation TZ item | Fixed |
| 31 | GCM wording; leftover plaintext | M67 temp + verify + rename; boot cleanup; test 111 | Fixed |
| 32 | Malformed tables | §3.1 order fixed, stray row removed, IDs kept (reason given) | Fixed |
| 33 | Library notes | M68; ESLint pinned | Fixed |
| 34 | §9 codes added twice | §11: codes created once in task 2 | Fixed |
| 35 | `idempotency_keys` for 01 | M69 moved; refresh-row cleanup | Fixed |
| 36 | Command `tenant_id` unchecked | M70; test 110 | Fixed |
| 37 | `setup_attempt_id` in the event | M71 | Fixed |
| 38 | Takeover vs open cash shift | README "Requirements carried" row for 05 | Decision |

**Part 1 result:** all 38 are closed. Notes A–C (below the blockers) are not blockers.

---

## Part 2 — New blockers

### N1. No way to regain admin access: the hub can be permanently locked out

- **Where:** M42 (the only device-less admin entry is the one-time bootstrap token, 30 min TTL, single use, issued only by `/setup/provision`), §6.29, M41 (reissue refused once `hub_confirmed_at` is set), §3.2 (`/setup` → 404 forever), M44 (kiosk/KDS pairing needs an admin), §6.7 (tablet/phone pairing needs an admin), foundation §5.10 source (c) ("every device must re-pair").
- **Problem:** Every way to get a first admin session after provisioning needs either a paired admin-capable device or the bootstrap token. The bootstrap token is issued exactly once. Nothing can issue another one: the hub has no route, no CLI and no 06 hook for it.
- **Failures:**
  1. The installer provisions the hub and the restart happens. The confirm task marks the branch `active` within seconds (M41). The installer comes back after more than 30 minutes, or the bootstrap login succeeds but its response is lost (the token is consumed and no session reaches the browser). Now no admin session exists, and none can ever be opened. `/setup` is 404, and reissue is refused because the branch is confirmed. The hub can never pair a single device.
  2. Later in life, every device whose holders have `access-hub-admin` is revoked, lost or wiped, for example a tablet stolen and revoked, a manager's phone removed by M38 `owner_removed`, or storage cleared. The result is the same lockout.
  3. Replace-hub restore from the cloud only (§5.10 c): the device table is empty by design, so the restored hub has no admin path either.
- **Recovery today:** wipe the hub and register it as a new branch. That loses every event not yet synced to the cloud (data loss) and splits the branch's history across two branch ids.
- **Required:** a recovery issuer that uses physical or shell access to the hub as its authority. One option is a hub CLI (`pnpm --filter hub issue-admin-bootstrap`, run as the service user on the hub box) that creates a new bootstrap token in a `writer.run`, expires any live one, and appends `AdminBootstrapTokenIssued` (with an `issued_by: 'cli'` field). Also add a requirement on 06 that the replace-hub flow issues one after restore. Tests: issue after expiry → a new link works; the old link → 401; the event is written.

### N2. Owner login while locked tells the attacker when the password is right

- **Where:** M64, §6.22 step (4) ("wrong password → `401` also while locked … correct password while locked → `429 LOGIN_LOCKED_OUT`"), test 109.
- **Problem:** The account lock was meant to stop password guessing (M33). Under M64 the hub still runs `argon2.verify` while the account is locked and answers differently depending on the result: `401` for a wrong password, `429` for the right one. A lock therefore no longer limits guessing. It only changes which status code means "found". The only remaining limit is per IP (30 per 15 min, in memory), which an attacker with many source IPs is not bound by.
- **Failure:** An attacker spreads guesses against the owner's email across many IPs. The account locks after 10 failures, but every further guess is still checked. The first `429` confirms the password. The owner's JWT gives read access to every branch's sales, and 01's admin routes will hang off the same login.
- **Required:** While locked, answer the same way whatever the password, and do not verify it. The response must not reveal the lock either (Review 1 #27). For example, while locked return `401 LOGIN_INVALID` without verifying (run the dummy hash for equal timing) and do not count the attempt. Tell the owner about the lock out of band later (01/07), or accept a visible `429` for **every** attempt on a locked account, which reveals that the account exists but not the password. Pick one, record it in M64, and change test 109 to assert that a locked account gives identical responses for a right and a wrong password.

---

## Notes (not blockers; for the author, no re-review needed)

- **A (M40):** "unless the row already carries a newer hash" has no defined mechanism. The rule that the live apply is a no-op must be enforced (for example, the projection applies only during boot catch-up), or a live `DeviceTokenRotated` could overwrite the fresh hash and lock out the device that just paired. Test 30 would catch it, so it is not a blocker. Separately, 06 must re-apply the cloud directory after a USB restore: the restored `staff` tables can be older than the directory applied at replace-hub setup, so staff removed after the backup could log in until the next sync. Add this to the README requirements for 06.
- **B (M46):** the session guard now writes (`SessionEnded` in its own `writer.run`) on `GET /queries/*`. Foundation §6.3 says queries make no writes. M46 has no override entry. Record it under M55.
- **C (M52):** a staff row skipped for a malformed hash disappears from the directory, so M38 revokes that person's phone (`owner_removed`) and M50/removal ends their sessions. One bad row from 01 therefore forces a re-pair. Consider keeping the previous row (with its old hash) only when the new hash is malformed and the old one is unchanged; M50 still handles a real reset. Alternatively, document the side effect.
- **D (M44):** `POST /pair/requests` is unauthenticated and capped at 10 pending. Anyone on the staff WiFi can fill the cap every 10 minutes and block kiosk/KDS pairing. Pairing is rare, so the impact is low. Consider a per-IP cap of 2 pending.

---

## Result

| | Count |
|---|---|
| Review 1 findings closed | 38 / 38 |
| New blockers | 2 (N1 admin lockout with data loss on recovery; N2 login correctness oracle) |
| Notes | 4 |

**REJECT.** Fix N1 and N2 in v0.7. Each is a contained change: one CLI + one 06 requirement, and one line of M64 + test 109. A Review 3 limited to those two items and their tests is enough. Notes A–D can go into the same version.
