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
# 02b-TK build shots — L-CLIENT-6b

The running client on a demo hub (`apps/client/e2e/shots/demo-setup.ts`: a menu shaped like the frames — Paye, Chicken Karahi Half / Full / By kg with "With it" add-ons and cooking choices, Tandoor breads, drinks, a Family Deal; Sana at Counter 1; hub clock at lunch). Rebuild with:

```bash
pnpm --filter @pos/client build
```

```bash
cd apps/client && TZ=Asia/Karachi npx playwright test -c playwright.shots.config.ts 6b-shots --project=1920
```

(one `--project` per run — 1920, 1366, 1280, 390 — so each size starts on a fresh hub). `<Frame>-<size>.png`; an Urdu capture of an English frame is `<Frame>-Urdu-<size>.png`. Never part of the gate.

| Frame | Verdict | Remaining differences |
|---|---|---|
| HeldDrawer | Match | — |
| ItemSheet | Close | No "Half karahi usually: 4 naan" hint (companions, GAPS G-5); header has no "2 of 3 busy" (stations-live has no slot count — shows "{station} busy / full" by band); a Serve row (02b v1.0.21 STAB-5) the frame does not draw |
| ItemSheetEdit | Close | as ItemSheet; 1366 Urdu not captured (the cart's lines collapse at 1366 × 768 in Urdu — cart layout, client-6a) |
| ItemSheetKg | Close | as ItemSheet |
| ItemSheetUrdu | Close | item, option, group and size names stay English (the menu has no Urdu names — owner data) |
| DealSheet | Different | one choice per part (01c §3.4.3; the hub refuses a part chosen twice), so "Drinks — pick 4 · n of 4" with steppers is choice buttons; no part names (deal parts have none) — sections read "4× — pick 1"; no deal-level "Extra naan" (deals have no add-on groups) |
| TokenDue | Close | "Print slip" (03c §8) for the frame's "Print token"; Print check bill in the grid |
| TokenReady | Close | "Print receipt again" (05 §8 OR-5) where the frame shows "Print token" |
| TokenPartial | Match | — |
| TokenLate | Match | — |
| TokenUrdu | Close | item names English (owner data) |
| TokenAddItems | Close | the "Adding to token · name · Paid/Due" banner and the "Ready by #53: 1:31 → 1:33" line sit above the screen, not inside the cart (the cart is client-6a's); no bill amount in the banner |
| TokenRemove | Close | no reason chips (RemoveItems carries no reason, 02b §6.2); no line pre-ticked |
| PhoneToken | Close | — |
| PayCash | Match | — |
| PayCashShort | Match | — |
| PayCard | Close | mode names come from billing config (English) |
| PayDone | Match | — |
| PayUrdu | Close | Cash / Card names from billing config |
| CustomerDisplay | Close | item names single-language (owner data); mark = branch-name initials (the hub serves no restaurant name) |
| PersonMenu | Close | header line is "branch · device type", not "Cashier · Counter 1" (role and device name are not on the client) |
| HomeUrdu / HomeTabletUrdu / HomeRushUrdu / PickupLaterUrdu / PhoneCartUrdu | Close (strings + RTL) | category and item names English (owner data); layout is client-6a's |
