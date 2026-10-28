# 01b status board (autobuild)
| Task | Status | Attempts | Depends on | Note |
|---|---|---|---|---|
| T0 | DONE | 1 | - | done by human (P-1 answer A) |
| T1 | DONE | 1 | - | c8fe165; AD-1 (#77 duplicate-Manager case via rolled-back partial run) |
| T2 | DONE | 1 | T1 | d21d8d1 |
| T3 | DONE | 1 | T1 | 8eb9cd4; passed at once, watched fail with valid setup |
| T4 | DONE | 1 | T1 | ca61be9 |
| T5 | DONE | 1 | - | 736506c; AD-2 (catalogue groups) |
| T6 | DONE | 1 | T5 | 7385fce; AD-3 (interim v1-valued v2 keys in cloud loadDirectory, hub DirectoryCore) |
| T7 | DONE | 1 | T1,T6 | 76f631f; AD-3 interim keys replaced; 01a poll budget tests → ≤ 17 (01a v1.3 §6.1); #83 split: cloud half here, hub half in apply-directory (R-2) |
| T8 | DONE | 1 | T6 | 365d868; AD-3 DirectoryCore now the stored v2 shape; AD-9 (skip ids) |
| T9 | DONE | 1 | T5,T8 | 5ee236f; #18 hub half passes at once (00 ttlFor) |
| T10 | DONE | 1 | T9 | ecd44f3; #19 passed at once (T9 permissionsOf); 00 #46/#82 roster rows gain responsibilities [] |
| T11 | DONE | 1 | T6 | 7ccb562; AD-7 (row types in versions.ts) |
| T12 | DONE | 1 | T1,T5,T6,T11 | 156fe20; AD-10, AD-11; #93 and #73 extended; create already checks §3.2 rules 5–6 (loop walk in T15) |
| T13 | DONE | 1 | T8,T12 | 0a4785c; #3 hub half passes at once (00 apply code, P-3) |
| T14 | DONE | 1 | T12 | 7d6700a; AD-14; #73 extended with PATCH; interim: is_active not applied yet (merged row keeps stored value) |
| T15 | DONE | 1 | T14 | 08ef777; #26 and #57 passed at once (T12 create checks); loop walk is one recursive statement per entry |
| T16 | DONE | 1 | T14 | 93c27a0; AD-15; is_active applied (T14 interim removed) |
| T17 | DONE | 1 | T8,T16 | 202dd11; #9 cloud and hub halves passed at once (T16 / 00 code); #101 failed first; T19 guard test now expects STAFF_LINKED_TO_OWNER for leaving the linked row |
| T18 | DONE | 1 | T16 | 3bfd918; passed at once, watched fail with the tenant lock removed; stale report retries with changed_versions (B23) |
| T19 | DONE | 1 | T14 | 1df74d0; AD-16 (CLI shares the person predicate, not the per-branch map); #93 green |
| T20 | DONE | 1 | T19 | 87aa1f7; passed at once, watched fail with the tenant lock removed; no src change |
| T21 | DONE | 1 | T12 | b2ff8a3; FOR UPDATE mutation checked (fails), restored |
| T22 | DONE | 1 | T12 | 1e6331f; AD-13; Class A: seeded ids get their own id space in the restaurant fixture |
| T23 | DONE | 1 | T9,T22 | ee8c4cd; passed at once, watched fail with B8 check and idle range removed; #17 PATCH part added in T24 |
| T24 | DONE | 1 | T22 | aa2f6dd; AD-17 (interim: `archived` not applied until T25); #17 extended with PATCH |
| T25 | DONE | 1 | T24 | b80df4a; AD-18 (role PATCH guards from T25; one audit row per archive); T26 #63/#76 may pass at once |
| T26 | DONE | 1 | T19,T25 | bf9c888; AD-20 (#63 leaving case → STAFF_LINKED_TO_OWNER per J-6/#101; client string in T52); passed at once, watched fail with role-PATCH guards and return check removed |
| T27 | DONE | 1 | T12 | 481d7db; AD-19 |
| T28 | DONE | 1 | T9 | 71157dc; AD-21 (scope check after the 01a checks) |
| T29 | DONE | 1 | T28 | bd4c79f; AD-23 (manage_stock_scope on every answer) |
| T30 | DONE | 1 | T14,T24,T27 | 5e34122; #104 failed first (hook); #80/#102 passed at once, watched fail with holder marks and staff version check removed |
| T31 | DONE | 1 | T12 | 64ad887; AD-22 (audit `{ name }`, `branch` audit entity) |
| T32 | DONE | 1 | T2,T12 | cf6a798; lint fix 6232378 |
| T33 | DONE | 1 | T6,T31 | b770b0a; 01a #1 (304 → 2 statements), #176, #177 (new list fields) updated per 01a v1.3 |
| T34 | DONE | 1 | T1,T19 | e0ec2b8; AD-6 (interim inline admin SQL until T19); AD-4 (reissue locks tenant, no bump); #93 GET part done in T12 |
| T35 | DONE | 1 | T1 | 2c26807; AD-8; #65 change-password part done in T38; #73 GET staff done in T12, PATCH waits for T14 |
| T36 | DONE | 1 | T35 | ba6e263; refresh notice interim null until T37 |
| T37 | DONE | 1 | T35 | 5af3f2b; #42 passed at once (T35/T36 code) |
| T38 | DONE | 1 | T35 | 434dd4f; AD-12; #65 extended; steps (3) lock and account counter left to T39 |
| T39 | DONE | 1 | T38 | 0a6ade9 |
| T40 | DONE | 1 | T38 | 85f367b; passed at once, watched fail with each hash compare-and-set removed; ran after T41 (#90 uses the reset CLI) |
| T41 | DONE | 1 | T35 | 964c42a; AD-24 (CLI output, hook) |
| T42 | DONE | 1 | T37,T38 | 0f9ad19; both cases fail with the refresh's owner-row lock made a plain read; restored |
| T43 | DONE | 1 | T41,T42 | 5a2a5db; passed at once (T41 hook, T42 locks), watched fail with the reset's credential_version bump removed; Class A: test secrets repeat every 8 tokens, #74 e clears token rows per run |
| T44 | DONE | 1 | T42,T43 | dd795e2; no src change; watched fail (40P01) with the owner-row lock made FOR SHARE, restored |
| T45 | DONE | 1 | T1,T12 | 2cc3421; AD-25 (#97 B case by non-assignment), AD-26 (CLI output) |
| T46 | DONE | 1 | T45 | 6e74b14; passed at once (T45 code); #99 a and b fail with the CLI tenant lock removed, restored |
| T47 | DONE | 1 | T41,T45 | bd48dd2; P-3 answered: call-back step added to the runbook (review R-4) |
| T48 | DONE | 1 | T1,T5 | 60caf88; dev re-seed (manual-test-00) left for the human; #20 split: cloud half in load-directory, hub half in apply-directory (R-1) |
| T49 | DONE | 1 | T8,T16 | c16e802; AD-28; #62 hub half passes at once (00 code, P-3) |
| T50 | DONE | 1 | T6 | 133722a; AD-27 (interim: nav items before their views, T51-T55); Urdu: 45 keys in docs/design/handoff/01b/urdu-todo.md |
| T50b | DONE | 1 | T50 | c5894db; AD-30, AD-31; P-4 answered B: phone Menu button + nav on Dialog, tab bar removed (review R-4); 16 Urdu keys left |
| T51 | DONE | 1 | T50,T50b | 388783e; laptop shell only (not blocked by P-4); design vs spec in build log |
| T52 | DONE | 1 | T50,T50b | 8dd3639; tests written first, first run after the views (failed on missing module) |
| T53 | DONE | 1 | T50,T50b | f54b237; station item names not shown (design vs spec) |
| T54 | DONE | 1 | T50,T50b | f7824f0; AD-32 (hub away notice uses the response threshold) |
| T55 | DONE | 1 | T50,T50b | 1ad4cdc; JWT then refused refresh passed at once (01a client); build with VITE_SUPPORT_PHONE not run here (sandbox) |
| T56 | DONE | 1 | T29,T50,T50b | 576bce8; AD-33 (counter no-day screen, note, outside_scope text) |
| T57 | DONE | 1 | T12,T22,T24,T27,T31,T32,T38,T48,T49 | 32052dc; #55 failed first (client fixture roles renamed, Class A); #96 watched fail by mutation |
| T58 | DONE | 1 | T57 | a0db376; README 01b Implemented, pending page flows and release drill; pnpm test 218/906 green |
| T59 | WAITING | 0 | T58 | plan STOP after T58: set back to TODO when the human confirms; Playwright via webapp-testing |
| T60 | WAITING | 0 | T59 | waits for T59 (plan STOP after T58) |
| T61 | PARKED | 0 | T58 | needs hardware; see P-2 |
