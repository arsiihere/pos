import { expect, test, type Page } from '@playwright/test';
import { deviceFor, dialog, hub, LANGS, menuTile, myTables, openOrder, pairAs, sendCart, sheet, signIn, signInOn, signOut, tr, type Lang } from './02b-support';

// 02b §8 Table view, Comp (02b-D33; 01d AD-1 waiting card; Q-11) with approval: Ali's role may comp only with a
// manager's approval. Ali sends Naan, opens the line → Comp → a reason → "Ask for approval" → the line waits; the
// manager on another tablet answers in Requests → Approve → his PIN → Approved; Ali's waiting card goes and the line
// reads "Comped ×1".

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** the waiting card: "Waiting for approval — Rs 30 comp" (the hub's amount) or the plain line */
const waiting = (lang: Lang) => new RegExp(`${esc(tr(lang, 'comp.waiting_plain'))}|${esc(tr(lang, 'comp.waiting', { amount: '\u0000' })).replace('\u0000', '.*')}`);

async function manager(page: Page, lang: Lang): Promise<void> {
  await pairAs(page, hub().device2, lang);
  await signIn(page, 'Manager', '0123');
}

for (const lang of LANGS) {
  test(`[02b §8 Table view, 02b-D33 @combined] comp with approval (${lang})`, async ({ browser, page }, info) => {
    test.setTimeout(90_000); // two people on two screens, a PIN and the answer's round trip
    const [table] = myTables('comp', info, lang);
    await signInOn(page, deviceFor(info), lang);
    // the approver: a tablet (a phone shows no Requests screen)
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const other = await context.newPage();
    try {
      await openOrder(page, lang, table);
      await menuTile(page, 'Naan').click();
      await sendCart(page, lang);
      await dialog(page).getByRole('button', { name: tr(lang, 'send.done') }).click();
      await expect(sheet(page)).toBeVisible();
      const line = sheet(page).locator('[aria-expanded]', { hasText: 'Naan' }).first();
      // the round is not served yet: it is open, its line is there
      await expect(line).toBeVisible();
      await line.click();
      await expect(line).toHaveAttribute('aria-expanded', 'true');
      await line.getByRole('button', { name: tr(lang, 'comp.do'), exact: true }).click();
      // the comp sheet (a bottom sheet on a phone)
      const comp = page.locator('.dlg').last();
      await expect(comp).toContainText(tr(lang, 'comp.needs_manager'));
      await comp.locator('.chips .chip').first().click();
      await comp.getByRole('button', { name: tr(lang, 'comp.ask') }).click();
      await expect(page.getByText(tr(lang, 'order.toast.comp_asked')).first()).toBeVisible();
      await expect(sheet(page).getByText(waiting(lang)).first()).toBeVisible();

      await manager(other, lang);
      await other.locator('header.top').getByRole('button', { name: new RegExp(tr(lang, 'alerts.nav.requests')) }).click();
      await other.locator('main').getByText('Naan').first().click();
      await dialog(other).getByRole('button', { name: tr(lang, 'answer.approve') }).click();
      const keys = other.locator('.pin__keys');
      for (const d of '0123') await keys.locator('.btn', { hasText: new RegExp(`^${d}$`) }).click();
      await keys.getByRole('button', { name: tr(lang, 'answer.approve') }).click();
      await expect(other.getByText(tr(lang, 'answer.done_approved')).first()).toBeVisible();

      // Ali: the waiting card goes when the answer reaches the page; the line reads "Comped ×1"
      await expect(sheet(page).getByText(waiting(lang))).toHaveCount(0, { timeout: 30_000 });
      await expect(sheet(page).getByText(tr(lang, 'stage.badge.comped', { n: '1' }))).toBeVisible();
    } finally {
      await signOut(other, info, lang);
      await context.close();
      await signOut(page, info, lang);
    }
  });
}
