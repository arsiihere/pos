import { expect, test, type APIRequestContext, type Page, type WebSocketRoute } from '@playwright/test';
import { escapeRe, menuTile, railEntry, rushOff, shiftOpen, signInOn, takeawayTab, type Lang } from './02b-support';
import { adminCommand } from './03b-support';
import { t1Held, t1Items, t1Key } from './t1-fixture';
import { apiSession, capture, closeAll, hub, hubAdvance, hubNow, passCard, passTablet, runId, LANGS, queueEntry, screen, t1Hub, tr } from './t1-support';

// L-E2E-T1 rows #26 / #27 — the owner's dry-run checklist, day close, on a hub of its own (playwright.dayclose.config.ts:
// the e2e global setup without the other flows' orders, so the day can close). The Owner at the cashier kiosk:
//   #26 close the day while a paid pickup order still waits → its food stays reserved (03a PK-10, owner ruling DC-1: no
//       StockReleased for its lines, no re-plan, no second fire), and it stays open (02b §3.3, owner ruling DC-2): next
//       day it is on the counter's queue and on the Pass, its date beside its token
//   #27 the day's Z totals match the payments taken (the software half; the drawer and the card slips are people's)
// One language per hub (playwright.dayclose.config.ts): the hub's clock is pinned before the day's end (global-setup), and
// the pickup is taken inside the hub's own bounds, so the run does not depend on the runner's clock or time zone.

const PICKUP_AHEAD_MS = 30 * 60_000;
// the run's karahi as an immediate line (t1-fixture t1Held, at the run's station): stock-tracked (K1), so a pickup
// order's line is HELD (03a PK-1) and holds a reservation; a sync line of a pickup order is not held and is released at
// the close (test 188)

interface OrderEvent {
  seq: number;
  stream_type: string;
  event_type: string;
  payload: Record<string, unknown>;
}

/** Opens the token's entry whose drawer offers Take payment (the Due one of same-token entries). */
async function openDue(page: Page, lang: Lang, token: string): Promise<void> {
  const pay = page.locator('section.tk-drawer').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) });
  // the order placed a moment ago reaches the queue by its live frame: look again until its entry is there
  await expect(async () => {
    await queueEntry(page, token);
    const entries = railEntry(page, token);
    await expect(entries.first()).toBeVisible({ timeout: 2_000 });
    const n = await entries.count();
    for (let i = 0; i < n; i++) {
      await entries.nth(i).click();
      if (await pay.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true, () => false)) return;
      await page.keyboard.press('Escape');
    }
    throw new Error(`no Due entry for token ${token}`);
  }).toPass({ timeout: 20_000 });
}

/**
 * The next business day opens (hub admin) on the next calendar date (the hub's clock moves a day on first: sessions
 * signed in before it have ended), with K1 counted (a reservation needs stock on hand).
 */
async function nextDay(request: APIRequestContext): Promise<void> {
  await hubAdvance(24 * 3_600_000);
  await adminCommand(request, 'open-business-day', 'OpenBusinessDay', {}).catch(() => undefined);
  await adminCommand(request, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'K1', on_hand: 1_000_000 }] }).catch(() => undefined);
}

