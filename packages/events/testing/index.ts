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
