# 03b + 03c client — cleanup list (deferred MINOR review findings)

Owner ruling Q-60: fix rounds only for BLOCKER / MAJOR; MINOR findings land here and are fixed in the close tasks (Z) or the next change to the file. Money MINORs are fixed before merge (03b / 03c move no money, so none are expected). Client lanes only (W0, K, P, A); hub MINORs go to `docs/plans/03b-hub-cleanup.md`. `#n` = the PR whose review found it. Paths: `K/` = `apps/client/src/features/kds/`, `P/` = `…/pass/`, `PR/` = `…/print/`, `AK/` = `…/admin/kitchen-screens/`, `AP/` = `…/admin/printers/`, `A/` = `…/alerts/`.

"Owner?" = the spec is silent or a contract change is needed: ask before fixing.

Status at close (Z2, 2026-11-13): every row below is **deferred**, none fixed. Rows from review comments were not re-checked against the merged code; a fix round for a MAJOR may have closed one. Whoever touches the file next re-checks the row first. Rows marked **Owner?** need a ruling or a spec / hub change.

## W0 (shell and contracts)

| # | PR | Finding → action |
|---|---|---|
| W-1 | #191 | `T/build-output.test.ts` `[03b W0.4]`: the manifest entry check's `${name}/index.html` branch never matches (vite's `root` is the entry folder, so the entry chunk's `src` is `index.html`); match `src === 'index.html' && isEntry` only. |
| W-2 | #212 | `S/StaffApp.test.tsx`: no test pins that the Dismiss sender is re-made on a person change (dropping `sessionToken` from the memo deps passes): D gets 403 on Dismiss, signs out, E (with the grant) signs in and sees Dismiss. |
| W-3 | #212 | `S/StaffApp.tsx` landing: `landOnPass` stays armed until the first `point_view`, however late; disarm on the session's first `catch_up` (with or without `point_view`) or when the route first leaves `#/tables` (AD-K12). |
| W-4 | #212 | `A/labels.ts` `closedText` `moved_to`: no caller passes it (rows carry no table of the re-target), so a re-targeted Ready's closed row reads "Moved"; drop the parameter or record the plain line as accepted (AD-K13) until a source exists. |
| W-5 | #190 | The W0.5 row does not say the two admin stubs import `ui-kit-admin`; the PR body claimed W0.4 stubs already did. Plan text only (AD-K4 records the rule). |
| W-6 | #194 | `kds/slots.ts` `notifySlots()` did not isolate a throwing listener (AD-K9 asks for it, as `publishFrame` does); wrap each listener in try / catch and add an assert to the slots test. |
| W-7 | #194 | `pass/contracts.ts` `PointLinesFrame` is a hand-written copy of `WsPointLines`; build it on `WsPointLines` once HK2's fields are in `@pos/events` (the zod `LineDetailSchema` strips `group_id` / `serve_mode` until then). |
| W-8 | #194 | `kds/contracts.ts` / `PassSnapshot.seen_at`: the comment does not say a catch-up `apply` replaces the store whole (AD-K8 now does). `KDS_CATCH_UP_PARTS` was named in the contract before K1; K1 owns the list. |
| W-9 | #194 | `print/register.ts`: "called once by each 03b screen's entry" leaves StrictMode / HMR open; say "module scope in the entry's main.tsx, never in an effect" and make a second call a no-op while registered. |
| W-10 | #199 | `registerPrintSlots` called again with a transport drops the `printed` set and the ticket cache (new `createPrintedSet()`): the `printed` tags vanish until the next reconnect. Keep the set across re-registration. |
| W-11 | #209 | Sync PR body footer nonstandard; no action. |
| W-12 | #190 | `pnpm install` fails with `npm_config_manage_package_manager_versions=false` ("broken lockfile") and works without it. Environment note for cloud sessions. |

## Lane K (KDS)

