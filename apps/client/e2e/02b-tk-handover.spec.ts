import { expect, test, type Page, type Request, type TestInfo } from '@playwright/test';
import {
  kitchenPull,
  kitchenReady,
  KITCHEN,
  deviceFor,
  escapeRe,
  LANGS,
  menuTile,
  railEntry,
  readyTile,
  sendCart,
  sentToken,
  shiftOpen,
  signInOn,
  signOut,
  takeawayTab,
  tr,
  type Lang,
} from './02b-support';

// 02b-TK C2-2 (02b v1.0.24 §3.7, §6.4; 05 v1.0.34 §6.1, B16; ruling R2; frames TokenReady, TokenPartial, TokenDue,
// HandoverUndo): the hand-over at the takeaway counter against the e2e hub, with the kitchen driven through the hub
// (02b-support `kitchenReady` / `kitchenPull`: the Cook's Pass and kitchen-screen commands). No request is mocked; MarkServed requests are
// only watched.
//   a. Hand over + 5 s Undo: Undo keeps the token in Ready and nothing is sent; the next hand-over sends MarkServed
//      after the window and the token leaves the queue.
//   b. Give ready items now: one line of two is ready → only it is served; the token stays (part given) with the other
//      line; when the rest is ready it is paid and handed over, and the token leaves the queue.
//   b2. Owner ruling 2026-11-24 #1: one line ready, one not yet sent to the kitchen (never fired, never pulled) →
//      Give ready items now, no Hand over all; the ready line is given and the token stays.
//   c. A Due token: Hand over greyed with "Take payment first" for Ali and for the Owner alike (R2; owner ruling
//      2026-11-24 #2: no manager override in the pilot) → the Owner takes cash → Paid → Hand over → handed over.
// The Owner (every permission) takes the money with an open shift (05 B11); Ali (order-taker role: take-order,
// mark-served, no take-payment) cannot.
// Flow b orders Naan (5 min) and Kheer (1 min, global-setup): Kheer fires 4 min after Naan, and only a fired line can be
// handed over (stage.ts servable), so the kitchen pulls Kheer onto Now first (GiveMeMore, `kitchenPull`); Naan is made
// ready at the Pass, Kheer later on the kitchen screen's StartItem / DoneItem (`kitchenReady`).

const { naan: NAAN, kheer: KHEER } = KITCHEN;
const UNDO_MS = 5_000; // apps/client/src/features/staff/orders/takeaway/handover.ts UNDO_MS

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the takeaway counter hand-over runs at the kiosk and landscape tablet viewports');
  // sign-ins, the kitchen, payments and two 5 s Undo windows
  test.setTimeout(90_000);
};

/** MarkServed commands the page sends (watched, never answered by the test). */
function watchServed(page: Page): Array<{ lines: Array<{ order_id: string; order_item_ids: string[] }> }> {
  const sent: Array<{ lines: Array<{ order_id: string; order_item_ids: string[] }> }> = [];
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().endsWith('/commands/mark-served')) sent.push((r.postDataJSON() as { payload: (typeof sent)[number] }).payload);
  });
  return sent;
}

/** The ids of every line a list of MarkServed payloads served. */
const servedIds = (sent: ReturnType<typeof watchServed>) => sent.flatMap((p) => p.lines.flatMap((l) => l.order_item_ids));

/** The landscape tablet shows the ready strip and keeps the cooking rows behind "All orders" (frame HomeTablet). */
async function openToken(page: Page, token: string): Promise<void> {
  const strip = page.locator('.tk-rstrip');
  if ((await strip.count()) > 0 && (await readyTile(page, token).count()) === 0) await strip.locator('.tk-rstrip__q').click();
  await railEntry(page, token).first().click();
  await expect(page.locator('section.tk-drawer')).toBeVisible();
}

const drawer = (page: Page) => page.locator('section.tk-drawer');
const drawerLine = (page: Page, name: string) => drawer(page).locator('.tk-il', { hasText: name });
const closeDrawer = (page: Page, lang: Lang) => drawer(page).getByRole('button', { name: tr(lang, 'common.close') }).first().click();

/** The items sent unpaid — Send · pay later (a person who takes payment, C3-1), else Send to kitchen: the token. */
async function sendLater(page: Page, lang: Lang, names: readonly string[], payer: boolean): Promise<string> {
  for (const name of names) await menuTile(page, name).click();
  if (payer) await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
  else await sendCart(page, lang);
  return sentToken(page);
}

/** The drawer's Take payment → cash Exact → Next customer (05 §6.9, §6.12). */
async function payCash(page: Page, lang: Lang, token: string): Promise<void> {
  await drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) }).click();
  const panel = page.locator('.cart .tk-paypanel');
  await expect(panel.locator('.tk-pay__h .tk-tok')).toHaveText(token);
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
  await page.keyboard.press('Enter');
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
  await expect(panel).toHaveCount(0);
}

