import { expect, test, type Page, type TestInfo, type WebSocketRoute } from '@playwright/test';
import { deviceFor, LANGS, menuTile, newOrder, sendCart, signInOn, signOut, tr, type Lang } from './02b-support';

// 02b §3.12, §8 Queue (§10 #35, browser part), a takeaway on each run's own screen (kiosk, tablet, Ali's phone). A
// takeaway sends in the background (02b-TK C1-3; frames SentToast, SentQueued): no Send dialog, a fresh cart at once.
// 1. offline Send → the toast "Not sent yet — token comes when the hub is back" and a dashed "Waiting to send" row in
//    the queue rail (never a token) → the hub is back → the queue sends it as the same person → the sticky token card
//    "Takeaway sent · Queued at …" (IR-7: mounted at the shell root) until OK, the row gone;
// 2. a queued Send whose page reloads goes to the queue log ("this screen was restarted") → "Send again as Ali" →
//    sent, the log is empty.

async function takeawayWithNaan(page: Page, lang: Lang, info: TestInfo): Promise<void> {
  await newOrder(page, lang, info, 'takeaway');
  await menuTile(page, 'Naan').click();
  await sendCart(page, lang);
}

/** The takeaway queue rail's rows (02b-TK C2-1): the kiosk's column; a landscape tablet's "All orders"; the Queue tab. */
async function showQueue(page: Page, lang: Lang): Promise<void> {
  const tab = page.locator('.ptabs').getByRole('button', { name: tr(lang, 'q.tab') });
  if ((await tab.count()) > 0) return tab.click();
  const strip = page.locator('.tk-rstrip__q');
  if ((await strip.count()) > 0) await strip.click();
}

for (const lang of LANGS) {
  test(`[02b §3.12, §8 Queue; 02b-TK C1-3; IR-7] offline Send → queued → reconnect → sticky token (${lang})`, async ({ page, context }, info) => {
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    await signInOn(page, deviceFor(info), lang);
    try {
      await context.setOffline(true);
      for (const ws of sockets) await ws.close({ code: 1006 });
      await takeawayWithNaan(page, lang, info);
      // no dialog: the queued toast, a fresh cart, and the order waits in the rail with no token
      await expect(page.getByText(tr(lang, 't.queued'))).toBeVisible();
      await expect(page.getByText(tr(lang, 'send.not_yet'), { exact: true })).toHaveCount(0);
      await expect(page.locator('.dlg[role="dialog"]')).toHaveCount(0);
      await showQueue(page, lang);
      const waiting = page.locator('.tk-qr--q');
      await expect(waiting).toHaveCount(1);
      await expect(waiting).toContainText(tr(lang, 'q.waiting_send'));
      await expect(waiting.locator('.tk-tok')).toHaveText('—');
      // the hub is back: the socket reconnects, the queue drains, the token comes on the sticky card
      await context.setOffline(false);
      const card = page.locator('.tokc');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card).toContainText(tr(lang, 'send.queued_sent'));
      expect(Number(await card.locator('.tk').textContent())).toBeGreaterThan(0);
      await expect(waiting).toHaveCount(0);
      // the landscape tablet's "All orders" drawer covers the card: close it
      const scrim = page.locator('.tk-scrim--fixed');
      if ((await scrim.count()) > 0) await scrim.first().dispatchEvent('click');
      await card.getByRole('button', { name: tr(lang, 'queue.ok') }).click();
      await expect(card).toHaveCount(0);
    } finally {
      await context.setOffline(false);
      await signOut(page, info, lang);
    }
  });

  test(`[02b §3.12 Q-2, §8 Queue; 02b-TK C1-3] queue log: a reloaded entry → Send again as Ali (${lang})`, async ({ page }, info) => {
    await signInOn(page, deviceFor(info), lang);
    try {
      // the submit never gets an answer (the network drops it): queued
      await page.route('**/commands/submit-order', (route) => route.abort('connectionreset'));
      await takeawayWithNaan(page, lang, info);
      await expect(page.getByText(tr(lang, 't.queued'))).toBeVisible();
      // the page restarts: the session token was memory only, so the entry is in the log (Q-2)
      await page.reload();
      await page.unroute('**/commands/submit-order');
      await signInOn(page, deviceFor(info), lang);
      await page.evaluate(() => {
        window.location.hash = '#/queue';
      });
      const log = page.locator('[aria-labelledby="queue-log-title"]');
      await expect(log).toContainText(tr(lang, 'queue.reloaded'));
      await log.getByRole('button', { name: tr(lang, 'queue.send_again_as', { name: 'Ali' }) }).click();
      await expect(page.getByText(tr(lang, 'order.toast.all_sent'))).toBeVisible();
      await expect(log.locator('.ql')).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });
}
