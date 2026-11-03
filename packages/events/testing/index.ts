import type { BranchConfig, ConfigItem } from '../src/config.js';
import type { PosEvent } from '../src/envelope.js';

const T = 1_761_000_000_000;

const envelope = {
  event_id: '01J00000000000000000000001',
  tenant_id: '01J00000000000000000000002',
  branch_id: '01J00000000000000000000003',
  schema_version: 1,
  occurred_at: T,
  recorded_at: T,
  actor_id: null,
  device_id: 'hub',
  seq: 1,
} as const;

type Overrides = Partial<Omit<PosEvent, 'payload'>> & { payload?: Record<string, unknown> };

function build(event: PosEvent, overrides?: Overrides): PosEvent {
  const { payload, ...rest } = overrides ?? {};
  return {
    ...event,
    ...rest,
    payload: { ...event.payload, ...payload },
  };
}

function hub(eventType: string, streamId: string, payload: Record<string, unknown>): PosEvent {
  return { ...envelope, stream_type: 'hub', stream_id: streamId, event_type: eventType, payload };
}

export function aHubProvisioned(overrides?: Overrides): PosEvent {
  return build(
    hub('HubProvisioned', envelope.branch_id, {
      tenant_id: envelope.tenant_id,
      branch_id: envelope.branch_id,
      hub_version: '0.0.0',
    }),
    overrides,
  );
}

export function aHubStarted(overrides?: Overrides): PosEvent {
  return build(
    hub('HubStarted', envelope.branch_id, {
      hub_down_at: null,
      hub_up_at: T,
      events_replayed: 0,
      missed_fires: 0,
      boot_ms: 1,
    }),
    overrides,
  );
}

export function aClockAlarm(overrides?: Overrides): PosEvent {
  return build(
    hub('ClockAlarm', envelope.branch_id, {
      wall_ms: T,
      last_recorded_at: T - 1,
      delta_ms: 1,
      source: 'boot',
    }),
    overrides,
  );
}

export function aStaffDirectoryApplied(overrides?: Overrides): PosEvent {
  return build(
    hub('StaffDirectoryApplied', envelope.branch_id, {
      directory_version: 1,
      staff_count: 0,
      role_count: 0,
      removed_staff_ids: [],
      credentials_changed_staff_ids: [],
      skipped: [],
    }),
    overrides,
  );
}

export function aAdminBootstrapTokenIssued(overrides?: Overrides): PosEvent {
  return build(
    hub('AdminBootstrapTokenIssued', envelope.branch_id, {
      bootstrap_token_id: '01J00000000000000000000008',
      expires_at: T + 1_800_000,
      issued_by: 'setup',
    }),
    overrides,
  );
}

export function aDevicePairingTokenGenerated(overrides?: Overrides): PosEvent {
  const pairingTokenId = '01J00000000000000000000008';
  return build(
    hub('DevicePairingTokenGenerated', pairingTokenId, {
      pairing_token_id: pairingTokenId,
      device_type: 'tablet',
      owner_staff_id: null,
      expires_at: T + 600_000,
    }),
    overrides,
  );
}

export function aDevicePaired(overrides?: Overrides): PosEvent {
  const deviceId = '01J00000000000000000000005';
  return build(
    hub('DevicePaired', deviceId, {
      device_id: deviceId,
      device_name: 'Till',
      device_type: 'tablet',
      station_id: null,
      owner_staff_id: null,
      pairing_token_id: '01J00000000000000000000008',
      pairing_request_id: null,
    }),
    overrides,
  );
}

export function aDeviceTokenRotated(overrides?: Overrides): PosEvent {
  const deviceId = '01J00000000000000000000005';
  return build(
    hub('DeviceTokenRotated', deviceId, {
      device_id: deviceId,
      pair_request_id: '01J00000000000000000000009',
    }),
    overrides,
  );
}

export function aDeviceRevoked(overrides?: Overrides): PosEvent {
  const deviceId = '01J00000000000000000000005';
  return build(
    hub('DeviceRevoked', deviceId, {
      device_id: deviceId,
      reason: null,
      cause: 'manual',
    }),
    overrides,
  );
}

