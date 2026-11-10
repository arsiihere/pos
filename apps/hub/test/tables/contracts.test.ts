import type { TableState } from '@pos/domain';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { StaffDirectory } from '../../src/auth/staff-directory';
import type { CommandCtx } from '../../src/commands/registry';
import type { CurrentTableOf as EngineCurrentTableOf, HoldersOfOrders as EngineHoldersOfOrders } from '../../src/engine-host/slip-readers';
import type { WriterTx } from '../../src/engine-host/writer';
import type {
  CloseHandover,
  CurrentTableOf,
  HoldersOfOrders,
  LockRow,
  MergeGuard,
  RequireLock,
  SeatingOf,
  SeatingRow,
  TableOwners,
  WaiterTeam,
  ZoneOf,
} from '../../src/tables/contracts';
import * as tables from '../../src/tables/index';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// Wraps the real registerTables so the test sees buildHubServer call it (server.ts wiring).
vi.mock('../../src/tables/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/tables/index')>();
  return { ...real, registerTables: vi.fn(real.registerTables) };
});

describe('[02a §4.2] contracts', () => {
  it('[02a §4.2] contracts compile', () => {
    // §5 seatings row (0012 columns); state is the column's CHECK: the open TableStates (no FREE) plus CLOSED.
    expectTypeOf<SeatingRow>().toEqualTypeOf<{
      seating_id: string;
      primary_table_id: string;
      state: Exclude<TableState, 'FREE'> | 'CLOSED';
      holder_staff_id: string;
      party_size: number | null;
      opened_at: number;
      bill_requested_at: number | null;
      bill_closed: 0 | 1;
      closed_at: number | null;
      close_reason: 'cleaned' | 'left_without_order' | 'merged' | null;
    }>();
    // §5 table_locks row (0012 columns).
    expectTypeOf<LockRow>().toEqualTypeOf<{
      table_id: string;
      seating_id: string;
      staff_id: string;
      device_id: string;
      locked_at: number;
      last_activity_at: number;
      last_touch_at: number | null;
    }>();
    // §4.2 tableOwners: Map<table_id, staff_id>, 1 statement.
    expectTypeOf<TableOwners>().toEqualTypeOf<(db: Database.Database, table_ids: readonly string[]) => Map<string, string>>();
    // §4.2 holdersOfOrders / currentTableOf: 03a v1.2 §4.4's types, re-exported (not redefined).
    expectTypeOf<HoldersOfOrders>().toEqualTypeOf<EngineHoldersOfOrders>();
    expectTypeOf<CurrentTableOf>().toEqualTypeOf<EngineCurrentTableOf>();
    expectTypeOf<CurrentTableOf>().toEqualTypeOf<
      (db: Database.Database, order_ids: readonly string[]) => Map<string, { seating_id: string; primary_table_id: string; table_ids: string[] }>
    >();
    // §4.2 seatingOf.
    expectTypeOf<SeatingOf>().toEqualTypeOf<
      (
        db: Database.Database,
        table_id: string,
      ) => { seating_id: string; primary_table_id: string; table_ids: string[]; state: TableState; holder_staff_id: string } | null
    >();
    // §4.2 zoneOf: 0 statements, no db.
    expectTypeOf<ZoneOf>().toEqualTypeOf<
      (table_id: string) => { floor_id: string; zone_id: string | null; zone_order_taker_staff_id: string | null }
    >();
    // §4.2 requireLock.
    expectTypeOf<RequireLock>().toEqualTypeOf<
      (tx: WriterTx, ref: { table_id: string; seating_id: string }, ctx: CommandCtx) => EventDraft[]
    >();
    // §3.9 closeHandover.
    expectTypeOf<CloseHandover>().toEqualTypeOf<(ctx: CommandCtx, seating_id: string, note: string) => EventDraft[]>();
    // §4.1 row 04: the merge guard.
    expectTypeOf<MergeGuard>().toEqualTypeOf<
      (db: Database.Database, q: { seating_ids: string[]; order_ids?: string[] }) => { blocked: boolean; order_item_ids: string[] }
    >();
    // §3.5 waiterTeam.
    expectTypeOf<WaiterTeam>().toEqualTypeOf<
      (seating: { assignee: string | null; holder_staff_id: string }, liveStaffIds: ReadonlySet<string>, directory: StaffDirectory) => string[]
    >();
    // index.ts entry points.
    expectTypeOf(tables.registerTables).parameters.toEqualTypeOf<[TestHub['app'], TestHub['deps']]>();
    expectTypeOf(tables.registerTables).returns.toEqualTypeOf<void>();
    expectTypeOf(tables.registerTablesProjection).parameters.toEqualTypeOf<[TestHub['deps']['projections']]>();
    expectTypeOf(tables.registerTablesProjection).returns.toEqualTypeOf<void>();
  });
});

describe('[02a §4.2] wiring skeleton', () => {
  let hub: TestHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('[02a §4.2] buildHubServer calls registerTables once with its app and deps', async () => {
    hub = await createTestHub();
    expect(tables.registerTables).toHaveBeenCalledTimes(1);
    const [app, deps] = vi.mocked(tables.registerTables).mock.calls[0] ?? [];
    expect(app === hub.app).toBe(true); // identity: a deep compare walks Fastify's address getter
    expect(deps === hub.deps).toBe(true);
  });
});
