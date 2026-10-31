/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import type { DefaultKey } from '@pos/domain';
import { createPool } from '../db/migrate.js';
import { systemClock } from '../lib/clock.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen } from '../lib/ids.js';
import { cryptoSecrets } from '../lib/secrets.js';
import { dealBranchVersion, stockItemBranchVersion } from '../modules/menu-variants/versions.js';
import { issueRegistrationCode } from './issue-registration-code.js';
import { seedTenant } from './seed-tenant.js';
import { SystemContext } from './system-context.js';

// Dev only (docs/manual-test-e2e.md): a demo tenant for hand testing. The tenant, its default roles and the
// three branches are written as seed-tenant and issue-registration-code write them; everything else goes
// through the owner API of a running cloud, so every rule and version bump of 01a, 01b and 01c applies (the
// routes call the service functions; no menu SQL here). A second run finds the owner and writes nothing.

const OWNER_EMAIL = 'owner@arifchatkhara.pk';
const OWNER_PASSWORD = 'chatkhara-demo-1';
const OWNER_PIN = '1234';
const MIN = 60_000;

interface Ctx {
  base: string;
  token: string;
  ids: () => string;
}

async function call<T>(c: Ctx, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${c.token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method === 'POST') headers['idempotency-key'] = c.ids();
  const res = await fetch(`${c.base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const json = (await res.json()) as { data?: T; error?: unknown };
  if (!res.ok || json.data === undefined) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error)}`);
  return json.data;
}

interface BranchPlan {
  name: string;
  floors: { name: string; tables: [string, number][] }[];
  stations: { key: string; name: string; type: 'slot' | 'batch'; capacity: number; freshness_min?: number; programs?: [string, number][] }[];
}

const BRANCHES: BranchPlan[] = [
  {
    name: 'Gulberg',
    floors: [
      { name: 'Ground', tables: [['G1', 4], ['G2', 4], ['G3', 6], ['G4', 2], ['G5', 8]] },
      { name: 'Family Hall', tables: [['F1', 6], ['F2', 6], ['F3', 10]] },
      { name: 'Rooftop', tables: [['R1', 4], ['R2', 4]] },
    ],
    stations: [
      { key: 'bbq', name: 'BBQ Grill', type: 'slot', capacity: 6 },
      { key: 'karahi', name: 'Karahi', type: 'slot', capacity: 4 },
      { key: 'tandoor', name: 'Tandoor', type: 'batch', capacity: 12, freshness_min: 10, programs: [['Naan', 3], ['Roghni naan', 4]] },
      { key: 'fryer', name: 'Fryer', type: 'batch', capacity: 8, freshness_min: 5, programs: [['Fries 180', 6]] },
      { key: 'drinks', name: 'Drinks', type: 'slot', capacity: 4 },
    ],
  },
  {
    name: 'Johar Town',
    floors: [
      { name: 'Ground', tables: [['T1', 4], ['T2', 4], ['T3', 6], ['T4', 6]] },
      { name: 'Upstairs', tables: [['U1', 8], ['U2', 4]] },
    ],
    stations: [
      { key: 'bbq', name: 'BBQ Grill', type: 'slot', capacity: 4 },
      { key: 'karahi', name: 'Karahi', type: 'slot', capacity: 3 },
      { key: 'tandoor', name: 'Tandoor', type: 'batch', capacity: 10, freshness_min: 10, programs: [['Naan', 3], ['Roghni naan', 4]] },
      { key: 'drinks', name: 'Drinks', type: 'slot', capacity: 3 },
    ],
  },
  {
    name: 'DHA',
    floors: [{ name: 'Main Hall', tables: [['D1', 4], ['D2', 4], ['D3', 6], ['D4', 6], ['D5', 2]] }],
    stations: [
      { key: 'bbq', name: 'BBQ Grill', type: 'slot', capacity: 4 },
      { key: 'karahi', name: 'Karahi', type: 'slot', capacity: 4 },
      { key: 'tandoor', name: 'Tandoor', type: 'batch', capacity: 10, freshness_min: 10, programs: [['Naan', 3], ['Roghni naan', 4]] },
      { key: 'fryer', name: 'Fryer', type: 'batch', capacity: 6, freshness_min: 5, programs: [['Fries 180', 6]] },
    ],
  },
];

