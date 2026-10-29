import type { BranchConfig, BranchConfigV1, ConfigItem, ConfigItemV1 } from '../src/config.js';
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
    hub('BusinessDayOpened', envelope.branch_id, {
      business_date: '2025-10-20',
      units: {
        I1: { stock_unit: 'piece', sale_unit: 'piece', stock_per_sale_unit: 1 },
        I3: { stock_unit: 'g', sale_unit: 'piece', stock_per_sale_unit: 250 },
      },
    }),
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

function configItemV1(itemId: string, name: string, sortOrder: number, o: Partial<ConfigItemV1>): ConfigItemV1 {
  return {
    item_id: itemId,
    category_id: 'C1',
    name,
    group_label: null,
    description: null,
    sort_order: sortOrder,
    price_minor: 120_000,
    tax_class_id: null,
    serve_mode: 'sync',
    prep_buffer_ms: 0,
    cook_time_ms: 1_200_000,
    stock_time_ms: null,
    out_of_stock_behaviour: 'cook_fresh',
    stock_unit: 'piece',
    sale_unit: 'piece',
    stock_per_sale_unit: 1,
    low_stock_threshold: null,
    carries_over: false,
    availability_windows: [],
    station_id: 'S1',
    program_id: null,
    stock_program_id: null,
    ...o,
  };
}

// 01a §4.3: slot station "Karahi"; I1 (pieces) and I3 (g, sold per 250 g piece)
// are stock-tracked; I2 is not. Seam (01c P-2): deleted in task 21.
export function aBranchConfigV1(overrides?: Partial<BranchConfigV1>): BranchConfigV1 {
  return {
    snapshot_schema_version: 1,
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
    items: [
      configItemV1('I1', 'Chicken Karahi', 1, { stock_time_ms: 300_000 }),
      configItemV1('I2', 'Mutton Karahi', 2, {}),
      configItemV1('I3', 'Chicken Karahi — Half', 3, {
        stock_time_ms: 300_000,
        stock_unit: 'g',
        sale_unit: 'piece',
        stock_per_sale_unit: 250,
      }),
    ],
    ...overrides,
  };
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
