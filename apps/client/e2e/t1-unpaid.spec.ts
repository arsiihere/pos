import { expect, test, type Locator, type Page } from '@playwright/test';
import { dialog, menuTile, rushOff, sendCart, sentToken, signInOn, takeawayTab } from './02b-support';
import { t1Station } from './t1-fixture';
import { capture, closeAll, cookLine, deviceFor, hubFire, LANGS, managerPhone, queueEntry, passCard, passTablet, screen, t1Run, t1RunsHere, tr, type Lang, type T1Run } from './t1-support';

// L-E2E-T1 group B — the owner's dry-run checklist, the unpaid hand-over (02b v1.0.25 §3.7a, §6.4, §6.4a, §8 OR-7; D2)
// as one journey on three devices against the e2e hub: Ali at the counter (order-taker: no take-payment) sends a token
// to pay later; Pervez at the run's Pass tablet cooks it; the Manager answers on the Manager's own phone (listed). Rows:
//   #22 Handed to customer on a Due (unpaid) order → blocked, "Ask a manager"; nothing handed over
//   #23 Ask a manager; the manager approves with PIN on the phone → the Pass can hand it over
//   #24 after the approval an item is added to that token → the approval is cleared; a new approval is needed
//   #25 Ask a manager; the manager declines → "Manager said no"; the hand-over stays blocked

const MANAGER_PIN = '0123';

/** Ali sends the run's main to pay later; the line fires; Pervez cooks it on the Pass. Returns the token. */
async function dueAndReady(cash: Page, pass: Page, run: T1Run, lang: Lang, info: Parameters<typeof deviceFor>[0]): Promise<string> {
  await rushOff(cash);
  await signInOn(cash, deviceFor(info), lang);
  await takeawayTab(cash);
  await menuTile(cash, run.items.main.name).click();
  // Ali has no take-payment: his cart sends with plain Send (the token is Due)
  await sendCart(cash, lang);
  const token = await sentToken(cash);
  await hubFire(t1Station(run.key));
  await passTablet(pass, 'unpaid', info, lang);
  const card = passCard(pass, token);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await cookLine(card, run.items.main.name);
  await expect(card).toHaveClass(/\bready\b/);
  // ⚠️ 03b v1.0.17 §8: one primary per state — Bag ready first; then "Handed to customer" is the card's action
  await card.locator('.pc__f .btn--ready').click();
  await expect(card.locator('.btn--customer')).toBeVisible();
  return token;
}

/** ⚠️ 03b v1.0.17 §8: the card's Ask a manager opens the sheet (the per-order breakdown); its Ask sends; then it closes */
async function askManager(pass: Page, card: Locator): Promise<void> {
  await card.locator('[data-ask]').click();
  const sheet = pass.locator('.pass-ask');
  await sheet.locator('[data-ask-send]').click();
  await expect(sheet.locator('[data-ask-send]')).toHaveCount(0);
  await sheet.locator('.dlg__x').click();
  await expect(sheet).toHaveCount(0);
}

/** The Manager's phone: Requests → the "Hand over unpaid #N" card → Approve or Reject; both ask the PIN (needs_pin always). */
async function answer(phone: Page, lang: Lang, token: string, decision: 'approve' | 'reject'): Promise<void> {
  await phone.getByRole('button', { name: new RegExp(tr(lang, 'alerts.nav.requests')) }).or(phone.getByRole('link', { name: new RegExp(tr(lang, 'alerts.nav.requests')) })).first().click();
  const title = tr(lang, 'alert.hand_over_unpaid.card', { identifier: `#${token}` });
  await phone.getByText(title).first().click();
  const sheet = dialog(phone);
  await expect(sheet).toContainText(title);
  const word = tr(lang, decision === 'approve' ? 'answer.approve' : 'answer.reject');
  await sheet.getByRole('button', { name: word }).click();
  const keys = phone.locator('.pin__keys');
  for (const d of MANAGER_PIN) await keys.locator('.btn', { hasText: new RegExp(`^${d}$`) }).click();
  await keys.getByRole('button', { name: word }).click();
  await expect(phone.getByText(tr(lang, decision === 'approve' ? 'answer.done_approved' : 'answer.done_rejected')).first()).toBeVisible();
}

