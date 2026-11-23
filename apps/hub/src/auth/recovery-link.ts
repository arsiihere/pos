import { DomainError, type DeviceType } from '@pos/domain';
import type { FastifyInstance } from 'fastify';
import type { HubDeps } from '../server.js';
import { issueAdminBootstrap } from './bootstrap-tokens.js';
import { listedAdminDeviceCount } from './device-profile.js';
import { currentDirectory } from './guards.js';

// 05a §6.11 (H-7; N-7, R-1, R-2): the recovery link at zero admin devices (M-8). Group `admin-device-public`: a device
// token of a paired non-kds device, no admin session (00 §3.9). The link is the existing bootstrap path (00 §6.29).

const RECOVERY_TYPES = new Set<DeviceType>(['tablet', 'cashier_kiosk', 'phone']);

export function registerRecoveryLinkRoute(app: FastifyInstance, deps: HubDeps): void {
  app.post('/admin/recovery-link', { config: { group: 'admin-device-public' } }, async (request) => {
    const device = request.device;
    if (device === undefined) throw new DomainError('DEVICE_TOKEN_INVALID');
    if (!RECOVERY_TYPES.has(device.device_type)) {
      throw new DomainError('DEVICE_TYPE_NOT_ALLOWED', {
        device_type: device.device_type,
        allowed: ['tablet', 'cashier_kiosk', 'phone'],
      });
    }
    // M-8 count: memory and the directory, no statement.
    if (listedAdminDeviceCount(currentDirectory(app)) !== 0) {
      throw new DomainError('PERMISSION_DENIED', { reason: 'recovery_not_needed' });
    }
    // R-1: any live bootstrap token, whoever issued it (1 statement). No await between this read and the issue.
    const live = deps.db
      .prepare(
        `SELECT MAX(expires_at) AS expires_at FROM admin_bootstrap_tokens
          WHERE branch_id = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .get(deps.config.provisioned?.branch_id, deps.clock.branchNow()) as { expires_at: number | null };
    if (live.expires_at !== null) return { data: { already_issued_until: live.expires_at } };
    const issued = deps.writer.run((tx) =>
      issueAdminBootstrap(tx, 'recovery', { clock: deps.clock, ids: deps.ids, secrets: deps.secrets }, device.device_id),
    ).result;
    // As setup builds its first-admin URL (00 §6.4 step 8).
    const firstAdminUrl = `http://${deps.config.advertised_host ?? ''}:${deps.config.http_port}/admin/bootstrap#t=${issued.token}`;
    return { data: { first_admin_url: firstAdminUrl, expires_at: issued.expires_at } };
  });
}
