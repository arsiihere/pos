import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { hub, LANGS, pairAs, runKey, signInPass, signOut, tr } from './03b-support';

// 02b-TK L-CLIENT-1 (03b v1.0.16 §3.4 Pickup identity, Readiness, Handed to customer, Bill freshness; frames
// PackerPass, HandoverUndo): the Pass tablet of the run's own point ('tkpass', 03b-fixture.ts) holds a takeaway order
// with a pickup time, three lines at a screenless station.
//   item 1: the card shows the pickup time; Cook (run-pass only) has no "Handed to customer"; Pervez (the Pass role:
//           run-pass + mark-served) sees it greyed, "Waiting for the bill" (the hub's open-orders has no `bill` yet).

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the Pass at the kiosk and landscape tablet viewports');
  test.setTimeout(90_000);
};

/** the screen, or one element of it: a Pass card is taller than the tablet's scroll area, so the viewport grows for it */
async function capture(page: Page, info: TestInfo, frame: string, what?: Locator) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(frame + '.png');
  if (what === undefined) await page.screenshot({ path });
  else {
    const size = page.viewportSize()!;
    // taller, still landscape (a portrait viewport turns the Pass into one column)
    await page.setViewportSize({ width: size.width, height: Math.max(size.height, Math.min(size.width - 80, 1400)) });
    await what.screenshot({ path });
    await page.setViewportSize(size);
  }
  await info.attach(frame, { path, contentType: 'image/png' });
}

for (const lang of LANGS) {
  test(`[03b v1.0.16 §3.4 R3-B-1, R3-B-2] Pass pickup card; Handed to customer greyed for the Pass role, absent for Cook (${lang})`, async ({ browser }, info) => {
    runsHere(info);
    const key = runKey('tkpass', info, lang);
    const tablet = hub().devices03[`pass:${key}`]!;
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      await pairAs(page, { ...tablet, device_type: 'tablet' }, lang);
      await signInPass(page, 'Cook');
      const card = page.locator('article.pc');
      await expect(card).toHaveCount(1);
      await expect(card.locator('.pc__pickup')).toContainText(tr(lang, 'pass.pickup_label').split('{time}')[0]!.trim());
      await expect(card.locator('.pc__pickup .num')).toHaveText(/^\d{1,2}:\d{2}\s?(AM|PM)$/);
      await expect(card.locator('.btn--customer')).toHaveCount(0);
      await signOut(page, info, lang);

      await signInPass(page, 'Pervez');
      const button = card.locator('.btn--customer');
      await expect(button).toBeVisible();
      await expect(button).toHaveText(tr(lang, 'pass.handed_to_customer'));
      await expect(button).toBeDisabled();
      await expect(card.locator('.pc__hint')).toHaveText(tr(lang, 'pass.waiting_bill'));
      await capture(page, info, `PackerPass-pickup-${info.project.name}-${lang}`, card);
    } finally {
      await signOut(page, info, lang);
      await context.close();
    }
  });
}
