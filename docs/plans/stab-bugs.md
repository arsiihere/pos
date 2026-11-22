# Stabilization 00–05: bug list

All fixes stay on the one local branch `fix/stab-tablet-pairing` (made from `module-stab`, which is at `main` after the
05 merge, #441). Owner, 2026-11-22: no new branch per bug, no push and no PR until the owner asks. One commit per change,
spec cited, gate green locally.

Class: **(a)** the code doesn't match the spec → failing test first, then the fix. **(b)** a behaviour change → spec bump
approved by the owner first, then code.

| ID | Where | Symptom | Root cause | Class | Spec | Push / PR | Status |
|---|---|---|---|---|---|---|---|
| STAB-1 | 00 admin page `/admin`, pair page `/pair` | No way to add a tablet, so no Pass (assembler) tablet can be set up: Approve offers only Cashier / Kitchen, and the Kitchen screens Pass-tablet picker is empty | Tablets pair by token (00 M44), and the hub supports it (`GenerateDevicePairingToken { device_type: 'tablet' }`, `POST /devices/pair`), but no screen used it: the admin page made only `phone` tokens (`#add-phone`), and the pair page always sent `device_type: 'phone'`. The 00 design open question 5 ("waiter tablets") never reached the spec | (b) | 00 v1.12.2 (M86, §6.7, §8.2; tests 167–168) | local, not pushed | fixed (gate green 2026-11-22); owner to test |
| STAB-2 | 03b Pass card, `MarkReadyToServe` | Ready to serve makes the whole order ready even when items are not cooked or not started; no way to mark one item ready | As specified: 03b v1.0.9 §3.5 step 2 takes every live line at the point whatever its stage, and the card's button is enabled whenever the tablet is online (`PassScreen.tsx:296`); readiness is only a hint (K4). No per-line Ready | (b) | 03b v1.0.10 (§3.4, §3.5, §6.6, §6.7, §6.22, §8; tests 77–80, 82, 83) | local, not pushed | spec DRAFT, awaiting owner approval |
| STAB-3 | 03b Pass card | The Pass can Start / Done only screenless stations; a station with a KDS can't be driven from the pass (tandoor: the cook can't tap, the distributor at the pass should) | As specified: 03b v1.0.8 §3.4 (Q-45) shows Start / Done only for screenless stations; the hub already allows `run-pass` on any line (`kds/commands/start-done.ts:116`) | (b) | 03b v1.0.10 (§3.4, §8; test 81) | local, not pushed | spec DRAFT, awaiting owner approval |
