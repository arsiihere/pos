import { expect, test, type Page, type TestInfo, type WebSocketRoute } from '@playwright/test';
import { deviceFor, escapeRe, landing, LANGS, menuTile, rushOff, signInOn, signOut, takeawayTab, tr, type Lang } from './02b-support';

// 02b-TK Part A2 batch 1 against the e2e test hub (kiosk 1920×1080 and landscape tablet 1280×800, en + ur).
// Item 1 — the shell (frames ShellAnatomy, PersonMenu, DayNotStarted; MAPPING TK-SH01–03; 05a v1.0.6 C-1):
//   the context slot "New takeaway" / "Token after Send" in the bar, the selected tab (.is-sel), the Live pill; the
//   person chip opens a menu and never signs out on one tap; Switch user (00 HPA v1.12.4 §6.9 takeover) holds the
//   unsent cart first (02b-TK C1-5) and hands the counter to the next person; Lock screen is the idle-lock screen now;
//   the business day of the fixture is open, so no day banner; the shift banner follows 05 v1.0.34 §6.16.
// Ali (order-taker) and the Owner (every permission) are on both devices (02b-tk-handover.spec.ts).
// The shell of the normal layout: seed03's open tokens put the screen in rush mode (R9), so the override is off here
// (02b-support rushOff; rush mode is 02b-tk-tiles.spec.ts's).

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway shell runs at the kiosk and landscape tablet viewports');
  test.setTimeout(60_000);
};
test.beforeEach(async ({ page }) => rushOff(page));

const chip = (page: Page) => page.locator('header.top button.me');
const menu = (page: Page) => page.locator('[role="menu"]');
const menuItem = (page: Page, lang: Lang, key: 'shell.me.switch' | 'shell.me.lock' | 'shell.me.shift' | 'shell.me.signout') =>
  menu(page).locator('[role="menuitem"]', { hasText: tr(lang, key) });

/** The PIN keys of the open pad, then Sign in; resolves once the shell has landed (05a §8 C-1, 02a-support `landing`:
 *  a hash moved before the landing is sent back by it). */
async function typePin(page: Page, pin = '1234'): Promise<void> {
  const pad = page.locator('.pin__keys');
  for (const digit of pin) await pad.locator('.btn', { hasText: new RegExp(`^${digit}$`) }).click();
  const landed = landing(page);
  await pad.locator('.btn--primary').click();
  await landed;
}

