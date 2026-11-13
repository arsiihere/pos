import { expect, test } from '@playwright/test';
import { dialog, goFloorOf, hub, LANGS, myTables, pairAs, sheet, sheetAct, signIn, signOut, takeOrder, tapTile, tile, tr } from './02a-support';

// §12.1 "§8 flows pass on a tablet and a phone" — flow 4: Ali's party moves from one table to the next, a free table
// joins it (one bill, "A + B"), then the joined table is split off again ("No orders — just free"). Real orders
// need the 02b ordering screen (a stub here), so the split step is the no-orders path.

for (const lang of LANGS) {
  test(`[02a §12.1, §8] move → join → split (${lang})`, async ({ page }, info) => {
    const [first, second] = myTables('tables', info, lang);
    await pairAs(page, hub().device, lang);
    await signIn(page, 'Ali');
    try {
      await takeOrder(page, lang, first);

      // Move party: first → second
      await tapTile(page, first);
      await sheetAct(page, lang, 'sheet.act.move');
      await expect(dialog(page)).toContainText(tr(lang, 'move.title', { table: first }));
      await dialog(page).locator('.mt', { hasText: second }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'move.to', { table: second }) }).click();
      await expect(dialog(page)).toHaveCount(0);
      await goFloorOf(page, second);
      await expect(tile(page, second)).toHaveAttribute('aria-label', new RegExp(tr(lang, 'tables.state.seated')));
      await expect(tile(page, first)).toHaveAttribute('aria-label', new RegExp(tr(lang, 'tables.state.free')));

      // Join a table: first joins second ("first + second")
      await tapTile(page, second);
      await sheetAct(page, lang, 'sheet.act.join');
      await expect(dialog(page)).toContainText(tr(lang, 'join.title', { table: second }));
      await dialog(page).locator('.mt', { hasText: first }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'join.go') }).click();
      await expect(dialog(page)).toHaveCount(0);
      await goFloorOf(page, second);
      await expect(page.getByRole('button', { name: new RegExp(`${first}.*${second}|${second}.*${first}`) }).first()).toBeVisible();

      // Split the party: first is freed ("No orders — just free first")
      await tapTile(page, second);
      await expect(sheet(page)).toBeVisible();
      await sheetAct(page, lang, 'sheet.act.split');
      await expect(dialog(page)).toContainText(tr(lang, 'split.title', { table: `${first} + ${second}` }));
      await dialog(page).locator('.mt', { hasText: first }).click();
      await dialog(page).getByRole('checkbox', { name: tr(lang, 'split.just_free', { table: first }) }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'split.go') }).click();
      await expect(dialog(page)).toHaveCount(0);
      await goFloorOf(page, first);
      await expect(tile(page, first)).toHaveAttribute('aria-label', new RegExp(tr(lang, 'tables.state.free')));
    } finally {
      await signOut(page, info, lang);
    }
  });
}
