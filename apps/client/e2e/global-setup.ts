import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Permission } from "@pos/domain";
import type { BranchConfig, DirectoryInput, EventDraft } from "@pos/events";
import { cryptoSecrets } from "../../hub/src/lib/secrets";
import { aDirectory } from "../../hub/test/helpers/fixtures";
import {
  appendOrder,
  fixtureMenu,
  FX,
  openDay,
  openSeating,
  setZoneStock,
} from "../../hub/test/orders/fixtures";
import { toStage } from "../../hub/test/voids/fixtures";
import {
  createTestHub,
  pairDevice,
  seedDirectory,
  type DeviceProfileInput,
  type TestHub,
} from "../../hub/test/helpers/test-hub";
import { startTickLoop } from "../../hub/src/alerts/tick";
import { menuWith03, seed03 } from "./03b-fixture";

// W0.7 (Q-32): one hub for the whole run — a provisioned test hub (in-memory clock, SQLite under TMPDIR), the
// fixture staff directory and branch config, one paired tablet; it serves the built /staff/ (run the client
// build first: `pnpm test:e2e` does). The specs read where it listens from POS_E2E_HUB (a JSON file).

export interface E2eDevice {
  token: string;
  device_id: string;
  device_type: "tablet" | "cashier_kiosk" | "phone";
}

export interface E2eHub {
  baseURL: string;
  /** the first paired tablet (W0.7 smoke) */
  device: E2eDevice;
  /** two more tablets, for flows that need two people signed in at once (02a flows) */
  device2: E2eDevice;
  device3: E2eDevice;
  /** 02b flows (task 28): the cashier kiosk and Ali's phone */
  kiosk: E2eDevice;
  phone: E2eDevice;
  tenant_id: string;
  branch_id: string;
  /** 03b / 03c flows (Z1): the fake LAN printer's address (real TCP socket on loopback) */
  printer_address: string;
  /** `pass:<key>` Pass tablets and `kds:<key>` kitchen screens of the 03b flows (03b-fixture.ts) */
  devices03: Record<string, { token: string; device_id: string }>;
  /** 02b-TK hand-over flows: the tablet the kitchen's people sign in on to make a token ready (02b-support `kitchenReady`) */
  kitchen: E2eDevice;
}

/** 02a flows: tables the specs take one by one (a flow never reuses a table another run left seated). */
// 120 a floor (task 28): the 02b flows take their pairs after the 02a flows' (02a's pairs are unchanged)
export const FLOOR_SIZE = 120;
const pad = (n: number) => String(n).padStart(3, "0");
export const TABLE_POOL: string[] = [
  ...Array.from({ length: FLOOR_SIZE }, (_, i) => `G${pad(i + 1)}`),
  ...Array.from({ length: FLOOR_SIZE }, (_, i) => `R${pad(i + 1)}`),
];
export const FLOWS = [
  "map",
  "busy",
  "handover",
  "tables",
  "call",
  "offline",
  "order",
  "comp",
  "zone",
  "bill",
] as const;
export type Flow = (typeof FLOWS)[number];
export const PROJECTS = [
  "tablet-landscape",
  "tablet-portrait",
  "kiosk",
  "phone-390",
  "phone-360",
] as const;
export const LANG_CODES = ["en", "ur"] as const;

/** Two tables nobody else uses: [flow, project, language] picks the pair, so runs never meet. */
export function tablePair(
  flow: Flow,
  project: string,
  lang: string,
): [string, string] {
  const slot =
    (FLOWS.indexOf(flow) * PROJECTS.length +
      PROJECTS.indexOf(project as (typeof PROJECTS)[number])) *
      LANG_CODES.length +
    LANG_CODES.indexOf(lang as "en" | "ur");
  return [TABLE_POOL[slot * 2]!, TABLE_POOL[slot * 2 + 1]!];
}

function grant(permission: Permission) {
  return {
    permission,
    grant_type: "allowed" as const,
    approver_role_id: null,
    approver_role_ids: [],
    scope: "branch" as const,
  };
}

