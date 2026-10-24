import type { Permission, SessionKind } from '@pos/domain';
import type { EventDraft, PosCommand } from '@pos/events';
import type { z } from 'zod';
import type { HubConfig } from '../config/schema.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import type { IdGen } from '../lib/ids.js';
import type { SecretGen } from '../lib/secrets.js';
import type { Resolution, StaffDirectory } from '../auth/staff-directory.js';

export interface CommandCtx {
  tx: WriterTx;
  state: Readonly<unknown>;
  clock: Clock;
  ids: IdGen;
  secrets: SecretGen;
  actor: {
    kind: SessionKind;
    staffId: string | null;
    stationId: string | null;
    sessionId: string;
    deviceId: string;
  };
  permission: Resolution | null;
  branch: { tenantId: string; branchId: string };
  directory: StaffDirectory;
  config: HubConfig;
}

export interface CommandDef<P extends z.ZodType = z.ZodType> {
  commandType: string;
  payloadSchema: P;
  sessionKind: 'device' | 'admin';
  permission: Permission | null;
  approvable?: boolean;
  stationScoped?: boolean;
  handle(ctx: CommandCtx, payload: z.infer<P>, cmd: PosCommand): { events: EventDraft[]; result: unknown };
}

export function defineCommand<P extends z.ZodType>(d: CommandDef<P>): CommandDef<P> {
  return d;
}

export function toKebab(commandType: string): string {
  return commandType
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

export function createCommandRegistry(): {
  register(d: CommandDef): void;
  byPath(name: string): CommandDef | undefined;
} {
  const byName = new Map<string, CommandDef>();
  return {
    register(d) {
      byName.set(toKebab(d.commandType), d);
    },
    byPath(name) {
      return byName.get(name);
    },
  };
}
