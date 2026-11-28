import { createServer } from 'node:net';
import type { BranchConfig, ConfigItem, DirectoryInput } from '@pos/events';
import { aDirectory } from '../../../hub/test/helpers/fixtures';
import { createTestHub, pairDevice, seedDirectory, type TestHub } from '../../../hub/test/helpers/test-hub';
import { fixtureMenu, openDay } from '../../../hub/test/orders/fixtures';
import { toStage } from '../../../hub/test/voids/fixtures';
import { cryptoSecrets } from '../../../hub/src/lib/secrets';

// 02b-TK L-CLIENT-6a proof only (never the gate, never `pnpm test:e2e`): a test hub with a demo menu shaped like the
// hand-off frames (docs/design/handoff/02b-tk/design/screens), so the fidelity captures compare like with like. Every
// order is a real SubmitOrder over HTTP, every stage a real kitchen event, every payment a real AddPayment / CloseSplit.

export interface DemoDevice {
  token: string;
  device_id: string;
  device_type: 'tablet' | 'cashier_kiosk' | 'phone';
}
export interface DemoHub {
  baseURL: string;
  kiosk: DemoDevice;
  tablet: DemoDevice;
  phone: DemoDevice;
  tenant_id: string;
  branch_id: string;
  tokens: Record<string, number>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const a = probe.address();
      const port = typeof a === 'object' && a !== null ? a.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const MIN = 60_000;

/** The frames' menu: categories Paye · Karahi · Tawa · BBQ · Tandoor · Drinks · Sides · Deals, one station each. */
export function demoMenu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations[0]!;
  const station = (station_id: string, name: string, capacity: number) => ({ ...s1, station_id, name, capacity });
  const plain = base.items.find((i) => i.item_id === 'I_NAAN')!;
  let sort = 0;
  const item = (item_id: string, name: string, category_id: string, station_id: string, price: number, cook_min: number, o: Partial<ConfigItem> = {}): ConfigItem => ({
    ...plain,
    item_id,
    name,
    category_id,
    station_id,
    price_minor: price * 100,
    cook_time_ms: cook_min * MIN,
    modifier_group_ids: [],
    stock_draws: [],
    stock_time_ms: null,
    is_ready_item: false,
    requires_weighing: false,
    sale_unit: 'piece',
    variant_group_id: null,
    variant_name: null,
    sort_order: (sort += 1),
    ...o,
  });
  const ready = { is_ready_item: true } as const;
  const cat = (category_id: string, name: string, sort_order: number) => ({ category_id, name, sort_order, availability_windows: [] });
  return {
    ...base,
    stations: [station('ST_KARAHI', 'Karahi', 2), station('ST_TANDOOR', 'Tandoor', 6), station('ST_TAWA', 'Tawa', 3), station('ST_BBQ', 'BBQ', 3), station('ST_DRINKS', 'Drinks', 4)],
    categories: [cat('C_PAYE', 'Paye', 1), cat('C_KARAHI', 'Karahi', 2), cat('C_TAWA', 'Tawa', 3), cat('C_BBQ', 'BBQ', 4), cat('C_TANDOOR', 'Tandoor', 5), cat('C_DRINKS', 'Drinks', 6), cat('C_SIDES', 'Sides', 7), cat('C_DEALS', 'Deals', 8)],
    variant_groups: [
      { variant_group_id: 'V_CK', category_id: 'C_KARAHI', name: 'Chicken Karahi', description: null, sort_order: 1 },
      { variant_group_id: 'V_MK', category_id: 'C_KARAHI', name: 'Mutton Karahi', description: null, sort_order: 2 },
    ],
    stock_items: [{ stock_item_id: 'K_TIKKA', name: 'Chicken Tikka', stock_unit: 'piece', carries_over: false, station_id: 'ST_BBQ', low_stock_threshold: null }],
    modifier_groups: [],
    floors: base.floors,
    items: [
      item('I_PAYE', 'Paye', 'C_PAYE', 'ST_KARAHI', 650, 1, ready),
      item('I_CK_H', 'Chicken Karahi — Half', 'C_KARAHI', 'ST_KARAHI', 1450, 22, { variant_group_id: 'V_CK', variant_name: 'Half' }),
      item('I_CK_F', 'Chicken Karahi — Full', 'C_KARAHI', 'ST_KARAHI', 2700, 22, { variant_group_id: 'V_CK', variant_name: 'Full' }),
      item('I_RNAAN', 'Roghni Naan', 'C_TANDOOR', 'ST_TANDOOR', 70, 6),
      item('I_LASSI_S', 'Lassi · sweet', 'C_DRINKS', 'ST_DRINKS', 250, 2),
      item('I_TAWA', 'Tawa Piece', 'C_TAWA', 'ST_TAWA', 1100, 14),
      item('I_NAAN', 'Naan', 'C_TANDOOR', 'ST_TANDOOR', 40, 5),
      item('I_RAITA', 'Raita', 'C_SIDES', 'ST_DRINKS', 120, 1, ready),
      item('I_MK_H', 'Mutton Karahi — Half', 'C_KARAHI', 'ST_KARAHI', 2400, 28, { variant_group_id: 'V_MK', variant_name: 'Half' }),
      item('I_MK_F', 'Mutton Karahi — Full', 'C_KARAHI', 'ST_KARAHI', 4600, 28, { variant_group_id: 'V_MK', variant_name: 'Full' }),
      item('I_QEEMA', 'Beef Qeema', 'C_TAWA', 'ST_TAWA', 900, 10),
      item('I_TIKKI', 'Anda Tikki', 'C_TAWA', 'ST_TAWA', 120, 4),
      item('I_TIKKA', 'Chicken Tikka', 'C_BBQ', 'ST_BBQ', 650, 12, { out_of_stock_behaviour: 'sold_out', stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K_TIKKA', quantity_per_sale_unit: 1 }] }),
      item('I_SEEKH', 'Seekh Kabab ×4', 'C_BBQ', 'ST_BBQ', 800, 15),
      item('I_ROTI', 'Roti', 'C_TANDOOR', 'ST_TANDOOR', 25, 4),
      item('I_MAGHAZ', 'Maghaz', 'C_TAWA', 'ST_TAWA', 900, 1, ready),
      item('I_LASSI_N', 'Lassi · salted', 'C_DRINKS', 'ST_DRINKS', 250, 2),
      item('I_COLD', 'Cold drink 1.5 L', 'C_DRINKS', 'ST_DRINKS', 280, 1, ready),
    ],
    deals: [
      {
        deal_id: 'D_FAMILY',
        category_id: 'C_DEALS',
        name: 'Family deal',
        description: null,
        sort_order: 1,
        price_minor: 450_000,
        tax_class_id: null,
        availability_windows: [],
        parts: [
          { deal_part_id: 'DP_K', quantity: 1, sort_order: 0, choices: [{ item_id: 'I_CK_F', extra_price_minor: 0, sort_order: 0 }, { item_id: 'I_MK_H', extra_price_minor: 0, sort_order: 1 }] },
          { deal_part_id: 'DP_N', quantity: 6, sort_order: 1, choices: [{ item_id: 'I_RNAAN', extra_price_minor: 0, sort_order: 0 }] },
        ],
      },
    ],
  };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const owner = base.staff.find((p) => p.staff_id === 'S_OWNER')!;
  return { ...base, staff: [...base.staff, { ...owner, staff_id: 'S_SANA', display_name: 'Sana' }] };
}

interface Session {
  command(type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>>;
  query<T>(path: string): Promise<T>;
}

async function session(baseURL: string, d: DemoDevice, staff_id: string, ids: { tenant_id: string; branch_id: string }, nowMs: () => number): Promise<Session> {
  const device = { Authorization: `Bearer ${d.token}`, 'content-type': 'application/json' };
  const signIn = await fetch(`${baseURL}/auth/pin`, { method: 'POST', headers: device, body: JSON.stringify({ staff_id, pin: '1234', takeover: true }) });
  if (signIn.status !== 200) throw new Error(`auth/pin ${await signIn.text()}`);
  const token = ((await signIn.json()) as { data: { session_token: string } }).data.session_token;
  let seq = 0;
  return {
    async command(type, payload) {
      seq += 1;
      const kebab = type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const res = await fetch(`${baseURL}/commands/${kebab}`, {
        method: 'POST',
        headers: { ...device, 'X-Session-Token': token },
        body: JSON.stringify({ command_id: `fid-${process.pid}-${staff_id}-${seq}`, ...ids, command_type: type, payload, occurred_at: nowMs(), actor_id: staff_id, device_id: d.device_id }),
      });
      const body = (await res.json()) as { data?: { result: Record<string, unknown> }; error?: unknown };
      if (res.status !== 200) throw new Error(`${type} ${res.status} ${JSON.stringify(body.error)}`);
      return body.data!.result;
    },
    async query<T>(path: string) {
      const res = await fetch(`${baseURL}/queries/${path}`, { headers: { ...device, 'X-Session-Token': token } });
      if (res.status !== 200) throw new Error(`${path} ${res.status} ${await res.text()}`);
      return ((await res.json()) as { data: T }).data;
    },
  };
}

export interface DemoOrder {
  key: string;
  name?: string;
  phone?: string;
  lines: Array<[string, number]>;
  stage?: 'added' | 'done' | 'part';
  paid?: boolean;
  pickupMin?: number;
  /** minutes the hub clock moves on after this order (so "ready 17 min ago" ages) */
  after?: number;
}

/** A hub with the demo menu at 1:20 PM local, the day open, Sana's shift open, and `orders` placed in turn. */
export async function startDemoHub(orders: DemoOrder[]): Promise<{ info: DemoHub; hub: TestHub }> {
  const port = await freePort();
  const hub = await createTestHub({ config: { advertised_host: '127.0.0.1', http_port: port } });
  Object.assign(hub.deps.secrets, cryptoSecrets);
  // 1:00 PM local the next day (the hub's local is the OS zone)
  const now = new Date(hub.clock.branchNow());
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(12, 45, 0, 0);
  hub.clock.advance(target.getTime() - now.getTime());
  await seedDirectory(hub, await directory());
  openDay(hub, { menu: demoMenu(), stock: { K_TIKKA: 0 } });
  const screens = ['takeaway', 'parking', 'dine_in', 'cashier', 'manager'] as const;
  const listed = { access: 'listed' as const, staff_ids: ['S_SANA', 'S_OWNER', 'S_MGR'], screens: [...screens] };
  const kiosk = pairDevice(hub, { type: 'cashier_kiosk', name: 'Counter 1', profile: listed });
  const tablet = pairDevice(hub, { type: 'tablet', name: 'Counter tablet', profile: listed });
  const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_SANA', name: 'Sana phone', profile: { access: 'listed', staff_ids: ['S_SANA'], screens: ['takeaway', 'dine_in', 'manager'] } });
  const seeder = pairDevice(hub, { type: 'tablet', name: 'Seeder', profile: { access: 'everyone', screens: [...screens] } });
  const seeder2 = pairDevice(hub, { type: 'tablet', name: 'Seeder 2', profile: { access: 'everyone', screens: [...screens] } });
  await hub.app.listen({ host: '127.0.0.1', port });
  const baseURL = `http://127.0.0.1:${port}`;
  const ids = { tenant_id: 'tenant-a', branch_id: hub.deps.config.provisioned!.branch_id };
  const dev = (d: { token: string; deviceId: string }, device_type: DemoDevice['device_type']): DemoDevice => ({ token: d.token, device_id: d.deviceId, device_type });
  const s = await session(baseURL, dev(seeder, 'tablet'), 'S_OWNER', ids, () => hub.clock.branchNow());
  await s.command('OpenShift', { float_minor: 0, as_drawer: false }).catch(() => undefined);
  // Sana's own shift, so the counter shows no "No shift open" banner (05 §6.16), as in the frames
  const sana = await session(baseURL, dev(seeder2, 'tablet'), 'S_SANA', ids, () => hub.clock.branchNow());
  await sana.command('OpenShift', { float_minor: 0, as_drawer: false }).catch((e: unknown) => console.warn('OpenShift Sana', e));
  const tokens: Record<string, number> = {};
  for (const o of orders) {
    const order_id = hub.deps.ids.next();
    const lines = o.lines.map(([item_id, quantity], i) => ({ order_item_id: hub.deps.ids.next() + i, item_id, quantity }));
    const takeaway: Record<string, string> = {};
    if (o.name !== undefined) takeaway['customer_name'] = o.name;
    if (o.phone !== undefined) takeaway['phone'] = o.phone;
    const res = await s.command('SubmitOrder', {
      order_id,
      order_type: 'takeaway',
      takeaway,
      lines,
      ...(o.pickupMin === undefined ? {} : { pickup_at_ms: hub.clock.branchNow() + o.pickupMin * MIN }),
    });
    tokens[o.key] = res['token'] as number;
    // a slot-station piece line is split per unit at Send (02b v1.0.20 §3.2): the engine's own line ids
    const engineLines = (hub.deps.state.get() as { lines: Record<string, { order_id: string }> }).lines;
    const all = Object.keys(engineLines).filter((id) => engineLines[id]!.order_id === order_id);
    if (o.stage === 'done') toStage(hub, order_id, all, 'done');
    if (o.stage === 'part') {
      toStage(hub, order_id, all.slice(0, 1), 'served');
    }
    if (o.paid === true) {
      const bill = await s.query<{ splits: Array<{ split_no: number; balance_minor: number; dues?: { cash_due_minor: number }; totals: { cash: { total_minor: number } } }> }>(`bill?order_id=${encodeURIComponent(order_id)}`);
      const one = bill.splits[0]!;
      // 05 v1.0.37 §6.9 (R2-1): the due the bill showed
      await s.command('AddPayment', { bill_ref: { order_id }, split_no: 1, mode_id: 'cash', direction: 'in', amount_minor: one.balance_minor, expected_due_minor: one.dues?.cash_due_minor ?? one.balance_minor, tendered_minor: one.balance_minor });
      await s.command('CloseSplit', { bill_ref: { order_id }, split_no: 1, expected_total_minor: one.totals.cash.total_minor });
    }
    hub.clock.advance((o.after ?? 1) * MIN);
  }
  return { info: { baseURL, kiosk: dev(kiosk, 'cashier_kiosk'), tablet: dev(tablet, 'tablet'), phone: dev(phone, 'phone'), ...ids, tokens }, hub };

}
