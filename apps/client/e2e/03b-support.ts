import { rmSync, writeFileSync } from "node:fs";
import {
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { hub, type Lang } from "./02b-support";
import { keyOf, lineId, stationOf, type Flow03 } from "./03b-fixture";

// 03b / 03c flows (Z1): helpers on top of 02's. A run takes its own station (see 03b-fixture.ts).

export * from "./02b-support";
export { keyOf, lineId, stationOf };

export const PIN_MANAGER = "0123";

export const runKey = (flow: Flow03, info: TestInfo, lang: Lang): string =>
  keyOf(flow, info.project.name, lang);
export const runStation = (flow: Flow03, info: TestInfo, lang: Lang): string =>
  stationOf(flow, info.project.name, lang);

/** The Manager's admin session (POST /admin/auth, the call 00's admin pages make). */
export async function adminSession(
  request: APIRequestContext,
): Promise<{ token: string; staff_id: string }> {
  const h = hub();
  const device = { Authorization: `Bearer ${h.device.token}` };
  const roster = await request.get(`${h.baseURL}/admin/login-roster`, {
    headers: device,
  });
  const staff = (
    (await roster.json()) as {
      data: { staff: Array<{ staff_id: string; display_name: string }> };
    }
  ).data.staff;
  const manager = staff.find((s) => s.display_name === "Manager");
  if (manager === undefined) throw new Error("no Manager in the admin roster");
  const login = await request.post(`${h.baseURL}/admin/auth`, {
    headers: device,
    data: { staff_id: manager.staff_id, pin: PIN_MANAGER },
  });
  const data = (
    (await login.json()) as {
      data: { admin_session_token: string; staff_id: string };
    }
  ).data;
  return { token: data.admin_session_token, staff_id: data.staff_id };
}

let commandSeq = 0;
/** An admin command as 00's admin pages send it (the approving device is the e2e tablet). */
export async function adminCommand(
  request: APIRequestContext,
  path: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const h = hub();
  const session = await adminSession(request);
  commandSeq += 1;
  const res = await request.post(`${h.baseURL}/admin/commands/${path}`, {
    headers: {
      Authorization: `Bearer ${h.device.token}`,
      "X-Admin-Session": session.token,
    },
    data: {
      command_id: `e2e03-${process.pid}-${commandSeq}`,
      tenant_id: h.tenant_id,
      branch_id: h.branch_id,
      command_type: type,
      payload,
      // eslint-disable-next-line no-restricted-syntax -- the e2e client has no Clock; the hub stamps its own time
      occurred_at: Date.now(),
      actor_id: session.staff_id,
      device_id: h.device.device_id,
    },
  });
  return { status: res.status(), body: await res.json() };
}

/**
 * Pairs a new kitchen screen the way a person does: the screen's /pair page shows a code; the Manager approves it for
 * the station (the call 00's /admin/approve page makes); the page says Paired and goes on to /kds/ (00 v1.9.2 §8.2).
 */
export async function pairKdsScreen(
  page: Page,
  request: APIRequestContext,
  station: string,
  lang: Lang,
): Promise<void> {
  const h = hub();
  await page.goto(`${h.baseURL}/pair?lang=${lang}`);
  const code = (
    await page.locator(".display-code").first().innerText()
  ).replace(/\s/g, "");
  const done = await adminCommand(
    request,
    "approve-pairing-request",
    "ApprovePairingRequest",
    { display_code: code, device_type: "kds", station_id: station },
  );
  expect(done.status, "approve-pairing-request").toBe(200);
  await page.waitForURL(/\/kds\/$/, { timeout: 15_000 });
}

/** The card of a line on the station view. */
export const card = (page: Page, key: string, n: number) =>
  page.locator(`article.kl[data-id="${lineId(key, n)}"]`);

/** Sign in on a Pass tablet: the app lands on the Pass (a point in the catch-up, 03b W0.6), not on the map. */
export async function signInPass(
  page: Page,
  name: string,
  pin = "1234",
): Promise<void> {
  const enter = async () => {
    for (const digit of pin)
      await page
        .locator(".pin__keys .btn", { hasText: new RegExp(`^${digit}$`) })
        .click();
    await page.locator(".pin__keys .btn--primary").click();
  };
  await page.locator(".who__t", { hasText: name }).click();
  await enter();
  const taken = page.locator(".pin__err");
  await Promise.race([
    page.locator(".who__t").first().waitFor({ state: "detached" }),
    taken.waitFor({ state: "visible" }),
  ]);
  if (await taken.isVisible()) await enter();
  await expect(page.locator("main.pass")).toBeVisible({ timeout: 15_000 });
}

/**
 * Runs `body` with the hub's clock at wall-clock speed (the global setup's driver watches this flag file): for the specs
 * that wait on time the hub itself keeps (kds_offline_ms, the presence tick). Others keep the fixed test clock.
 */
export async function withLiveClock<T>(body: () => Promise<T>): Promise<T> {
  const flag = (process.env["POS_E2E_HUB"] ?? "").replace(/\.json$/, ".clock");
  writeFileSync(flag, "1");
  try {
    return await body();
  } finally {
    rmSync(flag, { force: true });
  }
}
