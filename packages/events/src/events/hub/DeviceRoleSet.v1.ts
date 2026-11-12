import { z } from 'zod';
import { defineEvent } from '../../registry.js';

// 03b §6.22 (hub / branch_id): SetDeviceRole; lane_label 1–20 chars (00 H-6).
const Id = z.string().min(1);

export const DeviceRoleSetPayload = z.object({
  device_id: Id,
  point_id: Id.nullable(),
  lane_label: z.string().min(1).max(20).nullable(),
});
export type DeviceRoleSetPayload = z.infer<typeof DeviceRoleSetPayload>;

export const DeviceRoleSet = defineEvent({ eventType: 'DeviceRoleSet', version: 1, payload: DeviceRoleSetPayload });
