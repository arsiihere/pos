// 02b §7 Performance, §10 #34 (E2-ETA AC1): SubmitOrder p99 < 60 ms (12 lines, peak engine), eta-preview p99 < 40 ms,
// seating-orders < 30 ms (§7's third row, timed here as a p99 too). 03a AD-32 / 02b AD-4: wall-clock bounds, so this file
// runs only in the clean measurement (`pnpm test:perf`, project perf-hub, real disk), never in the normal gate
// (apps/hub/vitest.config.ts excludes test/**/*.perf.test.ts). No agent runs it; the owner does (AD-4).
//
// Fixture (the 03a perf pattern, fires-tick.perf.test.ts / snapshots.perf.test.ts): the AD-27 normal peak day of seed 7
// (@pos/engine/sim), its state with the most lines, swapped into a test hub whose branch config routes the cart's items
// to the day's slot stations (tandoor, karahi, bbq, tawa) under the same ids, so planOrder plans against the peak queues.
// The business day is the day's own (state.business_day). The hub clock stands at the peak's instant.
//
// The cart: 11 cart lines + 1 linked option child = 12 ItemAdded, every one an engine line, no stock draws (the sim day
// counts no stock), dine-in on a seating the person holds (requireLock, follow_up read, 02a fold) — the heaviest
// normal submit. One sample = one POST /commands/submit-order through Fastify inject (schema, pipeline, BEGIN IMMEDIATE,
// the append, the folds, COMMIT with WAL + synchronous=FULL, the reply). Before each sample the peak state is swapped
// back, so every sample plans on the same peak and none leans on another's orders; the log and the projections keep
// growing, which only makes later samples a little heavier.
//
// eta-preview: the same cart as a draft (keys, no ids), read-only, on the peak state. seating-orders: a second seating
// with 4 such rounds (48 lines) submitted on the peak, then the query on that state.
import { performance } from 'node:perf_hooks';
import type { EngineState } from '@pos/engine';
import type { BranchConfig, ConfigItem, ConfigStation, DirectoryInput } from '@pos/events';
import { aBranchConfig } from '@pos/events/testing';
import { generateDay, runDay } from '@pos/engine/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { swapBranchConfig } from '../../src/sync/branch-config-holder';
import { aDirectory } from '../helpers/fixtures';
import { createTestHub, openSession, pairDevice, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, fixtureMenu, openDay, openSeating } from './fixtures';

const SEED = 7;
const SUBMIT_P99_MS = 60; // §7, §10 #34
const PREVIEW_P99_MS = 40; // §7, §10 #34
const SEATING_ORDERS_P99_MS = 30; // §7
const CART_LINES = 12; // §7 "12 lines": ItemAdded per submit
const WARM_UP = 3; // untimed: the first calls after boot run cold (JIT, first lock take), a once-per-boot cost
const SAMPLES = 31;
const ROUNDS = 4; // seating-orders: a table with 4 rounds of the cart
const HOOK_MS = 3_600_000; // a watchdog for the day's simulation, not a bound

const SEAT = 'SEAT_PERF';
const SEAT_READ = 'SEAT_PERF_READ';
const TABLE_READ = 'T_PERF_READ';
const TAKER = 'S_PERF';

const pctl = (xs: readonly number[], q: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)]!;
};
const summary = (xs: readonly number[]): string =>
  `p50 ${pctl(xs, 0.5).toFixed(2)} / p99 ${pctl(xs, 0.99).toFixed(2)} / max ${Math.max(...xs).toFixed(2)} ms`;

