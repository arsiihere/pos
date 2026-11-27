import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import {
  dialog,
  hub,
  kitchenReady,
  KITCHEN,
  deviceFor,
  LANGS,
  menuTile,
  pairAs,
  railEntry,
  readyTile,
  sendCart,
  sentToken,
  signIn,
  signInOn,
  signOut,
  takeawayTab,
  tr,
} from './02b-support';

// 02b-TK L-CLIENT-2 item 4 (02b v1.0.25 §3.7a Ask / Approve, §6.4 customer_handover, §6.4a RequestUnpaidHandover,
// §6.12a kind hand_over_unpaid, §8 OR-7; D2; test 90 client part): the unpaid hand-over against the e2e hub, nothing
// mocked. Ali (order-taker: take-order, mark-served, no take-payment) sends a Naan to pay later; the kitchen makes it
// ready (02b-support kitchenReady). The Due token's drawer greys Hand over all ("Take payment first") and offers
// "Ask a manager" → RequestUnpaidHandover { order_id } → "Waiting for a manager…". The Manager (holds hand-over-unpaid
// by default, 01b B-5) on the second listed tablet opens Requests → "Hand over unpaid #N" → Approve → PIN. The
// UnpaidHandoverApproved frame reaches Ali's page: Hand over all enables for that order; after the 5 s Undo window
// MarkServed goes out with `customer_handover: true` (§6.4) and the hub answers 200.
// The hub on this base strips the unknown `customer_handover` field (MarkServed's payload schema is not strict) and
// has no transactional refusal yet (U-5); the client side of that refusal is unit-tested.

const { naan: NAAN } = KITCHEN;
const UNDO_MS = 5_000; // apps/client/src/features/staff/orders/takeaway/handover.ts UNDO_MS
const MANAGER_PIN = '0123'; // apps/hub/test/helpers/fixtures.ts PIN.b

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway counter runs at the kiosk and landscape tablet viewports');
  // two people on two screens, the kitchen, a PIN and the 5 s Undo window
  test.setTimeout(120_000);
};

const drawer = (page: Page) => page.locator('section.tk-drawer');

async function openToken(page: Page, token: string): Promise<void> {
  const strip = page.locator('.tk-rstrip');
  if ((await strip.count()) > 0 && (await readyTile(page, token).count()) === 0) await strip.locator('.tk-rstrip__q').click();
  await railEntry(page, token).first().click();
  await expect(drawer(page)).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string, what = page.locator('body')): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(`${name}.png`);
  await what.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

for (const lang of LANGS) {
  test(`[02b v1.0.25 §3.7a, §6.4a, §8 OR-7; D2; test 90] a Due takeaway → Ask a manager → the manager approves with PIN → handed over (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const served: Array<{ customer_handover?: boolean; lines: Array<{ order_id: string; order_item_ids: string[] }> }> = [];
    page.on('request', (r: Request) => {
      if (r.method() === 'POST' && r.url().endsWith('/commands/mark-served')) served.push((r.postDataJSON() as { payload: (typeof served)[number] }).payload);
    });
    const managerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const manager = await managerContext.newPage();
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await menuTile(page, NAAN.name).click();
      await sendCart(page, lang);
      const token = await sentToken(page);
      await kitchenReady(request, token, [NAAN.item_id]);
      const tile = readyTile(page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      await expect(tile).toContainText(tr(lang, 'q.due'));
      // the ready tile: no one-tap hand-over on a Due, unapproved token; Ask a manager is offered on it
      await expect(tile.locator('[data-ask]')).toHaveText(tr(lang, 'pass.ask_manager'));

      await openToken(page, token);
      const handOver = drawer(page).getByRole('button', { name: tr(lang, 'v.collected') });
      await expect(handOver).toHaveAttribute('aria-disabled', 'true');
      await expect(drawer(page).getByRole('note')).toHaveText(tr(lang, 'v.pay_first'));
      const asked = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/request-unpaid-handover'));
      await drawer(page).locator('[data-ask]').click();
      const answer = await asked;
      expect(answer.status()).toBe(200);
      const order_id = ((answer.request().postDataJSON() as { payload: { order_id: string } }).payload).order_id;
      expect(order_id).toMatch(/^[0-9A-Z]{26}$/);
      const waiting = drawer(page).locator(`[data-unpaid="${order_id}"]`);
      await expect(waiting).toContainText(tr(lang, 'pass.waiting_manager'));
      await expect(waiting.getByRole('button', { name: tr(lang, 'unpaid.withdraw') })).toBeVisible();
      await expect(handOver).toHaveAttribute('aria-disabled', 'true');
      await capture(page, info, `UnpaidWaiting-${info.project.name}-${lang}`, drawer(page));

      // the Manager on the second listed tablet: Requests → "Hand over unpaid #N" → Approve → PIN
      await pairAs(manager, hub().device2, lang);
      await signIn(manager, 'Manager', MANAGER_PIN);
      await manager.locator('header.top').getByRole('button', { name: new RegExp(tr(lang, 'alerts.nav.requests')) }).click();
      const card = tr(lang, 'alert.hand_over_unpaid.card', { identifier: `#${token}` });
      await manager.locator('main').getByText(card).first().click();
      const sheet = dialog(manager);
      await expect(sheet).toContainText(card);
      await capture(manager, info, `UnpaidAnswer-${info.project.name}-${lang}`, sheet);
      await sheet.getByRole('button', { name: tr(lang, 'answer.approve') }).click();
      const keys = manager.locator('.pin__keys');
      for (const d of MANAGER_PIN) await keys.locator('.btn', { hasText: new RegExp(`^${d}$`) }).click();
      await keys.getByRole('button', { name: tr(lang, 'answer.approve') }).click();
      await expect(manager.getByText(tr(lang, 'answer.done_approved')).first()).toBeVisible();

      // Ali: the approval (UnpaidHandoverApproved) unlocks that order only; Hand over all → 5 s Undo → MarkServed
      await expect(handOver).toHaveAttribute('aria-disabled', 'false', { timeout: 30_000 });
      await expect(drawer(page).locator('[data-ask]')).toHaveCount(0);
      const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await handOver.click();
      await expect(page.locator('.tk-toast', { hasText: tr(lang, 't.collected') })).toBeVisible();
      expect((await sent).status()).toBe(200);
      expect(served).toHaveLength(1);
      expect(served[0]!.customer_handover).toBe(true);
      expect(served[0]!.lines.map((l) => l.order_id)).toEqual([order_id]);
      // the token's line reads handed over
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-il', { hasText: NAAN.name }).locator('.tk-chip')).toHaveText(tr(lang, 'v.given'));
    } finally {
      await signOut(manager, info, lang);
      await managerContext.close();
      await signOut(page, info, lang);
      await context.close();
    }
  });
}
