import { expect, test } from '@playwright/test';
import { dialog, goFloorOf, hub, LANGS, myTables, pairAs, sheetAct, signIn, signOut, takeOrder, tapTile, tile, tr } from './02a-support';

// §12.1 "§8 flows pass on a tablet and a phone" — flow 5: Ali calls a waiter to his table; Bilal (his waiter) is
// working, so someone gets it, and the tile says "Call sent". Two pages.

for (const lang of LANGS) {
  test(`[02a §12.1, §8] call waiter (${lang})`, async ({ browser, page }, info) => {
    const [mine] = myTables('call', info, lang);
    const h = hub();
    await pairAs(page, h.device, lang);
    await signIn(page, 'Ali');
    const context = await browser.newContext({ ...info.project.use });
    const other = await context.newPage();
    try {
      await pairAs(other, h.device2, lang);
      await signIn(other, 'Bilal'); // Ali's waiter: the one a call from Ali's table reaches
      await takeOrder(page, lang, mine);

      // Call waiter: one tap on a reason sends it
      await tapTile(page, mine);
      await sheetAct(page, lang, 'sheet.act.call');
      await expect(dialog(page)).toContainText(tr(lang, 'call.title', { table: mine }));
      await dialog(page).getByRole('button', { name: tr(lang, 'call.chip.water') }).click();
      await expect(page.getByText(tr(lang, 'tables.toast.waiter_called'))).toBeVisible();
      await expect(page.getByText(tr(lang, 'call.nobody'))).toHaveCount(0);
      await goFloorOf(page, mine);
      await expect(tile(page, mine)).toContainText(tr(lang, 'tables.flag.call_sent', { n: '0' }));
    } finally {
      await signOut(other, info, lang);
      await context.close();
      await signOut(page, info, lang);
    }
  });
}
