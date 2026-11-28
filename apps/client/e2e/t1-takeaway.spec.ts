import { expect, test, type Page } from '@playwright/test';
import { escapeRe, menuTile, plain, rushOff, sentToken, shiftOpen, signInOn, takeawayTab } from './02b-support';
import { apiSession, capture, hubPlan, planEta, queueEntry, runId, closeAll, cookLine, deviceFor, hubFire, hubNow, printMark, LANGS, passCard, passTablet, printedJob, screen, t1Key, t1Run, t1RunsHere, tr } from './t1-support';
import { t1Station } from './t1-fixture';

// L-E2E-T1 group A — the owner's dry-run checklist ("Takeaway Tier 1 — Restaurant Dry Run Checklist"), the takeaway
// journey against the e2e hub, nothing mocked. The Owner runs the counter (cashier kiosk at the kiosk viewport, the
// landscape tablet otherwise; the fixture's order-taker has no take-payment); Pervez (the Pass role) runs the run's own
// Pass point on its tablet (t1-fixture). Rows:
//   #1  open day and shift → the cart shows a Ready-by time (never "Times will be set when sent")
//   #4  takeaway, pay now (cash): 2 paye + "4n" Enter (4 naan), Send & pay, cash → receipt prints, kitchen gets it
//       (the run's Pass card), the token is in the queue
//   #16 the Pass card shows the token and how much of the bag is ready
//   #17 whole bag only: paye done first → the bag is not Ready until the drink is done too
//   #18 Handed to customer on a paid ready bag, Undo within 5 s brings it back
//   #5  pay later with a phone number → the token slip prints; the order sits in the queue as Due
//   #7  pickup 30 min from now with a drink → Ready by = the pickup time; the kitchen does not start the drink early
//   #8  the customer came early (Boost) → the ready time moves earlier; the bag is not Ready while the drink is made

async function counter(page: Page, lang: Parameters<typeof tr>[0], info: Parameters<typeof deviceFor>[0]): Promise<void> {
  await rushOff(page);
  await signInOn(page, deviceFor(info), lang, 'Owner');
  await shiftOpen(page, lang);
  await takeawayTab(page);
}

/** 03a §3.5.1 step 5 (engine paddingOf): the takeaway promise padding of a station, from the hub's branch config. */
async function takeawayPadding(api: Awaited<ReturnType<typeof apiSession>>, station_id: string): Promise<number> {
  const { snapshot } = await api.query<{ snapshot: { stations: Array<{ station_id: string; policy: string; promise_padding_ms: number | null }>; engine_settings: { promise_padding_takeaway_ms: number } } }>('branch-config');
  const station = snapshot.stations.find((s) => s.station_id === station_id)!;
  if (station.policy !== 'waada_guard') return 0;
  return station.promise_padding_ms ?? snapshot.engine_settings.promise_padding_takeaway_ms;
}

