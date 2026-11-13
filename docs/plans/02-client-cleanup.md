# 02a + 02b client — cleanup list (deferred MINOR review findings)

Owner ruling Q-60: fix rounds only for BLOCKER / MAJOR; MINOR findings land here and are fixed in close tasks (Z) or the next change to the file. Money MINORs were fixed before merge. One file for 02a, 02b, the shared shell and the 03b hub lanes that ran alongside. `#n` = the PR whose review found it. Paths: `S/` = `apps/client/src/features/staff/`, `A/` = `apps/client/src/features/alerts/`.

"Owner?" = the spec is silent or a contract change is needed: ask before fixing.

## 02 shell (W0, both modules)

| # | PR | Finding → action |
|---|---|---|
| W-1 | #150 | StrictMode (dev only): the config effect's cleanup disposes the kept instance, so no re-read on `BranchConfigApplied` / reconnect in dev (prod fine). Fix with the StrictMode sweep (P-1). |
| W-2 | #150 | The `Shell` object is rebuilt on every `StaffApp` render (15 s tick), so every `useShell()` screen re-renders. Memoize it. (Task 28 found the worst effect: `OrdersPart`'s reader depended on the whole `shell` and reset on each render; fixed in #201 by depending on `shell.live` / `shell.orders`. No other 02 screen depends on the whole `shell`. Memoizing the object itself is still open.) |
| W-3 | #150 | Add a test that a real `visibilitychange` in `StaffApp` reaches the live bus. |
| W-4 | #150 | `e2e/global-setup.ts` imports hub source (branch-config holder) beyond the test helpers; e2e files and `playwright.config.ts` are not typechecked. Add an e2e tsconfig to the typecheck or move the import behind a helper. |

## 02a (tables client)

| # | PR | Finding → action |
|---|---|---|
| A-1 | #157 | `S/SignIn.tsx:96`: a stale network error stays after the hub returns until a digit is typed. Clear it on the roster's next success. |
| A-2 | #157 | `main.tsx:50` not-paired branch is untested; `alerts.signin.not_paired` string is unused. Test it or drop the key. |
| A-3 | #157 | Add a test that other API codes and WS 4401 do not wipe the pairing. |
| A-4 | #159 | `useTableLock` assumes it holds the lock on mount: a no-op Release on leave when not held; "then Release" tested only via a manual call. `reasonText` duplicates 22a's reason parser — fold into one. |
| A-5 | #160 | Tile flag icons / classes for "Waiting to send" / "Call sent" differ from `Tiles.dc.html` (manual check M8). Debounce is a fixed window, not trailing. |
| A-6 | #163 | Icon buttons need a11y names ("Requests, 1"); `MeTab` reuses the `signin__phone` class; an Urdu test wraps rtl itself. **Owner?** phone approvers have no path to Requests (spec silent). |
| A-7 | #161 | Sheet map refresh misses `OrderContactSet` / `LineComped`; compare replies to the last frame seq; force release "already done" still toasts "released"; the Note string duplicates a W0.3 key; busy Release on a just-opened free table shows nothing. The sheet should read lane B's map store (21a) and drop replies older than the last frame seq. |
| A-8 | #161 | Null-case test has no frame between the 409 and Release; no test for a 409 on `OpenTable` after Take over (render-time vs sent seating). |
| A-9 | #166 | An in-flight reply can close a newer dialog; preset person not working → nothing selected / no reason; a picked Join / Move table stays after it disappears; blank staff name in the other-owner dialog; singular wording ("1 orders / stay / items"). |
| A-10 | #166 | Force move "Me" copy ("Give F2 to Me now?"); a failed candidates read shows Loading forever; split counts lines, not quantity; offline mid-dialog Send stays enabled. **Owner?** Force move / Move "Other" sends a bare `other` (handoff CHANGES Q9 asks for an optional note; frames show none). |
| A-11 | #169 | The order bar says "orders" but `pendingCount` counts all entries (frame: "1 waiting to send"); "Back online" shows only if the tables bar was mounted while offline. |
| A-12 | #170 | Late flag not asserted through `StaffApp`; no test that the map filters to the chosen floor / all when absent; `StaffApp` mutates the `lastFloor` ref in render (duplicates `TableMap` logic). |
| A-13 | #172 | No test that a repeated call keeps the first "Call sent" time; no double-tap or stale-seating tests; Clean dialog says "0 orders" when `order_count` is missing; handover error "Try again." sits next to a Try again button. |
| A-14 | #172 | No dedupe: a second queued Clean replays as "table changed" and leaves a spurious queue-log row. Show "Waiting to send" instead when the table already has a queued entry. |
| A-15 | #168 | Tapping a zone banner does not mark it seen (Inbox badge); the takeaway comp lock-screen text loses the requester; the 72 px check is only via classes (task 24 measured it); `WaitingCard` `seating_id` is unused. |
| A-16 | lane D | Receiver's wide fact "Table · zone · guests · seats" missing (hub does not send it); call card has no zone / time; Inbox rows for handover / call unchanged; zone alert opened from the Inbox not marked seen (`StaffApp` `onSeen`); `forTable` seating guard optional; add the F01 real lock panel test. **Owner?** the "Handover … closed: the table changed" banner has no frame. |
| A-17 | lane C | `release.note` / `tables.reason.note` key overlap; "{n} orders moved" has the plural only; lane C Urdu strings need a native review (M6). |
| A-18 | — | **Owner?** the `ForceMovedToMe` frame shows the manager's name, time, reason and order total, but the W0.4 `LockBannerState` carries the table only, so 23b shows table + "Open table". Extend the contract? |
| A-19 | — | **Done in #193 (IR-12, AD-C20):** ~~**Task 28 decision:** `Enqueue` answers `queued` even when the entry went to the queue log (session ended), so the caller's toast "Will be sent when the hub is back" is wrong. Needs an additive field on W0.4 `EnqueueResult` (`S/tables/contracts.ts`).~~ |
| A-20 | #186 | The e2e doc lacks the browser-install note (sandbox Chromium one revision behind Playwright 1.65 → symlink workaround); the e2e `signOut` helper swallows errors; online Bill / Clean flows → task 28. |