/** fixtureMenu() with the sim day's slot stations (same ids) and the cart's items routed to them; no stock, no zones. */
function perfMenu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations[0]!;
  const station = (station_id: string, capacity: number): ConfigStation => ({ ...s1, station_id, name: station_id, station_type: 'slot', capacity, programs: [] });
  const plain = aBranchConfig().items.find((i) => i.item_id === 'I2')!;
  const item = (item_id: string, station_id: string, cook_time_ms: number, sort_order: number, o: Partial<ConfigItem> = {}): ConfigItem => ({
    ...plain,
    item_id,
    name: item_id,
    station_id,
    cook_time_ms,
    sort_order,
    ...o,
  });
  return {
    ...base,
    stations: [station('tandoor', 30), station('karahi', 50), station('bbq', 30), station('tawa', 8)],
    stock_items: [],
    floors: [
      {
        floor_id: FX.floor,
        name: 'Ground',
        sort_order: 0,
        zones: [],
        tables: [
          { table_id: FX.table, name: 'T2', seats: 4, sort_order: 0, zone_id: null },
          { table_id: TABLE_READ, name: 'T3', seats: 4, sort_order: 1, zone_id: null },
        ],
      },
    ],
    items: [
      item(FX.piece, 'karahi', 1_200_000, 1, { modifier_group_ids: [FX.optionGroup] }),
      item('I_MUTTON', 'karahi', 1_200_000, 2),
      item(FX.naan, 'tandoor', 180_000, 3, { price_minor: 3_000 }),
      item('I_ROTI', 'tandoor', 180_000, 4, { price_minor: 2_000 }),
      item('I_TIKKA', 'bbq', 900_000, 5),
      item('I_PARATHA', 'tawa', 300_000, 6, { price_minor: 5_000 }),
      item(FX.optionItem, 'tawa', 60_000, 7, { price_minor: 10_000 }),
      item(FX.ready, 'tawa', 60_000, 8, { price_minor: 8_000, is_ready_item: true }),
    ],
    deals: [],
  };
}

/** 11 cart lines + the karahi's linked raita = 12 lines; `id` is the key (preview) or the order_item_id (submit). */
function cart(id: 'key' | 'order_item_id', prefix: string): Array<Record<string, unknown>> {
  const line = (n: number, item_id: string, quantity = 1, o: Record<string, unknown> = {}) => ({ [id]: `${prefix}${String(n).padStart(2, '0')}`, item_id, quantity, ...o });
  return [
    line(1, FX.piece, 1, { options: [{ option_id: FX.option, quantity: 1, [id]: `${prefix}01o` }] }),
    line(2, 'I_MUTTON'),
    line(3, FX.naan, 4),
    line(4, 'I_ROTI', 2),
    line(5, FX.naan, 2),
    line(6, 'I_TIKKA'),
    line(7, 'I_TIKKA', 2),
    line(8, 'I_PARATHA', 2),
    line(9, 'I_PARATHA'),
    line(10, FX.ready, 4),
    line(11, 'I_ROTI'),
  ];
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const grant = { permission: 'take-order', grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope: 'branch' as const };
  return {
    ...base,
    roles: [...base.roles, { role_id: 'R_PERF', name: 'R_PERF', session_idle_ttl_ms: 3_600_000, permissions: [grant] }],
    staff: [
      ...base.staff,
      { staff_id: TAKER, display_name: 'Perf', pin_hash: base.staff[0]!.pin_hash, role_ids: ['R_PERF'], denied_permissions: [], lead_staff_id: null, floor_ids: [] },
    ],
  };
}

