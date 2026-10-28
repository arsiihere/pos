# 06 — Offline + Sync (and backup/restore): screen inventory

**No spec yet.** Sources: stories E5-OFF AC3–5 and edges, E0-BAK AC1–4 and edges, E5-DEV edge (outage beyond the safe window); foundation §5.5 (sync), §5.10 (replace and restore), D41, D48, D52, D53, D63; README R1/R10 (cloud me-central-1), 06 carried (encrypted USB backups and key availability, `applyStaffDirectory`, `ClockAlarm cloud_offset`, maintenance hour, admin access after restore via `issueAdminBootstrap`, re-apply cloud directory after USB restore, config poll before `/auth/*`, nightly USB backup required for the pilot). The device command queue itself is 02's (02-B02, 02-D14). Conventions in [00-index.md](00-index.md).

---

## 1. Who and where
| Who | Device | Network | How often | Conditions |
|---|---|---|---|---|
| Manager (sync status, backup status, backup time) | hub admin on T, K, P | Hub | glance daily; when internet is down | rush — must not interrupt |
| Owner (replace hub, see backups from anywhere) | L owner app (cloud) | Internet | rare (hub dies) | stressed: restaurant can't bill |
| Installer (restore a replacement hub) | L on LAN | LAN + internet | rare | target: operational ≤ 15 min |

## 2. Jobs to be done
| # | Job | Story AC | Acceptance |
|---|---|---|---|
| J1 | As a manager, I need to see cloud sync status and the last successful sync, with an "offline" indicator when internet is down. | E5-OFF AC5 | calm, not alarming; service unaffected |
| J2 | As a manager, I need to know sync caught up after the internet returned, in the background. | E5-OFF AC4, edge | no interruption |
| J3 | As a manager, I need to know the hub's clock disagrees with the cloud. | E5-OFF edge; D48 | > 60 s → alarm |
| J4 | As a manager, I need nightly USB backups at the quiet hour (or a fixed time) with success/failure visible. | E0-BAK AC1; D63 | last 7 kept; integrity checked; audited |
| J5 | As the owner, I need backup status and last backup times (local and cloud) with an alert after 24 h. | E0-BAK AC4 | in 07 owner view |
| J6 | As the owner, I need to replace a dead hub with a replace-hub code. | E0-BAK AC3; §5.10 step 1 | old key revoked; single-use code |
| J7 | As an installer, I need to restore from the old disk, USB or cloud (best first), see what can be lost, and get back to service ≤ 15 min. | E0-BAK AC3, edges | lost window stated; cloud-only ⇒ re-pair every device; first-admin link after restore |
| J8 | As a manager, I need an alert when the hub has been unreachable longer than the safe window. | E5-DEV edge | manager alerted |

## 3. Screen list
| ID | Name | Kind |
|---|---|---|
| 06-S01 | Sync status (hub admin): online/offline, last sync, events waiting, clock offset | screen/panel |
| 06-B01 | "No internet — everything still works; will sync later" indicator | status chip/banner on manager screens |
| 06-B02 | Clock differs from cloud by N s | banner |
| 06-B03 | Hub was unreachable longer than 5 min (manager alert) | notification |
| 06-S02 | Backups (hub admin): last USB backup, result, size, next time, USB drive state, last 7 | screen |
| 06-S03 | Backup time setting (quiet hour auto / fixed time) | setting |
| 06-B04 | Backup failed / USB missing or full | banner + audit |
| 06-S04 | Restore a replacement hub — setup with replace-hub code (extends 00-S01) | screen |
| 06-S05 | Choose restore source (old disk / USB / cloud) with what each keeps | screen |
| 06-D01 | Possible data loss window confirm | dialog |
| 06-S06 | Restoring… progress (copying, pulling events from cloud, rebuilding) | full-screen |
| 06-S07 | Restore done — first-admin link + "re-pair every device" (cloud only) | full-screen |
| 06-S08 | Replace hub (owner app): issue replace-hub code | owner screen |
| 06-D02 | Replace hub confirm ("the old hub stops syncing") | dialog |
| 06-S09 | Backup key / restore key handling (USB backups are encrypted) | screen — Q2 |

**Count: 15.**

## 4. Per screen