## 02b (ordering client)

| # | PR | Finding → action |
|---|---|---|
| B-1 | #151 | `money.ts:20` writes the deal-line kind union by hand; reuse `LineKind` from `orders/contracts.ts:13` at the next change to that file. |
| B-2 | #156 | Missing tests: quota-exceeded / aborted transaction; "no IndexedDB" for the draft store; the queue's no-IDB test misses delete; concurrent put + delete. |
| B-3 | #158 | `stock-mirror.ts:69` seeding drops the count time for "not counted" entries (shows too little stock until the next catch-up). **Owner?** the real fix is the hub sending the entry unit in catch-up (a hub task). |
| B-4 | #158 | `stock-mirror.ts:181`: add a comment that the mirror trusts hub frames; add tests for day close → reopen + recount and a partial release. |
| B-5 | #162 | A closed tab's queued entries stay hidden from an open tab until reload; the `later` flag is true for an in-flight Send again. |
| B-6 | #164 | A stored draft arriving ms after a tap is overwritten silently. |
| B-7 | #165 | Icons differ from the frame; queue-log rows after a restart don't name whose order it was; the sign-in drain has no time limit (`shell-hooks.ts:20`: a hung hub keeps the PIN waiting); no drain test with a second person signing in. |
| B-8 | #171 | Clock set back delays the lock (a ≥ 24.8 d jump loops the timer); drain / logout have no time limit; kiosk keyboard focus can't reach Sign in; a 5xx drain fail then logout turns entries into "Send again as new person". |
| B-9 | #167 | A Q-7 option name mismatch is dropped silently; a removed option / deal choice is dropped silently; caps ignore the cart's other lines for linked options and deal parts; no Urdu sheet test; "Done" pill vs "Add" text on a deal quantity raise; frame diffs: station queue line in the header, ready time, weighed sheet Cancel. |
| B-10 | #167 | The menu-change test covers removed variants only (not a removed deal or an edited line); redundant note clamp on save. |
| B-11 | #174 | "Time updated" compares per line; the spec says when a group's promise moves ≥ 60 s. Toggle / remove while sending is guarded by a ref but untested. |
| B-12 | #178 | Remove sheet says "Already cooking — use Void" for served / out-of-engine lines; blank body + toast after a failed first read; no unmount guard on `load()`; stale "live total" comment in `WeightSheet`. |
| B-13 | #180 | Two surviving mutations with no user-visible change (accepted; no action). |
| B-14 | #181 | Permission refusal always says "This zone is not one of yours" (even when the grant was revoked); "Couldn't load the orders" alert shows over a stale list. |
| B-15 | #183 | Until H6 is on the module branch, a `COMP_PENDING` card for another's request clears only on `LineComped` (goes away once H6 arrives from `main`); the Q-11 test lacks a hub ≠ preview case; a denied-grant comp-it entry stays in memory. |
| B-16 | #185 | `ReleaseSheet` loses the pinned attempt on Cancel + reopen (hub skips released lines); no tests for catch-up seeding of known orders or the `ReleaseSheet` tick lock. |
| B-17 | #201 | `S/orders/order-screen/OrderScreen.tsx` (~line 89): the new `tableCode` helper sits between the draft-store doc comment and `useDrafts`, so `useDrafts` lost its comment and `tableCode` carries a stale one. Move `tableCode` above that comment. |
| B-18 | #201 | `S/orders/table-view/OrdersPart.test.tsx` (the new shell re-render test) asserts the selected line survives, not that an opened served round stays open (`Round.tsx` `open` state). Add that assertion at the next change to the file. |

