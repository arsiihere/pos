# 01d G1: brainstorming decisions (running record)

| | |
|---|---|
| Status | **Working record of the G1 session (2026-11-01).** Rows are developer answers unless marked. Rows marked *Proposed — needs approval* change README, CLAUDE.md or an approved spec and are approved at the gate. |
| Inputs | `01d-g0-decisions.md` (G0 register), `01d-notifications-teams-refined.md`, README, foundation v1.7, 00 v1.5, 01b v1.3 |

## 1. Scope, order and README rows

| ID | Decision |
|---|---|
| G1-1 | **README row numbers.** R28–R32 are taken. New rows: **R33** device policy (G0 D1–D7), **R34** foundation may change by version bump. G0 file fixed (commit 8aa6b2c). |
| G1-2 | **R34** *Proposed — needs approval* (developer approves at the gate). A decision of its own: README R34 and the CLAUDE.md line "The foundation is frozen (D64)…" are edited **in the same change**, before 01d's spec bumps the foundation. |
| G1-3 | **`no_pin_staff` (G0 P1) is tablet path**, not hardware path: the handover tile (K5) and per-person pickup metrics (K12) need waiter names on the hub, and 01b B3 keeps people without a PIN out of the directory. Stays in 01d's scope as a carried 01b bump (v1.3 → v1.4). |
| G1-4 | **The pilot branch runs with the hardware** (pager watches, pager bridge, ESP32 station button devices). H0 is a product rule for customers without hardware: the tablet path must work alone, but the pilot ships both. |
| G1-5 | **Spec split.** **01d (pilot):** notifications, requests, targets, attempts and escalation, receipts, tablet routes, and a **route interface** (text or short code; acknowledgeable or not; which receipts it can report: sent / delivered / seen) that hardware routes plug into without changing 01d. **01e Device gateway (pilot, mandatory):** compact device protocol, `pager_bridge` type, headless pairing, ESP32 station button devices, pager route, device health. 01e rests on the hardware spike (G0 §9), not on guesses. |
| G1-6 | **Order** *Proposed — needs approval* (README R21 / R27 build order and milestone A module list): hardware spike runs now, in parallel with 01d's spec → build 01d → spec 01e from the spike results → build 01e against test producers (send `12 P` to a watch, take button presses), firmware in parallel → 03a → 02 → 04 → 03b (Start / Done and Ready to serve connect the real flow to the devices) → 05. |

## 1a. Requests

| ID | Decision |
|---|---|
| G1-7 | **01d owns the request record and its answer rules; owning modules plug in a handler for the effect** (model A). One request record per kind (void, discount, comp, table handover, zone stock transfer); request events go on the **subject's stream** (order, table, stock), `stream_type` unchanged. On an accepted answer 01d calls the kind's handler **in the same SQLite transaction**; the handler writes the domain event. |
| G1-7a | **Handler failure:** the handler throws (e.g. the void is no longer possible) → the whole transaction rolls back, the request stays pending, the answerer gets the error. No partial answers. |
| G1-7b | **Obsolete:** the owning module closes a pending request as obsolete with a reason (bill closed, item already removed, table moved) through a 01d call; attempts stop; requester and targets are told. |
| G1-7c | **Right check in 01d:** each kind declares the permission it needs and a **range resolver** from the subject to its range (team, zone, branch). 01d checks the answerer's right and range when the answer arrives (G0 N6, G0-7), so range rules live in one place. The handler only applies the effect. |
| G1-7d | **In-person fallback is the same answer path**, sent from the requester's device with the answerer's PIN; no separate flow. The answer records the device it came from. |
| G1-7e | **Withdrawn** by the requester is allowed while pending. |
| G1-7f | **Foundation §4.5 mapping** (proposal, see below). |

**Request states (01d):** `pending` → `approved` \| `rejected` (answered) \| `withdrawn` (requester) \| `closed` (owning module; reason `obsolete` or `overridden`). Accept / Decline kinds use `approved` / `rejected` with the kind's labels.

