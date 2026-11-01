import type { Permission, SessionKind } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { EngineState } from '@pos/engine';
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
  state: Readonly<EngineState>;
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

/** 00 v1.6 §3.7 H-3: the only commands that may declare `permission: 'checked-in-handler'`. */
export const HANDLER_CHECKED_COMMANDS = ['AnswerRequest', 'WithdrawRequest', 'MarkAlertsSeen'] as const;

/** 00 v1.6 §3.5 H-3: read-only context for `preRead` / `pinCheck` (built by the pipeline in 01d task 6). */
export interface PreReadCtx {
  /** read-only connection */
  db: Database.Database;
  state: Readonly<EngineState>;
  clock: Clock;
  actor: CommandCtx['actor'];
  directory: StaffDirectory;
  branch: CommandCtx['branch'];
  config: HubConfig;
  authChanged: boolean;
}

export interface CommandDef<P extends z.ZodType = z.ZodType> {
  commandType: string;
  payloadSchema: P;
  sessionKind: 'device' | 'admin';
  /** `'checked-in-handler'` only for HANDLER_CHECKED_COMMANDS (00 v1.6 §3.7 H-3); `ctx.permission` is then null. */
  permission: Permission | null | 'checked-in-handler';
  approvable?: boolean;
  stationScoped?: boolean;
  /** 00 v1.6 §3.5 H-3: read-only check before the PIN step. */
  preRead?(ctx: PreReadCtx, payload: z.infer<P>): void;
  /** 00 v1.6 §3.5 H-3: the PIN to verify; `field` is also omitted from `payload_hash` (H-9). */
  pinCheck?(payload: z.infer<P>, ctx: PreReadCtx): { staff_id: string; pin: string; field: string } | null;
  /** 00 v1.6 §3.5 H-3: drafts appended on a PIN mismatch / a failed `prepare`. */
  pinHooks?: {
    onMismatch(tx: WriterTx, payload: z.infer<P>, ctx: CommandCtx): EventDraft[];
    onPrepareFailed(tx: WriterTx, error: unknown, matched: boolean, payload: z.infer<P>, ctx: CommandCtx): EventDraft[];
  };
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
      if (d.permission === 'checked-in-handler' && !(HANDLER_CHECKED_COMMANDS as readonly string[]).includes(d.commandType)) {
        throw new Error(
          `${d.commandType}: permission 'checked-in-handler' is allowed only for HANDLER_CHECKED_COMMANDS (${HANDLER_CHECKED_COMMANDS.join(', ')})`,
        );
      }
      byName.set(toKebab(d.commandType), d);
    },
    byPath(name) {
      return byName.get(name);
    },
  };
}
