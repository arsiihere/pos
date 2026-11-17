import { expect, test } from "@playwright/test";
import {
  hub,
  pairAs,
  runKey,
  signInPass,
  signOut,
  tr,
  withLiveClock,
  type Lang,
} from "./03b-support";

// 03b v1.0.8 §3.6, §6.15, §8, #74, test #40, #41 (Z1): takeover. The kitchen screen is open ;
// its window is closed, so the hub sees the screen drop. After kds_offline_ms (3 s in the
// e2e config) the Pass of the station's point shows "{station} screen offline" with the station's Now rows: Start works
// from the Pass, and so does Reprint (the station prints too, IR-15, Q-51). The screen comes back: the section goes and
// the Pass says "{station} screen is back" (Q-56).

for (const lang of ["en", "ur"] as Lang[]) {
  test(`[03b §3.6, #74, #40, #41; 03c §3.5 @combined] a screen drops: the Pass takes over its rows, then it is back (${lang})`, async ({
    page,
    browser,
  }, info) => {
    // the hub's clock runs for this flow: the screen is dark after kds_offline_ms of hub time
    await withLiveClock(async () => {
      test.skip(
        !["tablet-landscape", "tablet-portrait"].includes(info.project.name),
        "the Pass runs on a tablet, landscape and portrait",
      );
      const key = runKey("takeover", info, lang);
      const h = hub();
      const station = `Grill ${key}`;
      const screen = h.devices03[`kds:${key}`]!;
      const keys = {
        token: screen.token,
        device_id: screen.device_id,
        device_type: "kds",
      };
      // the kitchen screen: its own browser context, paired (its keys in the pairing store), live with its three rows
      const openScreen = async () => {
        const ctx = await browser.newContext({
          ...info.project.use,
          viewport: { width: 1920, height: 1080 },
        });
        const kds = await ctx.newPage();
        await kds.goto(`${h.baseURL}/kds/`);
        await kds.evaluate(
          (k) =>
            new Promise<void>((resolve) => {
              const open = indexedDB.open("pos-device", 1);
              open.onupgradeneeded = () =>
                open.result.createObjectStore("device");
              open.onsuccess = () => {
                const tx = open.result.transaction("device", "readwrite");
                for (const [key, value] of Object.entries(k))
                  tx.objectStore("device").put(value, key);
                tx.oncomplete = () => resolve();
              };
            }),
          keys,
        );
        await kds.reload();
        await expect(kds.locator("article.kl")).toHaveCount(3);
        return ctx;
      };
      let context = await openScreen();
      try {
        // the Pass tablet of the station's point: no takeover while the screen is up
        await pairAs(
          page,
          { ...h.devices03[`pass:${key}`]!, device_type: "tablet" },
          lang,
        );
        await signInPass(page, "Cook");
        await expect(page.locator("article.pc")).toHaveCount(1);
        await expect(page.locator(".tko")).toHaveCount(0);

        // the screen's window closes: the hub sees it drop
        await context.close();
        const section = page.locator(".tko");
        await expect(section).toBeVisible({ timeout: 30_000 });
        await expect(section).toContainText(
          tr(lang, "pass.takeover", { station }),
        );
        await expect(section.locator("article.kl")).toHaveCount(3);

        // run it from the Pass: Start, and Reprint (one ticket of this station)
        const first = section.locator("article.kl").first();
        await first.locator(".btn--start").click();
        await expect(first.locator(".btn--done")).toBeVisible();
        await section
          .locator("article.kl")
          .nth(1)
          .getByRole("button", { name: tr(lang, "print.reprint") })
          .click();
        await expect(
          page.getByText(tr(lang, "print.reprinting", { n: "1" })),
        ).toBeVisible();

        // the screen is back: the takeover ends at once and the Pass says so
        context = await openScreen();
        await expect(section).toHaveCount(0, { timeout: 60_000 });
        await expect(
          page.getByText(tr(lang, "pass.screen_back", { station })),
        ).toBeVisible();
      } finally {
        await context.close();
        await signOut(page, info, lang);
      }
    });
  });
}
