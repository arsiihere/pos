import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { dialog, goFloorOf, hub, isPhone, landing, lineId, pairAs, sheet, sheetAct, signInPass, signOut, takeOrder, tapTile, tr, withLiveClock, type Lang } from './03b-support';
import { dlLine, dlTables, type DlScenario, type E2eDevice } from './global-setup';

// dl t1 (01d v1.3 §3.13; docs/plans/dl-plan.md row t1): the deep-link smoke, end to end, on the real test hub and the
// built /staff/ client (`pnpm test:e2e`; run by the lane, never in the gate). It owns no numbered test: it re-runs
// 74, 75, 80, 84 (and 79, 86, 95) through a browser. English only; one table pair per (scenario, viewport), after the
// 02a / 02b pairs (global-setup dlTables). Screenshots (deviceScaleFactor 1) go to docs/plans/dl-e2e-shots/ only with
// POS_E2E_SHOTS=1, so an ordinary run leaves the tree clean.

const LANG: Lang = 'en';
const PIN = '1234';
const PIN_MANAGER = '0123';
/** the Rooftop zone's Cola (global-setup floors(): warn at 2) */
const ZONE = 'Z-FL-R';
const COLA = 'I_COLA';

// a step that hangs fails at that step, not at the test timeout
test.use({ actionTimeout: 15_000 });

