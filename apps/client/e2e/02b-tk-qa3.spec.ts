import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PIN_MANAGER } from './03b-support';
import { deviceFor, hub, isKioskRun, menuTile, signInOn, signOut, takeawayTab, tr, type Lang } from './02b-support';

// QA round 3 (owner 2026-11-28 QA-R3, build 97d5e267; 02b v1.0.33 §8 QR3-3 – QR3-5, 05a v1.0.8 §6.8): the takeaway
// screen from 1280 to 1920 px wide (the 1568 × 711 tablet and the 1456 kiosk of the report included), in English and
// Urdu: no label, chip, button or rail text clipped or ellipsised, the pickup chips with their full label ("+" kept in
// Urdu); the alert banners never over the item search or the category chips; "/" in the phone field focuses the item
// search; "999" says "Max 99"; Manager tools → Devices in the staff look, its list scrolling.

/** Text elements whose content overflows their own box while it is hidden or ellipsised (clipped text): none. */
async function clippedText(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((roots) => {
    const out: string[] = [];
    for (const root of roots)
      for (const e of [root, ...root.querySelectorAll('*')] as HTMLElement[]) {
        if (!/^(BUTTON|B|SMALL|SPAN|STRONG|LABEL|A|H1|H2|H3|P)$/.test(e.tagName) || e.closest('.sr') !== null || e.classList.contains('sr')) continue;
        const cs = getComputedStyle(e);
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll' || e.getBoundingClientRect().width === 0) continue;
        if (e.scrollWidth > e.clientWidth + 1 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis')) out.push(`${e.tagName}.${e.className}: ${(e.textContent ?? '').trim().slice(0, 40)}`);
      }
    return out;
  });
}

const overlaps = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const SIZES: Record<string, Array<[number, number]>> = {
  kiosk: [[1366, 768], [1456, 768], [1920, 1080]],
  'tablet-landscape': [[1280, 800], [1568, 711]],
};

for (const lang of ['en', 'ur'] as const) {
  test(`[QA-R3 BUG-7/8; 02b v1.0.33 QR3-3] takeaway screen from 1280 to 1920 (${lang}): nothing clipped; the pickup chips whole`, async ({ page }, info) => {
    const sizes = SIZES[info.project.name];
    test.skip(sizes === undefined, 'kiosk and landscape tablet');
    test.setTimeout(90_000);
    await signInOn(page, isKioskRun(info) ? hub().kiosk : deviceFor(info), lang, 'Owner');
    try {
      await takeawayTab(page);
      await menuTile(page, 'Naan').click();
      for (const [width, height] of sizes!) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await page.waitForTimeout(200);
        for (const part of ['header.top', '.osc--tk']) expect(await clippedText(page, part), `${part} at ${width} × ${height}`).toEqual([]);
        // the pickup chips: whole labels, the Urdu with its "+"
        const chips = page.locator('.cart [data-pickup-row] .tk-pick button');
        await expect(chips.nth(1)).toHaveText(tr(lang, 'c.pick_15'));
        await info.attach(`qa3-${info.project.name}-${width}-${lang}`, { body: await page.screenshot(), contentType: 'image/png' });
      }
    } finally {
      await signOut(page, info, lang);
    }
  });
}

/** The Manager (listed on tablet 2) sends a test alert to the given device: a banner on its screen. */
async function testAlertTo(page: Page, device_id: string, tag: string): Promise<void> {
  const h = hub();
  const dev = { Authorization: `Bearer ${h.device2.token}` };
  const login = await page.request.post(`${h.baseURL}/auth/pin`, { headers: dev, data: { staff_id: 'S_MGR', pin: PIN_MANAGER, takeover: true } });
  expect(login.status(), await login.text()).toBe(200);
  const session = ((await login.json()) as { data: { session_token: string } }).data.session_token;
  const headers = { ...dev, 'X-Session-Token': session };
  const sent = await page.request.post(`${h.baseURL}/commands/send-test-alert`, {
    headers,
    // eslint-disable-next-line no-restricted-syntax -- the e2e client has no Clock; the hub stamps its own time
    data: { command_id: `e2e-qa3-${tag}-${process.pid}`, tenant_id: h.tenant_id, branch_id: h.branch_id, command_type: 'SendTestAlert', payload: { target: { kind: 'device', device_id } }, occurred_at: Date.now(), actor_id: 'S_MGR', device_id: h.device2.device_id },
  });
  expect(sent.status(), await sent.text()).toBe(200);
  await page.request.post(`${h.baseURL}/auth/logout`, { headers, data: {} });
}

