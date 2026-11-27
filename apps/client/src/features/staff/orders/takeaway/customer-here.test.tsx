import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { screenHarness, sl, view } from './screen-harness';
import { aRow, at } from './test-fixtures';

// BUG-4 (02b v1.0.25 §6.6 BoostOrder `boost-order`, §8 02b-R4-3 "Customer is here — cook now"; 03a v1.2.11 PK-5; D1;
// 01b v1.12 §6.15 default grants): the cashier kiosk's token view of a pickup token — paid or due, its pickup ~20 min
// ahead (QA: #13 paid pickup 1:06, #10 due pickup 1:00, viewed ~20 min before) — offers Customer is here to whoever
// holds `boost-order` (Owner, Manager, Order taker by default), through the real rail → drawer path. The default
// Cashier role has no `boost-order` (01b v1.12 §6.15 "boost-order still not"; 02b §3.14), so the hub would refuse
// the command and the button stays hidden for it (spec conflict reported: 03b's Pass says "use 'Customer is here' at
// the counter").

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

const tick = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
// the harness's hub clock reads 13:20; the pickups are 20 min ahead
const PAID_PICK = at(13, 46);
const DUE_PICK = at(13, 40);
const openBill = (bill_id: string, owed: number) => ({ bill_id, state: 'open', splits: [{ split_no: 1, state: 'open', balance_minor: owed }], totals_default: { total_minor: owed } });
const closedBill = (bill_id: string, paid: number) => ({ bill_id, state: 'closed', splits: [{ split_no: 1, state: 'closed', balance_minor: 0, totals: { as_paid: { total_minor: paid } }, invoice: null }], totals_default: { total_minor: 0 } });

function harness(grants: Record<string, unknown>) {
  const rows = [
    aRow({ order_id: 'O13', token: 13, placed_at: at(13, 0), ready: { n: 0, m: 1 }, promise_ms: PAID_PICK, pickup_at_ms: PAID_PICK, effective_pickup_at_ms: PAID_PICK, bill: { state: 'paid', due_minor: 0 } }),
    aRow({ order_id: 'O10', token: 10, placed_at: at(12, 50), ready: { n: 0, m: 1 }, promise_ms: DUE_PICK, pickup_at_ms: DUE_PICK, effective_pickup_at_ms: DUE_PICK, bill: { state: 'due', due_minor: 4_000 } }),
  ];
  const views = { O13: { ...view('O13', [sl('O13', 'A', 'Karahi', 'added')]), billed: true }, O10: view('O10', [sl('O10', 'B', 'Karahi', 'added')]) };
  return screenHarness({ rows, views, bills: { O13: closedBill('B13', 4_000), O10: openBill('B10', 4_000) }, grants });
}
const openToken = async (m: Mounted, token: number) => {
  const entry = [...m.container.querySelectorAll<HTMLElement>('.tk-qr, .tk-rt__open')].find((e) => (e.querySelector('.tk-tok, .tok')?.textContent ?? '') === String(token))!;
  m.click(entry);
  await tick(300);
};
const here = (m: Mounted) => [...m.container.querySelectorAll<HTMLButtonElement>('.tk-drawer button')].find((b) => b.textContent === 'Customer is here — cook now') ?? null;

describe('[BUG-4; 02b §6.6, §8 02b-R4-3; D1] Customer is here on the cashier kiosk, a pickup ~20 min ahead', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }));
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  for (const [what, token] of [['paid #13', 13], ['due #10', 10]] as const) {
    it(`[${what}] boost-order (Owner / Manager) → offered; a tap sends BoostOrder for that order`, async () => {
      const h = harness({ 'boost-order': { grant: 'allowed', scope: 'branch' } });
      const m = h.render();
      await flush();
      await openToken(m, token);
      expect(here(m)).not.toBeNull();
      m.click(here(m));
      await flush();
      expect(h.commands.filter((c) => c.type === 'BoostOrder').map((c) => c.payload)).toEqual([{ order_id: token === 13 ? 'O13' : 'O10' }]);
      m.unmount();
    });

    it(`[${what}] the default Cashier (no boost-order, 01b §6.15) → not offered`, async () => {
      const h = harness({});
      const m = h.render();
      await flush();
      await openToken(m, token);
      expect(m.container.querySelector('.tk-drawer')).not.toBeNull();
      expect(here(m)).toBeNull();
      m.unmount();
    });
  }
});