export function aDevicePinLockedOut(overrides?: Overrides): PosEvent {
  const deviceId = '01J00000000000000000000005';
  return build(
    hub('DevicePinLockedOut', deviceId, {
      subject_type: 'device',
      subject_id: deviceId,
      locked_until: T + 900_000,
      failed_count: 5,
    }),
    overrides,
  );
}

export function aSessionStarted(overrides?: Overrides): PosEvent {
  const staffId = '01J00000000000000000000004';
  return build(
    {
      ...envelope,
      stream_type: 'staff',
      stream_id: staffId,
      event_type: 'SessionStarted',
      payload: {
        session_id: '01J00000000000000000000006',
        kind: 'staff',
        staff_id: staffId,
        station_id: null,
        device_id: '01J00000000000000000000005',
        idle_ttl_ms: 300_000,
      },
    },
    overrides,
  );
}

export function aSessionEnded(overrides?: Overrides): PosEvent {
  const staffId = '01J00000000000000000000004';
  return build(
    {
      ...envelope,
      stream_type: 'staff',
      stream_id: staffId,
      event_type: 'SessionEnded',
      payload: {
        session_id: '01J00000000000000000000006',
        kind: 'staff',
        staff_id: staffId,
        station_id: null,
        reason: 'logout',
        ended_by: null,
      },
    },
    overrides,
  );
}

export function aStaffPinLockedOut(overrides?: Overrides): PosEvent {
  const staffId = '01J00000000000000000000004';
  return build(
    {
      ...envelope,
      stream_type: 'staff',
      stream_id: staffId,
      event_type: 'StaffPinLockedOut',
      payload: {
        staff_id: staffId,
        locked_until: T + 900_000,
        failed_count: 5,
      },
    },
    overrides,
  );
}

export function aPinLockoutCleared(overrides?: Overrides): PosEvent {
  const staffId = '01J00000000000000000000004';
  return build(
    {
      ...envelope,
      stream_type: 'staff',
      stream_id: staffId,
      event_type: 'PinLockoutCleared',
      payload: { subject_type: 'staff', subject_id: staffId },
    },
    overrides,
  );
}

function stock(eventType: string, itemId: string, payload: Record<string, unknown>): PosEvent {
  return { ...envelope, stream_type: 'stock', stream_id: itemId, event_type: eventType, payload };
}

export function aBranchConfigApplied(overrides?: Overrides): PosEvent {
  return build(
    hub('BranchConfigApplied', envelope.branch_id, {
      config_version: 1,
      snapshot_schema_version: 1,
      snapshot_hash: 'a'.repeat(64),
      previous_config_version: null,
    }),
    overrides,
  );
}

export function aStockSet(overrides?: Overrides): PosEvent {
  return build(
    { ...stock('StockSet', 'I1', { stock_item_id: 'I1', on_hand: 10, unit: 'piece' }), schema_version: 2 },
    overrides,
  );
}

export function aStockAdded(overrides?: Overrides): PosEvent {
  return build(
    { ...stock('StockAdded', 'I1', { stock_item_id: 'I1', quantity: 5, unit: 'piece' }), schema_version: 2 },
    overrides,
  );
}

export function aBusinessDayOpened(overrides?: Overrides): PosEvent {
  return build(
    {
      // 01c §5.3 row 3: 01a's I1 (pieces) and I3 (250 g per piece), each its own stock item (V5).
      ...hub('BusinessDayOpened', envelope.branch_id, {
        business_date: '2025-10-20',
        stock_units: { I1: 'piece', I3: 'g' },
        draws: {
          I1: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }] },
          I3: { sale_unit: 'piece', stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }] },
        },
      }),
      schema_version: 2,
    },
    overrides,
  );
}

export function aBusinessDayClosed(overrides?: Overrides): PosEvent {
  return build(hub('BusinessDayClosed', envelope.branch_id, {}), overrides);
}

export function anItemMadeUnavailable(overrides?: Overrides): PosEvent {
  return build(stock('ItemMadeUnavailable', 'I1', { item_id: 'I1' }), overrides);
}