const dlPair = (scenario: DlScenario, info: TestInfo): [string, string] => dlTables(scenario, info.project.name);
const portraitOrPhone = (info: TestInfo): boolean => info.project.name === 'tablet-portrait' || isPhone(info);
const isKiosk = (info: TestInfo): boolean => info.project.name === 'kiosk';

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  if (process.env['POS_E2E_SHOTS'] !== '1') return;
  const dir = join(info.project.testDir, '..', '..', '..', 'docs', 'plans', 'dl-e2e-shots');
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}-${info.project.name}.png`) });
}

/** A person's screen at this run's viewport (deviceScaleFactor 1), recording its glows. */
async function screen(browser: Browser, info: TestInfo, extra: { reducedMotion?: 'reduce' } = {}): Promise<Page> {
  const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 1, ...extra });
  const page = await context.newPage();
  await recordGlows(page);
  return page;
}

async function close(page: Page, info: TestInfo): Promise<void> {
  await signOut(page, info, LANG);
  await page.context().close();
}

/** The PIN on the sign-in screen (the name tile first, unless it is the owner's phone); a session this device still
 *  holds asks once more (DEVICE_SESSION_ACTIVE). */
async function enter(page: Page, device: E2eDevice, name: string, pin: string): Promise<void> {
  const keys = page.locator('.pin__keys');
  const type = async () => {
    for (const d of pin) await keys.locator('.btn', { hasText: new RegExp(`^${d}$`) }).click();
    await keys.locator('.btn--primary').click();
  };
  if (device.device_type !== 'phone') await page.locator('.who__t', { hasText: name }).click();
  const landed = landing(page);
  await type();
  const taken = page.locator('.pin__err');
  await Promise.race([keys.waitFor({ state: 'detached' }), taken.waitFor({ state: 'visible' })]);
  if (await taken.isVisible()) await type();
  await expect(keys).toHaveCount(0);
  await landed;
}

async function signInAt(page: Page, device: E2eDevice, name: string, pin = PIN): Promise<void> {
  await pairAs(page, device, LANG);
  await enter(page, device, name, pin);
}

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => (window.location.hash = h), hash);
}

const hash = (page: Page): Promise<string> => page.evaluate(() => window.location.hash);
/** A query parameter of the hash route (#/tables/<id>?seating_id=…). */
const hashParam = async (page: Page, name: string): Promise<string | null> => new URLSearchParams((await hash(page)).split('?')[1] ?? '').get(name);

/** The element at the centre of `inside` belongs to it: nothing covers it. */
async function onTop(page: Page, inside: Locator): Promise<boolean> {
  const box = await inside.boundingBox();
  if (box === null) return false;
  const handle = await inside.elementHandle();
  return page.evaluate(
    ([el, x, y]) => {
      const hit = document.elementFromPoint(x as number, y as number);
      return hit !== null && (el as Element).contains(hit);
    },
    [handle, box.x + box.width / 2, box.y + Math.min(box.height / 2, 40)] as const,
  );
}

/** One element that got `pos-glow` (§3.13.6), as the page saw it then. */
interface Glow {
  data: Record<string, string>;
  text: string;
  /** inside the table sheet (section.tv) */
  inSheet: boolean;
  animation: string;
  outline: string;
}

/**
 * Records every element that gets `pos-glow`, with its computed animation and outline. The glow lasts --motion-glow
 * (2 s), so a spec reads what the page did rather than racing the class (no timing assert, 03a AD-32).
 */
async function recordGlows(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __dlGlows: unknown[] };
    w.__dlGlows = [];
    const on = new WeakSet<Element>();
    new MutationObserver((records) => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (!el.classList?.contains('pos-glow')) {
          on.delete(el);
          continue;
        }
        if (on.has(el)) continue;
        on.add(el);
        const cs = getComputedStyle(el);
        w.__dlGlows.push({
          data: { ...el.dataset },
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
          inSheet: el.closest('section.tv') !== null,
          animation: cs.animationName,
          outline: `${cs.outlineStyle} ${cs.outlineWidth}`,
        });
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
}

const glows = (page: Page): Promise<Glow[]> => page.evaluate(() => (window as unknown as { __dlGlows: Glow[] }).__dlGlows ?? []);

/** Waits for a glow that `match` accepts (on or after glow number `from`). */
async function glowOf(page: Page, what: string, match: (g: Glow) => boolean, from = 0): Promise<Glow> {
  let found: Glow | undefined;
  try {
    await expect.poll(async () => (found = (await glows(page)).slice(from).find(match)) !== undefined, { timeout: 10_000 }).toBe(true);
  } catch {
    throw new Error(`no glow on ${what}; the page glowed: ${JSON.stringify((await glows(page)).slice(from))}`);
  }
  return found!;
}

/** The landscape side panel (the table sheet) overlaps the table's tile (table-place.ts `covered`). */
async function coveredByPanel(page: Page, table: string): Promise<boolean> {
  const tile = await page.locator(`[data-table="${table}"]`).boundingBox();
  const panel = await sheet(page).boundingBox();
  if (tile === null || panel === null) return false;
  const w = Math.min(tile.x + tile.width, panel.x + panel.width) - Math.max(tile.x, panel.x);
  const h = Math.min(tile.y + tile.height, panel.y + panel.height) - Math.max(tile.y, panel.y);
  return w > 0 && h > 0;
}

/** The kiosk Back chip, in its own slot of the alert layer (01d v1.3.3 §3.13.6a: `div.abk`, above route sheets). */
const backChip = (page: Page): Locator => page.locator('div.abk button.chip', { hasText: tr(LANG, 'alerts.back') });

const phoneTab = (page: Page): Locator => page.locator('a.tab[aria-current="page"]');
const toast = (page: Page): Locator => page.getByText(tr(LANG, 'alerts.target_closed'));

/** Ali asks to void the seeded Naan line of the open table sheet (the e2e directory: void-item needs a manager). */
async function askVoid(page: Page): Promise<void> {
  const line = sheet(page).locator('[aria-expanded]', { hasText: 'Naan' }).first();
  await expect(line).toBeVisible();
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  // the seeded line is cooking (global-setup dlSeedTables), so it offers Void ("Void · Needs approval"), not Remove
  await line.getByRole('button', { name: new RegExp(`^${tr(LANG, 'line.void')}\\b`) }).click();
  const voidSheet = page.locator('.dlg').last();
  await expect(voidSheet).toContainText(tr(LANG, 'comp.needs_manager'));
  await voidSheet.locator('.chips--r .chip').first().click();
  await voidSheet.locator('.acts .btn--primary').click();
  await expect(page.getByText(tr(LANG, 'void.toast.asked')).first()).toBeVisible();
}

/** Clean-up: Ali withdraws a request a test left open, so no later flow (02b comp, the next viewport) meets it. */
async function withdrawLeftover(ali: Page): Promise<void> {
  try {
    await sheet(ali).getByRole('button', { name: tr(LANG, 'comp.withdraw') }).click({ timeout: 3_000 });
    await expect(ali.getByText(tr(LANG, 'void.toast.withdrawn')).first()).toBeVisible({ timeout: 3_000 });
  } catch {
    // already answered or withdrawn
  }
}

/** A staff command straight to the hub (00 §6.3 envelope), as `staff_id` on `device`, then sign out. For set-up
 *  only: the screens under test are the browser pages. */
let commandSeq = 0;
async function staffCommand(request: APIRequestContext, device: E2eDevice, staff_id: string, type: string, payload: Record<string, unknown>): Promise<void> {
  const h = hub();
  const auth = { Authorization: `Bearer ${device.token}` };
  const signIn = await request.post(`${h.baseURL}/auth/pin`, { headers: auth, data: { staff_id, pin: PIN, takeover: true } });
  expect(signIn.status(), 'auth/pin').toBe(200);
  const session = ((await signIn.json()) as { data: { session_token: string } }).data.session_token;
  const headers = { ...auth, 'X-Session-Token': session };
  commandSeq += 1;
  const kebab = type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  const res = await request.post(`${h.baseURL}/commands/${kebab}`, {
    headers,
    data: {
      command_id: `e2e-dl-${process.pid}-${commandSeq}`,
      tenant_id: h.tenant_id,
      branch_id: h.branch_id,
      command_type: type,
      payload,
      // eslint-disable-next-line no-restricted-syntax -- the e2e client has no Clock; the hub stamps its own time
      occurred_at: Date.now(),
      actor_id: staff_id,
      device_id: device.device_id,
    },
  });
  expect(res.status(), `${type}: ${await res.text()}`).toBe(200);
  await request.post(`${h.baseURL}/auth/logout`, { headers, data: {} });
}

// ------------------------------------------------------------------------------------------------------------------
// 1. §3.13.2 rules 2, 4 (tests 74, 80): a Manager taps Ali's void request in Requests → the table sheet of the seating
//    opens, the Naan line glows in it, AnswerSheet is on top; Approve with the PIN works. Phone viewport: the Tables tab
//    is marked (m1). Kiosk: the Manager taps from the cashier kiosk (its Back chip: tests 4 and 1b).
test('[01d §3.13.2 rules 2, 4; dl t1] Manager taps a void request: sheet, line glow, AnswerSheet on top, approve', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const h = hub();
  const [table] = dlPair('void', info);
  const ali = await screen(browser, info);
  const mgr = await screen(browser, info);
  try {
    await signInAt(ali, h.device, 'Ali');
    await tapTile(ali, table);
    await askVoid(ali);

    await signInAt(mgr, isKiosk(info) ? h.kiosk : h.device2, 'Manager', PIN_MANAGER);
    await go(mgr, '#/requests');
    if (portraitOrPhone(info)) {
      // portrait and phone: the urgent request's banner sits over the list; its Open is the same tap (§3.13.7)
      const banner = mgr.locator('.abn[data-alert]', { hasText: table }).first();
      await expect(banner).toBeVisible({ timeout: 20_000 });
      await banner.getByRole('button', { name: tr(LANG, 'alerts.open') }).click();
    } else {
      // the Requests row (02a: the table chip, "Void from Ali")
      const row = mgr.locator('main').getByRole('button', { name: new RegExp(`\\b${table}\\b`) }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await row.click();
    }

    // the place: the table sheet of the seating (the hash names table and seating), the Naan line glowing in it
    await expect(mgr).toHaveURL(new RegExp(`#/tables/${table}\\?seating_id=seat-dl-${table}`));
    await expect(sheet(mgr)).toBeVisible();
    const g = await glowOf(mgr, 'the Naan line', (x) => x.data['line'] !== undefined);
    expect(g.data['line']).toBe(dlLine(table));
    expect(g.inSheet).toBe(true);
    expect(g.animation).toBe('pos-glow');
    // rule 4: AnswerSheet on top (the hit test at its centre lands inside it)
    const answer = dialog(mgr);
    await expect(answer.getByRole('button', { name: tr(LANG, 'answer.approve') })).toBeVisible();
    expect(await onTop(mgr, answer)).toBe(true);
    await shot(mgr, info, 'void-answer-on-top');
    if (isPhone(info)) await expect(phoneTab(mgr)).toHaveAttribute('href', '#/tables');
    // focus is consumed once (§3.13.5): the hash keeps table and seating, not focus
    await expect.poll(() => hash(mgr)).not.toContain('focus=');

    await answer.getByRole('button', { name: tr(LANG, 'answer.approve') }).click();
    const keys = mgr.locator('.pin__keys');
    await mgr.waitForTimeout(450); // ⚠️ 01d v1.3.9 §8.1 (QA-R2, BUG-13): the answer pad ignores taps for 400 ms after it opens
    for (const d of PIN_MANAGER) await keys.locator('.btn', { hasText: new RegExp(`^${d}$`) }).click();
    await keys.getByRole('button', { name: tr(LANG, 'answer.approve') }).click();
    await expect(mgr.getByText(tr(LANG, 'answer.done_approved')).first()).toBeVisible();

  } finally {
    await close(mgr, info);
    await close(ali, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 1b. §3.13.2 rule 6, §3.13.6a (DL Q-K (c), 01d v1.3.3; tests 86, 100–105 end to end): after a deep link to a table
//     place on the cashier kiosk, the Back chip (`div.abk`, z 20) sits above the table sheet (`scrim--route`, z 10):
//     a real click (hit-tested by the browser) reaches it and returns to the hash the tap left; the chip goes.
test('[01d §3.13.2 rule 6; dl t1] kiosk: the Back chip can be tapped over a table place', async ({ browser }, info) => {
  test.skip(!isKiosk(info), 'the Back chip is the cashier kiosk\'s');
  test.setTimeout(120_000);
  const h = hub();
  const [table] = dlPair('closed', info);
  const ali = await screen(browser, info);
  const mgr = await screen(browser, info);
  try {
    await signInAt(ali, h.device, 'Ali');
    await tapTile(ali, table);
    await askVoid(ali);
    await signInAt(mgr, h.kiosk, 'Manager', PIN_MANAGER);
    await go(mgr, '#/requests');
    const row = mgr.locator('main').getByRole('button', { name: new RegExp(`\\b${table}\\b`) }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(sheet(mgr)).toBeVisible();
    await mgr.keyboard.press('Escape'); // AnswerSheet: the person only wants to go back
    await expect(dialog(mgr)).toHaveCount(0);
    const back = backChip(mgr);
    await expect(back).toBeVisible();
    expect(await onTop(mgr, back), 'the Back chip is above the table sheet').toBe(true);
    await shot(mgr, info, 'kiosk-back-chip-over-sheet');
    await back.click({ timeout: 5_000 });
    await expect.poll(() => hash(mgr)).toBe('#/requests');
    await expect(sheet(mgr)).toHaveCount(0);
    await expect(back).toHaveCount(0);
  } finally {
    await withdrawLeftover(ali);
    await close(mgr, info);
    await close(ali, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 2. §3.13.2 rule 2, §3.13.3 M1, §3.13.5 m7 (tests 75, 79, 84): Ali calls a waiter; Bilal (his waiter) taps the call
//    banner's Open → his table: the tile glows on a landscape screen, the sheet header on portrait and phone (the
//    bottom sheet covers the map). Then Ali joins that table into another one (MergeTables): Bilal's tap on the same
//    call in his Inbox opens the surviving seating; closing that sheet returns to his Inbox (v1.3.3 close returns).
test('[01d §3.13.3 M1, §3.13.5 m7; dl t1] call_waiter: the tile or the header glows; after MergeTables the survivor opens', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const h = hub();
  const [called, other] = dlPair('call', info);
  const ali = await screen(browser, info);
  const bilal = await screen(browser, info);
  try {
    await signInAt(ali, h.device, 'Ali');
    await signInAt(bilal, h.device3, 'Bilal');
    await takeOrder(ali, LANG, called);
    await takeOrder(ali, LANG, other);
    await tapTile(ali, called);
    await sheetAct(ali, LANG, 'sheet.act.call');
    await dialog(ali).getByRole('button', { name: tr(LANG, 'call.chip.water') }).click();
    await expect(ali.getByText(tr(LANG, 'tables.toast.waiter_called'))).toBeVisible();

    const banner = bilal.locator('.abn[data-alert]', { hasText: called }).first();
    await expect(banner).toBeVisible({ timeout: 20_000 });
    const alertId = (await banner.getAttribute('data-alert'))!;
    await banner.getByRole('button', { name: tr(LANG, 'alerts.open') }).click();
    await expect(bilal).toHaveURL(new RegExp(`#/tables/${called}\\?seating_id=`));
    const seating = await hashParam(bilal, 'seating_id');
    expect(seating).not.toBeNull();
    await expect(sheet(bilal)).toBeVisible();
    if (portraitOrPhone(info)) {
      const g = await glowOf(bilal, 'the sheet header', (x) => x.data['seating'] !== undefined);
      expect(g.data['seating']).toBe(seating);
    } else {
      // landscape: the tile, kept in view beside the side panel; if the panel still covers it, the header (m7)
      const g = await glowOf(bilal, 'the tile or the header', (x) => x.data['table'] !== undefined || x.data['seating'] !== undefined);
      if (g.data['table'] !== undefined) {
        expect(g.data['table']).toBe(called);
        expect(g.inSheet).toBe(false);
      } else {
        expect(g.data['seating']).toBe(seating);
        expect(await coveredByPanel(bilal, called), 'the header glows only when the panel covers the tile').toBe(true);
      }
    }
    await shot(bilal, info, 'call-glow');
    if (isPhone(info)) await expect(phoneTab(bilal)).toHaveAttribute('href', '#/tables');
    // a waiter's call has no AnswerSheet: only the place
    await expect(dialog(bilal)).toHaveCount(0);

    // MergeTables: from the other party's sheet Ali joins the called table; its seating is absorbed into the other one
    // (02a MergeTables: the picked table's seating closes `merged`, its tables and orders move)
    await goFloorOf(ali, other);
    await tapTile(ali, other);
    await sheetAct(ali, LANG, 'sheet.act.join');
    await dialog(ali).locator('.mt', { hasText: called }).click();
    await dialog(ali).getByRole('button', { name: tr(LANG, 'join.go') }).click();
    await expect(dialog(ali)).toHaveCount(0);
    // Bilal's map has the merge (its live frame) before his next tap
    await go(bilal, '#/tables');
    await goFloorOf(bilal, called);
    const joined = new RegExp(`${called}.*${other}|${other}.*${called}`);
    await expect(bilal.getByRole('button', { name: joined }).first()).toBeVisible({ timeout: 20_000 });

    // the same call, tapped again in the Inbox: the seating that absorbed the called table opens (§3.13.3 step 2)
    await go(bilal, '#/inbox');
    const before = (await glows(bilal)).length;
    await bilal.locator(`main [data-alert="${alertId}"]`).first().click();
    await expect(bilal).toHaveURL(/#\/tables\/[^?]+\?seating_id=/);
    const survivor = await hashParam(bilal, 'seating_id');
    expect(survivor).not.toBeNull();
    expect(survivor).not.toBe(seating);
    await expect(sheet(bilal)).toContainText(joined);
    await glowOf(bilal, 'the survivor', (x) => x.data['seating'] === survivor || x.data['table'] !== undefined, before);
    await shot(bilal, info, 'call-after-merge');

    // (c) close returns (01d v1.3.3 §3.13.2 rule 6, K-2): the sheet this tap opened closes back to the route the tap
    // started on, #/inbox, not to the sheet's own fallback (#/tables)
    await sheet(bilal).getByRole('button', { name: tr(LANG, 'common.close') }).click();
    await expect(sheet(bilal)).toHaveCount(0);
    await expect.poll(() => hash(bilal)).toBe('#/inbox');
  } finally {
    await close(bilal, info);
    await close(ali, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 3. §3.13.2 rule 4 (B2), §3.13.3 (test 82): a tap on a request that has since closed (Ali withdrew it) shows "This item
//    is no longer open." and stays: no navigation, no AnswerSheet.
test('[01d §3.13.2 rule 4, §3.13.3; dl t1] a request closed since: the toast, the route unchanged', async ({ browser }, info) => {
  test.skip(!['tablet-landscape', 'phone-390'].includes(info.project.name), 'a tablet and a phone are enough for the closed path');
  test.setTimeout(120_000);
  const h = hub();
  const [table] = dlPair('closed', info);
  const ali = await screen(browser, info);
  const mgr = await screen(browser, info);
  try {
    await signInAt(ali, h.device, 'Ali');
    await signInAt(mgr, h.device2, 'Manager', PIN_MANAGER);
    await tapTile(ali, table);
    await askVoid(ali);
    await go(mgr, '#/inbox');
    const card = mgr.locator('main [data-alert]', { hasText: table }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const alertId = (await card.getAttribute('data-alert'))!;

    // Ali withdraws: the request closes; the Manager's Inbox keeps it in Today
    await sheet(ali).getByRole('button', { name: tr(LANG, 'comp.withdraw') }).click();
    await expect(ali.getByText(tr(LANG, 'void.toast.withdrawn')).first()).toBeVisible();
    const closed = mgr.locator(`main [data-alert="${alertId}"]`).first();
    await expect(closed).toContainText(tr(LANG, 'alerts.closed.withdrawn'), { timeout: 20_000 });

    await closed.click();
    await expect(toast(mgr)).toBeVisible();
    await shot(mgr, info, 'closed-toast');
    expect(await hash(mgr)).toBe('#/inbox');
    await expect(dialog(mgr)).toHaveCount(0);
  } finally {
    await close(mgr, info);
    await close(ali, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 4. §3.13.7, §3.13.5, §3.13.6 (tests 75, 77, 86): the zone banner's Open lands on #/zones and glows the zone stock row.
//    Landscape: the animated glow. Portrait under prefers-reduced-motion: no animation, the static outline ring
//    (v1.3.1). Kiosk: the Back chip returns to the kiosk home. Phone: the tab Ali was on stays marked (05a C-1; was m1).
test('[01d §3.13.5, §3.13.6, §3.13.7; dl t1] zone banner → #/zones row glows (reduced motion: the outline ring)', async ({ browser, request }, info) => {
  test.skip(isPhone(info) && info.project.name !== 'phone-390', 'one phone width is enough here');
  test.setTimeout(120_000);
  const h = hub();
  const reduced = info.project.name === 'tablet-portrait';
  const ali = await screen(browser, info, reduced ? { reducedMotion: 'reduce' } : {});
  const device = isKiosk(info) ? h.kiosk : isPhone(info) ? h.phone : h.device;
  try {
    await signInAt(ali, device, 'Ali');
    const home = await hash(ali);
    // Sara counts 1 Cola on the Rooftop counter (warn at 2): zone_stock_low reaches every manage-zone-stock holder
    await staffCommand(request, h.device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 1 });
    const banner = ali.locator('.abn[data-alert]', { hasText: tr(LANG, 'alert.zone_stock_low.card') }).first();
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await banner.getByRole('button', { name: tr(LANG, 'alerts.open') }).click();

    await expect.poll(() => hash(ali)).toMatch(/^#\/zones/);
    const g = await glowOf(ali, 'the Cola row', (x) => x.data['zoneItem'] === `${ZONE}:${COLA}`);
    if (reduced) {
      expect(g.animation).toBe('none');
      expect(g.outline).toBe('solid 2px');
    } else {
      expect(g.animation).toBe('pos-glow');
    }
    await shot(ali, info, reduced ? 'zone-reduced-motion' : 'zone-glow');
    await expect.poll(() => hash(ali)).toBe('#/zones');
    // 05a C-1: the phone's tabs are the profile's screens; #/zones is no screen's route, so the tab Ali was on stays
    // marked: Dine in, the phone's first screen (was 01d m1: the fixed Orders tab)
    if (isPhone(info)) await expect(phoneTab(ali)).toHaveAttribute('href', '#/tables');
    if (isKiosk(info)) {
      const back = backChip(ali);
      await expect(back).toBeVisible();
      await back.click();
      await expect.poll(() => hash(ali)).toBe(home);
      await expect(back).toHaveCount(0);
    }
  } finally {
    // the count goes back above the threshold (the alert closes `done`) for every later run
    await staffCommand(request, h.device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 500 });
    await close(ali, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 5. §3.13.5 m12 (test 95), §3.13.3: on a Pass tablet on #/pass, the escalated Ready's Open glows the order's Pass
//    card in place: no navigation, no sheet. Then, once the food is handed over, Ali's tap on his (closed)
//    ready_to_serve finds every line served: not open → the toast, and he stays where he is.
//    Uses the 03b fixture's Pass tablet, point and takeaway order of the key `pass-kiosk-en`, which the 03b Pass flow
//    leaves unused (it runs on tablets only). The escalation comes at 2 × ready_window_ms (60 s) of hub time.
test('[01d §3.13.5 m12, §3.13.3; dl t1] a Pass card glows in place; a served order is no longer open', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'tablet-landscape', 'the Pass runs on a tablet; one viewport is enough here');
  test.setTimeout(240_000);
  const h = hub();
  const key = 'pass-kiosk-en';
  const order = `O3-${key}`;
  const pass = await screen(browser, info);
  const ali = await screen(browser, info);
  try {
    await pairAs(pass, { ...h.devices03[`pass:${key}`]!, device_type: 'tablet' }, LANG);
    await signInPass(pass, 'Cook');
    await signInAt(ali, h.device, 'Ali');
    const card = pass.locator(`article.pc[data-order="${order}"]`);
    await expect(card).toBeVisible();
    for (const n of [1, 2, 3]) {
      const row = card.locator('.pl').nth(n - 1);
      await row.locator('.btn--start').click();
      await row.locator('.btn--done').click();
      const undo = row.locator('.btn--undo');
      await expect(undo.or(card.locator('.pc__msg'))).toBeVisible();
      if (!(await undo.isVisible())) await row.locator('.btn--done').click();
      await expect(undo).toBeVisible();
    }
    await card.locator('.btn--ready').click();
    await expect(card.locator('.pc__rdy')).toBeVisible();

    // nobody comes: the Ready escalates to the Pass's point (a lock-only row) after 2 windows of hub time
    const banner = pass.locator('.abn[data-alert]').first();
    await withLiveClock(() => expect(banner).toBeVisible({ timeout: 150_000 }));
    await banner.getByRole('button', { name: tr(LANG, 'alerts.open') }).click();
    const g = await glowOf(pass, 'the Pass card', (x) => x.data['order'] === order);
    expect(g.animation).toBe('pos-glow');
    await shot(pass, info, 'pass-card-in-place');
    expect(await hash(pass)).toBe('#/pass');
    await expect(pass.locator('.dlg[role="dialog"]')).toHaveCount(0);

    // Hand over → Ali ("Food handed to you"), and the food is served (Sara marks the three lines; a hand-over alone
    // does not serve them, 03b §3.5). Ali's ready_to_serve, closed by now, has every line served: not open
    await card.locator('.btn--hand').click();
    await pass.locator('.rcv', { hasText: 'Ali' }).click();
    await go(ali, '#/inbox');
    await expect(ali.getByText(tr(LANG, 'alert.served_card.card').split(' · ')[0]!).first()).toBeVisible({ timeout: 20_000 });
    await staffCommand(request, h.device3, 'S_SARA', 'MarkServed', { lines: [{ order_id: order, order_item_ids: [1, 2, 3].map((n) => lineId(key, n)) }] });
    const ready = ali.locator('main [data-alert]', { hasText: tr(LANG, 'alert.ready_to_serve.card').split(' · ')[0]! }).first();
    await expect(ready).toBeVisible({ timeout: 20_000 });
    await ready.click();
    await expect(toast(ali)).toBeVisible();
    await shot(ali, info, 'served-order-toast');
    expect(await hash(ali)).toBe('#/inbox');
  } finally {
    await close(ali, info);
    await close(pass, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 7. §3.13.6a layers (DL Q-K (c), 01d v1.3.3): real clicks, hit-tested by the browser (what jsdom cannot check). Ali has
//    a table sheet open (opened normally); Sara counts the Rooftop Cola down, so a zone banner arrives over it.

/** Ali on his screen with the layers table's sheet open; returns its hash. */
async function layersSheet(ali: Page, info: TestInfo): Promise<string> {
  const h = hub();
  const [table] = dlPair('layers', info);
  await signInAt(ali, isKiosk(info) ? h.kiosk : h.device, 'Ali');
  if (isKiosk(info)) await go(ali, '#/tables'); // the kiosk lands on its home
  await tapTile(ali, table);
  await expect(sheet(ali)).toBeVisible();
  return hash(ali);
}

async function zoneBanner(ali: Page, request: APIRequestContext): Promise<Locator> {
  await staffCommand(request, hub().device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 1 });
  const banner = ali.locator('.abn[data-alert]', { hasText: tr(LANG, 'alert.zone_stock_low.card') }).first();
  await expect(banner).toBeVisible({ timeout: 20_000 });
  return banner.getByRole('button', { name: tr(LANG, 'alerts.open') });
}

// 7a. (a) Only the route sheet (`scrim--route`, z 10) is under the banner (z 20): a real click on Open reaches it and
//     deep-links to #/zones. Kiosk: the Back chip then returns to the table sheet it left.
test('[01d §3.13.6a, §3.13.2 rule 6; dl t1] layers: a banner Open is tappable over an open TableSheet', async ({ browser, request }, info) => {
  test.skip(!['tablet-landscape', 'kiosk'].includes(info.project.name), 'the side-panel layouts: landscape tablet and kiosk');
  test.setTimeout(120_000);
  const ali = await screen(browser, info);
  try {
    const sheetHash = await layersSheet(ali, info);
    const open = await zoneBanner(ali, request);
    expect(await onTop(ali, open), 'the banner is above the route sheet').toBe(true);
    await shot(ali, info, 'layers-banner-over-sheet');
    await open.click({ timeout: 5_000 });
    await expect.poll(() => hash(ali)).toMatch(/^#\/zones/);
    await glowOf(ali, 'the Cola row', (x) => x.data['zoneItem'] === `${ZONE}:${COLA}`);
    if (isKiosk(info)) {
      // the Back chip returns to the hash the tap left: the table sheet, opened normally before
      const back = backChip(ali);
      await expect(back).toBeVisible();
      await back.click({ timeout: 5_000 });
      await expect.poll(() => hash(ali)).toBe(sheetHash);
      await expect(sheet(ali)).toBeVisible();
      await expect(back).toHaveCount(0);
    }
  } finally {
    await staffCommand(request, hub().device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 500 });
    await close(ali, info);
  }
});

// 7d. (d) A popup opened from a route sheet (plain `.scrim`, z 30; cs14 portals it into `.pu.staff`) still covers the
//     banners: the banner's Open is not on top, the hit at its centre lands on the popup's scrim, a real click cannot
//     reach it, and the route stays. Three popups: Void and Comp from the TableSheet, Mark served from OrderView.

/** The popup is open over the route sheet; a zone banner arrives; nothing of the banner can be clicked through it. */
async function popupCoversBanner(ali: Page, request: APIRequestContext, info: TestInfo, popup: Locator, name: string): Promise<void> {
  const route = await hash(ali);
  // the popup is a child of the shell root, not of the route sheet (its z 30 is not capped by the sheet's z 10)
  expect(await popup.evaluate((el) => el.closest('.scrim--route') === null && el.closest('.pu.staff') !== null), `${name}: portalled into .pu.staff`).toBe(true);
  const open = await zoneBanner(ali, request);
  await shot(ali, info, `layers-${name}-over-banner`);
  const box = (await open.boundingBox())!;
  const hit = await ali.evaluate(([x, y]) => document.elementFromPoint(x as number, y as number)?.closest('.scrim, .abns')?.className ?? null, [
    box.x + box.width / 2,
    box.y + box.height / 2,
  ] as const);
  expect(hit, `${name}: the hit at the banner Open lands on the popup scrim`).toMatch(/\bscrim\b/);
  expect(hit).not.toMatch(/scrim--route/);
  expect(await onTop(ali, open), `${name}: the popup covers the banner`).toBe(false);
  await expect(open.click({ timeout: 2_000 }), `${name}: a real click cannot reach the banner Open`).rejects.toThrow();
  expect(await hash(ali)).toBe(route);
  await expect(popup).toBeVisible();
}

/** The layers table's Naan line, open (its actions shown). */
async function layersLine(ali: Page): Promise<Locator> {
  const line = sheet(ali).locator('[aria-expanded]', { hasText: 'Naan' }).first();
  if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
  return line;
}

const LAYER_VIEWPORTS = ['tablet-landscape', 'kiosk'];

test('[01d §3.13.6a; dl t1] layers: the Void popup from the TableSheet covers the banners', async ({ browser, request }, info) => {
  test.skip(!LAYER_VIEWPORTS.includes(info.project.name), 'the side-panel layouts: landscape tablet and kiosk');
  test.setTimeout(120_000);
  const ali = await screen(browser, info);
  try {
    await layersSheet(ali, info);
    const line = await layersLine(ali);
    await line.getByRole('button', { name: new RegExp(`^${tr(LANG, 'line.void')}\\b`) }).click();
    const popup = ali.locator('.dlg[role="dialog"]').last();
    await expect(popup).toContainText(tr(LANG, 'comp.needs_manager'));
    await popupCoversBanner(ali, request, info, popup, 'void');
  } finally {
    await staffCommand(request, hub().device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 500 });
    await close(ali, info);
  }
});

test('[01d §3.13.6a; dl t1] layers: the Comp sheet from the TableSheet covers the banners', async ({ browser, request }, info) => {
  test.skip(!LAYER_VIEWPORTS.includes(info.project.name), 'the side-panel layouts: landscape tablet and kiosk');
  test.setTimeout(120_000);
  const ali = await screen(browser, info);
  try {
    await layersSheet(ali, info);
    const line = await layersLine(ali);
    await line.getByRole('button', { name: tr(LANG, 'comp.do'), exact: true }).click();
    const popup = ali.locator('.dlg[role="dialog"]').last();
    await expect(popup).toContainText(tr(LANG, 'comp.needs_manager'));
    await popupCoversBanner(ali, request, info, popup, 'comp');
  } finally {
    await staffCommand(request, hub().device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 500 });
    await close(ali, info);
  }
});

// OrderView (a route sheet too, `scrim--route`): a takeaway order of the 03b fixture whose lines the kitchen has been
// sent (FireDispatched), placed by Ali; the keys `pass-phone-*` are unused (03b's Pass flow runs on tablets only).
test('[01d §3.13.6a; dl t1] layers: the Mark served sheet from OrderView covers the banners', async ({ browser, request }, info) => {
  test.skip(!LAYER_VIEWPORTS.includes(info.project.name), 'the side-panel layouts: landscape tablet and kiosk');
  test.setTimeout(120_000);
  const h = hub();
  const order = `O3-pass-${isKiosk(info) ? 'phone-360' : 'phone-390'}-en`;
  const ali = await screen(browser, info);
  try {
    await signInAt(ali, isKiosk(info) ? h.kiosk : h.device, 'Ali');
    await go(ali, `#/orders/${order}`);
    const view = ali.locator(`[data-order="${order}"]`).first();
    await expect(view).toBeVisible();
    expect(await view.evaluate((el) => el.closest('.scrim--route') !== null), 'OrderView is a route sheet').toBe(true);
    const line = view.locator('[aria-expanded]').first();
    if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click();
    await line.getByRole('button', { name: tr(LANG, 'served.title') }).click();
    const popup = ali.locator('.dlg[role="dialog"]').last();
    await expect(popup).toBeVisible();
    await popupCoversBanner(ali, request, info, popup, 'mark-served');
  } finally {
    await staffCommand(request, h.device3, 'S_SARA', 'SetZoneStock', { zone_id: ZONE, item_id: COLA, on_hand: 500 });
    await close(ali, info);
  }
});

// ------------------------------------------------------------------------------------------------------------------
// 6. §3.13.4 "9b notification tap while signed out" (test 91, page half): the app opens at #/inbox?focus=alert:<id>
//    behind the sign-in; the focus is kept through it, and the card glows once (dl cs12, #264).
test('[01d §3.13.4 #91; dl t1] Inbox focus kept through the sign-in', async ({ browser }, info) => {
  test.skip(info.project.name !== 'tablet-portrait', 'one viewport is enough here');
  test.setTimeout(120_000);
  const h = hub();
  const [table] = dlPair('closed', info);
  const ali = await screen(browser, info);
  const mgr = await screen(browser, info);
  try {
    await signInAt(ali, h.device, 'Ali');
    await tapTile(ali, table);
    await askVoid(ali);
    await signInAt(mgr, h.device2, 'Manager', PIN_MANAGER);
    await go(mgr, '#/inbox');
    const card = mgr.locator('main [data-alert]', { hasText: table }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    const alertId = (await card.getAttribute('data-alert'))!;
    await signOut(mgr, info, LANG);
    await expect(mgr.locator('.who__t').first()).toBeVisible();

    await go(mgr, `#/inbox?focus=alert:${alertId}`);
    await enter(mgr, h.device2, 'Manager', PIN_MANAGER);
    await glowOf(mgr, 'the Inbox card', (x) => x.data['alert'] === alertId);
    await expect.poll(() => hash(mgr)).toBe('#/inbox');
    await shot(mgr, info, 'inbox-focus-after-sign-in');
  } finally {
    await withdrawLeftover(ali);
    await close(mgr, info);
    await close(ali, info);
  }
});