// 01c §7, V3, V4 (m-7): stock lives on stock items, counted per branch at a station (§6.9); items draw from them.
// A stock item is counted at every branch that has its station.
interface StockPlan {
  name: string;
  unit: 'piece' | 'g' | 'ml';
  station: string; // station key
  low: number | null;
  carries?: boolean;
}

const STOCK_ITEMS: StockPlan[] = [
  { name: 'Karahi pot', unit: 'g', station: 'karahi', low: 1000 },
  { name: 'Chicken tikka', unit: 'piece', station: 'bbq', low: 10 },
  { name: 'Seekh kebab (4 pcs)', unit: 'piece', station: 'bbq', low: 8 },
  { name: 'Chicken biryani', unit: 'g', station: 'karahi', low: 2000 },
  { name: 'Fries', unit: 'piece', station: 'fryer', low: 5 },
  { name: 'Raita', unit: 'piece', station: 'drinks', low: 10, carries: true },
  { name: 'Soft drink 1.5 L', unit: 'piece', station: 'drinks', low: 6, carries: true },
];

interface ItemPlan {
  name: string;
  category: string;
  price: number; // rupees
  station: string; // station key; a branch without it gets no route
  program?: string;
  cook_min: number;
  stock_min?: number; // stock time (slot) or the stock program (batch) when set
  draw?: { stock: string; per_sale: number }; // 01c V4: the item's one draw
  variant?: { group: string; name: string }; // 01c V2
  serve?: 'immediate' | 'sync';
}

const CATEGORIES: { name: string; windows?: [number, number][] }[] = [
  { name: 'BBQ' },
  { name: 'Karahi' },
  { name: 'Rice' },
  { name: 'Breads' },
  { name: 'Sides' },
  { name: 'Drinks' },
  { name: 'Breakfast', windows: [[7 * 60, 11 * 60]] },
];

// 01c §6.1, V2: the variant groups (the ordering tile; members are the items with `variant`).
const VARIANT_GROUPS: { name: string; category: string; sort_order: number }[] = [{ name: 'Chicken Karahi', category: 'Karahi', sort_order: 3 }];

