# 03b + 03c client — cleanup list (deferred MINOR review findings)

Owner ruling Q-60: fix rounds only for BLOCKER / MAJOR; MINOR findings land here and are fixed in the close tasks (Z) or the next change to the file. Money MINORs are fixed before merge (03b / 03c move no money, so none are expected). Client lanes only (W0, K, P, A); hub MINORs go to `docs/plans/03b-hub-cleanup.md`. `#n` = the PR whose review found it. Paths: `K/` = `apps/client/src/features/kds/`, `P/` = `…/pass/`, `PR/` = `…/print/`, `AK/` = `…/admin/kitchen-screens/`, `AP/` = `…/admin/printers/`, `A/` = `…/alerts/`.

"Owner?" = the spec is silent or a contract change is needed: ask before fixing.

## W0 (shell and contracts)

| # | PR | Finding → action |
|---|---|---|
| W-1 | #191 | `T/build-output.test.ts` `[03b W0.4]`: the manifest entry check's `${name}/index.html` branch never matches (vite's `root` is the entry folder, so the entry chunk's `src` is `index.html`); match `src === 'index.html' && isEntry` only. |

## Lane K (KDS)

| # | PR | Finding → action |
|---|---|---|

## Lane P (Pass)

| # | PR | Finding → action |
|---|---|---|

## Lane A (admin, print, alert cards)

| # | PR | Finding → action |
|---|---|---|
