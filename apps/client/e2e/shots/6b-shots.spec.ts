import { expect, test, type Page } from '@playwright/test';
import type { Lang } from '../02b-support';
import { escapeRe, LANGS, railEntry, sentToken, tr } from '../02b-support';
import { SHOTS, advanceHub, readyAll, counter, isPhoneRun, leave, shot, tile } from './shots-support';

// 02b-TK L-CLIENT-6b build shots (owner proof, never the gate): each frame of the lane on the demo hub at every size
// of playwright.shots.config.ts, English and Urdu, saved to docs/design/handoff/02b-tk/build-shots/.

test.describe.configure({ mode: 'default' });

async function addPaye(page: Page, n: number) {
  const paye = await tile(page, 'Paye', 'Paye');
  for (let i = 0; i < n; i += 1) await paye.click();
}

async function name(page: Page, who: string) {
  const field = page.locator('input[name="customer_name"]');
  if (await field.isVisible()) await field.fill(who);
}

for (const lang of LANGS) {
  test(`HeldDrawer (${lang})`, async ({ page }, info) => {
    test.skip(isPhoneRun(info), 'kiosk / tablet frame');
    await counter(page, info, lang);
    try {
      await addPaye(page, 2);
      await name(page, 'Usman');
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'cart.hold'))}`) }).first().click();
      await page.locator('.tk-q__foot').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'q.held'))}`) }).click();
      await expect(page.locator('.tk-held')).toBeVisible();
      await shot(page, info, 'HeldDrawer', lang);
      // leave nothing held for the next run
      for (const trash of await page.locator('.tk-held__trash').all()) await trash.click();
      await page.locator('.tk-held .tk-x').click();
    } finally {
      await leave(page, info, lang);
    }
  });
}

const sheetOf = (page: Page) => page.locator('.dlg.tk-sheet');

for (const lang of LANGS) {
  test(`ItemSheet, ItemSheetKg, ItemSheetEdit (${lang})`, async ({ page }, info) => {
    await counter(page, info, lang);
    try {
      await addPaye(page, 2);
      await name(page, 'Usman');
      const karahi = await tile(page, 'Karahi', 'Chicken Karahi');
      await karahi.getByRole('button', { name: /By kg/ }).click();
      const sheet = sheetOf(page);
      await expect(sheet).toBeVisible();
      await sheet.locator('.tk-var').first().click();
      const step = async (option: string, n: number) => {
        for (let i = 0; i < n; i += 1) await sheet.locator(`.tk-opt[aria-label="${option}"] .tk-step button`).nth(1).click();
      };
      await step('Roghni Naan', 4);
      await step('Raita', 1);
      await sheet.locator('.tk-chc', { hasText: 'Less oil' }).click();
      await shot(page, info, lang === 'ur' ? 'ItemSheetUrdu' : 'ItemSheet', lang, { urduFrame: true });
      await sheet.locator('.tk-var').nth(2).click();
      await sheet.locator('.tk-kg__chips .tk-btn').nth(1).click();
      await shot(page, info, 'ItemSheetKg', lang);
      await sheet.locator('.tk-var').first().click();
      await sheet.locator('.tk-sheet__go').click();
      await expect(sheet).toHaveCount(0);
      if (isPhoneRun(info)) await page.locator('.ptabs button').nth(1).click();
      const line = page.locator('.ln', { hasText: 'Chicken Karahi' }).first();
      await line.locator('.ln__m').click();
      await line.locator('.ln__ctrl .btn').first().click();
      await expect(sheet).toBeVisible();
      await shot(page, info, 'ItemSheetEdit', lang);
      await sheet.locator('.tk-sheet__trash').click();
    } finally {
      await leave(page, info, lang);
    }
  });
}

for (const lang of LANGS) {
  test(`DealSheet (${lang})`, async ({ page }, info) => {
    await counter(page, info, lang);
    try {
      await addPaye(page, 2);
      const deal = await tile(page, 'Deals', 'Family Deal');
      await deal.click();
      const sheet = sheetOf(page);
      await expect(sheet).toBeVisible();
      await sheet.locator('.tk-chc', { hasText: 'Lassi · sweet' }).click();
      await shot(page, info, 'DealSheet', lang);
      await sheet.locator('.dlg__x').click();
    } finally {
      await leave(page, info, lang);
    }
  });
}

async function add(page: Page, category: string, item: string, n = 1) {
  const it = await tile(page, category, item);
  for (let i = 0; i < n; i += 1) await it.click();
}

async function sendLater(page: Page, lang: Lang): Promise<string> {
  await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).first().click();
  return sentToken(page);
}

