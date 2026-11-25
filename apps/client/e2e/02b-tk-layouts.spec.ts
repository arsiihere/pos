import { expect, test, type Page, type TestInfo, type WebSocketRoute } from '@playwright/test';
import { deviceFor, escapeRe, hub, kitchenReady, KITCHEN, LANGS, menuTile, railEntry, readyTile, sentToken, shiftOpen, signInOn, signOut, takeawayTab, tr } from './02b-support';

async function capture(page: Page, info: TestInfo, frame: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(frame + '.png');
  await page.screenshot({ path });
  await info.attach(frame, { path, contentType: 'image/png' });
}

for (const lang of LANGS) {
  test(`[7a/7b] landscape tablet home and drawer (${lang})`, async ({ page, request }, info) => {
    test.skip(info.project.name !== 'tablet-landscape', 'landscape tablet frames');
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await takeawayTab(page);
      const home = page.locator('.osc--tk-tablet');
      await expect(home.locator('.tk-rstrip')).toBeVisible();
      await menuTile(page, 'Naan').click();
      await home.locator('.cart').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await kitchenReady(request, token, [KITCHEN.naan.item_id]);
      await expect(readyTile(page, token)).toBeVisible({ timeout: 15_000 });
      await menuTile(page, 'Naan').click();
      await menuTile(page, 'Raita').click();
      await expect(home.locator('.cart__foot b[dir="ltr"]').first()).toHaveText(/\d+:\d{2}/);
      expect(await home.locator('.items').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)).toBe(3);
      expect(Math.round((await home.locator('> .cart').boundingBox())!.width)).toBe(440);
      await capture(page, info, lang === 'ur' ? 'HomeTabletUrdu' : 'HomeTablet');
      await home.locator('.tk-rstrip__q').click();
      const drawer = home.locator('.tk-q--drawer');
      await expect(drawer.getByRole('searchbox')).toBeVisible();
      if (lang === 'en') await capture(page, info, 'QueueTablet');
      await drawer.getByRole('button', { name: tr(lang, 'common.close') }).click();
      await expect(drawer).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[7c/7d] phone menu, cart, queue, token and hand over (${lang})`, async ({ page, browser, request }, info) => {
    test.skip(info.project.name !== 'phone-390', 'phone frames');
    test.setTimeout(90_000);
    await signInOn(page, hub().phone, lang);
    try {
      await takeawayTab(page);
      await menuTile(page, 'Naan').click();
      await expect(page.locator('.ph-bar')).toContainText('Rs 30');
      await expect(page.locator('.ph-bar__time')).toHaveText(/\d+:\d{2}/);
      if (lang === 'en') await capture(page, info, 'PhoneMenu');
      await page.locator('.ptabs').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'order.tab.cart'))}`) }).click();
      await expect(page.locator('input[name="phone"]')).toHaveAttribute('inputmode', 'tel');
      await page.locator('input[name="customer_name"]').fill('Sample Customer');
      await page.locator('input[name="phone"]').fill('03001234567');
      await expect(page.locator('.ln .step')).toBeVisible();
      await capture(page, info, lang === 'ur' ? 'PhoneCartUrdu' : 'PhoneCart');
      await page.locator('.ph-bar').getByRole('button', { name: tr(lang, 'cart.send_short'), exact: true }).click();
      const token = await sentToken(page);
      await expect(page.locator('.toast').first()).not.toContainText('Sample Customer');
      await page.locator('.ptabs').getByRole('button', { name: tr(lang, 'q.tab') }).click();
      await kitchenReady(request, token, [KITCHEN.naan.item_id]);
      const tile = readyTile(page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      if (lang === 'en') await capture(page, info, 'PhoneQueue');
      await railEntry(page, token).first().click();
      const drawer = page.locator('.tk-drawer--phone');
      await expect(drawer).toBeVisible();
      await expect(drawer).not.toContainText(/Sample Customer|4567/);
      await expect(drawer.getByText(tr(lang, 'v.pay_first'))).toBeVisible();
      if (lang === 'en') await capture(page, info, 'PhoneToken');

      const kiosk = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
      try {
        await signInOn(kiosk, hub().kiosk, lang, 'Owner');
        await shiftOpen(kiosk, lang);
        await takeawayTab(kiosk);
        await readyTile(kiosk, token).getByRole('button', { name: tr(lang, 'q.collect_pay') }).click();
        const panel = kiosk.locator('.tk-paypanel');
        await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
        await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
        await panel.getByRole('button', { name: tr(lang, 'p.next') }).click();
        await kiosk.locator('header.top .me').click();
        await kiosk.locator('[role=menu] .tk-mi--danger').click();
        await expect(kiosk.locator('.who__t').first()).toBeVisible();
      } finally {
        await kiosk.close();
      }
      const handOver = drawer.getByRole('button', { name: tr(lang, 'v.collected'), exact: true });
      await expect(handOver).toHaveAttribute('aria-disabled', 'false', { timeout: 15_000 });
      await handOver.click();
      await expect(drawer).toHaveCount(0);
      await expect(tile).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[7e] offline phone queues the cart (${lang})`, async ({ page, context }, info) => {
    test.skip(info.project.name !== 'phone-390', 'phone frame');
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    await signInOn(page, hub().phone, lang);
    try {
      await takeawayTab(page);
      await menuTile(page, 'Naan').click();
      await page.locator('.ptabs').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'order.tab.cart'))}`) }).click();
      await page.locator('input[name="customer_name"]').fill('Offline Sample');
      await context.setOffline(true);
      for (const ws of sockets) await ws.close({ code: 1006 });
      await expect(page.locator('.ph-bar__time')).toHaveText('—');
      await expect(page.locator('.ph-bar').getByRole('button', { name: tr(lang, 'c.phone_pay') })).toHaveCount(0);
      if (lang === 'en') await capture(page, info, 'PhoneOffline');
      await page.locator('.ph-bar').getByRole('button', { name: tr(lang, 'cart.send_short'), exact: true }).click();
      await expect(page.getByText(tr(lang, 't.queued'))).toBeVisible();
      await page.locator('.ptabs').getByRole('button', { name: tr(lang, 'q.tab') }).click();
      const waiting = page.locator('.tk-qr--q').first();
      await expect(waiting).toBeVisible();
      await expect(waiting).not.toContainText('Offline Sample');
    } finally {
      await context.setOffline(false);
      await signOut(page, info, lang);
    }
  });
}