for (const lang of LANGS) {
  test(`[T1 #22 #23] a Due bag at the Pass: Handed to customer blocked, Ask a manager → the manager approves with PIN on the phone → handed over (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('unpaid', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    const phone = await screen(browser, { width: 390, height: 844 });
    const served: Array<{ customer_handover?: boolean }> = [];
    pass.page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().endsWith('/commands/mark-served')) served.push((r.postDataJSON() as { payload: { customer_handover?: boolean } }).payload);
    });
    try {
      const token = await dueAndReady(cash.page, pass.page, run, lang, info);
      const card = passCard(pass.page, token);
      // #22: Due, unapproved → greyed, "Take payment first", Ask a manager; nothing handed over
      const button = card.locator('.btn--customer');
      await expect(button).toBeDisabled();
      await expect(card.locator('.pc__why')).toHaveText(tr(lang, 'pass.take_payment_first'));
      await expect(card.locator('[data-ask]')).toHaveText(tr(lang, 'pass.ask_manager'));
      expect(served).toEqual([]);
      await capture(pass.page, info, `T1-22-blocked-${info.project.name}-${lang}`, card);

      // #23: Ask → the Manager approves with PIN on the phone → the Pass hands it over (customer_handover)
      await askManager(pass.page, card);
      await expect(card).toContainText(tr(lang, 'pass.waiting_manager'));
      await managerPhone(phone.page, lang);
      await answer(phone.page, lang, token, 'approve');
      await expect(button).toBeEnabled({ timeout: 30_000 });
      await button.click();
      await expect(card).toHaveCount(0, { timeout: 20_000 });
      expect(served.at(-1)?.customer_handover).toBe(true);
      // the counter: still owed (a Due order stays open until paid), its line handed over
      await (await queueEntry(cash.page, token)).click();
      await expect(cash.page.locator('section.tk-drawer .tk-il', { hasText: run.items.main.name }).locator('.tk-chip')).toHaveText(tr(lang, 'v.given'), { timeout: 15_000 });
    } finally {
      await closeAll(info, lang, phone, pass, cash);
    }
  });

  test(`[T1 #24] the approval ends when the bill grows: an item added to the token after the approval → Ask a manager again (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('unpaid', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    const phone = await screen(browser, { width: 390, height: 844 });
    try {
      const token = await dueAndReady(cash.page, pass.page, run, lang, info);
      const card = passCard(pass.page, token);
      await askManager(pass.page, card);
      await managerPhone(phone.page, lang);
      await answer(phone.page, lang, token, 'approve');
      const button = card.locator('.btn--customer');
      await expect(button).toBeEnabled({ timeout: 30_000 });

      // Ali adds the drink to the token: the key's due rises above the approved amount (D2) → the approval is cleared
      await takeawayTab(cash.page);
      await (await queueEntry(cash.page, token)).click();
      await cash.page.locator('.tk-drawer').getByRole('button', { name: tr(lang, 'v.add') }).click();
      await menuTile(cash.page, run.items.drink.name).click();
      await cash.page.getByRole('button', { name: `${tr(lang, 'c.add_to')} ${token}` }).click();
      await expect(cash.page.locator('.tk-banner')).toHaveCount(0);
      // the token's card on the Pass (03b v1.0.17: the addition joins it): blocked again, a new approval is needed —
      // the drink cooks, so Bag ready is its one primary (no hand-over), and Ask a manager is offered again
      const root = card.filter({ hasText: run.items.main.name });
      await expect(root.locator('[data-ask]')).toHaveText(tr(lang, 'pass.ask_manager'), { timeout: 20_000 });
      await expect(root.locator('.btn--customer')).toHaveCount(0);
      await capture(pass.page, info, `T1-24-cleared-${info.project.name}-${lang}`, root);
    } finally {
      await closeAll(info, lang, phone, pass, cash);
    }
  });

  test(`[T1 #25] the manager says no: "Manager said no" on the Pass; the hand-over stays blocked (${lang})`, async ({ browser }, info) => {
    t1RunsHere(info);
    const run = t1Run('unpaid', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    const phone = await screen(browser, { width: 390, height: 844 });
    try {
      const token = await dueAndReady(cash.page, pass.page, run, lang, info);
      const card = passCard(pass.page, token);
      await askManager(pass.page, card);
      await managerPhone(phone.page, lang);
      await answer(phone.page, lang, token, 'reject');
      await expect(card).toContainText(tr(lang, 'pass.manager_rejected'), { timeout: 30_000 });
      await expect(card.locator('.btn--customer')).toBeDisabled();
      await capture(pass.page, info, `T1-25-rejected-${info.project.name}-${lang}`, card);
    } finally {
      await closeAll(info, lang, phone, pass, cash);
    }
  });
}