export function anItemMadeAvailable(overrides?: Overrides): PosEvent {
  return build(stock('ItemMadeAvailable', 'I1', { item_id: 'I1' }), overrides);
}

// 01d §4.2: a test_alert on the hub subject (hub / branch_id) to one person; request events use the same alert.
const ALERT_ID = '01J00000000000000000000010';
const ALERT_STAFF_ID = '01J00000000000000000000004';

export function anAlertRaised(overrides?: Overrides): PosEvent {
  return build(
    hub('AlertRaised', envelope.branch_id, {
      alert_id: ALERT_ID,
      kind: 'test_alert',
      family: 'info',
      subject_stream_type: 'hub',
      subject_stream_id: envelope.branch_id,
      dedupe_key: 'test:01J00000000000000000000011',
      requester_staff_id: null,
      target: { kind: 'person', staff_id: ALERT_STAFF_ID },
      values: {},
      display: { kind_label_key: 'alert.test_alert.lock' },
      details: null,
      hidden_from: null,
      request: null,
    }),
    overrides,
  );
}

export function anAttemptSent(overrides?: Overrides): PosEvent {
  return build(
    hub('AttemptSent', envelope.branch_id, {
      alert_id: ALERT_ID,
      step: 0,
      recipients: [{ staff_id: ALERT_STAFF_ID, device_id: null, for_staff_id: null, set: 'recipient' }],
      routes: [{ staff_id: ALERT_STAFF_ID, route: 'screen', ref: '01J00000000000000000000006' }],
    }),
    overrides,
  );
}

export function aRequestAnswered(overrides?: Overrides): PosEvent {
  return build(
    hub('RequestAnswered', envelope.branch_id, {
      alert_id: ALERT_ID,
      decision: 'approve',
      answerer_staff_id: ALERT_STAFF_ID,
      method: 'pin',
      device_id: '01J00000000000000000000005',
      on_requester_device: false,
    }),
    overrides,
  );
}

export function anAlertClosed(overrides?: Overrides): PosEvent {
  return build(
    hub('AlertClosed', envelope.branch_id, {
      alert_id: ALERT_ID,
      reason: 'done',
      by_staff_id: null,
      note: null,
    }),
    overrides,
  );
}

export function aPresenceSet(overrides?: Overrides): PosEvent {
  return build(
    {
      ...envelope,
      stream_type: 'staff',
      stream_id: envelope.branch_id,
      event_type: 'PresenceSet',
      payload: {
        business_day_id: '01J00000000000000000000012',
        staff_ids: [ALERT_STAFF_ID],
        present: true,
        set_by: ALERT_STAFF_ID,
      },
    },
    overrides,
  );
}

function configItem(itemId: string, name: string, sortOrder: number, o: Partial<ConfigItem>): ConfigItem {
  return {
    item_id: itemId,
    category_id: 'C1',
    variant_group_id: null,
    variant_name: null,
    name,
    description: null,
    sort_order: sortOrder,
    price_minor: 120_000,
    tax_class_id: null,
    serve_mode: 'sync',
    prep_buffer_ms: 0,
    cook_time_ms: 1_200_000,
    stock_time_ms: null,
    out_of_stock_behaviour: 'cook_fresh',
    sale_unit: 'piece',
    requires_weighing: false,
    stock_draws: [],
    availability_windows: [],
    station_id: 'S1',
    program_id: null,
    stock_program_id: null,
    modifier_group_ids: [],
    ...o,
  };
}

