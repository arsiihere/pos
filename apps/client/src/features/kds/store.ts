import { UNDO_DONE_MS, type LineDetail } from '@pos/domain';
import { KdsStationBody, StationPlanBody, type WsServerMessage } from '@pos/events';
import type { KdsNowLine, KdsSnapshot, KdsStore } from './contracts';

// 03b v1.0.8 §3.3, §6.14, §6.16, §6.17 (K1): the KDS store of the station this screen's session belongs to.
// - `catch_up` (sent on every (re)connect) replaces everything: Now rows from `kds_station.now`, details from both
//   catch-up parts, the Next plan from `station_plan`, and the arrival times are emptied.
// - Frames after it update it in arrival order: `kds_lines` fills details, `station_plan` replaces Next, line events
//   move rows (FireDispatched appends at the end, nothing reorders, Done is kept inside UNDO_DONE_MS, §3.3).
// - Q-49 (#76): a line event whose order_item_id the store does not hold (not a Now row, not in Next) is ignored:
//   no row, no change, no listener call. A station-scoped frame for another station is ignored the same way.
// - Q-55: a line that arrives live gets `arrived_at` = the hub clock (`now()`) at frame receipt.

export type KdsStage = KdsNowLine['stage'];
export type KdsMark = KdsNowLine['mark'];

/** One Now row in append order; `detail` null = a placeholder until `kds_lines` brings it (§3.3). */
export interface KdsRow {
  order_item_id: string;
  order_id: string | null;
  stage: KdsStage;
  fired_at: number | null;
  started_at: number | null;
  mark: KdsMark;
  done_undone: boolean;
  /** hub-clock ms when this screen saw the Done (the client keeps the row for UNDO_DONE_MS) */
  done_at: number | null;
  detail: LineDetail | null;
}

/** What K2–K5 render: the contract snapshot plus the ordered rows (placeholders included), Next and the notices. */
export interface KdsView extends KdsSnapshot {
  rows: readonly KdsRow[];
  /** the last `station_plan` of this station (Next = `frozen`, Later = the rest); null before one arrived */
  plan: StationPlanBody | null;
  /** §3.10 `station_notice { kind: 'archived' }` since the last catch-up */
  archived: { open_lines: number } | null;
}

export interface KdsStoreImpl extends KdsStore {
  snapshot(): KdsView;
  /** drops Done rows whose undo window has passed (display tick; no hub read) */
  prune(): void;
}

type Meta = Omit<KdsStationBody, 'now' | 'details'>;

