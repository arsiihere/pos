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
| T29 | TODO | 0 | T28 | |
| T30 | DONE | 1 | T14,T24,T27 | 5e34122; #104 failed first (hook); #80/#102 passed at once, watched fail with holder marks and staff version check removed |
| T31 | DONE | 1 | T12 | 64ad887; AD-22 (audit `{ name }`, `branch` audit entity) |
| T32 | DONE | 1 | T2,T12 | cf6a798; lint fix 6232378 |
| T33 | TODO | 0 | T6,T31 | |
| T34 | DONE | 1 | T1,T19 | e0ec2b8; AD-6 (interim inline admin SQL until T19); AD-4 (reissue locks tenant, no bump); #93 GET part done in T12 |
| T35 | DONE | 1 | T1 | 2c26807; AD-8; #65 change-password part done in T38; #73 GET staff done in T12, PATCH waits for T14 |
| T36 | DONE | 1 | T35 | ba6e263; refresh notice interim null until T37 |
| T37 | DONE | 1 | T35 | 5af3f2b; #42 passed at once (T35/T36 code) |
| T38 | DONE | 1 | T35 | 434dd4f; AD-12; #65 extended; steps (3) lock and account counter left to T39 |
| T39 | TODO | 0 | T38 | |
| T40 | TODO | 0 | T38 | may pass at once; watch fail per plan |
| T41 | TODO | 0 | T35 | |
| T42 | TODO | 0 | T37,T38 | |
| T43 | TODO | 0 | T41,T42 | |
| T44 | TODO | 0 | T42,T43 | |
| T45 | TODO | 0 | T1,T12 | |
| T46 | TODO | 0 | T45 | |
| T47 | TODO | 0 | T41,T45 | Claude only (docs/runbooks) — autobuild can do it |
| T48 | DONE | 1 | T1,T5 | 60caf88; dev re-seed (manual-test-00) left for the human; #20 split: cloud half in load-directory, hub half in apply-directory (R-1) |
| T49 | TODO | 0 | T8,T16 | |
| T50 | TODO | 0 | T6 | |
| T51 | TODO | 0 | T50 | |
| T52 | TODO | 0 | T50 | |
| T53 | TODO | 0 | T50 | |
| T54 | TODO | 0 | T50 | |
| T55 | TODO | 0 | T50 | |
| T56 | TODO | 0 | T29,T50 | |
| T57 | TODO | 0 | T12,T22,T24,T27,T31,T32,T38,T48,T49 | |
| T58 | TODO | 0 | T57 | plan marks STOP after this task; T59+ wait for human |
| T59 | TODO | 0 | T58 | Playwright via webapp-testing |
| T60 | TODO | 0 | T59 | |
| T61 | PARKED | 0 | T58 | needs hardware; see P-2 |
