# Foundation v1.18 — Hostile review, run 2

**Spec:** `docs/specs/00_Foundation_Spec_v1.18.md` (DRAFT), "Changes in v1.18" rows F-1 – F-12, the hostile run 1 table, and every "Foundation v1.18" marker (§1 Stack, §1 out of scope, §5.4, §5.6 note, §5.7 session kinds and D28, §6.2 appends, §6.3 table, §6.5 hint and close codes).
**Read against:** `CLAUDE.md`; rulings R3, R5, R7; run 1 (`docs/reviews/00_v1.13_hostile_run1.md`); owner review 24 Nov 2026; 00 HPA v1.13; 05a v1.0.7; 01d v1.3.7 C-F-37; code `packages/events/src/events/staff/Session*.v1.ts`, `packages/events/src/events/*/AdminBootstrapTokenIssued*`.

**Verdict: APPROVE WITH WORDING FIXES.** **0 BLOCKER, 0 MAJOR, 4 MINOR.**

The body text (§5.7 D28, session kinds, §6.2 codes with `scope` values, §6.5 `4413`, §6.3 rows) matches 00 v1.13 and 05a v1.0.7 after run 1 and the owner review. Findings are in the changelog and one versioning rule. Cross-spec defects found in the module text are filed in `00_v1.13_hostile_run2.md` and `05a_v1.0.7_hostile_run2.md`; none needs foundation text.

---

## MINOR

### R2-m-1 — Changelog rows describe the pre-run-1 design
**Where:** l. 6 header ("the customer status page on a `public` route group exempt from the guest-network guard"; "rows F-1 – F-8" while the table runs to F-12); row F-1 ("route group `public`: the **only** routes exempt from the guest-network guard (besides `/health`…)", "per-IP and global rate limit"); §5.4 l. 1183 ("after each commit it receives one `display_hint`").
**Problem:** D28 itself now says: own listener, no exemption on the main listener, valid links charged per order, invalid per IP. The rows a reader scans first say the opposite. §5.4 omits "when a mapped event is in the batch" (00 §6.21; §6.5 l. 1702 says it right).
**Fix:** reword F-1 to "the status page and its read on a separate public listener (`public_status.port`); the main listener keeps the guest guard on every route; HMAC link; valid-per-order / invalid-per-IP limiter"; header "rows F-1 – F-12"; §5.4 "after each commit that touches the board". Mark "⚠️ Changed by Foundation v1.18 hostile run 2".

### R2-m-2 — The OR-1 marker has no changelog row
**Where:** §1 Stack, pickup board row ("⚠️ Changed by Foundation v1.18 owner review (OR-1): English only, 31 pieces…"); "Changes in v1.18" has no owner-review sub-section (00 and 05a each have one).
**Problem:** R34 / CLAUDE.md: every change has a changelog entry with its marker.
**Fix:** add "Owner review (24 Nov 2026)" under Changes in v1.18: OR-1 (English-only composed voice, §1 Stack); OD-1 – OD-6, OD-8 – OD-10 accepted with 00 HPA v1.13, no further foundation text.

### R2-m-3 — Row F-2 still names `tablet`
**Where:** row F-2 ("a paired `cashier_kiosk` or `tablet` whose 05a profile is `board`"), corrected only by a trailing marker.
**Problem:** the row's main clause contradicts §5.7 and OD-2.
**Fix:** strike "or `tablet`" in place (keep the marker).

### R2-m-4 — An enum value added to a v1 payload with no version: D46 is silent, precedent says bump
**Where:** l. 35 ("`SessionStarted` / `SessionEnded` `kind` gains `'display'` (v1, added enum value)"); 00 §4.2 events row (same); D46 (§4.1 l. 419: "When a payload shape changes, the new version gets a new Zod schema and an upcaster"); precedent: 05a H-7 bumped `AdminBootstrapTokenIssued` to **v2** to add `issued_by: 'recovery'`; 01b bumped `StaffDirectoryApplied` to v2 for added `skipped.kind` values; fixtures rule l. 1744 ("one stored sample per schema version").
**Problem:** two contradictory practices for the same change; a reader with the old `z.enum(['staff','admin','station'])` (any future cloud ingest validating payloads, 06) rejects the event.
**Fix (pick one, state it in D46):** (a) recommended, consistent with precedent: `SessionStarted` / `SessionEnded` **v2**, identity upcaster v1 → v2, v2 fixtures (00 §4.2 and test 169 follow); or (b) a D46 sentence: "adding an enum value to a payload is not a shape change; it needs a new fixture, no new version", and mark 05a H-7 / 01b v2 bumps as conservative. Either way, write it once here.
