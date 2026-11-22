# Spike: lock-screen alerts — results

Branch `spike/lock-alerts` @ <sha>. Hub @ main <sha>. Capacitor <ver>, OkHttp <ver>, targetSdk <n>.

## Units
| Unit | Model | Android / skin | Patch | RAM | Device owner possible? | Mode run | Battery-opt exempt | FSI allowed | Boot start of specialUse FGS |
|---|---|---|---|---|---|---|---|---|---|

## Config per run
| Run | Unit | Wake lock | WifiLock | Ping s | Urgent FSI |
|---|---|---|---|---|---|

## Results
| Run | Scenario | Fired | Received | Notified | Hub receipts | Missed | Dupes | p50 ms | p95 ms | max ms | Recover after outage | Rang (spot check) | Battery %/h | PASS? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Control socket (laptop) p50 / p95: …  · Clock skew start/end/drift: …

## Missed / late alerts (each one explained)
| Run | alert_id | fired | what the device log shows | cause |

## Observations
- …

## Verdict per unit
PASS / FAIL, cheapest passing config, anything the OEM needed.

## Inputs for the 05b spec
- Wake lock needed? WifiLock mode? Client ping value?
- Reconnect / network-callback behaviour that must be specified.
- Boot start: works / needs …
- Full-screen intent: allowed by default / needs …
- Device-owner provisioning steps that worked (exact commands).
- Protocol gaps found in 01d alert mode (if any): describe; do NOT fix in the hub.
