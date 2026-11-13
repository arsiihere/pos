import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { en } from '../src/i18n/en';
import { ur } from '../src/i18n/ur';
import { tablePair, type E2eDevice, type E2eHub, type Flow } from './global-setup';

// 02a flows (§12.1 "§8 flows pass on a tablet and a phone"): shared helpers. One hub serves the whole run, so every
// (flow, viewport, language) run takes its own two tables from the pool and signs its people out at the end.

export type Lang = 'en' | 'ur';
export const LANGS: readonly Lang[] = ['en', 'ur'];
export const PIN_ALI = '1234';

export function hub(): E2eHub {
  const file = process.env['POS_E2E_HUB'];
  if (file === undefined) throw new Error('POS_E2E_HUB is not set: run through playwright.config.ts (globalSetup)');
  return JSON.parse(readFileSync(file, 'utf8')) as E2eHub;
}

/** The app's own words, so a spec asserts on the language it runs in. */
export function tr(lang: Lang, key: keyof typeof en, values: Record<string, string> = {}): string {
  const text = lang === 'ur' ? (ur[key] ?? en[key]) : en[key];
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => values[name] ?? whole);
}

export type { Flow };

/** Two tables nobody else uses (see `tablePair`). */
export function myTables(flow: Flow, info: TestInfo, lang: Lang): [string, string] {
  return tablePair(flow, info.project.name, lang);
}

export const floorOfTable = (table: string): string => (table.startsWith('R') ? 'FL-R' : 'FL-G');

export const isPhone = (info: TestInfo): boolean => info.project.name.startsWith('phone');

/** The pairing store the hub's pair page writes (IndexedDB `pos-device` / `device`), then the app in `lang`. */
export async function pairAs(page: Page, device: E2eDevice, lang: Lang): Promise<void> {
  const base = hub().baseURL;
  await page.goto(`${base}/staff/?lang=${lang}`);
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
  await page.goto(`${base}/staff/?lang=${lang}`);
  await page.reload();
}

/** Name tile, then the PIN keys, then Sign in. Resolves when the sign-in screen is gone and the map is up. A session a
 * run left on this device asks for the PIN again to take over (DEVICE_SESSION_ACTIVE): it is typed once more. */
export async function signIn(page: Page, name: string, pin: string = PIN_ALI): Promise<void> {
  const enter = async () => {
    for (const digit of pin) await page.locator('.pin__keys .btn', { hasText: new RegExp(`^${digit}$`) }).click();
    await page.locator('.pin__keys .btn--primary').click();
  };
  await page.locator('.who__t', { hasText: name }).click();
  await enter();
  const gone = page.locator('.who__t').first();
  const taken = page.locator('.pin__err');
  await Promise.race([gone.waitFor({ state: 'detached' }), taken.waitFor({ state: 'visible' })]);
  if (await taken.isVisible()) await enter();
  await expect(page.locator('.who__t')).toHaveCount(0);
  await expect(page.locator('.tt').first()).toBeVisible();
}

/** Best effort: the person leaves, so the next run finds the name list (the hub keeps one session per device). */
export async function signOut(page: Page, info: TestInfo, lang: Lang): Promise<void> {
  try {
    if (isPhone(info)) {
      await page.evaluate(() => {
        window.location.hash = '#/me';
      });
      await page.getByRole('button', { name: tr(lang, 'alerts.sign_out_short') }).click({ timeout: 3000 });
    } else {
      await page.locator('header.top .me').click({ timeout: 3000 });
    }
  } catch {
    // the page may already be closed or signed out
  }
}

/** Open the map at the table's floor (the hash the floor control writes), then the table's tile. */
export function tile(page: Page, table: string): Locator {
  // a joined party's tile is named "A + B"
  return page.getByRole('button', { name: new RegExp(`^(\\S+ \\+ )?${table}( \\+ \\S+)?(,|$)`) }).first();
}

export async function goFloorOf(page: Page, table: string): Promise<void> {
  // the map has drawn (its first tiles) before the floor is chosen, so the choice is not lost to the first load
  await page.locator('.tt').first().waitFor();
  await page.evaluate((id) => {
    window.location.hash = `#/tables?floor=${id}`;
  }, floorOfTable(table));
}

export async function tapTile(page: Page, table: string): Promise<void> {
  await goFloorOf(page, table);
  const t = tile(page, table);
  await t.scrollIntoViewIfNeeded();
  await t.click();
}

export const sheet = (page: Page): Locator => page.locator('section.tv[role="dialog"]');
export const dialog = (page: Page): Locator => page.locator('.dlg[role="dialog"]');

/** Seat the table as the signed-in person: tap, "Take order", the order screen (02b stub) opens, back to the map. */
export async function takeOrder(page: Page, lang: Lang, table: string): Promise<void> {
  await tapTile(page, table);
  await sheet(page).getByRole('button', { name: tr(lang, 'sheet.take_order') }).click();
  await expect(page).toHaveURL(/#\/order\/dine_in\//);
  await page.goBack();
  await expect(page).toHaveURL(/#\/tables/);
}

/** One of the sheet's actions: straight from the grid, else through "More". */
export async function sheetAct(page: Page, lang: Lang, key: 'sheet.act.hand' | 'sheet.act.move' | 'sheet.act.join' | 'sheet.act.split' | 'sheet.act.call' | 'sheet.act.bill' | 'sheet.mark_clean', values: Record<string, string> = {}): Promise<void> {
  const button = sheet(page).getByRole('button', { name: tr(lang, key, values) });
  if ((await button.count()) === 0) {
    await sheet(page).getByRole('button', { name: tr(lang, 'sheet.act.more') }).click();
  }
  await button.click();
}