/** The client's clock text (features/alerts/labels.ts `timeText`): 12-hour hub-local time, e.g. "10:52 PM". */
function clientTime(ms: number, utcOffsetMs: number): string {
  const d = new Date(ms + utcOffsetMs);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

async function payCashExact(page: Page, lang: Parameters<typeof tr>[0]): Promise<string> {
  await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_pay'))}`) }).click();
  const token = await sentToken(page);
  const panel = page.locator('.cart .tk-paypanel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
  await expect(panel.getByText(tr(lang, 'p.next'))).toBeVisible();
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
  await expect(panel).toHaveCount(0);
  return token;
}

for (const lang of LANGS) {
  test(`[T1 #1 #4 #16] pay now in cash: Ready by on the cart, "4n" adds 4 Naan, receipt prints, the Pass card and the queue have the token (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      // #1: an open day → the cart's Ready-by is a time, not "Times will be set when sent"
      await menuTile(page, run.items.main.name).click();
      await menuTile(page, run.items.main.name).click();
      await expect(page.locator('.cart .ln', { hasText: run.items.main.name })).toContainText('2');
      // #4: "4n" then Enter
      await page.locator('.cart .tk-total').click(); // L-CLIENT-6a: the takeaway cart has no head
      await page.keyboard.press('/');
      await page.keyboard.type('4n');
      const first = page.locator('.tk-sugg [role="option"]').first();
      await expect(first).toContainText('4×');
      await expect(first, '"4n" picks Naan first').toContainText('Naan');
      await page.keyboard.press('Enter');
      await expect(page.locator('.cart .ln', { hasText: /^.*Naan/ })).toContainText('4');
      const ready = page.locator('.cart [data-ready]'); // L-CLIENT-6a item 5: the Ready by panel
      await expect(ready.locator('b')).toHaveText(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
      await expect(ready).not.toContainText(tr(lang, 'cart.times_later'));
      await capture(page, info, `T1-04-cart-${info.project.name}-${lang}`, page.locator('.cart'));

      const mark = await printMark();
      const token = await payCashExact(page, lang);
      const receipt = await printedJob(mark, 'Receipt');
      expect(receipt.text).toContain('Naan');
      expect(receipt.text).toContain(run.items.main.name.slice(0, 12));
      // the queue holds the paid token until it is handed over
      await expect(await queueEntry(page, token)).toBeVisible();

      // #16: the kitchen got it — the run point's Pass card: token, lines, how much of the bag is ready
      await passTablet(pass.page, 'bag', info, lang);
      const card = passCard(pass.page, token);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.locator('.pl', { hasText: run.items.main.name })).toBeVisible();
      // ⚠️ 03b v1.0.17 §8: the readiness pill (the station line shows only for 2+ stations)
      await expect(card.locator('.rd')).toBeVisible();
      await capture(pass.page, info, `T1-16-pass-card-${info.project.name}-${lang}`, card);
    } finally {
      await closeAll(info, lang, pass, cash);
    }
  });

  test(`[T1 #17 #18] whole bag only: the paye done first leaves the bag not Ready until the drink; Handed to customer, then Undo brings it back (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    try {
      await counter(cash.page, lang, info);
      await menuTile(cash.page, run.items.main.name).click();
      await menuTile(cash.page, run.items.drink.name).click();
      const token = await payCashExact(cash.page, lang);
      // their fire comes (the e2e hub's fixed clock fires nothing by itself)
      await hubFire(t1Station(t1Key('bag', info.project.name, lang)));

      await passTablet(pass.page, 'bag', info, lang);
      const card = passCard(pass.page, token);
      await expect(card).toBeVisible({ timeout: 15_000 });
      // #17: the paye done, the drink not → the bag is not ready and cannot be handed over (03b v1.0.17 §8: no
      // "Handed to customer" while it cooks)
      await cookLine(card, run.items.main.name);
      await expect(card).not.toHaveClass(/\bready\b/);
      await expect(card.locator('.rd')).not.toHaveText(tr(lang, 'pass.ready'));
      await expect(card.locator('.btn--customer')).toHaveCount(0);
      await capture(pass.page, info, `T1-17-half-bag-${info.project.name}-${lang}`, card);
      await cookLine(card, run.items.drink.name);
      await expect(card).toHaveClass(/\bready\b/);
      // the whole bag is ready: Bag ready, then "Handed to customer" is the card's one primary
      await card.locator('.pc__f .btn--ready').click();
      await expect(card.locator('.pc__f .btn--ready')).toHaveCount(0);

      // #18: Handed to customer on the paid, ready bag; Undo within 5 s brings it back; then for real
      const button = card.locator('.btn--customer');
      await expect(button).toBeEnabled();
      await button.click();
      const undo = pass.page.locator('.pass-undo');
      await expect(undo).toContainText(`#${token}`);
      await undo.getByRole('button').click();
      await expect(undo).toHaveCount(0);
      await expect(card).toBeVisible();
      await expect(card.locator('.btn--customer')).toBeEnabled();
      await capture(pass.page, info, `T1-18-undo-${info.project.name}-${lang}`, card);
      const served = pass.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: 15_000 });
      await card.locator('.btn--customer').click();
      expect((await served).status()).toBe(200);
      await expect(card).toHaveCount(0, { timeout: 15_000 });
      // the counter's queue lets it go too
      await expect(await queueEntry(cash.page, token)).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await closeAll(info, lang, pass, cash);
    }
  });
}

