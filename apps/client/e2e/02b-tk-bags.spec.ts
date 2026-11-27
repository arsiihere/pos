import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type TestInfo } from '@playwright/test';
import { hub, LANGS, pairAs, runKey, signInPass, signOut, tr } from './03b-support';

// ⚠️ 03b v1.0.17 §3.4, §8 (owner ruling 2026-11-28 "Pass bag = token"; QA BUG-8, BUG-2 and the Pass design audit,
// frame PackerPass): the 'tkbags' point (03b-fixture.ts seedBags) holds six takeaway bags. The token whose addition
// cooks after its root was done is ONE card, Cooking (BUG-8). The type tabs are one row in the top bar; the bag area
// scrolls (BUG-2: `.pscroll` is not overflow hidden). Build shots at 1280×800 and 1280×580 go to
// docs/design/handoff/02b-tk/build-shots/PackerPass-<size>.png (English).

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/design/handoff/02b-tk/build-shots');

const runsHere = (info: TestInfo) => {
  test.skip(info.project.name !== 'tablet-landscape', 'the Pass tablet at 1280 × 800');
  test.setTimeout(90_000);
};

for (const lang of LANGS) {
  test(`[03b v1.0.17 §3.4, §8] one Pass card per token; tabs in the top bar; the bag area scrolls (${lang})`, async ({ browser }, info) => {
    runsHere(info);
    const key = runKey('tkbags', info, lang);
    const tablet = hub().devices03[`pass:${key}`]!;
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await pairAs(page, { ...tablet, device_type: 'tablet' }, lang);
      await signInPass(page, 'Pervez');
      // one row of type tabs, in the top bar; no filter row on the screen
      const tabs = page.locator('header.top .pfilter--bar');
      await expect(tabs).toBeVisible();
      await expect(page.locator('main.pass > .pfilter')).toHaveCount(0);
      await tabs.locator('[data-filter="takeaway"]').click();
      await expect(tabs.locator('[data-filter="takeaway"] .n')).toHaveText('6');
      const cards = page.locator('article.pc');
      await expect(cards).toHaveCount(6);
      // BUG-8: the root and its addition are one card; the addition cooks, so the bag is Cooking again
      const bag = page.locator(`article.pc[data-orders~="B3-${key}-add"]`);
      await expect(bag).toHaveCount(1);
      await expect(bag.locator('.pl')).toHaveCount(3);
      await expect(bag.locator('.rd')).toHaveText(tr(lang, 'pass.cooking'));
      await expect(bag.locator('.btn--customer')).toBeDisabled();
      // one Due pill per bag, with its amount
      await expect(bag.locator('.pc__due')).toHaveCount(1);
      await expect(bag.locator('.pc__due')).toContainText('Rs');
      // the phone (pickup) order shows the phone glyph
      await expect(page.locator(`article.pc[data-order="B3-${key}-pickup"] .pc__ph`)).toBeVisible();
      // the bag area scrolls (BUG-2)
      const overflow = await page.locator('.pscroll').evaluate((el) => getComputedStyle(el).overflowY);
      expect(overflow).toBe('auto');

      if (lang === 'en') {
        mkdirSync(SHOTS, { recursive: true });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.screenshot({ path: `${SHOTS}/PackerPass-1280x800.png` });
        await page.setViewportSize({ width: 1280, height: 580 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/PackerPass-1280x580.png` });
        // at 580 the cards below the fold are reached by scrolling the bag area
        const scrolls = await page.locator('.pscroll').evaluate((el) => el.scrollHeight > el.clientHeight);
        expect(scrolls).toBe(true);
      }
    } finally {
      await signOut(page, info, lang);
      await context.close();
    }
  });
}
