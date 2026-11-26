import type { EventDraft, PosEvent } from '@pos/events';
import type Database from 'better-sqlite3';
import type { Clock } from '../lib/clock.js';
import type { IdGen } from '../lib/ids.js';
import type { ProjectionRegistry } from '../projections/registry.js';
import { AUTH_EVENTS, type AuthGeneration } from './auth-generation.js';
import { appendEvents } from './append-events.js';
import type { StateHolder } from './state-holder.js';

export interface WriterTx {
  db: Database.Database;
  state: Readonly<unknown>;
  clock: Clock;
  ids: IdGen;
  branchId: string;
  append(drafts: EventDraft[]): PosEvent[];
  onCommit(fn: () => void): void;
}

/**
 * ⚠️ 03b v1.0.16 §3.5 (run 3 R3-B-3, D8): what a before-commit hook gets: the events the transaction appended so far
 * (after their projections) and `tx()`, the transaction with `state` folded through them (folded on first call).
 */
export interface PreCommit {
  appended: readonly PosEvent[];
  tx(): WriterTx;
}

export interface Writer {
  run<T>(fn: (tx: WriterTx) => T): { result: T; appended: PosEvent[] };
  lastSeq(): number;
  addAfterCommit(fn: (appended: PosEvent[]) => void): void;
  /**
   * ⚠️ 03b v1.0.16 §3.5 (R3-B-3): runs once per transaction that appended something, inside it, after `fn` and before
   * COMMIT. It may append (those events commit, fold and publish with the rest, and are not passed to the hooks again);
   * a throw rolls the whole transaction back. Live writes only: boot replay does not use the writer.
   */
  addBeforeCommit(fn: (pre: PreCommit) => void): void;
}

export function createWriter<S>(o: {
  db: Database.Database;
  clock: Clock;
  ids: IdGen;
  tenantId: string;
  branchId: string;
  projections: ProjectionRegistry;
  state: StateHolder<S>;
  authGeneration: AuthGeneration;
  publish: (events: PosEvent[]) => void;
  testHooks?: { beforeCommit?: () => void; beforePublish?: () => void };
}): Writer {
  let lastSeq = (
    o.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE branch_id = ?').get(o.branchId) as {
      seq: number;
    }
  ).seq;
  const afterCommit: Array<(appended: PosEvent[]) => void> = [];
  const beforeCommit: Array<(pre: PreCommit) => void> = [];
  const authEvents = new Set<string>(AUTH_EVENTS);
  return {
    lastSeq: () => lastSeq,
    addAfterCommit(fn) {
      afterCommit.push(fn);
    },
    addBeforeCommit(fn) {
      beforeCommit.push(fn);
    },
    run(fn) {
      const onCommit: Array<() => void> = [];
      const appended: PosEvent[] = [];
      let next = o.state.get() as S;
      const result = o.db
        .transaction(() => {
          const tx: WriterTx = {
            db: o.db,
            state: o.state.get(),
            clock: o.clock,
            ids: o.ids,
            branchId: o.branchId,
            append(drafts) {
              const events = appendEvents(o.db, drafts, {
                clock: o.clock,
                ids: o.ids,
                tenantId: o.tenantId,
                branchId: o.branchId,
              });
              o.projections.applyAll(o.db, events, o.branchId);
              appended.push(...events);
              return events;
            },
            onCommit(cb) {
              onCommit.push(cb);
            },
          };
          const value = fn(tx);
          if (beforeCommit.length > 0 && appended.length > 0) {
            const own = [...appended];
            let staged: WriterTx | undefined;
            const pre: PreCommit = { appended: own, tx: () => (staged ??= { ...tx, state: o.state.fold(o.state.get() as S, own) as Readonly<unknown> }) };
            for (const hook of beforeCommit) hook(pre);
          }
          if (appended.length > 0) next = o.state.fold(next, appended);
          o.testHooks?.beforeCommit?.();
          return value;
        })
        .immediate();
      o.state.swap(next);
      const last = appended[appended.length - 1];
      if (last !== undefined) lastSeq = last.seq;
      if (appended.some((event) => authEvents.has(event.event_type))) o.authGeneration.bump();
      for (const cb of onCommit) cb();
      for (const hook of afterCommit) hook(appended);
      o.testHooks?.beforePublish?.();
      if (appended.length > 0) o.publish(appended);
      return { result, appended };
    },
  };
}
