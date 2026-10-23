import { DomainError } from '@pos/domain';
import { defineEvent, latestVersion, PosCommandSchema, type EventDraft, type PosCommand } from '@pos/events';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z, type ZodError } from 'zod';
import type { HubConfig } from '../config/schema.js';
import { currentDirectory } from '../auth/guards.js';
import { activity, type SessionRow } from '../auth/session-store.js';
import type { Resolution, StaffDirectory } from '../auth/staff-directory.js';
import type { Writer } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import { payloadHash } from '../lib/hash.js';
import type { IdGen } from '../lib/ids.js';
import type { SecretGen } from '../lib/secrets.js';
import { createCommandRegistry, defineCommand, toKebab, type CommandCtx, type CommandDef } from './registry.js';

interface CommandRouteDeps {
  config: HubConfig;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
  writer: Writer;
}

export function registerCommandRoutes(app: FastifyInstance, deps: CommandRouteDeps): void {
  const registry = createCommandRegistry();
  registerTestCommands(registry);
  app.post(
    '/commands/:name',
    { config: { group: 'device-session', allowStation: true } },
    async (request) => runCommand(app, deps, registry, request, 'device'),
  );
  app.post('/admin/commands/:name', { config: { group: 'admin' } }, async (request) =>
    runCommand(app, deps, registry, request, 'admin'),
  );
}