async function sendPaid(page: Page, lang: Lang): Promise<string> {
  await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_pay'))}`) }).first().click();
  const panel = page.locator('.tk-paypanel');
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
  const token = (await panel.locator('.tk-tok, [data-token]').first().textContent().catch(() => null)) ?? '';
  await panel.getByRole('button', { name: tr(lang, 'p.next') }).click();
  await expect(panel).toHaveCount(0);
  return /\d+/.exec(token)?.[0] ?? '';
}

async function openToken(page: Page, token: string) {
  await railEntry(page, token).first().click();
  const drawer = page.locator('section.tk-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.tk-il').first()).toBeVisible();
  return drawer;
}

const closeDrawer = async (page: Page) => {
  const x = page.locator('section.tk-drawer .tk-x');
  if (await x.count()) await x.first().click();
};

for (const lang of LANGS) {
  test(`TokenDue, TokenRemove, TokenAddItems (${lang})`, async ({ page, request }, info) => {
    test.skip(isPhoneRun(info), 'kiosk / tablet frames');
    await counter(page, info, lang);
    try {
      await add(page, 'Paye', 'Paye', 2);
      await add(page, 'Tandoor', 'Roghni Naan', 2);
      const token = await sendLater(page, lang);
      await readyAll(request, token, ['I_PAYE']);
      const drawer = await openToken(page, token);
      await shot(page, info, lang === 'ur' ? 'TokenUrdu' : 'TokenDue', lang, { urduFrame: true });
      await drawer.getByRole('button', { name: new RegExp(escapeRe(tr(lang, 'v.remove'))) }).click();
      await page.waitForTimeout(300);
      await shot(page, info, 'TokenRemove', lang);
      await page.keyboard.press('Escape');
      await closeDrawer(page);
      const again = await openToken(page, token);
      await again.getByRole('button', { name: new RegExp(escapeRe(tr(lang, 'v.add'))) }).click();
      await add(page, 'Tandoor', 'Roghni Naan', 2);
      await shot(page, info, 'TokenAddItems', lang);
      await page.locator('.tk-banner--adding .tk-btn').click();
      for (const rm of await page.locator('.ln').all()) void rm;
    } finally {
      await leave(page, info, lang);
    }
  });

  test(`TokenReady, TokenPartial, TokenLate (${lang})`, async ({ page, request }, info) => {
    test.skip(isPhoneRun(info), 'kiosk / tablet frames');
    await page.clock.install();
    await counter(page, info, lang);
    try {
      // ready + paid: Tawa Piece + 4 Roti, the kitchen makes it ready (Bag ready at the Pass)
      await add(page, 'Tawa', 'Tawa Piece');
      await add(page, 'Tandoor', 'Roti', 4);
      await name(page, 'Kamran');
      const phone = page.locator('input[name="phone"]');
      if (await phone.isVisible()) await phone.fill('03001234567');
      const ready = await sendPaid(page, lang);
      await readyAll(request, ready);
      await expect(railEntry(page, ready).first()).toBeVisible();
      await openToken(page, ready);
      await shot(page, info, 'TokenReady', lang);
      await closeDrawer(page);
      // part given: Paye now, karahi cooking
      await add(page, 'Paye', 'Paye', 2);
      await add(page, 'Tandoor', 'Roghni Naan', 4);
      await name(page, 'Ayesha');
      const part = await sendPaid(page, lang);
      await readyAll(request, part, ['I_PAYE']);
      const drawer = await openToken(page, part);
      await drawer.getByRole('button', { name: new RegExp(escapeRe(tr(lang, 'v.give_ready'))) }).click();
      await page.waitForTimeout(6_500);
      await openToken(page, part);
      await shot(page, info, 'TokenPartial', lang);
      await closeDrawer(page);
      // not collected: the hub clock 17 min on
      // the page's (hub) clock 17 min on, as 02b-tk-late.spec does; the hub's own clock too
      await advanceHub(17 * 60_000);
      await page.clock.fastForward('17:00');
      await page.waitForTimeout(2_000);
      await openToken(page, ready);
      await expect(page.locator('section.tk-drawer [data-late]')).toBeVisible({ timeout: 20_000 });
      await shot(page, info, 'TokenLate', lang);
      await closeDrawer(page);
    } finally {
      await leave(page, info, lang);
    }
  });
}

