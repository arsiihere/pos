import { expect, test } from '@playwright/test';
import { dialog, hub, LANGS, myTables, pairAs, sheet, signIn, signOut, tapTile, tile, tr } from './02a-support';

// §12.1 "§8 flows pass on a tablet and a phone" — flow 2: someone else is taking an order here (TableBusy), the
// manager releases the lock by force (ForceRelease), the sheet stops saying "is ordering". Two pages, two tablets.

for (const lang of LANGS) {
  test(`[02a §12.1, §8] busy table → Release Ali's lock (${lang})`, async ({ browser, page }, info) => {
    const [mine] = myTables('busy', info, lang);
    const h = hub();
    // page A: Ali opens the table and stays on the order screen (02b stub), holding the lock
    await pairAs(page, h.device, lang);
    await signIn(page, 'Ali');
    await tapTile(page, mine);
    await sheet(page).getByRole('button', { name: tr(lang, 'sheet.take_order') }).click();
    await expect(page).toHaveURL(/#\/order\/dine_in\//);

    // page B: the manager on another tablet, same viewport
    const context = await browser.newContext({ ...info.project.use });
    const other = await context.newPage();
    try {
      await pairAs(other, h.device2, lang);
      await signIn(other, 'Manager', '0123');
      await tapTile(other, mine);
      await expect(sheet(other)).toContainText(tr(lang, 'sheet.ordering', { name: 'Ali' }));
      // the primary action says who is ordering (drawn off, aria-disabled, but it still answers a tap with TableBusy)
      await sheet(other).getByRole('button', { name: tr(lang, 'sheet.take_order_busy', { name: 'Ali' }) }).click({ force: true });
      await expect(dialog(other)).toContainText(tr(lang, 'busy.title', { name: 'Ali' }));
      await expect(dialog(other)).toContainText(tr(lang, 'busy.still_can'));
      // Release Ali's lock: a reason is required
      await dialog(other).getByRole('button', { name: tr(lang, 'sheet.act.release_other', { name: 'Ali' }) }).click();
      await expect(dialog(other)).toContainText(tr(lang, 'release.title', { name: 'Ali', table: mine }));
      const go = dialog(other).getByRole('button', { name: tr(lang, 'release.go') });
      await expect(go).toBeDisabled();
      await dialog(other).locator('.chips .chip').first().click();
      await go.click();
      await expect(dialog(other)).toHaveCount(0);
      // the lock is gone: the sheet no longer says Ali is ordering
      await expect(sheet(other)).not.toContainText(tr(lang, 'sheet.ordering', { name: 'Ali' }));
      await expect(tile(other, mine)).toBeVisible();
    } finally {
      await signOut(other, info, lang);
      await context.close();
      await signOut(page, info, lang);
    }
  });
}
