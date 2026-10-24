import type { PosEvent } from '@pos/events';

export type Reducer<S> = (s: S, e: PosEvent) => S;

export interface StateHolder<S> {
  get(): Readonly<S>;
  setReducer(r: Reducer<S>): void;
  reducer(): Reducer<S>;
  swap(next: S): void;
}

export function createStateHolder<S>(initial: S): StateHolder<S> {
  let current = initial;
  let reduce: Reducer<S> | undefined;
  return {
    get: () => current,
    setReducer(next) {
      reduce = next;
    },
    reducer() {
      if (reduce === undefined) throw new Error('reducer is not set');
      return reduce;
    },
    swap(next) {
      current = next;
    },
  };
}
