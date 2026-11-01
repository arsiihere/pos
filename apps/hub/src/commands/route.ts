import { DomainError } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import { defineEvent, latestVersion, PosCommandSchema, type EventDraft, type PosCommand } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, type ZodError } from 'zod';
import type { HubConfig } from '../config/schema.js';
import type { AuthGeneration } from '../engine-host/auth-generation.js';
import { currentDirectory } from '../auth/guards.js';
import { activity, endSession, findSessionByToken, isIdleExpired, type SessionRow } from '../auth/session-store.js';
import type { Resolution, StaffDirectory } from '../auth/staff-directory.js';
import type { Writer, WriterTx } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import { payloadHash } from '../lib/hash.js';
import type { IdGen } from '../lib/ids.js';
import type { SecretGen } from '../lib/secrets.js';
import { IdempotentReplay } from './replay.js';
import { createCommandRegistry, defineCommand, toKebab, type CommandCtx, type CommandDef } from './registry.js';

interface CommandRouteDeps {
  config: HubConfig;
  db: Database.Database;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
  writer: Writer;
  authGeneration: AuthGeneration;
  testHooks?: { betweenGuardAndWriter?: () => Promise<void> };
}

const commandRegistries = new WeakMap<FastifyInstance, ReturnType<typeof createCommandRegistry>>();

export function commandRegistry(app: FastifyInstance): ReturnType<typeof createCommandRegistry> {
  const registry = commandRegistries.get(app);
  if (registry === undefined) throw new Error('command routes are not registered');
  return registry;
}

export function registerCommandRoutes(app: FastifyInstance, deps: CommandRouteDeps, testCommands: boolean): void {
  const registry = createCommandRegistry();
  commandRegistries.set(app, registry);
  if (testCommands) registerTestCommands(registry);
  app.post(
    '/commands/:name',
    { config: { group: 'device' } },
    async (request, reply) => runCommand(app, deps, registry, request, reply, 'device'),
  );
  app.post('/admin/commands/:name', { config: { group: 'admin' } }, async (request, reply) =>
    runCommand(app, deps, registry, request, reply, 'admin'),
  );
}

async function runCommand(
  app: FastifyInstance,
  deps: CommandRouteDeps,
  registry: ReturnType<typeof createCommandRegistry>,
  request: FastifyRequest,
  reply: FastifyReply,
  routeKind: 'device' | 'admin',
): Promise<unknown> {
  const name = routeName(request);
  const commandDef = registry.byPath(name);
  if (commandDef === undefined || commandDef.sessionKind !== routeKind) throw new DomainError('ROUTE_NOT_FOUND');
  const command = parseCommand(request.body);
  if (toKebab(command.command_type) !== name) invalid('command_type', 'command_type does not match the path');
  const deviceId = commandDeviceId(request, routeKind);
  if (deviceId === undefined || command.device_id !== deviceId) invalid('device_id', 'device_id does not match the token');
  const provisioned = deps.config.provisioned;
  if (provisioned === undefined) throw new DomainError('HUB_NOT_PROVISIONED');
  if (command.tenant_id !== provisioned.tenant_id || command.branch_id !== provisioned.branch_id) {
    throw new DomainError('BRANCH_MISMATCH');
  }
  // 00 v1.6 H-9: the command's pinCheck field, left out of payload_hash. Filled by 01d task 6
  // (`commandDef.pinCheck?.(payload, preCtx)?.field`); no command declares pinCheck before then.
  const pinField: string | undefined = undefined;
  const early = decide(readStored(deps.db, command.command_id), command, deviceId, request.session, routeKind, pinField);
  if (early?.kind === 'replay') return sendReplay(reply, early.stored);
  if (early?.kind === 'conflict') throw commandIdUsed();
  const session = routeKind === 'device' ? requireCommandSession(request, deps) : request.session;
  if (session === undefined) throw new DomainError('SESSION_INVALID');
  if (session.ended_at !== null) throw new DomainError('SESSION_EXPIRED');
  const actorId = session.kind === 'station' ? null : session.staff_id;
  if (command.actor_id !== actorId) invalid('actor_id', 'actor_id does not match the session');
  const payload = commandDef.payloadSchema.safeParse(command.payload);
  if (!payload.success) throw new DomainError('VALIDATION_FAILED', { issues: zodIssues(payload.error) });
  const authGen = request.authGen ?? deps.authGeneration.current();
  await deps.testHooks?.betweenGuardAndWriter?.();
  try {
    const body = deps.writer.run((tx) => {
      const again = decide(readStored(tx.db, command.command_id), command, deviceId, session, routeKind, pinField);
      if (again?.kind === 'replay') throw new IdempotentReplay(again.stored);
      if (again?.kind === 'conflict') throw commandIdUsed();
      if (deps.authGeneration.current() !== authGen) recheckAuth(tx, deviceId, session.session_id);
      const directory = currentDirectory(app);
      const permission = authorize(commandDef, session, directory);
    const ctx: CommandCtx = {
      tx,
      // R8: the writer's tx.state is the hub's EngineState (HubDeps.state).
      state: tx.state as Readonly<EngineState>,
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
    const beforeSeq = (
      tx.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE branch_id = ?').get(tx.branchId) as {
        seq: number;
      }
    ).seq;
    const handled = commandDef.handle(ctx, payload.data, command);
    tx.append(handled.events);
    const eventIds = (
      tx.db
        .prepare('SELECT event_id FROM events WHERE branch_id = ? AND seq > ? ORDER BY seq')
        .all(tx.branchId, beforeSeq) as Array<{ event_id: string }>
    ).map((row) => row.event_id);
    const response = {
      data: { command_id: command.command_id, event_ids: eventIds, result: handled.result },
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
        payloadHash(command.payload, pinField),
        JSON.stringify({ status: 200, body: response }),
        deps.clock.branchNow(),
      );
      return response;
    }).result;
    activity.touch(session.session_id, deps.clock.branchNow());
    return body;
  } catch (error) {
    if (error instanceof IdempotentReplay) return sendReplay(reply, error.stored);
    throw error;
  }
}

