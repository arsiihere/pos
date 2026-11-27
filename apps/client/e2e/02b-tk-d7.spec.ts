import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { receivingPointOf } from './03b-fixture';
import { hub, hubConfig, LANGS, pairAs, PIN_MANAGER, runKey, runStation, signInPass, signOut, tr, type Lang } from './03b-support';

// 02b-TK L-CLIENT-2 item 1 (03b v1.0.16 §3.10 "Pass archive (D7)", §6.15, §6.16 (R3-M-1); 01a v2.11 §6.9a, §6.21
// (R3-B-1); D7). The 'd7' run (03b-fixture.ts) has a Pass point of its own holding a takeaway order of three lines, and
// a receiving point with its own Pass tablet. A real config apply (the hub's poller, its stub cloud) archives the run's
// point and makes the receiving point its station's default:
//   - the archived point's Pass tablet gets point_view_refresh { view: null } → "This point was retired …", no cards;
//   - the receiving Pass tablet gets its refreshed view → the moved card, each line "Moved from Pass d7-…".
// Then a config that archives every point is refused (no active destination; nothing commits): the hub admin config
// status shows "Menu update refused: activate another Pass point first." A "not modified" poll clears it afterwards.

const RUNS_ON = ['kiosk', 'tablet-landscape'];
const runsHere = (info: TestInfo) => {
  test.skip(!RUNS_ON.includes(info.project.name), 'the Pass and the hub admin page at the kiosk and landscape tablet viewports');
  test.setTimeout(90_000);
};

async function capture(page: Page, info: TestInfo, frame: string, what?: Locator) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(frame + '.png');
  if (what === undefined) await page.screenshot({ path });
  else await what.screenshot({ path });
  await info.attach(frame, { path, contentType: 'image/png' });
}

for (const lang of LANGS) {
  test(`[03b v1.0.16 §3.10, §6.16 R3-M-1; D7] archiving a Pass point: the old Pass is retired, the receiving Pass shows "Moved from" (${lang})`, async ({ browser }, info) => {
    runsHere(info);
    const key = runKey('d7', info, lang);
    const h = hub();
    const from = h.devices03[`pass:${key}`]!;
    const to = h.devices03[`passTo:${key}`]!;
    const fromContext = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const toContext = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const oldPass = await fromContext.newPage();
    const newPass = await toContext.newPage();
    let oldIn = false;
    let newIn = false;
    try {
      await pairAs(oldPass, { ...from, device_type: 'tablet' }, lang);
      await signInPass(oldPass, 'Cook');
      oldIn = true;
      await expect(oldPass.locator('article.pc')).toHaveCount(1);
      await pairAs(newPass, { ...to, device_type: 'tablet' }, lang);
      await signInPass(newPass, 'Pervez');
      newIn = true;
      await expect(newPass.locator('article.pc')).toHaveCount(0);

      const applied = await hubConfig({ kind: 'archive', point: `P3-${key}`, station: runStation('d7', info, lang), to: receivingPointOf(info.project.name, lang) });
      expect(applied.outcome).toBe('applied');

      // the archived point's tablet: one full-screen state, no cards, no actions
      const retired = oldPass.locator('[data-retired]');
      await expect(retired).toBeVisible();
      await expect(retired).toContainText(tr(lang, 'pass.point_retired'));
      await expect(oldPass.locator('article.pc')).toHaveCount(0);
      await expect(oldPass.locator('main.pass button')).toHaveCount(0);
      await capture(oldPass, info, `PassRetired-${info.project.name}-${lang}`);

      // the receiving tablet: the moved card, every line labelled with the old point's name
      const card = newPass.locator('article.pc');
      await expect(card).toHaveCount(1);
      const moved = card.locator('[data-moved]');
      await expect(moved).toHaveCount(3);
      await expect(moved.first()).toHaveText(tr(lang, 'pass.moved_from', { point: `Pass ${key}` }));
      await capture(newPass, info, `PassMovedFrom-${info.project.name}-${lang}`);
    } finally {
      if (newIn) await signOut(newPass, info, lang).catch(() => undefined);
      if (oldIn) await signOut(oldPass, info, lang).catch(() => undefined);
      await fromContext.close();
      await toContext.close();
    }
  });
}

async function signInAdmin(page: Page, path: string, lang: Lang): Promise<void> {
  const h = hub();
  await page.goto(`${h.baseURL}${path}?lang=${lang}`);
  await page.evaluate(
    (keys) =>
      new Promise<void>((resolve) => {
        const open = indexedDB.open('pos-device', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('device');
        open.onsuccess = () => {
          const tx = open.result.transaction('device', 'readwrite');
          for (const [k, v] of Object.entries(keys)) tx.objectStore('device').put(v, k);
          tx.oncomplete = () => resolve();
        };
      }),
    { token: h.device.token, device_id: h.device.device_id, device_type: 'tablet' },
  );
  await page.reload();
  await page.locator('.pos-staff__tile', { hasText: 'Manager' }).click();
  for (const digit of PIN_MANAGER) await page.locator('.pos-pin__keys .pos-pin__key', { hasText: new RegExp(`^${digit}$`) }).click();
  await page.locator('.pos-pin__key--fn').last().click();
}

for (const lang of LANGS) {
  test(`[01a v2.11 §6.21 R3-B-1, §6.9a; D7] config status: a Pass archive the hub refuses says "activate another Pass point first" (${lang})`, async ({ browser }, info) => {
    runsHere(info);
    const context = await browser.newContext({ ...info.project.use, deviceScaleFactor: 2 });
    const page = await context.newPage();
    try {
      const refused = await hubConfig({ kind: 'refuse' });
      expect(refused.outcome).toBe('rejected');
      expect(refused.problem).toMatchObject({ reason: 'apply_failed', code: 'VALIDATION_FAILED', details: { issues: [{ path: 'archived', message: 'Activate another Pass point first' }] } });
      await signInAdmin(page, '/admin/stock/', lang);
      const banner = page.locator('.pos-banner--danger');
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText(tr(lang, 'admin_stock.problem.archive_refused'));
      await capture(page, info, `ConfigArchiveRefused-${info.project.name}-${lang}`);
    } finally {
      const cleared = await hubConfig({ kind: 'clear' });
      expect(cleared.problem).toBeNull();
      await context.close();
    }
  });
}