## 03b hub (hub-gaps lanes)

| # | PR | Finding → action |
|---|---|---|
| K-1 | #177 | The plan said one assertion in `restaurant-ws.int.test.ts`; the PR edits two (same scope, Q-62). Put the 01a marker in the next 01a bump, including the #145 push clause. Dark / archived-station warning tests were merged into existing tests; the print-config Urdu item case uses "Naan ★". |
| K-2 | #179 | 00 v1.9.2 §8.2 (~line 1599) is stale ("401/403 wipe and start new request") → reword at the next 00 bump. An already-paired KDS opening `/pair?t=` goes to `/staff/` (Q-29 as written; changing it needs a spec change first). |
| K-3 | #179 | No test that a stored-token pair-page load makes zero network calls (check the fetch stub). `client-dist.int.test.ts:201-203` compares `/kds/` headers to a real `/staff/` build → compare to known header values so the test needs no client build. |
| K-4 | #179 | 03b client K1 must own "revoked KDS token → wipe device keys → `/pair`" **and** add "a network failure on `/auth/station` keeps the stored KDS token". |
| K-5 | #182 | Test #68's budget not checked with both KDS + Pass hooks in one commit; the no-table-event case doesn't assert the total statement count unchanged; detach / merge-without-absorbed untested; `kds-catch-up.ts:100` `db.prepare` → `cachedPrepare`. |
| K-6 | #184 | `admin.printer_problem` has no UR key (template is language-neutral); `client-dist` tests need a client build first (see K-3). |

## Process / close

| # | Source | Item → action |
|---|---|---|
| P-1 | #150, #171 | **StrictMode sweep:** objects created in `useMemo` and disposed in an effect cleanup break live objects in dev (`StaffApp.tsx` and others). Sweep once at close. |
| P-2 | lane note #119 | `pulse-02.css` reuses `.cart` / `.ln` / `.eta` / `.plate` from `pulse-staff.css` unscoped — manual check M8. |
| P-3 | close | Done in the 02a close docs: Q-63 row in `docs/OPEN-QUESTIONS.md` §10 + pilot rule M10; plan Close notes for 26c2 (Q-64, 01c V9, #180), 27a2 files (#183) and the 23b phone 64 px (IR-10). |
