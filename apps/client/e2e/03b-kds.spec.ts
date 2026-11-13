import { expect, test } from '@playwright/test';
import { card, pairKdsScreen, runKey, runStation, tr, type Lang } from './03b-support';

// 03b v1.0.8 §3.2, §3.3, §8, #70–#72, E3-KDS (Z1): pair a kitchen screen → /kds/ → lines → Start / Done; Reprint (03c
// v1.0.9 §3.5, IR-15). Runs at 1920 (kiosk project) and 1280 (tablet-landscape). The KDS is English only (brief §6.1),
// so the ur run opens the pair page in Urdu and then checks the screen stays English, left to right.

for (const lang of ['en', 'ur'] as Lang[]) {
  test(`[03b §3.2, §3.3, §8; 03c §3.5 @combined] pair → /kds/ → Start, Done, Undo, Reprint (${lang})`, async ({ page, request }, info) => {
    test.skip(!['kiosk', 'tablet-landscape'].includes(info.project.name), 'KDS runs at 1920 and 1280');
    const key = runKey('kds', info, lang);
    await pairKdsScreen(page, request, runStation('kds', info, lang), lang);

    // the station view: the three fired lines in Now, English and LTR whatever the page language was
    await expect(page.locator('div.kds')).toHaveAttribute('lang', 'en');
    await expect(page.locator('div.kds')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('article.kl')).toHaveCount(3);
    await expect(page.locator('.ksec__h').first()).toContainText(tr('en', 'kds.now'));
    // 1920: three columns; 1280: compact cards (`kgrid--1280`, Q-IR-14)
    const compact = info.project.name === 'tablet-landscape';
    await expect(page.locator('main.kgrid')).toHaveClass(compact ? /kgrid--1280/ : /^(?!.*kgrid--1280)/);
    await expect(card(page, key, 1)).toHaveClass(compact ? /kl--c/ : /^(?!.*kl--c)/);

    // Start → Done → Undo on line 1
    const one = card(page, key, 1);
    await one.locator('.btn--start').click();
    await expect(one.locator('.btn--done')).toBeVisible();
    await one.locator('.btn--done').click();
    // Done a moment after Start: the inline "Done already? m:ss of 6:00 — tap again" (§3.2), no modal; the tap confirms
    await expect(one.locator('.btn--confirm')).toContainText(/Done already\?/);
    await one.locator('.btn--confirm').click();
    await expect(one.locator('.btn--undo')).toBeVisible();
    await expect(one).toHaveClass(/s-done/);

    // Reprint (03c §3.5, IR-15): the station prints too, so its cards offer it; it answers on the card
    const two = card(page, key, 2);
    await two.getByRole('button', { name: tr('en', 'print.reprint') }).click();
    await expect(two.locator('.kl__msg')).toContainText(/Reprint/);
  });
}
