import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import {
  dialog,
  escapeRe,
  hub,
  kitchenReady,
  kitchenSession,
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
// ⚠️ 02b-TK L-CLIENT-3 item 3 (02b v1.0.25 §6.4 (R3-M-4), §3.7a; D2; test 90): U-5 is merged — MarkServed with
// `customer_handover: true` rechecks the key's fresh due against the order's approval in its writer transaction and
// refuses with 403 PERMISSION_DENIED { reason: 'unpaid_handover_approval_required', order_id }. The second test reaches
// that refusal from the UI: the client's own check passes (the root is approved at its due), Hand over all starts the
// 5 s Undo window, and inside it an addition to the same token (SubmitOrder with adds_to_order_id, sent through the
// hub's API as the Owner on the kitchen tablet: another counter adding to the token) raises the key's due above the
// approved amount. The hub refuses the send; the screen says "Not paid — take payment first or ask a manager" and
// the token offers Ask a manager again.

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

/** Ali asks; the Manager on the second listed tablet approves with PIN (as the first test); returns the asked order_id. */
async function askAndApprove(page: Page, manager: Page, info: TestInfo, lang: (typeof LANGS)[number], token: string): Promise<string> {
  await openToken(page, token);
  const asked = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/request-unpaid-handover'));
  await drawer(page).locator('[data-ask]').click();
  const answer = await asked;
  expect(answer.status()).toBe(200);
  const order_id = (answer.request().postDataJSON() as { payload: { order_id: string } }).payload.order_id;
  await pairAs(manager, hub().device2, lang);
  await signIn(manager, 'Manager', MANAGER_PIN);
  await manager.locator('header.top').getByRole('button', { name: new RegExp(tr(lang, 'alerts.nav.requests')) }).click();
  await manager.locator('main').getByText(tr(lang, 'alert.hand_over_unpaid.card', { identifier: `#${token}` })).first().click();
  const sheet = dialog(manager);
  await sheet.getByRole('button', { name: tr(lang, 'answer.approve') }).click();
  const keys = manager.locator('.pin__keys');
  await manager.waitForTimeout(450); // ⚠️ 01d v1.3.9 §8.1 (QA-R2, BUG-13): the answer pad ignores taps for 400 ms after it opens
  for (const d of MANAGER_PIN) await keys.locator('.btn', { hasText: new RegExp(`^${d}$`) }).click();
  await keys.getByRole('button', { name: tr(lang, 'answer.approve') }).click();
  await expect(manager.getByText(tr(lang, 'answer.done_approved')).first()).toBeVisible();
  void info;
  return order_id;
}

for (const lang of LANGS) {
  test(`[02b v1.0.25 §6.4 (R3-M-4), §3.7a; D2; test 90; U-5] the client's check passes, the bill grows inside the Undo window → the hub refuses the hand-over (403 unpaid_handover_approval_required) → "Not paid" and Ask a manager (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const managerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const manager = await managerContext.newPage();
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await menuTile(page, NAAN.name).click();
      await sendCart(page, lang);
      const token = await sentToken(page);
      await kitchenReady(request, token, [NAAN.item_id]);
      await expect(readyTile(page, token)).toBeVisible({ timeout: 15_000 });
      const root = await askAndApprove(page, manager, info, lang, token);

      // approved at its due: the client's own check passes and Hand over all is live
      const handOver = drawer(page).getByRole('button', { name: tr(lang, 'v.collected') });
      await expect(handOver).toHaveAttribute('aria-disabled', 'false', { timeout: 30_000 });
      const refused = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 15_000 });
      await handOver.click();
      await expect(page.locator('.tk-toast', { hasText: tr(lang, 't.collected') })).toBeVisible();

      // inside the 5 s Undo window another counter adds to the token: the key's due is now above the approved amount
      const owner = await kitchenSession(request, 'S_OWNER');
      try {
        const id = `E2EU5${process.pid}${lang}${info.project.name}`.replace(/[^0-9A-Za-z]/g, '').slice(0, 20);
        const added = await owner.command('SubmitOrder', { order_id: `${id}-O`, order_type: 'takeaway', adds_to_order_id: root, lines: [{ order_item_id: `${id}-L1`, item_id: KITCHEN.kheer.item_id, quantity: 1 }] });
        expect(added.status, `SubmitOrder addition: ${added.text}`).toBe(200);
      } finally {
        await owner.close();
      }

      // the hub's transactional check refuses the whole send (§6.4 R3-M-4)
      const answer = await refused;
      expect(answer.status()).toBe(403);
      expect((answer.request().postDataJSON() as { payload: { customer_handover?: boolean } }).payload.customer_handover).toBe(true);
      const body = (await answer.json()) as { error: { code: string; details: Record<string, unknown> } };
      expect(body.error.code).toBe('PERMISSION_DENIED');
      expect(body.error.details).toEqual({ reason: 'unpaid_handover_approval_required', order_id: root });

      // the screen: "Not paid — take payment first or ask a manager", and the token offers Ask a manager again
      await expect(page.locator('.toast', { hasText: tr(lang, 'unpaid.refused') })).toBeVisible();
      await capture(page, info, `UnpaidRefused-${info.project.name}-${lang}`, page.locator('.toast', { hasText: tr(lang, 'unpaid.refused') }));
      await openToken(page, token);
      await expect(drawer(page).locator('[data-ask]')).toHaveText(tr(lang, 'pass.ask_manager'));
      // the root's Naan is ready, the addition's Kheer is not: "Give ready items now" (not Hand over all), greyed — it
      // would take the root's last live line while its due is above the approved amount
      await expect(drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.give_ready'))}`) })).toHaveAttribute('aria-disabled', 'true');
      await expect(drawer(page).locator('.tk-il', { hasText: NAAN.name }).locator('.tk-chip')).not.toHaveText(tr(lang, 'v.given'));
      await capture(page, info, `UnpaidRefusedAsk-${info.project.name}-${lang}`, drawer(page));
    } finally {
      await signOut(manager, info, lang).catch(() => undefined);
      await managerContext.close();
      await signOut(page, info, lang).catch(() => undefined);
      await context.close();
    }
  });

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
      await manager.waitForTimeout(450); // ⚠️ 01d v1.3.9 §8.1 (QA-R2, BUG-13): the answer pad ignores taps for 400 ms after it opens
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

  // ⚠️ 02b-TK L-CLIENT-4 item 4 (02b v1.0.25 §6.16 (R3-M-8); D2; test 87): open-orders rows carry the hub's
  // `unpaid_handover_approved`, and the client treats it as authoritative (orders/unpaid/candidate.ts gateOf / dueGate,
  // requests.ts seed). After the approval the page is RELOADED, so the approval the UnpaidHandoverApproved frame left in
  // memory is gone: the row alone must show the order approved (Hand over all live, no Ask a manager), and the
  // hand-over goes through (MarkServed with customer_handover: true answers 200; the line reads Given).
  test(`[02b v1.0.25 §6.16 (R3-M-8); D2; test 87] an unpaid hand-over approval survives a reload through open-orders unpaid_handover_approved (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const managerContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    const manager = await managerContext.newPage();
    await signInOn(page, deviceFor(info), lang);
    try {
      await takeawayTab(page);
      await menuTile(page, NAAN.name).click();
      await sendCart(page, lang);
      const token = await sentToken(page);
      await kitchenReady(request, token, [NAAN.item_id]);
      await expect(readyTile(page, token)).toBeVisible({ timeout: 15_000 });
      const order_id = await askAndApprove(page, manager, info, lang, token);
      await expect(drawer(page).getByRole('button', { name: tr(lang, 'v.collected') })).toHaveAttribute('aria-disabled', 'false', { timeout: 30_000 });

      // reload: the in-memory approval (and the memory-only session) is gone; Ali signs in again and open-orders is read
      await page.reload();
      const rows = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/queries/open-orders') && r.status() === 200);
      await signInOn(page, deviceFor(info), lang);
      await takeawayTab(page);
      const row = ((await (await rows).json()) as { data: { orders: Array<{ order_id: string; unpaid_handover_approved?: boolean }> } }).data.orders.find((o) => o.order_id === order_id);
      expect(row?.unpaid_handover_approved).toBe(true);
      const tile = readyTile(page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      await expect(tile).toContainText(tr(lang, 'q.due'));
      await expect(tile.locator('[data-ask]')).toHaveCount(0);
      await openToken(page, token);
      const handOver = drawer(page).getByRole('button', { name: tr(lang, 'v.collected') });
      await expect(handOver).toHaveAttribute('aria-disabled', 'false');
      await expect(drawer(page).locator('[data-ask]')).toHaveCount(0);
      await capture(page, info, `UnpaidApprovedReload-${info.project.name}-${lang}`, drawer(page));

      const sent = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await handOver.click();
      await expect(page.locator('.tk-toast', { hasText: tr(lang, 't.collected') })).toBeVisible();
      const served = await sent;
      expect(served.status()).toBe(200);
      const payload = (served.request().postDataJSON() as { payload: { customer_handover?: boolean; lines: Array<{ order_id: string }> } }).payload;
      expect(payload.customer_handover).toBe(true);
      expect(payload.lines.map((l) => l.order_id)).toEqual([order_id]);
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-il', { hasText: NAAN.name }).locator('.tk-chip')).toHaveText(tr(lang, 'v.given'));
    } finally {
      await signOut(manager, info, lang).catch(() => undefined);
      await managerContext.close();
      await signOut(page, info, lang).catch(() => undefined);
      await context.close();
    }
  });
}