// 01c §4.6: slot station "Karahi"; stock item K1 "Karahi pot" counted in g
// there; Half I1 draws 500 g, Full I3 draws 1 000 g (variant group V1);
// I2 is not stock-tracked.
export function aBranchConfig(overrides?: Partial<BranchConfig>): BranchConfig {
  return {
    snapshot_schema_version: 2,
    config_version: 1,
    branch_id: envelope.branch_id,
    currency_code: 'PKR',
    tax_enabled: false,
    day_stale_after_hours: 16,
    day_min_gap_hours: 4,
    floors: [],
    stations: [
      {
        station_id: 'S1',
        name: 'Karahi',
        location_label: null,
        station_type: 'slot',
        capacity: 4,
        freshness_window_ms: null,
        completion_mode: 'two_tap',
        is_archived: false,
        programs: [],
      },
    ],
    tax_classes: [],
    categories: [{ category_id: 'C1', name: 'Karahi', sort_order: 1, availability_windows: [] }],
    variant_groups: [
      { variant_group_id: 'V1', category_id: 'C1', name: 'Chicken Karahi', description: null, sort_order: 1 },
    ],
    stock_items: [
      {
        stock_item_id: 'K1',
        name: 'Karahi pot',
        stock_unit: 'g',
        carries_over: false,
        station_id: 'S1',
        low_stock_threshold: null,
      },
    ],
    modifier_groups: [],
    items: [
      configItem('I1', 'Chicken Karahi — Half', 1, {
        variant_group_id: 'V1',
        variant_name: 'Half',
        stock_time_ms: 300_000,
        stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 500 }],
      }),
      configItem('I2', 'Mutton Karahi', 2, {}),
      configItem('I3', 'Chicken Karahi — Full', 3, {
        variant_group_id: 'V1',
        variant_name: 'Full',
        stock_time_ms: 300_000,
        stock_draws: [{ stock_item_id: 'K1', quantity_per_sale_unit: 1_000 }],
      }),
    ],
    deals: [],
    ...overrides,
  };
}

// 01a's per-item stock fixture in schema 2 (01c §5.1 backfill rule: a tracked item becomes a stock item with
// the same id, counted at its route station, with one draw): slot station "Karahi"; I1 (pieces, 1 per sale)
// and I3 (g, 250 g per piece) are stock items; I2 is not stock-tracked. No variant groups.
export function aBranchConfigItemStock(overrides?: Partial<BranchConfig>): BranchConfig {
  const base = aBranchConfig();
  return {
    ...base,
    variant_groups: [],
    stock_items: [
      { stock_item_id: 'I1', name: 'Chicken Karahi', stock_unit: 'piece', carries_over: false, station_id: 'S1', low_stock_threshold: null },
      { stock_item_id: 'I3', name: 'Chicken Karahi — Half', stock_unit: 'g', carries_over: false, station_id: 'S1', low_stock_threshold: null },
    ],
    items: [
      configItem('I1', 'Chicken Karahi', 1, {
        stock_time_ms: 300_000,
        stock_draws: [{ stock_item_id: 'I1', quantity_per_sale_unit: 1 }],
      }),
      configItem('I2', 'Mutton Karahi', 2, {}),
      configItem('I3', 'Chicken Karahi — Half', 3, {
        stock_time_ms: 300_000,
        stock_draws: [{ stock_item_id: 'I3', quantity_per_sale_unit: 250 }],
      }),
    ],
    ...overrides,
  };
}

// 03a §4.2: order-stream events (order / order_id). One dine-in order O1 at table T12 with one sync
// line L1 (Mutton Karahi I2, slot station S1, 20 min) in group O1:0; promise = target + 180 000 padding.
const ORDER_ID = 'O1';
const ORDER_TARGET = T + 1_500_000;
const PADDING_MS = 180_000;
// 01a v2.1 §5.2a item knob default; the `fix` cook time of a return (§3.8a).
const ADJUST_TIME_MS = 180_000;

function order(eventType: string, orderId: string, payload: Record<string, unknown>): PosEvent {
  return { ...envelope, stream_type: 'order', stream_id: orderId, event_type: eventType, payload };
}

function engineLine(orderItemId: string, o?: Record<string, unknown>): Record<string, unknown> {
  return {
    order_item_id: orderItemId,
    station_id: 'S1',
    alternates: [],
    point_id: null,
    carry_ms: 0,
    from_stock: false,
    weight_pct: 100,
    max_early_ms: 60_000,
    max_late_ms: null,
    max_carry_ms: null,
    ...o,
  };
}

