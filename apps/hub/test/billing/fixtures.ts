// 05 plan §2B.5 row P0.F: shared test fixtures for every 05 lane (hub base). Built on 02b's test/orders/fixtures.ts and
// 04's test/voids/fixtures.ts (re-used, not copied): every order, line and seating comes from real events through the
// hub's real writer, over every merged migration. Over events, migrations and merged helpers only; the `billing`
// projection (task 7) is not used here. Jurisdictions re-use packages/domain compute.fixtures.ts.
import type { Permission } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import { JURISDICTION_SEEDS, type DirectoryInput, type JurisdictionRuleValues } from '@pos/events';
import { DEFAULT_ROLES } from '../../../cloud/src/modules/staff-roles/default-roles';
import {
  noneRules,
  PK_PB_RULES,
  PK_RULES,
  pkPbProfile,
  rateBpProfile,
  stackedProfile,
} from '../../../../packages/domain/src/billing/compute.fixtures';
import type { ComputeRules, ComputeTaxProfile } from '../../../../packages/domain/src/billing/compute';
import { aDirectory } from '../helpers/fixtures';
import { openSession, pairDevice, type TestHub } from '../helpers/test-hub';
import {
  answer,
  append,
  appendOrder,
  dealX2,
  FX,
  mergedSeating,
  openSeating,
  openVoidsDay,
  optionChildOrder,
  parkingOrder,
  pendingWeight,
  PIN,
  post,
  raiseVoid,
  remakeLine,
  signIn,
  STAFF,
  startVoids,
  takeawayOrder,
  VX,
  type Reply,
  type Who,
} from '../voids/fixtures';

export { answer, appendOrder, dealX2, FX, mergedSeating, openSeating, optionChildOrder, parkingOrder, pendingWeight, PIN, post, raiseVoid, remakeLine, signIn, STAFF, takeawayOrder, VX };
export type { Reply, Who };

/** The billing ids on top of FX / VX / STAFF. */
export const BX = {
  /** the Manager role of the directory (approver of every `requires_approval` default) */
  managerRole: 'R_MGR',
  /** the table of dineInTwoRounds */
  dineInTable: VX.tables.T4,
  /** the plate of parkingTwoDays */
  plate: 'LEB 1234',
} as const;

// ------------------------------------------------------------------------------------------- directory (row B-2)

const ROLE_OF = { owner: 'R_OWNER', manager: BX.managerRole, cashier: 'R_CASH', order_taker: 'R_WAIT' } as const;
type Wanted = keyof typeof ROLE_OF;

type Grant = DirectoryInput['roles'][number]['permissions'][number];
const grantOf = (permission: Permission, scope: Grant['scope']): Grant => ({ permission, grant_type: 'allowed', approver_role_id: null, approver_role_ids: [], scope });

/**
 * aDirectory()'s four people (Owner, Manager, Cashier, Order taker; STAFF + S_OWNER, PINs from helpers/fixtures) over the
 * four roles of the cloud's own DEFAULT_ROLES (01b §6.15, 05 row B-2, P0.8: the same data new tenants are seeded with;
 * the hub already imports it the same way in test/voids/permissions.int.test.ts). Waiter and Cook are left out.
 * default_key → role_id and approver_key → approver_role_ids are mapped as the cloud's directory export does.
 */
export async function billingDirectory(o?: { directory_version?: number }): Promise<DirectoryInput> {
  const base = await aDirectory(o);
  const roles = DEFAULT_ROLES.filter((r): r is typeof r & { default_key: Wanted } => r.default_key in ROLE_OF).map((r) => ({
    role_id: ROLE_OF[r.default_key],
    name: r.name,
    session_idle_ttl_ms: r.session_idle_ttl_ms,
    permissions: r.grants.map((g): Grant => {
      const scope = g.scope ?? 'branch';
      if (g.grant_type === 'allowed') return grantOf(g.permission, scope);
      const approver = ROLE_OF[g.approver_key as Wanted];
      return { permission: g.permission, grant_type: 'requires_approval', approver_role_id: approver, approver_role_ids: [approver], scope };
    }),
  }));
  return { ...base, roles };
}

