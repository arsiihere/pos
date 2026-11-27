import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { deviceFor, LANGS, menuTile, rushOff, signInOn, signOut, takeawayTab, tr } from './02b-support';

// ⚠️ 02b-TK L-CLIENT-4 item 3 (02b v1.0.25 §8; 05 v1.0.35 §6.3a Result, §8 R2-M-3; frames HomeKiosk, HomeTablet,
// PhoneCart): the takeaway cart's own line sum (not computeBill) is labelled "Items" beside the same figure: on the
// kiosk and landscape tablet cart footer, and on the phone's sticky bar. Against the e2e hub, nothing mocked.

const RUNS_ON = ['kiosk', 'tablet-landscape', 'phone-390'];

async function capture(page: Page, info: TestInfo, name: string, what: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(`${name}.png`);
  await what.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

for (const lang of LANGS) {
  test(`[02b v1.0.25 §8; 05 v1.0.35 §6.3a, §8] the takeaway cart footer total is labelled "Items" (${lang})`, async ({ page }, info) => {
    test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway cart: kiosk, landscape tablet and phone');
    await rushOff(page);
    const device = deviceFor(info);
    const phone = info.project.name.startsWith('phone');
    await signInOn(page, device, lang, phone ? 'Ali' : 'Owner');
    try {
      await takeawayTab(page);
      await menuTile(page, 'Naan').click();
      await menuTile(page, 'Naan').click();
      const foot = phone ? page.locator('.ph-bar .sbar__t') : page.locator('.cart__foot .tk-total'); // L-CLIENT-6a item 5: the takeaway cart's line sum row
      await expect(foot.locator('[data-items-label]')).toHaveText(tr(lang, 'cart.items_label'));
      await expect(foot.locator(phone ? 'b' : 'strong')).toHaveText('Rs 60');
      await capture(page, info, `CartItems-${info.project.name}-${lang}`, phone ? page.locator('.ph-bar') : page.locator('.cart__foot'));
    } finally {
      await signOut(page, info, lang).catch(() => undefined);
    }
  });
}
