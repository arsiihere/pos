import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BranchConfig, ConfigItem, DirectoryInput } from '@pos/events';
import { SnapshotBillingSchema } from '@pos/events';
import { hubBilling } from '../../../hub/src/billing/defaults';
import { hubTime } from '../../../hub/src/lib/hub-time';
import { cryptoSecrets } from '../../../hub/src/lib/secrets';
import { aDirectory } from '../../../hub/test/helpers/fixtures';
import { createTestHub, pairDevice, seedDirectory, type DeviceProfileInput } from '../../../hub/test/helpers/test-hub';
import { fixtureMenu, openDay } from '../../../hub/test/orders/fixtures';

// 02b-TK L-CLIENT-6b build shots (owner proof, not a gate test): a hub of its own with a demo menu shaped like the
// hand-off frames (Arif Chatkhara lunch: Paye, Chicken Karahi Half / Full / By kg with "With it" add-ons and cooking
// choices, Tandoor breads, drinks, a Family Deal) and the counter's people (Sana, Zain). The clock is moved to 12:50
// local so the shots read lunch time; the spec places its own orders through the kiosk. Run with
// `playwright test -c playwright.shots.config.ts` (TZ=Asia/Karachi), never in the gate.

export const DEMO = {
  karahi: { half: 'I_CK_H', full: 'I_CK_F', kg: 'I_CK_KG' },
  paye: 'I_PAYE',
  rnaan: 'I_RNAAN',
  naan: 'I_NAAN',
  roti: 'I_ROTI',
  raita: 'I_RAITA',
  salad: 'I_SALAD',
  lassiSweet: 'I_LASSI_S',
  lassiSalted: 'I_LASSI_K',
  deal: 'D_FAMILY',
} as const;

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

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const owner = base.staff.find((p) => p.staff_id === 'S_OWNER')!;
  const cash = base.staff.find((p) => p.staff_id === 'S_CASH')!;
  return {
    ...base,
    staff: [
      ...base.staff,
      { ...owner, staff_id: 'S_SANA', display_name: 'Sana' },
      { ...owner, staff_id: 'S_ZAIN', display_name: 'Zain' },
      { ...cash, staff_id: 'S_ALI', display_name: 'Ali', pin_hash: owner.pin_hash, role_ids: ['R_OWNER'] },
      { ...owner, staff_id: 'S_COOK', display_name: 'Cook' },
    ],
  };
}

