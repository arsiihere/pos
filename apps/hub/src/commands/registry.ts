import type { Permission, SessionKind } from '@pos/domain';
import type Database from 'better-sqlite3';
import type { EngineState } from '@pos/engine';
import type { EventDraft, PosCommand } from '@pos/events';
import { z } from 'zod';
import type { HubConfig } from '../config/schema.js';
import type { WriterTx } from '../engine-host/writer.js';
import type { Clock } from '../lib/clock.js';
import type { IdGen } from '../lib/ids.js';
import type { SecretGen } from '../lib/secrets.js';
import type { Resolution, SessionDirectory } from '../auth/staff-directory.js';

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
  /** 05a §3.3a: the session view (`forSession`) of the current directory. */
  directory: SessionDirectory;
  config: HubConfig;
  /** 00 v1.8 H-1 (b): `X-Queued-At` clamped to `[started_at - 120 000, now]`; null unless the command is queueable with a valid header. */
  queuedAt: number | null;
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
  /** 05a §3.3a: the session view (`forSession`) of the current directory. */
  directory: SessionDirectory;
  branch: CommandCtx['branch'];
  config: HubConfig;
  authChanged: boolean;
}

export interface CommandDef<P extends z.ZodType = z.ZodType> {
  commandType: string;
  payloadSchema: P;
  /**
   * 00 v1.12 §3.7 / §4.2 (05 row H-1): `'both'` is registered on `/commands/<name>` and `/admin/commands/<name>`:
   * one `command_id` space, the same `handle`, permission resolved from the staff of the request's session.
   */
  sessionKind: 'device' | 'admin' | 'both';
  /** `'checked-in-handler'` only for HANDLER_CHECKED_COMMANDS (00 v1.6 §3.7 H-3); `ctx.permission` is then null. */
  permission: Permission | null | 'checked-in-handler';
  /**
   * ⚠️ 02b v1.0.28 QR2-2 (owner 2026-11-28 QA-R2, BUG-9): a `'both'` command's permission on the staff route
   * (`/commands/<name>`) when it differs from `permission` (which the admin route keeps). Absent → `permission`.
   */
  devicePermission?: Permission;
  approvable?: boolean;
  stationScoped?: boolean;
  /** 00 v1.8 H-1 (c): only a queueable command reads `X-Queued-At` as `ctx.queuedAt` (default false). */
  queueable?: boolean;
  /**
   * 00 v1.12 §3.7 / §4.2 (05 row H-4): dotted payload paths removed before `payload_hash`, beside the `pinCheck`
   * field. A secret, a government ID, a payment reference or free text is never hashed, stored or echoed: a
   * `VALIDATION_FAILED` issue at, under or above a listed path carries its path and Zod code only.
   * Each path must resolve to an object field of `payloadSchema` (through optional / nullable / default; no
   * array step): `register` refuses any other.
   * - A refine must not set an issue `path` off an omitted path (e.g. a refine on the payload root reporting at a
   *   sibling field while echoing an omitted value): that issue keeps its message and the value would be echoed.
   * - Changing `hashOmit` on a deployed command changes its `payload_hash`: a retry in flight across the upgrade
   *   (first try stored under the old list) is then refused as `command_id already used`.
   */
  hashOmit?: readonly string[];
  /** 00 v1.6 §3.5 / §4.2 H-3: read-only check after payload Zod, before the PIN step; `db` is the read-only view. */
  preRead?(db: Database.Database, payload: z.infer<P>, ctx: PreReadCtx): void;
  /** 00 v1.6 §3.5 H-3: the PIN to verify; `field` is also omitted from `payload_hash` (H-9). */
  pinCheck?(payload: z.infer<P>, ctx: PreReadCtx): { staff_id: string; pin: string; field: string } | null;
  /** 00 v1.6 §3.5 H-3: drafts appended on a PIN mismatch / a failed `prepare`. */
  pinHooks?: {
    // `cmd` (01d task 23): the command envelope, e.g. its command_id for a notice's dedupe_key (01d §3.10).
    onMismatch(tx: WriterTx, payload: z.infer<P>, ctx: CommandCtx, cmd: PosCommand): EventDraft[];
    onPrepareFailed(tx: WriterTx, error: unknown, matched: boolean, payload: z.infer<P>, ctx: CommandCtx, cmd: PosCommand): EventDraft[];
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
      // 00 v1.12 §3.7 (05 row H-4): a path that is not a payload field (typo, array step) would omit nothing.
      for (const path of d.hashOmit ?? []) {
        if (!resolvesToField(d.payloadSchema, path.split('.'))) {
          throw new Error(`${d.commandType}: hashOmit path '${path}' is not an object field of payloadSchema`);
        }
      }
      byName.set(toKebab(d.commandType), d);
    },
    byPath(name) {
      return byName.get(name);
    },
  };
}

function unwrapped(schema: unknown): unknown {
  let current = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
    current = current.unwrap();
  }
  return current;
}

/** 05 row H-4: every segment is a key of a (wrapped) `z.object` shape. */
function resolvesToField(schema: z.ZodType, segments: readonly string[]): boolean {
  let current: unknown = schema;
  for (const segment of segments) {
    const object = unwrapped(current);
    if (segment.length === 0 || !(object instanceof z.ZodObject) || !Object.hasOwn(object.shape, segment)) return false;
    current = (object.shape as Record<string, unknown>)[segment];
  }
  return segments.length > 0;
}
