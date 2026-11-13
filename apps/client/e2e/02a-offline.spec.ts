import { expect, test, type WebSocketRoute } from '@playwright/test';
import { dialog, hub, LANGS, myTables, pairAs, sheet, sheetAct, signIn, signOut, tapTile, tr } from './02a-support';

// §12.1 "§8 flows pass on a tablet and a phone" — flow 6: the hub goes away. The sheet says so; Hand over (and the
// other hub-only actions) are drawn off and say "Needs the hub"; Ask for bill and Clean go to the one queue, whose
// answer here (02b's queue is a stub) is "Needs the hub". The two tables are seeded by the fixture: one with an order
// (Ask for bill), one waiting for cleaning (Clean).

for (const lang of LANGS) {
  test(`[02a §12.1, §8] offline: Bill and Clean say "Needs the hub" (${lang})`, async ({ page, context }, info) => {
    const [ordered, dirty] = myTables('offline', info, lang);
    // the page's live socket is held so the hub can "go away": a closed socket plus a network that refuses the rest
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    await pairAs(page, hub().device, lang);
    await signIn(page, 'Ali');
    const needsHub = page.getByText(tr(lang, 'tables.toast.needs_hub')).first();
    try {
      await tapTile(page, ordered);
      await expect(sheet(page)).toBeVisible();
      await context.setOffline(true);
      for (const ws of sockets) await ws.close({ code: 1006 });
      await expect(sheet(page)).toContainText(tr(lang, 'sheet.offline'));

      // Hand over needs the hub: drawn off, a tap says so and opens nothing
      await sheet(page).getByRole('button', { name: tr(lang, 'sheet.act.hand') }).click({ force: true });
      await expect(needsHub).toBeVisible();
      await expect(dialog(page)).toHaveCount(0);

      // Ask for bill: the confirm, then "Needs the hub" (the toast above has gone first, so this one is its own)
      await expect(needsHub).toHaveCount(0, { timeout: 10_000 });
      await sheetAct(page, lang, 'sheet.act.bill');
      await sheet(page).getByRole('button', { name: tr(lang, 'bill.ask') }).click();
      await expect(needsHub).toBeVisible();
      await sheet(page).getByRole('button', { name: tr(lang, 'common.close') }).click();

      // Clean: the table waiting for cleaning
      await expect(needsHub).toHaveCount(0, { timeout: 10_000 });
      await tapTile(page, dirty);
      await expect(sheet(page)).toContainText(tr(lang, 'sheet.offline'));
      await sheet(page).getByRole('button', { name: tr(lang, 'sheet.mark_clean') }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'sheet.mark_clean') }).click();
      await expect(needsHub).toBeVisible();
    } finally {
      await context.setOffline(false);
      await signOut(page, info, lang);
    }
  });
}
