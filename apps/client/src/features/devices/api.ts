import type { DeviceType, ScreenKey } from '@pos/domain';
import type { HubResult } from '../../api/hub-admin';
import { newUlid } from '../../app/ulid';
import type { StaffApi } from '../staff/api';

// 05a §6.3, §6.4, §6.8, §8 (tasks 31, 32): the hub client of the staff `#/devices` page. The shapes are the spec's; the hub
// side is built by other lanes. Reads and commands go through the shell's staff api (the device token and the
// staff session); the page never builds its own fetch.

export interface DevicePerson {
  staff_id: string;
  display_name: string;
}

/** §6.8: one row of `GET /queries/devices` (only the fields this page reads). */
export interface DeviceRow {
  device_id: string;
  device_name: string;
  device_type: DeviceType;
  revoked_at: number | null;
  access: 'everyone' | 'listed' | null;
  people: DevicePerson[];
  screens: ScreenKey[];
  point_id: string | null;
  profile_version: number;
  needs_review: boolean;
}

/** §6.8: a request waiting for approval (never the code). */
export interface PendingRequest {
  request_id: string;
  device_name: string;
  hardware_hint: DeviceType | null;
  created_at: number;
}

export interface DevicesData {
  devices: DeviceRow[];
  pending_requests: PendingRequest[];
  /** M-8: the count when it is 0 or 1, else null */
  admin_warning: 0 | 1 | null;
}

/** §6.3 payload. `kds` ⇒ `station_id` and nothing else; a staff device ⇒ `access` and `screens`. */
export interface ApprovePayload {
  request_id?: string;
  display_code: string;
  device_type: DeviceType;
  device_name: string;
  station_id?: string;
  access?: 'everyone' | 'listed';
  staff_ids?: string[];
  screens?: ScreenKey[];
  point_id?: string;
}

/** §6.4 payload: unsent fields are kept. */
export interface SetProfilePayload {
  device_id: string;
  expected_version: number;
  device_name?: string;
  access?: 'everyone' | 'listed';
  staff_ids?: string[];
  screens?: ScreenKey[];
  point_id?: string;
}

export interface PickPerson {
  staff_id: string;
  display_name: string;
}

export interface PickPoint {
  point_id: string;
  name: string;
}

export interface PickStation {
  station_id: string;
  name: string;
}

interface BranchConfigReply {
  snapshot?: {
    points?: Array<PickPoint & { is_archived?: boolean }>;
    stations?: Array<PickStation & { is_archived?: boolean }>;
  };
}

export function createDevicesApi(staff: Pick<StaffApi, 'query' | 'command'>) {
  return {
    devices: () => staff.query<DevicesData>('/queries/devices'),
    approve: (payload: ApprovePayload, commandId: string) =>
      staff.command<{ device_id: string; device_type: DeviceType; screens: ScreenKey[]; access: string }>('ApprovePairingRequest', payload, { commandId }),
    setProfile: (payload: SetProfilePayload, commandId: string) =>
      staff.command<{ device_id: string; profile_version: number }>('SetDeviceProfile', payload, { commandId }),
    revoke: (deviceId: string, commandId: string) => staff.command<unknown>('RevokeDevice', { device_id: deviceId }, { commandId }),
    /**
     * The people to pick from. Assumption (spec §6.3 names no query for it): the staff roster, as the sign-in screen
     * reads it; the forms add the people a device already lists.
     */
    people: async (): Promise<HubResult<PickPerson[]>> => {
      const answer = await staff.query<{ staff: PickPerson[] }>('/queries/staff-roster');
      return answer.ok ? { ok: true, data: answer.data.staff.map((s) => ({ staff_id: s.staff_id, display_name: s.display_name })) } : answer;
    },
    /** Points and stations come from the branch-config snapshot a staff session may read (00 §6.23). */
    places: async (): Promise<HubResult<{ points: PickPoint[]; stations: PickStation[] }>> => {
      const answer = await staff.query<BranchConfigReply | null>('/queries/branch-config');
      if (!answer.ok) return answer;
      const snap = answer.data?.snapshot;
      return {
        ok: true,
        data: {
          points: (snap?.points ?? []).filter((p) => p.is_archived !== true).map((p) => ({ point_id: p.point_id, name: p.name })),
          stations: (snap?.stations ?? []).filter((s) => s.is_archived !== true).map((s) => ({ station_id: s.station_id, name: s.name })),
        },
      };
    },
    newCommandId: () => newUlid(),
  };
}

export type DevicesApi = ReturnType<typeof createDevicesApi>;