for (const lang of LANGS) {
  test(`[T1 #26 #27] day close with a paid pickup still waiting: its stock stays reserved, nothing is cooked again; the Z matches the payments (${lang})`, async ({ browser, request }, info) => {
    test.setTimeout(180_000);
    // the day-close hub sets day_min_gap_hours to 0 (global-setup, POS_E2E_DAYCLOSE): the day closes at once, so the
    // pickup placed next is still 30 min ahead at the close (03a test 188: a close at p − 30 min)
    const KARAHI = t1Held(t1Key('close', 'kiosk', lang));
    const cash = await screen(browser, { width: 1920, height: 1080 });
    const pass = await screen(browser, { width: 1280, height: 800 });
    let api = await apiSession(request, 'S_OWNER');
    let reopened = false;
    try {
      const page = cash.page;
      await rushOff(page);
      await signInOn(page, hub().kiosk, lang, 'Owner');
      await shiftOpen(page, lang);
      await takeawayTab(page);

      // a pickup order 30 min ahead (SubmitOrder pickup_at_ms, 02b §3.2 step 2b), paid in cash at the counter
      const order_id = runId(`T1-DC-${lang}`);
      // the pickup inside the hub's own bounds (eta-preview pickup_bounds, 02b §3.2 step 2b): 30 min ahead where the day
      // allows, else the latest the day allows — never a time the hub would refuse, whatever the runner's clock or zone
      const lines = [{ key: 'K', item_id: KARAHI.item_id, quantity: 1 }];
      const preview = await api.query<{ pickup_bounds: { earliest_ms: number; latest_ms: number } | null }>(`eta-preview?draft=${encodeURIComponent(JSON.stringify({ order_type: 'takeaway', lines }))}`);
      const bounds = preview.pickup_bounds!;
      expect(bounds.earliest_ms, 'the open day has time left for a pickup').toBeLessThanOrEqual(bounds.latest_ms);
      const pickup_at_ms = Math.min(Math.max((await hubNow()) + PICKUP_AHEAD_MS, bounds.earliest_ms), bounds.latest_ms);
      const placed = await api.command('SubmitOrder', { order_id, order_type: 'takeaway', pickup_at_ms, lines: [{ order_item_id: `${order_id}-K`, item_id: KARAHI.item_id, quantity: 1 }] });
      expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);
      const token = String((await api.query<{ orders: Array<{ order_id: string; token: number }> }>('open-orders?order_type=takeaway')).orders.find((o) => o.order_id === order_id)!.token);
      // DC-2: yesterday's paid pickup stays open, and a new day's tokens start again at 1, so two entries can read the same
      // token; this order's is the one whose drawer offers Take payment
      await openDue(page, lang, token);
      await page.locator('section.tk-drawer').getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      const due = (await panel.locator('.tk-pay__due .money').innerText()).trim();
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
      await page.keyboard.press('Enter');
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
      await expect(panel).toHaveCount(0);
      const before = (await t1Hub<{ events: OrderEvent[] }>({ kind: 'orderEvents', order_id })).events;
      expect(before.map((e) => e.event_type)).toContain('OrdersBilled');

      // the Owner's shift closes (counted skip), then the day closes from the staff app's Day close screen
      const shift = await api.query<{ shift: { shift_id: string } | null } & { shift_id?: string }>('shift');
      const shift_id = shift.shift?.shift_id ?? shift.shift_id!;
      const closed = await api.command('CloseShift', { shift_id, skip_count: true, note: 'e2e dry run: count skipped' });
      expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
      await page.evaluate(() => (window.location.hash = '#/day-close'));
      await page.getByRole('button', { name: tr(lang, 'billing.dayclose.close') }).click();
      await expect(page.getByText(tr(lang, 'billing.dayclose.done')).first()).toBeVisible({ timeout: 20_000 });
      await capture(page, info, `T1-26-day-closed-${lang}`);

      // #27: the Z's cash total is the payment taken (the only one of this day on this hub)
      await expect(page.locator('main')).toContainText(due.replace(/^Rs\s?/, ''));

      // #26 DC-1: the waiting pickup's stock is not released at the close, nothing re-planned or fired again
      const after = (await t1Hub<{ events: OrderEvent[] }>({ kind: 'orderEvents', order_id })).events.filter((e) => e.seq > before.at(-1)!.seq);
      const types = after.map((e) => e.event_type);
      expect(before.map((e) => e.event_type), 'the held line holds a reservation').toContain('StockReserved');
      expect(types, 'no stock release for the kept pickup (DC-1)').not.toContain('StockReleased');
      expect(types, 'no second fire or re-plan').not.toContain('FireDispatched');
      expect(types).not.toContain('ItemAdded');

      // 02b §3.3 DC-2: the paid order still waiting stays open — next day it is on the counter's queue and on the Pass,
      // its date beside its token ("from <date>")
      await nextDay(request);
      reopened = true;
      await api.close().catch(() => undefined);
      api = await apiSession(request, 'S_OWNER');
      const open = await api.query<{ orders: Array<{ order_id: string; from_date: string | null; bill: { state: string } | null }> }>('open-orders?order_type=takeaway');
      expect(open.orders.find((o) => o.order_id === order_id)).toMatchObject({ bill: { state: 'paid' }, from_date: expect.any(String) });
      await signInOn(page, hub().kiosk, lang, 'Owner');
      await takeawayTab(page);
      await expect(await queueEntry(page, token)).toBeVisible({ timeout: 15_000 });
      await capture(page, info, `T1-26-next-day-counter-${lang}`);
      await passTablet(pass.page, 'close', info, lang);
      const card = passCard(pass.page, token);
      await expect(card).toBeVisible({ timeout: 15_000 });
      // the date beside the token (its business date, not today's)
      await expect(card.locator('.pc__n')).not.toHaveText(new RegExp(`^#?${token}$`));
      await capture(pass.page, info, `T1-26-next-day-pass-${lang}`);
    } finally {
      await api.close();
      await closeAll(info, lang, pass, cash);
      // the next run starts on an open day
      if (!reopened) await nextDay(request);
    }
  });
}