const ITEMS: ItemPlan[] = [
  { name: 'Chicken tikka', category: 'BBQ', price: 650, station: 'bbq', cook_min: 14, stock_min: 3, draw: { stock: 'Chicken tikka', per_sale: 1 }, serve: 'sync' },
  { name: 'Seekh kebab (4 pcs)', category: 'BBQ', price: 720, station: 'bbq', cook_min: 10, stock_min: 2, draw: { stock: 'Seekh kebab (4 pcs)', per_sale: 1 }, serve: 'sync' },
  { name: 'Malai boti', category: 'BBQ', price: 890, station: 'bbq', cook_min: 12, serve: 'sync' },
  // 01c §1, V4: Half and Full share one Karahi pot, 500 g / 1 000 g a sale (6 000 g → Half 12, Full 6).
  { name: 'Chicken Karahi — Half', category: 'Karahi', price: 1150, station: 'karahi', cook_min: 20, stock_min: 5, draw: { stock: 'Karahi pot', per_sale: 500 }, variant: { group: 'Chicken Karahi', name: 'Half' }, serve: 'sync' },
  { name: 'Chicken Karahi — Full', category: 'Karahi', price: 2200, station: 'karahi', cook_min: 25, stock_min: 5, draw: { stock: 'Karahi pot', per_sale: 1000 }, variant: { group: 'Chicken Karahi', name: 'Full' }, serve: 'sync' },
  { name: 'Mutton karahi (half)', category: 'Karahi', price: 2600, station: 'karahi', cook_min: 30, serve: 'sync' },
  { name: 'Chicken biryani', category: 'Rice', price: 450, station: 'karahi', cook_min: 25, stock_min: 1, draw: { stock: 'Chicken biryani', per_sale: 350 } },
  { name: 'Naan', category: 'Breads', price: 40, station: 'tandoor', program: 'Naan', cook_min: 3, serve: 'sync' },
  { name: 'Roghni naan', category: 'Breads', price: 80, station: 'tandoor', program: 'Roghni naan', cook_min: 4, serve: 'sync' },
  { name: 'Fries', category: 'Sides', price: 350, station: 'fryer', program: 'Fries 180', cook_min: 6, stock_min: 0, draw: { stock: 'Fries', per_sale: 1 } },
  { name: 'Raita', category: 'Sides', price: 120, station: 'drinks', cook_min: 1, stock_min: 0, draw: { stock: 'Raita', per_sale: 1 } },
  { name: 'Mint margarita', category: 'Drinks', price: 380, station: 'drinks', cook_min: 3 },
  { name: 'Soft drink 1.5 L', category: 'Drinks', price: 300, station: 'drinks', cook_min: 1, stock_min: 0, draw: { stock: 'Soft drink 1.5 L', per_sale: 1 } },
  { name: 'Halwa puri', category: 'Breakfast', price: 550, station: 'karahi', cook_min: 8 },
];

// DHA charges a little more (S57 branch price), for items and the deal.
const branchPrice = (branch: string, rupees: number): number | null => (branch === 'DHA' ? Math.round(rupees * 1.1) * 100 : null);

// 01b §3.8, §6.15, R5: default roles are looked up by default_key, never by name (as seed-tenant does).
interface StaffPlan {
  name: string;
  role: DefaultKey;
  branches: string[];
  pin: string | null;
  lead?: string;
}

const STAFF: StaffPlan[] = [
  { name: 'Hamza', role: 'manager', branches: ['Gulberg'], pin: '2222' },
  { name: 'Usman', role: 'cashier', branches: ['Gulberg'], pin: '3333' },
  { name: 'Ali', role: 'order_taker', branches: ['Gulberg'], pin: '4444' },
  { name: 'Zain', role: 'waiter', branches: ['Gulberg'], pin: '5555', lead: 'Ali' },
  { name: 'Faisal', role: 'cook', branches: ['Gulberg'], pin: '6666' },
  { name: 'Kashif', role: 'manager', branches: ['Johar Town'], pin: '7777' },
  { name: 'Nadeem', role: 'waiter', branches: ['Johar Town'], pin: null },
  { name: 'Imran', role: 'manager', branches: ['DHA'], pin: '8888' },
];

// The seed's last write: the PIN of the last staff member that has one. seed-tenant commits the owner first, so
// the owner alone does not mean the seed finished.
const LAST_PIN_STAFF = STAFF.filter((s) => s.pin !== null).at(-1)!.name;