test('[QA-R3 UX; 02b v1.0.33 QR3-5] an alert banner on the takeaway screen never covers the item search or the category chips', async ({ page }, info: TestInfo) => {
  test.skip(SIZES[info.project.name] === undefined, 'kiosk and landscape tablet');
  const device = isKioskRun(info) ? hub().kiosk : deviceFor(info);
  const lang: Lang = 'en';
  await signInOn(page, device, lang, 'Owner');
  try {
    await takeawayTab(page);
    await testAlertTo(page, device.device_id, info.project.name);
    const banner = page.locator('.abns .abn').first();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    const b = (await banner.boundingBox())!;
    for (const part of ['.tk-ksearch .search', '.menu .pills']) {
      const box = await page.locator(part).first().boundingBox();
      if (box !== null) expect(overlaps(b, box), `the banner covers ${part}`).toBe(false);
    }
  } finally {
    await signOut(page, info, lang);
  }
});

test('[QA-R3 BUG-21/24; 02b v1.0.33 QR3-4] "/" in the phone field focuses the item search; "999" says Max 99', async ({ page }, info) => {
  test.skip(SIZES[info.project.name] === undefined, 'kiosk and landscape tablet');
  const lang: Lang = 'en';
  await signInOn(page, isKioskRun(info) ? hub().kiosk : deviceFor(info), lang, 'Owner');
  try {
    await takeawayTab(page);
    const phone = page.locator('.cust input[name="phone"]');
    // the kiosk folds Name / phone into one button until it is tapped
    const who = page.locator('.cart .cust--compact').getByRole('button', { name: tr(lang, 'c.who_add') });
    await expect(async () => {
      if ((await phone.count()) === 0) await who.click({ timeout: 1_000 });
      await expect(phone).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await phone.click();
    await page.keyboard.type('0300');
    await page.keyboard.press('/');
    const search = page.locator('.menu input[type="search"]');
    await expect(search).toBeFocused();
    await expect(phone).toHaveValue('0300');
    await expect(search).toHaveValue('');
    await page.keyboard.type('999');
    await expect(page.locator('.tk-ksearch [data-max-qty]')).toHaveText(tr(lang, 'm.max_qty', { n: '99' }));
    await page.keyboard.press('Escape');
    await phone.fill('');
  } finally {
    await signOut(page, info, lang);
  }
});

test('[QA-R3 BUG-4; 05a v1.0.8 §6.8] Manager tools → Devices: staff look, sized icons, the list scrolls', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet-landscape', 'the manager tablet (the e2e phone is Ali\'s, who has no Devices)');
  const lang: Lang = 'en';
  await signInOn(page, deviceFor(info), lang, 'Owner');
  try {
    await page.evaluate(() => (window.location.hash = '#/devices'));
    const main = page.locator('main.body.dv');
    await expect(main).toBeVisible();
    await expect(page.locator('main.dv [class*="pos-"]')).toHaveCount(0);
    const icons = await page.locator('main.dv .dv__hw .ico').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    expect(icons.length).toBeGreaterThan(0);
    expect(Math.max(...icons)).toBeLessThanOrEqual(32);
    const body = page.locator('main.dv .lcard__b');
    const sizes = await body.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight, overflow: getComputedStyle(e).overflowY }));
    expect(sizes.overflow).toBe('auto');
    if (sizes.scroll > sizes.client) {
      await body.evaluate((e) => e.scrollTo(0, e.scrollHeight));
      expect(await body.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    }
  } finally {
    await signOut(page, info, lang);
  }
});

test('[QA-R3 UX; 01d v1.3.10 §8.1 B01] on a phone an alert banner sits above the screen and covers none of it', async ({ page }, info) => {
  test.skip(!info.project.name.startsWith('phone'), 'phones');
  const lang: Lang = 'en';
  const device = deviceFor(info);
  await signInOn(page, device, lang, 'Ali');
  try {
    await testAlertTo(page, device.device_id, info.project.name);
    const banner = page.locator('.abns--phone .abn').first();
    await expect(banner).toBeVisible({ timeout: 15_000 });
    const b = (await banner.boundingBox())!;
    // every button of the screen below stays uncovered
    const boxes = await page.locator('main button, main a.btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }).filter((r) => r.width > 0));
    for (const c of boxes) expect(overlaps(b, c), 'the banner covers a screen button').toBe(false);
  } finally {
    await signOut(page, info, lang);
  }
});
