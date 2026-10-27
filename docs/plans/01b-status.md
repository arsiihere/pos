# 01b status board (autobuild)
| Task | Status | Attempts | Depends on | Note |
|---|---|---|---|---|
| T0 | DONE | 1 | - | done by human (P-1 answer A) |
| T1 | DONE | 1 | - | c8fe165; AD-1 (#77 duplicate-Manager case via rolled-back partial run) |
| T2 | TODO | 0 | T1 | |
| T3 | TODO | 0 | T1 | may pass at once; watch fail per plan |
| T4 | TODO | 0 | T1 | uses scratchDatabaseAt(4) |
| T5 | DONE | 1 | - | 736506c; AD-2 (catalogue groups) |
| T6 | TODO | 0 | T5 | copy v1 schemas to fixture before editing |
| T7 | TODO | 0 | T1,T6 | |
| T8 | TODO | 0 | T6 | |
| T9 | TODO | 0 | T5,T8 | |
| T10 | TODO | 0 | T9 | |
| T11 | TODO | 0 | T6 | |
| T12 | TODO | 0 | T1,T5,T6,T11 | |
| T13 | TODO | 0 | T8,T12 | |
| T14 | TODO | 0 | T12 | |
| T15 | TODO | 0 | T14 | |
| T16 | TODO | 0 | T14 | |
| T17 | TODO | 0 | T8,T16 | |
| T18 | TODO | 0 | T16 | may pass at once; watch fail per plan |
| T19 | TODO | 0 | T14 | |
| T20 | TODO | 0 | T19 | may pass at once; watch fail per plan |
| T21 | TODO | 0 | T12 | |
| T22 | TODO | 0 | T12 | |
| T23 | TODO | 0 | T9,T22 | |
| T24 | TODO | 0 | T22 | |
| T25 | TODO | 0 | T24 | |
| T26 | TODO | 0 | T19,T25 | |
| T27 | TODO | 0 | T12 | |
| T28 | TODO | 0 | T9 | |
| T29 | TODO | 0 | T28 | |
| T30 | TODO | 0 | T14,T24,T27 | |
| T31 | TODO | 0 | T12 | |
| T32 | TODO | 0 | T2,T12 | |
| T33 | TODO | 0 | T6,T31 | |
| T34 | TODO | 0 | T1 | |
| T35 | TODO | 0 | T1 | |
| T36 | TODO | 0 | T35 | |
| T37 | TODO | 0 | T35 | |
| T38 | TODO | 0 | T35 | |
| T39 | TODO | 0 | T38 | |
| T40 | TODO | 0 | T38 | may pass at once; watch fail per plan |
| T41 | TODO | 0 | T35 | |
| T42 | TODO | 0 | T37,T38 | |
| T43 | TODO | 0 | T41,T42 | |
| T44 | TODO | 0 | T42,T43 | |
| T45 | TODO | 0 | T1,T12 | |
| T46 | TODO | 0 | T45 | |
| T47 | TODO | 0 | T41,T45 | Claude only (docs/runbooks) — autobuild can do it |
| T48 | TODO | 0 | T1,T5 | |
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