// Resolves to the process exit code: 0 seeded or already seeded, 1 partially seeded.
export async function seedDemo(base: string, tenantName: string, deps: { pool: pg.Pool; out: (text: string) => void }): Promise<0 | 1> {
  const clock = systemClock();
  const ids = ulidGen(clock);
  const sys = new SystemContext(deps.pool);
  // Idempotent: the demo owner exists and the seed finished → nothing is written (registration codes are only shown once).
  // AD-36 b: if the seed's last write is missing, an earlier run died part-way; never resume it.
  const seeded = await sys.query<{ tenant_id: string; complete: boolean }>(
    `SELECT o.tenant_id,
            EXISTS (SELECT 1 FROM staff s WHERE s.tenant_id = o.tenant_id AND s.display_name = $2 AND s.pin_hash IS NOT NULL) AS complete
       FROM owner_users o WHERE lower(o.email) = lower($1)`,
    [OWNER_EMAIL, LAST_PIN_STAFF],
  );
  if (seeded[0] !== undefined) {
    if (!seeded[0].complete) {
      deps.out(`partially seeded: tenant_id ${seeded[0].tenant_id} (${OWNER_EMAIL}); nothing written. Wipe the database and seed again.\n`);
      return 1;
    }
    deps.out(`already seeded: tenant_id ${seeded[0].tenant_id} (${OWNER_EMAIL}); nothing written. Wipe the database to seed again.\n`);
    return 0;
  }
  const owner = await seedTenant(
    sys,
    { name: tenantName, currency: 'PKR', ownerEmail: OWNER_EMAIL, ownerName: 'Arif', password: OWNER_PASSWORD, pin: OWNER_PIN },
    { clock, ids },
  );
  const codes: { name: string; code: string; branch_id: string }[] = [];
  for (const branch of BRANCHES) {
    const issued = await issueRegistrationCode(sys, { tenantId: owner.tenant_id, branchName: branch.name }, { clock, ids, secrets: cryptoSecrets });
    codes.push({ name: branch.name, code: issued.code, branch_id: issued.branch_id });
  }
  const keyed = await sys.query<{ default_key: string; role_id: string }>(
    `SELECT default_key, role_id FROM roles WHERE tenant_id = $1 AND default_key IS NOT NULL`,
    [owner.tenant_id],
  );
  const roleId = new Map(keyed.map((r) => [r.default_key, r.role_id]));

  const login = await fetch(`${base}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  const loginJson = (await login.json()) as { data?: { access_token: string } };
  if (loginJson.data === undefined) throw new Error(`login failed (${login.status}): is the cloud running at ${base}?`);
  const c: Ctx = { base, token: loginJson.data.access_token, ids: () => ids.next() };

  const branchId = new Map(codes.map((b) => [b.name, b.branch_id]));
  const stationIds = new Map<string, { station_id: string; programs: Map<string, string> }>(); // `${branch}/${key}`
  const floorIds = new Map<string, string>(); // `${branch}/${floor}`

  for (const plan of BRANCHES) {
    const b = branchId.get(plan.name)!;
    for (const [i, floor] of plan.floors.entries()) {
      const { floor: f } = await call<{ floor: { floor_id: string } }>(c, 'POST', `/v1/admin/branches/${b}/floors`, { name: floor.name, sort_order: i });
      floorIds.set(`${plan.name}/${floor.name}`, f.floor_id);
      for (const [j, [name, seats]] of floor.tables.entries()) {
        await call(c, 'POST', `/v1/admin/branches/${b}/tables`, { floor_id: f.floor_id, name, seats, sort_order: j });
      }
    }
    for (const s of plan.stations) {
      const { station } = await call<{ station: { station_id: string } }>(c, 'POST', `/v1/admin/branches/${b}/stations`, {
        name: s.name,
        station_type: s.type,
        capacity: s.capacity,
        ...(s.freshness_min !== undefined ? { freshness_window_ms: s.freshness_min * MIN } : {}),
      });
      const programs = new Map<string, string>();
      for (const [name, minutes] of s.programs ?? []) {
        const { program } = await call<{ program: { program_id: string } }>(
          c,
          'POST',
          `/v1/admin/branches/${b}/stations/${station.station_id}/programs`,
          { name, cook_time_ms: minutes * MIN },
        );
        programs.set(name, program.program_id);
      }
      stationIds.set(`${plan.name}/${s.key}`, { station_id: station.station_id, programs });
    }
  }

  await call(c, 'POST', '/v1/admin/tax-classes', { name: 'Sales tax 16%', rate_bp: 1600 });
  const categoryIds = new Map<string, string>();
  for (const [i, cat] of CATEGORIES.entries()) {
    const { category } = await call<{ category: { category_id: string } }>(c, 'POST', '/v1/admin/categories', {
      name: cat.name,
      sort_order: i,
      availability_windows: (cat.windows ?? []).map(([s, e]) => ({ start_ms: s * MIN, end_ms: e * MIN })),
    });
    categoryIds.set(cat.name, category.category_id);
  }

  // 01c §6.1
  const variantGroupIds = new Map<string, string>();
  for (const g of VARIANT_GROUPS) {
    const { variant_group } = await call<{ variant_group: { variant_group_id: string } }>(c, 'POST', '/v1/admin/variant-groups', {
      name: g.name,
      category_id: categoryIds.get(g.category)!,
      sort_order: g.sort_order,
    });
    variantGroupIds.set(g.name, variant_group.variant_group_id);
  }

  // 01c §6.7, then §6.9 per branch that has the station (the "no row" version from the one version builder, B23).
  const stockItemIds = new Map<string, string>();
  for (const si of STOCK_ITEMS) {
    const { stock_item } = await call<{ stock_item: { stock_item_id: string } }>(c, 'POST', '/v1/admin/stock-items', {
      name: si.name,
      stock_unit: si.unit,
      carries_over: si.carries ?? false,
    });
    stockItemIds.set(si.name, stock_item.stock_item_id);
    for (const plan of BRANCHES) {
      const st = stationIds.get(`${plan.name}/${si.station}`);
      if (st === undefined) continue;
      const b = branchId.get(plan.name)!;
      await call(c, 'PUT', `/v1/admin/stock-items/${stock_item.stock_item_id}/branches/${b}`, {
        expected_version: stockItemBranchVersion(stock_item.stock_item_id, b, null).version,
        station_id: st.station_id,
        low_stock_threshold: si.low,
      });
    }
  }

  // 01c §6.4: variant members carry variant_group_id / variant_name; draws replace 01a's item stock fields (m-7).
  const itemIds = new Map<string, string>();
  for (const [i, item] of ITEMS.entries()) {
    const tracked = item.stock_min !== undefined;
    const routes = BRANCHES.flatMap((plan) => {
      const st = stationIds.get(`${plan.name}/${item.station}`);
      if (st === undefined) return [];
      const program = item.program === undefined ? null : (st.programs.get(item.program) ?? null);
      return [{ branch_id: branchId.get(plan.name)!, station_id: st.station_id, program_id: program, stock_program_id: tracked ? program : null, price_minor_override: branchPrice(plan.name, item.price) }];
    });
    const { item: created } = await call<{ item: { item_id: string } }>(c, 'POST', '/v1/admin/menu-items', {
      category_id: categoryIds.get(item.category)!,
      tax_class_id: null,
      name: item.name,
      variant_group_id: item.variant === undefined ? null : variantGroupIds.get(item.variant.group)!,
      variant_name: item.variant?.name ?? null,
      sort_order: i,
      price_minor: item.price * 100,
      serve_mode: item.serve ?? 'immediate',
      cook_time_ms: item.cook_min * MIN,
      stock_time_ms: tracked ? item.stock_min! * MIN : null,
      sale_unit: 'piece',
      stock_draws: item.draw === undefined ? [] : [{ stock_item_id: stockItemIds.get(item.draw.stock)!, quantity_per_sale_unit: item.draw.per_sale }],
      routes,
    });
    itemIds.set(item.name, created.item_id);
  }

  // 01c §6.11, V6, V8: Spice level on category Karahi (plain options); Bread on the Chicken Karahi group, linking Naan.
  await call(c, 'POST', '/v1/admin/modifier-groups', {
    name: 'Spice level',
    min_choices: 1,
    max_choices: 1,
    sort_order: 1,
    options: [
      { name: 'Mild', price_minor: 0, sort_order: 1 },
      { name: 'Normal', price_minor: 0, is_default: true, sort_order: 2 },
      { name: 'Hot', price_minor: 0, sort_order: 3 },
    ],
    links: [{ target_kind: 'category', target_id: categoryIds.get('Karahi')!, mode: 'attach' }],
  });
  await call(c, 'POST', '/v1/admin/modifier-groups', {
    name: 'Bread',
    min_choices: 0,
    max_choices: 6,
    sort_order: 2,
    // price_minor null: the Naan's own effective branch price (V6)
    options: [{ name: 'Naan', price_minor: null, max_quantity: 6, linked_item_id: itemIds.get('Naan')!, sort_order: 1 }],
    links: [{ target_kind: 'variant_group', target_id: variantGroupIds.get('Chicken Karahi')!, mode: 'attach' }],
  });

  // 01c §6.14, V10: one Full karahi and 4 naan (plain, or Roghni +Rs 30); §6.16 sells it at every branch.
  const { deal } = await call<{ deal: { deal_id: string } }>(c, 'POST', '/v1/admin/deals', {
    name: 'Family karahi deal',
    category_id: categoryIds.get('Karahi')!,
    tax_class_id: null,
    sort_order: 1,
    price_minor: 3200 * 100,
    parts: [
      { quantity: 1, sort_order: 1, choices: [{ item_id: itemIds.get('Chicken Karahi — Full')! }] },
      {
        quantity: 4,
        sort_order: 2,
        choices: [
          { item_id: itemIds.get('Naan')!, sort_order: 1 },
          { item_id: itemIds.get('Roghni naan')!, extra_price_minor: 30 * 100, sort_order: 2 },
        ],
      },
    ],
  });
  for (const plan of BRANCHES) {
    const b = branchId.get(plan.name)!;
    await call(c, 'PUT', `/v1/admin/deals/${deal.deal_id}/branches/${b}`, {
      expected_version: dealBranchVersion(deal.deal_id, b, null).version,
      is_sold: true,
      price_minor_override: branchPrice(plan.name, 3200),
    });
  }

  const staffIds = new Map<string, string>();
  for (const s of STAFF) {
    const lead = s.lead === undefined ? undefined : staffIds.get(s.lead);
    const { staff } = await call<{ staff: { staff_id: string } }>(c, 'POST', '/v1/admin/staff', {
      display_name: s.name,
      role_ids: [roleId.get(s.role)!],
      branch_ids: s.branches.map((n) => branchId.get(n)!),
      ...(lead !== undefined ? { reports_to: [{ branch_id: branchId.get(s.branches[0]!)!, lead_staff_id: lead }] } : {}),
    });
    staffIds.set(s.name, staff.staff_id);
    if (s.pin !== null) await call(c, 'PUT', `/v1/admin/staff/${staff.staff_id}/pin`, { pin: s.pin });
  }

  const out = deps.out;
  out(`tenant_id ${owner.tenant_id}\nowner_staff_id ${owner.staff_id}\n`);
  out(`owner login ${OWNER_EMAIL} / ${OWNER_PASSWORD}   owner PIN ${OWNER_PIN}\n`);
  for (const b of codes) out(`branch ${b.name.padEnd(11)} ${b.branch_id}  registration code ${b.code}\n`);
  out(`staff PINs: ${STAFF.map((s) => `${s.name} ${s.pin ?? '(none)'}`).join(', ')}\n`);
  out(
    `menu: ${ITEMS.length} items; variant group Chicken Karahi (Half 500 g, Full 1 000 g of Karahi pot); ` +
      `${STOCK_ITEMS.length} stock items; modifier groups Spice level, Bread (Naan); Family karahi deal at every branch\n`,
  );
  return 0;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const pool = createPool(loadCloudEnv(process.env).DATABASE_URL);
  seedDemo(flag(process.argv, 'cloud') ?? 'http://127.0.0.1:4000', flag(process.argv, 'name') ?? 'Arif Chatkhara', {
    pool,
    out: (text) => process.stdout.write(text),
  })
    .finally(() => pool.end())
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'seed failed';
      process.stderr.write(`${message}\n`);
      process.exit(1);
    });
}