| # | PR | Finding → action |
|---|---|---|
| K-1 | #196 | `KdsApp.tsx`: a page with no meta and a stored token showed "pair again" and `/pair` sent it back to `/kds/` (a tap loop); fixed to a Reload message (test at `KdsApp.test.tsx` "page meta missing…"). Remaining: a plain 4401 calls `/auth/station` at once with no backoff (`attempt` reset by the last ok); every non-unpair error retries forever as "Can't reach the hub" (00 §8.4: SERVICE_UNAVAILABLE retries once, other 4xx show `errors.<code>`). |
| K-2 | #196 | No StrictMode test existed in review 1; `KdsApp.test.tsx` now has one ("StrictMode: one POST /auth/station and one socket auth"). Keep. |
| K-3 | #202 | `stationQuery` in `KdsApp.tsx` calls `GET /queries/order-tickets`, which 03c §3.10 allows on the staff session only. It is unused: make it a fixed refusal. |
| K-4 | #202 | No tests pin that `canReprint` follows the live session and that with no session `command` answers `network` (both mutants survive). Commit message and PR body describe the old design ("canReprint true", "tag-only when the session ends"). |
| K-5 | #200 | Header sub-line has no device name or lane label (the station socket lacks them: hub gap). A card refused because its order left the kitchen stays until the hub's event arrives (see `03b-client-gaps.md`, "order leaves the engine"). |
| K-6 | #202 | **Owner?** Old-window takeover edge: a KDS window that was offline when a new one took over reconnects and takes the session back; the hub closes the loser with 4401 and no reason (`ws/server.ts:346`), so the client cannot tell "replaced" from "session ended". Hand check in `03b-manual-checks.md` (check 7). |
| K-7 | #179 (hub) | A paired KDS opening `/pair?t=` goes to `/staff/` (Q-29 as written; a spec change first). K1 keeps the token on a network failure (test added). |

## Lane P (Pass)

| # | PR | Finding → action |
|---|---|---|
| P-1 | #203 | MINOR 4: if the Ready is retargeted between its frame and the command reply, `claimReady` loses the name. Fix: keep the chain of old alert ids. |
| P-2 | #203 | A late Handover reply can name a newer Ready made by another tablet; clear the remembered handover entries on a new `ReadyToServe` for the order. The PR body still describes the removed replay. |
| P-3 | #204 | No test pins mount-only print-slot registration in `PassScreen`. |
| P-4 | #205 | Ready band time lacks the `.num` wrapper; the receiver tile reads "T4 + T5 team" where the frame has "T4 team"; a card error line persists after reconnect or after another device acts (R1-6). |
| P-5 | #205 | Re-check: no test that a catch-up clears the "handed to" line; no test pinning the hub cap of 40; the IR-6 fix ignores `point_id`, so a Handover at another point of the same order drops this tablet's line; "Undo ready" is hidden more broadly than "no Handover since". |
| P-6 | #205 | Known behaviour, recorded as AD-K26: command ids are kept across sign-out (03c precedent), so person B's retry of A's lost tap replays A's command and the band names B. |
| P-7 | #208 | No Pass-level test for the takeover Reprint same-id retry; the takeover section drops the KDS batch-start notice; Reprint stays on takeover rows of an archived point; the Offline and Archived banners differ from the frames (icons; Archived still draws the station strip); booting offline shows skeletons with no warn bar; no Urdu render test for the takeover copy. |
| P-8 | #208 | Optional `surface` prop on `K/LineRow` (IR-21) so the Pass reuses it without `hasPrinter={false}`. |

## Lane A (admin, print, alert cards)