function commandDeviceId(request: FastifyRequest, routeKind: 'device' | 'admin'): string | undefined {
  if (routeKind === 'admin' && request.session?.kind === 'admin' && request.session.device_id === null) return 'hub-admin';
  return request.device?.device_id;
}

function requireCommandSession(request: FastifyRequest, deps: CommandRouteDeps): SessionRow {
  const token = headerValue(request, 'x-session-token');
  const session = token === undefined ? undefined : findSessionByToken(deps.db, token);
  if (session === undefined || session.device_id !== request.device?.device_id) throw new DomainError('SESSION_INVALID');
  if (session.kind !== 'staff' && session.kind !== 'station') throw new DomainError('SESSION_INVALID');
  if (session.ended_at !== null) throw new DomainError('SESSION_EXPIRED');
  if (isIdleExpired(session, deps.clock.branchNow())) {
    endIdle(deps, token!);
    throw new DomainError('SESSION_EXPIRED');
  }
  return session;
}

function endIdle(deps: CommandRouteDeps, token: string): void {
  deps.writer.run((tx) => {
    const fresh = findSessionByToken(tx.db, token);
    if (fresh === undefined || fresh.ended_at !== null) return;
    endSession(tx, fresh, 'idle_timeout', null, null, fresh.device_id ?? 'hub');
  });
}

function decide(
  row: StoredCommand | undefined,
  command: PosCommand,
  deviceId: string,
  session: SessionRow | undefined,
  routeKind: 'device' | 'admin',
  pinField: string | undefined,
): { kind: 'replay'; stored: { status: number; body: unknown } } | { kind: 'conflict' } | undefined {
  if (row === undefined) return undefined;
  const identity = routeKind === 'admin' ? session !== undefined && row.session_id === session.session_id : row.device_id === deviceId;
  if (identity && row.command_type === command.command_type && row.payload_hash === payloadHash(command.payload, pinField)) {
    return { kind: 'replay', stored: JSON.parse(row.response_json) as { status: number; body: unknown } };
  }
  return { kind: 'conflict' };
}

function readStored(db: Database.Database, commandId: string): StoredCommand | undefined {
  return db
    .prepare(
      `SELECT device_id, session_id, command_type, payload_hash, response_json
       FROM processed_commands WHERE command_id = ?`,
    )
    .get(commandId) as StoredCommand | undefined;
}

function recheckAuth(tx: WriterTx, deviceId: string, sessionId: string): void {
  if (deviceId !== 'hub-admin') {
    const device = tx.db.prepare('SELECT revoked_at FROM devices WHERE device_id = ?').get(deviceId) as
      | { revoked_at: number | null }
      | undefined;
    if (device?.revoked_at != null) throw new DomainError('DEVICE_REVOKED');
  }
  const row = tx.db.prepare('SELECT ended_at FROM staff_sessions WHERE session_id = ?').get(sessionId) as
    | { ended_at: number | null }
    | undefined;
  if (row?.ended_at != null) throw new DomainError('SESSION_EXPIRED');
}

function sendReplay(reply: FastifyReply, stored: { status: number; body: unknown }): unknown {
  reply.header('Idempotent-Replay', 'true');
  reply.status(stored.status);
  return stored.body;
}

function commandIdUsed(): DomainError {
  return new DomainError('VALIDATION_FAILED', {
    issues: [{ path: 'command_id', message: 'command_id already used' }],
  });
}

interface StoredCommand {
  device_id: string;
  session_id: string | null;
  command_type: string;
  payload_hash: string;
  response_json: string;
}

function authorize(def: CommandDef, session: SessionRow, directory: StaffDirectory): Resolution | null {
  if (def.permission === 'checked-in-handler') {
    // 00 v1.6 §3.7 H-3: staff session only; the handler runs its own right check.
    if (session.kind === 'station') throw new DomainError('PERMISSION_DENIED', { session_kind: 'station' });
    if (session.staff_id === null) throw new DomainError('PERMISSION_DENIED', { grant: 'not_granted' });
    return null;
  }
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
      commandType: 'TestAdmin',
      payloadSchema: z.object({}),
      sessionKind: 'admin',
      permission: 'access-hub-admin',
      handle(ctx, _payload, cmd) {
        return { events: [testEvent(ctx, cmd)], result: { ok: true } };
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

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  if (first === undefined || first.length === 0) return undefined;
  return first;
}

function routeName(request: FastifyRequest): string {
  const params = request.params as { name?: string };
  return params.name ?? '';
}
