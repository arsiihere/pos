import { expect, test, type Page, type TestInfo, type WebSocketRoute } from '@playwright/test';
import { escapeRe, menuTile, rushOff, sendCart, sentToken, shiftOpen, signInOn, takeawayTab } from './02b-support';
import { apiSession, capture, closeAll, deviceFor, LANGS, passCard, passTablet, queueEntry, screen, t1Run, t1RunsHere, tr, type Lang } from './t1-support';

// L-E2E-T1 group D (part 1) — the owner's dry-run checklist, counter operations against the e2e hub. Rows:
//   #12 remove one item, then cancel a whole order → the kitchen's ticket updates; the cancelled order leaves the queue
//   #13 15+ tokens open → the screen switches to the rush layout; a token is still easy to find
//   #14 the hub's network drops, an order is sent, the network comes back → the order waits, then sends by itself;
//       nothing lost or sent twice

const drawer = (page: Page) => page.locator('section.tk-drawer');

async function owner(page: Page, lang: Lang, info: TestInfo): Promise<void> {
  await rushOff(page);
  await signInOn(page, deviceFor(info), lang, 'Owner');
  await shiftOpen(page, lang);
  await takeawayTab(page);
}

/**
 * Remove one line from the token view (L-CLIENT-6b item 5, frame TokenRemove): Remove / cancel opens "Remove from token",
 * one unit of the line is picked on its stepper, and the red "Remove 1 {item}" sends RemoveItems.
 */
async function removeLine(page: Page, lang: Lang, name: string): Promise<void> {
  await drawer(page).getByRole('button', { name: tr(lang, 'v.remove') }).click();
  const dialog = page.locator('.tk-remove');
  await expect(dialog).toBeVisible();
  const row = dialog.locator('.tk-il', { hasText: name });
  await row.locator('.tk-step button').nth(1).click();
  await expect(row.locator('.tk-step output')).toHaveText('1');
  const removed = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/remove-items'), { timeout: 15_000 });
  await dialog.locator('.tk-btn--danger').click();
  expect((await removed).status()).toBe(200);
}

for (const lang of LANGS) {
  test(`[T1 #12] remove one item, then cancel the whole order: the Pass card updates, the cancelled token leaves the queue (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    try {
      await owner(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      await menuTile(page, run.items.drink.name).click();
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await passTablet(pass.page, 'bag', info, lang);
      const card = passCard(pass.page, token);
      await expect(card.locator('.pl', { hasText: run.items.drink.name })).toBeVisible({ timeout: 15_000 });

      await (await queueEntry(page, token)).click();
      await removeLine(page, lang, run.items.drink.name);
      await expect(card.locator('.pl', { hasText: run.items.drink.name })).toHaveCount(0, { timeout: 15_000 });
      await expect(card.locator('.pl', { hasText: run.items.main.name })).toBeVisible();
      await capture(pass.page, info, `T1-12-removed-${info.project.name}-${lang}`, card);

      if (!(await drawer(page).isVisible())) await (await queueEntry(page, token)).click();
      await removeLine(page, lang, run.items.main.name);
      await expect(card).toHaveCount(0, { timeout: 15_000 });
      // qa1-fix: the cancelled token's drawer closes by itself (its token left the queue)
      await expect(drawer(page)).toHaveCount(0, { timeout: 15_000 });
      await expect(await queueEntry(page, token)).toHaveCount(0, { timeout: 15_000 });
    } finally {
      await closeAll(info, lang, pass, cash);
    }
  });

  test(`[T1 #13] 15+ open tokens switch the counter to the rush layout; the token search still finds a token (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const cash = await screen(browser, info.project.use.viewport!);
    const api = await apiSession(request, 'S_OWNER');
    try {
      const { orders } = await api.query<{ orders: Array<{ token: number | null }> }>('open-orders?order_type=takeaway');
      expect(orders.length, 'the e2e hub holds 15+ open takeaway tokens').toBeGreaterThanOrEqual(15);
      // no manual override: the count decides (02b-TK R9)
      await signInOn(cash.page, deviceFor(info), lang, 'Owner');
      await takeawayTab(cash.page);
      await expect(cash.page.locator('.osc--tk.osc--rush')).toBeVisible();
      await capture(cash.page, info, `T1-13-rush-${info.project.name}-${lang}`);
      const token = String(orders.find((o) => o.token !== null)!.token);
      const search = cash.page.locator('.tk-q input[type="search"], .tk-rstrip input[type="search"], aside input[type="search"]').first();
      if (!(await search.isVisible())) await cash.page.locator('.tk-rstrip__q').click();
      await search.fill(token);
      await expect((await queueEntry(cash.page, token))).toBeVisible();
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #14] the network drops: the order waits on the device, then sends by itself once — nothing lost or sent twice (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const api = await apiSession(request, 'S_OWNER');
    const submits: number[] = [];
    cash.page.on('response', (r) => {
      if (r.request().method() === 'POST' && r.url().endsWith('/commands/submit-order')) submits.push(r.status());
    });
    const sockets: WebSocketRoute[] = [];
    await cash.page.routeWebSocket(/\/ws$/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    try {
      await rushOff(cash.page);
      await signInOn(cash.page, deviceFor(info), lang);
      await takeawayTab(cash.page);
      await menuTile(cash.page, run.items.main.name).click();
      // the hub's network drops: no HTTP and the live socket closes (as the 02b-tk-layouts offline flow does)
      await cash.context.setOffline(true);
      for (const ws of sockets) await ws.close({ code: 1006 });
      await sendCart(cash.page, lang);
      await expect(cash.page.getByText(tr(lang, 't.queued')).first()).toBeVisible({ timeout: 10_000 });
      await capture(cash.page, info, `T1-14-queued-${info.project.name}-${lang}`);
      const before = (await api.query<{ orders: unknown[] }>('open-orders?order_type=takeaway')).orders.length;
      await cash.context.setOffline(false);
      await expect.poll(() => submits.filter((s) => s === 200).length, { timeout: 30_000 }).toBe(1);
      const after = (await api.query<{ orders: Array<{ lines_summary?: unknown }> }>('open-orders?order_type=takeaway')).orders.length;
      expect(after - before).toBe(1);
      // the replay is not sent twice: no second 200 after a while
      await cash.page.waitForTimeout(3_000);
      expect(submits.filter((s) => s === 200)).toHaveLength(1);
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });
}
