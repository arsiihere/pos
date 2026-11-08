# Browser check of the owner timing pages (03a cloud lane)

Headless Chromium (Python Playwright 1.62.0, chromium-1234, no download needed) against the built owner app served by the real cloud on `pos_test_cloud`, seeded with `seed-demo` plus 60 extra items. Widths: 1280 px and 390 px. Scripts and logs: `.superpowers/sdd/03a-plan/browser/`. Every row below was run after the fixes, on the rebuilt app. Each view at 390 px was checked for `scrollWidth > innerWidth` and for elements past the edge: none. Console errors were only the browser's own lines for the refusals the checks provoke (400, 409, 422).

Fix commits: **49d2229** Urdu strings; **65dbb4e** server limits in the box's unit and plain words; **b7cfeef** station name, place, capacity and freshness refusals under the box; **42f40fa** a save's answer scrolled into view; **6ed3d21** kitchen timing one column at phone width.

| Page / check | Width | Language | Result | Screenshot | Fix |
|---|---|---|---|---|---|
| Points: list, add, rename, sort | 1280 | en | OK | `points-renamed-desktop-en.png` | |
| Points: list, add, rename, sort | 390 | en, ur | OK; English buttons before the fix | `points-renamed-390-en.png`, `points-renamed-390-ur.png` | 49d2229 |
| Points: refused archive names the stations | 1280, 390 | en, ur | OK | `points-archive-refused-desktop-en.png`, `points-archive-refused-390-ur.png` | 49d2229 |
| Points: show archived, restore | 1280 | ur | OK | `points-show-archived-desktop-ur.png` | 49d2229 |
| Points: refused restore (name taken) | 1280, 390 | en, ur | OK | `points-restore-refused-desktop-en.png`, `points-restore-refused-390-ur.png` | 49d2229 |
| Points: nav entry in the drawer | 390 | en, ur | OK; "Floors", "Stations" were English | `points-drawer-390-en.png`, `points-drawer-390-ur.png` | 49d2229 |
| Station: range error under the right box | 390 | en | Was "Too big: expected number to be <=900000"; now "Use 15 minutes or less." | `st-range-390-en.png` | 65dbb4e |
| Station: nested carry error under its point | 1280, 390 | en, ur | OK, same wording fix | `st-carry-err-desktop-en.png`, `st-carry-err-390-ur.png` | 65dbb4e |
| Station: every field, alternates with order-type ticks, carry per point | 390 | ur | OK; PATCH holds ms and bp | `st-filled-390-ur.png` | 49d2229 |
| Station: save and reload show saved values | 1280 | en | OK | `st-reloaded-desktop-en.png` | |
| Station: no order type ticked | 390 | en | OK | `st-alt-empty-390-en.png` | |
| Station: name, place, capacity refused | 1280 | en | Was banner only; now under the box (tests; refusal path browser-checked before the fix) | | b7cfeef |
| Station: refused archive, named as an alternate | 1280, 390 | en, ur | OK | `st-archive-refused-390-en.png`, `st-archive-refused-desktop-ur.png` | 49d2229 |
| Item: five knobs, minutes shown, ms sent | 390, 1280 | en, ur | OK. Request: 2.5 min → `max_early_ms: 150000`; emptied carry → `max_carry_ms: null` | `item-open-390-en.png`, `item-reloaded-desktop-ur.png` | 49d2229 |
| Item: goes-with, Never suggest, item past page 1 stays linked | 1280, 390 | en, ur | OK; "Extra item 55" kept and named after removing another link | `item-goes-with-desktop-en.png`, `item-goes-with-390-ur.png` | 49d2229 |
| Item: an error opens the folded section | 1280, 390 | en, ur | OK; the summary was off-screen when scrolled, now scrolls in | `item-range-error-desktop-ur.png`, `item-goes-with-refused-390-en.png` | 42f40fa |
| Category: goes-with picker, no Never suggest | 1280, 390 | en, ur | OK | `cat-form-picked-desktop-en.png`, `cat-form-picked-390-ur.png` | 49d2229 |
| Branch: all 16 kitchen timing fields | 1280 | en | OK; round trip after reload | `branch-settings-desktop-en.png` | |
| Branch: all 16 kitchen timing fields | 390 | en, ur | **Was broken:** boxes 32–38 px, value unreadable; now one column | `branch-settings-390-en.png`, `branch-settings-390-ur.png`, `branch-range-390-ur.png` | 6ed3d21 |
| Branch: real 409 in two contexts | 1280, 390 | en, ur | **Was hidden:** scrolled down, only a greyed Save showed; now the banner comes into view | `branch-409-top-desktop-en.png`, `branch-409-top-390-ur.png` | 42f40fa |
| Branch: Reload shows the first save, second save succeeds | 1280, 390 | en | OK | `branch-reloaded-desktop-en.png`, `branch-resaved-390-en.png` | |
| Menu: category refused by a size group | 1280, 390 | en | OK | `cat-in-use-group-desktop-en.png`, `cat-in-use-group-390-en.png` | |
| Menu: category refused by a deal | 1280, 390 | ur | OK | `cat-in-use-deal-desktop-ur.png`, `cat-in-use-deal-390-ur.png` | 49d2229 |

## Could not be checked

- Real phones and touch input: only a 390 px viewport in headless Chromium, with touch enabled.
- A refused name, place or capacity on the rebuilt app in the browser: the fix (b7cfeef) has component tests and its message path was seen in the browser, but `edge.py` was not rerun on the final build.
- Cloud-down and failed-menu-read states: not provoked.
