import { expect, test } from '@playwright/test';
import { KITCHEN } from './02b-support';
import { pairKdsScreen } from './03b-support';
import { apiSession, runId } from './t1-support';

// BUG-14 (03b v1.0.16 §3.2 Give me more, §3.3 Now / Next, §6.4 GiveMeMore; 03a pullEarly): on the kitchen screen, Give
// me more pulls the next line from Next; it joins Now at once (the hub's station_plan and FireDispatched { reason:
// 'pulled' } frames), with no reload. Against the e2e hub (fixed clock, no fires tick): a takeaway of Naan (S1) and
// Kheer (the Dessert station S-E2E, pullable at once, global-setup) puts the Kheer in the Dessert station's Next.

test('[03b §3.2, §3.3, §6.4; BUG-14] Give me more: the pulled line shows in Now live, no reload', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'kiosk', 'one run is enough: the KDS at 1920');
  await pairKdsScreen(page, request, KITCHEN.kheer.station_id, 'en');
  const api = await apiSession(request, 'S_OWNER');
  try {
    const order_id = runId('KDS-MORE');
    const kheer = `${order_id}-K`;
    const placed = await api.command('SubmitOrder', {
      order_id,
      order_type: 'takeaway',
      lines: [
        { order_item_id: `${order_id}-N`, item_id: KITCHEN.naan.item_id, quantity: 1 },
        { order_item_id: kheer, item_id: KITCHEN.kheer.item_id, quantity: 1 },
      ],
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(200);
    // the Kheer waits for its sync group: planned (Next / Later), not in Now
    await expect(page.locator('.knx')).toContainText(/Later: [1-9]|Next [1-9]/, { timeout: 10_000 });
    await expect(page.locator(`section.ksec article.kl[data-id="${kheer}"]`)).toHaveCount(0);
    const more = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/commands/give-me-more'));
    await page.getByRole('button', { name: 'Give me more' }).click();
    const answer = (await (await more).json()) as { data: { result: { pulled: string[] | null } } };
    const pulled = answer.data.result.pulled;
    expect(pulled, 'something to pull').not.toBeNull();
    // every pulled line joins Now and leaves Next, live
    for (const id of pulled!) {
      await expect(page.locator(`section.ksec article.kl[data-id="${id}"]`), `${id} in Now`).toBeVisible({ timeout: 5_000 });
      await expect(page.locator(`.knx [data-id="${id}"]`)).toHaveCount(0);
    }
  } finally {
    await api.close();
  }
});
