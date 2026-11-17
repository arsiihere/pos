import { expect, test } from '@playwright/test';
import { deviceFor, dialog, LANGS, menuTile, myTables, openOrder, sendCart, sheet, signInOn, signOut, tr } from './02b-support';

// 02b §8 Zone stock (02b-S12) and the zone undo (02b-C04, §8 Table view): each floor's zone keeps Cola on its counter.
// 1. Ali sends Cola at a zone table: it is served from the zone; in the table view the line offers "Undo · m:ss"
//    while the undo window is open → Removed, the count goes back.
// 2. The zone stock screen: Cola's count, Refill → Add 1 → "Refilled · n now".

for (const lang of LANGS) {
  test(`[02b §8 Table view, 02b-C04] zone undo (${lang})`, async ({ page }, info) => {
    const [table] = myTables('zone', info, lang);
    await signInOn(page, deviceFor(info), lang);
    try {
      await openOrder(page, lang, table);
      await menuTile(page, 'Cola').click();
      await sendCart(page, lang);
      await dialog(page).getByRole('button', { name: tr(lang, 'send.done') }).click();
      await expect(sheet(page)).toBeVisible();
      // the round is served (from the zone) and folds once the view's read says so: open it, select the line, until its
      // Undo shows (the open may come before the fold)
      const line = sheet(page).locator('[aria-expanded]', { hasText: 'Cola' }).first();
      const round = sheet(page).getByRole('button', { name: new RegExp(`^${tr(lang, 'order.round', { n: '1' })}`) });
      const undo = sheet(page).getByRole('button', { name: new RegExp(tr(lang, 'zone.undo', { time: '\\d+:\\d\\d' })) });
      await expect(async () => {
        if (!(await line.isVisible())) await round.click({ timeout: 1_000 });
        if ((await line.getAttribute('aria-expanded', { timeout: 1_000 })) !== 'true') await line.click({ timeout: 1_000 });
        await expect(undo).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await undo.click();
      await expect(page.getByText(tr(lang, 'stage.badge.removed')).first()).toBeVisible();
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b §8 Zone stock screen, 02b-S12] zone refill (${lang})`, async ({ page }, info) => {
    await signInOn(page, deviceFor(info), lang);
    try {
      await page.evaluate(() => (window.location.hash = '#/zones'));
      const row = page.locator('[role="group"][aria-label="Rooftop"] .zs', { hasText: 'Cola' });
      await expect(row).toBeVisible();
      const before = Number(await row.locator('.n').textContent());
      await row.getByRole('button', { name: tr(lang, 'zone.refill') }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'zone.refill') }).click();
      await expect(page.getByText(tr(lang, 'order.toast.refilled', { n: String(before + 1) })).first()).toBeVisible();
      await expect(row.locator('.n')).toHaveText(String(before + 1));
    } finally {
      await signOut(page, info, lang);
    }
  });
}
