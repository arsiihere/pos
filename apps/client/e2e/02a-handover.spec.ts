import { expect, test, type Page } from '@playwright/test';
import { dialog, hub, isPhone, LANGS, myTables, pairAs, sheet, sheetAct, signIn, signOut, takeOrder, tapTile, tr, type Lang } from './02a-support';

// §12.1 "§8 flows pass on a tablet and a phone" — flow 3: Ali hands a table to Sara, who is signed in on another
// tablet. Sara accepts one table and declines the other; Ali's page shows the answer. Two pages. The answer
// sheet's Accept / Decline buttons are measured in each viewport (the frame draws them 72 px high).

async function handOver(page: Page, lang: Lang, table: string): Promise<void> {
  await tapTile(page, table);
  await sheetAct(page, lang, 'sheet.act.hand');
  await expect(dialog(page)).toContainText(tr(lang, 'handover.title', { table }));
  await dialog(page).getByRole('radio', { name: /Sara/ }).click();
  await dialog(page).getByRole('button', { name: tr(lang, 'handover.send') }).click();
  await expect(dialog(page)).toHaveCount(0);
}

/**
 * Sara's side: the banner, its Open, the answer sheet (measured), then the answer.
 * ⚠️ 01d v1.3.2 §3.13.2 rule 4 (DL Q-1 (a)): Open now navigates to the table's sheet (#/tables/<table>) and puts the
 * answer sheet on top of it. Afterwards Sara closes the table sheet, as a person does to get back to the map: while it
 * is open its scrim covers the next banner.
 */
async function answer(page: Page, lang: Lang, table: string, choice: 'accept' | 'decline'): Promise<{ accept: number; decline: number }> {
  const banner = page.locator('.abn', { hasText: table });
  await banner.getByRole('button', { name: tr(lang, 'alerts.open') }).click();
  await expect(page).toHaveURL(new RegExp(`#/tables/${table}\\?seating_id=`));
  await expect(sheet(page)).toBeVisible();
  // the answer sheet (the `.dlg` popup), not the table sheet route behind it, which is a dialog too
  const sheetBox = page.locator('.dlg[role="dialog"]').filter({ hasText: table });
  const accept = sheetBox.getByRole('button', { name: tr(lang, 'answer.accept') });
  const decline = sheetBox.getByRole('button', { name: tr(lang, 'answer.decline') });
  await expect(accept).toBeVisible();
  const height = async (b: typeof accept): Promise<number> => (await b.boundingBox())?.height ?? 0;
  const sizes = { accept: await height(accept), decline: await height(decline) };
  await (choice === 'accept' ? accept : decline).click();
  // the answer is sent once its buttons are gone; then any answered sheet, then the table sheet, are closed
  await expect(accept).toHaveCount(0);
  if ((await page.locator('.dlg[role="dialog"]').count()) > 0) await page.keyboard.press('Escape');
  await expect(page.locator('.dlg[role="dialog"]')).toHaveCount(0);
  await sheet(page).getByRole('button', { name: tr(lang, 'common.close') }).click();
  await expect(sheet(page)).toHaveCount(0);
  return sizes;
}

for (const lang of LANGS) {
  test(`[02a §12.1, §8] hand over: accepted and declined (${lang})`, async ({ browser, page }, info) => {
    const [accepted, declined] = myTables('handover', info, lang);
    const h = hub();
    await pairAs(page, h.device, lang);
    await signIn(page, 'Ali');
    await takeOrder(page, lang, accepted);
    await takeOrder(page, lang, declined);

    const context = await browser.newContext({ ...info.project.use });
    const other = await context.newPage();
    try {
      await pairAs(other, h.device2, lang);
      await signIn(other, 'Sara');

      // accepted
      await handOver(page, lang, accepted);
      await expect(page.getByText(tr(lang, 'handover.waiting', { name: 'Sara' }))).toBeVisible();
      const sizes = await answer(other, lang, accepted, 'accept');
      info.annotations.push({ type: 'answer-sheet-button-px', description: `Decline ${sizes.decline} / Accept ${sizes.accept}` });
      // 72 px on tablet and kiosk viewports; the phone floor is 56 px (IR-10: the phone draws 64, pulse-02.css is the
      // handoff's byte copy, accepted). The measured heights are recorded in docs/reviews/02a-client-e2e.md.
      const floor = isPhone(info) ? 56 : 72;
      expect(sizes.accept).toBeGreaterThanOrEqual(floor);
      expect(sizes.decline).toBeGreaterThanOrEqual(floor);
      await expect(page.getByText(tr(lang, 'handover.result.accepted', { name: 'Sara', table: accepted }))).toBeVisible();

      // declined
      await handOver(page, lang, declined);
      await answer(other, lang, declined, 'decline');
      await expect(page.getByText(tr(lang, 'handover.result.declined', { name: 'Sara', table: declined }))).toBeVisible();
      await expect(page.getByText(tr(lang, 'handover.result.stays_yours'))).toBeVisible();
    } finally {
      await signOut(other, info, lang);
      await context.close();
      await signOut(page, info, lang);
    }
  });
}