/** A hub with billingDirectory() seeded and voidsMenu()'s day open (startVoids' options: `stock`, `open: false`). */
export function startBilling(o: { stock?: Record<string, number>; open?: boolean } = {}): Promise<TestHub> {
  return billingDirectory().then((directory) => startVoids({ ...o, directory }));
}

// ------------------------------------------------------------------------------------------- devices and sign-in

/** A cashier kiosk: the device a drawer shift is opened on (05 B11 / B23: `drawer_device_id`). */
export function drawerDevice(hub: TestHub, name = 'Counter drawer'): { deviceId: string; token: string } {
  return pairDevice(hub, { type: 'cashier_kiosk', name });
}

/** A staff session on a device that already exists (signIn pairs a new tablet each time). */
export function signInOn(hub: TestHub, staffId: string, device: { deviceId: string; token: string }): Who {
  const session = openSession(hub, { kind: 'staff', staffId, deviceId: device.deviceId });
  return { staffId, deviceId: device.deviceId, token: device.token, sessionId: session.sessionId, sessionToken: session.token };
}

// ------------------------------------------------------------------------------------------- orders and seatings

export interface Round {
  order_id: string;
  lines: string[];
}

/** One open seating at T4 with two rounds: a karahi and a naan, then a follow-up naan (02b O1: a round is a new order). */
export function dineInTwoRounds(hub: TestHub, o: { prefix?: string; table_id?: string } = {}): { seating_id: string; table_id: string; rounds: [Round, Round] } {
  const p = o.prefix ?? 'DI';
  const table_id = o.table_id ?? BX.dineInTable;
  const seating_id = `SEAT_${p}`;
  openSeating(hub, { table_id, seating_id });
  const first = [`${p}1_K`, `${p}1_N`];
  const second = [`${p}2_N`];
  const r1 = appendOrder(hub, {
    order_type: 'dine_in',
    seating_id,
    placed_by: STAFF.orderTaker,
    lines: [
      { order_item_id: first[0]!, item_id: FX.piece },
      { order_item_id: first[1]!, item_id: FX.naan },
    ],
  });
  const r2 = appendOrder(hub, { order_type: 'dine_in', seating_id, placed_by: STAFF.orderTaker, follow_up: true, lines: [{ order_item_id: second[0]!, item_id: FX.naan }] });
  return { seating_id, table_id, rounds: [{ order_id: r1.order_id, lines: first }, { order_id: r2.order_id, lines: second }] };
}

/** A takeaway of three naans (3 000 each) with one unit comped by a real LineComped (as the Manager, a direct comp). */
export function compedLine(hub: TestHub, o: { prefix?: string; units?: number; value_minor?: number } = {}): { order_id: string; line: string } {
  const line = `${o.prefix ?? 'CP'}_N`;
  const { order_id } = appendOrder(hub, { order_type: 'takeaway', placed_by: STAFF.orderTaker, lines: [{ order_item_id: line, item_id: FX.naan, quantity: 3 }] });
  append(
    hub,
    [
      {
        stream_type: 'order',
        stream_id: order_id,
        event_type: 'LineComped',
        payload: { order_item_id: line, units: o.units ?? 1, value_minor: o.value_minor ?? 3_000, reason_code: 'quality', note: null, requester_staff_id: STAFF.manager, alert_id: null, approver_staff_id: null },
      },
    ],
    { actor: STAFF.manager },
  );
  return { order_id, line };
}

