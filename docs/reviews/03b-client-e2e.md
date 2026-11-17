# 03b / 03c client — Playwright flows (task Z1)

Spec: 03b v1.0.8 §8, §10 tests #70–#76; 03c v1.0.9 §8. Plan: `docs/plans/03b-client-plan.md` task Z1.
Branch `close/03b-client` on `module-03b-client` (0582cb1). Not part of the gate (`pnpm test:e2e` only; never in CI or the cloud).

## Run

```
pnpm --filter @pos/client test:e2e     # builds the client, then playwright test
```

`pnpm test:e2e` builds first. A bare `playwright test` does not: after a client change run `pnpm --filter @pos/client build`
(a stale `dist/` once made a fixed bug look open). Chromium was already on the machine; its folder was named through the
environment of the command (`PLAYWRIGHT_BROWSERS_PATH=<dir> TMPDIR=/dev/shm`), no machine path is committed. One worker,
one test hub for the whole run.

**Result: 185 passed, 0 failed, 50 skipped** (235 tests in 17.6 min; the skips are the specs' own viewport selection). The older 02a / 02b flows are in the same run and pass with the tick loop on**

The 03b specs are tagged `@combined`: they need the hub files of `module-03b-hub-gaps` (HK1–HK7: the `/kds/` entry, the
KDS and point catch-ups, the print and kds config queries) as well as this branch. They were run in a tree of this branch
plus those hub files; they go green on `main` only after hub-gaps is there too (README R34 order: hub-gaps with or before
this branch).

## Fixture (outside the plan row's file list)

- `e2e/global-setup.ts`: a Cook role (`run-pass`, `reprint-ticket`, PIN 1234); the hub's tick loop is started (kitchen-screen
  presence → takeover); a clock driver advances the test hub's fixed clock 1 s a second only while a spec holds the flag file
  (`withLiveClock` in `03b-support.ts`, used by the takeover flow). Every other spec keeps the fixed clock: with a running
  clock the 02a join order, the "Done already?" confirm and the admin "Offline" chip all changed.
- `Object.assign(hub.deps.secrets, cryptoSecrets)`: the test hub's secrets wrap after 8 tokens ("UNIQUE constraint failed:
  devices.token_hash" at the ninth pairing); the 03b fixture pairs many devices, so the real crypto secrets are swapped in
  (approved by the integrator for this PR).
- `e2e/03b-fixture.ts`: per (flow, viewport, language) run one station `S3-<key>` (two_tap) with three lines (Seekh Kebab ×2,
  Chicken Tikka ×1, Tandoori Roti ×4) on one fired takeaway order; Pass and takeover runs also get their own point and a
  Pass tablet bound to it (`devices.point_id`); `kds_offline_ms` is 3 s. One fake LAN printer (a real TCP socket on
  127.0.0.1); its `PrinterSaved` event is seeded directly because SavePrinter refuses a loopback address (03c §3.2).
- `e2e/03b-support.ts`: pairing through the real `/pair` page and approve API, admin session, Pass sign-in, card locators.

## Flows

| Screen id | Spec | Viewports | en | ur | Result |
|---|---|---|---|---|---|
| KDS station view, Start / Done / Undo, Reprint (IR-15) | `03b-kds.spec.ts` | 1920, 1280 | done | differs | done at both widths (`kgrid--1280` / `kl--c` only at 1280). Urdu: the KDS is English only (brief §6.1), so the `ur` run asserts `lang=en dir=ltr`, the same flow |
| KDS second window takes the session (M53, 4401 `replaced`, "Use this window") | `03b-takeover.spec.ts` | 1920, 1280 | done | differs | as above, KDS English only |
| Pass: Start / Done on a screenless station, Ready to serve, Hand over | `03b-pass.spec.ts` | tablet landscape, portrait | done | done | the taker (Ali, takeaway) gets the Ready in the Inbox and "Food handed to you" after Hand over; portrait shows one card column (`pcards--1`) |
| Pass takeover: the screen's window closes | `03b-pass-takeover.spec.ts` | tablet landscape, portrait | done | done | differs from the plan wording only in the cause: the screen's window is closed (not its socket alone), which is what the hub sees as a dropped screen; the section, Start, Reprint and "screen is back" are driven |
| Admin kitchen screens (row, lane, volume) | `03b-admin.spec.ts` | tablet landscape (laptop), phone 390 | done | done | |
| Admin printers (card, Test print, add, loopback refused, archive) | `03b-admin.spec.ts` | tablet landscape (laptop), phone 390 | done | done | Archive by a real click after #213 |

Runs on the other projects skip (the specs name the viewports they cover).

## Real bugs found

- KDS body class `pos-staff` collided with the `.pos-staff` name-tile grid: `main.kgrid` covered every button, so Start and
  Done could not be clicked. Fixed in #211 (IR-23), its own PR.
- The printer card's ⋯ menu opened outside the viewport at the bottom of the list, Archive unreachable by a click. Fixed in
  #213 (IR-25), its own PR (`admin-03-additions.css`; `admin-03.css` stays equal to the handoff file).

## Not driven here

Real printers, sound output, cable pull, paper-out and the Urdu native review: `docs/plans/03b-manual-checks.md` (pilot
hardware only). The KDS takeover edge "old window, close 4401 without a reason" is also a manual check.
