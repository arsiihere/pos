import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type TestInfo } from '@playwright/test';
import { hub, rushOff, shiftOpen, signInOn, signOut, takeawayTab, type Lang } from '../02b-support';

// 02b-TK L-CLIENT-6b build shots: helpers of the shots specs (demo hub, e2e/shots/demo-setup.ts).

export const SHOTS = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/design/handoff/02b-tk/build-shots');

export const isPhoneRun = (info: TestInfo) => info.project.name === '390';

/** `<Frame>-<size>.png`; an Urdu capture of an English frame is `<Frame>-Urdu-<size>.png`. */
export async function shot(page: Page, info: TestInfo, frame: string, lang: Lang, o: { urduFrame?: boolean } = {}): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(250);
  mkdirSync(SHOTS, { recursive: true });
  const name = `${frame}${lang === 'ur' && o.urduFrame !== true ? '-Urdu' : ''}-${info.project.name}.png`;
  await page.screenshot({ path: join(SHOTS, name) });
}

/** The demo hub's clock moves `ms` forward (demo-setup reads the request file). */
export async function advanceHub(ms: number): Promise<void> {
  const file = process.env['POS_SHOTS_CLOCK'];
  if (file === undefined) throw new Error('no POS_SHOTS_CLOCK');
  writeFileSync(file, String(ms));
  await new Promise((r) => setTimeout(r, 900));
}

/** Sana at the counter: the kiosk on a desktop size, her phone at 390. */
export async function counter(page: Page, info: TestInfo, lang: Lang): Promise<void> {
  await rushOff(page);
  const phone = isPhoneRun(info);
  await signInOn(page, phone ? hub().phone : hub().kiosk, lang, 'Sana');
  if (!phone) await shiftOpen(page, lang);
  await takeawayTab(page);
  // the sign-in's toasts leave before a capture
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
}

export async function leave(page: Page, info: TestInfo, lang: Lang): Promise<void> {
  await signOut(page, info, lang);
}

/** The menu category of the takeaway screen, then the item tile by its (base) name. */
export async function tile(page: Page, category: string, name: string) {
  await page.locator('.cats button, .tk-cats button, [role="tablist"] button, .rail button').filter({ hasText: new RegExp(`^${category}`) }).first().click();
  return page.locator('.mi').filter({ hasText: name }).first();
}
