import type { LineDetail } from '@pos/domain';
import { KdsStationBody, type WsServerMessage } from '@pos/events';
import type { PassSnapshot, PassStore, PointLine, PointOrder, PointStation, PointViewBody, ServeFields } from './contracts';

// 03b v1.0.8 §3.4, §3.6, §6.15–§6.17 (P1): the Pass store of the point this tablet belongs to.
// - `catch_up` (every (re)connect) replaces everything from `point_view`; `seen_at` is emptied (catch-up orders carry
//   the hub's `placed_at` and `ready.at`). A catch-up without a valid `point_view` (a tablet without a point) = no view.
// - `point_lines` (this point only): a held line takes the new details and keeps its stage / handed_over, and its card
//   takes the identifier (Q-47, "T4" → "T9"); a new line joins its card as waiting (`added`); a new card goes last.
// - Kitchen progress (ItemStarted / ItemDone / ItemDoneUndone) moves stages; served / removed / voided / returned lines
//   drop off (a partial ItemRemoved / ItemVoided keeps the line: `point_lines` re-sends its units, B3-3); a card with
//   no line left drops off; OrderCancelled drops the card. ItemsReleased makes its lines `immediate` (Q-46).
// - Pass events of this point: ReadyToServe sets `ready`, ReadyToServeUndone clears it, Handover marks lines handed
//   over (the Ready stays, as `pass_orders.ready_at` in the catch-up), ReadyRetargeted moves the Ready's alert id.
// - Q-49 (#76): an event for an order_item_id (or order) the store does not hold changes nothing and calls no listener.
// - Q-55: a live card's `placed_at` and a live Ready's `at` = the hub clock (`now()`) at frame receipt, also kept in
//   `seen_at` (`<order_id>`, `ready:<order_id>`); a live Ready's `by` = the staff id this tablet claimed it for
//   (`claimReady`, after its own MarkReadyToServe; `claimHandover` for the Ready its own Handover made), else null
//   until the next catch-up.
// - §3.6: `station_takeover` opens / closes a takeover section (and the station's `dark`); `station_notice` `output`
//   keeps the section's `has_printer`, `archived` is kept per station (§3.10). Takeover rows themselves are drawn
//   from the section's own KDS store (P4), which reads the same frames.

/** What P2–P5 render: the contract snapshot plus the §3.10 archived notices since the last catch-up. */
export interface PassView extends PassSnapshot {
  /** station_id → open_lines of a `station_notice { kind: 'archived' }` */
  archived: ReadonlyMap<string, number>;
}

export interface PassStoreImpl extends PassStore {
  snapshot(): PassView;
  /**
   * Q-55: this tablet's MarkReadyToServe answered `{ alert_id }` (not `already`) for `staff_id`: the Ready with that
   * alert id shows that person, whether its frame came before or after the reply.
   */
  claimReady(alert_id: string, staff_id: string): void;
  /**
   * Q-55: this tablet's Handover answered `{ handover_id }` for `staff_id`. When that Handover made the Ready (no open
   * Ready before it: `ReadyToServe { alert_id: null }` in the same commit), the Ready shows that person, whether the
   * Handover frame came before or after the reply. A Ready that has its own alert keeps its own name.
   */
  claimHandover(handover_id: string, staff_id: string): void;
}

