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
  append(drafts: EventDraft[]): PosEvent[];
  onCommit(fn: () => void): void;
}

export interface Writer {
  run<T>(fn: (tx: WriterTx) => T): { result: T; appended: PosEvent[] };
  lastSeq(): number;
  addAfterCommit(fn: (appended: PosEvent[]) => void): void;
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
  const authEvents = new Set<string>(AUTH_EVENTS);
  return {
    lastSeq: () => lastSeq,
    addAfterCommit(fn) {
      afterCommit.push(fn);
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
          if (appended.length > 0) {
            const reduce = o.state.reducer();
            for (const event of appended) next = reduce(next, event);
          }
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
