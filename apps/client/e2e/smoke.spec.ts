import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { E2eHub } from './global-setup';

// W0.7 smoke (Q-32): the hub-served /staff/ entry, paired as a tablet, shows the sign-in names on every viewport.

function hub(): E2eHub {
  const file = process.env['POS_E2E_HUB'];
  if (file === undefined) throw new Error('POS_E2E_HUB is not set: run through playwright.config.ts (globalSetup)');
  return JSON.parse(readFileSync(file, 'utf8')) as E2eHub;
}

/** The pairing store the hub's pair page writes (IndexedDB `pos-device` / `device`), then a reload. */
async function pairAs(page: Page, h: E2eHub): Promise<void> {
  await page.goto(`${h.baseURL}/staff/`);
  await page.evaluate(
    (keys) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pos-device', 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('device')) open.result.createObjectStore('device');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('device', 'readwrite');
          for (const [k, v] of Object.entries(keys)) tx.objectStore('device').put(v, k);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { token: h.device.token, device_id: h.device.device_id, device_type: h.device.device_type },
  );
  await page.reload();
}

test('[02 W0.7] /staff/ sign-in renders', async ({ page }) => {
  const h = hub();
  await pairAs(page, h);
  await expect(page.locator('.pu.staff')).toBeVisible();
  // the fixture directory's people with a PIN, as name tiles
  await expect(page.locator('.who__t').first()).toBeVisible();
});
