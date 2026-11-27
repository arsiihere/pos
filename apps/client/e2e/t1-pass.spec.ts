import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { escapeRe, menuTile, readyTile, rushOff, sentToken, shiftOpen, signInOn, takeawayTab } from './02b-support';
import { t1OtherPoint, t1Station, t1Table } from './t1-fixture';
import {
  apiSession,
  capture,
  runId,
  closeAll,
  cookLine,
  deviceFor,
  hubAdvance,
  hubFire,
  LANGS,
  managerPhone,
  passCard,
  passTablet,
  screen,
  t1Hub,
  t1Run,
  t1RunsHere,
  tr,
  type Lang,
} from './t1-support';

// L-E2E-T1 group D (part 2) — the owner's dry-run checklist, the Pass against the e2e hub. Rows:
//   #19 a ready bag left uncollected past the ready window, then 2× the window → the Pass card and the counter tile turn
//       amber; at 2× the manager is alerted (03b v1.0.16 §3.4 R3-M-9, §3.5 R8; ready_to_serve step 3 → managers)
//   #20 one Pass point set to Takeaway only → takeaway goes there, dine-in goes to the other point (03b PT-1, routePoint)
// The e2e hub's ready window is 60 s (03b-fixture menu). The point order types are a real config apply (t1-fixture
// driver), restored at the end: routing is branch-wide while it is set.

const WINDOW_MS = 60_000;

async function owner(page: Page, lang: Lang, info: TestInfo): Promise<void> {
  await rushOff(page);
  await signInOn(page, deviceFor(info), lang, 'Owner');
  await shiftOpen(page, lang);
  await takeawayTab(page);
}

async function payNow(page: Page, lang: Lang): Promise<string> {
  await page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_pay'))}`) }).click();
  const token = await sentToken(page);
  const panel = page.locator('.cart .tk-paypanel');
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.exact'))}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.done'))}`) }).click();
  await panel.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'p.next'))}`) }).click();
  await expect(panel).toHaveCount(0);
  return token;
}

for (const lang of LANGS) {
  test(`[T1 #19] a ready bag not collected: amber on the Pass card and the counter tile past the window; at 2× the manager is alerted (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info);
    const run = t1Run('amber', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const pass = await screen(browser, { width: 1280, height: 800 });
    const phone = await screen(browser, { width: 390, height: 844 });
    try {
      await cash.page.clock.install();
      await pass.page.clock.install();
      await owner(cash.page, lang, info);
      await menuTile(cash.page, run.items.main.name).click();
      const token = await payNow(cash.page, lang);
      await hubFire(t1Station(run.key));
      await passTablet(pass.page, 'amber', info, lang);
      await managerPhone(phone.page, lang);
      const card = passCard(pass.page, token);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await cookLine(card, run.items.main.name);
      await card.locator('.btn--ready').click();
      await expect(card.locator('.pc__rdy')).toBeVisible();
      const tile = readyTile(cash.page, token);
      await expect(tile).toBeVisible({ timeout: 15_000 });
      await expect(tile).not.toHaveClass(/tk-rt--late/);

      // past 1× the window (hub and pages): amber on both screens
      await hubAdvance(WINDOW_MS + 30_000);
      await pass.page.clock.fastForward(WINDOW_MS + 30_000);
      await cash.page.clock.fastForward(WINDOW_MS + 30_000);
      await expect(card).toHaveClass(/pc--late/, { timeout: 10_000 });
      await expect(tile).toHaveClass(/tk-rt--late/, { timeout: 10_000 });
      await capture(pass.page, info, `T1-19-amber-pass-${info.project.name}-${lang}`, card);
      await capture(cash.page, info, `T1-19-amber-tile-${info.project.name}-${lang}`, tile);

      // past 2× the window: the counter alert escalates to the managers — the Manager (signed in on the phone) gets it in
      // the inbox the phone reads (alerts-inbox; the e2e inbox holds other specs' alerts, so the row is found by token)
      await hubAdvance(WINDOW_MS);
      const mgr = await apiSession(request, 'S_MGR', '0123');
      try {
        await expect
          .poll(async () => {
            const { alerts } = await mgr.query<{ alerts: Array<{ kind: string; escalation: boolean; lock: unknown; card?: unknown }> }>('alerts-inbox?limit=50');
            return alerts.filter((a) => a.kind === 'ready_to_serve' && JSON.stringify([a.lock, a.card ?? null]).includes(`#${token}`)).map((a) => a.escalation);
          }, { timeout: 30_000 })
          .toEqual([true]);
      } finally {
        await mgr.close();
      }
      await capture(phone.page, info, `T1-19-manager-${info.project.name}-${lang}`);
    } finally {
      await closeAll(info, lang, phone, pass, cash);
    }
  });

  test(`[T1 #20] a Pass point set to Takeaway only: takeaway lines go there, dine-in goes to the other point (${lang})`, async ({ browser, request }, info) => {
    t1RunsHere(info, 180_000);
    const run = t1Run('route', info, lang);
    const cash = await screen(browser, info.project.use.viewport!);
    const passA = await screen(browser, { width: 1280, height: 800 });
    const passB = await screen(browser, { width: 1280, height: 800 });
    const set = await t1Hub<{ outcome: string }>({ kind: 'orderTypes', points: { [run.point]: ['takeaway'], [t1OtherPoint(run.key)]: ['dine_in'] } });
    expect(set.outcome).toBe('applied');
    const api = await apiSession(request, 'S_OWNER');
    try {
      await owner(cash.page, lang, info);
      await menuTile(cash.page, run.items.main.name).click();
      await cash.page.getByRole('button', { name: new RegExp(`^${escapeRe(tr(lang, 'c.send_later'))}`) }).click();
      const token = await sentToken(cash.page);

      // a dine-in order of the same item at the T1 floor's table, sent through SubmitOrder (the hub routes it)
      const table = t1Table(info.project.name, lang);
      const seating_id = runId(`SEAT-${run.key}`);
      await t1Hub({ kind: 'seat', table_id: table, seating_id, holder: 'S_OWNER' });
      const order_id = runId(`T1-DI-${run.key}`);
      const placed = await api.command('SubmitOrder', { order_id, order_type: 'dine_in', table_id: table, seating_id, lines: [{ order_item_id: `${order_id}-M`, item_id: run.items.main.item_id, quantity: 1 }] });
      expect(placed.status, JSON.stringify(placed.body.error)).toBe(200);

      await passTablet(passA.page, 'route', info, lang);
      await passTablet(passB.page, 'route', info, lang, 'Pervez', 'passB');
      // the takeaway-only point: the token's card, no dine-in card
      await expect(passCard(passA.page, token)).toBeVisible({ timeout: 15_000 });
      await expect(passA.page.locator('article.pc', { hasText: table })).toHaveCount(0);
      // the dine-in point: the table's card, not the token
      await expect(passB.page.locator('article.pc', { hasText: table })).toBeVisible({ timeout: 15_000 });
      await expect(passCard(passB.page, token)).toHaveCount(0);
      await capture(passB.page, info, `T1-20-dine-in-${info.project.name}-${lang}`);
    } finally {
      await api.close();
      await t1Hub({ kind: 'orderTypes', points: { [run.point]: null, [t1OtherPoint(run.key)]: null } });
      await closeAll(info, lang, passB, passA, cash);
    }
  });
}