function itemAddedPayload(orderId: string, orderItemId: string, o?: Record<string, unknown>): Record<string, unknown> {
  return {
    order_id: orderId,
    order_item_id: orderItemId,
    parent_order_item_id: null,
    line_kind: 'item',
    item_id: 'I2',
    deal_id: null,
    deal_part_id: null,
    option_id: null,
    option_quantity: null,
    variant_group_id: null,
    variant_group_name: null,
    variant_name: null,
    name: 'Mutton Karahi',
    category_id: 'C1',
    requires_weighing: false,
    quantity: 1,
    sale_unit: 'piece',
    price_minor: 120_000,
    extra_price_minor: null,
    allocated_price_minor: null,
    tax_class_id: null,
    station_id: 'S1',
    program_id: null,
    stock_program_id: null,
    program_cook_time_ms: null,
    stock_program_cook_time_ms: null,
    serve_mode: 'sync',
    prep_buffer_ms: 0,
    cook_time_ms: 1_200_000,
    stock_time_ms: null,
    out_of_stock_behaviour: 'cook_fresh',
    stock_draws: [],
    options: [],
    line_total_minor: 120_000,
    kitchen_note: null,
    ...o,
  };
}

function orderPlacedPayload(orderId: string, lineIds: string[], lines?: Record<string, unknown>[]): Record<string, unknown> {
  return {
    order_id: orderId,
    order_type: 'dine_in',
    table_id: 'T12',
    table_key: 'dine_in:T12',
    follow_up: false,
    pickup_at_ms: null,
    order_item_ids: lineIds,
    groups: [{ group_id: `${orderId}:0`, target_land_ms: ORDER_TARGET, promise_ms: ORDER_TARGET + PADDING_MS, order_item_ids: lineIds }],
    lines: lines ?? lineIds.map((id) => engineLine(id)),
  };
}

export function anOrderPlaced(overrides?: Overrides): PosEvent {
  return build(order('OrderPlaced', ORDER_ID, orderPlacedPayload(ORDER_ID, ['L1'])), overrides);
}

export function anItemAdded(overrides?: Overrides): PosEvent {
  return build(order('ItemAdded', ORDER_ID, itemAddedPayload(ORDER_ID, 'L1')), overrides);
}

// A later addition (P-10): line L2 in a new group O1:1.
export function anOrderLinesAdded(overrides?: Overrides): PosEvent {
  return build(
    order('OrderLinesAdded', ORDER_ID, {
      order_id: ORDER_ID,
      order_item_ids: ['L2'],
      groups: [{ group_id: `${ORDER_ID}:1`, target_land_ms: ORDER_TARGET, promise_ms: ORDER_TARGET + PADDING_MS, order_item_ids: ['L2'] }],
      lines: [engineLine('L2', { return_of: null, cook_ms_override: null })],
    }),
    overrides,
  );
}

export interface ReturnOptions {
  /** the return line's order_item_id; default `<served>R` */
  order_item_id?: string;
  /** the item's 01a v2.1 adjust_time_ms (D25 copy by 02); default 180 000; used for `fix` only */
  adjust_time_ms?: number;
  /** index of the new group (`order_id:<n>`); default 1 */
  group_index?: number;
  target_land_ms?: number;
  promise_ms?: number;
  /** engine-field overrides of the OrderLinesAdded line (e.g. the served line's engine station, alternates) */
  line?: Record<string, unknown>;
  recorded_at?: number;
  actor_id?: string | null;
}

