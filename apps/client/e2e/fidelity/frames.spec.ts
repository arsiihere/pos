import { expect, test, type Page } from '@playwright/test';
import type { DemoDevice, DemoHub } from './demo-hub';
import { demo, hubDown, openTakeaway, shot, SIZES, tile, type Size } from './support';

// 02b-TK L-CLIENT-6a proof: each frame of the lane rendered on the demo hubs (setup.ts) and saved as
// docs/design/handoff/02b-tk/build-shots/<Frame>-<size>.png. Kiosk frames at 1920 × 1080, 1366 × 768 and 1280 × 800
// (the kiosk device), tablet frames at 1280 × 800 and 1366 × 768 (the tablet device), phone frames at 390 × 844.

test.setTimeout(240_000);

const KIOSK: Size[] = ['1920', '1366', '1280'];
const TABLET: Size[] = ['1280', '1366'];

async function on(browser: import('@playwright/test').Browser, size: Size, h: DemoHub, device: DemoDevice, o: { rush?: 'on' | 'off'; phone?: boolean; failQueue?: boolean } = {}): Promise<Page> {
  const page = await browser.newPage({ viewport: SIZES[size], ...(o.phone === true ? { isMobile: true, hasTouch: true } : {}) });
  // HomeError: the queue read fails (the rail says so, with Try again)
  if (o.failQueue === true) await page.route('**/queries/open-orders*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'x', details: {} } }) }));
  await openTakeaway(page, h, device, { rush: o.rush ?? 'off' });
  return page;
}

const section = async (page: Page, name: string) => {
  const pill = page.locator('.menu .pills .pill', { hasText: new RegExp(`^${name}`) });
  if (await pill.count()) await pill.first().click();
};

/** the HomeKiosk cart: Paye ×2, Raita, Chicken Karahi Half, Roghni Naan ×4, name Usman */
async function homeCart(page: Page, name = 'Usman') {
  await section(page, 'Paye');
  await tile(page, 'Paye').click();
  await tile(page, 'Paye').click();
  await section(page, 'Sides');
  await tile(page, 'Raita').click();
  await section(page, 'Karahi');
  await page.getByRole('button', { name: 'Chicken Karahi · Half' }).click();
  await section(page, 'Tandoor');
  for (let i = 0; i < 4; i++) await tile(page, 'Roghni Naan').click();
  await page.locator('.cart input[name="customer_name"]').fill(name);
  await section(page, 'Paye');
  await page.waitForTimeout(900);
}

const offline = hubDown;

const kioskFrames: Array<[string, (page: Page) => Promise<void>, { hub?: 'busy' | 'empty'; rush?: 'on'; failQueue?: boolean }?]> = [
  ['HomeKiosk', homeCart],
  ['ShellAnatomy', async (page) => {
    await homeCart(page);
    await page.locator('header.top .me').click();
    await page.waitForTimeout(300);
  }],
  ['HomeEmpty', async () => undefined, { hub: 'empty' }],
  ['HomeRush', async (page) => {
    await section(page, 'Karahi');
    await page.getByRole('button', { name: 'Chicken Karahi · Full' }).click();
    await section(page, 'Tandoor');
    await tile(page, 'Naan').click();
    await page.waitForTimeout(800);
  }, { rush: 'on' }],
  ['TileStates', async (page) => {
    await section(page, 'Karahi');
    await page.getByRole('button', { name: 'Chicken Karahi · Half' }).click();
    await section(page, 'BBQ');
    await tile(page, 'Seekh Kabab ×4').click();
    await page.waitForTimeout(600);
  }],
  ['KeyboardMode', async (page) => {
    await homeCart(page);
    await page.locator('.menu .search input').click();
    await page.keyboard.type('4n');
    await page.waitForTimeout(500);
  }],
  ['CartTimeDelta', async (page) => {
    await homeCart(page);
    await page.locator('.cart .ln', { hasText: 'Chicken Karahi' }).getByRole('button', { name: /more|\+/i }).first().click();
    await page.waitForTimeout(1200);
  }],
  ['CartNote', async (page) => {
    await homeCart(page);
    await page.locator('.cart').getByRole('button', { name: /Add note/ }).click();
    await page.locator('[role="dialog"] textarea').fill('Less spicy, extra raita on the side');
    await page.locator('[role="dialog"] .btn--primary').click();
    await page.waitForTimeout(600);
  }],
  ['ServeChoice', async (page) => {
    await section(page, 'Paye');
    await tile(page, 'Paye').click();
    await section(page, 'Karahi');
    await page.getByRole('button', { name: 'Mutton Karahi · Half' }).click();
    await page.waitForTimeout(1000);
  }],
  ['PickupLater', async (page) => {
    await section(page, 'Karahi');
    await page.getByRole('button', { name: 'Mutton Karahi · Full' }).click();
    await section(page, 'Tandoor');
    for (let i = 0; i < 8; i++) await tile(page, 'Naan').click();
    await page.locator('.cart input[name="customer_name"]').fill('Saima');
    await page.locator('.cart input[name="phone"]').fill('03217654321');
    await page.locator('.cart [data-pickup-row] button', { hasText: '+45 min' }).click();
    await page.waitForTimeout(1200);
  }],
  ['LeaveGuard', async (page) => {
    await homeCart(page);
    await page.locator('header.top nav.tabs-top a').nth(2).click();
    await expect(page.locator('.dlg')).toBeVisible();
    await page.waitForTimeout(300);
  }],
  ['ReadyTiles', async (page) => {
    await page.locator('.tk-rt').first().locator('.tk-rt__open').click();
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }],
  ['HomeError', async (page) => {
    await homeCart(page);
  }, { failQueue: true }],
  ['HomeOffline', async (page) => {
    await homeCart(page);
    await offline(page);
  }],
  ['SentToast', async (page) => {
    await homeCart(page, 'Usman');
    await page.locator('.cart').getByRole('button', { name: /^Send · pay later/ }).click();
    await expect(page.locator('.toast')).toBeVisible();
    await page.waitForTimeout(400);
  }],
  ['SentQueued', async (page) => {
    await offline(page);
    await homeCart(page, 'Imran');
    await page.locator('.cart').getByRole('button', { name: /^Send · pay later/ }).click();
    await page.waitForTimeout(800);
  }],
  ['HandoverUndo', async (page) => {
    const hand = page.locator('.tk-rt button.tk-rt__act', { hasText: 'Hand over' }).first();
    if (await hand.count()) await hand.click();
    await page.waitForTimeout(500);
  }],
];

for (const [frame, run, o] of kioskFrames) {
  test(`kiosk ${frame}`, async ({ browser }) => {
    for (const size of KIOSK) {
      // HandoverUndo hands a bag over for real: once is enough
      if (frame === 'HandoverUndo' && size !== '1920') continue;
      const h = demo(o?.hub ?? 'busy');
      const page = await on(browser, size, h, h.kiosk, { ...(o?.rush === undefined ? {} : { rush: o.rush }), ...(o?.failQueue === true ? { failQueue: true } : {}) });
      try {
        await run(page);
        // the rail keeps its width and the page never scrolls sideways, whatever the queue holds (6b's check)
        const rail = await page.locator('.osc--tk > .tk-q').boundingBox();
        if (rail !== null) expect(rail.width).toBeLessThanOrEqual(size === '1920' ? 441 : 381);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await shot(page, `${frame}-${size}`);
      } finally {
        await page.context().setOffline(false);
        await page.close();
      }
    }
  });
}

// 6b's check (Urdu at 1366 × 768): the cart lines keep their room under the name / pickup rows
test('kiosk HomeKiosk in Urdu', async ({ browser }) => {
  for (const size of ['1366', '1920'] as const) {
    const h = demo('busy');
    const page = await browser.newPage({ viewport: SIZES[size] });
    try {
      await openTakeaway(page, h, h.kiosk, { lang: 'ur' });
      await page.locator('.menu .pills .pill').first().click();
      await tile(page, 'Paye').click();
      await tile(page, 'Paye').click();
      await page.locator('.cart input[name="customer_name"]').fill('عثمان');
      await page.waitForTimeout(900);
      const lines = await page.locator('.osc--tk > .cart > .lines').boundingBox();
      expect(lines!.height).toBeGreaterThan(100);
      await shot(page, `HomeKioskUrdu-${size}`);
    } finally {
      await page.close();
    }
  }
});

// qa-bill-2 in the 6a cart (02b v1.0.26 CT-1 – CT-4): the amber "Kitchen can make it by …" over the lines when the asked
// pickup is too soon, the one clock (Ready by = the latest line time), and the 30 s preview refresh
test('kiosk PickupLate + one clock + 30 s refresh', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const size of ['1920', '1366'] as const) {
    const h = demo('busy');
    const page = await on(browser, size, h, h.kiosk);
    try {
      await section(page, 'Karahi');
      await page.getByRole('button', { name: 'Mutton Karahi · Full' }).click();
      await page.locator('.cart [data-pickup-row] button', { hasText: '+15 min' }).click();
      await expect(page.locator('.cart [data-pickup-late]')).toBeVisible();
      const lines = await page.locator('.osc--tk > .cart > .lines').boundingBox();
      expect(lines!.height).toBeGreaterThan(100);
      await shot(page, `PickupLate-${size}`);
      await page.locator('.cart [data-pickup-row] button', { hasText: 'Now' }).click();
      await page.waitForTimeout(900);
      // one clock: Ready by = the latest line badge
      const ready = await page.locator('.cart [data-ready] b').textContent();
      const badges = await page.locator('.cart .ln .eta .num').allTextContents();
      expect(badges.length).toBeGreaterThan(0);
      expect(badges).toContain(ready);
      if (size === '1920') {
        let asked = 0;
        page.on('request', (r) => {
          if (r.url().includes('/queries/eta-preview')) asked += 1;
        });
        await page.waitForTimeout(32_000);
        expect(asked, 'the cart re-asks its times every 30 s').toBeGreaterThanOrEqual(1);
      }
    } finally {
      await page.close();
    }
  }
});