const EMPTY: KdsView = { station: null, details: new Map(), arrived_at: new Map(), rows: [], plan: null, archived: null };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export function createKdsStore(deps: { stationId: string; now: () => number }): KdsStoreImpl {
  const own = deps.stationId;
  let meta: Meta | null = null;
  let rows: KdsRow[] = [];
  let details = new Map<string, LineDetail>();
  let arrived = new Map<string, number>();
  let plan: StationPlanBody | null = null;
  /**
   * The lines the last `station_plan` frame dropped. The hub sends a commit's `station_plan` (an after-commit hook)
   * before the commit's events, so a line that fires reaches the store first as "gone from the plan" and only then
   * as `FireDispatched` (or ItemStarted / ItemDone in the same commit). They stay held until the next plan frame.
   */
  let leaving = new Map<string, StationPlanBody['lines'][number]>();
  let archived: { open_lines: number } | null = null;
  let view: KdsView = EMPTY;
  const listeners = new Set<() => void>();

  function changed(): void {
    view =
      meta === null
        ? EMPTY
        : {
            station: {
              ...meta,
              now: rows.flatMap((r) =>
                r.detail === null ? [] : [{ ...r.detail, stage: r.stage, fired_at: r.fired_at, started_at: r.started_at, mark: r.mark, done_undone: r.done_undone }],
              ),
              details: (plan?.lines ?? []).flatMap((l) => {
                const d = details.get(l.order_item_id);
                return l.frozen && d !== undefined ? [d] : [];
              }),
            },
            details: new Map(details),
            arrived_at: new Map(arrived),
            rows: [...rows],
            plan,
            archived,
          };
    for (const fn of [...listeners]) fn();
  }

  const rowOf = (id: string): KdsRow | undefined => rows.find((r) => r.order_item_id === id);
  const planned = (id: string) => plan?.lines.find((l) => l.order_item_id === id) ?? leaving.get(id);
  const held = (id: string): boolean => rowOf(id) !== undefined || planned(id) !== undefined;

  function replace(id: string, next: Partial<KdsRow>): void {
    rows = rows.map((r) => (r.order_item_id === id ? { ...r, ...next } : r));
  }

  function dropPlanned(ids: ReadonlySet<string>): void {
    for (const id of ids) leaving.delete(id);
    if (plan !== null && plan.lines.some((l) => ids.has(l.order_item_id))) plan = { ...plan, lines: plan.lines.filter((l) => !ids.has(l.order_item_id)) };
  }

  function remove(ids: readonly string[]): boolean {
    const gone = new Set(ids.filter(held));
    if (gone.size === 0) return false;
    rows = rows.filter((r) => !gone.has(r.order_item_id));
    dropPlanned(gone);
    for (const id of gone) {
      details.delete(id);
      arrived.delete(id);
    }
    return true;
  }

  /** a planned line enters Now at the end (FireDispatched, or a start / done before its fire) */
  function enter(id: string, at: number, row: Partial<KdsRow>): void {
    const p = planned(id);
    rows = [
      ...rows,
      {
        order_item_id: id,
        order_id: p?.order_id ?? details.get(id)?.order_id ?? null,
        stage: 'added',
        fired_at: at,
        started_at: null,
        mark: p?.mark ?? null,
        done_undone: false,
        done_at: null,
        detail: details.get(id) ?? null,
        ...row,
      },
    ];
    arrived.set(id, at);
    dropPlanned(new Set([id]));
  }

  function catchUp(state: Record<string, unknown>): boolean {
    const part = KdsStationBody.safeParse(state['kds_station']);
    if (!part.success || part.data.station_id !== own) return false;
    const { now, details: next, ...rest } = part.data;
    meta = rest;
    details = new Map();
    for (const d of next) details.set(d.order_item_id, d);
    rows = now.map(({ stage, fired_at, started_at, mark, done_undone, ...d }) => {
      details.set(d.order_item_id, d);
      return { order_item_id: d.order_item_id, order_id: d.order_id, stage, fired_at, started_at, mark, done_undone, done_at: null, detail: d };
    });
    const plans = Array.isArray(state['station_plan']) ? (state['station_plan'] as unknown[]) : [];
    plan = null;
    for (const raw of plans) {
      const p = StationPlanBody.safeParse(raw);
      if (p.success && p.data.station_id === own) plan = p.data;
    }
    arrived = new Map();
    leaving = new Map();
    archived = null;
    return true;
  }

  /** one hub event; true when the store changed */
  function onEvent(type: string, p: Record<string, unknown>): boolean {
    if (meta === null) return false;
    const id = str(p['order_item_id']);
    const at = deps.now();
    switch (type) {
      case 'FireDispatched': {
        if (p['station_id'] !== own || !Array.isArray(p['order_item_ids'])) return false;
        const ids = (p['order_item_ids'] as unknown[]).flatMap((v) => (typeof v === 'string' && planned(v) !== undefined && rowOf(v) === undefined ? [v] : []));
        for (const fired of ids) enter(fired, at, {});
        return ids.length > 0;
      }
      case 'ItemStarted': {
        if (id === null || !held(id)) return false;
        const started_at = int(p['started_at']) ?? at;
        if (rowOf(id) === undefined) enter(id, at, { stage: 'cooking', started_at });
        else replace(id, { stage: 'cooking', started_at });
        return true;
      }
      case 'ItemDone': {
        if (id === null || !held(id)) return false;
        // the hub's done_at (hub clock), so the kept Done ends with the hub's UndoDone window
        const done_at = int(p['done_at']) ?? at;
        if (rowOf(id) === undefined) enter(id, at, { stage: 'done', done_at });
        else replace(id, { stage: 'done', done_at });
        return true;
      }
      case 'ItemDoneUndone':
        if (id === null || rowOf(id) === undefined) return false;
        replace(id, { stage: 'cooking', done_at: null, done_undone: true });
        return true;
      case 'ItemRemoved':
      case 'ItemVoided': {
        if (id === null || !held(id)) return false;
        const units = int(p['units']);
        const live = details.get(id)?.units;
        // a partial removal / void keeps the row; kds_lines re-sends its live units (B3-3)
        if (units !== null && (live === undefined || units < live)) return false;
        return remove([id]);
      }
      case 'ItemServed':
        return Array.isArray(p['order_item_ids']) && remove((p['order_item_ids'] as unknown[]).flatMap((v) => (typeof v === 'string' ? [v] : [])));
      case 'BusinessDayOpened':
        meta = { ...meta, day_open: true };
        return true;
      case 'BusinessDayClosed':
        meta = { ...meta, day_open: false };
        return true;
      case 'LanesSet': {
        const lanes_on = int(p['lanes_on']);
        const lane_count = int(p['lane_count']);
        if (p['station_id'] !== own || lanes_on === null || lane_count === null) return false;
        meta = { ...meta, lanes: { lanes_on, lane_count } };
        return true;
      }
      case 'StationCapacitySet': {
        // §3.7 mirror: a manager capacity = custom; null = all lanes on; lane reasons wait for the LanesSet that follows
        if (p['station_id'] !== own) return false;
        if (p['capacity_override'] === null) meta = { ...meta, lanes: { lanes_on: meta.lanes.lane_count, lane_count: meta.lanes.lane_count } };
        else if (p['reason'] === 'manager') meta = { ...meta, lanes: { lanes_on: null, lane_count: meta.lanes.lane_count } };
        else return false;
        return true;
      }
      case 'StationScreenSet': {
        const sound_volume = int(p['sound_volume']);
        if (p['station_id'] !== own || sound_volume === null) return false;
        meta = { ...meta, sound_volume };
        return true;
      }
      default:
        return false;
    }
  }

  function apply(frame: WsServerMessage): boolean {
    switch (frame.type) {
      case 'catch_up':
        return catchUp(frame.state);
      case 'event':
        return onEvent(frame.event.event_type, frame.event.payload);
      case 'kds_lines': {
        if (meta === null || frame.station_id !== own) return false;
        for (const d of frame.lines) {
          details.set(d.order_item_id, d);
          if (rowOf(d.order_item_id) !== undefined) replace(d.order_item_id, { detail: d, order_id: d.order_id });
        }
        return frame.lines.length > 0;
      }
      case 'station_plan': {
        if (meta === null || frame.station_id !== own) return false;
        const { station_id, as_of_seq, lines } = frame;
        const body = { station_id, as_of_seq, lines };
        const inNow = new Set(rows.map((r) => r.order_item_id));
        const kept = new Set(body.lines.map((l) => l.order_item_id));
        leaving = new Map((plan?.lines ?? []).filter((l) => !kept.has(l.order_item_id) && !inNow.has(l.order_item_id)).map((l) => [l.order_item_id, l]));
        plan = { ...body, lines: body.lines.filter((l) => !inNow.has(l.order_item_id)) };
        return true;
      }
      case 'station_notice':
        if (meta === null || frame.station_id !== own) return false;
        if (frame.kind === 'output') meta = { ...meta, has_printer: frame.has_printer };
        else archived = { open_lines: frame.open_lines };
        return true;
      default:
        return false;
    }
  }

  return {
    apply(frame) {
      if (apply(frame)) changed();
    },
    hold: (ids) => ids.filter(held),
    snapshot: () => view,
    prune() {
      const now = deps.now();
      const gone = rows.filter((r) => r.stage === 'done' && r.done_at !== null && now - r.done_at >= UNDO_DONE_MS).map((r) => r.order_item_id);
      if (remove(gone)) changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
