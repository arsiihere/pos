import type { StationPlanBody, WsServerMessage } from '@pos/events';
import { createKdsStore, type KdsStoreImpl } from '../../kds/store';
import { nextOf } from '../../kds/station/NextColumn';

// 03b v1.0.8 §3.6 (P4; Q-56): the takeover sections' data. Each dark station of this point gets its own KDS store
// (K1's `createKdsStore`, read only), started from the takeover body — the catch-up's `point_view.takeovers[]` or the
// `station_takeover { active: true, view }` frame — with the last `station_plan` of that station (the Next column),
// then fed every frame the Pass gets (line events, `station_plan`, `station_notice { kind: 'output' }` → has_printer,
// …); each KDS store ignores what is not its station's (Q-49). So a takeover section is exactly the station's KDS view.
// `station_takeover { active: false }` drops the section; listeners hear whether it still held rows in Now or Next
// (Q-56: only then "{Station} screen is back" — an empty section means the takeover ended for "nothing to show").
// A catch-up rebuilds every section from its parts. No timer reads the hub; `prune()` is the display tick's Done drop.

export interface TakeoverEnded {
  station_id: string;
  /** rows in Now or Next when it ended */
  rows: number;
}

export interface Takeovers {
  apply(frame: WsServerMessage): void;
  /** the sections by station_id, in start order */
  stores(): ReadonlyMap<string, KdsStoreImpl>;
  /** changes on every section change (for useSyncExternalStore) */
  version(): number;
  subscribe(listener: () => void): () => void;
  onEnded(listener: (e: TakeoverEnded) => void): () => void;
  prune(): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function createTakeovers(deps: { now: () => number }): Takeovers {
  let stores = new Map<string, KdsStoreImpl>();
  const offs = new Map<string, () => void>();
  /** the last station_plan per station (catch-up part or frame), for a takeover that starts later */
  let plans = new Map<string, StationPlanBody>();
  let version = 0;
  const listeners = new Set<() => void>();
  const ended = new Set<(e: TakeoverEnded) => void>();
  const changed = () => {
    version += 1;
    for (const fn of [...listeners]) fn();
  };

  function open(station_id: string, body: unknown): void {
    close(station_id);
    const store = createKdsStore({ stationId: station_id, now: deps.now });
    const plan = plans.get(station_id);
    store.apply({ type: 'catch_up', as_of_seq: 0, state: { kds_station: body, station_plan: plan === undefined ? [] : [plan] } });
    if (store.snapshot().station === null) return; // not a valid body for this station
    offs.set(station_id, store.subscribe(changed));
    stores = new Map(stores).set(station_id, store);
  }

  function close(station_id: string): KdsStoreImpl | undefined {
    const store = stores.get(station_id);
    if (store === undefined) return undefined;
    offs.get(station_id)?.();
    offs.delete(station_id);
    stores = new Map(stores);
    stores.delete(station_id);
    return store;
  }

  return {
    apply(frame) {
      if (frame.type === 'catch_up') {
        plans = new Map();
        const parts = frame.state['station_plan'];
        if (Array.isArray(parts)) for (const p of parts) if (isObj(p) && typeof p['station_id'] === 'string') plans.set(p['station_id'], p as unknown as StationPlanBody);
        for (const id of [...stores.keys()]) close(id);
        const pv = frame.state['point_view'];
        const bodies = isObj(pv) && Array.isArray(pv['takeovers']) ? (pv['takeovers'] as unknown[]) : [];
        for (const b of bodies) if (isObj(b) && typeof b['station_id'] === 'string') open(b['station_id'], b);
        changed();
        return;
      }
      if (frame.type === 'station_plan') plans.set(frame.station_id, { station_id: frame.station_id, as_of_seq: frame.as_of_seq, lines: frame.lines });
      if (frame.type === 'station_takeover') {
        if (frame.active) {
          if (frame.view === undefined) return;
          open(frame.station_id, frame.view);
          changed();
          return;
        }
        const gone = close(frame.station_id);
        if (gone === undefined) return;
        const snap = gone.snapshot();
        const rows = snap.rows.length + nextOf(snap.plan).next.length;
        changed();
        for (const fn of [...ended]) fn({ station_id: frame.station_id, rows });
        return;
      }
      for (const store of stores.values()) store.apply(frame);
    },
    stores: () => stores,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    onEnded(listener) {
      ended.add(listener);
      return () => void ended.delete(listener);
    },
    prune() {
      for (const store of stores.values()) store.prune();
    },
  };
}
