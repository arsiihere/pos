import { expect, test, type Page } from '@playwright/test';
import { hub, isPhone, PIN_MANAGER, runKey, tr, type Lang } from './03b-support';

// 03b v1.0.8 §3.8, §6.9, §8 (Q-43, Q-54) and 03c v1.0.9 §3.2, §8 (Z1): the two hub admin pages, on a laptop (1280) and a
// phone (390), in en and ur. Kitchen screens: sign in, the station's screen row, a lane label, the volume. Printers: the
// fake LAN printer (a real TCP socket on loopback), Test print, add (a private address) and refuse (loopback), archive.

const RUNS = ['tablet-landscape', 'phone-390'];

async function signInAdmin(page: Page, path: string, lang: Lang): Promise<void> {
  const h = hub();
  // the pairing store the pair page writes, then the page
  await page.goto(`${h.baseURL}${path}?lang=${lang}`);
  await page.evaluate(
    (keys) =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('pos-device', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('device');
        open.onsuccess = () => {
          const tx = open.result.transaction('device', 'readwrite');
          for (const [k, v] of Object.entries(keys)) tx.objectStore('device').put(v, k);
          tx.oncomplete = () => resolve();
        };
      }),
    { token: h.device.token, device_id: h.device.device_id, device_type: 'tablet' },
  );
  await page.reload();
  await page.locator('.pos-staff__tile', { hasText: 'Manager' }).click();
  for (const digit of PIN_MANAGER) await page.locator('.pos-pin__keys .pos-pin__key', { hasText: new RegExp(`^${digit}$`) }).click();
  await page.locator('.pos-pin__key--fn').last().click();
}

for (const lang of ['en', 'ur'] as Lang[]) {
  test(`[03b §3.8, §6.9, §8 Q-43] kitchen screens: station row, lane label, volume (${lang})`, async ({ page }, info) => {
    test.skip(!RUNS.includes(info.project.name), 'admin runs on a laptop and a phone');
    const key = runKey('admin', info, lang);
    await signInAdmin(page, '/admin/kitchen-screens/', lang);
    await expect(page.locator('h2', { hasText: tr(lang, 'kitchen_screens.stations') })).toBeVisible();
    // laptop: the hub admin side-nav; phone: only the page's own app bar
    await expect(page.locator('.pos-sidenav')).toHaveCount(isPhone(info) ? 0 : 1);

    const station = page.locator('article.ks', { hasText: `Grill ${key}` });
    await expect(station.locator('.scr', { hasText: `Screen ${key}` })).toBeVisible();
    await expect(station.getByText(tr(lang, 'kitchen_screens.state.offline')).first()).toBeVisible();

    // lane label: SetDeviceRole through the dialog, then "Lane: Left" on the row
    await station.getByRole('button', { name: tr(lang, 'kitchen_screens.lane_label') }).click();
    await page.locator('.pos-dialog input.pos-input').fill('Left');
    await page.locator('.pos-dialog').getByRole('button', { name: tr(lang, 'kitchen_screens.save') }).click();
    await expect(page.locator('.pos-dialog')).toHaveCount(0);
    await expect(station.locator('.scr strong')).toHaveText('Left');

    // volume: a key press on the slider saves it (SetStationScreen), then the toast
    const slider = station.locator('input.vol__t');
    await slider.focus();
    await slider.press('ArrowRight');
    await expect(page.locator('.ad-toast')).toBeVisible();
  });

  test(`[03c §3.2, §8] printers: the fake printer, Test print, add, refuse a loopback address, archive (${lang})`, async ({ page }, info) => {
    test.skip(!RUNS.includes(info.project.name), 'admin runs on a laptop and a phone');
    const key = runKey('admin', info, lang);
    await signInAdmin(page, '/admin/printers/', lang);
    const fake = page.locator('article.pr', { hasText: 'Kitchen printer' });
    await expect(fake).toBeVisible();
    await expect(fake).toContainText(hub().printer_address);

    // Test print: the real transport to the fake printer; its status answer is "Ready"
    await fake.getByRole('button', { name: tr(lang, 'printers.test') }).click();
    await expect(fake.locator('.tres')).toContainText(tr(lang, 'printers.test_ok'), { timeout: 20_000 });

    // add: a loopback address is refused on the form (private IPv4 only), a private one is saved
    const name = `Pass ${key}`;
    await page.getByRole('button', { name: tr(lang, 'printers.add') }).first().click();
    const dialog = page.locator('.pos-dialog');
    await dialog.locator('input.pos-input').first().fill(name);
    await dialog.locator('input.pos-input--mono').fill('127.0.0.1:9100');
    await dialog.getByRole('button', { name: tr(lang, 'kitchen_screens.save') }).click();
    await expect(dialog.locator('.pos-field__error')).toContainText(tr(lang, 'printers.address_error_lan'));
    await dialog.locator('input.pos-input--mono').fill('192.168.1.50:9100');
    await dialog.getByRole('button', { name: tr(lang, 'kitchen_screens.save') }).click();
    await expect(dialog).toHaveCount(0);
    const added = page.locator('article.pr', { hasText: name });
    await expect(added).toContainText('192.168.1.50:9100');

    // archive: the card's "more" menu, the confirm; the printer leaves the list (kept as Archived)
    await added.getByRole('button', { name: tr(lang, 'common.more_for', { name }) }).click();
    // The card's menu opens off screen (shared `.pos-menu` is `position: absolute; top: calc(100% - 8px)` and the card has
    // no positioned parent: y < 0 at 1280 x 800; Z1 finding), so the item cannot be clicked. Focus is on it: Enter.
    await page.getByRole('menuitem', { name: tr(lang, 'printers.archive') }).click();
    await page.locator('.pos-dialog').getByRole('button', { name: tr(lang, 'printers.archive') }).click();
    await expect(page.locator('article.pr--off', { hasText: name })).toBeVisible();
  });
}
