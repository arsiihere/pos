import type { DeviceType } from '@pos/domain';
import { openSession, pairDevice, type DeviceProfileInput, type TestHub } from './test-hub';

// 05a plan task 13 (§3 B4): pair a device the way a real one is paired, by request (POST /pair/requests -> admin
// approves -> the device polls GET /pair/requests/:id), instead of through a pairing token. Tests that need only a
// paired device use this so they survive the removal of the token pairing routes (task 15).
//
// Needs a seeded directory with S_OWNER (the approving admin). 05a §6.3 (task 15): every device type is approved;
// a staff device's `profile` goes in the approve payload (approve writes its DeviceProfileSet). Without `profile` a
// staff device gets the §6.3 form default for its hardware: `cashier_kiosk` → everyone, takeaway + cashier +
// manager; `tablet` → everyone, dine_in + manager; `phone` → listed [S_OWNER], dine_in.
// Each call also adds one admin tablet device row (the approver) and an admin session; count devices accordingly.

let nextIp = 1;

export interface PairedByRequest {
  deviceId: string;
  token: string;
  /** The approved poll body (`status`, `device_id`, `device_token`, `device_type`, `station_id`, `branch_name`, ...). */
  poll: Record<string, unknown>;
}

export async function pairByRequest(
  h: TestHub,
  o: {
    device_type: DeviceType;
    hardware_hint?: 'tablet' | 'cashier_kiosk' | 'kds' | 'phone';
    profile?: DeviceProfileInput;
    /** kds only; the caller registers the station validator. */
    station_id?: string;
    device_name?: string;
  },
): Promise<PairedByRequest> {
  // A fresh address per call keeps clear of the per-IP pending cap.
  const remoteAddress = `10.77.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`;
  nextIp += 1;
  const created = await h.app.inject({
    method: 'POST',
    url: '/pair/requests',
    remoteAddress,
    payload: { device_name: o.device_name ?? o.device_type, ...(o.hardware_hint === undefined ? {} : { hardware_hint: o.hardware_hint }) },
  });
  if (created.statusCode !== 200) throw new Error(`pairByRequest: POST /pair/requests -> ${created.statusCode} ${created.body}`);
  const request = created.json().data as { request_id: string; display_code: string; poll_secret: string };

  const admin = pairDevice(h, { type: 'tablet' });
  const session = openSession(h, { kind: 'admin', staffId: 'S_OWNER', deviceId: admin.deviceId });
  const approved = await h.app.inject({
    method: 'POST',
    url: '/admin/commands/approve-pairing-request',
    headers: { authorization: `Bearer ${admin.token}`, 'x-admin-session': session.token },
    payload: {
      command_id: `cmd-pair-by-request-${request.request_id}`,
      tenant_id: 'tenant-a',
      branch_id: 'branch-1',
      command_type: 'ApprovePairingRequest',
      payload: {
        request_id: request.request_id,
        display_code: request.display_code,
        device_type: o.device_type,
        device_name: o.device_name ?? o.device_type,
        ...(o.station_id === undefined ? {} : { station_id: o.station_id }),
        ...(o.device_type === 'kds' ? {} : profilePayload(o.profile ?? FORM_DEFAULT[o.device_type])),
      },
      occurred_at: h.clock.branchNow(),
      actor_id: 'S_OWNER',
      device_id: admin.deviceId,
    },
  });
  if (approved.statusCode !== 200) throw new Error(`pairByRequest: approve -> ${approved.statusCode} ${approved.body}`);

  const polled = await h.app.inject({
    method: 'GET',
    url: `/pair/requests/${request.request_id}`,
    headers: { 'x-poll-secret': request.poll_secret },
  });
  const body = polled.json().data as Record<string, unknown>;
  if (polled.statusCode !== 200 || body.status !== 'approved') throw new Error(`pairByRequest: poll -> ${polled.statusCode} ${polled.body}`);
  const deviceId = body.device_id as string;
  return { deviceId, token: body.device_token as string, poll: body };
}

const FORM_DEFAULT: Record<Exclude<DeviceType, 'kds'>, DeviceProfileInput> = {
  cashier_kiosk: { access: 'everyone', screens: ['takeaway', 'cashier', 'manager'] },
  tablet: { access: 'everyone', screens: ['dine_in', 'manager'] },
  phone: { access: 'listed', staff_ids: ['S_OWNER'], screens: ['dine_in'] },
};

function profilePayload(p: DeviceProfileInput): Record<string, unknown> {
  return {
    access: p.access,
    screens: p.screens,
    ...(p.access === 'listed' ? { staff_ids: p.staff_ids } : {}),
    ...(p.point_id === undefined || p.point_id === null ? {} : { point_id: p.point_id }),
  };
}