for (const lang of LANGS) {
  test(`[T1 #5] Send · pay later with a phone number: the token slip prints; the token is Due in the queue (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await page.locator('.cart input[name="phone"]').fill('03001234567', { timeout: 10_000 });
      await menuTile(page, run.items.main.name).click();
      const mark = await printMark();
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await (await queueEntry(page, token)).click();
      await expect(page.locator('.tk-drawer .tk-fact--due')).toBeVisible();
      // 02b §3.2 step 2b / 03c §3.11: Send · pay later prints the token slip (print_slip)
      // this token's own slip (the fixed hub clock stamps other runs' slips with the same time)
      const slip = await printedJob(mark, 'Token slip', new RegExp(`#${token}\\s`));
      expect(slip.text).toContain('PAY AT THE COUNTER');
    } finally {
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #7] pickup 30 min from now with a drink: the cart's pickup chip, Ready by = the pickup time, the drink not started early (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      await menuTile(page, run.items.drink.name).click();
      // 02b §8 Phone and pickup (R1, R4): pickup chips Now / +15 / +30 / +45 / Time… send pickup_at_ms
      // the chip's words per language (strings-table c.pick_30: "+30 min" / "30 منٹ بعد"; the Urdu has no "+")
      const plus30 = page.locator('.cart [data-pickup-row]').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.pick_30'))}$`) });
      await expect(plus30, 'the cart offers the +30 pickup chip (02b §8)').toBeVisible({ timeout: 5_000 });
      await plus30.click();
      await expect(plus30).toHaveAttribute('aria-pressed', 'true');
      // the footer: "Kitchen times it for <the pickup>" (frame PickupLater .tk-readyby--later)
      const later = page.locator('.cart .tk-readyby--later'); // L-CLIENT-6a item 5
      await expect(later).toContainText(tr(lang, 'c.ready_later'));
      await expect(later.locator('b')).toHaveText(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
      await capture(page, info, `PickupCart-${info.project.name}-${lang}`, page.locator('.cart'));
      const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/commands/submit-order'));
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const pickup = ((await sent).postDataJSON() as { payload: { pickup_at_ms?: number } }).payload.pickup_at_ms;
      expect(pickup).toBeGreaterThan(await hubNow());
      const token = await sentToken(page);
      const api = await apiSession(request, 'S_OWNER');
      try {
        const { orders } = await api.query<{ orders: Array<{ token: number | null; promise_ms: number | null; effective_pickup_at_ms: number | null }> }>('open-orders?order_type=takeaway');
        const o = orders.find((x) => String(x.token) === token)!;
        expect(o.effective_pickup_at_ms).toBe(pickup);
        // ⚠️ 03a v1.2.12 PK2-1 (owner 2026-11-28, QA BUG-5): a takeaway pickup's kitchen target is
        // T_L = max(pickup − padding, land) = pickup − padding here (the kitchen is free 30 min ahead), so the promise
        // (T + padding; engine paddingOf: a Waada Guard station's promise_padding_ms, else the branch's
        // engine_settings.promise_padding_takeaway_ms; 0 on a FIFO / EDF station) is the pickup itself
        expect(o.promise_ms).toBe(pickup);
      } finally {
        await api.close();
      }
      // the kitchen holds the drink: nothing fires before its time
      expect(await hubFire(t1Station(run.key), [])).not.toContain(run.items.drink.item_id);
      // 02b §8 (02b-R4-3): the queue's Phone orders — later row and the token view show the pickup time
      const entry = await queueEntry(page, token);
      await expect(entry.locator('[data-pickup]')).toContainText(tr(lang, 'c.pickup'));
      await entry.scrollIntoViewIfNeeded();
      await capture(page, info, `PickupQueue-${info.project.name}-${lang}`, entry);
      await entry.click();
      await expect(page.locator('.tk-drawer .tk-facts [data-pickup]')).toBeVisible();
      await capture(page, info, `PickupToken-${info.project.name}-${lang}`, page.locator('section.tk-drawer'));
    } finally {
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #8] the customer came early: Customer is here (Boost) at the counter moves the ready time earlier ("Ready ~" beside the struck promise); the bag is not Ready while the drink is made (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const api = await apiSession(request, 'S_OWNER');
    try {
      // a pickup order 45 min ahead, as the counter sends it (SubmitOrder pickup_at_ms, 02b §3.2 step 2b)
      const order_id = runId(`T1-PK-${run.key}`);
      const pickupAt = (await hubNow()) + 45 * 60_000;
      const placed = await api.command('SubmitOrder', {
        order_id,
        order_type: 'takeaway',
        pickup_at_ms: pickupAt,
        lines: [
          { order_item_id: `${order_id}-M`, item_id: run.items.main.item_id, quantity: 1 },
          { order_item_id: `${order_id}-D`, item_id: run.items.drink.item_id, quantity: 1 },
        ],
      });
      expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);
      const token = String((await api.query<{ orders: Array<{ order_id: string; token: number }> }>('open-orders?order_type=takeaway')).orders.find((o) => o.order_id === order_id)!.token);
      await counter(cash.page, lang, info);
      await (await queueEntry(cash.page, token)).click();
      // 03b §3.4 / 02b §6.6a ReleaseBoost: the counter's "Customer is here" (pass.pickup_at points the Pass to it)
      // (the button's words per language: v.here "Customer is here — cook now" / Urdu)
      const drawer = cash.page.locator('section.tk-drawer');
      const here = drawer.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.here'))}`) });
      await expect(here, 'the token view offers Customer is here for a pickup order (02b §8)').toBeVisible({ timeout: 5_000 });
      type Row = { order_id: string; promise_ms: number | null; pickup_at_ms: number | null; effective_pickup_at_ms: number | null; planned_ready_at_ms?: number | null; ready: { n: number; m: number } };
      const rowOf = async () => (await api.query<{ orders: Row[] }>('open-orders?order_type=takeaway')).orders.find((o) => o.order_id === order_id)!;
      const before = await rowOf();
      // ⚠️ 03a v1.2.12 PK2-1 (owner 2026-11-28, QA BUG-5): the engine's plan lands the whole bag for the pickup less
      // the takeaway padding (T_L = max(pickup − padding, land)): not before it
      const planned = await hubPlan(order_id);
      expect(planned.pickup_at_ms).toBe(pickupAt);
      const padding = await takeawayPadding(api, t1Station(run.key));
      expect(planEta(planned)).toBeGreaterThanOrEqual(pickupAt - padding);
      // ⚠️ 02b v1.0.25 §6.16 (BR-1): before the boost the planned customer time is the promise, so the token view shows
      // the promise only (no "Ready ~", nothing struck through)
      const offset = (await api.query<{ hub_time: { utc_offset_ms: number } }>('branch-config')).hub_time.utc_offset_ms;
      const readyBy = drawer.locator('.tk-facts .tk-fact').first();
      expect(before.planned_ready_at_ms).toBe(planEta(planned) + padding);
      expect(before.planned_ready_at_ms).toBe(before.promise_ms);
      await expect(readyBy.locator('b')).toHaveText(clientTime(before.promise_ms!, offset));
      await expect(readyBy.locator('[data-planned]')).toHaveCount(0);
      await expect(readyBy.locator('s')).toHaveCount(0);
      await capture(cash.page, info, `CustomerHere-${info.project.name}-${lang}`, drawer);
      const boosted = cash.page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/boost-order'));
      await here.click();
      expect((await boosted).status()).toBe(200);
      // boosted: no button; the pickup time stays (D1); the effective pickup is gone; the ready time is not later
      await expect(here).toHaveCount(0);
      await expect(drawer.locator('.tk-facts [data-pickup]')).toBeVisible();
      const after = await rowOf();
      expect(after.pickup_at_ms).toBe(before.pickup_at_ms);
      expect(after.effective_pickup_at_ms).toBeNull();
      // 03a PK-5: the boost re-places the order's lines at their earliest fit — the plan's eta moves before the pickup
      // (the stored promise may stay, so promise_ms is not checked)
      const replanned = await hubPlan(order_id);
      expect(replanned.boosted).toBe(true);
      expect(replanned.pickup_at_ms).toBe(pickupAt);
      console.log(`[T1 #8 ${info.project.name} ${lang}] pickup ${pickupAt}, plan eta before ${planEta(planned)} (pickup ${planEta(planned) - pickupAt >= 0 ? '+' : ''}${(planEta(planned) - pickupAt) / 60_000} min), after ${planEta(replanned)} (pickup ${(planEta(replanned) - pickupAt) / 60_000} min), promise ${before.promise_ms} → ${after.promise_ms}`);
      expect(planEta(replanned)).toBeLessThan(pickupAt);
      // ⚠️ 02b v1.0.25 §6.16 (owner ruling BR-1, 2026-11-27; 03a PK-5; 03c §4.2): open-orders carries the customer time
      // (the plan's land + the engine's padding, as receipts) — the promise before the boost, earlier after it; the
      // stored promise (⚠️ 03a v1.2.12 PK2-1: the pickup itself, T = pickup − padding) does not move, and the token view shows "Ready ~{planned}" with
      // that promise struck through beside it
      expect(after.planned_ready_at_ms).toBe(planEta(replanned) + padding);
      expect(after.planned_ready_at_ms!).toBeLessThan(pickupAt);
      expect(after.promise_ms).toBe(pickupAt);
      expect(before.promise_ms).toBe(after.promise_ms);
      await expect(readyBy.locator('small')).toHaveText(tr(lang, 'v.ready_at'));
      await expect(readyBy.locator('[data-planned]')).toHaveText(plain(tr(lang, 'q.ready_planned', { t: clientTime(after.planned_ready_at_ms!, offset) })));
      await expect(readyBy.locator('s')).toHaveText(clientTime(after.promise_ms!, offset));
      console.log(`[T1 #8 ${info.project.name} ${lang}] planned_ready_at_ms ${before.planned_ready_at_ms} → ${after.planned_ready_at_ms} (${clientTime(before.planned_ready_at_ms!, offset)} → ${clientTime(after.planned_ready_at_ms!, offset)}), promise ${after.promise_ms} (${clientTime(after.promise_ms!, offset)}, the pickup; padding ${padding / 60_000} min)`);
      // whole bag (D1): nothing is ready yet — the token is not Ready while the drink is still to make
      expect(after.ready.n).toBeLessThan(after.ready.m);
      // nothing to hand over yet: no enabled Hand over all (L-CLIENT-6b, frame TokenDue: a Due token still cooking shows
      // Take payment as its primary; a paid one shows Hand over all greyed with the time)
      await expect(drawer.locator('button[aria-disabled="false"]', { hasText: tr(lang, 'v.collected') })).toHaveCount(0);
      await capture(cash.page, info, `CustomerHereDone-${info.project.name}-${lang}`, drawer);
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });
}

