# Spec index

Specs are the source of truth (CLAUDE.md). Module specs inherit the Shared Standards in the foundation spec (§6) and do not redefine them. The foundation is frozen at v1.7 (D64): later issues are fixed in module specs or covered by unit tests.

**File naming:** `NN_<Module>_Spec_v<major>.<minor>.md`. `NN` is the build order below. On a version bump the file is renamed and this index is updated in the same commit.

| # | Spec | Version | Status | Stories | Depends on | Blocked by |
|---|------|---------|--------|---------|------------|------------|
| 00 | [Foundation](00_Foundation_Spec_v1.7.md) | v1.7 | APPROVED — FINAL | All P1 (architecture, state machines, Shared Standards) | — | — |
| 01 | Restaurant Setup | — | Not started | E1 (floors, stations, batch programs, menu, stock) | 00 | OQ1, OQ10, OQ11, OQ14 |
| 02 | Ordering + Tables | — | Not started | E2, part of E5 (device command queue) | 01 | — |
| 03 | Timing Engine + KDS | — | Not started | E3, E4 (hold-and-fire, KDS, printing, slip warnings) | 02 | Overrun handling only: tap-rate field test (OQ4, D43) |
| 04 | Roles + Audit | — | Not started | E6 (permissions, void workflow, audit log) | 02 | — |
| 05 | Billing | — | Not started | E8 (payments, shifts, Z report, blind count, tax invoices) | 04 | OQ15 (PRA, D58) |
| 06 | Offline + Sync | — | Not started | E5 in full (sync, device queue, backup, hub restore) | 01–05 | — |
| 07 | Basic Owner View | — | Not started | D22 (cloud projections, read-only dashboard) | 05, 06 | — |

Open questions and blockers are tracked in the foundation spec §7. Decisions are logged in `docs/stories/stories-refined.md` §1. Reviews go in `docs/reviews/`.