test('tablet HomeTablet + QueueTablet', async ({ browser }) => {
  for (const size of TABLET) {
    const h = demo('busy');
    const page = await on(browser, size, h, h.tablet);
    try {
      await homeCart(page);
      await shot(page, `HomeTablet-${size}`);
      await page.locator('.tk-rstrip__q').click();
      await page.waitForTimeout(500);
      await shot(page, `QueueTablet-${size}`);
    } finally {
      await page.close();
    }
  }
});

test('phone PhoneMenu, PhoneCart, PhoneQueue, PhoneOffline', async ({ browser }) => {
  const h = demo('busy');
  const page = await on(browser, '390', h, h.phone, { phone: true });
  const tab = (name: RegExp) => page.locator('.ptabs button', { hasText: name });
  try {
    await section(page, 'Paye');
    await tile(page, 'Paye').click();
    await section(page, 'Tandoor');
    await tile(page, 'Roghni Naan').click();
    await tile(page, 'Roghni Naan').click();
    await page.waitForTimeout(900);
    await shot(page, 'PhoneMenu-390');
    await tab(/^Cart/).click();
    await page.locator('input[name="customer_name"]').fill('Usman');
    await page.waitForTimeout(500);
    await shot(page, 'PhoneCart-390');
    await tab(/^Queue/).click();
    await page.waitForTimeout(500);
    await shot(page, 'PhoneQueue-390');
    await tab(/^Menu/).click();
    await offline(page);
    await shot(page, 'PhoneOffline-390');
  } finally {
    await page.context().setOffline(false);
    await page.close();
  }
});
