import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { deviceFor, escapeRe, LANGS, menuTile, signInOn, signOut, takeawayTab, tr, type Lang } from './02b-support';

// 02b-TK Part A2 batch 1 against the e2e test hub (kiosk 1920×1080 and landscape tablet 1280×800, en + ur).
// Item 1 — the shell (frames ShellAnatomy, PersonMenu, DayNotStarted; MAPPING TK-SH01–03; 05a v1.0.6 C-1):
//   the context slot "New takeaway" / "Token after Send" in the bar, the selected tab (.is-sel), the Live pill; the
//   person chip opens a menu and never signs out on one tap; Switch user (00 HPA v1.12.4 §6.9 takeover) holds the
//   unsent cart first (02b-TK C1-5) and hands the counter to the next person; Lock screen is the idle-lock screen now;
//   the business day of the fixture is open, so no day banner; the shift banner follows 05 v1.0.34 §6.16.
// Ali (order-taker) and the Owner (every permission) are on both devices (02b-tk-handover.spec.ts).

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway shell runs at the kiosk and landscape tablet viewports');
  test.setTimeout(60_000);
};

const chip = (page: Page) => page.locator('header.top button.me');
const menu = (page: Page) => page.locator('[role="menu"]');
const menuItem = (page: Page, lang: Lang, key: 'shell.me.switch' | 'shell.me.lock' | 'shell.me.shift' | 'shell.me.signout') =>
  menu(page).locator('[role="menuitem"]', { hasText: tr(lang, key) });

/** The PIN keys of the open pad, then Sign in. */
async function typePin(page: Page, pin = '1234'): Promise<void> {
  const pad = page.locator('.pin__keys');
  for (const digit of pin) await pad.locator('.btn', { hasText: new RegExp(`^${digit}$`) }).click();
  await pad.locator('.btn--primary').click();
}

for (const lang of LANGS) {
  test(`[02b-TK TK-SH01] the context slot, the selected tab and the Live pill (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      const ctx = page.locator('header.top .tk-ctx');
      await expect(ctx.locator('b')).toHaveText(tr(lang, 'ctx.new'));
      await expect(ctx.locator('small')).toHaveText(tr(lang, 'ctx.token_after'));
      await expect(page.locator('header.top nav.tabs-top a.is-sel')).toHaveAttribute('href', '#/takeaway');
      await expect(page.locator('header.top nav.tabs-top a.is-sel')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('header.top .live.tk-live')).toHaveText(tr(lang, 'alerts.live'));
      // the fixture's business day is open: no "Day not started" banner
      await expect(page.locator('.tk-banner', { hasText: tr(lang, 'shell.day.closed') })).toHaveCount(0);
      // the slot belongs to the takeaway screen: another screen has the brand block again
      await page.evaluate(() => (window.location.hash = '#/inbox'));
      await expect(page.locator('header.top .tk-ctx')).toHaveCount(0);
      await expect(page.locator('header.top .brand')).toBeVisible();
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-SH02] the person chip opens a menu; one tap never signs out; Escape closes it (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await chip(page).click();
      await expect(menu(page)).toBeVisible();
      await expect(chip(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(menuItem(page, lang, 'shell.me.switch')).toContainText(tr(lang, 'shell.me.switch_sub'));
      await expect(menuItem(page, lang, 'shell.me.lock')).toContainText(tr(lang, 'shell.me.lock_sub'));
      await expect(menuItem(page, lang, 'shell.me.signout')).toContainText(tr(lang, 'shell.me.signout_sub'));
      // still signed in: the name tiles are not back
      await expect(page.locator('.who__t')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu(page)).toHaveCount(0);
      await expect(page.locator('.osc--tk')).toBeVisible();
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-SH02; 00 HPA §6.9 M20] Switch user holds the unsent cart, then the next person takes the counter over (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await menuTile(page, 'Naan').click();
      await expect(page.locator('.cart .ln')).toHaveCount(1);
      await chip(page).click();
      await menuItem(page, lang, 'shell.me.switch').click();
      // the tiles over the signed-in page, with Back
      await expect(page.locator('.signin__switch')).toBeVisible();
      await page.locator('.who__t', { hasText: 'Owner' }).click();
      await typePin(page);
      await expect(page.locator('.pin__keys')).toHaveCount(0);
      await expect(chip(page)).toContainText('Owner');
      // Ali's cart was held first: it waits in Held on this counter, by Ali
      await page.evaluate(() => (window.location.hash = '#/held'));
      const row = page.locator('.ql', { hasText: tr(lang, 'h.by', { name: 'Ali' }) }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('Naan');
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-SH02; 02b §8 Device idle lock] Lock screen locks now; its Sign in brings the name tiles (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    await takeawayTab(page);
    await chip(page).click();
    await menuItem(page, lang, 'shell.me.lock').click();
    const lock = page.locator('.idle');
    await expect(lock).toBeVisible();
    await expect(lock.locator('h1')).toHaveText(tr(lang, 'shell.locked'));
    await lock.getByRole('button', { name: tr(lang, 'alerts.signin.submit') }).click();
    await expect(page.locator('.who__t').first()).toBeVisible();
  });

  test(`[02b-TK TK-SH01; 05 §6.16] the Owner's shift: the banner with Open my shift when none is open, else My shift says when it opened (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await takeawayTab(page);
      const banner = page.locator('.tk-banner', { hasText: tr(lang, 'shell.shift.closed') });
      await chip(page).click();
      const shift = menuItem(page, lang, 'shell.me.shift');
      await expect(shift).toBeVisible();
      if ((await banner.count()) > 0) {
        await expect(shift).toContainText(tr(lang, 'shell.shift.closed'));
        await page.keyboard.press('Escape');
        await banner.getByRole('button', { name: tr(lang, 'shell.shift.open') }).click();
        await expect(page).toHaveURL(/#\/shift$/);
      } else {
        // "Opened {time} · float {money}": its fixed words, the time and the money between them
        for (const word of tr(lang, 'shell.me.shift_open').split(/\{\w+\}/).map((w) => w.trim()).filter((w) => w !== '')) await expect(shift).toContainText(word);
        await expect(shift).toContainText(new RegExp(`\\d{1,2}:\\d{2}.*${escapeRe('Rs')}`));
      }
    } finally {
      await signOut(page, info, lang);
    }
  });
}
