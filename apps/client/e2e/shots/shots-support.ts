import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { hub, kitchenSession, rushOff, shiftOpen, signInOn, signOut, takeawayTab, type Lang } from '../02b-support';

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
  await page.locator('.cats button, .pills .pill, .tk-cats button').filter({ hasText: new RegExp(`^${category}`) }).first().click();
  return page.locator('.mi').filter({ hasText: name }).first();
}

/** The kitchen makes every line of a token ready (as 02b-support kitchenReady, for any number of lines per item). */
export async function readyAll(request: APIRequestContext, token: string, only?: readonly string[]): Promise<void> {
  const reader = await kitchenSession(request, 'S_OWNER');
  const lines: Array<{ order_id: string; order_item_id: string; item_id: string | null; stage: string | null; fired: boolean; line_kind: string }> = [];
  try {
    const { orders } = await reader.query<{ orders: Array<{ order_id: string; token: number | null }> }>('open-orders?order_type=takeaway');
    for (const o of orders.filter((x) => String(x.token) === token)) {
      const view = await reader.query<{ lines: Array<{ order_item_id: string; item_id: string | null; stage: string | null; fired: boolean; line_kind: string }> }>(`order-view?order_id=${encodeURIComponent(o.order_id)}`);
      for (const l of view.lines) if (only === undefined || (l.item_id !== null && only.includes(l.item_id))) lines.push({ ...l, order_id: o.order_id });
    }
  } finally {
    await reader.close();
  }
  const cook = await kitchenSession(request, 'S_COOK');
  try {
    for (const l of lines.filter((x) => x.fired && x.stage !== 'done' && x.stage !== 'served')) {
      if (l.stage === 'added') await cook.command('StartItem', { order_item_id: l.order_item_id });
      await cook.command('DoneItem', { order_item_id: l.order_item_id, confirm: true });
    }
    // Bag ready at the Pass (03b §6.6) with every chosen line: the counter's ready time (`ready_at`) starts there
    const bag = lines.filter((l) => l.line_kind !== 'deal' && l.stage !== 'served' && l.stage !== 'removed' && l.stage !== 'voided');
    for (const order_id of new Set(bag.map((l) => l.order_id))) {
      const ids = bag.filter((l) => l.order_id === order_id).map((l) => l.order_item_id);
      const res = await cook.command('MarkReadyToServe', { order_id, point_id: 'P1', order_item_ids: ids });
      expect(res.status, `MarkReadyToServe: ${res.text}`).toBe(200);
    }
  } finally {
    await cook.close();
  }
}
