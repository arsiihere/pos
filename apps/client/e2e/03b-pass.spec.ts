import { expect, test } from '@playwright/test';
import { hub, myTables, pairAs, signIn, signInPass, signOut, runKey, tr, type Lang } from './03b-support';

// 03b v1.0.8 §3.4, §3.5, §8, #74, E3-KDS AC10 (Z1): the Pass tablet (a `tablet` bound to a point, 01d's /staff/ at #/pass),
// landscape and portrait, en and ur. Cook (run-pass) signs in: the card of a takeaway order whose station has no screen
// → Start and Done on its lines (screenless, Q-45) → Ready → "Ready to serve" (Ali, who placed the order, signs in on a
// second tablet and gets the card) → Hand over → Ali → "Handed to Ali" and Ali's "Food handed to you" card.

void myTables;
for (const lang of ['en', 'ur'] as Lang[]) {
  test(`[03b §3.4, §3.5, §8, #74 @combined] Pass: screenless Start / Done → Ready → Ready to serve → Hand over (${lang})`, async ({ page, browser }, info) => {
    test.skip(!['tablet-landscape', 'tablet-portrait'].includes(info.project.name), 'the Pass runs on a tablet, landscape and portrait');
    const key = runKey('pass', info, lang);
    const h = hub();
    const tablet = h.devices03[`pass:${key}`]!;
    await pairAs(page, { ...tablet, device_type: 'tablet' }, lang);
    await signInPass(page, 'Cook');
    await expect(page.locator('main.pass')).toBeVisible();
    const card = page.locator('article.pc');
    await expect(card).toHaveCount(1);
    // portrait: one column of cards (IR-18 `pcards--1`); landscape: the wide grid
    await expect(page.locator('.pcards')).toHaveClass(info.project.name === 'tablet-portrait' ? /pcards--1/ : /^(?!.*pcards--1)/);
    // the station has no screen: the group says so and every line carries Start / Done
    await expect(card.locator('.pc__g')).toContainText(`Grill ${key}`);
    await expect(card.locator('.btn--start')).toHaveCount(3);

    const context = await browser.newContext({ ...info.project.use });
    const taker = await context.newPage();
    try {
      await pairAs(taker, h.device2, lang);
      await signIn(taker, 'Ali');

      for (const line of [1, 2, 3]) {
        const row = card.locator('.pl').nth(line - 1);
        await row.locator('.btn--start').click();
        await row.locator('.btn--done').click();
        // a Done this soon after Start: "Done already? …" on the card, and the second tap confirms
        const undo = row.locator('.btn--undo');
        await expect(undo.or(card.locator('.pc__msg'))).toBeVisible();
        if (!(await undo.isVisible())) await row.locator('.btn--done').click();
        await expect(undo).toBeVisible();
      }
      await expect(card).toHaveClass(/ready/);

      // Ready to serve: Ali's tablet gets the card; the Pass shows who and when, with Undo for 30 s
      await card.locator('.btn--ready').click();
      await expect(card.locator('.pc__rdy')).toBeVisible();
      // the Ready is a person alert for Ali (the taker of a takeaway): the header's Inbox lists it
      await expect(taker.getByRole('button', { name: /Inbox|ان باکس|اِن باکس/ })).toContainText(/[1-9]/, { timeout: 20_000 });
      await taker.getByRole('button', { name: /Inbox|ان باکس|اِن باکس/ }).click();
      await expect(taker.getByText(tr(lang, 'alert.ready_to_serve.card').split(' · ')[0]).first()).toBeVisible({ timeout: 20_000 });

      // Hand over → the receiver sheet → Ali
      await card.locator('.btn--hand').click();
      await expect(page.getByRole('dialog')).toContainText(tr(lang, 'pass.who_takes'));
      await page.locator('.rcv', { hasText: 'Ali' }).click();
      await expect(taker.getByText(tr(lang, 'alert.served_card.card').split(' · ')[0]).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await signOut(taker, info, lang);
      await context.close();
      await signOut(page, info, lang);
    }
  });
}
