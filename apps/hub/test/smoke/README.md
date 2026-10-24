# Hub smoke test — spec 00 §10 #79

Checks the §7.8 targets on the machine it runs on. Run it on the pilot hub mini PC and record the output, or the gap, in `docs/reviews/` (§12.1).

```sh
pnpm --filter @pos/hub smoke
```

| Line | Target (§7.8) | How |
|---|---|---|
| `auth_pin_p95` | `/auth/pin` p95 ≤ 300 ms, no contention | 40 sequential logins on a test hub (M8 argon2 params) |
| `command_p95` | no-op command pipeline p95 ≤ 5 ms | 200 `TestNoop` commands through `POST /commands/test-noop` |
| `boot_1m` | 00's boot steps on 1 M events ≤ 5 s | `boot()` on the #100 fixture (built once, cached in the OS temp dir) |

The first 20 requests of each loop are warm-up and are not sampled. Each line ends in `ok` or `MISS`; the exit code is 1 if any line is `MISS`. Requests go through Fastify `inject`, so the request timings leave out the network.
