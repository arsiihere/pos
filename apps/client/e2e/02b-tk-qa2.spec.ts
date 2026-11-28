import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { deviceFor, hub, menuTile, signInOn, signOut, takeawayTab, type Lang } from './02b-support';

// QA round 2 (owner 2026-11-28 QA-R2; 02b v1.0.28 §8 QK-2, QK-3, test QR2-3; BUG-15, BUG-16): the cashier kiosk at 1366
// and 1456 px wide, in English and Urdu, and the 1280 landscape tablet: menu tiles keep a readable width (≥ 140 px)
// with names broken by word, and the pickup chips, the cart's buttons and the quantity steps are never clipped.

/** Elements whose content overflows their own box while it is hidden or ellipsised (clipped text): the rule is none. */
async function clipped(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((els) =>
    els
      .filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
      .map((e) => `${e.className}:${(e.textContent ?? '').trim().slice(0, 30)}`),
  );
}

const CART = '.cart [data-pickup-row] button, .cart .cart__foot .btn, .cart .cart__foot .tk-btn, .cart .ln .step, .cart .cust--compact .tk-btn';

async function checkLayout(page: Page, info: TestInfo, lang: Lang, frame: string): Promise<void> {
  await takeawayTab(page);
  await menuTile(page, 'Naan').click();
  await menuTile(page, 'Naan').click();
  await page.locator('.cart [data-pickup-row] .tk-pick button').nth(2).click(); // +30 min
  const tiles = await page.locator('.osc--tk .items .mi').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(tiles.length).toBeGreaterThan(0);
  expect(Math.min(...tiles)).toBeGreaterThanOrEqual(140);
  // a name breaks by word, never inside one (the per-letter break of QA came from overflow-wrap on ~100 px tiles)
  const wrap = await page.locator('.osc--tk .items .mi .mi__name').evaluateAll((els) => [...new Set(els.map((e) => `${getComputedStyle(e).overflowWrap}/${getComputedStyle(e).wordBreak}`))]);
  expect(wrap).toEqual(['normal/normal']);
  expect(await clipped(page, CART)).toEqual([]);
  await info.attach(`${frame}-${lang}`, { body: await page.screenshot(), contentType: 'image/png' });
}

for (const lang of ['en', 'ur'] as const) {
  for (const width of [1366, 1456]) {
    test(`[BUG-15/16; QK-2, QK-3] kiosk at ${width} × 768 (${lang}): tiles ≥ 140 px, nothing clipped`, async ({ page }, info) => {
      test.skip(info.project.name !== 'kiosk', 'kiosk widths');
      await page.setViewportSize({ width, height: 768 });
      await signInOn(page, hub().kiosk, lang, 'Owner');
      try {
        await checkLayout(page, info, lang, `kiosk-${width}`);
      } finally {
        await signOut(page, info, lang);
      }
    });
  }
}

test('[BUG-15; QK-2] the 1280 landscape tablet keeps its layout: nothing clipped in the cart', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-landscape', 'landscape tablet');
  await signInOn(page, deviceFor(info), 'en', 'Owner');
  try {
    await takeawayTab(page);
    await menuTile(page, 'Naan').click();
    await page.locator('.cart [data-pickup-row] .tk-pick button').nth(2).click();
    expect(await clipped(page, CART)).toEqual([]);
    expect(Math.round((await page.locator('.osc--tk-tablet > .cart').boundingBox())!.width)).toBe(440);
  } finally {
    await signOut(page, info, 'en');
  }
});
