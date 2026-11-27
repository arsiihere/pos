import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { hub, pairAs, signInPass, signOut, type Lang } from './03b-support';
import { t1Items, t1Key, t1OtherPoint, t1Point, type T1Flow, type T1Request } from './t1-fixture';

// L-E2E-T1: helpers of the dry-run journeys (t1-*.spec.ts) — the run's own Pass point and items (t1-fixture.ts), the
// hub's print jobs and clock (the global setup's T1 driver), screenshots, and a second device in its own context.

export * from './03b-support';
export { t1Items, t1Key, t1OtherPoint, t1Point };

// `@gap` in a test's title: a dry-run row the e2e found unmet (a missing client feature or a bug, reported to the lane
// that owns it). The test stays and fails until that lane's fix lands; the gate's e2e job runs with --grep-invert @gap.
export const T1_RUNS_ON = ['kiosk', 'tablet-landscape'];
/** the takeaway counter and the Pass run at the kiosk and landscape tablet viewports (02b-TK C2-1) */
export function t1RunsHere(info: TestInfo, timeout = 150_000): void {
  test.skip(!T1_RUNS_ON.includes(info.project.name), 'the takeaway counter and the Pass at the kiosk and landscape tablet viewports');
  test.setTimeout(timeout);
}

export interface T1Run {
  key: string;
  point: string;
  items: ReturnType<typeof t1Items>;
}
export const t1Run = (flow: T1Flow, info: TestInfo, lang: Lang): T1Run => {
  const key = t1Key(flow, info.project.name, lang);
  return { key, point: t1Point(key), items: t1Items(key) };
};

