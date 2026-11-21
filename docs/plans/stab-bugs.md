# Stabilization 00–05: bug list

Integration branch `module-stab` (from `main` at the 05 merge, #441). One bug per branch `fix/stab-<name>` and one PR into
`module-stab`, merged with the gate green. At the end: one PR `module-stab` → `main` with a merge commit.

Class: **(a)** the code doesn't match the spec → failing test first, then the fix. **(b)** a behaviour change → spec bump
approved by the owner first, then code.

| ID | Where | Symptom | Root cause | Class | Spec | PR | Status |
|---|---|---|---|---|---|---|---|
| STAB-1 | 00 admin page `/admin`, pair page `/pair` | No way to add a tablet, so no Pass (assembler) tablet can be set up: Approve offers only Cashier / Kitchen, and the Kitchen screens Pass-tablet picker is empty | Tablets pair by token (00 M44), and the hub supports it (`GenerateDevicePairingToken { device_type: 'tablet' }`, `POST /devices/pair`), but no screen used it: the admin page made only `phone` tokens (`#add-phone`), and the pair page always sent `device_type: 'phone'`. The 00 design open question 5 ("waiter tablets") never reached the spec | (b) | 00 v1.12.2 (M86, §6.7, §8.2; tests 167–168) | — | in progress (`fix/stab-tablet-pairing`) |