for (const lang of LANGS) {
  test(`[02b-TK TK-SH01] the context slot, the selected tab and the Live pill (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      const ctx = page.locator('header.top .tk-ctx');
      // the slot's own line and sub-line (TopBar.tsx): on a tablet the binding header sits in the slot too, with its own <b>
      await expect(ctx.locator(':scope > div > b')).toHaveText(tr(lang, 'ctx.new'));
      await expect(ctx.locator(':scope > div > small')).toHaveText(tr(lang, 'ctx.token_after'));
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
      // Ali's cart was held first: it waits in Held on this counter, by Ali. A held row (frame HeldDrawer, L-CLIENT-6b
      // item 2) names the order and its total, then the item summary: "Takeaway · Rs 30" / "Naan" (one Naan)
      await page.evaluate(() => (window.location.hash = '#/held'));
      const row = page.locator('.tk-held .tk-held__row', { hasText: tr(lang, 'h.by', { name: 'Ali' }) }).first();
      await expect(row).toBeVisible();
      await expect(row.locator('small').first()).toHaveText('Naan');
      await expect(row).toContainText(/Rs\s?30(?![\d,.])/);
    } finally {
      await signOut(page, info, lang);
    }
  });

  // 02b §8 Device idle lock: the lock shows, drains the queue, sends the logout and offers login. With the hub there the
  // logout goes through at once and the hub closes the staff socket (4401), so the page goes straight to the name tiles;
  // the lock screen stays only while the logout is owed (02b-idle.spec.ts): the hub is gone here when Lock is tapped.
  test(`[02b-TK TK-SH02; 02b §8 Device idle lock] Lock screen locks now; its Sign in brings the name tiles (${lang})`, async ({ page, context }, info) => {
    runsHere(info);
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await context.setOffline(true);
      for (const ws of sockets) await ws.close({ code: 1006 });
      await chip(page).click();
      await menuItem(page, lang, 'shell.me.lock').click();
      const lock = page.locator('.idle');
      await expect(lock).toBeVisible();
      await expect(lock.locator('h1')).toHaveText(tr(lang, 'shell.locked'));
      await context.setOffline(false);
      await lock.getByRole('button', { name: tr(lang, 'alerts.signin.submit') }).click();
      await expect(lock).toHaveCount(0);
      await expect(page.locator('.who__t').first()).toBeVisible();
    } finally {
      await context.setOffline(false);
      await signOut(page, info, lang);
    }
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

  // Item 2 — keyboard speed mode (frame KeyboardMode; MAPPING TK-S02). The fixture menu has Naan and Chicken Karahi.
  test(`[02b-TK TK-S02] "/" focuses the search; "4naan" Enter adds 4 Naan; Esc leaves the search; F4 holds (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      const search = page.locator('.menu input[type="search"]');
      await expect(search).toHaveAttribute('placeholder', tr(lang, 'm.search'));
      await page.locator('.cart__head').click(); // the focus on the page, in no field
      await page.keyboard.press('/');
      await expect(search).toBeFocused();
      // "4n" of the frame is the vitest suite's (the fixture menu may hold other n… items): the full word here
      await page.keyboard.type('4naan');
      const first = page.locator('.tk-sugg [role="option"]').first();
      await expect(first).toContainText('4×');
      await expect(first).toContainText('Naan');
      await expect(first).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Enter');
      const line = page.locator('.cart .ln', { hasText: 'Naan' });
      await expect(line).toHaveCount(1);
      await expect(line).toContainText('4');
      await expect(search).toHaveValue('');
      await page.keyboard.type('nan');
      await page.keyboard.press('Escape');
      await expect(search).toHaveValue('');
      await expect(search).not.toBeFocused();
      // F4 holds the cart: a fresh one on the Takeaway tab
      await page.keyboard.press('F4');
      await expect(page.locator('.cart .ln')).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-S02] digits typed in the phone field stay in the phone field, never in the item search (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      const phone = page.locator('.cust input[name="phone"]');
      await phone.click();
      await page.keyboard.type('03001234567');
      await expect(phone).toHaveValue('03001234567');
      await expect(page.locator('.menu input[type="search"]')).toHaveValue('');
      await expect(page.locator('.tk-sugg')).toHaveCount(0);
      // typing on the bare screen goes to the search
      await page.locator('.cart__head').click();
      await page.keyboard.type('4');
      await expect(page.locator('.menu input[type="search"]')).toBeFocused();
      await expect(page.locator('.menu input[type="search"]')).toHaveValue('4');
      await page.keyboard.press('Escape');
      // the phone stays on the cart, not sent: clear it for the next run (the draft is per device and person)
      await phone.fill('');
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK TK-S02] F2 with an unsent cart asks first (Hold it / Throw away / Stay here); the hint row on the kiosk only (${lang})`, async ({ page }, info) => {
    runsHere(info);
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      const hint = page.locator('.menu > .tk-hint');
      if (info.project.name === 'kiosk') {
        await expect(hint).toContainText('F2');
        await expect(hint).toContainText(tr(lang, 'ctx.new'));
        await expect(hint).toContainText(tr(lang, 'shell.back'));
      } else await expect(hint).toHaveCount(0);
      await menuTile(page, 'Naan').click();
      await page.locator('.cart__head').click();
      await page.keyboard.press('F2');
      const guard = page.locator('.dlg[role="dialog"]', { hasText: tr(lang, 'l.title') });
      await expect(guard).toBeVisible();
      await guard.getByRole('button', { name: tr(lang, 'l.discard') }).click();
      await expect(page.locator('.cart .ln')).toHaveCount(0);
      await expect(page).toHaveURL(/#\/takeaway$/);
    } finally {
      await signOut(page, info, lang);
    }
  });
}
