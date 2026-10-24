# Tap test (OQ4): throwaway field tool

This tool is not product code. Delete it after the 2 weeks. The only goal is to find out whether kitchen staff will actually tap START/DONE during a rush, and how often.

## Run it
```bash
cd tools/tap-test
node server.js            # needs Node 18+, no npm install
```
- Phone (on the same Wi-Fi): open `http://<laptop/PC IP>:8090`. Find the IP with `ipconfig` on Windows or `ip a` on Linux.
- Summary: `http://<IP>:8090/summary`
- Data: `data/taps-YYYY-MM-DD.csv`, one file per day. Copy it every evening.

If Windows Firewall shows a prompt, allow Node on Private networks.

## Phone setup at the tandoor
- Mount it on the wall at eye level, out of the way of heat and splashes. Keep it within reach but **not** in the direct heat.
- Keep the charger plugged in. Set screen timeout to "never" (Developer options → Stay awake while charging).
- Turn brightness up, and turn auto-rotate off.
- Pick the station from the dropdown once. The phone remembers it.

If the Wi-Fi drops, taps keep being saved on the phone, and the line at the bottom turns orange with "Not uploaded yet: N". They upload automatically once the Wi-Fi is back.

## What staff do
- Item goes in the tandoor / starts → **START (شروع)**
- Item comes out / is ready → **DONE (مکمل)**
- Wrong tap → **UNDO (واپس)**, which cancels the last tap

Don't push them. Explain it once, and then don't force it. Whether they tap on their own is exactly the data you're after.

## Supervisor paper log (rush hours only)
Every 15 minutes, on one sheet:

| Time | Items out (count) | Notes (rush? staff short? phone ignored?) |
|---|---|---|
| 1:00 | 18 | rush, tandoor guy didn't tap |

## Read it every evening
Compare the `/summary` DONE count with the paper log for the same hours.
- **Taps ≈ paper (within 10%):** tapping works, and 03a can rely on START/DONE.
- **Taps 10–30% short:** it works only when there's no rush. 03a needs fallbacks (auto-DONE from timers, batch DONE).
- **Taps >30% short or ignored at rush:** 03a's tap-driven design is wrong. Rethink before you write spec 03a.

Also look at `peak_taps_per_min` (the real ceiling), `p90_gap` (real cook time), and `unmatched_starts` (forgotten DONEs).
