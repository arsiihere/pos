// 02b v1.0.25 §6.16, §6.18, §10 test 83 (run 1 m-1): `pnpm test:perf` only (real disk, never in the normal gate:
// apps/hub/vitest.config.ts excludes test/**/*.perf.test.ts; never in CI or the cloud). 400 paid takeaways of the day,
// 10 of them not handed over → `open-orders` p99 < 40 ms (through Fastify inject) and the catch-up part `orders` build
// < 60 ms. Wall-clock bounds, so the owner runs it on a quiet machine (AD-4, AD-32). L-CLOSE-2.
import { performance } from 'node:perf_hooks';
import type { EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ordersCatchUpPart } from '../../src/orders/catch-up';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, openDay } from './fixtures';

const ORDERS = 400;
const NOT_HANDED = 10;
const OPEN_ORDERS_P99_MS = 40;
const CATCH_UP_MS = 60;
const WARM_UP = 3;
const SAMPLES = 31;

const pctl = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]!;
};

let hub: TestHub;
let auth: { token: string; session: string };

beforeAll(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await aDirectory());
  openDay(hub);
  const at = () => hub.clock.branchNow();
  for (let i = 0; i < ORDERS; i += 1) {
    const order_id = `P${String(i).padStart(4, '0')}`;
    appendOrder(hub, { order_type: 'takeaway', order_id, lines: [{ order_item_id: `${order_id}a`, item_id: FX.naan, quantity: 2 }, { order_item_id: `${order_id}b`, item_id: FX.ready }] });
    const drafts: EventDraft[] = [{ stream_type: 'order', stream_id: order_id, event_type: 'OrdersBilled', schema_version: 1, payload: { order_ids: [order_id], bill_id: `B${order_id}` }, occurred_at: at(), actor_id: null, device_id: 'hub' }];
    // all but the last NOT_HANDED are handed over (served by tap)
    if (i < ORDERS - NOT_HANDED) drafts.push({ stream_type: 'order', stream_id: order_id, event_type: 'ItemServed', schema_version: 1, payload: { order_item_ids: [`${order_id}a`, `${order_id}b`], source: 'tap' }, occurred_at: at(), actor_id: null, device_id: 'hub' });
    hub.deps.writer.run((tx) => tx.append(drafts));
  }
  const device = pairDevice(hub, { type: 'cashier_kiosk' });
  const session = openSession(hub, { kind: 'staff', staffId: 'S_CASH', deviceId: device.deviceId });
  auth = { token: device.token, session: session.token };
}, 600_000);

afterAll(async () => {
  swapBranchConfig(null);
  await hub.close();
});

describe('[02b #83 perf] open-orders and the catch-up on a day of 400 paid takeaways', () => {
  it(`open-orders p99 < ${OPEN_ORDERS_P99_MS} ms with ${NOT_HANDED} listed`, async () => {
    const one = async (): Promise<number> => {
      const t0 = performance.now();
      const res = await hub.app.inject({ method: 'GET', url: '/queries/open-orders', headers: { authorization: `Bearer ${auth.token}`, 'x-session-token': auth.session } });
      const ms = performance.now() - t0;
      expect(res.statusCode).toBe(200);
      expect((res.json() as { data: { orders: unknown[] } }).data.orders).toHaveLength(NOT_HANDED);
      return ms;
    };
    for (let i = 0; i < WARM_UP; i += 1) await one();
    const xs: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) xs.push(await one());
    expect(pctl(xs, 0.99)).toBeLessThan(OPEN_ORDERS_P99_MS);
  });

  it(`the catch-up part orders builds in < ${CATCH_UP_MS} ms`, () => {
    const part = ordersCatchUpPart(hub.clock);
    const state = hub.deps.state.get() as EngineState;
    const ctx = { deviceId: 'D1', deviceType: 'cashier_kiosk' as const, sessionId: 'X', kind: 'staff' as const, staffId: 'S_CASH', stationId: null, asOfSeq: 0 };
    for (let i = 0; i < WARM_UP; i += 1) part.build(hub.deps.db, state, ctx);
    const xs: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const t0 = performance.now();
      const built = part.build(hub.deps.db, state, ctx) as { orders: unknown[] };
      xs.push(performance.now() - t0);
      expect(built.orders).toHaveLength(NOT_HANDED);
    }
    expect(pctl(xs, 0.99)).toBeLessThan(CATCH_UP_MS);
  });
});
