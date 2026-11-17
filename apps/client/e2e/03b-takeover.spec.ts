import { expect, test } from '@playwright/test';
import { hub, pairKdsScreen, runStation, tr, type Lang } from './03b-support';

// 03b v1.0.8 §8, #72; 00 v1.9.2 §8.4 (M53): a second window of the same screen takes the station session. The first
// window stops ("This screen is open in another window", close 4401 `replaced`); only a tap on "Use this window" takes
// it back, and then the other window is the one that stops. KDS is English only; runs at 1920 and 1280.

for (const lang of ['en', 'ur'] as Lang[]) {
  test(`[03b §8, #72; 00 §8.4 M53 @combined] a second window takes the station session; Use this window takes it back (${lang})`, async ({ page, request, browser }, info) => {
    test.skip(!['kiosk', 'tablet-landscape'].includes(info.project.name), 'KDS runs at 1920 and 1280');
    await pairKdsScreen(page, request, runStation('takeover', info, lang), lang);
    await expect(page.locator('article.kl')).toHaveCount(3);

    // the pairing keys the first window holds go into a second browser profile: the same screen, another window
    const keys = await page.evaluate(
      () =>
        new Promise<Record<string, string>>((resolve) => {
          const open = indexedDB.open('pos-device', 1);
          open.onsuccess = () => {
            const store = open.result.transaction('device').objectStore('device');
            const out: Record<string, string> = {};
            const all = store.openCursor();
            all.onsuccess = () => {
              const c = all.result;
              if (c === null) return resolve(out);
              out[String(c.key)] = String(c.value);
              c.continue();
            };
          };
        }),
    );
    const context = await browser.newContext({ ...info.project.use });
    const second = await context.newPage();
    try {
      await second.goto(`${hub().baseURL}/kds/`);
      await second.evaluate(
        (k) =>
          new Promise<void>((resolve) => {
            const open = indexedDB.open('pos-device', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('device');
            open.onsuccess = () => {
              const tx = open.result.transaction('device', 'readwrite');
              for (const [key, value] of Object.entries(k)) tx.objectStore('device').put(value, key);
              tx.oncomplete = () => resolve();
            };
          }),
        { token: keys['token']!, device_id: keys['device_id']!, device_type: keys['device_type']! },
      );
      await second.reload();
      await expect(second.locator('article.kl')).toHaveCount(3);

      // the first window was replaced: its rows are gone, one button takes the session back
      await expect(page.getByText(tr('en', 'kds.replaced'))).toBeVisible();
      await expect(page.locator('article.kl')).toHaveCount(0);
      await page.getByRole('button', { name: tr('en', 'kds.use_this_window') }).click();
      await expect(page.locator('article.kl')).toHaveCount(3);
      await expect(second.getByText(tr('en', 'kds.replaced'))).toBeVisible();
    } finally {
      await context.close();
    }
  });
}
