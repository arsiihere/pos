import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { hub, LANGS, pairAs, runKey, signInOn, signInPass, signOut, tr } from './03b-support';

// 02b-TK L-CLIENT-1 (03b v1.0.16 §3.4 Pickup identity, Readiness, Handed to customer, Bill freshness; frames
// PackerPass, HandoverUndo): the Pass tablet of the run's own point ('tkpass', 03b-fixture.ts) holds a takeaway order
// with a pickup time, three lines at a screenless station.
//   item 1: the card shows the pickup time; Cook (run-pass only) has no "Handed to customer"; Pervez (the Pass role:
//           run-pass + mark-served) sees it greyed: the order is unpaid, so since B2-1 (open-orders `bill`) the card
//           reads "Due — customer pays at counter" and "Take payment first".
//   item 2: Pervez cooks the three lines and taps Bag ready → the hub's order-level counter alert reaches Ali at the
//           kiosk as the counter card ("Bag ready — hand over at the counter", #token); past the R8 window (the page's
//           clock fast-forwarded; the hub's ready_window_ms is 60 s) the Pass card is amber "Ready {n} min ago — not
//           collected".

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
  test(`[03b v1.0.16 §3.4 R3-B-1, R3-B-2] Pass pickup card; no Handed to customer while the pickup waits (Pass role and Cook) (${lang})`, async ({ browser }, info) => {
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
      // ⚠️ 03b v1.0.18 §8 (one primary per state): the pickup's whole order is not ready yet, so no "Handed to customer"
      // at all (never a greyed one as its primary); the one Due pill with its amount and Ask a manager show already
      await expect(card.locator('.btn--customer')).toHaveCount(0);
      await expect(card.locator('.pc__due')).toContainText(tr(lang, 'pass.due_amount').split('{amount}')[0]!.trim());
      await expect(card.locator('.pc__due')).toContainText('Rs');
      await expect(card.locator('[data-ask]')).toHaveText(tr(lang, 'pass.ask_manager'));
      await capture(page, info, `PackerPass-pickup-${info.project.name}-${lang}`, card);
    } finally {
      await signOut(page, info, lang);
      await context.close();
    }
  });
}

for (const lang of LANGS) {
  test(`[03b v1.0.16 §3.4 R3-M-9, §3.5 R8] Bag ready → the counter card at the kiosk; amber "not collected" after the window (${lang})`, async ({ browser }, info) => {
    runsHere(info);
    const key = runKey('tkpass', info, lang);
    const h = hub();
    const tablet = h.devices03[`pass:${key}`]!;
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    // the counter: Ali at the cashier kiosk (its profile shows the takeaway screen)
    const counterContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
    const kiosk = await counterContext.newPage();
    try {
      await page.clock.install();
      await pairAs(page, { ...tablet, device_type: 'tablet' }, lang);
      await signInPass(page, 'Pervez');
      await signInOn(kiosk, h.kiosk, lang);
      const card = page.locator('article.pc');
      await expect(card).toHaveCount(1);
      const token = (await card.locator('.pc__n').innerText()).trim();
      for (const n of [1, 2, 3]) {
        const row = card.locator('.pl').nth(n - 1);
        await row.locator('.btn--start').click();
        // the Start lands first: a Done tapped while it is in flight is dropped by the row's one-tap guard (03b §3.2)
        await expect(row.locator('.btn--start')).toHaveCount(0, { timeout: 10_000 });
        await row.locator('.btn--done').click();
        // a Done this soon after Start asks again ("Done already? …"); the second tap confirms
        const undo = row.locator('.btn--undo');
        // the Done-confirm prompt only (.pc__act): a Due takeaway also shows the Due, Ask a manager and amber lines, which
        // are .pc__msg too; matching every .pc__msg hit two elements (Playwright strict mode)
        await expect(undo.or(card.locator('.pc__act'))).toBeVisible();
        if (!(await undo.isVisible())) await row.locator('.btn--done').click();
        await expect(undo).toBeVisible();
      }
      // the whole bag is ready (point_lines.orders pickup_readiness) → Bag ready
      await expect(card).toHaveClass(/\bready\b/);
      await card.locator('.btn--ready').click();
      await expect(card.locator('.pc__rdy')).toBeVisible();

      const banner = kiosk.locator('.abn--counter', { has: kiosk.locator('.tcode', { hasText: token }) });
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await expect(banner.locator('.ac__title b')).toHaveText(tr(lang, 'alert.ready_to_serve.counter'));
      if (info.project.name === 'kiosk') await capture(kiosk, info, `CounterReady-${lang}`);

      // past the R8 window on the page's (hub) clock: amber on the card
      await page.clock.fastForward('02:30');
      await expect(card).toHaveClass(/pc--late/, { timeout: 10_000 });
      const [before] = tr(lang, 'pass.not_collected').split('{n}');
      await expect(card.locator('.pc__late')).toContainText(lang === 'en' ? before!.trim() : tr(lang, 'pass.not_collected').split('{n}')[1]!.trim());
      await capture(page, info, `PassNotCollected-${info.project.name}-${lang}`, card);
    } finally {
      await signOut(kiosk, info, lang);
      await counterContext.close();
      await signOut(page, info, lang);
      await context.close();
    }
  });
}
