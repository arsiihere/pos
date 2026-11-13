import { expect, test } from '@playwright/test';
import { dialog, hub, LANGS, menuTile, signInOn, signOut, tr } from './02b-support';

// 02b §8 Types (02-S04) on Ali's phone: the map's New order (02a IR-5 → 02b New order sheet) → Parking → plate and car
// type → Naan → Send → the plate on the sent card.

for (const lang of LANGS) {
  test(`[02b §8 Types; IR-5] parking on the phone (${lang})`, async ({ page }, info) => {
    test.skip(!info.project.name.startsWith('phone'), 'the phone flow runs at the phone viewports');
    const plate = `LEA ${info.project.name.slice(-3)}${lang === 'en' ? 1 : 2}`;
    await signInOn(page, hub().phone, lang);
    try {
      await expect(page).toHaveURL(/#\/tables/);
      await page.locator('.phbar').getByRole('button', { name: tr(lang, 'order.new') }).click();
      await dialog(page).locator('.bchip', { hasText: tr(lang, 'order.parking') }).click();
      await dialog(page).locator('input.inp--plate').fill(plate);
      await dialog(page).locator('.bchip', { hasText: tr(lang, 'order.parking.sedan') }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'order.takeaway.next') }).click();
      await expect(page).toHaveURL(/#\/order\/parking\//);
      await menuTile(page, 'Naan').click();
      // the phone shows the menu and the cart as tabs: Send sits on the cart
      const send = page.getByRole('button', { name: new RegExp(`^(${tr(lang, 'cart.send')}|${tr(lang, 'cart.send_short')})`) }).first();
      if (!(await send.isVisible())) await page.getByRole('button', { name: new RegExp(`^${tr(lang, 'order.tab.cart')}`) }).click();
      await send.click();
      await expect(page.locator('.token .plate')).toHaveText(plate);
    } finally {
      await signOut(page, info, lang);
    }
  });
}
