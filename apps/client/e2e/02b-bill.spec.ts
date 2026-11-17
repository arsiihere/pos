import { expect, test } from '@playwright/test';
import { deviceFor, dialog, goFloorOf, LANGS, menuTile, myTables, openOrder, sendCart, sheet, sheetAct, signInOn, signOut, tapTile, tile, tr } from './02b-support';

// 02a §8 Ask for the bill and Mark clean ONLINE (02a gaps moved to task 28: they need a real 02b order): Ali orders at
// a table and sends it, then Ask for bill → "Bill asked", the tile reads Bill; a table waiting for cleaning (seeded) →
// Mark clean → the tile reads Free. Through the one queue (Q-3): sent only after the 2xx.

for (const lang of LANGS) {
  test(`[02a §8, §3.13 @combined] online Ask for bill and Clean (${lang})`, async ({ page }, info) => {
    const [table, dirty] = myTables('bill', info, lang);
    await signInOn(page, deviceFor(info), lang);
    try {
      await openOrder(page, lang, table);
      await menuTile(page, 'Naan').click();
      await sendCart(page, lang);
      await dialog(page).getByRole('button', { name: tr(lang, 'send.done') }).click();
      await expect(sheet(page)).toBeVisible();
      await sheetAct(page, lang, 'sheet.act.bill');
      await sheet(page).getByRole('button', { name: tr(lang, 'bill.ask') }).click();
      await expect(page.getByText(tr(lang, 'bill.asked')).first()).toBeVisible();
      await sheet(page).getByRole('button', { name: tr(lang, 'common.close') }).click();
      await goFloorOf(page, table);
      await expect(tile(page, table)).toContainText(tr(lang, 'tables.state.bill'));

      await tapTile(page, dirty);
      await sheet(page).getByRole('button', { name: tr(lang, 'sheet.mark_clean') }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'sheet.mark_clean') }).click();
      await goFloorOf(page, dirty);
      await expect(tile(page, dirty)).toContainText(tr(lang, 'tables.state.free'));
    } finally {
      await signOut(page, info, lang);
    }
  });
}
