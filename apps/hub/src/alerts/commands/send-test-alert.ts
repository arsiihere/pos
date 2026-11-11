import { DomainError } from '@pos/domain';
import { SendTestAlertPayload, type AlertDisplay, type AlertTarget, type EventDraft, type PosCommand } from '@pos/events';
import type { FastifyInstance } from 'fastify';
import type { CommandCtx } from '../../commands/registry.js';
import { defineCommand } from '../../commands/registry.js';
import { commandRegistry } from '../../commands/route.js';
import { branchConfig } from '../../sync/branch-config-holder.js';
import { TEST_ALERT } from '../kinds.js';
import { alerts } from '../raise.js';
import { hasTargetResolver } from '../targets.js';

// 01d §6.5 `SendTestAlert`, §3.10 `test_alert`: a manager (`manage-devices`, the normal permission check; not
// handler-checked) sends a test to a person, a team (default depth 'direct', from the payload schema), a
// device or a point. Processing: a point id that is not an active point of branchConfig().points → 404
// POINT_NOT_FOUND (checked first, memory; v1.2.3 D-4, 03b B1-1); a point without a registered resolver → 422
// points_not_available (§4.4); unknown staff (person or team lead) → 404 STAFF_NOT_FOUND (directory, in memory); unknown
// or revoked device → 404 DEVICE_NOT_FOUND (1 statement); then `raise('test_alert')` on hub / branch_id with
// dedupe_key 'test:' + command_id (the alert id is made inside raise). Statements: 1 (device only) + raise.
// A team with no reports or an offline device is not an error: step 0 lists who it resolves to, with no
// route, and the receipts show it (Review Focus 5).

type Payload = SendTestAlertPayload;

const DEVICE = 'SELECT device_name FROM devices WHERE device_id = ? AND branch_id = ? AND revoked_at IS NULL';

function knownStaff(ctx: CommandCtx, staffId: string): void {
  // the hub directory's `staff` or `no_pin_staff` (B-1: a no-PIN person is targetable, never signed in)
  if (ctx.directory.get(staffId) === undefined && !ctx.directory.isNoPin(staffId)) {
    throw new DomainError('STAFF_NOT_FOUND', { staff_id: staffId });
  }
}

/** Checks the target (§6.5 Processing); returns the device name for a device target (the alert's display). */
function checkTarget(ctx: CommandCtx, target: Payload['target']): string | null {
  switch (target.kind) {
    case 'point':
      if (!(branchConfig()?.points.some((p) => p.point_id === target.point_id && !p.is_archived) ?? false)) {
        throw new DomainError('POINT_NOT_FOUND', { point_id: target.point_id });
      }
      if (!hasTargetResolver('point')) {
        throw new DomainError('CONFIG_REFERENCE_INVALID', { field: 'target.point_id', reason: 'points_not_available' });
      }
      return null;
    case 'person':
      knownStaff(ctx, target.staff_id);
      return null;
    case 'team':
      knownStaff(ctx, target.lead_staff_id);
      return null;
    case 'device': {
      const row = ctx.tx.db.prepare(DEVICE).get(target.device_id, ctx.branch.branchId) as { device_name: string } | undefined;
      if (row === undefined) throw new DomainError('DEVICE_NOT_FOUND', { device_id: target.device_id });
      return row.device_name;
    }
  }
}

function handle(ctx: CommandCtx, payload: Payload, cmd: PosCommand): { events: EventDraft[]; result: { alert_id: string } } {
  const deviceName = checkTarget(ctx, payload.target);
  const sender = ctx.actor.staffId === null ? null : (ctx.directory.get(ctx.actor.staffId)?.display_name ?? null);
  // lock-safe display only (§3.12): who sent it and, for a device test, which device; no details
  const display: AlertDisplay = { kind_label_key: TEST_ALERT.labels.lock, requester_name: sender, device_name: deviceName };
  const raised = alerts.raise(ctx, {
    kind: TEST_ALERT.kind,
    subject: { stream_type: 'hub', stream_id: ctx.branch.branchId },
    target: payload.target as AlertTarget,
    display,
    dedupe_key: `test:${cmd.command_id}`,
  });
  return { events: raised.events, result: { alert_id: raised.alert_id } };
}

export function registerSendTestAlert(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'SendTestAlert',
      payloadSchema: SendTestAlertPayload,
      sessionKind: 'device',
      permission: 'manage-devices',
      handle: (ctx, payload, cmd) => handle(ctx, payload, cmd),
    }),
  );
}
