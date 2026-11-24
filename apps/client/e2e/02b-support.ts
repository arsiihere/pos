import { expect, type Page, type TestInfo } from '@playwright/test';
import { dialog, hub, isPhone, pairAs, sheet, tapTile, tr, type Lang } from './02a-support';
import type { E2eDevice } from './global-setup';

// 02b flows (task 28; 02b §8, §10 #35, #36): helpers on top of 02a's. The fixture menu is the hub's 02b test menu
// (apps/hub/test/orders/fixtures.ts fixtureMenu: Naan, Cola, Chicken Karahi …), the business day is open.

export * from './02a-support';

export const isKioskRun = (info: TestInfo): boolean => info.project.name === 'kiosk';

/** The device a run uses for "its" screen: the kiosk viewport runs the cashier kiosk, phones run Ali's phone. */
export function deviceFor(info: TestInfo): E2eDevice {
  const h = hub();
  if (info.project.name === 'kiosk') return h.kiosk;
  if (info.project.name.startsWith('phone')) return h.phone;
  return h.device;
}

/** The phone signs its owner in at once (one name: the PIN pad is open). */
export async function signInOn(page: Page, device: E2eDevice, lang: Lang, name = 'Ali', pin = '1234'): Promise<void> {
  await pairAs(page, device, lang);
  const pad = page.locator('.pin__keys');
  if (device.device_type !== 'phone') await page.locator('.who__t', { hasText: name }).click();
  const enter = async () => {
    for (const digit of pin) await pad.locator('.btn', { hasText: new RegExp(`^${digit}$`) }).click();
    await pad.locator('.btn--primary').click();
  };
  await enter();
  const taken = page.locator('.pin__err');
  await Promise.race([pad.waitFor({ state: 'detached' }), taken.waitFor({ state: 'visible' })]);
  if (await taken.isVisible()) await enter();
  await expect(pad).toHaveCount(0);
}

/** A menu tile of the order screen (02-S05), by the item's name. */
export const menuTile = (page: Page, name: string) => page.locator(`.mi[aria-label="${name}"]`);

/** Seat the table and open its order screen (Take order). */
export async function openOrder(page: Page, lang: Lang, table: string): Promise<void> {
  // the kiosk lands on its home (#/): the map first
  if (!/#\/tables/.test(page.url())) await page.evaluate(() => (window.location.hash = '#/tables'));
  await tapTile(page, table);
  await sheet(page).getByRole('button', { name: tr(lang, 'sheet.take_order') }).click();
  await expect(page).toHaveURL(/#\/order\/dine_in\//);
}

/**
 * A new takeaway or parking order (02-S04): a takeaway on the Takeaway tab, which is the order screen in takeaway mode
 * on every device (02b-TK C2-1: kiosk, tablet, phone); a parking order from the map's New order (02a IR-5 → 02b's New
 * order sheet), the plate + Sedan.
 */
export async function newOrder(page: Page, lang: Lang, info: TestInfo, type: 'takeaway' | 'parking', plate = 'LEA 123'): Promise<void> {
  if (type === 'takeaway') {
    await page.evaluate(() => (window.location.hash = '#/takeaway'));
    await expect(page.locator('.order').first()).toBeVisible();
    await expect(page).toHaveURL(/#\/takeaway$/);
    return;
  }
  if (isKioskRun(info)) await page.evaluate(() => (window.location.hash = '#/tables'));
  const bar = isPhone(info) ? page.locator('.phbar') : page.locator('main.map');
  await bar.getByRole('button', { name: tr(lang, 'order.new') }).click();
  await dialog(page).locator('.bchip', { hasText: tr(lang, `order.${type}`) }).click();
  await dialog(page).locator('input.inp--plate').fill(plate);
  await dialog(page).locator('.bchip', { hasText: tr(lang, 'order.parking.sedan') }).click();
  await dialog(page).getByRole('button', { name: tr(lang, 'order.takeaway.next') }).click();
  await expect(page).toHaveURL(new RegExp(`#/order/${type}/`));
}

/** Send the cart (on a phone the cart is its own tab). */
export async function sendCart(page: Page, lang: Lang): Promise<void> {
  const send = page.getByRole('button', { name: new RegExp(`^(${tr(lang, 'cart.send')}|${tr(lang, 'cart.send_short')})`) }).first();
  if (!(await send.isVisible())) await page.getByRole('button', { name: new RegExp(`^${tr(lang, 'order.tab.cart')}`) }).click();
  await send.click();
}

// ------------------------------------------------------------------------------------------------- the counter (02b-TK)

/** A text as a RegExp source. */
export function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The Takeaway tab (`#/takeaway`, 05a A-7): the order screen itself — rail, menu, cart (02b-TK C2-1). */
export async function takeawayTab(page: Page): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/takeaway'));
  await expect(page.locator('.osc--tk')).toBeVisible();
  await expect(page).toHaveURL(/#\/takeaway$/);
}

/** The signed-in person's shift is open (05 §6.15): open it with Starting cash 0, or it already is. */
export async function shiftOpen(page: Page, lang: Lang): Promise<void> {
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
export async function sentToken(page: Page): Promise<string> {
  const toast = page.locator('.toast').first();
  await expect(toast).toContainText(/^\s*\d+/);
  const text = (await toast.textContent()) ?? '';
  return /\d+/.exec(text)![0];
}

/** The rail entry of a token (a ready tile or a cooking row). */
export const railEntry = (page: Page, token: string) =>
  page.locator('.tk-rt__open', { has: page.locator('.tok', { hasText: new RegExp(`^${token}$`) }) }).or(page.locator('.tk-qr', { has: page.locator('.tk-tok', { hasText: new RegExp(`^${token}$`) }) }));

/** The ready tile of a token (02b-TK C2-1, frame ReadyTiles). */
export const readyTile = (page: Page, token: string) => page.locator('.tk-rt', { has: page.locator('.tok', { hasText: new RegExp(`^${token}$`) }) });