| Foundation §4.5 void state | 01d request state | Owner |
|---|---|---|
| PENDING | `pending` | 01d (record, attempts, escalation); 04 (bill effect: excluded from total, blocks close) |
| APPROVED | `approved` | 01d accepts the answer; 04's handler removes the item from the bill |
| REJECTED | `rejected` | 01d accepts the answer; 04's handler reinstates the item; 01d tells the table's order taker (G0 N9) |
| OVERRIDDEN | `closed`, reason `overridden` | **04.** It is not an answer from an approver: 04 owns the rule (must be ON, default OFF), the manager's permission and the reason, writes its own override event, then closes the 01d request through the same call as G1-7b. 01d only stops attempts and tells the requester and targets. |
| — (not in §4.5) | `withdrawn` | 01d; **04 must define** what a withdrawn void means for the item (proposed: the void never happened, item stays at full price) |

G1-7f confirmed by the developer as written; 04 to confirm the withdrawn-void meaning.

| ID | Decision |
|---|---|
| G1-9 | **Escalation widens only who is told, never who may answer.** |
| G1-9a | The grant's scope (`my_team`, `my_zones`, `branch`) is a permission rule; no timer loosens it. |
| G1-9b | Out-of-range people who receive an escalation see the request **read-only** with "Find <approver> or a manager"; the requester's "ask in person" line stays. |
| G1-9c | Branch-scope holders (normally the manager) are in range for every request, so they are the real escalation target. |
| G1-9d | **Shortcut:** if no in-range approver is signed in anywhere when the request is raised, skip the waiting steps and go to branch-scope holders at once. |
| G1-9e | **No approver warning (pilot form of Q-N5, approvals only):** while the business day is open and no branch-scope approver for a permission is signed in anywhere, the always-on screens and the manager / owner views show "No one can approve voids right now". The general "no route reaches this person" warning stays deferred. |
| G1-9f | **G0-1 wording, approval requests, as amended:** t0 in-range approvers (G0-7); 45 s repeat sound on their tablets and show on the always-on screens (assembler, cashier); **2 min branch-scope approvers; other holders told read-only**; requester's screen says "Waiting 2 min — ask in person". |

