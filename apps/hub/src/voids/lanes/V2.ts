import type { FastifyInstance } from 'fastify';
import { registerDayCloseGuard } from '../../commands/close-business-day.js';
import { registerLineGuard } from '../../orders/line-guard.js';
import type { HubDeps } from '../../server.js';
import { provideVoids, voidDayCloseGuard, voidLineGuard } from '../contracts.js';
import { pendingVoids } from '../exports.js';
import { dayCloseGuard, lineGuard, mergeGuard } from '../guards.js';
import { registerPendingVoidsQuery } from '../queries/pending-voids.js';
import { registerVoidPreviewQuery } from '../queries/void-preview.js';

// 04 lane V2: this lane's wiring lines go here and only here (phase 0 P0.7). Only lane V2 edits this file.
// register(): commands, queries, guard registrations, provideVoids(...) — called once per server by registerVoids.

export function register(app: FastifyInstance, deps: HubDeps): void {
  void deps;
  // v8 (§4.2, §6.6): the real exports and guards behind contracts.ts. The merge guard is already registered by
  // registerVoids (voids/index.ts) through contracts' voidMergeGuard; the line guard (02b row Q-3) and the day-close
  // guard (01a row A-1) are registered here, also through contracts' wrappers.
  provideVoids({ pendingVoids, mergeGuard, lineGuard, dayCloseGuard });
  registerLineGuard(voidLineGuard);
  registerDayCloseGuard(voidDayCloseGuard);
  // v9 (§6.3, §6.4): the two read queries
  registerVoidPreviewQuery(app);
  registerPendingVoidsQuery(app);
}
