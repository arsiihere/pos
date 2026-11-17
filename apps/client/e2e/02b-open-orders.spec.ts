import { expect, test } from '@playwright/test';
import { PROJECTS } from './global-setup';
import { deviceFor, dialog, LANGS, menuTile, newOrder, sendCart, signInOn, signOut, tr } from './02b-support';

// 02b §8 Open orders (02-S07): a parking order sent on this run's screen is listed with its plate (the kiosk's home is
// the list; elsewhere #/orders, the phone's Orders tab); tapping it opens its order view with the line.

for (const lang of LANGS) {
  test(`[02b §8 Open orders, 02-S07] open orders (${lang})`, async ({ page }, info) => {
    // one plate per run (project × language): the hub keeps every run's orders open
    const plate = `OO ${PROJECTS.indexOf(info.project.name as (typeof PROJECTS)[number])}${lang.toUpperCase()}`;
    await signInOn(page, deviceFor(info), lang);
    try {
      await newOrder(page, lang, info, 'parking', plate);
      await menuTile(page, 'Naan').click();
      await sendCart(page, lang);
      await expect(page.locator('.token .plate')).toHaveText(plate);
      await dialog(page).getByRole('button', { name: tr(lang, 'send.done') }).click();
      await page.evaluate(() => (window.location.hash = '#/orders'));
      const row = page.locator('button.oo', { has: page.locator('.plate', { hasText: plate }) });
      await expect(row).toBeVisible();
      await expect(row).toContainText(tr(lang, 'order.parking'));
      await row.click();
      await expect(page).toHaveURL(/#\/orders\/[^/]+$/);
      await expect(page.locator('[data-line]', { hasText: 'Naan' }).first()).toBeVisible();
    } finally {
      await signOut(page, info, lang);
    }
  });
}