let seq = 0;
/** One request to the global setup's T1 driver (t1-fixture `startT1Driver`). */
export async function t1Hub<T>(req: T1Request): Promise<T> {
  const base = (process.env['POS_E2E_HUB'] ?? '').replace(/\.json$/, '');
  const id = `${process.pid}-${++seq}`;
  const done = `${base}.t1-${id}.json`;
  writeFileSync(`${base}.t1-req.json`, JSON.stringify({ ...req, id }));
  for (let i = 0; i < 300; i++) {
    if (existsSync(done)) {
      const res = JSON.parse(readFileSync(done, 'utf8')) as T & { error?: string };
      rmSync(done, { force: true });
      if (res.error !== undefined) throw new Error(res.error);
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('the e2e hub did not answer the T1 request');
}

export const hubNow = async (): Promise<number> => (await t1Hub<{ now: number }>({ kind: 'now' })).now;
export const hubAdvance = async (ms: number): Promise<number> => (await t1Hub<{ now: number }>({ kind: 'advance', ms })).now;

/** Fires the station's unfired lines (FireDispatched), as the hub's fires tick would once their time comes. */
export const hubFire = async (station: string, except: string[] = []): Promise<string[]> => (await t1Hub<{ fired: string[] }>({ kind: 'fire', station, except })).fired;

export interface PrintJob {
  job_id: string;
  printer_id: string;
  order_id: string | null;
  created_at: number;
  kind_label: string | null;
  text: string;
}
/** The hub's document print jobs since `since` (hub time), rendered as the paper reads. */
export const printJobs = async (since: number): Promise<PrintJob[]> => (await t1Hub<{ jobs: PrintJob[] }>({ kind: 'jobs', since })).jobs;
/** Waits for a job of `kind_label` since `since` (the receipt and slip print in the command's transaction). */
export async function printedJob(since: number, kind_label: string, match?: RegExp): Promise<PrintJob> {
  let found: PrintJob | undefined;
  await expect(async () => {
    found = (await printJobs(since)).find((j) => j.kind_label === kind_label && (match === undefined || match.test(j.text)));
    expect(found, `a "${kind_label}" print job`).toBeDefined();
  }).toPass({ timeout: 10_000 });
  return found!;
}

/** A device of its own (a second screen at another viewport) in a fresh context. */
export async function screen(browser: Browser, viewport: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  return { context, page: await context.newPage() };
}

/** The run point's Pass tablet, signed in by `name` (Pervez: the Pass role, run-pass + mark-served). */
export async function passTablet(page: Page, flow: T1Flow, info: TestInfo, lang: Lang, name = 'Pervez', which: 'pass' | 'passB' = 'pass'): Promise<void> {
  const d = hub().devicesT1[`${which}:${t1Key(flow, info.project.name, lang)}`]!;
  await pairAs(page, { ...d, device_type: 'tablet' }, lang);
  await signInPass(page, name);
}

/** The Manager's own phone (listed), signed in with the Manager's PIN. */
export async function managerPhone(page: Page, lang: Lang): Promise<void> {
  const d = hub().devicesT1['managerPhone']!;
  await pairAs(page, { ...d, device_type: 'phone' }, lang);
  const pad = page.locator('.pin__keys');
  for (const digit of '0123') await pad.locator('.btn', { hasText: new RegExp(`^${digit}$`) }).click();
  await pad.locator('.btn--primary').click();
  await expect(pad).toHaveCount(0);
}

/** The Pass card of a token. */
export const passCard = (page: Page, token: string): Locator => page.locator('article.pc', { has: page.locator('.pc__n', { hasText: new RegExp(`^#?${token}$`) }) });

/** Start then Done on a Pass line row (a Done this soon asks once more; the second tap confirms). */
export async function cookLine(card: Locator, name: string): Promise<void> {
  const row = card.locator('.pl', { hasText: name });
  await row.locator('.btn--start').click();
  await row.locator('.btn--done').click();
  const undo = row.locator('.btn--undo');
  await expect(undo.or(card.locator('.pc__act'))).toBeVisible();
  if (!(await undo.isVisible())) await row.locator('.btn--done').click();
  await expect(undo).toBeVisible();
}

export async function capture(page: Page, info: TestInfo, name: string, what?: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const path = info.outputPath(`${name}.png`);
  if (what === undefined) await page.screenshot({ path });
  else await what.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

/** Signs out and closes, never throwing over the test's own failure. */
export async function closeAll(info: TestInfo, lang: Lang, ...screens: Array<{ context: BrowserContext; page: Page }>): Promise<void> {
  for (const s of screens) {
    await signOut(s.page, info, lang).catch(() => undefined);
    await s.context.close().catch(() => undefined);
  }
}

export interface ApiSession {
  command(type: string, payload: Record<string, unknown>): Promise<{ status: number; body: { data?: { result: Record<string, unknown> }; error?: { code: string; details: Record<string, unknown> } } }>;
  query<T>(path: string): Promise<T>;
  close(): Promise<void>;
}

let apiSeq = 0;
/** A staff session on the kitchen tablet (POST /auth/pin), for a journey's set-up and read-backs only. */
export async function apiSession(request: import('@playwright/test').APIRequestContext, staff_id: string, pin = '1234'): Promise<ApiSession> {
  const h = hub();
  const device = { Authorization: `Bearer ${h.kitchen.token}` };
  const signIn = await request.post(`${h.baseURL}/auth/pin`, { headers: device, data: { staff_id, pin, takeover: true } });
  expect(signIn.status(), `auth/pin ${staff_id}: ${await signIn.text()}`).toBe(200);
  const session = ((await signIn.json()) as { data: { session_token: string } }).data.session_token;
  const headers = { ...device, 'X-Session-Token': session };
  return {
    async command(type, payload) {
      apiSeq += 1;
      const kebab = type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const res = await request.post(`${h.baseURL}/commands/${kebab}`, {
        headers,
        data: {
          command_id: `e2e-t1-${process.pid}-${apiSeq}`,
          tenant_id: h.tenant_id,
          branch_id: h.branch_id,
          command_type: type,
          payload,
          // eslint-disable-next-line no-restricted-syntax -- the e2e client has no Clock; the hub stamps its own time
          occurred_at: Date.now(),
          actor_id: staff_id,
          device_id: h.kitchen.device_id,
        },
      });
      return { status: res.status(), body: (await res.json()) as never };
    },
    async query<T>(path: string) {
      const res = await request.get(`${h.baseURL}/queries/${path}`, { headers });
      expect(res.status(), `${path}: ${await res.text()}`).toBe(200);
      return ((await res.json()) as { data: T }).data;
    },
    async close() {
      await request.post(`${h.baseURL}/auth/logout`, { headers, data: {} });
    },
  };
}

/**
 * The queue entry of a token at the counter: the kiosk shows its queue column; the landscape tablet keeps it behind
 * the rail strip's queue toggle (02b-TK C2-1), which this opens first.
 */
export async function queueEntry(page: Page, token: string): Promise<Locator> {
  const { railEntry, readyTile } = await import('./02b-support');
  // an open token drawer covers the tablet's rail strip: close it first
  const open = page.locator('section.tk-drawer');
  if (await open.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
  }
  const strip = page.locator('.tk-rstrip');
  if ((await strip.count()) > 0 && (await readyTile(page, token).count()) === 0 && (await page.locator('.tk-qr').count()) === 0) await strip.locator('.tk-rstrip__q').click();
  return railEntry(page, token).first();
}

let idSeq = 0;
/** An id no other run of this hub uses: the worker's pid and a counter (no wall clock, F §6.7). */
export const runId = (prefix: string): string => `${prefix}-${process.pid}-${++idSeq}`.toUpperCase();
