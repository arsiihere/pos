import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { deviceFor, escapeRe, kitchenReady, KITCHEN, LANGS, menuTile, readyTile, rushOff, sentToken, shiftOpen, signInOn, signOut, takeawayTab, tr } from './02b-support';

// 02b-TK L-CLIENT-2 item 2 (03b v1.0.16 §3.4 "Not collected" (R3-M-9), §3.5, D8; 02b v1.0.25 §6.16; frames ReadyTiles,
// TokenLate): at the counter (kiosk column, landscape tablet strip) a paid takeaway token whose whole bag is ready
// shows the green Ready tile; once hub now ≥ open-orders `ready_at` + `bag_ready_window_ms` (the e2e hub's R8 window is
// 60 s; the page's clock is fast-forwarded, as 02b-tk-pass.spec does) the tile turns amber "{n} min · Call", and the
// drawer it opens says "Ready {n} min ago — not collected" with Call. The token is handed over at the end (the rail
// stays as other specs expect).

const NAAN = KITCHEN.naan;
const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway counter at the kiosk and landscape tablet viewports');
  test.setTimeout(90_000);
};

async function capture(page: Page, info: TestInfo, frame: string, what?: Locator) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(frame + '.png');
  if (what === undefined) await page.screenshot({ path });
  else await what.screenshot({ path });
  await info.attach(frame, { path, contentType: 'image/png' });
}

const drawer = (page: Page) => page.locator('section.tk-drawer');

for (const lang of LANGS) {
  test(`[03b v1.0.16 §3.4 R3-M-9, §3.5; frames ReadyTiles, TokenLate] the counter Ready tile turns amber after the R8 window (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.clock.install();
    await rushOff(page);
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeawayTab(page);
      const phone = page.locator('.cart input[name="phone"]');
      if ((await phone.count()) > 0) {
        await page.locator('.cart input[name="customer_name"]').fill('Kamran');
        await phone.fill('03001234567');
      }
      await menuTile(page, NAAN.name).click();
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await kitchenReady(request, token, [NAAN.item_id]);

      // ready: pay it (cash, exact), the green Paid tile
      const tile = readyTile(page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      await tile.locator('.tk-rt__open').click();
      await drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
      await page.keyboard.press('Enter');
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
      await expect(panel).toHaveCount(0);
      await expect(tile.locator('.tk-chip--ok')).toBeVisible();
      await expect(tile).not.toHaveClass(/tk-rt--late/);

      // past the window on the page's (hub) clock: amber, re-checked by the rail's timer
      await page.clock.fastForward('02:30');
      await expect(tile).toHaveClass(/tk-rt--late/, { timeout: 10_000 });
      const [before, after] = tr(lang, 'q.waiting_min').split('{n}');
      const act = tile.locator('.tk-rt__act');
      const called = (await phone.count()) > 0;
      if (called) await expect(act).toHaveText(new RegExp(`^${escapeRe(before!)}\\d+${escapeRe(after!)}$`));
      await capture(page, info, `ReadyTileLate-${info.project.name}-${lang}`, tile);

      // the drawer: "Ready {n} min ago — not collected"
      await (called ? act : tile.locator('.tk-rt__open')).click();
      const banner = drawer(page).locator('[data-late]');
      await expect(banner).toBeVisible();
      const [b1, b2] = tr(lang, 'v.late').split('{n}');
      await expect(banner).toContainText(new RegExp(`${escapeRe(b1!)}\\d+${escapeRe(b2!)}`));
      await capture(page, info, `TokenLate-${info.project.name}-${lang}`);

      // hand it over (the rail stays as the other specs expect): Hand over all, the 5 s Undo window passes
      const served = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: 20_000 });
      await drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.collected'))}`) }).click();
      await page.clock.fastForward('00:06');
      expect((await served).status()).toBe(200);
      await expect(readyTile(page, token)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang).catch(() => undefined);
      await context.close();
    }
  });
}
