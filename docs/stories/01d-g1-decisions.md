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

## 2. Carried rows

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
