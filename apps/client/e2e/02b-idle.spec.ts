import { expect, test, type WebSocketRoute } from '@playwright/test';
import { deviceFor, LANGS, signInOn, signOut, tr } from './02b-support';

// 02b §8 Device idle lock (02-B09; §10 #35 m-9, S-4; owner Q-21) offline: the hub is gone, the person leaves the
// screen; past the idle TTL (Ali's role: 60 min, from the login reply) the first tap shows the lock and does nothing
// else. When the hub is back, the lock's Sign in sends the owed logout and the page offers the names again.

for (const lang of LANGS) {
  test(`[02b §8 Device idle lock] idle lock while offline (${lang})`, async ({ page, context }, info) => {
    await page.clock.install();
    const sockets: WebSocketRoute[] = [];
    await page.routeWebSocket(/\/ws$/, (ws) => {
      ws.connectToServer();
      sockets.push(ws);
    });
    const device = deviceFor(info);
    await signInOn(page, device, lang);
    try {
      await context.setOffline(true);
      for (const ws of sockets) await ws.close({ code: 1006 });
      await page.clock.fastForward('01:01:00');
      // the first tap after the TTL: the lock, nothing else (the person chip / tab is not acted on)
      // a raw tap (no actionability wait: the page's clock is Playwright's)
      await page.mouse.click(5, 300);
      const lock = page.locator('.idle[role="alert"]');
      await expect(lock).toBeVisible();
      await expect(lock).toContainText(tr(lang, 'idle.title', { n: '60' }));
      await context.setOffline(false);
      await lock.getByRole('button', { name: tr(lang, 'alerts.signin.submit') }).click();
      await expect(lock).toHaveCount(0);
      await expect(page.locator(device.device_type === 'phone' ? '.pin__keys' : '.who__t').first()).toBeVisible();
    } finally {
      await context.setOffline(false);
      await signOut(page, info, lang);
    }
  });
}
