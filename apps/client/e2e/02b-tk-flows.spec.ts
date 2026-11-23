import { expect, test, type Page } from '@playwright/test';
import { hub, LANGS, menuTile, signInOn, signOut, tr, type Lang } from './02b-support';

// 02b-TK C3-5 (CLAUDE.md pipeline 9; docs/plans/02b-tk-plan.md C3-5): the takeaway counter flows on the cashier kiosk
// against the e2e test hub — walk-in Send & pay with cash (C3-1), Send · pay later then pay and hand over (C2-2, C3-1),
// add items to a sent token (C2-3), held drafts shared per device with the contact masked (C2-5, R3).
// The Owner (PIN 1234, every permission) takes the money: the fixture Cashier role has no take-payment and Ali's
// order-taker role neither. A payment needs the Owner's open shift (05 B11): the flows open it once (Starting cash 0).

const kioskOnly = (name: string) => test.skip(name !== 'kiosk', 'the takeaway counter flows run at the kiosk viewport');

/** The kiosk's takeaway screen (KioskHome `#/takeaway`, 05a A-7: its Takeaway chip). */
async function takeaway(page: Page, lang: Lang): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/takeaway'));
  await page.locator('.bchip', { hasText: tr(lang, 'order.takeaway') }).click();
  await expect(page).toHaveURL(/#\/order\/takeaway\//);
}

/** The signed-in person's shift is open (05 §6.15): open it with Starting cash 0, or it already is. */
async function shiftOpen(page: Page, lang: Lang): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/shift'));
  const open = page.getByRole('button', { name: tr(lang, 'billing.shift.open') });
  const title = page.getByText(tr(lang, 'billing.shift.open_title'));
  await page.locator('main').first().waitFor();
  if (await title.isVisible().catch(() => false)) {
    await page.locator('.b5-card input').first().fill('0');
    await open.click();
    await expect(title).toHaveCount(0);
  }
}

/** The token the sent toast names ("57 · sent · ready 1:42 PM"). */
async function sentToken(page: Page): Promise<string> {
  const toast = page.locator('.toast').first();
  await expect(toast).toContainText(/^\s*\d+/);
  const text = (await toast.textContent()) ?? '';
  return /\d+/.exec(text)![0];
}

/** The rail entry of a token (a ready tile or a cooking row). */
const railEntry = (page: Page, token: string) =>
  page.locator('.tk-rt__open', { has: page.locator('.tok', { hasText: new RegExp(`^${token}$`) }) }).or(page.locator('.tk-qr', { has: page.locator('.tk-tok', { hasText: new RegExp(`^${token}$`) }) }));

for (const lang of LANGS) {
  test(`[02b-TK C3-1; 05 §6.9, §6.12] walk-in Send & pay, cash Exact (${lang})`, async ({ page }, info) => {
    kioskOnly(info.project.name);
    await signInOn(page, hub().kiosk, lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeaway(page, lang);
      await menuTile(page, 'Naan').click();
      await page.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'c.send_pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      await expect(panel).toBeVisible();
      // the cart behind is fresh: the next customer's
      await expect(page.locator('.cart .ln')).toHaveCount(0);
      await expect(panel.locator('.tk-pay__due .money')).toHaveText(/Rs \d/);
      await panel.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'p.exact'))}`) }).click();
      await panel.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'p.done'))}`) }).click();
      await expect(panel.getByText(tr(lang, 'p.next'))).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(panel).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  // The e2e hub's clock is fixed and no cook taps Done, so the token never turns ready here: the flow pays later and
  // then from the token view (the bill turns Paid, Take payment goes); the hand-over itself (5 s Undo, MarkServed) is
  // the vitest suite's (token-screen.test.tsx) and the pilot's.
  test(`[02b-TK C2-2, C3-1; R2] Send · pay later, then Take payment from the token view (${lang})`, async ({ page }, info) => {
    kioskOnly(info.project.name);
    await signInOn(page, hub().kiosk, lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeaway(page, lang);
      await menuTile(page, 'Water').click();
      await page.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await railEntry(page, token).first().click();
      const drawer = page.locator('.tk-drawer');
      await expect(drawer.locator('.tk-fact--due')).toBeVisible();
      await drawer.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'v.pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      await expect(panel.locator('.tk-pay__h .tk-tok')).toHaveText(token);
      await panel.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'p.exact'))}`) }).click();
      await page.keyboard.press('Enter');
      await panel.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'p.next'))}`) }).click();
      await railEntry(page, token).first().click();
      await expect(drawer.locator('.tk-fact--paid')).toBeVisible();
      await expect(drawer.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'v.pay'))}`) })).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK C2-3; 02b §3.2] add items to a sent token (${lang})`, async ({ page }, info) => {
    kioskOnly(info.project.name);
    await signInOn(page, hub().kiosk, lang, 'Owner');
    try {
      await takeaway(page, lang);
      await menuTile(page, 'Naan').click();
      await page.getByRole('button', { name: new RegExp(`^${escape(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await railEntry(page, token).first().click();
      await page.locator('.tk-drawer').getByRole('button', { name: tr(lang, 'v.add') }).click();
      await expect(page.locator('.tk-banner')).toContainText(token);
      await menuTile(page, 'Raita').click();
      await page.getByRole('button', { name: `${tr(lang, 'c.add_to')} ${token}` }).click();
      await expect(page.locator('.tk-banner')).toHaveCount(0);
      // the rail joins the addition to the token once open-orders is read again (a live frame): open the token until it shows
      const drawer = page.locator('.tk-drawer');
      await expect(async () => {
        if (await drawer.isVisible()) await drawer.getByRole('button', { name: tr(lang, 'common.close') }).first().click();
        await railEntry(page, token).first().click();
        await expect(drawer.locator('.tk-il', { hasText: 'Raita' })).toBeVisible({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await expect(drawer.locator('.tk-il', { hasText: 'Naan' })).toBeVisible();
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK C2-5; R3] held drafts are shared on the device, the name masked without view-customer-contact (${lang})`, async ({ page }, info) => {
    kioskOnly(info.project.name);
    await signInOn(page, hub().kiosk, lang, 'Owner');
    await takeaway(page, lang);
    await page.locator('.cart input').first().fill('Usman');
    await menuTile(page, 'Naan').click();
    await page.getByRole('button', { name: tr(lang, 'cart.hold') }).click();
    await signOut(page, info, lang);
    await signInOn(page, hub().kiosk, lang);
    try {
      await page.evaluate(() => (window.location.hash = '#/held'));
      const row = page.locator('.ql', { hasText: tr(lang, 'h.by', { name: 'Owner' }) }).first();
      await expect(row).toBeVisible();
      await expect(row).toContainText('U•••');
      await expect(row).not.toContainText('Usman');
      await row.getByRole('button', { name: tr(lang, 'held.resume') }).click();
      await expect(page).toHaveURL(/#\/order\/takeaway\//);
      await expect(page.locator('.cart .ln')).toHaveCount(1);
    } finally {
      await signOut(page, info, lang);
    }
  });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
