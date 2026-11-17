import { expect, test } from '@playwright/test';
import { dialog, hub, LANGS, menuTile, myTables, openOrder, pairAs, sendCart, sheet, signIn, signInOn, signOut, tapTile, tr } from './02b-support';

// 02b §8 Ordering screen, Send (§10 #36) and 02a §8 Banners on the real order screen (02a gap moved to task 28):
// Ali takes the order at a table, adds Naan, sends it: "Sending to the kitchen…" then Sent (never before the 2xx) with
// the food-together time. He starts round 2; the manager on a second tablet releases Ali's lock: Ali's order screen
// shows the lock banner (released by the manager, the draft kept).

for (const lang of LANGS) {
  test(`[02b §8; 02a §8 Banners] dine-in order + Send + lock banner (${lang})`, async ({ browser, page }, info) => {
    const [table] = myTables('order', info, lang);
    const h = hub();
    await signInOn(page, h.device, lang);
    const context = await browser.newContext({ ...info.project.use });
    const other = await context.newPage();
    try {
      await openOrder(page, lang, table);
      await menuTile(page, 'Naan').click();
      await sendCart(page, lang);
      const sent = dialog(page);
      await expect(sent.locator('#send-t')).toHaveText(tr(lang, 'send.sent'));
      await expect(sent).toContainText(tr(lang, 'send.food_together_at'));
      await sent.getByRole('button', { name: tr(lang, 'send.done') }).click();

      // Done goes back to the table's sheet: round 2 on the same table, then the manager releases Ali's lock
      await sheet(page).getByRole('button', { name: tr(lang, 'sheet.add_items_round', { n: '2' }) }).click();
      await expect(page).toHaveURL(/#\/order\/dine_in\//);
      await menuTile(page, 'Naan').click();
      await pairAs(other, h.device2, lang);
      await signIn(other, 'Manager', '0123');
      await tapTile(other, table);
      await sheet(other).getByRole('button', { name: tr(lang, 'sheet.take_order_busy', { name: 'Ali' }) }).click({ force: true });
      await dialog(other).getByRole('button', { name: tr(lang, 'sheet.act.release_other', { name: 'Ali' }) }).click();
      await dialog(other).locator('.chips .chip').first().click();
      await dialog(other).getByRole('button', { name: tr(lang, 'release.go') }).click();
      await expect(dialog(other)).toHaveCount(0);

      await expect(page.getByText(tr(lang, 'lock.released_by', { table, name: 'Manager' }))).toBeVisible();
      await expect(page.getByText(tr(lang, 'lock.kept'))).toBeVisible();
    } finally {
      await signOut(other, info, lang);
      await context.close();
      await signOut(page, info, lang);
    }
  });
}