for (const lang of LANGS) {
  test(`PayCash, PayCashShort, PayCard, PayDone (${lang})`, async ({ page }, info) => {
    test.skip(isPhoneRun(info), 'kiosk / tablet frames');
    await counter(page, info, lang);
    try {
      await add(page, 'Paye', 'Paye', 2);
      await add(page, 'Sides', 'Raita');
      await add(page, 'Tandoor', 'Roghni Naan', 4);
      await name(page, 'Usman');
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_pay'))}`) }).first().click();
      const panel = page.locator('.tk-paypanel');
      await expect(panel.locator('.tk-notes button').first()).toBeVisible();
      await panel.locator('.tk-notes button').nth(2).click();
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await shot(page, info, lang === 'ur' ? 'PayUrdu' : 'PayCash', lang, { urduFrame: true });
      await panel.locator('.tk-tendered input').fill('1000');
      await shot(page, info, 'PayCashShort', lang);
      await panel.locator('.tk-mode').nth(1).click();
      await panel.locator('.tk-qrbox input').fill('4417');
      await shot(page, info, 'PayCard', lang);
      await panel.locator('.tk-mode').first().click();
      await panel.locator('.tk-notes button').nth(2).click();
      await panel.getByRole('button', { name: new RegExp(`${escapeRe(tr(lang, 'p.done'))}`) }).click();
      await expect(panel.locator('.tk-pay__done')).toBeVisible();
      await shot(page, info, 'PayDone', lang);
      await panel.getByRole('button', { name: tr(lang, 'p.next') }).click();
    } finally {
      await leave(page, info, lang);
    }
  });
}

for (const lang of LANGS) {
  test(`PersonMenu, CustomerDisplay (${lang})`, async ({ page }, info) => {
    test.skip(isPhoneRun(info), 'kiosk / tablet frames');
    await counter(page, info, lang);
    try {
      await page.locator('header.top .me').click();
      await expect(page.locator('[role="menu"]')).toBeVisible();
      await shot(page, info, 'PersonMenu', lang);
      await page.keyboard.press('Escape');
      if (info.project.name !== '1920') return;
      // BUG-11: the cart is built first, then the customer screen opens — it shows the cart at once
      await add(page, 'Paye', 'Paye', 2);
      await add(page, 'Sides', 'Raita');
      await add(page, 'Tandoor', 'Roghni Naan', 4);
      const [display] = await Promise.all([page.waitForEvent('popup'), page.getByRole('button', { name: tr(lang, 'cd.open') }).click()]);
      await display.setViewportSize({ width: 1920, height: 1080 });
      await expect(display.locator('.cd-row').first()).toBeVisible({ timeout: 5_000 });
      await display.evaluate(() => document.fonts.ready.then(() => undefined));
      await display.screenshot({ path: `${SHOTS}/CustomerDisplay${lang === 'ur' ? '-Urdu' : ''}-1920.png` });
      await display.close();
      for (const rm of await page.locator('.ln__rm, .ln .btn--icon[aria-label]').all()) void rm;
    } finally {
      await leave(page, info, lang);
    }
  });

  test(`Urdu home frames: HomeUrdu / HomeTabletUrdu / HomeRushUrdu / PickupLaterUrdu / PhoneCartUrdu (${lang})`, async ({ page }, info) => {
    test.skip(lang !== 'ur', 'Urdu frames');
    if (info.project.name === '1920') {
      await page.addInitScript(() => window.localStorage.setItem('pos.tk.rush', 'on'));
    }
    await counter(page, info, lang);
    try {
      await add(page, 'Paye', 'Paye', 2);
      await add(page, 'Tandoor', 'Roghni Naan', 4);
      if (isPhoneRun(info)) {
        await page.locator('.ptabs button').nth(1).click();
        await name(page, 'Usman');
        await shot(page, info, 'PhoneCartUrdu', lang, { urduFrame: true });
        return;
      }
      await name(page, 'Usman');
      const frame = info.project.name === '1280' ? 'HomeTabletUrdu' : info.project.name === '1920' ? 'HomeRushUrdu' : 'HomeUrdu';
      await shot(page, info, frame, lang, { urduFrame: true });
      const later = page.locator('.tk-pick button').nth(2);
      if (await later.isVisible()) {
        const phone = page.locator('input[name="phone"]');
        if (await phone.isVisible()) await phone.fill('03001234567');
        await later.click();
        await shot(page, info, 'PickupLaterUrdu', lang, { urduFrame: true });
      }
    } finally {
      await leave(page, info, lang);
    }
  });

  test(`PhoneToken (${lang})`, async ({ page, request }, info) => {
    test.skip(!isPhoneRun(info), 'phone frame');
    await counter(page, info, lang);
    try {
      await add(page, 'Paye', 'Paye', 2);
      await add(page, 'Tandoor', 'Roghni Naan', 2);
      await page.locator('.ptabs button').nth(1).click();
      await page.locator('.ph-bar').getByRole('button', { name: tr(lang, 'cart.send_short'), exact: true }).click();
      const token = await sentToken(page);
      await readyAll(request, token, ['I_PAYE']);
      await page.locator('.ptabs').getByRole('button', { name: tr(lang, 'q.tab') }).click();
      await railEntry(page, token).first().click();
      await expect(page.locator('.tk-drawer--phone .tk-il').first()).toBeVisible();
      await shot(page, info, lang === 'ur' ? 'PhoneTokenUrdu' : 'PhoneToken', lang, { urduFrame: true });
    } finally {
      await leave(page, info, lang);
    }
  });
}

