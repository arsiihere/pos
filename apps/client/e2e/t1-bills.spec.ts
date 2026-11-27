import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { escapeRe, menuTile, rushOff, sentToken, shiftOpen, signInOn, takeawayTab } from './02b-support';
import { T1_CARD } from './t1-fixture';
import { apiSession, capture, closeAll, deviceFor, hubNow, LANGS, printedJob, queueEntry, screen, t1Run, t1RunsHere, tr, type ApiSession, type Lang } from './t1-support';

// L-E2E-T1 group C — the owner's dry-run checklist, bills at the takeaway counter against the e2e hub (05 v1.0.35
// §6.3, §6.3a, §6.5, §6.9, §6.12). The Owner runs the counter (take-payment, an open shift). Rows:
//   #6  pay a token by card on the counter machine, type the reference → the bill closes, the receipt prints, the
//       reference is saved
//   #9  open a token, add an item, press Check bill before sending → the paper says NOT SENT YET - CHECK BILL with
//       the new total
//   #10 bill Rs 1,000, take Rs 600, press Check bill → Total 1,000 · Already paid 600 · Remaining payable 400
//   #11 split a bill in two, pay and close one half → the other half still shows its own amount as due (not 0)

const drawer = (page: Page) => page.locator('section.tk-drawer');

async function counter(page: Page, lang: Lang, info: TestInfo): Promise<void> {
  await rushOff(page);
  await signInOn(page, deviceFor(info), lang, 'Owner');
  await shiftOpen(page, lang);
  await takeawayTab(page);
}

/** Sends the cart to pay later; the token and its order id (SubmitOrder's own). */
async function sendLater(page: Page, lang: Lang): Promise<{ token: string; order_id: string }> {
  const sent = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith('/commands/submit-order'));
  await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
  const order_id = ((await sent).postDataJSON() as { payload: { order_id: string } }).payload.order_id;
  return { token: await sentToken(page), order_id };
}

interface BillSplit {
  split_no: number;
  state: string;
  balance_minor: number;
  totals: { cash: { total_minor: number } };
  payments: Array<{ has_reference: boolean; mode_id: string }>;
}
const billOf = (api: ApiSession, order_id: string) => api.query<{ state: string; splits: BillSplit[] }>(`bill?order_id=${encodeURIComponent(order_id)}`);
const money = (minor: number): string => `Rs ${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

for (const lang of LANGS) {
  test(`[T1 #6] card payment with the machine's reference: the bill closes, the receipt prints, the reference is saved (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const api = await apiSession(request, 'S_OWNER');
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      const { token, order_id } = await sendLater(page, lang);
      await (await queueEntry(page, token)).click();
      await drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      await panel.locator('.tk-mode', { hasText: T1_CARD.name }).click();
      await panel.locator('input.tk-input').fill('REF-88213');
      const since = await hubNow();
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
      await expect(panel.getByText(tr(lang, 'p.next'))).toBeVisible();
      await capture(page, info, `T1-06-card-${info.project.name}-${lang}`, panel);
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
      await printedJob(since, 'Receipt');
      const bill = await billOf(api, order_id);
      expect(bill.state).toBe('closed');
      expect(bill.splits[0]!.payments).toEqual([expect.objectContaining({ mode_id: T1_CARD.mode_id, has_reference: true })]);
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #9] add items to a token, Check bill before sending: NOT SENT YET - CHECK BILL with the new total (${lang}) @gap`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      const { token } = await sendLater(page, lang);
      await (await queueEntry(page, token)).click();
      await drawer(page).getByRole('button', { name: tr(lang, 'v.add') }).click();
      await menuTile(page, run.items.drink.name).click();
      const since = await hubNow();
      // 05 §6.3a (R2-M-6): an addition cart's Check bill is PrintCartCheckBill { draft: { …, adds_to_order_id } }
      const asked = page.waitForRequest((r) => r.method() === 'POST' && /\/commands\/print-(cart-)?check-bill$/.test(r.url()));
      await page.locator('.cart').getByRole('button', { name: tr(lang, 'billing.check_bill') }).click();
      expect((await asked).url(), 'the addition cart sends PrintCartCheckBill (05 §6.3a)').toMatch(/print-cart-check-bill$/);
      const paper = await printedJob(since, 'Check bill (not sent)');
      expect(paper.text.split('\n')[0]!.trim()).toBe('NOT SENT YET - CHECK BILL');
      expect(paper.text).toContain('Includes items not sent yet');
      expect(paper.text).toContain(run.items.drink.name.slice(0, 12));
    } finally {
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #10] a partly paid token's check bill: Total · Already paid · Remaining payable (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const api = await apiSession(request, 'S_OWNER');
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      await menuTile(page, run.items.main.name).click();
      const { token, order_id } = await sendLater(page, lang);
      const total = (await billOf(api, order_id)).splits[0]!.totals.cash.total_minor;
      const part = Math.round((total * 0.6) / 100) * 100;
      const paid = await api.command('AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: part, tendered_minor: part });
      expect(paid.status, JSON.stringify(paid.body.error)).toBe(200);
      await (await queueEntry(page, token)).click();
      const since = await hubNow();
      await drawer(page).getByRole('button', { name: tr(lang, 'billing.check_bill') }).click();
      // the fixed hub clock stamps other runs' check bills with the same time: this token's own
      const paper = await printedJob(since, 'Check bill', new RegExp(`^#${token}\\s`, 'm'));
      const line = (label: string) => paper.text.split('\n').find((l) => l.startsWith(label)) ?? '';
      expect(line('Total if paid in cash')).toContain(money(total).replace('Rs ', ''));
      expect(line('Already paid')).toContain(money(part).replace('Rs ', ''));
      expect(line('Remaining payable')).toContain(money(total - part).replace('Rs ', ''));
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #11] split in two, pay and close one half: the other half still shows its own amount due (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const api = await apiSession(request, 'S_OWNER');
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      await menuTile(page, run.items.main.name).click();
      const { token, order_id } = await sendLater(page, lang);
      const split = await api.command('SetSplits', { bill_ref: { order_id }, mode: 'equal', n: 2 });
      expect(split.status, JSON.stringify(split.body.error)).toBe(200);
      const one = (await billOf(api, order_id)).splits.find((s) => s.split_no === 1)!;
      const pay = await api.command('AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: one.balance_minor, tendered_minor: one.balance_minor });
      expect(pay.status, JSON.stringify(pay.body.error)).toBe(200);
      const close = await api.command('CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: one.totals.cash.total_minor });
      expect(close.status, JSON.stringify(close.body.error)).toBe(200);
      const two = (await billOf(api, order_id)).splits.find((s) => s.split_no === 2)!;
      expect(two.state).toBe('open');
      expect(two.balance_minor).toBeGreaterThan(0);
      // the counter: the token is still Due for the other half's own amount, not 0
      await (await queueEntry(page, token)).click();
      await expect(drawer(page).locator('.tk-fact--due')).toBeVisible();
      await expect(drawer(page)).toContainText(money(two.balance_minor).replace('Rs ', ''));
      // the bill screen: split 2 open with its own amount
      await page.evaluate((id) => (window.location.hash = `#/bill?order_id=${id}`), order_id);
      await expect(page.locator('main')).toContainText(money(two.balance_minor).replace('Rs ', ''));
      await capture(page, info, `T1-11-split-${info.project.name}-${lang}`);
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });
}
