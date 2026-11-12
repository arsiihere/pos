import type { DirectoryInput } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentDirectory } from '../../src/auth/guards';
import type { CommandCtx } from '../../src/commands/registry';
import { checkOrderScope, orderCovered, scopedOrders, type ScopedOrder } from '../../src/orders/commands/mark-served';
import { currentTableOf } from '../../src/tables/reads';
import { aDirectory } from '../helpers/fixtures';
import { statementCounter } from '../helpers/statement-counter';
import { createTestHub, seedDirectory, type TestHub } from '../helpers/test-hub';
import { FX, appendOrder, openDay, openSeating } from './fixtures';

// 03b P0.14 (G-3, owner-approved): the pure `orderCovered` gives checkOrderScope's verdict for any staff, with the
// tables read once by the caller; 0 statements. 02b §3.14 behaviour unchanged (checkOrderScope wraps it).

let hub: TestHub;
afterEach(async () => {
  await hub?.close();
});

function grant(permission: string, scope: 'branch' | 'my_floors' | 'own_tables') {
  return { permission, grant_type: 'allowed' as const, approver_role_id: null, approver_role_ids: [], scope };
}

async function directory(): Promise<DirectoryInput> {
  const base = await aDirectory();
  const pin = base.staff[0]!.pin_hash;
  const person = (staff_id: string, role_ids: string[], floor_ids: string[] = []) => ({
    staff_id,
    display_name: staff_id,
    pin_hash: pin,
    role_ids,
    denied_permissions: [],
    lead_staff_id: null,
    floor_ids,
  });
  const role = (role_id: string, permissions: ReturnType<typeof grant>[]) => ({ role_id, name: role_id, session_idle_ttl_ms: 36_000_000, permissions });
  return {
    ...base,
    roles: [
      ...base.roles,
      role('R_BRANCH', [grant('mark-served', 'branch')]),
      role('R_OWN', [grant('mark-served', 'own_tables')]),
      role('R_FLOOR', [grant('mark-served', 'my_floors')]),
    ],
    staff: [
      ...base.staff,
      person('S_BRANCH', ['R_BRANCH']),
      person('S_HOLDER', ['R_OWN']),
      person('S_OTHER', ['R_OWN']),
      person('S_FLOOR', ['R_FLOOR'], [FX.floor]),
      person('S_FAR', ['R_FLOOR'], ['F_OTHER']),
      person('S_NONE', []),
    ],
  };
}

beforeEach(async () => {
  hub = await createTestHub();
  await seedDirectory(hub, await directory());
  openDay(hub);
});

const ctxFor = (staffId: string): CommandCtx => {
  const directory = currentDirectory(hub.app);
  return {
    actor: { staffId },
    permission: directory.resolve(staffId, 'mark-served'),
    directory,
    tx: { db: hub.deps.db },
  } as unknown as CommandCtx;
};

const verdict = (staffId: string, o: ScopedOrder): boolean => {
  try {
    checkOrderScope(ctxFor(staffId), [o]);
    return true;
  } catch (error) {
    expect((error as { code?: string }).code).toBe('PERMISSION_DENIED');
    return false;
  }
};

