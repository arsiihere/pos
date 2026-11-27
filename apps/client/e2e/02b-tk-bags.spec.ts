import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { hub, LANGS, pairAs, PIN_MANAGER, runKey, signInPass, signOut, tr } from './03b-support';

// ⚠️ 03b v1.0.17 §3.4, §8 (owner ruling 2026-11-28 "Pass bag = token"; QA BUG-8, BUG-2 and the Pass design audit,
// frame PackerPass): the 'tkbags' point (03b-fixture.ts seedBags) holds six takeaway bags. The token whose addition
// cooks after its root was done is ONE card, Cooking (BUG-8). The type tabs are one row in the top bar; the bag area
// scrolls (BUG-2: `.pscroll` is not overflow hidden). Build shots at 1280×800 and 1280×580 go to
// docs/design/handoff/02b-tk/build-shots/PackerPass-<size>.png (English).

const SHOTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/design/handoff/02b-tk/build-shots');

/** the element's box lies inside the viewport (fully visible, not scrolled away) */
async function fullyVisible(page: Page, el: Locator): Promise<boolean> {
  const box = await el.boundingBox();
  const view = page.viewportSize()!;
  return box !== null && box.y >= 0 && box.x >= 0 && box.y + box.height <= view.height + 0.5 && box.x + box.width <= view.width + 0.5;
}
const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

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
      // one primary per state (v1.0.17 §8): the bag is not ready, so Bag ready, no "Handed to customer" yet
      await expect(bag.locator('.pc__f .btn--ready')).toHaveCount(1);
      await expect(bag.locator('.btn--customer')).toHaveCount(0);
      // one Due pill per bag, with its amount
      await expect(bag.locator('.pc__due')).toHaveCount(1);
      await expect(bag.locator('.pc__due')).toContainText('Rs');
      // the phone (pickup) order shows the phone glyph
      await expect(page.locator(`article.pc[data-order="B3-${key}-pickup"] .pc__ph`)).toBeVisible();
      // the bag area scrolls (BUG-2)
      const overflow = await page.locator('.pscroll').evaluate((el) => getComputedStyle(el).overflowY);
      expect(overflow).toBe('auto');

      // QA design review round 2: six bag cards (3 × 2) fully visible at 1280 × 800; the first row at 1280 × 580
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      if (lang === 'en') {
        mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: `${SHOTS}/PackerPass-1280x800.png` });
      }
      for (let i = 0; i < 6; i++) expect(await fullyVisible(page, cards.nth(i)), `card ${i + 1} at 800`).toBe(true);
      // the line actions sit in the line's own row (no full-width Start / Done rows), the Ask button beside the Due pill
      await expect(page.locator('article.pc .pl__a')).toHaveCount(0);
      await expect(bag.locator('[data-unpaid]')).toHaveCount(0);
      await page.setViewportSize({ width: 1280, height: 580 });
      await page.waitForTimeout(300);
      for (let i = 0; i < 3; i++) expect(await fullyVisible(page, cards.nth(i)), `card ${i + 1} at 580`).toBe(true);
      if (lang === 'en') await page.screenshot({ path: `${SHOTS}/PackerPass-1280x580.png` });
      // at 580 the second row is reached by scrolling the bag area
      const scrolls = await page.locator('.pscroll').evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(scrolls).toBe(true);
      await page.setViewportSize({ width: 1280, height: 800 });
    } finally {
      await signOut(page, info, lang);
      await context.close();
    }
  });
}

test('[03b v1.0.17 §8] every station has a screen: status chips only, no strip; an alert banner and a toast never cover a card', async ({ browser, request }, info) => {
  runsHere(info);
  const lang = 'en';
  const key = runKey('tknormal', info, lang);
  const tablet = hub().devices03[`pass:${key}`]!;
  const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await pairAs(page, { ...tablet, device_type: 'tablet' }, lang);
    await signInPass(page, 'Pervez');
    await page.locator('header.top .pfilter--bar [data-filter="takeaway"]').click();
    const cards = page.locator('article.pc');
    await expect(cards).toHaveCount(6);
    // both stations have a screen: no strip, no "no screen" on any card
    await expect(page.locator('.pstrip')).toHaveCount(0);
    await expect(page.locator('article.pc', { hasText: tr(lang, 'pass.group_no_screen').split('{station}')[1]!.trim() })).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    for (let i = 0; i < 6; i++) expect(await fullyVisible(page, cards.nth(i)), `card ${i + 1}`).toBe(true);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/PackerPass-normal-1280x800.png` });

    // an alert banner (the Manager's test alert to this tablet) and a toast (Reprint): neither covers a card
    // manage-devices is listed-device only (05a H-2): the Manager signs in on tablet 2, which lists him
    const h = hub();
    const dev = { Authorization: `Bearer ${h.device2.token}` };
    const login = await request.post(`${h.baseURL}/auth/pin`, { headers: dev, data: { staff_id: 'S_MGR', pin: PIN_MANAGER, takeover: true } });
    expect(login.status(), await login.text()).toBe(200);
    const session = ((await login.json()) as { data: { session_token: string } }).data.session_token;
    const headers = { ...dev, 'X-Session-Token': session };
    const sent = await request.post(`${h.baseURL}/commands/send-test-alert`, {
      headers,
      // eslint-disable-next-line no-restricted-syntax -- the e2e client has no Clock; the hub stamps its own time
      data: { command_id: `e2e-bags-${process.pid}`, tenant_id: h.tenant_id, branch_id: h.branch_id, command_type: 'SendTestAlert', payload: { target: { kind: 'device', device_id: tablet.device_id } }, occurred_at: Date.now(), actor_id: 'S_MGR', device_id: h.device2.device_id },
    });
    expect(sent.status(), await sent.text()).toBe(200);
    await request.post(`${h.baseURL}/auth/logout`, { headers, data: {} });
    const banner = page.locator('.abns .abn').first();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await page.locator('article.pc .btn.rp').first().click();
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
    await page.waitForTimeout(400);
    const boxes = await cards.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
    const t = (await toast.boundingBox())!;
    const b = (await banner.boundingBox())!;
    for (const c of boxes) {
      expect(overlaps(t, c), 'the toast covers a card').toBe(false);
      expect(overlaps(b, c), 'the alert banner covers a card').toBe(false);
    }
    await page.screenshot({ path: `${SHOTS}/PackerPass-alert-toast-1280x800.png` });
  } finally {
    await signOut(page, info, lang);
    await context.close();
  }
});
