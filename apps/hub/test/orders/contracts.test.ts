import type { ProposedOrder } from '@pos/engine';
import type { BranchConfig, EventDraft, ItemAddedPayload } from '@pos/events';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CommandCtx } from '../../src/commands/registry';
import type { WriterTx } from '../../src/engine-host/writer';
import type {
  BuildSubmit,
  FoodDrafts,
  LineChangeDrafts,
  LineShares,
  LineView,
  OrderLines,
  OrdersOf,
  OrderView,
  SeatingTotals,
  SubmitInput,
  ZoneAlertDrafts,
} from '../../src/orders/contracts';
import * as orders from '../../src/orders/index';
import { createTestHub, type TestHub } from '../helpers/test-hub';

// Wraps the real registerOrders so the test sees buildHubServer call it (server.ts wiring).
vi.mock('../../src/orders/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/orders/index')>();
  return { ...real, registerOrders: vi.fn(real.registerOrders) };
});

describe('[02b §4.2] contracts', () => {
  it('[02b §4.2] contracts compile', () => {
    // §4.2 orderLines fields, plus the §5 order_lines columns the commands read (SQL nullability; flags boolean).
    expectTypeOf<LineView>().toEqualTypeOf<{
      order_item_id: string;
      order_id: string;
      parent_order_item_id: string | null;
      line_kind: 'item' | 'option_child' | 'deal' | 'deal_part';
      item_id: string | null;
      deal_id: string | null;
      name: string;
      sale_unit: 'piece' | 'g' | 'ml';
      quantity: number | null;
      units: number;
      live_units: number;
      comped_units: number;
      removed_units: number;
      voided_units: number;
      returned_units: number;
      refundable_minor: number;
      comp_minor: number;
      comp_voided_minor: number;
      removed_minor: number;
      refund_minor: number;
      line_total_minor: number | null;
      billed_minor: number;
      return_of: string | null;
      served_from_zone_id: string | null;
      zone_served: boolean;
      added_at: number;
      served_at: number | null;
      served_source: 'tap' | 'estimated' | 'zone' | null;
      is_food: boolean;
      kitchen_note: string | null;
    }>();
    // plan "02b exports" OrderView, plus the §5 orders columns (no contact values: has_phone only, O17).
    expectTypeOf<OrderView>().toEqualTypeOf<{
      order_id: string;
      order_type: 'dine_in' | 'takeaway' | 'parking';
      table_key: string;
      business_date: string;
      token: number | null;
      car_number: string | null;
      car_type: 'sedan' | 'mini' | 'large' | null;
      order_note: string | null;
      placed_by: string;
      placed_at: number;
      follow_up: boolean;
      cancelled: boolean;
      cancelled_at: number | null;
      billed: boolean;
      billed_at: number | null;
      day_closed_at: number | null;
      sent_after_reconnect: boolean;
      has_phone: boolean;
      lines: LineView[];
    }>();
    expectTypeOf<SeatingTotals>().toEqualTypeOf<(db: Database.Database, seating_id: string) => { total_minor: number; order_count: number }>();
    expectTypeOf<OrderLines>().toEqualTypeOf<(db: Database.Database, order_ids: readonly string[]) => Map<string, LineView[]>>();
    expectTypeOf<OrdersOf>().toEqualTypeOf<(db: Database.Database, seating_id: string) => OrderView[]>();
    expectTypeOf<LineShares>().toEqualTypeOf<
      (line: {
        refundable_minor: number;
        units: number;
        comped_units: number;
        removed_units: number;
        voided_units: number;
        comp_minor: number;
      }) => { next_share_minor(n: number): number; comped_take_back_minor(n: number): number }
    >();
    expectTypeOf<LineChangeDrafts>().toEqualTypeOf<
      (tx: WriterTx, order_id: string, changes: { order_item_id: string; units_out: number }[]) => EventDraft[]
    >();
    expectTypeOf<FoodDrafts>().toEqualTypeOf<(order_id: string, lines: readonly LineView[], after: 'served' | 'change' | 'return') => EventDraft[]>();
    expectTypeOf<ZoneAlertDrafts>().toEqualTypeOf<
      (ctx: CommandCtx, changes: { zone_id: string; item_id: string; before: number; after: number }[]) => EventDraft[]
    >();
    expectTypeOf<BuildSubmit>().toEqualTypeOf<
      (config: BranchConfig, input: SubmitInput) => { proposed: ProposedOrder; itemAdded: ItemAddedPayload[]; zoneCandidates: string[] }
    >();
    // §6.1 SubmitOrder payload.
    expectTypeOf<SubmitInput>().toEqualTypeOf<{
      order_id: string;
      order_type: 'dine_in' | 'takeaway' | 'parking';
      table_id?: string;
      seating_id?: string;
      takeaway?: { customer_name?: string; phone?: string };
      parking?: { car_number: string; car_type: 'sedan' | 'mini' | 'large'; phone?: string };
      order_note?: string;
      lines: Array<{
        order_item_id: string;
        item_id?: string;
        deal_id?: string;
        variant_id?: string;
        quantity?: number;
        options?: Array<{ option_id: string; quantity: number; order_item_id?: string }>;
        deal_choices?: Array<{
          deal_part_id: string;
          item_id: string;
          order_item_id: string;
          options?: Array<{ option_id: string; quantity: number; order_item_id?: string }>;
        }>;
        kitchen_note?: string;
        from_zone?: boolean;
      }>;
    }>();
    // index.ts entry points.
    expectTypeOf(orders.registerOrders).parameters.toEqualTypeOf<[TestHub['app'], TestHub['deps']]>();
    expectTypeOf(orders.registerOrders).returns.toEqualTypeOf<void>();
    expectTypeOf(orders.registerOrdersProjection).parameters.toEqualTypeOf<[TestHub['deps']['projections']]>();
    expectTypeOf(orders.registerOrdersProjection).returns.toEqualTypeOf<void>();
  });
});

describe('[02b §4.2] wiring skeleton', () => {
  let hub: TestHub | undefined;
  afterEach(async () => {
    await hub?.close();
    hub = undefined;
  });

  it('[02b §4.2] buildHubServer calls registerOrders once with its app and deps', async () => {
    hub = await createTestHub();
    expect(orders.registerOrders).toHaveBeenCalledTimes(1);
    const [app, deps] = vi.mocked(orders.registerOrders).mock.calls[0] ?? [];
    expect(app === hub.app).toBe(true); // identity: a deep compare walks Fastify's address getter
    expect(deps === hub.deps).toBe(true);
  });
});