describe('[03b G-3, 02b §3.14] orderCovered = checkOrderScope', () => {
  it('[03b G-3] per scope (branch, own_tables, my_floors, none) × order type (dine-in, takeaway, parking): the same verdict, 0 statements', () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_HOLDER' });
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'D1', item_id: FX.naan }], placed_by: 'S_HOLDER' }).order_id;
    const takeaway = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan }], placed_by: 'S_HOLDER' }).order_id;
    const parking = appendOrder(hub, { order_type: 'parking', lines: [{ order_item_id: 'P1', item_id: FX.naan }], placed_by: 'S_FLOOR' }).order_id;
    const orders = scopedOrders(hub.deps.db, [dine, takeaway, parking]);
    const tables = currentTableOf(hub.deps.db, [dine]);
    const directory = currentDirectory(hub.app);
    const staff = ['S_BRANCH', 'S_HOLDER', 'S_OTHER', 'S_FLOOR', 'S_FAR', 'S_NONE'];
    const expected: Record<string, [boolean, boolean, boolean]> = {
      // [dine-in, takeaway, parking]
      S_BRANCH: [true, true, true],
      S_HOLDER: [true, true, false],
      S_OTHER: [false, false, false],
      S_FLOOR: [true, false, true],
      S_FAR: [false, false, false],
      S_NONE: [false, false, false],
    };
    for (const staffId of staff) {
      const [d, t, p] = [dine, takeaway, parking].map((id) => verdict(staffId, orders.get(id)!));
      expect([d, t, p], `${staffId} checkOrderScope`).toEqual(expected[staffId]);
      const who = { staffId, resolution: directory.resolve(staffId, 'mark-served') };
      const counter = statementCounter(hub.deps.db);
      const covered = [dine, takeaway, parking].map((id) => orderCovered(orders.get(id)!, who, tables, (s) => directory.floorsOf(s)));
      expect(counter.count, `${staffId} statements`).toBe(0);
      expect(covered, `${staffId} orderCovered`).toEqual(expected[staffId]);
    }
  });

  it('[03b G-3] no staff, no resolution, or a my_floors dine-in without the tables read → not covered', () => {
    openSeating(hub, { table_id: FX.table, seating_id: 'SEAT1', holder_staff_id: 'S_HOLDER' });
    const dine = appendOrder(hub, { order_type: 'dine_in', seating_id: 'SEAT1', lines: [{ order_item_id: 'D1', item_id: FX.naan }] }).order_id;
    const o = scopedOrders(hub.deps.db, [dine]).get(dine)!;
    const directory = currentDirectory(hub.app);
    const floorsOf = (s: string) => directory.floorsOf(s);
    expect(orderCovered(o, { staffId: null, resolution: { grant: 'allowed', scope: 'branch' } }, null, floorsOf)).toBe(false);
    expect(orderCovered(o, { staffId: 'S_BRANCH', resolution: null }, null, floorsOf)).toBe(false);
    expect(orderCovered(o, { staffId: 'S_NONE', resolution: { grant: 'not_granted' } }, null, floorsOf)).toBe(false);
    expect(orderCovered(o, { staffId: 'S_FLOOR', resolution: directory.resolve('S_FLOOR', 'mark-served') }, null, floorsOf)).toBe(false);
    expect(orderCovered(o, { staffId: 'S_FLOOR', resolution: directory.resolve('S_FLOOR', 'mark-served') }, currentTableOf(hub.deps.db, [dine]), floorsOf)).toBe(true);
  });

  it('[03b §3.5 step 2, #25] orderCovered checks the scope only: a requires_approval resolution is covered, so callers check grant first', () => {
    const dine = appendOrder(hub, { order_type: 'takeaway', lines: [{ order_item_id: 'T1', item_id: FX.naan }], placed_by: 'S_HOLDER' }).order_id;
    const o = scopedOrders(hub.deps.db, [dine]).get(dine)!;
    const floorsOf = (s: string) => currentDirectory(hub.app).floorsOf(s);
    const approval = { grant: 'requires_approval' as const, approver_role_ids: ['R_BRANCH'], scope: 'branch' as const };
    // Documented parity: the pure function alone says "covered" for requires_approval …
    expect(orderCovered(o, { staffId: 'S_OTHER', resolution: approval }, null, floorsOf)).toBe(true);
    expect(orderCovered(o, { staffId: 'S_HOLDER', resolution: { ...approval, scope: 'own_tables' } }, null, floorsOf)).toBe(true);
    // … so 03b's Handover receiver / pass-receivers must require grant === 'allowed' before calling it.
    const receiverOk = (resolution: typeof approval | { grant: 'allowed'; scope: 'branch' }) =>
      resolution.grant === 'allowed' && orderCovered(o, { staffId: 'S_OTHER', resolution }, null, floorsOf);
    expect(receiverOk(approval)).toBe(false);
    expect(receiverOk({ grant: 'allowed', scope: 'branch' })).toBe(true);
  });
});