describe('[02b #34] SubmitOrder, eta-preview and seating-orders at 12 lines on the AD-27 normal peak, through the hub', () => {
  let hub: TestHub;
  let peak: { state: EngineState; at: number; lines: number; seq: number };
  let who: { deviceId: string; token: string; sessionToken: string };
  let commandSeq = 0;
  let orderSeq = 0;

  const headers = () => ({ authorization: `Bearer ${who.token}`, 'x-session-token': who.sessionToken });

  /** One SubmitOrder of the cart on `seating_id`; returns the wall time, the status and the ItemAdded count. */
  async function submit(table_id: string, seating_id: string): Promise<{ ms: number; status: number; lines: number }> {
    orderSeq += 1;
    const order_id = `PERF_O${String(orderSeq).padStart(4, '0')}`;
    const payload = { order_id, order_type: 'dine_in', table_id, seating_id, lines: cart('order_item_id', `${order_id}_L`) };
    const started = performance.now();
    const res = await hub.app.inject({
      method: 'POST',
      url: '/commands/submit-order',
      headers: headers(),
      payload: {
        command_id: `perf-cmd-${(commandSeq += 1)}`,
        tenant_id: 'tenant-a',
        branch_id: 'branch-1',
        command_type: 'SubmitOrder',
        payload,
        occurred_at: hub.clock.branchNow(),
        actor_id: TAKER,
        device_id: who.deviceId,
      },
    });
    const ms = performance.now() - started;
    const added = hub.deps.db.prepare("SELECT COUNT(*) FROM events WHERE event_type = 'ItemAdded' AND stream_id = ?").pluck().get(order_id) as number;
    return { ms, status: res.statusCode, lines: added };
  }

  async function timedGet(url: string): Promise<{ ms: number; status: number; body: unknown }> {
    const started = performance.now();
    const res = await hub.app.inject({ method: 'GET', url, headers: headers() });
    const ms = performance.now() - started;
    return { ms, status: res.statusCode, body: res.json() as unknown };
  }

  beforeAll(async () => {
    let best: { state: EngineState; seq: number; lines: number } | null = null;
    const run = runDay(generateDay(SEED), {
      watch: (state, seq) => {
        const lines = Object.keys(state.lines).length;
        if (best === null || lines > best.lines) best = { state, seq, lines };
      },
    });
    const b = best!;
    peak = { ...b, at: run.events[b.seq - 1]!.recorded_at };

    hub = await createTestHub();
    hub.clock.set(peak.at);
    await seedDirectory(hub, await directory());
    openDay(hub, { menu: perfMenu() }); // the config apply; the business day itself comes with the peak state
    openSeating(hub, { table_id: FX.table, seating_id: SEAT, holder_staff_id: TAKER });
    openSeating(hub, { table_id: TABLE_READ, seating_id: SEAT_READ, holder_staff_id: TAKER });
    const device = pairDevice(hub, { type: 'tablet' });
    const session = openSession(hub, { kind: 'staff', staffId: TAKER, deviceId: device.deviceId });
    who = { deviceId: device.deviceId, token: device.token, sessionToken: session.token };
  }, HOOK_MS);

  afterAll(async () => {
    swapBranchConfig(null);
    await hub?.close();
  });

  it(`[02b #34 submit] SubmitOrder of 12 lines on the peak engine, p99 < ${SUBMIT_P99_MS} ms`, async () => {
    const samples: number[] = [];
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      hub.deps.state.swap(peak.state);
      const r = await submit(FX.table, SEAT);
      expect(r.status).toBe(200);
      expect(r.lines).toBe(CART_LINES);
      if (i >= WARM_UP) samples.push(r.ms);
    }
    process.stderr.write(`[02b #34 submit] peak seq ${peak.seq}, ${peak.lines} lines in the engine; ${SAMPLES} submits of ${CART_LINES} lines: ${summary(samples)}\n`);
    expect(pctl(samples, 0.99)).toBeLessThan(SUBMIT_P99_MS);
  });

  it(`[02b #34 preview] eta-preview of the same 12-line cart on the peak engine, p99 < ${PREVIEW_P99_MS} ms`, async () => {
    hub.deps.state.swap(peak.state);
    const draft = { order_type: 'dine_in', table_id: FX.table, seating_id: SEAT, lines: cart('key', 'k') };
    const url = `/queries/eta-preview?draft=${encodeURIComponent(JSON.stringify(draft))}`;
    const samples: number[] = [];
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      const r = await timedGet(url);
      expect(r.status).toBe(200);
      expect((r.body as { data: { lines: unknown[] } }).data.lines).toHaveLength(CART_LINES);
      if (i >= WARM_UP) samples.push(r.ms);
    }
    process.stderr.write(`[02b #34 preview] ${SAMPLES} previews of ${CART_LINES} lines: ${summary(samples)}\n`);
    expect(pctl(samples, 0.99)).toBeLessThan(PREVIEW_P99_MS);
  });

  it(`[02b §7 seating-orders] seating-orders of a table with ${ROUNDS} rounds of 12 lines on the peak engine, p99 < ${SEATING_ORDERS_P99_MS} ms`, async () => {
    hub.deps.state.swap(peak.state);
    for (let i = 0; i < ROUNDS; i += 1) expect((await submit(TABLE_READ, SEAT_READ)).status).toBe(200);
    const samples: number[] = [];
    for (let i = 0; i < WARM_UP + SAMPLES; i += 1) {
      const r = await timedGet(`/queries/seating-orders?seating_id=${SEAT_READ}`);
      expect(r.status).toBe(200);
      const orders = (r.body as { data: { orders: Array<{ lines: unknown[] }> } }).data.orders;
      expect(orders).toHaveLength(ROUNDS);
      expect(orders.reduce((n, o) => n + o.lines.length, 0)).toBe(ROUNDS * CART_LINES);
      if (i >= WARM_UP) samples.push(r.ms);
    }
    process.stderr.write(`[02b §7 seating-orders] ${SAMPLES} reads of ${ROUNDS} × ${CART_LINES} lines: ${summary(samples)}\n`);
    expect(pctl(samples, 0.99)).toBeLessThan(SEATING_ORDERS_P99_MS);
  });
});
