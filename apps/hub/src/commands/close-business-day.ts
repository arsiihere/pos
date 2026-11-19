import { DEFAULT_DAY_MIN_GAP_HOURS, DomainError, type ErrorCode } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type { EventDraft } from '@pos/events';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { branchConfig } from '../sync/branch-config-holder.js';
import type { Resolution } from '../auth/staff-directory.js';
import { defineCommand, type CommandCtx } from './registry.js';
import { withStockEffects } from './set-precooked-stock.js';
import { commandRegistry } from './route.js';

const Payload = z.object({}).strict();

// 01a v2.7 §6.18b (04 §4.5 A-1; ⚠️ 05 row A-3): the day-close guards, the 02a merge-guard pattern
// (tables/merge-guard.ts). Later modules register them at startup; an ordered list in registration order (04's void
// guard first, then 05's); the first non-null result refuses, later guards are not asked. Unregistered → never blocks
// (0 statements). A guard already in the list is not appended again (every test hub re-registers 04's at boot).
// Asked after not_open / opened_recently, before the append; a non-null result → `409 <code>`.
export type DayCloseGuard = (db: Database.Database, state: Readonly<EngineState>) => { code: ErrorCode; details: Record<string, unknown> } | null;

const dayCloseGuards: DayCloseGuard[] = [];

export function registerDayCloseGuard(fn: DayCloseGuard): void {
  if (!dayCloseGuards.includes(fn)) dayCloseGuards.push(fn);
}

/** Tests only: back to "no guard registered" (⚠️ 05 row A-3: was `resetDayCloseGuard`). */
export function resetDayCloseGuards(): void {
  dayCloseGuards.length = 0;
}

/** Asks the guards in list order; the first non-null result answers. None → never blocked (0 statements). */
export function checkDayCloseGuard(db: Database.Database, state: Readonly<EngineState>): ReturnType<DayCloseGuard> {
  for (const guard of dayCloseGuards) {
    const result = guard(db, state);
    if (result !== null) return result;
  }
  return null;
}

// 01a v2.7 §6.18b (⚠️ 05 row A-4): the day-close appenders, an ordered list in registration order. After the guards,
// the close appends `[...appenderDrafts, ...withStockEffects(ctx, [BusinessDayClosed])]` in its one transaction, so
// 03a's releases and BusinessDayClosed stay last. Unregistered → today's behaviour. A repeat registration is ignored.
export type DayCloseAppender = (ctx: CommandCtx) => EventDraft[];

const dayCloseAppenders: DayCloseAppender[] = [];

export function registerDayCloseAppender(fn: DayCloseAppender): void {
  if (!dayCloseAppenders.includes(fn)) dayCloseAppenders.push(fn);
}

/** Tests only: back to "no appender registered". */
export function resetDayCloseAppenders(): void {
  dayCloseAppenders.length = 0;
}

/** The scope of the session's `close-business-day` grant; no scope (none resolved) counts as `branch`, as 01b B20. */
function grantScope(resolution: Resolution | null): string {
  return resolution !== null && 'scope' in resolution ? resolution.scope : 'branch';
}

// §6.18b, S33: closes the open day unless it was opened less than day_min_gap_hours ago.
export function registerCloseBusinessDay(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'CloseBusinessDay',
      payloadSchema: Payload,
      // ⚠️ 01a v2.7 §6.18b (05 row A-5): `close-business-day`, on the staff app and the hub admin (00 row H-1)
      sessionKind: 'both',
      permission: 'close-business-day',
      handle(ctx) {
        // 01b B20 with the new name: the day is branch-wide, so the grant must have scope `branch`. The cloud grants
        // close-business-day with scope `branch` only (PERMISSION_SCOPES), so this is defence in depth.
        if (grantScope(ctx.permission) !== 'branch') {
          throw new DomainError('PERMISSION_DENIED', { permission: 'close-business-day', reason: 'outside_scope', required_scope: 'branch' });
        }
        const day = ctx.state.business_day;
        if (day === null || day.closed_at !== null) {
          return {
            events: [],
            result: {
              business_date: day?.business_date ?? null,
              opened_at: day?.opened_at ?? null,
              closed_at: day?.closed_at ?? null,
              changed: false,
              reason: 'not_open',
            },
          };
        }
        const now = ctx.clock.branchNow();
        const gapHours = branchConfig()?.day_min_gap_hours ?? DEFAULT_DAY_MIN_GAP_HOURS;
        // A negative age (hub clock moved back) also counts as recent.
        if (now - day.opened_at < gapHours * 3_600_000) {
          return {
            events: [],
            result: { business_date: day.business_date, opened_at: day.opened_at, closed_at: null, changed: false, reason: 'opened_recently' },
          };
        }
        // 01a v2.5 A-1: a blocking guard refuses the close; no event, no processed_commands row (the throw rolls back)
        const blocked = checkDayCloseGuard(ctx.tx.db, ctx.state);
        if (blocked !== null) throw new DomainError(blocked.code, blocked.details);
        // Appended here so the result's closed_at is the event's recorded_at, the day's end. ⚠️ 05 row A-4: the
        // appenders' drafts first, then (A-14) the releases and BusinessDayClosed; a close needs no stock context
        // (§6.1f), so it works without a branch config.
        const appenderDrafts = dayCloseAppenders.flatMap((appender) => appender(ctx));
        const appended = ctx.tx.append([
          ...appenderDrafts,
          ...withStockEffects(ctx, [
            {
              stream_type: 'hub',
              stream_id: ctx.branch.branchId,
              event_type: 'BusinessDayClosed',
              schema_version: 1,
              payload: {},
              occurred_at: now,
              actor_id: ctx.actor.staffId,
              device_id: ctx.actor.deviceId,
            },
          ]),
        ]);
        const closed = appended.find((event) => event.event_type === 'BusinessDayClosed');
        return {
          events: [],
          result: {
            business_date: day.business_date,
            opened_at: day.opened_at,
            closed_at: closed!.recorded_at,
            changed: true,
            reason: 'closed',
          },
        };
      },
    }),
  );
}
