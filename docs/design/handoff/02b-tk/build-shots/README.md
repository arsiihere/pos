# 02b-TK L-CLIENT-6a — build shots

The running client, rendered by `apps/client/e2e/fidelity/frames.spec.ts` on two demo hubs (`e2e/fidelity/setup.ts`:
a menu shaped like the hand-off's — Paye · Karahi · Tawa · BBQ · Tandoor · Drinks · Sides · Deals — and real
SubmitOrder / kitchen / AddPayment events for the queue). Compare each `<Frame>-<size>.png` with
`../design/screens/<Frame>.png`.

```bash
pnpm --filter @pos/client build
cd apps/client && pnpm exec playwright test -c playwright.fidelity.config.ts
```

Sizes: kiosk frames at 1920 × 1080, 1366 × 768 and 1280 × 800 (the cashier kiosk device); tablet frames at 1280 × 800
and 1366 × 768 (the tablet device); phone frames at 390 × 844. `HandoverUndo` is taken once (it really hands a bag
over). Token numbers start at 1 on the demo hub (the frames show 46–57). The menu has no photo field (owner: photos
after the pilot): each tile shows its category's placeholder.

Never part of the gate or `pnpm test:e2e`.