const EMPTY: PassView = { view: null, takeovers: new Map(), seen_at: new Map(), archived: new Map() };

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** a `point_view` part of the expected shape, else null (the hub's body has no shared zod schema) */
function readView(v: unknown): PointViewBody | null {
  if (!isObj(v) || typeof v['point_id'] !== 'string' || !Array.isArray(v['stations']) || !Array.isArray(v['orders'])) return null;
  const orders = (v['orders'] as unknown[]).filter((o): o is PointOrder => isObj(o) && typeof o['order_id'] === 'string' && Array.isArray(o['lines']));
  const stations = (v['stations'] as unknown[]).filter((s): s is PointStation => isObj(s) && typeof s['station_id'] === 'string');
  const takeovers = Array.isArray(v['takeovers']) ? (v['takeovers'] as unknown[]).flatMap((t) => {
    const p = KdsStationBody.safeParse(t);
    return p.success ? [p.data] : [];
  }) : [];
  return { point_id: v['point_id'], stations, orders, takeovers };
}

function serveOf(l: ServeFields): ServeFields {
  return {
    ...(l.group_id === undefined ? {} : { group_id: l.group_id }),
    ...(l.serve_mode === undefined ? {} : { serve_mode: l.serve_mode }),
  };
}

export function createPassStore(deps: { now: () => number }): PassStoreImpl {
  let point: string | null = null;
  let stations: PointStation[] = [];
  let orders: PointOrder[] = [];
  let takeovers = new Map<string, KdsStationBody>();
  let seen = new Map<string, number>();
  let archived = new Map<string, number>();
  /** order_id → the open Ready's alert id (from live frames; null after a catch-up or for a Handover's own Ready) */
  let readyAlert = new Map<string, string | null>();
  /** alert_id → staff_id claimed by this tablet (Q-55); kept for the page's life, a few per shift */
  const claims = new Map<string, string>();
  /** handover_id → staff_id claimed by this tablet for its own Handover (a Ready it created has no alert, Q-55) */
  const handClaims = new Map<string, string>();
  /** handover_id → order_id of Handover events seen since the last catch-up (for a claim after the frame) */
  let handOrders = new Map<string, string>();
  /**
   * B3-3: the hub sends a commit's `point_lines` (afterCommit hook, engine-host/writer.ts) before its events, so a
   * partial ItemRemoved / ItemVoided arrives after the line already shows its new units. order_item_id → the units
   * before the last re-send, compared by the next removal / void of that line, then forgotten.
   */
  let unitsBefore = new Map<string, number>();
  let snap: PassView = EMPTY;
  const listeners = new Set<() => void>();

  function changed(): void {
    snap =
      point === null
        ? EMPTY
        : {
            view: { point_id: point, stations: [...stations], orders: [...orders], takeovers: [...takeovers.values()] },
            takeovers: new Map(takeovers),
            seen_at: new Map(seen),
            archived: new Map(archived),
          };
    for (const fn of [...listeners]) fn();
  }

  const orderOfLine = (id: string): PointOrder | undefined => orders.find((o) => o.lines.some((l) => l.order_item_id === id));
  const inTakeover = (id: string): boolean =>
    [...takeovers.values()].some((b) => b.now.some((l) => l.order_item_id === id) || b.details.some((d) => d.order_item_id === id));
  const held = (id: string): boolean => orderOfLine(id) !== undefined || inTakeover(id);

  /** applies `fn` to the held lines in `targets`; true when one changed */
  function updateLines(targets: ReadonlySet<string>, fn: (l: PointLine) => PointLine): boolean {
    let hit = false;
    orders = orders.map((o) => {
      if (!o.lines.some((l) => targets.has(l.order_item_id))) return o;
      hit = true;
      return { ...o, lines: o.lines.map((l) => (targets.has(l.order_item_id) ? fn(l) : l)) };
    });
    return hit;
  }

  function dropLines(targets: ReadonlySet<string>): boolean {
    let hit = false;
    orders = orders.flatMap((o) => {
      if (!o.lines.some((l) => targets.has(l.order_item_id))) return [o];
      hit = true;
      const lines = o.lines.filter((l) => !targets.has(l.order_item_id));
      if (lines.length > 0) return [{ ...o, lines }];
      dropOrderState(o.order_id);
      return [];
    });
    return hit;
  }

  function dropOrderState(order_id: string): void {
    seen.delete(order_id);
    seen.delete(`ready:${order_id}`);
    readyAlert.delete(order_id);
  }

  /** Q-55: the open Ready of `order_id` was made by a Handover (no alert) and has no name yet → `staff_id` */
  function nameOwnHandoverReady(order_id: string, staff_id: string): boolean {
    const card = orders.find((o) => o.order_id === order_id);
    if (card?.ready == null || card.ready.by !== null || readyAlert.get(order_id) !== null) return false;
    setReady(order_id, { ...card.ready, by: staff_id });
    return true;
  }

  function setReady(order_id: string, ready: PointOrder['ready']): void {
    orders = orders.map((o) => (o.order_id === order_id ? { ...o, ready } : o));
  }

  function catchUp(state: Record<string, unknown>): boolean {
    const v = readView(state['point_view']);
    const had = point !== null;
    seen = new Map();
    archived = new Map();
    readyAlert = new Map();
    unitsBefore = new Map();
    handOrders = new Map();
    if (v === null) {
      point = null;
      stations = [];
      orders = [];
      takeovers = new Map();
      return had;
    }
    point = v.point_id;
    stations = v.stations;
    orders = v.orders;
    takeovers = new Map(v.takeovers.map((b) => [b.station_id, b]));
    return true;
  }

  function onPointLines(frame: Extract<WsServerMessage, { type: 'point_lines' }>): boolean {
    if (point === null || frame.point_id !== point) return false;
    let hit = false;
    for (const raw of frame.lines as Array<LineDetail & ServeFields>) {
      if (raw.point_id !== point) continue;
      hit = true;
      const { group_id, serve_mode, ...d } = raw;
      const serve = serveOf({ ...(group_id === undefined ? {} : { group_id }), ...(serve_mode === undefined ? {} : { serve_mode }) });
      const host = orderOfLine(d.order_item_id);
      if (host !== undefined) {
        const old = host.lines.find((l) => l.order_item_id === d.order_item_id)!.units;
        if (old !== d.units && !unitsBefore.has(d.order_item_id)) unitsBefore.set(d.order_item_id, old);
        orders = orders.map((o) =>
          o !== host
            ? o
            : {
                ...o,
                identifier: d.identifier,
                lines: o.lines.map((l) => (l.order_item_id === d.order_item_id ? { ...l, ...d, ...serve, stage: l.stage, handed_over: l.handed_over } : l)),
              },
        );
        continue;
      }
      const fresh: PointLine = { ...d, ...serve, stage: 'added', handed_over: false };
      const card = orders.find((o) => o.order_id === d.order_id);
      if (card !== undefined) {
        orders = orders.map((o) => (o === card ? { ...o, identifier: d.identifier, lines: [...o.lines, fresh] } : o));
      } else {
        const at = deps.now();
        seen.set(d.order_id, at);
        orders = [...orders, { order_id: d.order_id, identifier: d.identifier, placed_at: at, lines: [fresh], ready: null }];
      }
    }
    return hit;
  }

  function onEvent(type: string, p: Record<string, unknown>): boolean {
    if (point === null) return false;
    const id = str(p['order_item_id']);
    switch (type) {
      case 'ItemStarted':
        return id !== null && updateLines(new Set([id]), (l) => ({ ...l, stage: 'cooking' }));
      case 'ItemDone':
        return id !== null && updateLines(new Set([id]), (l) => ({ ...l, stage: 'done' }));
      case 'ItemDoneUndone':
        return id !== null && updateLines(new Set([id]), (l) => ({ ...l, stage: 'cooking' }));
      case 'ItemServed':
        return dropLines(new Set(ids(p['order_item_ids'])));
      case 'ItemReturned':
        return id !== null && dropLines(new Set([id]));
      case 'ItemRemoved':
      case 'ItemVoided': {
        if (id === null) return false;
        const units = int(p['units']);
        const live = orderOfLine(id)?.lines.find((l) => l.order_item_id === id)?.units;
        if (live === undefined) return false;
        // the units before this commit's re-send when there was one (B3-3: point_lines comes first), else the shown ones
        const was = unitsBefore.get(id) ?? live;
        unitsBefore.delete(id);
        // a partial removal / void keeps the line; point_lines re-sends its live units (B3-3)
        if (units !== null && units < was) return false;
        return dropLines(new Set([id]));
      }
      case 'OrderCancelled': {
        const order_id = str(p['order_id']);
        if (order_id === null || !orders.some((o) => o.order_id === order_id)) return false;
        orders = orders.filter((o) => o.order_id !== order_id);
        dropOrderState(order_id);
        return true;
      }
      case 'ItemsReleased':
        return updateLines(new Set([...ids(p['released']), ...ids(p['expedite'])]), (l) => ({ ...l, serve_mode: 'immediate' }));
      case 'LanesSet': {
        const station_id = str(p['station_id']);
        const lanes_on = int(p['lanes_on']);
        const lane_count = int(p['lane_count']);
        if (station_id === null || lanes_on === null || lane_count === null || !stations.some((s) => s.station_id === station_id)) return false;
        stations = stations.map((s) => (s.station_id === station_id ? { ...s, lanes: { lanes_on, lane_count } } : s));
        return true;
      }
    }
    // the Pass events: this point's held orders only
    const order_id = str(p['order_id']);
    if (p['point_id'] !== point || order_id === null || !orders.some((o) => o.order_id === order_id)) return false;
    switch (type) {
      case 'ReadyToServe': {
        const at = deps.now();
        const alert_id = str(p['alert_id']);
        readyAlert.set(order_id, alert_id);
        seen.set(`ready:${order_id}`, at);
        setReady(order_id, { at, by: alert_id === null ? null : (claims.get(alert_id) ?? null) });
        return true;
      }
      case 'ReadyToServeUndone':
        readyAlert.delete(order_id);
        seen.delete(`ready:${order_id}`);
        setReady(order_id, null);
        return true;
      case 'Handover': {
        const handover_id = str(p['handover_id']);
        if (handover_id !== null) handOrders.set(handover_id, order_id);
        const by = handover_id === null ? undefined : handClaims.get(handover_id);
        const named = by !== undefined && nameOwnHandoverReady(order_id, by);
        return updateLines(new Set(ids(p['order_item_ids'])), (l) => ({ ...l, handed_over: true })) || named;
      }
      case 'ReadyRetargeted': {
        const alert_id = str(p['alert_id']);
        if (alert_id !== null && readyAlert.has(order_id)) readyAlert.set(order_id, alert_id);
        return false;
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
      case 'point_lines':
        return onPointLines(frame);
      case 'station_takeover': {
        if (point === null) return false;
        if (frame.active) {
          if (frame.view === undefined) return false;
          takeovers = new Map(takeovers).set(frame.station_id, frame.view);
        } else {
          if (!takeovers.has(frame.station_id)) return false;
          takeovers = new Map(takeovers);
          takeovers.delete(frame.station_id);
        }
        stations = stations.map((s) => (s.station_id === frame.station_id ? { ...s, dark: frame.active } : s));
        return true;
      }
      case 'station_notice': {
        if (point === null) return false;
        if (frame.kind === 'archived') {
          archived = new Map(archived).set(frame.station_id, frame.open_lines);
          return true;
        }
        const body = takeovers.get(frame.station_id);
        if (body === undefined) return false;
        takeovers = new Map(takeovers).set(frame.station_id, { ...body, has_printer: frame.has_printer });
        return true;
      }
      default:
        return false;
    }
  }

  return {
    apply(frame) {
      if (apply(frame)) changed();
    },
    hold: (list) => list.filter(held),
    snapshot: () => snap,
    claimReady(alert_id, staff_id) {
      claims.set(alert_id, staff_id);
      const order_id = [...readyAlert].find(([, a]) => a === alert_id)?.[0];
      const card = order_id === undefined ? undefined : orders.find((o) => o.order_id === order_id);
      if (card?.ready == null || card.ready.by === staff_id) return;
      setReady(card.order_id, { ...card.ready, by: staff_id });
      changed();
    },
    claimHandover(handover_id, staff_id) {
      handClaims.set(handover_id, staff_id);
      const order_id = handOrders.get(handover_id);
      if (order_id !== undefined && nameOwnHandoverReady(order_id, staff_id)) changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
