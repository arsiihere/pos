import { describe, expect, it } from 'vitest';
import { parseEvent } from '../src/codecs';
import { BranchConfigSnapshotSchemaV4, isStockTracked } from '../src/config';
import '../src/index';
import * as builders from './index';

const builderNames = [
  'aHubProvisioned',
  'aHubStarted',
  'aClockAlarm',
  'aStaffDirectoryApplied',
  'aAdminBootstrapTokenIssued',
  'aDevicePairingTokenGenerated',
  'aDevicePaired',
  'aDeviceTokenRotated',
  'aDeviceRevoked',
  'aDevicePinLockedOut',
  'aSessionStarted',
  'aSessionEnded',
  'aStaffPinLockedOut',
  'aPinLockoutCleared',
  'aBranchConfigApplied',
  'aStockSet',
  'aStockAdded',
  'aBusinessDayOpened',
  'aBusinessDayClosed',
  'anItemMadeUnavailable',
  'anItemMadeAvailable',
  'anAlertRaised',
  'anAttemptSent',
  'aRequestAnswered',
  'anAlertClosed',
  'aPresenceSet',
  'anOrderPlaced',
  'anItemAdded',
  'anOrderLinesAdded',
  'anItemStarted',
  'anItemDone',
  'aFireDispatched',
  'anEngineConfigApplied',
  'aStockReserved',
  'aStockReleased',
  'aStockConsumed',
] as const;

