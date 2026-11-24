import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { deviceFor, LANGS, menuTile, signInOn, signOut, takeawayTab, tr } from './02b-support';
import { TK_TILES } from './global-setup';

// 02b-TK Part A2 batch 2 against the e2e test hub (kiosk 1920×1080 and landscape tablet 1280×800, en + ur).
// Item 3 — the tiles (frame TileStates; MAPPING TK-C01): Half / Full on the "Paye" variant tile add that variant in one
//   tap; the open cart line's ×2 ×4 ×6 ×8 chips set its quantity; the sold-out "Tikka" shows "Sold out", its price
//   not struck through, and a tap says why in a toast (global-setup TK_TILES).
// Item 4 — rush mode (frame HomeRush; R9 UI only): the e2e hub has far fewer than 15 open tokens, so the pill's manual
//   toggle is walked: "Rush mode · n" (.tk-live--rush), dense tiles (.items--rush, no photos), the folded
//   "Name / phone" button and the compact queue; a second tap goes back to Live and the normal layout.
// Ali (order-taker) is on both devices.

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway tiles run at the kiosk and landscape tablet viewports');
  test.setTimeout(60_000);
};

/** The Paye category of the menu rail (its tiles are not on the first category). */
async function payeCategory(page: Page): Promise<void> {
  await page.locator('.cats').getByRole('button', { name: new RegExp(`^${TK_TILES.category}`) }).click();
}
const cartLines = (page: Page) => page.locator('.cart .ln');

for (const lang of LANGS) {
  test(`[02b-TK TK-C01] Half / Full on the variant tile add that variant in one tap (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await payeCategory(page);
      const paye = menuTile(page, TK_TILES.group);
      await expect(paye.locator('.tk-split button')).toHaveCount(2);
      await paye.getByRole('button', { name: `${TK_TILES.group} · ${TK_TILES.full}` }).click();
      await expect(page.locator('.dlg[role="dialog"]')).toHaveCount(0);
      await expect(cartLines(page)).toHaveCount(1);
      await expect(cartLines(page).first()).toContainText('Paye — Full');
      await paye.getByRole('button', { name: `${TK_TILES.group} · ${TK_TILES.half}` }).click();
      await expect(cartLines(page)).toHaveCount(2);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-C01; CHANGES §4 #6] the open line's ×2 ×4 ×6 ×8 chips set its quantity (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await menuTile(page, 'Naan').click();
      await cartLines(page).first().locator('.ln__m').click();
      const chips = cartLines(page).first().locator('.tk-qchips button');
      await expect(chips).toHaveText(['×2', '×4', '×6', '×8']);
      await chips.nth(2).click();
      await expect(cartLines(page).first().locator('.ln__q')).toHaveText('6×');
      await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'true');
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-C01] a sold-out tile: "Sold out", the price not struck through, a tap says why (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await payeCategory(page);
      const tikka = menuTile(page, TK_TILES.soldOut);
      await expect(tikka).toHaveAttribute('aria-disabled', 'true');
      await expect(tikka.locator('.tag')).toHaveText(tr(lang, 'm.sold_out'));
      await expect(tikka.locator('.price')).not.toHaveCSS('text-decoration-line', 'line-through');
      await tikka.click();
      await expect(page.locator('.toast').first()).toContainText(tr(lang, 't.sold_out', { item: TK_TILES.soldOut }));
      await expect(cartLines(page)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK R9; frame HomeRush] the Live pill switches rush mode by hand: dense tiles, "Name / phone", compact queue (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      const pill = page.locator('header.top button.live.tk-live');
      await expect(pill).toHaveText(tr(lang, 'alerts.live'));
      await pill.click();
      await expect(pill).toHaveClass(/tk-live--rush/);
      await expect(pill).toContainText(tr(lang, 'shell.rush'));
      await expect(page.locator('.menu .items--rush')).toBeVisible();
      await expect(page.locator('.menu .items--rush .photo').first()).toBeHidden();
      await expect(page.locator('.cart input[name="customer_name"]')).toHaveCount(0);
      await page.locator('.cart .cust--compact').getByRole('button', { name: tr(lang, 'c.who_add') }).click();
      await expect(page.locator('.cart input[name="customer_name"]')).toBeVisible();
      if (info.project.name === 'kiosk') await expect(page.locator('aside.tk-q.tk-q--compact')).toBeVisible();
      await pill.click();
      await expect(pill).not.toHaveClass(/tk-live--rush/);
      await expect(pill).toHaveText(tr(lang, 'alerts.live'));
      await expect(page.locator('.menu .items--rush')).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });
}