function demoMenu(): BranchConfig {
  const base = fixtureMenu();
  const s1 = base.stations[0]!;
  const plain = base.items.find((i) => i.item_id === 'I_NAAN')!;
  const st = (station_id: string, name: string, capacity: number) => ({ ...s1, station_id, name, capacity });
  const item = (item_id: string, name: string, category_id: string, sort_order: number, price: number, cook_min: number, station_id: string, o: Partial<ConfigItem> = {}): ConfigItem => ({
    ...plain,
    modifier_group_ids: [],
    stock_draws: [],
    stock_time_ms: null,
    item_id,
    name,
    category_id,
    sort_order,
    price_minor: price * 100,
    cook_time_ms: cook_min * 60_000,
    station_id,
    variant_group_id: null,
    variant_name: null,
    ...o,
  });
  const opt = (option_id: string, name: string, price: number, linked: string | null, sort_order: number, max_quantity = 20) => ({
    option_id,
    name,
    price_minor: price * 100,
    max_quantity,
    is_default: false,
    linked_item_id: linked,
    sort_order,
  });
  const ready = { is_ready_item: true, station_id: 'S_CTR' } as Partial<ConfigItem>;
  const pk = hubBilling({ currency_code: base.currency_code, tax_classes: base.tax_classes, billing: base.billing });
  const billing = SnapshotBillingSchema.parse({
    ...pk.settings,
    jurisdiction: pk.jurisdiction,
    tax_profiles: pk.tax_profiles.map((p) => ({ tax_class_id: p.tax_profile_id, taxes: p.taxes })),
    payment_modes: [
      ...pk.settings.payment_modes.filter((m) => m.mode_id !== 'card'),
      { mode_id: 'card', name: 'Card', kind: 'card', payment_class: 'digital', reference_required: true, is_active: true, sort_order: 1, authority_codes: [] },
    ],
  });
  return {
    ...base,
    billing,
    floors: [],
    stations: [st('S1', 'Karahi', 3), st('S_TAN', 'Tandoor', 6), st('S_TAWA', 'Tawa', 3), st('S_BBQ', 'BBQ', 4), st('S_CTR', 'Counter', 20)],
    categories: [
      { category_id: 'C_PAYE', name: 'Paye', sort_order: 1, availability_windows: [] },
      { category_id: 'C_KAR', name: 'Karahi', sort_order: 2, availability_windows: [] },
      { category_id: 'C_TAWA', name: 'Tawa', sort_order: 3, availability_windows: [] },
      { category_id: 'C_BBQ', name: 'BBQ', sort_order: 4, availability_windows: [] },
      { category_id: 'C_TAN', name: 'Tandoor', sort_order: 5, availability_windows: [] },
      { category_id: 'C_DRINK', name: 'Drinks', sort_order: 6, availability_windows: [] },
      { category_id: 'C_SIDE', name: 'Sides', sort_order: 7, availability_windows: [] },
      { category_id: 'C_DEAL', name: 'Deals', sort_order: 8, availability_windows: [] },
    ],
    variant_groups: [
      { variant_group_id: 'V_CK', category_id: 'C_KAR', name: 'Chicken Karahi', description: null, sort_order: 1 },
      { variant_group_id: 'V_MK', category_id: 'C_KAR', name: 'Mutton Karahi', description: null, sort_order: 2 },
    ],
    stock_items: [
      { stock_item_id: 'K_TIKKA', name: 'Chicken Tikka', stock_unit: 'piece', carries_over: false, station_id: 'S_BBQ', low_stock_threshold: null },
      { stock_item_id: 'K_GRAVY', name: 'Extra gravy', stock_unit: 'piece', carries_over: false, station_id: 'S1', low_stock_threshold: null },
    ],
    modifier_groups: [
      {
        modifier_group_id: 'M_WITH',
        name: 'With it',
        min_choices: 0,
        max_choices: 50,
        sort_order: 0,
        has_plain_options: false,
        options: [
          opt('O_RNAAN', 'Roghni Naan', 70, DEMO.rnaan, 0),
          opt('O_NAAN', 'Naan', 40, DEMO.naan, 1),
          opt('O_RAITA', 'Raita', 120, DEMO.raita, 2),
          opt('O_SALAD', 'Salad', 100, DEMO.salad, 3),
          opt('O_ROTI', 'Roti', 25, DEMO.roti, 4),
          opt('O_GRAVY', 'Extra gravy', 150, 'I_GRAVY', 5, 2),
        ],
      },
      {
        modifier_group_id: 'M_COOK',
        name: 'Cooking',
        min_choices: 0,
        max_choices: 2,
        sort_order: 1,
        has_plain_options: true,
        options: [opt('O_LESSOIL', 'Less oil', 0, null, 0, 1), opt('O_SPICY', 'Extra spicy', 0, null, 1, 1), opt('O_MILD', 'Mild', 0, null, 2, 1), opt('O_NOTOM', 'No tomato', 0, null, 3, 1)],
      },
    ],
    items: [
      item(DEMO.paye, 'Paye', 'C_PAYE', 1, 650, 1, 'S_CTR', ready),
      item(DEMO.karahi.half, 'Chicken Karahi — Half', 'C_KAR', 1, 1450, 22, 'S1', { variant_group_id: 'V_CK', variant_name: 'Half', modifier_group_ids: ['M_WITH', 'M_COOK'] }),
      item(DEMO.karahi.full, 'Chicken Karahi — Full', 'C_KAR', 2, 2700, 24, 'S1', { variant_group_id: 'V_CK', variant_name: 'Full', modifier_group_ids: ['M_WITH', 'M_COOK'] }),
      item(DEMO.karahi.kg, 'Chicken Karahi — By kg', 'C_KAR', 3, 2600, 24, 'S1', { variant_group_id: 'V_CK', variant_name: 'By kg', sale_unit: 'g', requires_weighing: true, modifier_group_ids: ['M_WITH', 'M_COOK'] }),
      item('I_MK_H', 'Mutton Karahi — Half', 'C_KAR', 4, 2400, 26, 'S1', { variant_group_id: 'V_MK', variant_name: 'Half', modifier_group_ids: ['M_WITH', 'M_COOK'] }),
      item('I_MK_F', 'Mutton Karahi — Full', 'C_KAR', 5, 4600, 28, 'S1', { variant_group_id: 'V_MK', variant_name: 'Full', modifier_group_ids: ['M_WITH', 'M_COOK'] }),
      item('I_TAWA', 'Tawa Piece', 'C_TAWA', 1, 1100, 14, 'S_TAWA'),
      item('I_QEEMA', 'Beef Qeema', 'C_TAWA', 2, 900, 10, 'S_TAWA'),
      item('I_ANDA', 'Anda Tikki', 'C_TAWA', 3, 120, 4, 'S_TAWA'),
      item('I_TIKKA', 'Chicken Tikka', 'C_BBQ', 1, 650, 12, 'S_BBQ', { out_of_stock_behaviour: 'sold_out', stock_time_ms: 300_000, stock_draws: [{ stock_item_id: 'K_TIKKA', quantity_per_sale_unit: 1 }] }),
      item('I_SEEKH', 'Seekh Kabab', 'C_BBQ', 2, 800, 12, 'S_BBQ'),
      item(DEMO.rnaan, 'Roghni Naan', 'C_TAN', 1, 70, 6, 'S_TAN'),
      item(DEMO.naan, 'Naan', 'C_TAN', 2, 40, 5, 'S_TAN'),
      item(DEMO.roti, 'Roti', 'C_TAN', 3, 25, 4, 'S_TAN'),
      item('I_MAGHAZ', 'Maghaz', 'C_TAWA', 4, 900, 8, 'S_TAWA'),
      item(DEMO.raita, 'Raita', 'C_SIDE', 1, 120, 1, 'S_CTR', ready),
      item(DEMO.salad, 'Salad', 'C_SIDE', 2, 100, 1, 'S_CTR', ready),
      item('I_GRAVY', 'Extra gravy', 'C_SIDE', 3, 150, 2, 'S1', { out_of_stock_behaviour: 'sold_out', stock_time_ms: 60_000, stock_draws: [{ stock_item_id: 'K_GRAVY', quantity_per_sale_unit: 1 }] }),
      item(DEMO.lassiSweet, 'Lassi · sweet', 'C_DRINK', 1, 250, 2, 'S_CTR', ready),
      item(DEMO.lassiSalted, 'Lassi · salted', 'C_DRINK', 2, 250, 2, 'S_CTR', ready),
      item('I_COLD', 'Cold drink 1.5 L', 'C_DRINK', 3, 280, 1, 'S_CTR', ready),
      item('I_WATER', 'Water 1.5 L', 'C_DRINK', 4, 120, 1, 'S_CTR', ready),
    ],
    deals: [
      {
        deal_id: DEMO.deal,
        category_id: 'C_DEAL',
        name: 'Family Deal',
        description: null,
        sort_order: 1,
        price_minor: 340_000,
        tax_class_id: null,
        availability_windows: [],
        parts: [
          { deal_part_id: 'DP_KAR', quantity: 1, sort_order: 0, choices: [{ item_id: DEMO.karahi.full, extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: 'DP_RNAAN', quantity: 6, sort_order: 1, choices: [{ item_id: DEMO.rnaan, extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: 'DP_RAITA', quantity: 2, sort_order: 2, choices: [{ item_id: DEMO.raita, extra_price_minor: 0, sort_order: 0 }] },
          { deal_part_id: 'DP_SALAD', quantity: 1, sort_order: 3, choices: [{ item_id: DEMO.salad, extra_price_minor: 0, sort_order: 0 }] },
          {
            deal_part_id: 'DP_DRINKS',
            quantity: 4,
            sort_order: 4,
            choices: [
              { item_id: DEMO.lassiSweet, extra_price_minor: 0, sort_order: 0 },
              { item_id: DEMO.lassiSalted, extra_price_minor: 0, sort_order: 1 },
              { item_id: 'I_COLD', extra_price_minor: 0, sort_order: 2 },
              { item_id: 'I_WATER', extra_price_minor: 0, sort_order: 3 },
            ],
          },
        ],
      },
    ],
  } as BranchConfig;
}

const KIOSK: DeviceProfileInput['screens'] = ['takeaway', 'parking', 'dine_in', 'cashier', 'manager'];

export default async function demoSetup(): Promise<() => Promise<void>> {
  const port = await freePort();
  const hub = await createTestHub({ config: { advertised_host: '127.0.0.1', http_port: port } });
  Object.assign(hub.deps.secrets, cryptoSecrets);
  // lunch: the next 12:50 local (the runner's TZ, Asia/Karachi in the shots config)
  const { now_ms, utc_offset_ms } = hubTime(hub.clock);
  const day = 86_400_000;
  const localMidnight = Math.floor((now_ms + utc_offset_ms) / day) * day - utc_offset_ms;
  let target = localMidnight + (12 * 60 + 50) * 60_000;
  if (target <= now_ms) target += day;
  hub.clock.advance(target - now_ms);
  await seedDirectory(hub, await directory());
  openDay(hub, { menu: demoMenu(), stock: { K_TIKKA: 0, K_GRAVY: 0 } });
  const everyone = { access: 'everyone' as const, screens: KIOSK };
  const kiosk = pairDevice(hub, { type: 'cashier_kiosk', name: 'Counter 1', profile: everyone });
  const tablet = pairDevice(hub, { type: 'tablet', name: 'Counter tablet', profile: everyone });
  const phone = pairDevice(hub, { type: 'phone', ownerStaffId: 'S_SANA', name: 'Sana phone', profile: { access: 'listed', staff_ids: ['S_SANA'], screens: ['takeaway', 'dine_in', 'parking', 'manager'] } });
  const kitchen = pairDevice(hub, { type: 'tablet', name: 'Kitchen', profile: everyone });
  await hub.app.listen({ host: '127.0.0.1', port });
  const clockFlag = join(tmpdir(), `pos-shots-hub-${process.pid}.clock`);
  const dev = (d: { token: string; deviceId: string }, device_type: 'tablet' | 'cashier_kiosk' | 'phone' = 'tablet') => ({ token: d.token, device_id: d.deviceId, device_type });
  const info = {
    baseURL: `http://127.0.0.1:${port}`,
    device: dev(tablet),
    device2: dev(tablet),
    device3: dev(tablet),
    kiosk: dev(kiosk, 'cashier_kiosk'),
    phone: dev(phone, 'phone'),
    kitchen: dev(kitchen),
    tenant_id: 'tenant-a',
    branch_id: 'branch-1',
    printer_address: '',
    devices03: {},
    devicesT1: {},
  };
  const file = join(tmpdir(), `pos-shots-hub-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(info));
  process.env['POS_E2E_HUB'] = file;
  // a spec moves the hub clock by writing ms into this file (read once a second)
  const tick = setInterval(() => {
    try {
      const ms = Number(readFileSync(clockFlag, 'utf8'));
      rmSync(clockFlag, { force: true });
      if (ms > 0) hub.clock.advance(ms);
    } catch {
      // no request
    }
  }, 300);
  process.env['POS_SHOTS_CLOCK'] = clockFlag;
  return async () => {
    clearInterval(tick);
    await hub.close();
  };
}
