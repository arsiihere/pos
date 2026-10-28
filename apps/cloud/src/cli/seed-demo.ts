/// <reference types="node" />
import { pathToFileURL } from 'node:url';
import { createPool } from '../db/migrate.js';
import { systemClock } from '../lib/clock.js';
import { loadCloudEnv } from '../lib/env.js';
import { ulidGen } from '../lib/ids.js';
import { cryptoSecrets } from '../lib/secrets.js';
import { issueRegistrationCode } from './issue-registration-code.js';
import { seedTenant } from './seed-tenant.js';
import { SystemContext } from './system-context.js';

// Dev only (docs/manual-test-e2e.md): a demo tenant for hand testing. The tenant, its default roles and the
// three branches are written as seed-tenant and issue-registration-code write them; everything else goes
// through the owner API of a running cloud, so every rule and version bump of 01a and 01b applies.

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

interface ItemPlan {
  name: string;
  category: string;
  price: number; // rupees
  station: string; // station key; a branch without it gets no route
  program?: string;
  cook_min: number;
  stock_min?: number | null;
  stock_unit?: 'piece' | 'g' | 'ml';
  per_sale?: number;
  low?: number | null;
  carries?: boolean;
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

const ITEMS: ItemPlan[] = [
  { name: 'Chicken tikka', category: 'BBQ', price: 650, station: 'bbq', cook_min: 14, stock_min: 3, low: 10, serve: 'sync' },
  { name: 'Seekh kebab (4 pcs)', category: 'BBQ', price: 720, station: 'bbq', cook_min: 10, stock_min: 2, low: 8, serve: 'sync' },
  { name: 'Malai boti', category: 'BBQ', price: 890, station: 'bbq', cook_min: 12, serve: 'sync' },
  { name: 'Chicken karahi (half)', category: 'Karahi', price: 1450, station: 'karahi', cook_min: 20, serve: 'sync' },
  { name: 'Mutton karahi (half)', category: 'Karahi', price: 2600, station: 'karahi', cook_min: 30, serve: 'sync' },
  { name: 'Chicken biryani', category: 'Rice', price: 450, station: 'karahi', cook_min: 25, stock_min: 1, stock_unit: 'g', per_sale: 350, low: 2000 },
  { name: 'Naan', category: 'Breads', price: 40, station: 'tandoor', program: 'Naan', cook_min: 3, serve: 'sync' },
  { name: 'Roghni naan', category: 'Breads', price: 80, station: 'tandoor', program: 'Roghni naan', cook_min: 4, serve: 'sync' },
  { name: 'Fries', category: 'Sides', price: 350, station: 'fryer', program: 'Fries 180', cook_min: 6, stock_min: 0, low: 5 },
  { name: 'Raita', category: 'Sides', price: 120, station: 'drinks', cook_min: 1, stock_min: 0, low: 10, carries: true },
  { name: 'Mint margarita', category: 'Drinks', price: 380, station: 'drinks', cook_min: 3 },
  { name: 'Soft drink 1.5 L', category: 'Drinks', price: 300, station: 'drinks', cook_min: 1, stock_min: 0, low: 6, carries: true },
  { name: 'Halwa puri', category: 'Breakfast', price: 550, station: 'karahi', cook_min: 8 },
];

// Default role names → default_key lookups go through the API's role list (§3.8: by key in code, by name here
// only because this is demo data).
interface StaffPlan {
  name: string;
  role: string;
  branches: string[];
  pin: string | null;
  lead?: string;
}

const STAFF: StaffPlan[] = [
  { name: 'Hamza', role: 'Manager', branches: ['Gulberg'], pin: '2222' },
  { name: 'Usman', role: 'Cashier', branches: ['Gulberg'], pin: '3333' },
  { name: 'Ali', role: 'Order taker', branches: ['Gulberg'], pin: '4444' },
  { name: 'Zain', role: 'Waiter', branches: ['Gulberg'], pin: '5555', lead: 'Ali' },
  { name: 'Faisal', role: 'Cook', branches: ['Gulberg'], pin: '6666' },
  { name: 'Kashif', role: 'Manager', branches: ['Johar Town'], pin: '7777' },
  { name: 'Nadeem', role: 'Waiter', branches: ['Johar Town'], pin: null },
  { name: 'Imran', role: 'Manager', branches: ['DHA'], pin: '8888' },
];

export async function seedDemo(base: string, tenantName: string): Promise<void> {
  const env = loadCloudEnv(process.env);
  const pool = createPool(env.DATABASE_URL);
  const clock = systemClock();
  const ids = ulidGen(clock);
  const sys = new SystemContext(pool);
  const codes: { name: string; code: string; branch_id: string }[] = [];
  let owner: { tenant_id: string; staff_id: string };
  try {
    owner = await seedTenant(
      sys,
      { name: tenantName, currency: 'PKR', ownerEmail: OWNER_EMAIL, ownerName: 'Arif', password: OWNER_PASSWORD, pin: OWNER_PIN },
      { clock, ids },
    );
    for (const branch of BRANCHES) {
      const issued = await issueRegistrationCode(sys, { tenantId: owner.tenant_id, branchName: branch.name }, { clock, ids, secrets: cryptoSecrets });
      codes.push({ name: branch.name, code: issued.code, branch_id: issued.branch_id });
    }
  } finally {
    await pool.end();
  }

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

  for (const [i, item] of ITEMS.entries()) {
    const routes = BRANCHES.flatMap((plan) => {
      const st = stationIds.get(`${plan.name}/${item.station}`);
      if (st === undefined) return [];
      const program = item.program === undefined ? null : (st.programs.get(item.program) ?? null);
      // DHA charges a little more (S57 branch price).
      const override = plan.name === 'DHA' ? Math.round(item.price * 1.1) * 100 : null;
      return [{ branch_id: branchId.get(plan.name)!, station_id: st.station_id, program_id: program, stock_program_id: item.stock_min !== undefined && item.stock_min !== null ? program : null, price_minor_override: override }];
    });
    const stockUnit = item.stock_unit ?? 'piece';
    await call(c, 'POST', '/v1/admin/menu-items', {
      category_id: categoryIds.get(item.category)!,
      tax_class_id: null,
      name: item.name,
      sort_order: i,
      price_minor: item.price * 100,
      serve_mode: item.serve ?? 'immediate',
      cook_time_ms: item.cook_min * MIN,
      stock_time_ms: item.stock_min === undefined || item.stock_min === null ? null : item.stock_min * MIN,
      stock_unit: stockUnit,
      sale_unit: 'piece',
      stock_per_sale_unit: stockUnit === 'piece' ? 1 : (item.per_sale ?? 1),
      low_stock_threshold: item.low ?? null,
      carries_over: item.carries ?? false,
      routes,
    });
  }

  const { roles } = await call<{ roles: { role_id: string; name: string }[] }>(c, 'GET', '/v1/admin/roles');
  const roleId = new Map(roles.map((r) => [r.name, r.role_id]));
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

  const out = process.stdout;
  out.write(`tenant_id ${owner.tenant_id}\nowner_staff_id ${owner.staff_id}\n`);
  out.write(`owner login ${OWNER_EMAIL} / ${OWNER_PASSWORD}   owner PIN ${OWNER_PIN}\n`);
  for (const b of codes) out.write(`branch ${b.name.padEnd(11)} ${b.branch_id}  registration code ${b.code}\n`);
  out.write(`staff PINs: ${STAFF.map((s) => `${s.name} ${s.pin ?? '(none)'}`).join(', ')}\n`);
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  seedDemo(flag(process.argv, 'cloud') ?? 'http://127.0.0.1:4000', flag(process.argv, 'name') ?? 'Arif Chatkhara').catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'seed failed';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
