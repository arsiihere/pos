import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';
import { deviceFor, kitchenSession, landing, LANGS, menuTile, newOrder, sendCart, signInOn, signOut, tr, type Lang } from './02b-support';

// ⚠️ 02b v1.0.32 QO-1, QO-2 (owner ruling R3-1 of 2026-11-28 QA-R3; BUG-1, BUG-3), §10 #122: a takeaway queued offline
// is never dropped across a page reload. Offline Send → "Waiting to send" (IndexedDB pos-queue entry `queued`) →
// the page reloads → the entry is still `queued` at load, before any sign-in (never the log) →
// - kiosk: the hub is still away: the page boots from the /staff/ service worker's cache and shows "Can't reach the
//   hub — 1 order is safe on this device…" with the Offline pill, no sign-in; the hub comes back → the page reloads
//   itself → the sign-in;
// - landscape tablet (no worker): the reload reaches the hub → the sign-in says "1 waiting to send";
// → someone signs in → the order is sent automatically (the sticky token card), the hub holds it exactly once.

interface StoredEntry {
  entry_id: string;
  state: string;
  log_reason?: string;
  payload: { order_id: string };
}

function queueEntries(page: Page): Promise<StoredEntry[]> {
  return page.evaluate(
    () =>
      new Promise<StoredEntry[]>((resolve, reject) => {
        const open = indexedDB.open('pos-queue');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('entries')) {
            db.close();
            resolve([]);
            return;
          }
          const req = db.transaction('entries', 'readonly').objectStore('entries').getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result as StoredEntry[]);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
}

/** The PIN sign-in on the page as it is (signInOn without its pairing reloads). */
async function signInHere(page: Page, name = 'Ali', pin = '1234'): Promise<void> {
  const pad = page.locator('.pin__keys');
  await page.locator('.who__t', { hasText: name }).click();
  const enter = async () => {
    for (const digit of pin) await pad.locator('.btn', { hasText: new RegExp(`^${digit}$`) }).click();
    await pad.locator('.btn--primary').click();
  };
  const landed = landing(page);
  await enter();
  const taken = page.locator('.pin__err');
  await Promise.race([pad.waitFor({ state: 'detached' }), taken.waitFor({ state: 'visible' })]);
  if (await taken.isVisible()) await enter();
  await expect(pad).toHaveCount(0);
  await landed;
}

async function showQueue(page: Page, lang: Lang): Promise<void> {
  const tab = page.locator('.ptabs').getByRole('button', { name: tr(lang, 'q.tab') });
  if ((await tab.count()) > 0) return tab.click();
  const strip = page.locator('.tk-rstrip__q');
  if ((await strip.count()) > 0 && (await page.locator('.tk-qr--q').count()) === 0) await strip.click();
}

for (const lang of LANGS) {
  for (const project of ['kiosk', 'tablet-landscape'] as const) {
    test(`[02b #122 QO-1 QO-2; R3-1 BUG-1 BUG-3] queued offline → reload → still waiting → sign-in → sent once — ${project} (${lang})`, async ({ page, context, request }, info) => {
      test.skip(info.project.name !== project, `the ${project} run`);
      test.setTimeout(120_000);
      const kiosk = project === 'kiosk';
      const sockets: WebSocketRoute[] = [];
      await page.routeWebSocket(/\/ws$/, (ws) => {
        ws.connectToServer();
        sockets.push(ws);
      });
      await signInOn(page, deviceFor(info), lang);
      try {
        if (kiosk) {
          // SW-1: the paired kiosk's worker is active (its build cached) before the hub goes away
          expect(await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null)).toMatch(/\/staff\/sw\.js$/);
        }
        // offline Send: queued, "Waiting to send" in the rail
        await context.setOffline(true);
        for (const ws of sockets) await ws.close({ code: 1006 });
        await newOrder(page, lang, info, 'takeaway');
        await menuTile(page, 'Naan').click();
        await sendCart(page, lang);
        await expect(page.getByText(tr(lang, 't.queued'))).toBeVisible();
        await showQueue(page, lang);
        await expect(page.locator('.tk-qr--q')).toHaveCount(1);
        const [queued] = await queueEntries(page);
        expect(queued).toMatchObject({ state: 'queued' });
        const order_id = queued!.payload.order_id;

        if (kiosk) {
          // BUG-3: the reload while the hub is unreachable boots from the worker's cache: the kiosk's own screen
          await page.reload();
          await expect(page.getByText(tr(lang, 'offline_boot.title'))).toBeVisible();
          await expect(page.getByText(tr(lang, 'offline_boot.orders_one'))).toBeVisible();
          await expect(page.locator('.live--off')).toContainText(tr(lang, 'alerts.hub_offline'));
          await expect(page.locator('.pin__keys, .who__t')).toHaveCount(0);
          // BUG-1: at load, before any sign-in, the order is still queued (never the log)
          expect(await queueEntries(page)).toEqual([expect.objectContaining({ entry_id: queued!.entry_id, state: 'queued' })]);
          // never an API answer in the worker's cache: only the /staff/ build
          const cached = await page.evaluate(async () => {
            const urls: string[] = [];
            for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) urls.push(new URL(r.url).pathname);
            return urls;
          });
          expect(cached.length).toBeGreaterThan(1);
          for (const path of cached) expect(path.startsWith('/staff/'), path).toBe(true);
          // the hub is back: the page reloads itself into the sign-in
          await context.setOffline(false);
          await expect(page.locator('.who__t', { hasText: 'Ali' })).toBeVisible({ timeout: 20_000 });
        } else {
          // the landscape tablet has no worker: the reload reaches the hub
          await context.setOffline(false);
          await page.reload();
          await expect(page.locator('.who__t', { hasText: 'Ali' })).toBeVisible();
        }
        // BUG-1: still queued at load, and the sign-in says it waits
        expect(await queueEntries(page)).toEqual([expect.objectContaining({ entry_id: queued!.entry_id, state: 'queued' })]);
        await expect(page.getByText(tr(lang, 'queue.waiting', { n: '1' }))).toBeVisible();

        // someone signs in and the hub answers: sent automatically, the token on the sticky card
        await signInHere(page);
        const card = page.locator('.tokc');
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card).toContainText(tr(lang, 'send.queued_sent'));
        const token = (await card.locator('.tk').textContent())!.trim();
        expect(Number(token)).toBeGreaterThan(0);
        await expect.poll(() => queueEntries(page)).toEqual([]);
        // exactly once on the hub
        const reader = await kitchenSession(request, 'S_OWNER');
        try {
          const { orders } = await reader.query<{ orders: Array<{ order_id: string; token: number | null }> }>('open-orders?order_type=takeaway');
          expect(orders.filter((o) => o.order_id === order_id)).toEqual([expect.objectContaining({ token: Number(token) })]);
          expect(orders.filter((o) => String(o.token) === token)).toHaveLength(1);
        } finally {
          await reader.close();
        }
        const scrim = page.locator('.tk-scrim--fixed');
        if ((await scrim.count()) > 0) await scrim.first().dispatchEvent('click');
        await card.getByRole('button', { name: tr(lang, 'queue.ok') }).click();
        await expect(card).toHaveCount(0);
      } finally {
        await context.setOffline(false);
        await signOut(page, info, lang);
      }
    });
  }
}
