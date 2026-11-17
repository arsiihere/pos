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
 * A new takeaway or parking order (02-S04): the kiosk's home buttons; elsewhere the map's New order (02a IR-5 → 02b's
 * New order sheet), the takeaway contact step skipped, the parking plate + Sedan.
 */
export async function newOrder(page: Page, lang: Lang, info: TestInfo, type: 'takeaway' | 'parking', plate = 'LEA 123'): Promise<void> {
  if (isKioskRun(info) && type === 'takeaway') {
    await page.locator('.bchip', { hasText: tr(lang, 'order.takeaway') }).click();
  } else {
    if (isKioskRun(info)) await page.evaluate(() => (window.location.hash = '#/tables'));
    const bar = isPhone(info) ? page.locator('.phbar') : page.locator('main.map');
    await bar.getByRole('button', { name: tr(lang, 'order.new') }).click();
    await dialog(page).locator('.bchip', { hasText: tr(lang, `order.${type}`) }).click();
    if (type === 'takeaway') {
      await dialog(page).getByRole('button', { name: tr(lang, 'order.takeaway.skip') }).click();
    } else {
      await dialog(page).locator('input.inp--plate').fill(plate);
      await dialog(page).locator('.bchip', { hasText: tr(lang, 'order.parking.sedan') }).click();
      await dialog(page).getByRole('button', { name: tr(lang, 'order.takeaway.next') }).click();
    }
  }
  await expect(page).toHaveURL(new RegExp(`#/order/${type}/`));
}

/** Send the cart (on a phone the cart is its own tab). */
export async function sendCart(page: Page, lang: Lang): Promise<void> {
  const send = page.getByRole('button', { name: new RegExp(`^(${tr(lang, 'cart.send')}|${tr(lang, 'cart.send_short')})`) }).first();
  if (!(await send.isVisible())) await page.getByRole('button', { name: new RegExp(`^${tr(lang, 'order.tab.cart')}`) }).click();
  await send.click();
}