/** The fixture directory plus an order-taker role (take-order, clean-table, mark-served) and two people with it, PIN 1234: Ali and Sara; and Bilal, a waiter (the fixture's order-taker role, no take-order) who reports to Ali: a call from Ali's table reaches him (02a §3.13). */
async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const owner = base.staff.find((p) => p.staff_id === "S_OWNER")!;
  const person = (staff_id: string, display_name: string) => ({
    ...owner,
    staff_id,
    display_name,
    role_ids: ["R_TAKER"],
  });
  // task 28: apply-comp needs the manager's approval (02b §8 Table view, comp with approval); zone stock on the floor
  const comp = {
    permission: "apply-comp" as const,
    grant_type: "requires_approval" as const,
    approver_role_id: "R_MGR",
    approver_role_ids: ["R_MGR"],
    scope: "branch" as const,
  };
  const taker = {
    role_id: "R_TAKER",
    name: "Waiter",
    session_idle_ttl_ms: 3_600_000,
    permissions: [
      grant("take-order"),
      grant("clean-table"),
      grant("mark-served"),
      grant("manage-zone-stock"),
      comp,
      // dl t1 (01d v1.3 §3.13.2 rule 4): a void needs the manager too, so a Manager can tap Ali's void request
      { ...comp, permission: "void-item" as const },
    ],
  };
  const waiter = {
    ...person("S_BILAL", "Bilal"),
    role_ids: ["R_WAIT"],
    lead_staff_id: "S_ALI",
  };
  // 03b Pass flows (Z1): a Cook holding run-pass and reprint-ticket (03b §4.5 B-1), PIN 1234 like the others
  const cookRole = {
    role_id: "R_COOK",
    name: "Cook",
    session_idle_ttl_ms: 3_600_000,
    permissions: [grant("run-pass"), grant("reprint-ticket")],
  };
  const cook = { ...person("S_COOK", "Cook"), role_ids: ["R_COOK"] };
  // 02b-TK L-CLIENT-1 (03b v1.0.16 §3.4, OR-2; 01b v1.12 B-4): the default Pass role — run-pass, mark-served (branch),
  // reprint-ticket — and Pervez, who runs the Pass with it ("Handed to customer"); Cook keeps exactly its grants
  const passRole = {
    role_id: "R_PASS",
    name: "Pass",
    session_idle_ttl_ms: 3_600_000,
    permissions: [grant("run-pass"), grant("mark-served"), grant("reprint-ticket")],
  };
  const packer = { ...person("S_PASS", "Pervez"), role_ids: ["R_PASS"] };
  return {
    ...base,
    roles: [...base.roles, taker, cookRole, passRole],
    staff: [
      ...base.staff,
      person("S_ALI", "Ali"),
      person("S_SARA", "Sara"),
      waiter,
      cook,
      packer,
    ],
  };
}

/** Two floors with FLOOR_SIZE tables each (G001…, R001…), each in a zone; task 28: each zone keeps Cola (warn at 2). */
function floors() {
  const floor = (
    floor_id: string,
    name: string,
    prefix: string,
    sort_order: number,
  ) => ({
    floor_id,
    name,
    sort_order,
    zones: [
      {
        zone_id: `Z-${floor_id}`,
        name,
        sort_order: 0,
        is_archived: false,
        routes: [],
        stock_items: [{ item_id: FX.zoneItem, threshold: 2 }],
      },
    ],
    tables: Array.from({ length: FLOOR_SIZE }, (_, i) => ({
      table_id: `${prefix}${pad(i + 1)}`,
      name: `${prefix}${pad(i + 1)}`,
      seats: 4,
      sort_order: i,
      zone_id: `Z-${floor_id}`,
    })),
  });
  return [
    floor("FL-G", "Ground floor", "G", 0),
    floor("FL-R", "Rooftop", "R", 1),
  ];
}

/** The offline flow needs a table with an order (Ask for bill) and one waiting for cleaning (Clean), seeded as events
 * as the hub's own table tests do; task 28's online 'bill' flow takes one more table waiting for cleaning. */
