import { expect, test } from '@playwright/test';
import { escapeRe, hub, LANGS, menuTile, shiftOpen, signInOn, signOut, takeawayTab, tr } from './02b-support';

for (const lang of LANGS) {
  test(`[02b §8/O17; CustomerDisplay] mirrors the current cart and confirmed payment (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'kiosk', 'the customer screen opener is kiosk only');
    await signInOn(page, hub().kiosk, lang, 'Owner');
    try {
      await page.evaluate(() => { window.location.hash = '#/shift'; });
      await expect(page.locator('main.b5-page :is(.b5-card, .b5-bh)').first()).toBeVisible();
      await shiftOpen(page, lang);
      await takeawayTab(page);
      const [display] = await Promise.all([
        page.waitForEvent('popup'),
        page.getByRole('button', { name: tr(lang, 'cd.open') }).click(),
      ]);
      try {
        const requests: string[] = [];
        display.on('request', (request) => {
          if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url());
        });
        const screen = display.locator('.cd');
        const screenshot = async (state: string) => {
          const path = info.outputPath(`customer-display-${lang}-${state}.png`);
          await display.screenshot({ path });
          await info.attach(state, { path, contentType: 'image/png' });
        };
        await expect(screen.getByRole('heading', { name: 'Welcome · خوش آمدید' })).toBeVisible();
        await screenshot('idle');

        const name = page.locator('input[name="customer_name"]');
        const addContact = page.getByRole('button', { name: tr(lang, 'c.who_add') });
        await expect(name.or(addContact)).toBeVisible();
        if (await addContact.isVisible()) await addContact.click();
        await name.fill('Private Customer');
        await page.locator('input[name="phone"]').fill('03001234567');
        for (const item of ['Naan', 'Raita', 'Water', 'Cola', 'Kheer']) {
          await menuTile(page, item).click();
        }
        await expect(screen.locator('.cd-row')).toHaveCount(5);
        await expect(screen.getByRole('heading', { name: 'Your order · آپ کا آرڈر' })).toBeVisible();
        await expect(screen.locator('.cd-big[dir="ltr"]')).toHaveText(/^Rs \d/);
        await expect(screen.getByText('Ready by · تیار ہوگا')).toBeVisible();
        await expect(screen.locator('.tk-readyby .cd-time[dir="ltr"]')).toHaveText(/\d+:\d{2} [AP]M/);
        await expect(screen).not.toContainText(/Private Customer|03001234567/);
        await screenshot('cart');

        await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_pay'))}`) }).click();
        const panel = page.locator('.cart .tk-paypanel');
        await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
        await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
        await expect(screen.locator('.cd-paid')).toContainText('Paid · ادا ہو گیا');
        await expect(screen.locator('.cd-paid')).toContainText('Rs 0');
        await expect(screen).not.toContainText(/Private Customer|03001234567/);
        await screenshot('paid');

        await panel.getByRole('button', { name: tr(lang, 'p.next') }).click();
        await expect(screen.getByRole('heading', { name: 'Welcome · خوش آمدید' })).toBeVisible();
        await display.reload();
        await expect(screen.getByRole('heading', { name: 'Welcome · خوش آمدید' })).toBeVisible();
        expect(requests).toEqual([]);
      } finally {
        await display.close();
      }
    } finally {
      await signOut(page, info, lang);
    }
  });
}
