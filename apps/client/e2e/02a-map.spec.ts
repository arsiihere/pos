import { expect, test } from '@playwright/test';
import { hub, LANGS, myTables, pairAs, signIn, signOut, sheet, tapTile, tile, tr } from './02a-support';

// §12.1 "§8 flows pass on a tablet and a phone" — flow 1: sign in, the table map, a floor, a free table's sheet,
// Take order (the 02b order screen is a stub: the route is the proof), back to the map.

for (const lang of LANGS) {
  test(`[02a §12.1, §8] sign-in → map → floor → Take order → back (${lang})`, async ({ page }, info) => {
    const [mine] = myTables('map', info, lang);
    await pairAs(page, hub().device, lang);
    await expect(page.locator('html')).toHaveAttribute('lang', lang);
    await signIn(page, 'Ali');
    // the order taker lands on the map
    await expect(page).toHaveURL(/#\/tables/);
    await expect(tile(page, 'G001')).toBeVisible();
    // the other floor: the floor control on a tablet, the chips on a phone
    await page.getByRole('button', { name: /Rooftop/ }).first().click();
    await expect(page).toHaveURL(/floor=FL-R/);
    await expect(tile(page, 'R001')).toBeVisible();
    await expect(tile(page, 'G001')).toHaveCount(0);
    // a table's sheet, Take order
    await tapTile(page, mine);
    await expect(sheet(page)).toBeVisible();
    await sheet(page).getByRole('button', { name: tr(lang, 'sheet.take_order') }).click();
    await expect(page).toHaveURL(/#\/order\/dine_in\//);
    await page.goBack();
    await expect(page).toHaveURL(/#\/tables/);
    // the table is Ali's now
    await expect(tile(page, mine)).toHaveAttribute('aria-label', new RegExp(`${tr(lang, 'tables.state.seated')}`));
    await signOut(page, info, lang);
  });
}