function seedOfflineTables(hub: TestHub): void {
  const draft = (
    stream_type: "table" | "order",
    stream_id: string,
    event_type: string,
    payload: Record<string, unknown>,
  ): EventDraft =>
    ({
      stream_type,
      stream_id,
      event_type,
      schema_version: 1,
      payload,
      occurred_at: hub.clock.branchNow(),
      actor_id: "S_ALI",
      device_id: "D_SEED",
    }) as EventDraft;
  const append = (d: EventDraft) => {
    hub.clock.advance(1_000);
    hub.deps.writer.run((tx) => tx.append([d]));
  };
  for (const project of PROJECTS) {
    for (const lang of LANG_CODES) {
      const [ordered, dirty] = tablePair("offline", project, lang);
      const open = (table_id: string, seating_id: string) =>
        append(
          draft("table", table_id, "TableOpened", {
            table_id,
            seating_id,
            holder_staff_id: "S_ALI",
            party_size: 2,
          }),
        );
      open(ordered, `seat-${ordered}`);
      const T = hub.clock.branchNow();
      append(
        draft("order", `order-${ordered}`, "OrderPlaced", {
          order_id: `order-${ordered}`,
          order_type: "dine_in",
          table_id: null,
          table_key: `dine_in:seat-${ordered}`,
          follow_up: false,
          pickup_at_ms: null,
          order_item_ids: [`order-${ordered}-L1`],
          groups: [
            {
              group_id: `order-${ordered}:0`,
              target_land_ms: T + 600_000,
              promise_ms: T + 900_000,
              order_item_ids: [`order-${ordered}-L1`],
            },
          ],
          lines: [],
        }),
      );
      open(dirty, `seat-${dirty}`);
      append(
        draft("table", dirty, "BillClosed", { seating_id: `seat-${dirty}` }),
      );
      // task 28 (online Clean, 02a gap): the 'bill' flow's second table waits for cleaning too
      const [, billDirty] = tablePair("bill", project, lang);
      open(billDirty, `seat-${billDirty}`);
      append(
        draft("table", billDirty, "BillClosed", {
          seating_id: `seat-${billDirty}`,
        }),
      );
    }
  }
}

/**
 * dl t1 (01d v1.3 §3.13): the deep-link runs take their table pairs after the 02a / 02b pairs (TABLE_POOL[200 …]),
 * one pair per (scenario, viewport). English only.
 */
export const DL_SCENARIOS = ["void", "closed", "call", "layers"] as const;
export type DlScenario = (typeof DL_SCENARIOS)[number];
export function dlTables(scenario: DlScenario, project: string): [string, string] {
  const base = FLOWS.length * PROJECTS.length * LANG_CODES.length * 2;
  const slot =
    DL_SCENARIOS.indexOf(scenario) * PROJECTS.length +
    PROJECTS.indexOf(project as (typeof PROJECTS)[number]);
  const a = TABLE_POOL[base + slot * 2];
  const b = TABLE_POOL[base + slot * 2 + 1];
  if (a === undefined || b === undefined)
    throw new Error(`dl e2e: no table pair for ${scenario} on ${project}`);
  return [a, b];
}
/** the seeded Naan line of a deep-link table (dlSeedTables) */
export const dlLine = (table: string): string => `L-dl-${table}`;

/**
 * dl t1: a void needs a line the kitchen has started (04 V1: a line at `added` is removed, not voided), and the test
 * hub has no engine fires tick and no cook. So, as 03b's fixture does, the 'void', 'closed' and 'layers' tables are seated
 * by Ali with one Naan the kitchen has started (04's toStage: a real FireDispatched, then ItemStarted).
 */
function dlSeedTables(hub: TestHub): void {
  for (const scenario of ["void", "closed", "layers"] as const)
    for (const project of PROJECTS) {
      const [table] = dlTables(scenario, project);
      const seating_id = `seat-dl-${table}`;
      openSeating(hub, { table_id: table, seating_id, holder_staff_id: "S_ALI" });
      appendOrder(hub, {
        order_type: "dine_in",
        seating_id,
        order_id: `order-dl-${table}`,
        placed_by: "S_ALI",
        lines: [{ order_item_id: dlLine(table), item_id: FX.naan }],
      });
      toStage(hub, `order-dl-${table}`, [dlLine(table)], "cooking");
    }
}

/**
 * 02b-TK hand-over flows (02b-support `kitchenPull`): the e2e hub's clock is fixed and has no fires tick, so a line is
 * fired only by GiveMeMore (03b §6.4), which pulls a line whose fire is still ahead and within its max_early_ms. Kheer
 * (1 min) cooks at its own station (S1's copy at point P1, capacity 20, so the 03b and dl lines S1 keeps cooking take
 * no room): ordered with Naan (5 min, due now) it fires 4 min later, and an hour of max_early_ms lets the kitchen pull
 * it at once.
 */