// ⚠️ 02b-TK L-CLIENT-5 item 3 (02b v1.0.25 §3.3 Day close: a carried order "is shown under the next day with its date
// beside its token" ("57 · 6 Nov"); §6.16 `from_date`; ruling DC-2): a PAID pickup not yet handed over stays open across
// the close (DC-2, hub #545); on the next business day (the hub clock a day on, OpenBusinessDay) the counter's queue row
// and token view show "<token> · <date>". On the day-close hub of playwright.dayclose.config.ts: its clock is pinned
// before the day's end (global-setup) and day_min_gap_hours is 0, so the day closes at once; the pickup is taken inside
// eta-preview's pickup_bounds. One language per run (POS_E2E_DAYCLOSE_LANG).
for (const lang of LANGS) {
  test(`[02b-TK L-CLIENT-5 item 3] a carried token shows its date beside the number on the next day (${lang})`, async ({ browser, request }, info) => {
    test.setTimeout(180_000);
    const KARAHI = t1Held(t1Key('close', 'kiosk', lang));
    let api = await apiSession(request, 'S_OWNER');
    let cash: Awaited<ReturnType<typeof screen>> | null = null;
    try {
      // a paid pickup inside the hub's bounds, paid in full at the counter (API): DC-2 keeps it open at the close
      const order_id = runId(`L5-CARRY-${lang}`);
      const lines = [{ key: 'K', item_id: KARAHI.item_id, quantity: 1 }];
      const preview = await api.query<{ pickup_bounds: { earliest_ms: number; latest_ms: number } | null }>(`eta-preview?draft=${encodeURIComponent(JSON.stringify({ order_type: 'takeaway', lines }))}`);
      const bounds = preview.pickup_bounds!;
      expect(bounds.earliest_ms, 'the open day has time left for a pickup').toBeLessThanOrEqual(bounds.latest_ms);
      const pickup_at_ms = Math.min(Math.max((await hubNow()) + PICKUP_AHEAD_MS, bounds.earliest_ms), bounds.latest_ms);
      const placed = await api.command('SubmitOrder', { order_id, order_type: 'takeaway', pickup_at_ms, lines: [{ order_item_id: `${order_id}-K`, item_id: KARAHI.item_id, quantity: 1 }] });
      expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);
      const shiftOpened = await api.command('OpenShift', { float_minor: 0, as_drawer: false });
      const shift_id = (shiftOpened.status === 200 ? (shiftOpened.body.data?.result as { shift_id?: string } | undefined)?.shift_id : undefined) ??
        (await api.query<{ shift: { shift_id: string } | null } & { shift_id?: string }>('shift').then((x) => x.shift?.shift_id ?? x.shift_id));
      const bill = await api.query<{ splits: Array<{ split_no: number; balance_minor: number }> }>(`bill?order_id=${order_id}`);
      const due = bill.splits[0]!.balance_minor;
      const paid = await api.command('AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: due, tendered_minor: due });
      expect(paid.status, JSON.stringify(paid.body.error)).toBe(200);
      const closedSplit = await api.command('CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: due });
      expect(closedSplit.status, JSON.stringify(closedSplit.body.error)).toBe(200);
      const open = (await api.query<{ orders: Array<{ order_id: string; token: number; business_date: string; bill: { state: string } | null }> }>('open-orders?order_type=takeaway')).orders;
      const row = open.find((o) => o.order_id === order_id)!;
      expect(row.bill).toMatchObject({ state: 'paid' });
      // 05's close guard refuses unbilled orders: an earlier run's leftovers are carried
      const unbilled = open.filter((o) => o.bill?.state !== 'paid').map((o) => o.order_id);
      if (unbilled.length > 0) expect((await api.command('CarryOverOrders', { order_ids: unbilled, reason_code: 'customer_will_pay_later' })).status).toBe(200);
      if (shift_id !== undefined) await api.command('CloseShift', { shift_id, skip_count: true, note: 'e2e: count skipped' });
      const closed = await api.command('CloseBusinessDay', {});
      expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
      // the next calendar day: a new business date; the paid pickup is still open with its from_date (DC-2)
      await nextDay(request);
      await api.close().catch(() => undefined);
      api = await apiSession(request, 'S_OWNER');
      const next = (await api.query<{ orders: Array<{ order_id: string; from_date: string | null }> }>('open-orders?order_type=takeaway')).orders;
      expect(next.find((o) => o.order_id === order_id)).toMatchObject({ from_date: row.business_date });

      cash = await screen(browser, { width: 1920, height: 1080 });
      const page = cash.page;
      await rushOff(page);
      await signInOn(page, hub().kiosk, lang, 'Owner');
      await takeawayTab(page);
      const token = String(row.token);
      const [, m, d] = row.business_date.split('-').map(Number);
      const label = `${token} · ${d} ${tr(lang, 'alerts.months').split(',')[m! - 1]}`;
      // DC-2: a new day's tokens start again at 1, so two entries can read the same number; the carried one has the date
      await expect(async () => {
        await queueEntry(page, token);
        await expect(page.locator('[data-carried]', { hasText: label }).first()).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 20_000 });
      const entry = page.locator('[data-token]', { has: page.locator('[data-carried]', { hasText: label }) }).first();
      await entry.scrollIntoViewIfNeeded();
      await capture(page, info, `CarriedToken-row-${lang}`, entry);
      await entry.click();
      await expect(page.locator('section.tk-drawer .tk-drawer__h [data-carried]')).toHaveText(label);
      await capture(page, info, `CarriedToken-view-${lang}`, page.locator('section.tk-drawer'));
    } finally {
      await api.close().catch(() => undefined);
      if (cash !== null) await closeAll(info, lang, cash);
    }
  });
}

// ⚠️ 02b v1.0.28 QR2-1 – QR2-3 (owner 2026-11-28 QA-R2; BUG-2, BUG-9, BUG-10), §10 #101: a takeaway queued offline
// across Close day is never dropped. On the day-close hub (day_min_gap_hours 0), at the cashier kiosk and on the landscape
// tablet: Send · pay later while offline → "Waiting to send" → the day closes elsewhere (API; an unbilled order carried) →
// back online, the hub refuses it for the closed day → the rail row stays: "Waiting — the day hasn't started" → the
// Owner's Start day on the banner (the staff app, no admin page) → the row goes, its token comes (the sticky card), the
// order is in the open day; the carried token keeps its date although the day reopened on the same date.
const VIEWS = [
  { project: 'kiosk', viewport: { width: 1920, height: 1080 } },
  { project: 'tablet-landscape', viewport: { width: 1280, height: 800 } },
] as const;
for (const lang of LANGS)
  for (const view of VIEWS) {
    test(`[02b #101 QR2-1 QR2-2 QR2-3] a takeaway queued offline across Close day waits, visible, and is sent at Start day; the carried token keeps its date — ${view.project} (${lang})`, async ({ browser, request }, info) => {
      test.setTimeout(180_000);
      const run = t1Items(t1Key('close', view.project, lang));
      let api = await apiSession(request, 'S_OWNER');
      const cash = await screen(browser, view.viewport);
      const { page, context } = cash;
      try {
        // the carried token (QR2-3): an unbilled takeaway placed now, carried over the close
        const carried_id = runId(`R2-CARRY-${lang}`);
        const placed = await api.command('SubmitOrder', { order_id: carried_id, order_type: 'takeaway', lines: [{ order_item_id: `${carried_id}-M`, item_id: run.main.item_id, quantity: 1 }] });
        expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);

        const sockets: WebSocketRoute[] = [];
        await page.routeWebSocket(/\/ws$/, (ws) => {
          ws.connectToServer();
          sockets.push(ws);
        });
        await rushOff(page);
        await signInOn(page, view.project === 'kiosk' ? hub().kiosk : hub().device, lang, 'Owner');
        await takeawayTab(page);

        // offline: Send · pay later → queued, no token
        await context.setOffline(true);
        for (const ws of sockets) await ws.close({ code: 1006 });
        await menuTile(page, run.main.name).click();
        await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
        await expect(page.getByText(tr(lang, 't.queued'))).toBeVisible();
        const strip = page.locator('.tk-rstrip__q');
        if ((await strip.count()) > 0 && (await page.locator('.tk-qr--q').count()) === 0) await strip.click();
        const waiting = page.locator('.tk-qr--q');
        await expect(waiting).toHaveCount(1);
        await expect(waiting).toContainText(tr(lang, 'q.waiting_send'));

        // the day closes elsewhere: shifts closed, every unbilled order carried (05's guard)
        // the Owner's own shift, if one is open (none → 404 SHIFT_NOT_FOUND)
        const shift = await api.query<{ shift: { shift_id: string } | null } & { shift_id?: string }>('shift').catch(() => null);
        const shift_id = shift?.shift?.shift_id ?? shift?.shift_id;
        if (shift_id !== undefined) await api.command('CloseShift', { shift_id, skip_count: true, note: 'e2e: count skipped' });
        const open = (await api.query<{ orders: Array<{ order_id: string; token: number | null; business_date: string; bill: { state: string } | null }> }>('open-orders?order_type=all')).orders;
        const unbilled = open.filter((o) => o.bill?.state !== 'paid').map((o) => o.order_id);
        if (unbilled.length > 0) expect((await api.command('CarryOverOrders', { order_ids: unbilled, reason_code: 'customer_will_pay_later' })).status).toBe(200);
        const closed = await api.command('CloseBusinessDay', {});
        expect(closed.status, JSON.stringify(closed.body.error)).toBe(200);
        expect(closed.body.data?.result).toMatchObject({ changed: true });
        const carried = open.find((o) => o.order_id === carried_id)!;

        // back online: the hub refuses it for the closed day; the row stays and says why (not the hidden queue log)
        await context.setOffline(false);
        await expect(waiting).toContainText(tr(lang, 'q.waiting_day'), { timeout: 30_000 });
        await expect(waiting).toHaveCount(1);
        await capture(page, info, `QR2-waiting-day-${view.project}-${lang}`);

        // the landscape tablet's "All orders" drawer covers the banner: close it
        const drawerScrim = page.locator('.tk-scrim--fixed');
        if ((await drawerScrim.count()) > 0) await drawerScrim.first().dispatchEvent('click');
        // the e2e hub's clock is pinned: a minute passes before the day starts again (a carried order is one placed before it)
        await hubAdvance(60_000);
        // QR2-2: Start day from the staff app's banner (close-business-day), no admin page
        const banner = page.locator('.tk-banner--warn', { hasText: tr(lang, 'shell.day.closed') });
        await expect(banner).toBeVisible({ timeout: 15_000 });
        await banner.getByRole('button', { name: tr(lang, 'day.start') }).click();
        // the day opened: the queue sends it — its token on the sticky card, the row gone
        const card = page.locator('.tokc');
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(card).toContainText(tr(lang, 'send.queued_sent'));
        const token = (await card.locator('.tk').textContent())!.trim();
        expect(Number(token)).toBeGreaterThan(0);
        await expect(banner).toHaveCount(0);
        const scrim = page.locator('.tk-scrim--fixed');
        if ((await scrim.count()) > 0) await scrim.first().dispatchEvent('click');
        await card.getByRole('button', { name: tr(lang, 'queue.ok') }).click();
        if ((await strip.count()) > 0 && (await page.locator('.tk-qr').count()) === 0) await strip.click();
        await expect(waiting).toHaveCount(0);

        // the hub has it once, in the open day; the carried token keeps its date (the same date reopened, QR2-3)
        await api.close().catch(() => undefined);
        api = await apiSession(request, 'S_OWNER');
        const after = (await api.query<{ orders: Array<{ order_id: string; token: number | null; business_date: string; from_date: string | null }> }>('open-orders?order_type=takeaway')).orders;
        const sent = after.filter((o) => String(o.token) === token && o.from_date === null);
        expect(sent).toHaveLength(1);
        expect(after.find((o) => o.order_id === carried_id)).toMatchObject({ from_date: carried.business_date });
        const [, m, d] = carried.business_date.split('-').map(Number);
        const label = `${carried.token} · ${d} ${tr(lang, 'alerts.months').split(',')[m! - 1]}`;
        await expect(async () => {
          await queueEntry(page, String(carried.token));
          await expect(page.locator('[data-carried]', { hasText: label }).first()).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 20_000 });
      } finally {
        await context.setOffline(false).catch(() => undefined);
        await api.close().catch(() => undefined);
        await closeAll(info, lang, cash);
      }
    });
  }
