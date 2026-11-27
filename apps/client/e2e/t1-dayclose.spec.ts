import { expect, test } from '@playwright/test';
import { escapeRe, rushOff, shiftOpen, signInOn, takeawayTab } from './02b-support';
import { adminCommand } from './03b-support';
import { T1_HELD } from './t1-fixture';
import { apiSession, capture, closeAll, hub, hubAdvance, hubNow, runId, LANGS, queueEntry, screen, t1Hub, tr } from './t1-support';

// L-E2E-T1 rows #26 / #27 — the owner's dry-run checklist, day close, on a hub of its own (playwright.dayclose.config.ts:
// the e2e global setup without the other flows' orders, so the day can close). The Owner at the cashier kiosk:
//   #26 close the day while a paid pickup order still waits → its food stays reserved (03a PK-10, owner ruling DC-1: no
//       StockReleased for its lines, no re-plan, no second fire) and it is still waiting after the close
//   #27 the day's Z totals match the payments taken (the software half; the drawer and the card slips are people's)
// Each run reopens the day at the end (OpenBusinessDay, hub admin), so the next language starts on an open day.

const PICKUP_AHEAD_MS = 30 * 60_000;
const DAY_MIN_GAP_MS = 4 * 3_600_000; // @pos/domain DEFAULT_DAY_MIN_GAP_HOURS
// the fixture karahi as an immediate line (t1-fixture T1_HELD): stock-tracked (K1), so a pickup order's line is HELD
// (03a PK-1) and holds a reservation; a sync line of a pickup order is not held and is released at the close (test 188)
const KARAHI = T1_HELD;

interface OrderEvent {
  seq: number;
  stream_type: string;
  event_type: string;
  payload: Record<string, unknown>;
}

for (const lang of LANGS) {
  test(`[T1 #26 #27] day close with a paid pickup still waiting: its stock stays reserved, nothing is cooked again; the Z matches the payments (${lang})`, async ({ browser, request }, info) => {
    test.setTimeout(180_000);
    // a day closes only day_min_gap_hours (4 h default) after it opened: the hub's clock moves on first (before anyone
    // signs in: a 4 h jump ends idle sessions), so the pickup placed next is still 30 min ahead at the close (03a test
    // 188: a close at p − 30 min)
    await hubAdvance(DAY_MIN_GAP_MS + 60_000);
    const cash = await screen(browser, { width: 1920, height: 1080 });
    const api = await apiSession(request, 'S_OWNER');
    try {
      const page = cash.page;
      await rushOff(page);
      await signInOn(page, hub().kiosk, lang, 'Owner');
      await shiftOpen(page, lang);
      await takeawayTab(page);

      // a pickup order 30 min ahead (SubmitOrder pickup_at_ms, 02b §3.2 step 2b), paid in cash at the counter
      const order_id = runId(`T1-DC-${lang}`);
      const placed = await api.command('SubmitOrder', { order_id, order_type: 'takeaway', pickup_at_ms: (await hubNow()) + PICKUP_AHEAD_MS, lines: [{ order_item_id: `${order_id}-K`, item_id: KARAHI.item_id, quantity: 1 }] });
      expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);
      const token = String((await api.query<{ orders: Array<{ order_id: string; token: number }> }>('open-orders?order_type=takeaway')).orders.find((o) => o.order_id === order_id)!.token);
      await (await queueEntry(page, token)).click();
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
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
      // the next run starts on an open day with K1 counted (a reservation needs stock on hand)
      await adminCommand(request, 'open-business-day', 'OpenBusinessDay', {}).catch(() => undefined);
      await adminCommand(request, 'set-precooked-stock', 'SetPrecookedStock', { entries: [{ stock_item_id: 'K1', on_hand: 1_000_000 }] }).catch(() => undefined);
    }
  });
}