/** The hand-over toast of the token ("48 handed over · Undo"). */
const undoToast = (page: Page, lang: Lang, token: string) => page.locator('.tk-toast', { hasText: tr(lang, 't.collected') }).filter({ hasText: new RegExp(`^\\s*${token}\\b`) });

for (const lang of LANGS) {
  test(`[02b-TK C2-2; 02b §6.4] Hand over, Undo within 5 s keeps the token; the next hand-over serves it (${lang})`, async ({ page, request }, info) => {
    runsHere(info);
    const sent = watchServed(page);
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeawayTab(page);
      const token = await sendLater(page, lang, [NAAN.name], true);
      await kitchenReady(request, token, [NAAN.item_id]);
      // the token is ready: pay it (a paid ready tile hands over in one tap)
      await expect(readyTile(page, token)).toBeVisible({ timeout: 15_000 });
      await openToken(page, token);
      await payCash(page, lang, token);
      const tile = readyTile(page, token);
      await expect(tile.locator('.tk-chip--ok')).toBeVisible();
      const handOver = tile.getByRole('button', { name: tr(lang, 'q.collect') });

      // 1. Hand over → the toast with Undo, the tile gone; Undo inside the window → the tile is back
      await handOver.click();
      const toast = undoToast(page, lang, token);
      await expect(toast).toBeVisible();
      await expect(tile).toHaveCount(0);
      await toast.getByRole('button', { name: tr(lang, 't.undo') }).click();
      await expect(toast).toHaveCount(0);
      await expect(tile).toBeVisible();
      // the window passes: nothing was sent (Undo = the command is never sent, §6.4) and the token stays Ready
      await page.waitForTimeout(UNDO_MS + 1_000);
      expect(sent, 'no MarkServed after Undo').toHaveLength(0);
      await expect(tile).toBeVisible();

      // 2. Hand over again and let the window pass → MarkServed (the hub answers 200) → the token leaves the queue
      const served = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await handOver.click();
      await expect(toast).toBeVisible();
      expect((await served).status()).toBe(200);
      await expect(toast).toHaveCount(0);
      expect(sent).toHaveLength(1);
      await expect(railEntry(page, token)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK C2-2; 02b §3.7, §6.4] Give ready items now serves the ready line only, then the rest (${lang})`, async ({ page, request }, info) => {
    runsHere(info);
    const sent = watchServed(page);
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeawayTab(page);
      const token = await sendLater(page, lang, [NAAN.name, KHEER.name], true);
      await kitchenPull(request, KHEER.station_id);
      const [first] = await kitchenReady(request, token, [NAAN.item_id]);
      // one of two ready: the token cooks on; its view offers Give ready items now · 1× the ready one
      await openToken(page, token);
      await expect(drawerLine(page, NAAN.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.ready'));
      await expect(drawerLine(page, KHEER.name).locator('.tk-chip')).not.toHaveText(tr(lang, 'v.ready'));
      const give = drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.give_ready'))}`) });
      await expect(give).toContainText(NAAN.name);
      const served = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await give.click();
      await expect(undoToast(page, lang, token)).toBeVisible();
      expect((await served).status()).toBe(200);
      expect(servedIds(sent)).toEqual([first]);

      // the token stays (part given) with the other line cooking
      const tile = readyTile(page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      await expect(tile).toContainText(tr(lang, 'q.part'));
      await openToken(page, token);
      await expect(drawerLine(page, NAAN.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.given'));
      await expect(drawerLine(page, KHEER.name).locator('.tk-chip')).not.toHaveText(tr(lang, 'v.given'));
      await expect(drawer(page).getByRole('button', { name: tr(lang, 'v.collected') })).toHaveAttribute('aria-disabled', 'true');
      await closeDrawer(page, lang);

      // the rest is ready: paid, then Hand over all serves the other line only, and the token leaves the queue
      const [second] = await kitchenReady(request, token, [KHEER.item_id]);
      await openToken(page, token);
      await expect(drawerLine(page, KHEER.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.ready'));
      await payCash(page, lang, token);
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-fact--paid')).toBeVisible();
      const rest = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await drawer(page).getByRole('button', { name: tr(lang, 'v.collected') }).click();
      await expect(undoToast(page, lang, token)).toBeVisible();
      expect((await rest).status()).toBe(200);
      expect(servedIds(sent)).toEqual([first, second]);
      await expect(railEntry(page, token)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b §3.7, §6.4; owner ruling 2026-11-24 #1] a line not yet sent to the kitchen: Give ready items now, no Hand over all (${lang})`, async ({ page, request }, info) => {
    runsHere(info);
    const sent = watchServed(page);
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeawayTab(page);
      const token = await sendLater(page, lang, [NAAN.name, KHEER.name], true);
      // Naan is fired at Send and made ready; Kheer fires 4 min later — never fired, never pulled (not sent to the kitchen)
      const [first] = await kitchenReady(request, token, [NAAN.item_id]);
      await openToken(page, token);
      await expect(drawerLine(page, NAAN.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.ready'));
      await expect(drawerLine(page, KHEER.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.waiting'));
      const give = drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.give_ready'))}`) });
      await expect(give).toContainText(NAAN.name);
      await expect(drawer(page).getByRole('button', { name: tr(lang, 'v.collected') })).toHaveCount(0);
      // give the ready line: only it is served; the token stays with the unsent line
      const served = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await give.click();
      await expect(undoToast(page, lang, token)).toBeVisible();
      expect((await served).status()).toBe(200);
      expect(servedIds(sent)).toEqual([first]);
      await expect(undoToast(page, lang, token)).toHaveCount(0);
      await expect(railEntry(page, token).first()).toBeVisible();
      await openToken(page, token);
      await expect(drawerLine(page, NAAN.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.given'));
      await expect(drawerLine(page, KHEER.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.waiting'));
      await closeDrawer(page, lang);

      // the token leaves the queue (no open token for the next flow): Kheer made ready at the Pass, paid, Hand over all
      const [second] = await kitchenReady(request, token, [KHEER.item_id]);
      await openToken(page, token);
      await expect(drawerLine(page, KHEER.name).locator('.tk-chip')).toHaveText(tr(lang, 'v.ready'));
      await payCash(page, lang, token);
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-fact--paid')).toBeVisible();
      const rest = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await drawer(page).getByRole('button', { name: tr(lang, 'v.collected') }).click();
      expect((await rest).status()).toBe(200);
      expect(servedIds(sent)).toEqual([first, second]);
      await expect(railEntry(page, token)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });

  test(`[02b-TK C2-2, C3-1; 05 B16; R2] a Due token: Hand over greyed, Take payment, then handed over (${lang})`, async ({ page, request }, info) => {
    runsHere(info);
    const sent = watchServed(page);
    // Ali (no take-payment) sends it to pay later; the kitchen makes it ready
    await signInOn(page, deviceFor(info), lang);
    const token = await (async () => {
      try {
        await takeawayTab(page);
        return await sendLater(page, lang, [NAAN.name], false);
      } catch (error) {
        await signOut(page, info, lang);
        throw error;
      }
    })();
    try {
      await kitchenReady(request, token, [NAAN.item_id]);
      const tile = readyTile(page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      await expect(tile).toContainText(tr(lang, 'q.due'));
      await openToken(page, token);
      // R2: Hand over is greyed on a Due order; the hint says take payment first
      const handOver = drawer(page).getByRole('button', { name: tr(lang, 'v.collected') });
      await expect(handOver).toHaveAttribute('aria-disabled', 'true');
      await expect(drawer(page).getByRole('note')).toHaveText(tr(lang, 'v.pay_first'));
      await expect(drawer(page).getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'v.pay'))}`) })).toHaveCount(0);
      // a tap on the greyed button does nothing (no Undo toast, nothing sent)
      await handOver.click({ force: true });
      await expect(undoToast(page, lang, token)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
    // the Owner: no unpaid override either (owner ruling 2026-11-24 #2) — Hand over greyed, the same hint; then the
    // Owner takes the cash: Paid, Hand over enabled, handed over after the Undo window, the token leaves the queue
    await signInOn(page, deviceFor(info), lang, 'Owner');
    try {
      await shiftOpen(page, lang);
      await takeawayTab(page);
      await expect(readyTile(page, token)).toBeVisible({ timeout: 15_000 });
      await openToken(page, token);
      const unpaid = drawer(page).getByRole('button', { name: tr(lang, 'v.collected') });
      await expect(unpaid).toHaveAttribute('aria-disabled', 'true');
      await expect(drawer(page).getByRole('note')).toHaveText(tr(lang, 'v.pay_first'));
      await expect(drawer(page).locator('.tk-drawer__f .tk-btn--xl')).toHaveCount(2); // Take payment + the greyed Hand over all only
      await unpaid.click({ force: true });
      await expect(undoToast(page, lang, token)).toHaveCount(0);
      await payCash(page, lang, token);
      await openToken(page, token);
      await expect(drawer(page).locator('.tk-fact--paid')).toBeVisible();
      const handOver = drawer(page).getByRole('button', { name: tr(lang, 'v.collected') });
      await expect(handOver).toHaveAttribute('aria-disabled', 'false');
      const served = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/mark-served'), { timeout: UNDO_MS + 10_000 });
      await handOver.click();
      await expect(undoToast(page, lang, token)).toBeVisible();
      expect((await served).status()).toBe(200);
      expect(sent).toHaveLength(1);
      await expect(railEntry(page, token)).toHaveCount(0);
    } finally {
      await signOut(page, info, lang);
    }
  });
}
