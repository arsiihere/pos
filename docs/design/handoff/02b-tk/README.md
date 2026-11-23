# Module 02b-TK · Takeaway · Pulse hand-off

The cashier's takeaway screen (kiosk first, then tablet and phone), plus the pickup board, the packer view, the customer status page, the token slip and the counter-facing display. Same format as `docs/design/handoff/02b`.

- `PROMPT.md` — paste into Claude Code (repo root, this folder placed at `docs/design/handoff/02b-tk/`).
- `CHANGES.md` — owner answers, information architecture, rules, per-screen decisions, hostile review, **new string keys (en + ur)**, open questions.
- `MAPPING.md` / `mapping.json` — screen → frames → components → data (endpoint).
- `GAPS.md` — everything the design needs that the hub API / specs don't give today, with the spec to change.
- `TAPS.md` — tap counts, today vs this design.
- `INDEX.html` — all frames as thumbnails.
- `brief/takeaway-brief.md` — Phase 1–3 findings (as-built audit, jobs, features) the design answers.
- `design/` — `*.dc.html` frames (static HTML at device size), `screens/*.png`, `pulse-tk.css`, `ds/` (tokens + fonts).
- `gen/` — the Python that builds every frame and screenshot (`python3 gen/build.py`, needs Playwright + Chrome), so states can be added without hand-editing HTML.