| # | PR | Finding → action |
|---|---|---|
| A-1 | #195 | The row says "Refresh" but the button reads "Reload" (Q-54 wording). |
| A-2 | #197 | "Used by nothing" while the hub refuses the archive (the hub counts archived stations' output rows); `Printers.tsx` ignores `archived` outputs in "Used by". |
| A-3 | #197 | **Owner?** `SavePrinter` has no version: a stale card can un-archive a printer or overwrite another admin's edit (the page re-reads before Edit / Archive as a mitigation). Spec gap (03c §6.2). |
| A-4 | #197 | `Printers.tsx` never reads `admin_permissions['manage-devices']` on open (harmless: every endpoint 403s); a mid-session 403 keeps the buttons. `newUlid()` on every Save / Archive tap loses the hub's M47 replay when a reply is lost (Add): reuse the command id after a network failure; the Archive dialog's id reuse is untested. |
| A-5 | #197 | `printers.error.busy` shows the W0.3 text "In use — try again in a moment" where the frame says "The printer is busy printing tickets. Try again in a moment." (a `printers.test_in_use` key exists now: check the Test print path uses it). "Go to Station outputs" is never clicked in the CONFIG_IN_USE test. `AP/test-data.ts` is not in the row's file list. No double-tap test on Test print / Save. |
| A-6 | #198 | `Queue.test.tsx:42` uses `last_error: 'write_timeout'`; the worker writes `connect_failed:transport` / `write_failed:<detail>`. Use a `:`-suffixed value. `Warnings.tsx:25`: no test for the station-name `lossy_name` (no `item_id`, no `name`). `CancelDialog` and `OutputEditor` keep Keep / Cancel / Escape enabled while the request is in flight. |
| A-7 | #199 | When the Pass card Reprint answers with both `ticket_ids` and `skipped` the toast shows only "Reprinting n tickets": no test for the mixed case. A catch-up makes every visible card re-read once (accepted, AD-K1, AD-K20). |
| A-8 | #210 | Dismiss uses the admin client's result type; a signed-out answer shows the admin "signed out" text. |
| A-9 | #195, #197 | **Owner?** The admin pages (`/admin/kitchen-screens/`, `/admin/printers/`) have no page meta, so no hub clock: "checked / last printed / last seen" times are omitted vs the frames. Keep (00 v1.9.2 §8.2 as written) or give them `pageMeta` (00 bump and a 2-line hub change). |
| A-10 | Z1 | **Bug (found by the e2e, not fixed):** the printer card's `MoreMenu` (Archive) opens off screen at 1280 x 800 (`.pos-menu` is `position: absolute; top: calc(100% - 8px)` and the card has no positioned parent: y = -56). Only keyboard Enter reaches Archive. Fix in `AP/Printers.tsx` / the card CSS (`position: relative` on `.pr`) with a layout test. |

## Hub follow-ups raised by the client lanes (go to `docs/plans/03b-hub-cleanup.md`; listed so the integrator sees them in one place)

| # | Source | Finding |
|---|---|---|
| H-1 | #177 | Plan said one assertion in `restaurant-ws.int.test.ts`; the PR edits two (Q-62, same scope). 01a marker in the next 01a bump, with the #145 push clause. Dark / archived-station warning tests merged into existing tests; the print-config Urdu item case uses "Naan ★". |
| H-2 | #179 | 00 v1.9.2 §8.2 line ~1599 is stale ("401/403 wipe and start new request"): reword at the next 00 bump. No test that a stored-token `/pair` load makes zero network calls (check the fetch stub). `client-dist.int.test.ts:201-203` compares `/kds/` headers to the real `/staff/` build: needs a client build, compare to known header values. |
| H-3 | #182 | Test #68 budget not checked with both KDS and Pass hooks in one commit; the no-table-event case does not assert the total statement count; detach / merge-without-absorbed untested; `kds-catch-up.ts:100` `db.prepare` → `cachedPrepare`. |
| H-4 | #184 | `admin.printer_problem` has no UR key (template is language-neutral); the client-dist tests need a client build first. |
| H-5 | HK7 | `apps/hub/deploy/ship-client.sh` shipped no `kds` / `admin-kitchen-screens` / `admin-printers` builds: fixed by HK7 on `module-03b-hub-gaps` (42a56cd); a pilot blocker until that branch is on `main`. |
| H-6 | Z1 | The test hub's `testSecrets()` is a counter that wraps every 256 bytes (the 9th `token256()` repeats the first: `devices.token_hash` UNIQUE fails). The e2e global setup swaps in `cryptoSecrets`; the hub's own test helper should do the same or fail loudly. |