describe('builders', () => {
  it('[F §6.7] every builder output parses', () => {
    for (const name of builderNames) {
      const build = builders[name];
      expect(parseEvent(build()), name).toMatchObject({ event_type: expect.any(String) });
    }
  });

  it('[01c §4.6] aBranchConfig is a valid schema-4 snapshot: K1 in g at Karahi, Half I1 500 g, Full I3 1 000 g, I2 untracked', () => {
    const config = builders.aBranchConfig();
    expect(BranchConfigSnapshotSchemaV4.parse(config)).toEqual(config);
    expect(config.snapshot_schema_version).toBe(4);
    const karahi = config.stations.find((s) => s.name === 'Karahi');
    expect(karahi?.station_type).toBe('slot');
    expect(config.stock_items).toEqual([
      expect.objectContaining({ stock_item_id: 'K1', stock_unit: 'g', station_id: karahi?.station_id }),
    ]);
    const item = (id: string) => {
      const found = config.items.find((i) => i.item_id === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    expect(item('I1')).toMatchObject({ variant_name: 'Half', sale_unit: 'piece' });
    expect(item('I1').stock_draws).toEqual([{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }]);
    expect(item('I3')).toMatchObject({ variant_name: 'Full', sale_unit: 'piece' });
    expect(item('I3').stock_draws).toEqual([{ stock_item_id: 'K1', quantity_per_sale_unit: 1000 }]);
    expect(isStockTracked(item('I1'))).toBe(true);
    expect(isStockTracked(item('I3'))).toBe(true);
    expect(isStockTracked(item('I2'))).toBe(false);
    expect(builders.aBranchConfig({ config_version: 9 }).config_version).toBe(9);
  });

  it('[01a §4.3 V3] aBranchConfig agrees with anEngineConfigApplied: station S1 on point P1, the same settings', () => {
    const config = builders.aBranchConfig();
    const { stations, settings } = builders.anEngineConfigApplied().payload as {
      stations: Array<Record<string, unknown>>;
      settings: Record<string, unknown>;
    };
    const engine = { ...stations[0]! };
    delete engine.reference_cook_ms; // the hub derives it (03a §3.11)
    expect(config.stations[0]).toMatchObject(engine);
    expect(config.points.map((point) => point.point_id)).toEqual([engine.point_id]);
    expect(config.engine_settings).toEqual({
      ...settings,
      table_lock_ttl_ms: 600_000,
      // 01a v2.3 §5.2a (02b A-1) defaults, AD-10
      queue_auto_send_max_ms: 14_400_000,
      zone_undo_ms: 300_000,
      slow_item_threshold_ms: 900_000,
      served_estimate_ms: null,
      comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
    });
  });

  it('[01c §5.1] aBranchConfigItemStock is a valid schema-4 snapshot: stock items I1 (piece, 1) and I3 (g, 250) at Karahi, I2 untracked', () => {
    const config = builders.aBranchConfigItemStock();
    expect(BranchConfigSnapshotSchemaV4.parse(config)).toEqual(config);
    expect(config.stock_items.map((s) => [s.stock_item_id, s.stock_unit, s.station_id])).toEqual([
      ['I1', 'piece', 'S1'],
      ['I3', 'g', 'S1'],
    ]);
    const item = (id: string) => {
      const found = config.items.find((i) => i.item_id === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    expect(item('I1').stock_draws).toEqual([{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }]);
    expect(item('I3').stock_draws).toEqual([{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }]);
    expect(isStockTracked(item('I2'))).toBe(false);
    expect(builders.aBranchConfigItemStock({ config_version: 9 }).config_version).toBe(9);
  });
});

describe('order builders', () => {
  const served = () =>
    builders.anItemAdded({
      payload: {
        order_item_id: 'L7',
        line_kind: 'deal_part',
        parent_order_item_id: 'L6',
        deal_id: 'D1',
        deal_part_id: 'P1',
        quantity: 3,
        price_minor: 220_000,
        extra_price_minor: 0,
        allocated_price_minor: 229_315,
        tax_class_id: 'X1',
        options: [{ option_id: 'OP1', modifier_group_id: 'M1', name: 'Spicy', price_minor: 5_000, quantity: 1, charge_minor: 5_000 }],
        line_total_minor: 0,
      },
    });
  const child = () =>
    builders.anItemAdded({
      payload: {
        order_item_id: 'L8',
        line_kind: 'option_child',
        parent_order_item_id: 'L1',
        option_id: 'OP9',
        option_quantity: 2,
        quantity: 4,
        price_minor: 3_000,
        line_total_minor: 12_000,
      },
    });

  it('[03a §4.2] anOrderPlaced, anItemAdded and anOrderLinesAdded are order-stream events keyed by order_id', () => {
    for (const event of [builders.anOrderPlaced(), builders.anItemAdded(), builders.anOrderLinesAdded()]) {
      expect(event.stream_type, event.event_type).toBe('order');
      expect(event.stream_id, event.event_type).toBe(event.payload.order_id);
      expect(event.schema_version, event.event_type).toBe(1);
    }
    expect(builders.anOrderPlaced({ payload: { follow_up: true } }).payload.follow_up).toBe(true);
  });

  for (const mode of ['fix', 'remake'] as const) {
    it(`[03a #103 fixture] a ${mode} return line carries no money: price 0, total 0, tax class null, option charges 0`, () => {
      for (const line of [served(), child()]) {
        const events = builders.aReturnLinesAdded(line, mode).map((e) => parseEvent(e));
        const added = events.find((e) => e.event_type === 'ItemAdded');
        expect(added?.payload).toMatchObject({
          price_minor: 0,
          line_total_minor: 0,
          tax_class_id: null,
          extra_price_minor: null,
          allocated_price_minor: null,
        });
        const options = added?.payload.options as { charge_minor: number }[];
        expect(options.every((o) => o.charge_minor === 0)).toBe(true);
      }
    });

    it(`[03a #114 fixture] a ${mode} return of a deal_part and of an option_child is a plain item line with quantity copied`, () => {
      for (const line of [served(), child()]) {
        const events = builders.aReturnLinesAdded(line, mode).map((e) => parseEvent(e));
        const lines = events.find((e) => e.event_type === 'OrderLinesAdded');
        const added = events.find((e) => e.event_type === 'ItemAdded');
        const newId = added?.payload.order_item_id;
        expect(newId).not.toBe(line.payload.order_item_id);
        expect(added?.payload).toMatchObject({
          order_id: line.payload.order_id,
          line_kind: 'item',
          parent_order_item_id: null,
          deal_id: null,
          deal_part_id: null,
          option_id: null,
          option_quantity: null,
          options: [],
          quantity: line.payload.quantity,
          item_id: line.payload.item_id,
          station_id: line.payload.station_id,
          cook_time_ms: line.payload.cook_time_ms,
        });
        expect(lines?.payload).toMatchObject({ order_id: line.payload.order_id, order_item_ids: [newId] });
        const [groupOf] = lines?.payload.groups as { group_id: string; order_item_ids: string[] }[];
        expect(groupOf?.order_item_ids).toEqual([newId]);
        const [engineLine] = lines?.payload.lines as Record<string, unknown>[];
        expect(engineLine).toMatchObject({
          order_item_id: newId,
          from_stock: false,
          return_of: { order_item_id: line.payload.order_item_id, mode },
          cook_ms_override: mode === 'fix' ? 180_000 : null,
        });
        const returned = events.filter((e) => e.event_type === 'ItemReturned');
        if (mode === 'remake') {
          expect(returned.map((e) => e.payload)).toEqual([
            { order_item_id: line.payload.order_item_id, mode: 'remake', replacement_order_item_id: newId },
          ]);
        } else {
          expect(returned).toEqual([]);
        }
        expect(events.map((e) => e.event_type)).toEqual(
          mode === 'remake' ? ['OrderLinesAdded', 'ItemAdded', 'ItemReturned'] : ['OrderLinesAdded', 'ItemAdded'],
        );
        expect(new Set(events.map((e) => e.recorded_at)).size).toBe(1);
      }
    });
  }

  it('[03a §3.8a] a fix return takes the item adjust_time_ms when given; remake never sets cook_ms_override', () => {
    const fix = builders.aReturnLinesAdded(served(), 'fix', { adjust_time_ms: 240_000 });
    const [fixLine] = fix[0]!.payload.lines as { cook_ms_override: number | null }[];
    expect(fixLine?.cook_ms_override).toBe(240_000);
    const remake = builders.aReturnLinesAdded(served(), 'remake', { adjust_time_ms: 240_000 });
    const [remakeLine] = remake[0]!.payload.lines as { cook_ms_override: number | null }[];
    expect(remakeLine?.cook_ms_override).toBeNull();
  });

  it('[03a §4.2] anOrderBatch: OrderPlaced then ItemAdded in order_item_ids order, one recorded_at, extra events stamped alike', () => {
    const extra = builders.anItemStarted();
    const batch = builders.anOrderBatch({
      order_id: 'O9',
      recorded_at: 5_000,
      actor_id: 'ST1',
      lines: [{ order_item_id: 'A1' }, { order_item_id: 'A2', item: { item_id: 'I3' } }, { order_item_id: 'A3' }],
      then: [extra],
    });
    const parsed = batch.map((e) => parseEvent(e));
    expect(parsed.map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded', 'ItemAdded', 'ItemAdded', 'ItemStarted']);
    expect(new Set(parsed.map((e) => e.recorded_at))).toEqual(new Set([5_000]));
    expect(new Set(parsed.map((e) => e.event_id)).size).toBe(parsed.length);
    expect(parsed.map((e) => e.seq)).toEqual([...parsed.map((e) => e.seq)].sort((a, b) => a - b));
    expect(parsed.every((e) => e.actor_id === 'ST1')).toBe(true);
    const placed = parsed[0]!.payload as { order_item_ids: string[]; groups: { group_id: string }[]; lines: { order_item_id: string }[] };
    expect(placed.order_item_ids).toEqual(['A1', 'A2', 'A3']);
    expect(placed.lines.map((l) => l.order_item_id)).toEqual(['A1', 'A2', 'A3']);
    expect(placed.groups.map((g) => g.group_id)).toEqual(['O9:0']);
    expect(parsed.slice(1, 4).map((e) => e.payload.order_item_id)).toEqual(['A1', 'A2', 'A3']);
    expect(parsed.slice(0, 4).every((e) => e.stream_id === 'O9' && e.payload.order_id === 'O9')).toBe(true);
    expect(parsed[2]!.payload.item_id).toBe('I3');
    expect(parsed[4]!.event_type).toBe('ItemStarted');
  });

  it('[03a §4.2] anItemStarted and anItemDone default to a tap on L1', () => {
    expect(builders.anItemStarted().payload).toMatchObject({ order_item_id: 'L1', source: 'tap' });
    expect(builders.anItemDone({ payload: { source: 'inferred' } }).payload).toMatchObject({ order_item_id: 'L1', source: 'inferred' });
  });

  it('[03a §4.2] anOrderBatch emits spec.reserved as StockReserved after the ItemAdded rows and before then, one recorded_at', () => {
    const batch = builders.anOrderBatch({
      recorded_at: 7_000,
      seq: 10,
      lines: [{ order_item_id: 'A1', line: { from_stock: true } }, { order_item_id: 'A2' }],
      reserved: [{ order_item_id: 'A1' }, { stock_item_id: 'K2', order_item_id: 'A1', quantity: 2 }],
      then: [builders.anItemStarted()],
    });
    const parsed = batch.map((e) => parseEvent(e));
    expect(parsed.map((e) => e.event_type)).toEqual([
      'OrderPlaced',
      'ItemAdded',
      'ItemAdded',
      'StockReserved',
      'StockReserved',
      'ItemStarted',
    ]);
    expect(new Set(parsed.map((e) => e.recorded_at))).toEqual(new Set([7_000]));
    expect(parsed.map((e) => e.seq)).toEqual([10, 11, 12, 13, 14, 15]);
    expect(parsed[3]).toMatchObject({ stream_type: 'stock', stream_id: 'K1', payload: { stock_item_id: 'K1', order_item_id: 'A1', quantity: 500 } });
    expect(parsed[4]).toMatchObject({ stream_type: 'stock', stream_id: 'K2', payload: { stock_item_id: 'K2', order_item_id: 'A1', quantity: 2 } });
    expect(builders.anOrderBatch().map((e) => e.event_type)).toEqual(['OrderPlaced', 'ItemAdded']);
  });
});

describe('station and stock builders', () => {
  it('[03a §4.2] aFireDispatched and anEngineConfigApplied are station-stream events; stock builders are keyed by stock_item_id', () => {
    const fire = builders.aFireDispatched();
    expect(fire).toMatchObject({ stream_type: 'station', stream_id: 'S1', payload: { station_id: 'S1', reason: 'scheduled' } });
    const config = builders.anEngineConfigApplied();
    expect(config).toMatchObject({ stream_type: 'station', stream_id: config.branch_id });
    for (const e of [builders.aStockReserved(), builders.aStockReleased(), builders.aStockConsumed()]) {
      expect(e.stream_type, e.event_type).toBe('stock');
      expect(e.stream_id, e.event_type).toBe(e.payload.stock_item_id);
      expect(e.schema_version, e.event_type).toBe(1);
    }
    expect(builders.aStockReleased({ payload: { reason: 'voided' } }).payload.reason).toBe('voided');
  });

  it('[03a §3.11] anEngineConfigApplied carries the 01a v2.1 §5.2a config defaults for aBranchConfig station S1', () => {
    const { payload } = parseEvent(builders.anEngineConfigApplied());
    expect(payload.stations).toEqual([
      {
        station_id: 'S1',
        name: 'Karahi',
        station_type: 'slot',
        capacity: 4,
        freshness_window_ms: null,
        completion_mode: 'two_tap',
        policy: 'waada_guard',
        freeze_ms: 120_000,
        min_slack_keep_ms: 60_000,
        promise_padding_ms: null,
        pressure_window_ms: 900_000,
        pressure_amber_bp: 8_000,
        pressure_red_bp: 10_000,
        pressure_alert_ms: 300_000,
        pause_enabled: false,
        lane_units: null,
        reserve_units: 0,
        point_id: 'P1',
        alternates: [],
        carry_times: [],
        programs: [],
        reference_cook_ms: 1_200_000,
        is_archived: false,
      },
    ]);
    expect(payload.settings).toEqual({
      weight_dine_in_pct: 100,
      weight_takeaway_pct: 200,
      weight_delivery_pct: 200,
      weight_parking_pct: 200,
      weight_follow_up_pct: 300,
      promise_padding_dine_in_ms: 180_000,
      promise_padding_takeaway_ms: 180_000,
      promise_padding_delivery_ms: 180_000,
      promise_padding_parking_ms: 180_000,
      slip_threshold_ms: 120_000,
      slip_escalate_ms: 120_000,
      cascade_step_ms: 60_000,
      min_gain_ms: 60_000,
      returns_boost: true,
      order_abandon_ms: 14_400_000,
    });
  });
});
