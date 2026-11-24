import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { dialog, hub, isPhone, landing, pairAs, sheet, tapTile, tr, type Lang } from './02a-support';
import { E2E_STATION, KHEER, type E2eDevice } from './global-setup';

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
  const landed = landing(page);
  await enter();
  const taken = page.locator('.pin__err');
  await Promise.race([pad.waitFor({ state: 'detached' }), taken.waitFor({ state: 'visible' })]);
  if (await taken.isVisible()) await enter();
  await expect(pad).toHaveCount(0);
  await landed;
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

// ------------------------------------------------------------------------------------------------- the kitchen (02b-TK)

/**
 * The kitchen items a takeaway hand-over flow orders: the fixture's Naan (5 min, at S1) and global-setup's Kheer
 * (1 min, its own station `S-E2E`, pullable at once). Both stations sit at the Pass point P1.
 */
export const KITCHEN = {
  naan: { item_id: 'I_NAAN', name: 'Naan' },
  kheer: { ...KHEER, station_id: E2E_STATION },
  point_id: 'P1',
} as const;

interface KitchenSession {
  command(type: string, payload: Record<string, unknown>): Promise<{ status: number; text: string }>;
  query<T>(path: string): Promise<T>;
  close(): Promise<void>;
}

let kitchenSeq = 0;

/** A staff session on the kitchen tablet (POST /auth/pin; 00 §6.3 command envelope), for set-up only. */
async function kitchenSession(request: APIRequestContext, staff_id: string): Promise<KitchenSession> {
  const h = hub();
  const device = { Authorization: `Bearer ${h.kitchen.token}` };
  const signIn = await request.post(`${h.baseURL}/auth/pin`, { headers: device, data: { staff_id, pin: '1234', takeover: true } });
  expect(signIn.status(), `auth/pin ${staff_id}: ${await signIn.text()}`).toBe(200);
  const session = ((await signIn.json()) as { data: { session_token: string } }).data.session_token;
  const headers = { ...device, 'X-Session-Token': session };
  return {
    async command(type, payload) {
      kitchenSeq += 1;
      const kebab = type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const res = await request.post(`${h.baseURL}/commands/${kebab}`, {
        headers,
        data: {
          command_id: `e2e-tk-${process.pid}-${kitchenSeq}`,
          tenant_id: h.tenant_id,
          branch_id: h.branch_id,
          command_type: type,
          payload,
          // eslint-disable-next-line no-restricted-syntax -- the e2e client has no Clock; the hub stamps its own time
          occurred_at: Date.now(),
          actor_id: staff_id,
          device_id: h.kitchen.device_id,
        },
      });
      return { status: res.status(), text: await res.text() };
    },
    async query<T>(path: string) {
      const res = await request.get(`${h.baseURL}/queries/${path}`, { headers });
      expect(res.status(), `${path}: ${await res.text()}`).toBe(200);
      return ((await res.json()) as { data: T }).data;
    },
    async close() {
      await request.post(`${h.baseURL}/auth/logout`, { headers, data: {} });
    },
  };
}


interface HubLine {
  order_id: string;
  order_item_id: string;
  item_id: string;
  stage: string | null;
  fired: boolean;
}

/** The token's lines of `item_ids` (one each), as the counter finds them: `open-orders` by token, then `order-view`
 *  (02b §6.16, §6.18a), read by the Owner (order-view is scoped to the take-order holders). */
async function tokenLines(request: APIRequestContext, token: string, item_ids: readonly string[]): Promise<HubLine[]> {
  const reader = await kitchenSession(request, 'S_OWNER');
  const mine: HubLine[] = [];
  try {
    const { orders } = await reader.query<{ orders: Array<{ order_id: string; token: number | null }> }>('open-orders?order_type=takeaway');
    for (const o of orders.filter((x) => String(x.token) === token)) {
      const view = await reader.query<{ lines: Array<Omit<HubLine, 'order_id' | 'item_id'> & { item_id: string | null }> }>(`order-view?order_id=${encodeURIComponent(o.order_id)}`);
      for (const l of view.lines) if (l.item_id !== null && item_ids.includes(l.item_id)) mine.push({ ...l, item_id: l.item_id, order_id: o.order_id });
    }
  } finally {
    await reader.close();
  }
  mine.sort((a, b) => item_ids.indexOf(a.item_id) - item_ids.indexOf(b.item_id));
  expect(
    mine.map((l) => l.item_id),
    `token ${token}: one line of each item`,
  ).toEqual([...item_ids]);
  return mine;
}

/**
 * The cook pulls the next lines of a station onto Now (03b §6.4 GiveMeMore, as the e2e Cook): a line is fired only so
 * in the e2e hub (fixed clock, no fires tick). The station's lines must be pullable (global-setup Kheer).
 */
export async function kitchenPull(request: APIRequestContext, station_id: string): Promise<string[]> {
  const cook = await kitchenSession(request, 'S_COOK');
  try {
    const more = await cook.command('GiveMeMore', { station_id, n: 10 });
    expect(more.status, `GiveMeMore: ${more.text}`).toBe(200);
    const pulled = (JSON.parse(more.text) as { data: { result: { pulled: string[] | null } } }).data.result.pulled;
    expect(pulled, `GiveMeMore ${station_id}: nothing to pull`).not.toBeNull();
    return pulled!;
  } finally {
    await cook.close();
  }
}

/**
 * The kitchen makes lines of a takeaway token ready through the hub's own commands, as the e2e Cook (`run-pass`, PIN
 * 1234, 03b §3.9) on the kitchen tablet. A fired line is cooked as on the kitchen screen: StartItem (03b §6.1, unless
 * cooking already), then DoneItem (§6.2). A line never fired (the e2e hub's fixed clock has no fires tick: a line due
 * now stays unfired, and GiveMeMore pulls only lines whose fire is still ahead) is made ready at the Pass instead —
 * MarkReadyToServe { order_id, point_id, order_item_ids } (03b §3.5, §6.6, "Bag ready" of 02b-TK C3-4), which writes
 * its Done (STAB-2 forced Done). Returns the order_item_ids made ready, in the order of `item_ids`.
 */
export async function kitchenReady(request: APIRequestContext, token: string, item_ids: readonly string[]): Promise<string[]> {
  const mine = await tokenLines(request, token, item_ids);
  const cook = await kitchenSession(request, 'S_COOK');
  try {
    for (const line of mine.filter((l) => l.fired && l.stage !== 'done')) {
      if (line.stage === 'added') {
        const start = await cook.command('StartItem', { order_item_id: line.order_item_id });
        expect(start.status, `StartItem: ${start.text}`).toBe(200);
      }
      // confirm: the fixed clock never lets the cook time pass (§3.2 the "done this early?" confirm, ITEM_DONE_CONFIRM_REQUIRED)
      const done = await cook.command('DoneItem', { order_item_id: line.order_item_id, confirm: true });
      expect(done.status, `DoneItem: ${done.text}`).toBe(200);
    }
    const unfired = mine.filter((l) => !l.fired && l.stage === 'added');
    for (const order_id of new Set(unfired.map((l) => l.order_id))) {
      const order_item_ids = unfired.filter((l) => l.order_id === order_id).map((l) => l.order_item_id);
      const ready = await cook.command('MarkReadyToServe', { order_id, point_id: KITCHEN.point_id, order_item_ids });
      expect(ready.status, `MarkReadyToServe: ${ready.text}`).toBe(200);
    }
  } finally {
    await cook.close();
  }
  return mine.map((l) => l.order_item_id);
}