export const E2E_STATION = "S-E2E";
export const KHEER = { item_id: "I_KHEER", name: "Kheer" } as const;
function menuWithKheer(menu: BranchConfig): BranchConfig {
  const s1 = menu.stations.find((s) => s.station_id === "S1")!;
  const raita = menu.items.find((i) => i.item_id === FX.optionItem)!;
  return {
    ...menu,
    stations: [...menu.stations, { ...s1, station_id: E2E_STATION, name: "Dessert", capacity: 20 }],
    items: [...menu.items, { ...raita, item_id: KHEER.item_id, name: KHEER.name, station_id: E2E_STATION, sort_order: 7, max_early_ms: 3_600_000 }],
  };
}

/**
 * 02b-TK A2 batch 2 (frame TileStates): a "Paye" variant group (Half / Full, plain pieces at the Dessert station, so
 * one tap on the tile adds the variant) and a sold-out "Tikka" (its stock item counted at 0), in a category of their
 * own after the fixture's, so no other flow sees them. Tikka has a stock cook time: 01c V12 tracks stock only for an
 * item that draws and has one (engine stock.ts, the client's stock mirror), so without it the count of 0 never applies.
 */
export const TK_TILES = { category: "Paye", group: "Paye", half: "Half", full: "Full", soldOut: "Tikka", stock: "K_TIKKA" } as const;
function menuWithTiles(menu: BranchConfig): BranchConfig {
  const raita = menu.items.find((i) => i.item_id === FX.optionItem)!;
  const plain = { ...raita, station_id: E2E_STATION, modifier_group_ids: [], category_id: "C_TK", max_early_ms: 3_600_000 };
  return {
    ...menu,
    categories: [...menu.categories, { category_id: "C_TK", name: TK_TILES.category, sort_order: 99, availability_windows: [] }],
    variant_groups: [...menu.variant_groups, { variant_group_id: "V_PAYE", category_id: "C_TK", name: TK_TILES.group, description: null, sort_order: 1 }],
    stock_items: [...menu.stock_items, { stock_item_id: TK_TILES.stock, name: "Tikka", stock_unit: "piece", carries_over: false, station_id: E2E_STATION, low_stock_threshold: null }],
    items: [
      ...menu.items,
      { ...plain, item_id: "I_PAYE_H", name: "Paye — Half", variant_group_id: "V_PAYE", variant_name: TK_TILES.half, price_minor: 40_000, sort_order: 20 },
      { ...plain, item_id: "I_PAYE_F", name: "Paye — Full", variant_group_id: "V_PAYE", variant_name: TK_TILES.full, price_minor: 70_000, sort_order: 21 },
      { ...plain, item_id: "I_TIKKA", name: TK_TILES.soldOut, price_minor: 65_000, sort_order: 22, out_of_stock_behaviour: "sold_out", stock_time_ms: 300_000, stock_draws: [{ stock_item_id: TK_TILES.stock, quantity_per_sale_unit: 1 }] },
    ],
  };
}

/** 05a v1.0.6 §5.3: the screens of each hardware, in the upgrade's order (the first is the device's home, C-1). */
const TABLET_SCREENS: DeviceProfileInput["screens"] = ["dine_in", "takeaway", "parking", "cashier", "manager"];
const KIOSK_SCREENS: DeviceProfileInput["screens"] = ["takeaway", "parking", "dine_in", "cashier", "manager"];
const PHONE_SCREENS: DeviceProfileInput["screens"] = ["dine_in", "takeaway", "parking", "manager"];
const listedOn = (staff_ids: string[], screens: DeviceProfileInput["screens"]): DeviceProfileInput => ({ access: "listed", staff_ids, screens });
const everyoneOn = (screens: DeviceProfileInput["screens"]): DeviceProfileInput => ({ access: "everyone", screens });

