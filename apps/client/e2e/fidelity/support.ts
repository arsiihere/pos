import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type WebSocketRoute } from '@playwright/test';
import type { DemoDevice, DemoHub } from './demo-hub';

export const SHOTS = fileURLToPath(new URL('../../../../docs/design/handoff/02b-tk/build-shots/', import.meta.url));

export function demo(which: 'busy' | 'empty'): DemoHub {
  const file = process.env['POS_FIDELITY'];
  if (file === undefined) throw new Error('run with playwright.fidelity.config.ts');
  return (JSON.parse(readFileSync(file, 'utf8')) as Record<string, DemoHub>)[which]!;
}

export const SIZES = { '1920': { width: 1920, height: 1080 }, '1366': { width: 1366, height: 768 }, '1280': { width: 1280, height: 800 }, '390': { width: 390, height: 844 } } as const;
export type Size = keyof typeof SIZES;

/** Pair the page as `device` of `h`, sign Sana in, open the Takeaway tab. */
export async function openTakeaway(page: Page, h: DemoHub, device: DemoDevice, o: { rush?: 'on' | 'off'; lang?: 'en' | 'ur' } = {}): Promise<void> {
  const lang = o.lang ?? 'en';
  // the live socket through the page, so a capture can drop it (the hub "goes away"), as the 02b-TK e2e do
  const sockets: WebSocketRoute[] = [];
  const state = { down: false };
  LINKS.set(page, { sockets, state });
  await page.routeWebSocket(/\/ws$/, (ws) => {
    if (state.down) return void ws.close({ code: 1006 });
    ws.connectToServer();
    sockets.push(ws);
  });
  await page.addInitScript((rush) => {
    try {
      window.localStorage.setItem('pos.tk.rush', rush);
    } catch {
      // storage blocked
    }
  }, o.rush ?? 'off');
  await page.goto(`${h.baseURL}/staff/?lang=${lang}`);
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
    { token: device.token, device_id: device.device_id, device_type: device.device_type },
  );
  await page.goto(`${h.baseURL}/staff/?lang=${lang}`);
  await page.reload();
  if (device.device_type !== 'phone') await page.locator('.who__t', { hasText: 'Sana' }).click();
  const pad = page.locator('.pin__keys');
  for (const digit of '1234') await pad.locator('.btn', { hasText: new RegExp(`^${digit}$`) }).click();
  await pad.locator('.btn--primary').click();
  await expect(pad).toHaveCount(0);
  await page.waitForTimeout(800);
  await page.evaluate(() => (window.location.hash = '#/takeaway'));
  await expect(page.locator('.osc--tk, .order--tk-phone')).toBeVisible();
  await page.waitForTimeout(800);
}

const LINKS = new WeakMap<Page, { sockets: WebSocketRoute[]; state: { down: boolean } }>();

/** The hub goes away: the browser is offline and the live socket drops (and cannot come back). */
export async function hubDown(page: Page): Promise<void> {
  const link = LINKS.get(page);
  await page.context().setOffline(true);
  if (link !== undefined) {
    link.state.down = true;
    for (const ws of link.sockets) await ws.close({ code: 1006 }).catch(() => undefined);
  }
  await page.waitForTimeout(1500);
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
}

export const tile = (page: Page, name: string) => page.locator(`.mi[aria-label="${name}"]`);