// 03a §3.8a (D28; v0.5 G4-1 #11, v0.6 G4-2 #18): what 02's ReturnToKitchen appends for a served line,
// given that line's ItemAdded. One batch, one recorded_at: OrderLinesAdded with one new line, its
// ItemAdded (the served line's D25 copy minus money, a plain 'item' line, whole quantity), and
// ItemReturned for `remake`.
export function aReturnLinesAdded(served: PosEvent, mode: 'fix' | 'remake', o: ReturnOptions = {}): PosEvent[] {
  const s = served.payload;
  const orderId = String(s.order_id);
  const servedId = String(s.order_item_id);
  const newId = o.order_item_id ?? `${servedId}R`;
  const target = o.target_land_ms ?? ORDER_TARGET;
  const stamp = {
    recorded_at: o.recorded_at ?? served.recorded_at,
    occurred_at: o.recorded_at ?? served.recorded_at,
    actor_id: o.actor_id ?? served.actor_id,
  };
  const linesAdded = order('OrderLinesAdded', orderId, {
    order_id: orderId,
    order_item_ids: [newId],
    groups: [
      {
        group_id: `${orderId}:${o.group_index ?? 1}`,
        target_land_ms: target,
        promise_ms: o.promise_ms ?? target + PADDING_MS,
        order_item_ids: [newId],
      },
    ],
    lines: [
      engineLine(newId, {
        station_id: s.station_id,
        ...o.line,
        from_stock: false,
        return_of: { order_item_id: servedId, mode },
        cook_ms_override: mode === 'fix' ? (o.adjust_time_ms ?? ADJUST_TIME_MS) : null,
      }),
    ],
  });
  const added = order('ItemAdded', orderId, {
    ...s,
    order_item_id: newId,
    line_kind: 'item',
    parent_order_item_id: null,
    deal_id: null,
    deal_part_id: null,
    option_id: null,
    option_quantity: null,
    options: [],
    price_minor: 0,
    extra_price_minor: null,
    allocated_price_minor: null,
    line_total_minor: 0,
    tax_class_id: null,
  });
  const events = [linesAdded, added];
  if (mode === 'remake') {
    events.push(order('ItemReturned', orderId, { order_item_id: servedId, mode: 'remake', replacement_order_item_id: newId }));
  }
  return events.map((e, i) => ({ ...e, ...stamp, seq: served.seq + 1 + i, event_id: eventId(served.seq + 1 + i) }));
}

export function anItemStarted(overrides?: Overrides): PosEvent {
  return build(order('ItemStarted', ORDER_ID, { order_item_id: 'L1', started_at: T, source: 'tap' }), overrides);
}

export function anItemDone(overrides?: Overrides): PosEvent {
  return build(order('ItemDone', ORDER_ID, { order_item_id: 'L1', done_at: T + 1_200_000, source: 'tap' }), overrides);
}

function eventId(seq: number): string {
  return `01J${String(seq).padStart(23, '0')}`;
}

export interface OrderBatchSpec {
  order_id?: string;
  /** the lines in order_item_ids order; default one line L1 */
  lines?: Array<{
    order_item_id: string;
    /** ItemAdded payload overrides */
    item?: Record<string, unknown>;
    /** OrderPlaced.lines[] engine-field overrides */
    line?: Record<string, unknown>;
  }>;
  /** OrderPlaced payload overrides (order fields, groups) */
  order?: Record<string, unknown>;
  recorded_at?: number;
  actor_id?: string | null;
  /** seq of the first event; default 1 */
  seq?: number;
  /**
   * Events appended after the ItemAdded rows with the same recorded_at (e.g. the §4.2 StockReserved
   * rows, whose builder is task 1b's); their payloads are kept, their envelope is re-stamped.
   */
  then?: PosEvent[];
}

// 03a §4.2 submit batch: OrderPlaced, then ItemAdded in order_item_ids order, then (via `then`) the
// StockReserved rows; one recorded_at; placed_by = actor_id, placed_at = recorded_at (§3.3).
export function anOrderBatch(spec: OrderBatchSpec = {}): PosEvent[] {
  const orderId = spec.order_id ?? ORDER_ID;
  const lines = spec.lines ?? [{ order_item_id: 'L1' }];
  const ids = lines.map((l) => l.order_item_id);
  const at = spec.recorded_at ?? T;
  const first = spec.seq ?? 1;
  const placed = order('OrderPlaced', orderId, {
    ...orderPlacedPayload(
      orderId,
      ids,
      lines.map((l) => engineLine(l.order_item_id, l.line)),
    ),
    ...spec.order,
  });
  const added = lines.map((l) => order('ItemAdded', orderId, itemAddedPayload(orderId, l.order_item_id, l.item)));
  return [placed, ...added, ...(spec.then ?? [])].map((e, i) => ({
    ...e,
    recorded_at: at,
    occurred_at: at,
    actor_id: spec.actor_id ?? null,
    seq: first + i,
    event_id: eventId(first + i),
  }));
}