/** A free local port: the hub checks Host = advertised_host:http_port (00 host guard), so it is fixed before boot. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = await freePort();
  const hub = await createTestHub({
    config: { advertised_host: "127.0.0.1", http_port: port },
  });
  // the test hub's secrets are a counter that wraps after 8 tokens (a repeat breaks devices.token_hash UNIQUE): the 03b
  // flows pair many devices, so tokens and display codes are random here (as in production, lib/secrets.ts cryptoSecrets)
  Object.assign(hub.deps.secrets, cryptoSecrets);
  await seedDirectory(hub, await directory());
  // task 28: the 02b fixture menu (Chicken Karahi, Naan, Cola, …) on the e2e floors, the business day open, stock counted
  openDay(hub, {
    menu: menuWithTiles(menuWithKheer(menuWith03({ ...fixtureMenu(), floors: floors() }))),
    stock: { [FX.stock]: 1_000_000, [TK_TILES.stock]: 0 },
  });
  for (const zone of ["Z-FL-G", "Z-FL-R"])
    setZoneStock(hub, zone, FX.zoneItem, 500);
  seedOfflineTables(hub);
  dlSeedTables(hub);
  const { printer, devices: devices03 } = await seed03(hub);
  // 05a v1.0.6 §3.3a, §3.5, §3.6, §5.3: every staff device the seed pairs carries the profile its flows need, as a
  // `DeviceProfileSet` through the writer (test-hub `appendDeviceProfile`: the event `SetDeviceProfile` appends; the
  // projection and the in-memory `deviceProfile` map see it). A device someone answers approvals or runs hub admin on is
  // `listed` (rule 3: no listed-only permission and no money answer on an `everyone` device); the others are
  // `everyone`, as the upgrade leaves a shared tablet.
  // tablet: Ali's floor flows, the Owner's takeaway counter (02b-TK), the Manager's hub admin (03b admin flows)
  const tablet = pairDevice(hub, { type: "tablet", name: "Tablet e2e", profile: listedOn(["S_ALI", "S_OWNER", "S_MGR"], TABLET_SCREENS) });
  // tablet 2: the Manager who approves (02a busy, 02b comp / order, dl), Sara (02a hand-over), Bilal (02a call), Ali (03b Pass taker)
  const tablet2 = pairDevice(hub, { type: "tablet", name: "Tablet e2e 2", profile: listedOn(["S_MGR", "S_ALI", "S_SARA", "S_BILAL"], TABLET_SCREENS) });
  // tablet 3: Bilal and Sara (dl call and zone set-up), no approvals: a shared floor tablet
  const tablet3 = pairDevice(hub, { type: "tablet", name: "Tablet e2e 3", profile: everyoneOn(TABLET_SCREENS) });
  // kiosk: Ali and the Owner at the counter (02b takeaway, 02b-TK), the Manager answering a void from it (dl t1 on the kiosk)
  const kiosk = pairDevice(hub, { type: "cashier_kiosk", name: "Kiosk e2e", profile: listedOn(["S_ALI", "S_OWNER", "S_MGR"], KIOSK_SCREENS) });
  // Ali's phone: `listed` [its owner] (§5.3)
  const phone = pairDevice(hub, {
    type: "phone",
    ownerStaffId: "S_ALI",
    name: "Ali phone",
    profile: listedOn(["S_ALI"], PHONE_SCREENS),
  });
  // the 02b-TK kitchen tablet (the Owner reads, the Cook runs the Pass and kitchen-screen commands): shared
  const kitchen = pairDevice(hub, { type: "tablet", name: "Kitchen e2e", profile: everyoneOn(TABLET_SCREENS) });
  const dev = (
    d: { token: string; deviceId: string },
    device_type: E2eDevice["device_type"] = "tablet",
  ): E2eDevice => ({ token: d.token, device_id: d.deviceId, device_type });
  await hub.app.listen({ host: "127.0.0.1", port });
  // 03b flows (Z1): the hub's tick loop (kitchen screen presence → takeover) needs time to pass; the test hub's clock is
  // fixed, so while a spec holds the flag file (03b-support `withLiveClock`) it runs at wall-clock speed (1 s a second), as
  // the hub's own clock does in production. Every other spec keeps the fixed clock (ordering, undo windows, presence).
  const stopTick = startTickLoop(hub.deps, hub.app.log);
  const clockFlag = join(tmpdir(), `pos-e2e-hub-${process.pid}.clock`);
  const clockDriver = setInterval(() => {
    if (existsSync(clockFlag)) hub.clock.advance(1_000);
  }, 1_000);
  const info: E2eHub = {
    baseURL: `http://127.0.0.1:${port}`,
    device: dev(tablet),
    device2: dev(tablet2),
    device3: dev(tablet3),
    kiosk: dev(kiosk, "cashier_kiosk"),
    phone: dev(phone, "phone"),
    tenant_id: "tenant-a",
    branch_id: "branch-1",
    printer_address: printer.address,
    devices03,
    kitchen: dev(kitchen),
  };
  const file = join(tmpdir(), `pos-e2e-hub-${process.pid}.json`);
  writeFileSync(file, JSON.stringify(info));
  process.env["POS_E2E_HUB"] = file;
  return async () => {
    clearInterval(clockDriver);
    rmSync(clockFlag, { force: true });
    stopTick();
    await hub.close();
    await printer.close();
  };
}
