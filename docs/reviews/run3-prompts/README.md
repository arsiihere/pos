# Run 3 review prompts (02b-TK package)

One self-contained brief per spec; run them in parallel (Codex cloud tasks), each writes `docs/reviews/<spec>_hostile_run3.md` and nothing else. Specs already ready for approval (no run 3): 05a v1.0.7, 03c v1.0.16, 01c v1.5, Foundation v1.18. 05c v0.2 is parked (no review).

| Brief | Spec | Scope |
|---|---|---|
| `02b_v1.0.25.md` | 02b | full |
| `01d_v1.3.7.md` | 01d | v1.3.7 rows |
| `03b_v1.0.16.md` | 03b | full + Pass points by order type (first review) |
| `03a_v1.2.11.md` | 03a | full |
| `05_v1.0.35.md` | 05 | v1.0.35 rows |
| `00_v1.13.md` | 00 HPA | targeted: public listener |
| `01b_v1.12.md` | 01b | targeted: B-4, B-5, §5.1c |
| `01a_v2.11.md` | 01a | targeted: PT rows |

After all eight are in, the spec lane (Claude) fixes them; Codex lanes waiting on a spec start when its run 3 is clean (`docs/plans/02b-tk-lanes.md`).
