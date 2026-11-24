import { expect, test } from '@playwright/test';
import { hub, LANGS, menuTile, railEntry, sendCart, sentToken, signInOn, signOut, takeawayTab, tr } from './02b-support';

// 02b §8 Types, Send; 02b-TK C2-1, C1-3 (frames HomeKiosk, SentToast): on the cashier kiosk the Takeaway tab is the
// order screen in takeaway mode (queue rail | menu | cart). Ali (no take-payment: one Send) → Naan → Send to kitchen:
// the order goes in the background — no Send dialog, no token dialog, a fresh cart at once — and the toast names the
// token the hub gave (only after its 2xx); the token joins the rail.

for (const lang of LANGS) {
  test(`[02b §8 Types; 02b-TK C2-1, C1-3] takeaway on the kiosk: Takeaway tab, background Send, token toast (${lang})`, async ({ page }, info) => {
    test.skip(info.project.name !== 'kiosk', 'the cashier kiosk flow runs at the kiosk viewport');
    await signInOn(page, hub().kiosk, lang);
    try {
      await takeawayTab(page);
      await expect(page.locator('.osc--tk > .tk-q')).toBeVisible();
      await menuTile(page, 'Naan').click();
      await expect(page.locator('.cart .ln')).toHaveCount(1);
      await sendCart(page, lang);
      const token = await sentToken(page);
      expect(Number(token)).toBeGreaterThan(0);
      await expect(page.locator('.toast').first()).toContainText(tr(lang, 't.sent'));
      // no dialog (the removed Send / token dialogs), the cart is fresh, the screen stays the Takeaway tab
      await expect(page.locator('.dlg[role="dialog"]')).toHaveCount(0);
      await expect(page.locator('.token')).toHaveCount(0);
      await expect(page.locator('.cart .ln')).toHaveCount(0);
      await expect(page).toHaveURL(/#\/takeaway$/);
      await expect(railEntry(page, token).first()).toBeVisible();
    } finally {
      await signOut(page, info, lang);
    }
  });
}
