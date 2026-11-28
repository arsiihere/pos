import { expect, test, type APIRequestContext, type Locator, type Page, type Response, type TestInfo } from '@playwright/test';
import { adminCommand } from './03b-support';
import { deviceFor, escapeRe, KITCHEN, LANGS, menuTile, railEntry, readyTile, rushOff, sentToken, signInOn, signOut, takeawayTab, tr } from './02b-support';

// ⚠️ 02b-TK L-CLIENT-3 item 2 (03c v1.0.16 §3.11, §6.14, §8; 02b v1.0.25 §3.2 steps 2b, 10a, 11 (R6); test 82; 03c test 65
// client part): against the e2e hub, nothing mocked. "Send · pay later" sends `takeaway.print_slip: true`; the hub
// queues the token slip in the SubmitOrder transaction on this device's bill route (the e2e fake LAN printer, set
// with SetBillRoute and removed at the end) and answers `slip: { printed: true, job_id }`; the sent toast says
// "Slip printing". The Due token's Print token sends PrintTakeawaySlip { order_id, reason: 'reprint' } and prints
// again. No QR (Tier 2: statusLink is null).

const NAAN = KITCHEN.naan;
const printerId = 'PR-E2E'; // 03b-fixture.ts printerId (the fake LAN printer, 80 mm)
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
  test(`[03c v1.0.16 §3.11, §6.14, §8; 02b v1.0.25 §3.2 steps 2b, 10a, 11; test 82] Send · pay later queues the token slip; Print token prints it again (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const device = deviceFor(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await rushOff(page);
    await deviceRoute(request, device.device_id, printerId);
    await signInOn(page, device, lang, 'Owner');
    try {
      await takeawayTab(page);
      await menuTile(page, NAAN.name).click();

      // Send · pay later → SubmitOrder { takeaway: { print_slip: true } } → slip queued in its transaction
      const submit = command(page, 'submit-order');
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const submitted = await submit;
      expect(submitted.status()).toBe(200);
      const sent = submitted.request().postDataJSON() as Sent<{ order_id: string; takeaway?: Record<string, unknown> }>;
      expect(sent.payload.takeaway).toEqual({ print_slip: true });
      const result = await resultOf<{ token: number; slip: { printed: boolean; job_id: string | null; skipped: string | null } }>(submitted);
      expect(result.slip).toMatchObject({ printed: true, skipped: null });
      expect(result.slip.job_id).toMatch(/^[0-9A-Z]{26}$/);
      const token = await sentToken(page);
      expect(token).toBe(String(result.token));
      await expect(page.locator('.toast').first()).toContainText(tr(lang, 'takeaway.slip.printing'));
      await capture(page, info, `SlipSent-${info.project.name}-${lang}`);

      // the Due token's Print slip (03c §8; L-CLIENT-6b) → PrintTakeawaySlip { order_id: newest, reason: 'reprint' }
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-fact--due')).toBeVisible();
      const reprint = command(page, 'print-takeaway-slip');
      await drawer(page).getByRole('button', { name: tr(lang, 'v.print_slip') }).click();
      const reprinted = await reprint;
      expect(reprinted.status()).toBe(200);
      expect((reprinted.request().postDataJSON() as Sent<unknown>).payload).toEqual({ order_id: sent.payload.order_id, reason: 'reprint' });
      const again = await resultOf<{ printed: boolean; job_id: string | null; skipped: string | null }>(reprinted);
      expect(again).toMatchObject({ printed: true, skipped: null });
      expect(again.job_id).not.toBe(result.slip.job_id);
      await expect(toast(page, tr(lang, 'takeaway.slip.printing'))).toBeVisible();
      await capture(page, info, `SlipReprint-${info.project.name}-${lang}`);
    } finally {
      await signOut(page, info, lang).catch(() => undefined);
      await context.close();
      await deviceRoute(request, device.device_id, null);
    }
  });
}

// ⚠️ 02b-TK L-CLIENT-4 item 2 (03c v1.0.16 §3.11 trigger 2, §6.14, §8; 02b v1.0.25 §3.2 step 10a): "Send & pay" sends no
// slip flag; its pay panel closed with the bill still open (Pay later) sends PrintTakeawaySlip { order_id, reason:
// 'pay_later' } once (not queued), the hub queues the slip job on this device's route and the toast says "Slip printing".
for (const lang of LANGS) {
  test(`[03c v1.0.16 §3.11 trigger 2, §6.14, §8; 02b v1.0.25 §3.2 step 10a] Send & pay closed unpaid prints the token slip (pay_later) (${lang})`, async ({ browser, request }, info) => {
    runsHere(info);
    const device = deviceFor(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await rushOff(page);
    await deviceRoute(request, device.device_id, printerId);
    await signInOn(page, device, lang, 'Owner');
    try {
      await takeawayTab(page);
      await menuTile(page, NAAN.name).click();

      const submit = command(page, 'submit-order');
      await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_pay'))}`) }).click();
      const submitted = await submit;
      expect(submitted.status()).toBe(200);
      const sent = submitted.request().postDataJSON() as Sent<{ order_id: string; takeaway?: Record<string, unknown> }>;
      expect(sent.payload.takeaway?.['print_slip']).toBeUndefined();
      expect((await resultOf<{ slip: unknown }>(submitted)).slip).toBeNull();
      const panel = page.locator('section.tk-paypanel');
      await expect(panel.locator('.tk-pay__due .money')).toHaveText(/Rs \d/);

      // the panel closed unpaid → PrintTakeawaySlip pay_later for the sent order
      const slip = command(page, 'print-takeaway-slip');
      await panel.getByRole('button', { name: tr(lang, 'p.later') }).click();
      await expect(panel).toHaveCount(0);
      const printed = await slip;
      expect(printed.status()).toBe(200);
      expect((printed.request().postDataJSON() as Sent<unknown>).payload).toEqual({ order_id: sent.payload.order_id, reason: 'pay_later' });
      const result = await resultOf<{ printed: boolean; job_id: string | null; skipped: string | null }>(printed);
      expect(result).toMatchObject({ printed: true, skipped: null });
      expect(result.job_id).toMatch(/^[0-9A-Z]{26}$/);
      await expect(toast(page, tr(lang, 'takeaway.slip.printing'))).toBeVisible();
      await capture(page, info, `SlipPayLater-${info.project.name}-${lang}`);
    } finally {
      await signOut(page, info, lang).catch(() => undefined);
      await context.close();
      await deviceRoute(request, device.device_id, null);
    }
  });
}