/** A takeaway root (one naan) and an addition (05 row Q-6): the addition keeps the root's token and carries `adds_to_order_id`. */
export function addedTakeaway(hub: TestHub, o: { prefix?: string } = {}): { root: { order_id: string; token: number; line: string }; addition: { order_id: string; line: string } } {
  const p = o.prefix ?? 'AT';
  const root = takeawayOrder(hub, { prefix: p });
  const line = `${p}_ADD`;
  const { order_id } = appendOrder(hub, {
    order_type: 'takeaway',
    placed_by: STAFF.orderTaker,
    adds_to_order_id: root.order_id,
    lines: [{ order_item_id: line, item_id: FX.naan }],
  });
  return { root, addition: { order_id, line } };
}

/**
 * The same parking plate on two business days: an order on the open day, a real BusinessDayClosed, the clock to the next
 * local noon, the next day opened, a second order for the plate (one `table_key`, two `business_date`s). Day 2 is left open.
 * Needs the day open (startBilling's default).
 */
export function parkingTwoDays(hub: TestHub, o: { plate?: string; prefix?: string } = {}): {
  day1: { order_id: string; business_date: string };
  day2: { order_id: string; business_date: string };
} {
  const day = (hub.deps.state.get() as EngineState).business_day;
  if (day === null) throw new Error('parkingTwoDays: the business day must be open (startBilling)');
  const p = o.prefix ?? 'PP';
  const car_number = o.plate ?? BX.plate;
  const first = parkingOrder(hub, { prefix: `${p}1`, car_number });
  append(hub, [{ stream_type: 'hub', stream_id: hub.deps.config.provisioned!.branch_id, event_type: 'BusinessDayClosed', payload: {} }], { actor: STAFF.manager });
  const noon = new Date(`${day.business_date}T12:00:00`);
  noon.setDate(noon.getDate() + 1);
  hub.clock.set(noon.getTime());
  const { business_date } = openVoidsDay(hub);
  const second = parkingOrder(hub, { prefix: `${p}2`, car_number });
  return { day1: { order_id: first.order_id, business_date: day.business_date }, day2: { order_id: second.order_id, business_date } };
}

// ------------------------------------------------------------------------------------------- jurisdictions (05 §3.4, row A-1)

export interface JurisdictionFixture {
  jurisdiction_id: string;
  rules: ComputeRules;
  profiles: ComputeTaxProfile[];
  /** the profile the fixture lines carry (`order_lines.tax_profile_id`) */
  tax_profile_id: string;
  /** 01a's built-in values where a seed exists (none, PK), else null */
  seed: JurisdictionRuleValues | null;
}

const FOOD = 'tc-food';
const flat = (jurisdiction_id: string, rules: ComputeRules, seed: JurisdictionRuleValues | null): JurisdictionFixture => ({
  jurisdiction_id,
  rules,
  profiles: [rateBpProfile(FOOD, 'Sales tax', 1600)],
  tax_profile_id: FOOD,
  seed,
});

/**
 * `none`, `PK`, `PK-PB` (from compute.fixtures.ts, the shapes of row A-1's seeds) and three test-only jurisdictions:
 * TEST-MULTI (a stacked federal 10 % + provincial 5 %, not compound, both classes), TEST-E0 (exponent 0) and TEST-E3
 * (exponent 3), each a flat 1 600 bp 'tc-food' like `none`.
 */
export const JURISDICTIONS = {
  none: flat('none', noneRules(), JURISDICTION_SEEDS.none),
  PK: flat('PK', PK_RULES, JURISDICTION_SEEDS.PK),
  'PK-PB': { jurisdiction_id: 'PK-PB', rules: PK_PB_RULES, profiles: [pkPbProfile('restaurant')], tax_profile_id: 'restaurant', seed: null },
  'TEST-MULTI': { jurisdiction_id: 'TEST-MULTI', rules: noneRules(), profiles: [stackedProfile('multi', 1000, 500, false)], tax_profile_id: 'multi', seed: null },
  'TEST-E0': flat('TEST-E0', noneRules(0), null),
  'TEST-E3': flat('TEST-E3', noneRules(3), null),
} as const satisfies Record<string, JurisdictionFixture>;
