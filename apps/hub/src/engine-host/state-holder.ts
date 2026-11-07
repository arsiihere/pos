import type { PosEvent } from '@pos/events';

export type Reducer<S> = (s: S, e: PosEvent) => S;
// 03a AD-28: folds one transaction's events in one call. Additive: a holder with no batch form folds event by event.
export type BatchReducer<S> = (s: S, events: readonly PosEvent[]) => S;

export interface StateHolder<S> {
  get(): Readonly<S>;
  setReducer(r: Reducer<S>, batch?: BatchReducer<S>): void;
  reducer(): Reducer<S>;
  fold(s: S, events: readonly PosEvent[]): S;
  swap(next: S): void;
}

export function createStateHolder<S>(initial: S): StateHolder<S> {
  let current = initial;
  let reduce: Reducer<S> | undefined;
  let foldBatch: BatchReducer<S> | undefined;
  return {
    get: () => current,
    setReducer(next, batch) {
      reduce = next;
      foldBatch = batch;
    },
    reducer() {
      if (reduce === undefined) throw new Error('reducer is not set');
      return reduce;
    },
    fold(s, events) {
      if (reduce === undefined) throw new Error('reducer is not set');
      return foldBatch !== undefined ? foldBatch(s, events) : events.reduce(reduce, s);
    },
    swap(next) {
      current = next;
    },
  };
}