function runCommand(
  app: FastifyInstance,
  deps: CommandRouteDeps,
  registry: ReturnType<typeof createCommandRegistry>,
  request: FastifyRequest,
  routeKind: 'device' | 'admin',
): unknown {
  const name = routeName(request);
  const commandDef = registry.byPath(name);
  if (commandDef === undefined || commandDef.sessionKind !== routeKind) throw new DomainError('ROUTE_NOT_FOUND');
  const command = parseCommand(request.body);
  if (toKebab(command.command_type) !== name) invalid('command_type', 'command_type does not match the path');
  const session = request.session;
  if (session === undefined) throw new DomainError('SESSION_INVALID');
  const deviceId = session.kind === 'admin' && session.device_id === null ? 'hub-admin' : request.device?.device_id;
  if (deviceId === undefined || command.device_id !== deviceId) invalid('device_id', 'device_id does not match the token');
  const provisioned = deps.config.provisioned;
  if (provisioned === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
  if (command.tenant_id !== provisioned.tenant_id || command.branch_id !== provisioned.branch_id) {
    throw new DomainError('BRANCH_MISMATCH');
  }
  const actorId = session.kind === 'station' ? null : session.staff_id;
  if (command.actor_id !== actorId) invalid('actor_id', 'actor_id does not match the session');
  const payload = commandDef.payloadSchema.safeParse(command.payload);
  if (!payload.success) throw new DomainError('VALIDATION_FAILED', { issues: zodIssues(payload.error) });
  const body = deps.writer.run((tx) => {
    const directory = currentDirectory(app);
    const permission = authorize(commandDef, session, directory);
    const ctx: CommandCtx = {
      tx,
      state: tx.state,
      clock: deps.clock,
      ids: deps.ids,
      secrets: deps.secrets,
      actor: {
        kind: session.kind,
        staffId: session.staff_id,
        stationId: session.station_id,
        sessionId: session.session_id,
        deviceId,
      },
      permission,
      branch: { tenantId: provisioned.tenant_id, branchId: provisioned.branch_id },
      directory,
      config: deps.config,
    };
    const handled = commandDef.handle(ctx, payload.data, command);
    const appended = tx.append(handled.events);
    const response = {
      data: { command_id: command.command_id, event_ids: appended.map((event) => event.event_id), result: handled.result },
    };
    tx.db
      .prepare(
        `INSERT INTO processed_commands (
          command_id, branch_id, device_id, session_id, command_type, payload_hash, response_json, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        command.command_id,
        provisioned.branch_id,
        deviceId,
        session.session_id,
        command.command_type,
        payloadHash(command.payload),
        JSON.stringify({ status: 200, body: response }),
        deps.clock.branchNow(),
      );
    return response;
  }).result;
  activity.touch(session.session_id, deps.clock.branchNow());
  return body;
}

function authorize(def: CommandDef, session: SessionRow, directory: StaffDirectory): Resolution | null {
  if (session.kind === 'station') {
    if (def.stationScoped !== true) {
      throw new DomainError('PERMISSION_DENIED', { permission: def.permission, session_kind: 'station' });
    }
    return null;
  }
  if (def.permission === null || session.staff_id === null) {
    throw new DomainError('PERMISSION_DENIED', { permission: def.permission, grant: 'not_granted' });
  }
  const resolution = directory.resolve(session.staff_id, def.permission);
  if (resolution.grant === 'allowed') return resolution;
  if (resolution.grant === 'requires_approval' && def.approvable === true) return resolution;
  throw new DomainError('PERMISSION_DENIED', { permission: def.permission, grant: resolution.grant });
}

function registerTestCommands(registry: ReturnType<typeof createCommandRegistry>): void {
  ensureTestNooped();
  registry.register(
    defineCommand({
      commandType: 'TestNoop',
      payloadSchema: z.object({}),
      sessionKind: 'device',
      permission: 'reprint-ticket',
      handle(ctx, _payload, cmd) {
        return { events: [testEvent(ctx, cmd)], result: { ok: true } };
      },
    }),
  );
  registry.register(
    defineCommand({
      commandType: 'TestApprovable',
      payloadSchema: z.object({}),
      sessionKind: 'device',
      permission: 'apply-discount',
      approvable: true,
      handle(ctx, _payload, cmd) {
        return { events: [testEvent(ctx, cmd)], result: { permission: ctx.permission } };
      },
    }),
  );
  registry.register(
    defineCommand({
      commandType: 'TestStation',
      payloadSchema: z.object({}),
      sessionKind: 'device',
      permission: null,
      stationScoped: true,
      handle(ctx, _payload, cmd) {
        return {
          events: [testEvent(ctx, cmd, { stream_type: 'station', stream_id: ctx.actor.stationId ?? '' })],
          result: { actor_id: ctx.actor.staffId },
        };
      },
    }),
  );
  registry.register(
    defineCommand({
      commandType: 'TestFails',
      payloadSchema: z.object({}),
      sessionKind: 'device',
      permission: 'reprint-ticket',
      handle() {
        throw new DomainError('STAFF_NOT_FOUND');
      },
    }),
  );
}

function testEvent(
  ctx: CommandCtx,
  cmd: PosCommand,
  stream?: { stream_type: EventDraft['stream_type']; stream_id: string },
): EventDraft {
  return {
    stream_type: stream?.stream_type ?? 'hub',
    stream_id: stream?.stream_id ?? ctx.branch.branchId,
    event_type: 'TestNooped',
    schema_version: 1,
    payload: { command_id: cmd.command_id },
    occurred_at: cmd.occurred_at,
    actor_id: ctx.actor.staffId,
    device_id: ctx.actor.deviceId,
  };
}

function ensureTestNooped(): void {
  try {
    latestVersion('TestNooped');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('unknown event type')) throw error;
    defineEvent({
      eventType: 'TestNooped',
      version: 1,
      payload: z.object({ command_id: z.string() }),
    });
  }
}

function parseCommand(body: unknown): PosCommand {
  const parsed = PosCommandSchema.safeParse(body);
  if (!parsed.success) throw new DomainError('VALIDATION_FAILED', { issues: zodIssues(parsed.error) });
  return parsed.data;
}

function zodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function invalid(path: string, message: string): never {
  throw new DomainError('VALIDATION_FAILED', { issues: [{ path, message }] });
}

function routeName(request: FastifyRequest): string {
  const params = request.params as { name?: string };
  return params.name ?? '';
}