### 06-S01 Sync status
Fields: Internet: Online / Offline (since 12:40); Last sent to cloud: 13:05:12 (hub time); Waiting to send: 1 240 events; Menu from owner: version 42 (01a-B10 ties in); Clock: in sync / differs 74 s. Read-only; no "sync now" (01a S24 precedent). Data: `sync_cursor` (`last_acked_seq`, `cloud_offset_ms`, `updated_at`), max seq. States: never synced; `SYNC_SEQ_GAP` recovering (internal; show "Catching up"); branch key rejected ("Call support", like 01a-B10).

### 06-S02 / S03 Backups
List of last 7: date, time, size, result (ok / failed: reason), verified. Next backup at 04:00 (quiet hour computed from 14 days) or fixed time (S03: "Choose a time" HH:MM, LTR). USB drive: "POSBACKUP · 21 GB free" / "Not plugged in". B04 when failed.

### 06-S04 … S07 Restore
- **S04:** 00-S01 with a **replace-hub** code (kind accepted here; `REGISTRATION_CODE_KIND_UNSUPPORTED` today on new-branch flow).
- **S05:** three cards, best first: **Old hub's disk** (nothing lost, keeps pairings), **USB backup** ("backup from 04:00 today; keeps pairings; events after 04:00 that reached the cloud are pulled back"), **Cloud only** ("every screen and phone must be paired again"). Disabled when unavailable.
- **D01:** "Events after 04:00 that never reached the cloud (internet was down 02:10–07:30) are lost." (E0-BAK edge: state the window explicitly).
- **S06:** steps with progress (Restore database · Pull 3 400 events from the cloud · Rebuild · Check staff list) — target ≤ 15 min.
- **S07:** "Hub restored" + first-admin QR (00-S02 pattern, via `issueAdminBootstrap`) + "Pair every device again" checklist when cloud-only; `HubRestored` audited.

### 06-S08 / D02 Replace hub (owner app)
Branch → **Replace hub** → D02 "Gulberg's current hub will stop syncing at once. Use this only if it is dead or stolen." → code `R7K2-…` (shown once, 24 h) + instructions.

## 5. Flows
1. **Internet down at lunch:** 06-B01 appears on manager screens; ordering/billing continue; internet back → background sync; B01 clears; 06-S01 "Waiting to send: 0".
2. **USB missing at 04:00:** backup fails → B04 + audit + 07 owner alert.
3. **Hub dead:** owner 06-S08 → installer 06-S04 → S05 USB → D01 → S06 → S07 → devices reconnect (USB keeps pairings) → service.
4. **Clock drift:** sync offset 74 s → 06-B02 on admin and KDS.

## 6. Data shown
`sync_cursor`, event counts, `ClockAlarm`, backup audit events (`BackupSucceeded`/`BackupFailed`?), USB state, restore source availability, `HubRestored`.

## 7. Cross-module links
Needs 00 provisioning/setup page, `issueAdminBootstrap`, `applyStaffDirectory`, encrypted file helper; 01a config poll. Gives sync and backup facts to 07 (owner view), clock alarm to 03a-B01 family.

## 8. Open questions (owner)
- **Q1** Where does a manager see sync/backup status: hub admin home (00-Q1), the stock page, the cashier screen?
- **Q2** USB backups are encrypted with a key kept only on the hub. How does a replacement hub get the key (owner keeps a printed key? stored in the cloud?) — README carried, unsolved.
- **Q3** What is the "safe window" alert (default 5 min) and who gets it, on which device, if the hub itself is down?
- **Q4** Should the cloud keep a nightly full snapshot visible as "cloud backup" (E0-BAK AC2)?

## 9. Design status
Not designed.

## Story AC → screen IDs
| Story AC | Screens |
|---|---|
| E5-OFF AC3, AC4 | 06-S01 (no UI action) |
| E5-OFF AC5 | 06-S01, B01 |
| E5-OFF edges (clock skew, drift, gap) | 06-B02, S01 |
| E5-DEV edge (outage > window) | 06-B03 |
| E0-BAK AC1 | 06-S02, S03, B04 |
| E0-BAK AC2 (cloud copy + nightly snapshot) | 06-S01 (Q4) |
| E0-BAK AC3 | 06-S04–S08, D01, D02 |
| E0-BAK AC4 | 07-S02 |
| E0-BAK edges | 06-D01, S07, B04 |

**ACs with no screen:** none.
