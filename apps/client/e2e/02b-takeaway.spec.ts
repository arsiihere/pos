import { expect, test } from '@playwright/test';
import { hub, LANGS, menuTile, signInOn, signOut, tr } from './02b-support';

// 02b §8 Types, Send (02-S04, 02-D07): the cashier kiosk's home → Takeaway → Naan → Send → the big
// token, only after the hub's 2xx; Done goes back to the kiosk home.

for (const lang of LANGS) {
  test(`[02b §8 Types; 02-D07] takeaway token on the kiosk (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'kiosk', 'the cashier kiosk flow runs at the kiosk viewport');
    await signInOn(page, hub().kiosk, lang);
    try {
      await expect(page).toHaveURL(/#\/$/);
      await page.locator('.bchip', { hasText: tr(lang, 'order.takeaway') }).click();
      await expect(page).toHaveURL(/#\/order\/takeaway\//);
      await menuTile(page, 'Naan').click();
      await page.getByRole('button', { name: tr(lang, 'cart.send') }).click();
      const token = page.locator('.token b.num');
      await expect(token).toBeVisible();
      expect(Number(await token.textContent())).toBeGreaterThan(0);
    } finally {
      await signOut(page, info, lang);
    }
  });
}
