# Codex instruction — 02b-TK backend, Tier 1 (takeaway counter on day 1)

You are OpenAI Codex working in this repository (restaurant POS monorepo, pnpm + Turborepo, TypeScript, hub = Node 22 + Fastify 5 + SQLite, cloud = Fastify 5 + Postgres 16). You implement **Tier 1** of the 02b-TK backend from start to end, lane by lane, and you **stop and report** at the points named below. You do not design and you never change a spec.

## 1. Read first (in this order)

1. `AGENTS.md` — the repo rules (same as `CLAUDE.md`). They bind you.
2. `docs/plans/02b-tk-lanes.md` — **the lanes, their owned paths, reserved migration numbers, dependencies, tests and "done when"**. Section "Tier 1 — lanes in start order" is your work list.
3. `docs/plans/02b-tk-backend-plan.md` — the task details (ids like B2-1, E-4, U-2) with spec §§, files and tests.
4. `docs/plans/02b-tk-rulings.md` — owner rulings R1–R9 and the owner-review answers OR-1–OR-7 (binding).
5. For each lane: the spec sections it cites in `docs/specs/` (read the §, its tests in §10, its §11 build step).

## 2. Scope

**Tier 1 only:** open-orders rework (paid order stays until handed over, bill state, `ready_at`); `pickup_at_ms` and the 03a whole-order-hold engine chain; ready alert to the kiosks + not-collected (R8); Pass points by order type, the Pass role and the hub side of "Handed to customer"; the unpaid hand-over request (01d / 02b / 01b); `PrintCartCheckBill` and the takeaway token slip (no QR in Tier 1: `statusLink` is injected and returns `null`).

**Not yours:** Tier 2 (board, voice, display session, status page, customer-orders, companions / short-code routes, top-items, rush), anything in **05c** (parked: no payment intents, no `when_none`, no `payment_*` kinds), and **all client code** (`apps/client/**`, `apps/tablet/**` belong to the client lane).

## 3. Branches

- Lane **L0a** creates `module-02b-tk` from `origin/main` merged with `origin/claude/02b-tk-specs` (the specs and plans branch). If that merge conflicts outside `docs/`, stop and report.
- Every lane works on its own branch `module-02b-tk-<lane>` (e.g. `module-02b-tk-l-print`) cut from the current `module-02b-tk`, and opens a PR **into `module-02b-tk`**. Merge only with CI `gate.yml` green. Never push to `main`, never force-push a shared branch.

## 4. Rules (every lane, every task)

- **Owned paths only.** Edit only the paths in the lane's "May touch" column. If a task needs any other file (a shared type, an error code, an event schema, a registry line): **stop and report**; do not edit it.
- **Never edit `docs/specs/**`.** If code and spec disagree, or a spec is unclear: **stop and report** with the § and the question. Never silently diverge.
- **TDD:** write the failing test first (spec test numbers from §10), then the code. A task is not done without passing tests.
- **One plan task per commit**; the message cites the spec §, e.g. `feat(orders): open-orders keeps paid takeaway until handed over [02b v1.0.25 §3.3, §6.16]`.
- **Full gate before every push:** `TMPDIR=/dev/shm flock /tmp/pos-gate.lock -c "pnpm -w typecheck && pnpm -w lint && pnpm -w test"` (Postgres test DB on port 5433 as `AGENTS.md` describes). All green, no skipped or disabled tests. **Never** run `pnpm test:perf`, printer, hardware or power-loss checks.
- **Migrations:** the runners refuse gaps, so use the **next free number on `module-02b-tk` when your PR is merged** (cloud is at `0020`, hub at `0027` today); renumber before merge if another lane took it. Never edit or renumber a merged migration.
- Build only what the spec asks: no extra layers, dependencies or "for later" code.
- Keep a short log per lane in `docs/plans/02b-tk-<lane>-status.md` (task, commit, tests, notes). That file is the only doc you write.

## 5. The lanes, in order (Tier 1)

Lanes on the same step may run as parallel tasks; they share no files.

| Step | Lane | May start when |
|---|---|---|
| 1 | **L0a** contracts | now — alone |
| 2 | **L-CLOUD-1**, **L-PRINT** (parallel) | L0a merged |
| 3 | **L0b** contracts, **L-AUDIT-1** (parallel) | L0b: run 3 clean for 02b, 03b, 01b, 01a PT. L-AUDIT-1: 04 v1.0.9 approved |
| 4 | **L-ENG**, **L-BILL**, **L-KDS**, **L-ALERTS-1**, **L-ROLES**, **L-PT** (parallel) | L0b merged and run 3 clean for that lane's spec (03a / 05 / 03b / 01d / 01b / 01a PT) |
| 6 | **L-ORDERS-1** | run 3 clean for 02b; L0b, L-BILL's B1-3, L-KDS's B1-4 merged (start with B1-2 → B2-1 → B2-2 → B2-3, the open-orders rework); P-1 after L-ENG; S-5 after L-PRINT; U-4 after L-AUDIT-1 |
| 7 | **L-CLOSE-1** | every Tier 1 lane merged |

For each lane do its tasks in the order of the backend plan, with the tests the lanes file lists, until its "Done when" holds.

## 6. Where to stop and report

Stop (end the task, report, wait for the owner) at each of these:

1. **After each lane** is merged into `module-02b-tk`: report the lane, commits, tests added, statement counts checked, anything you could not do.
2. **Before any lane that waits for run 3 or for 04 v1.0.9** (steps 3, 4, 6): check `docs/reviews/` for `<spec>_hostile_run3.md` of every spec the lane needs and confirm with the owner that its fixes are merged into `claude/02b-tk-specs` (then merge that branch into `module-02b-tk` first). If not, stop and report which review is missing.
3. **B1-0 is done:** the Part A migration is already renumbered to cloud `0020_cashier_mark_served.sql` on `module-02b-tk` (the runners refuse gaps, so the old `0130` idea is dropped). L0a starts at B1-1.
4. Any **spec / code disagreement**, a **file outside the lane's owned paths**, a gate you cannot get green, or a merge conflict outside your lane: stop and report.
5. **After L-CLOSE-1:** report Tier 1 done (checklists, endpoints, open items, the `test:perf` and manual checks the owner must run on real hardware). **Do not start Tier 2.**

Report format (short): lane · branch / PR · commits (one line each) · tests (numbers) · gate result · open questions (§ + question).
