import { expect, test, type APIRequestContext, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import { adminCommand } from './03b-support';
import { deviceFor, escapeRe, KITCHEN, LANGS, menuTile, railEntry, readyTile, rushOff, sentToken, shiftOpen, signInOn, signOut, takeawayTab, tr } from './02b-support';

// ⚠️ 02b-TK L-CLIENT-3 item 1 (05 v1.0.35 §6.3, §6.3a, §6.22, §8; 02b v1.0.25 §8 OR-5 / R6, test row 73; D9; 05 #60h):
// against the e2e hub, nothing mocked. The Owner (every permission) at the counter (kiosk column, landscape tablet):
// an unsent cart's "Print check bill" → PrintCartCheckBill { draft } (no ids) → the hub prints it (a `document` job on
// the run's device bill route) and answers the paper's gross and remaining payable; after Send · pay later the token's
// "Print check bill" → PrintCheckBill { bill_ref: { order_id } }; once paid, "Print receipt again" →
// PrintBillDocument { receipt }. The run routes this device's bills to the e2e fake LAN printer (03b-fixture
// `PR-E2E`, "Kitchen printer") with the admin SetBillRoute, and removes the route again at the end.

const NAAN = KITCHEN.naan;
const printerId = 'PR-E2E'; // 03b-fixture.ts printerId (the fake LAN printer, 80 mm)
const PRINTER = 'Kitchen printer'; // 03b-fixture seed03 PrinterSaved
const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway counter runs at the kiosk and landscape tablet viewports');
  test.setTimeout(90_000);
};

const drawer = (page: Page) => page.locator('section.tk-drawer');
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });

async function capture(page: Page, info: TestInfo, name: string, what?: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(`${name}.png`);
  if (what === undefined) await page.screenshot({ path });
  else await what.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

/** 03c §6.13 SetBillRoute { scope: 'device' }: this run's device prints its bills on `printer_id` (null removes it). */
async function deviceRoute(request: APIRequestContext, device_id: string, printer_id: string | null): Promise<void> {
  const done = await adminCommand(request, 'set-bill-route', 'SetBillRoute', { scope: 'device', ref_id: device_id, printer_id });
  expect(done.status, `SetBillRoute ${JSON.stringify(done.body)}`).toBe(200);
}

const command = (page: Page, path: string) => page.waitForResponse((r: Response) => r.request().method() === 'POST' && r.url().endsWith(`/commands/${path}`));
type Sent<P> = { command_type: string; payload: P };
const resultOf = async <R,>(r: Response) => ((await r.json()) as { data: { result: R } }).data.result;

/** A non-ready token's row is in the landscape strip's queue (02b-TK C2-1); the kiosk column lists it. */
async function openToken(page: Page, token: string): Promise<void> {
  const strip = page.locator('.tk-rstrip');
  if ((await strip.count()) > 0 && (await readyTile(page, token).count()) === 0 && (await railEntry(page, token).count()) === 0) await strip.locator('.tk-rstrip__q').click();
  await railEntry(page, token).first().click();
  await expect(drawer(page)).toBeVisible();
}

for (const lang of LANGS) {
  test(`[05 v1.0.35 §6.3a, §6.3, §6.22, §8 OR-5; D9; #60h] cart check bill before Send, the Due token's check bill, Print receipt again once paid (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const device = deviceFor(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await rushOff(page);
    await deviceRoute(request, device.device_id, printerId);
    await signInOn(page, device, lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeawayTab(page);
      const cart = page.locator('.cart');
      const check = cart.getByRole('button', { name: tr(lang, 'billing.check_bill') });
      await expect(check).toHaveCount(0); // an empty cart prints nothing
      await menuTile(page, NAAN.name).click();

      // 1. the unsent cart → PrintCartCheckBill { draft }, printed on the route's printer, gross and remaining payable
      const cartPrint = command(page, 'print-cart-check-bill');
      await check.click();
      const cartAnswer = await cartPrint;
      expect(cartAnswer.status()).toBe(200);
      const sent = cartAnswer.request().postDataJSON() as Sent<{ draft: Record<string, unknown> & { lines: Array<Record<string, unknown>> }; printer_id?: string }>;
      expect(sent.command_type).toBe('PrintCartCheckBill');
      expect(Object.keys(sent.payload)).toEqual(['draft']);
      expect(sent.payload.draft).toMatchObject({ order_type: 'takeaway', lines: [{ item_id: NAAN.item_id, quantity: 1 }] });
      expect(sent.payload.draft).not.toHaveProperty('order_id');
      expect(sent.payload.draft).not.toHaveProperty('adds_to_order_id');
      expect(sent.payload.draft.lines[0]).not.toHaveProperty('order_item_id');
      const printed = await resultOf<{ printed: boolean; job_id: string | null; printer_name: string | null; totals_default: { total_minor: number }; due_minor: number }>(cartAnswer);
      expect(printed).toMatchObject({ printed: true, printer_name: PRINTER });
      expect(printed.job_id).toMatch(/^[0-9A-Z]{26}$/);
      expect(printed.totals_default.total_minor).toBeGreaterThan(0);
      expect(printed.due_minor).toBe(printed.totals_default.total_minor); // a plain draft: one unpaid split
      const sentTo = tr(lang, 'billing.check_sent', { printer: PRINTER });
      const [gross, due] = tr(lang, 'billing.check_amounts').split('{due}')[0]!.split('{gross}');
      // an Urdu sentence isolates its money (FSI … PDI, L-CLIENT-6b fill): the amounts may sit inside U+2068 … U+2069
      await expect(toast(page, sentTo)).toContainText(new RegExp(`${escapeRe(gross!)}\u2068?Rs [\\d,.]+\u2069?${escapeRe(due!)}\u2068?Rs [\\d,.]+\u2069?`));
      await capture(page, info, `CartCheckBill-${info.project.name}-${lang}`);

      // 2. Send · pay later → the Due token's Print check bill = PrintCheckBill { bill_ref: { order_id: newest } }
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(page);
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-fact--due')).toBeVisible();
      const duePrint = command(page, 'print-check-bill');
      await drawer(page).getByRole('button', { name: tr(lang, 'billing.check_bill') }).click();
      const dueAnswer = await duePrint;
      expect(dueAnswer.status()).toBe(200);
      const dueSent = dueAnswer.request().postDataJSON() as Sent<{ bill_ref: { order_id: string } }>;
      expect(dueSent.payload).toEqual({ bill_ref: { order_id: expect.stringMatching(/^[0-9A-Z]{26}$/) as unknown as string } });
      expect(await resultOf<{ printed: boolean; printer_name: string }>(dueAnswer)).toMatchObject({ printed: true, printer_name: PRINTER });
      await expect(toast(page, sentTo)).toBeVisible();
      await expect(drawer(page).getByRole('button', { name: tr(lang, 'billing.receipt_again') })).toHaveCount(0);

      // 3. pay it (cash, exact) → the paid token's action is Print receipt again = PrintBillDocument { receipt }
      await drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
      await page.keyboard.press('Enter');
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
      await expect(panel).toHaveCount(0);
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-fact--paid')).toBeVisible();
      await expect(drawer(page).getByRole('button', { name: tr(lang, 'billing.check_bill') })).toHaveCount(0);
      const again = drawer(page).getByRole('button', { name: tr(lang, 'billing.receipt_again') });
      const reprint = command(page, 'print-bill-document');
      await again.click();
      const reprinted = await reprint;
      expect(reprinted.status()).toBe(200);
      expect((reprinted.request().postDataJSON() as Sent<{ doc: string; ref_id: string }>).payload).toMatchObject({ doc: 'receipt', ref_id: expect.any(String) as unknown as string });
      expect(await resultOf<{ printed: boolean; printer_name: string }>(reprinted)).toMatchObject({ printed: true, printer_name: PRINTER });
      await expect(toast(page, tr(lang, 'billing.print.reprint_sent', { printer: PRINTER }))).toBeVisible();
      await capture(page, info, `ReceiptAgain-${info.project.name}-${lang}`);
    } finally {
      await signOut(page, info, lang).catch(() => undefined);
      await context.close();
      await deviceRoute(request, device.device_id, null);
    }
  });
}

