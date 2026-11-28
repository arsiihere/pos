import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { escapeRe, menuTile, rushOff, sentToken, shiftOpen, signInOn, takeawayTab } from './02b-support';
import { T1_CARD } from './t1-fixture';
import { apiSession, capture, closeAll, deviceFor, LANGS, printedJob, printMark, queueEntry, screen, t1Run, t1RunsHere, tr, type ApiSession, type Lang } from './t1-support';

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
  // 05 v1.0.37 §6.1: the hub's dues of the split
  dues?: { cash_due_minor: number };
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
      const mark = await printMark();
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
      await expect(panel.getByText(tr(lang, 'p.next'))).toBeVisible();
      await capture(page, info, `T1-06-card-${info.project.name}-${lang}`, panel);
      await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
      await printedJob(mark, 'Receipt');
      const bill = await billOf(api, order_id);
      expect(bill.state).toBe('closed');
      expect(bill.splits[0]!.payments).toEqual([expect.objectContaining({ mode_id: T1_CARD.mode_id, has_reference: true })]);
    } finally {
      await api.close();
      await closeAll(info, lang, cash);
    }
  });

  test(`[T1 #9] add items to a token, Check bill before sending: NOT SENT YET - CHECK BILL with the new total (${lang})`, async ({ browser }, info) => {
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
      const mark = await printMark();
      // 05 §6.3a (R2-M-6): an addition cart's Check bill is PrintCartCheckBill { draft: { …, adds_to_order_id } }
      const asked = page.waitForRequest((r) => r.method() === 'POST' && /\/commands\/print-(cart-)?check-bill$/.test(r.url()));
      await page.locator('.cart').getByRole('button', { name: tr(lang, 'billing.check_bill') }).click();
      expect((await asked).url(), 'the addition cart sends PrintCartCheckBill (05 §6.3a)').toMatch(/print-cart-check-bill$/);
      const paper = await printedJob(mark, 'Check bill (not sent)');
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
      const first = (await billOf(api, order_id)).splits[0]!;
      const total = first.totals.cash.total_minor;
      const part = Math.round((total * 0.6) / 100) * 100;
      // 05 v1.0.37 §6.9 (R2-1): the due the bill showed
      const paid = await api.command('AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: part, expected_due_minor: first.dues?.cash_due_minor ?? total, tendered_minor: part });
      expect(paid.status, JSON.stringify(paid.body.error)).toBe(200);
      await (await queueEntry(page, token)).click();
      const mark = await printMark();
      await drawer(page).getByRole('button', { name: tr(lang, 'billing.check_bill') }).click();
      // the fixed hub clock stamps other runs' check bills with the same time: this token's own
      const paper = await printedJob(mark, 'Check bill', new RegExp(`^#${token}\\s`, 'm'));
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
      const pay = await api.command('AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: one.balance_minor, expected_due_minor: one.dues?.cash_due_minor ?? one.balance_minor, tendered_minor: one.balance_minor });
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
  // ⚠️ 05 v1.0.37 §6.9, §8 (owner 2026-11-28 QA-R2, R2-1; QA BUG-1 BLOCKER), test #21f e2e: two devices — the counter's
  // pay panel is open on a token while another device adds to it; the panel shows the new amount at once, clears
  // Customer gave, and the payment taken is the new due, once (never "Paid Rs 80 · Give change Rs 120").
  test(`[QA-R2 BUG-1] a pay panel open while another device adds to the token: "Bill changed — now …", Customer gave cleared, one payment of the new due (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('bag', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const other = await apiSession(request, 'S_OWNER');
    try {
      await counter(cash.page, lang, info);
      const page = cash.page;
      await menuTile(page, run.items.main.name).click();
      const { token, order_id } = await sendLater(page, lang);
      const first = (await billOf(other, order_id)).splits[0]!;
      const was = first.dues?.cash_due_minor ?? first.balance_minor;
      await (await queueEntry(page, token)).click();
      await drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) }).click();
      const panel = page.locator('.cart .tk-paypanel');
      await expect(panel.locator('.tk-pay__due .money')).toHaveText(money(was));
      const given = panel.locator('.tk-tendered input');
      await given.fill(String(Math.ceil(was / 100) + 100));
      await expect(panel.locator('.tk-change')).toBeVisible();

      // device B: "Add to token"
      const added = await other.command('SubmitOrder', { order_id: `${order_id}-R2`, order_type: 'takeaway', adds_to_order_id: order_id, lines: [{ order_item_id: `${order_id}-R2-L`, item_id: run.items.main.item_id, quantity: 1 }] });
      expect(added.status, JSON.stringify(added.body.error)).toBe(200);
      const now = (await billOf(other, order_id)).splits[0]!;
      const due = now.dues?.cash_due_minor ?? now.balance_minor;
      expect(due).toBeGreaterThan(was);

      await expect(panel.locator('.tk-pay__due .money')).toHaveText(money(due));
      await expect(panel.locator('.tk-pay__b [role="status"]')).toContainText(money(due).replace('Rs ', ''));
      await expect(given).toHaveValue('');
      await expect(panel.locator('.tk-change')).toHaveCount(0);
      const paid = panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) });
      await expect(paid).toHaveAttribute('aria-disabled', 'true');
      await capture(page, info, `QA-R2-BUG1-changed-${info.project.name}-${lang}`, panel);

      // the cashier takes the new amount: one payment, the bill closed, no change owed
      const sent: Array<{ amount_minor: number; expected_due_minor: number }> = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && r.url().endsWith('/commands/add-payment')) sent.push((r.postDataJSON() as { payload: { amount_minor: number; expected_due_minor: number } }).payload);
      });
      await panel.locator('.tk-notes button').first().click();
      await paid.click();
      await expect(panel.getByText(tr(lang, 'p.next'))).toBeVisible();
      await expect(panel.locator('.tk-change')).toHaveCount(0);
      expect(sent).toEqual([expect.objectContaining({ amount_minor: due, expected_due_minor: due })]);
      const bill = await billOf(other, order_id);
      expect(bill.state).toBe('closed');
      expect(bill.splits[0]!.payments).toHaveLength(1);
    } finally {
      await other.close();
      await closeAll(info, lang, cash);
    }
  });
}
