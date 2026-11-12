import { DEFAULT_DAY_MIN_GAP_HOURS, DomainError, type ErrorCode } from '@pos/domain';
import type { EngineState } from '@pos/engine';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { branchConfig } from '../sync/branch-config-holder.js';
import { defineCommand } from './registry.js';
import { requireBranchScope, withStockEffects } from './set-precooked-stock.js';
import { commandRegistry } from './route.js';

const Payload = z.object({}).strict();

// 01a v2.5 §6.18b / 04 §4.5 A-1: the day-close guard, the 02a merge-guard pattern. A later module (04) registers
// it at startup; at most one, a later registration replaces the earlier one. Unregistered → never blocks
// (0 statements). Asked after not_open / opened_recently, before the append; a non-null result → `409 <code>`.
export type DayCloseGuard = (db: Database.Database, state: Readonly<EngineState>) => { code: ErrorCode; details: Record<string, unknown> } | null;

let dayCloseGuard: DayCloseGuard | null = null;

export function registerDayCloseGuard(fn: DayCloseGuard): void {
  dayCloseGuard = fn;
}

/** Tests only: back to "no guard registered". */
export function resetDayCloseGuard(): void {
  dayCloseGuard = null;
}

/** Asks the registered guard; with none, never blocked (0 statements). */
export function checkDayCloseGuard(db: Database.Database, state: Readonly<EngineState>): ReturnType<DayCloseGuard> {
  return dayCloseGuard === null ? null : dayCloseGuard(db, state);
}

// §6.18b, S33: closes the open day unless it was opened less than day_min_gap_hours ago.
export function registerCloseBusinessDay(app: FastifyInstance): void {
  commandRegistry(app).register(
    defineCommand({
      commandType: 'CloseBusinessDay',
      payloadSchema: Payload,
      sessionKind: 'admin',
      permission: 'manage-stock',
      handle(ctx) {
        requireBranchScope(ctx);
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
        // Appended here so the result's closed_at is the event's recorded_at, the day's end. A-14: the releases come
        // first; a close needs no stock context (§6.1f), so it works without a branch config.
        const appended = ctx.tx.append(
          withStockEffects(ctx, [
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
        );
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