// BUG-4 (02b v1.0.25 §6.6 BoostOrder, §8 02b-R4-3 "Customer is here — cook now", §6.16 BR-1; 03a v1.2.11 PK-5; D1): QA
// on the cashier kiosk ~20 min before the pickups — a PAID pickup (Send & pay, +15) and a DUE one (pay later, +20) —
// both offer Customer is here to a boost-order holder (the Owner runs this counter; the default Cashier role has no
// boost-order, 01b v1.12 §6.15, so it never sees it). After the boost the button goes, the pickup stays, and the
// Ready-by fact shows "Ready ~{planned}" beside the struck promise once the engine plans it earlier (BR-1).
test('[BUG-4; 02b §6.6, §8] Customer is here on a paid and a due pickup ~20 min ahead; after the boost "Ready ~" (en)', async ({ browser, request }, info) => {
  t1RunsHere(info);
  const lang = 'en' as const;
  const run = t1Run('bag', info, lang);
  const cash = await screen(browser, info.project.use.viewport!);
  const api = await apiSession(request, 'S_OWNER');
  try {
    await counter(cash.page, lang, info);
    const page = cash.page;
    // the paid pickup through the counter: +15 min, Send & pay, cash
    await menuTile(page, run.items.main.name).click();
    await menuTile(page, run.items.drink.name).click();
    const plus15 = page.locator('.cart [data-pickup-row]').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.pick_15'))}$`) });
    await plus15.click();
    await expect(plus15).toHaveAttribute('aria-pressed', 'true');
    const paid = await payCashExact(page, lang);
    // the due pickup as a phone order 20 min ahead (SubmitOrder pickup_at_ms, pay later)
    const order_id = runId(`BUG4-${run.key}`);
    const placed = await api.command('SubmitOrder', {
      order_id,
      order_type: 'takeaway',
      pickup_at_ms: (await hubNow()) + 20 * 60_000,
      lines: [
        { order_item_id: `${order_id}-M`, item_id: run.items.main.item_id, quantity: 1 },
        { order_item_id: `${order_id}-D`, item_id: run.items.drink.item_id, quantity: 1 },
      ],
    });
    expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);
    type Row = { order_id: string; token: number | null; bill?: { state: string } | null; promise_ms: number | null; effective_pickup_at_ms: number | null; planned_ready_at_ms?: number | null };
    const rows = async () => (await api.query<{ orders: Row[] }>('open-orders?order_type=takeaway')).orders;
    const due = String((await rows()).find((o) => o.order_id === order_id)!.token);
    const paidRow = (await rows()).find((o) => String(o.token) === paid)!;
    expect(paidRow.bill?.state, 'the counter token is paid').toBe('paid');
    expect(paidRow.effective_pickup_at_ms).not.toBeNull();
    const drawer = page.locator('section.tk-drawer');
    const here = drawer.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.here'))}`) });
    for (const token of [due, paid]) {
      await (await queueEntry(page, token)).click();
      await expect(here, `token ${token}: Customer is here`).toBeVisible({ timeout: 5_000 });
    }
    // boost the paid one (its drawer is open)
    const boosted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/boost-order'));
    await here.click();
    expect((await boosted).status()).toBe(200);
    await expect(here).toHaveCount(0);
    await expect(drawer.locator('.tk-facts [data-pickup]')).toBeVisible();
    const after = (await rows()).find((o) => String(o.token) === paid)!;
    expect(after.effective_pickup_at_ms).toBeNull();
    const readyBy = drawer.locator('.tk-facts .tk-fact').first();
    const offset = (await api.query<{ hub_time: { utc_offset_ms: number } }>('branch-config')).hub_time.utc_offset_ms;
    if (after.planned_ready_at_ms != null && after.promise_ms !== null && after.planned_ready_at_ms < after.promise_ms) {
      await expect(readyBy.locator('[data-planned]')).toHaveText(tr(lang, 'q.ready_planned', { t: clientTime(after.planned_ready_at_ms, offset) }));
      await expect(readyBy.locator('s')).toHaveText(clientTime(after.promise_ms, offset));
    } else {
      await expect(readyBy.locator('[data-planned]')).toHaveCount(0);
    }
    console.log(`[BUG-4 ${info.project.name}] paid ${paid} boosted: planned ${after.planned_ready_at_ms}, promise ${after.promise_ms}`);
  } finally {
    await api.close();
    await closeAll(info, lang, cash);
  }
});