| G1-10 | **Each request kind declares whether its answer needs a PIN.** |
| G1-10a | Money kinds (void, discount, comp): PIN on every answer, on any device. |
| G1-10b | Accept kinds (table handover, zone-stock transfer): one tap on the answerer's own signed-in session. |
| G1-10c | In-person fallback (answer from someone else's device): always PIN. |
| G1-10d | The answer event records the method `pin` \| `session` \| `in_person`, plus the device id. |
| G1-10e | These are defaults; the PIN requirement per kind is a branch setting (data, R18). A branch may **add** a PIN to accept kinds; it may **not** remove the PIN from money kinds (fixed in the spec). |
| G1-10f | No PIN-free window after a PIN answer; each money answer needs its own PIN. |

## 1c. Targets

| ID | Decision |
|---|---|
| G1-11 | **Alerts follow the table's current owner.** |
| G1-11a | Table's team = current owner (from 02, **read at send time**, i.e. per attempt) + direct reports (`teamOf` for PIN holders, `no_pin_staff` by `lead_staff_id` for the rest). |
| G1-11b | Zone assignment (Z2) only sets the default owner when a table opens (02's rule). |
| G1-11c | Pending pickups at handover: the next attempt goes to the new team; the item leaves the old team's inboxes and shows "Moved to Bilal" there. |
| G1-11d | Fallbacks: owner has no reports → owner only. Owner not signed in anywhere → the zone's assigned order taker; none signed in → branch-scope holders (manager). *Open for the spec: which permission defines "manager" for non-approval fallbacks (proposed: a branch-scope holder of `force-release-table-lock`).* |
| G1-11e | Zone stock stays with the zone, not the owner: a moved table still draws from the zone it sits in (Z4, Z6 unchanged). |

| G1-12 | **The point's assembler is a device target, not a person.** |
| G1-12a | A tablet can be bound to a point: nullable `point_id` on the device row (new forward migration, 00 bump; points from 01a). Several tablets may be bound to one point; all receive the point's alerts. |
| G1-12b | 01d delivers to the bound devices whoever is signed in. Alerts show even with no one signed in; Ready to serve, Handover and state taps need a signed-in staff session and record that person. *Note: G0 P3 `tap-for-station` covers Start / Done; the spec must name the permission for Ready to serve and Handover (proposed: the same `tap-for-station` on the point's stations, or a new one, 01b bump).* |
| G1-12c | The same device target covers escalation to always-on screens (cashier kiosk, KDS, point tablets). |
| G1-12d | A point with no bound device online → the manager is told (same rule as 01e device health, G0 G7). |
| G1-12e | G1-11d's open point stays for the spec; candidate: branch-scope holder of `force-release-table-lock`. |

## 1b. Receipts

| ID | Decision |
|---|---|
| G1-8 | **Delivery receipts are synced events**: **delivered** and **seen** only. "Sent" is taken from the attempt event (it lists targets and routes); "answered" is the request's answer event. |
| G1-8a | **Stream:** receipt events go on the existing **`audit`** stream_type, not the subject's stream: ~5,000 receipts per rush would load the order stream 03a replays (R6, 90 s boot budget), and the engine never needs them. They still sync to the cloud and show on the owner's remote view. Payload carries the notification id and the subject (`stream_type` + `stream_id`) to join back. |
| G1-8b | Only the **first** delivered and the **first** seen per person per device per notification are recorded; repeats are dropped on the hub. |
| G1-8c | **Batched writes:** receipts are appended in batches (flush every 1–2 s or N receipts, whichever first), one transaction per batch, since each commit is an fsync under `synchronous=FULL`. A hub crash may lose the last batch; **acceptable for receipts only** (no other 01d write is batched). |
| G1-8d | **Pager route:** sent only (from the attempt event); no receipts (01e). |
| G1-8e | **Sizing re-check** (below). |

**Sizing re-check (R6).** R6 assumes 2,000 orders/day ≈ 40,000 events/day (≈ 20 per order). 01d adds per order, at design size: Ready to serve per point (~1.5 points) × ~1.3 attempts ≈ 2 attempt events; receipts ≈ 2 attempts × ~3 people × 1 device × 2 (delivered, seen) ≈ 12; plus Served card, slip and request traffic ≈ 2–4. So **≈ 16–18 extra events per order, ≈ 32–36k per day: total ≈ 75k events/day, of which ≈ 45k are on replayed streams** (order, table, station, stock) and ≈ 30k on `audit`.

Finding: foundation §5.8 step 3 replays `SELECT * FROM events WHERE branch_id = ? AND seq > snapshot.last_seq`, **all stream types**. Putting receipts on `audit` keeps them out of the replay **only if 03a filters replay by `stream_type`** (with an index that serves it). Without that, G1-8a saves nothing at boot.

## 2. Carried rows

### To 03a

| Row | Item |
|---|---|
| G1-8e | Size snapshots and replay against **≈ 75k events/day** (≈ 45k on replayed streams, ≈ 30k `audit`) instead of R6's 40k. Engine replay reads only the stream types its reducers use (skip `audit`), with an index serving `(branch_id, stream_type, seq)` or equivalent; this changes the foundation §5.8 step 3 query text, so it lands through the foundation v1.8 bump (R34). Cloud sync volume roughly doubles; note for 06 sizing. |

### To 01e (pilot, mandatory)

| G0 row | Item |
|---|---|
| D3 | Pager watch via ESP32 pager bridge (433 MHz), watch text format |
| D4 | Station button device (paired as `kds`, lanes) |
| D5 | `pager_bridge` device type: CHECK widening migration, `DevicePaired` v2 + upcaster, approval payload, 00 bump |
| G1 | Compact device protocol frames |
| G2 | `ref` names the item; stale stage → fresh lines |
| G3 | Press time = hub receive time; `source: 'button'` |
| G4 | No queue on device; `OFFLINE`; tablet and auto-print fallback |
| G5 | No snapshot to headless devices |
| G6 | Headless pairing (button display code; bridge setup-mode AP) |
| G7 | Device health / keepalive shown to point assembler and manager |
| N2 (pager part), N5 (pager receipt = sent only), N8 watch kinds, G0-2 watch patterns | The pager route, plugged into the 01d route interface |
| G0-10 | Watch model and code format (after the spike) |

## 3. Open (next questions)

- Confirm / challenge remaining 01d rows (N1–N10, G0-1, G0-2, G0-7, S1–S3, D1, D2, D6–D8).
- Data model and event streams.
- Interfaces for other modules.
- Q-A2 (D8).
